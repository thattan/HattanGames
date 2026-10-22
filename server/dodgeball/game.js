import {
  PLAYER, BALL, RULES, SPAWNS, BALL_SPAWNS,
  clamp, circleRect, stepPlayer, stepBall,
} from '../../public/games/dodgeball/shared/physics.js';

const round1 = (n) => Math.round(n * 10) / 10;

export class Game {
  constructor() {
    this.players = new Map();
    this.balls = [];
    this.timeLeft = RULES.roundSeconds;
    this.events = [];
    this.nextBallId = 1;
  }

  addPlayer(id, name, color) {
    const p = {
      id, name, color,
      x: 0, y: 0, vx: 0, vy: 0, facing: 1,
      onGround: false, groundSolid: false, coyote: 0, jumpBuffer: 0, dropTimer: 0,
      alive: true, respawn: 0, invuln: 0,
      holding: null, throwCd: 0, catchWin: 0, catchCd: 0,
      wantThrow: false, wantCatch: false,
      score: 0, hits: 0, catches: 0, outs: 0,
      input: { left: false, right: false, down: false, jump: false, aim: -0.2 },
      seq: { jump: null, throw: null, catch: null },
    };
    this.players.set(id, p);
    this.spawn(p);
    this.ensureBalls();
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.dropBall(p);
    this.players.delete(id);
  }

  setInput(id, m) {
    const p = this.players.get(id);
    if (!p || typeof m !== 'object') return;
    const inp = p.input;
    inp.left = !!m.left;
    inp.right = !!m.right;
    inp.down = !!m.down;
    inp.jump = !!m.jump;
    if (Number.isFinite(m.aim)) inp.aim = clamp(m.aim, -Math.PI * 2, Math.PI * 2);

    // Button presses arrive as counters so a quick tap between ticks is never lost.
    // The first value we see only syncs the counter (it may be left over from a past round).
    const press = (key, value, onPress) => {
      if (!Number.isInteger(value)) return;
      if (p.seq[key] !== null && value !== p.seq[key]) onPress();
      p.seq[key] = value;
    };
    press('jump', m.js, () => { p.jumpBuffer = PLAYER.jumpBuffer; });
    press('throw', m.ts, () => { p.wantThrow = true; });
    press('catch', m.cs, () => { p.wantCatch = true; });
  }

  ensureBalls() {
    const want = clamp(Math.ceil(this.players.size / 2), 2, BALL_SPAWNS.length);
    while (this.balls.length < want) {
      const s = BALL_SPAWNS[this.balls.length];
      this.balls.push({
        id: this.nextBallId++, x: s.x, y: s.y, vx: 0, vy: 0,
        state: 'dead', owner: null, liveTimer: 0, onGround: false,
      });
    }
  }

  spawn(p) {
    // Pick the spawn point farthest from other living players.
    let best = SPAWNS[0];
    let bestDist = -1;
    for (const s of SPAWNS) {
      let nearest = Infinity;
      for (const o of this.players.values()) {
        if (o === p || !o.alive) continue;
        nearest = Math.min(nearest, Math.hypot(o.x - s.x, o.y - s.y));
      }
      const d = nearest === Infinity ? Math.random() : nearest + Math.random() * 40;
      if (d > bestDist) { bestDist = d; best = s; }
    }
    Object.assign(p, {
      x: best.x - PLAYER.w / 2, y: best.y - PLAYER.h, vx: 0, vy: 0,
      alive: true, respawn: 0, invuln: RULES.invulnSeconds,
      onGround: false, catchWin: 0, jumpBuffer: 0,
    });
  }

  ballById(id) {
    return this.balls.find((b) => b.id === id);
  }

  dropBall(p) {
    if (p.holding === null) return;
    const b = this.ballById(p.holding);
    p.holding = null;
    if (!b) return;
    Object.assign(b, { state: 'dead', owner: null, vx: p.vx * 0.5, vy: -220 });
  }

  eliminate(p) {
    if (!p.alive) return;
    this.dropBall(p);
    p.alive = false;
    p.respawn = RULES.respawnSeconds;
    p.outs++;
  }

  throwBall(p) {
    const b = this.ballById(p.holding);
    if (!b) { p.holding = null; return; }
    const a = p.input.aim;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const cx = p.x + PLAYER.w / 2;
    const cy = p.y + PLAYER.h / 2;
    Object.assign(b, {
      x: cx + dx * 24, y: cy + dy * 24,
      vx: dx * BALL.throwSpeed + p.vx * 0.25,
      vy: dy * BALL.throwSpeed,
      state: 'live', owner: p.id, liveTimer: BALL.liveTime,
    });
    p.holding = null;
    p.throwCd = RULES.throwCooldown;
    if (Math.abs(dx) > 0.1) p.facing = Math.sign(dx);
  }

