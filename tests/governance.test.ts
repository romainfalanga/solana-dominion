import committed from '../config/governance.json';
import platform from '../config/platform.json';
import {describe,it,expect,afterEach} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {Keypair} from '@solana/web3.js';
import {TOKEN_2022_PROGRAM_ID} from '@solana/spl-token';
import bs58 from 'bs58';
import {createPrivateKey,sign} from 'node:crypto';
import {readGovernance,readGovernanceAudit,sha256,roundRules,weeklyUtcWindow,validateGovernanceConfig,submitGovernanceVote,submitGovernanceProposal,type GovernanceConfig,type CommittedRound} from '../server/governance';
import {buildVoteMessage,buildProposalMessage} from '../src/governanceTypes';
import type {Env,D1Database,D1Statement} from '../server/types';
const now=Date.parse('2026-11-18T00:00:00.000Z'),wallet=Keypair.generate(),other=Keypair.generate(),owner=wallet.publicKey.toBase58();
const signature=(message:string)=>bs58.encode(sign(null,Buffer.from(message),createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),Buffer.from(wallet.secretKey.slice(0,32))]),format:'der',type:'pkcs8'})));
const databases:DatabaseSync[]=[];
afterEach(()=>{for(const db of databases.splice(0))db.close();});
function adapter(sqlite:DatabaseSync,queries:string[]):D1Database{return {prepare(sql:string){queries.push(sql);const statement=(values:(string|number|null)[]):D1Statement=>({bind:(...next)=>statement(next),async first<T>(){return (sqlite.prepare(sql).get(...values) as T|undefined)??null;},async all<T>(){return {success:true,results:sqlite.prepare(sql).all(...values) as T[]};},async run(){const result=sqlite.prepare(sql).run(...values);return {success:true,meta:{changes:Number(result.changes)}};}});return statement([]);}};}
async function setup(){
 const snapshot={version:1 as const,network:'mainnet-beta',mint:Keypair.generate().publicKey.toBase58(),tokenProgram:TOKEN_2022_PROGRAM_ID.toBase58(),decimals:6,slot:100,blockTime:Date.parse('2026-11-15T00:00:00.000Z')/1000,collectedAt:'2026-11-15T00:01:00.000Z',excludedOwners:[],weights:[{owner,amount:'9007199254740993'},{owner:other.publicKey.toBase58(),amount:'9007199254740993'}].sort((a,b)=>a.owner<b.owner?-1:1)};
 const round:CommittedRound={domain:'https://example.com',id:'week-1',themeLabel:'Premier vote',...weeklyUtcWindow('2026-11-16T00:00:00.000Z'),quorumBps:5000,candidates:[{id:'gta6',label:'GTA6'},{id:'space',label:'Espace'}],snapshot,snapshotHash:await sha256(snapshot),rulesHash:''};round.rulesHash=await sha256(roundRules(round));
 const source:GovernanceConfig={version:1,domain:'https://example.com',network:'mainnet-beta',governanceMint:snapshot.mint,rounds:[round]};
 const sqlite=new DatabaseSync(':memory:');databases.push(sqlite);sqlite.exec(readFileSync(new URL('../migrations/0003_governance.sql',import.meta.url),'utf8'));
 const queries:string[]=[],env:Env={DB:adapter(sqlite,queries)};
 return {source,env,round,sqlite,queries};
}
describe('snapshot governance signed ballots',()=>{
 it('validates the actual committed round configuration before publication',async()=>{await expect(validateGovernanceConfig({...committed,governanceMint:platform.paymentMint} as GovernanceConfig)).resolves.toBeUndefined();});
 it('does not fabricate a round when no snapshot exists',async()=>{const {source,env}=await setup();const s=await readGovernance(env, {...source,rounds:[]});expect(s.status).toBe('awaiting_snapshot');expect(s.rounds).toEqual([]);expect(s.governanceMint).toBeTruthy();});
 it('verifies Ed25519, tallies bigints exactly and exports reproducible audit',async()=>{const {source,env}=await setup(),state=await readGovernance(env,source,now);const body={roundId:'week-1',owner,candidateId:'gta6',signature:signature(buildVoteMessage(state,'week-1',owner,'gta6'))};await submitGovernanceVote(env,body,source,now);await submitGovernanceVote(env,body,source,now);const result=await readGovernance(env,source,now);expect(result.rounds[0].castWeightAtomic).toBe('9007199254740993');expect(result.rounds[0].winnerId).toBeNull();expect((await readGovernanceAudit(env,'week-1',source)).ballots).toHaveLength(1);expect((await readGovernance(env,source,Date.parse('2026-11-24'))).rounds[0].winnerId).toBe('gta6');});
 it('rejects cross-domain, choice mutation and duplicate conflicting votes',async()=>{const {source,env}=await setup(),state=await readGovernance(env,source,now);const body={roundId:'week-1',owner,candidateId:'gta6',signature:signature(buildVoteMessage(state,'week-1',owner,'gta6'))};await expect(submitGovernanceVote(env,{...body,candidateId:'space'},source,now)).rejects.toThrow('Signature');const wrong=structuredClone(state);wrong.rounds[0].domain='https://evil.example';await expect(submitGovernanceVote(env,{...body,signature:signature(buildVoteMessage(wrong,'week-1',owner,'gta6'))},source,now)).rejects.toThrow('Signature');await submitGovernanceVote(env,body,source,now);await expect(submitGovernanceVote(env,{...body,candidateId:'space',signature:signature(buildVoteMessage(state,'week-1',owner,'space'))},source,now)).rejects.toThrow('immuable');});
 it('rejects unavailable choices, wallets, times and rounds',async()=>{const {source,env}=await setup();for(const [body,time] of [[{roundId:'week-1',owner,candidateId:'unknown',signature:'x'},now],[{roundId:'week-2',owner,candidateId:'gta6',signature:'x'},now],[{roundId:'week-1',owner,candidateId:'gta6',signature:'x'},Date.parse('2026-11-23T00:00:00.000Z')],[{roundId:'week-1',owner:Keypair.generate().publicKey.toBase58(),candidateId:'gta6',signature:'x'},now]] as const)await expect(submitGovernanceVote(env,body,source,time)).rejects.toThrow();});
 it('publishes a signed next-round suggestion without modifying candidates',async()=>{const {source,env}=await setup(),state=await readGovernance(env,source,now),theme='Océan';await submitGovernanceProposal(env,{roundId:'week-1',owner,theme,signature:signature(buildProposalMessage(state,'week-1',owner,theme))},source,now);expect((await readGovernance(env,source,now)).proposals[0].theme).toBe(theme);expect(source.rounds[0].candidates).toHaveLength(2);});
 it('detects altered manifests and preserves historical mint/domain/network after rotation',async()=>{const {source}=await setup();source.governanceMint=Keypair.generate().publicKey.toBase58();await expect(validateGovernanceConfig(source)).resolves.toBeUndefined();source.rounds[0].snapshot.weights[0].amount='1';await expect(validateGovernanceConfig(source)).rejects.toThrow('Empreinte');});
 it('returns no winner on an exact tie despite quorum',async()=>{const {source,env,sqlite}=await setup();for(const [i,w] of source.rounds[0].snapshot.weights.entries())sqlite.prepare('INSERT INTO governance_votes VALUES (?,?,?,?,?,?,?,?)').run('week-1',source.rounds[0].rulesHash,source.rounds[0].snapshotHash,w.owner,i?'space':'gta6',w.amount,'fixture-signature',new Date(now).toISOString());const result=await readGovernance(env,source,Date.parse('2026-11-24'));expect(result.rounds[0].quorumReached).toBe(true);expect(result.rounds[0].winnerId).toBeNull();});
 it('rejects snapshots captured after opening',async()=>{const {source}=await setup();source.rounds[0].snapshot.collectedAt='2026-11-18T00:00:00.000Z';await expect(validateGovernanceConfig(source)).rejects.toThrow('précéder');});
 it('requires Monday UTC and leaves no winner for quorum failure or tie',async()=>{expect(()=>weeklyUtcWindow('2026-11-17T00:00:00.000Z')).toThrow();const {source,env}=await setup();expect((await readGovernance(env,source,Date.parse('2026-11-24'))).rounds[0].winnerId).toBeNull();});
});

