import {describe,it,expect} from 'vitest';
import {PublicKey} from '@solana/web3.js';
import {TOKEN_2022_PROGRAM_ID,type Mint} from '@solana/spl-token';
import {Buffer} from 'buffer';
import fixture from './fixtures/dbc-launch.json';
import type {PlatformConfig} from '../src/types';
import {getDominionCurveParameters,encodeDominionConfigInstruction,decodeDbcInstruction,quoteInitialLaunch,validateLaunchInput,DBC_SUPPLY,estimateLaunchSol,requireLaunchBalances,isDbcMigrationReady,decodeDbcConfig,decodeDbcPool,migrationPoolAddress} from '../src/lib/dbc';
const config:PlatformConfig={mode:'mainnet-beta',quoteMint:'31CZR8AgCjGsbkjJGUznY99hiKTQkX6J2zxiwN9Mpump',quoteTokenProgram:TOKEN_2022_PROGRAM_ID.toBase58(),quoteSymbol:'CHOULE',quoteDecimals:6,programId:null,rpcUrl:'https://api.mainnet-beta.solana.com',tradingEnabled:true,creationEnabled:true,worldName:'Dominion',creationFeeAtomic:'0',treasury:'sr1GJKY7LWggyQebWWE4BhoyMkC9Wwd3BCRcxchcY8d',configVersion:'test',curveVersion:'dbc-v1',launchModel:'dbc',dbcConfig:null,curve:{initialMarketCapQuote:'10000',migrationMarketCapQuote:'1000000',tradingFeeBps:100}};
const mint:Mint={address:new PublicKey(config.quoteMint!),mintAuthority:null,freezeAuthority:null,supply:1_000_000_000_000_000n,decimals:6,isInitialized:true,tlvData:Buffer.alloc(0)};
describe('Meteora DBC economics',()=>{
 it('locks liquidity, fixes supply, and excludes creator premine and creation fee',()=>{
  const p=getDominionCurveParameters(config);
  expect(p.tokenSupply?.preMigrationTokenSupply.toString()).toBe(DBC_SUPPLY.toString());
  expect(p.tokenSupply?.postMigrationTokenSupply.toString()).toBe(DBC_SUPPLY.toString());
  expect(p.partnerPermanentLockedLiquidityPercentage).toBe(100);
  expect(p.partnerLiquidityPercentage+p.creatorLiquidityPercentage+p.creatorPermanentLockedLiquidityPercentage).toBe(0);
  expect(p.lockedVesting.amountPerPeriod.isZero()).toBe(true);expect(p.poolCreationFee.isZero()).toBe(true);
  expect(p.poolFees.baseFee.cliffFeeNumerator.toString()).toBe('10000000');expect(p.poolFees.dynamicFee).toBeNull();
 });
 it('quotes an allocation, not the entire token supply, and applies slippage',()=>{
  const {quote}=quoteInitialLaunch(config,'100',mint,0);
  expect(BigInt(quote.outputAmount.toString())).toBeGreaterThan(0n);
  expect(BigInt(quote.outputAmount.toString())).toBeLessThan(DBC_SUPPLY);
  expect(quote.minimumAmountOut.lt(quote.outputAmount)).toBe(true);
  expect(quote.amountLeft.isZero()).toBe(true);
 });
 it('larger buys acquire more tokens but at a worse average price',()=>{
  const a=quoteInitialLaunch(config,'100',mint,0).quote.outputAmount;
  const b=quoteInitialLaunch(config,'200',mint,0).quote.outputAmount;
  expect(b.gt(a)).toBe(true);expect(b.lt(a.muln(2))).toBe(true);
 });
 it('rejects zero, huge exact input and invalid economic parameters',()=>{
  expect(()=>quoteInitialLaunch(config,'0',mint,0)).toThrow();
  expect(()=>quoteInitialLaunch(config,'999999999',mint,0)).toThrow();
  expect(()=>getDominionCurveParameters({...config,curve:{...config.curve!,migrationMarketCapQuote:'1'}})).toThrow();
  expect(()=>getDominionCurveParameters({...config,curve:{...config.curve!,tradingFeeBps:9999}})).toThrow();
 });
 it('uses the exact public SDK instruction encoding for canonical verification',()=>{
  const encoded=encodeDominionConfigInstruction(config),decoded=decodeDbcInstruction(encoded);
  expect(decoded?.name).toBe('createConfig2');expect(encoded.length).toBeGreaterThan(150);
  expect(encodeDominionConfigInstruction({...config,curve:{...config.curve!,tradingFeeBps:200}}).equals(encoded)).toBe(false);
 });
 it('validates token text in bytes and requires an initial purchase',()=>{
  expect(validateLaunchInput({name:'🌊'.repeat(8),symbol:'wave',seedAmount:'1'}).symbol).toBe('WAVE');
  expect(()=>validateLaunchInput({name:'🌊'.repeat(9),symbol:'WAVE',seedAmount:'1'})).toThrow();
  expect(()=>validateLaunchInput({name:'Token',symbol:'TOK'})).toThrow();
 });
});

describe('DBC operational preflight and migration',()=>{
 it('requires both initial quote balance and the complete SOL budget before setup',()=>{
  expect(()=>requireLaunchBalances(99n,100n,100_000_000,20_000_000,'CHOULE')).toThrow(/CHOULE insuffisant/);
  expect(()=>requireLaunchBalances(100n,100n,1_000_000,20_000_000,'CHOULE')).toThrow(/SOL/);
  expect(()=>requireLaunchBalances(100n,100n,20_000_000,20_000_000,'CHOULE')).not.toThrow();
 });
 it('budgets first-world setup separately and includes Metaplex fees',async()=>{
  const connection={getMinimumBalanceForRentExemption:async(size:number)=>size*100};
  const shared=await estimateLaunchSol(connection,false),fresh=await estimateLaunchSol(connection,true);
  expect(fresh-shared).toBe(1048*100+10000);expect(shared).toBeGreaterThan(11_000_000);
 });
 it('enables migration only after the on-chain threshold and completed vesting step',()=>{
  const curve=decodeDbcConfig(Buffer.from(fixture.configAccount.data[0],'base64'));
  const pool=decodeDbcPool(Buffer.from(fixture.poolAccount.data[0],'base64'));
  pool.poolState.isMigrated=0;pool.poolState.migrationProgress=2;pool.poolState.quoteReserve=curve.migrationQuoteThreshold.subn(1);
  expect(isDbcMigrationReady(pool,curve)).toBe(false);
  pool.poolState.quoteReserve=curve.migrationQuoteThreshold.clone();expect(isDbcMigrationReady(pool,curve)).toBe(true);
  pool.poolState.migrationProgress=1;expect(isDbcMigrationReady(pool,curve)).toBe(false);
  pool.poolState.migrationProgress=2;pool.poolState.isMigrated=1;expect(isDbcMigrationReady(pool,curve)).toBe(false);
 });
 it('derives a concrete DAMMv2 target independent of the fee-paying wallet',()=>{
  const curve=decodeDbcConfig(Buffer.from(fixture.configAccount.data[0],'base64'));
  const target=migrationPoolAddress(curve,new PublicKey(fixture.mint));
  expect(PublicKey.isOnCurve(target)).toBe(false);expect(target.toBase58()).not.toBe(fixture.pool);
 });
});
