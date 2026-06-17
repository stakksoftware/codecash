// Type declarations for @codecash/sdk (Phase 4).

export interface SDKDevice {
  id: string;
  privateKey: string;
  publicKey: string;
}

export interface SDKOptions {
  serverUrl: string;
  accessToken: string;
  device: SDKDevice;
  surface?: string;
  bundlePublicKey?: string;
  receiptPublicKey?: string;
  onSponsor?: (line: string, campaign: any) => void;
  autoFlush?: boolean;
  clock?: () => number;
}

export interface WaitOptions {
  tags?: string[];
  cwd?: string;
  windowFocused?: boolean;
  onSponsor?: (line: string, campaign: any) => void;
}

export interface FlushResult {
  submitted: number;
  receipts: any[];
  credited?: any[];
}

export class CodeCashSDK {
  constructor(opts: SDKOptions);
  static login(opts: { serverUrl: string; email: string; surface?: string; onSponsor?: (line: string, c: any) => void; autoFlush?: boolean }): Promise<CodeCashSDK>;
  serverUrl: string;
  surface: string;
  receipts: any[];
  sync(): Promise<{ campaigns: number; version?: string }>;
  selectLine(ctx?: { tags?: string[]; cwd?: string }): { line: string; campaign: any | null };
  duringWait<T>(fn: () => Promise<T> | T, opts?: WaitOptions): Promise<T>;
  wrapStream<T>(makeStream: () => AsyncIterable<T> | Promise<AsyncIterable<T>>, opts?: WaitOptions): AsyncGenerator<T>;
  pendingCount(): number;
  flush(): Promise<FlushResult>;
  earningsUsd(): string;
  static verifyReceipt(receipt: any, publicKey: string): { ok: boolean; signatureValid: boolean; arithmeticValid: boolean; reasons: string[] };
}

export default CodeCashSDK;
