import {hierarchy,treemap,treemapSquarify} from 'd3-hierarchy';
import type {Token} from '../types';
export function layoutTerritories(tokens:Token[],width:number,height:number) {
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0) return [];
 const positive=tokens.filter(t=>Number.isFinite(t.marketCap)&&t.marketCap>0);
 if(!positive.length) return [];
 const max=Math.max(...positive.map(t=>t.marketCap));
 const root=hierarchy<{token?:Token;children?:{token:Token}[]}>({children:positive.map(token=>({token}))}).sum(d=>d.token?d.token.marketCap/max:0).sort((a,b)=>(b.value??0)-(a.value??0)||((a.data.token?.mint??'').localeCompare(b.data.token?.mint??'')));
 return treemap<{token?:Token}>().tile(treemapSquarify).size([width,height]).padding(0).round(false)(root).leaves().map(n=>({token:n.data.token!,x:n.x0,y:n.y0,width:n.x1-n.x0,height:n.y1-n.y0}));
}
