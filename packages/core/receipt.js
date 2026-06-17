// @codecash/core/receipt
//
// A signed impression receipt (FR6). The platform signs one of these for every
// monetizable event it credits. A user can export the JSON and verify it against
// the published CodeCash receipt public key using nothing but this file — no
// CodeCash servers involved. That independence is the trust moat.

import { signValue, verifyValue, randomId } from './crypto.js';
import { computePayout, PAYOUT_FORMULA_VERSION } from './payout.js';

export const RECEIPT_SCHEMA = 'codecash.receipt/v1';

/**
 * Build the canonical, signable body of a receipt from a credited event.
 * Everything that affects the payout is included so the math is reproducible.
 */
export function buildReceiptBody(ev, split) {
  const payout = computePayout(ev, split);
  return {
    schema: RECEIPT_SCHEMA,
    receiptId: ev.receiptId || randomId(12),
    eventId: ev.eventId,
    issuedAt: ev.issuedAt, // ISO-8601 string, supplied by caller (testable)
    deviceId: ev.deviceId, // pseudonymous device id — NOT a user identity
    advertiser: ev.advertiser,
    campaignId: ev.campaignId,
    type: payout.type,
    cpmMicros: ev.cpmMicros ?? null,
    conversionValueMicros: ev.conversionValueMicros ?? null,
    quality: payout.quality,
    units: payout.units,
    formulaVersion: payout.formulaVersion,
    split: { userShareBps: payout.userShareBps },
    amounts: {
      grossMicros: payout.grossMicros,
      platformCutMicros: payout.platformCutMicros,
      netMicros: payout.netMicros,
    },
  };
}

/**
 * Sign a receipt body with the platform's receipt private key.
 * @returns {{ body:object, signature:string, keyId:string, alg:'ed25519' }}
 */
export function signReceipt(body, privateKeyB64u, keyId = 'codecash-receipts-v1') {
  return {
    body,
    signature: signValue(body, privateKeyB64u),
    keyId,
    alg: 'ed25519',
  };
}

/** Convenience: build + sign in one step. */
export function issueReceipt(ev, privateKeyB64u, { split, keyId } = {}) {
  return signReceipt(buildReceiptBody(ev, split), privateKeyB64u, keyId);
}

/**
 * Independently verify a receipt. Returns a structured result rather than
 * throwing, so a CLI/dashboard can show *why* a receipt failed.
 *
 * Two checks:
 *   1. signature — the bytes were signed by the published key.
 *   2. arithmetic — re-running the published formula reproduces the receipt's
 *      amounts. This catches a server that signs honestly but computes payouts
 *      dishonestly.
 */
export function verifyReceipt(receipt, publicKeyB64u) {
  const reasons = [];
  if (!receipt || typeof receipt !== 'object' || !receipt.body) {
    return { ok: false, signatureValid: false, arithmeticValid: false, reasons: ['malformed receipt'] };
  }

  const signatureValid = verifyValue(receipt.body, receipt.signature, publicKeyB64u);
  if (!signatureValid) reasons.push('signature does not match published receipt key');

  let arithmeticValid = false;
  try {
    const recomputed = computePayout(
      {
        type: receipt.body.type,
        cpmMicros: receipt.body.cpmMicros ?? undefined,
        conversionValueMicros: receipt.body.conversionValueMicros ?? undefined,
        quality: receipt.body.quality,
        units: receipt.body.units ?? 1,
      },
      { userShareBps: receipt.body.split?.userShareBps },
    );
    const a = receipt.body.amounts || {};
    arithmeticValid =
      recomputed.grossMicros === a.grossMicros &&
      recomputed.platformCutMicros === a.platformCutMicros &&
      recomputed.netMicros === a.netMicros &&
      recomputed.formulaVersion === receipt.body.formulaVersion;
    if (!arithmeticValid) reasons.push('amounts do not match the published payout formula');
  } catch (err) {
    reasons.push(`could not recompute payout: ${err.message}`);
  }

  if (receipt.body.formulaVersion !== PAYOUT_FORMULA_VERSION) {
    // Not a failure — a receipt issued under an older formula version stays
    // valid forever. We surface it as informational.
    reasons.push(
      `receipt uses formula ${receipt.body.formulaVersion} (current is ${PAYOUT_FORMULA_VERSION})`,
    );
  }

  return {
    ok: signatureValid && arithmeticValid,
    signatureValid,
    arithmeticValid,
    reasons,
  };
}
