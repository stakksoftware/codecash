// Seeded inventory floor (FR9, FR10). CodeCash launches by BROKERING existing,
// dev-relevant affiliate/sponsor demand rather than building an ad network from
// scratch (G2, Non-goal #1). This guarantees payouts are never $0 on day one.
//
// These are illustrative dev-relevant offers (cloud credits, devtools, courses)
// spanning the monetization models in §8. In production this list is populated
// from brokered affiliate feeds and direct sponsor deals; the shape is identical.

export const SEED_CAMPAIGNS = [
  {
    id: 'affiliate-cloud-credits',
    advertiser: 'NimbusCloud',
    model: 'affiliate',
    text: '$200 in cloud credits for new accounts → nimbus.example/dev',
    url: 'https://nimbus.example/dev?ref=codecash',
    cpmMicros: 12_000_000, // $12 CPM floor for verified dev impressions
    tags: ['docker', 'kubernetes', 'terraform', 'go', 'rust'],
    weight: 3,
    dailyCapImpressions: 4,
  },
  {
    id: 'sponsor-devtool-ide',
    advertiser: 'Quill IDE',
    model: 'sponsor',
    text: 'The AI-native editor devs actually keep → quill.example',
    url: 'https://quill.example?ref=codecash',
    cpmMicros: 9_000_000,
    tags: ['javascript', 'python', 'rust', 'go'],
    weight: 2,
    dailyCapImpressions: 3,
  },
  {
    id: 'affiliate-course-rust',
    advertiser: 'Ferris Academy',
    model: 'affiliate',
    text: 'Master async Rust — 30% off this week → ferris.example/async',
    url: 'https://ferris.example/async?ref=codecash',
    cpmMicros: 15_000_000,
    tags: ['rust'],
    requireTags: ['rust'],
    weight: 4,
    dailyCapImpressions: 2,
  },
  {
    id: 'sponsor-observability',
    advertiser: 'PulseMetrics',
    model: 'sponsor',
    text: 'Trace every agent run — free tier for solo devs → pulse.example',
    url: 'https://pulse.example?ref=codecash',
    cpmMicros: 11_000_000,
    tags: ['ci', 'kubernetes', 'docker'],
    weight: 2,
    dailyCapImpressions: 3,
  },
  {
    id: 'impression-house-floor',
    advertiser: 'CodeCash',
    model: 'impression',
    text: 'Your wait time, your money. See exactly how → codecash.example/ledger',
    url: 'https://codecash.example/ledger',
    cpmMicros: 4_000_000, // house floor so a line is always available
    weight: 1,
  },
];

export const SEED_CONVERSION_VALUE_MICROS = {
  'affiliate-cloud-credits': 25_000_000, // $25 bounty per signup
  'affiliate-course-rust': 18_000_000,
};
