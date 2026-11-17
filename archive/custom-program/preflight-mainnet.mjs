/** Read-only. No signer, no sendTransaction, no private key input. */
import {readFile,stat,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
const manifest=JSON.parse(await readFile(new URL('../config/mainnet.json',import.meta.url),'utf8'));
const endpoint=process.env.SOLANA_RPC_URL||'https://api.mainnet-beta.solana.com';
if(new URL(endpoint).protocol!=='https:')throw new Error('HTTPS RPC required');
const allowed=new Set(['getGenesisHash','getMultipleAccounts','getMinimumBalanceForRentExemption','getTokenAccountsByOwner']);
async function rpc(method,params=[]){if(!allowed.has(method))throw new Error('Read-only method required');const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error(`RPC HTTP ${r.status}`);const data=await r.json();if(data.error)throw new Error(`RPC refused ${method}`);return data.result;}
for(const field of ['quoteMint','quoteTokenProgram','deploymentWallet'])new PublicKey(manifest[field]);
if(await rpc('getGenesisHash')!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw new Error('Not mainnet');
const keys=[manifest.deploymentWallet,manifest.quoteMint];if(manifest.programId)keys.push(new PublicKey(manifest.programId).toBase58());
const accounts=await rpc('getMultipleAccounts',[keys,{encoding:'jsonParsed',commitment:'finalized'}]);
const [wallet,mint,program]=accounts.value;const info=mint?.data?.parsed?.info;
const checks=[];function check(name,ok,detail){checks.push({name,ok:Boolean(ok),detail});}
check('wallet-system-owner',wallet?.owner==='11111111111111111111111111111111'&&wallet.space===0,'Wallet utilisateur, pas un compte programme');
check('quote-owner',mint?.owner===manifest.quoteTokenProgram,'Programme de token attendu');
check('quote-decimals',info?.decimals===manifest.quoteDecimals,'Décimales vérifiées sur chaîne');
check('quote-authorities',info?.isInitialized&&!info?.freezeAuthority&&!info?.mintAuthority,'Pas de création supplémentaire ni gel');
const extensions=info?.extensions??[];check('quote-extensions',extensions.every(x=>['metadataPointer','tokenMetadata'].includes(x.extension)),extensions.map(x=>x.extension));
const binary=new URL('../target/deploy/dominion.so',import.meta.url);let binaryBytes=null,sha256=null,rent=null;
try{binaryBytes=(await stat(binary)).size;sha256=createHash('sha256').update(await readFile(binary)).digest('hex');const lengths={program:36,programData:binaryBytes+45,buffer:binaryBytes+37};const entries=await Promise.all(Object.entries(lengths).map(async([k,size])=>[k,await rpc('getMinimumBalanceForRentExemption',[size,{commitment:'finalized'}])]));rent=Object.fromEntries(entries);rent.finalLamports=rent.program+rent.programData;rent.conservativePeakLamports=rent.finalLamports+rent.buffer;
}catch(error){if(error?.code!=='ENOENT')throw error;}
check('binary-present',binaryBytes!==null,'Reconstruire après choix de l’identifiant du programme');
check('program-id-configured',manifest.programId!==null,'Identifiant de développement non utilisable pour un déploiement propriétaire');
check('program-deployed',program?.executable,'Programme réel mainnet requis avant activation du site');
const balance=wallet?.lamports??0;
check('funding-final-rent',rent&&balance>=rent.finalLamports,'Frais réseau et marge supplémentaire non inclus');
const tokens=await rpc('getTokenAccountsByOwner',[manifest.deploymentWallet,{mint:manifest.quoteMint},{encoding:'jsonParsed',commitment:'finalized'}]);
const tokenBalance=tokens.value.reduce((s,a)=>s+BigInt(a.account.data.parsed.info.tokenAmount.amount),0n);
const report={checkedAt:new Date().toISOString(),cluster:'mainnet-beta',slot:accounts.context.slot,manifest,walletLamports:balance,quoteBalanceAtomic:tokenBalance.toString(),binary:{bytes:binaryBytes,sha256},rent,checks,ready:checks.every(c=>c.ok),notes:['Lecture seule : aucun fonds transféré.','Le budget conservateur inclut un buffer provisoire ; ce n’est pas un devis de frais réseau.','La clé de signature du wallet et l’autorité de déploiement restent sous contrôle utilisateur.','Tests internes uniquement, aucun audit externe.']};
if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));if(!report.ready)process.exitCode=2;
