# CodeCash

**Earn from the time you already spend waiting on agents and builds — on terms
you can audit, with nothing sensitive ever leaving your machine.**

CodeCash turns AI/agent wait-states into value for the developer who is waiting,
without being parasitic, opaque, or fraud-prone — the three things sinking the
incumbent. It renders one tasteful sponsored line during genuine wait states,
pays you on a **published, versioned formula**, hands you a **cryptographically
signed receipt for every cent**, keeps **all targeting on-device**, and **never
transmits your prompts or code**.

> Formerly codenamed *Slipstream*. Working name: **CodeCash**.

## 🟢 Live

Deployed on Vercel + Supabase Postgres ([deployment notes](docs/DEPLOY.md)):

- **Transparency dashboard:** https://codecash-swart.vercel.app/
- **Advertiser console:** https://codecash-swart.vercel.app/advertiser
- **Published receipt key:** https://codecash-swart.vercel.app/.well-known/codecash-receipts.json
- **Source:** https://github.com/stakksoftware/codecash

Point the CLI/SDK at it: `export CODECASH_SERVER=https://codecash-swart.vercel.app`

```
$ codecash ledger
CodeCash local ledger
─────────────────────
events: 4   impression:2  engagement:1  conversion:1
gross:  $2.5945   you (net): $1.8161   platform: $0.7783
split:  you 70% / platform 30%   formula v1.0.0

$ codecash verify
✓ 6AeB-pKt0s3V-iCP.json — signature OK, math OK ($0.0067 to you)
✓ PsoNevwIZUtYzBea.json — signature OK, math OK ($1.7500 to you)
Verified 4 receipt(s) against published key; 0 failed.
```

## Why this exists

The incumbent proved people will install something to monetize dead time — and
exposed exactly where a competitor wins:

| Weakness observed | CodeCash's answer |
|---|---|
| Earnings drop near cash-out → suspected throttling | **No threshold throttling, ever** — enforced by a unit test (FR8) |
| House-only inventory → payouts trend to $0 | **Seeded affiliate floor** so day-one payout is never $0 (FR9) |
| Per-impression payout is trivially gamed | **Verified, quality-gated** impressions + engagement/conversion weighting (FR12/FR14) |
| Repeated re-auth → churn | **Persistent keychain auth, silent refresh** (FR19) |
| Injects into surfaces it doesn't own → fragile/ToS-risky | **Only host-sanctioned config** (Claude Code `statusLine`); degrade, never break (FR2/FR20) |
| Opaque data flow → "spyware" feel | **On-device targeting, open-source client, signed minimal counters** (FR16–FR18) |

## Quick start

Requires **Node ≥ 20**. No external dependencies — the whole thing runs on the
Node standard library.

```bash
npm install            # links the workspaces (no network packages)
npm test               # 60 tests across core / cli / server
npm run keys           # generate + publish the receipt/bundle keys
npm run demo           # full end-to-end walkthrough (server + CLI, all local)
```

Two end-to-end walkthroughs (server + real CLIs, all local):

```bash
npm run demo           # Phase 0/1: earn, signed receipts, verify, Stripe cash-out
npm run demo:phase2    # Phases 2-4: advertisers + broker, wrap, sponsor mode, SDK
```

Run the pieces yourself:

```bash
npm run server         # broker on http://127.0.0.1:8787 (earner / at /, advertiser at /advertiser)

# earner:
node apps/cli/bin/codecash.js login --email you@example.com
node apps/cli/bin/codecash.js install        # wire into Claude Code statusLine
node apps/cli/bin/codecash.js sync            # pull the signed campaign bundle
node apps/cli/bin/codecash.js status          # the sponsored wait-state line
node apps/cli/bin/codecash.js wrap -- npm install   # monetize a build/long-job wait
node apps/cli/bin/codecash.js ledger          # your auditable ledger
node apps/cli/bin/codecash.js verify          # verify receipts independently

# advertiser:
npm run import-feed                            # broker the sample affiliate feed
node apps/cli/bin/codecash-advertiser.js register --name "Acme" --email ads@acme.com
node apps/cli/bin/codecash-advertiser.js fund --usd 50
node apps/cli/bin/codecash-advertiser.js create --objective cpc --bid-usd 0.30 --text "Acme → acme.example" --tags rust,go --budget-usd 10
```

## Repository layout

```
packages/core      @codecash/core — the zero-dependency trust core
  crypto.js        canonical JSON + Ed25519 sign/verify
  payout.js        THE published payout formula (no balance inputs → no throttling)
  pricing.js       objective→formula mapping: CPM / CPC / CPA tiers (Phase 2)
  receipt.js       signed, independently-verifiable receipts
  counter.js       privacy-safe counters + a forbidden-field allowlist
  bundle.js        signed campaign bundle
  targeting.js     on-device ad selection
  session.js       verified-impression quality gating

packages/sdk       @codecash/sdk — opt-in latency-monetization SDK (Phase 4)
  index.js         duringWait() / wrapStream() for third-party apps
  example.mjs      runnable time-to-first-token example

apps/cli           codecash — the open-source on-device client
  bin/codecash.js              earner CLI (incl. `wrap`, `mode`)
  bin/codecash-advertiser.js   advertiser console CLI (Phase 2)
  src/             config · keychain · telemetry · render · events · ledger · api · surfaces · advertiser · commands

apps/server        @codecash/server — the broker (Node stdlib http, zero deps)
  src/             server · store · keys · seed · broker · fraud · payouts · stripe
  public/          dashboard.html (earner) · advertiser.html (demand)
  data/            affiliate-feed.sample.json — brokered demand (FR10)

docs/              PRD · PAYOUT_FORMULA · PRIVACY · PAYOUTS · FRAUD · DEMAND · SURFACES · SDK · ARCHITECTURE · keys/
scripts/           genkeys.mjs · demo.mjs · demo-phase2.mjs · import-feed.mjs
```

