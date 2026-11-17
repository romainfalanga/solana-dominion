import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { Buffer } from 'buffer';
import { Keypair,PublicKey } from '@solana/web3.js';
import { ExtensionType,MintLayout,TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { readSnapshot } from '../server/market';
import pumpFixture from './fixtures/pump-quote.json';
import {WRAPPED_SOL} from '../server/pump';
import { layoutTerritories } from '../src/lib/territories';
import type { PlatformConfig } from '../src/types';
import type { D1Database,D1Statement,Env,RegisteredLaunch,RpcAccount } from '../server/types';

const platform = Keypair.generate().publicKey.toBase58(),replacement = Keypair.generate().publicKey.toBase58(),launched = Keypair.generate().publicKey.toBase58();
const creator = Keypair.generate().publicKey.toBase58();
function config(mint = platform,program = TOKEN_PROGRAM_ID,decimals = 6): PlatformConfig {
  return {mode:'mainnet-beta',quoteMint:mint,quoteSymbol:'ACTUAL',quoteDecimals:decimals,quoteTokenProgram:program.toBase58(),programId:null,rpcUrl:'https://api.mainnet-beta.solana.com',tradingEnabled:false,worldName:'Test',creationFeeAtomic:'1000000',treasury:creator,configVersion:'0123456789abcdef',creationEnabled:true};
}
function registered(mint: string): RegisteredLaunch {
  return {cluster:'mainnet-beta',mint,signature:'receipt',creator,name:'Registered token',symbol:'REG',payment_mint:platform,payment_program:TOKEN_PROGRAM_ID.toBase58(),fee_atomic:'1000000',treasury:creator,config_version:'0123456789abcdef',created_at:1700000000,slot:1};
}
function mintAccount(supply: bigint,decimals = 6,program = TOKEN_PROGRAM_ID,metadata = false): RpcAccount {
  const base = Buffer.alloc(MintLayout.span);
  MintLayout.encode({mintAuthorityOption:0,mintAuthority:PublicKey.default,supply,decimals,isInitialized:true,freezeAuthorityOption:0,freezeAuthority:PublicKey.default},base);
  let data = base;
  if (metadata) {
    const header = Buffer.alloc(166);base.copy(header);header[165] = 1;
    const pointer = Buffer.alloc(68);pointer.writeUInt16LE(ExtensionType.MetadataPointer);pointer.writeUInt16LE(64,2);
    const tokenMetadata = Buffer.alloc(84);tokenMetadata.writeUInt16LE(ExtensionType.TokenMetadata);tokenMetadata.writeUInt16LE(80,2);
    data = Buffer.concat([header,pointer,tokenMetadata]);
  }
  return {data:[data.toString('base64'),'base64'],owner:program.toBase58(),executable:false,lamports:1};
}
let rows: RegisteredLaunch[],accounts:Map<string,RpcAccount>,pairs:unknown[],rpcBatches:string[][],dexBatches:string[][];
function environment(): Env {
  const statement: D1Statement = {
    bind(){return statement;},async first(){throw new Error('Unexpected first');},async run(){throw new Error('Unexpected mutation');},
    async all<T>(){return {success:true,results:structuredClone(rows) as T[]};},
  };
  const DB: D1Database = {prepare:() => statement};
  return {DB,SOLANA_RPC_URL:'https://rpc.example'};
}
function quote(mint: string,price: string,liquidity = 1000) {
  return {chainId:'solana',pairAddress:`pair-${mint}`,baseToken:{address:mint},priceUsd:price,liquidity:{usd:liquidity},priceChange:{h24:2}};
}
beforeEach(() => {
  rows = [];accounts = new Map();pairs = [];rpcBatches = [];dexBatches = [];
  vi.stubGlobal('fetch',vi.fn(async (url: string | URL | Request,init?:RequestInit) => {
    if (String(url).startsWith('https://api.dexscreener.com/')) {dexBatches.push(String(url).split('/').at(-1)!.split(','));return Response.json(pairs);}
    const request = JSON.parse(String(init?.body)) as {method:string;params:[string[],unknown]};
    expect(request.method).toBe('getMultipleAccounts');rpcBatches.push(request.params[0]);
    return Response.json({jsonrpc:'2.0',id:1,result:{context:{slot:123},value:request.params[0].map(mint => accounts.get(mint) ?? null)}});
  }));
});
afterEach(() => {vi.unstubAllGlobals();vi.restoreAllMocks();});

describe('platform token participates in the same territory competition',() => {
  it('includes a real metadata-only Token-2022 platform mint even with an empty registry',async () => {
    const supply = 2_000_000_000_000_000_000n;
    accounts.set(platform,mintAccount(supply,9,TOKEN_2022_PROGRAM_ID,true));pairs = [quote(platform,'0.5')];
    const snapshot = await readSnapshot(environment(),config(platform,TOKEN_2022_PROGRAM_ID,9));
    expect(snapshot.tokens).toHaveLength(1);
    expect(snapshot.tokens[0]).toMatchObject({mint:platform,name:'ACTUAL',symbol:'ACTUAL',isPlatform:true,supply:supply.toString(),decimals:9,price:0.5,marketCap:1_000_000_000,creator:'',createdAt:0});
    expect(snapshot).toMatchObject({source:'chain',currency:'USD',slot:123});
    expect(rpcBatches).toEqual([[platform]]);expect(dexBatches).toEqual([[platform]]);
  });
  it('uses one denominator for the platform and launched tokens without reserving a fixed area',async () => {
    rows = [registered(launched)];accounts.set(platform,mintAccount(1_000_000_000n));accounts.set(launched,mintAccount(1_000_000_000n));
    pairs = [quote(platform,'0.6'),quote(launched,'0.4')];
    const snapshot = await readSnapshot(environment(),config());
    expect(snapshot.tokens.reduce((sum,token) => sum + token.marketCap,0)).toBe(1000);
    const territories = layoutTerritories(snapshot.tokens,100,100),platformRect = territories.find(rect => rect.token.mint === platform)!;
    expect(platformRect.width * platformRect.height).toBeCloseTo(6000);
    expect(territories.reduce((sum,rect) => sum + rect.width * rect.height,0)).toBeCloseTo(10000);
  });
  it('keeps the platform listed with zero territory when no valid liquid quote exists',async () => {
    accounts.set(platform,mintAccount(1_000_000_000n));pairs = [quote(platform,'10',0),{...quote(launched,'500'),quoteToken:{address:platform}}];
    const snapshot = await readSnapshot(environment(),config());
    expect(snapshot.tokens[0]).toMatchObject({isPlatform:true,price:0,marketCap:0,change24h:null});
    expect(layoutTerritories(snapshot.tokens,100,100)).toEqual([]);
  });
  it('deduplicates the platform mint if it is also registered and preserves its known origin',async () => {
    rows = [registered(platform)];accounts.set(platform,mintAccount(1_000_000_000n));pairs = [quote(platform,'1')];
    const snapshot = await readSnapshot(environment(),config());
    expect(snapshot.tokens).toHaveLength(1);expect(snapshot.tokens[0]).toMatchObject({isPlatform:true,name:'ACTUAL',symbol:'ACTUAL',creator,createdAt:1700000000,marketCap:1000});
    expect(rpcBatches).toEqual([[platform]]);expect(dexBatches).toEqual([[platform]]);
  });
  it('automatically removes the old unregistered platform mint when configuration changes',async () => {
    accounts.set(platform,mintAccount(1_000_000_000n));accounts.set(replacement,mintAccount(2_000_000_000n));pairs = [quote(platform,'1'),quote(replacement,'2')];
    expect((await readSnapshot(environment(),config())).tokens.map(token => token.mint)).toEqual([platform]);
    const next = await readSnapshot(environment(),{...config(replacement),quoteSymbol:'NEW'});
    expect(next.tokens.map(token => token.mint)).toEqual([replacement]);expect(next.tokens[0]).toMatchObject({isPlatform:true,symbol:'NEW',marketCap:4000});
  });
  it('retains an old platform token as a normal competitor when it has a registered launch',async () => {
    rows = [registered(platform)];accounts.set(platform,mintAccount(1_000_000_000n));accounts.set(replacement,mintAccount(2_000_000_000n));pairs = [quote(platform,'1'),quote(replacement,'2')];
    const snapshot = await readSnapshot(environment(),config(replacement));
    expect(snapshot.tokens).toHaveLength(2);expect(snapshot.tokens.find(token => token.mint === platform)).toMatchObject({isPlatform:false,symbol:'REG',marketCap:1000});
    expect(snapshot.tokens.find(token => token.mint === replacement)).toMatchObject({isPlatform:true,marketCap:4000});
  });
  it('re-reads current platform supply instead of caching the original minted amount',async () => {
    accounts.set(platform,mintAccount(1_000_000_000n));pairs = [quote(platform,'1')];
    expect((await readSnapshot(environment(),config())).tokens[0].marketCap).toBe(1000);
    accounts.set(platform,mintAccount(900_000_000n));expect((await readSnapshot(environment(),config())).tokens[0].marketCap).toBe(900);
  });
  it('fails closed when the platform account owner or decimals differ from the verified config',async () => {
    accounts.set(platform,mintAccount(1_000_000_000n,6,TOKEN_2022_PROGRAM_ID));
    await expect(readSnapshot(environment(),config())).rejects.toThrow('vérifié');
    await expect(readSnapshot(environment(),config(platform,TOKEN_2022_PROGRAM_ID,9))).rejects.toThrow('décimales');
    accounts.clear();await expect(readSnapshot(environment(),config())).rejects.toThrow('vérifié');
  });
  it('still enforces fixed classic SPL issuance invariants for registered non-platform tokens',async () => {
    rows = [registered(launched)];accounts.set(platform,mintAccount(2_000_000_000_000_000_000n,9,TOKEN_2022_PROGRAM_ID,true));
    accounts.set(launched,mintAccount(2_000_000_000_000_000n));
    await expect(readSnapshot(environment(),config(platform,TOKEN_2022_PROGRAM_ID,9))).rejects.toThrow('offre');
  });
});

describe('native Pump fallback for payment assets only',()=>{
  it('converts the verified native curve through a real WSOL/USDC quote',async()=>{
    accounts.set(pumpFixture.mint,pumpFixture.mintAccount as unknown as RpcAccount);accounts.set(pumpFixture.curve,pumpFixture.curveAccount as unknown as RpcAccount);
    pairs=[{...quote(WRAPPED_SOL,'73.45'),quoteToken:{address:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'}}];
    const token=(await readSnapshot(environment(),config(pumpFixture.mint,TOKEN_2022_PROGRAM_ID))).tokens[0];
    const bytes=Buffer.from(pumpFixture.curveAccount.data[0],'base64'),expected=Number(bytes.readBigUInt64LE(16))/Number(bytes.readBigUInt64LE(8))*0.001*73.45;
    expect(token.price).toBeCloseTo(expected,14);expect(token.marketCap).toBeCloseTo(expected*1e9,8);expect(token.change24h).toBeNull();
    expect(dexBatches).toContainEqual([WRAPPED_SOL]);
  });
  it('does not invent a dollar conversion or use arbitrary WSOL cross-pairs',async()=>{
    accounts.set(pumpFixture.mint,pumpFixture.mintAccount as unknown as RpcAccount);accounts.set(pumpFixture.curve,pumpFixture.curveAccount as unknown as RpcAccount);pairs=[{...quote(WRAPPED_SOL,'73.45'),quoteToken:{address:launched}}];
    expect((await readSnapshot(environment(),config(pumpFixture.mint,TOKEN_2022_PROGRAM_ID))).tokens[0].marketCap).toBe(0);
  });
  it('never probes an arbitrary historical standard launch for Pump fallback',async()=>{
    rows=[registered(launched)];accounts.set(platform,mintAccount(1_000_000_000n));accounts.set(launched,mintAccount(1_000_000_000n));pairs=[quote(platform,'1')];
    await readSnapshot(environment(),config());expect(rpcBatches).toEqual([[launched,platform]]);
  });
});

describe('transient quote provider failures',()=>{
  it('retries a DexScreener503 instead of treating it as an absent market',async()=>{
    accounts.set(platform,mintAccount(1_000_000_000n));pairs=[quote(platform,'2')];
    const original=fetch;let dexAttempts=0;
    vi.stubGlobal('fetch',vi.fn(async(url: string | URL | Request,init?:RequestInit)=>{
      if(String(url).startsWith('https://api.dexscreener.com/')&&++dexAttempts===1)return new Response('temporarily unavailable',{status:503});
      return original(url,init);
    }));
    expect((await readSnapshot(environment(),config())).tokens[0].marketCap).toBe(2000);expect(dexAttempts).toBe(2);
  });
});
