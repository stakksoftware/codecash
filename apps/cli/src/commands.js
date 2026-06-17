// CodeCash CLI commands. Each is small, prints human output, and — critically —
// the `status` path can never throw into the host tool.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig, patchConfig } from './config.js';
import { files, home } from './paths.js';
import {
  getDeviceKeyPair,
  getDeviceId,
  setAuthBundle,
  clearAuth,
  getAuthBundle,
  secretBackend,
} from './keychain.js';
import * as api from './api.js';
import * as render from './render.js';
import * as events from './events.js';
import * as ledger from './ledger.js';
import * as telemetry from './telemetry.js';
import { verifyReceipt, formatUsd, microsToUsd, PAYOUT_FORMULA_VERSION, DEFAULT_SPLIT } from '@codecash/core';

const out = (...a) => console.log(...a);
const err = (...a) => console.error(...a);

// ---------------------------------------------------------------------------

export async function login(args) {
  const email = args.email || args._[0];
  if (!email) return fail('usage: codecash login --email you@example.com');
  const cfg = loadConfig();
  const kp = getDeviceKeyPair();
  const deviceId = getDeviceId();
  let res;
  try {
    res = await api.login(cfg.serverUrl, { email, deviceId, devicePublicKey: kp.publicKey });
  } catch (e) {
    return fail(`login failed: ${e.message}\n(server: ${cfg.serverUrl})`);
  }
  setAuthBundle(res.auth);
  patchConfig({
    account: { accountId: res.account.accountId, email, verified: res.account.verified },
    receiptPublicKey: res.receiptPublicKey || cfg.receiptPublicKey,
    bundlePublicKey: res.bundlePublicKey || cfg.bundlePublicKey,
  });
  out(`✓ Logged in as ${email}`);
  out(`  device:   ${deviceId}  (key in ${secretBackend()})`);
  out(`  account:  ${res.account.accountId}${res.account.verified ? ' (payment-verified)' : ' (unverified — verify before cash-out)'}`);
  out(`  auth:     persistent; silent refresh enabled (no repeated sign-ins)`);
}

export async function logout() {
  clearAuth();
  patchConfig({ account: null });
  out('✓ Signed out (device key retained).');
}

export async function sync() {
  const cfg = loadConfig();
  const bundle = await api.fetchBundle(cfg.serverUrl);
  if (bundle) {
    fs.writeFileSync(files.bundle(), JSON.stringify(bundle), { mode: 0o600 });
    out(`✓ Synced campaign bundle v${bundle.body?.version} (${bundle.body?.campaigns?.length ?? 0} campaigns).`);
  } else {
    out('· No bundle synced (offline or server unavailable). CodeCash will stay silent until next sync.');
  }
  // also push any pending verified events
  const f = await events.flush();
  if (f.submitted) out(`✓ Flushed ${f.submitted} pending event group(s); received ${f.receipts.length} signed receipt(s).`);
  else if (f.error) out(`· Flush deferred: ${f.error}`);
}

// `status` is the statusLine command (FR1/FR2). It MUST be fast and never throw.
export async function status(args) {
  try {
    const r = render.renderLine({ cwd: process.cwd(), bundlePublicKey: loadConfig().bundlePublicKey });
    if (r.line) out(r.line);
    else if (args.json) out(JSON.stringify({ line: '' }));
  } catch {
    // FR20/FR21: degrade to silence; never break the host status line.
    telemetry.record(false);
  }
}

// Record a verified wait-state event (used by integrations & the demo).
export async function record(args) {
  const signals = {
    windowFocused: bool(args.focused, true),
    agentActive: bool(args['agent-active'], true),
    visibleMs: num(args['visible-ms'], 8000),
    lastAgentHeartbeatAgeMs: num(args['heartbeat-age'], 0),
  };
  const res = events.recordEvent({
    campaignId: args.campaign,
    advertiser: args.advertiser,
    type: args.type || 'impression',
    cpmMicros: num(args.cpm, 0),
    conversionValueMicros: args['conversion-value'] ? num(args['conversion-value'], 0) : undefined,
    signals,
  });
  if (res.queued) out(`✓ queued ${res.entry.type} for ${res.entry.campaignId} (quality ${res.entry.quality.toFixed(2)})`);
  else out(`· not credited: ${res.assessment.reasons.join('; ') || 'quality 0'}`);
}

export async function flush() {
  const f = await events.flush();
  if (f.error) return fail(`flush failed: ${f.error}`);
  out(`✓ submitted ${f.submitted} event group(s); ${f.receipts.length} signed receipt(s) added to ledger.`);
}

