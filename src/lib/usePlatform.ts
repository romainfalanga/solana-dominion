import {useCallback,useEffect,useRef,useState} from 'react';
import type {PlatformConfig,Snapshot,CreateTokenInput,TradeInput} from '../types';
import {demoConfig,initialDemo,palette,revalue} from './demo';
import {parseUnits,calculateOutput,minimumOutput} from './math';
import {phantom,createOnChain,tradeOnChain} from './wallet';
const STORE='dominion-demo-v1';
function readDemo():Snapshot {try {const raw=localStorage.getItem(STORE);if(raw){const data=JSON.parse(raw);if(data.source==='demo'&&Array.isArray(data.tokens)&&data.tokens.length<=100&&data.tokens.every((t:Record<string,unknown>)=>typeof t.mint==='string'&&String(t.mint).startsWith('demo-')&&typeof t.baseReserve==='string'&&/^\d+$/.test(t.baseReserve)&&typeof t.quoteReserve==='string'&&/^\d+$/.test(t.quoteReserve)&&t.supply==='1000000000000000')) return {...data,tokens:data.tokens.map(revalue)};}}catch{/* Invalid local data resets only simulation. */}return initialDemo();}
async function request<T>(url:string):Promise<T>{const res=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!res.ok){let msg='Service indisponible.';try{const data=await res.json();msg=data.error??msg;}catch{}throw new Error(msg);}return res.json();}
export function usePlatform(){
 const [config,setConfig]=useState<PlatformConfig>(demoConfig),[snapshot,setSnapshot]=useState<Snapshot>(initialDemo),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null),[wallet,setWallet]=useState<string|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState<string|null>(null);
 const ready=useRef(false),lock=useRef(false),configRef=useRef(config),holdings=useRef<Record<string,bigint>>({});
 const updateDemo=(s:Snapshot)=>{setSnapshot(s);localStorage.setItem(STORE,JSON.stringify(s));};
 const refresh=useCallback(async()=>{try{const cfg=import.meta.env.DEV?demoConfig:await request<PlatformConfig>('/api/config');const next=cfg.mode==='demo'?readDemo():await request<Snapshot>('/api/territories');if(cfg.mode!=='demo'&&(next.source!=='chain'||next.tokens.some(t=>t.mint.startsWith('demo-'))))throw new Error('La source des marchés ne correspond pas au monde.');configRef.current=cfg;setConfig(cfg);setSnapshot(next);ready.current=true;setError(null);}catch(e){ready.current=false;setError(e instanceof Error?e.message:'Impossible de charger le monde.');}finally{setLoading(false);}},[]);
 useEffect(()=>{void refresh();const id=setInterval(()=>{if(document.visibilityState==='visible'&&!lock.current)void refresh();},15000);return()=>clearInterval(id);},[refresh]);
 useEffect(()=>{const p=window.phantom?.solana??window.solana;const onChange=(key:import('@solana/web3.js').PublicKey|null)=>setWallet(key?.toBase58()??null);const onDisconnect=()=>setWallet(null);p?.on?.('accountChanged',onChange);p?.on?.('disconnect',onDisconnect);return()=>{p?.removeListener?.('accountChanged',onChange);p?.removeListener?.('disconnect',onDisconnect);};},[]);
 const execute=async(action:()=>Promise<void>)=>{if(lock.current)return;lock.current=true;setBusy(true);setError(null);setNotice(null);try{await action();}catch(e){setError(e instanceof Error?e.message:'Action interrompue.');throw e;}finally{lock.current=false;setBusy(false);}};
 const connect=async()=>{await execute(async()=>{const result=await phantom().connect();setWallet(result.publicKey.toBase58());setNotice('Wallet Phantom connecté.');});};
 const disconnect=async()=>{await execute(async()=>{await phantom().disconnect();setWallet(null);});};
 const createToken=async(input:CreateTokenInput)=>execute(async()=>{
 if(!ready.current)throw new Error('Attends le chargement de la configuration.');
 const name=input.name.trim(),symbol=input.symbol.trim().toUpperCase();if(!name||new TextEncoder().encode(name).length>32||! /^[A-Z0-9]{1,10}$/.test(symbol))throw new Error('Nom : 32 octets maximum ; symbole : 1 à 10 lettres ou chiffres.');
 const cfg=configRef.current;
 if(cfg.mode==='demo'){
 const seed=parseUnits(input.seedAmount,6);if(seed<=0n)throw new Error('La réserve doit être positive.');
 const current=readDemo();if(current.tokens.length>=100)throw new Error('Limite de démonstration atteinte. Réinitialise le monde.');
 const token=revalue({mint:`demo-${crypto.randomUUID()}`,pool:'demo',name,symbol,color:palette[current.tokens.length%palette.length],creator:wallet??'Vous (simulation)',supply:'1000000000000000',baseReserve:'1000000000000000',quoteReserve:seed.toString(),decimals:6,quoteDecimals:6,marketCap:0,price:0,change24h:null,createdAt:Math.floor(Date.now()/1000)});
 updateDemo({...current,tokens:[...current.tokens,token],updatedAt:new Date().toISOString()});setNotice(`${symbol} créé en simulation. Achète ses premiers tokens pour faire apparaître son territoire.`);
 }else{const sig=await createOnChain(cfg,input);setNotice(`Token créé sur Solana. Transaction : ${sig}`);await refresh();}
 });
 const trade=async(input:TradeInput)=>execute(async()=>{
 if(!ready.current)throw new Error('Configuration indisponible.');const cfg=configRef.current;
 if(cfg.mode==='demo'){
 const current=readDemo(),token=current.tokens.find(t=>t.mint===input.token.mint);if(!token)throw new Error('Token introuvable.');
 const amount=parseUnits(input.amount,6);const buy=input.side==='buy';
 if(!buy&&(holdings.current[token.mint]??0n)<amount)throw new Error('Achète d’abord ces tokens dans cette session de démonstration.');
 const x=BigInt(token.baseReserve),y=BigInt(token.quoteReserve),out=calculateOutput(amount,buy?y:x,buy?x:y);minimumOutput(out,input.slippageBps);
 holdings.current[token.mint]=(holdings.current[token.mint]??0n)+(buy?out:-amount);
 const updated=revalue({...token,baseReserve:(buy?x-out:x+amount).toString(),quoteReserve:(buy?y+amount:y-out).toString()});
 updateDemo({...current,tokens:current.tokens.map(t=>t.mint===token.mint?updated:t),updatedAt:new Date().toISOString()});setNotice(`${buy?'Achat':'Vente'} simulé. Le territoire a été recalculé ; aucun fonds réel utilisé.`);
 }else{const sig=await tradeOnChain(cfg,input);setNotice(`Échange confirmé. Transaction : ${sig}`);await refresh();}
 });
 const resetDemo=()=>{if(configRef.current.mode!=='demo'||lock.current)return;holdings.current={};updateDemo(initialDemo());setNotice('Le monde de démonstration a été réinitialisé.');setError(null);};
 return {config,snapshot,loading,error,wallet,busy,notice,connect,disconnect,refresh,createToken,trade,resetDemo};
}
