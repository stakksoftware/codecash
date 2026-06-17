// CodeCash broker server. Built on Node's stdlib http so it runs with zero
// install. Responsibilities:
//   - publish the receipt/bundle public keys (FR6, FR7)
//   - persistent auth with silent refresh (FR19)
//   - serve the signed campaign bundle (FR9, FR16)
//   - ingest device-signed counters, run fraud checks (FR12-15), credit payouts
//     via the PUBLISHED formula, and return independently-verifiable signed
//     receipts (FR5, FR6)
//   - expose the transparent ledger and Stripe-backed payouts (FR22, FR23)
//
// The handler functions are exported so tests can drive them in-process.

import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  randomId,
  buildBundle,
  signBundle,
  verifyCounter,
  issueReceipt,
  computePayout,
} from '@codecash/core';
import * as store from './store.js';
import * as keysMod from './keys.js';
import * as payouts from './payouts.js';
import { SEED_CAMPAIGNS, SEED_CONVERSION_VALUE_MICROS } from './seed.js';
import { screenCounter, applyDailyVelocityCap } from './fraud.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ACCESS_TTL_MS = 15 * 60 * 1000; // short access token => exercises refresh
const BUNDLE_VERSION = '2026.06.17';

// ---- bundle (built + signed once per process, refreshed by version) --------

let _bundleCache;
export function currentBundle() {
  if (_bundleCache) return _bundleCache;
  const body = buildBundle({
    version: BUNDLE_VERSION,
    generatedAt: new Date().toISOString(),
    ttlSeconds: 3600,
    campaigns: SEED_CAMPAIGNS,
  });
  _bundleCache = signBundle(body, keysMod.bundleKeys().privateKey, keysMod.BUNDLE_KEY_ID);
  return _bundleCache;
}

const campaignsById = () => Object.fromEntries(SEED_CAMPAIGNS.map((c) => [c.id, c]));

// ---- helpers ---------------------------------------------------------------

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1_000_000) reject(new Error('payload too large'));
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function authAccount(req) {
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  return token ? store.resolveAccessToken(token) : null;
}

function newAuthBundle(accountId) {
  const accessToken = 'at_' + randomId(18);
  const refreshToken = 'rt_' + randomId(24);
  const expiresAt = new Date(Date.now() + ACCESS_TTL_MS).toISOString();
  store.createSession(accountId, { accessToken, refreshToken, expiresAt });
  return { accessToken, refreshToken, expiresAt };
}

// ---- handlers (exported for tests) -----------------------------------------

