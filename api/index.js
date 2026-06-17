// Vercel serverless entry. The same router that runs as a local Node http
// server (apps/server/src/server.js) handles every request here. State lives in
// Supabase Postgres (selected by SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env);
// signing keys come from CODECASH_*_KEY env so they are stable across cold
// starts. See vercel.json for routing.

import { handle } from '../apps/server/src/server.js';

export default function (req, res) {
  return handle(req, res);
}

export const config = { maxDuration: 15 };
