import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-adv-test-'));
process.env.CODECASH_DATA_DIR = path.join(tmp, 'data');
process.env.CODECASH_KEYS_DIR = path.join(tmp, 'keys');

const { createServer } = await import('../src/server.js');
const core = await import('@codecash/core');

let server, base;
async function api(method, p, { body, token, apiKey } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json() };
}

// A funded earner so we can submit counters against advertiser campaigns.
const device = core.generateKeyPair();
const deviceId = 'dev_adv_1';
let userToken;

before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  const r = await api('POST', '/v1/auth/login', { body: { email: 'earner@x.com', deviceId, devicePublicKey: device.publicKey } });
  userToken = r.json.auth.accessToken;
});
after(() => server.close());

function counter(events) {
  const body = core.buildCounter({
    deviceId,
    surface: 'agent-cli',
    periodStart: new Date(Date.now() - 1000).toISOString(),
    periodEnd: new Date().toISOString(),
    events,
  });
  return core.signCounter(body, device.privateKey);
}

let apiKey, advertiserId, campaignId;

test('advertiser registers and receives an api key', async () => {
  const r = await api('POST', '/v1/advertisers', { body: { name: 'Acme Dev', email: 'ads@acme.com' } });
  assert.equal(r.status, 200);
  assert.match(r.json.apiKey, /^adk_/);
  apiKey = r.json.apiKey;
  advertiserId = r.json.advertiserId;
});

test('advertiser funds budget and creates a CPC campaign', async () => {
  const f = await api('POST', '/v1/advertisers/fund', { apiKey, body: { amountMicros: 5_000_000 } });
  assert.equal(f.json.balanceMicros, 5_000_000);
  const c = await api('POST', '/v1/advertisers/campaigns', {
    apiKey,
    body: {
      advertiser: 'Acme Dev',
      objective: 'cpc',
      bidMicros: 250_000, // $0.25 / click
      text: 'Acme: ship faster → acme.example',
      url: 'https://acme.example?ref=codecash',
      tags: ['rust', 'go'],
      budgetMicros: 1_000_000, // $1 budget
    },
  });
  assert.equal(c.status, 200);
  assert.match(c.json.pricing, /CPC/);
  campaignId = c.json.campaign.id;
});

test('the funded campaign appears in the public bundle (no bid/budget leaked)', async () => {
  const b = await api('GET', '/v1/bundle');
  const found = b.json.body.campaigns.find((c) => c.id === campaignId);
  assert.ok(found, 'campaign should be in bundle');
  assert.equal(found.advertiser, 'Acme Dev');
  assert.equal(found.objective, 'cpc');
  assert.equal(found.bidMicros, undefined); // never leak the bid
  assert.equal(found.budgetMicros, undefined); // never leak the budget
});

test('a verified click bills the advertiser and credits the earner', async () => {
  const r = await api('POST', '/v1/counters', { token: userToken, body: counter([{ campaignId, type: 'engagement', count: 1, quality: 1 }]) });
  assert.equal(r.status, 200);
  assert.equal(r.json.receipts.length, 1);
  const gross = r.json.receipts[0].body.amounts.grossMicros;
  assert.ok(Math.abs(gross - 250_000) <= core.EVENT_WEIGHTS.engagement, `gross ${gross}`);
  // advertiser stats reflect the click + spend
  const s = await api('GET', '/v1/advertisers/stats', { apiKey });
  assert.equal(s.json.engagements, 1);
  assert.ok(s.json.spentMicros > 0);
  assert.equal(s.json.balanceMicros, 5_000_000 - s.json.spentMicros);
});

test('an impression on a CPC buy is not billed and not flagged as invalid', async () => {
  const r = await api('POST', '/v1/counters', { token: userToken, body: counter([{ campaignId, type: 'impression', count: 1, quality: 1 }]) });
  assert.equal(r.json.receipts.length, 0);
  assert.match(r.json.credited[0].note, /not the billable event/);
  const list = await api('GET', '/v1/advertisers/campaigns', { apiKey });
  const c = list.json.campaigns.find((x) => x.id === campaignId);
  assert.equal(c.stats.invalidTrafficRate, 0); // impression on CPC ≠ invalid traffic
});

