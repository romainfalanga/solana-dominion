import {describe,it,expect,vi} from 'vitest';
import {Keypair,Transaction,SystemProgram,VersionedTransaction} from '@solana/web3.js';
import bs58 from 'bs58';
import {sendWalletTransaction,checkPending,PendingTransactionError,type TransactionConnection,type PendingStore} from '../src/lib/transactions';
import type {Phantom} from '../src/lib/wallet';
function setup(){const payer=Keypair.generate(),mint=Keypair.generate(),values=new Map<string,string>();const store:PendingStore={getItem:k=>values.get(k)??null,setItem:(k,v)=>{values.set(k,v);},removeItem:k=>{values.delete(k);}};
 const tx=new Transaction().add(SystemProgram.createAccount({fromPubkey:payer.publicKey,newAccountPubkey:mint.publicKey,lamports:1,space:0,programId:SystemProgram.programId}));
 const conn={rpcEndpoint:'https://example.test',getLatestBlockhash:vi.fn().mockResolvedValue({blockhash:Keypair.generate().publicKey.toBase58(),lastValidBlockHeight:999}),simulateTransaction:vi.fn().mockResolvedValue({value:{err:null}}),sendRawTransaction:vi.fn(async(raw:Uint8Array)=>bs58.encode(Transaction.from(raw).signature!)),confirmTransaction:vi.fn().mockResolvedValue({value:{err:null}}),getSignatureStatuses:vi.fn().mockResolvedValue({value:[null]}),getBlockHeight:vi.fn().mockResolvedValue(900)};
 const provider:Phantom={publicKey:payer.publicKey,connect:async()=>({publicKey:payer.publicKey}),disconnect:async()=>{},signTransaction:async(t)=>{t.partialSign(payer);return t;}};
 return {payer,mint,store,values,tx,conn,provider};}
const asConnection=(c:ReturnType<typeof setup>['conn'])=>c as unknown as TransactionConnection;
describe('wallet broadcasts',()=>{
 it('simulates without changing signed legacy message, confirms and clears receipt',async()=>{const t=setup();const sig=await sendWalletTransaction(asConnection(t.conn),t.provider,t.payer.publicKey,t.tx,[t.mint],t.store);expect(sig).toBe(bs58.encode(t.tx.signature!));expect(t.conn.simulateTransaction.mock.calls[0][0]).toBeInstanceOf(VersionedTransaction);expect(t.values.size).toBe(0);expect(t.tx.verifySignatures()).toBe(true);});
 it('keeps the signature after uncertain broadcast and blocks duplicate send',async()=>{const t=setup();t.conn.sendRawTransaction.mockRejectedValue(new Error('HTTP timeout'));await expect(sendWalletTransaction(asConnection(t.conn),t.provider,t.payer.publicKey,t.tx,[t.mint],t.store)).rejects.toBeInstanceOf(PendingTransactionError);expect(t.values.size).toBe(1);await expect(checkPending(asConnection(t.conn),t.payer.publicKey,t.store)).rejects.toThrow('en attente');expect(t.conn.sendRawTransaction).toHaveBeenCalledTimes(1);});
 it('recovers successful broadcast when HTTP response is lost',async()=>{const t=setup();t.conn.sendRawTransaction.mockRejectedValue(new Error('HTTP timeout'));t.conn.getSignatureStatuses.mockResolvedValue({value:[{err:null,confirmationStatus:'finalized'}]});const sig=await sendWalletTransaction(asConnection(t.conn),t.provider,t.payer.publicKey,t.tx,[t.mint],t.store);expect(sig).toBe(bs58.encode(t.tx.signature!));expect(t.values.size).toBe(0);});
});
