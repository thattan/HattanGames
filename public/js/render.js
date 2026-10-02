import { WORLD, PLAYER, BALL, PLATFORMS } from '../shared/physics.js';

const COLORS = {
  wall: '#1e4a86',
  wallLine: 'rgba(0,0,0,0.13)',
  stripeWhite: '#ffffff',
  stripeRed: '#c7362d',
  maple: '#e3b474',
  mapleDeep: '#b9834a',
  mapleGrain: 'rgba(122,76,30,0.25)',
  ink: '#221b14',
  ball: '#d2352b',
  ballDead: '#9a3b33',
  ballSeam: '#7a1d17',
};

const TRAIL_LEN = 7;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scale = 1;
    this.background = this.buildBackground();
    this.trails = new Map();
    this.effects = [];
    this.lastFrame = performance.now();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.scale = this.canvas.width / WORLD.w;
  }

  toWorld(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * WORLD.w,
      y: ((clientY - rect.top) / rect.height) * WORLD.h,
    };
  }

  buildBackground() {
    const c = document.createElement('canvas');
    c.width = WORLD.w;
    c.height = WORLD.h;
    const g = c.getContext('2d');

    // Cinderblock wall
    g.fillStyle = COLORS.wall;
    g.fillRect(0, 0, WORLD.w, WORLD.h);
    g.strokeStyle = COLORS.wallLine;
    g.lineWidth = 2;
    for (let row = 0, y = 0; y < WORLD.h; row++, y += 40) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(WORLD.w, y); g.stroke();
      for (let x = row % 2 ? 50 : 0; x < WORLD.w; x += 100) {
        g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 40); g.stroke();
      }
    }

    // Painted wall stripes
    g.fillStyle = COLORS.stripeWhite;
    g.fillRect(0, 600, WORLD.w, 8);
    g.fillStyle = COLORS.stripeRed;
    g.fillRect(0, 608, WORLD.w, 18);

    // Faded center-court circle painted on the wall, purely decorative
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.lineWidth = 10;
    g.beginPath(); g.arc(WORLD.w / 2, 330, 150, 0, Math.PI * 2); g.stroke();

    // Wall pads on both sides, where bank shots happen
    for (const x of [0, WORLD.w - 10]) {
      g.fillStyle = '#163a6b';
      g.fillRect(x, 60, 10, 620);
      g.fillStyle = 'rgba(255,255,255,0.12)';
      for (let y = 60; y < 680; y += 62) g.fillRect(x, y, 10, 2);
    }

    // Poles first so no support ever covers a platform in front of it
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (const pl of PLATFORMS) {
      if (pl.solid) continue;
      for (const x of [pl.x + 14, pl.x + pl.w - 20]) g.fillRect(x, pl.y + pl.h, 6, 680 - pl.y - pl.h);
    }
    for (const pl of PLATFORMS) {
      if (pl.solid) this.drawFloor(g, pl);
      else this.drawBleacher(g, pl);
    }
    return c;
  }

  drawFloor(g, pl) {
    g.fillStyle = COLORS.maple;
    g.fillRect(pl.x, pl.y, pl.w, pl.h);
    g.fillStyle = COLORS.stripeRed;
    g.fillRect(pl.x, pl.y, pl.w, 5);
    g.strokeStyle = COLORS.mapleGrain;
    g.lineWidth = 1;
    for (let y = pl.y + 13; y < pl.y + pl.h; y += 9) {
      g.beginPath(); g.moveTo(pl.x, y); g.lineTo(pl.x + pl.w, y); g.stroke();
    }
    for (let x = 37; x < pl.w; x += 131) {
      g.beginPath(); g.moveTo(x, pl.y + 5); g.lineTo(x, pl.y + pl.h); g.stroke();
    }
  }

  drawBleacher(g, pl) {
    g.fillStyle = COLORS.maple;
    g.fillRect(pl.x, pl.y, pl.w, pl.h);
    g.fillStyle = COLORS.mapleDeep;
    g.fillRect(pl.x, pl.y + pl.h - 5, pl.w, 5);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillRect(pl.x, pl.y, pl.w, 2);
  }

  spawnEffect(e, names) {
    const color = e.k === 'hit' ? '#ffffff' : '#ffb21e';
    const text = e.k === 'hit' ? 'Out!' : 'Caught!';
    const sub = e.k === 'hit' ? names.get(e.target) : names.get(e.by);
    this.effects.push({ kind: 'text', x: e.x, y: e.y - 20, text, sub, color, life: 1 });
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 120 + Math.random() * 220;
      this.effects.push({ kind: 'spark', x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, color, life: 0.5 });
    }
  }

  draw(view, { myId, roster, aim, phase }) {
    const now = performance.now();
    const dt = Math.min((now - this.lastFrame) / 1000, 0.1);
    this.lastFrame = now;
    const ctx = this.ctx;
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.drawImage(this.background, 0, 0);
    if (!view) return;

    const names = new Map(roster.map((p) => [p.id, p.name]));
    const colors = new Map(roster.map((p) => [p.id, p.color]));
    for (const e of view.events) this.spawnEffect(e, names);

    const playersById = new Map(view.players.map((p) => [p.id, p]));

    // Free balls with trails for live throws
    const seen = new Set();
    for (const b of view.balls) {
      seen.add(b.id);
      let trail = this.trails.get(b.id);
      if (!trail) this.trails.set(b.id, (trail = []));
      if (b.st === 1) {
        trail.push({ x: b.x, y: b.y });
        if (trail.length > TRAIL_LEN) trail.shift();
      } else {
        trail.length = 0;
      }
      if (b.st === 2) continue; // held balls are drawn with their holder
      this.drawTrail(trail);
      this.drawBall(b.x, b.y, b.st === 1);
    }
    for (const id of this.trails.keys()) if (!seen.has(id)) this.trails.delete(id);

    // Players
    for (const p of view.players) {
      if (!p.a) continue;
      this.drawPlayer(p, colors.get(p.id) ?? '#888', names.get(p.id) ?? '', p.id === myId, now);
    }

    // Held balls, attached to the holder's rendered position
    for (const b of view.balls) {
      if (b.st !== 2) continue;
      const h = playersById.get(b.o);
      if (!h || !h.a) continue;
      this.drawBall(h.x + PLAYER.w / 2 + h.f * 14, h.y + 22, false);
    }

    const self = view.self;
    if (phase === 'playing' && self?.a && self.h) this.drawAimGuide(self, aim);

    this.drawEffects(dt);

    if (phase === 'playing' && self && !self.a) {
      ctx.fillStyle = 'rgba(13,27,48,0.35)';
      ctx.fillRect(0, 0, WORLD.w, WORLD.h);
      this.label(`You're out. Back in ${Math.max(0, self.r).toFixed(1)}s`, WORLD.w / 2, WORLD.h / 2, 34, '#ffffff');
    }
  }

  drawTrail(trail) {
    const ctx = this.ctx;
    for (let i = 0; i < trail.length - 1; i++) {
      const t = (i + 1) / trail.length;
      ctx.fillStyle = `rgba(255,255,255,${0.35 * t})`;
      ctx.beginPath();
      ctx.arc(trail[i].x, trail[i].y, BALL.r * (0.4 + 0.5 * t), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawBall(x, y, live) {
    const ctx = this.ctx;
    if (live) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, BALL.r + 4, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = live ? COLORS.ball : COLORS.ballDead;
    ctx.beginPath(); ctx.arc(x, y, BALL.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = COLORS.ballSeam;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, BALL.r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - BALL.r, y - 2); ctx.quadraticCurveTo(x, y + 5, x + BALL.r, y - 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath(); ctx.arc(x - 4, y - 4, 3, 0, Math.PI * 2); ctx.fill();
  }

  drawPlayer(p, color, name, isMe, now) {
    const ctx = this.ctx;
    const { w, h } = PLAYER;
    const flicker = p.i && Math.floor(now / 90) % 2 === 0;
    ctx.globalAlpha = flicker ? 0.35 : 1;

    // Body (shirt), shorts, headband
    ctx.fillStyle = color;
    roundRect(ctx, p.x, p.y, w, h, 6); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(p.x, p.y + h - 13, w, 9);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(p.x, p.y + 6, w, 4);
    ctx.lineWidth = 2;
    ctx.strokeStyle = COLORS.ink;
    roundRect(ctx, p.x, p.y, w, h, 6); ctx.stroke();

    // Eyes look the way you're facing
    const ex = p.x + w / 2 + p.f * 5;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(ex - 6, p.y + 14, 5, 6);
    ctx.fillRect(ex + 1, p.y + 14, 5, 6);
    ctx.fillStyle = COLORS.ink;
    ctx.fillRect(ex - 4 + p.f, p.y + 16, 2, 3);
    ctx.fillRect(ex + 3 + p.f, p.y + 16, 2, 3);

    // Catching: raised glove ring
    if (p.c) {
      ctx.strokeStyle = '#ffb21e';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x + w / 2, p.y + h / 2, 30, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    this.label(name, p.x + w / 2, p.y - 10, 14, '#ffffff');
    if (isMe) {
      ctx.fillStyle = '#ffb21e';
      ctx.beginPath();
      ctx.moveTo(p.x + w / 2 - 6, p.y - 34);
      ctx.lineTo(p.x + w / 2 + 6, p.y - 34);
      ctx.lineTo(p.x + w / 2, p.y - 27);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Dotted preview of the throw arc
  drawAimGuide(self, aim) {
    const ctx = this.ctx;
    const dx = Math.cos(aim);
    const dy = Math.sin(aim);
    let x = self.x + PLAYER.w / 2 + dx * 24;
    let y = self.y + PLAYER.h / 2 + dy * 24;
    let vx = dx * BALL.throwSpeed + self.vx * 0.25;
    let vy = dy * BALL.throwSpeed;
    const step = 1 / 60;
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    for (let i = 0; i < 24; i++) {
      for (let k = 0; k < 2; k++) { vy += BALL.liveGravity * step; x += vx * step; y += vy * step; }
      if (x < 0 || x > WORLD.w || y > WORLD.h) break;
      ctx.globalAlpha = 1 - i / 24;
      ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  drawEffects(dt) {
    const ctx = this.ctx;
    for (const fx of this.effects) {
      fx.life -= dt;
      if (fx.kind === 'spark') {
        fx.x += fx.vx * dt;
        fx.y += fx.vy * dt;
        fx.vy += 600 * dt;
        ctx.globalAlpha = Math.max(0, fx.life * 2);
        ctx.fillStyle = fx.color;
        ctx.fillRect(fx.x - 2, fx.y - 2, 4, 4);
      } else {
        fx.y -= 40 * dt;
        ctx.globalAlpha = Math.max(0, Math.min(1, fx.life * 1.5));
        this.label(fx.text, fx.x, fx.y, 28, fx.color, 'Graduate');
        if (fx.sub) this.label(fx.sub, fx.x, fx.y + 22, 14, '#ffffff');
      }
    }
    ctx.globalAlpha = 1;
    this.effects = this.effects.filter((fx) => fx.life > 0);
  }

  label(text, x, y, size, color, family = 'Barlow') {
    const ctx = this.ctx;
    ctx.font = `${family === 'Barlow' ? '700 ' : ''}${size}px ${family}, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(3, size / 5);
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
