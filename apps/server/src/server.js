// CodeCash broker server. The same router runs two ways:
//   - locally as a Node stdlib http server (`createServer().listen()`)
//   - on Vercel as a serverless function (`export handle` + `ensureReady`)
//
// Storage is backend-agnostic via ./db.js (file store locally, Supabase Postgres
// in production). Every store call is awaited, so both a sync (file) and async
// (Postgres) backend work unchanged.
//
// Responsibilities: publish keys (FR6/FR7), persistent auth (FR19), signed
// bundle (FR9/FR16), counter ingestion + fraud checks (FR12-15) crediting via the
// PUBLISHED formula into signed receipts (FR5/FR6), transparent ledger, Stripe
// payouts (FR22/FR23), and the Phase 2 advertiser/demand API.

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
import * as store from './db.js';
import * as keysMod from './keys.js';
import * as payouts from './payouts.js';
import * as broker from './broker.js';
import { SEED_CAMPAIGNS, SEED_CONVERSION_VALUE_MICROS } from './seed.js';
import { screenCounter, applyDailyVelocityCap } from './fraud.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ACCESS_TTL_MS = 15 * 60 * 1000; // short access token => exercises refresh
const BUNDLE_VERSION = '2026.06.17';

// ---- bundle (built + signed fresh; inventory = seeded floor + live demand) --

function publicCampaign(c) {
  const pub = { id: c.id, advertiser: c.advertiser, model: c.model, text: c.text };
  if (c.url) pub.url = c.url;
  if (c.tags) pub.tags = c.tags;
  if (c.requireTags) pub.requireTags = c.requireTags;
  if (c.weight != null) pub.weight = c.weight;
  if (c.dailyCapImpressions != null) pub.dailyCapImpressions = c.dailyCapImpressions;
  if (c.objective) pub.objective = c.objective;
  // Legacy seed campaigns publish their CPM floor; objective campaigns never
  // publish their bid.
  if (!c.objective && c.cpmMicros != null) pub.cpmMicros = c.cpmMicros;
  return pub;
}

export async function currentBundle() {
  const live = await store.activeCampaigns();
  const body = buildBundle({
    version: `${BUNDLE_VERSION}+${live.length}`,
    generatedAt: new Date().toISOString(),
    ttlSeconds: 3600,
    campaigns: [...SEED_CAMPAIGNS, ...live].map(publicCampaign),
  });
  return signBundle(body, keysMod.bundleKeys().privateKey, keysMod.BUNDLE_KEY_ID);
}

const SEED_BY_ID = Object.fromEntries(SEED_CAMPAIGNS.map((c) => [c.id, c]));
async function lookupCampaign(id) {
  return SEED_BY_ID[id] || (await store.getCampaign(id)) || null;
}

// ---- helpers ---------------------------------------------------------------

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
    // CORS: dashboards may be served from a different origin (e.g. Vercel) than
    // the API. Public, read-mostly endpoints; auth is via bearer/api-key headers.
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, x-api-key, content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  });
  res.end(body);
}

function readJson(req) {
  // Serverless platforms (Vercel) may pre-parse the body onto req.body; the
  // local http server streams it. Handle both.
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') return Promise.resolve(req.body ? JSON.parse(req.body) : {});
    return Promise.resolve(req.body);
  }
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

async function authAccount(req) {
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  return token ? store.resolveAccessToken(token) : null;
}

async function authAdvertiser(req) {
  const key = req.headers['x-api-key'];
  return key ? store.resolveApiKey(key) : null;
}

async function newAuthBundle(accountId) {
  const accessToken = 'at_' + randomId(18);
  const refreshToken = 'rt_' + randomId(24);
  const expiresAt = new Date(Date.now() + ACCESS_TTL_MS).toISOString();
  await store.createSession(accountId, { accessToken, refreshToken, expiresAt });
  return { accessToken, refreshToken, expiresAt };
}

// ---- handlers --------------------------------------------------------------

