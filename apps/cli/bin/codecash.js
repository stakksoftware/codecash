#!/usr/bin/env node
// CodeCash CLI entrypoint. Tiny arg parser + command dispatch. The `status`
// command is the hot path (runs on every host status-line tick), so dispatch is
// kept allocation-light and always resolves to exit code 0 unless a command
// explicitly sets otherwise.

import * as cmd from '../src/commands.js';

const MAP = {
  login: cmd.login,
  logout: cmd.logout,
  sync: cmd.sync,
  status: cmd.status,
  record: cmd.record,
  flush: cmd.flush,
  ledger: cmd.ledgerCmd,
  verify: cmd.verify,
  payouts: cmd.payouts,
  cashout: cmd.cashout,
  pause: cmd.pause,
  resume: cmd.resume,
  off: cmd.off,
  on: cmd.on,
  mode: cmd.mode,
  install: cmd.install,
  uninstall: cmd.uninstall,
  doctor: cmd.doctor,
  help: async () => cmd.help(),
};

function parse(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

async function main() {
  const [, , name, ...rest] = process.argv;
  const handler = MAP[name] || (name ? null : MAP.help);
  if (!handler) {
    console.error(`unknown command: ${name}\n`);
    cmd.help();
    process.exitCode = 1;
    return;
  }
  await handler(parse(rest));
}

main().catch((e) => {
  // Last-resort guard: never crash the host's status line.
  console.error(e?.message || String(e));
  process.exitCode = 1;
});
