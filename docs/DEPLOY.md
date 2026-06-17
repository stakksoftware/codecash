# CodeCash Deployment

CodeCash runs live on **Vercel** (API + dashboards) backed by **Supabase
Postgres** (state). The same router in [`apps/server/src/server.js`](../apps/server/src/server.js)
runs locally as a Node http server and on Vercel as a serverless function.

## Live URLs

| What | URL |
|------|-----|
| Earner transparency dashboard | https://codecash.sh/ |
| Advertiser console | https://codecash.sh/advertiser |
| Health | https://codecash.sh/healthz |
| Published receipt key | https://codecash.sh/.well-known/codecash-receipts.json |
| Signed campaign bundle | https://codecash.sh/v1/bundle |
| Source | https://github.com/stakksoftware/codecash |

The CLI / SDK point at it with `CODECASH_SERVER=https://codecash.sh`.

## Architecture

```
            GitHub (stakksoftware/codecash)
                      │  vercel deploy --prod
                      ▼
        Vercel serverless function  ──PostgREST(service_role)──▶  Supabase Postgres
        api/index.js → server.handle                              (project: codecash,
        + static dashboards (same origin)                          ap-southeast-2)
```

- **Storage** — [`store-pg.js`](../apps/server/src/store-pg.js) talks to Supabase
  over PostgREST using the service-role key (zero extra deps, serverless-safe).
  Tables have **RLS enabled with no policies**, so only the service role (the
  server) can touch them. Schema: migration `codecash_initial_schema`.
- **Backend selection** — [`db.js`](../apps/server/src/db.js) picks Postgres when
  `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are set, else the local file store.
- **Signing keys** — read from `CODECASH_*_KEY` env (stable across cold starts);
  the public receipt key matches [`docs/keys`](./keys), so receipts issued in
  production verify against the already-published key.
- **Routing** — [`vercel.json`](../vercel.json) rewrites all paths to the function;
  the function serves `/`, `/advertiser`, `/v1/*`, `/.well-known/*`, `/healthz`.

## Environment variables (Vercel → Production)

| Var | Source |
|-----|--------|
| `SUPABASE_URL` | Supabase project API URL |
| `SUPABASE_SERVICE_ROLE_KEY` | `supabase projects api-keys` (secret) |
| `CODECASH_RECEIPT_PRIVATE_KEY` / `_PUBLIC_KEY` | ed25519 receipt keypair |
| `CODECASH_BUNDLE_PRIVATE_KEY` / `_PUBLIC_KEY` | ed25519 bundle keypair |
| `CODECASH_ADMIN_TOKEN` | guards `/v1/admin/*` (feed import, identity verify) |

Set with the Vercel CLI:

```bash
printf '%s' "$VALUE" | vercel env add NAME production --scope stakk-software
```

## Redeploy

```bash
vercel deploy --prod --scope stakk-software        # from the repo root
```

Schema changes go through a Supabase migration (`apply_migration` / `supabase db
push`); they don't require a redeploy unless the store code changes.

## Seeding live inventory

```bash
CODECASH_SERVER=https://codecash.sh \
CODECASH_ADMIN_TOKEN=... \
node scripts/import-feed.mjs
```

## Notes

- **Stripe** payouts use the deterministic mock until `STRIPE_SECRET_KEY` is set
  in Vercel env (then the same code path calls Stripe Transfers).
- **Deployment Protection** is disabled on the project so the service is public;
  re-enable in Vercel project settings if you want it gated.
- Money is integer micro-USD throughout; Postgres columns are `bigint`.
