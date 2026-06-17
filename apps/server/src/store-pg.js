// Supabase Postgres backend (production). Talks to the project over PostgREST
// using the service-role key, so it stays dependency-free (just `fetch`) and is
// serverless-friendly (no DB connection pool to exhaust). The service-role key
// bypasses RLS; tables have RLS enabled with no anon policies, so only this
// server can read/write them.
//
// Same function surface as store.js (the file backend). All functions are async.

const BASE = (process.env.SUPABASE_URL || '').replace(/\/$/, '') + '/rest/v1';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const HEADERS = { apikey: KEY, authorization: `Bearer ${KEY}`, 'content-type': 'application/json' };

async function rq(method, pathQs, { body, prefer } = {}) {
  const res = await fetch(`${BASE}${pathQs}`, {
    method,
    headers: prefer ? { ...HEADERS, prefer } : HEADERS,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`pg ${method} ${pathQs.split('?')[0]} -> ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}
const enc = encodeURIComponent;
const sel = (t, qs = '') => rq('GET', `/${t}${qs ? '?' + qs : ''}`);
const insert = (t, row) => rq('POST', `/${t}`, { body: row, prefer: 'return=representation' });
const upsert = (t, row) => rq('POST', `/${t}`, { body: row, prefer: 'resolution=merge-duplicates,return=representation' });
const patch = (t, qs, row) => rq('PATCH', `/${t}?${qs}`, { body: row, prefer: 'return=representation' });
const n = (v) => (v == null ? 0 : Number(v));

// ---- row <-> object mappers ------------------------------------------------

const acct = (r) => r && { accountId: r.account_id, email: r.email, identityVerified: !!r.identity_verified, createdAt: r.created_at };
const dev = (r) => r && { deviceId: r.device_id, accountId: r.account_id, publicKey: r.public_key };
const adv = (r) => r && { advertiserId: r.advertiser_id, name: r.name, email: r.email, balanceMicros: n(r.balance_micros), createdAt: r.created_at };
const camp = (r) =>
  r && {
    id: r.id,
    advertiserId: r.advertiser_id,
    advertiser: r.advertiser,
    model: r.model,
    objective: r.objective || undefined,
    bidMicros: r.bid_micros == null ? undefined : n(r.bid_micros),
    text: r.text,
    url: r.url || undefined,
    tags: r.tags || undefined,
    requireTags: r.require_tags || undefined,
    weight: r.weight == null ? undefined : Number(r.weight),
    dailyCapImpressions: r.daily_cap_impressions == null ? undefined : n(r.daily_cap_impressions),
    cpmMicros: r.cpm_micros == null ? undefined : n(r.cpm_micros),
    status: r.status,
    budgetMicros: n(r.budget_micros),
    spentMicros: n(r.spent_micros),
    createdAt: r.created_at,
  };
const ledgerRow = (r) => ({
  accountId: r.account_id,
  deviceId: r.device_id,
  eventId: r.event_id,
  issuedAt: r.issued_at,
  advertiser: r.advertiser,
  campaignId: r.campaign_id,
  type: r.type,
  amounts: r.amounts,
  receipt: r.receipt,
});

// ---- lifecycle -------------------------------------------------------------

export async function init() {
  // Schema is provisioned via migration. Cheap connectivity check (also surfaces
  // a misconfigured key early).
  await sel('accounts', 'limit=1');
  return true;
}
export async function flush() {}

// ---- accounts & devices ----------------------------------------------------

export async function upsertAccount(email) {
  const existing = await sel('accounts', `email=eq.${enc(email)}&limit=1`);
  if (existing && existing[0]) return acct(existing[0]);
  const accountId = 'acct_' + Buffer.from(email).toString('hex').slice(0, 12);
  const rows = await insert('accounts', { account_id: accountId, email, identity_verified: false, created_at: new Date().toISOString() });
  return acct(rows[0]);
}

export async function getAccount(accountId) {
  const rows = await sel('accounts', `account_id=eq.${enc(accountId)}&limit=1`);
  return rows && rows[0] ? acct(rows[0]) : null;
}

export async function setIdentityVerified(accountId, verified = true) {
  const rows = await patch('accounts', `account_id=eq.${enc(accountId)}`, { identity_verified: verified });
  return rows && rows[0] ? acct(rows[0]) : null;
}

export async function registerDevice(deviceId, accountId, publicKey) {
  const rows = await upsert('devices', { device_id: deviceId, account_id: accountId, public_key: publicKey });
  return dev(rows[0]);
}

export async function getDevice(deviceId) {
  const rows = await sel('devices', `device_id=eq.${enc(deviceId)}&limit=1`);
  return rows && rows[0] ? dev(rows[0]) : null;
}

// ---- sessions --------------------------------------------------------------

export async function createSession(accountId, { accessToken, refreshToken, expiresAt }) {
  await insert('sessions', { access_token: accessToken, account_id: accountId, expires_at: expiresAt });
  await insert('refresh_tokens', { refresh_token: refreshToken, account_id: accountId });
}

export async function resolveAccessToken(accessToken) {
  const rows = await sel('sessions', `access_token=eq.${enc(accessToken)}&limit=1`);
  const s = rows && rows[0];
  if (!s) return null;
  if (Date.parse(s.expires_at) <= Date.now()) return null;
  return s.account_id;
}

export async function resolveRefreshToken(refreshToken) {
  const rows = await sel('refresh_tokens', `refresh_token=eq.${enc(refreshToken)}&limit=1`);
  return rows && rows[0] ? rows[0].account_id : null;
}

// ---- ledger ----------------------------------------------------------------

export async function appendLedger(entry) {
  await insert('ledger', {
    account_id: entry.accountId,
    device_id: entry.deviceId,
    event_id: entry.eventId,
    issued_at: entry.issuedAt,
    advertiser: entry.advertiser,
    campaign_id: entry.campaignId,
    type: entry.type,
    amounts: entry.amounts,
    receipt: entry.receipt,
  });
  return entry;
}

export async function ledgerForAccount(accountId) {
  const rows = await sel('ledger', `account_id=eq.${enc(accountId)}&order=id.asc`);
  return (rows || []).map(ledgerRow);
}

export async function balanceMicros(accountId) {
  const led = await sel('ledger', `account_id=eq.${enc(accountId)}&select=amounts`);
  const credited = (led || []).reduce((s, e) => s + (e.amounts?.netMicros || 0), 0);
  const tr = await sel('transfers', `account_id=eq.${enc(accountId)}&select=amount_micros`);
  const withdrawn = (tr || []).reduce((s, t) => s + n(t.amount_micros), 0);
  return credited - withdrawn;
}

export async function creditedTodayMicros(accountId, nowMs = Date.now()) {
  const since = new Date(nowMs - 24 * 3600_000).toISOString();
  const led = await sel('ledger', `account_id=eq.${enc(accountId)}&issued_at=gt.${enc(since)}&select=amounts`);
  return (led || []).reduce((s, e) => s + (e.amounts?.grossMicros || 0), 0);
}

export async function recordTransfer(t) {
  await insert('transfers', { account_id: t.accountId, amount_micros: t.amountMicros, transfer_id: t.transferId, rails: t.rails, at: t.at });
  return t;
}

// ---- fraud bookkeeping -----------------------------------------------------

export async function nonceSeen(deviceId, nonce) {
  const rows = await sel('seen_nonces', `device_id=eq.${enc(deviceId)}&nonce=eq.${enc(nonce)}&limit=1`);
  return !!(rows && rows[0]);
}

export async function rememberNonce(deviceId, nonce, atMs = Date.now()) {
  await upsert('seen_nonces', { device_id: deviceId, nonce, at_ms: atMs });
}

export async function recordCounterSubmission(deviceId, atMs = Date.now()) {
  await insert('counter_log', { device_id: deviceId, at_ms: atMs });
}

export async function recentCounterCount(deviceId, atMs = Date.now()) {
  const rows = await sel('counter_log', `device_id=eq.${enc(deviceId)}&at_ms=gt.${atMs - 60_000}&select=id`);
  return (rows || []).length;
}

// ---- advertisers, campaigns, budgets ---------------------------------------

export async function createAdvertiser({ name, email, apiKey }) {
  const advertiserId = 'adv_' + Buffer.from(name + ':' + email).toString('hex').slice(0, 12);
  const existing = await sel('advertisers', `advertiser_id=eq.${enc(advertiserId)}&limit=1`);
  let advertiser;
  if (existing && existing[0]) advertiser = adv(existing[0]);
  else {
    const rows = await insert('advertisers', { advertiser_id: advertiserId, name, email, balance_micros: 0, created_at: new Date().toISOString() });
    advertiser = adv(rows[0]);
  }
  await upsert('api_keys', { api_key: apiKey, advertiser_id: advertiserId });
  return { advertiser, apiKey };
}

export async function resolveApiKey(apiKey) {
  const rows = await sel('api_keys', `api_key=eq.${enc(apiKey)}&limit=1`);
  return rows && rows[0] ? rows[0].advertiser_id : null;
}

export async function getAdvertiser(advertiserId) {
  const rows = await sel('advertisers', `advertiser_id=eq.${enc(advertiserId)}&limit=1`);
  return rows && rows[0] ? adv(rows[0]) : null;
}

export async function fundAdvertiser(advertiserId, amountMicros) {
  const a = await getAdvertiser(advertiserId);
  if (!a) return null;
  const rows = await patch('advertisers', `advertiser_id=eq.${enc(advertiserId)}`, { balance_micros: a.balanceMicros + amountMicros });
  return adv(rows[0]);
}

export async function createCampaign(advertiserId, campaign) {
  const id = campaign.id || 'camp_' + Math.random().toString(36).slice(2, 14);
  const row = {
    id,
    advertiser_id: advertiserId,
    advertiser: campaign.advertiser,
    model: campaign.model || 'sponsor',
    objective: campaign.objective ?? null,
    bid_micros: campaign.bidMicros ?? null,
    text: campaign.text,
    url: campaign.url ?? null,
    tags: campaign.tags ?? null,
    require_tags: campaign.requireTags ?? null,
    weight: campaign.weight ?? null,
    daily_cap_impressions: campaign.dailyCapImpressions ?? null,
    cpm_micros: campaign.cpmMicros ?? null,
    status: campaign.status || 'active',
    budget_micros: campaign.budgetMicros ?? 0,
    spent_micros: 0,
    created_at: new Date().toISOString(),
  };
  const rows = await insert('campaigns', row);
  await upsert('campaign_stats', { campaign_id: id, impressions: 0, engagements: 0, conversions: 0, flagged: 0, spent_micros: 0 });
  return camp(rows[0]);
}

export async function getCampaign(id) {
  const rows = await sel('campaigns', `id=eq.${enc(id)}&limit=1`);
  return rows && rows[0] ? camp(rows[0]) : null;
}

export async function setCampaignStatus(id, status) {
  const rows = await patch('campaigns', `id=eq.${enc(id)}`, { status });
  return rows && rows[0] ? camp(rows[0]) : null;
}

export async function updateCampaign(id, fields) {
  const row = {};
  if (fields.bidMicros != null) row.bid_micros = fields.bidMicros;
  if (fields.budgetMicros != null) row.budget_micros = fields.budgetMicros;
  if (fields.text != null) row.text = fields.text;
  if ('url' in fields) row.url = fields.url ?? null;
  if ('tags' in fields) row.tags = fields.tags ?? null;
  if (fields.status) row.status = fields.status;
  if (Object.keys(row).length === 0) return getCampaign(id);
  const rows = await patch('campaigns', `id=eq.${enc(id)}`, row);
  return rows && rows[0] ? camp(rows[0]) : null;
}

export async function deleteCampaign(id) {
  await rq('DELETE', `/campaign_stats?campaign_id=eq.${enc(id)}`);
  await rq('DELETE', `/campaigns?id=eq.${enc(id)}`);
  return true;
}

export async function campaignsForAdvertiser(advertiserId) {
  const rows = await sel('campaigns', `advertiser_id=eq.${enc(advertiserId)}&order=created_at.asc`);
  return (rows || []).map(camp);
}

export async function activeCampaigns() {
  const rows = await sel('campaigns', `status=eq.active`);
  const campaigns = (rows || []).map(camp).filter((c) => c.budgetMicros - c.spentMicros > 0);
  if (campaigns.length === 0) return [];
  const ids = [...new Set(campaigns.map((c) => c.advertiserId))];
  const advs = await sel('advertisers', `advertiser_id=in.(${ids.map(enc).join(',')})&select=advertiser_id,balance_micros`);
  const balance = Object.fromEntries((advs || []).map((a) => [a.advertiser_id, n(a.balance_micros)]));
  return campaigns.filter((c) => (balance[c.advertiserId] || 0) > 0);
}

export async function campaignRemainingBudget(campaignId) {
  const c = await getCampaign(campaignId);
  if (!c) return Infinity; // seed/legacy campaigns have no server budget
  const a = await getAdvertiser(c.advertiserId);
  const advRemaining = a ? a.balanceMicros : 0;
  return Math.max(0, Math.min(c.budgetMicros - c.spentMicros, advRemaining));
}

export async function recordSpend(campaignId, grossMicros) {
  const c = await getCampaign(campaignId);
  if (!c) return; // seed/legacy: no advertiser to bill
  const spent = c.spentMicros + grossMicros;
  const status = c.budgetMicros - spent <= 0 ? 'exhausted' : c.status;
  await patch('campaigns', `id=eq.${enc(campaignId)}`, { spent_micros: spent, status });
  const a = await getAdvertiser(c.advertiserId);
  if (a) await patch('advertisers', `advertiser_id=eq.${enc(c.advertiserId)}`, { balance_micros: Math.max(0, a.balanceMicros - grossMicros) });
  const s = await statsRow(campaignId);
  await upsert('campaign_stats', { ...s, campaign_id: campaignId, spent_micros: n(s.spent_micros) + grossMicros });
}

async function statsRow(campaignId) {
  const rows = await sel('campaign_stats', `campaign_id=eq.${enc(campaignId)}&limit=1`);
  return (rows && rows[0]) || { campaign_id: campaignId, impressions: 0, engagements: 0, conversions: 0, flagged: 0, spent_micros: 0 };
}

export async function recordCampaignEvent(campaignId, type, { flagged = false } = {}) {
  const s = await statsRow(campaignId);
  const next = {
    campaign_id: campaignId,
    impressions: n(s.impressions) + (type === 'impression' ? 1 : 0),
    engagements: n(s.engagements) + (type === 'engagement' ? 1 : 0),
    conversions: n(s.conversions) + (type === 'conversion' ? 1 : 0),
    flagged: n(s.flagged) + (flagged ? 1 : 0),
    spent_micros: n(s.spent_micros),
  };
  await upsert('campaign_stats', next);
}

export async function campaignStats(campaignId) {
  const s = await statsRow(campaignId);
  const stats = { impressions: n(s.impressions), engagements: n(s.engagements), conversions: n(s.conversions), flagged: n(s.flagged), spentMicros: n(s.spent_micros) };
  const total = stats.impressions + stats.engagements + stats.conversions + stats.flagged;
  return { ...stats, total, invalidTrafficRate: total ? +(stats.flagged / total).toFixed(4) : 0 };
}

// ---- test/demo helpers (no-ops on pg) --------------------------------------
export async function _reset() {}
export async function _all() {
  return {};
}
