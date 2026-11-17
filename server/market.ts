import { PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID,unpackMint } from '@solana/spl-token';
import type { PlatformConfig,Snapshot,Token } from '../src/types';
import { PublicError,database,type Env,type RegisteredLaunch,type RpcAccount,type RpcContext } from './types';
import { accountInfo,boundedJson,rpc } from './rpc';
import { settings } from './settings';
const COLORS = ['#60c2b1','#ad93e8','#ee9879','#7eb6df','#d9ba68','#d98eb7','#93bf78','#83a0e3'];
interface DexPair { chainId?:string;pairAddress?:string;baseToken?:{address?:string};priceUsd?:string;liquidity?:{usd?:number};priceChange?:{h24?:number} }
function colorFor(mint: string): string {let value = 0;for (const c of mint) value = ((value * 31) + c.charCodeAt(0)) >>> 0;return COLORS[value % COLORS.length];}
async function prices(mints: string[]): Promise<Map<string,{price:number;change:number|null}>> {
  const selected = new Map<string,{price:number;change:number|null;liquidity:number;pair:string}>();
  for (let start = 0;start < mints.length;start += 30) {
    const batch = mints.slice(start,start + 30),wanted = new Set(batch);
    // Documented endpoint: https://docs.dexscreener.com/api/reference, maximum 30 addresses.
    const response = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${batch.join(',')}`,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(8_000)});
    const pairs = await boundedJson<DexPair[]>(response);
    if (!Array.isArray(pairs)) throw new PublicError('Réponse de cotation non valide.');
    for (const pair of pairs) {
      const mint = pair.baseToken?.address;
      if (!mint || !wanted.has(mint) || pair.chainId !== 'solana') continue;
      const price = Number(pair.priceUsd),liquidity = pair.liquidity?.usd ?? 0;
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(liquidity) || liquidity <= 0) continue;
      const previous = selected.get(mint),pairAddress = pair.pairAddress || '';
      if (previous && (previous.liquidity > liquidity || (previous.liquidity === liquidity && previous.pair <= pairAddress))) continue;
      const change = pair.priceChange?.h24;
      selected.set(mint,{price,liquidity,pair:pairAddress,change:typeof change === 'number' && Number.isFinite(change) ? change : null});
    }
  }
  return selected;
}
export async function readSnapshot(env: Env,config: PlatformConfig): Promise<Snapshot> {
  const cfg = settings(env);
  const rows = await database(env).prepare('SELECT * FROM launches WHERE cluster = ? ORDER BY created_at DESC,mint LIMIT 1001').bind(cfg.cluster).all<RegisteredLaunch>();
  if (!rows.success || !rows.results) throw new PublicError('Le registre de tokens est indisponible.');
  if (rows.results.length > 1000) throw new PublicError('Le registre dépasse la capacité de cette version. Aucun territoire partiel n’est affiché.');
  const launches = rows.results;
  if (!launches.length) return {tokens:[],updatedAt:new Date().toISOString(),slot:null,source:'chain',currency:'USD'};
  const tokens: Token[] = [];let minimumSlot: number | null = null,latestSlot = 0;
  for (let start = 0;start < launches.length;start += 100) {
    const batch = launches.slice(start,start + 100);
    const result = await rpc<RpcContext<(RpcAccount | null)[]>>(cfg.privateRpc,'getMultipleAccounts',[batch.map(row => row.mint),{encoding:'base64',commitment:'finalized',...(latestSlot ? {minContextSlot:latestSlot} : {})}]);
    if (result.value.length !== batch.length || result.context.slot < latestSlot) throw new PublicError('Lecture des offres de tokens incohérente.');
    latestSlot = result.context.slot;minimumSlot ??= latestSlot;
    batch.forEach((launch,index) => {
      const info = accountInfo(result.value[index]);
      if (!info || !info.owner.equals(TOKEN_PROGRAM_ID) || info.executable || info.data.length !== 82) throw new PublicError('Un mint enregistré ne peut pas être vérifié sur Solana.');
      const mint = unpackMint(new PublicKey(launch.mint),info,TOKEN_PROGRAM_ID);
      if (!mint.isInitialized || mint.decimals !== 6 || mint.mintAuthority || mint.freezeAuthority || mint.supply > 1_000_000_000_000_000n) throw new PublicError('L’offre ou les autorités d’un token enregistré sont incohérentes.');
      tokens.push({mint:launch.mint,pool:'',name:launch.name,symbol:launch.symbol,color:colorFor(launch.mint),creator:launch.creator,supply:mint.supply.toString(),baseReserve:'0',quoteReserve:'0',decimals:6,quoteDecimals:config.quoteDecimals,marketCap:0,price:0,change24h:null,createdAt:launch.created_at});
    });
  }
  const quotes = cfg.cluster === 'mainnet-beta' ? await prices(tokens.map(token => token.mint)) : new Map<string,{price:number;change:number|null}>();
  for (const token of tokens) {
    const quote = quotes.get(token.mint);if (!quote) continue;
    const cap = quote.price * (Number(token.supply) / 10 ** token.decimals);
    if (!Number.isFinite(cap)) throw new PublicError('La cotation d’un token est hors limites.');
    token.price = quote.price;token.marketCap = cap;token.change24h = quote.change;
  }
  return {tokens,updatedAt:new Date().toISOString(),slot:minimumSlot,source:'chain',currency:'USD'};
}
