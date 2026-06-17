# CodeCash Latency SDK (Phase 4)

> `@codecash/sdk` — let a third-party app monetize **its own** wait-states
> (time-to-first-token, slow APIs, long computations) on the same trust-first,
> privacy-first terms as the CLI (surface roadmap #4).

This is **opt-in**: an app *chooses* to integrate. Nothing about the app's
prompts, responses, or data ever leaves it — only a signed, aggregated counter
(see [PRIVACY.md](./PRIVACY.md)).

## Install

```bash
npm install @codecash/sdk    # depends only on @codecash/core
```

## Quick start

```js
import { CodeCashSDK } from '@codecash/sdk';

// One-time: generate a device, log in, get a ready client.
const cc = await CodeCashSDK.login({
  serverUrl: 'https://api.codecash.example',
  email: 'my-app@example.com',
  surface: 'my-llm-app',
  onSponsor: (line) => ui.showStatusLine(line), // render it however you like
  autoFlush: true,
});
await cc.sync(); // fetch + verify the signed campaign bundle
```

### Monetize any awaited operation

```js
const answer = await cc.duringWait(() => llm.complete(prompt), { tags: ['rust'] });
// `answer` is exactly what llm.complete returned; errors propagate unchanged.
```

### Monetize time-to-first-token (streaming)

```js
for await (const token of cc.wrapStream(() => llm.stream(prompt), { tags })) {
  ui.append(token);
}
// One verified impression is credited for the latency before the first token.
```

### Earnings & receipts

```js
await cc.flush();              // submit a signed counter, collect signed receipts
cc.earningsUsd();             // "$0.0123" net this session
cc.receipts;                  // the signed receipts (verify them anywhere)
CodeCashSDK.verifyReceipt(cc.receipts[0], publishedKey); // independent verification
```

## What it does and doesn't do

- **Does:** select a sponsor on-device, show it via your `onSponsor` callback,
  assess the wait with genuine session signals (FR12), buffer a privacy-safe
  signed counter, and submit it for signed receipts.
- **Doesn't:** transmit prompts, responses, or app data; alter your operation's
  result or errors; block on the network in your hot path (flushing is async and
  failures degrade silently).

## Trust model

The SDK reuses [`@codecash/core`](../packages/core) for every trust-critical
operation — the same canonical signing, the same payout formula, the same
counter allowlist. An impression earns from impression-billable inventory
(CPM / sponsor / legacy); CPC/CPA campaigns aren't billed for impressions, which
is why a session's earnings reflect only genuine, billable attention.

See [`packages/sdk/example.mjs`](../packages/sdk/example.mjs) for a runnable
end-to-end example (`npm run server`, then
`node packages/sdk/example.mjs http://127.0.0.1:8787`).
