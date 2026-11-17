import { Buffer } from 'buffer';
import { PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,unpackMint } from '@solana/spl-token';
import source from '../config/platform.json';
import { assertCompatibleQuoteMint } from '../src/lib/quoteMint';
import { DBC_PROGRAM_ID,encodeDominionConfigInstruction,decodeDbcConfig,assertDominionDbcConfig } from '../src/lib/dbc';
import type { PlatformConfig } from '../src/types';
import { PublicError,database,type Env,type RpcAccount,type RpcContext,type SavedConfiguration,type SavedCurve } from './types';
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
  return {cluster,paymentMint:paymentMint.toBase58(),treasury:treasury.toBase58(),launch:source.launch,publicRpc,privateRpc};
}
export async function verifyNetwork(env: Env): Promise<void> {
  const cfg = settings(env);
  if (await rpc<string>(cfg.privateRpc,'getGenesisHash',[]) !== GENESIS[cfg.cluster]) throw new PublicError('Le réseau RPC ne correspond pas à la plateforme.');
}
export interface ParsedMint { data?: {parsed?: {info?: {symbol?:string;extensions?:{extension:string;state?:{symbol?:string;name?:string}}[]}}} }
export function quoteSymbolFromParsed(parsed: RpcContext<ParsedMint | null> | null,address: string): string {
  const metadata = parsed?.value?.data?.parsed?.info;
  const symbol = metadata?.extensions?.find(extension => extension.extension === 'tokenMetadata')?.state?.symbol || metadata?.symbol;
  return typeof symbol === 'string' && symbol.trim() && !/[\u0000-\u001f\u007f]/.test(symbol) ? symbol.trim().slice(0,24) : `${address.slice(0,4)}…${address.slice(-4)}`;
}
async function hashVersion(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2,'0')).join('').slice(0,16);
}
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
  const quoteSymbol = quoteSymbolFromParsed(parsed,cfg.paymentMint);
  const config: PlatformConfig = {mode:cfg.cluster,quoteMint:cfg.paymentMint,quoteSymbol,quoteDecimals:mint.decimals,quoteTokenProgram:info.owner.toBase58(),
    programId:null,rpcUrl:cfg.publicRpc,tradingEnabled:false,worldName:'Les territoires Solana',creationFeeAtomic:'0',
    treasury:cfg.treasury,configVersion:'',creationEnabled:env.CREATION_ENABLED === 'true' && Boolean(env.DB),launchModel:'dbc',dbcConfig:null,curve:source.launch};
  const encoded = encodeDominionConfigInstruction(config);
  config.curveVersion = await hashVersion({model:'dominion-dbc-v1',quoteMint:config.quoteMint,quoteTokenProgram:config.quoteTokenProgram,quoteDecimals:config.quoteDecimals,treasury:config.treasury,parameters:Buffer.from(encoded).toString('base64')});
  const stored = await database(env).prepare('SELECT * FROM curve_configs WHERE cluster = ? AND payment_mint = ? AND curve_version = ?').bind(cfg.cluster,cfg.paymentMint,config.curveVersion).first<SavedCurve>();
  if (stored) {
    const onChain = await rpc<RpcContext<RpcAccount | null>>(cfg.privateRpc,'getAccountInfo',[stored.config_address,{encoding:'base64',commitment:'finalized',minContextSlot:stored.slot}]);
    const account = accountInfo(onChain.value);
    if (!account || account.executable || !account.owner.equals(DBC_PROGRAM_ID) || onChain.context.slot < stored.slot) throw new PublicError('La configuration de courbe enregistrée ne peut pas être vérifiée.');
    try {assertDominionDbcConfig(decodeDbcConfig(account.data),config);} catch {throw new PublicError('La configuration de courbe ne correspond plus aux paramètres de la plateforme.');}
    config.dbcConfig = stored.config_address;config.tradingEnabled = config.creationEnabled;
  }
  config.configVersion = await hashVersion({cluster:cfg.cluster,paymentMint:cfg.paymentMint,treasury:cfg.treasury,creationFeeAtomic:'0',quoteTokenProgram:info.owner.toBase58(),launchModel:'dbc',curveVersion:config.curveVersion,dbcConfig:config.dbcConfig});
  return config;
}
export async function recordConfiguration(env: Env,config: PlatformConfig): Promise<void> {
  const row: SavedConfiguration = {version:config.configVersion,cluster:config.mode === 'devnet'?'devnet':'mainnet-beta',payment_mint:config.quoteMint!,payment_program:config.quoteTokenProgram,fee_atomic:config.creationFeeAtomic,treasury:config.treasury,quote_decimals:config.quoteDecimals,launch_model:config.launchModel ?? 'standard',curve_version:config.curveVersion ?? null,dbc_config:config.dbcConfig ?? null,curve_json:config.curve ? JSON.stringify(config.curve) : null};
  const db = database(env);
  const result = await db.prepare('INSERT INTO configurations (version,cluster,payment_mint,payment_program,fee_atomic,treasury,quote_decimals,launch_model,curve_version,dbc_config,curve_json) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(version) DO NOTHING')
    .bind(row.version,row.cluster,row.payment_mint,row.payment_program,row.fee_atomic,row.treasury,row.quote_decimals,row.launch_model!,row.curve_version ?? null,row.dbc_config ?? null,row.curve_json ?? null).run();
  if (!result.success) throw new PublicError('Impossible de mémoriser la configuration de création.');
  const saved = await db.prepare('SELECT * FROM configurations WHERE version = ? AND cluster = ?').bind(row.version,row.cluster).first<SavedConfiguration>();
  if (!saved || Object.entries(row).some(([key,value]) => saved[key as keyof SavedConfiguration] !== value)) throw new PublicError('Historique des configurations incohérent.');
}
