const ROUND_SIZE = 10;
const LIVE_MS = 2 * 60 * 60 * 1000;
const POINTS_VERSION = 1;
const FIVE_SECOND_VERSION = 2;
const HOT_VERSION = 3;
const SCORE_STEP_MS = 1000;
const MAX_QUESTION_SCORE = 10;
const MAX_NETWORK_CREDIT_MS = 200;
const MAX_TIMING_SAMPLE_MS = 1200;
const MAX_TIMING_ROUNDS = 1024;
const RECENT_ROUNDS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const COOKIE = "eason_player_v1";
const previewCache = new Map();
const previewPending = new Map();
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
export function earnedPoints(elapsed,correct,scoringVersion=POINTS_VERSION) {
  if(!correct || !Number.isFinite(elapsed) || elapsed<0) return 0;
  const seconds=Math.ceil(elapsed/SCORE_STEP_MS);
  if(scoringVersion===HOT_VERSION) return Math.max(1,MAX_QUESTION_SCORE-Math.max(0,seconds-2));
  if(elapsed>10000) return 0;
  return MAX_QUESTION_SCORE-Math.max(0,seconds-(scoringVersion===FIVE_SECOND_VERSION ? 5 : 1));
}
function makeQuestion(song, catalog) {
  const wrong=shuffle(catalog.filter(s=>s.name!==song.name)).slice(0,3);
  return {id:song.id, offset:song.offset, name:song.name, choices:shuffle([song,...wrong].map(s=>s.name)), start:0, clipKey:crypto.randomUUID()};
}
async function recentSongIds(db, player, mode, exceptRound=null) {
  const recent=await db.prepare(`WITH recent AS (
    SELECT questions FROM games WHERE owner=? AND mode=? AND id IS NOT ?
    ORDER BY updated DESC,id DESC LIMIT ?
  ) SELECT DISTINCT json_extract(song.value,'$.id') AS id
    FROM recent,json_each(recent.questions) song WHERE json_extract(song.value,'$.start')>0`)
    .bind(player,mode,exceptRound,RECENT_ROUNDS).all();
  return new Set(recent.results.map(song=>song.id));
}
function chooseSongs(pool, recent, count) {
  const fresh=shuffle(pool.filter(song=>!recent.has(song.id))).slice(0,count);
  if(fresh.length===count) return fresh;
  return [...fresh,...shuffle(pool.filter(song=>recent.has(song.id))).slice(0,count-fresh.length)];
}
function roundDetails(questions, scoringVersion) {
  const showSpeedTips=scoringVersion===POINTS_VERSION && questions.every(q=>q.result.earned>0);
  return questions.map(q=>{
    const { earned, elapsedMs=null, choice, outcome, networkCreditMs }=q.result;
    const nextPointDeadline=(MAX_QUESTION_SCORE-earned)*SCORE_STEP_MS;
    const msToNextPoint=showSpeedTips && earned<MAX_QUESTION_SCORE && Number.isFinite(elapsedMs)
      ? elapsedMs-nextPointDeadline : 0;
    return {name:q.name,trackId:q.id,offset:q.offset,earned,elapsedMs,
      selected:q.choices[choice] ?? null,outcome:outcome ?? (earned>0 ? "correct" : "unscored"),
      ...(networkCreditMs>0 ? {networkCreditMs} : {}),
      ...(msToNextPoint>0 ? {msToNextPoint} : {})};
  });
}
function clipView(round,index,q) {
  const suffix=q.clipKey ? "&v="+q.clipKey : "";
  return {round,index,total:ROUND_SIZE,choices:[null,null,null,null],offset:q.offset,
    previewPath:"/api/clip?round="+round+"&index="+index+suffix};
}
function view(row, q=JSON.parse(row.questions)[row.cursor]) {
  return {...clipView(row.id,row.cursor,q),score:row.score,correct:row.hits,scoringVersion:row.scoring_version,started:!!q.start};
}
async function fetchPreview(id) {
  const response=await fetch("https://api.deezer.com/track/"+id+"?output=json",{signal:AbortSignal.timeout(8500)});
  if (!response.ok) fail(503,"试听服务暂时繁忙，请重试或换题。");
  const data=await response.json();
  if(data.artist?.id!==75172 || !data.preview || !/^https:\/\/[\w.-]+\.dzcdn\.net\//.test(data.preview)) fail(404,"该录音暂时无法试听，请换题。");
  const now=Date.now();
  const token=new URL(data.preview).searchParams.get("hdnea") || "";
  const expiresAt=Number(token.match(/(?:^|~)exp=(\d+)/)?.[1]) * 1000;
  const expires=expiresAt ? Math.min(now+900000,expiresAt-30000) : now+120000;
  if(previewCache.size>=400) previewCache.delete(previewCache.keys().next().value);
  previewCache.set(id,{url:data.preview,expires});
  return data.preview;
}
async function preview(id) {
  const cached=previewCache.get(id);
  if(cached && cached.expires>Date.now()) return cached.url;
  if(!previewPending.has(id)) previewPending.set(id,fetchPreview(id).finally(()=>previewPending.delete(id)));
  return previewPending.get(id);
}
function scoreTable(version) {
  if(version===HOT_VERSION) return "hot_best";
  return version===FIVE_SECOND_VERSION ? "points_best" : "best";
}
function shanghaiWeekStart(timestamp) {
  const local=new Date(timestamp+SHANGHAI_OFFSET_MS);
  const daysSinceMonday=(local.getUTCDay()+6)%7;
  return Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate()-daysSinceMonday)-SHANGHAI_OFFSET_MS;
}
const standings = (version, weekly) => `SELECT b.owner,p.nickname,b.score,b.hits AS correct,b.achieved,
  RANK() OVER (ORDER BY b.score DESC,b.hits DESC) AS rank
  FROM ${weekly ? "weekly_best" : scoreTable(version)} b JOIN players p ON p.id=b.owner
  ${weekly ? "WHERE b.week_start=?" : version===POINTS_VERSION ? "WHERE b.owner NOT IN ("+["a","b","c","d"].map(id=>"'"+id.repeat(64)+"'").join(",")+")" : ""}`;
