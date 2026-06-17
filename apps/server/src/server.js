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
  billingInputs,
  validateCampaign,
  describePricing,
} from '@codecash/core';
import * as store from './store.js';
import * as keysMod from './keys.js';
import * as payouts from './payouts.js';
import * as broker from './broker.js';
import { SEED_CAMPAIGNS, SEED_CONVERSION_VALUE_MICROS } from './seed.js';
import { screenCounter, applyDailyVelocityCap } from './fraud.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ACCESS_TTL_MS = 15 * 60 * 1000; // short access token => exercises refresh
const BUNDLE_VERSION = '2026.06.17';

// ---- bundle (built + signed fresh; inventory = seeded floor + live demand) --

// Only ad-serving fields go into the PUBLIC bundle. Advertiser budgets, spend,
// bids, and objectives stay server-side (objective is harmless, included for the
// dashboard but pricing values are not).
function publicCampaign(c) {
  const pub = {
    id: c.id,
    advertiser: c.advertiser,
    model: c.model,
    text: c.text,
  };
  if (c.url) pub.url = c.url;
  if (c.tags) pub.tags = c.tags;
  if (c.requireTags) pub.requireTags = c.requireTags;
  if (c.weight != null) pub.weight = c.weight;
  if (c.dailyCapImpressions != null) pub.dailyCapImpressions = c.dailyCapImpressions;
  if (c.objective) pub.objective = c.objective;
  // Legacy seed campaigns publish their CPM floor (not sensitive); objective
  // campaigns never publish their bid.
  if (!c.objective && c.cpmMicros != null) pub.cpmMicros = c.cpmMicros;
  return pub;
}

export function inventory() {
  // Seeded floor (FR9) UNION live, funded advertiser campaigns (Phase 2).
  return [...SEED_CAMPAIGNS, ...store.activeCampaigns()];
}

export function currentBundle() {
  const live = store.activeCampaigns();
  const body = buildBundle({
    version: `${BUNDLE_VERSION}+${live.length}`,
    generatedAt: new Date().toISOString(),
    ttlSeconds: 3600,
    campaigns: [...SEED_CAMPAIGNS, ...live].map(publicCampaign),
  });
  return signBundle(body, keysMod.bundleKeys().privateKey, keysMod.BUNDLE_KEY_ID);
}

// Full (server-side) campaign record by id — seeded floor first, else a store
// (advertiser) campaign. Returns even exhausted/paused store campaigns so an
// in-flight counter can still settle against remaining budget.
const SEED_BY_ID = Object.fromEntries(SEED_CAMPAIGNS.map((c) => [c.id, c]));
function lookupCampaign(id) {
  return SEED_BY_ID[id] || store.getCampaign(id) || null;
}

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

