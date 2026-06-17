// The local, append-only ledger (FR5). Every monetizable event the client
// records is written here as one JSON line, alongside the signed receipt the
// server returned. The user owns this file; the `codecash ledger` and
// `codecash verify` commands read it. Nothing is ever rewritten or deleted by
// CodeCash — append-only is itself a transparency guarantee.

import fs from 'node:fs';
import path from 'node:path';
import { files, ensureHome } from './paths.js';
import { microsToUsd } from '@codecash/core';

export function append(entry) {
  ensureHome();
  fs.appendFileSync(files.ledger(), JSON.stringify(entry) + '\n', { mode: 0o600 });
  // Persist the signed receipt separately too, for easy export/verification.
  if (entry.receipt) {
    const dir = files.receipts();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const id = entry.receipt.body?.receiptId || entry.eventId;
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(entry.receipt, null, 2));
  }
  return entry;
}

export function readAll() {
  try {
    return fs
      .readFileSync(files.ledger(), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function summarize(entries = readAll()) {
  let grossMicros = 0;
  let netMicros = 0;
  let platformMicros = 0;
  const byType = {};
  for (const e of entries) {
    const a = e.amounts || {};
    grossMicros += a.grossMicros || 0;
    netMicros += a.netMicros || 0;
    platformMicros += a.platformCutMicros || 0;
    byType[e.type] = (byType[e.type] || 0) + 1;
  }
  return {
    count: entries.length,
    byType,
    grossMicros,
    netMicros,
    platformMicros,
    grossUsd: microsToUsd(grossMicros),
    netUsd: microsToUsd(netMicros),
    platformUsd: microsToUsd(platformMicros),
  };
}
