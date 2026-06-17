// CodeCash advertiser console (Phase 2 — demand). A thin CLI over the demand
// API so advertisers can register, fund a budget, launch objective-based
// campaigns, and watch verified-traffic stats. Separate identity space from the
// earner CLI: advertisers authenticate with an x-api-key, stored locally.

import fs from 'node:fs';
import path from 'node:path';
import { home, ensureHome } from './paths.js';

const CFG = () => path.join(home(), 'advertiser.json');
const out = (...a) => console.log(...a);
const fail = (m) => { console.error(m); process.exitCode = 1; };
const usd = (m) => '$' + (m / 1e6).toFixed(2);
const toMicros = (usdVal) => Math.round(Number(usdVal) * 1e6);

function loadCfg() {
  try { return JSON.parse(fs.readFileSync(CFG(), 'utf8')); } catch { return {}; }
}
function saveCfg(c) {
  ensureHome();
  fs.writeFileSync(CFG(), JSON.stringify(c, null, 2), { mode: 0o600 });
}
function serverUrl(args) {
  return args.server || process.env.CODECASH_SERVER || loadCfg().serverUrl || 'http://127.0.0.1:8787';
}
async function http(method, url, { body, apiKey } = {}) {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', ...(apiKey ? { 'x-api-key': apiKey } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}${json.details ? ': ' + json.details.join('; ') : ''}`);
  return json;
}
function requireKey() {
  const c = loadCfg();
  if (!c.apiKey) throw new Error('not registered — run: codecash-advertiser register --name "X" --email you@co.com');
  return c.apiKey;
}

export async function register(args) {
  if (!args.name || !args.email) return fail('usage: register --name "Acme" --email ads@acme.com');
  const url = serverUrl(args);
  let r;
  try { r = await http('POST', `${url}/v1/advertisers`, { body: { name: args.name, email: args.email } }); }
  catch (e) { return fail(`register failed: ${e.message}`); }
  saveCfg({ apiKey: r.apiKey, advertiserId: r.advertiserId, serverUrl: url, name: args.name });
  out(`✓ Registered "${args.name}"`);
  out(`  advertiserId: ${r.advertiserId}`);
  out(`  api key:      ${r.apiKey}   (saved to ${CFG()})`);
  out(`  console:      ${url}/advertiser?key=${r.apiKey}`);
}

export async function fund(args) {
  const amount = args['usd'];
  if (!amount) return fail('usage: fund --usd 50');
  try {
    const r = await http('POST', `${serverUrl(args)}/v1/advertisers/fund`, { apiKey: requireKey(), body: { amountMicros: toMicros(amount) } });
    out(`✓ Funded. Balance: ${usd(r.balanceMicros)}`);
  } catch (e) { fail(`fund failed: ${e.message}`); }
}

export async function create(args) {
  const objective = args.objective || 'cpm';
  const bidUsd = args['bid-usd'];
  if (!args.text) return fail('usage: create --advertiser "X" --objective <cpm|cpc|cpa> --bid-usd 0.25 --text "..." [--url ...] [--tags a,b] [--budget-usd 10]');
  const campaign = {
    advertiser: args.advertiser || loadCfg().name,
    model: args.model || (objective === 'cpa' ? 'affiliate' : 'sponsor'),
    objective,
    bidMicros: bidUsd ? toMicros(bidUsd) : undefined,
    text: args.text,
    url: args.url,
    tags: args.tags ? String(args.tags).split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    budgetMicros: args['budget-usd'] ? toMicros(args['budget-usd']) : 0,
  };
  try {
    const r = await http('POST', `${serverUrl(args)}/v1/advertisers/campaigns`, { apiKey: requireKey(), body: campaign });
    out(`✓ Campaign ${r.campaign.id} created — ${r.pricing}`);
    out(`  budget: ${usd(r.campaign.budgetMicros)}   status: ${r.campaign.status}`);
  } catch (e) { fail(`create failed: ${e.message}`); }
}

export async function campaigns(args) {
  try {
    const r = await http('GET', `${serverUrl(args)}/v1/advertisers/campaigns`, { apiKey: requireKey() });
    if (!r.campaigns.length) return out('No campaigns yet.');
    out('Campaigns');
    out('─────────');
    for (const c of r.campaigns) {
      const s = c.stats;
      out(`  ${c.id}  [${c.status}]  ${c.pricing}`);
      out(`    "${c.text}"`);
      out(`    spent ${usd(s.spentMicros)} / budget left ${usd(c.remainingBudgetMicros)}   impr ${s.impressions}  clicks ${s.engagements}  conv ${s.conversions}  invalid ${(s.invalidTrafficRate * 100).toFixed(1)}%`);
    }
  } catch (e) { fail(`list failed: ${e.message}`); }
}

export async function stats(args) {
  try {
    const s = await http('GET', `${serverUrl(args)}/v1/advertisers/stats`, { apiKey: requireKey() });
    out('Advertiser stats');
    out('────────────────');
    out(`  ${s.name}  (${s.advertiserId})`);
    out(`  balance:        ${usd(s.balanceMicros)}`);
    out(`  spent:          ${usd(s.spentMicros)}`);
    out(`  campaigns:      ${s.campaigns}`);
    out(`  impr/clicks/conv: ${s.impressions}/${s.engagements}/${s.conversions}`);
    out(`  invalid traffic:  ${(s.invalidTrafficRate * 100).toFixed(1)}%  (quality-gated, never billed)`);
  } catch (e) { fail(`stats failed: ${e.message}`); }
}

export function help() {
  out(`CodeCash Advertiser Console — buy verified developer attention.

USAGE
  codecash-advertiser <command> [options]

  register --name "Acme" --email ads@acme.com   Register; saves your API key
  fund --usd 50                                 Add budget
  create --objective <cpm|cpc|cpa> --bid-usd N --text "..." [--url U] [--tags a,b] [--budget-usd N]
  campaigns                                     List campaigns + verified-traffic stats
  stats                                         Account-level stats (incl. invalid-traffic rate)

Pricing tiers: cpm = per 1,000 verified impressions · cpc = per intentional click
· cpa = per confirmed conversion. CodeCash bills only verified, quality-gated traffic.`);
}
