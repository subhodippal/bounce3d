// Tiny synthesized sound effects (no audio files needed, works offline).
export class Sfx {
  constructor(muted = false) {
    this.ctx = null;
    this.master = null;
    this.muted = muted;
  }

  unlock() {
    if (!this.ctx) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.6;
        this.master.connect(this.ctx.destination);
      } catch { return; }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.6;
  }

  tone(freq, dur, { type = 'square', vol = 0.12, slide = null, delay = 0 } = {}) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  noise(dur, vol = 0.2) {
    if (!this.ctx || this.muted) return;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    const g = this.ctx.createGain();
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1200;
    g.gain.value = vol;
    src.buffer = buf;
    src.connect(f).connect(g).connect(this.master);
    src.start();
  }

  jump() { this.tone(300, 0.14, { slide: 620, vol: 0.07 }); }
  land() { this.tone(140, 0.06, { type: 'triangle', vol: 0.08 }); }
  bounce() { this.tone(220, 0.22, { type: 'sine', slide: 900, vol: 0.14 }); }
  spring() { this.tone(180, 0.3, { type: 'sawtooth', slide: 1200, vol: 0.06 }); }
  ring() {
    this.tone(988, 0.09, { type: 'triangle', vol: 0.14 });
    this.tone(1480, 0.18, { type: 'triangle', vol: 0.14, delay: 0.07 });
  }
  life() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.12, { type: 'triangle', vol: 0.12, delay: i * 0.07 })); }
  checkpoint() { this.tone(660, 0.1, { type: 'sine', vol: 0.14 }); this.tone(880, 0.2, { type: 'sine', vol: 0.14, delay: 0.1 }); }
  open() { [392, 523, 659, 784].forEach((f, i) => this.tone(f, 0.18, { type: 'square', vol: 0.06, delay: i * 0.09 })); }
  die() { this.noise(0.35, 0.25); this.tone(400, 0.5, { type: 'sawtooth', slide: 60, vol: 0.08 }); }
  win() { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, 0.2, { type: 'square', vol: 0.06, delay: i * 0.1 })); }
  click() { this.tone(700, 0.04, { type: 'square', vol: 0.05 }); }
  inflate() { this.tone(160, 0.45, { type: 'sawtooth', slide: 520, vol: 0.06 }); this.noise(0.3, 0.08); }
  deflate() { this.noise(0.4, 0.14); this.tone(600, 0.4, { type: 'triangle', slide: 120, vol: 0.08 }); }
  splash() { this.noise(0.25, 0.18); this.tone(260, 0.12, { type: 'sine', slide: 90, vol: 0.06 }); }
  bumper() { this.tone(520 + Math.random() * 200, 0.08, { type: 'square', vol: 0.06 }); }
  secret() { [659, 784, 988, 1319, 1568].forEach((f, i) => this.tone(f, 0.14, { type: 'triangle', vol: 0.12, delay: i * 0.06 })); }
}
