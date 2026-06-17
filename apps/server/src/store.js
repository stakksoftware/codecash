// Persistence layer. For a runnable, dependency-free reference implementation
// this is a single JSON document loaded into memory and flushed on write. The
// interface (accounts/sessions/devices/ledger/transfers/seenNonces) is the seam
// where production swaps in Postgres/Supabase — see docs/ARCHITECTURE.md. The
// rest of the server only ever calls these functions, never the file directly.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.CODECASH_DATA_DIR || path.join(here, '..', '.data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

function emptyDb() {
  return {
    accounts: {}, // accountId -> { accountId, email, identityVerified, createdAt }
    emailIndex: {}, // email -> accountId
    devices: {}, // deviceId -> { deviceId, accountId, publicKey }
    sessions: {}, // accessToken -> { accountId, expiresAt }
    refresh: {}, // refreshToken -> { accountId }
    ledger: [], // [{ accountId, deviceId, ...receipt.body, receipt }]
    transfers: [], // [{ accountId, amountMicros, transferId, at, rails }]
    seenNonces: {}, // deviceId -> { nonce: at } (replay protection)
    counterLog: {}, // deviceId -> [submittedAtMs] (rate limiting)
  };
}

let db;

export function init() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    db = emptyDb();
    flush();
  }
  return db;
}

export function flush() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function ensure() {
  if (!db) init();
  return db;
}

// ---- accounts & devices ----------------------------------------------------

export function upsertAccount(email) {
  const d = ensure();
  let accountId = d.emailIndex[email];
  if (!accountId) {
    accountId = 'acct_' + Buffer.from(email).toString('hex').slice(0, 12);
    d.accounts[accountId] = {
      accountId,
      email,
      identityVerified: false,
      createdAt: new Date().toISOString(),
    };
    d.emailIndex[email] = accountId;
  }
  flush();
  return d.accounts[accountId];
}

export function getAccount(accountId) {
  return ensure().accounts[accountId] || null;
}

export function setIdentityVerified(accountId, verified = true) {
  const d = ensure();
  if (d.accounts[accountId]) {
    d.accounts[accountId].identityVerified = verified;
    flush();
  }
  return d.accounts[accountId];
}

export function registerDevice(deviceId, accountId, publicKey) {
  const d = ensure();
  d.devices[deviceId] = { deviceId, accountId, publicKey };
  flush();
  return d.devices[deviceId];
}

export function getDevice(deviceId) {
  return ensure().devices[deviceId] || null;
}

// ---- sessions (auth tokens) ------------------------------------------------

export function createSession(accountId, { accessToken, refreshToken, expiresAt }) {
  const d = ensure();
  d.sessions[accessToken] = { accountId, expiresAt };
  d.refresh[refreshToken] = { accountId };
  flush();
}

export function resolveAccessToken(accessToken) {
  const s = ensure().sessions[accessToken];
  if (!s) return null;
  if (Date.parse(s.expiresAt) <= Date.now()) return null;
  return s.accountId;
}

export function resolveRefreshToken(refreshToken) {
  const r = ensure().refresh[refreshToken];
  return r ? r.accountId : null;
}

// ---- ledger ----------------------------------------------------------------

export function appendLedger(entry) {
  const d = ensure();
  d.ledger.push(entry);
  flush();
  return entry;
}

export function ledgerForAccount(accountId) {
  return ensure().ledger.filter((e) => e.accountId === accountId);
}

export function balanceMicros(accountId) {
  const credited = ledgerForAccount(accountId).reduce((s, e) => s + (e.amounts?.netMicros || 0), 0);
  const withdrawn = ensure()
    .transfers.filter((t) => t.accountId === accountId)
    .reduce((s, t) => s + t.amountMicros, 0);
  return credited - withdrawn;
}

export function creditedTodayMicros(accountId, nowMs = Date.now()) {
  const dayAgo = nowMs - 24 * 3600_000;
  return ledgerForAccount(accountId)
    .filter((e) => Date.parse(e.issuedAt || '') > dayAgo)
    .reduce((s, e) => s + (e.amounts?.grossMicros || 0), 0);
}

export function recordTransfer(t) {
  const d = ensure();
  d.transfers.push(t);
  flush();
  return t;
}

// ---- fraud bookkeeping -----------------------------------------------------

export function nonceSeen(deviceId, nonce) {
  const d = ensure();
  return !!(d.seenNonces[deviceId] && d.seenNonces[deviceId][nonce]);
}

export function rememberNonce(deviceId, nonce, atMs = Date.now()) {
  const d = ensure();
  d.seenNonces[deviceId] = d.seenNonces[deviceId] || {};
  d.seenNonces[deviceId][nonce] = atMs;
  flush();
}

export function recordCounterSubmission(deviceId, atMs = Date.now()) {
  const d = ensure();
  d.counterLog[deviceId] = (d.counterLog[deviceId] || []).filter((t) => t > atMs - 60_000);
  d.counterLog[deviceId].push(atMs);
  flush();
  return d.counterLog[deviceId].length;
}

export function recentCounterCount(deviceId, atMs = Date.now()) {
  const d = ensure();
  return (d.counterLog[deviceId] || []).filter((t) => t > atMs - 60_000).length;
}

// ---- test/demo helpers -----------------------------------------------------

export function _reset() {
  db = emptyDb();
  flush();
}

export function _all() {
  return ensure();
}
