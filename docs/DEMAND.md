# CodeCash Demand Side (Phase 2)

> How advertisers buy **verified** developer attention — and why CodeCash brokers
> existing demand before building an auction (FR9, FR10, FR11, G2, G3).

## The two-sided market

CodeCash has two identity spaces:

- **Earners** (the CLI / SDK) authenticate with an account access token and earn.
- **Advertisers** (the console) authenticate with an `x-api-key` and spend.

They meet at the **signed campaign bundle**: the served inventory is the seeded
floor (FR9) **unioned** with live, funded advertiser campaigns. Targeting still
happens entirely on the earner's device.

## Pricing tiers / campaign objectives (FR11, FR14)

An advertiser buys **one objective** and bids a price for it. The single published
payout formula in [`payout.js`](../packages/core/payout.js) is unchanged — the
objective just maps the bid into the formula's inputs (see
[`pricing.js`](../packages/core/pricing.js)), so receipts stay independently
verifiable without anyone needing to know the objective.

| Objective | Bills on | Bid means | Impressions? |
|-----------|----------|-----------|--------------|
| `cpm` | verified impressions | cost per 1,000 impressions | billed |
| `cpc` | engagements (clicks) | cost per click | free |
| `cpa` | conversions | bounty per action | free |

Legacy seeded campaigns (no `objective`) keep the original weight-based pricing,
so nothing about Phase 0/1 changes. This is also why impression-only surfaces
(`wrap`, the SDK) earn from CPM/sponsor/legacy inventory, not from CPC/CPA buys —
exactly as a real market behaves.

## Budgets & pacing

Each campaign has a budget; each advertiser has a funded balance. Crediting an
event bills the advertiser the **gross** (the earner gets their net, the platform
its cut). When a campaign's budget is spent it flips to `exhausted` and drops
out of the next bundle. Spend can never exceed budget — the same pacing logic
that caps the earner's velocity caps advertiser spend (see
[`server.js`](../apps/server/src/server.js)).

## Server-authoritative pricing (anti-fraud)

The server prices every event from the campaign's own objective/bid — it **never**
trusts a client-supplied CPM. A client cannot inflate its payout, and an
advertiser is only ever billed for the objective they bought.

## Invalid-traffic rate (the trust metric)

For each campaign the server tracks impressions, clicks, conversions, and
**flagged** events. A *billable* event that the fraud layer quality-gated to $0
is flagged as invalid traffic; a non-billable event (e.g. an impression on a CPC
buy) is **not**. The advertiser sees:

```
invalidTrafficRate = flagged / (impressions + clicks + conversions + flagged)
```

A low, honestly-reported invalid-traffic rate is the trust signal that lets
CodeCash sell verified attention at real CPMs (a CodeCash success metric, §9).

## Brokering existing demand (FR10)

Before any native auction, CodeCash ingests existing affiliate/sponsor feeds.
[`broker.js`](../apps/server/src/broker.js) converts a feed of offers into
campaigns on a synthetic, pre-funded "brokered" advertiser, each with its own
budget. A sample feed lives at
[`apps/server/data/affiliate-feed.sample.json`](../apps/server/data/affiliate-feed.sample.json).

```bash
npm run server                 # start the broker
npm run import-feed            # broker the sample feed into live inventory
```

## Advertiser console

API (auth via `x-api-key`):

| Endpoint | Purpose |
|----------|---------|
| `POST /v1/advertisers` | register, returns an API key (shown once) |
| `POST /v1/advertisers/fund` | add budget |
| `POST /v1/advertisers/campaigns` | launch a campaign |
| `GET  /v1/advertisers/campaigns` | list campaigns + per-campaign stats |
| `GET  /v1/advertisers/stats` | account-level spend + invalid-traffic rate |

CLI ([`codecash-advertiser`](../apps/cli/bin/codecash-advertiser.js)):

```bash
codecash-advertiser register --name "Acme" --email ads@acme.com
codecash-advertiser fund --usd 50
codecash-advertiser create --objective cpc --bid-usd 0.30 \
  --text "Acme: ship faster → acme.example" --tags rust,go --budget-usd 10
codecash-advertiser campaigns
codecash-advertiser stats
```

Web console: `GET /advertiser` (paste your API key) —
[`advertiser.html`](../apps/server/public/advertiser.html).
