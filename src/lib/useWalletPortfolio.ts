import {useCallback,useEffect,useRef,useState} from 'react';
import type {WalletSnapshot} from '../walletTypes';

export function validateWalletSnapshot(value:unknown,owner:string):WalletSnapshot {
 const s=value as WalletSnapshot;
 if(!s||s.owner!==owner||s.currency!=='USD'||!Array.isArray(s.assets)||s.assets.length>1000||!Number.isSafeInteger(s.slot)||s.slot<0||!Number.isFinite(Date.parse(s.updatedAt)))throw new Error('Réponse du portefeuille incohérente.');
 const mints=new Set<string>();let total=0,unknown=0;
 for(const a of s.assets){
  if(!a||typeof a.mint!=='string'||mints.has(a.mint)||typeof a.name!=='string'||typeof a.symbol!=='string'||typeof a.color!=='string'||typeof a.amount!=='string'||!/^\d+(\.\d+)?$/.test(a.amount)||!Number.isInteger(a.decimals)||a.decimals<0||a.decimals>255||typeof a.isNative!=='boolean')throw new Error('Position du portefeuille incohérente.');
  mints.add(a.mint);
  if(a.valueUsd===null&&a.priceUsd===null)unknown++;
  else if(typeof a.valueUsd==='number'&&Number.isFinite(a.valueUsd)&&a.valueUsd>=0&&typeof a.priceUsd==='number'&&Number.isFinite(a.priceUsd)&&a.priceUsd>0)total+=a.valueUsd;
  else throw new Error('Valorisation du portefeuille incohérente.');
 }
 if(!Number.isFinite(s.totalUsd)||s.totalUsd<0||Math.abs(s.totalUsd-total)>Math.max(1e-8,total*1e-10)||s.unpricedCount!==unknown)throw new Error('Total du portefeuille incohérent.');
 return s;
}
export function useWalletPortfolio(owner:string|null){
 const [state,setState]=useState<{owner:string|null;snapshot:WalletSnapshot|null;loading:boolean;error:string|null}>({owner:null,snapshot:null,loading:false,error:null});
 const controller=useRef<AbortController|null>(null),sequence=useRef(0);
 const refresh=useCallback(async()=>{
  controller.current?.abort();const id=++sequence.current;
  if(!owner){setState({owner:null,snapshot:null,loading:false,error:null});return;}
  const current=new AbortController();controller.current=current;
  setState(previous=>({owner,snapshot:previous.owner===owner?previous.snapshot:null,loading:true,error:null}));
  try{
   const response=await fetch(`/api/wallet?owner=${encodeURIComponent(owner)}`,{cache:'no-store',signal:AbortSignal.any([current.signal,AbortSignal.timeout(25_000)])});
   const data:unknown=await response.json();
   if(!response.ok)throw new Error(typeof (data as {error?:unknown})?.error==='string'?(data as {error:string}).error:'Lecture du portefeuille indisponible.');
   const snapshot=validateWalletSnapshot(data,owner);
   if(id===sequence.current&&!current.signal.aborted)setState({owner,snapshot,loading:false,error:null});
  }catch(error){
   if(id===sequence.current&&!current.signal.aborted)setState(previous=>({owner,snapshot:previous.owner===owner?previous.snapshot:null,loading:false,error:error instanceof Error&&error.name!=='TimeoutError'?error.message:'La lecture du portefeuille prend trop de temps. Réessayez.'}));
  }
 },[owner]);
 useEffect(()=>{
  void refresh();
  const timer=window.setInterval(()=>{if(owner&&document.visibilityState==='visible')void refresh();},30_000);
  return()=>{window.clearInterval(timer);controller.current?.abort();sequence.current++;};
 },[owner,refresh]);
 // Hide the old account synchronously, before the effect for the new owner runs.
 return {snapshot:state.owner===owner?state.snapshot:null,loading:!!owner&&(state.owner!==owner||state.loading),error:state.owner===owner?state.error:null,refresh};
}
