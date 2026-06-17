// @codecash/core/crypto
//
// Deterministic Ed25519 signing over a canonical JSON encoding. Zero external
// dependencies — only Node's built-in `node:crypto`. The whole point of
// CodeCash's trust model is that anyone can re-implement verification from this
// file alone, so it is deliberately small and explicit.

import {
  generateKeyPairSync,
  sign as nodeSign,
  verify as nodeVerify,
  createPublicKey,
  createPrivateKey,
  createHash,
  randomBytes,
} from 'node:crypto';

/**
 * Canonical JSON: object keys sorted recursively, no insignificant whitespace.
 * Two semantically-equal payloads always serialize to the same bytes, which is
 * what makes a signature verifiable by an independent party.
 */
export function canonicalize(value) {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      const v = value[key];
      if (v === undefined) continue; // undefined is not representable in JSON
      out[key] = sortDeep(v);
    }
    return out;
  }
  return value;
}

export function canonicalBytes(value) {
  return Buffer.from(canonicalize(value), 'utf8');
}

// ---------------------------------------------------------------------------
// Key material. We serialize Ed25519 keys as base64url-encoded raw 32-byte
// values so they are easy to publish, copy, and embed in receipts.
// ---------------------------------------------------------------------------

export function generateKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKey: exportPublicKey(publicKey),
    privateKey: exportPrivateKey(privateKey),
  };
}

function exportPublicKey(keyObject) {
  // SPKI DER for an Ed25519 public key is a fixed 44-byte structure whose last
  // 32 bytes are the raw key.
  const der = keyObject.export({ type: 'spki', format: 'der' });
  return base64url(der.subarray(der.length - 32));
}

function exportPrivateKey(keyObject) {
  // PKCS8 DER for an Ed25519 private key ends with the raw 32-byte seed.
  const der = keyObject.export({ type: 'pkcs8', format: 'der' });
  return base64url(der.subarray(der.length - 32));
}

const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

function publicKeyObjectFromRaw(rawB64u) {
  const raw = fromBase64url(rawB64u);
  if (raw.length !== 32) throw new Error('invalid ed25519 public key length');
  return createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, raw]),
    format: 'der',
    type: 'spki',
  });
}

function privateKeyObjectFromRaw(rawB64u) {
  const raw = fromBase64url(rawB64u);
  if (raw.length !== 32) throw new Error('invalid ed25519 private key length');
  return createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, raw]),
    format: 'der',
    type: 'pkcs8',
  });
}

/** Sign a JS value with a raw base64url private key. Returns base64url signature. */
export function signValue(value, privateKeyB64u) {
  const key = privateKeyObjectFromRaw(privateKeyB64u);
  const sig = nodeSign(null, canonicalBytes(value), key);
  return base64url(sig);
}

/** Verify a base64url signature over a JS value with a raw base64url public key. */
export function verifyValue(value, signatureB64u, publicKeyB64u) {
  try {
    const key = publicKeyObjectFromRaw(publicKeyB64u);
    return nodeVerify(null, canonicalBytes(value), key, fromBase64url(signatureB64u));
  } catch {
    return false;
  }
}

/** Stable content fingerprint of any value (sha-256, base64url, truncated). */
export function fingerprint(value, length = 16) {
  return base64url(createHash('sha256').update(canonicalBytes(value)).digest()).slice(0, length);
}

// ---------------------------------------------------------------------------
// base64url helpers (no padding) — used for keys, signatures, and ids.
// ---------------------------------------------------------------------------

export function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** Cryptographically-random id, base64url. */
export function randomId(bytes = 12) {
  return base64url(randomBytes(bytes));
}
