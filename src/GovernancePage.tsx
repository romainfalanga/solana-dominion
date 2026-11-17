import { useEffect, useRef, useState } from 'react';
import bs58 from 'bs58';
import { phantom } from './lib/wallet';
import { buildProposalMessage, buildVoteMessage, normalizeTheme, type GovernanceState, type GovernanceRound } from './governanceTypes';
const ratio=(a:string,b:string)=>BigInt(b)>0n?Number(BigInt(a)*10000n/BigInt(b))/100:0;
const date=(value:string)=>new Date(value).toLocaleString('fr-FR',{timeZone:'Europe/Paris',dateStyle:'medium',timeStyle:'short'});
export default function GovernancePage({owner,onConnect,busy}:{owner:string|null;onConnect:()=>Promise<void>;busy:boolean}) {
 useEffect(()=>{const timer=setInterval(()=>{if(document.visibilityState==='visible')setRevision(v=>v+1);},30000);return()=>clearInterval(timer);},[]);
 const [state,setState]=useState<GovernanceState|null>(null),[error,setError]=useState<string|null>(null),[loading,setLoading]=useState(true),[revision,setRevision]=useState(0);
 useEffect(()=>{const controller=new AbortController();setLoading(true);void fetch('/api/governance',{signal:controller.signal}).then(async r=>{const data=await r.json();if(!r.ok)throw new Error(data.error||'Gouvernance indisponible.');return data as GovernanceState;}).then(data=>{setState(data);setError(null);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[revision]);
 return <section className="governance-page"><div className="governance-intro"><div><span className="eyebrow">LA COMMUNAUTÉ CHOISIT LA SUITE</span><h2>Un thème. Un nouveau monde.</h2><p>Un nouveau monde permanent chaque semaine, avec son propre token de cotation. Le token mère sert à voter sur les thèmes ; les anciens mondes restent ouverts.</p></div>{state?.governanceMint&&<div className="governance-mint"><span>Token mère · gouvernance</span><a href={`https://explorer.solana.com/address/${state.governanceMint}${state.network==='devnet'?'?cluster=devnet':''}`} target="_blank" rel="noreferrer"><code>{state.governanceMint}</code></a><button className="button button-quiet" onClick={()=>void navigator.clipboard.writeText(state.governanceMint!).catch(()=>setError('Copie indisponible.'))}>Copier le CA</button></div>}</div>
 <div className="governance-toolbar"><h2>Les scrutins</h2><button className="button button-quiet" disabled={loading} onClick={()=>setRevision(v=>v+1)}>Actualiser les scrutins</button></div>
 {error&&<div className="message message-error" role="alert">{error}</div>}
 {loading&&!state&&<p role="status">Chargement des scrutins…</p>}
 {state&&state.rounds.length===0&&<div className="governance-empty"><span>01 / AVANT LE PREMIER VOTE</span><h3>Le premier scrutin se prépare.</h3><p>Aucun snapshot ni candidat n’est encore publié. Les dates, les choix et les règles seront affichés avant l’ouverture. Aucun vote n’est actuellement disponible.</p></div>}
 {state?.rounds.map(round=><Round key={`${round.id}:${owner}`} state={state} round={round} owner={owner} onConnect={onConnect} busy={busy} onRefresh={()=>setRevision(v=>v+1)}/>)}
 {state?.notice&&<p className="governance-notice">{state.notice}</p>}
 </section>;
}
function Round({state,round,owner,onConnect,busy,onRefresh}:{state:GovernanceState;round:GovernanceRound;owner:string|null;onConnect:()=>Promise<void>;busy:boolean;onRefresh:()=>void}) {
 const [choice,setChoice]=useState(''),[consent,setConsent]=useState(false),[theme,setTheme]=useState(''),[working,setWorking]=useState(false),[error,setError]=useState<string|null>(null),[notice,setNotice]=useState<string|null>(null);
 const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const open=round.status==='open'&&Date.now()<Date.parse(round.closesAt)&&Date.now()>=Date.parse(round.opensAt),domainValid=round.domain===window.location.origin;
 async function submit(kind:'votes'|'proposals') {
  if(!owner||!open||!domainValid||working)return;
  setWorking(true);setError(null);setNotice(null);
  try {
   const provider=phantom();if(provider.publicKey?.toBase58()!==owner)throw new Error('Le compte Phantom a changé. Reconnectez le wallet.');if(!provider.signMessage)throw new Error('Ce wallet ne prend pas en charge la signature de messages.');
   const value=kind==='votes'?choice:normalizeTheme(theme);
   if(kind==='proposals'&&(new TextEncoder().encode(value).length>160||/[\p{Cc}\p{Cf}]/u.test(value)))throw new Error('Thème invalide : 160 octets maximum, sans caractères invisibles.');
   const message=kind==='votes'?buildVoteMessage(state,round.id,owner,value):buildProposalMessage(state,round.id,owner,value);
   const result=await provider.signMessage(new TextEncoder().encode(message));
   if(!alive.current||provider.publicKey?.toBase58()!==owner)throw new Error('Compte changé pendant la signature. Aucun dépôt effectué.');
   const response=await fetch(`/api/governance/${kind}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roundId:round.id,owner,...(kind==='votes'?{candidateId:value}:{theme:value}),signature:bs58.encode(result.signature)}),signal:AbortSignal.timeout(20000)});
   const data=await response.json();if(!response.ok)throw new Error(data.error||'Dépôt impossible.');
   if(alive.current){setNotice(kind==='votes'?'Votre vote est enregistré et ne peut plus être modifié.':'Votre suggestion pour un prochain scrutin est enregistrée.');onRefresh();}
  }catch(e){if(alive.current)setError(e instanceof Error?e.message:'Dépôt interrompu.');}finally{if(alive.current)setWorking(false);}
 }
 return <article className="governance-round"><div className="governance-round-header"><h3>{round.themeLabel}</h3><span>{open?'Vote ouvert':round.status==='upcoming'?'À venir':'Terminé'}</span></div><p className="governance-dates">{date(round.opensAt)} → {date(round.closesAt)} · heure de Paris</p><p>Participation : {ratio(round.castWeightAtomic,round.eligibleWeightAtomic).toLocaleString('fr-FR')} % · quorum : {round.quorumBps/100} %{round.status==='closed'&&!round.quorumReached?' · quorum non atteint':''}</p>
 <fieldset disabled={!open||working||busy}><legend>Thèmes du scrutin</legend>{round.candidates.map(candidate=><label className="governance-candidate" key={candidate.id}><input type="radio" name={`candidate-${round.id}`} checked={choice===candidate.id} onChange={()=>{setChoice(candidate.id);setConsent(false);}}/><span>{candidate.label}{round.winnerId===candidate.id?' · retenu':''}</span><strong>{ratio(round.votes.find(v=>v.candidateId===candidate.id)?.weightAtomic??'0',round.castWeightAtomic).toLocaleString('fr-FR')} % des voix exprimées</strong></label>)}</fieldset>
 {open&&<><p className="governance-explanation">Votre poids dépend du snapshot publié, pas de votre solde actuel. Une signature de message, sans transaction ni transfert de tokens. Un seul choix définitif par wallet.</p>{!domainValid?<p role="alert">La signature est disponible uniquement sur le domaine du scrutin : {round.domain}.</p>:!owner?<button className="button button-primary" disabled={busy} onClick={()=>void onConnect().catch(e=>setError(e instanceof Error?e.message:'Connexion impossible.'))}>Connecter Phantom pour voter</button>:<><label className="governance-consent"><input type="checkbox" checked={consent} disabled={working} onChange={e=>setConsent(e.target.checked)}/>Je confirme ce choix définitif.</label><button className="button button-primary" disabled={!choice||!consent||working||busy} onClick={()=>void submit('votes')}>{working?'Signature / enregistrement…':'Signer mon vote'}</button><div className="governance-propose"><h4>Proposer un thème pour un prochain vote</h4><p>Cette suggestion publique ne modifie pas les candidats du scrutin en cours. Une suggestion par wallet éligible.</p><label>Votre thème<input maxLength={80} minLength={3} value={theme} disabled={working} onChange={e=>setTheme(e.target.value)} /></label><button className="button button-quiet" disabled={normalizeTheme(theme).length<3||working||busy} onClick={()=>void submit('proposals')}>Signer la suggestion</button></div></>}</>}
 {error&&<div role="alert" className="message message-error">{error}</div>}{notice&&<div role="status" className="message message-success">{notice}</div>}
 <details><summary>Vérifier le snapshot et les règles</summary><dl><dt>Slot du snapshot</dt><dd>{round.snapshotSlot}</dd><dt>Empreinte du snapshot</dt><dd><code>{round.snapshotHash}</code></dd><dt>Empreinte des règles</dt><dd><code>{round.rulesHash}</code></dd><dt>Mint du scrutin</dt><dd><code>{round.governanceMint}</code></dd></dl><a href={`/api/governance/audit?roundId=${encodeURIComponent(round.id)}`} target="_blank" rel="noreferrer">Consulter les données d’audit publiques</a></details>
 {state.proposals.filter(p=>p.roundId===round.id).length>0&&<div className="governance-suggestions"><h4>Suggestions pour la suite</h4>{state.proposals.filter(p=>p.roundId===round.id).map(p=><p key={p.id}>{p.theme} <small>· {p.owner.slice(0,5)}…{p.owner.slice(-5)}</small></p>)}</div>}
 </article>;
}
