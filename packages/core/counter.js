// @codecash/core/counter
//
// The ONLY thing a CodeCash client ever transmits about your activity: a
// minimal, aggregated, device-signed counter (FR18). This module both builds
// counters and enforces — in code, with an allowlist — that no prompt, code,
// file content, repo metadata, or free-form context can ever ride along (FR17).
//
// If a future change tries to add a sensitive field to a counter, `assertClean`
// throws and the unit test fails. Privacy is a test, not a promise.

import { signValue, verifyValue, randomId } from './crypto.js';

export const COUNTER_SCHEMA = 'codecash.counter/v1';

/**
 * The complete, exhaustive set of keys allowed in a counter body. Anything not
 * on this list is forbidden. Keep this list small and boring on purpose.
 */
export const COUNTER_ALLOWED_KEYS = Object.freeze([
  'schema', // constant
  'deviceId', // pseudonymous device id (rotating, not a user identity)
  'periodStart', // ISO-8601 start of the aggregation window
  'periodEnd', // ISO-8601 end of the aggregation window
  'surface', // host surface category, e.g. "agent-cli" (NOT which repo)
  'events', // array of {campaignId, type, count, quality, cpmMicros}
  'nonce', // anti-replay
]);

const EVENT_ALLOWED_KEYS = Object.freeze([
  'campaignId',
  'type',
  'count',
  'quality',
  'cpmMicros',
  'conversionValueMicros',
]);

/**
 * Build a privacy-safe counter body. Callers pass only aggregate event tallies.
 * No targeting context, prompt, or path is accepted — there is no parameter for
 * it.
 */
export function buildCounter({ deviceId, periodStart, periodEnd, surface, events }) {
  const body = {
    schema: COUNTER_SCHEMA,
    deviceId,
    periodStart,
    periodEnd,
    surface,
    events: (events || []).map((e) => pick(e, EVENT_ALLOWED_KEYS)),
    nonce: randomId(8),
  };
  assertClean(body);
  return body;
}

/**
 * Throw if `body` contains any key outside the allowlist (at the top level or
 * inside an event). This is the privacy guarantee, enforced mechanically.
 */
export function assertClean(body) {
  for (const key of Object.keys(body)) {
    if (!COUNTER_ALLOWED_KEYS.includes(key)) {
      throw new Error(`counter contains forbidden field "${key}" — privacy violation (FR17/FR18)`);
    }
  }
  for (const ev of body.events || []) {
    for (const key of Object.keys(ev)) {
      if (!EVENT_ALLOWED_KEYS.includes(key)) {
        throw new Error(`counter event contains forbidden field "${key}" — privacy violation`);
      }
    }
  }
  return true;
}

export function signCounter(body, devicePrivateKeyB64u) {
  assertClean(body);
  return {
    body,
    signature: signValue(body, devicePrivateKeyB64u),
    alg: 'ed25519',
  };
}

/** Verify a counter was signed by the claimed device key and is clean. */
export function verifyCounter(counter, devicePublicKeyB64u) {
  try {
    assertClean(counter.body);
  } catch {
    return false;
  }
  return verifyValue(counter.body, counter.signature, devicePublicKeyB64u);
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}
