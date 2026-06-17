// Server key management. CodeCash signs two things:
//   - receipts (the published receipt key — users verify against its public half)
//   - campaign bundles (so clients trust the inventory they target against)
//
// Keys are generated once and persisted under apps/server/keys/. The PUBLIC
// halves are safe to publish and are also mirrored to docs/keys/ by
// scripts/genkeys.mjs for independent verification.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPair } from '@codecash/core';

const here = path.dirname(fileURLToPath(import.meta.url));
const KEYS_DIR = process.env.CODECASH_KEYS_DIR || path.join(here, '..', 'keys');

export const RECEIPT_KEY_ID = 'codecash-receipts-v1';
export const BUNDLE_KEY_ID = 'codecash-bundle-v1';

function loadOrCreate(name) {
  fs.mkdirSync(KEYS_DIR, { recursive: true });
  const file = path.join(KEYS_DIR, `${name}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    const kp = generateKeyPair();
    fs.writeFileSync(file, JSON.stringify(kp, null, 2), { mode: 0o600 });
    // Mirror the public half (only) so it can be published/audited.
    fs.writeFileSync(path.join(KEYS_DIR, `${name}.public`), kp.publicKey + '\n');
    return kp;
  }
}

let _receipt;
let _bundle;

export function receiptKeys() {
  if (!_receipt) _receipt = loadOrCreate('receipt-key');
  return _receipt;
}

export function bundleKeys() {
  if (!_bundle) _bundle = loadOrCreate('bundle-key');
  return _bundle;
}

export function publicKeyDoc() {
  return {
    receipt: { keyId: RECEIPT_KEY_ID, publicKey: receiptKeys().publicKey, alg: 'ed25519' },
    bundle: { keyId: BUNDLE_KEY_ID, publicKey: bundleKeys().publicKey, alg: 'ed25519' },
  };
}