## The trust core, in one paragraph

`@codecash/core` is dependency-free and runs **identically** on your machine, on
the server, and in an independent auditor's tools. A receipt is verified two
ways: its Ed25519 **signature** must match the published key, *and* re-running
the **published formula** must reproduce its amounts — so a server that signs
honestly but computes dishonestly is still caught. Try it: `codecash verify`, or
open the dashboard and click "verify" on any row (it verifies in your browser via
WebCrypto, trusting nothing on the page).

## Requirements traceability (FR1–FR23)

| FR | Requirement | Where |
|----|-------------|-------|
| FR1 | One subtle sponsored wait-state line | [`render.js`](apps/cli/src/render.js) |
| FR2 | Host-sanctioned config only (Claude Code statusLine) | [`commands.js` `install`](apps/cli/src/commands.js) |
| FR3 | One sponsor max; global frequency cap | [`render.js`](apps/cli/src/render.js) |
| FR4 | Kill-switch + pause | [`config.js`](apps/cli/src/config.js), `off`/`on`/`pause` |
| FR5 | Per-event dashboard (CPM, gross, net, cut) | [`dashboard.html`](apps/server/public/dashboard.html), `ledger` |
| FR6 | Signed, independently-verifiable receipts | [`receipt.js`](packages/core/receipt.js), `verify` |
| FR7 | Published, versioned payout formula | [`PAYOUT_FORMULA.md`](docs/PAYOUT_FORMULA.md), [`payout.js`](packages/core/payout.js) |
| FR8 | No threshold-proximity throttling | [`payout.js`](packages/core/payout.js) + FR8 unit test |
| FR9 | Seeded affiliate inventory floor | [`seed.js`](apps/server/src/seed.js) |
| FR10 | Broker existing demand before native auction | [`seed.js`](apps/server/src/seed.js) (affiliate/sponsor models) |
| FR11 | Multiple revenue models behind one surface | [`bundle.js`](packages/core/bundle.js) `model`, [`payout.js`](packages/core/payout.js) |
| FR12 | Pay on verified impressions only | [`session.js`](packages/core/session.js) |
| FR13 | Rate-limit / anomaly / velocity cap | [`fraud.js`](apps/server/src/fraud.js) |
| FR14 | Weight toward engagement/conversion | [`payout.js` `EVENT_WEIGHTS`](packages/core/payout.js) |
| FR15 | Sybil resistance + verified identity at cash-out | [`payouts.js`](apps/server/src/payouts.js), `verify-identity` |
| FR16 | On-device targeting from synced bundle | [`targeting.js`](packages/core/targeting.js) |
| FR17 | Never transmit prompts/code/paths | [`counter.js`](packages/core/counter.js), [`PRIVACY.md`](docs/PRIVACY.md) |
| FR18 | Minimal signed counters; open-source client | [`counter.js`](packages/core/counter.js), MIT [`LICENSE`](LICENSE) |
| FR19 | Persistent keychain auth, silent refresh | [`keychain.js`](apps/cli/src/keychain.js) |
| FR20 | Self-heal; degrade rather than break host | [`api.js`](apps/cli/src/api.js), [`render.js`](apps/cli/src/render.js) |
| FR21 | Self-telemetry + auto-disable | [`telemetry.js`](apps/cli/src/telemetry.js) |
| FR22 | Transparent cash-out threshold + schedule | [`PAYOUTS.md`](docs/PAYOUTS.md), [`payouts.js`](apps/server/src/payouts.js) |
| FR23 | Stripe payout rails live | [`stripe.js`](apps/server/src/stripe.js) |

## Phased plan status (PRD §12)

- **Phase 0 — Trust core:** ✅ ledger, signed receipts, published formula,
  on-device targeting.
- **Phase 1 — Launch surface:** ✅ Claude Code statusLine, affiliate floor,
  Stripe payout path, zero-maintenance keychain auth.
- **Phase 2 — Demand:** ✅ advertiser console (register/fund/campaigns/stats),
  CPM/CPC/CPA payout tiers, budget pacing, brokered affiliate-feed import,
  invalid-traffic metric, advertiser dashboard. See [DEMAND.md](docs/DEMAND.md).
- **Phase 3 — Surface expansion:** ✅ `codecash wrap` for build/CI + long-job
  waits, on-device surface detection, "powered by" sponsor mode + pay-to-remove.
  See [SURFACES.md](docs/SURFACES.md).
- **Phase 4 — SDK:** ✅ `@codecash/sdk` monetizes third-party app latency /
  time-to-first-token. See [SDK.md](docs/SDK.md).

All phases share one trust core, one payout formula, and one signed-receipt
format — Phases 2–4 required **no** change to the formula or receipt
([ARCHITECTURE.md](docs/ARCHITECTURE.md)).

## Docs

- [Product Requirements (PRD)](docs/PRD.md)
- [Payout Formula](docs/PAYOUT_FORMULA.md) · [Payouts](docs/PAYOUTS.md)
- [Privacy Promise](docs/PRIVACY.md) · [Fraud Resistance](docs/FRAUD.md)
- [Demand Side (Phase 2)](docs/DEMAND.md) · [Surfaces (Phase 3)](docs/SURFACES.md) · [Latency SDK (Phase 4)](docs/SDK.md)
- [Architecture](docs/ARCHITECTURE.md)

## License

MIT — the client is open source so you can audit exactly what runs on your
machine.
