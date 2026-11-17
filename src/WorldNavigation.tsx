import { useEffect, useState } from 'react';
import type { World, WorldCatalog } from './worldTypes';
export function useWorldCatalog() {
 const [catalog,setCatalog]=useState<WorldCatalog|null>(null),[error,setError]=useState<string|null>(null),[revision,setRevision]=useState(0);
 useEffect(()=>{const controller=new AbortController();void fetch('/api/worlds',{signal:controller.signal}).then(async r=>{if(!r.ok)throw new Error('Catalogue des mondes indisponible.');const data=await r.json() as WorldCatalog;if(!Array.isArray(data.worlds)||!data.worlds.every(w=>typeof w.id==='string'&&['open','pending'].includes(w.status)))throw new Error('Catalogue invalide.');return data;}).then(data=>{setCatalog(data);setError(null);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();},[revision]);
 return {catalog,error,retry:()=>setRevision(v=>v+1)};
}
export function WorldSelector({worlds,selected,onSelect,busy}:{worlds:World[];selected:string;onSelect:(id:string)=>void;busy:boolean}) {
 return <section className="world-selector" aria-label="Choisir un monde"><div className="world-selector-label">Les mondes<span>Chaque monde reste ouvert.</span></div><div className="world-options">{worlds.map(world=><button key={world.id} aria-pressed={selected===world.id} disabled={busy} onClick={()=>onSelect(world.id)}><span>{world.name}</span><small>{world.status==='pending'?'À venir':world.week===0?'Monde originel':`Semaine ${world.week}`}</small></button>)}</div></section>;
}
export function PendingWorld({world}:{world:World}) {return <section className="pending-world"><span className="pending-world-index">PROCHAIN MONDE · SEMAINE {world.week}</span><h2>{world.name}</h2><p>{world.theme}</p><div><strong>Le monde se prépare.</strong><p>Son token de cotation n’a pas encore été créé. Aucun mint, prix ou achat n’est disponible pour ce monde.</p><p>À son ouverture, il aura sa propre carte et sa propre monnaie de cotation. Les mondes précédents restent accessibles.</p></div></section>;}
