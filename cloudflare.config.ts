import {defineConfig,bindings} from 'cf/config';
export default defineConfig({
 accountId:'834ee251038ce2f923cba9847f973c40',
 worker:{
  name:'solana-dominion',previewUrls:false,entrypoint:'./server/index.ts',compatibilityDate:'2026-11-17',compatibilityFlags:['nodejs_compat'],
  assets:{notFoundHandling:'single-page-application',runWorkerFirst:['/api/*']},
  env:{PUBLIC_SOLANA_RPC_URL:bindings.text('https://solana-rpc.publicnode.com'),CREATION_ENABLED:bindings.text('true'),DB:bindings.d1({id:'011a776a-18ac-4325-8783-cf473dfb09cd',name:'solana-dominion-registry'})},
  observability:{enabled:true,headSamplingRate:0.1,traces:{enabled:true,headSamplingRate:0.1}},
 }
});
