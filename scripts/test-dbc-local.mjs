/** Real standard SPL launch test. Uses the SAME TypeScript transaction builder as Phantom.
 * All keys are ephemeral; RPC is restricted to localhost; no custom program is needed.
 */
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {Connection,Keypair,PublicKey,SystemProgram,Transaction,sendAndConfirmTransaction} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,ExtensionType,getMintLen,createInitializeMintInstruction,createInitializeMetadataPointerInstruction,tokenMetadataInitializeWithRentTransfer,getOrCreateAssociatedTokenAccount,mintTo,setAuthority,AuthorityType,getAssociatedTokenAddressSync,getMint,getAccount,createTransferCheckedInstruction} from '@solana/spl-token';
const rpc=process.env.LOCAL_RPC_URL||'http://127.0.0.1:8899';
assert.match(rpc,/^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/,'Only a local validator is allowed');
await mkdir('target',{recursive:true});
const bundled=resolve('target/test-dbc-wallet.mjs');
await build({entryPoints:['src/lib/dbc.ts'],outfile:bundled,bundle:true,packages:'external',platform:'node',format:'esm'});
const {buildCurveSetupTransaction,buildDbcLaunchTransaction,buildDbcTradeTransaction,previewLaunch,previewTrade,decodeDbcConfig,decodeDbcPool,assertDominionDbcConfig,DBC_SUPPLY,previewMigration,buildDbcMigrationTransaction}=await import(pathToFileURL(bundled).href);
const connection=new Connection(rpc,'confirmed'),payer=Keypair.generate(),treasury=Keypair.generate().publicKey;
const airdrop=await connection.requestAirdrop(payer.publicKey,5_000_000_000);await connection.confirmTransaction(airdrop,'confirmed');
const quote=Keypair.generate(),space=getMintLen([ExtensionType.MetadataPointer]);
await sendAndConfirmTransaction(connection,new Transaction().add(
 SystemProgram.createAccount({fromPubkey:payer.publicKey,newAccountPubkey:quote.publicKey,space,lamports:await connection.getMinimumBalanceForRentExemption(space),programId:TOKEN_2022_PROGRAM_ID}),
 createInitializeMetadataPointerInstruction(quote.publicKey,null,quote.publicKey,TOKEN_2022_PROGRAM_ID),
 createInitializeMintInstruction(quote.publicKey,6,payer.publicKey,null,TOKEN_2022_PROGRAM_ID)
),[payer,quote]);
await tokenMetadataInitializeWithRentTransfer(connection,payer,quote.publicKey,payer.publicKey,payer,'Launch payment','PAY','https://example.invalid/pay.json');
const source=await getOrCreateAssociatedTokenAccount(connection,payer,quote.publicKey,payer.publicKey,false,'confirmed',undefined,TOKEN_2022_PROGRAM_ID);
await mintTo(connection,payer,quote.publicKey,source.address,payer,50_000_000_000_000n,[],undefined,TOKEN_2022_PROGRAM_ID);
await setAuthority(connection,payer,quote.publicKey,payer,AuthorityType.MintTokens,null,[],undefined,TOKEN_2022_PROGRAM_ID);
const config={mode:'mainnet-beta',launchModel:'dbc',quoteMint:quote.publicKey.toBase58(),quoteSymbol:'PAY',quoteDecimals:6,quoteTokenProgram:TOKEN_2022_PROGRAM_ID.toBase58(),programId:null,rpcUrl:rpc,tradingEnabled:true,creationEnabled:true,worldName:'Local DBC test',creationFeeAtomic:'0',treasury:treasury.toBase58(),configVersion:'1234567890abcdef',curveVersion:'abcdef1234567890',dbcConfig:null,curve:{initialMarketCapQuote:'10000',migrationMarketCapQuote:'1000000',tradingFeeBps:100}};
const packet=async tx=>{tx.feePayer=payer.publicKey;tx.recentBlockhash=(await connection.getLatestBlockhash()).blockhash;return tx.serialize({requireAllSignatures:false,verifySignatures:false}).length;};
const setup=await buildCurveSetupTransaction(connection,payer.publicKey,config);const setupBytes=await packet(setup.transaction);assert(setupBytes<=1232);
const setupSig=await sendAndConfirmTransaction(connection,setup.transaction,[payer,setup.configKeypair]);config.dbcConfig=setup.configKeypair.publicKey.toBase58();
assertDominionDbcConfig(decodeDbcConfig((await connection.getAccountInfo(setup.configKeypair.publicKey)).data),config);
const small=await previewLaunch(config,'100'),large=await previewLaunch(config,'1000');assert(Number(large.tokensOut)>Number(small.tokensOut));assert(large.sharePercent<100);
const built=await buildDbcLaunchTransaction(connection,payer.publicKey,config,{name:'Local Dominion',symbol:'LOCAL',seedAmount:'1000'},'https://solana-dominion.romainfalanga83.workers.dev/api/token/'+Keypair.generate().publicKey.toBase58()+'.json');
const launchBytes=await packet(built.transaction);assert(launchBytes<=1232);
const quoteBefore=(await getAccount(connection,source.address,'confirmed',TOKEN_2022_PROGRAM_ID)).amount;
const launchSig=await sendAndConfirmTransaction(connection,built.transaction,[payer,built.mintKeypair]);
const baseMint=built.mintKeypair.publicKey,baseAta=getAssociatedTokenAddressSync(baseMint,payer.publicKey);
const minted=await getMint(connection,baseMint);assert.equal(minted.supply,DBC_SUPPLY);assert.equal(minted.mintAuthority,null);assert.equal(minted.freezeAuthority,null);
const firstBalance=(await getAccount(connection,baseAta)).amount;assert(firstBalance>0n&&firstBalance<DBC_SUPPLY);assert.equal(firstBalance,BigInt(built.quote.outputAmount.toString()));
assert.equal(quoteBefore-(await getAccount(connection,source.address,'confirmed',TOKEN_2022_PROGRAM_ID)).amount,1_000_000_000n);
const poolRaw=await connection.getAccountInfo(built.pool);const poolState=decodeDbcPool(poolRaw.data).poolState;assert.equal(poolState.baseMint.toBase58(),baseMint.toBase58());assert.equal(poolState.config.toBase58(),config.dbcConfig);
const token={mint:baseMint.toBase58(),pool:built.pool.toBase58(),launchModel:'dbc',name:'Local Dominion',symbol:'LOCAL',color:'#fa9',creator:payer.publicKey.toBase58(),supply:DBC_SUPPLY.toString(),baseReserve:'0',quoteReserve:'0',decimals:6,quoteDecimals:6,marketCap:0,price:0,change24h:null,createdAt:0};
for(const side of ['buy','sell']){const input={token,side,amount:side==='buy'?'200':'1000',slippageBps:100};const preview=await previewTrade(config,input);input.minimumOutAtomic=preview.minimumOutAtomic;const tx=await buildDbcTradeTransaction(connection,payer.publicKey,config,input);assert(await packet(tx)<=1232);const sig=await sendAndConfirmTransaction(connection,tx,[payer]);assert.equal((await connection.getTransaction(sig,{maxSupportedTransactionVersion:0})).meta.err,null);}
// Atomic failure on an unfunded initial purchase must leave neither pool nor mint.
const poor=Keypair.generate();await connection.confirmTransaction(await connection.requestAirdrop(poor.publicKey,1_000_000_000),'confirmed');
const rollback=await buildDbcLaunchTransaction(connection,poor.publicKey,config,{name:'No balance',symbol:'NONE',seedAmount:'1000'},'https://example.invalid/token.json');
await assert.rejects(()=>sendAndConfirmTransaction(connection,rollback.transaction,[poor,rollback.mintKeypair]));assert.equal(await connection.getAccountInfo(rollback.mintKeypair.publicKey),null);assert.equal(await connection.getAccountInfo(rollback.pool),null);
await connection.confirmTransaction(setupSig,'finalized');await connection.confirmTransaction(launchSig,'finalized');
const raw=info=>({data:[info.data.toString('base64'),'base64'],owner:info.owner.toBase58(),lamports:info.lamports,executable:info.executable,rentEpoch:info.rentEpoch});
const [mintInfo,quoteInfo,curveInfo]=await connection.getMultipleAccountsInfo([baseMint,quote.publicKey,setup.configKeypair.publicKey],'finalized');
const fixture={description:'Actual transactions on localhost with downloaded mainnet DBC and Metaplex programs; ephemeral public addresses only, no private keys.',network:'localhost',config,payer:payer.publicKey.toBase58(),mint:baseMint.toBase58(),pool:built.pool.toBase58(),setupSignature:setupSig,launchSignature:launchSig,setupTransaction:await connection.getParsedTransaction(setupSig,{commitment:'finalized',maxSupportedTransactionVersion:0}),launchTransaction:await connection.getParsedTransaction(launchSig,{commitment:'finalized',maxSupportedTransactionVersion:0}),mintAccount:raw(mintInfo),quoteMintAccount:raw(quoteInfo),configAccount:raw(curveInfo),poolAccount:raw(poolRaw)};
await mkdir('tests/fixtures',{recursive:true});await writeFile('tests/fixtures/dbc-launch.json',JSON.stringify(fixture,null,2)+'\n');
console.log(JSON.stringify({passed:true,network:'localhost',setupBytes,launchBytes,initialBuyTokens:large.tokensOut,initialSupplyPercent:large.sharePercent,checks:['real mainnet DBC program on local validator','Token2022 metadata quote','shared configuration invariants','larger purchase buys more supply','creator receives purchased allocation only','supply held by protocol, no mint or freeze authority','atomic quote payment','subsequent buy and sell','insufficient funds rolls back pool and mint','finalized fixtures with no secrets']},null,2));

