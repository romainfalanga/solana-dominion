import {PublicKey} from '@solana/web3.js';
import bs58 from 'bs58';
import {TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID} from '@solana/spl-token';
import config from '../config/governance.json';
import platform from '../config/platform.json';
import {buildVoteMessage,buildProposalMessage,normalizeTheme,type GovernanceState,type GovernanceRound,type GovernanceProposal} from '../src/governanceTypes';
import {database,PublicError,type Env} from './types';
export interface SnapshotManifest {version:1;network:string;mint:string;tokenProgram:string;decimals:number;slot:number;blockTime:number;collectedAt:string;excludedOwners:string[];weights:{owner:string;amount:string}[]}
export interface CommittedRound {domain:string;id:string;themeLabel:string;opensAt:string;closesAt:string;quorumBps:number;candidates:{id:string;label:string}[];snapshot:SnapshotManifest;snapshotHash:string;rulesHash:string}
export interface GovernanceConfig {version:number;domain:string;network:'mainnet-beta'|'devnet';governanceMint:string|null;rounds:CommittedRound[]}
function fail(message:string,status=422):never{throw new PublicError(message,status,'GOVERNANCE_INVALID');}
const activeConfig={...config,governanceMint:platform.paymentMint} as GovernanceConfig;
export async function sha256(value:unknown):Promise<string>{return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(n=>n.toString(16).padStart(2,'0')).join('');}
export function roundRules(round:CommittedRound){return {version:1,domain:round.domain,id:round.id,themeLabel:round.themeLabel,opensAt:round.opensAt,closesAt:round.closesAt,quorumBps:round.quorumBps,candidates:round.candidates,snapshotHash:round.snapshotHash,votePolicy:'one-immutable-ballot-per-owner',tiePolicy:'no-winner',proposalPolicy:'one-next-round-suggestion-per-owner'};}
export function weeklyUtcWindow(start:string){const date=new Date(start);if(!Number.isFinite(date.getTime())||date.toISOString()!==start||date.getUTCDay()!==1||date.getUTCHours()||date.getUTCMinutes()||date.getUTCSeconds()||date.getUTCMilliseconds())fail('Le scrutin commence un lundi à 00:00 UTC.');return {opensAt:date.toISOString(),closesAt:new Date(date.getTime()+7*86400000).toISOString()};}
export async function validateGovernanceConfig(source:GovernanceConfig):Promise<void>{
 if(new TextEncoder().encode(JSON.stringify(source)).length>2_000_000)fail('Archive limitée à 2 Mo : stockage immuable externe requis.',503);
 if(source.version!==1||!['mainnet-beta','devnet'].includes(source.network)||new URL(source.domain).origin!==source.domain||!source.domain.startsWith('https://'))fail('Configuration de gouvernance invalide.',503);
 if(!source.governanceMint){if(source.rounds.length)fail('Mint de gouvernance absent.',503);return;}
 new PublicKey(source.governanceMint);if(source.rounds.length>52||source.rounds.reduce((n,r)=>n+r.snapshot.weights.length,0)>25000)fail('Archive de gouvernance trop volumineuse.',503);const ids=new Set<string>();let previousEnd=0;
 for(const r of source.rounds){
  if(new URL(r.domain).origin!==r.domain||!r.domain.startsWith('https://'))fail('Domaine historique invalide.',503);
  if(!/^[a-z0-9-]{1,64}$/.test(r.id)||ids.has(r.id)||!r.themeLabel||r.themeLabel.length>100)fail('Identifiant de scrutin invalide.',503);ids.add(r.id);
  const window=weeklyUtcWindow(r.opensAt);if(r.closesAt!==window.closesAt||Date.parse(r.opensAt)<previousEnd)fail('Calendrier de scrutin incohérent.',503);previousEnd=Date.parse(r.closesAt);
  if(!Number.isInteger(r.quorumBps)||r.quorumBps<1||r.quorumBps>10000||r.candidates.length<2||r.candidates.length>20||new Set(r.candidates.map(c=>c.id)).size!==r.candidates.length||r.candidates.some(c=>!/^[a-z0-9-]{1,64}$/.test(c.id)||!c.label||c.label.length>100))fail('Règles de scrutin invalides.',503);
  const s=r.snapshot;if(!Number.isSafeInteger(s.blockTime)||s.blockTime<=0||!Number.isFinite(Date.parse(s.collectedAt))||s.blockTime*1000>Date.parse(s.collectedAt)||Date.parse(s.collectedAt)>=Date.parse(r.opensAt))fail('Le snapshot doit précéder le début du scrutin.',503);if(new PublicKey(s.mint).toBase58()!==s.mint||![TOKEN_PROGRAM_ID.toBase58(),TOKEN_2022_PROGRAM_ID.toBase58()].includes(s.tokenProgram)||!['mainnet-beta','devnet'].includes(s.network))fail('Mint/programme de snapshot invalide.',503);if(s.weights.reduce((n,w)=>n+BigInt(w.amount),0n)>18446744073709551615n)fail('Poids total impossible.',503);if(s.version!==1||!Number.isSafeInteger(s.slot)||s.slot<=0||!Number.isInteger(s.decimals)||s.decimals<0||s.decimals>18||s.weights.length>25000)fail('Snapshot invalide.',503);
  let prev='';for(const w of s.weights){if(w.owner<=prev||!PublicKey.isOnCurve(new PublicKey(w.owner).toBytes())||s.excludedOwners.includes(w.owner)||!/^\d+$/.test(w.amount)||BigInt(w.amount)<=0n||BigInt(w.amount)>18446744073709551615n)fail('Poids de snapshot invalide.',503);prev=w.owner;}
  if(!s.weights.length||await sha256(s)!==r.snapshotHash||await sha256(roundRules(r))!==r.rulesHash)fail('Empreinte de scrutin invalide.',503);
 }
}
interface RoundCommitment {id:string;hash:string}
/** The durable append-only commitment is checked even when the configured list
 * is empty, so deleting a published round cannot hide its ballots or snapshot. */
