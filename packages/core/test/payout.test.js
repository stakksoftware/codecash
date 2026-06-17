import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computePayout,
  EVENT_WEIGHTS,
  DEFAULT_SPLIT,
  PAYOUT_FORMULA_VERSION,
} from '../payout.js';

test('impression payout = CPM/1000 * quality, split by userShareBps', () => {
  // $5.00 CPM = 5_000_000 micros. Per impression = 5000 micros. 70% to user.
  const r = computePayout({ type: 'impression', cpmMicros: 5_000_000, quality: 1 });
  assert.equal(r.grossMicros, 5000);
  assert.equal(r.netMicros, 3500); // 70%
  assert.equal(r.platformCutMicros, 1500); // 30%
  assert.equal(r.userShareBps, DEFAULT_SPLIT.userShareBps);
  assert.equal(r.formulaVersion, PAYOUT_FORMULA_VERSION);
});

test('quality multiplier of 0 yields a zero payout (FR12 gate)', () => {
  const r = computePayout({ type: 'impression', cpmMicros: 5_000_000, quality: 0 });
  assert.equal(r.grossMicros, 0);
  assert.equal(r.netMicros, 0);
});

test('engagement and conversion are weighted higher than impressions (FR14)', () => {
  const imp = computePayout({ type: 'impression', cpmMicros: 5_000_000 });
  const eng = computePayout({ type: 'engagement', cpmMicros: 5_000_000 });
  assert.equal(eng.grossMicros, imp.grossMicros * EVENT_WEIGHTS.engagement);
  assert.ok(eng.grossMicros > imp.grossMicros);
});

test('conversion with order value pays a published 10% rev-share', () => {
  // $40 order = 40_000_000 micros -> 10% = 4_000_000 gross.
  const r = computePayout({ type: 'conversion', conversionValueMicros: 40_000_000, quality: 1 });
  assert.equal(r.grossMicros, 4_000_000);
  assert.equal(r.netMicros, 2_800_000);
});

test('custom split is honored and published in the result', () => {
  const r = computePayout({ type: 'impression', cpmMicros: 10_000_000 }, { userShareBps: 5000 });
  assert.equal(r.grossMicros, 10_000);
  assert.equal(r.netMicros, 5000);
  assert.equal(r.userShareBps, 5000);
});

// ---------------------------------------------------------------------------
// THE FR8 INVARIANT: payout cannot depend on accrued balance / threshold
// proximity. We prove it: feeding hostile "balance"/"threshold" fields changes
// nothing, because the formula has no such parameter.
// ---------------------------------------------------------------------------
test('FR8: payout is independent of balance / threshold proximity', () => {
  const base = { type: 'impression', cpmMicros: 5_000_000, quality: 0.8 };
  const near = computePayout({ ...base, balance: 9_999_999, threshold: 10_000_000, lifetimeEarnings: 1e9 });
  const far = computePayout({ ...base, balance: 0, threshold: 10_000_000, lifetimeEarnings: 0 });
  assert.deepEqual(near, far);
});

test('FR8: repeated identical events always pay the same (no taper)', () => {
  const ev = { type: 'impression', cpmMicros: 4_000_000, quality: 1 };
  const first = computePayout(ev).netMicros;
  let last;
  for (let i = 0; i < 10_000; i++) last = computePayout(ev).netMicros;
  assert.equal(first, last);
});

test('units multiply gross linearly and split still holds', () => {
  const one = computePayout({ type: 'impression', cpmMicros: 5_000_000, units: 1 });
  const ten = computePayout({ type: 'impression', cpmMicros: 5_000_000, units: 10 });
  assert.equal(ten.grossMicros, one.grossMicros * 10);
  assert.equal(ten.units, 10);
  assert.equal(ten.netMicros, Math.floor((ten.grossMicros * ten.userShareBps) / 10000));
  assert.equal(ten.netMicros + ten.platformCutMicros, ten.grossMicros);
});

test('unknown event type throws', () => {
  assert.throws(() => computePayout({ type: 'wat', cpmMicros: 1000 }));
});
