// Fraud resistance (FR13, FR15). These checks run server-side on every counter
// before any money is credited. They make raw-impression saturation — the attack
// that was published against the incumbent within days — uneconomical:
//
//   - signature + device binding: a counter must be signed by the key the device
//     registered at login (handled in server.js).
//   - replay protection: each counter nonce is single-use per device.
//   - rate limiting: bounded counters per device per minute.
//   - velocity cap: bounded *credited* gross per account per day.
//   - anomaly detection: implausible per-counter volumes are clamped/flagged.
//   - quality gating: quality<=0 events (from session.js) pay nothing.

export const RATE_LIMIT_PER_MIN = 30; // counters/device/minute
export const MAX_EVENTS_PER_COUNTER = 500; // anomaly threshold
export const MAX_COUNT_PER_EVENT = 240; // ~one verified impression / 15s over 1h
export const DAILY_EARNINGS_CAP_MICROS = 20_000_000; // $20/day gross velocity cap

/**
 * Returns { ok, reason, flags } — server.js rejects when !ok, and applies any
 * clamps the checks request via `flags`.
 */
export function screenCounter({ deviceId, body, recentCount, nonceAlreadySeen }) {
  const flags = [];

  if (nonceAlreadySeen) {
    return { ok: false, reason: 'replayed counter nonce', flags };
  }
  if (recentCount > RATE_LIMIT_PER_MIN) {
    return { ok: false, reason: 'rate limit exceeded (counters/min)', flags };
  }
  const events = body.events || [];
  if (events.length > MAX_EVENTS_PER_COUNTER) {
    return { ok: false, reason: 'anomalous counter size', flags };
  }
  for (const e of events) {
    if ((e.count || 0) > MAX_COUNT_PER_EVENT) {
      flags.push(`clamped count for ${e.campaignId} (${e.count} -> ${MAX_COUNT_PER_EVENT})`);
      e.count = MAX_COUNT_PER_EVENT;
    }
    if (e.quality != null && (e.quality < 0 || e.quality > 1)) {
      flags.push(`clamped quality for ${e.campaignId}`);
      e.quality = Math.min(1, Math.max(0, e.quality));
    }
  }
  return { ok: true, flags };
}

/**
 * Velocity cap applied while crediting. Given how much an account has already
 * been credited (gross) today and a proposed additional gross, returns the
 * amount that may actually be credited now. This is a fraud control on EARNINGS,
 * not a threshold-proximity throttle — it is published, fixed, and applies
 * equally regardless of cash-out balance (consistent with FR8).
 */
export function applyDailyVelocityCap(creditedTodayMicros, proposedGrossMicros) {
  const remaining = Math.max(0, DAILY_EARNINGS_CAP_MICROS - creditedTodayMicros);
  const allowedGross = Math.min(proposedGrossMicros, remaining);
  return { allowedGross, capped: allowedGross < proposedGrossMicros, remaining };
}
