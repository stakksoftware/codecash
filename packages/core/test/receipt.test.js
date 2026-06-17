import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair } from '../crypto.js';
import { issueReceipt, verifyReceipt, buildReceiptBody, signReceipt } from '../receipt.js';

const sampleEvent = {
  eventId: 'evt_1',
  issuedAt: '2026-06-17T12:00:00.000Z',
  deviceId: 'dev_abc',
  advertiser: 'Acme Cloud',
  campaignId: 'camp_1',
  type: 'impression',
  cpmMicros: 5_000_000,
  quality: 1,
};

test('a freshly issued receipt verifies against the published key (FR6)', () => {
  const { publicKey, privateKey } = generateKeyPair();
  const receipt = issueReceipt(sampleEvent, privateKey);
  const result = verifyReceipt(receipt, publicKey);
  assert.ok(result.ok);
  assert.ok(result.signatureValid);
  assert.ok(result.arithmeticValid);
});

test('a tampered amount is caught by the arithmetic check', () => {
  const { publicKey, privateKey } = generateKeyPair();
  const receipt = issueReceipt(sampleEvent, privateKey);
  // Forge a higher net without re-signing -> signature fails.
  receipt.body.amounts.netMicros += 1000;
  const result = verifyReceipt(receipt, publicKey);
  assert.equal(result.ok, false);
  assert.equal(result.signatureValid, false);
});

test('a receipt re-signed with dishonest math fails the arithmetic check', () => {
  const { publicKey, privateKey } = generateKeyPair();
  const body = buildReceiptBody(sampleEvent);
  body.amounts.netMicros = 9_999_999; // lie about the payout
  const receipt = signReceipt(body, privateKey); // sign the lie honestly
  const result = verifyReceipt(receipt, publicKey);
  assert.ok(result.signatureValid); // signature is valid...
  assert.equal(result.arithmeticValid, false); // ...but the math is not
  assert.equal(result.ok, false);
});

test('verification fails against the wrong public key', () => {
  const a = generateKeyPair();
  const b = generateKeyPair();
  const receipt = issueReceipt(sampleEvent, a.privateKey);
  assert.equal(verifyReceipt(receipt, b.publicKey).ok, false);
});

test('malformed receipts do not throw', () => {
  const { publicKey } = generateKeyPair();
  assert.equal(verifyReceipt(null, publicKey).ok, false);
  assert.equal(verifyReceipt({}, publicKey).ok, false);
});
