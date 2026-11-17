/** Run against a fresh local validator with dominion.so loaded at PROGRAM_ID.
 * No private key is read; ephemeral local-only payer is funded with airdrop.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Connection,Keypair,PublicKey,SystemProgram,Transaction,TransactionInstruction,sendAndConfirmTransaction} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,ASSOCIATED_TOKEN_PROGRAM_ID,ExtensionType,getMintLen,createInitializeMintInstruction,createInitializeMetadataPointerInstruction,createInitializeTransferFeeConfigInstruction,tokenMetadataInitializeWithRentTransfer,setAuthority,AuthorityType,createMint,getOrCreateAssociatedTokenAccount,mintTo,getAssociatedTokenAddressSync,getMint,getAccount} from '@solana/spl-token';
const rpc=process.env.LOCAL_RPC_URL || 'http://127.0.0.1:8899';
assert.match(rpc,/^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/, 'Only a local validator is allowed');
const connection=new Connection(rpc,'confirmed');
const program=new PublicKey('Fg6PaFpoGXkYsidMpWxTWqkZ7FEfcYkgMQHHTPqzW8B');
const payer=Keypair.generate();
const disc=name=>createHash('sha256').update(`global:${name}`).digest().subarray(0,8);
const u64=n=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(n));return b};
const i64=n=>{const b=Buffer.alloc(8);b.writeBigInt64LE(BigInt(n));return b};
const str=s=>{const b=Buffer.from(s);const len=Buffer.alloc(4);len.writeUInt32LE(b.length);return Buffer.concat([len,b])};
const key=(pubkey,isWritable=false,isSigner=false)=>({pubkey,isWritable,isSigner});
const ix=(name,keys,...data)=>new TransactionInstruction({programId:program,keys,data:Buffer.concat([disc(name),...data])});
const send=(instruction,signers=[])=>sendAndConfirmTransaction(connection,new Transaction().add(instruction),[payer,...signers],{commitment:'confirmed'});
const airdrop=await connection.requestAirdrop(payer.publicKey,10_000_000_000);await connection.confirmTransaction(airdrop,'confirmed');
const frozenQuote=await createMint(connection,payer,payer.publicKey,payer.publicKey,6);
const frozenConfig=PublicKey.findProgramAddressSync([Buffer.from('config'),frozenQuote.toBuffer()],program)[0];
await assert.rejects(()=>send(ix('initialize_config',[key(payer.publicKey,true,true),key(frozenQuote),key(frozenConfig,true),key(SystemProgram.programId)])),/6000|FreezeAuthority|gel/);
assert.equal(await connection.getAccountInfo(frozenConfig),null);
const quote=await createMint(connection,payer,payer.publicKey,null,6);
const userQuote=await getOrCreateAssociatedTokenAccount(connection,payer,quote,payer.publicKey);
await mintTo(connection,payer,quote,userQuote.address,payer,10_000_000_000n);
const config=PublicKey.findProgramAddressSync([Buffer.from('config'),quote.toBuffer()],program)[0];
const configIx=ix('initialize_config',[key(payer.publicKey,true,true),key(quote),key(config,true),key(SystemProgram.programId)]);
await send(configIx);
await assert.rejects(()=>send(configIx));
const mint=Keypair.generate();
const pool=PublicKey.findProgramAddressSync([Buffer.from('pool'),mint.publicKey.toBuffer()],program)[0];
const tokenVault=getAssociatedTokenAddressSync(mint.publicKey,pool,true);
const quoteVault=getAssociatedTokenAddressSync(quote,pool,true);
const userToken=getAssociatedTokenAddressSync(mint.publicKey,payer.publicKey);
const createKeys=[key(payer.publicKey,true,true),key(config),key(quote),key(mint.publicKey,true,true),key(pool,true),key(tokenVault,true),key(quoteVault,true),key(userQuote.address,true),key(TOKEN_PROGRAM_ID),key(TOKEN_PROGRAM_ID),key(ASSOCIATED_TOKEN_PROGRAM_ID),key(SystemProgram.programId)];
const createIx=ix('create_pool',createKeys,str('Local integration'),str('LOCAL'),u64(1_000_000_000));
await send(createIx,[mint]);
const mintState=await getMint(connection,mint.publicKey);
assert.equal(mintState.supply,1_000_000_000_000_000n);assert.equal(mintState.mintAuthority,null);assert.equal(mintState.freezeAuthority,null);
assert.equal((await getAccount(connection,tokenVault)).amount,mintState.supply);
const swapKeys=[key(payer.publicKey,true,true),key(pool),key(mint.publicKey),key(quote),key(tokenVault,true),key(quoteVault,true),key(userToken,true),key(userQuote.address,true),key(TOKEN_PROGRAM_ID),key(TOKEN_PROGRAM_ID),key(ASSOCIATED_TOKEN_PROGRAM_ID),key(SystemProgram.programId)];
const deadline=()=>Math.floor(Date.now()/1000)+120;
const swap=(name,amount,min,expiry=deadline(),keys=swapKeys)=>ix(name,keys,u64(amount),u64(min),i64(expiry));
const before=async()=>[(await getAccount(connection,tokenVault)).amount,(await getAccount(connection,quoteVault)).amount];
const baseline=await before();
await assert.rejects(()=>send(swap('buy',100_000_000n,1_000_000_000_000_000n)),/6003|Slippage|minimal/);
assert.deepEqual(await before(),baseline);
await assert.rejects(()=>send(swap('buy',100_000_000n,1n,1)),/6004|Expired|expir/);
assert.deepEqual(await before(),baseline);
const substituted=[...swapKeys];substituted[5]=key(userQuote.address,true);
await assert.rejects(()=>send(swap('buy',100_000_000n,1n,deadline(),substituted)),/Constraint|2001|2015|2006/);
assert.deepEqual(await before(),baseline);
await send(swap('buy',100_000_000n,1n));
const bought=(await getAccount(connection,userToken)).amount;
assert(bought>0n);const afterBuy=await before();assert(afterBuy[0]*afterBuy[1]>=baseline[0]*baseline[1]);
const quoteAfterBuy=(await getAccount(connection,userQuote.address)).amount;
await send(swap('sell',bought,1n));
const final=await before();const quoteAfterSell=(await getAccount(connection,userQuote.address)).amount;
assert.equal((await getAccount(connection,userToken)).amount,0n);
assert(quoteAfterSell-quoteAfterBuy<=100_000_000n);
assert(final[0]*final[1]>=afterBuy[0]*afterBuy[1]);
assert.equal(final[0],mintState.supply);
// Atomic create failure must leave neither mint nor pool allocated.
const failedMint=Keypair.generate();const failedPool=PublicKey.findProgramAddressSync([Buffer.from('pool'),failedMint.publicKey.toBuffer()],program)[0];
const failedKeys=[...createKeys];failedKeys[3]=key(failedMint.publicKey,true,true);failedKeys[4]=key(failedPool,true);failedKeys[5]=key(getAssociatedTokenAddressSync(failedMint.publicKey,failedPool,true),true);failedKeys[6]=key(getAssociatedTokenAddressSync(quote,failedPool,true),true);
await assert.rejects(()=>send(ix('create_pool',failedKeys,str('Rollback'),str('FAIL'),u64(99_000_000_000)),[failedMint]));
assert.equal(await connection.getAccountInfo(failedMint.publicKey),null);assert.equal(await connection.getAccountInfo(failedPool),null);
// A quote matching pump-style metadata-only Token-2022 semantics.
const quote22=Keypair.generate();
const quote22Space=getMintLen([ExtensionType.MetadataPointer]);
await sendAndConfirmTransaction(connection,new Transaction().add(
  SystemProgram.createAccount({fromPubkey:payer.publicKey,newAccountPubkey:quote22.publicKey,space:quote22Space,lamports:await connection.getMinimumBalanceForRentExemption(quote22Space),programId:TOKEN_2022_PROGRAM_ID}),
  createInitializeMetadataPointerInstruction(quote22.publicKey,null,quote22.publicKey,TOKEN_2022_PROGRAM_ID),
  createInitializeMintInstruction(quote22.publicKey,6,payer.publicKey,null,TOKEN_2022_PROGRAM_ID)
),[payer,quote22]);
await tokenMetadataInitializeWithRentTransfer(connection,payer,quote22.publicKey,payer.publicKey,payer,'Quote metadata','Q22','https://example.invalid/q22.json');
const userQuote22=await getOrCreateAssociatedTokenAccount(connection,payer,quote22.publicKey,payer.publicKey,false,'confirmed',undefined,TOKEN_2022_PROGRAM_ID);
await mintTo(connection,payer,quote22.publicKey,userQuote22.address,payer,10_000_000_000n,[],undefined,TOKEN_2022_PROGRAM_ID);
await setAuthority(connection,payer,quote22.publicKey,payer,AuthorityType.MintTokens,null,[],undefined,TOKEN_2022_PROGRAM_ID);
const config22=PublicKey.findProgramAddressSync([Buffer.from('config'),quote22.publicKey.toBuffer()],program)[0];
const mint22=Keypair.generate(),pool22=PublicKey.findProgramAddressSync([Buffer.from('pool'),mint22.publicKey.toBuffer()],program)[0];
const baseVault22=getAssociatedTokenAddressSync(mint22.publicKey,pool22,true),quoteVault22=getAssociatedTokenAddressSync(quote22.publicKey,pool22,true,TOKEN_2022_PROGRAM_ID),userBase22=getAssociatedTokenAddressSync(mint22.publicKey,payer.publicKey);
const keys22=[key(payer.publicKey,true,true),key(config22),key(quote22.publicKey),key(mint22.publicKey,true,true),key(pool22,true),key(baseVault22,true),key(quoteVault22,true),key(userQuote22.address,true),key(TOKEN_PROGRAM_ID),key(TOKEN_2022_PROGRAM_ID),key(ASSOCIATED_TOKEN_PROGRAM_ID),key(SystemProgram.programId)];
const initialize22=ix('initialize_config',[key(payer.publicKey,true,true),key(quote22.publicKey),key(config22,true),key(SystemProgram.programId)]);
const create22=ix('create_pool',keys22,str('Token twenty two quote market'),str('T22'),u64(1_000_000_000));
// Config initialization and pool creation in ONE transaction, as the browser does.
const combinedSignature=await sendAndConfirmTransaction(connection,new Transaction().add(initialize22,create22),[payer,mint22]);
const swapKeys22=[key(payer.publicKey,true,true),key(pool22),key(mint22.publicKey),key(quote22.publicKey),key(baseVault22,true),key(quoteVault22,true),key(userBase22,true),key(userQuote22.address,true),key(TOKEN_PROGRAM_ID),key(TOKEN_2022_PROGRAM_ID),key(ASSOCIATED_TOKEN_PROGRAM_ID),key(SystemProgram.programId)];
const wrongQuoteProgram=[...swapKeys22];wrongQuoteProgram[9]=key(TOKEN_PROGRAM_ID);
await assert.rejects(()=>send(swap('buy',100_000_000n,1n,deadline(),wrongQuoteProgram)));
const quote22Before=(await getAccount(connection,quoteVault22,'confirmed',TOKEN_2022_PROGRAM_ID)).amount;
await send(swap('buy',100_000_000n,1n,deadline(),swapKeys22));
const purchased22=(await getAccount(connection,userBase22)).amount;assert(purchased22>0n);
assert.equal((await getAccount(connection,quoteVault22,'confirmed',TOKEN_2022_PROGRAM_ID)).amount,quote22Before+100_000_000n);
await send(swap('sell',purchased22,1n,deadline(),swapKeys22));
assert.equal((await getAccount(connection,userBase22)).amount,0n);
assert.equal((await getAccount(connection,baseVault22)).amount,1_000_000_000_000_000n);
assert((await getAccount(connection,quoteVault22,'confirmed',TOKEN_2022_PROGRAM_ID)).amount>=quote22Before);
// Transfer-fee tokens MUST be rejected on chain before a world can be created.
const feeQuote=Keypair.generate(),feeSpace=getMintLen([ExtensionType.TransferFeeConfig]);
await sendAndConfirmTransaction(connection,new Transaction().add(
 SystemProgram.createAccount({fromPubkey:payer.publicKey,newAccountPubkey:feeQuote.publicKey,space:feeSpace,lamports:await connection.getMinimumBalanceForRentExemption(feeSpace),programId:TOKEN_2022_PROGRAM_ID}),
 createInitializeTransferFeeConfigInstruction(feeQuote.publicKey,payer.publicKey,payer.publicKey,100,100000n,TOKEN_2022_PROGRAM_ID),
 createInitializeMintInstruction(feeQuote.publicKey,6,payer.publicKey,null,TOKEN_2022_PROGRAM_ID)
),[payer,feeQuote]);
const feeConfig=PublicKey.findProgramAddressSync([Buffer.from('config'),feeQuote.publicKey.toBuffer()],program)[0];
await assert.rejects(()=>send(ix('initialize_config',[key(payer.publicKey,true,true),key(feeQuote.publicKey),key(feeConfig,true),key(SystemProgram.programId)])),/6009|UnsupportedQuoteExtension|non autoris/);
assert.equal(await connection.getAccountInfo(feeConfig),null);
const combined=await connection.getTransaction(combinedSignature,{commitment:'confirmed',maxSupportedTransactionVersion:0});
assert(combined.meta.computeUnitsConsumed<400000);
console.log(JSON.stringify({passed:true,token2022Checks:['metadata-only quote create with atomic config','wrong quote program rejected','Token2022 buy and sell conservation','transferfee quote rejected'],atomicCreateComputeUnits:combined.meta.computeUnitsConsumed,checks:['freezeable quote rejected','config reinitialization rejected','fixed supply and revoked authorities','slippage rollback','expired quote rollback','substituted vault rejected','buy and sell conservation','roundtrip no profit','failed creation atomic rollback'],pool:pool.toBase58(),network:'local validator'},null,2));
