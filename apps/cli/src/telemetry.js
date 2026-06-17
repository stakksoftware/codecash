// Self-monitoring (FR21). CodeCash tracks its OWN failure rate. If it starts
// erroring often — e.g. a host update changed something underneath it — it
// auto-disables so it can never degrade or break the host tool. This is a
// circuit breaker, not analytics: it records only local counts, transmits
// nothing, and exists purely to make the client fail safe.

import fs from 'node:fs';
import { files, ensureHome } from './paths.js';

const WINDOW = 20; // consider the last N invocations
const TRIP_RATIO = 0.5; // auto-disable if >50% of recent invocations errored
const COOLDOWN_MS = 60 * 60 * 1000; // re-enable after an hour

function load() {
  try {
    return JSON.parse(fs.readFileSync(files.telemetry(), 'utf8'));
  } catch {
    return { recent: [], disabledUntil: null, totals: { ok: 0, err: 0 } };
  }
}

function save(t) {
  ensureHome();
  fs.writeFileSync(files.telemetry(), JSON.stringify(t), { mode: 0o600 });
}

export function record(ok, nowMs = Date.now()) {
  const t = load();
  t.recent.push({ ok: !!ok, at: nowMs });
  if (t.recent.length > WINDOW) t.recent = t.recent.slice(-WINDOW);
  t.totals = t.totals || { ok: 0, err: 0 };
  t.totals[ok ? 'ok' : 'err']++;

  const errs = t.recent.filter((r) => !r.ok).length;
  if (t.recent.length >= 5 && errs / t.recent.length > TRIP_RATIO) {
    t.disabledUntil = new Date(nowMs + COOLDOWN_MS).toISOString();
    t.recent = []; // reset the window after tripping
  }
  save(t);
  return t;
}

/** Should the client suppress itself right now because it has been failing? */
export function isCircuitOpen(nowMs = Date.now()) {
  const t = load();
  return !!(t.disabledUntil && Date.parse(t.disabledUntil) > nowMs);
}

export function status() {
  return load();
}

export function reset() {
  save({ recent: [], disabledUntil: null, totals: { ok: 0, err: 0 } });
}
