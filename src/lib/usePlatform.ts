import {useCallback,useEffect,useRef,useState} from 'react';
import type {PlatformConfig,Snapshot,CreateTokenInput,TradeInput} from '../types';
import {demoConfig,initialDemo,palette,revalue} from './demo';
import {phantom,createOnChain} from './wallet';
import {PendingTransactionError} from './transactions';
const RECEIPTS='dominion-pending-registrations-v1';
const STORE='dominion-demo-v2';
function pending():string[]{try{const data=JSON.parse(localStorage.getItem(RECEIPTS)||'[]');return Array.isArray(data)?data.filter(s=>typeof s==='string').slice(-30):[];}catch{return [];}}
function remember(signature:string){localStorage.setItem(RECEIPTS,JSON.stringify([...new Set([...pending(),signature])].slice(-30)));}
async function register(signature:string):Promise<boolean>{const res=await fetch('/api/launches',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({signature}),signal:AbortSignal.timeout(20000)});if(res.status===409)return false;if(!res.ok){const data=await res.json().catch(()=>({error:'Enregistrement indisponible.'}));throw new Error(typeof data.error==='string'?data.error:'Enregistrement indisponible.');}localStorage.setItem(RECEIPTS,JSON.stringify(pending().filter(s=>s!==signature)));return true;}
function readDemo():Snapshot{try{const data=JSON.parse(localStorage.getItem(STORE)||'null');if(data?.source==='demo'&&Array.isArray(data.tokens)&&data.tokens.length<=100)return data;}catch{}return initialDemo();}
async function stateRequest(){const res=await fetch('/api/state',{signal:AbortSignal.timeout(20000)});if(!res.ok){const data=await res.json().catch(()=>({}));throw new Error(data.error||'Impossible de vérifier les données Solana.');}return res.json() as Promise<{config:PlatformConfig;snapshot:Snapshot}>;}
export function usePlatform(){
 const [config,setConfig]=useState<PlatformConfig>({...demoConfig,creationEnabled:false}),[snapshot,setSnapshot]=useState<Snapshot>({tokens:[],updatedAt:'',slot:null,source:'chain',currency:'USD'}),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null),[wallet,setWallet]=useState<string|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState<string|null>(null);
 const ready=useRef(false),lock=useRef(false),refreshing=useRef(false),configRef=useRef(config);
 const refresh=useCallback(async()=>{
 if(refreshing.current)return;refreshing.current=true;
 try{
  const state=import.meta.env.DEV?{config:demoConfig,snapshot:readDemo()}:await stateRequest();
  if(state.config.mode!=='demo'&&(state.snapshot.source!=='chain'||state.snapshot.tokens.some(t=>t.mint.startsWith('demo-'))))throw new Error('Source des marchés incohérente.');
  configRef.current=state.config;setConfig(state.config);setSnapshot(state.snapshot);ready.current=true;setError(null);
  if(state.config.mode!=='demo'&&pending().length){try{if(await register(pending()[0]))setNotice('Le token créé est enregistré. Actualise la carte pour le retrouver.');}catch{setNotice('Une création confirmée attend encore son enregistrement. Le reçu est conservé ; aucun nouveau paiement ne sera envoyé.');}}
 }catch(e){ready.current=false;setError(e instanceof Error?e.message:'Service indisponible.');}finally{setLoading(false);refreshing.current=false;}
 },[]);
 useEffect(()=>{void refresh();const timer=setInterval(()=>{if(document.visibilityState==='visible'&&!lock.current)void refresh();},15000);return()=>clearInterval(timer);},[refresh]);
 useEffect(()=>{const provider=window.phantom?.solana??window.solana;const change=(p:import('@solana/web3.js').PublicKey|null)=>setWallet(p?.toBase58()??null);const disconnect=()=>setWallet(null);provider?.on?.('accountChanged',change);provider?.on?.('disconnect',disconnect);return()=>{provider?.removeListener?.('accountChanged',change);provider?.removeListener?.('disconnect',disconnect);};},[]);
 async function execute(action:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError(null);try{await action();}catch(e){setError(e instanceof Error?e.message:'Action interrompue.');throw e;}finally{lock.current=false;setBusy(false);}}
 const connect=()=>execute(async()=>{const p=await phantom().connect();setWallet(p.publicKey.toBase58());setNotice('Phantom connecté. Chaque création nécessite ta signature.');});
 const disconnect=()=>execute(async()=>{await phantom().disconnect();setWallet(null);});
 const createToken=(input:CreateTokenInput)=>execute(async()=>{
 if(!ready.current||!configRef.current.creationEnabled)throw new Error('Création momentanément indisponible. Actualise la configuration.');
 const cfg=configRef.current,name=input.name.trim(),symbol=input.symbol.trim().toUpperCase();if(!name||new TextEncoder().encode(name).length>32||! /^[A-Z0-9]{1,10}$/.test(symbol))throw new Error('Nom : 32 octets maximum ; symbole : 1 à 10 lettres ou chiffres.');
 if(cfg.mode==='demo'){
  const old=readDemo();if(old.tokens.length>=100)throw new Error('Limite de démonstration atteinte.');
  const token=revalue({mint:`demo-${crypto.randomUUID()}`,pool:'',name,symbol,color:palette[old.tokens.length%palette.length],creator:wallet??'Simulation',supply:'1000000000000000',baseReserve:'0',quoteReserve:'0',decimals:6,quoteDecimals:6,marketCap:0,price:0,change24h:null,createdAt:Math.floor(Date.now()/1000)});
  const next={...old,tokens:[...old.tokens,token],updatedAt:new Date().toISOString()};localStorage.setItem(STORE,JSON.stringify(next));setSnapshot(next);setNotice(`${symbol} créé en simulation. Sans cours de marché, son territoire vaut zéro.`);return;
 }
 if(pending().length)throw new Error('Une création attend encore son enregistrement. Actualise avant de signer une nouvelle création.');
 let result;try{result=await createOnChain(cfg,{name,symbol});}catch(e){if(e instanceof PendingTransactionError)remember(e.signature);throw e;}remember(result.signature);
 setNotice(`Token créé sur Solana : ${result.mint}. Finalisation et enregistrement en cours…`);
 try{let done=false;for(let attempt=0;attempt<10;attempt++){if(await register(result.signature)){done=true;break;}await new Promise(r=>setTimeout(r,4000));}
  setNotice(done?`${symbol} créé et enregistré. Transaction : ${result.signature}`:`Création envoyée : ${result.signature}. Le reçu est conservé ; l’enregistrement sera repris à l’actualisation sans nouveau paiement.`);
 }catch{setNotice(`Token créé : ${result.mint}. Enregistrement différé ; reçu conservé (${result.signature}). Actualise sans recréer le token.`);}
 await refresh();
 });
 const trade=async(_input:TradeInput)=>{throw new Error('Les échanges se font sur les marchés externes disponibles pour ce token.');};
 const resetDemo=()=>{if(configRef.current.mode!=='demo'||lock.current)return;const next=initialDemo();localStorage.setItem(STORE,JSON.stringify(next));setSnapshot(next);setError(null);};
 return {config,snapshot,loading,error,wallet,busy,notice,connect,disconnect,refresh,createToken,trade,resetDemo};
}
