"use strict";

const clipSeconds = 10;
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

  async function load(question, signal, priority) {
    const url = new URL(question.previewPath, location.href);
    if (url.origin !== location.origin) throw new Error("试听地址有误");
    const response = await fetch(url, {signal, cache:"no-store"});
    if (!response.ok) throw new Error("原唱试听暂时不可用");
    const metadata = await response.json();
    const recording = await fetch(metadata.url, {signal, credentials:"omit",priority});
    if (!recording.ok) throw new Error("音频加载失败");
    const decoded = await audio().decodeAudioData(await recording.arrayBuffer());
    if(signal.aborted) throw new DOMException("试听已取消","AbortError");
    if (decoded.duration < clipSeconds) throw new Error("原唱试听长度不足");
    // Retain only the excerpt while this song and the next song are in memory.
    const length=Math.round(decoded.sampleRate*clipSeconds);
    const first=Math.min(Math.round(Math.max(0,question.offset || 0)*decoded.sampleRate),decoded.length-length);
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
