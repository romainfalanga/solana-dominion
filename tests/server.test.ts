import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { Buffer } from 'buffer';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import fixture from './fixtures/standard-launch.json';
import worker,{resolveConfig,readSnapshot,type Env} from '../server';
import { recordConfiguration } from '../server/settings';
import type { D1Database,D1Statement,D1Result,ParsedTransaction,RegisteredLaunch,SavedConfiguration } from '../server/types';

const GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const legacy: SavedConfiguration = {version:fixture.config.configVersion,cluster:'mainnet-beta',payment_mint:fixture.config.quoteMint,payment_program:fixture.config.quoteTokenProgram,fee_atomic:fixture.config.creationFeeAtomic,treasury:fixture.config.treasury,quote_decimals:fixture.config.quoteDecimals};
const launchRow: RegisteredLaunch = {cluster:'mainnet-beta',mint:fixture.mint,signature:fixture.signature,creator:fixture.payer,name:'Waves',symbol:'WAVE',payment_mint:legacy.payment_mint,payment_program:legacy.payment_program,fee_atomic:legacy.fee_atomic,treasury:legacy.treasury,config_version:legacy.version,created_at:fixture.parsedTransaction.blockTime!,slot:fixture.parsedTransaction.slot};
class TestDB implements D1Database {
  configurations = new Map<string,SavedConfiguration>();launches = new Map<string,RegisteredLaunch>();forcedRows?:RegisteredLaunch[];
  prepare(sql: string): D1Statement {return new TestStatement(this,sql);}
}
class TestStatement implements D1Statement {
  constructor(readonly db: TestDB,readonly sql: string,readonly values: (string|number|null)[] = []) {}
  bind(...values: (string|number|null)[]): D1Statement {return new TestStatement(this.db,this.sql,values);}
  async first<T>(): Promise<T|null> {
    const v = this.values;
    const row = this.sql.includes('FROM configurations') ? this.db.configurations.get(String(v[0])) : [...this.db.launches.values()].find(item => item.cluster === v[0] && item.signature === v[1]);
    if (row && this.sql.includes('FROM configurations') && row.cluster !== v[1]) return null;
    return row ? structuredClone(row) as T : null;
  }
  async all<T>(): Promise<D1Result<T>> {return {success:true,results:(this.db.forcedRows ?? [...this.db.launches.values()].filter(row => row.cluster === this.values[0])).map(row => structuredClone(row)) as T[]};}
  async run(): Promise<D1Result> {
    const v = this.values;
    if (this.sql.startsWith('INSERT INTO configurations')) {
      const version = String(v[0]);if (this.db.configurations.has(version)) return {success:true,meta:{changes:0}};
      this.db.configurations.set(version,{version,cluster:v[1] as 'mainnet-beta',payment_mint:String(v[2]),payment_program:String(v[3]),fee_atomic:String(v[4]),treasury:String(v[5]),quote_decimals:Number(v[6]),launch_model:v[7] as 'standard'|'dbc',curve_version:v[8] as string|null,dbc_config:v[9] as string|null,curve_json:v[10] as string|null});
    } else if (this.sql.startsWith('INSERT INTO launches')) {
      if ([...this.db.launches.values()].some(row => row.cluster === v[0] && (row.mint === v[1] || row.signature === v[2]))) return {success:true,meta:{changes:0}};
      this.db.launches.set(String(v[1]),{cluster:v[0] as 'mainnet-beta',mint:String(v[1]),signature:String(v[2]),creator:String(v[3]),name:String(v[4]),symbol:String(v[5]),payment_mint:String(v[6]),payment_program:String(v[7]),fee_atomic:String(v[8]),treasury:String(v[9]),config_version:String(v[10]),created_at:Number(v[11]),slot:Number(v[12])});
    } else throw new Error(`Unexpected SQL: ${this.sql}`);
    return {success:true,meta:{changes:1}};
  }
}
let db: TestDB,env: Env,tx: ParsedTransaction | null,mintAccount: typeof fixture.mintAccount,quoteAccount: typeof fixture.quoteMintAccount;
let genesis: string,dexPairs: unknown[],methods:string[];
const ctx = {waitUntil:vi.fn()};
function editInfo(type: string): Record<string,unknown> {
  const ix = tx!.transaction.message.instructions.find(item => typeof item.parsed === 'object' && item.parsed?.type === type);
  if (!ix || typeof ix.parsed !== 'object') throw new Error('Missing fixture instruction');return ix.parsed.info;
}
function setSupply(amount: bigint) {const data = Buffer.from(mintAccount.data[0],'base64');data.writeBigUInt64LE(amount,36);mintAccount.data[0] = data.toString('base64');}
function request(path: string,method = 'GET',body?:unknown,headers: Record<string,string> = {}) {
  return worker.fetch(new Request(`https://dominion.example${path}`,{method,headers:body === undefined ? headers : {'Content-Type':'application/json',...headers},...(body === undefined ? {} : {body:JSON.stringify(body)})}),env,ctx);
}
const register = () => request('/api/launches','POST',{signature:fixture.signature});
beforeEach(() => {
  db = new TestDB();db.configurations.set(legacy.version,{...legacy});env = {DB:db,CREATION_ENABLED:'true',SOLANA_RPC_URL:'https://rpc.example/?key=private-secret'};
  tx = structuredClone(fixture.parsedTransaction);mintAccount = structuredClone(fixture.mintAccount);quoteAccount = structuredClone(fixture.quoteMintAccount);genesis = GENESIS;dexPairs = [];methods = [];
  vi.stubGlobal('fetch',vi.fn(async (url: string | URL | Request,init?:RequestInit) => {
    if (String(url).startsWith('https://api.dexscreener.com/')) {methods.push('dex');return Response.json(dexPairs);}
    const {method,params} = JSON.parse(String(init?.body)) as {method:string;params:unknown[]};methods.push(method);
    let result: unknown;
    if (method === 'getGenesisHash') result = genesis;
    else if (method === 'getTransaction') result = tx;
    else if (method === 'getAccountInfo') {
      if ((params[1] as {encoding:string}).encoding === 'jsonParsed') result = {context:{slot:2000},value:{data:{parsed:{info:{extensions:[{extension:'tokenMetadata',state:{name:'Actual chain name',symbol:'CHOULE'}}]}}}}};
      else result = {context:{slot:fixture.parsedTransaction.slot + 10},value:params[0] === fixture.mint ? mintAccount : quoteAccount};
    } else if (method === 'getMultipleAccounts') result = {context:{slot:fixture.parsedTransaction.slot + 20},value:(params[0] as string[]).map(address => address === fixture.mint ? mintAccount : quoteAccount)};
    else throw new Error(`Unexpected RPC method ${method}`);
    return Response.json({jsonrpc:'2.0',id:1,result});
  }));
});
afterEach(() => {vi.unstubAllGlobals();vi.restoreAllMocks();});

