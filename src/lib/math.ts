export const U64_MAX = (1n << 64n) - 1n;
export function parseUnits(value:string,decimals:number):bigint {
  if (!Number.isInteger(decimals)||decimals<0||decimals>18||!/^\d+(\.\d+)?$/.test(value)) throw new Error('Montant invalide.');
  const [whole,fraction='']=value.split('.');
  if(fraction.length>decimals) throw new Error(`Maximum ${decimals} décimales.`);
  const result=BigInt(whole)*10n**BigInt(decimals)+BigInt(fraction.padEnd(decimals,'0')||'0');
  if(result>U64_MAX) throw new Error('Montant trop élevé.');
  return result;
}
export function formatUnits(value:bigint|string,decimals:number):string {
 const n=BigInt(value), unit=10n**BigInt(decimals); const fraction=(n%unit).toString().padStart(decimals,'0').replace(/0+$/,'');
 return `${n/unit}${fraction?'.'+fraction:''}`;
}
export function calculateOutput(amount:string|bigint,reserveIn:string|bigint,reserveOut:string|bigint):bigint {
 const a=BigInt(amount),x=BigInt(reserveIn),y=BigInt(reserveOut);
 if(a<=0n||x<=0n||y<=0n||a>U64_MAX||x+a>U64_MAX) throw new Error('Montant ou réserves invalides.');
 return a*y/(x+a);
}
export function minimumOutput(output:bigint,bps:number):bigint {
 if(!Number.isInteger(bps)||bps<1||bps>500) throw new Error('Le glissement doit être compris entre 0,01 % et 5 %.');
 const min=output*BigInt(10000-bps)/10000n;
 if(min<=0n) throw new Error('Montant trop faible pour un échange protégé.');
 return min;
}
