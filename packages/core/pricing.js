// @codecash/core/pricing  (Phase 2 — demand)
//
// Campaign objectives & payout tiers. An advertiser buys ONE objective and bids
// a price for it. CodeCash still pays out through the SINGLE published formula
// in payout.js — this module only maps an advertiser's bid into the formula's
// inputs, so receipts stay independently reproducible without anyone needing to
// know the objective (verifyReceipt just re-runs computePayout on the stored
// cpm/conversion values).
//
//   cpm  → bills verified impressions; bid is cost per 1,000 impressions (FR11)
//   cpc  → bills engagements (intentional clicks); bid is cost per click (FR14)
//   cpa  → bills conversions; bid is the bounty per action (FR14, affiliate)
//
// Legacy campaigns (no `objective`, e.g. the seeded floor) keep their original
// weight-based behavior, so nothing about Phase 0/1 changes.

import { EVENT_WEIGHTS } from './payout.js';

export const OBJECTIVES = Object.freeze({
  cpm: { billable: 'impression', label: 'cost per 1,000 impressions' },
  cpc: { billable: 'engagement', label: 'cost per click' },
  cpa: { billable: 'conversion', label: 'cost per action' },
});

export const CONVERSION_REVSHARE = 0.10; // must match payout.js conversion path

/**
 * Map a campaign + event type to the inputs computePayout expects.
 * @returns {{ type:string, cpmMicros?:number, conversionValueMicros?:number, billable:boolean }}
 */
export function billingInputs(campaign, eventType) {
  const objective = campaign.objective;

  // ---- legacy (Phase 0/1) campaigns: unchanged weight-based pricing ----
  if (!objective) {
    if (eventType === 'conversion') {
      return {
        type: 'conversion',
        conversionValueMicros: campaign.conversionValueMicros ?? campaign.cpmMicros,
        billable: true,
      };
    }
    return { type: eventType, cpmMicros: campaign.cpmMicros, billable: true };
  }

  // ---- objective-based campaigns ----
  const spec = OBJECTIVES[objective];
  if (!spec) throw new Error(`unknown campaign objective: ${objective}`);

  // Only the objective's billable event type pays; others are logged at $0.
  if (eventType !== spec.billable) {
    return { type: eventType, cpmMicros: 0, billable: false };
  }

  const bid = campaign.bidMicros ?? 0;
  if (objective === 'cpm') {
    return { type: 'impression', cpmMicros: bid, billable: true };
  }
  if (objective === 'cpc') {
    // We want gross-per-click == bid. computePayout gives cpm/1000 * weight, so
    // choose cpm = bid * 1000 / engagementWeight.
    return {
      type: 'engagement',
      cpmMicros: Math.round((bid * 1000) / EVENT_WEIGHTS.engagement),
      billable: true,
    };
  }
  // cpa: gross == bid via the conversion rev-share path (bid = value * revshare).
  return {
    type: 'conversion',
    conversionValueMicros: Math.round(bid / CONVERSION_REVSHARE),
    billable: true,
  };
}

/** Human-readable description of how a campaign is priced. */
export function describePricing(campaign) {
  if (!campaign.objective) return `legacy CPM @ ${campaign.cpmMicros} micros`;
  const spec = OBJECTIVES[campaign.objective];
  return `${campaign.objective.toUpperCase()} (${spec?.label}) @ ${campaign.bidMicros} micros`;
}

/** Validate an advertiser-supplied campaign before it enters the bundle. */
export function validateCampaign(c) {
  const errors = [];
  if (!c.advertiser) errors.push('advertiser required');
  if (!c.text || c.text.length > 120) errors.push('text required, <=120 chars');
  if (c.objective && !OBJECTIVES[c.objective]) errors.push(`bad objective ${c.objective}`);
  if (c.objective && !(c.bidMicros > 0)) errors.push('bidMicros must be > 0 for objective campaigns');
  if (c.budgetMicros != null && !(c.budgetMicros >= 0)) errors.push('budgetMicros must be >= 0');
  if (c.url && !/^https?:\/\//.test(c.url)) errors.push('url must be http(s)');
  return { ok: errors.length === 0, errors };
}
