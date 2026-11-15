// Little sounds made in the browser with the Web Audio API: no sound files, nothing downloaded.
// Short, soft tones; the sound button in the header turns them off together with the voices.
let ctx = null;
let master = null;
let muted = false;

export function setMuted(on) {
  muted = on;
}

// Browsers allow sound only after the first tap, so the audio starts on demand.
function audio() {
  if (muted) return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.18; // quiet
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// One soft note: a sine or triangle wave with a quick fade in and a gentle fade out.
function note(freq, start, length, { type = 'sine', volume = 1, slide = 0 } = {}) {
  const c = ctx;
  const t0 = c.currentTime + start;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(freq * slide, t0 + length);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
  osc.connect(gain).connect(master);
  osc.start(t0);
  osc.stop(t0 + length + 0.02);
}

// A short knock, like a wooden piece put on the board.
function knock(start, pitch, volume) {
  const c = ctx;
  const t0 = c.currentTime + start;
  const len = 0.09;
  const buffer = c.createBuffer(1, Math.floor(c.sampleRate * len), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 4;
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = pitch;
  filter.Q.value = 4;
  const gain = c.createGain();
  gain.gain.value = volume;
  src.connect(filter).connect(gain).connect(master);
  src.start(t0);
  note(pitch / 4, start, 0.08, { type: 'sine', volume: volume * 0.35 });
}

const SOUNDS = {
  move: () => knock(0, 900, 1.6),
  capture: () => { knock(0, 700, 1.8); knock(0.07, 520, 1.4); },
  check: () => { knock(0, 900, 1.4); note(880, 0.03, 0.22, { type: 'triangle', volume: 0.35 }); },
  right: () => { note(660, 0, 0.14, { type: 'triangle', volume: 0.45 }); note(990, 0.1, 0.2, { type: 'triangle', volume: 0.45 }); },
  wrong: () => { note(330, 0, 0.16, { type: 'triangle', volume: 0.4 }); note(247, 0.13, 0.26, { type: 'triangle', volume: 0.4 }); },
  win: () => [523, 659, 784, 1047].forEach((f, i) => note(f, i * 0.11, i === 3 ? 0.5 : 0.18, { type: 'triangle', volume: 0.42 })),
  tick: () => note(1320, 0, 0.05, { type: 'square', volume: 0.12 }),
};

export function play(name) {
  if (!SOUNDS[name] || !audio()) return;
  try {
    SOUNDS[name]();
  } catch { /* sound is only a nicety */ }
}

// The right sound for a move that has just been played on `chess` (a chess.js game).
export function playMove(mv, chess) {
  if (!mv) return;
  if (chess.inCheck()) play('check');
  else if (mv.captured) play('capture');
  else play('move');
}
