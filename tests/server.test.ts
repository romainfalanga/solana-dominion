import { afterEach, describe, expect, it, vi } from 'vitest';
import { Buffer } from 'buffer';
import { Keypair, PublicKey } from '@solana/web3.js';
import { AccountLayout, getAssociatedTokenAddressSync, MintLayout, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import worker, { baseConfig, readSnapshot, type Env } from '../server';

const quote = Keypair.generate().publicKey;
const program = Keypair.generate().publicKey;
const ctx = { waitUntil: vi.fn() };
const env: Env = { PLATFORM_MODE:'devnet',QUOTE_MINT:quote.toBase58(),PROGRAM_ID:program.toBase58(),TRADING_ENABLED:'true',SOLANA_RPC_URL:'https://private.example/rpc?key=hidden-secret' };
function mintAccount(decimals = 9, freeze = false) {
  const data = Buffer.alloc(MintLayout.span);
  MintLayout.encode({ mintAuthorityOption:0,mintAuthority:PublicKey.default,supply:100_000_000_000n,decimals,isInitialized:true,freezeAuthorityOption:freeze ? 1 : 0,freezeAuthority:PublicKey.default },data);
  return { data:[data.toString('base64'),'base64'],owner:TOKEN_PROGRAM_ID.toBase58(),lamports:1,executable:false };
}
function rpcMock(overrides: Record<string,unknown> = {}) {
  return vi.stubGlobal('fetch',vi.fn(async (_url,init) => {
    const method = JSON.parse(String(init?.body)).method as string;
    const values: Record<string,unknown> = { getGenesisHash:'EtWTRABZaYq6iMfeYKouRu166VU2xqa1', getMultipleAccounts:{ context:{slot:12},value:[{ executable:true },mintAccount()] }, getProgramAccounts:{ context:{slot:13},value:[] },...overrides };
    return Response.json({ jsonrpc:'2.0',id:1,result:values[method] });
  }));
}
async function request(path: string,settings: Env = {}, method = 'GET') {
  return worker.fetch(new Request(`https://dominion.example${path}`,{method}),settings,ctx);
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Worker API fail-closed configuration',() => {
  it('defaults to an explicit demo with trading disabled and no on-chain addresses',async () => {
    const response = await request('/api/config');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({mode:'demo',tradingEnabled:false,quoteMint:null,programId:null});
  });
  it('does not reveal the private RPC endpoint and resolves real mint decimals',async () => {
    rpcMock();
    const response = await request('/api/config',env);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain('hidden-secret');
    expect(JSON.parse(text)).toMatchObject({quoteDecimals:9,tradingEnabled:true,rpcUrl:'https://api.devnet.solana.com/'});
  });
  it('rejects a mismatched network instead of silently falling back to demo',async () => {
    rpcMock({getGenesisHash:'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'});
    const response = await request('/api/territories',env);
    expect(response.status).toBe(503);
    expect(await response.text()).toContain('réseau RPC');
  });
  it('rejects a missing executable program',async () => {
    rpcMock({getMultipleAccounts:{context:{slot:12},value:[null,mintAccount()]}});
    const response = await request('/api/config',env);
    expect(response.status).toBe(503);
    expect(await response.text()).toContain('pas encore déployé');
  });
  it('rejects a freezable quote mint',async () => {
    rpcMock({getMultipleAccounts:{context:{slot:12},value:[{executable:true},mintAccount(6,true)]}});
    const response = await request('/api/config',env);
    expect(response.status).toBe(503);
    expect(await response.text()).toContain('autorité de gel');
  });
  it('requires a second explicit mainnet acknowledgement for writes',() => {
    expect(baseConfig({...env,PLATFORM_MODE:'mainnet-beta'}).tradingEnabled).toBe(false);
    expect(baseConfig({...env,PLATFORM_MODE:'mainnet-beta',MAINNET_ACK:'AUDITED_AND_APPROVED'}).tradingEnabled).toBe(true);
  });
  it('rejects malformed configuration and insecure public RPC URLs',async () => {
    expect((await request('/api/config',{PLATFORM_MODE:'unknown'})).status).toBe(503);
    expect((await request('/api/config',{...env,PUBLIC_SOLANA_RPC_URL:'http://example.com'})).status).toBe(503);
  });
});

