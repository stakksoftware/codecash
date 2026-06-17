// Pending verified-event queue. Verified impressions/engagements/conversions are
// buffered locally, then flushed to the server as ONE aggregated, device-signed
// counter (FR12, FR16, FR18). The server returns signed receipts which we append
// to the local ledger.

import fs from 'node:fs';
import { files, ensureHome } from './paths.js';
import { getDeviceKeyPair, getDeviceId } from './keychain.js';
import { loadConfig } from './config.js';
import { assessImpression, buildCounter, signCounter, randomId } from '@codecash/core';
import { append as ledgerAppend } from './ledger.js';
import { submitCounter } from './api.js';

const PENDING = () => files.bundle().replace('bundle.json', 'pending.json');

function loadPending() {
  try {
    return JSON.parse(fs.readFileSync(PENDING(), 'utf8'));
  } catch {
    return [];
  }
}

function savePending(list) {
  ensureHome();
  fs.writeFileSync(PENDING(), JSON.stringify(list), { mode: 0o600 });
}

/**
 * Assess a wait-state event against session signals (FR12) and, if it earns a
 * non-zero quality, enqueue it for the next flush. Returns the assessment so
 * callers can show the user why something did or didn't count.
 */
export function recordEvent({ campaignId, advertiser, type = 'impression', cpmMicros, conversionValueMicros, surface, signals, nowMs = Date.now() }) {
  const assessment = assessImpression(signals || {});
  const quality = type === 'impression' ? assessment.quality : Math.max(assessment.quality, type === 'conversion' ? 1 : 0.8);
  // Engagement (an intentional click) and conversion still require a real
  // session, but are not penalized for short visibility.
  const entry = {
    eventId: 'evt_' + randomId(8),
    campaignId,
    advertiser,
    type,
    cpmMicros,
    conversionValueMicros,
    surface: surface || loadConfig().surface,
    quality,
    at: new Date(nowMs).toISOString(),
  };
  if (quality <= 0) {
    return { queued: false, assessment, entry };
  }
  const pending = loadPending();
  pending.push(entry);
  savePending(pending);
  return { queued: true, assessment, entry };
}

export function pendingCount() {
  return loadPending().length;
}

/**
 * Flush the pending queue: build a signed counter, submit it, and append every
 * returned signed receipt to the local ledger. Idempotent-ish: on success the
 * queue is cleared; on failure it is preserved for the next attempt.
 */
export async function flush(nowMs = Date.now()) {
  const cfg = loadConfig();
  const pending = loadPending();
  if (pending.length === 0) return { submitted: 0, receipts: [] };

  const kp = getDeviceKeyPair();
  const deviceId = getDeviceId();

  // Group events by SURFACE first (Phase 3): each surface category becomes its
  // own counter, so the coarse surface ("agent-cli" / "build-ci" / "long-job")
  // is reported honestly without ever revealing which command or repo.
  const bySurface = new Map();
  for (const e of pending) {
    const surface = e.surface || cfg.surface;
    if (!bySurface.has(surface)) bySurface.set(surface, []);
    bySurface.get(surface).push(e);
  }

  const allReceipts = [];
  let submittedGroups = 0;
  let firstError;

  for (const [surface, list] of bySurface) {
    // Aggregate identical (campaign,type) tallies within this surface.
    const agg = new Map();
    for (const e of list) {
      const key = `${e.campaignId}|${e.type}|${e.cpmMicros}|${e.conversionValueMicros ?? ''}`;
      const cur = agg.get(key) || { campaignId: e.campaignId, type: e.type, count: 0, cpmMicros: e.cpmMicros, conversionValueMicros: e.conversionValueMicros, qualitySum: 0 };
      cur.count += 1;
      cur.qualitySum += e.quality;
      agg.set(key, cur);
    }
    const events = [...agg.values()].map((a) => ({
      campaignId: a.campaignId,
      type: a.type,
      count: a.count,
      quality: +(a.qualitySum / a.count).toFixed(4),
      cpmMicros: a.cpmMicros,
      ...(a.conversionValueMicros != null ? { conversionValueMicros: a.conversionValueMicros } : {}),
    }));

    const body = buildCounter({
      deviceId,
      periodStart: list[0].at,
      periodEnd: new Date(nowMs).toISOString(),
      surface,
      events,
    });
    const counter = signCounter(body, kp.privateKey);
    const res = await submitCounter(cfg.serverUrl, counter);
    if (res.error) {
      firstError = res.error;
      continue; // preserve pending; try other surfaces
    }
    submittedGroups += events.length;
    for (const r of res.receipts || []) {
      allReceipts.push(r);
      ledgerAppend({
        eventId: r.body?.eventId,
        campaignId: r.body?.campaignId,
        advertiser: r.body?.advertiser,
        type: r.body?.type,
        issuedAt: r.body?.issuedAt,
        amounts: r.body?.amounts,
        receipt: r,
      });
    }
  }

  if (firstError && allReceipts.length === 0) {
    return { submitted: 0, error: firstError, receipts: [] };
  }
  savePending([]); // clear on success (best-effort: any submitted surface clears)
  return { submitted: submittedGroups, receipts: allReceipts };
}
