import { test } from 'node:test';
import assert from 'node:assert/strict';
import { billingInputs, validateCampaign, OBJECTIVES } from '../pricing.js';
import { computePayout, EVENT_WEIGHTS } from '../payout.js';

test('legacy campaigns (no objective) keep weight-based pricing', () => {
  const c = { advertiser: 'X', cpmMicros: 5_000_000 };
  const imp = billingInputs(c, 'impression');
  assert.equal(imp.type, 'impression');
  assert.equal(imp.cpmMicros, 5_000_000);
  assert.equal(imp.billable, true);
  const conv = billingInputs({ ...c, conversionValueMicros: 40_000_000 }, 'conversion');
  assert.equal(conv.conversionValueMicros, 40_000_000);
});

test('CPM objective bills impressions at the bid as a CPM', () => {
  const c = { advertiser: 'X', objective: 'cpm', bidMicros: 8_000_000 };
  const inp = billingInputs(c, 'impression');
  const pay = computePayout({ ...inp, quality: 1, units: 1 });
  assert.equal(pay.grossMicros, 8_000_000 / 1000); // CPM/1000 per impression
  // a click on a CPM buy is not billable
  assert.equal(billingInputs(c, 'engagement').billable, false);
});

test('CPC objective makes gross-per-click equal the bid', () => {
  const bid = 250_000; // $0.25 per click
  const c = { advertiser: 'X', objective: 'cpc', bidMicros: bid };
  const inp = billingInputs(c, 'engagement');
  assert.equal(inp.type, 'engagement');
  const pay = computePayout({ ...inp, quality: 1, units: 1 });
  // round-trip through the weight should land back at ~bid
  assert.ok(Math.abs(pay.grossMicros - bid) <= EVENT_WEIGHTS.engagement);
  // an impression on a CPC buy is free
  assert.equal(billingInputs(c, 'impression').billable, false);
});

test('CPA objective makes gross-per-conversion equal the bid', () => {
  const bid = 3_000_000; // $3 bounty
  const c = { advertiser: 'X', objective: 'cpa', bidMicros: bid };
  const inp = billingInputs(c, 'conversion');
  const pay = computePayout({ ...inp, quality: 1, units: 1 });
  assert.equal(pay.grossMicros, bid);
  assert.equal(billingInputs(c, 'impression').billable, false);
});

test('objective billing inputs are reproducible by verifyReceipt math', () => {
  // The receipt only stores cpm/conversion values, never the objective — so a
  // CPC campaign must still verify. Re-running computePayout on the stored
  // values reproduces the amount.
  const c = { advertiser: 'X', objective: 'cpc', bidMicros: 400_000 };
  const inp = billingInputs(c, 'engagement');
  const a = computePayout({ type: inp.type, cpmMicros: inp.cpmMicros, quality: 0.9, units: 3 });
  const b = computePayout({ type: 'engagement', cpmMicros: inp.cpmMicros, quality: 0.9, units: 3 });
  assert.deepEqual(a, b);
});

test('validateCampaign catches bad input', () => {
  assert.equal(validateCampaign({ advertiser: 'X', text: 'hi', objective: 'cpm', bidMicros: 1 }).ok, true);
  assert.equal(validateCampaign({ text: 'hi' }).ok, false); // no advertiser
  assert.equal(validateCampaign({ advertiser: 'X', text: 'hi', objective: 'zzz', bidMicros: 1 }).ok, false);
  assert.equal(validateCampaign({ advertiser: 'X', text: 'hi', objective: 'cpm' }).ok, false); // no bid
  assert.equal(validateCampaign({ advertiser: 'X', text: 'hi', url: 'ftp://x' }).ok, false);
});

test('OBJECTIVES maps each objective to its billable event', () => {
  assert.equal(OBJECTIVES.cpm.billable, 'impression');
  assert.equal(OBJECTIVES.cpc.billable, 'engagement');
  assert.equal(OBJECTIVES.cpa.billable, 'conversion');
});