describe('read-only world API',() => {
  it('returns empty chain state honestly when no tokens exist',async () => {
    rpcMock();
    const response = await request('/api/territories',env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({source:'chain',slot:13,tokens:[]});
  });
  it('rejects oversized worlds instead of dropping tokens from the denominator',async () => {
    rpcMock({getProgramAccounts:{context:{slot:13},value:Array.from({length:251},()=>({}))}});
    const response = await request('/api/territories',env);
    expect(response.status).toBe(503);
    expect(await response.text()).toContain('250 marchés');
  });
  it('does not expose a transaction relay, arbitrary RPC proxy or mutation endpoint',async () => {
    expect((await request('/api/rpc')).status).toBe(404);
    const response = await request('/api/territories',{},'POST');
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
  });
  it('adds security headers to success and error responses; HEAD has no body',async () => {
    for (const path of ['/api/config','/api/absent']) {
      const response = await request(path);
      expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    }
    expect(await (await request('/api/health',{},'HEAD')).text()).toBe('');
  });
  it('strips provider errors containing credentials from client responses',async () => {
    vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new Error('https://private.example/?key=hidden-secret')));
    const response = await request('/api/config',env);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('hidden-secret');
  });
});


describe('on-chain reserve snapshots',() => {
  function fixture(currentSupply = 1_000_000_000n) {
    const mint = Keypair.generate().publicKey;
    const [pool,bump] = PublicKey.findProgramAddressSync([Buffer.from('pool'),mint.toBuffer()],program);
    const baseVault = getAssociatedTokenAddressSync(mint,pool,true);
    const quoteVault = getAssociatedTokenAddressSync(quote,pool,true);
    const data = Buffer.alloc(235); let offset = 0;
    Buffer.from([241,154,109,4,17,177,109,188]).copy(data,offset); offset += 8;
    for (const key of [Keypair.generate().publicKey,mint,quote,baseVault,quoteVault]) { key.toBuffer().copy(data,offset); offset += 32; }
    data.writeBigUInt64LE(1_000_000_000n,offset); offset += 8;
    data.writeBigInt64LE(1_700_000_000n,offset); offset += 8; data[offset++] = bump;
    for (const value of ['Example','EX']) { const bytes = Buffer.from(value); data.writeUInt32LE(bytes.length,offset); offset += 4; bytes.copy(data,offset); offset += bytes.length; }
    const raw = (bytes: Buffer,owner = TOKEN_PROGRAM_ID) => ({data:[bytes.toString('base64'),'base64'],owner:owner.toBase58(),executable:false,lamports:1});
    const mintBytes = Buffer.alloc(MintLayout.span);
    MintLayout.encode({mintAuthorityOption:0,mintAuthority:PublicKey.default,supply:currentSupply,decimals:6,isInitialized:true,freezeAuthorityOption:0,freezeAuthority:PublicKey.default},mintBytes);
    const vaultBytes = (tokenMint: PublicKey,amount: bigint) => {
      const bytes = Buffer.alloc(AccountLayout.span);
      AccountLayout.encode({mint:tokenMint,owner:pool,amount,delegateOption:0,delegate:PublicKey.default,state:1,isNativeOption:0,isNative:0n,delegatedAmount:0n,closeAuthorityOption:0,closeAuthority:PublicKey.default},bytes);
      return bytes;
    };
    return { pool:{pubkey:pool.toBase58(),account:raw(data,program)},accounts:[raw(mintBytes),raw(vaultBytes(mint,500_000_000n)),raw(vaultBytes(quote,200_000_000n))] };
  }
  it('derives circulation from current mint supply, including burned tokens',async () => {
    const data = fixture(900_000_000n);
    rpcMock({getProgramAccounts:{context:{slot:13},value:[data.pool]},getMultipleAccounts:{context:{slot:14},value:data.accounts}});
    const snapshot = await readSnapshot(env,baseConfig(env));
    expect(snapshot.tokens).toHaveLength(1);
    expect(snapshot.tokens[0].price).toBeCloseTo(0.4);
    expect(snapshot.tokens[0].marketCap).toBeCloseTo(160);
    expect(snapshot.tokens[0].supply).toBe('900000000');
    expect(snapshot.slot).toBe(14);
  });
  it('rejects an account at a non-canonical pool address',async () => {
    const data = fixture(); data.pool.pubkey = Keypair.generate().publicKey.toBase58();
    rpcMock({getProgramAccounts:{context:{slot:13},value:[data.pool]}});
    await expect(readSnapshot(env,baseConfig(env))).rejects.toThrow('Adresses du marché');
  });
  it('rejects reserves that exceed the live supply instead of displaying negative territory',async () => {
    const data = fixture(400_000_000n);
    rpcMock({getProgramAccounts:{context:{slot:13},value:[data.pool]},getMultipleAccounts:{context:{slot:14},value:data.accounts}});
    await expect(readSnapshot(env,baseConfig(env))).rejects.toThrow('Réserves du marché');
  });
});
