// @codecash/sdk — opt-in latency monetization for third-party apps (Phase 4,
// surface roadmap #4).
//
// Any app that makes its users wait (an LLM call streaming, a slow API, a long
// computation) can embed CodeCash to turn that wait into value — on the SAME
// terms as the CLI: on-device targeting, signed counters, verified impressions,
// nothing sensitive transmitted. Integration is a few lines:
//
//   import { CodeCashSDK } from '@codecash/sdk';
//   const cc = await CodeCashSDK.login({ serverUrl, email, surface: 'my-llm-app' });
//   await cc.sync();
//   const answer = await cc.duringWait(() => llm.complete(prompt), {
//     onSponsor: (line) => ui.showStatus(line),
//   });
//   await cc.flush();
//
// The SDK holds all state in memory (it's a library, not a daemon) and reuses
// @codecash/core for every trust-critical operation.

import {
  generateKeyPair,
  selectCampaign,
  deriveLocalTags,
  buildCounter,
  signCounter,
  verifyBundle,
  verifyReceipt,
  assessImpression,
  formatUsd,
} from '@codecash/core';

export class CodeCashSDK {
  /**
   * @param {object} opts
   * @param {string} opts.serverUrl
   * @param {string} opts.accessToken      a CodeCash account access token
   * @param {{id:string, privateKey:string, publicKey:string}} opts.device
   * @param {string} [opts.surface]        coarse surface category (never the app's data)
   * @param {string} [opts.bundlePublicKey] to verify the synced bundle
   * @param {(line:string, campaign:object)=>void} [opts.onSponsor]
   * @param {boolean} [opts.autoFlush]     flush after each credited wait (default false)
   */
  constructor(opts) {
    if (!opts?.serverUrl || !opts?.accessToken || !opts?.device) {
      throw new Error('CodeCashSDK requires { serverUrl, accessToken, device }');
    }
    this.serverUrl = opts.serverUrl.replace(/\/$/, '');
    this.accessToken = opts.accessToken;
    this.device = opts.device;
    this.surface = opts.surface || 'sdk';
    this.bundlePublicKey = opts.bundlePublicKey || null;
    this.onSponsor = opts.onSponsor || (() => {});
    this.autoFlush = !!opts.autoFlush;

    this._bundle = null;
    this._pending = [];
    this._seed = 1;
    this.receipts = [];
    // Injectable clock (tests pass a deterministic one; production uses Date.now).
    this._clock = opts.clock || (() => Date.now());
  }

