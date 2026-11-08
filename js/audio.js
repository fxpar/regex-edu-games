// Sons 100 % synthétisés (WebAudio) : aucun fichier audio à charger.
let ctx = null;
let master = null;
let musicGain = null;
let muted = false;
let noiseBuf = null;
let musicTimer = null;

export function initAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.4;
    master.connect(ctx.destination);
    musicGain = ctx.createGain();
    musicGain.gain.value = 0.12;
    musicGain.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export function setMuted(v) {
  muted = v;
  if (master) master.gain.setTargetAtTime(v ? 0 : 0.4, ctx.currentTime, 0.02);
}
export const isMuted = () => muted;

function tone(freq, dur, { type = 'square', vol = 0.25, when = 0, slide = null, out = master } = {}) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur, { vol = 0.3, freq = 2000, slide = null, when = 0, q = 0.8 } = {}) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (slide) f.frequency.exponentialRampToValueAtTime(slide, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t);
  s.stop(t + dur + 0.02);
}

export const sfx = {
  click() { tone(900, 0.03, { vol: 0.08 }); },
  key() { tone(1400, 0.015, { vol: 0.04, type: 'triangle' }); },
  lock() { tone(1320, 0.06, { vol: 0.15 }); tone(1760, 0.09, { vol: 0.15, when: 0.07 }); },
  missile() { noise(0.6, { vol: 0.25, freq: 4000, slide: 300 }); tone(500, 0.4, { type: 'sawtooth', vol: 0.06, slide: 120 }); },
  boom() { noise(0.9, { vol: 0.55, freq: 1200, slide: 50, q: 1.5 }); tone(90, 0.6, { type: 'sine', vol: 0.5, slide: 30 }); },
  error() { tone(150, 0.22, { type: 'sawtooth', vol: 0.22 }); tone(110, 0.25, { type: 'sawtooth', vol: 0.2, when: 0.1 }); },
  iff() { for (let i = 0; i < 4; i++) tone(i % 2 ? 660 : 880, 0.1, { vol: 0.18, when: i * 0.11 }); },
  impact() { noise(0.5, { vol: 0.6, freq: 600, slide: 60 }); tone(60, 0.5, { type: 'square', vol: 0.3, slide: 30 }); },
  pass() { tone(520, 0.12, { type: 'triangle', vol: 0.12 }); tone(780, 0.16, { type: 'triangle', vol: 0.12, when: 0.1 }); },
  levelUp() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, { type: 'square', vol: 0.15, when: i * 0.1 })); },
  gameOver() { [440, 349, 294, 220].forEach((f, i) => tone(f, 0.3, { type: 'sawtooth', vol: 0.18, when: i * 0.2 })); },
  open() { tone(400, 0.12, { type: 'triangle', vol: 0.12, slide: 900 }); },
};

// Petite boucle synthwave (basse + arpège), planifiée à l'avance.
const BASS = [41.2, 41.2, 49, 49, 55, 55, 36.7, 36.7]; // Mi, Sol, La, Ré
const ARP = [0, 7, 12, 15, 12, 7];
export function startMusic() {
  if (!ctx || musicTimer) return;
  let step = 0;
  let next = ctx.currentTime + 0.1;
  const spb = 60 / 104 / 2; // croches à 104 BPM
  musicTimer = setInterval(() => {
    while (next < ctx.currentTime + 0.3) {
      const bar = Math.floor(step / 16) % BASS.length;
      const root = BASS[bar];
      const when = next - ctx.currentTime;
      if (step % 2 === 0) tone(root * 2, spb * 1.6, { type: 'sawtooth', vol: 0.5, when, out: musicGain });
      const semi = ARP[step % ARP.length];
      tone(root * 8 * Math.pow(2, semi / 12), spb * 0.9, { type: 'square', vol: 0.12, when, out: musicGain });
      next += spb;
      step++;
    }
  }, 60);
}
export function stopMusic() {
  clearInterval(musicTimer);
  musicTimer = null;
}
