/* ============ P5 QUIZ — CANVAS FX LAYER (particles, slashes, rain, shake) ============ */

type ParticleKind = "star" | "spark" | "slash" | "confetti" | "shard" | "ring" | "ink" | "text" | "rain" | "dust";

interface Particle {
  kind: ParticleKind;
  x: number; y: number;
  vx: number; vy: number;
  rot: number; vrot: number;
  life: number; maxLife: number;
  size: number;
  color: string;
  text?: string;
  grav: number;
  drag: number;
}

class FxLayer {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private parts: Particle[] = [];
  private w = 0;
  private h = 0;
  private last = 0;
  private shakeMag = 0;
  private shakeX = 0;
  private shakeY = 0;
  private flashA = 0;
  private flashColor = "#ffffff";
  private heartPulse = 0;
  private crtOn = false;
  private dustTimer = 0;
  private running = false;
  private cursorX = -100;
  private cursorY = -100;
  private cursorActive = false;
  private cursorTimer = 0;
  private goldAmbient = false;
  private goldTimer = 0;
  private particlesOn = true;
  app: HTMLElement | null = null;

  init(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.resize();
    window.addEventListener("resize", () => this.resize());
    window.addEventListener("pointermove", (e) => {
      this.cursorX = e.clientX;
      this.cursorY = e.clientY;
      this.cursorActive = true;
    });
    window.addEventListener("pointerleave", () => {
      this.cursorActive = false;
    });
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  private resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = this.w * dpr;
    this.canvas.height = this.h * dpr;
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---------------- spawning ---------------- */

  private add(p: Partial<Particle> & { kind: ParticleKind; x: number; y: number }) {
    if (!this.particlesOn) return;
    if (this.parts.length > 900) this.parts.splice(0, 100);
    this.parts.push({
      vx: 0, vy: 0, rot: 0, vrot: 0,
      life: 1, maxLife: 1, size: 6, color: "#f6f4f0",
      grav: 0, drag: 0.99,
      ...p,
    });
  }

  starBurst(x: number, y: number, opts: { n?: number; gold?: boolean; big?: boolean } = {}) {
    const n = opts.n ?? 14;
    const color = opts.gold ? "#ffd76a" : "#f6f4f0";
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.4;
      const sp = (opts.big ? 6 : 4) + Math.random() * 5;
      this.add({
        kind: "star", x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2,
        vrot: (Math.random() - 0.5) * 0.3,
        size: opts.big ? 10 + Math.random() * 14 : 6 + Math.random() * 9,
        maxLife: 0.7 + Math.random() * 0.5, grav: 0.06, drag: 0.985, color,
      });
    }
    this.ring(x, y, color, opts.big ? 120 : 70);
  }

