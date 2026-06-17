#!/usr/bin/env node
// CodeCash advertiser console entrypoint (Phase 2 — demand side).

import * as adv from '../src/advertiser.js';

const MAP = {
  register: adv.register,
  fund: adv.fund,
  create: adv.create,
  campaigns: adv.campaigns,
  stats: adv.stats,
  help: async () => adv.help(),
};

function parse(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[key] = true;
      else { args[key] = next; i++; }
    } else args._.push(a);
  }
  return args;
}

async function main() {
  const [, , name, ...rest] = process.argv;
  const handler = MAP[name] || (name ? null : MAP.help);
  if (!handler) {
    console.error(`unknown command: ${name}\n`);
    adv.help();
    process.exitCode = 1;
    return;
  }
  await handler(parse(rest));
}

main().catch((e) => {
  console.error(e?.message || String(e));
  process.exitCode = 1;
});
