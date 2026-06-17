import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-p3-test-'));
process.env.CODECASH_HOME = tmp;
process.env.CODECASH_SERVER = 'http://127.0.0.1:0';

const { detectSurface } = await import('../src/surfaces.js');
const { patchConfig } = await import('../src/config.js');
const render = await import('../src/render.js');
const events = await import('../src/events.js');
const telemetry = await import('../src/telemetry.js');
const { files } = await import('../src/paths.js');

beforeEach(() => {
  for (const f of [files.config(), files.bundle(), files.bundle().replace('bundle.json', 'frequency.json'), files.bundle().replace('bundle.json', 'pending.json')]) {
    try { fs.unlinkSync(f); } catch {}
  }
  telemetry.reset();
});

function writeBundle() {
  const body = {
    schema: 'codecash.bundle/v1', version: 't', generatedAt: new Date().toISOString(), ttlSeconds: 3600,
    campaigns: [
      { id: 's1', advertiser: 'Sponsor One', model: 'sponsor', text: 'one', cpmMicros: 9_000_000, weight: 2 },
      { id: 's2', advertiser: 'Sponsor Two', model: 'sponsor', text: 'two', cpmMicros: 9_000_000, weight: 2 },
      { id: 'a1', advertiser: 'Affil', model: 'affiliate', text: 'aff', cpmMicros: 12_000_000, tags: ['rust'], weight: 3 },
    ],
  };
  fs.writeFileSync(files.bundle(), JSON.stringify({ body, signature: 'x', keyId: 'k', alg: 'ed25519' }));
}

test('detectSurface maps build and long-job commands', () => {
  assert.deepEqual(detectSurface(['npm', 'install']).surface, 'build-ci');
  assert.deepEqual(detectSurface(['cargo', 'build', '--release']), { surface: 'build-ci', tags: ['rust'], commandName: 'cargo' });
  assert.equal(detectSurface(['terraform', 'apply']).surface, 'long-job');
  assert.deepEqual(detectSurface(['docker', 'build', '.']).tags, ['docker']);
  assert.equal(detectSurface(['some-unknown-binary']).surface, 'long-job');
});

test('sponsor mode pins a single "powered by" sponsor (§8)', () => {
  patchConfig({ enabled: true, mode: 'sponsor', pausedUntil: null });
  writeBundle();
  const now = 1_700_000_000_000;
  const a = render.renderLine({ nowMs: now, countFrequency: false });
  const b = render.renderLine({ nowMs: now, countFrequency: false });
  assert.match(a.line, /Sponsored by/);
  assert.equal(a.campaign.model, 'sponsor');
  assert.equal(a.campaign.id, b.campaign.id); // pinned, not rotating
});

test('off mode (pay-to-remove) is silent', () => {
  patchConfig({ enabled: true, mode: 'off' });
  writeBundle();
  assert.equal(render.renderLine({}).line, '');
});

test('events carry their surface and flush groups by surface', () => {
  patchConfig({ surface: 'agent-cli' });
  const r1 = events.recordEvent({ campaignId: 'a1', advertiser: 'Affil', type: 'impression', cpmMicros: 1, surface: 'build-ci', signals: { windowFocused: true, agentActive: true, visibleMs: 9000 } });
  const r2 = events.recordEvent({ campaignId: 'a1', advertiser: 'Affil', type: 'impression', cpmMicros: 1, surface: 'long-job', signals: { windowFocused: true, agentActive: true, visibleMs: 9000 } });
  assert.equal(r1.entry.surface, 'build-ci');
  assert.equal(r2.entry.surface, 'long-job');
  assert.equal(events.pendingCount(), 2);
});
