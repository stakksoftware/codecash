// @codecash/core/targeting
//
// On-device ad selection (FR16, G4). Given a synced bundle and a LOCAL context
// object, pick at most one campaign. The context (host surface, language tags
// derived locally from the working directory, etc.) is consumed here and never
// leaves the machine. This function is pure and deterministic given its `seed`,
// which makes selection auditable and testable.

/**
 * @param {object} bundleBody  the `.body` of a verified bundle
 * @param {object} ctx
 * @param {string[]} [ctx.tags]      locally-derived contextual tags (never sent)
 * @param {string}   [ctx.surface]   host surface category, e.g. "agent-cli"
 * @param {object}   [ctx.frequency] map of campaignId -> impressions already shown today
 * @param {number}   [seed]          deterministic tiebreak seed (e.g. a counter)
 * @returns {Campaign|null}
 */
export function selectCampaign(bundleBody, ctx = {}, seed = 0) {
  const campaigns = (bundleBody?.campaigns || []).filter((c) => isEligible(c, ctx));
  if (campaigns.length === 0) return null;

  // Score = base weight * (1 + tag overlap). Higher contextual relevance wins,
  // but everything is computed locally from `ctx`.
  const ctxTags = new Set((ctx.tags || []).map((t) => String(t).toLowerCase()));
  const scored = campaigns.map((c, i) => {
    const overlap = (c.tags || []).reduce(
      (n, t) => n + (ctxTags.has(String(t).toLowerCase()) ? 1 : 0),
      0,
    );
    const weight = Math.max(0, c.weight ?? 1);
    return { c, i, score: weight * (1 + overlap) };
  });

  const total = scored.reduce((s, x) => s + x.score, 0);
  if (total <= 0) return scored[0].c;

  // Deterministic weighted pick using the integer `seed` (no Math.random — the
  // caller supplies entropy so tests are reproducible and selection auditable).
  let pointer = (Math.abs(hashSeed(seed)) % 1_000_000) / 1_000_000 * total;
  for (const x of scored) {
    pointer -= x.score;
    if (pointer <= 0) return x.c;
  }
  return scored[scored.length - 1].c;
}

function isEligible(c, ctx) {
  if (!c || !c.id) return false;
  // Daily frequency cap (FR3 honored at selection time).
  const shown = ctx.frequency?.[c.id] ?? 0;
  if (c.dailyCapImpressions && shown >= c.dailyCapImpressions) return false;
  // A campaign with required tags is only eligible if at least one matches.
  if (c.requireTags && c.requireTags.length) {
    const ctxTags = new Set((ctx.tags || []).map((t) => String(t).toLowerCase()));
    if (!c.requireTags.some((t) => ctxTags.has(String(t).toLowerCase()))) return false;
  }
  return true;
}

// Tiny integer hash so equal seeds give equal picks across processes.
function hashSeed(seed) {
  let h = 2166136261 ^ Math.floor(seed);
  h = Math.imul(h, 16777619);
  h ^= h >>> 13;
  return h | 0;
}

/**
 * Derive contextual tags from a local path / detected files WITHOUT transmitting
 * them. This is a helper the client uses; its output stays on-device and only
 * influences `selectCampaign`.
 */
export function deriveLocalTags({ cwd = '', files = [] } = {}) {
  const tags = new Set();
  const hay = (cwd + ' ' + files.join(' ')).toLowerCase();
  const rules = [
    [/cargo\.toml|\.rs\b/, 'rust'],
    [/package\.json|\.ts\b|\.tsx\b|\.js\b/, 'javascript'],
    [/requirements\.txt|pyproject\.toml|\.py\b/, 'python'],
    [/go\.mod|\.go\b/, 'go'],
    [/dockerfile|docker-compose/, 'docker'],
    [/terraform|\.tf\b/, 'terraform'],
    [/\.github\/workflows|\.gitlab-ci/, 'ci'],
    [/kubernetes|k8s|helm/, 'kubernetes'],
  ];
  for (const [re, tag] of rules) if (re.test(hay)) tags.add(tag);
  return [...tags];
}
