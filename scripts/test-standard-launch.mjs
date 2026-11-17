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
const bundled=resolve('target/test-standard-wallet.mjs');
await build({entryPoints:['src/lib/wallet.ts'],outfile:bundled,bundle:true,packages:'external',platform:'node',format:'esm'});
const {buildStandardLaunchTransaction,LAUNCH_SUPPLY}=await import(pathToFileURL(bundled).href);
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
await mintTo(connection,payer,quote.publicKey,source.address,payer,100_000_000n,[],undefined,TOKEN_2022_PROGRAM_ID);
await setAuthority(connection,payer,quote.publicKey,payer,AuthorityType.MintTokens,null,[],undefined,TOKEN_2022_PROGRAM_ID);
const config={mode:'mainnet-beta',quoteMint:quote.publicKey.toBase58(),quoteSymbol:'PAY',quoteDecimals:6,quoteTokenProgram:TOKEN_2022_PROGRAM_ID.toBase58(),programId:null,rpcUrl:rpc,tradingEnabled:false,creationEnabled:true,worldName:'Local test',creationFeeAtomic:'1000000',treasury:treasury.toBase58(),configVersion:'launch-v1'};
const built=await buildStandardLaunchTransaction(connection,payer.publicKey,config,{name:'🌊'.repeat(8),symbol:'ABCDEFGHIJ'});
assert.equal(built.transaction.instructions.length,9);
assert.deepEqual(JSON.parse(built.transaction.instructions[8].data.toString()),{app:'dominion',version:1,configVersion:'launch-v1',mint:built.mint.publicKey.toBase58(),name:'🌊'.repeat(8),symbol:'ABCDEFGHIJ'});
assert(built.transaction.instructions[8].keys[0].pubkey.equals(payer.publicKey));assert(built.transaction.instructions[8].keys[0].isSigner);
built.transaction.recentBlockhash=(await connection.getLatestBlockhash()).blockhash;
const packetBytes=built.transaction.serialize({requireAllSignatures:false,verifySignatures:false}).length;assert(packetBytes<=1232);
// Worst JSON escaping permitted by input rules and maximum configuration-version length.
const worst=await buildStandardLaunchTransaction(connection,payer.publicKey,{...config,configVersion:'v'.repeat(64)},{name:'\\'.repeat(32),symbol:'ABCDEFGHIJ'});
worst.transaction.recentBlockhash=(await connection.getLatestBlockhash()).blockhash;
const worstPacketBytes=worst.transaction.serialize({requireAllSignatures:false,verifySignatures:false}).length;assert(worstPacketBytes<=1232);
const sig=await sendAndConfirmTransaction(connection,built.transaction,[payer,built.mint],{commitment:'confirmed'});
const minted=await getMint(connection,built.mint.publicKey);assert.equal(minted.supply,LAUNCH_SUPPLY);assert.equal(minted.decimals,6);assert.equal(minted.mintAuthority,null);assert.equal(minted.freezeAuthority,null);
const creatorAta=getAssociatedTokenAddressSync(built.mint.publicKey,payer.publicKey);
assert.equal((await getAccount(connection,creatorAta)).amount,LAUNCH_SUPPLY);
const treasuryAta=getAssociatedTokenAddressSync(quote.publicKey,treasury,false,TOKEN_2022_PROGRAM_ID);
assert.equal((await getAccount(connection,treasuryAta,'confirmed',TOKEN_2022_PROGRAM_ID)).amount,1_000_000n);
assert.equal((await getAccount(connection,source.address,'confirmed',TOKEN_2022_PROGRAM_ID)).amount,99_000_000n);
assert.equal((await connection.getBalance(treasury)),0,'The treasury wallet itself paid no SOL');
// A late payment failure rolls back mint creation, initial allocation, authority revocation and treasury ATA.
const rollbackTreasury=Keypair.generate().publicKey;
const rollback=await buildStandardLaunchTransaction(connection,payer.publicKey,{...config,treasury:rollbackTreasury.toBase58()},{name:'Rollback test',symbol:'ROLL'});
const rollbackAta=getAssociatedTokenAddressSync(quote.publicKey,rollbackTreasury,false,TOKEN_2022_PROGRAM_ID);
rollback.transaction.instructions[7]=createTransferCheckedInstruction(source.address,quote.publicKey,rollbackAta,payer.publicKey,999_000_000n,6,[],TOKEN_2022_PROGRAM_ID);
await assert.rejects(()=>sendAndConfirmTransaction(connection,rollback.transaction,[payer,rollback.mint]));
assert.equal(await connection.getAccountInfo(rollback.mint.publicKey),null);assert.equal(await connection.getAccountInfo(rollbackAta),null);
assert.equal((await getAccount(connection,source.address,'confirmed',TOKEN_2022_PROGRAM_ID)).amount,99_000_000n);
await assert.rejects(()=>buildStandardLaunchTransaction(connection,payer.publicKey,{...config,creationFeeAtomic:'1000000000'},{name:'Poor payment',symbol:'POOR'}),/Solde/);
await assert.rejects(()=>buildStandardLaunchTransaction(connection,payer.publicKey,config,{name:'x'.repeat(33),symbol:'LONG'}),/32 octets/);
await assert.rejects(()=>buildStandardLaunchTransaction(connection,payer.publicKey,config,{name:'bad\u0000name',symbol:'CTRL'}),/contrôle/);
await assert.rejects(()=>buildStandardLaunchTransaction(connection,payer.publicKey,{...config,quoteTokenProgram:TOKEN_PROGRAM_ID.toBase58()},{name:'Wrong program',symbol:'WRONG'}),/incohérent/);
const confirmed=await connection.getTransaction(sig,{maxSupportedTransactionVersion:0});assert.equal(confirmed.meta.err,null);assert(confirmed.meta.computeUnitsConsumed<=500000);
const worstSignature=await sendAndConfirmTransaction(connection,worst.transaction,[payer,worst.mint]);
const worstConfirmed=await connection.getTransaction(worstSignature,{maxSupportedTransactionVersion:0});assert.equal(worstConfirmed.meta.err,null);assert(worstConfirmed.meta.computeUnitsConsumed<=500000);
if(process.argv.includes('--fixture')) {
 await connection.confirmTransaction(sig,'finalized');
 const parsedTransaction=await connection.getParsedTransaction(sig,{commitment:'finalized',maxSupportedTransactionVersion:0});
 assert(parsedTransaction,'Finalized parsed transaction must exist');
 const [mintInfo,quoteInfo]=await connection.getMultipleAccountsInfo([built.mint.publicKey,quote.publicKey],'finalized');
 const raw=info=>({data:[info.data.toString('base64'),'base64'],owner:info.owner.toBase58(),lamports:info.lamports,executable:info.executable,rentEpoch:info.rentEpoch});
 const fixture={description:'Real localhost standard SPL launch; public ephemeral test addresses only; no private keys.',network:'localhost',signature:sig,mint:built.mint.publicKey.toBase58(),payer:payer.publicKey.toBase58(),config,parsedTransaction,mintAccount:raw(mintInfo),quoteMintAccount:raw(quoteInfo)};
 await mkdir('tests/fixtures',{recursive:true});
 await writeFile('tests/fixtures/standard-launch.json',JSON.stringify(fixture,null,2)+'\n');
 console.log('Fixture written: tests/fixtures/standard-launch.json');
}
console.log(JSON.stringify({passed:true,network:'localhost',usesCustomProgram:false,signature:sig,mint:built.mint.publicKey.toBase58(),packetBytes,worstPacketBytes,computeUnits:confirmed.meta.computeUnitsConsumed,worstComputeUnits:worstConfirmed.meta.computeUnitsConsumed,checks:['same SDK builder as browser','metadata Token2022 quote supported','full supply delivered to creator','mint authority revoked and no freeze authority','exact atomic fee delivered','canonical signer memo','treasury wallet paid no SOL','late payment failure rolls back all accounts','insufficient quote rejected before wallet','name byte bounds and controls rejected','wrong quote program rejected']},null,2));
