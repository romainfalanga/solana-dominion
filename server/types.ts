export interface D1Result<T = unknown> { success: boolean; results?: T[]; meta?: { changes?: number } }
export interface D1Statement {
  bind(...values: (string | number | null)[]): D1Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}
export interface D1Database { prepare(sql: string): D1Statement }
export interface Env {
  SOLANA_RPC_URL?: string;
  PUBLIC_SOLANA_RPC_URL?: string;
  CREATION_ENABLED?: string;
  DB?: D1Database;
  ASSETS?: { fetch(request: Request): Promise<Response> };
}
export interface Context { waitUntil(promise: Promise<unknown>): void }
export interface SavedConfiguration {
  version: string; cluster: 'devnet' | 'mainnet-beta'; payment_mint: string; payment_program: string;
  fee_atomic: string; treasury: string; quote_decimals: number;
}
export interface RegisteredLaunch {
  cluster: 'devnet' | 'mainnet-beta'; mint: string; signature: string; creator: string; name: string; symbol: string;
  payment_mint: string; payment_program: string; fee_atomic: string; treasury: string; config_version: string;
  created_at: number; slot: number;
}
export interface RpcAccount { data: [string,string]; owner: string; executable: boolean; lamports: number; rentEpoch?: number }
export interface RpcContext<T> { context: {slot:number}; value: T }
export interface ParsedInstruction { programId: string; parsed?: string | { type: string; info: Record<string,unknown> } }
export interface TokenBalance { accountIndex: number; mint: string; owner?: string; programId?: string; uiTokenAmount: { amount: string; decimals: number } }
export interface ParsedTransaction {
  slot: number; blockTime: number | null;
  transaction: { signatures: string[]; message: { accountKeys: {pubkey:string;signer:boolean;writable:boolean}[]; instructions: ParsedInstruction[] } };
  meta: { err: unknown; preTokenBalances?: TokenBalance[]; postTokenBalances?: TokenBalance[] } | null;
}
export class PublicError extends Error {
  constructor(message: string,readonly status = 503,readonly code = 'SERVICE_UNAVAILABLE') { super(message); }
}
export function database(env: Env): D1Database {
  if (!env.DB) throw new PublicError('Le registre de tokens n’est pas encore configuré.');
  return env.DB;
}
