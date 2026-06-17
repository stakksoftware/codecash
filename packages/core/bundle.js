// @codecash/core/bundle
//
// A campaign bundle is the signed package of ad inventory the client syncs and
// then targets against entirely on-device (FR16). The client downloads the whole
// bundle and chooses locally, so the server never learns which ad you saw or why
// you were eligible for it.

import { signValue, verifyValue } from './crypto.js';

export const BUNDLE_SCHEMA = 'codecash.bundle/v1';

/**
 * @typedef {object} Campaign
 * @property {string} id
 * @property {string} advertiser
 * @property {('impression'|'sponsor'|'affiliate'|'opt-in')} model  monetization model (§8)
 * @property {string} text            the sponsor line shown during the wait state
 * @property {string} [url]           click / affiliate destination
 * @property {number} cpmMicros       advertiser CPM in micro-USD
 * @property {string[]} [tags]        contextual tags matched locally (e.g. "rust","docker")
 * @property {number} [weight]        relative selection weight
 * @property {number} [dailyCapImpressions]
 */

export function buildBundle({ campaigns, version, generatedAt, ttlSeconds = 3600 }) {
  return {
    schema: BUNDLE_SCHEMA,
    version,
    generatedAt,
    ttlSeconds,
    campaigns: campaigns || [],
  };
}

export function signBundle(body, privateKeyB64u, keyId = 'codecash-bundle-v1') {
  return { body, signature: signValue(body, privateKeyB64u), keyId, alg: 'ed25519' };
}

export function verifyBundle(bundle, publicKeyB64u) {
  if (!bundle || !bundle.body) return false;
  return verifyValue(bundle.body, bundle.signature, publicKeyB64u);
}

/** Is a synced bundle still fresh given a reference time (ms epoch)? */
export function bundleIsFresh(bundle, nowMs) {
  const gen = Date.parse(bundle?.body?.generatedAt || '');
  if (!Number.isFinite(gen)) return false;
  const ttl = (bundle.body.ttlSeconds ?? 0) * 1000;
  return nowMs <= gen + ttl;
}
