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
export async function rpc<T>(endpoint: string,method: string,params: unknown[]): Promise<T> {
  let response: Response | undefined;
  for(let attempt=0;attempt<3;attempt++){
   response = await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(8_000)});
   if(![429,502,503,504].includes(response.status)||attempt===2)break;
   await response.body?.cancel();
   await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));
  }
  const envelope = await boundedJson<{result?:T;error?:unknown}>(response!);
  if (envelope.error || envelope.result === undefined) throw new PublicError('Lecture Solana impossible. Réessayez dans quelques instants.');
  return envelope.result;
}
export function accountInfo(raw: RpcAccount | null): AccountInfo<Buffer> | null {
  if (!raw) return null;
  if (!Array.isArray(raw.data) || raw.data[1] !== 'base64') throw new PublicError('Format de compte Solana inattendu.');
  return {data:Buffer.from(raw.data[0],'base64'),owner:new PublicKey(raw.owner),executable:raw.executable,lamports:raw.lamports,rentEpoch:raw.rentEpoch};
}
