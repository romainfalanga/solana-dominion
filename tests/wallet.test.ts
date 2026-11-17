import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {Keypair} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID} from '@solana/spl-token';
import worker from '../server/index';
import {readWallet} from '../server/wallet';
import {WRAPPED_SOL} from '../server/pump';
import pumpFixture from './fixtures/pump-quote.json';
const owner=Keypair.generate().publicKey.toBase58(),mint=Keypair.generate().publicKey.toBase58(),unknown=Keypair.generate().publicKey.toBase58();
const classic=TOKEN_PROGRAM_ID.toBase58(),token2022=TOKEN_2022_PROGRAM_ID.toBase58();
const env={SOLANA_RPC_URL:'https://private-rpc.invalid'};
function account(mintAddress:string,amount:string,decimals=6,program=classic,accountOwner=owner){return {pubkey:Keypair.generate().publicKey.toBase58(),account:{owner:program,executable:false,data:{program:'spl-token',parsed:{type:'account',info:{owner:accountOwner,mint:mintAddress,state:'initialized',tokenAmount:{amount,decimals}}}}}};}
let rpcAccounts:Map<string,unknown>;
let native:number,groups:ReturnType<typeof account>[][],dex:unknown[],requests:{method:string;params:unknown[]}[];
beforeEach(()=>{
 rpcAccounts=new Map();native=0;groups=[[],[]];dex=[];requests=[];
 vi.stubGlobal('fetch',vi.fn(async(url,init)=>{
  if(String(url).startsWith('https://api.dexscreener.com/'))return Response.json(dex);
  const {method,params}=JSON.parse(init.body);requests.push({method,params});let result:unknown;
  if(method==='getGenesisHash')result='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
  else if(method==='getBalance')result={context:{slot:103},value:native};
  else if(method==='getTokenAccountsByOwner')result={context:{slot:params[1].programId===classic?102:101},value:groups[params[1].programId===classic?0:1]};
  else if(method==='getMultipleAccounts')result={context:{slot:105},value:params[0].map((address:string)=>rpcAccounts.get(address)??null)};
  else throw new Error('Unexpected RPC');
  return Response.json({jsonrpc:'2.0',id:1,result});
 }));
});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
function quote(address:string,price:string){return {chainId:'solana',pairAddress:'pair',baseToken:{address},quoteToken:{address:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'},priceUsd:price,liquidity:{usd:10000}};}
describe('wallet-wide balances and USD valuation',()=>{
 it('aggregates atomic balances exactly, separates native SOL from WSOL and keeps unknown values null',async()=>{
  native=2_000_000_000;groups=[[account(mint,'1000001'),account(mint,'2000002'),account(WRAPPED_SOL,'500000000',9),account(mint,'0')],[account(unknown,'1',0,token2022)]];dex=[quote(mint,'2'),quote(WRAPPED_SOL,'100')];
  const snapshot=await readWallet(env,owner);expect(snapshot.assets).toHaveLength(4);expect(snapshot.slot).toBe(101);
  expect(snapshot.assets.find(asset=>asset.mint===mint)).toMatchObject({amount:'3.000003',valueUsd:6.000006,priceUsd:2});
  expect(snapshot.assets.find(asset=>asset.isNative)).toMatchObject({mint:'native:sol',amount:'2',valueUsd:200});
  expect(snapshot.assets.find(asset=>asset.mint===WRAPPED_SOL)).toMatchObject({amount:'0.5',valueUsd:50,isNative:false});
  expect(snapshot.assets.find(asset=>asset.mint===unknown)).toMatchObject({amount:'1',priceUsd:null,valueUsd:null});
  expect(snapshot.totalUsd).toBeCloseTo(256.000006);expect(snapshot.unpricedCount).toBe(1);
  expect(requests.filter(request=>request.method==='getTokenAccountsByOwner').map(request=>request.params)).toEqual([[owner,{programId:classic},{encoding:'jsonParsed',commitment:'finalized'}],[owner,{programId:token2022},{encoding:'jsonParsed',commitment:'finalized'}]]);
 });
 it('returns an empty zero wallet without asking for prices',async()=>{
  const snapshot=await readWallet(env,owner);expect(snapshot).toMatchObject({assets:[],totalUsd:0,unpricedCount:0});expect(vi.mocked(fetch).mock.calls.some(([url])=>String(url).includes('dexscreener'))).toBe(false);
 });
 it('rejects wrong ownership, program and conflicting decimals without returning a partial portfolio',async()=>{
  groups=[[account(mint,'1',6,classic,unknown)],[]];await expect(readWallet(env,owner)).rejects.toMatchObject({code:'WALLET_ACCOUNT_INVALID'});
  groups=[[account(mint,'1',6,token2022)],[]];await expect(readWallet(env,owner)).rejects.toMatchObject({code:'WALLET_ACCOUNT_INVALID'});
  groups=[[account(mint,'1',6),account(mint,'2',9)],[]];await expect(readWallet(env,owner)).rejects.toMatchObject({code:'WALLET_ACCOUNT_INVALID'});
 });
 it('rejects unsafe native amounts and oversized enumerations explicitly',async()=>{
  native=Number.MAX_SAFE_INTEGER+1;await expect(readWallet(env,owner)).rejects.toMatchObject({code:'WALLET_ACCOUNT_INVALID'});
  native=0;const one=account(mint,'1');groups=[Array.from({length:1001},()=>one),[]];await expect(readWallet(env,owner)).rejects.toMatchObject({code:'WALLET_TOO_LARGE'});
 });
 it('validates the address before RPC and never uses a shared cache for wallet routes',async()=>{
  const cache={match:vi.fn(),put:vi.fn()};vi.stubGlobal('caches',{default:cache});
  const invalid=await worker.fetch(new Request('https://example.test/api/wallet?owner=not-a-wallet'),env,{waitUntil(){}});expect(invalid.status).toBe(400);expect(requests).toHaveLength(0);
  const response=await worker.fetch(new Request(`https://example.test/api/wallet?owner=${owner}`),env,{waitUntil(){}});expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toBe('private, no-store');expect(cache.match).not.toHaveBeenCalled();expect(cache.put).not.toHaveBeenCalled();
  const missing=await worker.fetch(new Request('https://example.test/api/wallet'),env,{waitUntil(){}});expect(missing.status).toBe(400);
 });
 it('values a held pre-graduation Pump mint from actual account data and SOL conversion',async()=>{
  groups=[[],[account(pumpFixture.mint,'1000000',6,token2022)]];rpcAccounts.set(pumpFixture.mint,pumpFixture.mintAccount);rpcAccounts.set(pumpFixture.curve,pumpFixture.curveAccount);dex=[quote(WRAPPED_SOL,'73.45')];
  const snapshot=await readWallet(env,owner);expect(snapshot.assets[0].amount).toBe('1');expect(snapshot.assets[0].priceUsd).toBeGreaterThan(0);expect(snapshot.totalUsd).toBe(snapshot.assets[0].priceUsd);expect(snapshot.unpricedCount).toBe(0);
 });
 it('keeps known balances and market prices when the optional registry is unavailable',async()=>{
  groups=[[account(mint,'1000000')],[]];dex=[quote(mint,'3')];const DB={prepare(){throw new Error('Registry offline');}};
  expect((await readWallet({...env,DB},owner)).totalUsd).toBe(3);
 });
 it('uses selected-pair names and stable distinct mint colors without assuming a dollar peg',async()=>{
  const usdc='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';groups=[[account(usdc,'1000000'),account(WRAPPED_SOL,'1000000000',9)],[]];
  dex=[{...quote(usdc,'0.9998'),baseToken:{address:usdc,name:'  USD Coin  ',symbol:' USDC '}},quote(WRAPPED_SOL,'73')];
  const first=await readWallet(env,owner),second=await readWallet(env,owner),usd=first.assets.find(asset=>asset.mint===usdc)!;
  expect(usd).toMatchObject({name:'USD Coin',symbol:'USDC',priceUsd:0.9998,valueUsd:0.9998});
  expect(usd.color).not.toBe(first.assets.find(asset=>asset.mint===WRAPPED_SOL)!.color);expect(second.assets.map(asset=>asset.color)).toEqual(first.assets.map(asset=>asset.color));
 });
 it('rejects control and bidi metadata, bounds labels, and uses only the selected liquid pair',async()=>{
  groups=[[account(mint,'1000000'),account(unknown,'1000000')],[]];
  dex=[{...quote(mint,'2'),liquidity:{usd:1},baseToken:{address:mint,name:'Wrong pair',symbol:'WRONG'}},{...quote(mint,'2'),baseToken:{address:mint,name:'A'.repeat(100),symbol:'B'.repeat(40)}},{...quote(unknown,'1'),baseToken:{address:unknown,name:'Spam\nName',symbol:'FAKE\u202e'}}];
  const snapshot=await readWallet(env,owner);expect(snapshot.assets.find(asset=>asset.mint===mint)).toMatchObject({name:'A'.repeat(80),symbol:'B'.repeat(24)});
  const label=`${unknown.slice(0,4)}…${unknown.slice(-4)}`;expect(snapshot.assets.find(asset=>asset.mint===unknown)).toMatchObject({name:label,symbol:label});
 });
 it('reports RPC failure explicitly instead of an empty wallet',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('',{status:403})));await expect(readWallet(env,owner)).rejects.toMatchObject({code:'SOLANA_RPC_UNAVAILABLE'});
 });
});
