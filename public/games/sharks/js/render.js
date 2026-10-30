import { WORLD, PLAYER, PLATFORMS, FLOOR_Y, safeZone } from '../shared/physics.js';

const COLORS = {
  wall: '#1e4a86',
  wallLine: 'rgba(0,0,0,0.13)',
  stripeWhite: '#ffffff',
  stripeRed: '#c7362d',
  maple: '#e3b474',
  mapleDeep: '#b9834a',
  mapleGrain: 'rgba(122,76,30,0.25)',
  ink: '#221b14',
  paint: '#15607a',
  paintEdge: '#0e4457',
  fin: '#11303f',
  safe: '#49d49a',
  caught: '#ff5a3c',
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scale = 1;
    this.background = this.buildBackground();
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

    // The two safe walls, painted end-zone style with a hatched border
    for (const side of [-1, 1]) this.drawZonePaint(g, safeZone(side));

    // Half-court line
    g.strokeStyle = 'rgba(255,255,255,0.1)';
    g.lineWidth = 6;
    g.setLineDash([18, 16]);
    g.beginPath(); g.moveTo(WORLD.w / 2, 40); g.lineTo(WORLD.w / 2, FLOOR_Y); g.stroke();
    g.setLineDash([]);

    // Poles first so no support ever covers a platform in front of it
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (const pl of PLATFORMS) {
      if (pl.solid) continue;
      for (const x of [pl.x + 14, pl.x + pl.w - 20]) g.fillRect(x, pl.y + pl.h, 6, FLOOR_Y - pl.y - pl.h);
    }
    for (const pl of PLATFORMS) {
      if (pl.solid) this.drawFloor(g, pl);
      else this.drawBleacher(g, pl);
    }
    return c;
  }

  drawZonePaint(g, z) {
    g.fillStyle = COLORS.paint;
    g.fillRect(z.x, 0, z.w, FLOOR_Y);

    // Diagonal hatching, clipped to the zone
    g.save();
    g.beginPath(); g.rect(z.x, 0, z.w, FLOOR_Y); g.clip();
    g.strokeStyle = 'rgba(255,255,255,0.07)';
    g.lineWidth = 10;
    for (let x = z.x - FLOOR_Y; x < z.x + z.w; x += 34) {
      g.beginPath(); g.moveTo(x, FLOOR_Y); g.lineTo(x + FLOOR_Y, 0); g.stroke();
    }
    g.restore();

    // The line you're running for
    const edge = z.side < 0 ? z.x + z.w - 7 : z.x;
    g.fillStyle = COLORS.stripeWhite;
    g.fillRect(edge, 0, 7, FLOOR_Y);

    // Wall pad along the outside
    const pad = z.side < 0 ? 0 : WORLD.w - 10;
    g.fillStyle = COLORS.paintEdge;
    g.fillRect(pad, 60, 10, FLOOR_Y - 60);
    g.fillStyle = 'rgba(255,255,255,0.12)';
    for (let y = 60; y < FLOOR_Y; y += 62) g.fillRect(pad, y, 10, 2);

    // "SAFE" stencilled up the wall
    g.save();
    g.translate(z.x + z.w / 2 - z.side * 22, 300);
    g.rotate(-Math.PI / 2);
    g.font = '400 42px Graduate, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(255,255,255,0.16)';
    g.fillText('SAFE', 0, 0);
    g.restore();
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
    const caught = e.k === 'tag' || e.k === 'stranded';
    const color = caught ? COLORS.caught : COLORS.safe;
    const text = caught ? 'Caught!' : 'Safe!';
    this.effects.push({ kind: 'text', x: e.x, y: e.y - 18, text, sub: names.get(e.target), color, life: 1 });
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 110 + Math.random() * 200;
      this.effects.push({ kind: 'spark', x: e.x, y: e.y + PLAYER.h / 2, vx: Math.cos(a) * s, vy: Math.sin(a) * s, color, life: 0.5 });
    }
  }

  draw(view, { myId, roster, phase }) {
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

    this.drawZoneState(view, now);

    // Sharks behind minnows, so the thing chasing you never hides you.
    const ordered = [...view.players].sort((a, b) => b.r - a.r);
    for (const p of ordered) {
      this.drawPlayer(p, colors.get(p.id) ?? '#888', names.get(p.id) ?? '', p.id === myId);
    }

    this.drawEffects(dt);
    if (phase === 'playing') this.drawBanner(view, now);
  }

  // Tint the wall that currently matters: green where minnows are running to, amber
  // on the starting wall for as long as it still keeps sharks out.
  drawZoneState(view, now) {
    const ctx = this.ctx;
    const dest = safeZone(view.dir);
    const origin = safeZone(-view.dir);

    const pulse = 0.1 + 0.05 * Math.sin(now / 320);
    ctx.fillStyle = `rgba(73, 212, 154, ${pulse + 0.06})`;
    ctx.fillRect(dest.x, 0, dest.w, FLOOR_Y);

    const sheltered = view.stage !== 'running' || view.grace;
    if (sheltered) {
      ctx.fillStyle = 'rgba(255, 178, 30, 0.12)';
      ctx.fillRect(origin.x, 0, origin.w, FLOOR_Y);
    }

    // The line the sharks can't cross, drawn only while it holds.
    ctx.strokeStyle = sheltered ? 'rgba(255, 178, 30, 0.75)' : 'rgba(255, 90, 60, 0.35)';
    ctx.lineWidth = 4;
    ctx.setLineDash(sheltered ? [] : [10, 12]);
    const edge = origin.side < 0 ? origin.x + origin.w : origin.x;
    ctx.beginPath(); ctx.moveTo(edge, 0); ctx.lineTo(edge, FLOOR_Y); ctx.stroke();
    ctx.setLineDash([]);
  }

  drawPlayer(p, color, name, isMe) {
    const ctx = this.ctx;
    const { w, h } = PLAYER;
    const cx = p.x + w / 2;
    const shark = p.r === 1;

    if (p.k) this.drawWake(p);
    ctx.globalAlpha = p.st ? 0.78 : 1;

    if (shark) {
      // Dorsal fin, swept back against the way they're facing
      ctx.fillStyle = COLORS.fin;
      ctx.beginPath();
      ctx.moveTo(cx - 10, p.y + 3);
      ctx.lineTo(cx + 10, p.y + 3);
      ctx.lineTo(cx - p.f * 7, p.y - 16);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = COLORS.ink;
      ctx.stroke();
    }

    ctx.fillStyle = color;
    roundRect(ctx, p.x, p.y, w, h, 6); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(p.x, p.y + h - 12, w, 8);
    ctx.fillStyle = shark ? COLORS.fin : '#ffffff';
    ctx.fillRect(p.x, p.y + 6, w, 4);
    ctx.lineWidth = 2;
    ctx.strokeStyle = COLORS.ink;
    roundRect(ctx, p.x, p.y, w, h, 6); ctx.stroke();

    // Eyes look the way you're moving
    const ex = cx + p.f * 5;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(ex - 6, p.y + 14, 5, 6);
    ctx.fillRect(ex + 1, p.y + 14, 5, 6);
    ctx.fillStyle = COLORS.ink;
    ctx.fillRect(ex - 4 + p.f, p.y + 16, 2, 3);
    ctx.fillRect(ex + 3 + p.f, p.y + 16, 2, 3);

    ctx.globalAlpha = 1;

    if (p.st) {
      ctx.strokeStyle = COLORS.safe;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx - 7, p.y - 8);
      ctx.lineTo(cx - 2, p.y - 3);
      ctx.lineTo(cx + 8, p.y - 14);
      ctx.stroke();
    } else {
      this.label(name, cx, p.y - 10, 13, '#ffffff');
    }

    if (isMe) {
      ctx.fillStyle = '#ffb21e';
      ctx.beginPath();
      ctx.moveTo(cx - 6, p.y - 32);
      ctx.lineTo(cx + 6, p.y - 32);
      ctx.lineTo(cx, p.y - 25);
      ctx.closePath();
      ctx.fill();
    }
  }

  drawWake(p) {
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    for (let i = 1; i <= 3; i++) {
      const x = p.x + PLAYER.w / 2 - p.f * (14 + i * 11);
      ctx.globalAlpha = 0.5 - i * 0.13;
      ctx.beginPath();
      ctx.moveTo(x, p.y + 10);
      ctx.lineTo(x, p.y + PLAYER.h - 10);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  drawBanner(view, now) {
    const ctx = this.ctx;
    const midX = WORLD.w / 2;

    if (view.stage === 'countdown') {
      const n = Math.max(1, Math.ceil(view.stageLeft));
      this.label(`Crossing ${view.crossing}`, midX, 180, 26, '#ffffff');
      this.label(String(n), midX, 250, 92, '#ffb21e', 'Graduate');
      this.drawDirectionArrow(view.dir, now);
      return;
    }

    if (view.stage === 'running' && view.grace) {
      this.label('GO!', midX, 220, 72, '#ffffff', 'Graduate');
      this.drawDirectionArrow(view.dir, now);
      return;
    }

    if (view.stage === 'tally') {
      const made = view.minnows;
      const text = made === 0 ? 'The sharks got everyone' : `${made} made it across`;
      this.label(text, midX, 200, 34, made === 0 ? COLORS.caught : COLORS.safe, 'Graduate');
    }
  }

  drawDirectionArrow(dir, now) {
    const ctx = this.ctx;
    const drift = (now / 10) % 70;
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const x = WORLD.w / 2 + dir * (i * 70 + drift - 70);
      ctx.globalAlpha = 0.45 - Math.abs(i - 1) * 0.15;
      ctx.beginPath();
      ctx.moveTo(x - dir * 18, 330);
      ctx.lineTo(x + dir * 14, 362);
      ctx.lineTo(x - dir * 18, 394);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = 'butt';
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
        this.label(fx.text, fx.x, fx.y, 26, fx.color, 'Graduate');
        if (fx.sub) this.label(fx.sub, fx.x, fx.y + 21, 13, '#ffffff');
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
