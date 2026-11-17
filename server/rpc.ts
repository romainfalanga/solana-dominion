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
const publicCooldown = new Map<string,number>();
let officialVerifiedUntil = 0;
let officialVerification:Promise<void>|undefined;
function unavailable(method:string,status:number):never {
  console.error(JSON.stringify({event:'upstream_http_error',provider:'solana',method,status}));
  throw new PublicError('Le RPC Solana est momentanément indisponible.',503,'SOLANA_RPC_UNAVAILABLE');
}
function retryAt(response:Response):number {
  const value=response.headers.get('Retry-After');
  if(value){const seconds=Number(value);if(Number.isFinite(seconds)&&seconds>=0)return Date.now()+Math.max(1000,seconds*1000);const date=Date.parse(value);if(Number.isFinite(date)&&date>Date.now())return date;}
  return Date.now()+30_000;
}
async function requestRpc(endpoint:string,method:string,params:unknown[]):Promise<Response> {
  return fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(8_000)});
}
async function rpcResult<T>(response:Response,method:string):Promise<T> {
  if(!response.ok)unavailable(method,response.status);
  const envelope=await boundedJson<{result?:T;error?:unknown}>(response);
  if(envelope.error||envelope.result===undefined)throw new PublicError('Lecture Solana impossible. Réessayez dans quelques instants.');
  return envelope.result;
}
async function verifyOfficialMainnet():Promise<void> {
  if(Date.now()<officialVerifiedUntil)return;
  if(!officialVerification){
    officialVerification=(async()=>{
      const hash=await rpcResult<string>(await requestRpc(OFFICIAL_MAINNET,'getGenesisHash',[]),'getGenesisHash');
      if(hash!==MAINNET_GENESIS)throw new PublicError('Le RPC de secours ne correspond pas au réseau principal Solana.',503,'SOLANA_RPC_NETWORK_MISMATCH');
      officialVerifiedUntil=Date.now()+60_000;
    })().finally(()=>{officialVerification=undefined;});
  }
  return officialVerification;
}
async function officialRead<T>(method:string,params:unknown[]):Promise<T> {
  await verifyOfficialMainnet();
  if(method==='getGenesisHash')return MAINNET_GENESIS as T;
  return rpcResult<T>(await requestRpc(OFFICIAL_MAINNET,method,params),method);
}
export async function rpc<T>(endpoint: string,method: string,params: unknown[]): Promise<T> {
  // This server verifies public chain state only; it never broadcasts transactions.
  if(!READ_METHODS.has(method))throw new PublicError('Méthode RPC non autorisée.',400,'RPC_METHOD_NOT_ALLOWED');
  const publicMainnet=checkedUrl(endpoint)===PUBLIC_MAINNET;
  if(publicMainnet&&(publicCooldown.get(method)??0)>Date.now())return officialRead<T>(method,params);
  let response:Response|undefined;
  for(let attempt=0;attempt<3;attempt++){
    response=await requestRpc(endpoint,method,params);
    if(publicMainnet&&TRANSIENT.has(response.status)){
      publicCooldown.set(method,retryAt(response));
      console.warn(JSON.stringify({event:'rpc_read_fallback',provider:'publicnode',method,status:response.status}));
      await response.body?.cancel();
      return officialRead<T>(method,params);
    }
    if(!TRANSIENT.has(response.status)||attempt===2)break;
    await response.body?.cancel();await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));
  }
  return rpcResult<T>(response!,method);
}
export function accountInfo(raw: RpcAccount | null): AccountInfo<Buffer> | null {
  if (!raw) return null;
  if (!Array.isArray(raw.data) || raw.data[1] !== 'base64') throw new PublicError('Format de compte Solana inattendu.');
  return {data:Buffer.from(raw.data[0],'base64'),owner:new PublicKey(raw.owner),executable:raw.executable,lamports:raw.lamports,rentEpoch:raw.rentEpoch};
}
