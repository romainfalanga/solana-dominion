import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const A='sr1GJKY7LWggyQebWWE4BhoyMkC9Wwd3BCRcxchcY8d',B='11111111111111111111111111111111';
const asset=(mint,symbol,amount,price,value,color)=>({mint,name:symbol,symbol,amount,decimals:6,priceUsd:price,valueUsd:value,color,isNative:mint==='native:sol'});
const aAssets=[asset('native:sol','SOL','3',100,300,'#ad93e8'),asset('usd-token','USDC','100',1,100,'#60c2b1'),asset('unknown-token','UNKNOWN','0.00000001',null,null,'#ee9879')];
const snapshot=(owner,assets)=>({owner,assets,totalUsd:assets.reduce((s,a)=>s+(a.valueUsd??0),0),unpricedCount:assets.filter(a=>a.valueUsd===null).length,slot:123,updatedAt:new Date().toISOString(),currency:'USD'});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox']});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(({A})=>{const listeners={};const key=a=>({toBase58:()=>a});window.__changeWallet=a=>{window.phantom.solana.publicKey=key(a);for(const fn of listeners.accountChanged??[])fn(key(a));};window.phantom={solana:{isPhantom:true,publicKey:key(A),connect:async()=>({publicKey:key(A)}),disconnect:async()=>{for(const fn of listeners.disconnect??[])fn();},on:(event,fn)=>(listeners[event]??=[]).push(fn),removeListener:(event,fn)=>{listeners[event]=(listeners[event]??[]).filter(f=>f!==fn);}}};},{A});
 await page.route('**/api/state',r=>r.fulfill({status:503,json:{error:'World unavailable for this isolated wallet test'}}));
 let delayA=false,mode='normal',reads=0;
 await page.route('**/api/wallet?*',async r=>{reads++;const owner=new URL(r.request().url()).searchParams.get('owner');if(owner===A&&delayA)await new Promise(resolve=>setTimeout(resolve,800));try{if(mode==='error')await r.fulfill({status:503,json:{error:'RPC indisponible pour le test'}});else await r.fulfill({json:snapshot(owner,mode==='empty'?[]:mode==='unknown'?[aAssets[2]]:owner===A?aAssets:[asset('second-token','SECOND','5',10,50,'#d9ba68')])});}catch{/* Owner-switch aborts an obsolete request. */}});
 await page.goto(process.env.DOMINION_URL||'http://127.0.0.1:4173');await page.getByRole('button',{name:'Wallet',exact:true}).click();
 await page.locator('.wallet-connect-state').waitFor();assert.equal(reads,0);assert(!await page.getByText('World unavailable for this isolated wallet test').count());
 await page.locator('.wallet-connect-state').getByRole('button',{name:'Connecter Phantom'}).click();await page.locator('.wallet-map .territory').first().waitFor();
 assert.equal(await page.locator('.wallet-map .territory').count(),2);assert.equal(await page.locator('.wallet-assets-table tbody tr').count(),3);
 const boxes=await page.locator('.wallet-map .territory').evaluateAll(es=>es.map(e=>({symbol:e.textContent,area:parseFloat(e.style.width)*parseFloat(e.style.height)})));
 const total=boxes.reduce((s,b)=>s+b.area,0);assert(Math.abs(boxes.find(b=>b.symbol.includes('SOL')).area/total-.75)<1e-8);
 assert.match(await page.locator('.wallet-stats').innerText(),/Valeur connue/);
 await page.getByRole('textbox',{name:'Rechercher un actif du wallet'}).fill('USDC');assert.equal(await page.locator('.wallet-map .territory').count(),2);assert.equal(await page.locator('.wallet-assets-table tbody tr').count(),1);await page.getByRole('textbox',{name:'Rechercher un actif du wallet'}).fill('');
 await page.screenshot({path:'/tmp/dominion-wallet-desktop.png',fullPage:true});
 for(const width of [390,320]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
 await page.screenshot({path:'/tmp/dominion-wallet-mobile.png',fullPage:true});
 delayA=true;await page.locator('.wallet-refresh').click();await page.evaluate(B=>window.__changeWallet(B),B);await page.getByText('SECOND',{exact:true}).first().waitFor();await page.waitForTimeout(950);assert.equal(await page.getByText('UNKNOWN',{exact:true}).count(),0);assert.equal(await page.locator('.wallet-map .territory').count(),1);
 mode='empty';await page.locator('.wallet-refresh').click();await page.getByRole('heading',{name:'Ce wallet est vide.'}).waitFor();
 mode='unknown';await page.locator('.wallet-refresh').click();await page.getByRole('heading',{name:'Aucun territoire valorisé.'}).waitFor();assert.equal(await page.locator('.wallet-map .territory').count(),0);
 mode='error';await page.locator('.wallet-refresh').click();await page.locator('.wallet-error').waitFor();assert.match(await page.locator('.wallet-error').innerText(),/RPC indisponible/);
 await page.locator('.wallet-button').click();await page.locator('.wallet-connect-state').waitFor();assert.equal(await page.locator('.wallet-assets-table').count(),0);assert.deepEqual(errors,[]);
 console.log('PASS Wallet production UI with explicit API and Phantom fixtures: 75/25 area, unknown prices, no world dependency, search denominator, mobile, owner race, empty, error, disconnect. No real wallet or transaction used.');
}finally{await browser.close();}
