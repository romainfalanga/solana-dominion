import {Buffer} from 'buffer';
import {PublicKey} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,unpackMint} from '@solana/spl-token';
import {assertCompatibleQuoteMint} from '../src/lib/quoteMint';
import {accountInfo,rpc} from './rpc';
import {PublicError,type RpcAccount,type RpcContext} from './types';
export const WRAPPED_SOL = 'So11111111111111111111111111111111111111112';
export const PUMP_PROGRAM = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const DISCRIMINATOR = Buffer.from([23,183,248,55,96,216,172,96]);
export function pumpCurveAddress(mint:PublicKey):PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'),mint.toBuffer()],PUMP_PROGRAM)[0];
}
/** Only legacy SOL-quoted pre-graduation accounts from the official Pump IDL.
 * quote_mint==Pubkey::default() means native SOL (pump-public-docs README).
 * Unknown layouts/quote currencies never produce a fallback price. */
export function pumpPriceInSol(address:PublicKey,mintRaw:RpcAccount|null,curveRaw:RpcAccount|null):number|null {
  try {
    const info=accountInfo(mintRaw),curve=accountInfo(curveRaw);
    if(!info||info.executable||(!info.owner.equals(TOKEN_PROGRAM_ID)&&!info.owner.equals(TOKEN_2022_PROGRAM_ID))||!curve||curve.executable||!curve.owner.equals(PUMP_PROGRAM))return null;
    const mint=unpackMint(address,info,info.owner);assertCompatibleQuoteMint(mint,info.owner);
    if(mint.decimals!==6||mint.mintAuthority||mint.supply<=0n)return null;
    const data=curve.data;
    if(data.length!==166||!data.subarray(0,8).equals(DISCRIMINATOR)||data[48]!==0||!data.subarray(83,115).equals(Buffer.alloc(32)))return null;
    const virtualTokens=data.readBigUInt64LE(8),virtualSol=data.readBigUInt64LE(16),realTokens=data.readBigUInt64LE(24),realSol=data.readBigUInt64LE(32),initialSupply=data.readBigUInt64LE(40);
    if(virtualTokens<=0n||virtualSol<=0n||realTokens<=0n||realSol<=0n||realTokens>virtualTokens||realSol>virtualSol||realTokens>mint.supply||mint.supply>initialSupply||initialSupply!==1_000_000_000_000_000n)return null;
    const price=(Number(virtualSol)/1e9)/(Number(virtualTokens)/10**mint.decimals);
    return Number.isFinite(price)&&price>0?price:null;
  }catch{return null;}
}
export async function pumpQuotePrices(endpoint:string,mints:string[],minimumSlot:number):Promise<Map<string,number>> {
  const result=new Map<string,number>();let slot=minimumSlot;
  for(let start=0;start<mints.length;start+=50){
    const batch=mints.slice(start,start+50),addresses=batch.flatMap(mint=>[mint,pumpCurveAddress(new PublicKey(mint)).toBase58()]);
    const response=await rpc<RpcContext<(RpcAccount|null)[]>>(endpoint,'getMultipleAccounts',[addresses,{encoding:'base64',commitment:'finalized',...(slot?{minContextSlot:slot}:{})}]);
    if(response.value.length!==addresses.length||response.context.slot<slot)throw new PublicError('Lecture des courbes de paiement incohérente.');slot=response.context.slot;
    batch.forEach((mint,index)=>{const price=pumpPriceInSol(new PublicKey(mint),response.value[index*2],response.value[index*2+1]);if(price!==null)result.set(mint,price);});
  }
  return result;
}
