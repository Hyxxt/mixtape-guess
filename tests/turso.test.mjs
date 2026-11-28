import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {tursoDb} from "../scripts/turso-db.mjs";

test("turso adapter preserves old scores while migrating and writing new scores",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"quiz-turso-"));
  const file=join(dir,"quiz.db").replaceAll("\\","/");
  let db;
  try {
    const previous=new DatabaseSync(file);
    try {
      previous.exec(readFileSync(new URL("../drizzle/0000_bouncy_morlocks.sql",import.meta.url),"utf8"));
      previous.exec(`CREATE TABLE _app_migrations(name TEXT PRIMARY KEY);
        INSERT INTO _app_migrations VALUES('0000_bouncy_morlocks.sql');
        INSERT INTO players VALUES('old','Past player',0);
        INSERT INTO best VALUES('old',85,10,0);
        INSERT INTO games VALUES('open','old','[]',0,0,0,0,0,0);
        CREATE TABLE visits(id TEXT PRIMARY KEY, at INTEGER NOT NULL, did TEXT NOT NULL, path TEXT NOT NULL, fresh INTEGER NOT NULL);
        INSERT INTO visits VALUES('v',0,'device','home',1);`);
    } finally { previous.close(); }
    db=await tursoDb({url:"file:"+file});
    assert.equal((await db.prepare("SELECT scoring_version FROM games WHERE id='open'").first()).scoring_version,1);
    assert.equal((await db.prepare("SELECT score FROM best WHERE owner='old'").first()).score,85);
    assert.equal((await db.prepare("SELECT fresh FROM visits WHERE id='v'").first()).fresh,1);
    await db.prepare("INSERT INTO players(id,nickname,created) VALUES(?,?,?)")
      .bind("p1","Tester",Date.now()).run();
    const player=await db.prepare("SELECT nickname FROM players WHERE id=?").bind("p1").first();
    assert.equal(player.nickname,"Tester");
    const results=await db.batch([
      db.prepare("INSERT INTO points_best(owner,score,hits,achieved) VALUES(?,?,?,?)")
        .bind("p1",10,1,Date.now()),
      db.prepare("UPDATE players SET nickname=? WHERE id=?").bind("Updated","p1")
    ]);
    assert.equal(results[0].meta.changes,1);
    assert.equal(results[1].meta.changes,1);
    const best=await db.prepare("SELECT score FROM points_best WHERE owner=?").bind("p1").first();
    assert.equal(best.score,10);
  } finally {
    try {db?.close();} catch {}
    try {rmSync(dir,{recursive:true,force:true});} catch {}
  }
});
