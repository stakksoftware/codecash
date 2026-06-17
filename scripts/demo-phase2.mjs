#!/usr/bin/env node
// End-to-end walkthrough of Phases 2–4:
//   Phase 2 (demand)   — broker an affiliate feed; an advertiser registers,
//                        funds a budget, and launches objective-based campaigns;
//                        a verified click bills the advertiser and credits the
//                        earner; stats show the invalid-traffic rate.
//   Phase 3 (surfaces) — `codecash wrap` monetizes a build/long-job wait, and
//                        "powered by" sponsor mode.
//   Phase 4 (SDK)      — a third-party app monetizes time-to-first-token.
//
// Server runs as its own process; CLIs are driven as subprocesses. All local.

import { spawnSync, spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(root, 'apps/cli/bin/codecash.js');
const ADV = path.join(root, 'apps/cli/bin/codecash-advertiser.js');
const SERVER_ENTRY = path.join(root, 'apps/server/src/server.js');
const IMPORT = path.join(root, 'scripts/import-feed.mjs');
const SDK_EXAMPLE = path.join(root, 'packages/sdk/example.mjs');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'codecash-p2-'));
const HOME = path.join(sandbox, 'home');
const DATA = path.join(sandbox, 'server-data');
const KEYS = path.join(sandbox, 'server-keys');
fs.mkdirSync(HOME, { recursive: true });

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
    srv.on('error', reject);
  });
}
const PORT = await freePort();
const SERVER = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, CODECASH_HOME: HOME, CODECASH_SERVER: SERVER, CODECASH_DATA_DIR: DATA, CODECASH_KEYS_DIR: KEYS };

function run(bin, args, { quiet = false, label } = {}) {
  const r = spawnSync('node', [bin, ...args], { env, encoding: 'utf8' });
  if (!quiet) {
    process.stdout.write(`\x1b[2m$ ${label || path.basename(bin)} ${args.join(' ')}\x1b[0m\n`);
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
  }
  return r;
}
const cli = (args, o) => run(CLI, args, { label: 'codecash', ...o });
const adv = (args, o) => run(ADV, args, { label: 'codecash-advertiser', ...o });
const banner = (t) => console.log(`\n\x1b[1m\x1b[35m▌ ${t}\x1b[0m`);

async function waitForServer(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${SERVER}/healthz`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('server not ready');
}

const server = spawn('node', [SERVER_ENTRY], { env: { ...env, PORT: String(PORT) }, stdio: 'ignore' });
await waitForServer();
console.log(`\x1b[2m(server ${SERVER}, sandbox ${sandbox})\x1b[0m`);

try {
  // ---------------- Phase 2: demand ----------------
  banner('PHASE 2 · Broker an existing affiliate feed into live inventory (FR10)');
  run(IMPORT, ['--server', SERVER]);

  banner('PHASE 2 · An advertiser registers, funds a budget, launches campaigns');
  adv(['register', '--name', 'Acme Dev Tools', '--email', 'ads@acme.example']);
  adv(['fund', '--usd', '25']);
  adv(['create', '--objective', 'cpc', '--bid-usd', '0.30', '--text', 'Acme: ship Rust faster → acme.example', '--url', 'https://acme.example?ref=codecash', '--tags', 'rust,go', '--budget-usd', '10']);
  const created = adv(['create', '--objective', 'cpa', '--bid-usd', '3.00', '--text', 'Acme Cloud: $300 free credits → acme.example/cloud', '--url', 'https://acme.example/cloud', '--budget-usd', '10'], { quiet: true });
  const cpcId = capture(adv(['campaigns'], { quiet: true }).stdout, /(camp_\w+)\s+\[active\]\s+CPC/);

  banner('PHASE 2 · An earner joins and syncs (sees seeded + brokered + advertiser inventory)');
  cli(['login', '--email', 'earner@example.com']);
  cli(['sync']);

  banner('PHASE 2 · A verified click on the advertiser campaign bills them & credits the earner');
  if (cpcId) {
    cli(['record', '--campaign', cpcId, '--type', 'engagement', '--visible-ms', '6000']);
    cli(['flush']);
  } else {
    console.log('  (could not parse CPC campaign id; skipping explicit click)');
  }

  banner('PHASE 2 · Advertiser stats — spend + verified vs invalid traffic');
  adv(['stats']);

  // ---------------- Phase 3: surfaces ----------------
  banner('PHASE 3 · Monetize a build / long-job wait with `codecash wrap` (FR Phase 3)');
  cli(['wrap', '--', 'sleep', '2']); // any real command; ~2s wait gets credited

  banner('PHASE 3 · "Powered by" single-sponsor mode (§8)');
  cli(['mode', 'sponsor']);
  cli(['status']);
  cli(['mode', 'earn'], { quiet: true });

  banner('PHASE 3 · The earner ledger now spans multiple surfaces');
  cli(['ledger']);

  // ---------------- Phase 4: SDK ----------------
  banner('PHASE 4 · A third-party app monetizes time-to-first-token via the SDK');
  run(SDK_EXAMPLE, [SERVER], { label: 'node packages/sdk/example.mjs' });

  console.log(`\n\x1b[1m\x1b[35m✓ Phases 2–4 complete.\x1b[0m`);
  console.log(`  Advertiser console: ${SERVER}/advertiser   Earner ledger: ${SERVER}/`);
} finally {
  server.kill('SIGTERM');
}

function capture(text, re) {
  const m = (text || '').match(re);
  return m ? m[1] : null;
}
