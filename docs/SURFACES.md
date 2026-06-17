# CodeCash Surfaces (Phase 3)

> Beyond the agent status line: monetize build/CI and long-job waits, and choose
> how ads show up (§7 surface roadmap, §8 monetization models).

## `codecash wrap` — build/CI & long-job waits

Wrap any long-running command. CodeCash shows **one** sponsor line while it runs
and records a verified impression based on the **real** runtime (FR12) — then
exits with the wrapped command's exit code, untouched.

```bash
codecash wrap -- npm install
codecash wrap -- cargo build --release
codecash wrap -- docker build -t app .
codecash wrap -- terraform apply
codecash wrap -- pytest -q
```

Guarantees:
- The wrapped command's stdout/stderr/exit code are never altered.
- A command shorter than the minimum visible time is **not** credited — a 200ms
  command isn't a meaningful wait (FR12).
- If anything CodeCash-related fails, the command still runs (degrade, never
  break — FR20).

### Surface detection (on-device)

[`surfaces.js`](../apps/cli/src/surfaces.js) maps the command to a coarse surface
category and local context tags. Only the **category** (`build-ci` / `long-job`)
is ever transmitted — never the command, its arguments, or any path (FR17). On
flush, events are grouped per surface so each surface is reported honestly in its
own signed counter.

| Command pattern | Surface | Tags |
|-----------------|---------|------|
| `npm/pnpm/yarn install`, `cargo build`, `go test`, `pytest`, `docker build`, `make` | `build-ci` | language/tool |
| `terraform apply`, `kubectl`, `helm`, `dbt`, `airflow`, training loops | `long-job` | tool/`ml` |
| anything else long-running | `long-job` | — |

## Monetization modes (§8)

Set with `codecash mode <earn|sponsor|off>`:

- **`earn`** (default) — rotating, on-device-targeted inventory; you earn on
  every model (impression / sponsor / affiliate / conversion).
- **`sponsor`** — *"powered by"*: one tasteful, **pinned** sponsor per period
  (podcast-style). Calmer and higher-trust; you still earn. Implemented as a
  stable daily pick among `sponsor`-model campaigns
  ([`render.js`](../apps/cli/src/render.js)).
- **`off`** — *pay-to-remove* (Brave-style): no ads, no earnings. The kill-switch
  (`codecash off`) and per-session `codecash pause` remain available on top
  (FR4).

## How the surfaces share one pipeline

`wrap` (and the SDK) reuse the exact same record → flush → signed-counter →
signed-receipt path as the agent status line. Adding a surface is mostly a matter
of detecting the wait and supplying honest session signals; the trust core does
the rest. That's why Phase 3 and Phase 4 required **no** changes to the payout
formula or receipt format.
