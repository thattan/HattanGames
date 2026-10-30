import {
  PLAYER, DASH, SPEED, RULES, SAFE, WORLD, FLOOR_Y,
  clamp, stepPlayer, startDash, touching, safeZone, inZone,
} from '../../public/games/sharks/shared/physics.js';

const round1 = (n) => Math.round(n * 10) / 10;
const STILL = { left: false, right: false, down: false, jump: false };
const PATROL_MARGIN = 140; // how far off each wall the sharks line up at the whistle

// A match is a sequence of crossings, each a four-stage machine:
//
//   countdown (3 s)  minnows penned at the starting wall, sharks pacing the water
//   running (20 s)   tagging is live; reach the far wall or get caught
//   tally (3 s)      everyone sees who made it
//   -> next crossing, with the direction flipped, or `done`
//
// Tagged minnows turn shark immediately, so a crossing gets more dangerous as it
// goes. The match ends when one minnow is left against a pack (they win), when the
// sharks have taken everyone, or at the crossing cap.
export class SharksGame {
  constructor() {
    this.players = new Map();
    this.stage = 'countdown';
    this.stageLeft = RULES.countdownSeconds;
    this.crossing = 1;
    this.dir = 1;          // 1 = running toward the right wall, -1 = toward the left
    this.sinceWhistle = 0;
    this.events = [];
    this.cutShort = false;
  }

  // ---------- roster ----------

  makePlayer(id, name, color, shark) {
    return {
      id, name, color,
      x: 0, y: 0, vx: 0, vy: 0, facing: 1,
      onGround: false, groundSolid: false, coyote: 0, jumpBuffer: 0, dropTimer: 0,
      dash: 0, dashCd: 0, wantDash: false, tagCd: 0, speedMul: 1,
      shark, safe: false,
      crossings: 0, tags: 0, won: false,
      input: { left: false, right: false, down: false, jump: false },
      seq: { jump: null, dash: null },
    };
  }

  addPlayer(id, name, color) {
    this.players.set(id, this.makePlayer(id, name, color, false));
  }

  // Joining mid-match means joining the pack: handing out a fresh minnow life would
  // let anyone reset their odds by reconnecting.
  addLatePlayer(id, name, color) {
    const p = this.makePlayer(id, name, color, true);
    this.players.set(id, p);
    this.place(p, this.patrolSpot(this.players.size - 1, this.players.size));
    p.dashCd = DASH.shark.cooldown;
  }

  removePlayer(id) {
    if (!this.players.delete(id) || this.stage === 'done') return;
    if (this.players.size < RULES.minPlayers || this.count(true) === 0) {
      this.cutShort = true;
      this.finish();
      return;
    }
    // The leaver may have been the last minnow still swimming.
    if (this.stage === 'running' && this.allMinnowsResolved()) this.finishCrossing();
  }

  roster(shark) {
    return [...this.players.values()].filter((p) => p.shark === shark);
  }

  count(shark) {
    return this.roster(shark).length;
  }

  // ---------- starting positions ----------

  place(p, spot) {
    Object.assign(p, {
      x: spot.x, y: spot.y, vx: 0, vy: 0,
      onGround: false, jumpBuffer: 0, dropTimer: 0, coyote: 0,
      dash: 0, dashCd: 0, wantDash: false, tagCd: 0, safe: false,
    });
  }

  // Minnows line up along the starting wall. Sixteen of them overlap, which is
  // exactly what the start of a real round looks like.
  lineUpSpot(i, count) {
    const z = safeZone(-this.dir);
    const perRow = Math.max(1, Math.floor((z.w - 12) / (PLAYER.w + 2)));
    const step = count > 1 ? (z.w - PLAYER.w - 12) / Math.max(1, Math.min(count, perRow) - 1) : 0;
    const row = Math.floor(i / perRow);
    const x = z.x + 6 + (i % perRow) * step + (row % 2 ? step / 2 : 0);
    return { x: clamp(x, z.x, z.x + z.w - PLAYER.w), y: FLOOR_Y - PLAYER.h };
  }

  // Sharks spread evenly across the middle of the water. The band is kept well clear
  // of both walls on purpose: a shark starting right on the line would tag the whole
  // pack the moment it left the wall, and the far wall is meant to be defended, not
  // sat on from the first frame.
  patrolSpot(i, count) {
    const lo = SAFE.w + PATROL_MARGIN;
    const hi = WORLD.w - SAFE.w - PATROL_MARGIN - PLAYER.w;
    const x = count > 1 ? lo + (i * (hi - lo)) / (count - 1) : (lo + hi) / 2;
    return { x, y: FLOOR_Y - PLAYER.h };
  }