describe('DBC configuration and historical SPL registry',() => {
  it('exposes actual quote metadata and no fixed creation fee',async () => {
    const response = await request('/api/state');expect(response.status).toBe(200);
    const {config,snapshot} = await response.json();
    expect(config).toMatchObject({mode:'mainnet-beta',quoteSymbol:'CHOULE',quoteDecimals:6,creationFeeAtomic:'0',creationEnabled:true,programId:null,tradingEnabled:false});
    expect(config.configVersion).toMatch(/^[a-f0-9]{16}$/);expect(db.configurations.has(config.configVersion)).toBe(true);
    expect(JSON.stringify(config)).not.toContain('private-secret');expect(snapshot).toMatchObject({source:'chain',currency:'USD'});expect(snapshot.tokens).toHaveLength(1);expect(snapshot.tokens[0]).toMatchObject({mint:config.quoteMint,isPlatform:true,marketCap:0});expect(methods).toContain('dex');
  });
  it('keeps the removed creation fee at zero regardless of actual mint decimals',async () => {
    const bytes = Buffer.from(quoteAccount.data[0],'base64');bytes[44] = 9;quoteAccount.data[0] = bytes.toString('base64');
    const config = await resolveConfig(env);expect(config.quoteDecimals).toBe(9);expect(config.creationFeeAtomic).toBe('0');
  });
  it('requires the complete real mainnet genesis hash and refuses a wrong network',async () => {
    genesis = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';expect((await request('/api/state')).status).toBe(503);
    expect(db.launches.size).toBe(0);
  });
  it('never silently supplies demonstration data when the DB or RPC is unavailable',async () => {
    env.DB = undefined;const response = await request('/api/state');expect(response.status).toBe(503);expect(await response.text()).not.toContain('"tokens"');
  });
  it('publishes a reproducible version and preserves previous settings for delayed receipts',async () => {
    const config = await resolveConfig(env);await recordConfiguration(env,config);await recordConfiguration(env,config);
    expect(db.configurations.size).toBe(2);expect(db.configurations.has(legacy.version)).toBe(true);
    expect(config.quoteMint).not.toBe(legacy.payment_mint);
    expect((await register()).status).toBe(201);
  });
});

