// Local CLI configuration & controls (FR4 kill-switch / pause, §8 opt-in modes).
// Plain JSON the user can read and edit. Nothing here is secret.

import fs from 'node:fs';
import { files, ensureHome } from './paths.js';

const DEFAULTS = {
  enabled: true, // master kill-switch (FR4). `codecash off` sets false.
  pausedUntil: null, // ISO string; `codecash pause` sets a session/temporary pause.
  // §8 monetization modes:
  //   'earn'    — rotating, targeted inventory; you earn on every model (default)
  //   'sponsor' — one tasteful "powered by" sponsor per period (podcast-style)
  //   'off'     — pay-to-remove: no ads, no earnings
  mode: 'earn',
  serverUrl: process.env.CODECASH_SERVER || 'http://127.0.0.1:8787',
  surface: 'agent-cli',
  frequencyCapPerHour: 6, // FR3 global frequency cap
  userShareBps: 7000, // mirrors the published split; informational
  account: null, // { accountId, email, verified } once logged in
};

export function loadConfig() {
  ensureHome();
  try {
    const raw = fs.readFileSync(files.config(), 'utf8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(cfg) {
  ensureHome();
  fs.writeFileSync(files.config(), JSON.stringify(cfg, null, 2), { mode: 0o600 });
  return cfg;
}

export function patchConfig(patch) {
  return saveConfig({ ...loadConfig(), ...patch });
}

/** Is CodeCash currently allowed to show a sponsored line? (FR4) */
export function isActive(cfg = loadConfig(), nowMs = Date.now()) {
  if (!cfg.enabled) return false;
  // 'earn' and 'sponsor' both render; only 'off' (pay-to-remove) is silent.
  if (cfg.mode === 'off') return false;
  if (cfg.pausedUntil && Date.parse(cfg.pausedUntil) > nowMs) return false;
  return true;
}
