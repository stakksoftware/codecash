import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair } from '../crypto.js';
import { buildCounter, assertClean, signCounter, verifyCounter } from '../counter.js';

const period = { periodStart: '2026-06-17T12:00:00.000Z', periodEnd: '2026-06-17T12:05:00.000Z' };

test('buildCounter produces a clean, signable body', () => {
  const body = buildCounter({
    deviceId: 'dev_1',
    surface: 'agent-cli',
    ...period,
    events: [{ campaignId: 'c1', type: 'impression', count: 3, quality: 0.9, cpmMicros: 5_000_000 }],
  });
  assert.equal(body.surface, 'agent-cli');
  assert.equal(body.events.length, 1);
  assert.ok(body.nonce);
});

test('FR17/FR18: forbidden top-level fields are rejected', () => {
  assert.throws(
    () => assertClean({ schema: 'codecash.counter/v1', prompt: 'my secret prompt', events: [] }),
    /forbidden field "prompt"/,
  );
  assert.throws(
    () => assertClean({ schema: 'x', repoPath: '/Users/me/secret-project', events: [] }),
    /forbidden field "repoPath"/,
  );
});

test('FR17/FR18: forbidden per-event fields are rejected', () => {
  assert.throws(
    () => assertClean({ schema: 'x', events: [{ campaignId: 'c1', codeSnippet: 'rm -rf /' }] }),
    /event contains forbidden field "codeSnippet"/,
  );
});

test('buildCounter strips unknown event keys instead of leaking them', () => {
  const body = buildCounter({
    deviceId: 'dev_1',
    surface: 'agent-cli',
    ...period,
    events: [{ campaignId: 'c1', type: 'impression', count: 1, filePath: '/etc/passwd' }],
  });
  assert.equal(body.events[0].filePath, undefined);
  assert.equal(body.events[0].campaignId, 'c1');
});

test('signed counters verify with the device key and fail when tampered', () => {
  const { publicKey, privateKey } = generateKeyPair();
  const body = buildCounter({
    deviceId: 'dev_1',
    surface: 'agent-cli',
    ...period,
    events: [{ campaignId: 'c1', type: 'impression', count: 2 }],
  });
  const counter = signCounter(body, privateKey);
  assert.ok(verifyCounter(counter, publicKey));
  counter.body.events[0].count = 999;
  assert.equal(verifyCounter(counter, publicKey), false);
});
