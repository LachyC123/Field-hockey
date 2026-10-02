/**
 * Procedural sound effects built with WebAudio, so the game ships with no audio files.
 * Every sound is layered from noise and oscillators and shaped to read as the real thing:
 * the crack of composite on ball, the deep thud of the backboard, the clang of a post.
 */
class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private crowdGain!: GainNode;
  private crowdFilter!: BiquadFilterNode;
  private noise!: AudioBuffer;
  muted = false;

  /** Must be called from a user gesture on mobile. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startCrowd();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.9;
  }

  private now(): number {
    return this.ctx!.currentTime;
  }

  private noiseBurst(dur: number, type: BiquadFilterType, freq: number, q: number, gain: number, attack = 0.002, when = 0): void {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    const t = this.now() + when;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', endFreq?: number, when = 0): void {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = type;
    const t = this.now() + when;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Stick on ball. Hits are louder and lower with a woody body; pushes are a soft clack. */
  strike(kind: 'push' | 'flick' | 'hit', power: number): void {
    if (!this.ctx) return;
    const p = Math.max(0.2, power);
    if (kind === 'hit') {
      this.noiseBurst(0.06, 'bandpass', 2600, 1.2, 0.9 * p);
      this.noiseBurst(0.12, 'lowpass', 900, 0.8, 0.5 * p);
      this.tone(420, 0.09, 0.35 * p, 'triangle', 180);
      this.tone(1650, 0.03, 0.25 * p, 'square', 900);
    } else if (kind === 'flick') {
      this.noiseBurst(0.18, 'bandpass', 1400, 0.6, 0.25 * p, 0.04); // whoosh of the drag
      this.noiseBurst(0.05, 'bandpass', 2200, 1.4, 0.45 * p, 0.002, 0.07);
      this.tone(520, 0.06, 0.18 * p, 'triangle', 300, 0.07);
    } else {
      this.noiseBurst(0.045, 'bandpass', 2000, 1.5, 0.45 * p);
      this.tone(600, 0.05, 0.16 * p, 'triangle', 350);
    }
  }

  /** The signature hockey goal sound. */
  backboard(strength: number): void {
    if (!this.ctx) return;
    const s = Math.max(0.35, strength);
    this.tone(95, 0.35, 0.9 * s, 'sine', 55);
    this.tone(180, 0.18, 0.4 * s, 'triangle', 90);
    this.noiseBurst(0.09, 'lowpass', 700, 0.7, 0.8 * s);
    this.noiseBurst(0.25, 'bandpass', 320, 2, 0.35 * s, 0.003, 0.01);
  }

  net(strength: number): void {
    if (!this.ctx) return;
    this.noiseBurst(0.3, 'highpass', 3000, 0.5, 0.12 + strength * 0.15, 0.01);
  }

  post(strength: number): void {
    if (!this.ctx) return;
    const s = Math.max(0.4, strength);
    for (const [f, g] of [
      [1180, 0.35],
      [1740, 0.22],
      [2650, 0.16],
      [3900, 0.08],
    ] as const)
      this.tone(f, 0.9, g * s, 'sine', f * 0.995);
    this.noiseBurst(0.04, 'highpass', 2500, 0.7, 0.5 * s);
  }

  pad(strength: number): void {
    if (!this.ctx) return;
    this.noiseBurst(0.14, 'lowpass', 500, 0.9, 0.7 * Math.max(0.3, strength));
    this.tone(130, 0.12, 0.35, 'sine', 80);
  }

  stickClash(): void {
    if (!this.ctx) return;
    this.noiseBurst(0.06, 'bandpass', 1800, 2, 0.5);
    this.tone(900, 0.07, 0.2, 'square', 500);
  }

  bounce(strength: number): void {
    if (!this.ctx) return;
    this.noiseBurst(0.05, 'lowpass', 600, 1, 0.12 * strength);
  }

  whistle(long = false): void {
    if (!this.ctx) return;
    const c = this.ctx;
    const o = c.createOscillator();
    o.frequency.value = 2650;
    const lfo = c.createOscillator();
    lfo.frequency.value = 28;
    const lg = c.createGain();
    lg.gain.value = 90;
    lfo.connect(lg).connect(o.frequency);
    const g = c.createGain();
    const t = this.now();
    const dur = long ? 0.9 : 0.35;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    g.gain.setValueAtTime(0.18, t + dur - 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    lfo.start(t);
    o.stop(t + dur + 0.05);
    lfo.stop(t + dur + 0.05);
  }

  /** Rising charge tick while the power ring fills. */
  charge(level: number): void {
    if (!this.ctx) return;
    this.tone(300 + level * 700, 0.04, 0.05, 'sine');
  }

  ui(kind: 'tap' | 'perfect' | 'select' = 'tap'): void {
    if (!this.ctx) return;
    if (kind === 'perfect') {
      this.tone(880, 0.12, 0.15, 'triangle');
      this.tone(1320, 0.18, 0.12, 'triangle', undefined, 0.06);
    } else if (kind === 'select') this.tone(660, 0.06, 0.08, 'triangle');
    else this.tone(520, 0.04, 0.06, 'triangle');
  }

  private startCrowd(): void {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    this.crowdFilter = c.createBiquadFilter();
    this.crowdFilter.type = 'bandpass';
    this.crowdFilter.frequency.value = 700;
    this.crowdFilter.Q.value = 0.6;
    this.crowdGain = c.createGain();
    this.crowdGain.gain.value = 0.035;
    src.connect(this.crowdFilter).connect(this.crowdGain).connect(this.master);
    src.start();
  }

  /** Crowd reaction: 'rise' on a chance, 'roar' on a goal, 'groan' on a miss, 'ooh' on a save. */
  crowd(kind: 'rise' | 'roar' | 'groan' | 'ooh' | 'calm'): void {
    if (!this.ctx) return;
    const g = this.crowdGain.gain;
    const f = this.crowdFilter.frequency;
    const t = this.now();
    g.cancelScheduledValues(t);
    f.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    f.setValueAtTime(f.value, t);
    if (kind === 'roar') {
      g.linearRampToValueAtTime(0.42, t + 0.25);
      f.linearRampToValueAtTime(1300, t + 0.25);
      g.linearRampToValueAtTime(0.2, t + 2.6);
      g.linearRampToValueAtTime(0.04, t + 5);
      f.linearRampToValueAtTime(700, t + 5);
    } else if (kind === 'rise') {
      g.linearRampToValueAtTime(0.09, t + 1.2);
      f.linearRampToValueAtTime(900, t + 1.2);
    } else if (kind === 'ooh') {
      g.linearRampToValueAtTime(0.2, t + 0.2);
      f.linearRampToValueAtTime(500, t + 0.3);
      g.linearRampToValueAtTime(0.04, t + 1.8);
      f.linearRampToValueAtTime(700, t + 1.8);
    } else if (kind === 'groan') {
      g.linearRampToValueAtTime(0.14, t + 0.2);
      f.linearRampToValueAtTime(380, t + 0.6);
      g.linearRampToValueAtTime(0.04, t + 1.8);
      f.linearRampToValueAtTime(700, t + 1.8);
    } else {
      g.linearRampToValueAtTime(0.035, t + 0.8);
      f.linearRampToValueAtTime(700, t + 0.8);
    }
  }
}

export const sfx = new Sfx();

export function haptic(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not supported */
  }
}
