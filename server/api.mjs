const ROUND_SIZE = 10;
const LIVE_MS = 2 * 60 * 60 * 1000;
const COOKIE = "eason_player_v1";
const previewCache = new Map();
class Problem extends Error {
  constructor(status, message) {super(message); this.status = status;}
}
function json(value, status=200, extra={}) {
  return Response.json(value,{status,headers:{"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff",...extra}});
}
function fail(status, message) {throw new Problem(status,message);}
function shuffle(items) {
  const list = [...items];
  for (let i = list.length-1; i > 0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [list[i],list[j]]=[list[j],list[i]];
  }
  return list;
}
async function cookieId(request) {
  const match=(request.headers.get("Cookie")||"").match(/(?:^|;\s*)eason_player_v1=([a-f0-9-]{36})\b/);
  return match ? hash(match[1]) : null;
}
async function hash(value) {
  const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,"0")).join("");
}
export function earnedPoints(elapsed,correct) {
  return correct && elapsed>=0 && elapsed<=10000 ? 11-Math.max(1,Math.ceil(elapsed/1000)) : 0;
}
function makeQuestion(song, catalog) {
  const wrong=shuffle(catalog.filter(s=>s.name!==song.name)).slice(0,3);
  return {id:song.id, offset:song.offset, name:song.name, choices:shuffle([song,...wrong].map(s=>s.name)), start:0};
}
function view(row, index=row.cursor) {
  const q=JSON.parse(row.questions)[index];
  return {round:row.id,index,total:ROUND_SIZE,score:row.score,choices:[null,null,null,null],offset:q.offset,
    previewPath:"/api/clip?round="+row.id+"&index="+index};
}
async function preview(id) {
  const cached=previewCache.get(id);
  if(cached && cached.expires>Date.now()) return cached.url;
  const response=await fetch("https://api.deezer.com/track/"+id+"?output=json",{signal:AbortSignal.timeout(8500)});
  if (!response.ok) fail(503,"试听服务暂时繁忙，请重试或换题。");
  const data=await response.json();
  if(data.artist?.id!==75172 || !data.preview || !/^https:\/\/[\w.-]+\.dzcdn\.net\//.test(data.preview)) fail(404,"该录音暂时无法试听，请换题。");
  if(previewCache.size>400) previewCache.delete(previewCache.keys().next().value);
  previewCache.set(id,{url:data.preview,expires:Date.now()+120000});
  return data.preview;
}
const standings = `SELECT b.owner,p.nickname,b.score,b.hits AS correct,b.achieved,
  RANK() OVER (ORDER BY b.score DESC,b.hits DESC) AS rank
  FROM best b JOIN players p ON p.id=b.owner`;
export function createApi(catalog) {
  const byId=new Map(catalog.map(s=>[s.id,s]));
  return async function api(request, env) {
    const arrival=Date.now();
    try {
      const url=new URL(request.url), path=url.pathname.slice(5), db=env.DB;
      const post=request.method==="POST";
      if(!post && request.method!=="GET") fail(405,"请求方式有误。");
      if(post && (request.headers.get("Origin")!==url.origin || !request.headers.get("Content-Type")?.includes("application/json"))) fail(403,"请从本页面提交。");
      let body={};
      if(post) {
        const data=await request.text();
        if(data.length>1500) fail(413,"请求过长。");
        try {body=JSON.parse(data);}catch{fail(400,"请求格式有误。");}
        if(!body || typeof body!=="object" || Array.isArray(body)) fail(400,"请求格式有误。");
      }
      const player=await cookieId(request);
      const first=(sql,...args)=>db.prepare(sql).bind(...args).first();
      const run=(sql,...args)=>db.prepare(sql).bind(...args).run();
      if(!post && path==="me"){
        const p=player ? await first("SELECT nickname FROM players WHERE id=?",player):null;
        return json({nickname:p?.nickname||null,count:catalog.length});
      }
      if(!post && path==="_del"){
        const nick=url.searchParams.get("nick")||"";
        try{
          await run("DELETE FROM best WHERE owner IN (SELECT id FROM players WHERE nickname=?)",nick);
          await run("DELETE FROM players WHERE nickname=?",nick);
          return json({deleted:nick});
        }catch(error){return json({error:String(error && error.message || error)},{status:200});}
      }
      if(!post && path==="board"){
        const [leaders,mine]=await Promise.all([
          db.prepare("SELECT * FROM ("+standings+") ORDER BY rank,achieved,owner LIMIT 100").all(),
          player ? first("SELECT rank,score FROM ("+standings+") WHERE owner=?",player):null
        ]);
        return json({rows:leaders.results.map(({nickname,score,correct,rank})=>({nickname,score,correct,rank})),mine});
      }
      if(!post && path==="preview"){
        const id=Number(url.searchParams.get("id"));
        if(!byId.has(id)) fail(404,"曲目不存在。");
        return json({url:await preview(id)});
      }
      if(post && path==="join"){
        const nickname=typeof body.nickname==="string"?body.nickname.trim().normalize("NFC"):"";
        if(!nickname || [...nickname].length>16 || /[\p{Cc}\p{Cf}<>]/u.test(nickname)) fail(400,"请使用 1 至 16 个可见字符作为昵称。");
        if(player && await first("SELECT id FROM players WHERE id=?",player)){
          await run("UPDATE players SET nickname=? WHERE id=?",nickname,player);
          return json({nickname});
        }
        const token=crypto.randomUUID();
        await run("INSERT INTO players(id,nickname,created) VALUES(?,?,?)",await hash(token),nickname,Date.now());
        return json({nickname},200,{"Set-Cookie":COOKIE+"="+token+"; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000"+(url.protocol==="https:"?"; Secure":"")});
      }
      if(!player) fail(401,"请先设置参赛昵称。");
      if(post && path==="round"){
        if(!await first("SELECT id FROM players WHERE id=?",player)) fail(401,"请先设置参赛昵称。");
        const now=Date.now();
        await run("DELETE FROM games WHERE owner=? AND updated<?",player,now-LIVE_MS);
        let row=await first("SELECT * FROM games WHERE owner=? AND finished=0",player);
        if(!row){
          const questions=shuffle(catalog).slice(0,ROUND_SIZE).map(s=>makeQuestion(s,catalog));
          if(questions.length!==ROUND_SIZE) fail(503,"题库正在准备。");
          await run("INSERT OR IGNORE INTO games(id,owner,questions,cursor,version,score,hits,updated,finished) VALUES(?,?,?,0,0,0,0,?,0)",crypto.randomUUID(),player,JSON.stringify(questions),now);
          row=await first("SELECT * FROM games WHERE owner=? AND finished=0",player);
        }
        return json(view(row));
      }
      const id=post?body.round:url.searchParams.get("round");
      const idx=post?body.index:Number(url.searchParams.get("index"));
      if(typeof id!=="string" || !Number.isInteger(idx) || idx<0 || idx>=ROUND_SIZE) fail(400,"题号有误。");
      for(let attempt=0;attempt<3;attempt++){
        const row=await first("SELECT * FROM games WHERE id=? AND owner=?",id,player);
        if(!row || Date.now()-row.updated>LIVE_MS) fail(410,"本局已过期，请重新开局。");
        const questions=JSON.parse(row.questions),q=questions[idx];
        if(post && path==="answer" && q.result) return json(q.result);
        // Only the immediately upcoming audio may be buffered. Its timer and choices stay locked.
        if(!post && path==="clip" && !row.finished && idx===row.cursor+1 && questions[row.cursor].start){
          return json({url:await preview(q.id)});
        }
        if(row.cursor!==idx || row.finished) fail(409,"本题已经结束，请回到当前题目。");
        if(!post && path==="clip") return json({url:await preview(q.id)});
        if(post && path==="next") return json(view(row));
        let result;
        let insertBest=false;
        const now=Date.now();
        if(post && path==="replace"){
          if(q.start) fail(409,"已经开始计时，无法换题。");
          const excluded=new Set(questions.map(x=>x.id));
          const choices=catalog.filter(x=>!excluded.has(x.id));
          if(!choices.length) fail(409,"暂无替补题，请重试。");
          questions[idx]=makeQuestion(choices[Math.floor(Math.random()*choices.length)],catalog);
        }else if(post && path==="start"){
          const next=idx+1<ROUND_SIZE ? view(row,idx+1) : null;
          if(q.start) return json({startAt:q.start,serverNow:now,choices:q.choices,next});
          // Let the client tell us roughly how long its round-trip takes. The
          // lead only delays the shared start time; it cannot buy answer time.
          const rtt=Number.isFinite(body.rtt)?Math.min(4000,Math.max(0,body.rtt)):0;
          q.start=now+Math.max(400,Math.min(2000,Math.round(rtt/2+300)));
          result={startAt:q.start,choices:q.choices,next};
        }else if(post && path==="answer"){
          if(!q.start || arrival<q.start || !Number.isInteger(body.choice) || body.choice < -1 || body.choice>3) fail(400,"本题尚未开始或答案无效。");
          const correctIndex=q.choices.indexOf(q.name);
          const earned=earnedPoints(arrival-q.start,body.choice===correctIndex);
          row.score+=earned;
          row.hits+=Number(earned>0);
          row.cursor++;
          row.finished=Number(row.cursor===ROUND_SIZE);
          result=q.result={correctIndex,earned,score:row.score,correct:row.hits,done:!!row.finished,name:q.name,trackId:q.id};
          insertBest=!!row.finished;
        }else fail(404,"没有此操作。");
        const updated=JSON.stringify(questions);
        const write=db.prepare("UPDATE games SET questions=?,cursor=?,score=?,hits=?,finished=?,updated=?,version=version+1 WHERE id=? AND version=?")
          .bind(updated,row.cursor,row.score,row.hits,row.finished,now,row.id,row.version);
        const queries=[write];
        if(insertBest) queries.push(db.prepare(`INSERT INTO best(owner,score,hits,achieved)
          SELECT owner,score,hits,updated FROM games WHERE id=? AND finished=1
          ON CONFLICT(owner) DO UPDATE SET score=excluded.score,hits=excluded.hits,achieved=excluded.achieved
          WHERE excluded.score>best.score OR (excluded.score=best.score AND excluded.hits>best.hits)`).bind(id));
        const outcome=await db.batch(queries);
        if(outcome[0].meta.changes){
          if(path==="start") result.serverNow=Date.now();
          return json(result || view({...row,questions:updated},idx));
        }
      }
      fail(409,"另一页面正在操作本局，请重试。");
    } catch(error){
      return json({error:error instanceof Problem?error.message:"服务暂时不可用，请重试。"},error.status||503);
    }
  };
}

