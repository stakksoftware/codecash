import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// Each run gets an isolated CODECASH_HOME.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-cli-test-'));
process.env.CODECASH_HOME = tmp;
process.env.CODECASH_SERVER = 'http://127.0.0.1:0'; // never actually hit in these tests

const { loadConfig, patchConfig, isActive } = await import('../src/config.js');
const telemetry = await import('../src/telemetry.js');
const render = await import('../src/render.js');
const events = await import('../src/events.js');
const { files } = await import('../src/paths.js');

beforeEach(() => {
  // reset state files between tests
  for (const f of [files.config(), files.telemetry(), files.bundle(), files.bundle().replace('bundle.json', 'frequency.json'), files.bundle().replace('bundle.json', 'pending.json')]) {
    try { fs.unlinkSync(f); } catch {}
  }
  telemetry.reset();
});

function writeBundle() {
  const body = {
    schema: 'codecash.bundle/v1',
    version: 'test',
    generatedAt: new Date().toISOString(),
    ttlSeconds: 3600,
    campaigns: [
      { id: 'c1', advertiser: 'Acme', model: 'sponsor', text: 'hello devs', cpmMicros: 5_000_000, weight: 1 },
    ],
  };
  fs.writeFileSync(files.bundle(), JSON.stringify({ body, signature: 'x', keyId: 'k', alg: 'ed25519' }));
}

test('isActive honors enabled / pause / mode (FR4)', () => {
  assert.equal(isActive({ enabled: true, mode: 'earn', pausedUntil: null }), true);
  assert.equal(isActive({ enabled: false, mode: 'earn', pausedUntil: null }), false);
  assert.equal(isActive({ enabled: true, mode: 'off', pausedUntil: null }), false);
  const future = new Date(Date.now() + 60000).toISOString();
  assert.equal(isActive({ enabled: true, mode: 'earn', pausedUntil: future }), false);
});

test('render produces one labeled sponsored line when active', () => {
  patchConfig({ enabled: true, mode: 'earn', pausedUntil: null });
  writeBundle();
  const r = render.renderLine({ cwd: '/tmp/proj' });
  assert.match(r.line, /Sponsored/);
  assert.match(r.line, /Acme/);
});

test('render is silent when paused/off (FR4)', () => {
  patchConfig({ enabled: false });
  writeBundle();
  assert.equal(render.renderLine({}).line, '');
});

test('render respects the hourly frequency cap (FR3)', () => {
  patchConfig({ enabled: true, mode: 'earn', pausedUntil: null, frequencyCapPerHour: 2 });
  writeBundle();
  assert.notEqual(render.renderLine({}).line, '');
  assert.notEqual(render.renderLine({}).line, '');
  assert.equal(render.renderLine({}).line, ''); // 3rd within the hour is capped
});

test('telemetry circuit breaker trips after repeated failures and silences render (FR21)', () => {
  patchConfig({ enabled: true, mode: 'earn', pausedUntil: null, frequencyCapPerHour: 100 });
  writeBundle();
  for (let i = 0; i < 10; i++) telemetry.record(false);
  assert.equal(telemetry.isCircuitOpen(), true);
  assert.equal(render.renderLine({}).line, '');
});

test('recordEvent queues a genuine event and refuses a fraudulent one (FR12)', () => {
  const good = events.recordEvent({
    campaignId: 'c1', advertiser: 'Acme', type: 'impression', cpmMicros: 5_000_000,
    signals: { windowFocused: true, agentActive: true, visibleMs: 9000 },
  });
  assert.equal(good.queued, true);
  const bad = events.recordEvent({
    campaignId: 'c1', advertiser: 'Acme', type: 'impression', cpmMicros: 5_000_000,
    signals: { windowFocused: true, agentActive: false, visibleMs: 9000 },
  });
  assert.equal(bad.queued, false);
  assert.equal(events.pendingCount(), 1);
});
