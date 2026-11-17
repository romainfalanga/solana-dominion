import {Connection} from '@solana/web3.js';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {PlatformConfig,Snapshot,CreateTokenInput,TradeInput} from '../types';
import {demoConfig,initialDemo,palette,revalue} from './demo';
import {phantom,createOnChain,tradeOnChain,migrateOnChain} from './wallet';
import {PendingTransactionError} from './transactions';
const RECEIPTS='dominion-pending-registrations-v1',STORE='dominion-demo-v2';
interface LaunchReceipt{signature:string;rpcUrl?:string;lastValidBlockHeight?:number;worldId?:string}
const worldPath=(path:string,worldId='origin')=>worldId==='origin'?path:`${path}?world=${encodeURIComponent(worldId)}`;
function pending():LaunchReceipt[]{try{const data=JSON.parse(localStorage.getItem(RECEIPTS)||'[]');return Array.isArray(data)?data.map(r=>typeof r==='string'?{signature:r}:r).filter(r=>r&&typeof r.signature==='string').slice(-30):[];}catch{return [];}}
function forget(signature:string){localStorage.setItem(RECEIPTS,JSON.stringify(pending().filter(r=>r.signature!==signature)));}
function remember(signature:string,rpcUrl?:string,lastValidBlockHeight?:number,worldId='origin'){localStorage.setItem(RECEIPTS,JSON.stringify([...pending().filter(r=>r.signature!==signature),{signature,rpcUrl,lastValidBlockHeight,worldId}].slice(-30)));}
export async function clearFailedReceipt(receipt:LaunchReceipt,rpcUrl:string,connection?:Pick<Connection,'getSignatureStatuses'|'getBlockHeight'>):Promise<void>{
 const c=connection??new Connection(receipt.rpcUrl||rpcUrl,'confirmed');const status=(await c.getSignatureStatuses([receipt.signature],{searchTransactionHistory:true})).value[0];
 if(status?.err){forget(receipt.signature);throw new Error(`La transaction a échoué sur Solana : ${receipt.signature}. Le reçu bloquant a été retiré.`);}
 if(!status&&receipt.lastValidBlockHeight!==undefined&&await c.getBlockHeight('finalized')>receipt.lastValidBlockHeight){forget(receipt.signature);throw new Error(`La transaction a expiré sans confirmation : ${receipt.signature}. Vous pouvez reprendre la création.`);}
}
async function register(receipt:LaunchReceipt,rpcUrl:string):Promise<boolean>{
 const res=await fetch(worldPath('/api/launches',receipt.worldId),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({signature:receipt.signature}),signal:AbortSignal.timeout(20000)});
 if(res.status===409){await clearFailedReceipt(receipt,rpcUrl);return false;}
 if(!res.ok){if(res.status===422)await clearFailedReceipt(receipt,rpcUrl);const data=await res.json().catch(()=>({error:'Enregistrement indisponible.'}));throw new Error(typeof data.error==='string'?data.error:'Enregistrement indisponible.');}
 forget(receipt.signature);return true;
}
function readDemo():Snapshot{try{const data=JSON.parse(localStorage.getItem(STORE)||'null');if(data?.source==='demo'&&Array.isArray(data.tokens)&&data.tokens.length<=100)return data;}catch{}return initialDemo();}
const emptySnapshot=():Snapshot=>({tokens:[],updatedAt:'',slot:null,source:'chain',currency:'USD'});
function blockedConfig(worldId:string):PlatformConfig{return {...demoConfig,worldId,mode:import.meta.env.DEV&&worldId==='origin'?'demo':'mainnet-beta',quoteMint:null,quoteSymbol:'…',creationEnabled:false,tradingEnabled:false,dbcConfig:null};}
async function stateRequest(worldId:string,signal:AbortSignal){const res=await fetch(worldPath('/api/state',worldId),{signal:AbortSignal.any([signal,AbortSignal.timeout(20000)])});if(!res.ok){const data=await res.json().catch(()=>({}));throw new Error(data.error||'Impossible de vérifier les données Solana.');}return res.json() as Promise<{config:PlatformConfig;snapshot:Snapshot}>;}
export function usePlatform(polling=true,worldId='origin',enabled=true){
 const [state,setState]=useState<{worldId:string;config:PlatformConfig;snapshot:Snapshot}|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null),[wallet,setWallet]=useState<string|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState<string|null>(null);
 const selection=useRef({worldId,enabled});selection.current={worldId,enabled};
 const ready=useRef<string|null>(null),lock=useRef(false),sequence=useRef(0),controller=useRef<AbortController|null>(null),inFlight=useRef<string|null>(null),configRef=useRef<PlatformConfig>(blockedConfig(worldId));
 const refresh=useCallback(async()=>{
 if(!enabled||selection.current.worldId!==worldId)return;
 if(inFlight.current===worldId)return;
 controller.current?.abort();const abort=new AbortController();controller.current=abort;inFlight.current=worldId;const id=++sequence.current;
 setLoading(true);ready.current=null;
 const current=()=>id===sequence.current&&!abort.signal.aborted&&selection.current.worldId===worldId&&selection.current.enabled;
 try{
  const next=import.meta.env.DEV&&worldId==='origin'?{config:{...demoConfig,worldId},snapshot:readDemo()}:await stateRequest(worldId,abort.signal);
  if((next.config.worldId??'origin')!==worldId)throw new Error('Les données reçues appartiennent à un autre territoire. Actualise la sélection.');
  if(next.config.mode!=='demo'&&(next.snapshot.source!=='chain'||next.snapshot.tokens.some(t=>t.mint.startsWith('demo-'))))throw new Error('Source des marchés incohérente.');
  if(!current())return;
  configRef.current=next.config;ready.current=worldId;setState({worldId,...next});setError(null);
  const receipt=pending().find(r=>(r.worldId??'origin')===worldId);
  if(next.config.mode!=='demo'&&receipt){try{const done=await register(receipt,next.config.rpcUrl);if(current()&&done)setNotice('Le token créé est enregistré dans ce territoire. Actualise la carte pour le retrouver.');}catch(e){if(current())setNotice(e instanceof Error?e.message:'Enregistrement différé. Le reçu est conservé.');}}
 }catch(e){if(current()){ready.current=null;setError(e instanceof Error?e.message:'Service indisponible.');}}
 finally{if(id===sequence.current){inFlight.current=null;if(!abort.signal.aborted)setLoading(false);}}
 },[worldId,enabled]);
 useEffect(()=>{ready.current=null;setError(null);setNotice(null);setLoading(enabled);controller.current?.abort();inFlight.current=null;sequence.current++;if(polling&&enabled)void refresh();const timer=polling&&enabled?setInterval(()=>{if(document.visibilityState==='visible'&&!lock.current)void refresh();},15000):null;return()=>{if(timer)clearInterval(timer);controller.current?.abort();inFlight.current=null;sequence.current++;};},[refresh,polling,enabled]);
 useEffect(()=>{const provider=window.phantom?.solana??window.solana;const change=(p:import('@solana/web3.js').PublicKey|null)=>setWallet(p?.toBase58()??null);const disconnect=()=>setWallet(null);provider?.on?.('accountChanged',change);provider?.on?.('disconnect',disconnect);return()=>{provider?.removeListener?.('accountChanged',change);provider?.removeListener?.('disconnect',disconnect);};},[]);
 async function execute(action:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError(null);try{await action();}catch(e){setError(e instanceof Error?e.message:'Action interrompue.');throw e;}finally{lock.current=false;setBusy(false);}}
 function activeConfig(){const selected=selection.current,cfg=configRef.current;if(!selected.enabled||ready.current!==selected.worldId||(cfg.worldId??'origin')!==selected.worldId)throw new Error('Attends le chargement du territoire sélectionné avant de signer.');return cfg;}
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(null),10000);return()=>clearTimeout(timer);},[notice]);
 const connect=()=>execute(async()=>{const p=await phantom().connect();setWallet(p.publicKey.toBase58());setNotice(null);});
 const disconnect=()=>execute(async()=>{await phantom().disconnect();setWallet(null);setNotice(null);});
 const createToken=(input:CreateTokenInput)=>execute(async()=>{
 const cfg=activeConfig();if(!cfg.creationEnabled)throw new Error('Création momentanément indisponible. Actualise la configuration.');
 const selectedWorld=cfg.worldId??'origin',name=input.name.trim(),symbol=input.symbol.trim().toUpperCase();if(!name||new TextEncoder().encode(name).length>32||! /^[A-Z0-9]{1,10}$/.test(symbol))throw new Error('Nom : 32 octets maximum ; symbole : 1 à 10 lettres ou chiffres.');
 if(cfg.mode==='demo'){
  const old=readDemo();if(old.tokens.length>=100)throw new Error('Limite de démonstration atteinte.');const token=revalue({mint:`demo-${crypto.randomUUID()}`,pool:'',name,symbol,color:palette[old.tokens.length%palette.length],creator:wallet??'Simulation',supply:'1000000000000000',baseReserve:'0',quoteReserve:'0',decimals:6,quoteDecimals:6,marketCap:0,price:0,change24h:null,createdAt:Math.floor(Date.now()/1000)});
  const next={...old,tokens:[...old.tokens,token],updatedAt:new Date().toISOString()};localStorage.setItem(STORE,JSON.stringify(next));setState({worldId:selectedWorld,config:cfg,snapshot:next});setNotice(`${symbol} créé en simulation. Sans cours de marché, son territoire vaut zéro.`);return;
 }
 if(pending().some(r=>(r.worldId??'origin')===selectedWorld))throw new Error('Une création attend encore son enregistrement dans ce territoire. Actualise avant de signer une nouvelle création.');
 let result;try{result=await createOnChain(cfg,{name,symbol,seedAmount:input.seedAmount});}catch(e){if(e instanceof PendingTransactionError)remember(e.signature,e.rpcEndpoint||cfg.rpcUrl,e.lastValidBlockHeight,selectedWorld);throw e;}remember(result.signature,cfg.rpcUrl,undefined,selectedWorld);
 setNotice(`Token créé sur Solana : ${result.mint}. Finalisation et enregistrement en cours…`);
 try{let done=false;for(let attempt=0;attempt<10;attempt++){if(await register({signature:result.signature,rpcUrl:cfg.rpcUrl,worldId:selectedWorld},cfg.rpcUrl)){done=true;break;}await new Promise(r=>setTimeout(r,4000));}setNotice(done?`${symbol} créé et enregistré. Transaction : ${result.signature}`:`Création envoyée : ${result.signature}. Le reçu est conservé ; l’enregistrement sera repris sans nouveau paiement.`);}catch{setNotice(`Token créé : ${result.mint}. Enregistrement différé ; reçu conservé (${result.signature}). Actualise sans recréer le token.`);}
 await refresh();
 });
 function tradeConfig(token:import('../types').Token){const cfg=activeConfig(),market=token.marketConfig??cfg;if((market.worldId??'origin')!==(cfg.worldId??'origin'))throw new Error('Ce marché appartient à un autre territoire.');return market;}
 const trade=(input:TradeInput)=>execute(async()=>{const signature=await tradeOnChain(tradeConfig(input.token),input);setNotice(`Échange confirmé : ${signature}`);await refresh();});
 const migrate=(token:import('../types').Token)=>execute(async()=>{const result=await migrateOnChain(tradeConfig(token),token);setNotice(result.signature?`Migration confirmée : ${result.signature}`:`Ce marché est déjà migré : ${result.pool}`);await refresh();});
 const resetDemo=()=>{const cfg=configRef.current;if(cfg.mode!=='demo'||lock.current||selection.current.worldId!=='origin')return;const next=initialDemo();localStorage.setItem(STORE,JSON.stringify(next));setState({worldId:'origin',config:cfg,snapshot:next});setError(null);};
 const valid=enabled&&state?.worldId===worldId;
 return {config:valid?state.config:blockedConfig(worldId),snapshot:valid?state.snapshot:emptySnapshot(),loading:enabled&&(loading||(!valid&&!error)),error:valid||enabled?error:null,wallet,busy,notice,connect,disconnect,refresh,createToken,trade,migrate,resetDemo};
}
