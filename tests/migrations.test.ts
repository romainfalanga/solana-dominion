import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {describe,it,expect} from 'vitest';

describe('additive multiworld migrations on real SQLite',()=>{
 it('preserves existing launches and enforces unique world and ballot identities',()=>{
  const db=new DatabaseSync(':memory:');
  try{
   for(const file of ['0001_registry.sql','0002_curves.sql'])db.exec(readFileSync(`migrations/${file}`,'utf8'));
   db.exec("INSERT INTO configurations(version,cluster,payment_mint,payment_program,fee_atomic,treasury,quote_decimals) VALUES('legacy','mainnet-beta','old-quote','spl','0','owner',6)");
   db.exec("INSERT INTO launches(cluster,mint,signature,creator,name,symbol,payment_mint,payment_program,fee_atomic,treasury,config_version,created_at,slot) VALUES('mainnet-beta','old-mint','old-signature','owner','Legacy','OLD','old-quote','spl','0','owner','legacy',1,1)");
   const before=db.prepare('SELECT * FROM launches').all();
   const migrations=readdirSync('migrations').filter(f=>/^000[3-9].*\.sql$/.test(f)).sort();
   for(let pass=0;pass<2;pass++)for(const file of migrations)db.exec(readFileSync(`migrations/${file}`,'utf8'));
   expect(db.prepare('SELECT * FROM launches').all()).toEqual(before);
   const world=db.prepare('INSERT INTO world_registry(cluster,id,quote_mint,week,created_at) VALUES(?,?,?,?,?)');
   world.run('mainnet-beta','origin','quote-a',0,'2026-11-17');
   expect(()=>world.run('mainnet-beta','other','quote-a',1,'2026-11-18')).toThrow();
   expect(()=>world.run('mainnet-beta','other','quote-b',0,'2026-11-18')).toThrow();
   world.run('mainnet-beta','gta6','quote-b',1,'2026-11-18');
   const vote=db.prepare('INSERT INTO governance_votes(round_id,rules_hash,snapshot_hash,owner,candidate_id,weight_atomic,signature,created_at) VALUES(?,?,?,?,?,?,?,?)');
   vote.run('week-1','rules','snapshot','wallet','gta6','9007199254740993','signed','now');
   expect(()=>vote.run('week-1','rules','snapshot','wallet','space','9007199254740993','signed2','now')).toThrow();
   expect(db.prepare('SELECT weight_atomic FROM governance_votes').get()?.weight_atomic).toBe('9007199254740993');
  }finally{db.close();}
 });
});
