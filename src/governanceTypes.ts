export interface GovernanceCandidate {id:string;label:string}
export interface GovernanceRound {
 domain:string;network:string;quoteDecimals:number;governanceMint:string;id:string;themeLabel:string;opensAt:string;closesAt:string;snapshotHash:string;snapshotSlot:number;rulesHash:string;
 candidates:GovernanceCandidate[];eligibleWeightAtomic:string;quorumBps:number;
 status:'upcoming'|'open'|'closed';votes:{candidateId:string;weightAtomic:string}[];castWeightAtomic:string;quorumReached:boolean;winnerId:string|null;
}
export interface GovernanceProposal {id:string;roundId:string;owner:string;theme:string;createdAt:string}
export interface GovernanceState {status:'awaiting_snapshot'|'ready';domain:string;network:'mainnet-beta'|'devnet';governanceMint:string|null;rounds:GovernanceRound[];proposals:GovernanceProposal[];notice:string}
export interface GovernanceVoteInput {roundId:string;owner:string;candidateId:string;signature:string}
export interface GovernanceProposalInput {roundId:string;owner:string;theme:string;signature:string}
export function normalizeTheme(theme:string):string{return theme.normalize('NFC').trim().replace(/ +/g,' ');}
function message(state:GovernanceState,roundId:string,owner:string,action:string,choice:string):string {
 const round=state.rounds.find(r=>r.id===roundId);if(!round||!state.governanceMint)throw new Error('Scrutin indisponible.');
 return JSON.stringify({app:'dominion-governance',version:1,domain:round.domain,network:round.network,mint:round.governanceMint,action,roundId,snapshotHash:round.snapshotHash,rulesHash:round.rulesHash,owner,choice,opensAt:round.opensAt,closesAt:round.closesAt});
}
export const buildVoteMessage=(state:GovernanceState,roundId:string,owner:string,candidateId:string)=>message(state,roundId,owner,'vote',candidateId);
export const buildProposalMessage=(state:GovernanceState,roundId:string,owner:string,theme:string)=>message(state,roundId,owner,'suggest-next-theme',normalizeTheme(theme));
