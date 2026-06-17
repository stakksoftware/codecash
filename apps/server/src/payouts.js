// Payout policy (FR22, FR23, FR15). Threshold and schedule are FIXED and stated
// up front — there is no balance-proximity throttling anywhere (FR8). Withdrawal
// requires a verified payment identity (FR15, Sybil resistance at cash-out).

import * as store from './store.js';
import { createPayout, stripeConfigured } from './stripe.js';

export const CASHOUT_THRESHOLD_MICROS = 5_000_000; // $5.00 — fixed, published
export const PAYOUT_SCHEDULE = 'on-demand once balance ≥ $5.00; auto-sweep weekly (Mondays)';

export function payoutStatus(accountId) {
  const account = store.getAccount(accountId);
  const balanceMicros = store.balanceMicros(accountId);
  return {
    balanceMicros,
    thresholdMicros: CASHOUT_THRESHOLD_MICROS,
    payable: balanceMicros >= CASHOUT_THRESHOLD_MICROS && !!account?.identityVerified,
    identityVerified: !!account?.identityVerified,
    schedule: PAYOUT_SCHEDULE,
    rails: stripeConfigured() ? 'stripe' : 'stripe-mock (set STRIPE_SECRET_KEY for live)',
  };
}

export async function withdraw(accountId) {
  const account = store.getAccount(accountId);
  if (!account) return { ok: false, reason: 'no such account' };

  const balanceMicros = store.balanceMicros(accountId);
  if (balanceMicros < CASHOUT_THRESHOLD_MICROS) {
    return { ok: false, reason: `below threshold (have ${balanceMicros}, need ${CASHOUT_THRESHOLD_MICROS})` };
  }
  if (!account.identityVerified) {
    // FR15: verified payment identity is required at withdrawal, not signup, so
    // it doesn't add friction that hurts growth (PRD §11 answered).
    return { ok: false, reason: 'payment identity not verified (required at cash-out, FR15)' };
  }

  const transfer = await createPayout({ accountId, amountMicros: balanceMicros, email: account.email });
  if (!transfer.ok) return { ok: false, reason: transfer.error || 'payout rail error' };

  store.recordTransfer({
    accountId,
    amountMicros: transfer.amountMicros,
    transferId: transfer.transferId,
    rails: transfer.rails,
    at: new Date().toISOString(),
  });
  return { ok: true, amountMicros: transfer.amountMicros, transferId: transfer.transferId, rails: transfer.rails };
}
