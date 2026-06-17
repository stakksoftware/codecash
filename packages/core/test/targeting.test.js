import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectCampaign, deriveLocalTags } from '../targeting.js';

const body = {
  campaigns: [
    { id: 'rust', advertiser: 'RustCloud', model: 'impression', text: 'a', cpmMicros: 1, tags: ['rust'], weight: 1 },
    { id: 'js', advertiser: 'NodeHost', model: 'impression', text: 'b', cpmMicros: 1, tags: ['javascript'], weight: 1 },
    { id: 'generic', advertiser: 'Anything', model: 'impression', text: 'c', cpmMicros: 1, weight: 1 },
  ],
};

test('contextual tags bias selection toward relevant campaigns', () => {
  // With a strong rust context, across many seeds rust should win most picks.
  let rustWins = 0;
  for (let seed = 0; seed < 200; seed++) {
    const c = selectCampaign(body, { tags: ['rust'] }, seed);
    if (c.id === 'rust') rustWins++;
  }
  assert.ok(rustWins > 100, `rust won ${rustWins}/200`);
});

test('selection is deterministic for a given seed', () => {
  const a = selectCampaign(body, { tags: ['rust'] }, 7);
  const b = selectCampaign(body, { tags: ['rust'] }, 7);
  assert.equal(a.id, b.id);
});

test('daily frequency cap removes a campaign from eligibility (FR3)', () => {
  const capped = {
    campaigns: [{ id: 'x', advertiser: 'X', model: 'impression', text: 't', cpmMicros: 1, dailyCapImpressions: 2 }],
  };
  assert.ok(selectCampaign(capped, { frequency: { x: 1 } }, 1));
  assert.equal(selectCampaign(capped, { frequency: { x: 2 } }, 1), null);
});

test('empty bundle yields null (degrade gracefully)', () => {
  assert.equal(selectCampaign({ campaigns: [] }, {}, 1), null);
});

test('deriveLocalTags detects languages/tooling from local context only', () => {
  const tags = deriveLocalTags({ cwd: '/home/me/proj', files: ['Cargo.toml', 'Dockerfile'] });
  assert.ok(tags.includes('rust'));
  assert.ok(tags.includes('docker'));
});
