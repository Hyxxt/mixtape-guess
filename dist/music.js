"use strict";

// Deezer artist 75172 is Eason Chan. Offsets are relative to each official preview.
const library = [
  {name:"富士山下", id:7278824, offset:6.3},
  {name:"好久不见", id:1100108, offset:12.9},
  {name:"葡萄成熟时", id:13675223, offset:2.4},
  {name:"浮夸", id:13675222, offset:8.6},
  {name:"单车", id:672506742, offset:18.9, version:"Get A Life 现场版"},
  {name:"孤勇者", id:1571246282, offset:18},
  {name:"淘汰", id:1100103, offset:7.2},
  {name:"红玫瑰", id:1100105, offset:9}
];
const clipLength = 10;
let audioContext, masterGain, voice, startTime, playbackOffset = 0, muted = false;
async function prepareAudio() {
  audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
  if (!masterGain) {
    masterGain = audioContext.createGain();
    masterGain.gain.value = muted ? 0 : .82;
    masterGain.connect(audioContext.destination);
  }
  if (audioContext.state !== "running") await audioContext.resume();
}

// The API offers JSONP. Isolate the provider script in an opaque-origin frame.
function resolvePreview(song, signal) {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.hidden = true;
    frame.title = "解析原唱试听";
    frame.setAttribute("sandbox", "allow-scripts");
    const cancel = () => {cleanup(); reject(new Error("试听加载已取消"));};
    function cleanup() {
      window.removeEventListener("message", receive);
      signal.removeEventListener("abort", cancel);
      frame.remove();
    }
    function receive(event) {
      if (event.source !== frame.contentWindow || event.origin !== "null") return;
      const url = event.data?.preview;
      cleanup();
      if (typeof url === "string" && /^https:\/\/[\w.-]+\.dzcdn\.net\//.test(url)) resolve(url);
      else reject(new Error("试听暂不可用"));
    }
    if (signal.aborted) {cancel(); return;}
    signal.addEventListener("abort", cancel, {once:true});
    window.addEventListener("message", receive);
    const api = "https://api.deezer.com/track/"+song.id+"?output=jsonp&amp;callback=track&amp;v="+Math.floor(Date.now()/300000);
    frame.srcdoc = '<meta charset="utf-8"><script>function track(t){parent.postMessage({preview:t.id==='+song.id+' && t.artist?.id===75172 ? t.preview : null},"*")}<\/script>'
      + '<script src="'+api+'" onerror="parent.postMessage({preview:null},\'*\')"><\/script>';
    document.body.append(frame);
  });
}
async function loadClip(song, signal) {
  const url = await resolvePreview(song, signal);
  const response = await fetch(url, {signal, credentials:"omit", cache:"no-store"});
  if (!response.ok) throw new Error("试听读取失败");
  const recording = await audioContext.decodeAudioData(await response.arrayBuffer());
  if (recording.duration + .02 < song.offset + clipLength) throw new Error("试听片段过短");
  return recording;
}
function elapsed() {
  return voice ? Math.min(clipLength, playbackOffset + audioContext.currentTime - startTime) : playbackOffset;
}
function stopAudio(reset = true) {
  if (voice) {
    playbackOffset = elapsed();
    voice.onended = null;
    voice.stop();
    voice.disconnect();
    voice = null;
  }
  if (reset) playbackOffset = 0;
}
function startAudio(buffer, offset, onEnd) {
  if (playbackOffset >= clipLength - .01) playbackOffset = 0;
  voice = audioContext.createBufferSource();
  voice.buffer = buffer;
  voice.connect(masterGain);
  voice.onended = () => {voice.disconnect(); voice = null; playbackOffset = clipLength; onEnd();};
  startTime = audioContext.currentTime;
  voice.start(0, offset + playbackOffset, clipLength - playbackOffset);
}
function toggleMute() {
  muted = !muted;
  if (masterGain) masterGain.gain.setTargetAtTime(muted ? 0 : .82, audioContext.currentTime, .012);
  return muted;
}
