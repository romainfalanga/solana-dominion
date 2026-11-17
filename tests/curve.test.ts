import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Buffer } from 'buffer';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { BorshCoder } from '@coral-xyz/anchor';
import { createDbcProgram,getPriceFromSqrtPrice } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { Connection } from '@solana/web3.js';
import fixture from './fixtures/dbc-launch.json';
import worker from '../server';
import { recordConfiguration,resolveConfig } from '../server/settings';
import { readSnapshot } from '../server/market';
import { dbcInstructions } from '../server/curves';
import { DBC_PROGRAM_ID,decodeDbcPool,decodeDbcConfig } from '../src/lib/dbc';
import type { PlatformConfig } from '../src/types';
import type { D1Database,D1Statement,Env,ParsedTransaction,RegisteredLaunch,RpcAccount,SavedCurve } from '../server/types';
vi.mock('../config/worlds.json',async(importOriginal)=>{
  const original=await importOriginal<{default:typeof import('../config/worlds.json')}>();
  const fixture=(await import('./fixtures/dbc-launch.json')).default;
  return {default:{...original.default,worlds:[...original.default.worlds,{id:'fixture',name:'Historical fixture',theme:'Test',week:99,status:'open',quoteMint:fixture.config.quoteMint,createdAt:'2026-11-16T00:00:00Z',launch:{initialMarketCapQuote:'10000',migrationMarketCapQuote:'1000000',tradingFeeBps:100}}]}};
});

const coder = new BorshCoder(createDbcProgram(new Connection('https://api.mainnet-beta.solana.com')).idl);
const policy = fixture.config as PlatformConfig;
let sqlite:DatabaseSync,env:Env,setup:ParsedTransaction|null,launch:ParsedTransaction|null,rawConfig:RpcAccount,rawPool:RpcAccount,rawMint:RpcAccount,dexPairs:unknown[];
const ctx = {waitUntil:vi.fn()};
function raw(value:{data:string[];owner:string;executable:boolean;lamports:number;rentEpoch?:number}):RpcAccount {return {...structuredClone(value),data:[value.data[0],value.data[1]]};}
function adapter(db:DatabaseSync):D1Database {
  return {prepare(sql:string):D1Statement {
    const build = (values:(string|number|null)[]):D1Statement => ({
      bind:(...next) => build(next),async first<T>(){return (db.prepare(sql).get(...values) as T|undefined) ?? null;},
      async all<T>(){return {success:true,results:db.prepare(sql).all(...values) as T[]};},
      async run(){const result = db.prepare(sql).run(...values);return {success:true,meta:{changes:Number(result.changes)}};},
    });return build([]);
  }};
}
function request(path:string,signature?:string) {
  if(path==='/api/launches'||path==='/api/curve-config')path+='?world=fixture';
  return worker.fetch(new Request(`https://dominion.example${path}`,signature ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({signature})} : undefined),env,ctx);
}
async function publishSetupHistory() {await recordConfiguration(env,{...policy,dbcConfig:null,tradingEnabled:false});}
async function publishLaunchHistory() {await recordConfiguration(env,{...policy,configVersion:'fedcba0987654321'});}
async function registerCurve() {await publishSetupHistory();return request('/api/curve-config',fixture.setupSignature);}
async function registerToken() {
  const setupResult = await registerCurve();expect(setupResult.status).toBe(201);await publishLaunchHistory();return request('/api/launches',fixture.launchSignature);
}
function amendInstruction(tx:ParsedTransaction,name:string,change:(data:Record<string,unknown>) => void) {
  const decoded = dbcInstructions(tx).find(ix => ix.name === name)!;
  change(decoded.data);
  const key = name === 'swap2' ? 'swap2' : name === 'initializevirtualpoolwithspltoken' ? 'initializeVirtualPoolWithSplToken' : 'createConfig2';
  tx.transaction.message.instructions[decoded.index].data = bs58.encode(coder.instruction.encode(key,decoded.data));
}
beforeEach(async () => {
  sqlite = new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('../migrations/0001_registry.sql',import.meta.url),'utf8'));sqlite.exec(readFileSync(new URL('../migrations/0002_curves.sql',import.meta.url),'utf8'));sqlite.exec(readFileSync(new URL('../migrations/0004_worlds.sql',import.meta.url),'utf8'));
  env = {DB:adapter(sqlite),CREATION_ENABLED:'true',SOLANA_RPC_URL:'https://rpc.example'};
  setup = structuredClone(fixture.setupTransaction);launch = structuredClone(fixture.launchTransaction);
  rawConfig = raw(fixture.configAccount);rawPool = raw(fixture.poolAccount);rawMint = raw(fixture.mintAccount);dexPairs = [];
  vi.stubGlobal('fetch',vi.fn(async (url:string|URL|Request,init?:RequestInit) => {
    if (String(url).startsWith('https://api.dexscreener.com/')) return Response.json(dexPairs);
    const {method,params} = JSON.parse(String(init?.body)) as {method:string;params:unknown[]};
    const at = (key:string) => key === fixture.config.dbcConfig ? rawConfig : key === fixture.pool ? rawPool : key === fixture.mint ? rawMint : raw(fixture.quoteMintAccount);
    let result:unknown;
    if (method === 'getGenesisHash') result = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
    else if (method === 'getTransaction') result = params[0] === fixture.setupSignature ? setup : launch;
    else if (method === 'getAccountInfo') {
      result = (params[1] as {encoding:string}).encoding === 'jsonParsed' ? {context:{slot:999999},value:{data:{parsed:{info:{extensions:[{extension:'tokenMetadata',state:{symbol:'PAY'}}]}}}}} : {context:{slot:999999},value:at(params[0] as string)};
    } else if (method === 'getMultipleAccounts') result = {context:{slot:999999},value:(params[0] as string[]).map(at)};
    else throw new Error(`Unexpected RPC ${method}`);
    return Response.json({jsonrpc:'2.0',id:1,result});
  }));
});
afterEach(() => {sqlite.close();vi.unstubAllGlobals();vi.restoreAllMocks();});