export const handlers = {
  async login(req, res) {
    const { email, deviceId, devicePublicKey } = await readJson(req);
    if (!email || !deviceId || !devicePublicKey) return send(res, 400, { error: 'email, deviceId, devicePublicKey required' });
    const account = await store.upsertAccount(email);
    await store.registerDevice(deviceId, account.accountId, devicePublicKey);
    const auth = await newAuthBundle(account.accountId);
    send(res, 200, {
      account: { accountId: account.accountId, verified: account.identityVerified },
      auth,
      receiptPublicKey: keysMod.receiptKeys().publicKey,
      bundlePublicKey: keysMod.bundleKeys().publicKey,
    });
  },

  async refresh(req, res) {
    const { refreshToken } = await readJson(req);
    const accountId = await store.resolveRefreshToken(refreshToken);
    if (!accountId) return send(res, 401, { error: 'invalid refresh token' });
    send(res, 200, await newAuthBundle(accountId));
  },

  async bundle(req, res) {
    send(res, 200, await currentBundle());
  },

  async counters(req, res) {
    const accountId = await authAccount(req);
    if (!accountId) return send(res, 401, { error: 'unauthorized' });
    const counter = await readJson(req);
    const body = counter.body;
    if (!body || !body.deviceId) return send(res, 400, { error: 'malformed counter' });

    const device = await store.getDevice(body.deviceId);
    if (!device || device.accountId !== accountId) return send(res, 403, { error: 'unknown or mismatched device' });

    // 1) Signature + device binding.
    if (!verifyCounter(counter, device.publicKey)) return send(res, 400, { error: 'bad counter signature' });

    // 2) Fraud screen (replay, rate limit, anomaly clamps) — FR13.
    const screen = screenCounter({
      deviceId: body.deviceId,
      body,
      recentCount: await store.recentCounterCount(body.deviceId),
      nonceAlreadySeen: await store.nonceSeen(body.deviceId, body.nonce),
    });
    if (!screen.ok) return send(res, 429, { error: screen.reason });
    await store.rememberNonce(body.deviceId, body.nonce);
    await store.recordCounterSubmission(body.deviceId);

    // 3) Credit each event via the PUBLISHED formula, with a daily velocity cap
    //    and (for advertiser campaigns) per-campaign budget pacing.
    let creditedToday = await store.creditedTodayMicros(accountId);
    const receipts = [];
    const credited = [];
    const issuedAt = new Date().toISOString();

    for (const ev of body.events || []) {
      const campaign = await lookupCampaign(ev.campaignId);
      if (!campaign) continue;

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

      await store.recordCampaignEvent(ev.campaignId, ev.type, { flagged: inputs.billable && single.grossMicros <= 0 });

      if (single.grossMicros <= 0) {
        credited.push({ campaignId: ev.campaignId, type: ev.type, grossMicros: 0, note: inputs.billable ? 'quality-gated to $0' : 'not the billable event for this objective' });
        continue;
      }

      const perUnitGross = single.grossMicros / units;
      const velocity = applyDailyVelocityCap(creditedToday, single.grossMicros);
      const budgetRemaining = await store.campaignRemainingBudget(ev.campaignId); // Infinity for seed
      const allowedGross = Math.min(velocity.allowedGross, budgetRemaining);
      const payableUnits = allowedGross >= single.grossMicros ? units : Math.floor(allowedGross / perUnitGross);
      if (payableUnits <= 0) {
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

      await store.appendLedger({
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
      await store.recordSpend(ev.campaignId, receipt.body.amounts.grossMicros);
      creditedToday += receipt.body.amounts.grossMicros;
      receipts.push(receipt);
      credited.push({ campaignId: ev.campaignId, type: inputs.type, units: payableUnits, grossMicros: receipt.body.amounts.grossMicros });
    }

    send(res, 200, { ok: true, receipts, credited, flags: screen.flags });
  },

  async ledger(req, res) {
    const accountId = await authAccount(req);
    if (!accountId) return send(res, 401, { error: 'unauthorized' });
    const entries = await store.ledgerForAccount(accountId);
    const grossMicros = entries.reduce((s, e) => s + (e.amounts?.grossMicros || 0), 0);
    const netMicros = entries.reduce((s, e) => s + (e.amounts?.netMicros || 0), 0);
    send(res, 200, {
      count: entries.length,
      grossMicros,
      netMicros,
      platformMicros: grossMicros - netMicros,
      balanceMicros: await store.balanceMicros(accountId),
      entries,
    });
  },

  async payouts(req, res) {
    const accountId = await authAccount(req);
    if (!accountId) return send(res, 401, { error: 'unauthorized' });
    send(res, 200, await payouts.payoutStatus(accountId));
  },

  async withdraw(req, res) {
    const accountId = await authAccount(req);
    if (!accountId) return send(res, 401, { error: 'unauthorized' });
    const result = await payouts.withdraw(accountId);
    send(res, result.ok ? 200 : 400, result);
  },

  async verifyIdentity(req, res) {
    const { accountId, adminToken } = await readJson(req);
    if (process.env.CODECASH_ADMIN_TOKEN && adminToken !== process.env.CODECASH_ADMIN_TOKEN) {
      return send(res, 403, { error: 'forbidden' });
    }
    const acct = await store.setIdentityVerified(accountId, true);
    if (!acct) return send(res, 404, { error: 'no such account' });
    send(res, 200, { ok: true, accountId, identityVerified: true });
  },

  // ---- Phase 2: advertiser (demand) API ------------------------------------

  async advertiserRegister(req, res) {
    const { name, email } = await readJson(req);
    if (!name || !email) return send(res, 400, { error: 'name and email required' });
    const apiKey = 'adk_' + randomId(20);
    const { advertiser } = await store.createAdvertiser({ name, email, apiKey });
    send(res, 200, {
      advertiserId: advertiser.advertiserId,
      apiKey,
      balanceMicros: advertiser.balanceMicros,
      dashboard: '/advertiser',
    });
  },

  async advertiserFund(req, res) {
    const advertiserId = await authAdvertiser(req);
    if (!advertiserId) return send(res, 401, { error: 'invalid api key' });
    const { amountMicros } = await readJson(req);
    if (!(amountMicros > 0)) return send(res, 400, { error: 'amountMicros > 0 required' });
    const adv = await store.fundAdvertiser(advertiserId, Math.floor(amountMicros));
    send(res, 200, { advertiserId, balanceMicros: adv.balanceMicros });
  },

  async advertiserCreateCampaign(req, res) {
    const advertiserId = await authAdvertiser(req);
    if (!advertiserId) return send(res, 401, { error: 'invalid api key' });
    const input = await readJson(req);
    const v = validateCampaign(input);
    if (!v.ok) return send(res, 400, { error: 'invalid campaign', details: v.errors });
    const campaign = await store.createCampaign(advertiserId, {
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
    const advertiserId = await authAdvertiser(req);
    if (!advertiserId) return send(res, 401, { error: 'invalid api key' });
    // Fetch advertiser balance once + all per-campaign stats in parallel, and
    // compute remaining budget locally (no extra round-trips per campaign).
    const [list, adv] = await Promise.all([store.campaignsForAdvertiser(advertiserId), store.getAdvertiser(advertiserId)]);
    const statsList = await Promise.all(list.map((c) => store.campaignStats(c.id)));
    const advBalance = adv?.balanceMicros ?? 0;
    const campaigns = list.map((c, i) => ({
      ...c,
      pricing: describePricing(c),
      stats: statsList[i],
      remainingBudgetMicros: Math.max(0, Math.min(c.budgetMicros - c.spentMicros, advBalance)),
    }));
    send(res, 200, { campaigns });
  },

  async advertiserSetCampaignStatus(req, res) {
    const advertiserId = await authAdvertiser(req);
    if (!advertiserId) return send(res, 401, { error: 'invalid api key' });
    const { id, status } = await readJson(req);
    if (!['active', 'paused'].includes(status)) return send(res, 400, { error: 'status must be "active" or "paused"' });
    const c = await store.getCampaign(id);
    if (!c || c.advertiserId !== advertiserId) return send(res, 404, { error: 'no such campaign' });
    const updated = await store.setCampaignStatus(id, status);
    send(res, 200, { ok: true, id, status: updated?.status ?? status });
  },

  async advertiserUpdateCampaign(req, res) {
    const advertiserId = await authAdvertiser(req);
    if (!advertiserId) return send(res, 401, { error: 'invalid api key' });
    const input = await readJson(req);
    const c = await store.getCampaign(input.id);
    if (!c || c.advertiserId !== advertiserId) return send(res, 404, { error: 'no such campaign' });

    const fields = {};
    if (input.bidMicros != null) {
      if (!(input.bidMicros > 0)) return send(res, 400, { error: 'bidMicros must be > 0' });
      fields.bidMicros = Math.floor(input.bidMicros);
    }
    if (input.budgetMicros != null) {
      if (!(input.budgetMicros >= 0)) return send(res, 400, { error: 'budgetMicros must be >= 0' });
      fields.budgetMicros = Math.floor(input.budgetMicros);
    }
    if (input.text != null) {
      if (!input.text || input.text.length > 120) return send(res, 400, { error: 'text required, <=120 chars' });
      fields.text = input.text;
    }
    if ('url' in input) fields.url = input.url || null;
    if ('tags' in input) fields.tags = Array.isArray(input.tags) ? input.tags : null;

    // Raising budget above spend un-exhausts a campaign (unless the advertiser
    // paused it); dropping below spend exhausts it.
    const newBudget = fields.budgetMicros ?? c.budgetMicros;
    if (c.status !== 'paused') fields.status = newBudget - c.spentMicros > 0 ? 'active' : 'exhausted';

    const updated = await store.updateCampaign(input.id, fields);
    send(res, 200, { ok: true, campaign: updated, pricing: describePricing(updated) });
  },

  async advertiserDeleteCampaign(req, res) {
    const advertiserId = await authAdvertiser(req);
    if (!advertiserId) return send(res, 401, { error: 'invalid api key' });
    const { id } = await readJson(req);
    const c = await store.getCampaign(id);
    if (!c || c.advertiserId !== advertiserId) return send(res, 404, { error: 'no such campaign' });
    await store.deleteCampaign(id);
    send(res, 200, { ok: true, id });
  },

  async advertiserStats(req, res) {
    const advertiserId = await authAdvertiser(req);
    if (!advertiserId) return send(res, 401, { error: 'invalid api key' });
    const [adv, campaigns] = await Promise.all([store.getAdvertiser(advertiserId), store.campaignsForAdvertiser(advertiserId)]);
    const statsList = await Promise.all(campaigns.map((c) => store.campaignStats(c.id)));
    let impressions = 0, engagements = 0, conversions = 0, flagged = 0, spentMicros = 0;
    for (const s of statsList) {
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
    const result = await broker.importFeed(offers || []);
    send(res, 200, { ok: true, ...result });
  },

  wellKnownKeys(req, res) {
    const doc = keysMod.publicKeyDoc();
    send(res, 200, { ...doc.receipt, keys: doc });
  },

  health(req, res) {
    send(res, 200, { ok: true, service: 'codecash-server', bundleVersion: BUNDLE_VERSION, backend: store.backendName });
  },

  landing(req, res) {
    serveStatic(res, 'landing.html', 'text/html; charset=utf-8');
  },

  dashboard(req, res) {
    serveStatic(res, 'dashboard.html', 'text/html; charset=utf-8');
  },

  advertiserDashboard(req, res) {
    serveStatic(res, 'advertiser.html', 'text/html; charset=utf-8');
  },

  installScript(req, res) {
    serveStatic(res, 'install.sh', 'text/plain; charset=utf-8');
  },

  ogImage(req, res) {
    serveStatic(res, 'og.svg', 'image/svg+xml; charset=utf-8');
  },
};

function serveStatic(res, name, contentType) {
  for (const candidate of [path.join(here, '..', 'public', name), path.join(process.cwd(), 'apps/server/public', name)]) {
    try {
      const data = fs.readFileSync(candidate);
      res.writeHead(200, { 'content-type': contentType, 'cache-control': 'public, max-age=300' });
      return res.end(data);
    } catch {
      /* try next */
    }
  }
  send(res, 404, { error: `${name} not found` });
}

// ---- router (shared by the local http server and the Vercel function) ------

let _ready;
export async function ensureReady() {
  if (!_ready) _ready = store.init();
  await _ready;
}

export async function handle(req, res) {
  try {
    await ensureReady();
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname.replace(/^\/api(?=\/|$)/, '') || '/'; // tolerate Vercel /api prefix
    const m = req.method;

    if (m === 'OPTIONS') return send(res, 204, {});
    if (p === '/healthz') return handlers.health(req, res);
    if (p === '/' || p === '/home') return handlers.landing(req, res);
    if (p === '/dashboard') return handlers.dashboard(req, res);
    if (p === '/advertiser' || p === '/ads') return handlers.advertiserDashboard(req, res);
    if (p === '/install.sh') return handlers.installScript(req, res);
    if (p === '/og.svg') return handlers.ogImage(req, res);
    if (p === '/.well-known/codecash-receipts.json') return handlers.wellKnownKeys(req, res);

    if (p === '/v1/auth/login' && m === 'POST') return handlers.login(req, res);
    if (p === '/v1/auth/refresh' && m === 'POST') return handlers.refresh(req, res);
    if (p === '/v1/bundle' && m === 'GET') return handlers.bundle(req, res);
    if (p === '/v1/counters' && m === 'POST') return handlers.counters(req, res);
    if (p === '/v1/ledger' && m === 'GET') return handlers.ledger(req, res);
    if (p === '/v1/payouts' && m === 'GET') return handlers.payouts(req, res);
    if (p === '/v1/payouts/withdraw' && m === 'POST') return handlers.withdraw(req, res);
    if (p === '/v1/admin/verify-identity' && m === 'POST') return handlers.verifyIdentity(req, res);

    if (p === '/v1/advertisers' && m === 'POST') return handlers.advertiserRegister(req, res);
    if (p === '/v1/advertisers/fund' && m === 'POST') return handlers.advertiserFund(req, res);
    if (p === '/v1/advertisers/campaigns' && m === 'POST') return handlers.advertiserCreateCampaign(req, res);
    if (p === '/v1/advertisers/campaigns' && m === 'GET') return handlers.advertiserListCampaigns(req, res);
    if (p === '/v1/advertisers/campaigns/status' && m === 'POST') return handlers.advertiserSetCampaignStatus(req, res);
    if (p === '/v1/advertisers/campaigns/update' && m === 'POST') return handlers.advertiserUpdateCampaign(req, res);
    if (p === '/v1/advertisers/campaigns/delete' && m === 'POST') return handlers.advertiserDeleteCampaign(req, res);
    if (p === '/v1/advertisers/stats' && m === 'GET') return handlers.advertiserStats(req, res);
    if (p === '/v1/admin/import-feed' && m === 'POST') return handlers.adminImportFeed(req, res);

    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 500, { error: e?.message || 'server error' });
  }
}

export function createServer() {
  return http.createServer(handle);
}

// ---- local entrypoint ------------------------------------------------------

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const port = Number(process.env.PORT || 8787);
  const server = createServer();
  server.listen(port, async () => {
    await ensureReady();
    const doc = keysMod.publicKeyDoc();
    const live = await store.activeCampaigns();
    console.log(`CodeCash server listening on http://127.0.0.1:${port}  [backend: ${store.backendName}]`);
    console.log(`  earner dashboard:     http://127.0.0.1:${port}/`);
    console.log(`  advertiser dashboard: http://127.0.0.1:${port}/advertiser`);
    console.log(`  receipt key:          ${doc.receipt.publicKey}`);
    console.log(`  inventory:            ${SEED_CAMPAIGNS.length} seeded + ${live.length} live campaigns`);
    console.log(`  payout rails:         ${(await payouts.payoutStatus('')).rails}`);
  });
}
