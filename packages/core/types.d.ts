// Type declarations for @codecash/core. The implementation is dependency-free
// ESM JavaScript; these declarations let TypeScript consumers (e.g. an editor
// plugin or SDK) import the trust core with full types.

export type Micros = number;

export interface KeyPair {
  publicKey: string; // base64url raw ed25519 (32 bytes)
  privateKey: string; // base64url raw ed25519 seed (32 bytes)
}

// ---- crypto ----
export function canonicalize(value: unknown): string;
export function canonicalBytes(value: unknown): Buffer;
export function generateKeyPair(): KeyPair;
export function signValue(value: unknown, privateKeyB64u: string): string;
export function verifyValue(value: unknown, signatureB64u: string, publicKeyB64u: string): boolean;
export function fingerprint(value: unknown, length?: number): string;
export function base64url(buf: Uint8Array | Buffer): string;
export function fromBase64url(str: string): Buffer;
export function randomId(bytes?: number): string;

// ---- payout ----
export const PAYOUT_FORMULA_VERSION: string;
export const DEFAULT_SPLIT: { userShareBps: number };
export const EVENT_WEIGHTS: { impression: number; engagement: number; conversion: number };
export type EventType = 'impression' | 'engagement' | 'conversion';
export interface PayoutEvent {
  cpmMicros?: Micros;
  type?: EventType;
  quality?: number;
  conversionValueMicros?: Micros;
  units?: number;
}
export interface PayoutResult {
  formulaVersion: string;
  type: EventType;
  weight: number;
  quality: number;
  units: number;
  userShareBps: number;
  grossMicros: Micros;
  platformCutMicros: Micros;
  netMicros: Micros;
}
export function computePayout(ev: PayoutEvent, split?: { userShareBps: number }): PayoutResult;
export function microsToUsd(micros: Micros): number;
export function formatUsd(micros: Micros, opts?: { precision?: number }): string;

// ---- receipt ----
export const RECEIPT_SCHEMA: string;
export interface Receipt {
  body: Record<string, unknown>;
  signature: string;
  keyId: string;
  alg: 'ed25519';
}
export function buildReceiptBody(ev: any, split?: { userShareBps: number }): Record<string, unknown>;
export function signReceipt(body: object, privateKeyB64u: string, keyId?: string): Receipt;
export function issueReceipt(ev: any, privateKeyB64u: string, opts?: { split?: { userShareBps: number }; keyId?: string }): Receipt;
export function verifyReceipt(receipt: Receipt, publicKeyB64u: string): {
  ok: boolean;
  signatureValid: boolean;
  arithmeticValid: boolean;
  reasons: string[];
};

// ---- counter ----
export const COUNTER_SCHEMA: string;
export const COUNTER_ALLOWED_KEYS: readonly string[];
export function buildCounter(input: {
  deviceId: string;
  periodStart: string;
  periodEnd: string;
  surface: string;
  events: Array<Record<string, unknown>>;
}): Record<string, unknown>;
export function assertClean(body: object): true;
export function signCounter(body: object, devicePrivateKeyB64u: string): { body: object; signature: string; alg: 'ed25519' };
export function verifyCounter(counter: { body: object; signature: string }, devicePublicKeyB64u: string): boolean;

// ---- bundle ----
export const BUNDLE_SCHEMA: string;
export interface Campaign {
  id: string;
  advertiser: string;
  model: 'impression' | 'sponsor' | 'affiliate' | 'opt-in';
  text: string;
  url?: string;
  cpmMicros: Micros;
  tags?: string[];
  requireTags?: string[];
  weight?: number;
  dailyCapImpressions?: number;
}
export function buildBundle(input: { campaigns: Campaign[]; version: string; generatedAt: string; ttlSeconds?: number }): any;
export function signBundle(body: object, privateKeyB64u: string, keyId?: string): any;
export function verifyBundle(bundle: any, publicKeyB64u: string): boolean;
export function bundleIsFresh(bundle: any, nowMs: number): boolean;

// ---- targeting ----
export function selectCampaign(bundleBody: any, ctx?: { tags?: string[]; surface?: string; frequency?: Record<string, number> }, seed?: number): Campaign | null;
export function deriveLocalTags(input?: { cwd?: string; files?: string[] }): string[];

// ---- session ----
export const MIN_VISIBLE_MS: number;
export const MAX_CREDITED_VISIBLE_MS: number;
export function assessImpression(sig?: {
  windowFocused?: boolean;
  agentActive?: boolean;
  visibleMs?: number;
  lastAgentHeartbeatAgeMs?: number;
}): { quality: number; verified: boolean; reasons: string[] };
