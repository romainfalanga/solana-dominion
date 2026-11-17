import {PublicKey} from '@solana/web3.js';
import source from '../config/worlds.json';
import platform from '../config/platform.json';
import type {World,WorldCatalog} from '../src/worldTypes';
import type {PlatformConfig} from '../src/types';
import {PublicError,database,type Env} from './types';
export interface WorldPolicy extends World {launch:NonNullable<PlatformConfig['curve']>}
type CatalogWorld=World&{launch:WorldPolicy['launch']|null};
function catalogPolicies():CatalogWorld[]{
  const ids=new Set<string>(),mints=new Set<string>(),weeks=new Set<number>();
  return source.worlds.map(entry=>{
    if(!/^[a-z0-9][a-z0-9-]{0,47}$/.test(entry.id)||ids.has(entry.id)||!entry.name.trim()||!Number.isSafeInteger(entry.week)||entry.week<0||!Number.isFinite(Date.parse(entry.createdAt))||!['open','pending'].includes(entry.status))throw new PublicError('Catalogue des mondes incohérent.',503,'WORLD_CATALOG_INVALID');
    ids.add(entry.id);
    if(entry.week>0){if(weeks.has(entry.week))throw new PublicError('Une seule sélection officielle est possible par semaine.',503,'WORLD_CATALOG_INVALID');weeks.add(entry.week);}
    if(entry.status==='open'){
      let mint:string;try{if(!entry.quoteMint)throw new Error();mint=new PublicKey(entry.quoteMint).toBase58();}catch{throw new PublicError('Mint de monde non valide.',503,'WORLD_CATALOG_INVALID');}
      if(mint!==entry.quoteMint||mints.has(mint))throw new PublicError('Chaque monde doit avoir une monnaie distincte.',503,'WORLD_CATALOG_INVALID');mints.add(mint);
    }else if(entry.quoteMint!==null)throw new PublicError('Un monde en attente ne doit pas annoncer de mint.',503,'WORLD_CATALOG_INVALID');
    const curve=entry.launch;
    if(entry.status==='pending'){if(curve!==null)throw new PublicError('La politique du monde en attente reste à définir.',503,'WORLD_CATALOG_INVALID');return {...entry,status:'pending' as const,launch:null};}
    if(!curve)throw new PublicError('Politique de monde absente.',503,'WORLD_CATALOG_INVALID');
    const initial=Number(curve.initialMarketCapQuote),migration=Number(curve.migrationMarketCapQuote);
    if(!Number.isFinite(initial)||initial<=0||!Number.isFinite(migration)||migration<=initial||migration>1e12||!Number.isInteger(curve.tradingFeeBps)||curve.tradingFeeBps<25||curve.tradingFeeBps>500)throw new PublicError('Politique de monde non valide.',503,'WORLD_CATALOG_INVALID');
    return {...entry,status:entry.status as World['status']};
  });
}
export function worldCatalog():WorldCatalog {
  const policies=catalogPolicies();if(!policies.some(world=>world.id===source.activeWorldId&&world.status==='open'))throw new PublicError('Monde actif non valide.',503,'WORLD_CATALOG_INVALID');
  let governanceMint:string;try{governanceMint=new PublicKey(platform.paymentMint).toBase58();}catch{throw new PublicError('Mint de gouvernance non valide.',503,'WORLD_CATALOG_INVALID');}
  return {worlds:policies.map(({launch:_,...world})=>world),activeWorldId:source.activeWorldId,governanceMint};
}
export function worldPolicy(id='origin'):WorldPolicy {
  const world=catalogPolicies().find(world=>world.id===id);if(!world)throw new PublicError('Monde inconnu.',404,'WORLD_NOT_FOUND');
  if(world.status!=='open'||!world.quoteMint||!world.launch)throw new PublicError('Ce monde attend son véritable token de paiement.',409,'WORLD_PENDING');return {...world,launch:world.launch};
}
export function assertWorldPayment(id:string,quoteMint:string):void {
  if(worldPolicy(id).quoteMint!==quoteMint)throw new PublicError('Cette transaction appartient à un autre monde. Sélectionnez son monde d’origine.',409,'WORLD_MISMATCH');
}
export function worldIdForQuote(quoteMint:string):string|undefined {return catalogPolicies().find(world=>world.status==='open'&&world.quoteMint===quoteMint)?.id;}
export function requestWorld(url:URL):string {
  if(url.searchParams.getAll('world').length>1)throw new PublicError('Un seul monde peut être sélectionné.',400,'INVALID_WORLD');
  const id=url.searchParams.get('world')??'origin';worldPolicy(id);return id;
}

interface StoredWorld {cluster:string;id:string;quote_mint:string;week:number;created_at:string}
/** Persist quote identity before exposing an open world. Never repurpose an old
 * world or silently remove it when the mother governance token is replaced. */
export async function recordWorldCatalog(env:Env):Promise<void>{
  const db=database(env),open=catalogPolicies().filter(world=>world.status==='open');
  const inspect=(rows:StoredWorld[])=>{
    for(const row of rows){const world=open.find(world=>world.id===row.id);
      if(!world||world.quoteMint!==row.quote_mint||world.week!==row.week||world.createdAt!==row.created_at)throw new PublicError('Un ancien monde ne peut pas être supprimé, fermé ou réaffecté à une autre monnaie.',503,'WORLD_HISTORY_MISMATCH');
    }
  };
  const read=async()=>{const rows=await db.prepare('SELECT cluster,id,quote_mint,week,created_at FROM world_registry WHERE cluster = ?').bind(platform.cluster).all<StoredWorld>();if(!rows.success||!rows.results)throw new PublicError('Le registre des mondes est indisponible.',503,'WORLD_REGISTRY_UNAVAILABLE');return rows.results;};
  const previous=await read();inspect(previous);
  for(const world of open){if(previous.some(row=>row.id===world.id))continue;
    const stored=await db.prepare('INSERT INTO world_registry (cluster,id,quote_mint,week,created_at) VALUES (?,?,?,?,?) ON CONFLICT DO NOTHING').bind(platform.cluster,world.id,world.quoteMint!,world.week,world.createdAt).run();
    if(!stored.success)throw new PublicError('Impossible de préserver l’identité du monde.',503,'WORLD_REGISTRY_UNAVAILABLE');
  }
  const current=await read();inspect(current);
  if(current.length!==open.length||open.some(world=>!current.some(row=>row.id===world.id)))throw new PublicError('Deux mondes partagent une identité de monnaie ou de semaine.',503,'WORLD_HISTORY_MISMATCH');
}
