// Brokered demand (FR10, Non-goal #1). Before building a native auction,
// CodeCash brokers EXISTING affiliate/sponsor demand. This module converts a
// third-party affiliate feed (the kind networks already publish) into CodeCash
// campaigns, so day-one inventory is real rather than house-only (G2/FR9).
//
// A feed offer looks like:
//   { merchant, headline, url, payoutMicros, model, tags }
// where `model` is "cpa" (bounty per signup/sale), "cpc" (per click) or "cpm".

import * as store from './db.js';
import { validateCampaign } from '@codecash/core';

const BROKER_ADVERTISER = { name: 'CodeCash Brokered', email: 'broker@codecash.example' };
const BROKER_API_KEY = 'brk_internal_broker_key';

/** Ensure the synthetic "brokered" advertiser exists and is funded. */
export async function ensureBrokerAdvertiser(fundMicros = 100_000_000) {
  const existing = await store.resolveApiKey(BROKER_API_KEY);
  if (existing) {
    return store.getAdvertiser(existing);
  }
  const { advertiser } = await store.createAdvertiser({ ...BROKER_ADVERTISER, apiKey: BROKER_API_KEY });
  await store.fundAdvertiser(advertiser.advertiserId, fundMicros);
  return store.getAdvertiser(advertiser.advertiserId);
}

/**
 * Import a feed of offers as active campaigns. Returns { imported, skipped }.
 * Each offer becomes one campaign on the brokered advertiser, with a per-offer
 * budget so a single brokered offer can't drain the whole pool. Idempotent on
 * the campaign id (re-importing the same feed updates in place).
 */
export async function importFeed(offers, { perOfferBudgetMicros = 10_000_000 } = {}) {
  const adv = await ensureBrokerAdvertiser();
  let imported = 0;
  const skipped = [];

  for (const offer of offers || []) {
    const objective = offer.model || 'cpa';
    const campaign = {
      id: 'brk_' + slug(offer.merchant) + '_' + slug(offer.headline).slice(0, 8),
      advertiser: offer.merchant,
      model: 'affiliate',
      objective,
      bidMicros: offer.payoutMicros,
      text: offer.headline,
      url: offer.url,
      tags: offer.tags || [],
      weight: offer.weight || 2,
      budgetMicros: offer.budgetMicros ?? perOfferBudgetMicros,
      dailyCapImpressions: offer.dailyCapImpressions,
    };
    const v = validateCampaign(campaign);
    if (!v.ok) {
      skipped.push({ merchant: offer.merchant, errors: v.errors });
      continue;
    }
    if (await store.getCampaign(campaign.id)) {
      skipped.push({ merchant: offer.merchant, errors: ['already imported'] });
      continue;
    }
    await store.createCampaign(adv.advertiserId, campaign);
    imported++;
  }
  return { imported, skipped, advertiserId: adv.advertiserId };
}

function slug(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
