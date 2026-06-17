#!/usr/bin/env node
// Generate (if missing) the server's receipt + bundle keypairs and PUBLISH the
// public halves to docs/keys/ so anyone can verify CodeCash receipts without
// trusting our infrastructure (FR6, FR7, FR18).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Load via the server's key module so generation logic lives in one place.
const keys = await import(path.join(root, 'apps/server/src/keys.js'));
const doc = keys.publicKeyDoc();

const docsKeys = path.join(root, 'docs', 'keys');
fs.mkdirSync(docsKeys, { recursive: true });

fs.writeFileSync(
  path.join(docsKeys, 'codecash-receipts.pub'),
  doc.receipt.publicKey + '\n',
);
fs.writeFileSync(
  path.join(docsKeys, 'codecash-bundle.pub'),
  doc.bundle.publicKey + '\n',
);
fs.writeFileSync(
  path.join(docsKeys, 'published-keys.json'),
  JSON.stringify(doc, null, 2) + '\n',
);

console.log('Published public keys to docs/keys/:');
console.log('  receipt:', doc.receipt.publicKey);
console.log('  bundle: ', doc.bundle.publicKey);
console.log('\nThese are the keys users verify signed receipts against. Private');
console.log('halves stay in apps/server/keys/ and are gitignored.');