async function commitRoundCatalog(env:Env,source:GovernanceConfig):Promise<void>{
 const expected=await Promise.all(source.rounds.map(async round=>({id:round.id,hash:await sha256(round)}))),serialized=JSON.stringify(expected),db=database(env);
 const read=()=>db.prepare("SELECT commitments_json FROM governance_rounds WHERE id = 'catalog'").first<{commitments_json:string}>();
 const previous=await read();
 if(previous){
  let entries:RoundCommitment[];try{entries=JSON.parse(previous.commitments_json);}catch{fail('Registre des scrutins illisible.',503);}
  if(!Array.isArray(entries!)||entries!.length>expected.length||entries!.some((entry,i)=>!entry||entry.id!==expected[i].id||entry.hash!==expected[i].hash))fail('Un scrutin publié ne peut pas être supprimé, remplacé ou modifié.',503);
  if(previous.commitments_json===serialized)return;
  const update=await db.prepare("UPDATE governance_rounds SET commitments_json = ? WHERE id = 'catalog' AND commitments_json = ?").bind(serialized,previous.commitments_json).run();
  if(!update.success)fail('Impossible de préserver les scrutins publiés.',503);
 }else{
  const insert=await db.prepare("INSERT INTO governance_rounds (id,commitments_json) VALUES ('catalog',?) ON CONFLICT(id) DO NOTHING").bind(serialized).run();
  if(!insert.success)fail('Impossible de préserver les scrutins publiés.',503);
 }
 // A concurrent publication may win; never expose an uncommitted configuration.
 if((await read())?.commitments_json!==serialized)fail('Le catalogue des scrutins a changé. Rechargez avant de continuer.',503);
}
interface VoteRow {round_id:string;rules_hash:string;snapshot_hash:string;owner:string;candidate_id:string;weight_atomic:string;signature:string;created_at:string}
export async function readGovernance(env:Env,source:GovernanceConfig=activeConfig,now=Date.now()):Promise<GovernanceState>{
 await validateGovernanceConfig(source);await commitRoundCatalog(env,source);const rounds:GovernanceRound[]=[],proposals:GovernanceProposal[]=[];
 const ids=source.rounds.map(round=>round.id),db=database(env);
 const allVotes=ids.length?await db.prepare(`SELECT * FROM governance_votes WHERE round_id IN (${ids.map(()=>'?').join(',')}) LIMIT 25001`).bind(...ids).all<VoteRow>():{success:true,results:[] as VoteRow[]};
 const allProposals=ids.length?await db.prepare(`SELECT id,round_id,owner,theme,created_at FROM governance_proposals WHERE round_id IN (${ids.map(()=>'?').join(',')}) ORDER BY created_at,id LIMIT 25001`).bind(...ids).all<{id:string;round_id:string;owner:string;theme:string;created_at:string}>():{success:true,results:[]};
 if(!allVotes.success||!allVotes.results||allVotes.results.length>25000||!allProposals.success||!allProposals.results||allProposals.results.length>25000)fail('Archive de votes indisponible ou trop volumineuse.',503);
 for(const r of source.rounds){
  const recorded=allVotes.results.filter(vote=>vote.round_id===r.id);
  const weights=new Map(r.snapshot.weights.map(w=>[w.owner,w.amount])),totals=new Map(r.candidates.map(c=>[c.id,0n]));let cast=0n;
  for(const v of recorded){if(v.rules_hash!==r.rulesHash||v.snapshot_hash!==r.snapshotHash||weights.get(v.owner)!==v.weight_atomic||!totals.has(v.candidate_id))fail('Bulletin enregistré incohérent.',503);const weight=BigInt(v.weight_atomic);cast+=weight;totals.set(v.candidate_id,totals.get(v.candidate_id)!+weight);}
  const eligible=r.snapshot.weights.reduce((n,w)=>n+BigInt(w.amount),0n),quorum=cast*10000n>=eligible*BigInt(r.quorumBps),status=now<Date.parse(r.opensAt)?'upcoming':now<Date.parse(r.closesAt)?'open':'closed';
  const ranked=[...totals].sort((a,b)=>a[1]===b[1]?0:a[1]>b[1]?-1:1),winner=status==='closed'&&quorum&&ranked[0][1]>0n&&ranked[0][1]>ranked[1][1]?ranked[0][0]:null;
  rounds.push({domain:r.domain,network:r.snapshot.network,quoteDecimals:r.snapshot.decimals,governanceMint:r.snapshot.mint,id:r.id,themeLabel:r.themeLabel,opensAt:r.opensAt,closesAt:r.closesAt,snapshotHash:r.snapshotHash,snapshotSlot:r.snapshot.slot,rulesHash:r.rulesHash,candidates:r.candidates,eligibleWeightAtomic:eligible.toString(),quorumBps:r.quorumBps,status,votes:[...totals].map(([candidateId,w])=>({candidateId,weightAtomic:w.toString()})),castWeightAtomic:cast.toString(),quorumReached:quorum,winnerId:winner});
  proposals.push(...allProposals.results.filter(proposal=>proposal.round_id===r.id).slice(0,500).map(p=>({id:p.id,roundId:p.round_id,owner:p.owner,theme:p.theme,createdAt:p.created_at})));
 }
 return {status:rounds.length?'ready':'awaiting_snapshot',domain:source.domain,network:source.network,governanceMint:source.governanceMint,rounds,proposals,notice:'Vote pondéré au snapshot publié, vérifiable mais collecté par un opérateur de confiance. Les réserves de protocoles et propriétaires exclus ne votent pas. Les suggestions concernent un prochain scrutin. Aucun token n’est créé automatiquement.'};
}
function input(body:unknown,keys:string[]):Record<string,string>{if(!body||typeof body!=='object'||Array.isArray(body)||JSON.stringify(body).length>4096||Object.keys(body).sort().join(',')!==keys.sort().join(','))fail('Message de gouvernance invalide.');const values=body as Record<string,unknown>;if(Object.values(values).some(v=>typeof v!=='string'||v.length>512))fail('Champ de gouvernance invalide.');return values as Record<string,string>;}
async function verify(owner:string,signature:string,message:string){try{const key=new PublicKey(owner);if(key.toBase58()!==owner||!PublicKey.isOnCurve(key.toBytes()))throw Error();const bytes=bs58.decode(signature);if(bytes.length!==64)throw Error();const publicKey=await crypto.subtle.importKey('raw',new Uint8Array(key.toBytes()),{name:'Ed25519'},false,['verify']);if(!await crypto.subtle.verify('Ed25519',publicKey,new Uint8Array(bytes),new TextEncoder().encode(message)))throw Error();}catch{fail('Signature Phantom invalide.',401);}}
async function eligible(env:Env,roundId:string,owner:string,source:GovernanceConfig,now:number){const state=await readGovernance(env,source,now),round=state.rounds.find(r=>r.id===roundId);if(!round||round.status!=='open')fail('Ce scrutin n’est pas ouvert.',409);const weight=source.rounds.find(r=>r.id===roundId)!.snapshot.weights.find(w=>w.owner===owner)?.amount;if(!weight)fail('Ce wallet ne possède aucun poids dans ce snapshot.',403);return {state,round,weight};}
export async function submitGovernanceVote(env:Env,body:unknown,source:GovernanceConfig=activeConfig,now=Date.now()){
 const b=input(body,['roundId','owner','candidateId','signature']),{state,round,weight}=await eligible(env,b.roundId,b.owner,source,now);if(!round.candidates.some(c=>c.id===b.candidateId))fail('Choix de vote inconnu.');await verify(b.owner,b.signature,buildVoteMessage(state,b.roundId,b.owner,b.candidateId));
 const db=database(env);await db.prepare('INSERT OR IGNORE INTO governance_votes (round_id,rules_hash,snapshot_hash,owner,candidate_id,weight_atomic,signature,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(b.roundId,round.rulesHash,round.snapshotHash,b.owner,b.candidateId,weight,b.signature,new Date(now).toISOString()).run();
 const saved=await db.prepare('SELECT * FROM governance_votes WHERE round_id = ? AND owner = ?').bind(b.roundId,b.owner).first<VoteRow>();if(!saved)fail('Vote non enregistré.',503);if(saved.candidate_id!==b.candidateId||saved.rules_hash!==round.rulesHash||saved.snapshot_hash!==round.snapshotHash)fail('Un bulletin immuable existe déjà pour ce wallet.',409);return {accepted:true,roundId:b.roundId,owner:b.owner,candidateId:b.candidateId,weightAtomic:weight};
}
export async function submitGovernanceProposal(env:Env,body:unknown,source:GovernanceConfig=activeConfig,now=Date.now()){
 const b=input(body,['roundId','owner','theme','signature']),theme=normalizeTheme(b.theme);if(theme!==b.theme||theme.length<3||new TextEncoder().encode(theme).length>160||/[\p{Cc}\p{Cf}]/u.test(theme))fail('Thème invalide : 3 caractères minimum, 160 octets maximum.');const {state}=await eligible(env,b.roundId,b.owner,source,now);await verify(b.owner,b.signature,buildProposalMessage(state,b.roundId,b.owner,theme));
 const id=await sha256({roundId:b.roundId,owner:b.owner}),db=database(env);await db.prepare('INSERT OR IGNORE INTO governance_proposals (id,round_id,owner,theme,signature,created_at) VALUES (?,?,?,?,?,?)').bind(id,b.roundId,b.owner,theme,b.signature,new Date(now).toISOString()).run();const saved=await db.prepare('SELECT theme FROM governance_proposals WHERE round_id = ? AND owner = ?').bind(b.roundId,b.owner).first<{theme:string}>();if(!saved)fail('Proposition non enregistrée.',503);if(saved.theme!==theme)fail('Une proposition existe déjà pour ce wallet et ce scrutin.',409);return {accepted:true,id,theme};
}

/** Public reproducible audit: no secrets, only already signed ballots and committed weights. */
export async function readGovernanceAudit(env:Env,roundId:string,source:GovernanceConfig=activeConfig){
 await validateGovernanceConfig(source);await commitRoundCatalog(env,source);const round=source.rounds.find(r=>r.id===roundId);if(!round)fail('Scrutin inconnu.',404);
 const votes=await database(env).prepare('SELECT * FROM governance_votes WHERE round_id = ? ORDER BY owner LIMIT 25001').bind(roundId).all<VoteRow>();
 const proposals=await database(env).prepare('SELECT * FROM governance_proposals WHERE round_id = ? ORDER BY owner LIMIT 25001').bind(roundId).all();
 if(!votes.success||!votes.results||votes.results.length>25000||!proposals.success||!proposals.results||proposals.results.length>25000)fail('Audit indisponible.',503);
 return {domain:round.domain,round,rules:roundRules(round),ballots:votes.results,proposals:proposals.results,trust:'Operator-collected finalized snapshot; signatures independently verifiable.'};
}
