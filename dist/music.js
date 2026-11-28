"use strict";

const clipSeconds = 10;
const player = (() => {
  let context, gain, analyser, source, sourceGain, dataArray, muted = false;
  const bufferCache = new Map();
  const maxCacheSize = 12;

  function audio() {
    if (!context) {
      const AudioEngine = window.AudioContext || window.webkitAudioContext;
      context = new AudioEngine({ latencyHint: "interactive" });
      gain = context.createGain();
      gain.gain.value = muted ? 0 : 0.85;
      analyser = context.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.72;
      dataArray = new Uint8Array(analyser.frequencyBinCount);
      gain.connect(analyser);
      analyser.connect(context.destination);
    }
    return context;
  }

  async function unlock() {
    const ctx = audio();
    if (ctx.state !== "running") await ctx.resume();
  }

  function rememberCache(key, value) {
    if (bufferCache.has(key)) bufferCache.delete(key);
    bufferCache.set(key, value);
    if (bufferCache.size > maxCacheSize) {
      bufferCache.delete(bufferCache.keys().next().value);
    }
  }

  async function load(question, signal, priority) {
    const cacheKey = `${question.previewPath}|${question.offset || 0}`;
    if (bufferCache.has(cacheKey)) {
      return bufferCache.get(cacheKey);
    }

    const url = new URL(question.previewPath, location.href);
    if (url.origin !== location.origin) throw new Error("试听地址有误");
    const response = await fetch(url, { signal, cache: "no-store" });
    if (!response.ok) throw new Error("原唱试听暂时不可用");
    const metadata = await response.json();

    // 直接发起简单请求，避免 Range 请求头触发额外的 CORS OPTIONS 预检
    const recording = await fetch(metadata.url, {
      signal,
      credentials: "omit",
      priority
    });
    if (!recording.ok) throw new Error("音频加载失败");

    const decoded = await audio().decodeAudioData(await recording.arrayBuffer());
    if (signal.aborted) throw new DOMException("试听已取消", "AbortError");
    if (decoded.duration < clipSeconds) throw new Error("原唱试听长度不足");

    const offset = Math.max(0, Number(question.offset) || 0);
    const length = Math.round(decoded.sampleRate * clipSeconds);
    const first = Math.min(Math.round(offset * decoded.sampleRate), decoded.length - length);
    const excerpt = audio().createBuffer(decoded.numberOfChannels, length, decoded.sampleRate);
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      excerpt.copyToChannel(decoded.getChannelData(channel).subarray(first, first + length), channel);
    }

    const clip = { buffer: excerpt, offset: 0 };
    rememberCache(cacheKey, clip);
    return clip;
  }

  function stop() {
    if (!source) return;
    const oldSource = source;
    const oldGain = sourceGain;
    source = null;
    sourceGain = null;
    oldSource.onended = null;
    try {
      const now = context.currentTime;
      if (oldGain) {
        oldGain.gain.cancelScheduledValues(now);
        oldGain.gain.setValueAtTime(oldGain.gain.value, now);
        oldGain.gain.linearRampToValueAtTime(0.0001, now + 0.02);
      }
      oldSource.stop(now + 0.025);
      setTimeout(() => {
        try { oldSource.disconnect(); oldGain?.disconnect(); } catch {}
      }, 40);
    } catch {
      try { oldSource.stop(); oldSource.disconnect(); oldGain?.disconnect(); } catch {}
    }
  }

  function start(clip, delay, elapsed, onEnd) {
    stop();
    const ctx = audio();
    const node = ctx.createBufferSource();
    const fade = ctx.createGain();
    node.buffer = clip.buffer;
    node.connect(fade);
    fade.connect(gain);

    const startAt = ctx.currentTime + delay;
    const playDuration = Math.max(0.05, clipSeconds - elapsed);
    fade.gain.setValueAtTime(0.0001, startAt);
    fade.gain.linearRampToValueAtTime(1, startAt + 0.02);
    if (playDuration > 0.06) {
      fade.gain.setValueAtTime(1, startAt + playDuration - 0.03);
      fade.gain.linearRampToValueAtTime(0.0001, startAt + playDuration);
    }

    node.onended = () => {
      if (source === node) {
        source = null;
        sourceGain = null;
      }
      try { node.disconnect(); fade.disconnect(); } catch {}
      onEnd();
    };
    source = node;
    sourceGain = fade;
    node.start(startAt, clip.offset + elapsed, playDuration);
  }

  function getLevel() {
    if (!analyser || !source || muted) return 0;
    analyser.getByteTimeDomainData(dataArray);
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const v = (dataArray[i] - 128) / 128;
      sum += v * v;
    }
    return Math.min(1, Math.sqrt(sum / dataArray.length) * 3.2);
  }

  function sfx(type) {
    if (muted || !context || context.state !== "running") return;
    try {
      const now = context.currentTime;
      const osc = context.createOscillator();
      const env = context.createGain();
      osc.connect(env);
      env.connect(context.destination);

      if (type === "correct") {
        osc.type = "triangle";
        osc.frequency.setValueAtTime(587.33, now);       // D5
        osc.frequency.setValueAtTime(880, now + 0.075);  // A5
        env.gain.setValueAtTime(0.001, now);
        env.gain.linearRampToValueAtTime(0.11, now + 0.015);
        env.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
        osc.start(now);
        osc.stop(now + 0.25);
      } else if (type === "wrong") {
        osc.type = "sine";
        osc.frequency.setValueAtTime(240, now);
        osc.frequency.exponentialRampToValueAtTime(150, now + 0.16);
        env.gain.setValueAtTime(0.001, now);
        env.gain.linearRampToValueAtTime(0.09, now + 0.015);
        env.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.start(now);
        osc.stop(now + 0.19);
      } else if (type === "click") {
        osc.type = "sine";
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.exponentialRampToValueAtTime(360, now + 0.045);
        env.gain.setValueAtTime(0.001, now);
        env.gain.linearRampToValueAtTime(0.06, now + 0.008);
        env.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
        osc.start(now);
        osc.stop(now + 0.055);
      }
    } catch {}
  }

  function toggleMute() {
    muted = !muted;
    if (gain && context) {
      gain.gain.setTargetAtTime(muted ? 0 : 0.85, context.currentTime, 0.015);
    }
    return muted;
  }

  return { unlock, load, start, stop, toggleMute, getLevel, sfx };
})();

