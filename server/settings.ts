import { PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,unpackMint } from '@solana/spl-token';
import source from '../config/platform.json';
import { assertCompatibleQuoteMint } from '../src/lib/quoteMint';
import { parseUnits } from '../src/lib/math';
import type { PlatformConfig } from '../src/types';
import { PublicError,database,type Env,type RpcAccount,type RpcContext,type SavedConfiguration } from './types';
import { accountInfo,checkedUrl,rpc } from './rpc';
const GENESIS = {devnet:'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG','mainnet-beta':'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'};
export function settings(env: Env) {
  if (source.cluster !== 'devnet' && source.cluster !== 'mainnet-beta') throw new PublicError('Réseau de plateforme non valide.');
  let paymentMint: PublicKey,treasury: PublicKey;
  try {paymentMint = new PublicKey(source.paymentMint);treasury = new PublicKey(source.treasury);} catch {throw new PublicError('Mint de paiement ou trésorerie non valide.');}
  if (!PublicKey.isOnCurve(treasury.toBytes())) throw new PublicError('La trésorerie doit être un wallet Solana.');
  const cluster: 'devnet'|'mainnet-beta' = source.cluster;
  const publicRpc = checkedUrl(env.PUBLIC_SOLANA_RPC_URL || `https://api.${cluster}.solana.com`);
  const privateRpc = checkedUrl(env.SOLANA_RPC_URL || publicRpc);
  return {cluster,paymentMint:paymentMint.toBase58(),treasury:treasury.toBase58(),creationFeeTokens:source.creationFeeTokens,publicRpc,privateRpc};
}
export async function verifyNetwork(env: Env): Promise<void> {
  const cfg = settings(env);
  if (await rpc<string>(cfg.privateRpc,'getGenesisHash',[]) !== GENESIS[cfg.cluster]) throw new PublicError('Le réseau RPC ne correspond pas à la plateforme.');
}
interface ParsedMint { data?: {parsed?: {info?: {symbol?:string;extensions?:{extension:string;state?:{symbol?:string;name?:string}}[]}}} }
export async function resolveConfig(env: Env): Promise<PlatformConfig> {
  const cfg = settings(env);
  const [raw,parsed] = await Promise.all([
    rpc<RpcContext<RpcAccount | null>>(cfg.privateRpc,'getAccountInfo',[cfg.paymentMint,{encoding:'base64',commitment:'finalized'}]),
    rpc<RpcContext<ParsedMint | null>>(cfg.privateRpc,'getAccountInfo',[cfg.paymentMint,{encoding:'jsonParsed',commitment:'finalized'}]).catch(() => null),
    verifyNetwork(env),
  ]);
  const info = accountInfo(raw.value);
  if (!info || (!info.owner.equals(TOKEN_PROGRAM_ID) && !info.owner.equals(TOKEN_2022_PROGRAM_ID))) throw new PublicError('Le token de paiement n’est pas un mint SPL pris en charge.');
  const mint = unpackMint(new PublicKey(cfg.paymentMint),info,info.owner);
  try {assertCompatibleQuoteMint(mint,info.owner);} catch (error) {throw new PublicError(error instanceof Error ? error.message : 'Mint de paiement incompatible.');}
  let fee: bigint;try {fee = parseUnits(cfg.creationFeeTokens,mint.decimals);} catch {throw new PublicError('Frais de création non valides.');}
  if (fee <= 0n) throw new PublicError('Les frais de création doivent être positifs.');
  const metadata = parsed?.value?.data?.parsed?.info;
  const symbol = metadata?.extensions?.find(extension => extension.extension === 'tokenMetadata')?.state?.symbol || metadata?.symbol;
  const quoteSymbol = typeof symbol === 'string' && symbol.trim() && !/[\u0000-\u001f\u007f]/.test(symbol) ? symbol.trim().slice(0,24) : `${cfg.paymentMint.slice(0,4)}…${cfg.paymentMint.slice(-4)}`;
  const identity = JSON.stringify({cluster:cfg.cluster,paymentMint:cfg.paymentMint,treasury:cfg.treasury,creationFeeAtomic:fee.toString(),quoteTokenProgram:info.owner.toBase58()});
  const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity));
  const configVersion = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2,'0')).join('').slice(0,16);
  return {mode:cfg.cluster,quoteMint:cfg.paymentMint,quoteSymbol,quoteDecimals:mint.decimals,quoteTokenProgram:info.owner.toBase58(),
    programId:null,rpcUrl:cfg.publicRpc,tradingEnabled:false,worldName:'Les territoires Solana',creationFeeAtomic:fee.toString(),
    treasury:cfg.treasury,configVersion,creationEnabled:env.CREATION_ENABLED === 'true' && Boolean(env.DB)};
}
export async function recordConfiguration(env: Env,config: PlatformConfig): Promise<void> {
  const row: SavedConfiguration = {version:config.configVersion,cluster:config.mode === 'devnet'?'devnet':'mainnet-beta',payment_mint:config.quoteMint!,payment_program:config.quoteTokenProgram,fee_atomic:config.creationFeeAtomic,treasury:config.treasury,quote_decimals:config.quoteDecimals};
  const db = database(env);
  const result = await db.prepare('INSERT INTO configurations (version,cluster,payment_mint,payment_program,fee_atomic,treasury,quote_decimals) VALUES (?,?,?,?,?,?,?) ON CONFLICT(version) DO NOTHING')
    .bind(row.version,row.cluster,row.payment_mint,row.payment_program,row.fee_atomic,row.treasury,row.quote_decimals).run();
  if (!result.success) throw new PublicError('Impossible de mémoriser la configuration de création.');
  const saved = await db.prepare('SELECT * FROM configurations WHERE version = ? AND cluster = ?').bind(row.version,row.cluster).first<SavedConfiguration>();
  if (!saved || Object.entries(row).some(([key,value]) => saved[key as keyof SavedConfiguration] !== value)) throw new PublicError('Historique des configurations incohérent.');
}
