import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
const primary='https://solana-rpc.publicnode.com/',official='https://api.mainnet-beta.solana.com/';
const genesis='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
let calls:{url:string;method:string;params:unknown[]}[];
const answer=(result:unknown)=>Response.json({jsonrpc:'2.0',id:1,result});
beforeEach(()=>{vi.resetModules();calls=[];vi.spyOn(console,'warn').mockImplementation(()=>{});vi.spyOn(console,'error').mockImplementation(()=>{});});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});
function transport(handler:(url:string,method:string,params:unknown[])=>Response){vi.stubGlobal('fetch',vi.fn(async(url,init)=>{const {method,params}=JSON.parse(init.body);calls.push({url:String(url),method,params});return handler(String(url),method,params);}));}
describe('read-only public mainnet RPC failover',()=>{
 it('switches immediately on429, checks genesis, and preserves finalized minContextSlot exactly',async()=>{
  transport((url,method)=>url===primary?new Response('',{status:429,headers:{'Retry-After':'60'}}):answer(method==='getGenesisHash'?genesis:{context:{slot:500},value:[null]}));
  const {rpc}=await import('../server/rpc');const params=[['mint1','mint2','mint3','mint4'],{encoding:'base64',commitment:'finalized',minContextSlot:499}];
  expect(await rpc(primary,'getMultipleAccounts',params)).toEqual({context:{slot:500},value:[null]});
  expect(calls).toEqual([{url:primary,method:'getMultipleAccounts',params},{url:official,method:'getGenesisHash',params:[]},{url:official,method:'getMultipleAccounts',params}]);
  await rpc(primary,'getMultipleAccounts',params);expect(calls).toHaveLength(4);expect(calls.at(-1)).toEqual({url:official,method:'getMultipleAccounts',params});
 });
 it('respects Retry-After per method and resumes primary when the cooldown expires',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-17T00:00:00Z'));let failures=0;
  transport((url,method)=>url===primary&&method==='getMultipleAccounts'&&failures++===0?new Response('',{status:429,headers:{'Retry-After':'90'}}):answer(method==='getGenesisHash'?genesis:null));
  const {rpc}=await import('../server/rpc');await rpc(primary,'getMultipleAccounts',[]);await rpc(primary,'getAccountInfo',[]);
  expect(calls.at(-1)?.url).toBe(primary);vi.setSystemTime(Date.now()+31_000);await rpc(primary,'getMultipleAccounts',[]);expect(calls.at(-1)?.url).toBe(official);
  vi.setSystemTime(Date.now()+60_000);await rpc(primary,'getMultipleAccounts',[]);expect(calls.at(-1)?.url).toBe(primary);
 });
 it('refuses another cluster before issuing any data request to fallback',async()=>{
  transport(url=>url===primary?new Response('',{status:503}):answer('EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'));
  const {rpc}=await import('../server/rpc');await expect(rpc(primary,'getAccountInfo',['mint'])).rejects.toMatchObject({code:'SOLANA_RPC_NETWORK_MISMATCH'});
  expect(calls.map(call=>call.method)).toEqual(['getAccountInfo','getGenesisHash']);
 });
 it('never reroutes a private/custom/devnet endpoint or broadcasts a transaction',async()=>{
  transport(()=>new Response('',{status:403}));const {rpc}=await import('../server/rpc');
  for(const endpoint of ['https://private.invalid/key','https://api.devnet.solana.com/','https://solana-rpc.publicnode.com/?secret=key'])await expect(rpc(endpoint,'getAccountInfo',[])).rejects.toMatchObject({code:'SOLANA_RPC_UNAVAILABLE'});
  expect(calls.every(call=>call.url!==official)).toBe(true);const count=calls.length;
  await expect(rpc(primary,'sendTransaction',['signed-data'])).rejects.toMatchObject({code:'RPC_METHOD_NOT_ALLOWED'});expect(calls).toHaveLength(count);
 });
 it('uses a30-second default cooldown for503 and revalidates genesis after its short cache expires',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-17T00:00:00Z'));
  transport((url,method)=>url===primary?new Response('',{status:503}):answer(method==='getGenesisHash'?genesis:null));
  const {rpc}=await import('../server/rpc');await rpc(primary,'getTransaction',['receipt']);vi.setSystemTime(Date.now()+20_000);await rpc(primary,'getTransaction',['receipt']);
  expect(calls.filter(c=>c.url===primary)).toHaveLength(1);vi.setSystemTime(Date.now()+41_000);await rpc(primary,'getTransaction',['receipt']);
  expect(calls.filter(c=>c.url===primary)).toHaveLength(2);expect(calls.filter(c=>c.method==='getGenesisHash')).toHaveLength(2);
 });
});

describe('small rate-limited account batch decomposition',()=>{
 it('preserves nulls, order, exact options and minimum actual slot with at most two requests in flight',async()=>{
  let active=0,peak=0;const options={commitment:'finalized',encoding:'base64',minContextSlot:100,dataSlice:{offset:0,length:82}};
  vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
    const body=JSON.parse(init.body);calls.push({url:String(url),...body});
    if(body.method==='getMultipleAccounts')return new Response('',{status:429});
    expect(String(url)).toBe(primary);expect(body.method).toBe('getAccountInfo');expect(body.params[1]).toEqual(options);
    active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,5));active--;
    const index=['a','b','c'].indexOf(body.params[0]);return answer({context:{slot:[103,101,105][index]},value:index===1?null:{address:body.params[0]}});
  }));
  const {rpc}=await import('../server/rpc');const result=await rpc(primary,'getMultipleAccounts',[['a','b','c'],options]);
  expect(result).toEqual({context:{slot:101},value:[{address:'a'},null,{address:'c'}]});expect(peak).toBe(2);
  await rpc(primary,'getMultipleAccounts',[['a','b','c'],options]);expect(calls.filter(call=>call.method==='getMultipleAccounts')).toHaveLength(1);
 });
 it('rejects stale individual context and never decomposes403 or large batches',async()=>{
  transport((_url,method)=>method==='getMultipleAccounts'?new Response('',{status:429}):answer({context:{slot:99},value:null}));
  const {rpc}=await import('../server/rpc');await expect(rpc(primary,'getMultipleAccounts',[['a'],{minContextSlot:100}])).rejects.toMatchObject({code:'SOLANA_RPC_CONTEXT_MISMATCH'});
  vi.resetModules();calls=[];transport(()=>new Response('',{status:403}));const other=await import('../server/rpc');
  await expect(other.rpc(primary,'getMultipleAccounts',[['a'],{minContextSlot:100}])).rejects.toMatchObject({code:'SOLANA_RPC_UNAVAILABLE'});expect(calls.map(call=>call.method)).toEqual(['getMultipleAccounts']);
  // The separate failover test uses four accounts and asserts official RPC batching.
 });
});
