import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair } from '../crypto.js';
import { buildBundle, signBundle, verifyBundle, bundleIsFresh } from '../bundle.js';

test('a signed bundle verifies and a tampered one does not', () => {
  const { publicKey, privateKey } = generateKeyPair();
  const body = buildBundle({
    version: '7',
    generatedAt: '2026-06-17T12:00:00.000Z',
    campaigns: [{ id: 'c1', advertiser: 'A', model: 'impression', text: 't', cpmMicros: 1 }],
  });
  const bundle = signBundle(body, privateKey);
  assert.ok(verifyBundle(bundle, publicKey));
  bundle.body.campaigns[0].cpmMicros = 999_999;
  assert.equal(verifyBundle(bundle, publicKey), false);
});

test('bundle freshness respects ttl', () => {
  const gen = Date.parse('2026-06-17T12:00:00.000Z');
  const bundle = { body: { generatedAt: '2026-06-17T12:00:00.000Z', ttlSeconds: 3600 } };
  assert.ok(bundleIsFresh(bundle, gen + 1000));
  assert.ok(bundleIsFresh(bundle, gen + 3600 * 1000));
  assert.equal(bundleIsFresh(bundle, gen + 3600 * 1000 + 1), false);
});
