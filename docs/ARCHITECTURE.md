# CodeCash Architecture

Three pieces, one trust core.

```
                         ┌───────────────────────────────────────┐
                         │              @codecash/core             │
                         │  canonical signing · payout formula ·   │
                         │  receipts · counters · targeting ·      │
                         │  session gating   (zero deps, shared)   │
                         └───────────────────────────────────────┘
                            ▲              ▲                 ▲
              imports       │              │ imports         │ mirrored in-browser
                            │              │                 │
        ┌───────────────────┴──┐     ┌─────┴───────────┐   ┌─┴─────────────────────┐
        │     apps/cli          │     │   apps/server    │   │  server/public/        │
        │  (open-source client) │     │   (broker)       │   │  dashboard.html        │
        │                       │     │                  │   │  (transparency UI)     │
        │ login · sync · status │     │ bundle · counters│   │ verifies receipts in   │
        │ record · flush · ledger│ ──▶ │ ledger · payouts │ ◀─│ the browser, no trust  │
        │ verify · payouts · etc│ HTTP│ fraud · stripe   │   │ in the page            │
        └───────────────────────┘     └──────────────────┘   └────────────────────────┘
              on-device only                 signed receipts ──────────▲
```

## `packages/core` — the trust core (zero dependencies)

Runs **identically** on the user's machine, the server, and an independent
auditor's. That sameness is the point: verification needs no special tooling.

- `crypto.js` — canonical JSON + Ed25519 sign/verify (Node stdlib only).
- `payout.js` — the published, versioned payout formula (no balance inputs).
- `receipt.js` — build/sign/verify signed receipts; verification re-runs the
  formula so dishonest math is caught even when the signature is valid.
- `counter.js` — privacy-safe counter builder + an allowlist that throws on any
  forbidden field.
- `bundle.js` — signed campaign bundle schema + freshness.
- `targeting.js` — on-device, deterministic ad selection.
- `session.js` — verified-impression quality gating.

## `apps/cli` — the client (FR1–FR4, FR16, FR19–FR21)

The hot path is `codecash status`, wired into Claude Code's **sanctioned**
`statusLine` setting (FR2) — CodeCash never patches a host. It renders at most
one labeled sponsor line, honoring pause/kill/frequency-cap, and **degrades to
silence** rather than ever breaking the host. A self-monitoring circuit breaker
(`telemetry.js`) auto-disables the client if it starts failing (FR21).

Secrets (device key + auth) live in the OS keychain (or a `0600` file) with
silent token refresh, so there are no repeated sign-ins (FR19).

## `apps/server` — the broker (FR5–FR15, FR22, FR23)

Node stdlib `http`, zero runtime deps. Serves the signed bundle, ingests
device-signed counters, runs the fraud gates, credits via the published formula,
issues signed receipts, exposes the ledger, and runs Stripe-backed payouts.

### The persistence seam

[`store.js`](../apps/server/src/store.js) is a single JSON-document store for a
runnable, dependency-free reference. Its function interface
(`accounts/devices/sessions/ledger/transfers/seenNonces`) is the seam where
production swaps in **Postgres / Supabase** — the rest of the server only calls
these functions, never the file. A Supabase migration would map each collection
to a table with the same shape.

## Data flow for one earned dollar

1. `status` renders a labeled sponsor line, selected on-device.
2. A genuine wait state is assessed (`session.js`) → quality > 0.
3. Verified events queue locally, then flush as **one** device-signed counter.
4. Server verifies signature + device binding, runs fraud gates, credits via the
   published formula using server-authoritative pricing, and returns **signed
   receipts**.
5. Receipts land in the local ledger and the server ledger. The user (or the
   dashboard) verifies them independently against the published key.
6. At ≥ $5 net with a verified payment identity, `cashout` triggers a Stripe
   transfer.

## Surface roadmap (PRD §7) and where it plugs in

`status` is surface #1 (agent CLIs). Build/CI and long-job surfaces (#2/#3) are
implemented by `codecash wrap`, which reuses the same `record`/`flush` path with
session signals derived from a wrapped command's real runtime
([surfaces.js](../apps/cli/src/surfaces.js)). The opt-in latency SDK (#4),
[`@codecash/sdk`](../packages/sdk), is a thin wrapper that calls the same
`@codecash/core` primitives — `duringWait()` and `wrapStream()` (time-to-first-
token). None of these required a change to the payout formula or receipt format.

## Demand side (Phase 2)

The same broker server grows a second identity space — **advertisers** (API key)
alongside **earners** (account token). Advertiser campaigns are stored in
[`store.js`](../apps/server/src/store.js) and **unioned** with the seeded floor to
build the signed bundle, so live demand and the affiliate floor serve through one
surface. Pricing tiers (CPM/CPC/CPA) live in
[`pricing.js`](../packages/core/pricing.js), which maps an advertiser's bid into
the single published formula's inputs — so receipts stay reproducible with no
knowledge of the objective. Budgets are paced by the same capping logic that
limits earner velocity; brokered demand is imported by
[`broker.js`](../apps/server/src/broker.js). See [DEMAND.md](./DEMAND.md).

```
   earners (CLI/SDK) ──counters──▶ ┌──────────────┐ ◀──campaigns/fund── advertisers
                                   │    broker     │
   signed receipts ◀──────────────│   (server)    │──spend/stats──▶ advertiser console
                                   └──────────────┘
                          one signed bundle = seeded floor ∪ live demand
```
