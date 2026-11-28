import {test} from "node:test";
import assert from "node:assert/strict";
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
  const originalTime=Date.now;let now=2000000000000;
  Date.now=()=>now;
  async function send(route,body,cookie=""){
    const response=await api(new Request(origin+"/api/"+route,{method:body?"POST":"GET",headers:{Origin:origin,Cookie:cookie,"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined}),{DB});
    return {status:response.status,data:await response.json(),cookie:response.headers.get("Set-Cookie")?.split(";")[0]};
  }
  async function play(cookie,ms,version=1){
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
      }else assert.equal(outcome.next,null);
    }
    assert.equal(picks.size,10);
    return outcome.score;
  }
  try {
    const a=(await send("join",{nickname:"A"})).cookie;
    const b=(await send("join",{nickname:"B"})).cookie;
    assert.notEqual(a,b);
    assert.equal(await play(a,950),100);
    assert.equal(await play(b,1260),90);
    assert.equal(await play(a,11000),0);
    let board=(await send("board",null,b)).data;
    assert.deepEqual(board.rows.map(r=>[r.nickname,r.score,r.rank]),[["A",100,1],["B",90,2]]);
    assert.equal(board.mine.rank,2);
    assert.equal(await play(b,1000),100);
    board=(await send("board")).data;
    assert.deepEqual(board.rows.map(r=>r.rank),[1,1]);
    assert.equal(board.mine,null);
    assert.equal(await play(a,5260,2),90);
    const historical=(await send("board?season=five-second",null,a)).data;
    assert.deepEqual(historical.rows.map(r=>[r.nickname,r.score,r.rank]),[["A",90,1]]);
    assert.equal(historical.mine.score,90);
    assert.equal((await send("board",null,a)).data.mine.score,100);
    assert.deepEqual((await send("board?season=ranked")).data,board);
    assert.deepEqual((await send("board?season=legacy")).data,board);
    assert.deepEqual((await send("board?season=points",null,a)).data,historical);
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

test("hot rounds share player nicknames and keep independent progress and rankings",async()=>{
  const DB=localDb(":memory:");
  const catalog=Array.from({length:16},(_,i)=>({name:"Song "+i,id:i+1,offset:3,hot:i<12}));
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
    const questions=JSON.parse(DB.prepare("SELECT questions FROM games WHERE id=?").bind(hot.round).first().questions);
    assert.equal(new Set(questions.map(q=>q.id)).size,10);
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
      hot=answer.data.next;
    }
    assert.equal(total,57);
    assert.equal(hot,null);
    assert.deepEqual((await send("round",{},cookie)).data,ranked);
    assert.deepEqual((await send("board",null,cookie)).data,{rows:[],mine:null});
    const board=(await send("board?season=hot",null,cookie)).data;
    assert.deepEqual(board.rows.map(r=>[r.nickname,r.score,r.rank]),[["黄xx",100,1],["热歌玩家",57,2]]);
    assert.deepEqual(board.mine,{score:57,rank:2});
    assert.deepEqual((await send("board?season=hot")).data,{rows:board.rows,mine:null});
    await send("join",{nickname:"新昵称"},cookie);
    assert.equal((await send("board?season=hot")).data.rows[1].nickname,"新昵称");
  } finally {Date.now=originalTime;}
});