if(process.argv.includes('--migration')){
 // Mirror the already-funded mainnet protocol authority on this isolated local chain.
 await connection.confirmTransaction(await connection.requestAirdrop(new PublicKey('FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM'),1_000_000_000),'confirmed');
 const input={token,side:'buy',amount:'1000000',slippageBps:100};const preview=await previewTrade(config,input);input.minimumOutAtomic=preview.minimumOutAtomic;const tx=await buildDbcTradeTransaction(connection,payer.publicKey,config,input);await sendAndConfirmTransaction(connection,tx,[payer]);
 const before=await previewMigration(config,token);assert(before.ready&&!before.migrated);const migration=await buildDbcMigrationTransaction(connection,payer.publicKey,config,token);const migrationBytes=await packet(migration.transaction);assert(migrationBytes<=1232);
 const migrationSignature=await sendAndConfirmTransaction(connection,migration.transaction,[payer,...migration.signers]);const after=await previewMigration(config,token);assert(after.migrated&&!after.ready);assert.equal(after.pool,migration.pool.toBase58());assert(await connection.getAccountInfo(migration.pool));await assert.rejects(()=>buildDbcMigrationTransaction(connection,payer.publicKey,config,token),/déjà migré/);
 console.log(JSON.stringify({migrationPassed:true,migrationSignature,migrationBytes,marketPool:after.pool,checks:['large buy reaches threshold','permissionless DBC to DAMMv2 migration','actual DAMMv2 pool account','repeated migration rejected']}));
}
