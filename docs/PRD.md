# CodeCash — Product Requirements Document

> **Working codename:** CodeCash (formerly *Slipstream*). The thesis: turn
> AI/agent wait-states into value for the user, without being parasitic, opaque,
> or fraud-prone — the three things that will sink the incumbent.

**Status:** Draft v0.1 · **Last updated:** June 17, 2026

---

## 1. Summary

Developers and AI users spend a growing share of their day staring at a spinner
while an agent thinks, a build runs, or a model streams. The incumbent
(Kickbacks.ai) proved people will install something to monetize that dead time.
It also exposed exactly where a competitor wins: **trust, demand, and
fraud-resistance.**

CodeCash is a wait-state monetization layer that pays out on *verifiable,
transparent* terms, runs *privacy-first* (no prompts/code leave the device), and
is *zero-maintenance* (no constant re-auth). It launches on developer agent CLIs
and expands to build/CI and long-running jobs.

## 2. Problem & opportunity

**User problem:** AI wait-states are frequent, attention-rich, and currently
unmonetized for the person waiting.

**Why the incumbent is beatable:**
- Earnings reportedly drop near the cash-out threshold → users suspect
  manipulation. **Trust is broken.**
- No real advertisers at launch; house inventory only → payouts trend toward
  zero. **Demand is unsolved.**
- Per-impression payout is structurally gameable; impression-saturation attacks
  were published within days. **Fraud is baked in.**
- Repeated re-auth / window reloads → churn. **Maintenance burden kills
  retention.**
- Relies on injecting into surfaces it doesn't own → fragile, ToS-risky.

**Opportunity:** Be the version that advertisers *and* users actually trust —
the only durable moat in an attention market.

## 3. Goals & non-goals

**Goals**
- **G1:** Pay users on terms they can independently audit (impressions, CPM,
  exact split).
- **G2:** Make payouts non-trivial on day one via seeded, dev-relevant demand.
- **G3:** Resist click/impression fraud well enough that advertisers pay real
  CPMs.
- **G4:** Keep all targeting/context on-device; never transmit prompts or code.
- **G5:** Zero ongoing babysitting — install once, works silently.

**Non-goals**
- Not building an ad network from scratch in v1 (broker existing demand first).
- Not injecting into closed apps that forbid modification (no ToS gambling).
- Not maximizing impressions per session — optimizing for advertiser-trusted
  *quality* impressions.

## 4. Target users

- **Primary:** Professional developers running agentic CLIs/IDEs (Claude Code,
  Codex, Cursor, Aider, Cline, Gemini CLI). High wait-state frequency, technical
  enough to trust an open ledger.
- **Secondary:** ML/data engineers with long training and pipeline jobs.
- **Demand side:** Devtool companies, cloud providers, course/cert sellers,
  dev-focused SaaS — advertisers who *want* developer attention and will pay for
  verified quality.

## 5. Differentiators (the wedge)

| Axis | Incumbent | CodeCash |
|------|-----------|----------|
| Earnings transparency | Opaque, suspected throttling | Public, auditable ledger; signed receipts |
| Payout basis | Raw impressions (gameable) | Quality/verified impressions → engagement/conversion tiers |
| Demand | House ads, none real | Seeded dev-relevant inventory + affiliate floor |
| Privacy | Local server, unclear data flow | On-device targeting; nothing sensitive leaves machine |
| Maintenance | Frequent re-auth/reloads | Persistent silent auth, self-healing |
| Surface strategy | Inject anywhere (fragile) | Owned/config-exposed surfaces first |

## 6. Functional requirements

### 6.1 Wait-state ad surface
- **FR1:** Render a single, subtle, tasteful sponsored status line during
  agent/build/job wait-states.
- **FR2:** Use only host-sanctioned config where it exists (e.g. the Claude Code
  `statusLine` setting); never patch internals of apps that forbid it.
- **FR3:** One sponsor line max; never stack or animate aggressively. Respect a
  global frequency cap.
- **FR4:** Honor an instant kill-switch and a "pause for this session" control.

### 6.2 Transparency & trust ledger (the moat — build first)
- **FR5:** Per-user dashboard showing every monetizable event: timestamp,
  advertiser, CPM, gross, net, platform cut.
- **FR6:** Cryptographically signed impression receipts the user can export and
  verify independently.
- **FR7:** Published, versioned payout formula. Any change is changelogged with
  an effective date.
- **FR8:** No threshold-proximity throttling, ever. Cash-out terms fixed and
  stated up front.

### 6.3 Demand & monetization
- **FR9:** Launch with a seeded inventory floor (affiliate offers for cloud
  credits, devtools, courses) so payout is never $0.
- **FR10:** Broker existing ad/affiliate demand before building a native auction.
- **FR11:** Support multiple revenue models behind one surface (see §8),
  selectable by advertiser campaign type.

