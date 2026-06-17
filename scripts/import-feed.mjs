#!/usr/bin/env node
// Broker an affiliate feed into a running CodeCash server (FR10). Reads a feed
// JSON (default: the bundled sample) and POSTs its offers to /v1/admin/import-feed.
//
//   node scripts/import-feed.mjs [feed.json] [--server http://127.0.0.1:8787]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const serverFlag = args.indexOf('--server');
const server = serverFlag >= 0 ? args[serverFlag + 1] : process.env.CODECASH_SERVER || 'http://127.0.0.1:8787';
const feedPath = args.find((a) => !a.startsWith('--') && a !== server) || path.join(root, 'apps/server/data/affiliate-feed.sample.json');

const feed = JSON.parse(fs.readFileSync(feedPath, 'utf8'));
const offers = feed.offers || feed;

const res = await fetch(`${server}/v1/admin/import-feed`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ offers, adminToken: process.env.CODECASH_ADMIN_TOKEN }),
});
const json = await res.json();
if (!res.ok) {
  console.error('import failed:', json.error || res.status);
  process.exit(1);
}
console.log(`✓ Brokered ${json.imported} offer(s) from ${path.basename(feedPath)} into live inventory.`);
if (json.skipped?.length) console.log(`  skipped ${json.skipped.length}:`, JSON.stringify(json.skipped));
console.log(`  advertiser: ${json.advertiserId}`);