export async function ledgerCmd(args) {
  const entries = ledger.readAll();
  const s = ledger.summarize(entries);
  out('CodeCash local ledger');
  out('─────────────────────');
  out(`events: ${s.count}   ${Object.entries(s.byType).map(([k, v]) => `${k}:${v}`).join('  ')}`);
  out(`gross:  ${formatUsd(s.grossMicros)}   you (net): ${formatUsd(s.netMicros)}   platform: ${formatUsd(s.platformMicros)}`);
  out(`split:  you ${(DEFAULT_SPLIT.userShareBps / 100).toFixed(0)}% / platform ${(100 - DEFAULT_SPLIT.userShareBps / 100).toFixed(0)}%   formula v${PAYOUT_FORMULA_VERSION}`);
  if (args.json) return out(JSON.stringify({ summary: s, entries }, null, 2));
  const recent = entries.slice(-Math.max(1, num(args.limit, 10)));
  if (recent.length) {
    out('');
    out('  when                      advertiser            type        you        receipt');
    for (const e of recent) {
      const a = e.amounts || {};
      out(
        '  ' +
          pad(e.issuedAt || '', 25) +
          pad(e.advertiser || '', 22) +
          pad(e.type || '', 12) +
          pad(formatUsd(a.netMicros || 0), 11) +
          (e.receipt ? (e.receipt.body?.receiptId || 'yes') : '—'),
      );
    }
    out('');
    out(`Receipts saved in ${files.receipts()} — verify any of them with: codecash verify`);
  }
}

export async function verify(args) {
  const cfg = loadConfig();
  let key = args.key || cfg.receiptPublicKey;
  if (!key) {
    try {
      const wk = await api.fetchReceiptKey(cfg.serverUrl);
      key = wk.publicKey;
    } catch {
      /* ignore */
    }
  }
  if (!key) return fail('no receipt public key available (pass --key or run codecash sync)');

  const target = args._[0];
  let receiptFiles = [];
  if (target) {
    receiptFiles = [target];
  } else {
    try {
      receiptFiles = fs
        .readdirSync(files.receipts())
        .filter((f) => f.endsWith('.json'))
        .map((f) => path.join(files.receipts(), f));
    } catch {
      receiptFiles = [];
    }
  }
  if (receiptFiles.length === 0) return out('No receipts to verify yet.');

  let ok = 0;
  let bad = 0;
  for (const f of receiptFiles) {
    let receipt;
    try {
      receipt = JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch {
      bad++;
      out(`✗ ${path.basename(f)} — unreadable`);
      continue;
    }
    const r = verifyReceipt(receipt, key);
    if (r.ok) {
      ok++;
      out(`✓ ${path.basename(f)} — signature OK, math OK (${formatUsd(receipt.body.amounts.netMicros)} to you)`);
    } else {
      bad++;
      out(`✗ ${path.basename(f)} — ${r.reasons.join('; ')}`);
    }
  }
  out('');
  out(`Verified ${ok} receipt(s) against published key; ${bad} failed.`);
  out(`Key (independently checkable): ${key}`);
  if (bad > 0) process.exitCode = 1;
}

export async function payouts() {
  const cfg = loadConfig();
  let p;
  try {
    p = await api.getPayoutStatus(cfg.serverUrl);
  } catch (e) {
    return fail(`could not fetch payout status: ${e.message}`);
  }
  out('CodeCash payouts');
  out('────────────────');
  out(`balance (net to you): ${formatUsd(p.balanceMicros)}`);
  out(`cash-out threshold:   ${formatUsd(p.thresholdMicros)} (fixed, stated up front — never throttled)`);
  out(`payable now:          ${p.payable ? 'YES' : 'no'}${p.payable ? '' : ` (need ${formatUsd(Math.max(0, p.thresholdMicros - p.balanceMicros))} more)`}`);
  out(`payment identity:     ${p.identityVerified ? 'verified' : 'NOT verified — required before withdrawal (FR15)'}`);
  out(`schedule:             ${p.schedule}`);
  out(`rails:                ${p.rails}`);
}

export async function cashout() {
  const cfg = loadConfig();
  let res;
  try {
    res = await api.requestWithdrawal(cfg.serverUrl);
  } catch (e) {
    return fail(`withdrawal failed: ${e.message}`);
  }
  if (res.ok) out(`✓ Withdrawal initiated: ${formatUsd(res.amountMicros)} via ${res.rails} (ref ${res.transferId}).`);
  else fail(`withdrawal not available: ${res.reason}`);
}

export async function pause(args) {
  const minutes = num(args.minutes, 0);
  const until = minutes > 0 ? new Date(Date.now() + minutes * 60000).toISOString() : new Date(Date.now() + 12 * 3600_000).toISOString();
  patchConfig({ pausedUntil: until });
  out(`✓ Paused until ${until}. Resume any time with: codecash resume`);
}

export async function resume() {
  patchConfig({ pausedUntil: null });
  out('✓ Resumed.');
}

export async function off() {
  patchConfig({ enabled: false });
  out('✓ CodeCash kill-switch ON — no sponsored lines will render. Re-enable with: codecash on');
}

export async function on() {
  patchConfig({ enabled: true });
  out('✓ CodeCash enabled.');
}

export async function mode(args) {
  const m = args._[0];
  if (!['earn', 'off'].includes(m)) return fail('usage: codecash mode <earn|off>   (off = pay-to-remove / no ads, §8)');
  patchConfig({ mode: m });
  out(`✓ Mode set to "${m}".${m === 'off' ? ' No ads will show; you will not earn.' : ' You will see one tasteful sponsor line during waits and earn.'}`);
}

// FR2: integrate ONLY via Claude Code's sanctioned statusLine setting.
export async function install(args) {
  const settingsPath = args.settings || path.join(os.homedir(), '.claude', 'settings.json');
  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch {
    /* new file */
  }
  const command = args.command || 'codecash status';
  settings.statusLine = { type: 'command', command, padding: 0 };
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  out(`✓ Wired CodeCash into Claude Code's sanctioned statusLine setting:`);
  out(`    ${settingsPath}`);
  out(`    statusLine.command = "${command}"`);
  out('  This uses only host-exposed config — CodeCash never patches the host (FR2).');
}

export async function uninstall(args) {
  const settingsPath = args.settings || path.join(os.homedir(), '.claude', 'settings.json');
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (settings.statusLine?.command?.includes('codecash')) {
      delete settings.statusLine;
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      out('✓ Removed CodeCash from statusLine.');
    } else {
      out('· No CodeCash statusLine entry found.');
    }
  } catch {
    out('· No settings file found; nothing to remove.');
  }
}

