/** Read-only chain access. Builds a reviewed local artifact, never publishes or signs a transaction.
 * Usage: node scripts/prepare-governance-round.mjs template.json output-round.json
 * template: {id,themeLabel,opensAt,quorumBps,candidates:[{id,label}],excludedOwners:[]}
 * SOLANA_RPC_URL must support full, non-paginated getProgramAccounts withContext.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {PublicKey} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,unpackMint,unpackAccount,ExtensionType,getExtensionTypes} from '@solana/spl-token';
import {build} from 'esbuild';
async function main(){
const [templatePath,outputPath]=process.argv.slice(2);if(!templatePath||!outputPath)throw Error('Usage: node scripts/prepare-governance-round.mjs template.json output-round.json');
const platform=JSON.parse(await readFile('config/platform.json','utf8')),governance=JSON.parse(await readFile('config/governance.json','utf8')),template=JSON.parse(await readFile(templatePath,'utf8'));
const endpoint=process.env.SOLANA_RPC_URL;if(!endpoint||new URL(endpoint).protocol!=='https:')throw Error('Provide an HTTPS SOLANA_RPC_URL.');
async function rpc(method,params=[]){const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(120000)});if(!response.ok)throw Error(`RPC HTTP ${response.status}`);const reader=response.body?.getReader();if(!reader)throw Error('Empty RPC response');const chunks=[];let length=0;for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>64*1024*1024){await reader.cancel();throw Error('RPC response exceeds 64 MiB; use an indexed snapshot service');}chunks.push(value);}const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(data.error||data.result===undefined)throw Error(`RPC ${method} failed`);return data.result;}
const expected=governance.network==='mainnet-beta'?'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d':'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';if(await rpc('getGenesisHash')!==expected)throw Error('Wrong network');
const mintAddress=new PublicKey(platform.paymentMint);
function info(raw){return {...raw,owner:new PublicKey(raw.owner),data:Buffer.from(raw.data[0],'base64')};}
const mintResponse=await rpc('getAccountInfo',[mintAddress.toBase58(),{encoding:'base64',commitment:'finalized'}]);if(!mintResponse.value)throw Error('Mint missing');
const mintInfo=info(mintResponse.value),program=mintInfo.owner;if(![TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID].some(p=>p.equals(program)))throw Error('Unsupported token program');
const mint=unpackMint(mintAddress,mintInfo,program);if(!mint.isInitialized||mint.mintAuthority||mint.freezeAuthority||mint.decimals>18)throw Error('Mint must be initialized, fixed supply, no freeze authority, <=18 decimals');
if(getExtensionTypes(mint.tlvData).some(e=>![ExtensionType.MetadataPointer,ExtensionType.TokenMetadata].includes(e)))throw Error('Unsupported mint extension');
const filters=[{memcmp:{offset:0,bytes:mintAddress.toBase58()}}];if(program.equals(TOKEN_PROGRAM_ID))filters.push({dataSize:165});
// ONE atomic bank-context enumeration. No pagination, dataSlice, per-owner reads, or largest-accounts endpoint.
const capture=await rpc('getProgramAccounts',[program.toBase58(),{encoding:'base64',commitment:'finalized',withContext:true,minContextSlot:mintResponse.context.slot,filters}]);
if(!Array.isArray(capture.value)||!Number.isSafeInteger(capture.context?.slot)||capture.context.slot<mintResponse.context.slot)throw Error('RPC omitted coherent snapshot context');
if(capture.value.length>100000)throw Error('More than 100000 token accounts: dedicated indexed snapshot service required');
const excluded=[...new Set([platform.treasury,...(template.excludedOwners??[])].map(p=>new PublicKey(p).toBase58()))].sort();const weights=new Map(),seen=new Set();let accounted=0n;
for(const row of capture.value){const address=new PublicKey(row.pubkey);if(seen.has(row.pubkey))throw Error('Duplicate token account');seen.add(row.pubkey);const raw=info(row.account);if(raw.executable||!raw.owner.equals(program))throw Error('Wrong account owner');const account=unpackAccount(address,raw,program);if(!account.isInitialized||!account.mint.equals(mintAddress))throw Error('Malformed mint account');if(getExtensionTypes(account.tlvData).some(e=>e!==ExtensionType.ImmutableOwner))throw Error('Unsupported token account extension');accounted+=account.amount;const owner=account.owner.toBase58();if(!account.amount||account.isFrozen||excluded.includes(owner)||!PublicKey.isOnCurve(account.owner.toBytes()))continue;weights.set(owner,(weights.get(owner)??0n)+account.amount);}
// Exact equality catches truncated responses. A concurrent burn requires a complete retry.
if(accounted!==mint.supply)throw Error('Account total differs from fixed supply: incomplete RPC response or concurrent burn. Retry the complete capture.');
const blockTime=await rpc('getBlockTime',[capture.context.slot]);if(!Number.isSafeInteger(blockTime))throw Error('Finalized block time unavailable');const collectedAt=new Date().toISOString();
const snapshot={version:1,network:governance.network,mint:mintAddress.toBase58(),tokenProgram:program.toBase58(),decimals:mint.decimals,slot:capture.context.slot,blockTime,collectedAt,excludedOwners:excluded,weights:[...weights].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([owner,amount])=>({owner,amount:amount.toString()}))};
const compiled=await build({entryPoints:['server/governance.ts'],bundle:true,write:false,platform:'node',format:'esm',packages:'external'});
// Place ephemeral module next to installed dependencies; no secrets or RPC URL written.
const temporary=new URL('../target/governance-operator.mjs',import.meta.url);await mkdir(new URL('../target/',import.meta.url),{recursive:true});await writeFile(temporary,compiled.outputFiles[0].text);const {sha256,roundRules,weeklyUtcWindow,validateGovernanceConfig}=await import(temporary.href);
const round={domain:governance.domain,id:template.id,themeLabel:template.themeLabel,...weeklyUtcWindow(template.opensAt),quorumBps:template.quorumBps,candidates:template.candidates,snapshot,snapshotHash:await sha256(snapshot),rulesHash:''};round.rulesHash=await sha256(roundRules(round));
if(Date.parse(round.opensAt)<=Date.now())throw Error('Round opening must still be in the future');
await validateGovernanceConfig({...governance,governanceMint:platform.paymentMint,rounds:[...governance.rounds,round]});
await writeFile(outputPath,JSON.stringify(round,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output:outputPath,slot:snapshot.slot,owners:snapshot.weights.length,tokenAccounts:seen.size,accountedAtoms:accounted.toString(),snapshotHash:round.snapshotHash,rulesHash:round.rulesHash,warning:'Review exclusions and provider completeness. Append artifact to config/governance.json rounds before opening; never edit a published round.'},null,2));

}
main().catch(error=>{console.error('Préparation interrompue : '+String(error?.message??'Erreur de collecte').replace(/https?:\/\/[^\s]+/g,'[endpoint masqué]'));process.exitCode=1;});
