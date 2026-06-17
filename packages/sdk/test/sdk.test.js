import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-sdk-test-'));
process.env.CODECASH_DATA_DIR = path.join(tmp, 'data');
process.env.CODECASH_KEYS_DIR = path.join(tmp, 'keys');

const { createServer } = await import('@codecash/server/src/server.js');
const { CodeCashSDK } = await import('../index.js');
const core = await import('@codecash/core');

let server, base, receiptKey;
before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  const wk = await (await fetch(`${base}/.well-known/codecash-receipts.json`)).json();
  receiptKey = wk.publicKey;
});
after(() => server.close());

// Deterministic clock so we don't sleep in tests.
function fakeClock(startMs, stepMs) {
  let t = startMs;
  return () => {
    const cur = t;
    t += stepMs;
    return cur;
  };
}

test('SDK logs in, syncs a verified bundle, and reports campaigns', async () => {
  const cc = await CodeCashSDK.login({ serverUrl: base, email: 'app@x.com', surface: 'unit-app' });
  const s = await cc.sync();
  assert.ok(s.campaigns >= 5);
});

test('duringWait shows a sponsor, credits a verified wait, and returns the result', async () => {
  const cc = await CodeCashSDK.login({ serverUrl: base, email: 'app2@x.com', surface: 'unit-app' });
  cc._clock = fakeClock(1_000_000, 9000); // each clock read advances 9s -> credited
  await cc.sync();

  let shownLine = null;
  const result = await cc.duringWait(() => 'the-answer', {
    onSponsor: (line) => { shownLine = line; },
  });
  assert.equal(result, 'the-answer');
  assert.match(shownLine, /Sponsored/);
  assert.equal(cc.pendingCount(), 1);

  const flushed = await cc.flush();
  assert.equal(flushed.receipts.length, 1);
  const v = core.verifyReceipt(flushed.receipts[0], receiptKey);
  assert.ok(v.ok, v.reasons.join('; '));
});

test('a too-short wait is not credited (FR12)', async () => {
  const cc = await CodeCashSDK.login({ serverUrl: base, email: 'app3@x.com', surface: 'unit-app' });
  cc._clock = fakeClock(1_000_000, 100); // 100ms wait < min visible
  await cc.sync();
  await cc.duringWait(() => 42);
  assert.equal(cc.pendingCount(), 0);
});

test('duringWait passes through the wrapped error but still credits the wait', async () => {
  const cc = await CodeCashSDK.login({ serverUrl: base, email: 'app4@x.com', surface: 'unit-app' });
  cc._clock = fakeClock(1_000_000, 9000);
  await cc.sync();
  await assert.rejects(
    cc.duringWait(() => { throw new Error('boom'); }),
    /boom/,
  );
  assert.equal(cc.pendingCount(), 1); // the user still waited; it still counts
});

test('wrapStream monetizes time-to-first-token and streams all chunks', async () => {
  const cc = await CodeCashSDK.login({ serverUrl: base, email: 'app5@x.com', surface: 'unit-app' });
  cc._clock = fakeClock(1_000_000, 9000);
  await cc.sync();

  async function* gen() {
    yield 'a'; yield 'b'; yield 'c';
  }
  const chunks = [];
  for await (const c of cc.wrapStream(() => gen())) chunks.push(c);
  assert.deepEqual(chunks, ['a', 'b', 'c']);
  assert.equal(cc.pendingCount(), 1); // exactly one impression for time-to-first-token
});

test('earningsUsd aggregates net across received receipts', async () => {
  const cc = await CodeCashSDK.login({ serverUrl: base, email: 'app6@x.com', surface: 'unit-app' });
  cc._clock = fakeClock(1_000_000, 9000);
  await cc.sync();
  await cc.duringWait(() => 1);
  await cc.flush();
  assert.match(cc.earningsUsd(), /^\$\d/);
});
