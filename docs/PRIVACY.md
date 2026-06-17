# CodeCash Privacy Promise

> Plain language, because trust is the whole product (FR17).

## The one-sentence version

**CodeCash never sees your prompts, your code, your files, your file paths, or
which repository you're in — targeting happens entirely on your machine, and the
only thing we ever receive is a small, signed tally of how many ads were shown.**

## What stays on your device, always

- Your prompts and agent conversations.
- Your code, file contents, and diffs.
- File names, directory names, repository names, and remotes.
- The local signals used to pick an ad (e.g. "this project looks like Rust").
  These are derived locally by [`targeting.js`](../packages/core/targeting.js)
  and consumed locally. They never leave.

Ad selection runs **on-device** from a campaign bundle we sync to you (FR16). We
send you the whole inventory; your machine chooses. We don't know which ad you
saw or why you were eligible for it.

## What we receive (and nothing else)

The complete, exhaustive list of what a CodeCash client transmits is enforced in
code by an allowlist in [`counter.js`](../packages/core/counter.js). If anyone
ever tries to add a field outside this list, the client throws and our test
suite fails. Privacy here is a **test, not a promise**:

```
schema       — a constant string
deviceId     — a pseudonymous, rotating device id (NOT your identity)
periodStart  — when the aggregation window started
periodEnd    — when it ended
surface      — a category like "agent-cli" (NOT which app project or repo)
events[]     — per campaign: { campaignId, type, count, quality, cpmMicros }
nonce        — a random anti-replay value
```

That's it. Aggregated counts, signed by your device key. No free-text field
exists for context to hide in.

## Why you can believe this

- **The client is open source (MIT).** Read every byte that runs on your
  machine. See [`packages/core`](../packages/core) and
  [`apps/cli`](../apps/cli).
- **The privacy boundary is a unit test.**
  [`counter.test.js`](../packages/core/test/counter.test.js) asserts that
  attempts to attach a prompt, a code snippet, or a repo path are rejected.
- **Signed, minimal counters.** What we receive is signed by your device key and
  contains only the fields above (FR18).

## Identity

- A `deviceId` is derived from a device key generated on first run and stored in
  your OS keychain (or a `0600` file). It is pseudonymous.
- Your email/account exists only to pay you. Payment-identity verification
  happens at **cash-out** (FR15), so you can install and earn without handing
  over identity up front.

## Controls

- `codecash pause` / `codecash resume` — temporarily stop.
- `codecash off` / `codecash on` — master kill-switch.
- `codecash mode off` — pay-to-remove / no-ads mode (you see nothing, earn
  nothing).
- Delete `~/.codecash/` to wipe all local state.

## Disclosure

Every sponsored line is clearly labeled **"Sponsored"** (or "Sponsored by …"),
in line with advertising-disclosure norms (PRD §10).
