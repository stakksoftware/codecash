// Filesystem layout for the CLI. Everything CodeCash stores locally lives under
// a single root so it is trivial to inspect or delete. Honors CODECASH_HOME for
// tests and power users.

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

export function home() {
  return process.env.CODECASH_HOME || path.join(os.homedir(), '.codecash');
}

export function ensureHome() {
  const dir = home();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export const files = {
  config: () => path.join(home(), 'config.json'),
  ledger: () => path.join(home(), 'ledger.jsonl'),
  bundle: () => path.join(home(), 'bundle.json'),
  secrets: () => path.join(home(), 'secrets.json'),
  telemetry: () => path.join(home(), 'telemetry.json'),
  receipts: () => path.join(home(), 'receipts'),
};
