import {Buffer} from 'buffer';
import BN from 'bn.js';
import {BorshCoder,type Idl} from '@coral-xyz/anchor';
import {convertIdlToCamelCase} from '@coral-xyz/anchor/dist/esm/idl.js';
import {Connection,PublicKey,Keypair,Transaction,TransactionInstruction,ComputeBudgetProgram,type AccountInfo} from '@solana/web3.js';
import {TOKEN_2022_PROGRAM_ID,getAssociatedTokenAddressSync,unpackAccount,unpackMint,type Mint} from '@solana/spl-token';
import {
 DynamicBondingCurveClient,DYNAMIC_BONDING_CURVE_PROGRAM_ID,DynamicBondingCurveIdl,
 buildCurveWithMarketCap,ActivationType,BaseFeeMode,CollectFeeMode,MigrationOption,MigrationFeeOption,
 MigratedCollectFeeMode,TokenAuthorityOption,TokenType,TokenDecimal,SwapMode,
 getQuoteFromInputAmount,getCurrentPoint,deriveDbcPoolAddress,deriveDammV2PoolAddress,DAMM_V2_MIGRATION_FEE_ADDRESS,DAMM_V2_PROGRAM_ID,
 type ConfigParameters,type PoolConfig,type VirtualPool,
} from '@meteora-ag/dynamic-bonding-curve-sdk';
import type {PlatformConfig,CreateTokenInput,TradeInput,Token} from '../types';
import {parseUnits,formatUnits} from './math';
import {assertCompatibleQuoteMint} from './quoteMint';
export const DBC_PROGRAM_ID=DYNAMIC_BONDING_CURVE_PROGRAM_ID;
export const DBC_SUPPLY=1_000_000_000_000_000n;
export const DBC_BASE_DECIMALS=6;
export const DBC_LAUNCH_SLIPPAGE_BPS=100;
const coder=new BorshCoder(convertIdlToCamelCase(DynamicBondingCurveIdl as Idl));
export function getDominionCurveParameters(config:PlatformConfig):ConfigParameters {
 const economics=config.curve??{initialMarketCapQuote:'10000',migrationMarketCapQuote:'1000000',tradingFeeBps:100};
 const initial=Number(economics.initialMarketCapQuote),migration=Number(economics.migrationMarketCapQuote),fee=economics.tradingFeeBps;
 if(!Number.isFinite(initial)||!Number.isFinite(migration)||initial<=0||migration<=initial||migration>1e12||!Number.isInteger(fee)||fee<25||fee>500)throw new Error('Paramètres de courbe invalides.');
 if(!Number.isInteger(config.quoteDecimals)||config.quoteDecimals<0||config.quoteDecimals>18)throw new Error('Décimales quote invalides.');
 const curve=buildCurveWithMarketCap({
  token:{tokenType:TokenType.SPLToken,tokenBaseDecimal:TokenDecimal.SIX,tokenQuoteDecimal:config.quoteDecimals,tokenAuthorityOption:TokenAuthorityOption.Immutable,totalTokenSupply:1_000_000_000,leftover:0},
  fee:{baseFeeParams:{baseFeeMode:BaseFeeMode.FeeSchedulerLinear,feeSchedulerParam:{startingFeeBps:fee,endingFeeBps:fee,numberOfPeriod:0,totalDuration:0}},dynamicFeeEnabled:false,collectFeeMode:CollectFeeMode.QuoteToken,creatorTradingFeePercentage:0,poolCreationFee:0,enableFirstSwapWithMinFee:false},
  migration:{migrationOption:MigrationOption.MET_DAMM_V2,migrationFeeOption:MigrationFeeOption.Customizable,migrationFee:{feePercentage:0,creatorFeePercentage:0},migratedPoolFee:{collectFeeMode:MigratedCollectFeeMode.QuoteToken,dynamicFee:0,poolFeeBps:fee,compoundingFeeBps:0}},
  liquidityDistribution:{partnerLiquidityPercentage:0,partnerPermanentLockedLiquidityPercentage:100,creatorLiquidityPercentage:0,creatorPermanentLockedLiquidityPercentage:0},
  lockedVesting:{totalLockedVestingAmount:0,numberOfVestingPeriod:0,cliffUnlockAmount:0,totalVestingDuration:0,cliffDurationFromMigrationTime:0},
  activationType:ActivationType.Timestamp,initialMarketCap:initial,migrationMarketCap:migration,
 });
 curve.padding=[0,0];return curve;
}
export function encodeDominionConfigInstruction(config:PlatformConfig):Buffer {
 return coder.instruction.encode('createConfig2',{configParameters:getDominionCurveParameters(config),transferFeeParameters:null});
}
export function decodeDbcInstruction(data:Uint8Array){return coder.instruction.decode(Buffer.from(data));}
export function decodeDbcConfig(data:Uint8Array):PoolConfig{return coder.accounts.decode('poolConfig',Buffer.from(data));}
export function decodeDbcPool(data:Uint8Array):VirtualPool{return coder.accounts.decode('virtualPool',Buffer.from(data));}
const same=(a:unknown,b:unknown)=>String(a)===String(b);
const zero=(v:unknown):boolean=>BN.isBN(v)?v.isZero():typeof v==='number'?v===0:typeof v==='boolean'?!v:Array.isArray(v)?v.every(zero):v!==null&&typeof v==='object'?Object.values(v).every(zero):v===null;
/** Check economic and custody invariants in the decoded immutable config, not only its address. */
export function assertDominionDbcConfig(actual:PoolConfig,config:PlatformConfig):void {
 const expected=getDominionCurveParameters(config);
 const fail=()=>{throw new Error('La configuration Meteora ne correspond pas à ce monde.');};
 if(actual.quoteMint.toBase58()!==config.quoteMint||actual.feeClaimer.toBase58()!==config.treasury||actual.leftoverReceiver.toBase58()!==config.treasury)fail();
 const scalars=['collectFeeMode','migrationOption','activationType','tokenType','tokenDecimal','partnerLiquidityPercentage','partnerPermanentLockedLiquidityPercentage','creatorLiquidityPercentage','creatorPermanentLockedLiquidityPercentage','migrationFeeOption','creatorTradingFeePercentage','tokenUpdateAuthority','migrationQuoteThreshold','sqrtStartPrice','poolCreationFee','migratedPoolBaseFeeMode'] as const;
 for(const field of scalars)if(!same(actual[field],expected[field]))fail();
 if(actual.fixedTokenSupplyFlag!==1||actual.transferFeeFlag!==0||actual.transferFeeBasisPoints!==0||actual.quoteTokenFlag!==(config.quoteTokenProgram===TOKEN_2022_PROGRAM_ID.toBase58()?1:0)||actual.enableFirstSwapWithMinFee!==0)fail();
 if(!same(actual.preMigrationTokenSupply,expected.tokenSupply!.preMigrationTokenSupply)||!same(actual.postMigrationTokenSupply,expected.tokenSupply!.postMigrationTokenSupply)||actual.migrationFeePercentage!==0||actual.creatorMigrationFeePercentage!==0)fail();
 if(actual.migratedPoolFeeBps!==expected.migratedPoolFee.poolFeeBps||actual.migratedDynamicFee!==0||actual.migratedCollectFeeMode!==0||actual.migratedCompoundingFeeBps!==0)fail();
 const base=expected.poolFees.baseFee;
 for(const field of ['cliffFeeNumerator','firstFactor','secondFactor','thirdFactor','baseFeeMode'] as const)if(!same(actual.poolFees.baseFee[field],base[field]))fail();
 if(actual.poolFees.dynamicFee.initialized!==0||!zero(actual.lockedVestingConfig)||!zero(actual.partnerLiquidityVestingInfo)||!zero(actual.creatorLiquidityVestingInfo))fail();
 if(actual.curve.length<expected.curve.length)fail();
 for(let i=0;i<actual.curve.length;i++){
  if(i<expected.curve.length){if(!same(actual.curve[i].sqrtPrice,expected.curve[i].sqrtPrice)||!same(actual.curve[i].liquidity,expected.curve[i].liquidity))fail();}
  else if(!zero(actual.curve[i]))fail();
 }
}
export async function readCompatibleQuote(connection:Connection,config:PlatformConfig):Promise<{mint:Mint;currentEpoch:number}> {
 if(!config.quoteMint)throw new Error('Token de paiement absent.');
 const address=new PublicKey(config.quoteMint),program=new PublicKey(config.quoteTokenProgram);
 const [info,epoch]=await Promise.all([connection.getAccountInfo(address,'confirmed'),connection.getEpochInfo('confirmed')]);
 if(!info||!info.owner.equals(program))throw new Error('Programme du token de paiement incohérent.');
 const mint=unpackMint(address,info,program);assertCompatibleQuoteMint(mint,program);
 if(mint.decimals!==config.quoteDecimals)throw new Error('Décimales du paiement incohérentes.');
 return {mint,currentEpoch:epoch.epoch};
}
export function quoteInitialLaunch(config:PlatformConfig,amount:string,quoteMint:Mint,currentEpoch:number) {
 const raw=parseUnits(amount,config.quoteDecimals);if(raw<=0n)throw new Error('Le premier achat doit être positif.');
 const parameters=getDominionCurveParameters(config);
 const quote=getQuoteFromInputAmount({config:parameters,swapBaseForQuote:false,amountIn:new BN(raw.toString()),swapMode:SwapMode.ExactIn,slippageBps:DBC_LAUNCH_SLIPPAGE_BPS,hasReferral:false,eligibleForFirstSwapWithMinFee:false,quoteTokenFlag:config.quoteTokenProgram===TOKEN_2022_PROGRAM_ID.toBase58()?1:0,quoteMint,currentEpoch});
 if(quote.outputAmount.lten(0)||!quote.minimumAmountOut||quote.minimumAmountOut.lten(0)||quote.amountLeft.gtn(0))throw new Error('Montant trop faible ou supérieur à la capacité de la courbe.');
 return {quote:{...quote,minimumAmountOut:quote.minimumAmountOut},amountIn:new BN(raw.toString())};
}
export async function previewLaunch(config:PlatformConfig,amount:string) {
 const connection=new Connection(config.rpcUrl,'confirmed');const {mint,currentEpoch}=await readCompatibleQuote(connection,config);
 const {quote}=quoteInitialLaunch(config,amount,mint,currentEpoch);
 if(config.dbcConfig){const actual=await new DynamicBondingCurveClient(connection).state.getPoolConfig(config.dbcConfig);if(!actual)throw new Error('Configuration de courbe absente.');assertDominionDbcConfig(actual,config);}
 return {tokensOut:formatUnits(quote.outputAmount.toString(),6),minTokensOut:formatUnits(quote.minimumAmountOut.toString(),6),sharePercent:Number(quote.outputAmount.toString())/Number(DBC_SUPPLY)*100,configNeeded:!config.dbcConfig};
}
export function validateLaunchInput(input:CreateTokenInput){
 const name=input.name.trim(),symbol=input.symbol.trim().toUpperCase();
 if(!name||Buffer.byteLength(name)>32||/[\u0000-\u001f\u007f]/.test(name)||!/^[A-Z0-9]{1,10}$/.test(symbol))throw new Error('Nom : 32 octets maximum. Symbole : 1 à 10 lettres ou chiffres.');
 if(!input.seedAmount)throw new Error('Indique le montant du premier achat.');return {name,symbol,amount:input.seedAmount};
}
export async function buildCurveSetupTransaction(connection:Connection,payer:PublicKey,config:PlatformConfig,configKeypair:Keypair=Keypair.generate()) {
 await readCompatibleQuote(connection,config);
 const transaction=await new DynamicBondingCurveClient(connection).partner.createConfig2({
  ...getDominionCurveParameters(config),config:configKeypair.publicKey,quoteMint:new PublicKey(config.quoteMint!),payer,feeClaimer:new PublicKey(config.treasury),leftoverReceiver:new PublicKey(config.treasury),transferFeeParameters:null,
 });
 transaction.instructions.unshift(ComputeBudgetProgram.setComputeUnitLimit({units:400000}));
 if(!config.curveVersion)throw new Error('Version de courbe absente.');
 const memo={app:'dominion-curve',version:1,configVersion:config.configVersion,curveVersion:config.curveVersion,config:configKeypair.publicKey.toBase58()};
 transaction.add(new TransactionInstruction({programId:new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),keys:[{pubkey:payer,isSigner:true,isWritable:false}],data:Buffer.from(JSON.stringify(memo))}));
 return {transaction,configKeypair};
}
export async function buildDbcLaunchTransaction(connection:Connection,payer:PublicKey,config:PlatformConfig,input:CreateTokenInput,metadataUri:string,mintKeypair:Keypair=Keypair.generate()) {
 const {name,symbol,amount}=validateLaunchInput(input);if(!config.dbcConfig)throw new Error('Initialise la courbe de ce monde avant de lancer un token.');
 if(!/^https:\/\//.test(metadataUri)||Buffer.byteLength(metadataUri)>140)throw new Error('Adresse de métadonnées invalide ou trop longue.');
 const client=new DynamicBondingCurveClient(connection);const curve=await client.state.getPoolConfig(config.dbcConfig);if(!curve)throw new Error('Configuration de courbe absente.');assertDominionDbcConfig(curve,config);
 const {mint,currentEpoch}=await readCompatibleQuote(connection,config),{quote,amountIn}=quoteInitialLaunch(config,amount,mint,currentEpoch);
 const transaction=await client.creator.createPoolWithFirstBuy({
  createPoolParam:{config:new PublicKey(config.dbcConfig),baseMint:mintKeypair.publicKey,payer,poolCreator:payer,name,symbol,uri:metadataUri},
  firstBuyParam:{buyer:payer,buyAmount:amountIn,minimumAmountOut:quote.minimumAmountOut,referralTokenAccount:null},
 });
 transaction.instructions.unshift(ComputeBudgetProgram.setComputeUnitLimit({units:600000}));
 return {transaction,mintKeypair,pool:deriveDbcPoolAddress(new PublicKey(config.quoteMint!),mintKeypair.publicKey,new PublicKey(config.dbcConfig)),quote};
}
async function readTrade(connection:Connection,config:PlatformConfig,input:TradeInput){
 if(!input.token.pool||input.token.migrated)throw new Error('Ce marché a migré ou n’est pas un marché de courbe disponible.');
 if(!Number.isInteger(input.slippageBps)||input.slippageBps<1||input.slippageBps>500)throw new Error('Glissement autorisé : 0,01 % à 5 %.');
 const client=new DynamicBondingCurveClient(connection),address=new PublicKey(input.token.pool),pool=await client.state.getPool(address);
 if(!pool||pool.poolState.isMigrated!==0||pool.poolState.baseMint.toBase58()!==input.token.mint)throw new Error('Marché absent ou déjà migré.');
 const curve=await client.state.getPoolConfig(pool.poolState.config);if(!curve)throw new Error('Configuration du marché absente.');assertDominionDbcConfig(curve,config);
 if(!deriveDbcPoolAddress(curve.quoteMint,pool.poolState.baseMint,pool.poolState.config).equals(address))throw new Error('Adresse du marché invalide.');
 const amountIn=new BN(parseUnits(input.amount,input.side==='buy'?config.quoteDecimals:6).toString());
 if(amountIn.lten(0))throw new Error('Le montant doit être positif.');
 const [currentPoint,quoteState]=await Promise.all([getCurrentPoint(connection,curve.activationType),readCompatibleQuote(connection,config)]);
 const quote=client.pool.swapQuote2({virtualPool:pool,config:curve,swapBaseForQuote:input.side==='sell',amountIn,swapMode:input.side==='buy'?SwapMode.PartialFill:SwapMode.ExactIn,slippageBps:input.slippageBps,currentPoint,hasReferral:false,eligibleForFirstSwapWithMinFee:false,quoteMint:quoteState.mint,currentEpoch:quoteState.currentEpoch});
 if(quote.outputAmount.lten(0)||!quote.minimumAmountOut||quote.minimumAmountOut.lten(0))throw new Error('Montant trop faible.');
 return {client,address,amountIn,quote:{...quote,minimumAmountOut:quote.minimumAmountOut}};
}
export async function previewTrade(config:PlatformConfig,input:TradeInput){
 const {quote}=await readTrade(new Connection(config.rpcUrl,'confirmed'),config,input),decimals=input.side==='buy'?6:config.quoteDecimals;
 return {tokensOut:formatUnits(quote.outputAmount.toString(),decimals),minTokensOut:formatUnits(quote.minimumAmountOut.toString(),decimals),minimumOutAtomic:quote.minimumAmountOut.toString(),amountInUsed:formatUnits(quote.includedTransferFeeAmountIn.toString(),input.side==='buy'?config.quoteDecimals:6)};
}
export async function buildDbcTradeTransaction(connection:Connection,payer:PublicKey,config:PlatformConfig,input:TradeInput){
 const {client,address,amountIn,quote}=await readTrade(connection,config,input);
 if(!input.minimumOutAtomic||!/^\d+$/.test(input.minimumOutAtomic))throw new Error('Actualise le devis avant de confirmer.');
 const minimumAmountOut=new BN(input.minimumOutAtomic);
 if(minimumAmountOut.lten(0)||minimumAmountOut.gt(quote.outputAmount))throw new Error('Le prix a évolué au-delà du glissement accepté. Actualise le devis.');
 const transaction=await client.pool.swap2({owner:payer,payer,pool:address,swapBaseForQuote:input.side==='sell',referralTokenAccount:null,swapMode:input.side==='buy'?SwapMode.PartialFill:SwapMode.ExactIn,amountIn,minimumAmountOut});
 transaction.instructions.unshift(ComputeBudgetProgram.setComputeUnitLimit({units:400000}));return transaction;
}


/** Conservative complete-launch SOL budget, including Metaplex's observed 0.01 SOL creation fee.
 * Rent is fetched from the selected chain; the extra 0.001 SOL is a buffer, not a platform fee.
 */
export async function estimateLaunchSol(connection:Pick<Connection,'getMinimumBalanceForRentExemption'>,configNeeded:boolean):Promise<number>{
 const sizes=[424,82,165,165,165,679,...(configNeeded?[1048]:[])];
 const rent=await Promise.all(sizes.map(size=>connection.getMinimumBalanceForRentExemption(size,'confirmed')));
 return rent.reduce((sum,value)=>sum+value,0)+10_000_000+1_000_000+(configNeeded?20_000:10_000);
}
export function requireLaunchBalances(quoteBalance:bigint,quoteNeeded:bigint,solBalance:number,solNeeded:number,quoteSymbol:string):void {
 if(quoteBalance<quoteNeeded)throw new Error(`Solde ${quoteSymbol} insuffisant pour le premier achat. Aucune configuration n’a été créée.`);
 if(solBalance<solNeeded)throw new Error(`Prévois au moins ${(solNeeded/1e9).toFixed(6)} SOL pour la configuration éventuelle, les comptes du token, les frais Metaplex et le réseau. Aucune configuration n’a été créée.`);
}
export async function assertLaunchFunds(connection:Connection,payer:PublicKey,config:PlatformConfig,amount:string){
 const quoteState=await readCompatibleQuote(connection,config);
 const {amountIn}=quoteInitialLaunch(config,amount,quoteState.mint,quoteState.currentEpoch);
 const quoteProgram=new PublicKey(config.quoteTokenProgram),quoteMint=new PublicKey(config.quoteMint!);
 const ata=getAssociatedTokenAddressSync(quoteMint,payer,false,quoteProgram);
 const [account,solBalance,minimumSolLamports]=await Promise.all([connection.getAccountInfo(ata,'confirmed'),connection.getBalance(payer,'confirmed'),estimateLaunchSol(connection,!config.dbcConfig)]);
 let quoteBalance=0n;
 if(account){const token=unpackAccount(ata,account,quoteProgram);if(token.isFrozen||!token.owner.equals(payer)||!token.mint.equals(quoteMint))throw new Error('Compte de paiement invalide.');quoteBalance=token.amount;}
 requireLaunchBalances(quoteBalance,BigInt(amountIn.toString()),solBalance,minimumSolLamports,config.quoteSymbol);
 return {quoteAtomic:amountIn.toString(),minimumSolLamports,availableSolLamports:solBalance};
}
export function isDbcMigrationReady(pool:VirtualPool,curve:PoolConfig):boolean {
 return pool.poolState.isMigrated===0&&pool.poolState.migrationProgress===2&&pool.poolState.quoteReserve.gte(curve.migrationQuoteThreshold);
}
export function migrationPoolAddress(curve:PoolConfig,baseMint:PublicKey):PublicKey {
 const dammConfig=DAMM_V2_MIGRATION_FEE_ADDRESS[curve.migrationFeeOption];
 if(!dammConfig)throw new Error('Configuration de migration DAMMv2 inconnue.');
 return deriveDammV2PoolAddress(dammConfig,baseMint,curve.quoteMint);
}
async function readMigration(connection:Connection,config:PlatformConfig,token:Token){
 if(!token.pool)throw new Error('Ce token n’a pas de marché DBC.');
 const client=new DynamicBondingCurveClient(connection),address=new PublicKey(token.pool),pool=await client.state.getPool(address);
 if(!pool||pool.poolState.baseMint.toBase58()!==token.mint)throw new Error('Marché DBC introuvable.');
 const curve=await client.state.getPoolConfig(pool.poolState.config);if(!curve)throw new Error('Configuration de courbe absente.');assertDominionDbcConfig(curve,config);
 if(!deriveDbcPoolAddress(curve.quoteMint,pool.poolState.baseMint,pool.poolState.config).equals(address))throw new Error('Adresse du marché invalide.');
 const target=migrationPoolAddress(curve,pool.poolState.baseMint);
 const migrated=pool.poolState.isMigrated!==0;
 if(migrated){const targetInfo=await connection.getAccountInfo(target,'confirmed');if(!targetInfo?.owner.equals(DAMM_V2_PROGRAM_ID))throw new Error('Le marché migré n’est pas encore vérifiable.');}
 return {client,address,pool,curve,target,ready:isDbcMigrationReady(pool,curve),migrated,marketUrl:`https://jup.ag/swap/${curve.quoteMint.toBase58()}-${token.mint}`};
}
export async function previewMigration(config:PlatformConfig,token:Token){
 const state=await readMigration(new Connection(config.rpcUrl,'confirmed'),config,token);
 return {ready:state.ready,migrated:state.migrated,pool:state.target.toBase58(),marketUrl:state.marketUrl};
}
export async function buildDbcMigrationTransaction(connection:Connection,payer:PublicKey,config:PlatformConfig,token:Token){
 const state=await readMigration(connection,config,token);
 if(state.migrated)throw new Error('Ce marché a déjà migré. Actualise sa fiche.');
 if(!state.ready)throw new Error('Le seuil de migration de ce marché n’est pas encore atteint.');
 await readCompatibleQuote(connection,config);
 const prepared=await state.client.migration.migrateToDammV2({payer,pool:state.address,dammConfig:DAMM_V2_MIGRATION_FEE_ADDRESS[state.curve.migrationFeeOption]});
 if(!prepared.transaction.instructions.some(ix=>ix.programId.equals(ComputeBudgetProgram.programId)&&ix.data[0]===2))prepared.transaction.instructions.unshift(ComputeBudgetProgram.setComputeUnitLimit({units:600000}));
 return {transaction:prepared.transaction,signers:[prepared.firstPositionNftKeypair,prepared.secondPositionNftKeypair],pool:state.target,marketUrl:state.marketUrl};
}
