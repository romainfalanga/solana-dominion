import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {Keypair} from '@solana/web3.js';
import committedSource from '../config/worlds.json';
import type {World} from '../src/worldTypes';
import type {PlatformConfig} from '../src/types';
import platform from '../config/platform.json';
import {worldCatalog,worldPolicy,recordWorldCatalog} from '../server/worlds';
import worker from '../server';
import type {Env,D1Database,D1Statement} from '../server/types';
const source=committedSource as {activeWorldId:string;worlds:(World&{launch:NonNullable<PlatformConfig['curve']>|null})[]};
const committed=structuredClone(source),mother=platform.paymentMint;
const original:typeof source={activeWorldId:'origin',worlds:[
 {id:'origin',name:'Origin fixture',theme:'Test origin',week:0,status:'open',quoteMint:'31CZR8AgCjGsbkjJGUznY99hiKTQkX6J2zxiwN9Mpump',createdAt:'2026-11-17T00:00:00Z',launch:{initialMarketCapQuote:'10000',migrationMarketCapQuote:'1000000',tradingFeeBps:100}},
 {id:'gta6',name:'Pending fixture',theme:'Test next world',week:1,status:'pending',quoteMint:null,createdAt:'2026-11-17T00:00:00Z',launch:null},
]};
let sqlite:DatabaseSync,env:Env;
function adapter(db:DatabaseSync):D1Database{return {prepare(sql:string){const build=(values:(string|number|null)[]):D1Statement=>({bind:(...next)=>build(next),async first<T>(){return db.prepare(sql).get(...values) as T??null;},async all<T>(){return {success:true,results:db.prepare(sql).all(...values) as T[]};},async run(){const result=db.prepare(sql).run(...values);return {success:true,meta:{changes:Number(result.changes)}};}});return build([]);}};}
const request=(path:string,method='GET')=>worker.fetch(new Request('https://dominion.example'+path,{method,...(method==='POST'?{headers:{'Content-Type':'application/json'},body:JSON.stringify({signature:'irrelevant'})}:{})}),env,{waitUntil(){}});
beforeEach(()=>{Object.assign(source,structuredClone(original));platform.paymentMint=mother;sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('../migrations/0004_worlds.sql',import.meta.url),'utf8'));env={DB:adapter(sqlite)};vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('No RPC should be used');}));});
afterEach(()=>{sqlite.close();Object.assign(source,structuredClone(committed));platform.paymentMint=mother;vi.unstubAllGlobals();});
describe('world catalog and durable quote identity',()=>{
 it('validates the committed catalog without fixing its future activation state',async()=>{
  Object.assign(source,structuredClone(committed));const catalog=worldCatalog();expect(catalog.worlds.some(world=>world.id===catalog.activeWorldId&&world.status==='open')).toBe(true);
  await recordWorldCatalog(env);expect(sqlite.prepare('SELECT COUNT(*) count FROM world_registry').get()?.count).toBe(catalog.worlds.filter(world=>world.status==='open').length);
 });
 it('exposes an open origin and a genuinely pending GTA6 without an invented mint or policy',async()=>{
  const response=await request('/api/worlds');expect(response.status).toBe(200);const catalog=await response.json();expect(catalog.governanceMint).toBe(mother);expect(catalog.activeWorldId).toBe('origin');
  expect(catalog.worlds.find((world:{id:string})=>world.id==='gta6')).toMatchObject({status:'pending',quoteMint:null});expect(source.worlds.find(world=>world.id==='gta6')!.launch).toBeNull();expect(fetch).not.toHaveBeenCalled();
  expect(sqlite.prepare('SELECT COUNT(*) count FROM world_registry').get()?.count).toBe(1);
 });
 it('rejects unknown, pending and ambiguous query worlds before any chain request',async()=>{
  for(const path of ['/api/config?world=unknown','/api/state?world=gta6','/api/territories?world=origin&world=gta6']){const response=await request(path);expect([400,404,409]).toContain(response.status);}
  const pending=await request('/api/launches?world=gta6','POST');expect(pending.status).toBe(409);expect((await pending.json()).code).toBe('WORLD_PENDING');expect(fetch).not.toHaveBeenCalled();
 });
 it('keeps the old origin quote when the mother governance mint changes',async()=>{
  await recordWorldCatalog(env);platform.paymentMint=Keypair.generate().publicKey.toBase58();await recordWorldCatalog(env);
  expect(worldCatalog().governanceMint).toBe(platform.paymentMint);expect(worldPolicy('origin').quoteMint).toBe(original.worlds[0].quoteMint);
 });
 it('refuses reassignment or removal of an already exposed open world',async()=>{
  await recordWorldCatalog(env);source.worlds[0].quoteMint=Keypair.generate().publicKey.toBase58();await expect(recordWorldCatalog(env)).rejects.toMatchObject({code:'WORLD_HISTORY_MISMATCH'});
  Object.assign(source,structuredClone(original));source.worlds=source.worlds.filter(world=>world.id!=='origin');await expect(recordWorldCatalog(env)).rejects.toMatchObject({code:'WORLD_HISTORY_MISMATCH'});
 });
 it('refuses duplicate mint/week and requires a deliberate policy before opening a pending world',()=>{
  const next=source.worlds[1];next.status='open';next.quoteMint=source.worlds[0].quoteMint;expect(()=>worldCatalog()).toThrow('distincte');
  next.quoteMint=Keypair.generate().publicKey.toBase58();expect(()=>worldCatalog()).toThrow('Politique');next.launch={initialMarketCapQuote:'20000',migrationMarketCapQuote:'2000000',tradingFeeBps:50};
  expect(worldPolicy('gta6').launch.initialMarketCapQuote).toBe('20000');source.worlds.push({...next,id:'another',quoteMint:Keypair.generate().publicKey.toBase58(),launch:{initialMarketCapQuote:'20000',migrationMarketCapQuote:'2000000',tradingFeeBps:50}});expect(()=>worldCatalog()).toThrow('semaine');
 });
 it('keeps old worlds open when another independently priced world is activated',async()=>{
  await recordWorldCatalog(env);const next=source.worlds[1];next.status='open';next.quoteMint=Keypair.generate().publicKey.toBase58();next.launch={initialMarketCapQuote:'50000',migrationMarketCapQuote:'5000000',tradingFeeBps:150};source.activeWorldId='gta6';
  await recordWorldCatalog(env);expect(worldCatalog().worlds.filter(world=>world.status==='open')).toHaveLength(2);expect(worldPolicy('origin').quoteMint).toBe(original.worlds[0].quoteMint);expect(sqlite.prepare('SELECT COUNT(*) count FROM world_registry').get()?.count).toBe(2);
 });
});
