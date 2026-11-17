import {Buffer} from 'buffer';
import {Connection,PublicKey,Keypair,Transaction,TransactionInstruction,SystemProgram,ComputeBudgetProgram} from '@solana/web3.js';
import {
 TOKEN_PROGRAM_ID,MINT_SIZE,getAssociatedTokenAddressSync,unpackMint,unpackAccount,
 createInitializeMint2Instruction,createAssociatedTokenAccountIdempotentInstruction,
 createMintToInstruction,createSetAuthorityInstruction,createTransferCheckedInstruction,AuthorityType,
} from '@solana/spl-token';
import type {PlatformConfig,CreateTokenInput,TradeInput} from '../types';
import {assertCompatibleQuoteMint} from './quoteMint';
import {sendWalletTransaction,checkPending} from './transactions';
export interface Phantom {isPhantom?:boolean;publicKey:PublicKey|null;connect():Promise<{publicKey:PublicKey}>;disconnect():Promise<void>;signTransaction(tx:Transaction):Promise<Transaction>;on?(name:string,cb:(key:PublicKey|null)=>void):void;removeListener?(name:string,cb:(key:PublicKey|null)=>void):void;}
declare global {interface Window {phantom?:{solana?:Phantom};solana?:Phantom;}}
export function phantom():Phantom {const p=window.phantom?.solana??window.solana;if(!p?.isPhantom)throw new Error('Installe Phantom depuis phantom.app, puis ouvre cette page dans son navigateur ou avec son extension.');return p;}
export const LAUNCH_SUPPLY=1_000_000_000_000_000n;
export const LAUNCH_DECIMALS=6;
export const MEMO_PROGRAM_ID=new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
export type LaunchConnection=Pick<Connection,'getAccountInfo'|'getMinimumBalanceForRentExemption'>;

