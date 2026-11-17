import {Buffer} from 'buffer';
import {Connection,PublicKey,Keypair,Transaction,TransactionInstruction,SystemProgram,ComputeBudgetProgram} from '@solana/web3.js';
import {
 TOKEN_PROGRAM_ID,MINT_SIZE,getAssociatedTokenAddressSync,unpackMint,unpackAccount,
 createInitializeMint2Instruction,createAssociatedTokenAccountIdempotentInstruction,
 createMintToInstruction,createSetAuthorityInstruction,createTransferCheckedInstruction,AuthorityType,
} from '@solana/spl-token';
import type {PlatformConfig,CreateTokenInput,TradeInput,Token} from '../types';
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

export class CurveSetupPendingError extends Error {
 readonly stage='config';
 constructor(readonly signature:string,detail='La configuration de courbe attend sa confirmation ou son enregistrement.'){super(`${detail} Reçu conservé : ${signature}. Reprends la création pour continuer sans repayer la configuration.`);this.name='CurveSetupPendingError';}
}
async function walletContext(config:PlatformConfig,operation:'create'|'trade'|'migrate'='create'){
 if(config.mode==='demo'||(operation==='create'&&!config.creationEnabled))throw new Error('Les transactions Solana ne sont pas activées pour ce monde.');
 const provider=phantom(),payer=provider.publicKey;if(!payer)throw new Error('Connecte ton wallet Phantom.');
 const connection=new Connection(config.rpcUrl,{commitment:'confirmed',confirmTransactionInitialTimeout:60000});
 const expected=config.mode==='devnet'?'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG':'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
 if(await connection.getGenesisHash()!==expected)throw new Error('Le réseau RPC ne correspond pas au monde sélectionné.');
 return {provider,payer,connection};
}
const curveReceiptKey=(config:PlatformConfig,payer:PublicKey)=>`dominion-curve-receipt:${config.mode}:${config.quoteMint}:${config.curveVersion}:${config.treasury}:${payer.toBase58()}`;
async function registerCurveReceipt(signature:string,receiptKey:string,config:PlatformConfig):Promise<PlatformConfig>{
 let response:Response;
 try{response=await fetch('/api/curve-config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({signature})});}
 catch{throw new CurveSetupPendingError(signature);}
 if(!response.ok){const body=await response.json().catch(()=>({error:'Enregistrement indisponible.'}));throw new CurveSetupPendingError(signature,body.error);}
 const currentResponse=await fetch('/api/config',{cache:'no-store'});if(!currentResponse.ok)throw new CurveSetupPendingError(signature);
 const current:PlatformConfig=await currentResponse.json();
 if(current.quoteMint!==config.quoteMint||current.curveVersion!==config.curveVersion||!current.dbcConfig)throw new CurveSetupPendingError(signature,'Le monde a changé ; vérifie la configuration active.');
 window.localStorage.removeItem(receiptKey);return current;
}
function checkPacket(transaction:Transaction,payer:PublicKey){
 transaction.feePayer=payer;transaction.recentBlockhash=PublicKey.default.toBase58();
 try{transaction.serialize({requireAllSignatures:false,verifySignatures:false});}
 catch{throw new Error('Cette transaction dépasse la taille Solana autorisée. Raccourcis le nom du token.');}
 transaction.recentBlockhash=undefined;
}
export async function createOnChain(config:PlatformConfig,input:CreateTokenInput):Promise<{signature:string;mint:string;configAddress?:string}> {
 if(config.launchModel!=='dbc')throw new Error('Le lancement par courbe n’est pas activé.');
 const dbc=await import('./dbc');dbc.validateLaunchInput(input);
 const {provider,payer,connection}=await walletContext(config),receiptKey=curveReceiptKey(config,payer);
 let active=config;
 const previous=window.localStorage.getItem(receiptKey);
 if(previous){
  const receipt=JSON.parse(previous);if(typeof receipt.signature!=='string')throw new Error('Reçu de configuration local invalide.');
  const status=(await connection.getSignatureStatuses([receipt.signature],{searchTransactionHistory:true})).value[0];
  if(status?.err){window.localStorage.removeItem(receiptKey);throw new Error('La configuration précédente a été rejetée. Vérifie tes soldes avant de réessayer.');}
  if(!status&&Number.isSafeInteger(receipt.lastValidBlockHeight)&&await connection.getBlockHeight('finalized')>receipt.lastValidBlockHeight){window.localStorage.removeItem(receiptKey);throw new Error('La configuration précédente a expiré sans confirmation. Reprends la création.');}
  active=await registerCurveReceipt(receipt.signature,receiptKey,config);
 }
 await dbc.assertLaunchFunds(connection,payer,active,input.seedAmount!);
 if(!active.dbcConfig){
  const prepared=await dbc.buildCurveSetupTransaction(connection,payer,active);
  checkPacket(prepared.transaction,payer);
  // The general sender persists before broadcasting; mirror that receipt for setup-stage recovery.
  const store={getItem:(key:string)=>window.localStorage.getItem(key),removeItem:(key:string)=>window.localStorage.removeItem(key),setItem:(key:string,value:string)=>{
   window.localStorage.setItem(key,value);
   if(key.startsWith('dominion-pending:')){const pending=JSON.parse(value);window.localStorage.setItem(receiptKey,JSON.stringify({signature:pending.signature,lastValidBlockHeight:pending.lastValidBlockHeight,configAddress:prepared.configKeypair.publicKey.toBase58()}));}
  }};
  let setupSignature:string;
  try{setupSignature=await sendWalletTransaction(connection,provider,payer,prepared.transaction,[prepared.configKeypair],store);}
  catch(error){
   const raw=window.localStorage.getItem(receiptKey);
   if(raw){const receipt=JSON.parse(raw);let rejected=false;try{rejected=Boolean((await connection.getSignatureStatuses([receipt.signature],{searchTransactionHistory:true})).value[0]?.err);}catch{/* Preserve pending when status cannot be read. */}
    if(rejected){window.localStorage.removeItem(receiptKey);throw error;}throw new CurveSetupPendingError(receipt.signature);
   }throw error;
  }
  try{const finalized=await connection.confirmTransaction(setupSignature,'finalized');if(finalized.value.err)throw new Error('Configuration rejetée.');}
  catch{throw new CurveSetupPendingError(setupSignature);}
  active=await registerCurveReceipt(setupSignature,receiptKey,active);
 }
 await checkPending(connection,payer);
 const mintKeypair=Keypair.generate();
 const metadataUri=`${window.location.origin}/api/metadata/${mintKeypair.publicKey.toBase58()}`;
 const built=await dbc.buildDbcLaunchTransaction(connection,payer,active,input,metadataUri,mintKeypair);
 checkPacket(built.transaction,payer);
 const signature=await sendWalletTransaction(connection,provider,payer,built.transaction,[built.mintKeypair]);
 return {signature,mint:built.mintKeypair.publicKey.toBase58(),configAddress:active.dbcConfig!};
}
export async function tradeOnChain(config:PlatformConfig,input:TradeInput):Promise<string> {
 if(config.launchModel!=='dbc'||!config.tradingEnabled)throw new Error('Les échanges ne sont pas activés pour ce monde.');
 const {provider,payer,connection}=await walletContext(config,'trade');await checkPending(connection,payer);
 const {buildDbcTradeTransaction}=await import('./dbc');const transaction=await buildDbcTradeTransaction(connection,payer,config,input);checkPacket(transaction,payer);
 return sendWalletTransaction(connection,provider,payer,transaction);
}


export class MigrationPendingError extends Error {
 readonly stage='migration';
 constructor(readonly signature:string){super(`Migration en attente : ${signature}. Le reçu est conservé. Reprends la migration pour vérifier son état sans la renvoyer.`);this.name='MigrationPendingError';}
}
export async function migrateOnChain(config:PlatformConfig,token:Token):Promise<{signature:string|null;pool:string;marketUrl:string}>{
 const {provider,payer,connection}=await walletContext(config,'migrate'),dbc=await import('./dbc');
 const receiptKey=`dominion-migration-receipt:${config.mode}:${token.pool}:${payer.toBase58()}`;
 const previous=window.localStorage.getItem(receiptKey);
 const state=await dbc.previewMigration(config,token);
 if(state.migrated){window.localStorage.removeItem(receiptKey);return {signature:previous?JSON.parse(previous).signature:null,pool:state.pool,marketUrl:state.marketUrl};}
 if(previous){
  const receipt=JSON.parse(previous);
  const status=(await connection.getSignatureStatuses([receipt.signature],{searchTransactionHistory:true})).value[0];
  if(status?.err){window.localStorage.removeItem(receiptKey);throw new Error('La migration précédente a été rejetée. Vérifie le solde SOL avant de réessayer.');}
  if(!status&&Number.isSafeInteger(receipt.lastValidBlockHeight)&&await connection.getBlockHeight('finalized')>receipt.lastValidBlockHeight){window.localStorage.removeItem(receiptKey);throw new Error('La migration précédente a expiré sans confirmation. Réessaie après actualisation.');}
  throw new MigrationPendingError(receipt.signature);
 }
 await checkPending(connection,payer);
 const prepared=await dbc.buildDbcMigrationTransaction(connection,payer,config,token);checkPacket(prepared.transaction,payer);
 const store={getItem:(key:string)=>window.localStorage.getItem(key),removeItem:(key:string)=>window.localStorage.removeItem(key),setItem:(key:string,value:string)=>{
  window.localStorage.setItem(key,value);if(key.startsWith('dominion-pending:'))window.localStorage.setItem(receiptKey,value);
 }};
 let signature:string;
 try{signature=await sendWalletTransaction(connection,provider,payer,prepared.transaction,prepared.signers,store);}
 catch(error){const receipt=window.localStorage.getItem(receiptKey);if(receipt)throw new MigrationPendingError(JSON.parse(receipt).signature);throw error;}
 const after=await dbc.previewMigration(config,token);
 if(!after.migrated)throw new MigrationPendingError(signature);
 window.localStorage.removeItem(receiptKey);return {signature,pool:after.pool,marketUrl:after.marketUrl};
}