  step(dt) {
    this.timeLeft = Math.max(0, this.timeLeft - dt);

    for (const p of this.players.values()) {
      if (!p.alive) {
        p.respawn -= dt;
        if (p.respawn <= 0) this.spawn(p);
        continue;
      }
      p.invuln = Math.max(0, p.invuln - dt);
      p.throwCd = Math.max(0, p.throwCd - dt);
      p.catchCd = Math.max(0, p.catchCd - dt);
      p.catchWin = Math.max(0, p.catchWin - dt);

      stepPlayer(p, p.input, dt);

      if (p.wantThrow && p.holding !== null && p.throwCd <= 0) this.throwBall(p);
      p.wantThrow = false;

      if (p.wantCatch && p.catchCd <= 0 && p.holding === null) {
        p.catchWin = RULES.catchWindow;
        p.catchCd = RULES.catchCooldown;
      }
      p.wantCatch = false;
    }

    for (const b of this.balls) {
      if (b.state === 'held') {
        const h = this.players.get(b.owner);
        if (!h || !h.alive || h.holding !== b.id) {
          b.state = 'dead';
          b.owner = null;
          continue;
        }
        b.x = h.x + PLAYER.w / 2 + h.facing * 14;
        b.y = h.y + 22;
        b.vx = h.vx;
        b.vy = h.vy;
        continue;
      }

      const touchedGround = stepBall(b, dt);
      if (b.state === 'live') {
        b.liveTimer -= dt;
        if (touchedGround || b.liveTimer <= 0) { b.state = 'dead'; b.owner = null; }
      }

      if (b.state === 'live') this.resolveLiveBall(b);
      else if (b.state === 'dead') this.resolvePickup(b);
    }
  }

  resolveLiveBall(b) {
    const thrower = this.players.get(b.owner);
    for (const p of this.players.values()) {
      if (!p.alive || p.id === b.owner || p.invuln > 0) continue;

      const canCatch = p.catchWin > 0 && p.holding === null;
      if (canCatch && circleRect(b.x, b.y, BALL.r + BALL.catchReach, p.x, p.y, PLAYER.w, PLAYER.h)) {
        p.score++;
        p.catches++;
        p.holding = b.id;
        p.catchWin = 0;
        Object.assign(b, { state: 'held', owner: p.id });
        if (thrower) this.eliminate(thrower);
        this.events.push({ k: 'catch', by: p.id, thrower: b.owner, x: round1(b.x), y: round1(b.y) });
        return;
      }

      if (circleRect(b.x, b.y, BALL.r, p.x, p.y, PLAYER.w, PLAYER.h)) {
        if (thrower) { thrower.score++; thrower.hits++; }
        this.events.push({ k: 'hit', by: b.owner, target: p.id, x: round1(b.x), y: round1(b.y) });
        this.eliminate(p);
        Object.assign(b, { state: 'dead', owner: null, vx: -b.vx * 0.3, vy: -260 });
        return;
      }
    }
  }

  resolvePickup(b) {
    for (const p of this.players.values()) {
      if (!p.alive || p.holding !== null) continue;
      if (circleRect(b.x, b.y, BALL.r, p.x, p.y, PLAYER.w, PLAYER.h)) {
        p.holding = b.id;
        Object.assign(b, { state: 'held', owner: p.id });
        return;
      }
    }
  }

  snapshot() {
    const events = this.events;
    this.events = [];
    return {
      t: Date.now(),
      timeLeft: round1(this.timeLeft),
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        x: round1(p.x), y: round1(p.y), vx: round1(p.vx), vy: round1(p.vy),
        f: p.facing,
        a: p.alive ? 1 : 0,
        h: p.holding !== null ? 1 : 0,
        i: p.invuln > 0 ? 1 : 0,
        c: p.catchWin > 0 ? 1 : 0,
        r: p.alive ? 0 : round1(Math.max(0, p.respawn)),
        s: p.score,
      })),
      balls: this.balls.map((b) => ({
        id: b.id,
        x: round1(b.x), y: round1(b.y),
        st: b.state === 'live' ? 1 : b.state === 'held' ? 2 : 0,
        o: b.owner,
      })),
      events,
    };
  }

  results() {
    return [...this.players.values()]
      .sort((a, b) => b.score - a.score || b.hits - a.hits || a.outs - b.outs)
      .map((p, i) => ({
        id: p.id, name: p.name, color: p.color,
        score: p.score, hits: p.hits, catches: p.catches, outs: p.outs,
        placement: i + 1,
      }));
  }
}
