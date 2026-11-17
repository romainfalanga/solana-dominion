import type {PlatformConfig,Token,Snapshot} from '../types';
export const demoConfig:PlatformConfig={mode:'demo',creationFeeAtomic:'1000000',treasury:'sr1GJKY7LWggyQebWWE4BhoyMkC9Wwd3BCRcxchcY8d',configVersion:'demo-v1',creationEnabled:true,quoteMint:null,quoteSymbol:'DOM',quoteDecimals:6,quoteTokenProgram:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',programId:null,rpcUrl:'https://api.devnet.solana.com',tradingEnabled:false,worldName:'Le monde de démonstration'};
export const palette=['#a99ef5','#55c9be','#eaa17b','#7aa9e9','#dfc164','#da88ab','#9bbd8c','#7bc3dc'];
export function revalue(token:Token):Token {
 const x=Number(token.baseReserve)/10**token.decimals,y=Number(token.quoteReserve)/10**token.quoteDecimals;
 const circulating=Math.max(0,(Number(token.supply)-Number(token.baseReserve))/10**token.decimals);
 const price=x>0?y/x:0; return {...token,price,marketCap:price*circulating};
}
export function initialDemo():Snapshot {
 const names=[['Nebula','NEB'],['Coral','CORAL'],['Ronin','RON'],['Orbit','ORB'],['Mango','MNG'],['Pixel','PXL'],['Moss','MOSS'],['Tide','TIDE']];
 const caps=[420000,260000,180000,125000,90000,65000,45000,30000];
 return {source:'demo',slot:null,updatedAt:new Date().toISOString(),tokens:names.map(([name,symbol],i)=>revalue({name,symbol,mint:`demo-${symbol}`,pool:`pool-${symbol}`,color:palette[i],creator:'Simulation',supply:'1000000000000000',baseReserve:'500000000000000',quoteReserve:String(caps[i]*1000000),decimals:6,quoteDecimals:6,marketCap:0,price:0,change24h:null,createdAt:1700000000+i}))};
}
