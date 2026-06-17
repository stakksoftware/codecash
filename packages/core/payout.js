// @codecash/core/payout
//
// THE PUBLISHED PAYOUT FORMULA. This file is the single source of truth that
// docs/PAYOUT_FORMULA.md describes in prose. The two must always agree.
//
// Design rules baked into the code (not just policy):
//   FR7  — the formula is versioned. Any change bumps PAYOUT_FORMULA_VERSION and
//          is recorded in docs/PAYOUT_FORMULA.md with an effective date.
//   FR8  — NO THRESHOLD-PROXIMITY THROTTLING. `computePayout` has no access to a
//          user's accrued balance, cash-out threshold, lifetime earnings, or
//          account age. It physically cannot taper payouts as you near cash-out.
//          A unit test asserts this invariant.
//   FR14 — payout weight moves toward engagement (an intentional click) and
//          conversion, which are far harder to fake than a raw impression.
//
// All money is integer micro-USD (1 USD = 1_000_000 micros) to avoid floating
// point drift. CPM is "cost per mille" — advertiser cost per 1000 impressions.

export const PAYOUT_FORMULA_VERSION = '1.0.0';

/**
 * The revenue split. `userShareBps` is the user's cut in basis points
 * (10000 = 100%). Default 7000 = 70% to the user / 30% platform — a higher user
 * share than the incumbent's implied take is part of the marketing wedge
 * (PRD §11 open question, answered here as the published default).
 *
 * The split is published and versioned alongside the formula. It is an input,
 * never a per-user secret.
 */
export const DEFAULT_SPLIT = Object.freeze({ userShareBps: 7000 });

/**
 * Event-type weights (FR14). A verified impression is the baseline (1.0).
 * Engagement and conversion are paid as multiples of the impression value
 * because they are intentional, far harder to fake, and worth more to
 * advertisers.
 */
export const EVENT_WEIGHTS = Object.freeze({
  impression: 1, // a verified, quality-gated view
  engagement: 8, // an intentional click / expand on the sponsor line
  conversion: 60, // a confirmed downstream action (affiliate / pixel)
});

const BPS = 10000;

/**
 * Compute the payout for a single monetizable event.
 *
 * Deliberately pure: output depends ONLY on the event's own properties and the
 * published constants. There is no `balance`, `threshold`, or `lifetimeEarnings`
 * parameter, by design (FR8).
 *
 * @param {object} ev
 * @param {number} ev.cpmMicros        Advertiser CPM in micro-USD (per 1000).
 * @param {('impression'|'engagement'|'conversion')} ev.type
 * @param {number} [ev.quality]        Quality multiplier in [0,1] (FR12 gate).
 *                                     0 means "not a verified/quality event" and
 *                                     yields a $0 payout — the event is logged
 *                                     but pays nothing.
 * @param {number} [ev.conversionValueMicros] For conversions, the actual order
 *                                     value; payout uses a rev-share of this when
 *                                     present (FR14 affiliate alignment).
 * @param {number} [ev.units]          Number of identical verified events this
 *                                     payout aggregates (default 1). Lets ONE
 *                                     signed receipt cover a batch while staying
 *                                     exactly reproducible by an auditor.
 * @param {{userShareBps:number}} [split]
 * @returns {{
 *   formulaVersion:string, type:string, weight:number, quality:number,
 *   units:number, userShareBps:number, grossMicros:number,
 *   platformCutMicros:number, netMicros:number
 * }}
 */
export function computePayout(ev, split = DEFAULT_SPLIT) {
  const type = ev.type || 'impression';
  const weight = EVENT_WEIGHTS[type];
  if (weight === undefined) throw new Error(`unknown event type: ${type}`);

  const quality = clamp01(ev.quality ?? 1);
  const units = Number.isFinite(ev.units) && ev.units > 0 ? Math.floor(ev.units) : 1;
  const userShareBps = clampBps(split.userShareBps ?? DEFAULT_SPLIT.userShareBps);

  let perUnitGross;
  if (type === 'conversion' && Number.isFinite(ev.conversionValueMicros)) {
    // Affiliate / rev-share conversions pay a published 10% of order value,
    // quality-gated. This aligns payout with real conversions (FR14, FR9).
    perUnitGross = Math.round(ev.conversionValueMicros * 0.10 * quality);
  } else {
    // CPM events: per-event value = CPM / 1000, scaled by event weight and the
    // quality multiplier.
    const perEvent = (ev.cpmMicros ?? 0) / 1000;
    perUnitGross = Math.round(perEvent * weight * quality);
  }
  const grossMicros = Math.max(0, perUnitGross) * units;

  const netMicros = Math.floor((grossMicros * userShareBps) / BPS);
  const platformCutMicros = grossMicros - netMicros;

  return {
    formulaVersion: PAYOUT_FORMULA_VERSION,
    type,
    weight,
    quality,
    units,
    userShareBps,
    grossMicros,
    platformCutMicros,
    netMicros,
  };
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function clampBps(n) {
  if (!Number.isFinite(n)) return DEFAULT_SPLIT.userShareBps;
  return Math.min(BPS, Math.max(0, Math.round(n)));
}

// ---------------------------------------------------------------------------
// Money formatting helpers (display only — never used in the formula itself).
// ---------------------------------------------------------------------------

export function microsToUsd(micros) {
  return micros / 1_000_000;
}

export function formatUsd(micros, { precision = 4 } = {}) {
  const usd = microsToUsd(micros);
  return `$${usd.toFixed(precision)}`;
}