test('budget pacing caps spend and exhausts the campaign', async () => {
  // 10 clicks requested but only ~3 more fit the remaining ~$0.75 budget.
  const r = await api('POST', '/v1/counters', { token: userToken, body: counter([{ campaignId, type: 'engagement', count: 10, quality: 1 }]) });
  const credited = r.json.credited[0];
  assert.ok(credited.units < 10, `paced to ${credited.units} units`);
  // now fully exhausted: another click earns nothing
  const r2 = await api('POST', '/v1/counters', { token: userToken, body: counter([{ campaignId, type: 'engagement', count: 1, quality: 1 }]) });
  assert.equal(r2.json.receipts.length, 0);
  assert.match(r2.json.credited[0].note, /budget exhausted/);
  // and it drops out of the served bundle
  const b = await api('GET', '/v1/bundle');
  assert.equal(b.json.body.campaigns.find((c) => c.id === campaignId), undefined);
});

test('a quality-gated billable click IS counted as invalid traffic', async () => {
  // fresh funded CPA campaign
  await api('POST', '/v1/advertisers/fund', { apiKey, body: { amountMicros: 5_000_000 } });
  const c = await api('POST', '/v1/advertisers/campaigns', {
    apiKey,
    body: { advertiser: 'Acme Dev', objective: 'cpa', bidMicros: 2_000_000, text: 'Acme signup → acme.example', budgetMicros: 4_000_000 },
  });
  const id = c.json.campaign.id;
  await api('POST', '/v1/counters', { token: userToken, body: counter([{ campaignId: id, type: 'conversion', count: 1, quality: 0 }]) });
  const list = await api('GET', '/v1/advertisers/campaigns', { apiKey });
  const stats = list.json.campaigns.find((x) => x.id === id).stats;
  assert.ok(stats.invalidTrafficRate > 0, 'quality-gated conversion flagged as invalid');
});

test('pause/resume, edit, and delete a campaign (ownership-checked)', async () => {
  await api('POST', '/v1/advertisers/fund', { apiKey, body: { amountMicros: 5_000_000 } });
  const made = await api('POST', '/v1/advertisers/campaigns', {
    apiKey,
    body: { advertiser: 'Acme Dev', objective: 'cpm', bidMicros: 8_000_000, text: 'Acme → acme.example', budgetMicros: 3_000_000, tags: ['go'] },
  });
  const id = made.json.campaign.id;

  // pause -> drops from served bundle; resume -> returns
  await api('POST', '/v1/advertisers/campaigns/status', { apiKey, body: { id, status: 'paused' } });
  let bundle = await api('GET', '/v1/bundle');
  assert.equal(bundle.json.body.campaigns.find((c) => c.id === id), undefined);
  await api('POST', '/v1/advertisers/campaigns/status', { apiKey, body: { id, status: 'active' } });
  bundle = await api('GET', '/v1/bundle');
  assert.ok(bundle.json.body.campaigns.find((c) => c.id === id));

  // edit bid/budget/headline
  const upd = await api('POST', '/v1/advertisers/campaigns/update', { apiKey, body: { id, bidMicros: 12_000_000, budgetMicros: 6_000_000, text: 'Acme v2 → acme.example' } });
  assert.equal(upd.json.campaign.bidMicros, 12_000_000);
  assert.equal(upd.json.campaign.text, 'Acme v2 → acme.example');

  // a different advertiser cannot touch it
  const other = await api('POST', '/v1/advertisers', { body: { name: 'Other Co', email: 'other@x.com' } });
  const denied = await api('POST', '/v1/advertisers/campaigns/delete', { apiKey: other.json.apiKey, body: { id } });
  assert.equal(denied.status, 404);

  // owner deletes it
  const del = await api('POST', '/v1/advertisers/campaigns/delete', { apiKey, body: { id } });
  assert.equal(del.json.ok, true);
  const list = await api('GET', '/v1/advertisers/campaigns', { apiKey });
  assert.equal(list.json.campaigns.find((c) => c.id === id), undefined);
});

test('analytics returns a 14-day series ending today with period totals', async () => {
  const r = await api('GET', '/v1/advertisers/analytics?days=14', { apiKey });
  assert.equal(r.status, 200);
  assert.equal(r.json.series.length, 14);
  assert.ok(r.json.totals.spentMicros >= 0);
  assert.equal(r.json.series[r.json.series.length - 1].date, new Date().toISOString().slice(0, 10));
});

test('admin can broker-import an affiliate feed into live campaigns', async () => {
  const offers = [
    { merchant: 'FeedCo', headline: 'FeedCo: try free → feedco.example', url: 'https://feedco.example', model: 'cpa', payoutMicros: 1_500_000, tags: ['python'] },
  ];
  const r = await api('POST', '/v1/admin/import-feed', { body: { offers } });
  assert.equal(r.json.imported, 1);
  const b = await api('GET', '/v1/bundle');
  assert.ok(b.json.body.campaigns.some((c) => c.advertiser === 'FeedCo'));
});
