import { PublicKey } from '@solana/web3.js';
import { PublicError,database,type RegisteredLaunch,type Env,type Context } from './types';
import { settings,resolveConfig,recordConfiguration } from './settings';
import { readSnapshot } from './market';
import {readWallet} from './wallet';
import { registerLaunch,validateSignature } from './launches';
import { registerCurveConfig } from './curves';
export type { Env } from './types';
export { resolveConfig,readSnapshot };

function json(value: unknown,status = 200): Response {return Response.json(value,{status,headers:{'Cache-Control':'no-store'}});}
function securityHeaders(env: Env): Headers {
  let rpcOrigin = 'https://api.mainnet-beta.solana.com';try {rpcOrigin = new URL(settings(env).publicRpc).origin;} catch { /* Invalid settings fail closed at the API. */ }
  return new Headers({'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'strict-origin-when-cross-origin','Permissions-Policy':'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy':`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' ${rpcOrigin} ${rpcOrigin.replace('https:','wss:')}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`});
}
function cacheKey(origin: string,path: string,env: Env): Request {
  const cfg = settings(env),url = new URL(origin + path);
  url.searchParams.set('schema','registry-dbc-3');
  url.searchParams.set('config',JSON.stringify([cfg.cluster,cfg.paymentMint,cfg.treasury,cfg.publicRpc,env.CREATION_ENABLED === 'true',cfg.launch]));
  return new Request(url.toString());
}
async function signatureBody(request: Request): Promise<string> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new PublicError('Un corps JSON est requis.',415,'INVALID_CONTENT_TYPE');
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) throw new PublicError('Origine non autorisée.',403,'INVALID_ORIGIN');
  const reader = request.body?.getReader();if (!reader) throw new PublicError('Signature manquante.',400,'INVALID_BODY');
  let size = 0;const chunks: Uint8Array[] = [];
  try {for (;;) {const {done,value} = await reader.read();if (done) break;size += value.byteLength;if (size > 5_120) {await reader.cancel();throw new PublicError('Requête trop volumineuse.',413,'BODY_TOO_LARGE');}chunks.push(value);}} finally {reader.releaseLock();}
  const data = new Uint8Array(size);let offset = 0;for (const chunk of chunks) {data.set(chunk,offset);offset += chunk.byteLength;}
  let body: unknown;try {body = JSON.parse(new TextDecoder().decode(data));} catch {throw new PublicError('JSON non valide.',400,'INVALID_BODY');}
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !('signature' in body)) throw new PublicError('La requête accepte uniquement une signature de transaction.',400,'INVALID_BODY');
  return validateSignature(body.signature);
}
export default {
  async fetch(request: Request,env: Env,ctx: Context): Promise<Response> {
    const url = new URL(request.url),security = securityHeaders(env);
    const cache = typeof caches !== 'undefined' ? (caches as CacheStorage & {default?:Cache}).default : undefined;
    let response: Response;
    try {
      if (url.pathname === '/api/curve-config' && request.method === 'POST') {
        const signature = await signatureBody(request),registered = await registerCurveConfig(env,signature);
        response = json(registered,registered.created ? 201 : 200);
        if (cache) ctx.waitUntil(Promise.all(['/api/state','/api/config','/api/territories'].map(path => cache.delete(cacheKey(url.origin,path,env)))));
      } else if (url.pathname === '/api/launches' && request.method === 'POST') {
        const signature = await signatureBody(request),registered = await registerLaunch(env,signature);
        response = json(registered,registered.created ? 201 : 200);
        if (cache) ctx.waitUntil(Promise.all(['/api/state','/api/territories'].map(path => cache.delete(cacheKey(url.origin,path,env)))));
      } else if (!['GET','HEAD'].includes(request.method)) response = json({error:'Méthode non autorisée.',code:'METHOD_NOT_ALLOWED'},405);
      else if (url.pathname === '/api/health') response = json({status:'ok',service:'solana-dominion',architecture:'meteora-dbc',version:'0.3.1'});
      else if (url.pathname === '/api/wallet') {
        if(url.searchParams.getAll('owner').length!==1||[...url.searchParams.keys()].some(key=>key!=='owner'))throw new PublicError('Un propriétaire de wallet est requis.',400,'INVALID_OWNER');
        response=json(await readWallet(env,url.searchParams.get('owner')!));
        response.headers.set('Cache-Control','private, no-store');
      }
      else if (url.pathname.startsWith('/api/metadata/')) {
        let mint: string;try {mint = new PublicKey(url.pathname.slice('/api/metadata/'.length)).toBase58();} catch {throw new PublicError('Adresse de token non valide.',400,'INVALID_MINT');}
        const row = await database(env).prepare('SELECT * FROM launches WHERE cluster = ? AND mint = ?').bind(settings(env).cluster,mint).first<RegisteredLaunch>();
        response = row ? json({name:row.name,symbol:row.symbol,description:'Token créé sur Dominion, plateforme de territoires Solana.',external_url:`${url.origin}/?mint=${mint}`}) : json({error:'Ce token n’est pas encore enregistré.',code:'NOT_FOUND'},404);
      } else if (['/api/state','/api/config','/api/territories'].includes(url.pathname)) {
        const key = cacheKey(url.origin,url.pathname,env),hit = await cache?.match(key);
        if (hit) response = hit;
        else {
          const config = await resolveConfig(env);
          // Persist signed-payment settings before exposing the version to a wallet.
          await recordConfiguration(env,config);
          if (url.pathname === '/api/config') response = json(config);
          else {const snapshot = await readSnapshot(env,config);response = json(url.pathname === '/api/state' ? {config,snapshot} : snapshot);}
          if (cache) {const cached = response.clone();cached.headers.set('Cache-Control','public, max-age=15');ctx.waitUntil(cache.put(key,cached));}
        }
      } else if (url.pathname.startsWith('/api/')) response = json({error:'Route inconnue.',code:'NOT_FOUND'},404);
      else response = env.ASSETS ? await env.ASSETS.fetch(request) : new Response('Not found',{status:404});
    } catch (error) {
      console.error(JSON.stringify({event:'request_failed',path:url.pathname,type:error instanceof PublicError ? error.code : 'INTERNAL_ERROR'}));
      response = json({error:error instanceof PublicError ? error.message : 'Impossible de vérifier les données. Réessayez sans envoyer de nouvelle transaction.',code:error instanceof PublicError ? error.code : 'SERVICE_UNAVAILABLE'},error instanceof PublicError ? error.status : 503);
      if (error instanceof PublicError && error.code === 'TRANSACTION_PENDING') response.headers.set('Retry-After','4');
    }
    const headers = new Headers(response.headers);security.forEach((value,key) => headers.set(key,value));
    if (url.pathname.startsWith('/api/')) headers.set('Cache-Control',url.pathname==='/api/wallet'?'private, no-store':'no-store');
    if (response.status === 405) headers.set('Allow',['/api/launches','/api/curve-config'].includes(url.pathname) ? 'POST' : 'GET, HEAD');
    return new Response(request.method === 'HEAD' ? null : response.body,{status:response.status,headers});
  },
};
