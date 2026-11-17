import { Buffer } from 'buffer';
import { PublicKey, type AccountInfo } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, unpackAccount, unpackMint } from '@solana/spl-token';
import { decodePool } from '../src/lib/chain';
import type { PlatformConfig, Snapshot, Token } from '../src/types';

/** Non-secret public settings belong in cloudflare.config.ts. SOLANA_RPC_URL may contain a secret. */
export interface Env {
  PLATFORM_MODE?: string;
  QUOTE_MINT?: string;
  QUOTE_SYMBOL?: string;
  PROGRAM_ID?: string;
  SOLANA_RPC_URL?: string;
  PUBLIC_SOLANA_RPC_URL?: string;
  TRADING_ENABLED?: string;
  MAINNET_ACK?: string;
  ASSETS?: { fetch(request: Request): Promise<Response> };
}
interface Context { waitUntil(promise: Promise<unknown>): void }
interface RpcAccount { data: [string, string]; owner: string; executable: boolean; lamports: number; rentEpoch?: number }
interface RpcContext<T> { context: { slot: number }; value: T }
interface PoolAccount { pubkey: string; account: RpcAccount }
interface RpcEnvelope<T> { result?: T; error?: { code: number; message: string } }
const POOL_DISCRIMINATOR = Buffer.from([241,154,109,4,17,177,109,188]);
const MAX_POOLS = 250;
const COLORS = ['#60c2b1','#ad93e8','#ee9879','#7eb6df','#d9ba68','#d98eb7','#93bf78','#83a0e3'];
const GENESIS = { devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1', 'mainnet-beta': '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp' };

class PublicError extends Error { constructor(message: string, readonly status = 503) { super(message); } }
function checkedUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new PublicError('Adresse RPC non valide.'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new PublicError('Le RPC doit utiliser HTTPS sans identifiants dans l’URL.');
  return url.href;
}
function address(value: string | undefined, label: string): PublicKey {
  try { if (!value) throw new Error(); return new PublicKey(value); } catch { throw new PublicError(`${label} non configuré ou non valide.`); }
}
export function baseConfig(env: Env): PlatformConfig {
  const mode = env.PLATFORM_MODE || 'demo';
  if (!['demo','devnet','mainnet-beta'].includes(mode)) throw new PublicError('Mode de plateforme non valide.');
  const typedMode = mode as PlatformConfig['mode'];
  const live = mode !== 'demo';
  const quoteMint = live ? address(env.QUOTE_MINT, 'Mint de paiement').toBase58() : null;
  const programId = live ? address(env.PROGRAM_ID, 'Programme Solana').toBase58() : null;
  const rpcUrl = checkedUrl(env.PUBLIC_SOLANA_RPC_URL || (mode === 'mainnet-beta' ? 'https://api.mainnet-beta.solana.com' : 'https://api.devnet.solana.com'));
  const symbol = (env.QUOTE_SYMBOL || 'DOM').trim();
  if (!/^[a-zA-Z0-9_-]{1,12}$/.test(symbol)) throw new PublicError('Symbole de paiement non valide.');
  return { mode: typedMode, quoteMint, quoteSymbol: symbol, quoteDecimals: 6, programId, rpcUrl,
    tradingEnabled: live && env.TRADING_ENABLED === 'true' && (mode !== 'mainnet-beta' || env.MAINNET_ACK === 'AUDITED_AND_APPROVED'),
    worldName: mode === 'demo' ? 'Monde de démonstration' : mode === 'devnet' ? 'Monde devnet' : 'Monde Solana' };
}

/** Limit every RPC response before parsing it; do not expose provider errors or private URLs. */
async function rpc<T>(endpoint: string, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok || !response.body) throw new PublicError('Le service Solana est momentanément indisponible.');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > 2_000_000) { await reader.cancel(); throw new PublicError('Réponse Solana trop volumineuse. Un indexeur est nécessaire.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const content = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { content.set(chunk, offset); offset += chunk.byteLength; }
  const envelope = JSON.parse(new TextDecoder().decode(content)) as RpcEnvelope<T>;
  if (envelope.error || envelope.result === undefined) throw new PublicError('Lecture Solana impossible. Réessayez dans quelques instants.');
  return envelope.result;
}
function accountInfo(raw: RpcAccount | null): AccountInfo<Buffer> | null {
  if (!raw) return null;
  if (!Array.isArray(raw.data) || raw.data[1] !== 'base64') throw new PublicError('Format de compte Solana inattendu.');
  return { data: Buffer.from(raw.data[0], 'base64'), owner: new PublicKey(raw.owner), executable: raw.executable, lamports: raw.lamports, rentEpoch: raw.rentEpoch };
}
async function verifiedConfig(env: Env, config: PlatformConfig): Promise<PlatformConfig> {
  if (config.mode === 'demo') return config;
  const endpoint = checkedUrl(env.SOLANA_RPC_URL || config.rpcUrl);
  const [genesis, accounts] = await Promise.all([
    rpc<string>(endpoint, 'getGenesisHash', []),
    rpc<RpcContext<(RpcAccount | null)[]>>(endpoint, 'getMultipleAccounts', [[config.programId, config.quoteMint], { encoding: 'base64', commitment: 'confirmed' }]),
  ]);
  if (genesis !== GENESIS[config.mode]) throw new PublicError('Le réseau RPC ne correspond pas au monde configuré.');
  if (!accounts.value[0]?.executable) throw new PublicError('Le programme Solana n’est pas encore déployé sur ce réseau.');
  const mint = unpackMint(new PublicKey(config.quoteMint!), accountInfo(accounts.value[1]), TOKEN_PROGRAM_ID);
  if (!mint.isInitialized || mint.decimals > 18 || mint.freezeAuthority) throw new PublicError('Le token de paiement doit être un SPL classique, initialisé et sans autorité de gel (18 décimales maximum).');
  return { ...config, quoteDecimals: mint.decimals };
}
function colorFor(mint: string): string {
  let value = 0; for (const c of mint) value = ((value * 31) + c.charCodeAt(0)) >>> 0;
  return COLORS[value % COLORS.length];
}
export async function readSnapshot(env: Env, config: PlatformConfig): Promise<Snapshot> {
  if (config.mode === 'demo') return { tokens: [], updatedAt: new Date().toISOString(), slot: null, source: 'demo' };
  const endpoint = checkedUrl(env.SOLANA_RPC_URL || config.rpcUrl);
  const program = new PublicKey(config.programId!); const quoteMint = new PublicKey(config.quoteMint!);
  const result = await rpc<RpcContext<PoolAccount[]>>(endpoint, 'getProgramAccounts', [program.toBase58(), {
    encoding: 'base64', commitment: 'confirmed', withContext: true,
    filters: [{ memcmp: { offset: 0, bytes: POOL_DISCRIMINATOR.toString('base64'), encoding: 'base64' } }, { memcmp: { offset: 72, bytes: quoteMint.toBase58() } }],
  }]);
  if (result.value.length > MAX_POOLS) throw new PublicError('Ce monde dépasse 250 marchés : activez un indexeur avant de continuer.');
  const pools = result.value.map(item => {
    const raw = accountInfo(item.account)!;
    if (!raw.owner.equals(program) || raw.executable || !raw.data.subarray(0,8).equals(POOL_DISCRIMINATOR)) throw new PublicError('Compte de marché non valide.');
    const data = decodePool(raw.data);
    const mint = new PublicKey(data.mint);
    const [expected] = PublicKey.findProgramAddressSync([Buffer.from('pool'),mint.toBuffer()],program);
    const pool = new PublicKey(item.pubkey);
    if (!pool.equals(expected) || data.quoteMint !== quoteMint.toBase58()
      || data.tokenVault !== getAssociatedTokenAddressSync(mint,pool,true).toBase58()
      || data.quoteVault !== getAssociatedTokenAddressSync(quoteMint,pool,true).toBase58()) throw new PublicError('Adresses du marché non valides.');
    return { ...data, pool: item.pubkey };
  });
  let minimumSlot = result.context.slot;
  let latestSlot = result.context.slot;
  const tokens: Token[] = [];
  // Each pool's mint and two reserves are read atomically within one RPC bank snapshot.
  for (let index = 0; index < pools.length; index += 33) {
    const batch = pools.slice(index,index + 33);
    const addresses = batch.flatMap(pool => [pool.mint,pool.tokenVault,pool.quoteVault]);
    const accounts = await rpc<RpcContext<(RpcAccount | null)[]>>(endpoint,'getMultipleAccounts', [addresses,{
      encoding:'base64',commitment:'confirmed',minContextSlot:latestSlot,
    }]);
    if (accounts.value.length !== addresses.length || accounts.context.slot < latestSlot) throw new PublicError('Lecture Solana incohérente.');
    latestSlot = accounts.context.slot;
    if (index === 0) minimumSlot = accounts.context.slot;
    batch.forEach((pool,i) => {
      const mint = unpackMint(new PublicKey(pool.mint),accountInfo(accounts.value[i*3]),TOKEN_PROGRAM_ID);
      const base = unpackAccount(new PublicKey(pool.tokenVault),accountInfo(accounts.value[i*3+1]),TOKEN_PROGRAM_ID);
      const quote = unpackAccount(new PublicKey(pool.quoteVault),accountInfo(accounts.value[i*3+2]),TOKEN_PROGRAM_ID);
      if (!mint.isInitialized || mint.decimals !== 6 || mint.mintAuthority || mint.freezeAuthority
        || !base.owner.equals(new PublicKey(pool.pool)) || !quote.owner.equals(new PublicKey(pool.pool))
        || !base.mint.equals(new PublicKey(pool.mint)) || !quote.mint.equals(quoteMint)
        || !base.isInitialized || !quote.isInitialized || base.isFrozen || quote.isFrozen
        || base.delegate || quote.delegate || base.closeAuthority || quote.closeAuthority
        || base.amount === 0n || quote.amount === 0n || base.amount > mint.supply || mint.supply > BigInt(pool.supply)) throw new PublicError('Réserves du marché non valides.');
      const price = (Number(quote.amount) / 10 ** config.quoteDecimals) / (Number(base.amount) / 10 ** mint.decimals);
      const marketCap = price * (Number(mint.supply - base.amount) / 10 ** mint.decimals);
      if (!Number.isFinite(price) || !Number.isFinite(marketCap)) throw new PublicError('Valorisation du marché non valide.');
      tokens.push({ mint:pool.mint,pool:pool.pool,name:pool.name,symbol:pool.symbol,creator:pool.creator,
        supply:mint.supply.toString(),baseReserve:base.amount.toString(),quoteReserve:quote.amount.toString(),decimals:mint.decimals,
        quoteDecimals:config.quoteDecimals,marketCap,price,change24h:null,createdAt:pool.createdAt,color:colorFor(pool.mint) });
    });
  }
  return { tokens,updatedAt:new Date().toISOString(),slot:minimumSlot,source:'chain' };
}
function headers(env: Env): Headers {
  let rpcOrigin = 'https://api.devnet.solana.com';
  try { rpcOrigin = new URL(checkedUrl(env.PUBLIC_SOLANA_RPC_URL || (env.PLATFORM_MODE === 'mainnet-beta' ? 'https://api.mainnet-beta.solana.com' : rpcOrigin))).origin; } catch { /* Fail-closed config route reports the issue. */ }
  return new Headers({
    'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'strict-origin-when-cross-origin',
    'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' ${rpcOrigin} ${rpcOrigin.replace('https:','wss:')}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`,
  });
}
function json(value: unknown,status = 200): Response { return Response.json(value,{ status,headers:{ 'Cache-Control':'no-store' } }); }
export default {
  async fetch(request: Request,env: Env,ctx: Context): Promise<Response> {
    const url = new URL(request.url);
    const secureHeaders = headers(env);
    let response: Response;
    try {
      if (!['GET','HEAD'].includes(request.method)) response = json({ error:'Méthode non autorisée.' },405);
      else if (url.pathname === '/api/health') response = json({ status:'ok',service:'solana-dominion',version:'0.1.0' });
      else if (url.pathname === '/api/config' || url.pathname === '/api/territories') {
        const config = baseConfig(env);
        const cacheStore = typeof caches !== 'undefined' ? (caches as CacheStorage & { default?: Cache }).default : undefined;
        // Never let user query parameters fragment the cache or alter the world.
        const cacheUrl = new URL(url.origin + url.pathname);
        cacheUrl.searchParams.set('world',`${config.mode}:${config.quoteMint}:${config.programId}:${env.QUOTE_SYMBOL || ''}:${env.TRADING_ENABLED || ''}:${env.MAINNET_ACK || ''}:${config.rpcUrl}`);
        const key = new Request(cacheUrl.toString());
        const hit = config.mode !== 'demo' ? await cacheStore?.match(key) : undefined;
        if (hit) response = hit;
        else {
          const verified = await verifiedConfig(env,config);
          response = json(url.pathname === '/api/config' ? verified : await readSnapshot(env,verified));
          if (config.mode !== 'demo' && cacheStore) {
            const cached = response.clone(); cached.headers.set('Cache-Control','public, max-age=10');
            ctx.waitUntil(cacheStore.put(key,cached));
          }
        }
      } else if (url.pathname.startsWith('/api/')) response = json({ error:'Route inconnue.' },404);
      else response = env.ASSETS ? await env.ASSETS.fetch(request) : new Response('Not found',{status:404});
    } catch (error) {
      // Do not log exception messages: RPC libraries may include provider URLs containing secrets.
      console.error(JSON.stringify({ event:'request_failed',path:url.pathname,type:error instanceof PublicError ? 'public_error' : 'internal_error' }));
      response = json({ error:error instanceof PublicError ? error.message : 'Impossible de vérifier les données Solana. Vérifiez la configuration puis réessayez.' },error instanceof PublicError ? error.status : 503);
    }
    const finalHeaders = new Headers(response.headers);
    secureHeaders.forEach((value,key) => finalHeaders.set(key,value));
    // CDN caching is handled explicitly above; never allow stale browser configuration.
    if (url.pathname.startsWith('/api/')) finalHeaders.set('Cache-Control','no-store');
    if (response.status === 405) finalHeaders.set('Allow','GET, HEAD');
    return new Response(request.method === 'HEAD' ? null : response.body,{status:response.status,headers:finalHeaders});
  },
};
