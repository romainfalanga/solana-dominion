export interface PlatformConfig { mode:'demo'|'devnet'|'mainnet-beta'; quoteMint:string|null; quoteSymbol:string; quoteDecimals:number; quoteTokenProgram:string; programId:string|null; rpcUrl:string; tradingEnabled:boolean; worldName:string; creationFeeAtomic:string; treasury:string; configVersion:string; creationEnabled:boolean; }
export interface Token { mint:string; pool:string; name:string; symbol:string; color:string; creator:string; supply:string; baseReserve:string; quoteReserve:string; decimals:number; quoteDecimals:number; marketCap:number; price:number; change24h:number|null; createdAt:number; }
export interface Snapshot { tokens:Token[]; updatedAt:string; slot:number|null; source:'demo'|'chain'; currency?:'USD'; }
export interface CreateTokenInput {name:string; symbol:string; seedAmount?:string;}
export interface TradeInput { token:Token; side:'buy'|'sell'; amount:string; slippageBps:number; }
