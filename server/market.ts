import { PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,unpackMint } from '@solana/spl-token';
import { deriveDbcPoolAddress,deriveDbcTokenVaultAddress,getPriceFromSqrtPrice,type TokenDecimal,type PoolConfig } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { DBC_PROGRAM_ID,DBC_SUPPLY,decodeDbcConfig,decodeDbcPool,assertDominionDbcConfig } from '../src/lib/dbc';
import { curvePolicy } from './curves';
import type { PlatformConfig,Snapshot,Token } from '../src/types';
import { assertCompatibleQuoteMint } from '../src/lib/quoteMint';
import { PublicError,database,type Env,type RegisteredLaunch,type RpcAccount,type RpcContext,type SavedCurve } from './types';
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
  const cfg = settings(env),db = database(env);
  const rows = await db.prepare('SELECT * FROM launches WHERE cluster = ? ORDER BY created_at DESC,mint LIMIT 1001').bind(cfg.cluster).all<RegisteredLaunch>();
  if (!rows.success || !rows.results) throw new PublicError('Le registre de tokens est indisponible.');
  if (rows.results.length > 1000) throw new PublicError('Le registre dépasse la capacité de cette version. Aucun territoire partiel n’est affiché.');
  let platformMint: PublicKey,platformProgram: PublicKey;
  try {if (!config.quoteMint) throw new Error();platformMint = new PublicKey(config.quoteMint);platformProgram = new PublicKey(config.quoteTokenProgram);}
  catch {throw new PublicError('Le mint de la plateforme est absent ou invalide.');}
  if (!platformProgram.equals(TOKEN_PROGRAM_ID) && !platformProgram.equals(TOKEN_2022_PROGRAM_ID)) throw new PublicError('Programme du token de plateforme non pris en charge.');
  type Definition = {mint:string;name:string;symbol:string;creator:string;createdAt:number;isPlatform:boolean;row?:RegisteredLaunch};
  const definitions = new Map<string,Definition>();
  for (const row of rows.results) definitions.set(row.mint,{mint:row.mint,name:row.name,symbol:row.symbol,creator:row.creator,createdAt:row.created_at,isPlatform:false,row});
  const platformAddress = platformMint.toBase58(),registeredPlatform = definitions.get(platformAddress);
  definitions.set(platformAddress,{mint:platformAddress,name:config.quoteSymbol,symbol:config.quoteSymbol,
    creator:registeredPlatform?.creator ?? '',createdAt:registeredPlatform?.createdAt ?? 0,isPlatform:true,row:registeredPlatform?.row});
  const launches = [...definitions.values()];
  const neededCurves = new Set(launches.filter(item => item.row?.model === 'dbc').map(item => item.row!.curve_config));
  if (neededCurves.has(null) || neededCurves.has(undefined)) throw new PublicError('Une configuration de courbe enregistrée est manquante.');
  const decodedCurves = new Map<string,{policy:PlatformConfig;curve:PoolConfig}>();
  let latestSlot = 0;
  if (neededCurves.size) {
    const saved = await db.prepare('SELECT * FROM curve_configs WHERE cluster = ?').bind(cfg.cluster).all<SavedCurve>();
    if (!saved.success || !saved.results) throw new PublicError('Les configurations de marché sont indisponibles.');
    const active = saved.results.filter(row => neededCurves.has(row.config_address));
    if (active.length !== neededCurves.size) throw new PublicError('Une courbe du registre ne peut pas être vérifiée.');
    for (let start = 0;start < active.length;start += 100) {
      const batch = active.slice(start,start + 100);
      const data = await rpc<RpcContext<(RpcAccount | null)[]>>(cfg.privateRpc,'getMultipleAccounts',[batch.map(row => row.config_address),{encoding:'base64',commitment:'finalized',...(latestSlot ? {minContextSlot:latestSlot} : {})}]);
      if (data.value.length !== batch.length || data.context.slot < latestSlot) throw new PublicError('Lecture des politiques de marché incohérente.');latestSlot = data.context.slot;
      batch.forEach((row,index) => {
        const info = accountInfo(data.value[index]);
        if (!info || info.executable || !info.owner.equals(DBC_PROGRAM_ID)) throw new PublicError('Une configuration ne dépend pas du programme Meteora attendu.');
        const policy = curvePolicy(row);
        try {const curve = decodeDbcConfig(info.data);assertDominionDbcConfig(curve,policy);decodedCurves.set(row.config_address,{policy,curve});}
        catch {throw new PublicError('Une politique de courbe ne respecte plus ses paramètres enregistrés.');}
      });
    }
  }
  const tokens: Token[] = [],curvePrices = new Map<string,{price:number;quoteMint:string}>();
  let minimumSlot: number | null = null,cursor = 0;
  while (cursor < launches.length) {
    const addresses:string[] = [],batch:{definition:Definition;mintIndex:number;poolIndex?:number}[] = [];
    while (cursor < launches.length) {
      const definition = launches[cursor],dbc = definition.row?.model === 'dbc';
      if (addresses.length + (dbc ? 2 : 1) > 100) break;
      const mintIndex = addresses.length;addresses.push(definition.mint);
      if (dbc && !definition.row?.pool) throw new PublicError('Adresse du marché de courbe absente.');
      const poolIndex = dbc ? addresses.length : undefined;if (dbc) addresses.push(definition.row!.pool!);
      batch.push({definition,mintIndex,poolIndex});cursor++;
    }
    const result = await rpc<RpcContext<(RpcAccount | null)[]>>(cfg.privateRpc,'getMultipleAccounts',[addresses,{encoding:'base64',commitment:'finalized',...(latestSlot ? {minContextSlot:latestSlot} : {})}]);
    if (result.value.length !== addresses.length || result.context.slot < latestSlot) throw new PublicError('Lecture des offres de tokens incohérente.');
    latestSlot = result.context.slot;minimumSlot ??= latestSlot;
    for (const item of batch) {
      const launch = item.definition,row = launch.row,dbc = row?.model === 'dbc',curveData = dbc ? decodedCurves.get(row.curve_config!) : undefined;
      if (dbc && !curveData) throw new PublicError('La politique de ce marché est absente.');
      const tokenProgram = dbc ? (curveData!.curve.tokenType === 1 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID) : launch.isPlatform ? platformProgram : TOKEN_PROGRAM_ID;
      const info = accountInfo(result.value[item.mintIndex]);
      if (!info || !info.owner.equals(tokenProgram) || info.executable || (!launch.isPlatform && !dbc && info.data.length !== 82)) throw new PublicError('Un mint du territoire ne peut pas être vérifié sur Solana.');
      const mint = unpackMint(new PublicKey(launch.mint),info,tokenProgram);
      if (launch.isPlatform) {
        try {assertCompatibleQuoteMint(mint,tokenProgram);} catch (error) {throw new PublicError(error instanceof Error ? error.message : 'Mint de plateforme incompatible.');}
        if (!tokenProgram.equals(platformProgram) || mint.decimals !== config.quoteDecimals) throw new PublicError('Les décimales ou le programme du token de plateforme ont changé depuis la configuration.');
      } else if (!mint.isInitialized || mint.decimals !== 6 || mint.mintAuthority || mint.freezeAuthority || mint.supply > DBC_SUPPLY) throw new PublicError('L’offre ou les autorités d’un token enregistré sont incohérentes.');
      const token:Token = {mint:launch.mint,pool:dbc ? row.pool! : '',name:launch.name,symbol:launch.symbol,color:colorFor(launch.mint),creator:launch.creator,supply:mint.supply.toString(),baseReserve:'0',quoteReserve:'0',decimals:mint.decimals,quoteDecimals:dbc ? curveData!.policy.quoteDecimals : config.quoteDecimals,marketCap:0,price:0,change24h:null,createdAt:launch.createdAt,isPlatform:launch.isPlatform,launchModel:dbc ? 'dbc' : 'standard'};
      if (dbc) {
        const poolInfo = accountInfo(result.value[item.poolIndex!]);
        if (!poolInfo || poolInfo.executable || !poolInfo.owner.equals(DBC_PROGRAM_ID)) throw new PublicError('Le marché n’appartient pas au programme Meteora attendu.');
        const state = decodeDbcPool(poolInfo.data).poolState,policy = curveData!.policy,curve = curveData!.curve,poolAddress = new PublicKey(row.pool!);
        if (!deriveDbcPoolAddress(curve.quoteMint,mint.address,new PublicKey(row.curve_config!)).equals(poolAddress) || state.config.toBase58() !== row.curve_config || state.baseMint.toBase58() !== launch.mint || row.payment_mint !== policy.quoteMint || state.poolType !== curve.tokenType || mint.decimals !== curve.tokenDecimal || state.hasSwap !== 1
          || !state.baseVault.equals(deriveDbcTokenVaultAddress(poolAddress,mint.address)) || !state.quoteVault.equals(deriveDbcTokenVaultAddress(poolAddress,curve.quoteMint))) throw new PublicError('Les comptes du marché de courbe sont incohérents.');
        if (mint.mintAuthority || mint.freezeAuthority || mint.supply > DBC_SUPPLY) throw new PublicError('Les autorités ou l’offre du marché ne sont pas conformes.');
        token.baseReserve = state.baseReserve.toString();token.quoteReserve = state.quoteReserve.toString();token.migrated = state.isMigrated !== 0;
        if (token.migrated) token.marketUrl = `https://jup.ag/swap/${curve.quoteMint.toBase58()}-${launch.mint}`;
        token.migrationReady = !token.migrated && state.quoteReserve.gte(curve.migrationQuoteThreshold) && state.migrationProgress === 2;
        // Each historical market keeps its own settlement asset and canonical curve.
        token.marketConfig = {...policy,rpcUrl:config.rpcUrl,dbcConfig:row.curve_config!,creationEnabled:config.creationEnabled,tradingEnabled:env.CREATION_ENABLED === 'true' && Boolean(env.DB)};
        if (!token.migrated) {
          const price = getPriceFromSqrtPrice(state.sqrtPrice,mint.decimals as TokenDecimal,policy.quoteDecimals).toNumber();
          if (!Number.isFinite(price) || price <= 0) throw new PublicError('Prix de courbe non valide.');
          curvePrices.set(token.mint,{price,quoteMint:curve.quoteMint.toBase58()});
        }
      }
      tokens.push(token);
    }
  }
  // Old worlds keep their own quote asset after a platform-token rotation. Those
  // conversion assets are priced without being added as extra territories.
  const requested = [...new Set([...tokens.map(token => token.mint),...curvePrices.values()].map(value => typeof value === 'string' ? value : value.quoteMint))];
  const quotes = cfg.cluster === 'mainnet-beta' ? await prices(requested) : new Map<string,{price:number;change:number|null}>();
  for (const token of tokens) {
    const curve = curvePrices.get(token.mint),quote = curve ? quotes.get(curve.quoteMint) : quotes.get(token.mint);
    if (!quote) continue;
    const price = curve ? curve.price * quote.price : quote.price,cap = price * (Number(token.supply) / 10 ** token.decimals);
    if (!Number.isFinite(price) || !Number.isFinite(cap)) throw new PublicError('La cotation d’un token est hors limites.');
    token.price = price;token.marketCap = cap;token.change24h = curve ? null : quote.change;
  }
  return {tokens,updatedAt:new Date().toISOString(),slot:minimumSlot,source:'chain',currency:'USD'};
}
