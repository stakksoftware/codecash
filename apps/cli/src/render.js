// Renders THE one sponsored wait-state line (FR1, FR3) and nothing more.
//
// Rules enforced here:
//   FR1 — a single, subtle, tasteful line.
//   FR3 — exactly one sponsor; a global hourly frequency cap; no animation.
//   FR4 — returns empty when paused / killed / circuit-open.
//   §6  — clearly labeled "Sponsored" (regulatory disclosure, §10).
//   FR16/G4 — selection happens on-device from the cached bundle using locally
//             derived context that never leaves the machine.

import fs from 'node:fs';
import { files } from './paths.js';
import { loadConfig, isActive } from './config.js';
import * as telemetry from './telemetry.js';
import { selectCampaign, deriveLocalTags, verifyBundle } from '@codecash/core';

const FREQ_FILE = () => files.bundle().replace('bundle.json', 'frequency.json');

function loadFrequency(nowMs) {
  try {
    const f = JSON.parse(fs.readFileSync(FREQ_FILE(), 'utf8'));
    // keep only timestamps within the last hour
    const hourAgo = nowMs - 3600_000;
    f.shown = (f.shown || []).filter((ts) => ts > hourAgo);
    f.perCampaign = f.perCampaign || {};
    return f;
  } catch {
    return { shown: [], perCampaign: {} };
  }
}

function saveFrequency(f) {
  try {
    fs.writeFileSync(FREQ_FILE(), JSON.stringify(f), { mode: 0o600 });
  } catch {
    /* non-fatal */
  }
}

function loadCachedBundle() {
  try {
    return JSON.parse(fs.readFileSync(files.bundle(), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Decide what (if anything) to show right now. Pure-ish: takes the local context
 * and returns { line, campaign } or { line: '' }. Records a "shown" marker and
 * bumps the per-campaign daily frequency when a line is produced.
 *
 * @param {object} opts
 * @param {string} [opts.cwd]
 * @param {string[]} [opts.files] file names in cwd (for local tag derivation)
 * @param {string} [opts.receiptPublicKey] to verify the cached bundle signature
 * @param {number} [opts.nowMs]
 */
export function renderLine(opts = {}) {
  const nowMs = opts.nowMs ?? Date.now();
  const cfg = loadConfig();

  // FR4 + FR21: never render when paused/off or while the circuit breaker is open.
  if (!isActive(cfg, nowMs) || telemetry.isCircuitOpen(nowMs)) return { line: '' };

  // FR3: global hourly frequency cap.
  const freq = loadFrequency(nowMs);
  if (freq.shown.length >= (cfg.frequencyCapPerHour || 6)) return { line: '' };

  const cached = loadCachedBundle();
  if (!cached?.body) return { line: '' };

  // If we know the receipt/bundle key, verify the cached bundle before trusting
  // it. Unknown key (offline first run) -> still render, but never crash.
  if (opts.bundlePublicKey && !verifyBundle(cached, opts.bundlePublicKey)) {
    return { line: '' };
  }

  // On-device targeting (G4). Tags are derived locally and never transmitted.
  const tags = deriveLocalTags({ cwd: opts.cwd || process.cwd(), files: opts.files || [] });
  const dailyFreq = freq.perCampaign;
  const campaign = selectCampaign(cached.body, { tags, surface: cfg.surface, frequency: dailyFreq }, freq.shown.length + nowMs);
  if (!campaign) return { line: '' };

  // Record visibility (used for verified-impression assessment) + frequency.
  freq.shown.push(nowMs);
  freq.perCampaign[campaign.id] = (freq.perCampaign[campaign.id] || 0) + 1;
  freq.lastShown = { campaignId: campaign.id, at: nowMs };
  saveFrequency(freq);

  return { line: formatLine(campaign), campaign };
}

/** One tasteful, clearly-labeled line. No ANSI animation. */
export function formatLine(c) {
  // Example: "· Sponsored — Acme Cloud: $200 in credits for new devs · ⌘ codecash open"
  const label = c.model === 'sponsor' ? 'Sponsored by' : 'Sponsored';
  return `· ${label} ${c.advertiser}: ${c.text}`;
}

export function frequencyState(nowMs = Date.now()) {
  return loadFrequency(nowMs);
}