export async function doctor() {
  const cfg = loadConfig();
  const auth = getAuthBundle();
  out('CodeCash doctor');
  out('───────────────');
  out(`home:            ${home()}`);
  out(`secret backend:  ${secretBackend()}`);
  out(`device id:       ${getDeviceId()}`);
  out(`account:         ${cfg.account ? cfg.account.email + (cfg.account.verified ? ' (verified)' : ' (unverified)') : 'not logged in'}`);
  out(`auth token:      ${auth ? 'present (expires ' + auth.expiresAt + ')' : 'none'}`);
  out(`server:          ${cfg.serverUrl}`);
  out(`enabled:         ${cfg.enabled}   mode: ${cfg.mode}   paused: ${cfg.pausedUntil || 'no'}`);
  out(`circuit breaker: ${telemetry.isCircuitOpen() ? 'OPEN (auto-disabled — self-healing)' : 'closed (healthy)'}`);
  const t = telemetry.status();
  out(`self-telemetry:  ok ${t.totals?.ok ?? 0} / err ${t.totals?.err ?? 0}`);
  out(`pending events:  ${events.pendingCount()}`);
  // probe server
  try {
    const wk = await api.fetchReceiptKey(cfg.serverUrl);
    out(`server reachable: yes (receipt key ${wk.keyId})`);
  } catch {
    out('server reachable: no (CodeCash will degrade to silence — FR20)');
  }
}

export function help() {
  out(`CodeCash — earn from the time you already spend waiting on agents & builds.

USAGE
  codecash <command> [options]

GETTING STARTED
  login --email <email>     Register this device; persistent silent auth (FR19)
  install                   Wire into Claude Code's sanctioned statusLine (FR2)
  sync                      Pull the signed campaign bundle; flush pending events
  status                    Print the one sponsored wait-state line (statusLine cmd)

EARNINGS & TRUST
  ledger [--limit N] [--json]   Your auditable local ledger (FR5)
  verify [file] [--key K]       Independently verify signed receipts (FR6)
  payouts                       Balance, fixed threshold, schedule (FR22)
  cashout                       Request a Stripe payout (FR23)

CONTROLS
  pause [--minutes N]       Pause (FR4). Default: 12h
  resume                    Resume
  off | on                  Master kill-switch (FR4)
  mode <earn|off>           Earn-with-ads or pay-to-remove (§8)

DIAGNOSTICS
  doctor                    Health, auth, circuit-breaker, server reachability
  record ...                (integration/test) record a verified event

Privacy: CodeCash never transmits prompts, code, file contents, or repo
metadata. Targeting is on-device. See docs/PRIVACY.md. Client is open source.`);
}

// ---------------------------------------------------------------------------

function fail(msg) {
  err(msg);
  process.exitCode = 1;
}

function num(v, dflt) {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

// CLI args arrive as strings; treat "false"/"0"/"no" (and real false) as false.
function bool(v, dflt) {
  if (v === undefined) return dflt;
  if (v === false || v === 'false' || v === '0' || v === 'no') return false;
  return true;
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s.slice(0, n - 1) + ' ' : s + ' '.repeat(n - s.length);
}
