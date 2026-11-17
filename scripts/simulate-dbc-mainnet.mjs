/** READ ONLY. No sendTransaction/sendRawTransaction, private wallet, or on-chain mutation. */
import {build} from 'esbuild';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {Connection,PublicKey,Keypair,Transaction,VersionedTransaction,ComputeBudgetProgram} from '@solana/web3.js';
import {TOKEN_2022_PROGRAM_ID} from '@solana/spl-token';
import {DynamicBondingCurveClient,deriveDbcPoolAddress} from '@meteora-ag/dynamic-bonding-curve-sdk';
await mkdir('target',{recursive:true});
const path=resolve('target/dbc-simulation.mjs');await build({entryPoints:['src/lib/dbc.ts'],outfile:path,bundle:true,format:'esm',platform:'node',packages:'external'});
const {getDominionCurveParameters,quoteInitialLaunch,readCompatibleQuote,assertDominionDbcConfig,decodeDbcConfig}=await import(pathToFileURL(path).href);
const source=JSON.parse(await readFile('config/platform.json','utf8'));
const run=promisify(execFile);
// This environment's Node networking is restricted; curl uses its configured public egress.
const readOnlyFetch=async(url,init)=>{
 const body=String(init.body),request=JSON.parse(body);
 if(!request.method.startsWith('get')&&request.method!=='simulateTransaction')throw new Error('Read-only RPC method required');
 const {stdout}=await run('curl',['--max-time','25','--silent','--show-error','--fail-with-body',String(url),'-H','Content-Type: application/json','--data-binary',body],{maxBuffer:8*1024*1024});
 return new Response(stdout,{status:200,headers:{'Content-Type':'application/json'}});
};
const connection=new Connection('https://api.mainnet-beta.solana.com',{commitment:'confirmed',fetch:readOnlyFetch});
if(await connection.getGenesisHash()!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw new Error('Mainnet expected');
const config={mode:'mainnet-beta',quoteMint:source.paymentMint,quoteSymbol:'CHOULE',quoteDecimals:6,quoteTokenProgram:TOKEN_2022_PROGRAM_ID.toBase58(),programId:null,rpcUrl:connection.rpcEndpoint,tradingEnabled:true,creationEnabled:true,creationFeeAtomic:'0',treasury:source.treasury,configVersion:'simulation',curveVersion:'dbc-v1',worldName:'Dominion',launchModel:'dbc',dbcConfig:null,curve:source.launch};
const payer=new PublicKey(source.treasury),configKey=Keypair.generate(),baseMint=Keypair.generate();
const {mint,currentEpoch}=await readCompatibleQuote(connection,config);
const {quote,amountIn}=quoteInitialLaunch(config,'1',mint,currentEpoch);
const client=new DynamicBondingCurveClient(connection);
const built=await client.partner.createConfigAndPoolWithFirstBuy({
 ...getDominionCurveParameters(config),config:configKey.publicKey,feeClaimer:payer,leftoverReceiver:payer,quoteMint:new PublicKey(config.quoteMint),payer,transferFeeParameters:null,
 preCreatePoolParam:{baseMint:baseMint.publicKey,poolCreator:payer,name:'DBCsim',symbol:'SIM',uri:'https://d.invalid/m'},
 firstBuyParam:{buyer:payer,buyAmount:amountIn,minimumAmountOut:quote.minimumAmountOut,referralTokenAccount:null},
});
// Short simulation metadata and treasury==payer let us simulate both SDK transactions atomically.
// Production uses separate shared-config setup and pool+buy transactions for arbitrary creators/metadata.
const combined=new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({units:1000000}),built.createConfigTx,built.createPoolWithFirstBuyTx);
combined.feePayer=payer;combined.recentBlockhash=(await connection.getLatestBlockhash('confirmed')).blockhash;
const packetBytes=combined.serialize({requireAllSignatures:false,verifySignatures:false}).length;
const pool=deriveDbcPoolAddress(new PublicKey(config.quoteMint),baseMint.publicKey,configKey.publicKey);
const simulated=await connection.simulateTransaction(new VersionedTransaction(combined.compileMessage()),{sigVerify:false,replaceRecentBlockhash:false,commitment:'confirmed',accounts:{encoding:'base64',addresses:[configKey.publicKey.toBase58(),pool.toBase58(),baseMint.publicKey.toBase58()]}});
if(!simulated.value.err&&simulated.value.accounts?.[0])assertDominionDbcConfig(decodeDbcConfig(Buffer.from(simulated.value.accounts[0].data[0],'base64')),config);
console.log(JSON.stringify({network:'mainnet-beta',broadcast:false,simulationOnly:true,packetBytes,quoteMint:config.quoteMint,amountInAtomic:amountIn.toString(),expectedBaseOutAtomic:quote.outputAmount.toString(),simulationError:simulated.value.err,computeUnits:simulated.value.unitsConsumed,logs:simulated.value.logs?.slice(-12)},null,2));
if(simulated.value.err)process.exitCode=1;