### 6.4 Fraud resistance
- **FR12:** Pay on *verified* impressions only — require genuine active-session
  signals, not a tracker that fires on any render.
- **FR13:** Rate-limit and anomaly-detect per device/account; cap earnings
  velocity.
- **FR14:** Move payout weight toward engagement (intentional click) and
  conversion, which are far harder to fake.
- **FR15:** Sybil resistance on account creation and cash-out (verified payment
  identity at withdrawal).

### 6.5 Privacy architecture
- **FR16:** All contextual targeting runs locally; ad selection happens on-device
  from a synced campaign bundle.
- **FR17:** Never transmit prompts, code, file contents, or repo metadata.
  Document this in plain language.
- **FR18:** Send only minimal, aggregated, signed counters needed for billing.
  Open-source the client so it's auditable.

### 6.6 Reliability / zero-maintenance
- **FR19:** Persistent auth via OS keychain with silent refresh; no repeated
  sign-ins.
- **FR20:** Self-heal on host updates; degrade gracefully (no ads) rather than
  breaking the host.
- **FR21:** Telemetry on its own failure rate; auto-disable if it would interfere
  with the host tool.

### 6.7 Payouts
- **FR22:** Transparent cash-out threshold and schedule, stated before install.
- **FR23:** Stripe (or equivalent) payout rails live at or before public launch.

## 7. Surface roadmap

1. **Agent CLIs/IDEs** (launch): Claude Code, Codex, Cursor, Aider, Cline/Roo,
   Gemini CLI — wherever a sanctioned spinner/status config exists.
2. **Build/CI waits:** `npm install`, `cargo build`, Docker builds,
   `terraform apply`, test watch modes.
3. **Long jobs:** ML training loops, data pipelines (dbt/Airflow),
   renders/exports.
4. **LLM API latency SDK:** opt-in wrapper monetizing time-to-first-token in
   third-party apps that *choose* to integrate.

> **Sequencing rule:** prefer surfaces you own or that expose config. Anything
> requiring injection into an unconsenting host is deprioritized.

## 8. Monetization models (support more than one)

- **Verified impression / CPM** — baseline, quality-gated.
- **Single-sponsor "powered by"** — one tasteful sponsor per period; higher
  trust.
- **Affiliate / rev-share** — dev-relevant offers; aligns payout with real
  conversions.
- **Opt-in / pay-to-remove (Brave-style)** — user chooses to see ads and earn, or
  pays to remove.

## 9. Success metrics

- **Trust:** % of users who export/verify a receipt; payout-dispute rate; D30
  retention.
- **Demand:** filled-impression rate; effective per-user daily earnings;
  advertiser renewal rate.
- **Integrity:** estimated fraud rate; advertiser-reported invalid-traffic rate.
- **Reliability:** re-auth events per user per week (target ~0); host-breakage
  incidents (target 0).
- **Growth:** installs, WAU, surfaces-per-user.

## 10. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Host platforms disallow or block it | Stay on sanctioned config; partner where possible; never break the host |
| No advertiser demand | Seed affiliate floor; broker before building auction; sell *verified* attention |
| Fraud destroys advertiser trust | Quality-gated payouts, engagement/conversion weighting, Sybil resistance |
| "Spyware" perception | On-device targeting, open-source client, plain-language data promise |
| Race-to-bottom on payouts erodes trust | Fixed, published terms; no threshold throttling |
| Regulatory / disclosure | Clear "Sponsored" labeling; comply with ad-disclosure norms |

## 11. Open questions (and current answers)

- **Withdrawal identity verification — how strict?** → Verified at **cash-out**,
  not signup, so growth isn't taxed by signup friction (FR15).
- **Native auction vs. perpetual brokering?** → Broker first (FR10); revisit a
  native auction once filled-impression rate and advertiser demand justify it.
- **Revenue split — 50/50 or higher user share?** → Anchored at **70% user** as a
  marketing wedge; published and versioned in
  [PAYOUT_FORMULA.md](./PAYOUT_FORMULA.md).
- **Self-hostable client, and billing survival?** → The client is open source and
  the trust core is dependency-free; billing survives because counters are
  device-signed and receipts are server-signed regardless of where the client
  runs.

## 12. Phased plan

- **Phase 0 — Trust core:** ledger, signed receipts, published payout formula,
  on-device targeting. *Ship before scaling ads.* ✅ implemented.
- **Phase 1 — Launch surface:** one agent CLI, affiliate floor, Stripe payouts,
  zero-maintenance auth. ✅ implemented.
- **Phase 2 — Demand:** onboard 5–10 dev-relevant advertisers; engagement/
  conversion payout tiers. (Tiers implemented; advertiser onboarding is a
  business step.)
- **Phase 3 — Surface expansion:** build/CI + long-job waits; "powered by" and
  pay-to-remove modes.
- **Phase 4 — SDK:** opt-in latency-monetization SDK for third-party apps.

See [README.md](../README.md) for the FR-to-implementation traceability table.
