import {describe,it,expect,vi} from 'vitest';
import {resolveQuoteDependencies,type QuoteDependencyContext} from '../server/market';
import type {RegisteredLaunch} from '../server/types';
function row(mint:string,payment_mint:string){return {mint,payment_mint,model:'dbc'} as RegisteredLaunch;}
describe('registered quote DAG outside the displayed world',()=>{
 it('resolves mother -> local -> child with exact multiplicative prices, without inserting parent territories',async()=>{
  const registry=new Map([['local',row('local','mother')],['child',row('child','local')]]),ratios=new Map([['local',2],['child',3]]),displayed=['child'];
  const read=async(r:RegisteredLaunch,c:QuoteDependencyContext):Promise<number|null>=>{if(r.payment_mint==='mother')return ratios.get(r.mint)!*5;const next=await resolveQuoteDependencies([r.payment_mint],async m=>registry.get(m)??null,read,c);return (next.get(r.payment_mint)??0)*ratios.get(r.mint)!;};
  const result=await resolveQuoteDependencies(['child'],async m=>registry.get(m)??null,read);
  expect(result.get('child')).toBe(30);expect([...result.keys()]).toEqual(['child']);expect(displayed).toEqual(['child']);
 });
 it('rejects cycles and bounds registered dependency depth',async()=>{
  const registry=new Map([['a',row('a','b')],['b',row('b','a')]]);
  const read=async(r:RegisteredLaunch,c:QuoteDependencyContext):Promise<number|null>=>{const next=await resolveQuoteDependencies([r.payment_mint],async m=>registry.get(m)??null,read,c);return next.get(r.payment_mint)??null;};
  await expect(resolveQuoteDependencies(['a'],async m=>registry.get(m)??null,read)).rejects.toThrow('Cycle');
  await expect(resolveQuoteDependencies(['a'],async m=>registry.get(m)??null,read,{path:['one','two','three','four'],prices:new Map()})).rejects.toThrow('quatre');
 });
 it('keeps missing quotes unknown, validates registry identities and reuses verified quotes',async()=>{
  const read=vi.fn(async()=>null);expect((await resolveQuoteDependencies(['unknown'],async()=>null,read)).size).toBe(0);expect(read).not.toHaveBeenCalled();
  await expect(resolveQuoteDependencies(['a'],async()=>row('different','mother'),read)).rejects.toThrow('incohérente');
  const load=vi.fn(async()=>row('a','mother'));expect((await resolveQuoteDependencies(['a'],load,read,{path:[],prices:new Map([['a',7]])})).get('a')).toBe(7);expect(load).not.toHaveBeenCalled();
 });
});

import {afterEach} from 'vitest';
import fixture from './fixtures/dbc-launch.json';
import {TOKEN_PROGRAM_ID} from '@solana/spl-token';
import {getPriceFromSqrtPrice} from '@meteora-ag/dynamic-bonding-curve-sdk';
import {decodeDbcPool} from '../src/lib/dbc';
import {readSnapshot} from '../server/market';
import type {PlatformConfig} from '../src/types';
import type {Env} from '../server/types';
afterEach(()=>vi.unstubAllGlobals());
it('prices a local world quote using its actual validated parent DBC account without adding its mother to the map',async()=>{
 const launch={mint:fixture.mint,pool:fixture.pool,model:'dbc',curve_config:fixture.config.dbcConfig,payment_mint:fixture.config.quoteMint,name:'Local',symbol:'LOCAL',creator:fixture.payer,created_at:1} as RegisteredLaunch;
 const saved={cluster:'mainnet-beta',payment_mint:fixture.config.quoteMint,curve_version:fixture.config.curveVersion,config_address:fixture.config.dbcConfig,policy_json:JSON.stringify(fixture.config)};
 const env={SOLANA_RPC_URL:'https://rpc.invalid',DB:{prepare(sql:string){let args:unknown[]=[];return {bind(...values:unknown[]){args=values;return this;},async all(){return {success:true,results:sql.includes('curve_configs')?[saved]:[]};},async first(){return sql.includes('curve_configs')?saved:args[1]===fixture.mint?launch:null;},async run(){return {success:true};}};}}} as Env;
 const accounts=new Map([[fixture.mint,fixture.mintAccount],[fixture.config.quoteMint,fixture.quoteMintAccount],[fixture.pool,fixture.poolAccount],[fixture.config.dbcConfig,fixture.configAccount]]);
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
  if(String(url).includes('dexscreener'))return Response.json([{chainId:'solana',baseToken:{address:fixture.config.quoteMint},quoteToken:{address:'USDC'},priceUsd:'2',liquidity:{usd:10000}}]);
  const req=JSON.parse(String(init?.body));if(req.method!=='getMultipleAccounts')throw Error('Unexpected RPC '+req.method);
  return Response.json({jsonrpc:'2.0',id:1,result:{context:{slot:9999999},value:req.params[0].map((address:string)=>accounts.get(address)??null)}});
 }));
 const localConfig={...fixture.config,worldId:undefined,quoteMint:fixture.mint,quoteTokenProgram:TOKEN_PROGRAM_ID.toBase58(),quoteDecimals:6} as PlatformConfig;
 const snapshot=await readSnapshot(env,localConfig,[]);
 expect(snapshot.tokens.map(t=>t.mint)).toEqual([fixture.mint]);
 const expected=getPriceFromSqrtPrice(decodeDbcPool(Buffer.from(fixture.poolAccount.data[0],'base64')).poolState.sqrtPrice,6,6).toNumber()*2;
 expect(snapshot.tokens[0].price).toBeCloseTo(expected,12);expect(snapshot.tokens[0].marketCap).toBeCloseTo(expected*1e9,6);
});
