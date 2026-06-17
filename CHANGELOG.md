# Changelog

All notable changes to CodeCash are recorded here. Payout-formula changes are
*also* changelogged in [docs/PAYOUT_FORMULA.md](docs/PAYOUT_FORMULA.md) with an
effective date (FR7).

## [0.2.0] — 2026-06-17

Phases 2–4: the demand side, surface expansion, and the latency SDK. No change
to the published payout formula or signed-receipt format — every new surface
reuses the Phase 0 trust core.

### Phase 2 — Demand (`@codecash/core/pricing`, server, advertiser CLI)
- Campaign objectives / payout tiers: **CPM / CPC / CPA**, mapped into the single
  published formula so receipts stay independently reproducible (FR11, FR14).
- Advertiser identity space (`x-api-key`): register, fund, create/list campaigns,
  account stats — API + `codecash-advertiser` CLI + `/advertiser` web console.
- Dynamic signed bundle = seeded floor ∪ live, funded advertiser campaigns;
  public bundle never leaks bids or budgets.
- Per-campaign **budget pacing**: spend can't exceed budget; exhausted campaigns
  drop out of inventory. Server-authoritative pricing (clients can't inflate CPM).
- **Invalid-traffic rate** per campaign (billable events quality-gated to $0),
  honestly reported to advertisers (§9 integrity metric).
- Brokered affiliate-feed import (`broker.js`, `scripts/import-feed.mjs`, sample
  feed) — broker existing demand before any native auction (FR10).

### Phase 3 — Surface expansion (CLI)
- `codecash wrap -- <command>`: monetize build/CI + long-job waits; credits a
  verified impression from the wrapped command's real runtime, passes the exit
  code through untouched, degrades to silence on any failure (FR12, FR20).
- On-device surface detection (`surfaces.js`); events grouped per surface on
  flush so only the coarse category is ever sent (FR17).
- `mode <earn|sponsor|off>`: rotating earn · "powered by" single-sponsor · pay-to-
  remove (§8).

### Phase 4 — SDK (`@codecash/sdk`)
- `CodeCashSDK` with `duringWait()` and `wrapStream()` (time-to-first-token) so a
  third-party app can monetize its own latency on the same trust/privacy terms.
- `CodeCashSDK.login()` bootstrap, on-device selection, signed counters, signed
  receipts, in-session earnings — built entirely on `@codecash/core`.

### Tests & tooling
- 85 tests (was 60): added pricing tiers, the full advertiser/budget/broker flow,
  surface detection + sponsor mode, and the SDK (login/sync/duringWait/wrapStream/
  flush/verify).
- `scripts/demo-phase2.mjs` runs Phases 2–4 end-to-end; `scripts/import-feed.mjs`
  brokers the sample feed.

## [0.1.0] — 2026-06-17

Initial scaffold of the full Phase 0 trust core and Phase 1 launch surface.

### Trust core (`@codecash/core`)
- Canonical-JSON Ed25519 signing/verification (zero dependencies).
- Published, versioned payout formula `v1.0.0` — 70/30 split, weights
  impression/engagement/conversion = 1/8/60, 10% conversion rev-share, quality
  gate, `units` aggregation, and **no balance/threshold inputs** (FR8).
- Signed, independently-verifiable receipts (signature *and* arithmetic).
- Privacy-safe counters with a forbidden-field allowlist (FR17/FR18).
- Signed campaign bundles + on-device targeting.
- Verified-impression session gating (FR12).

### Client (`codecash` CLI)
- `login`, `install`, `sync`, `status`, `record`, `flush`, `ledger`, `verify`,
  `payouts`, `cashout`, `pause`/`resume`, `off`/`on`, `mode`, `doctor`.
- OS-keychain (or `0600` file) secret storage with silent token refresh (FR19).
- Self-monitoring circuit breaker that auto-disables on repeated failure (FR21).
- Renders only via Claude Code's sanctioned `statusLine`; degrades to silence,
  never breaks the host (FR2/FR20).

### Broker (`@codecash/server`)
- Node stdlib `http`, zero runtime dependencies.
- Signed bundle endpoint with a seeded affiliate/sponsor inventory floor (FR9).
- Device-signed counter ingestion with replay/rate/anomaly/velocity fraud gates
  and server-authoritative pricing (FR12–FR14).
- Signed-receipt issuance, transparent ledger, published key well-known.
- Stripe payout adapter (live + deterministic mock) and verified-identity gate at
  cash-out (FR15/FR22/FR23).
- In-browser transparency dashboard that verifies receipts via WebCrypto (FR5).

### Tests & tooling
- 60 tests across core/cli/server, including the FR8 no-throttle invariant, the
  FR17 privacy allowlist, replay/rate-limit rejection, and the full
  withdraw-after-verification path.
- `scripts/genkeys.mjs` publishes verification keys to `docs/keys/`.
- `scripts/demo.mjs` runs the entire flow end-to-end locally.
