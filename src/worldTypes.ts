export interface World {
 id:string; name:string; theme:string; week:number; status:'open'|'pending';
 quoteMint:string|null; createdAt:string;
}
export interface WorldCatalog {worlds:World[];activeWorldId:string;governanceMint:string}
