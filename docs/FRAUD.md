# CodeCash Fraud Resistance

> Advertisers pay real CPMs only when the traffic is real. Impression-saturation
> attacks were published against the incumbent within days of launch. CodeCash
> is built so those attacks don't pay. (G3, FR12–FR15)

## Layered defense

Every counter passes through these gates before a cent is credited. Code:
[`session.js`](../packages/core/session.js),
[`fraud.js`](../apps/server/src/fraud.js),
[`server.js`](../apps/server/src/server.js).

### 1. Verified impressions only (FR12)
Payout is gated by a **quality** multiplier in `[0,1]` computed from genuine
active-session signals — a real agent/build/job running, the window focused, and
real time-on-screen. A tracker that fires on any render earns **quality 0 = $0**.
This is the structural difference from "pay per raw impression."

### 2. Device-bound signatures
A counter must be signed by the Ed25519 device key registered at login. The
server rejects any counter whose signature doesn't verify against the stored
device public key. You can't submit counters for a device you don't hold.

### 3. Replay protection
Each counter carries a single-use `nonce`. Re-submitting the same counter is
rejected (`429`). Verified by *"replayed counter nonce is rejected"* in
[`server.test.js`](../apps/server/test/server.test.js).

### 4. Rate limiting (FR13)
Bounded counters per device per minute (`RATE_LIMIT_PER_MIN`). Bursts are
refused.

### 5. Anomaly clamping (FR13)
Implausible per-event counts are clamped to a sane ceiling
(`MAX_COUNT_PER_EVENT`) rather than trusted, and the clamp is reported back in
`flags`.

### 6. Daily earnings-velocity cap (FR13)
A fixed **$20/day gross** cap per account bounds how fast any single account can
earn — the same for everyone, independent of cash-out proximity (so it doesn't
violate FR8).

### 7. Server-authoritative pricing
The server credits using **its own** CPM and conversion values from the signed
campaign bundle, never the numbers a client claims. Lying about CPM does nothing.

### 8. Weight toward harder-to-fake events (FR14)
Engagement (×8) and conversion (×60 / 10% rev-share) dominate the payout mix.
Faking an intentional click or a real downstream conversion is far harder and
more detectable than faking a view, so the economics favor real attention.

### 9. Sybil resistance at cash-out (FR15)
Money only leaves the system to a **verified payment identity**. Spinning up
throwaway accounts is pointless because withdrawal requires KYC at the payout
step — verified at cash-out, not signup, so honest users face no signup friction
(answers PRD §11).

## What an attacker gains

- Spamming impressions → quality-gated to $0.
- Replaying counters → rejected.
- Inflating counts/CPM → clamped / ignored.
- Many fake accounts → can't withdraw without verified identity.
- Best case for a determined attacker → capped at $20/day gross on a single
  KYC-verified identity, with engagement/conversion (the bulk of value) requiring
  hard-to-fake actions.

This is the bar mainstream ad networks hold themselves to, and it's what lets
CodeCash sell *verified* attention rather than raw, gameable impressions.
