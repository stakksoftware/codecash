import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  screenCounter,
  applyDailyVelocityCap,
  RATE_LIMIT_PER_MIN,
  MAX_COUNT_PER_EVENT,
  DAILY_EARNINGS_CAP_MICROS,
} from '../src/fraud.js';

test('replayed nonce is rejected', () => {
  const r = screenCounter({ deviceId: 'd', body: { events: [] }, recentCount: 0, nonceAlreadySeen: true });
  assert.equal(r.ok, false);
  assert.match(r.reason, /replay/);
});

test('rate limit over the per-minute cap is rejected', () => {
  const r = screenCounter({ deviceId: 'd', body: { events: [] }, recentCount: RATE_LIMIT_PER_MIN + 1, nonceAlreadySeen: false });
  assert.equal(r.ok, false);
  assert.match(r.reason, /rate limit/);
});

test('oversized per-event counts are clamped, not rejected', () => {
  const body = { events: [{ campaignId: 'c', type: 'impression', count: MAX_COUNT_PER_EVENT + 1000 }] };
  const r = screenCounter({ deviceId: 'd', body, recentCount: 0, nonceAlreadySeen: false });
  assert.equal(r.ok, true);
  assert.equal(body.events[0].count, MAX_COUNT_PER_EVENT);
  assert.ok(r.flags.length > 0);
});

test('daily velocity cap limits credited gross', () => {
  const half = DAILY_EARNINGS_CAP_MICROS / 2;
  const a = applyDailyVelocityCap(0, half);
  assert.equal(a.allowedGross, half);
  assert.equal(a.capped, false);
  const b = applyDailyVelocityCap(DAILY_EARNINGS_CAP_MICROS - 100, 1000);
  assert.equal(b.allowedGross, 100);
  assert.equal(b.capped, true);
  const c = applyDailyVelocityCap(DAILY_EARNINGS_CAP_MICROS, 1000);
  assert.equal(c.allowedGross, 0);
});