describe('signature-only receipt endpoint',() => {
  it('rejects client-supplied metadata, non-JSON, oversized and cross-origin requests',async () => {
    expect((await request('/api/launches','POST',{signature:fixture.signature,name:'Injected'})).status).toBe(400);
    expect((await request('/api/launches','POST',{signature:fixture.signature},{'Content-Type':'text/plain'})).status).toBe(415);
    expect((await request('/api/launches','POST',{signature:fixture.signature},{Origin:'https://evil.example'})).status).toBe(403);
    expect((await request('/api/launches','POST',{signature:'a'.repeat(6000)})).status).toBe(413);
    expect((await request('/api/launches','POST',{signature:'invalid'})).status).toBe(400);
    expect(db.launches.size).toBe(0);
  });
  it('waits for finalization and tells the client to retry the receipt rather than pay again',async () => {
    tx = null;const response = await register();expect(response.status).toBe(409);expect(response.headers.get('retry-after')).toBe('4');
    expect(await response.json()).toMatchObject({code:'TRANSACTION_PENDING'});expect(db.launches.size).toBe(0);
    const call = vi.mocked(fetch).mock.calls.find(([,init]) => String(init?.body).includes('getTransaction'));
    expect(JSON.parse(String(call?.[1]?.body)).params[1].commitment).toBe('finalized');
  });
  it('accepts the real finalized SDK transaction fixture and is idempotent by signature',async () => {
    const first = await register();expect(first.status).toBe(201);const value = await first.json();
    expect(value.launch).toMatchObject({mint:fixture.mint,creator:fixture.payer,signature:fixture.signature,payment_mint:legacy.payment_mint,symbol:'ABCDEFGHIJ'});
    const count = methods.length;const second = await register();expect(second.status).toBe(200);expect((await second.json()).created).toBe(false);expect(methods.length).toBe(count);expect(db.launches.size).toBe(1);
  });
  it('rejects a failed transaction and a missing signed app receipt',async () => {
    tx!.meta!.err = {InstructionError:[7,'Custom']};expect((await register()).status).toBe(422);
    tx = structuredClone(fixture.parsedTransaction);tx.transaction.message.instructions = tx.transaction.message.instructions.filter(ix => ix.programId !== 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');expect((await register()).status).toBe(422);
  });
  it('rejects an unknown config version and a treasury mismatch',async () => {
    db.configurations.clear();expect((await register()).status).toBe(409);
    db.configurations.set(legacy.version,{...legacy,treasury:fixture.payer});expect((await register()).status).toBe(422);
  });
  it('rejects the wrong fee amount',async () => {
    (editInfo('transferChecked').tokenAmount as {amount:string}).amount = '1';expect((await register()).status).toBe(422);expect(db.launches.size).toBe(0);
  });
  it('rejects a fee that was refunded within the same transaction',async () => {
    const destination = editInfo('transferChecked').destination;
    const index = tx!.transaction.message.accountKeys.findIndex(key => key.pubkey === destination);
    tx!.meta!.postTokenBalances!.find(balance => balance.accountIndex === index)!.uiTokenAmount.amount = '0';expect((await register()).status).toBe(422);
  });
  it('requires the mint to be created in this transaction, not a pre-existing token',async () => {
    editInfo('createAccount').space = 165;expect((await register()).status).toBe(422);
    tx = structuredClone(fixture.parsedTransaction);tx.transaction.message.accountKeys[0].signer = false;expect((await register()).status).toBe(422);
  });
  it('rejects a forged mint authority or missing authority revocation',async () => {
    editInfo('setAuthority').newAuthority = fixture.payer;expect((await register()).status).toBe(422);
    tx = structuredClone(fixture.parsedTransaction);const bytes = Buffer.from(mintAccount.data[0],'base64');bytes.writeUInt32LE(1,0);mintAccount.data[0] = bytes.toString('base64');expect((await register()).status).toBe(422);
  });
  it('accepts delayed registration after a burn because finalized creation still proves the initial supply',async () => {
    setSupply(900_000_000_000_000n);expect((await register()).status).toBe(201);
  });
  it('rejects an inflated current supply',async () => {
    setSupply(1_100_000_000_000_000n);expect((await register()).status).toBe(422);
  });
});

describe('real token territories in USD',() => {
  it('keeps all payment-token generations and uses current supply with the most liquid base-token quote',async () => {
    db.launches.set(launchRow.mint,launchRow);setSupply(900_000_000_000_000n);
    dexPairs = [{chainId:'solana',baseToken:{address:fixture.mint},priceUsd:'0.01',liquidity:{usd:100},marketCap:999999},
      {chainId:'solana',baseToken:{address:fixture.mint},priceUsd:'0.02',liquidity:{usd:1000},priceChange:{h24:3}},
      {chainId:'solana',baseToken:{address:'other'},quoteToken:{address:fixture.mint},priceUsd:'9999',liquidity:{usd:1000000}}];
    const snapshot = await readSnapshot(env,await resolveConfig(env));expect(snapshot.tokens).toHaveLength(2);
    expect(snapshot.tokens[0]).toMatchObject({price:0.02,marketCap:18_000_000,change24h:3,baseReserve:'0',quoteReserve:'0',pool:'',supply:'900000000000000'});expect(snapshot.currency).toBe('USD');
  });
  it('retains unpriced tokens at zero territory and never invents a valuation',async () => {
    db.launches.set(launchRow.mint,launchRow);const snapshot = await readSnapshot(env,await resolveConfig(env));expect(snapshot.tokens[0]).toMatchObject({price:0,marketCap:0,change24h:null});
  });
  it('rejects an oversized registry instead of silently truncating the denominator',async () => {
    db.forcedRows = Array.from({length:1001},() => launchRow);await expect(readSnapshot(env,await resolveConfig(env))).rejects.toThrow('capacité');
  });
  it('adds security headers and does not expose an arbitrary RPC relay',async () => {
    const response = await request('/api/health');expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await request('/api/rpc')).status).toBe(404);expect((await request('/api/state','POST',{})).status).toBe(405);
  });
});
