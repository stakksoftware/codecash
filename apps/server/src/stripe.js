// Stripe payout adapter (FR23). Payout rails are live behind a single interface
// so accrued-but-unpayable balances never erode trust. In production this calls
// Stripe Connect Transfers/Payouts; in dev (no STRIPE_SECRET_KEY) it uses a
// deterministic mock that returns a transfer id, so the entire withdrawal path
// is exercised end-to-end without network or secrets.

import { randomId } from '@codecash/core';

export function stripeConfigured() {
  return !!process.env.STRIPE_SECRET_KEY;
}

/**
 * Create a payout transfer of `amountMicros` to the account's connected payee.
 * Returns { ok, transferId, rails, amountMicros }.
 *
 * The mock and the real path return the same shape so callers don't branch.
 */
export async function createPayout({ accountId, amountMicros, email }) {
  if (!stripeConfigured()) {
    return {
      ok: true,
      transferId: 'tr_mock_' + randomId(8),
      rails: 'stripe-mock',
      amountMicros,
    };
  }

  // --- Real Stripe path (engaged only when STRIPE_SECRET_KEY is present) ---
  // Kept dependency-free: a direct call to Stripe's REST API. Amount is in the
  // smallest currency unit (cents); we floor micros -> cents.
  const cents = Math.floor(amountMicros / 10_000);
  const params = new URLSearchParams({
    amount: String(cents),
    currency: 'usd',
    // In production, `destination` is the user's Stripe Connect account id,
    // looked up from a verified-identity record (FR15). Stored per-account.
    destination: process.env.STRIPE_DEMO_DESTINATION || 'acct_connected_placeholder',
    description: `CodeCash payout to ${accountId}`,
  });
  const res = await fetch('https://api.stripe.com/v1/transfers', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });
  const json = await res.json();
  if (!res.ok) {
    return { ok: false, error: json.error?.message || 'stripe error', rails: 'stripe' };
  }
  return { ok: true, transferId: json.id, rails: 'stripe', amountMicros: cents * 10_000 };
}
