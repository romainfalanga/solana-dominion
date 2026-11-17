import { Buffer } from 'buffer';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,getAssociatedTokenAddressSync,unpackMint } from '@solana/spl-token';
import { DynamicBondingCurveIdl,deriveDbcPoolAddress,deriveDbcPoolAuthority,deriveDbcTokenVaultAddress } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { DBC_PROGRAM_ID,DBC_SUPPLY,encodeDominionConfigInstruction,decodeDbcInstruction,decodeDbcConfig,decodeDbcPool,assertDominionDbcConfig } from '../src/lib/dbc';
import type { PlatformConfig } from '../src/types';
import { PublicError,database,type Env,type ParsedInstruction,type ParsedTransaction,type RegisteredLaunch,type RpcAccount,type RpcContext,type SavedConfiguration,type SavedCurve,type TokenBalance } from './types';
import { accountInfo,rpc } from './rpc';
import { settings,verifyNetwork,quoteSymbolFromParsed,type ParsedMint } from './settings';
import {assertWorldPayment,worldIdForQuote} from './worlds';
const MEMO = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const normalized = (name: string) => name.replaceAll('_','').toLowerCase();
function invalid(message: string): never {throw new PublicError(message,422,'INVALID_CURVE');}
interface DecodedInstruction { name:string;data:Record<string,unknown>;accounts:Record<string,string>;raw:Buffer;index:number }
export function dbcInstructions(tx: ParsedTransaction): DecodedInstruction[] {
  return tx.transaction.message.instructions.flatMap((instruction,index) => {
    if (instruction.programId !== DBC_PROGRAM_ID.toBase58()) return [];
    if (!instruction.data || !instruction.accounts) return invalid('Instruction Meteora non décodable.');
    let bytes: Buffer,decoded: ReturnType<typeof decodeDbcInstruction>;
    try {bytes = Buffer.from(bs58.decode(instruction.data));decoded = decodeDbcInstruction(bytes);} catch {return invalid('Instruction Meteora non valide.');}
    if (!decoded) return invalid('Instruction Meteora inconnue.');
    const schema = DynamicBondingCurveIdl.instructions.find(item => normalized(item.name) === normalized(decoded!.name));
    if (!schema || instruction.accounts.length < schema.accounts.length) return invalid('Comptes Meteora incomplets.');
    const accounts = Object.fromEntries(schema.accounts.map((account,i) => [account.name,instruction.accounts![i]]));
    return [{name:normalized(decoded.name),data:decoded.data as Record<string,unknown>,accounts,raw:bytes,index}];
  });
}
function successful(tx: ParsedTransaction,signature: string): string {
  const payer = tx.transaction.message.accountKeys[0];
  if (!tx.meta || tx.meta.err !== null || tx.transaction.signatures[0] !== signature || !payer?.signer || !payer.writable || !Number.isSafeInteger(tx.slot) || tx.slot < 0) invalid('La transaction Meteora doit être réussie et signée par son payeur.');
  return payer.pubkey;
}
export function restorePolicy(row: SavedConfiguration,env: Env): PlatformConfig {
  if (row.launch_model !== 'dbc' || !row.curve_version || !row.curve_json) invalid('Configuration historique de courbe absente.');
  let curve: PlatformConfig['curve'];try {curve = JSON.parse(row.curve_json) as PlatformConfig['curve'];} catch {return invalid('Politique de courbe historique non valide.');}
  return {mode:row.cluster,quoteMint:row.payment_mint,quoteSymbol:row.payment_mint.slice(0,6),quoteDecimals:row.quote_decimals,quoteTokenProgram:row.payment_program,programId:null,rpcUrl:settings(env).publicRpc,tradingEnabled:false,worldName:'Solana',worldId:worldIdForQuote(row.payment_mint),creationFeeAtomic:row.fee_atomic,treasury:row.treasury,configVersion:row.version,creationEnabled:true,launchModel:'dbc',curveVersion:row.curve_version,dbcConfig:row.dbc_config ?? null,curve};
}
export function curvePolicy(row: SavedCurve): PlatformConfig {
  let policy: PlatformConfig;try {policy = JSON.parse(row.policy_json) as PlatformConfig;} catch {return invalid('Politique de courbe sauvegardée non valide.');}
  if (policy.quoteMint !== row.payment_mint || policy.curveVersion !== row.curve_version || policy.mode !== row.cluster) invalid('Historique de courbe incohérent.');
  return {...policy,dbcConfig:row.config_address};
}
export async function registerCurveConfig(env: Env,signature: string,worldId?:string): Promise<{created:boolean;curve:SavedCurve}> {
  const cfg = settings(env,worldId),db = database(env);
  const existing = await db.prepare('SELECT * FROM curve_configs WHERE cluster = ? AND signature = ?').bind(cfg.cluster,signature).first<SavedCurve>();
  if (existing) {if(worldId)assertWorldPayment(worldId,existing.payment_mint);return {created:false,curve:existing};}
  if (env.CREATION_ENABLED !== 'true') throw new PublicError('La configuration de nouveaux marchés est désactivée.',503,'CREATION_DISABLED');
  await verifyNetwork(env);
  const tx = await rpc<ParsedTransaction | null>(cfg.privateRpc,'getTransaction',[signature,{encoding:'jsonParsed',commitment:'finalized',maxSupportedTransactionVersion:0}]);
  if (!tx) throw new PublicError('La configuration de courbe n’est pas encore finalisée. Réessayez la même signature.',409,'TRANSACTION_PENDING');
  const payer = successful(tx,signature);
  const memos = tx.transaction.message.instructions.filter(ix => ix.programId === MEMO && typeof ix.parsed === 'string').flatMap(ix => {
    try {const value = JSON.parse(ix.parsed as string) as Record<string,unknown>;return value?.app === 'dominion-curve' ? [value] : [];} catch {return [];}
  });
  if (memos.length !== 1) invalid('Le reçu signé de configuration de courbe est absent ou ambigu.');
  const memo = memos[0];
  if (Object.keys(memo).sort().join(',') !== 'app,config,configVersion,curveVersion,version' || memo.version !== 1 || typeof memo.configVersion !== 'string' || typeof memo.curveVersion !== 'string' || typeof memo.config !== 'string') invalid('Le reçu de configuration est non valide.');
  const saved = await db.prepare('SELECT * FROM configurations WHERE version = ? AND cluster = ?').bind(memo.configVersion,cfg.cluster).first<SavedConfiguration>();
  if (!saved || saved.curve_version !== memo.curveVersion) invalid('Cette politique de courbe n’a pas été publiée par la plateforme.');
  if(worldId)assertWorldPayment(worldId,saved.payment_mint);
  const policy = restorePolicy(saved,env),creates = dbcInstructions(tx).filter(ix => ix.name === 'createconfig2');
  if (creates.length !== 1) invalid('Une unique création de configuration Meteora est requise.');
  const create = creates[0],a = create.accounts;
  if (a.config !== memo.config || a.payer !== payer || a.quote_mint !== saved.payment_mint || a.fee_claimer !== saved.treasury || a.leftover_receiver !== saved.treasury || !tx.transaction.message.accountKeys.some(key => key.pubkey === memo.config && key.signer)) invalid('Les destinataires ou signataires de la courbe sont incorrects.');
  if (!create.raw.equals(encodeDominionConfigInstruction(policy))) invalid('Les paramètres de la courbe ne sont pas ceux de la plateforme.');
  const raw = await rpc<RpcContext<RpcAccount | null>>(cfg.privateRpc,'getAccountInfo',[memo.config,{encoding:'base64',commitment:'finalized',minContextSlot:tx.slot}]);
  const info = accountInfo(raw.value);
  if (!info || info.executable || !info.owner.equals(DBC_PROGRAM_ID) || raw.context.slot < tx.slot) invalid('La configuration n’appartient pas au programme Meteora attendu.');
  try {assertDominionDbcConfig(decodeDbcConfig(info.data),policy);} catch {invalid('La configuration créée ne respecte pas les règles de la plateforme.');}
  const quoteMetadata = await rpc<RpcContext<ParsedMint | null>>(cfg.privateRpc,'getAccountInfo',[saved.payment_mint,{encoding:'jsonParsed',commitment:'finalized'}]).catch(() => null);
  policy.quoteSymbol = quoteSymbolFromParsed(quoteMetadata,saved.payment_mint);
  const row: SavedCurve = {cluster:cfg.cluster,payment_mint:saved.payment_mint,curve_version:saved.curve_version!,config_address:memo.config,signature,creator:payer,platform_config_version:saved.version,policy_json:JSON.stringify(policy),slot:tx.slot};
  const result = await db.prepare('INSERT INTO curve_configs (cluster,payment_mint,curve_version,config_address,signature,creator,platform_config_version,policy_json,slot) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING')
    .bind(row.cluster,row.payment_mint,row.curve_version,row.config_address,row.signature,row.creator,row.platform_config_version,row.policy_json,row.slot).run();
  if (!result.success) throw new PublicError('La courbe est valide mais son enregistrement a échoué. Réessayez le même reçu.');
  const stored = await db.prepare('SELECT * FROM curve_configs WHERE cluster = ? AND payment_mint = ? AND curve_version = ?').bind(row.cluster,row.payment_mint,row.curve_version).first<SavedCurve>();
  if (!stored) throw new PublicError('La configuration de courbe enregistrée est introuvable.');
  // Two users may bootstrap an identical policy concurrently. The first valid config wins.
  return {created:stored.config_address === row.config_address && result.meta?.changes !== 0,curve:stored};
}
function asAmount(value: unknown): bigint {
  const text = String(value);if (!/^\d+$/.test(text)) return invalid('Montant d’achat initial non valide.');return BigInt(text);
}
function balance(tx: ParsedTransaction,values: TokenBalance[] | undefined,address: string,mint: string,owner: string,program: string,required: boolean): bigint {
  const index = tx.transaction.message.accountKeys.findIndex(key => key.pubkey === address),rows = values?.filter(item => item.accountIndex === index) ?? [];
  if (!rows.length && !required) return 0n;
  const row = rows[0];if (index < 0 || rows.length !== 1 || row.mint !== mint || row.owner !== owner || row.programId !== program || !/^\d+$/.test(row.uiTokenAmount.amount)) return invalid('Les soldes de l’achat initial ne correspondent pas au marché.');
  return BigInt(row.uiTokenAmount.amount);
}
export async function registerDbcLaunch(env: Env,signature: string,tx: ParsedTransaction,worldId?:string): Promise<{created:boolean;launch:RegisteredLaunch}> {
  const cfg = settings(env,worldId),db = database(env),payer = successful(tx,signature),instructions = dbcInstructions(tx);
  const creates = instructions.filter(ix => ix.name === 'initializevirtualpoolwithspltoken' || ix.name === 'initializevirtualpoolwithtoken2022');
  if (creates.length !== 1) invalid('Une seule création de marché Meteora est requise.');
  const create = creates[0],a = create.accounts;
  const shared = await db.prepare('SELECT * FROM curve_configs WHERE cluster = ? AND config_address = ?').bind(cfg.cluster,a.config).first<SavedCurve>();
  if (!shared) invalid('Le marché utilise une configuration de courbe non enregistrée.');
  if(worldId)assertWorldPayment(worldId,shared.payment_mint);
  const policy = curvePolicy(shared),configAddress = new PublicKey(shared.config_address),quoteMint = new PublicKey(shared.payment_mint),mint = new PublicKey(a.base_mint),poolAddress = new PublicKey(a.pool);
  const expectedPool = deriveDbcPoolAddress(quoteMint,mint,configAddress),authority = deriveDbcPoolAuthority();
  const baseProgram = create.name === 'initializevirtualpoolwithtoken2022' ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  if (a.creator !== payer || a.payer !== payer || a.quote_mint !== shared.payment_mint || a.pool_authority !== authority.toBase58() || !expectedPool.equals(poolAddress)
    || a.base_vault !== deriveDbcTokenVaultAddress(poolAddress,mint).toBase58() || a.quote_vault !== deriveDbcTokenVaultAddress(poolAddress,quoteMint).toBase58()
    || a.token_program !== baseProgram.toBase58() || a.token_quote_program !== policy.quoteTokenProgram || !tx.transaction.message.accountKeys.some(key => key.pubkey === a.base_mint && key.signer)) invalid('Les comptes de création du marché ne sont pas cohérents.');
  const metadata = create.data.params as Record<string,unknown> | undefined;
  if (!metadata || typeof metadata.name !== 'string' || !metadata.name.trim() || metadata.name !== metadata.name.trim() || new TextEncoder().encode(metadata.name).length > 32 || /[\u0000-\u001f\u007f]/.test(metadata.name) || typeof metadata.symbol !== 'string' || !/^[A-Z0-9]{1,10}$/.test(metadata.symbol)) invalid('Les métadonnées du token créé sont invalides.');
  const swaps = instructions.filter(ix => (ix.name === 'swap' || ix.name === 'swap2') && ix.accounts.pool === a.pool);
  if (swaps.length !== 1 || swaps[0].index <= create.index) invalid('Le lancement doit inclure un premier achat après la création du marché.');
  const swap = swaps[0],s = swap.accounts,params = swap.data.params as Record<string,unknown>;
  if (!params || (swap.name === 'swap2' && params.swapMode !== 0)) invalid('Le premier achat doit utiliser un montant entrant exact.');
  const input = asAmount(swap.name === 'swap2' ? params.amount0 : params.amountIn),minimum = asAmount(swap.name === 'swap2' ? params.amount1 : params.minimumAmountOut);
  if (input <= 0n || minimum <= 0n) invalid('Le premier achat doit avoir un montant et un minimum reçus strictement positifs.');
  const inputAccount = getAssociatedTokenAddressSync(quoteMint,new PublicKey(payer),false,new PublicKey(policy.quoteTokenProgram)).toBase58();
  const outputAccount = getAssociatedTokenAddressSync(mint,new PublicKey(payer),false,baseProgram).toBase58();
  if (s.config !== a.config || s.payer !== payer || s.pool_authority !== authority.toBase58() || s.base_mint !== a.base_mint || s.quote_mint !== a.quote_mint || s.base_vault !== a.base_vault || s.quote_vault !== a.quote_vault || s.input_token_account !== inputAccount || s.output_token_account !== outputAccount || s.token_base_program !== baseProgram.toBase58() || s.token_quote_program !== policy.quoteTokenProgram) invalid('Le premier échange ne correspond pas à un achat par le créateur.');
  const buyerOutput = balance(tx,tx.meta!.postTokenBalances,outputAccount,a.base_mint,payer,baseProgram.toBase58(),true) - balance(tx,tx.meta!.preTokenBalances,outputAccount,a.base_mint,payer,baseProgram.toBase58(),false);
  const vaultInput = balance(tx,tx.meta!.postTokenBalances,a.quote_vault,a.quote_mint,authority.toBase58(),policy.quoteTokenProgram,true) - balance(tx,tx.meta!.preTokenBalances,a.quote_vault,a.quote_mint,authority.toBase58(),policy.quoteTokenProgram,false);
  if (buyerOutput < minimum || buyerOutput <= 0n || vaultInput <= 0n || vaultInput > input) invalid('Les soldes ne prouvent pas l’achat initial annoncé.');
  const accounts = await rpc<RpcContext<(RpcAccount | null)[]>>(cfg.privateRpc,'getMultipleAccounts',[[a.pool,a.config,a.base_mint],{encoding:'base64',commitment:'finalized',minContextSlot:tx.slot}]);
  if (accounts.context.slot < tx.slot || accounts.value.length !== 3) invalid('Les comptes du marché ne sont pas encore vérifiables.');
  const poolInfo = accountInfo(accounts.value[0]),configInfo = accountInfo(accounts.value[1]),mintInfo = accountInfo(accounts.value[2]);
  if (!poolInfo || poolInfo.executable || !poolInfo.owner.equals(DBC_PROGRAM_ID) || !configInfo || configInfo.executable || !configInfo.owner.equals(DBC_PROGRAM_ID) || !mintInfo || mintInfo.executable || !mintInfo.owner.equals(baseProgram)) invalid('Un compte du marché n’appartient pas au programme attendu.');
  let pool:ReturnType<typeof decodeDbcPool>,curve:ReturnType<typeof decodeDbcConfig>;
  try {pool = decodeDbcPool(poolInfo.data);curve = decodeDbcConfig(configInfo.data);assertDominionDbcConfig(curve,policy);} catch {return invalid('Le marché ou sa politique de courbe ne sont pas valides.');}
  const state = pool.poolState;
  if (state.config.toBase58() !== a.config || state.baseMint.toBase58() !== a.base_mint || state.creator.toBase58() !== payer || state.baseVault.toBase58() !== a.base_vault || state.quoteVault.toBase58() !== a.quote_vault || state.hasSwap !== 1 || state.poolType !== curve.tokenType) invalid('L’état du pool ne confirme pas le lancement.');
  const token = unpackMint(mint,mintInfo,baseProgram);
  if (!token.isInitialized || token.decimals !== curve.tokenDecimal || token.mintAuthority || token.freezeAuthority || token.supply > DBC_SUPPLY) invalid('Les autorités ou l’offre du nouveau token ne respectent pas la courbe.');
  const history = await db.prepare('SELECT * FROM configurations WHERE cluster = ? AND dbc_config = ? LIMIT 1').bind(cfg.cluster,a.config).first<SavedConfiguration>();
  if (!history) throw new PublicError('Actualisez la configuration de la plateforme puis réessayez ce reçu.',409,'CONFIGURATION_UNKNOWN');
  const row:RegisteredLaunch = {cluster:cfg.cluster,mint:a.base_mint,signature,creator:payer,name:metadata.name,symbol:metadata.symbol,payment_mint:shared.payment_mint,payment_program:policy.quoteTokenProgram,fee_atomic:'0',treasury:policy.treasury,config_version:history.version,created_at:typeof tx.blockTime === 'number' ? tx.blockTime : Math.floor(Date.now()/1000),slot:tx.slot,model:'dbc',pool:a.pool,curve_config:a.config,initial_quote_atomic:input.toString()};
  const result = await db.prepare('INSERT INTO launches (cluster,mint,signature,creator,name,symbol,payment_mint,payment_program,fee_atomic,treasury,config_version,created_at,slot,model,pool,curve_config,initial_quote_atomic) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING')
    .bind(row.cluster,row.mint,row.signature,row.creator,row.name,row.symbol,row.payment_mint,row.payment_program,row.fee_atomic,row.treasury,row.config_version,row.created_at,row.slot,'dbc',row.pool!,row.curve_config!,row.initial_quote_atomic!).run();
  if (!result.success) throw new PublicError('Le marché est valide mais son enregistrement a échoué. Réessayez la même signature.');
  const stored = await db.prepare('SELECT * FROM launches WHERE cluster = ? AND signature = ?').bind(cfg.cluster,signature).first<RegisteredLaunch>();
  if (!stored || stored.mint !== row.mint || stored.pool !== row.pool) throw new PublicError('Ce marché est déjà associé à un autre reçu.',409,'ALREADY_REGISTERED');
  return {created:result.meta?.changes !== 0,launch:stored};
}