  /** Turn-key bootstrap: generate a device, log in, return a ready SDK. */
  static async login({ serverUrl, email, surface, onSponsor, autoFlush } = {}) {
    const base = (serverUrl || '').replace(/\/$/, '');
    const device = generateKeyPair();
    const deviceId = 'dev_sdk_' + device.publicKey.slice(0, 12);
    const res = await fetch(`${base}/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, deviceId, devicePublicKey: device.publicKey }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `login failed (${res.status})`);
    return new CodeCashSDK({
      serverUrl: base,
      accessToken: json.auth.accessToken,
      device: { id: deviceId, privateKey: device.privateKey, publicKey: device.publicKey },
      bundlePublicKey: json.bundlePublicKey,
      receiptPublicKey: json.receiptPublicKey,
      surface,
      onSponsor,
      autoFlush,
    });
  }

  /** Fetch + verify the signed campaign bundle. */
  async sync() {
    const res = await fetch(`${this.serverUrl}/v1/bundle`);
    const bundle = await res.json();
    if (this.bundlePublicKey && !verifyBundle(bundle, this.bundlePublicKey)) {
      throw new Error('bundle signature did not verify against the published key');
    }
    this._bundle = bundle;
    return { campaigns: bundle.body?.campaigns?.length ?? 0, version: bundle.body?.version };
  }

  /** Select a sponsor line on-device for the given local context. */
  selectLine({ tags = [], cwd } = {}) {
    if (!this._bundle?.body) return { line: '', campaign: null };
    const localTags = [...deriveLocalTags({ cwd: cwd || '', files: [] }), ...tags];
    const campaign = selectCampaign(this._bundle.body, { tags: localTags, surface: this.surface }, this._seed++);
    if (!campaign) return { line: '', campaign: null };
    const label = campaign.model === 'sponsor' ? 'Sponsored by' : 'Sponsored';
    return { line: `· ${label} ${campaign.advertiser}: ${campaign.text}`, campaign };
  }

  /**
   * Run an async operation, showing one sponsor line while it runs and crediting
   * a verified impression based on the REAL elapsed time (FR12). The wrapped
   * operation's result (or error) is passed through unchanged.
   */
  async duringWait(fn, opts = {}) {
    const { line, campaign } = this.selectLine(opts);
    if (campaign && line) {
      try { (opts.onSponsor || this.onSponsor)(line, campaign); } catch { /* host UI errors never break the wait */ }
    }
    const start = this._clock();
    let result, error;
    try {
      result = await fn();
    } catch (e) {
      error = e;
    }
    const elapsed = this._clock() - start;
    if (campaign) this._credit(campaign, elapsed, opts);
    if (this.autoFlush) await this.flush().catch(() => {});
    if (error) throw error;
    return result;
  }

  /**
   * Monetize time-to-first-token (surface roadmap #4). Wraps a function that
   * returns an async iterable; shows a sponsor line until the FIRST chunk
   * arrives, credits an impression for that latency, then streams the rest
   * through untouched.
   */
  async *wrapStream(makeStream, opts = {}) {
    const { line, campaign } = this.selectLine(opts);
    if (campaign && line) {
      try { (opts.onSponsor || this.onSponsor)(line, campaign); } catch { /* ignore */ }
    }
    const start = this._clock();
    let credited = false;
    const stream = await makeStream();
    for await (const chunk of stream) {
      if (!credited) {
        credited = true;
        if (campaign) this._credit(campaign, this._clock() - start, opts);
        if (this.autoFlush) await this.flush().catch(() => {});
      }
      yield chunk;
    }
  }

  _credit(campaign, elapsedMs, opts) {
    const assessment = assessImpression({
      windowFocused: opts.windowFocused ?? true,
      agentActive: true, // an operation was genuinely running
      visibleMs: elapsedMs,
      lastAgentHeartbeatAgeMs: 0,
    });
    if (assessment.quality <= 0) return { credited: false, assessment };
    this._pending.push({
      campaignId: campaign.id,
      type: 'impression',
      quality: assessment.quality,
      cpmMicros: campaign.cpmMicros,
    });
    return { credited: true, assessment };
  }

  pendingCount() {
    return this._pending.length;
  }

  /** Build one signed counter, submit it, collect signed receipts. */
  async flush() {
    if (this._pending.length === 0) return { submitted: 0, receipts: [] };
    const agg = new Map();
    for (const e of this._pending) {
      const key = `${e.campaignId}|${e.type}`;
      const cur = agg.get(key) || { campaignId: e.campaignId, type: e.type, count: 0, qualitySum: 0, cpmMicros: e.cpmMicros };
      cur.count += 1;
      cur.qualitySum += e.quality;
      agg.set(key, cur);
    }
    const events = [...agg.values()].map((a) => ({
      campaignId: a.campaignId,
      type: a.type,
      count: a.count,
      quality: +(a.qualitySum / a.count).toFixed(4),
      cpmMicros: a.cpmMicros,
    }));
    const body = buildCounter({
      deviceId: this.device.id,
      periodStart: new Date(this._clock() - 1000).toISOString(),
      periodEnd: new Date(this._clock()).toISOString(),
      surface: this.surface,
      events,
    });
    const counter = signCounter(body, this.device.privateKey);
    const res = await fetch(`${this.serverUrl}/v1/counters`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.accessToken}` },
      body: JSON.stringify(counter),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `counter submit failed (${res.status})`);
    this._pending = [];
    this.receipts.push(...(json.receipts || []));
    return { submitted: events.length, receipts: json.receipts || [], credited: json.credited || [] };
  }

  /** Sum of net earnings across receipts received this session. */
  earningsUsd() {
    const net = this.receipts.reduce((s, r) => s + (r.body?.amounts?.netMicros || 0), 0);
    return formatUsd(net);
  }

  /** Re-export so integrators can verify receipts without importing core. */
  static verifyReceipt(receipt, publicKey) {
    return verifyReceipt(receipt, publicKey);
  }
}


export default CodeCashSDK;
