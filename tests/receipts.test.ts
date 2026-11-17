import {afterEach,describe,it,expect,vi} from 'vitest';
import type {Connection} from '@solana/web3.js';
import {clearFailedReceipt} from '../src/lib/usePlatform';
const signature='test-public-receipt',key='dominion-pending-registrations-v1';
function storage(){const values=new Map([[key,JSON.stringify([{signature,lastValidBlockHeight:10}])]]);vi.stubGlobal('localStorage',{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v)});return values;}
function connection(status:unknown,height=9){return {getSignatureStatuses:vi.fn().mockResolvedValue({context:{slot:1},value:[status]}),getBlockHeight:vi.fn().mockResolvedValue(height)} as unknown as Pick<Connection,'getSignatureStatuses'|'getBlockHeight'>;}
afterEach(()=>{vi.unstubAllGlobals();});
describe('definitive launch receipt recovery',()=>{
 it('removes a failed transaction so future launches are not permanently blocked',async()=>{const s=storage();await expect(clearFailedReceipt({signature,lastValidBlockHeight:10},'https://rpc.invalid',connection({err:{InstructionError:[0,'InvalidArgument']},confirmationStatus:'finalized'}))).rejects.toThrow('échoué');expect(JSON.parse(s.get(key)!)).toEqual([]);});
 it('removes an absent transaction only after final blockheight proves expiration',async()=>{const s=storage();await expect(clearFailedReceipt({signature,lastValidBlockHeight:10},'https://rpc.invalid',connection(null,11))).rejects.toThrow('expiré');expect(JSON.parse(s.get(key)!)).toEqual([]);});
 it('preserves an unknown transaction that can still land',async()=>{const s=storage();await clearFailedReceipt({signature,lastValidBlockHeight:10},'https://rpc.invalid',connection(null));expect(JSON.parse(s.get(key)!)).toHaveLength(1);});
 it('preserves a confirmed paid launch even after its blockhash expires',async()=>{const s=storage(),c=connection({err:null,confirmationStatus:'finalized'},11);await clearFailedReceipt({signature,lastValidBlockHeight:10},'https://rpc.invalid',c);expect(JSON.parse(s.get(key)!)).toHaveLength(1);expect(c.getBlockHeight).not.toHaveBeenCalled();});
});
