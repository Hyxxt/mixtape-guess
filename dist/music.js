"use strict";

// 每首只收录用于听辨的短句。数字为调内音级，+/- 表示八度，0 为休止。
// 参考各曲的 Everyone Piano 公开简谱，编号对应 /Number-<score>-1.html。
const phrases = [
  {name:"十年", score:250, key:8, bpm:62,
   lead:"1+:.5 1+:.5 7:.5 3+:.5 6:.25 1+:.25 7:.25 6:.25 6:.5 3+:.25 6:.25 3+:.75 6:.25 5+:.375 6+:.375 5+:.25 3+:2 1+:.25 7:.25 6:.25 7:.25 4+:2",
   bass:"1-:2 6-:2 3-:4 4-:4"},
  {name:"好久不见", score:90, key:0, bpm:79,
   lead:"1+:1.5 5:.5 1+:.5 5:.5 2+:.5 1+:.5 2+:1.5 7:.5 1+:.5 5:.5 2+:.5 1+:.5 3+:1.5 6:.5 1+:.5 5:.5 2+:.5 1+:.5 2+:2 7:2",
   bass:"1-:.5 5-:.5 1:3 7-:.5 5-:.5 1:3 6-:.5 3:.5 1:3 5-:.5 2:.5 4:.5 1:.5 7-:2"},
  {name:"富士山下", score:14118, key:5, bpm:105,
   lead:"1+:2 1+:2 7:2 1+:.5 7:.5 6:.5 5:.5 6:.5 5:.5 3:.5 2:.5 3:.5 2:.5 1+:.5 7:.5 1+:.5 7:.5 6:.5 5:.5 6 7:.5 1+:.5 2+ 3+:.5 6:.5 5:2",
   bass:"0:6 6-:.5 3:.5 6-:.5 1:.5 3:2 3-:.5 7-:.5 3:.5 5:.5 7-:2 4-:.5 1:.5 6- 5-:.5 2:.5 7- 1:2"},
  {name:"孤勇者", score:14014, key:0, bpm:132,
   lead:"2+ 7 1+ 6 2+ 7 1+ 6 2+ 7 1+ 6 2+ 7 1+ 6 3:6 0:.5 1:.5 2:.5 1:.5 3:4",
   bass:"4- 1 4- 1 5- 2 5- 2 6- 3 6- 3 5- 2 5- 2 4- 1 4-:2 5- 2 5-:2"},
  {name:"你的背包", score:12200, key:0, bpm:72,
   lead:"0:.5 3:.25 2:.25 3:.5 2:.25 3:1.25 0:.5 2:.25 1:.25 2:.25 2:.75 1:.25 3:.25 3:.25 2:1.25 0:.75 1:.25 6:.25 5:.25 6:.5 0:.5 6:.25 6:.25 5:.5 5:.5 3:.5 3:.25 3:3.25 5:.5 3:.5",
   bass:"1-:.5 5-:.5 1:.5 2:.5 3:2 2-:.5 6-:.5 2:.5 4:.5 6:2 4-:.5 1:.5 4:.5 6:.5 1:2 1-:.5 5-:.5 1:.5 2:.5 3:2"},
  {name:"葡萄成熟时", score:13840, key:0, bpm:70,
   lead:"0:.25 2:.25 2:.25 2:.25 2:.5 1:.5 2:.25 2:.25 2:.25 1:.25 2:.25 3:.25 5:.25 5:.5 5:.25 5:.25 5:.25 5:.5 1:.5 7-:.5 1:.5 7-:.5 1:.5 5:.5 1:.25 1:1.25 5:.5 1:.25 1:.75 1:.25 1:.25 4:.5 3:.5 2:.25 1:.25 1:.25 3:.25 2:2",
   bass:"1-:.5 5-:.5 1 1-:.5 5-:.5 7-:.5 5-:.5 6-:.5 3:.5 6-:.5 3:.5 6-:.5 3:.5 6- 4-:.5 1:.5 4-:.5 1:.5 3-:.5 1:.5 5-:.5 3:.5 2-:.5 6-:.5 4 5-:.5 2:.5 7-"},
  {name:"单车", score:2230, key:7, bpm:65,
   lead:"2-:.25 3-:.25 5-:.25 6-:.25 5- 1 7-:.25 1:.25 7-:.25 5-:.75 3-:.5 6 3- 2-:.25 3-:.25 5-:.25 3-:.5 2-:.25 3-:.25 2-:.25 1-:2 1-:.25 5-:.25 6-:.25 1:.25 2:.25 1:.25 2:.25 3:.25 2 6:.5 5-:1.5",
   bass:"0 1- 1- 7- 7- 6- 6- 5- 5- 4- 4- 3- 3- 2- 2- 5-"},
  {name:"浮夸", score:1950, key:5, bpm:92,
   lead:"1:.5 6-:.5 7-:.5 1:1.5 1:.5 7-:.5 1:.5 3 1:.5 7-:.5 6-:.5 6-:.5 6-:4.5 1:.5 6-:.5 7-:.5 1:.5 6-:.5 7-:.5 1:.5 7-:.5 1:.5 3 1:.5",
   bass:"6-:3 5-:3 4-:6 6-:3 5-:3"}
];

function readPhrase(notation, key, bpm) {
  return notation.split(" ").map(token => {
    const [pitch, beats] = token.split(":");
    const note = Number(pitch[0]);
    const octave = pitch.includes("+") ? 12 : pitch.includes("-") ? -12 : 0;
    const semitones = key + octave + [0,2,4,5,7,9,11][note-1];
    return {freq: note ? 261.6256 * 2 ** (semitones / 12) : 0, length: (Number(beats) || 1)*60/bpm};
  });
}
const library = phrases.map(song => ({
  name:song.name,
  notes:readPhrase(song.lead, song.key, song.bpm),
  bass:readPhrase(song.bass, song.key-12, song.bpm)
}));

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
function renderPart(data, rate, notes, level) {
  let time = 0;
  for (const {freq, length} of notes) {
    if (time >= clipLength) break;
    const offset = Math.floor(time * rate);
    const duration = Math.min(length * .94 + .065, clipLength - time);
    const count = Math.min(Math.ceil(duration * rate), data.length - offset);
    if (freq > 0) {
      for (let j = 0; j < count; j++) {
        const t = j / rate, phase = 2 * Math.PI * freq * t;
        const envelope = Math.min(t / .009, 1) * Math.exp(-2.4*t) * Math.min((duration-t)/.06, 1);
        data[offset+j] += level * envelope * (Math.sin(phase) + .35*Math.sin(2*phase)*Math.exp(-4*t) + .13*Math.sin(3*phase)*Math.exp(-6*t));
      }
    }
    time += length;
  }
}
function synthesize(song) {
  const rate = audioContext.sampleRate;
  const buffer = audioContext.createBuffer(1, Math.ceil(rate * clipLength), rate);
  const data = buffer.getChannelData(0);
  renderPart(data, rate, song.notes, .41);
  renderPart(data, rate, song.bass, .17);
  const fade = Math.ceil(rate * .06);
  for (let i = 0; i < fade; i++) data[data.length-1-i] *= i/fade;
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
