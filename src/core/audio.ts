/* ============ P5 QUIZ — SYNTHESIZED AUDIO (Web Audio, zero files) ============ */
import type { Settings } from "./types";

type SfxName =
  | "tick" | "click" | "hover" | "correct" | "wrong" | "slash" | "rankup"
  | "heartbeat" | "stamp" | "star" | "unlock" | "select" | "whoosh" | "paper" | "break";

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private musicTimer: number | null = null;
  private nextNote = 0;
  private step = 0;
  private intensity = 0;
  private fileBgm: HTMLAudioElement | null = null;
  private fileSelect: HTMLAudioElement | null = null;
  private fadeRaf: number | null = null;
  enabled = { music: true, sfx: true };
  volume = 0.7;
  bgmMode: "authentic" | "synth" = "authentic";

  ensure(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      try {
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.ctx.destination);
        this.sfxBus = this.ctx.createGain();
        this.sfxBus.connect(this.master);
        this.musicBus = this.ctx.createGain();
        this.musicBus.gain.value = 0.5;
        this.musicBus.connect(this.master);
      } catch {
        return null;
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => undefined);
    }
    return this.ctx;
  }

  /* unlock on first gesture: resumes synth + starts whatever music mode is active */
  unlock() {
    this.ensure();
    if (this.enabled.music) {
      if (this.bgmMode === "authentic") this.startFileMusic();
      else this.startMusic();
    }
  }

  /* ---------- file-based BGM (authentic P5 track) ---------- */
  private getBgmEl(): HTMLAudioElement | null {
    if (typeof window === "undefined") return null;
    if (!this.fileBgm) {
      this.fileBgm = new Audio("./audio/background.mp3");
      this.fileBgm.loop = true;
      this.fileBgm.volume = 0;
      // don't pull ~8MB of music until the player actually turns music on
      this.fileBgm.preload = "none";
    }
    return this.fileBgm;
  }

  private fadeBgmTo(target: number, done?: () => void) {
    const audio = this.getBgmEl();
    if (!audio) return;
    if (this.fadeRaf !== null) cancelAnimationFrame(this.fadeRaf);
    const start = audio.volume;
    const diff = target - start;
    const begin = performance.now();
    const FADE_MS = 450;
    const tick = (now: number) => {
      const p = Math.min(1, (now - begin) / FADE_MS);
      audio.volume = Math.max(0, Math.min(1, start + diff * p));
      if (p < 1) {
        this.fadeRaf = requestAnimationFrame(tick);
      } else {
        this.fadeRaf = null;
        done?.();
      }
    };
    this.fadeRaf = requestAnimationFrame(tick);
  }

  startFileMusic() {
    const audio = this.getBgmEl();
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(() => undefined);
    }
    this.fadeBgmTo(this.volume * 0.6);
  }

  stopFileMusic() {
    const audio = this.getBgmEl();
    if (!audio || audio.paused) return;
    this.fadeBgmTo(0, () => audio.pause());
  }

  private playSelectFile() {
    if (!this.enabled.sfx) return;
    try {
      if (!this.fileSelect) {
        this.fileSelect = new Audio("./audio/select.mp3");
        this.fileSelect.volume = 0.5;
      }
      const a = this.fileSelect;
      a.currentTime = 0;
      void a.play().catch(() => this.synthSfx("select"));
    } catch {
      this.synthSfx("select");
    }
  }

  applySettings(s: Settings) {
    this.enabled.music = s.music;
    this.enabled.sfx = s.sfx;
    this.volume = s.volume;
    this.bgmMode = s.bgm;
    if (this.ctx) this.master.gain.setTargetAtTime(s.volume, this.ctx.currentTime, 0.05);
    // file BGM follows volume instantly when audible
    if (this.fileBgm && !this.fileBgm.paused && this.fadeRaf === null) {
      this.fileBgm.volume = this.volume * 0.6;
    }
    if (s.music && s.bgm === "authentic") {
      this.stopMusic();
      this.startFileMusic();
    } else if (s.music && s.bgm === "synth") {
      this.stopFileMusic();
      this.startMusic();
    } else {
      this.stopMusic();
      this.stopFileMusic();
    }
  }

  setIntensity(i: number) {
    this.intensity = Math.max(0, Math.min(1, i));
  }

  /* ---------- low-level helpers ---------- */
  private tone(
    freq: number, dur: number, type: OscillatorType, vol: number,
    opts: { slide?: number; attack?: number; bus?: GainNode; pan?: number } = {},
  ) {
    const ctx = this.ensure();
    if (!ctx || !this.enabled.sfx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (opts.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.slide), t + dur);
    const attack = opts.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const dest = opts.bus ?? this.sfxBus;
    if (opts.pan !== undefined) {
      const p = ctx.createStereoPanner();
      p.pan.value = opts.pan;
      osc.connect(g).connect(p).connect(dest);
    } else {
      osc.connect(g).connect(dest);
    }
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, opts: { hp?: number; lp?: number; sweep?: number } = {}) {
    const ctx = this.ensure();
    if (!ctx || !this.enabled.sfx) return;
    const t = ctx.currentTime;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 1.1;
    if (opts.sweep) {
      filter.frequency.setValueAtTime(opts.hp ?? 400, t);
      filter.frequency.exponentialRampToValueAtTime(opts.sweep, t + dur);
    } else {
      filter.frequency.value = (opts.hp ?? 400) + (opts.lp ?? 0) / 2 || 800;
      if (opts.hp) { filter.type = "highpass"; filter.frequency.value = opts.hp; }
      if (opts.lp) { filter.type = "lowpass"; filter.frequency.value = opts.lp; }
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(this.sfxBus);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  /* ---------- named SFX ---------- */
  sfx(name: SfxName) {
    if (name === "select" && this.bgmMode === "authentic") {
      this.playSelectFile();
      return;
    }
    this.synthSfx(name);
  }

  private synthSfx(name: SfxName) {
    switch (name) {
      case "tick":
        this.tone(1800 + Math.random() * 300, 0.03, "square", 0.05);
        break;
      case "click":
        this.tone(320, 0.07, "square", 0.12, { slide: 200 });
        this.noise(0.04, 0.05, { hp: 1500 });
        break;
      case "hover":
        this.tone(880, 0.05, "sine", 0.04);
        break;
      case "select":
        this.tone(520, 0.09, "square", 0.1, { slide: 780 });
        break;
      case "correct": {
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((f, i) => setTimeout(() => this.tone(f, 0.22, "triangle", 0.16), i * 55));
        this.tone(261.63, 0.3, "sine", 0.12, { slide: 130 });
        break;
      }
      case "wrong": {
        this.tone(220, 0.28, "sawtooth", 0.14, { slide: 110 });
        this.tone(233, 0.28, "sawtooth", 0.1, { slide: 116 });
        this.noise(0.12, 0.08, { hp: 200 });
        break;
      }
      case "slash":
        this.noise(0.18, 0.22, { hp: 900, sweep: 3200 });
        this.tone(120, 0.15, "sawtooth", 0.1, { slide: 60 });
        break;
      case "whoosh":
        this.noise(0.35, 0.1, { hp: 300, sweep: 1400 });
        break;
      case "rankup": {
        this.tone(82, 0.4, "sine", 0.3, { slide: 41 });
        setTimeout(() => this.tone(65, 0.5, "sine", 0.28, { slide: 32 }), 20);
        setTimeout(() => {
          [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) =>
            setTimeout(() => this.tone(f, 0.35, "triangle", 0.14), i * 70));
        }, 90);
        this.noise(0.5, 0.06, { hp: 4000 });
        break;
      }
      case "heartbeat": {
        this.tone(58, 0.12, "sine", 0.3, { slide: 40 });
        setTimeout(() => this.tone(50, 0.14, "sine", 0.24, { slide: 36 }), 160);
        break;
      }
      case "stamp":
        this.noise(0.08, 0.24, { hp: 300 });
        this.tone(140, 0.09, "square", 0.16, { slide: 90 });
        break;
      case "star":
        this.tone(1568, 0.4, "sine", 0.1, { slide: 2093 });
        break;
      case "unlock": {
        [880, 1108.7, 1318.5, 1760].forEach((f, i) =>
          setTimeout(() => this.tone(f, 0.3, "sine", 0.12), i * 80));
        break;
      }
      case "paper":
        this.noise(0.22, 0.12, { hp: 600, sweep: 2400 });
        break;
      case "break":
        this.noise(0.3, 0.2, { hp: 1200, sweep: 3800 });
        this.tone(300, 0.25, "square", 0.1, { slide: 80 });
        break;
    }
  }

  /* ---------- music: acid-jazz loop, lookahead scheduler ---------- */
  private readonly BPM = 92;
  private readonly SWING = 0.62;

  startMusic() {
    if (this.musicTimer !== null || !this.ensure()) return;
    this.nextNote = this.ctx!.currentTime + 0.05;
    this.step = 0;
    this.musicTimer = window.setInterval(() => this.schedule(), 30);
  }

  stopMusic() {
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx) return;
    const stepDur = 60 / this.BPM / 2; // 8th notes
    while (this.nextNote < ctx.currentTime + 0.2) {
      this.playStep(this.step, this.nextNote);
      const swing = this.step % 2 === 1 ? this.SWING : 1;
      this.nextNote += stepDur * swing;
      this.step = (this.step + 1) % 32;
    }
  }

  private noteFreq(midi: number) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  private musicTone(midi: number, t: number, dur: number, type: OscillatorType, vol: number, lp = 2400) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = this.noteFreq(midi);
    f.type = "lowpass";
    f.frequency.value = lp;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(f).connect(g).connect(this.musicBus);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  // Am7 → D9 → Fmaj7 → E7♭9 (2 bars each = 16 steps per chord)
  private chords: number[][] = [
    [57, 60, 64, 67],  // Am7
    [50, 57, 62, 65],  // D9
    [53, 57, 60, 64],  // Fmaj7
    [52, 56, 59, 62],  // E7b9
  ];
  private roots = [45, 38, 41, 40];

  private playStep(step: number, t: number) {
    const chordIdx = Math.floor(step / 8) % 4;
    const chord = this.chords[chordIdx];
    const root = this.roots[chordIdx];
    const vol = this.enabled.music ? 1 : 0;

    // walking bass — root on beats, chromatic walk ups
    const inBar = step % 8;
    const bassPattern = [0, 0, 7, 0, 5, 0, 10, 0];
    if (inBar % 2 === 0) {
      const walk = [root, root, root + bassPattern[inBar], root];
      const note = walk[Math.floor(inBar / 2)];
      this.musicTone(note, t, 0.3, "triangle", 0.16 * vol, 700);
    }
    // comp chord stabs — offbeat swing feel
    if (inBar % 2 === 1) {
      const midi = chord[Math.floor(Math.random() * chord.length)];
      this.musicTone(midi, t, 0.12, "sawtooth", 0.035 * vol, 1600);
      this.musicTone(midi + 12, t, 0.12, "sawtooth", 0.025 * vol, 2000);
    }
    // hats
    if (this.enabled.music) {
      const ctx = this.ctx!;
      const len = Math.floor(ctx.sampleRate * 0.03);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 6000;
      const g = ctx.createGain();
      const hv = (inBar % 2 === 1 ? 0.05 : 0.028) * (0.5 + this.intensity * 0.5);
      g.gain.value = hv;
      src.connect(hp).connect(g).connect(this.musicBus);
      src.start(t);
    }
    // intensity: kick + brass stab on beats when hot
    if (this.intensity > 0.25 && inBar % 4 === 0) {
      this.musicTone(36, t, 0.25, "sine", 0.12 * this.intensity * vol, 300);
      this.musicTone(chord[0] + 12, t, 0.2, "square", 0.02 * this.intensity * vol, 1200);
    }
  }
}

export const audio = new AudioEngine();
