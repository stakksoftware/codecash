#!/usr/bin/env node
// Example: an app that calls a slow "LLM" monetizes its own time-to-first-token
// with a few lines of CodeCash SDK. Run a CodeCash server first:
//
//   npm run server            # in one shell
//   node packages/sdk/example.mjs http://127.0.0.1:8787
//
// Nothing about the prompt, response, or app data is ever transmitted — only a
// signed, aggregated counter (see docs/PRIVACY.md).

import { CodeCashSDK } from './index.js';

const serverUrl = process.argv[2] || process.env.CODECASH_SERVER || 'http://127.0.0.1:8787';

const cc = await CodeCashSDK.login({
  serverUrl,
  email: 'example-app@codecash.example',
  surface: 'example-llm-app',
  onSponsor: (line) => console.log(`\x1b[2m  ${line}\x1b[0m`),
  autoFlush: true,
});
await cc.sync();

// A fake streaming LLM with a ~1.6s time-to-first-token, then a few tokens.
function fakeLLMStream(reply) {
  return (async function* () {
    await new Promise((r) => setTimeout(r, 1600)); // the latency we monetize
    for (const tok of reply.split(' ')) {
      await new Promise((r) => setTimeout(r, 40));
      yield tok + ' ';
    }
  })();
}

// Simulate a short chat session: each prompt monetizes its time-to-first-token.
const prompts = [
  ['How do I borrow-check this?', 'Use a reference, not a move.', ['rust']],
  ['Write a Dockerfile', 'FROM node:22-alpine ...', ['docker']],
  ['Explain async/await', 'It suspends until the promise settles.', ['javascript']],
  ['Optimize this query', 'Add an index on the join key.', ['python']],
];

for (const [q, reply, tags] of prompts) {
  console.log(`\nUser: ${q}`);
  process.stdout.write('Model: ');
  let answer = '';
  for await (const tok of cc.wrapStream(() => fakeLLMStream(reply), { tags })) {
    process.stdout.write(tok);
    answer += tok;
  }
  process.stdout.write('\n');
}

console.log(`\nAcross ${prompts.length} prompts this app earned ${cc.earningsUsd()} (net) on ${cc.receipts.length} signed receipt(s) —`);
console.log('all from time-to-first-token, with no prompt or response data leaving the app.');
