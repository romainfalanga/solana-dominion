import {afterEach,describe,it,expect,vi} from 'vitest';
import {Buffer} from 'buffer';
import {PublicKey} from '@solana/web3.js';
import fixture from './fixtures/pump-quote.json';
import {pumpCurveAddress,pumpPriceInSol,pumpQuotePrices,WRAPPED_SOL} from '../server/pump';
import type {RpcAccount} from '../server/types';
const mint=new PublicKey(fixture.mint),raw=fixture.mintAccount as unknown as RpcAccount;
function changed(offset:number,value:number){const account=structuredClone(fixture.curveAccount) as unknown as RpcAccount;const bytes=Buffer.from(account.data[0],'base64');bytes[offset]=value;account.data[0]=bytes.toString('base64');return account;}
afterEach(()=>vi.unstubAllGlobals());
describe('verified Pump pre-graduation payment quote',()=>{
 it('decodes the actual finalized CHOULE curve and derives its exact PDA',()=>{
  expect(pumpCurveAddress(mint).toBase58()).toBe(fixture.curve);
  const bytes=Buffer.from(fixture.curveAccount.data[0],'base64');
  expect(pumpPriceInSol(mint,raw,fixture.curveAccount as unknown as RpcAccount)).toBe((Number(bytes.readBigUInt64LE(16))/1e9)/(Number(bytes.readBigUInt64LE(8))/1e6));
 });
 it('rejects graduated, discriminator-mismatched and non-SOL curves',()=>{
  expect(pumpPriceInSol(mint,raw,changed(48,1))).toBeNull();
  expect(pumpPriceInSol(mint,raw,changed(0,0))).toBeNull();
  expect(pumpPriceInSol(mint,raw,changed(83,1))).toBeNull();
 });
 it('rejects wrong program, malformed account, zero reserves and impossible supply',()=>{
  expect(pumpPriceInSol(mint,raw,{...fixture.curveAccount,owner:WRAPPED_SOL} as unknown as RpcAccount)).toBeNull();
  expect(pumpPriceInSol(mint,raw,{...fixture.curveAccount,data:['AA==','base64']} as unknown as RpcAccount)).toBeNull();
  const account=structuredClone(fixture.curveAccount) as unknown as RpcAccount,bytes=Buffer.from(account.data[0],'base64');bytes.writeBigUInt64LE(0n,16);account.data[0]=bytes.toString('base64');expect(pumpPriceInSol(mint,raw,account)).toBeNull();
  bytes.writeBigUInt64LE(Buffer.from(fixture.curveAccount.data[0],'base64').readBigUInt64LE(16),16);bytes.writeBigUInt64LE(1n,40);account.data[0]=bytes.toString('base64');expect(pumpPriceInSol(mint,raw,account)).toBeNull();
 });
 it('only requests derived accounts and rejects a snapshot older than the territories',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{const body=JSON.parse(init.body);expect(body.params[0]).toEqual([fixture.mint,fixture.curve]);expect(body.params[1]).toMatchObject({commitment:'finalized',minContextSlot:fixture.slot});return Response.json({jsonrpc:'2.0',id:1,result:{context:{slot:fixture.slot-1},value:[raw,fixture.curveAccount]}});}));
  await expect(pumpQuotePrices('https://rpc.invalid',[fixture.mint],fixture.slot)).rejects.toThrow('incohérente');
 });
});
