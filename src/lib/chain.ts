import {PublicKey} from '@solana/web3.js';
export const POOL_DISCRIMINATOR=new Uint8Array([241,154,109,4,17,177,109,188]);
export function decodePool(bytes:Uint8Array) {
 if(bytes.length<193||!POOL_DISCRIMINATOR.every((v,i)=>bytes[i]===v)) throw new Error('Compte Pool invalide.');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength); let offset=8;
 const key=()=>{const result=new PublicKey(bytes.slice(offset,offset+32)).toBase58(); offset+=32; return result;};
 const creator=key(),mint=key(),quoteMint=key(),tokenVault=key(),quoteVault=key();
 const supply=view.getBigUint64(offset,true).toString();offset+=8;
 const createdAt=Number(view.getBigInt64(offset,true));offset+=8; const bump=bytes[offset++];
 const str=(max:number)=>{const length=view.getUint32(offset,true);offset+=4;if(length>max||offset+length>bytes.length) throw new Error('Métadonnées invalides.');const s=new TextDecoder('utf-8',{fatal:true}).decode(bytes.slice(offset,offset+length));offset+=length;return s;};
 const name=str(32),symbol=str(10);
 return {creator,mint,quoteMint,tokenVault,quoteVault,supply,createdAt,bump,name,symbol};
}
