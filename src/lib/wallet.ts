import {Buffer} from 'buffer';
import {Connection,PublicKey,Keypair,Transaction,TransactionInstruction,SystemProgram,ComputeBudgetProgram} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,ASSOCIATED_TOKEN_PROGRAM_ID,getAssociatedTokenAddressSync,getMint,unpackAccount} from '@solana/spl-token';
import type {PlatformConfig,CreateTokenInput,TradeInput} from '../types';
import {parseUnits,calculateOutput,minimumOutput} from './math';
import {decodePool} from './chain';
export interface Phantom {isPhantom?:boolean;publicKey:PublicKey|null;connect():Promise<{publicKey:PublicKey}>;disconnect():Promise<void>;signTransaction(tx:Transaction):Promise<Transaction>;on?(name:string,cb:(key:PublicKey|null)=>void):void;removeListener?(name:string,cb:(key:PublicKey|null)=>void):void;}
declare global {interface Window {phantom?:{solana?:Phantom};solana?:Phantom;}}
export function phantom():Phantom {const p=window.phantom?.solana??window.solana;if(!p?.isPhantom)throw new Error('Installe Phantom depuis phantom.app, puis ouvre cette page dans son navigateur ou avec son extension.');return p;}
const discs={initialize_config:[208,127,21,1,194,190,196,70],create_pool:[233,146,209,142,207,104,64,188],buy:[102,6,61,18,1,218,235,234],sell:[51,230,133,164,1,127,131,173]};
const u64=(n:bigint)=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(n);return b;};
const string=(s:string)=>{const b=Buffer.from(s),l=Buffer.alloc(4);l.writeUInt32LE(b.length);return Buffer.concat([l,b]);};
const meta=(pubkey:PublicKey,isWritable=false,isSigner=false)=>({pubkey,isWritable,isSigner});
async function context(config:PlatformConfig){
 if(config.mode==='demo'||!config.tradingEnabled||!config.programId||!config.quoteMint)throw new Error('Les transactions ne sont pas encore activées pour ce monde.');
 const provider=phantom(),payer=provider.publicKey;if(!payer)throw new Error('Connecte ton wallet Phantom.');
 const connection=new Connection(config.rpcUrl,{commitment:'confirmed',confirmTransactionInitialTimeout:60000});
 const expected=config.mode==='devnet'?'EtWTRABZaYq6iMfeYKouRu166VU2xqa1':'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
 if(await connection.getGenesisHash()!==expected)throw new Error('Le réseau RPC ne correspond pas au monde sélectionné.');
 const program=new PublicKey(config.programId),quote=new PublicKey(config.quoteMint);
 const [programAccount,quoteMint]=await Promise.all([connection.getAccountInfo(program),getMint(connection,quote)]);
 if(!programAccount?.executable)throw new Error('Le programme Solana n’est pas déployé.');
 if(quoteMint.freezeAuthority||quoteMint.decimals!==config.quoteDecimals)throw new Error('Le token de paiement ne correspond pas à la configuration.');
 return {provider,payer,connection,program,quote};
}
async function send(connection:Connection,provider:Phantom,payer:PublicKey,tx:Transaction,signers:Keypair[]=[]) {
 const block=await connection.getLatestBlockhash('confirmed');tx.feePayer=payer;tx.recentBlockhash=block.blockhash;
 if(signers.length) tx.partialSign(...signers);
 const simulated=await connection.simulateTransaction(tx);
 if(simulated.value.err)throw new Error(`Simulation refusée : ${JSON.stringify(simulated.value.err)}. Vérifie les soldes SOL et tokens.`);
 const signed=await provider.signTransaction(tx);
 const signature=await connection.sendRawTransaction(signed.serialize(),{skipPreflight:false,maxRetries:3});
 try {const confirmation=await connection.confirmTransaction({...block,signature},'confirmed');if(confirmation.value.err)throw new Error('Transaction rejetée par Solana.');}
 catch(error){throw new Error(`Confirmation incertaine ou rejetée. Vérifie ${signature} dans Solana Explorer avant de réessayer. ${error instanceof Error?error.message:''}`);}
 return signature;
}
export async function createOnChain(config:PlatformConfig,input:CreateTokenInput) {
 const name=input.name.trim(),symbol=input.symbol.trim().toUpperCase();
 if(!name||Buffer.byteLength(name)>32||! /^[A-Z0-9]{1,10}$/.test(symbol))throw new Error('Nom : 32 octets maximum. Symbole : 1 à 10 lettres ou chiffres.');
 const amount=parseUnits(input.seedAmount,config.quoteDecimals);if(amount<=0n)throw new Error('La réserve initiale doit être positive.');
 const {provider,payer,connection,program,quote}=await context(config);
 const mint=Keypair.generate(),[pool]=PublicKey.findProgramAddressSync([Buffer.from('pool'),mint.publicKey.toBuffer()],program),[cfg]=PublicKey.findProgramAddressSync([Buffer.from('config'),quote.toBuffer()],program);
 const tokenVault=getAssociatedTokenAddressSync(mint.publicKey,pool,true),quoteVault=getAssociatedTokenAddressSync(quote,pool,true),creatorQuote=getAssociatedTokenAddressSync(quote,payer);
 const tx=new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({units:400000}));
 if(!await connection.getAccountInfo(cfg))tx.add(new TransactionInstruction({programId:program,keys:[meta(payer,true,true),meta(quote),meta(cfg,true),meta(SystemProgram.programId)],data:Buffer.from(discs.initialize_config)}));
 tx.add(new TransactionInstruction({programId:program,keys:[meta(payer,true,true),meta(cfg),meta(quote),meta(mint.publicKey,true,true),meta(pool,true),meta(tokenVault,true),meta(quoteVault,true),meta(creatorQuote,true),meta(TOKEN_PROGRAM_ID),meta(ASSOCIATED_TOKEN_PROGRAM_ID),meta(SystemProgram.programId)],data:Buffer.concat([Buffer.from(discs.create_pool),string(name),string(symbol),u64(amount)])}));
 return send(connection,provider,payer,tx,[mint]);
}
export async function tradeOnChain(config:PlatformConfig,input:TradeInput) {
 const {provider,payer,connection,program,quote}=await context(config);
 const mint=new PublicKey(input.token.mint),[pool]=PublicKey.findProgramAddressSync([Buffer.from('pool'),mint.toBuffer()],program);
 if(pool.toBase58()!==input.token.pool)throw new Error('Marché invalide.');
 const info=await connection.getAccountInfo(pool);if(!info?.owner.equals(program))throw new Error('Propriétaire du marché invalide.');
 const decoded=decodePool(info.data);if(decoded.quoteMint!==quote.toBase58()||decoded.mint!==mint.toBase58())throw new Error('Monde incompatible.');
 const tokenVault=getAssociatedTokenAddressSync(mint,pool,true),quoteVault=getAssociatedTokenAddressSync(quote,pool,true);
 const vaultInfos=await connection.getMultipleAccountsInfo([tokenVault,quoteVault],'confirmed');
 const base=unpackAccount(tokenVault,vaultInfos[0]),reserve=unpackAccount(quoteVault,vaultInfos[1]);
 const amount=parseUnits(input.amount,input.side==='buy'?config.quoteDecimals:6);
 const expected=calculateOutput(amount,input.side==='buy'?input.token.quoteReserve:input.token.baseReserve,input.side==='buy'?input.token.baseReserve:input.token.quoteReserve),min=minimumOutput(expected,input.slippageBps);
 const fresh=calculateOutput(amount,input.side==='buy'?reserve.amount:base.amount,input.side==='buy'?base.amount:reserve.amount);
 if(fresh<min)throw new Error('Le prix a évolué au-delà du glissement accepté. Actualise le monde et vérifie le nouveau devis.');
 const tx=new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({units:250000}),new TransactionInstruction({programId:program,keys:[meta(payer,true,true),meta(pool),meta(mint),meta(quote),meta(tokenVault,true),meta(quoteVault,true),meta(getAssociatedTokenAddressSync(mint,payer),true),meta(getAssociatedTokenAddressSync(quote,payer),true),meta(TOKEN_PROGRAM_ID),meta(ASSOCIATED_TOKEN_PROGRAM_ID),meta(SystemProgram.programId)],data:Buffer.concat([Buffer.from(discs[input.side]),u64(amount),u64(min),u64(BigInt(Math.floor(Date.now()/1000)+120))])}));
 return send(connection,provider,payer,tx);
}
