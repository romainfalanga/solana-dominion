/** Read-only mainnet simulation, deliberately no sendRawTransaction or wallet secret. */
import {build} from 'esbuild';import {readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
import {Connection,PublicKey,VersionedTransaction} from '@solana/web3.js';
const bundled=await build({entryPoints:['src/lib/wallet.ts'],bundle:true,format:'esm',platform:'node',packages:'external',write:false});
const path=new URL('../.wallet-simulation.mjs',import.meta.url);await writeFile(path,bundled.outputFiles[0].contents);
const {buildStandardLaunchTransaction}=await import(path.href);
const source=JSON.parse(await readFile(new URL('../config/platform.json',import.meta.url),'utf8'));
const connection=new Connection('https://api.mainnet-beta.solana.com','confirmed');
if(await connection.getGenesisHash()!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw new Error('Mainnet expected');
const quoteProgram='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',fee='1000000';
const configVersion=createHash('sha256').update(JSON.stringify({cluster:source.cluster,paymentMint:source.paymentMint,treasury:source.treasury,creationFeeAtomic:fee,quoteTokenProgram:quoteProgram})).digest('hex').slice(0,16);
const config={mode:'mainnet-beta',quoteMint:source.paymentMint,quoteSymbol:'CHOULE',quoteDecimals:6,quoteTokenProgram:quoteProgram,programId:null,rpcUrl:connection.rpcEndpoint,tradingEnabled:false,creationEnabled:true,creationFeeAtomic:fee,treasury:source.treasury,configVersion,worldName:'Dominion'};
const built=await buildStandardLaunchTransaction(connection,new PublicKey(source.treasury),config,{name:'Simulation sans envoi',symbol:'SIM'});
built.transaction.recentBlockhash=(await connection.getLatestBlockhash()).blockhash;
const tx=new VersionedTransaction(built.transaction.compileMessage());
const result=await connection.simulateTransaction(tx,{sigVerify:false,replaceRecentBlockhash:false,commitment:'confirmed'});
console.log(JSON.stringify({network:'mainnet-beta',broadcast:false,paymentMint:source.paymentMint,simulationError:result.value.err,unitsConsumed:result.value.unitsConsumed,logs:result.value.logs?.slice(-5)}));
if(result.value.err)process.exitCode=1;
