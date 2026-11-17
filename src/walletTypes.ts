export interface WalletAsset {
 mint:string; name:string; symbol:string; color:string; amount:string; decimals:number;
 priceUsd:number|null; valueUsd:number|null; isNative:boolean;
}
export interface WalletSnapshot {
 owner:string; assets:WalletAsset[]; totalUsd:number; unpricedCount:number;
 updatedAt:string; slot:number; currency:'USD';
}
