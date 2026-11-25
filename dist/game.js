"use strict";
const $ = id => document.getElementById(id);
const icon = name => '<svg aria-hidden="true"><use href="#'+name+'"/></svg>';
const pad = value => String(value).padStart(2, "0");
const roundSize = 5, historyKey = "blind-test-fm.eason.history.v1";
let songs, index, points, answered, completed, buffer, generation = 0, pending = false, frame;
let loader = null;
let historyLog = [];
try {
  const saved = JSON.parse(localStorage.getItem(historyKey));
  if (Array.isArray(saved)) historyLog = saved.filter(r => Number.isInteger(r.right) && r.right >= 0 && r.right <= 5 && Number.isFinite(r.time)).slice(0,50);
} catch {}
function shuffled(items) {
  const result = [...items];
  for (let i = result.length-1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i+1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
function wave() {
  const position = elapsed();
  $("elapsed").textContent = "00:"+pad(Math.floor(position));
  const bars = $("waveform").children;
  for(let i=0;i<bars.length;i++) bars[i].classList.toggle("heard", i/bars.length < position/clipLength);
  if(voice) frame = requestAnimationFrame(wave);
}
function updatePlayer() {
  cancelAnimationFrame(frame);
  const atEnd = playbackOffset >= clipLength - .01;
  const label = pending ? "正在加载原唱…" : voice ? "暂停播放" : atEnd ? "重听片段" : playbackOffset > 0 ? "继续播放" : "播放原唱";
  $("playBtn").innerHTML = icon(voice ? "pause" : atEnd ? "repeat" : "play") + label;
  $("playBtn").disabled = pending;
  $("status").textContent = pending ? "LOADING" : voice ? "PLAYING" : atEnd ? "REPLAY" : playbackOffset ? "PAUSED" : "READY";
  wave();
}
function cancelLoad() {
  generation++;
  loader?.abort();
  loader = null;
  pending = false;
}
async function play() {
  if (voice) { stopAudio(false); updatePlayer(); return; }
  if (pending) return;
  const current = generation;
  const song = songs[index];
  loader = new AbortController();
  const request = loader;
  const timeout = setTimeout(() => request.abort(), 20000);
  pending = true;
  updatePlayer();
  try {
    await prepareAudio();
    if (current !== generation) return;
    const recording = buffer || await loadClip(song, request.signal);
    if (current !== generation || request.signal.aborted) return;
    buffer = recording;
    if (!answered) $("feedback").textContent = "听原唱，选出你的答案。";
    startAudio(buffer, song.offset, updatePlayer);
  } catch {
    if (current === generation) $("feedback").textContent = "原唱试听加载失败，请检查网络后重试。";
  } finally {
    clearTimeout(timeout);
    if(current === generation) { pending = false; loader = null; updatePlayer(); }
  }
}
function startRound() {
  songs = shuffled(library).slice(0,roundSize); index = 0; points = 0; completed = false;
  showQuestion();
}
function showQuestion() {
  cancelLoad(); stopAudio(); buffer = null; answered = false;
  $("track").textContent = "TRACK "+pad(index+1)+" / "+pad(roundSize);
  $("mystery").textContent = "神秘曲目 "+pad(index+1);
  $("points").textContent = String(points).padStart(3,"0");
  $("feedback").textContent = "听原唱，选出你的答案。";
  $("skipBtn").innerHTML = '跳过此题'+icon("skip");
  const song = songs[index];
  const others = shuffled(library.filter(s => s !== song)).slice(0,3);
  const buttons = shuffled([song,...others]).map((s,i) => {
    const btn = document.createElement("button");
    btn.className = "opt"; btn.dataset.name = s.name;
    btn.innerHTML = '<span class="letter">'+"ABCD"[i]+'</span>'+s.name;
    btn.addEventListener("click", () => answer(s.name));
    return btn;
  });
  $("options").replaceChildren(...buttons);
  const bars = Array.from({length:80}, (_,i) => {
    const bar = document.createElement("i");
    const contour = .26+.74*Math.abs(Math.sin(i*.112+.55)*Math.cos(i*.064-.6));
    const detail = Math.abs(Math.sin((i+11)*(index+1)*7.39)*.78)+.22;
    bar.style.height = (3+61*contour*detail)+"px";
    return bar;
  });
  $("waveform").replaceChildren(...bars);
  updatePlayer();
}
function answer(name) {
  if(answered) return;
  answered = true;
  cancelLoad();
  stopAudio(false); updatePlayer();
  const correct = songs[index].name;
  if(name === correct) points += 100;
  $("points").textContent = String(points).padStart(3,"0");
  for(const btn of $("options").children) {
    btn.disabled = true;
    if(btn.dataset.name === correct) {btn.classList.add("correct");btn.innerHTML += "<small>✓ 正解</small>";}
    else if(btn.dataset.name === name) {btn.classList.add("wrong");btn.innerHTML += "<small>✕</small>";}
  }
  $("feedback").textContent = name === correct ? "猜对了！+100 分" : (name ? "正确答案是" : "已跳过，答案是")+"《"+correct+"》。";
  const song = songs[index];
  const source = document.createElement("a");
  source.href = "https://www.deezer.com/track/"+song.id;
  source.target = "_blank";
  source.rel = "noopener noreferrer";
  source.textContent = song.version || "听完整歌曲";
  $("feedback").append(" ", source);
  $("skipBtn").textContent = index === roundSize-1 ? "查看成绩" : "下一首";
  if (index === roundSize-1) {
    completed = true;
    historyLog.unshift({time:Date.now(),right:points/100});
    historyLog = historyLog.slice(0,50);
    try {localStorage.setItem(historyKey, JSON.stringify(historyLog));} catch {}
  }
}
function next() {
  if(!answered) {answer(null);return;}
  if(completed) {showResults();return;}
  index++;showQuestion();$("playBtn").focus({preventScroll:true});
}
function showModal(html) {
  cancelLoad();
  if(voice) stopAudio(false);
  updatePlayer();
  $("modalContent").innerHTML = html;
  if(!$("modal").open) $("modal").showModal();
}
function showResults() {
  showModal('<h2>陈奕迅专场成绩</h2><div class="bigscore">'+points+' <small>/ 500 分</small></div><p>五首旋律里，你猜中了 '+points/100+' 首。</p><button class="resultbtn" id="again">再来一局</button>');
  $("again").onclick = () => {$("modal").close();startRound();$("playBtn").focus();};
}
$("playBtn").onclick = play;
$("skipBtn").onclick = next;
$("muteBtn").onclick = () => {
  const m = toggleMute(), label = m ? "取消静音" : "静音";
  $("muteBtn").innerHTML = icon(m ? "mute" : "vol");
  $("muteBtn").setAttribute("aria-label",label);$("muteBtn").title=label;
};
$("history").onclick = () => {
  const rows = historyLog.map(r=>'<div class="logrow"><span>'+new Date(r.time).toLocaleString("zh-CN",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"})+'</span><span>猜中 '+r.right+'/5 首</span><b>'+r.right*100+' 分</b></div>').join("");
  showModal("<h2>陈奕迅专场战绩</h2>"+(rows ? "<p>本机最近的 "+historyLog.length+" 局挑战</p>"+rows : "<p>还没有完成的挑战。猜完五首后，你的第一条战绩就会出现在这里。</p>"));
};
$("helpBtn").onclick = () => showModal('<h2>玩法说明</h2><ol><li>点击「播放原唱」，联网听陈奕迅亲自演唱的 10 秒片段，可暂停或重听。</li><li>从四个歌名中选出答案。每题只能作答一次，猜对得 100 分，跳过得 0 分。</li><li>每局随机抽取五首，满分 500 分。完成后可在「我的战绩」回顾成绩。</li></ol>');
$("lobby").onclick = () => {if($("modal").open) $("modal").close();$("game").scrollIntoView({block:"nearest"});};
$("close").onclick = () => $("modal").close();
$("modal").addEventListener("click",event => {if(event.target === $("modal")) {const r = $("modal").getBoundingClientRect(); if(event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) $("modal").close();}});
document.addEventListener("visibilitychange",()=>{if(document.hidden && (voice || pending)){cancelLoad();stopAudio(false);updatePlayer();}});
startRound();
