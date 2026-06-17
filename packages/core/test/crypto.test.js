import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalize,
  generateKeyPair,
  signValue,
  verifyValue,
  base64url,
  fromBase64url,
  randomId,
  fingerprint,
} from '../crypto.js';

test('canonicalize sorts keys deterministically', () => {
  assert.equal(canonicalize({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(canonicalize({ a: { z: 1, y: 2 } }), '{"a":{"y":2,"z":1}}');
  // key order on the input must not change the output
  assert.equal(canonicalize({ x: 1, a: 2 }), canonicalize({ a: 2, x: 1 }));
});

test('canonicalize drops undefined values', () => {
  assert.equal(canonicalize({ a: 1, b: undefined }), '{"a":1}');
});

test('ed25519 sign/verify round-trips', () => {
  const { publicKey, privateKey } = generateKeyPair();
  const value = { hello: 'world', n: 42 };
  const sig = signValue(value, privateKey);
  assert.ok(verifyValue(value, sig, publicKey));
});

test('verify fails on tampered payload', () => {
  const { publicKey, privateKey } = generateKeyPair();
  const sig = signValue({ amount: 100 }, privateKey);
  assert.equal(verifyValue({ amount: 101 }, sig, publicKey), false);
});

test('verify fails with the wrong key', () => {
  const a = generateKeyPair();
  const b = generateKeyPair();
  const sig = signValue({ x: 1 }, a.privateKey);
  assert.equal(verifyValue({ x: 1 }, sig, b.publicKey), false);
});

test('signature is independent of key order in the payload', () => {
  const { publicKey, privateKey } = generateKeyPair();
  const sig = signValue({ a: 1, b: 2 }, privateKey);
  assert.ok(verifyValue({ b: 2, a: 1 }, sig, publicKey));
});

test('base64url round-trips and is url-safe', () => {
  const buf = Buffer.from([0xff, 0xfe, 0xfd, 0x00, 0x10]);
  const s = base64url(buf);
  assert.match(s, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(fromBase64url(s), buf);
});

test('randomId and fingerprint produce stable shapes', () => {
  assert.match(randomId(8), /^[A-Za-z0-9_-]+$/);
  assert.equal(fingerprint({ a: 1 }), fingerprint({ a: 1 }));
  assert.notEqual(fingerprint({ a: 1 }), fingerprint({ a: 2 }));
});