describe('durable governance history and bounded reads',()=>{
 it('refuses deletion and fully rehashed edits even before the first ballot',async()=>{
  const {source,env}=await setup();await readGovernance(env,source,now);
  await expect(readGovernance(env,{...source,rounds:[]},now)).rejects.toThrow('supprimé');
  const altered=structuredClone(source);altered.rounds[0].themeLabel='Changed after publication';altered.rounds[0].rulesHash=await sha256(roundRules(altered.rounds[0]));await expect(validateGovernanceConfig(altered)).resolves.toBeUndefined();
  await expect(readGovernance(env,altered,now)).rejects.toThrow('modifié');await expect(readGovernanceAudit(env,'week-1',altered)).rejects.toThrow('modifié');
 });
 it('appends rounds using a durable compare-and-swap without rewriting historical commitments',async()=>{
  const {source,env,sqlite}=await setup();await readGovernance(env,source,now);const old=JSON.parse(String(sqlite.prepare('SELECT commitments_json FROM governance_rounds').get()?.commitments_json));
  const next=structuredClone(source.rounds[0]);next.id='week-2';Object.assign(next,weeklyUtcWindow('2026-11-23T00:00:00.000Z'));next.rulesHash=await sha256(roundRules(next));source.rounds.push(next);
  expect((await readGovernance(env,source,now)).rounds).toHaveLength(2);const current=JSON.parse(String(sqlite.prepare('SELECT commitments_json FROM governance_rounds').get()?.commitments_json));expect(current[0]).toEqual(old[0]);expect(current).toHaveLength(2);
 });
 it('does not expose an appended round when the conditional write loses a race',async()=>{
  const {source,env}=await setup();await readGovernance(env,source,now);const base=env.DB!;
  const next=structuredClone(source.rounds[0]);next.id='week-2';Object.assign(next,weeklyUtcWindow('2026-11-23T00:00:00.000Z'));next.rulesHash=await sha256(roundRules(next));source.rounds.push(next);
  env.DB={prepare(sql){const statement=base.prepare(sql);if(!sql.startsWith('UPDATE governance_rounds'))return statement;const raced:D1Statement={...statement,bind(){return raced;},async run(){return {success:true,meta:{changes:0}};}};return raced;}};
  await expect(readGovernance(env,source,now)).rejects.toThrow('catalogue');
 });
 it('reads a full52-round archive with only two bulk ballot/proposal queries',async()=>{
  const {source,env,queries}=await setup(),base=source.rounds[0];source.rounds=[];
  for(let index=0;index<52;index++){const round=structuredClone(base);round.id=`week-${index+1}`;Object.assign(round,weeklyUtcWindow(new Date(Date.parse(base.opensAt)+index*7*86400000).toISOString()));round.rulesHash=await sha256(roundRules(round));source.rounds.push(round);}
  const state=await readGovernance(env,source,now);expect(state.rounds).toHaveLength(52);expect(queries.filter(sql=>sql.startsWith('SELECT')&&(sql.includes('FROM governance_votes')||sql.includes('FROM governance_proposals')))).toHaveLength(2);expect(queries).toHaveLength(5);
 });
});