  // ---------- match flow ----------

  begin() {
    const ids = [...this.players.keys()];
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    const sharks = Math.max(1, Math.round(ids.length / RULES.sharksPerPlayers));
    for (const id of ids.slice(0, sharks)) this.players.get(id).shark = true;
    this.beginCrossing(1, 1);
  }

  beginCrossing(n, dir) {
    this.crossing = n;
    this.dir = dir;
    this.stage = 'countdown';
    this.stageLeft = RULES.countdownSeconds;
    this.sinceWhistle = 0;

    const minnows = this.roster(false);
    const sharks = this.roster(true);
    minnows.forEach((p, i) => this.place(p, this.lineUpSpot(i, minnows.length)));
    sharks.forEach((p, i) => this.place(p, this.patrolSpot(i, sharks.length)));
  }

  // Returns true when the whistle blew or the stage changed, so the room can push
  // a snapshot immediately rather than waiting for the next scheduled one.
  step(dt) {
    if (this.stage === 'done') return false;

    this.stageLeft = Math.max(0, this.stageLeft - dt);
    if (this.stage === 'running') this.sinceWhistle += dt;

    for (const p of this.players.values()) this.advance(p, dt);

    if (this.stage === 'running') {
      this.resolveTags();
      this.resolveSafe();
      if (this.allMinnowsResolved() || this.stageLeft <= 0) {
        this.finishCrossing();
        return true;
      }
      return false;
    }

    if (this.stageLeft > 0) return false;
    if (this.stage === 'countdown') {
      this.stage = 'running';
      this.stageLeft = RULES.crossingSeconds;
      this.sinceWhistle = 0;
      return true;
    }
    this.nextCrossing();
    return true;
  }

  advance(p, dt) {
    const frozen = this.stage === 'tally';
    p.speedMul = SPEED[p.shark ? 'shark' : 'minnow'];
    p.dashCd = Math.max(0, p.dashCd - dt);
    p.tagCd = Math.max(0, p.tagCd - dt);

    stepPlayer(p, frozen ? STILL : p.input, dt);

    if (p.wantDash && !frozen && p.dashCd <= 0) {
      const dir = (p.input.right ? 1 : 0) - (p.input.left ? 1 : 0);
      startDash(p, p.shark ? 'shark' : 'minnow', dir);
    }
    p.wantDash = false;

    this.confine(p);
  }

  // The walls are the whole game, so they're enforced here rather than in the
  // shared step: sharks are kept out, safe minnows are kept in.
  confine(p) {
    const dest = safeZone(this.dir);
    const origin = safeZone(-this.dir);

    if (p.shark) {
      this.pushOut(p, dest);
      // The starting wall shelters minnows for a few seconds, then it's open water —
      // otherwise a nervous minnow could camp there for the whole crossing.
      if (this.stage !== 'running' || this.sinceWhistle < RULES.graceSeconds) {
        this.pushOut(p, origin);
      }
      return;
    }
    if (p.safe) { this.pushIn(p, dest); return; }
    if (this.stage === 'countdown') this.pushIn(p, origin);
  }

  pushOut(p, z) {
    if (z.side < 0) {
      if (p.x < z.w) { p.x = z.w; if (p.vx < 0) { p.vx = 0; p.dash = 0; } }
    } else if (p.x + PLAYER.w > z.x) {
      p.x = z.x - PLAYER.w;
      if (p.vx > 0) { p.vx = 0; p.dash = 0; }
    }
  }

  pushIn(p, z) {
    const lo = z.x;
    const hi = z.x + z.w - PLAYER.w;
    if (p.x < lo) { p.x = lo; if (p.vx < 0) p.vx = 0; }
    if (p.x > hi) { p.x = hi; if (p.vx > 0) p.vx = 0; }
  }

  resolveTags() {
    // Snapshot the pack first: a minnow tagged this frame shouldn't get to tag
    // someone else before the frame is out.
    const sharks = this.roster(true);
    for (const s of sharks) {
      if (s.tagCd > 0) continue;
      for (const m of this.players.values()) {
        if (m.shark || m.safe || !touching(s, m, 2)) continue;
        this.convert(m, 'tag', s);
        s.tags++;
        // One at a time. Running through the pack at the start line shouldn't
        // take the whole pack with it.
        s.tagCd = RULES.tagCooldown;
        break;
      }
    }
  }

