import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessImpression, MIN_VISIBLE_MS } from '../session.js';

test('a genuine, focused, active wait state is fully verified', () => {
  const r = assessImpression({ windowFocused: true, agentActive: true, visibleMs: 15000 });
  assert.ok(r.verified);
  assert.equal(r.quality, 1);
});

test('no active agent => quality 0 (FR12: not a real wait state)', () => {
  const r = assessImpression({ windowFocused: true, agentActive: false, visibleMs: 15000 });
  assert.equal(r.quality, 0);
  assert.equal(r.verified, false);
});

test('too-brief impressions do not count', () => {
  const r = assessImpression({ windowFocused: true, agentActive: true, visibleMs: MIN_VISIBLE_MS - 1 });
  assert.equal(r.quality, 0);
});

test('unfocused window is damped, not zeroed', () => {
  const r = assessImpression({ windowFocused: false, agentActive: true, visibleMs: 15000 });
  assert.ok(r.quality > 0 && r.quality < 1);
});

test('stale agent heartbeat zeroes quality', () => {
  const r = assessImpression({ windowFocused: true, agentActive: true, visibleMs: 15000, lastAgentHeartbeatAgeMs: 60_000 });
  assert.equal(r.quality, 0);
});