describe('Meteora shared curve registration',() => {
  it('exposes a missing curve as null without inventing an address or enabling swaps',async () => {
    const config = await resolveConfig(env);expect(config.launchModel).toBe('dbc');expect(config.dbcConfig).toBeNull();expect(config.tradingEnabled).toBe(false);expect(config.curveVersion).toMatch(/^[a-f0-9]{16}$/);
  });
  it('verifies and stores the real finalized setup transaction and is idempotent',async () => {
    const first = await registerCurve();expect(first.status).toBe(201);const body = await first.json();expect(body.curve.config_address).toBe(fixture.config.dbcConfig);
    const second = await request('/api/curve-config',fixture.setupSignature);expect(second.status).toBe(200);expect((await second.json()).created).toBe(false);
    expect(sqlite.prepare('SELECT COUNT(*) count FROM curve_configs').get()?.count).toBe(1);
  });
  it('rejects a configuration not owned by the actual Meteora program',async () => {
    rawConfig.owner = TOKEN_PROGRAM_ID.toBase58();expect((await registerCurve()).status).toBe(422);expect(sqlite.prepare('SELECT COUNT(*) count FROM curve_configs').get()?.count).toBe(0);
  });
  it('rejects a quote mint different from the saved platform policy',async () => {
    await publishSetupHistory();sqlite.prepare('UPDATE configurations SET payment_mint = ?').run(fixture.mint);
    expect((await request('/api/curve-config',fixture.setupSignature)).status).toBe(409);
  });
  it('rejects canonical instruction parameter substitution even when the account address is genuine',async () => {
    amendInstruction(setup!,'createconfig2',data => {(data.configParameters as Record<string,unknown>).partnerPermanentLockedLiquidityPercentage = 0;});
    expect((await registerCurve()).status).toBe(422);
  });
  it('requires the signed policy memo and waits for finalization',async () => {
    setup = null;expect((await registerCurve()).status).toBe(409);
    setup = structuredClone(fixture.setupTransaction);setup.transaction.message.instructions = setup.transaction.message.instructions.filter(ix => ix.programId !== 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLmfcHr' && !('parsed' in ix && typeof ix.parsed === 'string'));
    expect((await request('/api/curve-config',fixture.setupSignature)).status).toBe(422);
  });
});

describe('Meteora pool creation and first purchase receipt',() => {
  it('accepts the real mainnet-program local fixture including first buy, without a custom mint-all allocation',async () => {
    const response = await registerToken();expect(response.status).toBe(201);const body = await response.json();
    expect(body.launch).toMatchObject({model:'dbc',mint:fixture.mint,pool:fixture.pool,creator:fixture.payer,curve_config:fixture.config.dbcConfig,fee_atomic:'0',initial_quote_atomic:'1000000000'});
    expect((await request('/api/launches',fixture.launchSignature)).status).toBe(200);
    const metadata = await request(`/api/metadata/${fixture.mint}`);expect(metadata.status).toBe(200);expect(await metadata.json()).toMatchObject({name:body.launch.name,symbol:body.launch.symbol});
  });
  it('refuses a pool that has no registered shared configuration',async () => {
    expect((await request('/api/launches',fixture.launchSignature)).status).toBe(422);
  });
  it('refuses a missing first purchase',async () => {
    expect((await registerCurve()).status).toBe(201);await publishLaunchHistory();
    const swaps = dbcInstructions(launch!).filter(ix => ix.name === 'swap' || ix.name === 'swap2').map(ix => ix.index);
    launch!.transaction.message.instructions = launch!.transaction.message.instructions.filter((_,index) => !swaps.includes(index));
    expect((await request('/api/launches',fixture.launchSignature)).status).toBe(422);
  });
  it('refuses a first purchase that leaves the creator with no tokens',async () => {
    expect((await registerCurve()).status).toBe(201);await publishLaunchHistory();
    const balance = launch!.meta!.postTokenBalances!.find(item => item.mint === fixture.mint && item.owner === fixture.payer)!;balance.uiTokenAmount.amount = '0';
    expect((await request('/api/launches',fixture.launchSignature)).status).toBe(422);
  });
  it('refuses a forged pool account owner',async () => {
    expect((await registerCurve()).status).toBe(201);await publishLaunchHistory();rawPool.owner = TOKEN_PROGRAM_ID.toBase58();
    expect((await request('/api/launches',fixture.launchSignature)).status).toBe(422);
  });
});

describe('curve prices in the common USD world',() => {
  it('values a pre-migration pool at its on-chain curve price times the actual quote/USD price',async () => {
    expect((await registerToken()).status).toBe(201);
    dexPairs = [{chainId:'solana',baseToken:{address:fixture.config.quoteMint},pairAddress:'quote-pair',priceUsd:'2',liquidity:{usd:100000}}];
    const snapshot = await readSnapshot(env,policy),token = snapshot.tokens.find(item => item.mint === fixture.mint)!;
    const price = getPriceFromSqrtPrice(decodeDbcPool(Buffer.from(rawPool.data[0],'base64')).poolState.sqrtPrice,6,6).toNumber() * 2;
    expect(token).toMatchObject({launchModel:'dbc',pool:fixture.pool,migrated:false,change24h:null});expect(token.price).toBeCloseTo(price,12);expect(token.marketCap).toBeCloseTo(price * 1_000_000_000,4);
    expect(snapshot.tokens.some(item => item.mint === fixture.config.quoteMint && item.isPlatform)).toBe(true);
  });
  it('does not invent USD value when the curve quote asset has no liquid USD quote',async () => {
    expect((await registerToken()).status).toBe(201);const snapshot = await readSnapshot(env,policy);
    expect(snapshot.tokens.find(item => item.mint === fixture.mint)).toMatchObject({price:0,marketCap:0,launchModel:'dbc'});
  });
  it('preserves an old market settlement config after the active platform quote changes',async () => {
    expect((await registerToken()).status).toBe(201);
    const replacement = '31CZR8AgCjGsbkjJGUznY99hiKTQkX6J2zxiwN9Mpump';
    const current:PlatformConfig = {...policy,quoteMint:replacement,quoteSymbol:'NEW',dbcConfig:null,tradingEnabled:false,rpcUrl:'https://api.mainnet-beta.solana.com'};
    dexPairs = [{chainId:'solana',baseToken:{address:policy.quoteMint},priceUsd:'2',liquidity:{usd:10000}}];
    const snapshot = await readSnapshot(env,current),token = snapshot.tokens.find(item => item.mint === fixture.mint)!;
    expect(token.marketConfig).toMatchObject({quoteMint:policy.quoteMint,dbcConfig:policy.dbcConfig,quoteSymbol:'PAY',tradingEnabled:true,rpcUrl:current.rpcUrl});
    expect(token.price).toBeGreaterThan(0);
    expect(snapshot.tokens.some(item => item.mint === policy.quoteMint)).toBe(false);
    expect(snapshot.tokens.some(item => item.mint === replacement && item.isPlatform)).toBe(true);
  });
  it('marks migration ready only after the quote threshold and protocol preparation phase are both reached',async () => {
    expect((await registerToken()).status).toBe(201);
    const curve = decodeDbcConfig(Buffer.from(rawConfig.data[0],'base64')),pool = decodeDbcPool(Buffer.from(rawPool.data[0],'base64'));
    pool.poolState.quoteReserve = curve.migrationQuoteThreshold;pool.poolState.sqrtPrice = curve.migrationSqrtPrice;pool.poolState.migrationProgress = 1;
    rawPool.data[0] = (await coder.accounts.encode('virtualPool',pool)).toString('base64');
    expect((await readSnapshot(env,policy)).tokens.find(item => item.mint === fixture.mint)?.migrationReady).toBe(false);
    pool.poolState.migrationProgress = 2;rawPool.data[0] = (await coder.accounts.encode('virtualPool',pool)).toString('base64');
    expect((await readSnapshot(env,policy)).tokens.find(item => item.mint === fixture.mint)).toMatchObject({migrationReady:true,migrated:false});
  });
  it('uses an external quote after migration rather than freezing the old curve price',async () => {
    expect((await registerToken()).status).toBe(201);
    const pool = decodeDbcPool(Buffer.from(rawPool.data[0],'base64'));pool.poolState.isMigrated = 1;rawPool.data[0] = (await coder.accounts.encode('virtualPool',pool)).toString('base64');
    dexPairs = [{chainId:'solana',baseToken:{address:fixture.mint},pairAddress:'migrated-pair',priceUsd:'0.25',liquidity:{usd:100000}}];
    const token = (await readSnapshot(env,policy)).tokens.find(item => item.mint === fixture.mint)!;
    expect(token).toMatchObject({migrated:true,price:0.25,marketCap:250_000_000,marketUrl:`https://jup.ag/swap/${policy.quoteMint}-${fixture.mint}`} );
  });
});