  resolveSafe() {
    const dest = safeZone(this.dir);
    for (const p of this.players.values()) {
      if (p.shark || p.safe || !inZone(p, dest)) continue;
      p.safe = true;
      p.crossings++;
      this.events.push({ k: 'safe', target: p.id, ...this.at(p) });
    }
  }

  convert(minnow, kind, by = null) {
    minnow.shark = true;
    minnow.dash = 0;
    minnow.dashCd = DASH.shark.cooldown;  // no free lunge the instant you turn
    minnow.tagCd = RULES.tagCooldown;     // nor a free tag off the player beside you
    this.events.push({ k: kind, by: by?.id ?? null, target: minnow.id, ...this.at(minnow) });
  }

  at(p) {
    return { x: round1(p.x + PLAYER.w / 2), y: round1(p.y) };
  }

  allMinnowsResolved() {
    for (const p of this.players.values()) if (!p.shark && !p.safe) return false;
    return true;
  }

  finishCrossing() {
    // Anyone still in the water when the whistle goes is caught by default.
    for (const p of this.players.values()) {
      if (!p.shark && !p.safe) this.convert(p, 'stranded');
    }
    this.stage = 'tally';
    this.stageLeft = RULES.tallySeconds;
  }

  nextCrossing() {
    if (this.shouldEnd()) { this.finish(); return; }
    this.beginCrossing(this.crossing + 1, -this.dir);
  }

  shouldEnd() {
    const minnows = this.count(false);
    if (minnows === 0) return true;
    // One minnow against a pack is the classic finish. With two players the lone
    // shark isn't a pack yet, so that match runs until the minnow is finally caught.
    if (minnows === 1 && this.count(true) >= 2) return true;
    return this.crossing >= RULES.maxCrossings;
  }

  finish() {
    const minnows = this.roster(false);
    if (!this.cutShort && minnows.length === 1) minnows[0].won = true;
    this.stage = 'done';
    this.stageLeft = 0;
  }

  // ---------- input ----------

  setInput(id, m) {
    const p = this.players.get(id);
    if (!p || typeof m !== 'object') return;
    const inp = p.input;
    inp.left = !!m.left;
    inp.right = !!m.right;
    inp.down = !!m.down;
    inp.jump = !!m.jump;

    // Presses arrive as ever-increasing counters so a tap shorter than one server
    // tick is never dropped. The first value seen only syncs the counter — it may be
    // left over from a previous crossing.
    const press = (key, value, onPress) => {
      if (!Number.isInteger(value)) return;
      if (p.seq[key] !== null && value !== p.seq[key]) onPress();
      p.seq[key] = value;
    };
    press('jump', m.js, () => { p.jumpBuffer = PLAYER.jumpBuffer; });
    press('dash', m.ds, () => { p.wantDash = true; });
  }

  // ---------- wire ----------

  score(p) {
    return p.crossings + p.tags + (p.won ? RULES.lastMinnowBonus : 0);
  }

  snapshot() {
    const events = this.events;
    this.events = [];
    return {
      t: Date.now(),
      stage: this.stage,
      stageLeft: round1(this.stageLeft),
      crossing: this.crossing,
      dir: this.dir,
      grace: this.stage === 'running' && this.sinceWhistle < RULES.graceSeconds ? 1 : 0,
      minnows: this.count(false),
      sharks: this.count(true),
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        x: round1(p.x), y: round1(p.y), vx: round1(p.vx), vy: round1(p.vy),
        f: p.facing,
        r: p.shark ? 1 : 0,
        st: p.safe ? 1 : 0,
        d: p.dashCd <= 0 ? 1 : 0,
        k: p.dash > 0 ? 1 : 0,
        s: this.score(p),
      })),
      events,
    };
  }

  results() {
    return [...this.players.values()]
      .map((p) => ({
        id: p.id, name: p.name, color: p.color,
        score: this.score(p), crossings: p.crossings, tags: p.tags, won: p.won,
      }))
      .sort((a, b) => Number(b.won) - Number(a.won) || b.score - a.score
        || b.crossings - a.crossings || b.tags - a.tags)
      .map((r, i) => ({ ...r, placement: i + 1 }));
  }
}
