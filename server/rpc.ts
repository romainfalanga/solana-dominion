import { Buffer } from 'buffer';
import { PublicKey,type AccountInfo } from '@solana/web3.js';
import { PublicError,type RpcAccount } from './types';
export function checkedUrl(value: string): string {
  let url: URL;try { url = new URL(value); } catch { throw new PublicError('Adresse RPC non valide.'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new PublicError('Le RPC doit utiliser HTTPS sans identifiants dans l’URL.');
  return url.href;
}
export async function boundedJson<T>(response: Response,limit = 2_000_000): Promise<T> {
  if (!response.ok || !response.body) throw new PublicError('Le fournisseur de données est momentanément indisponible.');
  const reader = response.body.getReader(),chunks: Uint8Array[] = [];let size = 0;
  try {
    for (;;) {const {done,value} = await reader.read();if (done) break;size += value.byteLength;if (size > limit) {await reader.cancel();throw new PublicError('Réponse du fournisseur trop volumineuse.');}chunks.push(value);}
  } finally {reader.releaseLock();}
  const bytes = new Uint8Array(size);let offset = 0;for (const chunk of chunks) {bytes.set(chunk,offset);offset += chunk.byteLength;}
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}
const PUBLIC_MAINNET = 'https://solana-rpc.publicnode.com/';
const OFFICIAL_MAINNET = 'https://api.mainnet-beta.solana.com/';
const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const READ_METHODS = new Set(['getAccountInfo','getMultipleAccounts','getTransaction','getGenesisHash']);
const TRANSIENT = new Set([429,502,503,504]);
const publicCooldown = new Map<string,{until:number;status:number}>();
let officialVerifiedUntil = 0;
let officialBlockedUntil = 0;
let publicLastStart = Number.NEGATIVE_INFINITY;
let publicStartQueue:Promise<void> = Promise.resolve();
const publicInFlight = new Map<string,Promise<unknown>>();
async function pacePublicStart():Promise<void> {
  const turn=publicStartQueue.then(async()=>{
    const delay=600-(Date.now()-publicLastStart);
    if(delay>0)await new Promise(resolve=>setTimeout(resolve,delay));
    publicLastStart=Date.now();
  });
  publicStartQueue=turn.catch(()=>{});
  await turn;
}
let officialVerification:Promise<void>|undefined;
function unavailable(method:string,status:number,provider:string):never {
  console.error(JSON.stringify({event:'upstream_http_error',provider,method,status}));
  throw new PublicError('Le RPC Solana est momentanément indisponible.',503,provider==='solana-official'?'SOLANA_RPC_BACKUP_UNAVAILABLE':'SOLANA_RPC_UNAVAILABLE');
}
function retryAt(response:Response):number {
  const value=response.headers.get('Retry-After');
  if(value){const seconds=Number(value);if(Number.isFinite(seconds)&&seconds>=0)return Date.now()+Math.max(1000,seconds*1000);const date=Date.parse(value);if(Number.isFinite(date)&&date>Date.now())return date;}
  return Date.now()+30_000;
}
async function requestRpc(endpoint:string,method:string,params:unknown[]):Promise<Response> {
  if(checkedUrl(endpoint)===PUBLIC_MAINNET)await pacePublicStart();
  return fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(8_000)});
}
async function rpcResult<T>(response:Response,method:string,provider:string):Promise<T> {
  if(!response.ok){
    if(provider==='solana-official'&&response.status===403)officialBlockedUntil=Date.now()+300_000;
    unavailable(method,response.status,provider);
  }
  const envelope=await boundedJson<{result?:T;error?:unknown}>(response);
  if(envelope.error||envelope.result===undefined)throw new PublicError('Lecture Solana impossible. Réessayez dans quelques instants.');
  return envelope.result;
}
async function verifyOfficialMainnet():Promise<void> {
  if(Date.now()<officialBlockedUntil)throw new PublicError('Le RPC de secours Solana est temporairement inaccessible.',503,'SOLANA_RPC_BACKUP_UNAVAILABLE');
  if(Date.now()<officialVerifiedUntil)return;
  if(!officialVerification){
    officialVerification=(async()=>{
      const hash=await rpcResult<string>(await requestRpc(OFFICIAL_MAINNET,'getGenesisHash',[]),'getGenesisHash','solana-official');
      if(hash!==MAINNET_GENESIS)throw new PublicError('Le RPC de secours ne correspond pas au réseau principal Solana.',503,'SOLANA_RPC_NETWORK_MISMATCH');
      officialVerifiedUntil=Date.now()+60_000;
    })().finally(()=>{officialVerification=undefined;});
  }
  return officialVerification;
}
async function officialRead<T>(method:string,params:unknown[]):Promise<T> {
  await verifyOfficialMainnet();
  if(method==='getGenesisHash')return MAINNET_GENESIS as T;
  return rpcResult<T>(await requestRpc(OFFICIAL_MAINNET,method,params),method,'solana-official');
}
function smallAccountBatch(method:string,params:unknown[]):params is [string[],Record<string,unknown>?] {
  return method==='getMultipleAccounts'&&params.length<=2&&Array.isArray(params[0])&&params[0].length>0&&params[0].length<=3&&params[0].every(value=>typeof value==='string')&&(params[1]===undefined||(params[1]!==null&&typeof params[1]==='object'&&!Array.isArray(params[1])));
}
async function individualAccounts<T>(endpoint:string,params:[string[],Record<string,unknown>?]):Promise<T> {
  const [addresses,options]=params;
  const requestedSlot=options?.minContextSlot??0;
  if(typeof requestedSlot!=='number'||!Number.isSafeInteger(requestedSlot)||requestedSlot<0)throw new PublicError('Slot minimum non valide.');
  const values:unknown[]=[];let minimumSlot=Number.MAX_SAFE_INTEGER;
  // Tiny batches only: at most two requests in flight; every response retains its
  // actual context, and the aggregate advertises the oldest returned slot.
  for(let start=0;start<addresses.length;start+=2){
    const results=await Promise.all(addresses.slice(start,start+2).map(address=>rpc<{context:{slot:number};value:unknown}>(endpoint,'getAccountInfo',options===undefined?[address]:[address,options])));
    for(const result of results){
      if(!result||!result.context||!Number.isSafeInteger(result.context.slot)||result.context.slot<requestedSlot||!Object.hasOwn(result,'value'))throw new PublicError('Lecture individuelle des comptes incohérente.',503,'SOLANA_RPC_CONTEXT_MISMATCH');
      minimumSlot=Math.min(minimumSlot,result.context.slot);values.push(result.value);
    }
  }
  return {context:{slot:minimumSlot},value:values} as T;
}
async function performRpc<T>(endpoint: string,method: string,params: unknown[]): Promise<T> {
  // This server verifies public chain state only; it never broadcasts transactions.
  if(!READ_METHODS.has(method))throw new PublicError('Méthode RPC non autorisée.',400,'RPC_METHOD_NOT_ALLOWED');
  const publicMainnet=checkedUrl(endpoint)===PUBLIC_MAINNET;
  const cooldown=publicCooldown.get(method);
  if(publicMainnet&&cooldown&&cooldown.until>Date.now()){
    if(cooldown.status===429&&smallAccountBatch(method,params))return individualAccounts<T>(endpoint,params);
    return officialRead<T>(method,params);
  }
  let response:Response|undefined;
  for(let attempt=0;attempt<3;attempt++){
    response=await requestRpc(endpoint,method,params);
    if(publicMainnet&&TRANSIENT.has(response.status)){
      publicCooldown.set(method,{until:retryAt(response),status:response.status});
      console.warn(JSON.stringify({event:'rpc_read_fallback',provider:'publicnode',method,status:response.status}));
      const limited=response.status===429;await response.body?.cancel();
      if(limited&&smallAccountBatch(method,params))return individualAccounts<T>(endpoint,params);
      return officialRead<T>(method,params);
    }
    if(!TRANSIENT.has(response.status)||attempt===2)break;
    await response.body?.cancel();await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));
  }
  return rpcResult<T>(response!,method,publicMainnet?'publicnode':checkedUrl(endpoint)===OFFICIAL_MAINNET?'solana-official':'solana-custom');
}
/** Share identical in-flight public reads only. No completed values or receipts are cached. */
export async function rpc<T>(endpoint:string,method:string,params:unknown[]):Promise<T> {
  if(checkedUrl(endpoint)!==PUBLIC_MAINNET)return performRpc<T>(endpoint,method,params);
  const key=JSON.stringify([method,params]);
  let pending=publicInFlight.get(key);
  if(!pending){
    pending=performRpc<unknown>(endpoint,method,params).finally(()=>{publicInFlight.delete(key);});
    publicInFlight.set(key,pending);
  }
  return structuredClone(await pending) as T;
}
export function accountInfo(raw: RpcAccount | null): AccountInfo<Buffer> | null {
  if (!raw) return null;
  if (!Array.isArray(raw.data) || raw.data[1] !== 'base64') throw new PublicError('Format de compte Solana inattendu.');
  return {data:Buffer.from(raw.data[0],'base64'),owner:new PublicKey(raw.owner),executable:raw.executable,lamports:raw.lamports,rentEpoch:raw.rentEpoch};
}
