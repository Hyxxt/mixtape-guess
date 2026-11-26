import {DatabaseSync} from "node:sqlite";
import {readdirSync,readFileSync} from "node:fs";
export function localDb(file) {
  const db=new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS local_migrations(name TEXT PRIMARY KEY)");
  const folder=new URL("../drizzle/",import.meta.url);
  for(const name of readdirSync(folder).filter(n=>n.endsWith(".sql")).sort()){
    if(db.prepare("SELECT name FROM local_migrations WHERE name=?").get(name))continue;
    db.exec("BEGIN");
    try{db.exec(readFileSync(new URL(name,folder),"utf8"));db.prepare("INSERT INTO local_migrations VALUES(?)").run(name);db.exec("COMMIT");}
    catch(e){db.exec("ROLLBACK");throw e;}
  }
  function statement(sql,values=[]){
    const prepared=db.prepare(sql);
    return {bind:(...args)=>statement(sql,args),first:()=>prepared.get(...values)||null,
      all:()=>({results:prepared.all(...values)}),run:()=>({meta:{changes:prepared.run(...values).changes}})};
  }
  return {prepare:statement,batch(queries){db.exec("BEGIN");try{const results=queries.map(q=>q.run());db.exec("COMMIT");return results;}catch(e){db.exec("ROLLBACK");throw e;}}};
}