// Advertisers authenticate with an API key (x-api-key) — separate identity space
// from earner accounts.
function authAdvertiser(req) {
  const key = req.headers['x-api-key'];
  return key ? store.resolveApiKey(key) : null;
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

    // 3) Credit each event via the PUBLISHED formula, with a daily velocity cap
    //    and (for advertiser campaigns) per-campaign budget pacing.
    let creditedToday = store.creditedTodayMicros(accountId);
    const receipts = [];
    const credited = [];
    const issuedAt = new Date().toISOString();

    for (const ev of body.events || []) {
      const campaign = lookupCampaign(ev.campaignId);
      if (!campaign) continue; // ignore unknown campaigns

      // Server-authoritative pricing: derive billing inputs from the campaign's
      // objective/bid (Phase 2) — never trust client-supplied cpm. Legacy seed
      // campaigns fall back to their published CPM / conversion value.
      const inputs = billingInputs(
        campaign.objective
          ? campaign
          : { ...campaign, conversionValueMicros: SEED_CONVERSION_VALUE_MICROS[ev.campaignId] ?? campaign.cpmMicros },
        ev.type,
      );

      const units = Math.max(1, Math.floor(ev.count || 1));
      const single = computePayout({
        type: inputs.type,
        cpmMicros: inputs.cpmMicros,
        conversionValueMicros: inputs.conversionValueMicros,
        quality: ev.quality ?? 1,
        units,
      });

      // "Invalid traffic" = a billable event that was quality-gated to $0 (fraud
      // signal). A non-billable event type for this objective is not invalid.
      store.recordCampaignEvent(ev.campaignId, ev.type, { flagged: inputs.billable && single.grossMicros <= 0 });

      if (single.grossMicros <= 0) {
        credited.push({ campaignId: ev.campaignId, type: ev.type, grossMicros: 0, note: inputs.billable ? 'quality-gated to $0' : 'not the billable event for this objective' });
        continue;
      }

      // Caps: daily earnings velocity (FR13) AND advertiser budget pacing.
      const perUnitGross = single.grossMicros / units;
      const velocity = applyDailyVelocityCap(creditedToday, single.grossMicros);
      const budgetRemaining = store.campaignRemainingBudget(ev.campaignId); // Infinity for seed
      const allowedGross = Math.min(velocity.allowedGross, budgetRemaining);
      let payableUnits = allowedGross >= single.grossMicros ? units : Math.floor(allowedGross / perUnitGross);
      if (payableUnits <= 0) {
        // Already counted above; a cap is not invalid traffic, just throttling.
        const note = budgetRemaining <= 0 ? 'advertiser budget exhausted' : 'daily earnings cap reached';
        credited.push({ campaignId: ev.campaignId, type: ev.type, grossMicros: 0, note });
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
          type: inputs.type,
          cpmMicros: inputs.type === 'conversion' ? null : inputs.cpmMicros,
          conversionValueMicros: inputs.conversionValueMicros ?? null,
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
        type: inputs.type,
        amounts: receipt.body.amounts,
        receipt,
      });
      // Bill the advertiser for the gross (no-op for seed/legacy campaigns).
      store.recordSpend(ev.campaignId, receipt.body.amounts.grossMicros);
      creditedToday += receipt.body.amounts.grossMicros;
      receipts.push(receipt);
      credited.push({ campaignId: ev.campaignId, type: inputs.type, units: payableUnits, grossMicros: receipt.body.amounts.grossMicros });
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

  // ---- Phase 2: advertiser (demand) API ------------------------------------

  async advertiserRegister(req, res) {
    const { name, email } = await readJson(req);
    if (!name || !email) return send(res, 400, { error: 'name and email required' });
    const apiKey = 'adk_' + randomId(20);
    const { advertiser } = store.createAdvertiser({ name, email, apiKey });
    send(res, 200, {
      advertiserId: advertiser.advertiserId,
      apiKey, // shown ONCE; the advertiser stores it
      balanceMicros: advertiser.balanceMicros,
      dashboard: '/advertiser',
    });
  },

  async advertiserFund(req, res) {
    const advertiserId = authAdvertiser(req);
    if (!advertiserId) return send(res, 401, { error: 'invalid api key' });
    const { amountMicros } = await readJson(req);
    if (!(amountMicros > 0)) return send(res, 400, { error: 'amountMicros > 0 required' });
    // In production this is a Stripe charge; here we credit the budget directly.
    const adv = store.fundAdvertiser(advertiserId, Math.floor(amountMicros));
    send(res, 200, { advertiserId, balanceMicros: adv.balanceMicros });
  },

  async advertiserCreateCampaign(req, res) {
    const advertiserId = authAdvertiser(req);
    if (!advertiserId) return send(res, 401, { error: 'invalid api key' });
    const input = await readJson(req);
    const v = validateCampaign(input);
    if (!v.ok) return send(res, 400, { error: 'invalid campaign', details: v.errors });
    const campaign = store.createCampaign(advertiserId, {
      advertiser: input.advertiser,
      model: input.model || 'sponsor',
      objective: input.objective,
      bidMicros: input.bidMicros,
      text: input.text,
      url: input.url,
      tags: input.tags,
      requireTags: input.requireTags,
      weight: input.weight,
      dailyCapImpressions: input.dailyCapImpressions,
      budgetMicros: input.budgetMicros ?? 0,
    });
    send(res, 200, { campaign, pricing: describePricing(campaign) });
  },

  async advertiserListCampaigns(req, res) {
    const advertiserId = authAdvertiser(req);
    if (!advertiserId) return send(res, 401, { error: 'invalid api key' });
    const campaigns = store.campaignsForAdvertiser(advertiserId).map((c) => ({
      ...c,
      pricing: describePricing(c),
      stats: store.campaignStats(c.id),
      remainingBudgetMicros: store.campaignRemainingBudget(c.id),
    }));
    send(res, 200, { campaigns });
  },

  async advertiserStats(req, res) {
    const advertiserId = authAdvertiser(req);
    if (!advertiserId) return send(res, 401, { error: 'invalid api key' });
    const adv = store.getAdvertiser(advertiserId);
    const campaigns = store.campaignsForAdvertiser(advertiserId);
    let impressions = 0, engagements = 0, conversions = 0, flagged = 0, spentMicros = 0;
    for (const c of campaigns) {
      const s = store.campaignStats(c.id);
      impressions += s.impressions; engagements += s.engagements;
      conversions += s.conversions; flagged += s.flagged; spentMicros += s.spentMicros;
    }
    const total = impressions + engagements + conversions + flagged;
    send(res, 200, {
      advertiserId,
      name: adv?.name,
      balanceMicros: adv?.balanceMicros ?? 0,
      campaigns: campaigns.length,
      impressions, engagements, conversions, flagged, spentMicros,
      invalidTrafficRate: total ? +(flagged / total).toFixed(4) : 0,
    });
  },

  async adminImportFeed(req, res) {
    const { offers, adminToken } = await readJson(req);
    if (process.env.CODECASH_ADMIN_TOKEN && adminToken !== process.env.CODECASH_ADMIN_TOKEN) {
      return send(res, 403, { error: 'forbidden' });
    }
    const result = broker.importFeed(offers || []);
    send(res, 200, { ok: true, ...result });
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
    serveHtml(res, 'dashboard.html');
  },

  advertiserDashboard(req, res) {
    serveHtml(res, 'advertiser.html');
  },
};

