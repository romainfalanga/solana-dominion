import {PublicKey} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID} from '@solana/spl-token';
import type {WalletAsset,WalletSnapshot} from '../src/walletTypes';
import {formatUnits} from '../src/lib/math';
import {PublicError,type Env,type RegisteredLaunch,type RpcContext} from './types';
import {rpc} from './rpc';
import {settings,verifyNetwork,resolveConfig} from './settings';
import {prices,readSnapshot,colorFor} from './market';
import {pumpQuotePrices,WRAPPED_SOL} from './pump';
const MAX_ACCOUNTS=1000,MAX_MINTS=250,U64_MAX=18_446_744_073_709_551_615n;
interface ParsedAccount {pubkey:string;account:{owner:string;executable:boolean;data:{program:string;parsed:{type:string;info:{owner:string;mint:string;state:string;tokenAmount:{amount:string;decimals:number}}}}}}
function invalid():never {throw new PublicError('Les comptes du wallet ne peuvent pas être vérifiés.',503,'WALLET_ACCOUNT_INVALID');}
function checkedSlot(value:number):number {if(!Number.isSafeInteger(value)||value<0)invalid();return value;}
export async function readWallet(env:Env,ownerInput:string):Promise<WalletSnapshot>{
  let owner:string;try{owner=new PublicKey(ownerInput).toBase58();}catch{throw new PublicError('Adresse de wallet non valide.',400,'INVALID_OWNER');}
  const cfg=settings(env);await verifyNetwork(env);
  const programs=[TOKEN_PROGRAM_ID.toBase58(),TOKEN_2022_PROGRAM_ID.toBase58()];
  const [native,...groups]=await Promise.all([
    rpc<RpcContext<number>>(cfg.privateRpc,'getBalance',[owner,{commitment:'finalized'}]),
    ...programs.map(programId=>rpc<RpcContext<ParsedAccount[]>>(cfg.privateRpc,'getTokenAccountsByOwner',[owner,{programId},{encoding:'jsonParsed',commitment:'finalized'}])),
  ]);
  if(!Number.isSafeInteger(native.value)||native.value<0)invalid();
  let slot=checkedSlot(native.context.slot),accountCount=0;const seen=new Set<string>(),holdings=new Map<string,{amount:bigint;decimals:number;program:string}>();
  groups.forEach((group,index)=>{
    slot=Math.min(slot,checkedSlot(group.context.slot));if(!Array.isArray(group.value))invalid();accountCount+=group.value.length;
    if(accountCount>MAX_ACCOUNTS)throw new PublicError('Ce wallet dépasse la limite de 1000 comptes. Aucun portefeuille partiel n’est affiché.',503,'WALLET_TOO_LARGE');
    for(const entry of group.value){
      const account=entry.account,parsed=account?.data?.parsed,info=parsed?.info;
      if(!entry.pubkey||seen.has(entry.pubkey)||account?.owner!==programs[index]||account.executable!==false||!['spl-token','spl-token-2022'].includes(account.data?.program)||parsed?.type!=='account'||info?.owner!==owner||!['initialized','frozen'].includes(info.state))invalid();
      let mint:string;try{new PublicKey(entry.pubkey);mint=new PublicKey(info.mint).toBase58();}catch{invalid();}seen.add(entry.pubkey);
      const amount=info.tokenAmount?.amount,decimals=info.tokenAmount?.decimals;
      if(typeof amount!=='string'||!/^\d+$/.test(amount)||amount.length>20||!Number.isInteger(decimals)||decimals<0||decimals>255)invalid();
      const atomic=BigInt(amount);if(atomic>U64_MAX)invalid();if(atomic===0n)continue;
      const previous=holdings.get(mint!);if(previous&&(previous.decimals!==decimals||previous.program!==programs[index]))invalid();
      const total=(previous?.amount??0n)+atomic;if(total>U64_MAX)invalid();holdings.set(mint!,{amount:total,decimals,program:programs[index]});
    }
  });
  if(holdings.size>MAX_MINTS)throw new PublicError('Ce wallet dépasse la limite de 250 tokens. Aucun portefeuille partiel n’est affiché.',503,'WALLET_TOO_LARGE');
  const assets:WalletAsset[]=[];
  if(native.value>0)assets.push({mint:'native:sol',name:'Solana',symbol:'SOL',color:'#ad93e8',amount:formatUnits(BigInt(native.value),9),decimals:9,priceUsd:null,valueUsd:null,isNative:true});
  for(const [mint,holding] of holdings){const label=`${mint.slice(0,4)}…${mint.slice(-4)}`;assets.push({mint,name:mint===WRAPPED_SOL?'Wrapped SOL':label,symbol:mint===WRAPPED_SOL?'WSOL':label,color:colorFor(mint),amount:formatUnits(holding.amount,holding.decimals),decimals:holding.decimals,priceUsd:null,valueUsd:null,isNative:false});}
  if(cfg.cluster==='mainnet-beta'&&assets.length){
    const requested=[...new Set(assets.map(asset=>asset.isNative?WRAPPED_SOL:asset.mint))],quotes=await prices(requested);
    // Account enumeration proves possession, while Pump verifies the mint and curve independently.
    const candidates=[...holdings].filter(([mint,holding])=>mint!==WRAPPED_SOL&&holding.decimals===6&&!quotes.has(mint)).map(([mint])=>mint);
    const pump=await pumpQuotePrices(cfg.privateRpc,candidates,slot);
    if(pump.size){const sol=quotes.get(WRAPPED_SOL)??(await prices([WRAPPED_SOL])).get(WRAPPED_SOL);if(sol)for(const [mint,price] of pump)quotes.set(mint,{price:price*sol.price,change:null});}
    for(const asset of assets){
      if(asset.isNative||asset.mint===WRAPPED_SOL)continue;
      const metadata=quotes.get(asset.mint);if(metadata?.name)asset.name=metadata.name;if(metadata?.symbol)asset.symbol=metadata.symbol;
    }
    // Only held registered mints enter the optional protocol-price path. An unrelated
    // registry error cannot hide balances or the prices already obtained above.
    if(env.DB&&holdings.size){try{
      const held=[...holdings.keys()],registered:RegisteredLaunch[]=[];
      for(let i=0;i<held.length;i+=80){const batch=held.slice(i,i+80);const rows=await env.DB.prepare(`SELECT * FROM launches WHERE cluster = ? AND mint IN (${batch.map(()=>'?').join(',')})`).bind(cfg.cluster,...batch).all<RegisteredLaunch>();if(!rows.success||!rows.results)throw new Error('Registry unavailable');registered.push(...rows.results);}
      for(const asset of assets){const row=registered.find(row=>row.mint===asset.mint);if(row){asset.name=row.name;asset.symbol=row.symbol;}}
      const dbc=registered.filter(row=>row.model==='dbc');
      if(dbc.length){const config=await resolveConfig(env),snapshot=await readSnapshot(env,config,dbc);for(const token of snapshot.tokens)if(holdings.has(token.mint)&&token.price>0)quotes.set(token.mint,{price:token.price,change:null});}
    }catch{console.warn(JSON.stringify({event:'wallet_registry_prices_unavailable'}));}}
    for(const asset of assets){const price=quotes.get(asset.isNative?WRAPPED_SOL:asset.mint)?.price;if(price===undefined)continue;const value=Number(asset.amount)*price;if(!Number.isFinite(value)||value<0)throw new PublicError('Valorisation du wallet hors limites.');asset.priceUsd=price;asset.valueUsd=value;}
  }
  const totalUsd=assets.reduce((sum,asset)=>sum+(asset.valueUsd??0),0);if(!Number.isFinite(totalUsd))throw new PublicError('Valorisation du wallet hors limites.');
  return {owner,assets,totalUsd,unpricedCount:assets.filter(asset=>asset.valueUsd===null).length,updatedAt:new Date().toISOString(),slot,currency:'USD'};
}
