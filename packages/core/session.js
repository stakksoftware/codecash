// @codecash/core/session
//
// Verified-impression gating (FR12). An impression is only "quality" — and only
// pays — when genuine active-session signals are present. A tracker that fires
// on any render is exactly the gameable design CodeCash refuses to ship.
//
// `assessImpression` returns a quality multiplier in [0,1] that feeds straight
// into the payout formula. No signals → quality 0 → $0 (the event is still
// logged for transparency, it just earns nothing).

export const MIN_VISIBLE_MS = 1500; // a sponsor line shown for < 1.5s does not count
export const MAX_CREDITED_VISIBLE_MS = 15000; // cap so idle windows can't farm time

/**
 * @param {object} sig
 * @param {boolean} sig.windowFocused   host window/tty was focused during the wait
 * @param {boolean} sig.agentActive     a real agent/build/job was running (heartbeat)
 * @param {number}  sig.visibleMs        how long the sponsor line was actually on screen
 * @param {number}  [sig.lastAgentHeartbeatAgeMs] ms since last genuine agent activity
 * @returns {{ quality:number, verified:boolean, reasons:string[] }}
 */
export function assessImpression(sig = {}) {
  const reasons = [];
  let quality = 1;

  if (!sig.agentActive) {
    reasons.push('no active agent/build/job — not a genuine wait state');
    quality = 0;
  }
  if (!sig.windowFocused) {
    // A background window can still be a real wait, but it is worth less and is
    // a common fraud vector, so we damp rather than zero it.
    reasons.push('host window not focused');
    quality *= 0.25;
  }

  const visible = Number(sig.visibleMs) || 0;
  if (visible < MIN_VISIBLE_MS) {
    reasons.push(`shown for ${visible}ms (< ${MIN_VISIBLE_MS}ms minimum)`);
    quality = 0;
  } else {
    // Scale up to the cap, then flat. Longer genuine waits are worth marginally
    // more attention, but we refuse to reward parking a spinner forever.
    const credited = Math.min(visible, MAX_CREDITED_VISIBLE_MS);
    quality *= 0.5 + 0.5 * (credited / MAX_CREDITED_VISIBLE_MS);
  }

  const stale = Number(sig.lastAgentHeartbeatAgeMs);
  if (Number.isFinite(stale) && stale > 30000) {
    reasons.push('agent heartbeat is stale (> 30s)');
    quality = 0;
  }

  quality = Math.min(1, Math.max(0, quality));
  return { quality, verified: quality > 0, reasons };
}
