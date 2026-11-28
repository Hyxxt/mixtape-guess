import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createApi,earnedPoints} from "../server/api.mjs";
import {localDb} from "../scripts/local-db.mjs";
test("ranked scores drop after one second and earlier five-second rounds keep their rules",()=>{
  for(let second=1;second<=10;second++){
    const points=11-second;
    assert.equal(earnedPoints(second*1000,true),points);
    assert.equal(earnedPoints((second-1)*1000+1,true),points);
    assert.equal(earnedPoints(second*1000,true,2),10-Math.max(0,second-5));
  }
  assert.equal(earnedPoints(-1,true),0);
  assert.equal(earnedPoints(0,true),10);
  assert.equal(earnedPoints(10001,true),0);
  assert.equal(earnedPoints(0,false),0);
});
test("two guests see the same persisted rankings, with replay-safe answers and personal bests",async()=>{
  const DB=localDb(":memory:");
  const api=createApi(Array.from({length:15},(_,i)=>({name:"Song "+i,id:i+1,offset:3})));
  const origin="https://quiz.example";
  const originalTime=Date.now;
  const weekEnd=Date.parse("2026-11-29T16:00:00Z");
  let now=weekEnd-300000;
  Date.now=()=>now;
  async function send(route,body,cookie=""){
    const response=await api(new Request(origin+"/api/"+route,{method:body?"POST":"GET",headers:{Origin:origin,Cookie:cookie,"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined}),{DB});
    return {status:response.status,data:await response.json(),cookie:response.headers.get("Set-Cookie")?.split(";")[0]};
  }
  async function play(cookie,ms,version=1,msToNextPoint){
    let q=(await send("round",{},cookie)).data;
    const round=q.round; const picks=new Set();let outcome;
    assert.equal(q.scoringVersion,1);
    if(version===2){
      DB.prepare("UPDATE games SET scoring_version=2 WHERE id=?").bind(round).run();
      q=(await send("round",{},cookie)).data;
    }
    for(let index=0;index<10;index++){
      const payload={round,index};
      if(index>0)q=(await send("next",payload,cookie)).data;
      assert.equal(q.index,index);assert.ok(q.choices.every(v=>v===null));
      assert.equal(q.scoringVersion,version);
      assert.equal(q.score,outcome?.score??0);
      assert.equal(q.correct,outcome?.correct??0);
      if(index>0) assert.deepEqual(q,outcome.next);
      const start=(await send("start",payload,cookie)).data;
      if(index<9){
        assert.equal(start.next.index,index+1);
        assert.ok(start.next.choices.every(value=>value===null));
        assert.equal(start.next.score,undefined);
        assert.equal(start.next.correct,undefined);
        assert.equal((await send("start",{round,index:index+1},cookie)).status,409);
        assert.equal((await send("answer",{round,index:index+1,choice:0},cookie)).status,409);
      }else assert.equal(start.next,null);
      assert.equal((await send("start",payload,cookie)).data.startAt,start.startAt);
      assert.equal((await send("answer",{...payload,choice:0},cookie)).status,400);
      const secret=JSON.parse(DB.prepare("SELECT questions FROM games WHERE id=?").bind(round).first().questions)[index];
      picks.add(secret.name);
      now=start.startAt+ms;
      const choice=start.choices.indexOf(secret.name);
      const response=await send("answer",{...payload,choice},cookie);
      assert.equal(response.status,200);
      outcome=response.data;
      assert.deepEqual((await send("answer",{...payload,choice:-1},cookie)).data,outcome);
      assert.equal(outcome.done,index===9);
      if(index<9){
        assert.equal(outcome.next.score,outcome.score);
        assert.equal(outcome.next.correct,outcome.correct);
        assert.equal(outcome.next.previewPath,start.next.previewPath);
        if(index===0) assert.deepEqual((await send("round",{},cookie)).data,outcome.next);
      }else{
        assert.equal(outcome.next,null);
        assert.equal(outcome.details.length,10);
        assert.equal(outcome.details.reduce((sum,answer)=>sum+answer.earned,0),outcome.score);
        assert.deepEqual(outcome.details[index],{
          name:secret.name,trackId:secret.id,offset:secret.offset,earned:outcome.earned,
          elapsedMs:ms,selected:secret.name,outcome:ms>10000?"timeout":"correct",
          ...(msToNextPoint===undefined ? {} : {msToNextPoint})
        });
      }
    }
    assert.equal(picks.size,10);
    return outcome.score;
  }
  try {
    const a=(await send("join",{nickname:"A"})).cookie;
    const b=(await send("join",{nickname:"B"})).cookie;
    assert.notEqual(a,b);
    assert.equal(await play(a,950),100);
    assert.equal(await play(b,1260,1,260),90);
    assert.equal(await play(a,11000),0);
    let board=(await send("board",null,b)).data;
    assert.deepEqual(board.rows.map(r=>[r.nickname,r.score,r.rank]),[["A",100,1],["黄xx",92,2],["B",90,3]]);
    assert.equal(board.mine.rank,3);
    assert.equal(await play(b,1000),100);
    board=(await send("board")).data;
    assert.deepEqual(board.rows.map(r=>r.rank),[1,1,3]);
    assert.equal(board.mine,null);
    assert.equal(await play(a,5260,2),90);
    const historical=(await send("board?season=five-second",null,a)).data;
    assert.deepEqual(historical.rows.map(r=>[r.nickname,r.score,r.rank]),[["A",90,1]]);
    assert.equal(historical.mine.score,90);
    assert.equal((await send("board",null,a)).data.mine.score,100);
    assert.deepEqual((await send("board?season=ranked")).data,board);
    assert.deepEqual((await send("board?season=legacy")).data,board);
    assert.deepEqual((await send("board?season=points",null,a)).data,historical);
    now=weekEnd-1;
    const weekly=(await send("board?season=weekly",null,a)).data;
    assert.equal(weekly.weekStart,Date.parse("2026-11-22T16:00:00Z"));
    assert.equal(weekly.weekEnd,weekEnd);
    assert.deepEqual(weekly.rows,board.rows.filter(r=>r.nickname!=="黄xx"));
    assert.deepEqual(weekly.mine,{score:100,rank:1});
    now=weekEnd;
    assert.deepEqual((await send("board?season=weekly",null,a)).data,
      {rows:[],mine:null,weekStart:weekly.weekEnd,weekEnd:Date.parse("2026-12-06T16:00:00Z")});
    assert.equal(await play(a,2000,1,1000),90);
    assert.deepEqual((await send("board?season=weekly",null,a)).data.mine,{score:90,rank:1});
    assert.equal((await send("board",null,a)).data.mine.score,100);
  } finally {Date.now=originalTime;}
});
test("start lead follows reported RTT and stays idempotent",async()=>{
  const DB=localDb(":memory:");
  const api=createApi(Array.from({length:15},(_,i)=>({name:"Song "+i,id:i+1,offset:3})));
  const origin="https://quiz.example";
  async function send(route,body,cookie=""){
    const response=await api(new Request(origin+"/api/"+route,{method:body?"POST":"GET",headers:{Origin:origin,Cookie:cookie,"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined}),{DB});
    return {data:await response.json(),cookie:response.headers.get("Set-Cookie")?.split(";")[0]};
  }
  const cookie=(await send("join",{nickname:"RTT"})).cookie;
  const round=(await send("round",{},cookie)).data.round;
  const slow=await send("start",{round,index:0,rtt:1200},cookie);
  const lead=slow.data.startAt-slow.data.serverNow;
  assert.ok(lead>=850 && lead<=950,"lead was "+lead);
  const again=await send("start",{round,index:0,rtt:0},cookie);
  assert.equal(again.data.startAt,slow.data.startAt);
});

test("rank timing credits only the first authenticated echo and caps the adjustment",async()=>{
  const DB=localDb(":memory:");
  const api=createApi(Array.from({length:16},(_,i)=>({name:"Song "+i,id:i+1,offset:3})));
  const origin="https://quiz.example";
  const realNow=Date.now;
  let now=2000000000000;
  Date.now=()=>now;
  async function send(route,body,cookie=""){
    const response=await api(new Request(origin+"/api/"+route,{method:"POST",headers:{Origin:origin,Cookie:cookie,"Content-Type":"application/json"},body:JSON.stringify(body)}),{DB});
    return {status:response.status,data:await response.json(),cookie:response.headers.get("Set-Cookie")?.split(";")[0]};
  }
  try {
    const {cookie}=await send("join",{nickname:"Ranked"});
    const other=(await send("join",{nickname:"Other"})).cookie;
    const round=(await send("round",{},cookie)).data.round;
    const cases=[
      {delay:850,answerAt:1100,credit:0,earned:9,wrongOwner:true},
      {delay:400,answerAt:1100,credit:200,earned:10},
      {delay:850,answerAt:1201,credit:200,earned:9},
      {delay:60,answerAt:1031,credit:30,earned:9,replay:true},
      {delay:1201,answerAt:1100,credit:0,earned:9},
      {delay:400,answerAt:10002,credit:200,earned:0,timeout:true}
    ];
    for(const [index,c] of cases.entries()){
      const payload={round,index};
      const start=(await send("start",{...payload,rtt:2000},cookie)).data;
      const echo={...payload,nonce:start.timingNonce,rtt:4000};
      const secret=JSON.parse(DB.prepare("SELECT questions FROM games WHERE id=?").bind(round).first().questions)[index];
      assert.equal((await send("round",{},cookie)).data.started,true);
      assert.equal((await send("replace",payload,cookie)).status,409);
      now=start.serverNow+c.delay;
      assert.equal((await send("timing",echo,c.wrongOwner ? other : cookie)).status,200);
      if(c.replay){
        now=start.serverNow+850;
        await send("timing",echo,cookie);
      }
      now=start.startAt+c.answerAt;
      const choice=c.timeout ? -1 : start.choices.indexOf(secret.name);
      const result=(await send("answer",{...payload,choice,timeout:c.timeout},cookie)).data;
      assert.equal(result.networkCreditMs??0,c.credit);
      assert.equal(result.elapsedMs,c.answerAt-c.credit);
      assert.equal(result.earned,c.earned);
      if(c.timeout) assert.equal(result.outcome,"timeout");
    }
  } finally {Date.now=realNow;}
});

test("hot rounds share player nicknames and keep independent progress and rankings",async()=>{
  const DB=localDb(":memory:");
  const catalog=Array.from({length:45},(_,i)=>({name:"Song "+i,id:i+1,offset:3,hot:i<40}));
  const api=createApi(catalog);
  const origin="https://quiz.example";
  const originalTime=Date.now;
  let now=2000000000000;
  Date.now=()=>now;
  async function send(route,body,cookie=""){
    const response=await api(new Request(origin+"/api/"+route,{method:body?"POST":"GET",headers:{Origin:origin,Cookie:cookie,"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined}),{DB});
    return {status:response.status,data:await response.json(),cookie:response.headers.get("Set-Cookie")?.split(";")[0]};
  }

  try {
    assert.equal((await send("round",{mode:"hot"})).status,401);
    assert.deepEqual((await send("board?season=hot")).data.rows,[{nickname:"黄xx",score:100,correct:10,rank:1}]);
    const {cookie}=await send("join",{nickname:"热歌玩家"});
    const ranked=(await send("round",{},cookie)).data;
    let hot=(await send("round",{mode:"hot"},cookie)).data;
    assert.notEqual(hot.round,ranked.round);
    assert.equal(hot.scoringVersion,3);
    assert.deepEqual((await send("round",{},cookie)).data,ranked);
    const initial=hot;
    hot=(await send("replace",{round:hot.round,index:0},cookie)).data;
    assert.notEqual(hot.previewPath,initial.previewPath);
    hot=(await send("replace",{round:hot.round,index:0},cookie)).data;
    const questions=JSON.parse(DB.prepare("SELECT questions FROM games WHERE id=?").bind(hot.round).first().questions);
    assert.equal(new Set(questions.map(q=>q.id)).size,10);
    assert.equal(new Set([...questions[0].replacedIds,questions[0].id]).size,3);
    const hotTitles=new Set(catalog.filter(song=>song.hot).map(song=>song.name));
    assert.ok(questions.every(q=>hotTitles.has(q.name) && q.choices.every(name=>hotTitles.has(name))));

    const cases=[[1999,10],[2000,10],[2001,9],[3000,9],[3001,8],[5000,7],[10000,2],[11000,1],[15000,1],[2000,0]];
    let total=0;
    for(const [index,[elapsed,earned]] of cases.entries()){
      assert.equal(hot.index,index);
      assert.equal(hot.score,total);
      const payload={round:hot.round,index};
      const start=(await send("start",payload,cookie)).data;
      now=start.startAt+elapsed;
      // Replays keep the original clock, including after the first clip ends.
      assert.equal((await send("start",payload,cookie)).data.startAt,start.startAt);
      const choice=earned ? start.choices.indexOf(questions[index].name) : -1;
      const answer=await send("answer",{...payload,choice,score:100},cookie);
      assert.equal(answer.status,200);
      assert.equal(answer.data.earned,earned);
      total+=earned;
      assert.equal(answer.data.score,total);
      if(index===9) assert.equal(answer.data.details[index].outcome,"skipped");
      hot=answer.data.next;
    }
    assert.equal(total,57);
    assert.equal(hot,null);
    assert.deepEqual((await send("round",{},cookie)).data,ranked);
    assert.deepEqual((await send("board",null,cookie)).data,{rows:[{nickname:"黄xx",score:92,correct:10,rank:1}],mine:null});
    assert.deepEqual((await send("board?season=weekly",null,cookie)).data.rows,[]);
    const board=(await send("board?season=hot",null,cookie)).data;
    assert.deepEqual(board.rows.map(r=>[r.nickname,r.score,r.rank]),[["黄xx",100,1],["热歌玩家",57,2]]);
    assert.deepEqual(board.mine,{score:57,rank:2});
    assert.deepEqual((await send("board?season=hot")).data,{rows:board.rows,mine:null});
    await send("join",{nickname:"新昵称"},cookie);
    assert.equal((await send("board?season=hot")).data.rows[1].nickname,"新昵称");

    const seen=new Set(questions.map(question=>question.id));
    const firstSongs=[...seen].sort((a,b)=>a-b);
    for(let roundNumber=2;roundNumber<=5;roundNumber++){
      now+=86400000;
      const round=(await send("round",{mode:"hot"},cookie)).data.round;
      const songs=JSON.parse(DB.prepare("SELECT questions FROM games WHERE id=?").bind(round).first().questions);
      if(roundNumber===5){
        assert.deepEqual(songs.map(song=>song.id).sort((a,b)=>a-b),firstSongs);
        break;
      }
      for(const [index,song] of songs.entries()){
        assert.equal(seen.has(song.id),false);
        seen.add(song.id);
        const payload={round,index};
        const start=(await send("start",payload,cookie)).data;
        now=start.startAt+2000;
        assert.equal((await send("answer",{...payload,choice:-1},cookie)).status,200);
      }
    }
    assert.equal(DB.prepare("SELECT COUNT(*) AS count FROM games WHERE mode='hot'").first().count,4);
  } finally {Date.now=originalTime;}
});

test("Jay rounds use their own songs and leaderboard with the competitive timing rules",async()=>{
  const DB=localDb(":memory:");
  const eason=Array.from({length:15},(_,i)=>({name:"Song "+i,id:i+1,offset:3,hot:true}));
  const jay=JSON.parse(readFileSync(new URL("../db/jay-catalog.json",import.meta.url),"utf8"));
  const byId=new Map(jay.map(song=>[song.id,song]));
  const names=new Set(jay.map(song=>song.name));
  const api=createApi(eason,jay);
  const origin="https://quiz.example";
  let cookie="";
  const realNow=Date.now;
  let now=realNow();
  Date.now=()=>now;
  async function send(path,body){
    const response=await api(new Request(origin+"/api/"+path,{method:body?"POST":"GET",
      headers:{Origin:origin,Cookie:cookie,"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined}),{DB});
    assert.equal(response.status,200,path);
    return {data:await response.json(),cookie:response.headers.get("Set-Cookie")?.split(";")[0]};
  }
  try{
    ({cookie}=await send("join",{nickname:"Jay Player"}));
    const ranked=(await send("round",{mode:"ranked"})).data;
    const hot=(await send("round",{mode:"hot"})).data;
    const first=(await send("round",{mode:"jay"})).data;
    assert.equal(new Set([first.round,ranked.round,hot.round]).size,3);
    const initial={round:first.round,index:0};
    const replaced=(await send("replace",initial)).data;
    assert.notEqual(replaced.previewPath,first.previewPath);
    assert.deepEqual((await send("round",{mode:"jay"})).data,replaced);
    const questions=JSON.parse(DB.prepare("SELECT questions FROM games WHERE id=?").bind(first.round).first().questions);
    assert.equal(new Set(questions.map(q=>q.id)).size,10);
    assert.ok(questions.every(q=>byId.has(q.id) && q.choices.every(name=>names.has(name))));
    const previewUrl=byId.get(questions[0].id).previewUrl;
    assert.equal((await send(replaced.previewPath.slice(5))).data.url,previewUrl);
    assert.equal((await send("preview?id="+questions[0].id)).data.url,previewUrl);
    let result;
    for(const [index,q] of questions.entries()){
      const payload={round:first.round,index};
      const start=(await send("start",payload)).data;
      now=start.serverNow+400;
      if(index===0) await send("timing",{...payload,nonce:start.timingNonce});
      now=start.startAt+1200;
      result=(await send("answer",{...payload,choice:start.choices.indexOf(q.name)})).data;
      assert.equal(result.earned,index===0?10:9);
    }
    assert.equal(result.score,91);
    assert.equal(result.details[1].msToNextPoint,200);
    assert.match(result.details[1].songUrl,/^https:\/\/music\.apple\.com\//);
    assert.deepEqual((await send("board?season=jay")).data.rows,[{nickname:"Jay Player",correct:10,score:91,rank:1}]);
    for(const season of ["ranked","hot","weekly","five-second"]){
      assert.equal((await send("board?season="+season)).data.mine,null);
    }
    assert.deepEqual((await send("round",{mode:"ranked"})).data,ranked);
    assert.deepEqual((await send("round",{mode:"hot"})).data,hot);
  } finally {Date.now=realNow;}
});
