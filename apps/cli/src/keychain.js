// Persistent, zero-maintenance auth & device identity (FR19).
//
// Secrets (the device signing key + the auth token bundle) are stored in the OS
// keychain when available, falling back to a 0600 JSON file. The device key is
// generated once and reused forever; the auth token is refreshed silently before
// it expires, so the user never re-authenticates after `codecash login`.
//
// Backend selection:
//   - macOS `security` keychain when CODECASH_KEYCHAIN=1 (and on darwin).
//   - otherwise an encrypted-at-rest-by-filesystem-perms JSON file.
// Both expose the same get/set interface, so the rest of the CLI is agnostic.

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { files, ensureHome } from './paths.js';
import { generateKeyPair } from '@codecash/core';

const SERVICE = 'com.codecash.cli';

function useKeychain() {
  return process.platform === 'darwin' && process.env.CODECASH_KEYCHAIN === '1';
}

// ---- macOS keychain backend ------------------------------------------------

function keychainGet(key) {
  try {
    const out = execFileSync(
      'security',
      ['find-generic-password', '-s', SERVICE, '-a', key, '-w'],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return out.toString('utf8').trim();
  } catch {
    return null;
  }
}

function keychainSet(key, value) {
  // -U updates if it already exists. Non-interactive for our own items.
  execFileSync(
    'security',
    ['add-generic-password', '-U', '-s', SERVICE, '-a', key, '-w', value],
    { stdio: 'ignore' },
  );
}

// ---- file backend ----------------------------------------------------------

function fileAll() {
  try {
    return JSON.parse(fs.readFileSync(files.secrets(), 'utf8'));
  } catch {
    return {};
  }
}

function fileGet(key) {
  return fileAll()[key] ?? null;
}

function fileSet(key, value) {
  ensureHome();
  const all = fileAll();
  all[key] = value;
  fs.writeFileSync(files.secrets(), JSON.stringify(all), { mode: 0o600 });
}

// ---- unified secret store --------------------------------------------------

export function getSecret(key) {
  return useKeychain() ? keychainGet(key) : fileGet(key);
}

export function setSecret(key, value) {
  return useKeychain() ? keychainSet(key, value) : fileSet(key, value);
}

export function secretBackend() {
  return useKeychain() ? 'macos-keychain' : 'file(0600)';
}

// ---- device identity -------------------------------------------------------

/** Get the persistent device keypair, generating + storing it once. */
export function getDeviceKeyPair() {
  let stored = getSecret('device_key');
  if (!stored) {
    const kp = generateKeyPair();
    setSecret('device_key', JSON.stringify(kp));
    setSecret('device_id', deviceIdFromPublic(kp.publicKey));
    stored = JSON.stringify(kp);
  }
  return JSON.parse(stored);
}

export function getDeviceId() {
  const id = getSecret('device_id');
  if (id) return id;
  // Derive from the key if missing (older installs).
  const kp = getDeviceKeyPair();
  const did = deviceIdFromPublic(kp.publicKey);
  setSecret('device_id', did);
  return did;
}

function deviceIdFromPublic(pub) {
  return 'dev_' + pub.slice(0, 16);
}

// ---- auth token (silent refresh) -------------------------------------------

export function getAuthBundle() {
  const raw = getSecret('auth');
  return raw ? JSON.parse(raw) : null;
}

export function setAuthBundle(bundle) {
  setSecret('auth', JSON.stringify(bundle));
}

export function clearAuth() {
  setAuthBundle(null);
}

/**
 * Return a currently-valid access token, refreshing silently if it is within
 * `skewMs` of expiry. `refresher(refreshToken)` performs the network refresh and
 * returns a new bundle. If refresh fails, returns the existing token if still
 * valid, else null — callers degrade gracefully rather than prompting (FR19/FR20).
 */
export async function getValidAccessToken(refresher, nowMs = Date.now(), skewMs = 60_000) {
  const bundle = getAuthBundle();
  if (!bundle) return null;
  const expMs = Date.parse(bundle.expiresAt || '') || 0;
  if (expMs - skewMs > nowMs) return bundle.accessToken;
  // Needs refresh.
  try {
    const next = await refresher(bundle.refreshToken);
    if (next && next.accessToken) {
      setAuthBundle(next);
      return next.accessToken;
    }
  } catch {
    /* fall through */
  }
  // Refresh failed — only return the old token if it has not actually expired.
  return expMs > nowMs ? bundle.accessToken : null;
}