function serveHtml(res, name) {
  try {
    const html = fs.readFileSync(path.join(here, '..', 'public', name));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch {
    send(res, 404, { error: `${name} not found` });
  }
}

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
      if (p === '/advertiser') return handlers.advertiserDashboard(req, res);
      if (p === '/.well-known/codecash-receipts.json') return handlers.wellKnownKeys(req, res);

      if (p === '/v1/auth/login' && m === 'POST') return handlers.login(req, res);
      if (p === '/v1/auth/refresh' && m === 'POST') return handlers.refresh(req, res);
      if (p === '/v1/bundle' && m === 'GET') return handlers.bundle(req, res);
      if (p === '/v1/counters' && m === 'POST') return handlers.counters(req, res);
      if (p === '/v1/ledger' && m === 'GET') return handlers.ledger(req, res);
      if (p === '/v1/payouts' && m === 'GET') return handlers.payouts(req, res);
      if (p === '/v1/payouts/withdraw' && m === 'POST') return handlers.withdraw(req, res);
      if (p === '/v1/admin/verify-identity' && m === 'POST') return handlers.verifyIdentity(req, res);

      // ---- Phase 2: advertiser (demand) API ----
      if (p === '/v1/advertisers' && m === 'POST') return handlers.advertiserRegister(req, res);
      if (p === '/v1/advertisers/fund' && m === 'POST') return handlers.advertiserFund(req, res);
      if (p === '/v1/advertisers/campaigns' && m === 'POST') return handlers.advertiserCreateCampaign(req, res);
      if (p === '/v1/advertisers/campaigns' && m === 'GET') return handlers.advertiserListCampaigns(req, res);
      if (p === '/v1/advertisers/stats' && m === 'GET') return handlers.advertiserStats(req, res);
      if (p === '/v1/admin/import-feed' && m === 'POST') return handlers.adminImportFeed(req, res);

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
    console.log(`  earner dashboard:     http://127.0.0.1:${port}/`);
    console.log(`  advertiser dashboard: http://127.0.0.1:${port}/advertiser`);
    console.log(`  receipt key:          ${doc.receipt.publicKey}`);
    console.log(`  inventory:            ${SEED_CAMPAIGNS.length} seeded + ${store.activeCampaigns().length} live campaigns`);
    console.log(`  payout rails:         ${payouts.payoutStatus('').rails}`);
  });
}