/** Build the exact atomic launch registered by the server; never submit or sign here. */
export async function buildStandardLaunchTransaction(
 connection:LaunchConnection,payer:PublicKey,config:PlatformConfig,input:CreateTokenInput,mint:Keypair=Keypair.generate(),
) {
 const name=input.name.trim(),symbol=input.symbol.trim().toUpperCase();
 if(!name||Buffer.byteLength(name,'utf8')>32||/[\u0000-\u001f\u007f]/.test(name)||! /^[A-Z0-9]{1,10}$/.test(symbol))throw new Error('Nom : 32 octets maximum, sans caractères de contrôle. Symbole : 1 à 10 lettres ou chiffres.');
 if(!/^[A-Za-z0-9_.:-]{1,64}$/.test(config.configVersion))throw new Error('Version de configuration invalide.');
 if(!/^\d+$/.test(config.creationFeeAtomic))throw new Error('Frais de création invalides.');
 const fee=BigInt(config.creationFeeAtomic);
 if(fee<=0n||fee>(1n<<64n)-1n)throw new Error('Frais de création invalides.');
 if(!config.quoteMint||!config.treasury)throw new Error('Le paiement de création n’est pas configuré.');
 const quote=new PublicKey(config.quoteMint),quoteProgram=new PublicKey(config.quoteTokenProgram),treasury=new PublicKey(config.treasury);
 const [quoteInfo,rent]=await Promise.all([connection.getAccountInfo(quote,'confirmed'),connection.getMinimumBalanceForRentExemption(MINT_SIZE,'confirmed')]);
 if(!quoteInfo||!quoteInfo.owner.equals(quoteProgram))throw new Error('Programme du token de paiement incohérent.');
 const quoteMint=unpackMint(quote,quoteInfo,quoteProgram);assertCompatibleQuoteMint(quoteMint,quoteProgram);
 if(quoteMint.decimals!==config.quoteDecimals)throw new Error('Les décimales du paiement ne correspondent pas à la configuration.');
 const source=getAssociatedTokenAddressSync(quote,payer,false,quoteProgram);
 const sourceInfo=await connection.getAccountInfo(source,'confirmed');
 if(!sourceInfo)throw new Error(`Ton wallet doit posséder au moins les frais de création en ${config.quoteSymbol}.`);
 const sourceAccount=unpackAccount(source,sourceInfo,quoteProgram);
 if(!sourceAccount.owner.equals(payer)||!sourceAccount.mint.equals(quote)||sourceAccount.isFrozen||sourceAccount.amount<fee)throw new Error(`Solde ${config.quoteSymbol} insuffisant ou compte de paiement invalide.`);
 const recipient=getAssociatedTokenAddressSync(quote,treasury,true,quoteProgram);
 const creatorToken=getAssociatedTokenAddressSync(mint.publicKey,payer);
 const memo={app:'dominion',version:1,configVersion:config.configVersion,mint:mint.publicKey.toBase58(),name,symbol};
 const transaction=new Transaction().add(
  ComputeBudgetProgram.setComputeUnitLimit({units:500000}),
  SystemProgram.createAccount({fromPubkey:payer,newAccountPubkey:mint.publicKey,space:MINT_SIZE,lamports:rent,programId:TOKEN_PROGRAM_ID}),
  createInitializeMint2Instruction(mint.publicKey,LAUNCH_DECIMALS,payer,null,TOKEN_PROGRAM_ID),
  createAssociatedTokenAccountIdempotentInstruction(payer,creatorToken,payer,mint.publicKey,TOKEN_PROGRAM_ID),
  createMintToInstruction(mint.publicKey,creatorToken,payer,LAUNCH_SUPPLY,[],TOKEN_PROGRAM_ID),
  createSetAuthorityInstruction(mint.publicKey,payer,AuthorityType.MintTokens,null,[],TOKEN_PROGRAM_ID),
  createAssociatedTokenAccountIdempotentInstruction(payer,recipient,treasury,quote,quoteProgram),
  createTransferCheckedInstruction(source,quote,recipient,payer,fee,quoteMint.decimals,[],quoteProgram),
  new TransactionInstruction({programId:MEMO_PROGRAM_ID,keys:[{pubkey:payer,isSigner:true,isWritable:false}],data:Buffer.from(JSON.stringify(memo),'utf8')}),
 );
 // Measure the complete legacy packet including both signatures, before wallet interaction.
 transaction.feePayer=payer;transaction.recentBlockhash=PublicKey.default.toBase58();
 try{transaction.serialize({requireAllSignatures:false,verifySignatures:false});}
 catch{throw new Error('Nom ou configuration trop volumineux pour une transaction Solana. Raccourcis le nom.');}
 transaction.recentBlockhash=undefined;
 return {transaction,mint,memo};
}

export async function createOnChain(config:PlatformConfig,input:CreateTokenInput):Promise<{signature:string;mint:string}> {
 if(config.mode==='demo'||!config.creationEnabled)throw new Error('La création de tokens sur Solana n’est pas activée pour ce monde.');
 const provider=phantom(),payer=provider.publicKey;if(!payer)throw new Error('Connecte ton wallet Phantom.');
 const connection=new Connection(config.rpcUrl,{commitment:'confirmed',confirmTransactionInitialTimeout:60000});
 const expected=config.mode==='devnet'?'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG':'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
 if(await connection.getGenesisHash()!==expected)throw new Error('Le réseau RPC ne correspond pas au monde sélectionné.');
 await checkPending(connection,payer);
 const built=await buildStandardLaunchTransaction(connection,payer,config,input);
 const signature=await sendWalletTransaction(connection,provider,payer,built.transaction,[built.mint]);
 return {signature,mint:built.mint.publicKey.toBase58()};
}
export async function tradeOnChain(_config:PlatformConfig,_input:TradeInput):Promise<never> {
 throw new Error('Ce token n’a pas de marché intégré. Sa création ne crée ni liquidité ni prix.');
}
