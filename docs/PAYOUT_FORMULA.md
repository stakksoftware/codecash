# CodeCash Payout Formula

> **The contract.** This document is the human-readable twin of
> [`packages/core/payout.js`](../packages/core/payout.js). The code is the source
> of truth; this file must always describe the code that ships. Every signed
> receipt records the `formulaVersion` it was paid under, so an old receipt stays
> verifiable forever (FR7).

**Current version:** `1.0.0`
**Effective:** 2026-06-17

---

## Money units

All amounts are integer **micro-USD** (`1 USD = 1,000,000 micros`). Integer math
end-to-end — no floating-point drift, no rounding surprises.

**CPM** = advertiser cost per **mille** (1,000 impressions), in micros.

## The formula

For a single monetizable event:

```
perUnitGross =
    if conversion with order value V:   round(V × 0.10 × quality)
    else:                               round((CPM / 1000) × weight × quality)

gross    = max(0, perUnitGross) × units
net      = floor(gross × userShareBps / 10000)      ← your money
platform = gross − net
```

### Event weights (`EVENT_WEIGHTS`)

| Event        | Weight | Why                                                            |
|--------------|:------:|----------------------------------------------------------------|
| `impression` |   1    | Baseline. A verified, quality-gated view.                      |
| `engagement` |   8    | An intentional click/expand — far harder to fake (FR14).       |
| `conversion` |   60   | A confirmed downstream action; or a 10% rev-share of order value. |

### Quality (`quality ∈ [0,1]`)

Quality is decided **on your device** by
[`session.js`](../packages/core/session.js) from genuine active-session signals
(real agent/build/job activity, window focus, time actually on screen). A view
that isn't a genuine wait state gets `quality = 0` and **pays nothing** — it is
still logged for transparency (FR12). The server independently re-screens.

### Split (`userShareBps`)

The revenue split is **published and versioned**, never a per-user secret.

| Param          | Value  | Meaning                          |
|----------------|:------:|----------------------------------|
| `userShareBps` | `7000` | **You keep 70%.** Platform 30%.  |

A 70% user share (vs. the incumbent's implied take) is a deliberate part of the
wedge (answers PRD §11). Changing it is a versioned, changelogged event.

## Worked examples

| Event | CPM / value | quality | units | gross | you (net) | platform |
|-------|-------------|:-------:|:-----:|------:|----------:|---------:|
| impression | $12.00 CPM | 1.0 | 1 | $0.0120 | $0.0084 | $0.0036 |
| impression | $5.00 CPM  | 0.8 | 2 | $0.0080 | $0.0056 | $0.0024 |
| engagement | $12.00 CPM | 1.0 | 1 | $0.0960 | $0.0672 | $0.0288 |
| conversion | $25.00 order | 1.0 | 1 | $2.5000 | $1.7500 | $0.7500 |

## The two invariants we will never break

1. **No threshold-proximity throttling (FR8).** `computePayout` takes *no*
   `balance`, `threshold`, `lifetimeEarnings`, or account-age parameter. It is
   mathematically impossible for it to taper your earnings as you approach
   cash-out. This is enforced by a unit test
   ([`payout.test.js`](../packages/core/test/payout.test.js), *"FR8: payout is
   independent of balance / threshold proximity"*) that feeds hostile
   balance/threshold fields and asserts the result is identical.

2. **Reproducible receipts.** Every receipt carries all inputs (type, CPM or
   order value, quality, units, split, formula version). Anyone can re-run this
   formula and confirm the amounts — `codecash verify` does exactly that, with
   no trust in CodeCash servers.

## Fraud-relevant pricing rule

The **server uses its own CPM and conversion values** from the signed campaign
bundle, never the values a client claims. A client cannot inflate its own
payout by lying about CPM.

## Daily velocity cap

Independent of the payout formula, the server applies a fixed, published
**$20.00/day gross** earnings-velocity cap per account
([`fraud.js`](../apps/server/src/fraud.js)). This is an anti-abuse control, not a
balance-proximity throttle: it is the same for everyone and does not depend on
how close you are to cash-out.

## Changelog

### 1.0.0 — 2026-06-17
- Initial published formula: micro-USD integer math; weights
  impression/engagement/conversion = 1/8/60; conversion rev-share 10%; user
  share 70%; quality gate in `[0,1]`; `units` aggregation; no balance/threshold
  inputs.
