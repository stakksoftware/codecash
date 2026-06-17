// Thin, self-healing client for the CodeCash server. Every call records its own
// success/failure into telemetry (FR21) and never throws into the host — a
// failed sync just means "no ad this time" (FR20, degrade gracefully).

import { getValidAccessToken } from './keychain.js';
import * as telemetry from './telemetry.js';

// Default generously: a hosted server can have a serverless cold start plus a
// few DB round-trips. The status-line path stays snappy by passing a small
// timeout where latency matters; everything else tolerates a cold start.
async function http(method, url, { body, token, timeoutMs = 15000 } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ac.signal,
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const err = new Error(json.error || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return json;
  } finally {
    clearTimeout(t);
  }
}

function refresher(serverUrl) {
  return (refreshToken) => http('POST', `${serverUrl}/v1/auth/refresh`, { body: { refreshToken } });
}

export async function login(serverUrl, { email, deviceId, devicePublicKey }) {
  return http('POST', `${serverUrl}/v1/auth/login`, {
    body: { email, deviceId, devicePublicKey },
  });
}

export async function fetchBundle(serverUrl) {
  try {
    const token = await getValidAccessToken(refresher(serverUrl));
    const bundle = await http('GET', `${serverUrl}/v1/bundle`, { token });
    telemetry.record(true);
    return bundle;
  } catch (err) {
    telemetry.record(false);
    return null; // self-heal: caller renders nothing
  }
}

export async function submitCounter(serverUrl, counter) {
  try {
    const token = await getValidAccessToken(refresher(serverUrl));
    const res = await http('POST', `${serverUrl}/v1/counters`, { token, body: counter });
    telemetry.record(true);
    return res; // { receipts: [...], credited: [...] }
  } catch (err) {
    telemetry.record(false);
    return { error: err.message, receipts: [] };
  }
}

export async function getLedger(serverUrl) {
  const token = await getValidAccessToken(refresher(serverUrl));
  return http('GET', `${serverUrl}/v1/ledger`, { token });
}

export async function getPayoutStatus(serverUrl) {
  const token = await getValidAccessToken(refresher(serverUrl));
  return http('GET', `${serverUrl}/v1/payouts`, { token });
}

export async function requestWithdrawal(serverUrl) {
  const token = await getValidAccessToken(refresher(serverUrl));
  return http('POST', `${serverUrl}/v1/payouts/withdraw`, { token, body: {} });
}

export async function fetchReceiptKey(serverUrl) {
  return http('GET', `${serverUrl}/.well-known/codecash-receipts.json`);
}
