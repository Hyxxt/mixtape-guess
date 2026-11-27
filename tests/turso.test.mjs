import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {tursoDb} from "../scripts/turso-db.mjs";

test("turso adapter migrates and supports batch writes",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"quiz-turso-"));
  const file=join(dir,"quiz.db").replaceAll("\\","/");
  let db;
  try {
    db=await tursoDb({url:"file:"+file});
    await db.prepare("INSERT INTO players(id,nickname,created) VALUES(?,?,?)")
      .bind("p1","Tester",Date.now()).run();
    const player=await db.prepare("SELECT nickname FROM players WHERE id=?").bind("p1").first();
    assert.equal(player.nickname,"Tester");
    const results=await db.batch([
      db.prepare("INSERT INTO best(owner,score,hits,achieved) VALUES(?,?,?,?)")
        .bind("p1",10,1,Date.now()),
      db.prepare("UPDATE players SET nickname=? WHERE id=?").bind("Updated","p1")
    ]);
    assert.equal(results[0].meta.changes,1);
    assert.equal(results[1].meta.changes,1);
    const best=await db.prepare("SELECT score FROM best WHERE owner=?").bind("p1").first();
    assert.equal(best.score,10);
  } finally {
    try {db?.close();} catch {}
    try {rmSync(dir,{recursive:true,force:true});} catch {}
  }
});