export const handlers = {
  async login(req, res) {
    const { email, deviceId, devicePublicKey } = await readJson(req);
    if (!email || !deviceId || !devicePublicKey) return send(res, 400, { error: 'email, deviceId, devicePublicKey required' });
    const account = store.upsertAccount(email);
    store.registerDevice(deviceId, account.accountId, devicePublicKey);
    const auth = newAuthBundle(account.accountId);
    send(res, 200, {
      account: { accountId: account.accountId, verified: account.identityVerified },
      auth,
      receiptPublicKey: keysMod.receiptKeys().publicKey,
      bundlePublicKey: keysMod.bundleKeys().publicKey,
    });
  },

  async refresh(req, res) {
    const { refreshToken } = await readJson(req);
    const accountId = store.resolveRefreshToken(refreshToken);
    if (!accountId) return send(res, 401, { error: 'invalid refresh token' });
    send(res, 200, newAuthBundle(accountId));
  },

  async bundle(req, res) {
    // Auth optional: the bundle is non-sensitive inventory. Targeting is local.
    send(res, 200, currentBundle());
  },

  async counters(req, res) {
    const accountId = authAccount(req);
    if (!accountId) return send(res, 401, { error: 'unauthorized' });
    const counter = await readJson(req);
    const body = counter.body;
    if (!body || !body.deviceId) return send(res, 400, { error: 'malformed counter' });

    const device = store.getDevice(body.deviceId);
    if (!device || device.accountId !== accountId) return send(res, 403, { error: 'unknown or mismatched device' });

    // 1) Signature + device binding.
    if (!verifyCounter(counter, device.publicKey)) return send(res, 400, { error: 'bad counter signature' });

    // 2) Fraud screen (replay, rate limit, anomaly clamps) — FR13.
    const screen = screenCounter({
      deviceId: body.deviceId,
      body,
      recentCount: store.recentCounterCount(body.deviceId),
      nonceAlreadySeen: store.nonceSeen(body.deviceId, body.nonce),
    });
    if (!screen.ok) return send(res, 429, { error: screen.reason });
    store.rememberNonce(body.deviceId, body.nonce);
    store.recordCounterSubmission(body.deviceId);

    // 3) Credit each event via the PUBLISHED formula, with a daily velocity cap.
    const byId = campaignsById();
    let creditedToday = store.creditedTodayMicros(accountId);
    const receipts = [];
    const credited = [];
    const issuedAt = new Date().toISOString();

    for (const ev of body.events || []) {
      const campaign = byId[ev.campaignId];
      if (!campaign) continue; // ignore unknown campaigns

      // Server uses ITS OWN cpm / conversion value, never the client's, so a
      // client cannot inflate its own payout (fraud control).
      const cpmMicros = campaign.cpmMicros;
      const conversionValueMicros =
        ev.type === 'conversion' ? SEED_CONVERSION_VALUE_MICROS[ev.campaignId] ?? campaign.cpmMicros : undefined;

      const units = Math.max(1, Math.floor(ev.count || 1));
      const single = computePayout({
        type: ev.type,
        cpmMicros,
        conversionValueMicros,
        quality: ev.quality ?? 1,
        units,
      });

      if (single.grossMicros <= 0) {
        credited.push({ campaignId: ev.campaignId, type: ev.type, grossMicros: 0, note: 'quality-gated to $0' });
        continue;
      }

      // Daily velocity cap (FR13) — reduce units to fit remaining headroom.
      const perUnitGross = single.grossMicros / units;
      const cap = applyDailyVelocityCap(creditedToday, single.grossMicros);
      let payableUnits = units;
      if (cap.capped) {
        payableUnits = Math.floor(cap.allowedGross / perUnitGross);
      }
      if (payableUnits <= 0) {
        credited.push({ campaignId: ev.campaignId, type: ev.type, grossMicros: 0, note: 'daily earnings cap reached' });
        continue;
      }

      const eventId = 'evt_' + randomId(8);
      const receipt = issueReceipt(
        {
          eventId,
          issuedAt,
          deviceId: body.deviceId,
          advertiser: campaign.advertiser,
          campaignId: ev.campaignId,
          type: ev.type,
          cpmMicros: ev.type === 'conversion' ? null : cpmMicros,
          conversionValueMicros: conversionValueMicros ?? null,
          quality: ev.quality ?? 1,
          units: payableUnits,
        },
        keysMod.receiptKeys().privateKey,
        { keyId: keysMod.RECEIPT_KEY_ID },
      );

      store.appendLedger({
        accountId,
        deviceId: body.deviceId,
        eventId,
        issuedAt,
        advertiser: campaign.advertiser,
        campaignId: ev.campaignId,
        type: ev.type,
        amounts: receipt.body.amounts,
        receipt,
      });
      creditedToday += receipt.body.amounts.grossMicros;
      receipts.push(receipt);
      credited.push({ campaignId: ev.campaignId, type: ev.type, units: payableUnits, grossMicros: receipt.body.amounts.grossMicros });
    }

    send(res, 200, { ok: true, receipts, credited, flags: screen.flags });
  },

  async ledger(req, res) {
    const accountId = authAccount(req);
    if (!accountId) return send(res, 401, { error: 'unauthorized' });
    const entries = store.ledgerForAccount(accountId);
    const grossMicros = entries.reduce((s, e) => s + (e.amounts?.grossMicros || 0), 0);
    const netMicros = entries.reduce((s, e) => s + (e.amounts?.netMicros || 0), 0);
    send(res, 200, {
      count: entries.length,
      grossMicros,
      netMicros,
      platformMicros: grossMicros - netMicros,
      balanceMicros: store.balanceMicros(accountId),
      entries,
    });
  },

  async payouts(req, res) {
    const accountId = authAccount(req);
    if (!accountId) return send(res, 401, { error: 'unauthorized' });
    send(res, 200, payouts.payoutStatus(accountId));
  },

  async withdraw(req, res) {
    const accountId = authAccount(req);
    if (!accountId) return send(res, 401, { error: 'unauthorized' });
    const result = await payouts.withdraw(accountId);
    send(res, result.ok ? 200 : 400, result);
  },

  // Demo/admin: simulate the verified-identity (KYC) step required at cash-out
  // (FR15). Guarded by an admin token in non-test use.
  async verifyIdentity(req, res) {
    const { accountId, adminToken } = await readJson(req);
    if (process.env.CODECASH_ADMIN_TOKEN && adminToken !== process.env.CODECASH_ADMIN_TOKEN) {
      return send(res, 403, { error: 'forbidden' });
    }
    const acct = store.setIdentityVerified(accountId, true);
    if (!acct) return send(res, 404, { error: 'no such account' });
    send(res, 200, { ok: true, accountId, identityVerified: true });
  },

  wellKnownKeys(req, res) {
    const doc = keysMod.publicKeyDoc();
    // The verify command reads `.publicKey` at the top level for the receipt key.
    send(res, 200, { ...doc.receipt, keys: doc });
  },

  health(req, res) {
    send(res, 200, { ok: true, service: 'codecash-server', bundleVersion: BUNDLE_VERSION });
  },

  dashboard(req, res) {
    const file = path.join(here, '..', 'public', 'dashboard.html');
    try {
      const html = fs.readFileSync(file);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch {
      send(res, 404, { error: 'dashboard not found' });
    }
  },
};

// ---- router ----------------------------------------------------------------

export function createServer() {
  store.init();
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const p = url.pathname;
      const m = req.method;

      if (p === '/healthz') return handlers.health(req, res);
      if (p === '/' || p === '/dashboard') return handlers.dashboard(req, res);
      if (p === '/.well-known/codecash-receipts.json') return handlers.wellKnownKeys(req, res);

      if (p === '/v1/auth/login' && m === 'POST') return handlers.login(req, res);
      if (p === '/v1/auth/refresh' && m === 'POST') return handlers.refresh(req, res);
      if (p === '/v1/bundle' && m === 'GET') return handlers.bundle(req, res);
      if (p === '/v1/counters' && m === 'POST') return handlers.counters(req, res);
      if (p === '/v1/ledger' && m === 'GET') return handlers.ledger(req, res);
      if (p === '/v1/payouts' && m === 'GET') return handlers.payouts(req, res);
      if (p === '/v1/payouts/withdraw' && m === 'POST') return handlers.withdraw(req, res);
      if (p === '/v1/admin/verify-identity' && m === 'POST') return handlers.verifyIdentity(req, res);

      send(res, 404, { error: 'not found' });
    } catch (e) {
      send(res, 500, { error: e?.message || 'server error' });
    }
  });
}

// ---- entrypoint ------------------------------------------------------------

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const port = Number(process.env.PORT || 8787);
  const server = createServer();
  server.listen(port, () => {
    const doc = keysMod.publicKeyDoc();
    console.log(`CodeCash server listening on http://127.0.0.1:${port}`);
    console.log(`  dashboard:    http://127.0.0.1:${port}/`);
    console.log(`  receipt key:  ${doc.receipt.publicKey}`);
    console.log(`  bundle:       v${BUNDLE_VERSION} (${SEED_CAMPAIGNS.length} seeded campaigns)`);
    console.log(`  payout rails: ${payouts.payoutStatus('').rails}`);
  });
}