// 访问统计：只记页面级请求（前端每次加载都会调 /api/me）。
// 设备标识用 IP+UA 的哈希，不存明文；写入 fire-and-forget，不拖慢响应。
// fresh 由数据库判定（当天该设备是否已出现过），所以容器重启也不会重复计 UV。
const CRAWLER = /curl|wget|bot|spider|crawler|monitor|uptime|python-requests|python-urllib|node-fetch|go-http|okhttp|java\/|axios|headless|phantom/i;
function deviceKey(request) {
  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  const ua = request.headers.get("user-agent") || "";
  const seed = ip + "|" + ua;
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = (((h << 5) + h) ^ seed.charCodeAt(i)) >>> 0;
  return h.toString(16);
}
function trackVisit(db, request) {
  try {
    const ua = request.headers.get("user-agent") || "";
    if (!ua || CRAWLER.test(ua)) return;
    const did = deviceKey(request);
    const now = Date.now();
    const dayStart = Math.floor(now / DAY_MS) * DAY_MS;
    Promise.resolve(
      db.prepare(
        "INSERT INTO visits(id,at,did,path,fresh) VALUES(?,?,?,?," +
        "CASE WHEN EXISTS(SELECT 1 FROM visits WHERE did=? AND at>=?) THEN 0 ELSE 1 END)"
      ).bind(crypto.randomUUID(), now, did, "home", did, dayStart).run()
    ).catch(() => {});
  } catch {}
}

