import {describe,it,expect} from 'vitest';
import {parseUnits,formatUnits,calculateOutput,minimumOutput,U64_MAX} from '../src/lib/math';
import {layoutTerritories} from '../src/lib/territories';
import {initialDemo} from '../src/lib/demo';
describe('monetary arithmetic',()=>{
 it('parses exact amounts without floats',()=>{expect(parseUnits('9007199254.740993',6)).toBe(9007199254740993n);expect(formatUnits(1234500n,6)).toBe('1.2345');expect(()=>parseUnits('1e6',6)).toThrow();expect(()=>parseUnits('0.0000001',6)).toThrow();expect(()=>parseUnits('-1',6)).toThrow();});
 it('rejects overflow and zero protection',()=>{expect(()=>calculateOutput('1',U64_MAX,'100')).toThrow();expect(()=>minimumOutput(1n,100)).toThrow();expect(()=>minimumOutput(100n,10000)).toThrow();});
 it('constant product cannot decrease and roundtrips never gain',()=>{for(let i=1n;i<100n;i++){const x=i*123456n,y=i*763542n,a=i*71n,out=calculateOutput(a,x,y);expect((x+a)*(y-out)>=x*y).toBe(true);const back=calculateOutput(out,y-out,x+a);expect(back<=a).toBe(true);}});
});
describe('territory partition',()=>{
 it.each([[1200,700],[320,600],[1,1]])('fills %s by %s exactly and respects proportions',(w,h)=>{const tokens=initialDemo().tokens,total=tokens.reduce((s,t)=>s+t.marketCap,0),rects=layoutTerritories(tokens,w,h);expect(rects.reduce((s,r)=>s+r.width*r.height,0)).toBeCloseTo(w*h,6);for(const r of rects){expect(r.width*r.height/(w*h)).toBeCloseTo(r.token.marketCap/total,12);expect(r.x).toBeGreaterThanOrEqual(0);expect(r.x+r.width).toBeLessThanOrEqual(w+1e-8);for(const other of rects){if(r===other)continue;const overlap=Math.max(0,Math.min(r.x+r.width,other.x+other.width)-Math.max(r.x,other.x))*Math.max(0,Math.min(r.y+r.height,other.y+other.height)-Math.max(r.y,other.y));expect(overlap).toBeCloseTo(0,8);}}});
 it('zero caps do not receive invented territory',()=>{expect(layoutTerritories(initialDemo().tokens.map(t=>({...t,marketCap:0})),100,100)).toEqual([]);});
});
