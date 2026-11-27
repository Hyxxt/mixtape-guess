"use strict";

const clipSeconds = 10;
// Deezer previews are 128 kbps CBR, so bytes map to time at ~16 KB/s.
// Fetching a window around the answer offset avoids downloading the full 30s
// preview when only ten seconds are played.
const previewBytesPerSecond = 16000;
const rangeLeadSeconds = 1.5;
const player = (() => {
  let context, gain, source, muted = false;

  function audio() {
    if (!context) {
      const AudioEngine = window.AudioContext || window.webkitAudioContext;
      context = new AudioEngine({latencyHint:"interactive"});
      gain = context.createGain();
      gain.gain.value = muted ? 0 : .82;
      gain.connect(context.destination);
    }
    return context;
  }

  async function unlock() {
    const audioContext = audio();
    if (audioContext.state !== "running") await audioContext.resume();
  }

  async function fetchRecording(url, signal, priority, range) {
    try {
      const response = await fetch(url, {
        signal, credentials:"omit", priority,
        ...(range ? {headers:{Range:range}} : {})
      });
      if (response.ok) return response;
      if (!range) throw new Error("音频加载失败");
    } catch (error) {
      if (signal.aborted || !range) throw error;
    }
    // Range can be rejected by a proxy/CDN; fall back to the full preview.
    return fetch(url, {signal, credentials:"omit", priority});
  }

  async function load(question, signal, priority) {
    const url = new URL(question.previewPath, location.href);
    if (url.origin !== location.origin) throw new Error("试听地址有误");
    const response = await fetch(url, {signal, cache:"no-store"});
    if (!response.ok) throw new Error("原唱试听暂时不可用");
    const metadata = await response.json();
    const offset=Math.max(0, Number(question.offset)||0);
    const rangeStartSeconds=Math.max(0, offset-rangeLeadSeconds);
    const rangeStart=Math.round(rangeStartSeconds*previewBytesPerSecond);
    const rangeEnd=Math.round((offset+clipSeconds+rangeLeadSeconds)*previewBytesPerSecond)-1;
    let recording=await fetchRecording(metadata.url, signal, priority, "bytes="+rangeStart+"-"+rangeEnd);
    if (!recording.ok) throw new Error("音频加载失败");
    let partial=recording.status===206;
    let decoded=await audio().decodeAudioData(await recording.arrayBuffer());
    if(signal.aborted) throw new DOMException("试听已取消","AbortError");
    let startInDecoded=partial ? Math.max(0, offset-rangeStartSeconds) : offset;
    if (partial && decoded.duration < startInDecoded+clipSeconds-0.05) {
      // A short/VBR preview or a bad byte estimate; retry with the full file.
      partial=false;
      recording=await fetchRecording(metadata.url, signal, priority, null);
      if (!recording.ok) throw new Error("音频加载失败");
      decoded=await audio().decodeAudioData(await recording.arrayBuffer());
      if(signal.aborted) throw new DOMException("试听已取消","AbortError");
      startInDecoded=offset;
    }
    if (decoded.duration < clipSeconds) throw new Error("原唱试听长度不足");
    // Retain only the excerpt while this song and the next song are in memory.
    const length=Math.round(decoded.sampleRate*clipSeconds);
    const first=Math.min(Math.round(startInDecoded*decoded.sampleRate),decoded.length-length);
    const excerpt=audio().createBuffer(decoded.numberOfChannels,length,decoded.sampleRate);
    for(let channel=0;channel<decoded.numberOfChannels;channel++){
      excerpt.copyToChannel(decoded.getChannelData(channel).subarray(first,first+length),channel);
    }
    return {buffer:excerpt,offset:0};
  }

  function stop() {
    if (!source) return;
    source.onended = null;
    source.stop();
    source.disconnect();
    source = null;
  }

  function start(clip, delay, elapsed, onEnd) {
    stop();
    const node = audio().createBufferSource();
    node.buffer = clip.buffer;
    node.connect(gain);
    node.onended = () => {
      node.disconnect();
      source = null;
      onEnd();
    };
    source = node;
    node.start(context.currentTime + delay, clip.offset + elapsed, clipSeconds - elapsed);
  }
  function toggleMute() {
    muted = !muted;
    if (gain) gain.gain.setTargetAtTime(muted ? 0 : .82, context.currentTime, .01);
    return muted;
  }
  return {unlock, load, start, stop, toggleMute};
})();