  confetti(x: number, y: number, n = 90, colors = ["#e60012", "#f6f4f0", "#e8b93b", "#2fc45a"]) {
    for (let i = 0; i < n; i++) {
      this.add({
        kind: "confetti", x, y,
        vx: (Math.random() - 0.5) * 22,
        vy: -Math.random() * 16 - 4,
        rot: Math.random() * Math.PI, vrot: (Math.random() - 0.5) * 0.4,
        size: 5 + Math.random() * 7,
        maxLife: 1.6 + Math.random() * 1.2,
        grav: 0.22, drag: 0.99,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }
  }

  starRain(duration = 2.4, gold = true) {
    const count = Math.floor(duration * 22);
    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        this.add({
          kind: "rain",
          x: Math.random() * this.w,
          y: -20,
          vy: 6 + Math.random() * 7,
          vx: (Math.random() - 0.5) * 1.4,
          size: 3 + Math.random() * 5,
          maxLife: 2.4,
          rot: Math.random() * Math.PI,
          vrot: 0.08,
          color: gold ? (Math.random() < 0.7 ? "#ffd76a" : "#e8b93b") : "#8a8a93",
        });
      }, i * (duration * 1000) / count);
    }
  }

  slashes(n = 5) {
    for (let i = 0; i < n; i++) {
      this.add({
        kind: "slash",
        x: this.w * (0.15 + Math.random() * 0.7),
        y: this.h * (0.1 + Math.random() * 0.8),
        vx: (Math.random() - 0.5) * 14,
        rot: (Math.random() - 0.5) * 1.6,
        size: 60 + Math.random() * 120,
        maxLife: 0.5 + Math.random() * 0.35,
        color: "#f6f4f0",
      });
    }
  }

  shards(x: number, y: number) {
    for (let i = 0; i < 26; i++) {
      const a = (Math.PI * 2 * i) / 26;
      this.add({
        kind: "shard", x, y,
        vx: Math.cos(a) * (4 + Math.random() * 7),
        vy: Math.sin(a) * (4 + Math.random() * 7) - 5,
        rot: Math.random() * Math.PI, vrot: (Math.random() - 0.5) * 0.5,
        size: 5 + Math.random() * 9,
        maxLife: 1 + Math.random() * 0.6,
        grav: 0.3, color: Math.random() < 0.5 ? "#e60012" : "#ff2a2a",
      });
    }
  }

  ring(x: number, y: number, color = "#f6f4f0", radius = 70) {
    this.add({ kind: "ring", x, y, size: radius, maxLife: 0.6, color });
  }

  ink(x: number, y: number, color = "#e60012") {
    this.add({ kind: "ink", x, y, size: 20, maxLife: 0.8, color });
  }

  textPop(x: number, y: number, text: string, color = "#ffd76a") {
    this.add({ kind: "text", x, y, text, color, vy: -1.6, size: 22, maxLife: 1.1, drag: 0.98 });
  }

  shake(power = 10) {
    this.shakeMag = Math.min(26, this.shakeMag + power);
  }

  flash(color = "#ffffff", alpha = 0.85) {
    this.flashColor = color;
    this.flashA = alpha;
  }

  heartbeat() {
    this.heartPulse = 1;
  }

  setCrt(on: boolean) {
    this.crtOn = on;
  }

  setAmbientGold(on: boolean) {
    this.goldAmbient = on;
  }

  setParticles(on: boolean) {
    this.particlesOn = on;
    if (!on) this.parts = [];
  }

  /* ---------------- loop ---------------- */

  private loop(t: number) {
    if (!this.running) return;
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);

    // shake decay + apply to app element
    if (this.shakeMag > 0.1) {
      this.shakeMag *= Math.pow(0.001, dt); // fast decay
      this.shakeX = (Math.random() - 0.5) * 2 * this.shakeMag;
      this.shakeY = (Math.random() - 0.5) * 2 * this.shakeMag;
    } else {
      this.shakeMag = 0;
      this.shakeX = 0;
      this.shakeY = 0;
    }
    if (this.app) {
      this.app.style.transform =
        this.shakeMag > 0.1 ? `translate3d(${this.shakeX}px, ${this.shakeY}px, 0)` : "";
    }

    // ambient dust
    this.dustTimer -= dt;
    if (this.dustTimer <= 0) {
      this.dustTimer = 0.7;
      this.add({
        kind: "dust", x: Math.random() * this.w, y: this.h + 10,
        vy: -(0.15 + Math.random() * 0.35),
        vx: (Math.random() - 0.5) * 0.2,
        size: 1 + Math.random() * 2.5,
        maxLife: 14,
        color: Math.random() < 0.7 ? "rgba(246,244,240,0.35)" : "rgba(230,0,18,0.3)",
      });
    }

    // ambient gold rising stars (results celebration)
    if (this.goldAmbient) {
      this.goldTimer -= dt;
      if (this.goldTimer <= 0) {
        this.goldTimer = 0.5;
        this.add({
          kind: "rain", x: Math.random() * this.w, y: this.h + 10,
          vy: -(0.8 + Math.random() * 1.4),
          vx: (Math.random() - 0.5) * 0.5,
          size: 2.5 + Math.random() * 4,
          maxLife: 10,
          rot: Math.random() * Math.PI, vrot: 0.05,
          color: Math.random() < 0.6 ? "#ffd76a" : "#e8b93b",
        });
      }
    }

    // cursor star trail
    if (this.cursorActive) {
      this.cursorTimer -= dt;
      if (this.cursorTimer <= 0) {
        this.cursorTimer = 0.045;
        this.add({
          kind: "rain", x: this.cursorX + (Math.random() - 0.5) * 18, y: this.cursorY + (Math.random() - 0.5) * 18,
          vx: (Math.random() - 0.5) * 0.8, vy: (Math.random() - 0.5) * 0.8 - 0.3,
          size: 2 + Math.random() * 4,
          maxLife: 0.55,
          rot: Math.random() * Math.PI, vrot: 0.12,
          color: Math.random() < 0.55 ? "#e60012" : "#ffd76a",
        });
      }
    }

    // cursor star
    if (this.cursorActive) {
      ctx.save();
      ctx.translate(this.cursorX, this.cursorY);
      ctx.rotate(t * 0.0012);
      ctx.fillStyle = "rgba(255,215,106,0.9)";
      ctx.beginPath();
      const s = 7;
      ctx.moveTo(0, -s);
      ctx.quadraticCurveTo(s * 0.18, -s * 0.18, s, 0);
      ctx.quadraticCurveTo(s * 0.18, s * 0.18, 0, s);
      ctx.quadraticCurveTo(-s * 0.18, s * 0.18, -s, 0);
      ctx.quadraticCurveTo(-s * 0.18, -s * 0.18, 0, -s);
      ctx.fill();
      ctx.restore();
    }

    // update + draw
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt / p.maxLife;
      if (p.life <= 0) {
        this.parts.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt * 60;
      p.y += p.vy * dt * 60;
      p.vy += p.grav * dt * 60;
      p.vx *= p.drag;
      p.rot += p.vrot;
      this.draw(ctx, p);
    }

    // full-screen flash
    if (this.flashA > 0.01) {
      ctx.globalAlpha = this.flashA;
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.globalAlpha = 1;
      this.flashA *= Math.pow(0.0001, dt);
    }

    // heartbeat vignette
    if (this.heartPulse > 0.01) {
      const a = this.heartPulse * 0.4;
      const grad = ctx.createRadialGradient(
        this.w / 2, this.h / 2, this.h * 0.3,
        this.w / 2, this.h / 2, this.h * 0.75,
      );
      grad.addColorStop(0, "rgba(230,0,18,0)");
      grad.addColorStop(1, `rgba(230,0,18,${a})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, this.w, this.h);
      this.heartPulse *= Math.pow(0.02, dt);
    }

    // CRT scanlines
    if (this.crtOn) {
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = "#000";
      for (let y = 0; y < this.h; y += 3) ctx.fillRect(0, y, this.w, 1);
      ctx.globalAlpha = 1;
    }

    requestAnimationFrame((tt) => this.loop(tt));
  }

  private draw(ctx: CanvasRenderingContext2D, p: Particle) {
    const a = p.life <= 0.15 ? p.life / 0.15 : p.life >= 0.8 ? (1 - p.life) / 0.2 : 1;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, a));
    ctx.translate(p.x, p.y);

    switch (p.kind) {
      case "dust": {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(0, 0, p.size, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "star": {
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        const s = p.size * (0.6 + 0.4 * (1 - p.life));
        ctx.beginPath();
        ctx.moveTo(0, -s);
        ctx.quadraticCurveTo(s * 0.18, -s * 0.18, s, 0);
        ctx.quadraticCurveTo(s * 0.18, s * 0.18, 0, s);
        ctx.quadraticCurveTo(-s * 0.18, s * 0.18, -s, 0);
        ctx.quadraticCurveTo(-s * 0.18, -s * 0.18, 0, -s);
        ctx.fill();
        break;
      }
      case "spark":
      case "rain": {
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.moveTo(0, -p.size);
        ctx.lineTo(p.size * 0.3, 0);
        ctx.lineTo(0, p.size);
        ctx.lineTo(-p.size * 0.3, 0);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case "slash": {
        ctx.rotate(p.rot);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 3.5;
        ctx.lineCap = "round";
        const len = p.size;
        const grad = ctx.createLinearGradient(-len, 0, len, 0);
        grad.addColorStop(0, "rgba(246,244,240,0)");
        grad.addColorStop(0.5, p.color);
        grad.addColorStop(1, "rgba(246,244,240,0)");
        ctx.strokeStyle = grad;
        ctx.beginPath();
        ctx.moveTo(-len, 0);
        ctx.lineTo(len, 0);
        ctx.stroke();
        break;
      }
      case "confetti": {
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
        break;
      }
      case "shard": {
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.moveTo(0, -p.size);
        ctx.lineTo(p.size * 0.7, 0);
        ctx.lineTo(0, p.size * 0.7);
        ctx.lineTo(-p.size * 0.5, 0);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case "ring": {
        const r = p.size * (1 - p.life);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 3 * p.life + 0.5;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case "ink": {
        const r = p.size * (1 - Math.pow(p.life, 2));
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "text": {
        ctx.font = `700 ${p.size}px "Barlow Condensed", sans-serif`;
        ctx.fillStyle = p.color;
        ctx.strokeStyle = "rgba(0,0,0,0.8)";
        ctx.lineWidth = 4;
        ctx.textAlign = "center";
        ctx.strokeText(p.text ?? "", 0, 0);
        ctx.fillText(p.text ?? "", 0, 0);
        break;
      }
    }
    ctx.restore();
  }
}

export const fx = new FxLayer();
