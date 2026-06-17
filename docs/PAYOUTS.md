# CodeCash Payouts

> Stated up front, before you install (FR22). Fixed terms, no surprises.

## Terms

| Term | Value |
|------|-------|
| **Your share** | **70%** of gross (published in [PAYOUT_FORMULA.md](./PAYOUT_FORMULA.md)) |
| **Cash-out threshold** | **$5.00** net balance |
| **Schedule** | On-demand once balance ≥ $5.00; automatic weekly sweep (Mondays) |
| **Rails** | Stripe (Connect transfers) |
| **Fees** | CodeCash adds no withdrawal fee; standard Stripe fees apply |
| **Identity** | Payment identity verified **at cash-out**, not at signup (FR15) |

These terms are **fixed**. We do not slow your earnings as you approach the
threshold — see the no-throttling invariant in
[PAYOUT_FORMULA.md](./PAYOUT_FORMULA.md) (FR8). A daily **$20.00 gross**
earnings-velocity cap applies as an anti-fraud control and is the same for
everyone.

## Why rails are live at launch

Accrued-but-unpayable balances are how trust dies (it's one of the incumbent's
wounds). CodeCash wires up payouts **before** public launch (FR23). The withdraw
path is exercised end-to-end in `scripts/demo.mjs` and
`apps/server/test/server.test.js`.

- **Dev / no secret:** with no `STRIPE_SECRET_KEY`, the
  [`stripe.js`](../apps/server/src/stripe.js) adapter returns a deterministic
  mock transfer so the full flow runs offline.
- **Live:** set `STRIPE_SECRET_KEY` (and per-account Stripe Connect destinations)
  and the same code path calls Stripe's Transfers API. The adapter returns an
  identical shape, so nothing else changes.

## Cashing out

```bash
codecash payouts     # balance, fixed threshold, whether you're payable, schedule
codecash cashout     # initiate a payout (requires balance ≥ threshold + verified identity)
```

If you're below the threshold or your payment identity isn't verified yet, the
command tells you exactly what's missing — it never silently fails.
