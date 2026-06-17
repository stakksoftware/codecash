import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// Isolate server state into a temp dir BEFORE importing the server modules.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-server-test-'));
process.env.CODECASH_DATA_DIR = path.join(tmp, 'data');
process.env.CODECASH_KEYS_DIR = path.join(tmp, 'keys');

const { createServer } = await import('../src/server.js');
const core = await import('@codecash/core');

let server;
let base;

before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

async function api(method, p, { body, token } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json() };
}

const device = core.generateKeyPair();
const deviceId = 'dev_test_1';
let auth;
let accountId;
let receiptKey;

test('login registers device and returns persistent auth + published keys', async () => {
  const { status, json } = await api('POST', '/v1/auth/login', {
    body: { email: 'a@b.com', deviceId, devicePublicKey: device.publicKey },
  });
  assert.equal(status, 200);
  assert.ok(json.auth.accessToken);
  assert.ok(json.auth.refreshToken);
  assert.ok(json.receiptPublicKey);
  auth = json.auth;
  accountId = json.account.accountId;
  receiptKey = json.receiptPublicKey;
});

test('well-known publishes the receipt verification key', async () => {
  const { status, json } = await api('GET', '/.well-known/codecash-receipts.json');
  assert.equal(status, 200);
  assert.equal(json.publicKey, receiptKey);
  assert.equal(json.alg, 'ed25519');
});

test('bundle is served and verifies against the published bundle key', async () => {
  const { status, json } = await api('GET', '/v1/bundle');
  assert.equal(status, 200);
  const wk = (await api('GET', '/.well-known/codecash-receipts.json')).json;
  assert.ok(core.verifyBundle(json, wk.keys.bundle.publicKey));
  assert.ok(json.body.campaigns.length >= 5);
});

function makeCounter(events) {
  const body = core.buildCounter({
    deviceId,
    surface: 'agent-cli',
    periodStart: new Date(Date.now() - 1000).toISOString(),
    periodEnd: new Date().toISOString(),
    events,
  });
  return core.signCounter(body, device.privateKey);
}

test('counter ingestion credits via the published formula and returns verifiable receipts', async () => {
  const counter = makeCounter([
    { campaignId: 'affiliate-cloud-credits', type: 'impression', count: 2, quality: 1 },
  ]);
  const { status, json } = await api('POST', '/v1/counters', { token: auth.accessToken, body: counter });
  assert.equal(status, 200);
  assert.equal(json.receipts.length, 1);
  const r = json.receipts[0];
  // Independently verify the receipt the server issued.
  const v = core.verifyReceipt(r, receiptKey);
  assert.ok(v.ok, v.reasons.join('; '));
  // 2 impressions @ $12 CPM => 2 * 12000 = 24000 gross micros, 70% net.
  assert.equal(r.body.amounts.grossMicros, 24000);
  assert.equal(r.body.amounts.netMicros, Math.floor((24000 * 7000) / 10000));
});

test('a counter signed by the wrong key is rejected', async () => {
  const evil = core.generateKeyPair();
  const body = core.buildCounter({
    deviceId,
    surface: 'agent-cli',
    periodStart: new Date().toISOString(),
    periodEnd: new Date().toISOString(),
    events: [{ campaignId: 'affiliate-cloud-credits', type: 'impression', count: 1, quality: 1 }],
  });
  const counter = core.signCounter(body, evil.privateKey);
  const { status } = await api('POST', '/v1/counters', { token: auth.accessToken, body: counter });
  assert.equal(status, 400);
});

test('replayed counter nonce is rejected (FR13)', async () => {
  const counter = makeCounter([{ campaignId: 'sponsor-devtool-ide', type: 'impression', count: 1, quality: 1 }]);
  const first = await api('POST', '/v1/counters', { token: auth.accessToken, body: counter });
  assert.equal(first.status, 200);
  const replay = await api('POST', '/v1/counters', { token: auth.accessToken, body: counter });
  assert.equal(replay.status, 429);
});

test('quality-gated (fraudulent) impressions are credited $0', async () => {
  const counter = makeCounter([{ campaignId: 'sponsor-devtool-ide', type: 'impression', count: 5, quality: 0 }]);
  const { json } = await api('POST', '/v1/counters', { token: auth.accessToken, body: counter });
  assert.equal(json.receipts.length, 0);
  assert.ok(json.credited.some((c) => c.grossMicros === 0));
});

test('ledger reflects credited events and balance', async () => {
  const { json } = await api('GET', '/v1/ledger', { token: auth.accessToken });
  assert.ok(json.count >= 2);
  assert.ok(json.balanceMicros > 0);
});

test('withdrawal is blocked until payment identity is verified (FR15)', async () => {
  const before = await api('GET', '/v1/payouts', { token: auth.accessToken });
  assert.equal(before.json.identityVerified, false);
  // Even forcing a withdraw is refused.
  const w = await api('POST', '/v1/payouts/withdraw', { token: auth.accessToken });
  assert.equal(w.json.ok, false);
});

test('after identity verification + threshold, withdrawal succeeds via the payout rail', async () => {
  // Credit enough conversions to clear the $5 threshold.
  for (let i = 0; i < 3; i++) {
    const c = makeCounter([{ campaignId: 'affiliate-cloud-credits', type: 'conversion', count: 1, quality: 1 }]);
    await api('POST', '/v1/counters', { token: auth.accessToken, body: c });
  }
  await api('POST', '/v1/admin/verify-identity', { body: { accountId } });
  const status = await api('GET', '/v1/payouts', { token: auth.accessToken });
  assert.equal(status.json.identityVerified, true);
  assert.ok(status.json.balanceMicros >= status.json.thresholdMicros, `balance ${status.json.balanceMicros}`);
  assert.equal(status.json.payable, true);
  const w = await api('POST', '/v1/payouts/withdraw', { token: auth.accessToken });
  assert.equal(w.json.ok, true);
  assert.ok(w.json.transferId);
});

test('unauthorized ledger access is refused', async () => {
  const { status } = await api('GET', '/v1/ledger');
  assert.equal(status, 401);
});
