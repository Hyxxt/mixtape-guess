"use strict";

const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2,"0");
const icon = name => '<svg aria-hidden="true"><use href="#'+name+'"/></svg>';
const modal = $("modal");
const practiceHistory = "blind-test-fm.eason.history.v1";
let mode = "ranked", phase = "home", nickname = "", question = null, clip = null;
let score = 0, correctCount = 0, picked = null, progress = 0, startedAt = 0;
let timer, clock, barIndex = 0, generation = 0, nextPrepared = null, controller = new AbortController();
let catalogPromise, pool, practiceSongs, currentResult, lastFailure, modalVersion = 0;
let activeAnswer, profileReady = false;
let advanceTimer;
const reviewDuration = 1500;
const isRanked = () => mode === "ranked";
const total = () => isRanked() ? 10 : 5;
const buttons = () => [...$("options").querySelectorAll("button")];
function node(tag, value, className) {
  const item = document.createElement(tag);
  if (value !== null && value !== undefined) item.textContent = value;
  if (className) item.className = className;
  return item;
}
function action(label, callback) {
  const b = node("button",label,"resultbtn");
  b.type = "button"; b.onclick = callback;
  return b;
}
async function withDeadline(parent, milliseconds, work) {
  const request=new AbortController();
  const cancel=()=>request.abort();
  if(parent?.aborted) cancel();
  else parent?.addEventListener("abort",cancel,{once:true});
  const timeout=setTimeout(cancel,milliseconds);
  try{return await work(request.signal);}
  finally{clearTimeout(timeout);parent?.removeEventListener("abort",cancel);}
}
function api(path, data, parent) {
  return withDeadline(parent,13000,async signal=>{
    const request = await fetch("/api/"+path,{
      method:data === undefined ? "GET" : "POST",
      credentials:"same-origin", cache:"no-store",
      signal,
      headers:data === undefined ? {} : {"Content-Type":"application/json"},
      body:data === undefined ? undefined : JSON.stringify(data)
    });
    const payload = await request.json().catch(()=>({}));
    if (!request.ok) throw new Error(payload.error || "连接失败，请稍后重试。");
    return payload;
  });
}
function shuffled(items) {
  const copy = [...items];
  for (let i=copy.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [copy[i],copy[j]]=[copy[j],copy[i]]; }
  return copy;
}
async function getCatalog() {
  catalogPromise ??= fetch("catalog.json").then(async response=>{
    if (!response.ok) throw new Error("曲库未能加载");
    const data = await response.json();
    if (!Array.isArray(data) || data.length < 5) throw new Error("曲库暂不可用");
    return data;
  }).catch(err=>{catalogPromise=null;throw err;});
  return catalogPromise;
}
function showDialog(title, ...content) {
  clearTimeout(advanceTimer);
  modalVersion++;
  $("modalContent").replaceChildren(node("h2",title), ...content);
  if (!modal.open) modal.showModal();
  return modalVersion;
}
function closeDialog() {
  modalVersion++;
  if (modal.open) modal.close();
}
function rememberHistory(right) {
  const rows = historyRows();
  rows.unshift({time:Date.now(),right});
  try {localStorage.setItem(practiceHistory, JSON.stringify(rows.slice(0,50)));} catch {}
}
function historyRows() {
  try {
    const saved=JSON.parse(localStorage.getItem(practiceHistory));
    return Array.isArray(saved) ? saved.filter(v=>v && Number.isInteger(v.right) && v.right>=0 && v.right<=5 && Number.isFinite(v.time)) : [];
  } catch {return [];}
}
function displayWave(milliseconds) {
  const count=$("waveform").children.length;
  const end=Math.min(count,Math.max(0,Math.floor(count*milliseconds/10000)));
  if (end < barIndex) {
    for(let i=end;i<barIndex;i++) $("waveform").children[i].classList.remove("heard");
  } else {
    for(let i=barIndex;i<end;i++) $("waveform").children[i].classList.add("heard");
  }
  barIndex=end;
  const value=pad(Math.max(0, Math.min(10, isRanked() ? Math.ceil((10000-milliseconds)/1000) : Math.floor(milliseconds/1000))));
  const text="00:"+value;
  if ($("elapsed").textContent !== text) $("elapsed").textContent=text;
}
function newWave(seed) {
  const fragment=document.createDocumentFragment();
  for(let i=0;i<52;i++) {
    const bar=node("i");
    const envelope=.22+.78*Math.abs(Math.sin(i*.112+.55)*Math.cos(i*.064-.6));
    bar.style.height=(4+57*envelope*(.22+.78*Math.abs(Math.sin((i+11)*(seed+1)*7.39))))+"px";
    fragment.append(bar);
  }
  $("waveform").replaceChildren(fragment);barIndex=0; displayWave(0);
}
function stopClock() {clearInterval(clock);clearTimeout(timer);}
function reset() {
  clearTimeout(advanceTimer);
  generation++;controller.abort();controller=new AbortController();stopClock();player.stop();
  phase="home";question=null;clip=null;nextPrepared=null;currentResult=null;picked=null;
  activeAnswer=null;score=0;correctCount=0;progress=0;startedAt=0;lastFailure=null;
}
function playControl(label, symbolName, disabled=false) {
  const btn=$("playBtn");btn.innerHTML=icon(symbolName)+label;btn.disabled=disabled;
}
function skipControl(label,hidden=false) {
  const button=$("skipBtn");button.textContent=label;button.hidden=hidden;button.style.display=hidden?"none":"";
}
function setProfile(name) {
  nickname=name || "";
  const label=$("profile").querySelector("[data-label]");
  (label || $("profile")).textContent=nickname || "游客昵称";
}
function setModeUI() {
  for(const id of ["ranked","practice"]) {
    $(id).classList.toggle("active",mode===id);
    $(id).setAttribute("aria-pressed",String(mode===id));
  }
  $("modeTitle").textContent=isRanked() ? "限时排名赛" : "自由练习";
  $("roundCount").textContent=String(total());
  $("track").textContent="TRACK "+pad((question?.index || 0)+1)+" / "+pad(total());
  $("points").textContent=String(score).padStart(3,"0");
}
function showHome() {
  document.body.classList.remove("in-game");
  setModeUI();newWave(0);
  document.querySelector(".choices h3").textContent="计分规则";
  $("mystery").textContent=isRanked() ? "十秒猜歌挑战" : "原唱自由练习";
  $("status").textContent="READY";
  $("feedback").textContent=isRanked() ? "每局 10 题，答完即可上榜。" : "每局 5 题，可暂停、重听。";
  const samples=isRanked() ? [["第 1 秒","10 分"],["第 2 秒","9 分"],["第 10 秒","1 分"],["答错或超时","0 分"]] :
    [["每局曲目","5 首"],["每题片段","10 秒"],["每题答对","100 分"],["最高得分","500 分"]];
  const lines=samples.map(([key,value])=>{const row=node("div",null,"logrow");row.append(node("span",key),node("b",value));return row;});
  $("options").replaceChildren(...lines);
  playControl(isRanked()?"开始排名赛":"开始练习","play");skipControl("",true);
}
function notifyError(message,retry) {
  phase="error";lastFailure=retry;
  stopClock();player.stop();
  buttons().forEach(b=>b.disabled=true);
  $("status").textContent="RETRY";
  $("feedback").textContent=message;
  playControl("重试","repeat");skipControl("",true);
}
function chooseMode(target) {
  if(mode===target) return;
  function switchNow() {closeDialog();reset();mode=target;showHome();}
  if(phase==="home" || phase==="finished" || (phase==="review" && currentResult?.done)) {switchNow();return;}
  showDialog("退出当前挑战？",node("p","切换模式会结束当前这一局。"),action("切换模式",switchNow),action("继续当前挑战",closeDialog));
}
function profileForm(after) {
  const form=node("form"), label=node("label","排行榜昵称"), field=node("input"), alert=node("p");
  label.htmlFor="playerNickname";field.id="playerNickname";field.name="nickname";field.autocomplete="nickname";
  field.value=nickname;field.placeholder="输入 1–16 个字";field.required=true;
  field.style.cssText="display:block;width:100%;font:inherit;margin:8px 0 4px;padding:9px;border:1px solid;border-radius:6px";
  const save=node("button",after?"保存并开始排名赛":"保存昵称","resultbtn");
  save.type="submit";alert.setAttribute("role","status");
  form.append(label,field,alert,save);showDialog(nickname?"我的昵称":"设置参赛昵称",node("p","成绩会以这个昵称显示在总榜。"),form);
  field.focus();
  form.onsubmit=async event=>{
    event.preventDefault();const name=field.value.trim();
    if (!name || Array.from(name).length>16) {alert.textContent="请输入 1–16 个字。";return;}
    save.disabled=true;alert.textContent="";
    const version=modalVersion;
    if(after) player.unlock().catch(()=>{});
    try {
      const me=await api("join",{nickname:name});setProfile(me.nickname);profileReady=true;
      if (!modal.open || version!==modalVersion) return;
      closeDialog();if(after) after();
    } catch(e) {alert.textContent=e.message;}
    finally {save.disabled=false;}
  };
}
async function loadMe() {
  const me=await api("me");
  setProfile(me.nickname);profileReady=true;
  if(Number.isFinite(me.count)) $("catalogCount").textContent=String(me.count);
}
function practiceQuestion(index) {
  const song=practiceSongs[index];
  const distractors=shuffled(pool.filter(v=>v.name!==song.name));
  const names=[...new Set(distractors.map(v=>v.name))].slice(0,3);
  const choices=shuffled([song.name,...names]);
  return {index,total:5,choices,score,offset:song.offset,previewPath:"/api/preview?id="+song.id,answer:song.name,trackId:song.id};
}
function timedLoad(q,parent,priority="auto") {
  return withDeadline(parent,18000,signal=>player.load(q,signal,priority));
}
function showQuestion(q) {
  document.body.classList.add("in-game");
  document.querySelector(".choices h3").textContent="这是哪首歌？";
  question=q;currentResult=null;picked=null;activeAnswer=null;progress=0;startedAt=0;clip=null;phase="loading";
  stopClock();player.stop();setModeUI();newWave(q.index);
  $("mystery").textContent="神秘曲目 "+pad(q.index+1);
  $("status").textContent="BUFFERING";$("feedback").textContent="正在准备原唱，加载时间不计入作答。";
  const list=q.choices.map((name,i)=>{
    const b=node("button",null,"opt");b.type="button";b.disabled=true;
    b.append(node("span","ABCD"[i],"letter"),node("span",isRanked()?"播放后揭晓":name));
    b.onclick=()=>answer(i);return b;
  });
  $("options").replaceChildren(...list);
  playControl("正在准备原唱…","play",true);skipControl("",true);
}
function nextPacket(index, preparedQuestion) {
  const signal=controller.signal;
  // Resolve failures to values so background prefetch never leaks an unhandled rejection.
  return (async()=>{
    let q;
    try {
      q=preparedQuestion || (isRanked() ? await api("next",{round:question.round,index},signal) : practiceQuestion(index));
      const audio=await timedLoad(q,signal,"low");
      return {q,audio};
    } catch(error) {return {q,error};}
  })();
}
async function opening() {
  const token=generation;
  phase="opening";playControl("正在准备挑战…","play",true);
  try {
    let q;
    if (isRanked()) {
      if (!profileReady) await loadMe();
      if(token!==generation) return;
      if (!nickname) {phase="home";showHome();profileForm(begin);return;}
      q=await api("round",{},controller.signal);
    } else {
      pool=await getCatalog();if(token!==generation)return;
      practiceSongs=shuffled(pool).slice(0,5);
      q=practiceQuestion(0);
    }
    if(token!==generation) return;
    await prepareQuestion(q);
  } catch(e) {if(token===generation)notifyError(e.message,begin);}
}
function begin() {
  reset();player.unlock().catch(()=>{});opening();
}
async function prepareQuestion(q, preloaded) {
  const token=generation;
  showQuestion(q);
  try {
    const audio=preloaded || await timedLoad(q, controller.signal);
    if(token!==generation || question!==q) return;
    clip=audio;phase="ready";
    if(modal.open || document.hidden) {readyMessage();return;}
    await playCurrent();
  } catch(e) {
    if(token!==generation || question!==q) return;
    notifyError("这首歌的原唱暂时无法加载，可重试或换一首。",()=>prepareQuestion(q));
    skipControl("换一首");
  }
}
function readyMessage() {
  $("status").textContent="READY";$("feedback").textContent="原唱已就绪，点击播放。";
  playControl("播放原唱","play");skipControl("",true);
}
async function replaceQuestion() {
  const old=question, token=generation;
  phase="loading";skipControl("",true);playControl("正在换歌…","repeat",true);
  try {
    let next;
    if(isRanked()) next=await api("replace",{round:old.round,index:old.index},controller.signal);
    else {
      const reserved=new Set(practiceSongs.map(s=>s.id));
      const alternatives=pool.filter(s=>!reserved.has(s.id));
      if(!alternatives.length) throw new Error("没有其他可替换的歌曲。");
      practiceSongs[old.index]=alternatives[Math.floor(Math.random()*alternatives.length)];
      next=practiceQuestion(old.index);
    }
    if(token===generation) await prepareQuestion(next);
  } catch(e) {if(token===generation) {notifyError(e.message,replaceQuestion);skipControl("换一首");}}
}
function remainingPosition() {
  return phase==="live" || phase==="scheduled" ? Math.min(10000,Math.max(0,performance.now()-startedAt)) : progress;
}
function revealOptions() {
  for (const [i,b] of buttons().entries()) {
    b.children[1].textContent=question.choices[i];b.disabled=false;
  }
}
function renderLive() {
  phase="live";revealOptions();
  $("status").textContent="ON AIR";
  $("feedback").textContent=isRanked() ? "倒计时内选出答案。" : "听原唱，选出你的答案。";
  playControl(isRanked()?"限时答题中":"暂停播放",isRanked()?"clock":"pause",isRanked());
  skipControl(isRanked()?"放弃本题":"跳过本题");
}
function tick() {
  if(phase!=="scheduled" && phase!=="live")return;
  if(phase==="scheduled" && performance.now()>=startedAt) renderLive();
  const pos=remainingPosition();
  displayWave(pos);
  if(pos>=10000) finishPlayback();
}
function finishPlayback() {
  if(phase!=="live" && phase!=="scheduled")return;
  progress=10000;displayWave(progress);stopClock();player.stop();
  if(isRanked()) {answer(-1);return;}
  phase="ready";revealOptions();
  $("status").textContent="REPLAY";playControl("重听片段","repeat");skipControl("跳过本题");
}
async function playCurrent() {
  if(!clip || (phase!=="ready" && phase!=="paused" && phase!=="startRetry"))return;
  const token=generation, q=question, previous=phase;
  phase="starting";playControl("准备播放…","play",true);skipControl("",true);
  try {
    await player.unlock();
    if(token!==generation || question!==q)return;
    let elapsed=progress===10000?0:progress, delay=0;
    let upcoming;
    if(isRanked()) {
      const before=performance.now();
      const scheduled=await api("start",{round:q.round,index:q.index},controller.signal);
      if(token!==generation || question!==q)return;
      q.choices=scheduled.choices;
      upcoming=scheduled.next;
      const received=performance.now();
      const estimatedServer=scheduled.serverNow+(received-before)/2;
      const untilStart=scheduled.startAt-estimatedServer;
      delay=Math.max(0,untilStart);elapsed=Math.max(0,-untilStart);
    }
    startedAt=performance.now()+delay-elapsed;phase="scheduled";
    if(elapsed>=10000) {finishPlayback();return;}
    player.start(clip,delay/1000,elapsed/1000,finishPlayback);
    $("status").textContent=delay>0?"GET READY":"ON AIR";
    if(delay<=0)renderLive();
    clock=setInterval(tick,125);
    timer=setTimeout(finishPlayback,Math.max(0,startedAt+10000-performance.now()));
    tick();
    if(q.index+1<q.total && (!isRanked() || upcoming)) {
      nextPrepared ??= nextPacket(q.index+1,upcoming);
    }
  } catch(e) {
    if(token!==generation || question!==q)return;
    phase=isRanked()?"startRetry":previous;stopClock();player.stop();
    $("feedback").textContent="未能开始播放，点击重试。";$("status").textContent="RETRY";playControl("重试播放","repeat");
  }
}
function pausePractice() {
  if(isRanked() || phase!=="live")return;
  progress=remainingPosition();stopClock();player.stop();phase="paused";displayWave(progress);
  $("status").textContent="PAUSED";playControl("继续播放","play");skipControl("跳过本题");
}
function answer(choice) {
  if (isRanked() && phase!=="live" && !(choice===-1 && phase==="scheduled"))return;
  if (!isRanked() && !["live","paused","ready"].includes(phase))return;
  if(isRanked() && remainingPosition()>=10000)choice=-1;
  progress=remainingPosition();stopClock();player.stop();displayWave(progress);
  picked=choice;phase="submitting";buttons().forEach((b,i)=>{b.disabled=true;b.classList.toggle("chosen",i===choice);});skipControl("",true);
  if(isRanked()) {
    activeAnswer={round:question.round,index:question.index,choice};
    settle();return;
  }
  const correctIndex=question.choices.indexOf(question.answer);
  const earned=choice===correctIndex?100:0;
  finalAnswer({earned,score:score+earned,correct:correctCount+Number(earned>0),correctIndex,name:question.answer,done:question.index===4});
}
async function settle() {
  if(!activeAnswer)return;
  const token=generation;
  phase="submitting";playControl("正在计分…","clock",true);
  try {
    const result=await api("answer",activeAnswer,controller.signal);
    if(token===generation) finalAnswer(result);
  } catch(e) {
    if(token!==generation)return;
    phase="submitRetry";$("status").textContent="RETRY";
    $("feedback").textContent="成绩尚未确认，请重试提交同一答案。";
    playControl("重新提交","repeat");
  }
}
function finalAnswer(result) {
  currentResult=result;activeAnswer=null;phase="review";score=result.score;correctCount=result.correct;
  for (const [i,b] of buttons().entries()) {
    b.classList.remove("chosen");
    b.disabled=true;b.children[1].textContent=question.choices[i];
    if(i===result.correctIndex) {b.classList.add("correct");b.append(node("small","✓ 正解"));}
    else if(i===picked) {b.classList.add("wrong");b.append(node("small","✕"));}
  }
  $("points").textContent=String(score).padStart(3,"0");
  $("status").textContent="RESULT";
  $("feedback").textContent=result.earned>0?"猜对了！+"+result.earned+" 分":"本题 0 分，答案是《"+result.name+"》。";
  const trackId=result.trackId||question.trackId;
  if(Number.isSafeInteger(trackId)){
    const source=node("a","听完整歌曲");
    source.href="https://www.deezer.com/track/"+trackId;
    source.target="_blank";source.rel="noopener noreferrer";
    $("feedback").append(" ",source);
  }
  playControl(result.done?"查看成绩":"下一题",result.done?"bars":"skip");skipControl("",true);
  if(result.done) {
    if(!isRanked())rememberHistory(correctCount);
    clip=null;nextPrepared=null;
  } else {
    clip=null;nextPrepared ??= nextPacket(question.index+1);
  }
  scheduleAdvance();
}
function scheduleAdvance() {
  clearTimeout(advanceTimer);
  if(phase!=="review" || modal.open || document.hidden)return;
  advanceTimer=setTimeout(()=>{
    if(phase==="review" && !modal.open && !document.hidden) advance();
  },reviewDuration);
}
async function advance() {
  if(phase!=="review")return;
  clearTimeout(advanceTimer);
  if(currentResult.done) {phase="finished";showResults();return;}
  const token=generation;
  phase="loading";playControl("正在准备下一题…","play",true);
  const takeNext=async()=>{
    const packet=await (nextPrepared || nextPacket(question.index+1));
    if(token!==generation)return;
    nextPrepared=null;
    if (!packet.q) {notifyError(packet.error?.message || "下一题加载失败。",takeNext);return;}
    await prepareQuestion(packet.q,packet.audio);
  };
  await takeNext();
}
function showResults() {
  const line=node("div",String(score),"bigscore");line.append(node("small"," / "+(isRanked()?"100":"500")+" 分"));
  const details=node("p","共 "+total()+" 题，答对 "+correctCount+" 题。"+(isRanked()?"本局已计入总榜。":""));
  const parts=[line,details,action("再来一局",()=>{closeDialog();begin();})];
  if(isRanked())parts.push(action("查看排行榜",showBoard));
  showDialog(isRanked()?"排名赛成绩":"练习成绩",...parts);
}
async function showBoard() {
  const content=node("div");content.append(node("p","正在读取排行榜…"));
  const version=showDialog("全站排行榜",content);
  try {
    const board=await api("board");
    if(version!==modalVersion || !modal.open)return;
    content.replaceChildren();
    if(board.mine)content.append(node("p","我的最高分 "+board.mine.score+" 分 · 第 "+board.mine.rank+" 名"));
    if(!board.rows.length) {content.append(node("p","还没有完赛记录。完成一局排名赛，即可率先上榜。"));return;}
    content.append(node("p","显示前 100 位。按个人最高分排名，同分时答对更多者优先，两项相同则并列。"));
    for(const row of board.rows) {
      const item=node("div",null,"logrow");
      item.append(node("b","#"+row.rank),node("span",row.nickname),node("strong",row.score+" 分"));
      content.append(item);
    }
  } catch(e) {if(version===modalVersion)content.replaceChildren(node("p","排行榜暂时无法读取。"),action("重新加载",showBoard));}
}
function showHistory() {
  const rows=historyRows();
  const container=node("div");
  if(!rows.length) container.append(node("p","本机还没有已完成的练习。"));
  rows.forEach(row=>{
    const item=node("div",null,"logrow");
    item.append(node("span",new Date(row.time).toLocaleDateString("zh-CN")),node("span","答对 "+row.right+" / 5"),node("b",row.right*100+" 分"));
    container.append(item);
  });
  showDialog("练习战绩",container);
}
$("playBtn").onclick=()=>{
  switch(phase) {
    case "home":begin();break;
    case "paused":case "ready":case "startRetry":playCurrent();break;
    case "live":pausePractice();break;
    case "submitRetry":settle();break;
    case "review":advance();break;
    case "finished":showResults();break;
    case "error":{const retry=lastFailure;lastFailure=null;if(retry)retry();break;}
  }
};
$("skipBtn").onclick=()=>{if(phase==="error")replaceQuestion();else answer(-1);};
$("ranked").onclick=()=>chooseMode("ranked");
$("practice").onclick=()=>chooseMode("practice");
$("board").onclick=showBoard;
$("history").onclick=showHistory;
$("profile").onclick=()=>profileForm();
$("helpBtn").onclick=()=>showDialog("玩法说明",node("p","排名赛每局 10 题，每题限时 10 秒。第 1 秒内答对得 10 分，第 2 秒得 9 分，依次递减，第 10 秒得 1 分。答错、放弃和超时均为 0 分。"),node("p","原唱加载完毕才开始计时。排名赛播放后不能暂停或重听。练习模式可自由暂停、重听，成绩保存在本机。"));
$("muteBtn").onclick=()=>{
  const mute=player.toggleMute(), label=mute?"取消静音":"静音";
  $("muteBtn").innerHTML=icon(mute?"mute":"vol");$("muteBtn").setAttribute("aria-label",label);$("muteBtn").title=label;
};
$("lobby").onclick=()=>{closeDialog();$("game").scrollIntoView({block:"nearest"});};
$("close").onclick=closeDialog;
modal.addEventListener("close",scheduleAdvance);
modal.addEventListener("click",e=>{if(e.target!==modal)return;const rect=modal.getBoundingClientRect();if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)closeDialog();});
document.addEventListener("visibilitychange",()=>{
  if(document.hidden)pausePractice();
  else if(isRanked() && (phase==="scheduled"||phase==="live"))tick();
  scheduleAdvance();
});
showHome();
loadMe().catch(()=>{});
