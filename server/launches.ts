import bs58 from 'bs58';
import { PublicKey,SystemProgram } from '@solana/web3.js';
import { getAssociatedTokenAddressSync,TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,unpackMint } from '@solana/spl-token';
import { PublicError,database,type Env,type ParsedInstruction,type ParsedTransaction,type RegisteredLaunch,type RpcAccount,type RpcContext,type SavedConfiguration,type TokenBalance } from './types';
import { accountInfo,rpc } from './rpc';
import { settings,verifyNetwork } from './settings';
import { DBC_PROGRAM_ID } from '../src/lib/dbc';
import { registerDbcLaunch } from './curves';
const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const SUPPLY = 1_000_000_000_000_000n;
interface Receipt { app:'dominion';version:1;configVersion:string;mint:string;name:string;symbol:string }
function invalid(message: string): never {throw new PublicError(message,422,'INVALID_LAUNCH');}
export function validateSignature(value: unknown): string {
  if (typeof value !== 'string' || value.length < 64 || value.length > 88) throw new PublicError('Signature Solana non valide.',400,'INVALID_SIGNATURE');
  try {if (bs58.decode(value).length !== 64) throw new Error();} catch {throw new PublicError('Signature Solana non valide.',400,'INVALID_SIGNATURE');}
  return value;
}
function receiptFrom(tx: ParsedTransaction): Receipt {
  const memos = tx.transaction.message.instructions.filter(ix => ix.programId === MEMO_PROGRAM && typeof ix.parsed === 'string');
  const receipts: Receipt[] = [];
  for (const memo of memos) {
    if (typeof memo.parsed !== 'string' || memo.parsed.length > 1024) continue;
    let value: Record<string,unknown>;try {value = JSON.parse(memo.parsed) as Record<string,unknown>;} catch {continue;}
    if (!value || value.app !== 'dominion') continue;
    if (Object.keys(value).sort().join(',') !== 'app,configVersion,mint,name,symbol,version' || value.version !== 1
      || typeof value.configVersion !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value.configVersion)
      || typeof value.mint !== 'string' || typeof value.name !== 'string' || !value.name.trim() || value.name !== value.name.trim()
      || new TextEncoder().encode(value.name).length > 32 || /[\u0000-\u001f\u007f]/.test(value.name)
      || typeof value.symbol !== 'string' || !/^[A-Z0-9]{1,10}$/.test(value.symbol)) invalid('Le reçu de création Dominion est invalide.');
    receipts.push(value as unknown as Receipt);
  }
  if (receipts.length !== 1) invalid('Un reçu de création Dominion signé est nécessaire.');
  return receipts[0];
}
function instruction(instructions: ParsedInstruction[],program: string,type: string,match: (info: Record<string,unknown>) => boolean): Record<string,unknown> {
  const found = instructions.flatMap(ix => ix.programId === program && typeof ix.parsed === 'object' && ix.parsed?.type === type && match(ix.parsed.info) ? [ix.parsed.info] : []);
  if (found.length !== 1) invalid(`Instruction de création ${type} absente ou ambiguë.`);
  return found[0];
}
function amountAt(balances: TokenBalance[] | undefined,index: number,mint: string,owner: string,program: string,decimals: number,required: boolean): bigint {
  const rows = balances?.filter(item => item.accountIndex === index) ?? [];
  if (!rows.length && !required) return 0n;
  const item = rows[0];
  if (rows.length !== 1 || !item || item.mint !== mint || item.owner !== owner || item.programId !== program || item.uiTokenAmount.decimals !== decimals || !/^\d+$/.test(item.uiTokenAmount.amount)) invalid('Les soldes de la transaction ne correspondent pas au paiement attendu.');
  return BigInt(item.uiTokenAmount.amount);
}
/** Validate only evidence returned by the finalized Solana RPC, never client-supplied metadata. */
export function verifyTransaction(tx: ParsedTransaction,signature: string,receipt: Receipt,config: SavedConfiguration): {payer:string;mint:string} {
  if (!tx.meta || tx.meta.err !== null || tx.transaction.signatures[0] !== signature || !Number.isSafeInteger(tx.slot) || tx.slot < 0) invalid('La transaction a échoué ou ne correspond pas à cette signature.');
  const keys = tx.transaction.message.accountKeys,instructions = tx.transaction.message.instructions;
  const payer = keys[0];
  if (!payer?.signer || !payer.writable) invalid('Le créateur doit être le payeur signataire de la transaction.');
  let mint: PublicKey,payerKey: PublicKey,quote: PublicKey,quoteProgram: PublicKey,treasury: PublicKey;
  try {mint = new PublicKey(receipt.mint);payerKey = new PublicKey(payer.pubkey);quote = new PublicKey(config.payment_mint);quoteProgram = new PublicKey(config.payment_program);treasury = new PublicKey(config.treasury);} catch {return invalid('Adresse de création non valide.');}
  if (!quoteProgram.equals(TOKEN_PROGRAM_ID) && !quoteProgram.equals(TOKEN_2022_PROGRAM_ID)) invalid('Programme de paiement incompatible.');
  if (!keys.some(key => key.pubkey === receipt.mint && key.signer)) invalid('Le nouveau mint doit signer sa création.');
  const baseProgram = TOKEN_PROGRAM_ID.toBase58();
  const create = instruction(instructions,SystemProgram.programId.toBase58(),'createAccount',info => info.newAccount === receipt.mint);
  if (create.source !== payer.pubkey || create.owner !== baseProgram || create.space !== 82) invalid('Le mint doit être un nouveau compte SPL créé par le signataire dans cette transaction.');
  const init = instruction(instructions,baseProgram,'initializeMint2',info => info.mint === receipt.mint);
  if (init.decimals !== 6 || init.mintAuthority !== payer.pubkey || init.freezeAuthority != null) invalid('Les autorités initiales du mint ne sont pas valides.');
  const creatorAta = getAssociatedTokenAddressSync(mint,payerKey).toBase58();
  const mintTo = instruction(instructions,baseProgram,'mintTo',info => info.mint === receipt.mint);
  if (mintTo.account !== creatorAta || mintTo.mintAuthority !== payer.pubkey || mintTo.amount !== SUPPLY.toString()) invalid('L’offre initiale doit être un milliard de tokens attribués au créateur.');
  const revoke = instruction(instructions,baseProgram,'setAuthority',info => (info.mint === receipt.mint || info.account === receipt.mint) && info.authorityType === 'mintTokens');
  if (revoke.authority !== payer.pubkey || revoke.newAuthority !== null) invalid('L’autorité de création de tokens doit être révoquée.');
  const source = getAssociatedTokenAddressSync(quote,payerKey,false,quoteProgram).toBase58();
  const destination = getAssociatedTokenAddressSync(quote,treasury,false,quoteProgram).toBase58();
  const transfer = instruction(instructions,config.payment_program,'transferChecked',info => info.source === source && info.destination === destination && info.mint === config.payment_mint && info.authority === payer.pubkey);
  const tokenAmount = transfer.tokenAmount as {amount?:unknown;decimals?:unknown} | undefined;
  if (!tokenAmount || tokenAmount.amount !== config.fee_atomic || tokenAmount.decimals !== config.quote_decimals) invalid('Les frais de création réglés ne correspondent pas à la configuration signée.');
  const destinationIndex = keys.findIndex(key => key.pubkey === destination);
  const sourceIndex = keys.findIndex(key => key.pubkey === source);
  if (destinationIndex < 0 || sourceIndex < 0) invalid('Les comptes de paiement sont absents.');
  const before = amountAt(tx.meta.preTokenBalances,destinationIndex,config.payment_mint,config.treasury,config.payment_program,config.quote_decimals,false);
  const after = amountAt(tx.meta.postTokenBalances,destinationIndex,config.payment_mint,config.treasury,config.payment_program,config.quote_decimals,true);
  // When the operator creates its own token, paying its own treasury is a self-transfer.
  if (payer.pubkey !== config.treasury && after - before < BigInt(config.fee_atomic)) invalid('La trésorerie n’a pas reçu les frais requis dans cette transaction.');
  const creatorIndex = keys.findIndex(key => key.pubkey === creatorAta);
  if (creatorIndex < 0 || amountAt(tx.meta.postTokenBalances,creatorIndex,receipt.mint,payer.pubkey,baseProgram,6,true) !== SUPPLY) invalid('L’offre initiale n’est pas présente sur le compte du créateur.');
  return {payer:payer.pubkey,mint:receipt.mint};
}
export async function registerLaunch(env: Env,signature: string): Promise<{created:boolean;launch:RegisteredLaunch}> {
  const db = database(env),current = settings(env);
  const existing = await db.prepare('SELECT * FROM launches WHERE cluster = ? AND signature = ?').bind(current.cluster,signature).first<RegisteredLaunch>();
  if (existing) return {created:false,launch:existing};
  if (env.CREATION_ENABLED !== 'true') throw new PublicError('La création est momentanément désactivée. Votre reçu peut être réessayé après réactivation.',503,'CREATION_DISABLED');
  await verifyNetwork(env);
  const tx = await rpc<ParsedTransaction | null>(current.privateRpc,'getTransaction',[signature,{encoding:'jsonParsed',commitment:'finalized',maxSupportedTransactionVersion:0}]);
  if (!tx) throw new PublicError('La transaction n’est pas encore finalisée. Réessayez ce même reçu, sans créer un nouveau token.',409,'TRANSACTION_PENDING');
  if (!tx.meta || tx.meta.err !== null) invalid('La transaction a échoué sur Solana.');
  if (tx.transaction.message.instructions.some(ix => ix.programId === DBC_PROGRAM_ID.toBase58())) return registerDbcLaunch(env,signature,tx);
  const receipt = receiptFrom(tx);
  const saved = await db.prepare('SELECT * FROM configurations WHERE version = ? AND cluster = ?').bind(receipt.configVersion,current.cluster).first<SavedConfiguration>();
  if (!saved) throw new PublicError('Cette configuration de création n’a pas été publiée par la plateforme.',409,'CONFIGURATION_UNKNOWN');
  const {payer,mint} = verifyTransaction(tx,signature,receipt,saved);
  const state = await rpc<RpcContext<RpcAccount | null>>(current.privateRpc,'getAccountInfo',[mint,{encoding:'base64',commitment:'finalized',minContextSlot:tx.slot}]);
  if (state.context.slot < tx.slot) throw new PublicError('Le RPC n’a pas encore atteint le slot de création.',409,'TRANSACTION_PENDING');
  const info = accountInfo(state.value);
  if (!info || !info.owner.equals(TOKEN_PROGRAM_ID) || info.executable || info.data.length !== 82) invalid('Le mint créé n’est pas un compte SPL classique valide.');
  const onChain = unpackMint(new PublicKey(mint),info,TOKEN_PROGRAM_ID);
  if (!onChain.isInitialized || onChain.decimals !== 6 || onChain.mintAuthority || onChain.freezeAuthority || onChain.supply > SUPPLY) invalid('L’offre ou les autorités actuelles du mint ne correspondent pas au lancement.');
  const createdAt = typeof tx.blockTime === 'number' && Number.isSafeInteger(tx.blockTime) ? tx.blockTime : Math.floor(Date.now()/1000);
  const row: RegisteredLaunch = {cluster:current.cluster,mint,signature,creator:payer,name:receipt.name,symbol:receipt.symbol,payment_mint:saved.payment_mint,payment_program:saved.payment_program,fee_atomic:saved.fee_atomic,treasury:saved.treasury,config_version:saved.version,created_at:createdAt,slot:tx.slot};
  const insert = await db.prepare('INSERT INTO launches (cluster,mint,signature,creator,name,symbol,payment_mint,payment_program,fee_atomic,treasury,config_version,created_at,slot) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING')
    .bind(row.cluster,row.mint,row.signature,row.creator,row.name,row.symbol,row.payment_mint,row.payment_program,row.fee_atomic,row.treasury,row.config_version,row.created_at,row.slot).run();
  if (!insert.success) throw new PublicError('Le reçu est valide mais son enregistrement a échoué. Réessayez la même signature.');
  const registered = await db.prepare('SELECT * FROM launches WHERE cluster = ? AND signature = ?').bind(current.cluster,signature).first<RegisteredLaunch>();
  if (!registered || registered.mint !== mint) throw new PublicError('Ce mint est déjà associé à un autre lancement.',409,'ALREADY_REGISTERED');
  return {created:insert.meta?.changes !== 0,launch:registered};
}