export function createApi(catalog) {
  const byId=new Map(catalog.map(s=>[s.id,s]));
  const hotCatalog=catalog.filter(song=>song.hot===true);
  const timing=new Map();
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
      if(!post && path==="health") return json({ok:true});
      if(!post && path==="me"){
        trackVisit(db, request);
        const p=player ? await first("SELECT nickname FROM players WHERE id=?",player):null;
        return json({nickname:p?.nickname||null,count:catalog.length});
      }
      if(!post && path==="board"){
        const season=url.searchParams.get("season");
        // The previous frontend used season=points for scores earned with the five-second rule.
        let version=POINTS_VERSION;
        if(season==="hot") version=HOT_VERSION;
        if(season==="five-second" || season==="points") version=FIVE_SECOND_VERSION;
        const weekly=season==="weekly";
        const weekStart=shanghaiWeekStart(arrival);
        const args=weekly ? [weekStart] : [];
        const ranking=standings(version,weekly);
        const [leaders,mine]=await Promise.all([
          db.prepare("SELECT * FROM ("+ranking+") ORDER BY rank,achieved,owner LIMIT 100").bind(...args).all(),
          player ? first("SELECT rank,score FROM ("+ranking+") WHERE owner=?",...args,player):null
        ]);
        const rows=leaders.results.map(({nickname,score,correct,rank})=>({nickname,score,correct,rank}));
        return json(weekly ? {rows,mine,weekStart,weekEnd:weekStart+WEEK_MS} : {rows,mine});
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
      if(post && path==="timing"){
        const sample=timing.get(body.round);
        if(sample && sample.player===player && sample.index===body.index && sample.nonce===body.nonce && sample.receivedAt===undefined){
          const rtt=arrival-sample.sentAt;
          if(rtt>=0 && rtt<=MAX_TIMING_SAMPLE_MS){
            sample.receivedAt=arrival;
            sample.creditMs=Math.min(MAX_NETWORK_CREDIT_MS,Math.floor(rtt/2));
          }
        }
        return json({ok:true});
      }
      if(post && path==="round"){
        const mode=body.mode ?? "ranked";
        if(mode!=="ranked" && mode!=="hot") fail(400,"玩法有误。");
        const pool=mode==="hot" ? hotCatalog : catalog;
        const scoringVersion=mode==="hot" ? HOT_VERSION : POINTS_VERSION;
        const now=Date.now();
        const active=await first(`SELECT g.* FROM players p
          LEFT JOIN games g ON g.owner=p.id AND g.mode=? AND g.finished=0 WHERE p.id=?`,mode,player);
        if(!active) fail(401,"请先设置参赛昵称。");
        if(active.id && now-active.updated<=LIVE_MS) return json(view(active));
        const recent=await recentSongIds(db,player,mode);
        const questions=chooseSongs(pool,recent,ROUND_SIZE).map(s=>makeQuestion(s,pool));
        if(questions.length!==ROUND_SIZE) fail(503,"题库正在准备。");
        const id=crypto.randomUUID();
        const [,created]=await db.batch([
          db.prepare(`DELETE FROM games WHERE owner=? AND mode=? AND updated<? AND (finished=0 OR id NOT IN (
            SELECT id FROM games WHERE owner=? AND mode=? AND finished=1 ORDER BY updated DESC,id DESC LIMIT ?
          ))`).bind(player,mode,now-LIVE_MS,player,mode,RECENT_ROUNDS),
          db.prepare(`INSERT OR IGNORE INTO games(id,owner,questions,cursor,version,score,hits,updated,finished,scoring_version,mode)
            VALUES(?,?,?,0,0,0,0,?,0,?,?)`).bind(id,player,JSON.stringify(questions),now,scoringVersion,mode)
        ]);
        if(created.meta.changes) return json(view({id,cursor:0,score:0,hits:0,scoring_version:scoringVersion},questions[0]));
        const row=await first("SELECT * FROM games WHERE owner=? AND mode=? AND finished=0",player,mode);
        if(!row) fail(409,"本局已结束，请重新开局。");
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
        if(!post && path==="clip" && url.searchParams.has("v") && url.searchParams.get("v")!==q.clipKey) fail(409,"曲目已更换，请重新加载。");
        // Only the immediately upcoming audio may be buffered. Its timer and choices stay locked.
        if(!post && path==="clip" && !row.finished && idx===row.cursor+1 && questions[row.cursor].start){
          return json({url:await preview(q.id)});
        }
        if(row.cursor!==idx || row.finished) fail(409,"本题已经结束，请回到当前题目。");
        if(!post && path==="clip") return json({url:await preview(q.id)});
        if(post && path==="next") return json(view(row,q));
        let result;
        let insertBest=false;
        const now=Date.now();
        if(post && path==="replace"){
          if(q.start) fail(409,"已经开始计时，无法换题。");
          const excluded=new Set(questions.flatMap(song=>[song.id,...(song.replacedIds || [])]));
          const pool=row.mode==="hot" ? hotCatalog : catalog;
          const choices=pool.filter(x=>!excluded.has(x.id));
          if(!choices.length) fail(409,"暂无替补题，请重试。");
          const recent=await recentSongIds(db,player,row.mode,id);
          questions[idx]={...makeQuestion(chooseSongs(choices,recent,1)[0],pool),replacedIds:[...(q.replacedIds || []),q.id]};
        }else if(post && path==="start"){
          const next=idx+1<ROUND_SIZE ? clipView(row.id,idx+1,questions[idx+1]) : null;
          if(q.start) return json({startAt:q.start,serverNow:now,processingMs:now-arrival,choices:q.choices,next});
          // Let the client tell us roughly how long its round-trip takes. The
          // lead only delays the shared start time; it cannot buy answer time.
          const rtt=Number.isFinite(body.rtt)?Math.min(4000,Math.max(0,body.rtt)):0;
          q.start=now+Math.max(400,Math.min(2000,Math.round(rtt/2+300)));
          result={startAt:q.start,choices:q.choices,next};
        }else if(post && path==="answer"){
          if(!q.start || arrival<q.start || !Number.isInteger(body.choice) || body.choice < -1 || body.choice>3) fail(400,"本题尚未开始或答案无效。");
          const correctIndex=q.choices.indexOf(q.name);
          const sample=timing.get(id);
          const credit=row.scoring_version===POINTS_VERSION && sample?.index===idx && sample.receivedAt<=arrival ? sample.creditMs : 0;
          const networkCreditMs=Math.min(credit,arrival-q.start);
          const elapsedMs=arrival-q.start-networkCreditMs;
          const earned=earnedPoints(elapsedMs,body.choice===correctIndex,row.scoring_version);
          const outcome=earned>0 ? "correct" : row.scoring_version!==HOT_VERSION && (elapsedMs>10000 || (body.choice===-1 && body.timeout===true))
            ? "timeout" : body.choice===-1 ? "skipped" : "wrong";
          row.score+=earned;
          row.hits+=Number(earned>0);
          row.cursor++;
          row.finished=Number(row.cursor===ROUND_SIZE);
          const next=row.finished ? null : view(row,questions[row.cursor]);
          result=q.result={correctIndex,earned,score:row.score,correct:row.hits,done:!!row.finished,name:q.name,trackId:q.id,next,
            elapsedMs,choice:body.choice,outcome,...(networkCreditMs>0 ? {networkCreditMs} : {})};
          insertBest=!!row.finished;
          if(insertBest) result.details=roundDetails(questions,row.scoring_version);
        }else fail(404,"没有此操作。");
        const updated=JSON.stringify(questions);
        const write=db.prepare("UPDATE games SET questions=?,cursor=?,score=?,hits=?,finished=?,updated=?,version=version+1 WHERE id=? AND version=?")
          .bind(updated,row.cursor,row.score,row.hits,row.finished,now,row.id,row.version);
        const queries=[write];
        const best=scoreTable(row.scoring_version);
        if(insertBest) queries.push(db.prepare(`INSERT INTO ${best}(owner,score,hits,achieved)
          SELECT owner,score,hits,updated FROM games WHERE id=? AND finished=1
          ON CONFLICT(owner) DO UPDATE SET score=excluded.score,hits=excluded.hits,achieved=excluded.achieved
          WHERE excluded.score>${best}.score OR (excluded.score=${best}.score AND excluded.hits>${best}.hits)`).bind(id));
        if(insertBest && row.scoring_version===POINTS_VERSION){
          const start=shanghaiWeekStart(now);
          queries.push(db.prepare(`INSERT INTO weekly_best(week_start,owner,score,hits,achieved)
            SELECT ?,owner,score,hits,updated FROM games WHERE id=? AND finished=1 AND updated>=? AND updated<?
            ON CONFLICT(week_start,owner) DO UPDATE SET score=excluded.score,hits=excluded.hits,achieved=excluded.achieved
            WHERE excluded.score>weekly_best.score OR (excluded.score=weekly_best.score AND excluded.hits>weekly_best.hits)`)
            .bind(start,id,start,start+WEEK_MS));
        }
        const outcome=await db.batch(queries);
        if(outcome[0].meta.changes){
          if(path==="start") {
            result.serverNow=Date.now();
            result.processingMs=result.serverNow-arrival;
            if(row.scoring_version===POINTS_VERSION){
              timing.delete(id);
              if(timing.size>=MAX_TIMING_ROUNDS) timing.delete(timing.keys().next().value);
              result.timingNonce=crypto.randomUUID();
              timing.set(id,{player,index:idx,nonce:result.timingNonce,sentAt:result.serverNow});
            }
          }
          if(insertBest) timing.delete(id);
          return json(result || view(row,questions[idx]));
        }
      }
      fail(409,"另一页面正在操作本局，请重试。");
    } catch(error){
      return json({error:error instanceof Problem?error.message:"服务暂时不可用，请重试。"},error.status||503);
    }
  };
}

