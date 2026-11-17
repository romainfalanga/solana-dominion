import bs58 from 'bs58';
import {Connection,PublicKey,Keypair,Transaction,VersionedTransaction} from '@solana/web3.js';
import type {Phantom} from './wallet';
export type TransactionConnection=Pick<Connection,'rpcEndpoint'|'getLatestBlockhash'|'simulateTransaction'|'sendRawTransaction'|'confirmTransaction'|'getSignatureStatuses'|'getBlockHeight'>;
export type PendingStore=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export class PendingTransactionError extends Error { constructor(readonly signature:string,readonly lastValidBlockHeight?:number,readonly rpcEndpoint?:string){super(`Confirmation incertaine : ${signature}. Le reçu est conservé ; ne recrée pas le token. Actualise pour vérifier son enregistrement.`);this.name='PendingTransactionError';} }
interface Pending {signature:string;lastValidBlockHeight:number;}
const storage=():PendingStore=>window.localStorage;
const key=(c:TransactionConnection,p:PublicKey)=>`dominion-pending:${c.rpcEndpoint}:${p.toBase58()}`;
export async function checkPending(c:TransactionConnection,payer:PublicKey,store:PendingStore=storage()):Promise<void>{
 const raw=store.getItem(key(c,payer));if(!raw)return;
 const pending:Pending=JSON.parse(raw);
 if(typeof pending.signature!=='string'||!Number.isSafeInteger(pending.lastValidBlockHeight))throw new Error('État de transaction local invalide. Vérifie tes dernières transactions avant de continuer.');
 const {value}=await c.getSignatureStatuses([pending.signature],{searchTransactionHistory:true});const status=value[0];
 if(status?.err){store.removeItem(key(c,payer));throw new Error(`La transaction précédente a été rejetée : ${pending.signature}. Vérifie le montant avant de réessayer.`);}
 if(status?.confirmationStatus==='confirmed'||status?.confirmationStatus==='finalized'){
  store.removeItem(key(c,payer));throw new Error(`La transaction précédente est confirmée : ${pending.signature}. Actualise tes soldes avant de passer un nouvel ordre.`);
 }
 if(!status&&await c.getBlockHeight('finalized')>pending.lastValidBlockHeight){store.removeItem(key(c,payer));throw new Error(`La transaction précédente a expiré sans confirmation : ${pending.signature}. Actualise le marché avant de réessayer.`);}
 throw new Error(`Transaction encore en attente : ${pending.signature}. Aucun nouvel ordre n’a été envoyé. Vérifie son état dans Solana Explorer.`);
}
export async function sendWalletTransaction(c:TransactionConnection,provider:Phantom,payer:PublicKey,tx:Transaction,signers:Keypair[]=[],store:PendingStore=storage()):Promise<string>{
 await checkPending(c,payer,store);
 const block=await c.getLatestBlockhash('confirmed');tx.feePayer=payer;tx.recentBlockhash=block.blockhash;
 if(signers.length)tx.partialSign(...signers);
 // Simulate a separate immutable message. Legacy simulation may refresh a blockhash and invalidate the mint signature.
 const simulation=new VersionedTransaction(tx.compileMessage());
 const simulated=await c.simulateTransaction(simulation,{sigVerify:false,replaceRecentBlockhash:false,commitment:'confirmed'});
 if(simulated.value.err)throw new Error(`Simulation refusée : ${JSON.stringify(simulated.value.err)}. Vérifie les soldes SOL et tokens.`);
 const message=tx.serializeMessage();const signed=await provider.signTransaction(tx);
 if(!signed.serializeMessage().equals(message))throw new Error('Le wallet a modifié le contenu de la transaction. Aucun envoi effectué.');
 const raw=signed.serialize();if(!signed.signature)throw new Error('Signature absente.');
 const signature=bs58.encode(signed.signature),pending:Pending={signature,lastValidBlockHeight:block.lastValidBlockHeight};
 // Persist before broadcasting: an HTTP timeout can occur after the chain has accepted the transaction.
 store.setItem(key(c,payer),JSON.stringify(pending));
 try{
  const returned=await c.sendRawTransaction(raw,{skipPreflight:false,maxRetries:3});
  if(returned!==signature)throw new Error('Signature retournée par le RPC incohérente.');
  const result=await c.confirmTransaction({...block,signature},'confirmed');
  if(result.value.err){store.removeItem(key(c,payer));throw new Error(`Transaction rejetée par Solana : ${signature}.`);}
  store.removeItem(key(c,payer));return signature;
 }catch(error){
  if(!store.getItem(key(c,payer)))throw error;
  let recovered;
  try{recovered=(await c.getSignatureStatuses([signature],{searchTransactionHistory:true})).value[0];}catch{/* Preserve pending after transport failure. */}
  if(recovered?.confirmationStatus==='confirmed'||recovered?.confirmationStatus==='finalized'){
   store.removeItem(key(c,payer));if(recovered.err)throw new Error(`Transaction rejetée par Solana : ${signature}.`);return signature;
  }
  throw new PendingTransactionError(signature,block.lastValidBlockHeight,c.rpcEndpoint);
 }
}
