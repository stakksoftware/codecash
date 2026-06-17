#!/usr/bin/env node
// End-to-end CodeCash walkthrough. Starts the server as its OWN process (so it
// keeps serving while the demo blocks on each CLI call), then drives the REAL
// CLI as a subprocess through the whole Phase 0/1 flow:
//
//   login → install → sync → render → record verified events → flush →
//   ledger → verify signed receipts → payouts → (verify identity) → cash out
//
// Everything runs locally with no external services and no secrets. Set
// STRIPE_SECRET_KEY to exercise the live payout rail instead of the mock.

import { spawnSync, spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(root, 'apps/cli/bin/codecash.js');
const SERVER_ENTRY = path.join(root, 'apps/server/src/server.js');

// Isolated sandbox so the demo never touches your real ~/.codecash or keys.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'codecash-demo-'));
const HOME = path.join(sandbox, 'home');
const DATA = path.join(sandbox, 'server-data');
const KEYS = path.join(sandbox, 'server-keys');
fs.mkdirSync(HOME, { recursive: true });

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

const PORT = await freePort();
const SERVER = `http://127.0.0.1:${PORT}`;
const env = {
  ...process.env,
  CODECASH_HOME: HOME,
  CODECASH_SERVER: SERVER,
  CODECASH_DATA_DIR: DATA,
  CODECASH_KEYS_DIR: KEYS,
};

function cli(args, { quiet = false } = {}) {
  const r = spawnSync('node', [CLI, ...args], { env, encoding: 'utf8' });
  if (!quiet) {
    process.stdout.write(`\x1b[2m$ codecash ${args.join(' ')}\x1b[0m\n`);
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
  }
  return r;
}

function banner(t) {
  console.log(`\n\x1b[1m\x1b[32m▌ ${t}\x1b[0m`);
}

async function waitForServer(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${SERVER}/healthz`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('server did not become ready');
}

// Start the server as a separate process.
const server = spawn('node', [SERVER_ENTRY], {
  env: { ...env, PORT: String(PORT) },
  stdio: 'ignore',
});
await waitForServer();
console.log(`\x1b[2m(demo server on ${SERVER}, sandbox ${sandbox})\x1b[0m`);

try {
  banner('1. Log in — generates a device key, persistent silent auth (FR19)');
  cli(['login', '--email', 'dev@example.com']);

  banner('2. Install into Claude Code via its sanctioned statusLine setting (FR2)');
  cli(['install', '--settings', path.join(HOME, 'claude-settings.json')]);

  banner('3. Sync the signed campaign bundle (FR9 affiliate floor, FR16 on-device)');
  cli(['sync']);

  banner('4. Render the one tasteful sponsored wait-state line (FR1, FR3)');
  cli(['status']);

  banner('5. Record verified wait-state events (FR12 quality gating)');
  // A genuine, focused, active wait — credited.
  cli(['record', '--campaign', 'affiliate-cloud-credits', '--type', 'impression', '--visible-ms', '9000']);
  cli(['record', '--campaign', 'sponsor-devtool-ide', '--type', 'impression', '--visible-ms', '12000']);
  // An intentional click — weighted higher (FR14).
  cli(['record', '--campaign', 'affiliate-cloud-credits', '--type', 'engagement', '--visible-ms', '5000']);
  // A conversion — affiliate rev-share (FR14).
  cli(['record', '--campaign', 'affiliate-cloud-credits', '--type', 'conversion', '--visible-ms', '4000']);
  // A fraud attempt: no active agent => NOT credited (FR12).
  cli(['record', '--campaign', 'sponsor-devtool-ide', '--type', 'impression', '--agent-active', 'false', '--visible-ms', '9000']);

  banner('6. Flush — uploads ONE signed counter, receives signed receipts (FR6, FR18)');
  cli(['flush']);

  banner('7. Your auditable local ledger (FR5)');
  cli(['ledger']);

  banner('8. Independently verify every signed receipt against the published key (FR6)');
  cli(['verify']);

  banner('9. Payout status — fixed threshold, no throttling (FR8, FR22)');
  cli(['payouts']);

  banner('10. Try to cash out before identity is verified (FR15 blocks it)');
  cli(['cashout']);

  banner('11. Verify payment identity (KYC at cash-out, FR15), then cash out (FR23)');
  const verifyRes = spawnSync(
    'node',
    ['-e', `fetch('${SERVER}/v1/admin/verify-identity',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({accountId:'acct_'+Buffer.from('dev@example.com').toString('hex').slice(0,12)})}).then(r=>r.json()).then(j=>console.log('  identity:',JSON.stringify(j)))`],
    { env, encoding: 'utf8' },
  );
  process.stdout.write(verifyRes.stdout || '');
  // give the credited balance a top-up so it clears the $5 threshold for the demo
  for (let i = 0; i < 3; i++) {
    cli(['record', '--campaign', 'affiliate-cloud-credits', '--type', 'conversion', '--visible-ms', '5000'], { quiet: true });
  }
  cli(['flush'], { quiet: true });
  cli(['payouts']);
  cli(['cashout']);

  banner('12. Health snapshot');
  cli(['doctor']);

  console.log(`\n\x1b[1m\x1b[32m✓ End-to-end CodeCash flow complete.\x1b[0m`);
  console.log(`  Open the transparency dashboard at ${SERVER}/  (paste the access token from step 1's secrets).`);
} finally {
  server.kill('SIGTERM');
}
