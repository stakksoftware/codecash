# Changelog

All notable changes to CodeCash are recorded here. Payout-formula changes are
*also* changelogged in [docs/PAYOUT_FORMULA.md](docs/PAYOUT_FORMULA.md) with an
effective date (FR7).

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
