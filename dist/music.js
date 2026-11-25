"use strict";
// 简谱的 1–7 为 C 调音阶，+ 为高八度，- 为低八度，冒号后是拍数。
const library = [
  ["茉莉花", 104, "3 3 5 6 1+:1.5 1+:0.5 6 5 5:2 6 5 3 5 3 2:3 3 3 5 6 1+:1.5 1+:0.5 6 5 5:2"],
  ["小星星", 106, "1 1 5 5 6 6 5:2 4 4 3 3 2 2 1:2 5 5 4 4 3 3 2:2 5 5 4 4 3 3 2:2"],
  ["欢乐颂", 116, "3 3 4 5 5 4 3 2 1 1 2 3 3:1.5 2:0.5 2:2 3 3 4 5 5 4 3 2 1 1 2 3 2:1.5 1:0.5 1:2"],
  ["两只老虎", 112, "1 2 3 1 1 2 3 1 3 4 5:2 3 4 5:2 5:0.5 6:0.5 5:0.5 4:0.5 3 1 5:0.5 6:0.5 5:0.5 4:0.5 3 1 1 5- 1:2"],
  ["新年好", 130, "1 1 1 5-:2 5- 3 3 3 1:2 1 1 3 5 5 4 3 2:3 2 3 4 4:2 4 3 2 3 1:2 1"],
  ["铃儿响叮当", 132, "3 3 3:2 3 3 3:2 3 5 1 2 3:4 4 4 4 4 4 3 3 3:0.5 3:0.5 3 2 2 3 2:2 5:2"],
  ["友谊地久天长", 104, "5- 1:1.5 1:0.5 1 3 2:1.5 1:0.5 2 3 1:1.5 1:0.5 3 5 6:3 6 5:1.5 3:0.5 3 1 2:1.5 1:0.5 2 3 1:1.5 6-:0.5 6- 5- 1:3"],
  ["生日快乐", 104, "5-:0.75 5-:0.25 6- 5- 1 7-:2 5-:0.75 5-:0.25 6- 5- 2 1:2 5-:0.75 5-:0.25 5 3 1 7- 6-:2 4:0.75 4:0.25 3 1 2 1:2"],
  ["伦敦桥", 118, "5:1.5 6:0.5 5 4 3 4 5:2 2 3 4:2 3 4 5:2 5:1.5 6:0.5 5 4 3 4 5:2 2:2 5:2 3 1:3"],
  ["扬基歌", 120, "1 1 2 3 1 3 2 5- 1 1 2 3 1:2 7-:2 1 1 2 3 4 3 2 1 7- 5- 6- 7- 1:2 1:2"],
  ["玛丽有只小羊羔", 116, "3 2 1 2 3 3 3:2 2 2 2:2 3 5 5:2 3 2 1 2 3 3 3 3 2 2 3 2 1:3"],
  ["划小船", 104, "1:1.5 1:1.5 1 2:0.5 3:1.5 3 2:0.5 3 4:0.5 5:3 1+:0.5 1+:0.5 1+:0.5 5:0.5 5:0.5 5:0.5 3:0.5 3:0.5 3:0.5 1:0.5 1:0.5 1:0.5 5 4:0.5 3 2:0.5 1:3"]
].map(([name, bpm, notation]) => {
  const notes = notation.split(" ").map(token => {
    const [pitch, duration] = token.split(":");
    const semitones = [0,2,4,5,7,9,11][Number(pitch[0])-1]
      + (pitch.includes("+") ? 12 : pitch.includes("-") ? -12 : 0);
    return {freq: 261.6256 * 2 ** (semitones / 12), length: (Number(duration) || 1) * 60 / bpm};
  });
  return {name, notes};
});

const clipLength = 10;
let audioContext, masterGain, voice, startTime, playbackOffset = 0, muted = false;
async function prepareAudio() {
  audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
  if (!masterGain) {
    masterGain = audioContext.createGain();
    masterGain.gain.value = muted ? 0 : .65;
    masterGain.connect(audioContext.destination);
  }
  if (audioContext.state !== "running") await audioContext.resume();
}
function synthesize(song) {
  const rate = audioContext.sampleRate;
  const buffer = audioContext.createBuffer(1, Math.ceil(rate * clipLength), rate);
  const data = buffer.getChannelData(0);
  let time = 0, i = 0;
  while (time < clipLength) {
    const {freq, length} = song.notes[i++ % song.notes.length];
    const offset = Math.floor(time * rate);
    const duration = Math.min(length * .94 + .055, clipLength - time);
    const count = Math.min(Math.ceil(duration * rate), data.length - offset);
    for (let j = 0; j < count; j++) {
      const t = j / rate, phase = 2 * Math.PI * freq * t;
      const envelope = Math.min(t / .012, 1) * Math.exp(-2.7 * t) * Math.min((duration - t) / .065, 1);
      data[offset+j] += .41 * envelope * (Math.sin(phase) + .33 * Math.sin(2*phase) * Math.exp(-4*t) + .13 * Math.sin(3*phase) * Math.exp(-6*t));
    }
    time += length;
  }
  return buffer;
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
function startAudio(buffer, onEnd) {
  if (playbackOffset >= clipLength - .01) playbackOffset = 0;
  voice = audioContext.createBufferSource();
  voice.buffer = buffer;
  voice.connect(masterGain);
  voice.onended = () => {voice.disconnect(); voice = null; playbackOffset = clipLength; onEnd();};
  startTime = audioContext.currentTime;
  voice.start(0, playbackOffset);
}
function toggleMute() {
  muted = !muted;
  if (masterGain) masterGain.gain.setTargetAtTime(muted ? 0 : .65, audioContext.currentTime, .012);
  return muted;
}

