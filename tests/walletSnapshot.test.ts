import {describe,it,expect} from 'vitest';
import {validateWalletSnapshot} from '../src/lib/useWalletPortfolio';
const asset={mint:'one',name:'Token',symbol:'ONE',color:'#fff',amount:'3',decimals:6,priceUsd:10,valueUsd:30,isNative:false};
const sample=()=>({owner:'walletA',assets:[asset,{...asset,mint:'two',priceUsd:null,valueUsd:null}],totalUsd:30,unpricedCount:1,slot:10,updatedAt:'2026-11-17T12:00:00Z',currency:'USD'});
describe('wallet portfolio response boundary',()=>{
 it('keeps unknown prices separate from the known USD total',()=>{expect(validateWalletSnapshot(sample(),'walletA').totalUsd).toBe(30);});
 it('rejects another wallet and duplicate mint positions',()=>{expect(()=>validateWalletSnapshot(sample(),'walletB')).toThrow();const s=sample();s.assets[1]={...asset};expect(()=>validateWalletSnapshot(s,'walletA')).toThrow();});
 it('rejects inflated totals, NaN prices and inconsistent unknown counts',()=>{for(const s of [{...sample(),totalUsd:300},{...sample(),unpricedCount:0},{...sample(),assets:[{...asset,priceUsd:NaN}]}])expect(()=>validateWalletSnapshot(s,'walletA')).toThrow();});
});
