// Renders the world slightly in the past so motion is smooth between snapshots.
// Other players are shown ~100ms behind; your own player only ~40ms behind so
// controls feel snappier. Next step for the jam: client-side prediction for self.
const DELAY_OTHERS = 100;
const DELAY_SELF = 40;
const MAX_SNAPS = 40;
const TELEPORT_DIST = 150;

const lerp = (a, b, t) => a + (b - a) * t;

export class Interpolator {
  constructor() {
    this.reset();
  }

  reset() {
    this.snaps = [];
    this.offset = null; // estimated (client clock - server clock), includes latency
    this.pendingEvents = [];
  }

  push(snap) {
    const sample = Date.now() - snap.t;
    // Track the lowest observed offset (least delayed packet), drifting slowly upward
    // so a clock change or a congested link doesn't stall rendering.
    if (this.offset === null || sample < this.offset) this.offset = sample;
    else this.offset += (sample - this.offset) * 0.02;

    this.snaps.push(snap);
    if (this.snaps.length > MAX_SNAPS) this.snaps.shift();
    for (const e of snap.events) this.pendingEvents.push({ ...e, t: snap.t });
  }

  latest() {
    return this.snaps[this.snaps.length - 1] ?? null;
  }

  // Interpolated players and balls at server time rt.
  at(rt) {
    const s = this.snaps;
    if (s.length === 1 || rt <= s[0].t) return { a: s[0], b: s[0], alpha: 0 };
    for (let i = s.length - 1; i > 0; i--) {
      if (s[i - 1].t <= rt) {
        const a = s[i - 1];
        const b = s[i];
        if (rt >= b.t) return { a: b, b, alpha: 0 };
        return { a, b, alpha: (rt - a.t) / (b.t - a.t) };
      }
    }
    return { a: s[0], b: s[0], alpha: 0 };
  }

  static blendPlayers({ a, b, alpha }) {
    const prev = new Map(a.players.map((p) => [p.id, p]));
    return b.players.map((p) => {
      const q = prev.get(p.id);
      if (!q || q.a !== p.a || Math.hypot(p.x - q.x, p.y - q.y) > TELEPORT_DIST) return p;
      return { ...p, x: lerp(q.x, p.x, alpha), y: lerp(q.y, p.y, alpha) };
    });
  }

  static blendBalls({ a, b, alpha }) {
    const prev = new Map(a.balls.map((x) => [x.id, x]));
    return b.balls.map((x) => {
      const q = prev.get(x.id);
      if (!q || q.st !== x.st || q.o !== x.o || Math.hypot(x.x - q.x, x.y - q.y) > TELEPORT_DIST) return x;
      return { ...x, x: lerp(q.x, x.x, alpha), y: lerp(q.y, x.y, alpha) };
    });
  }

  sample(myId) {
    const last = this.latest();
    if (!last) return null;
    const now = Date.now();
    const rtOthers = now - this.offset - DELAY_OTHERS;
    const rtSelf = now - this.offset - DELAY_SELF;

    const othersFrame = this.at(rtOthers);
    const players = Interpolator.blendPlayers(othersFrame).filter((p) => p.id !== myId);
    const self = Interpolator.blendPlayers(this.at(rtSelf)).find((p) => p.id === myId) ?? null;
    if (self) players.push(self);

    const events = [];
    while (this.pendingEvents.length && this.pendingEvents[0].t <= rtOthers) {
      events.push(this.pendingEvents.shift());
    }

    return {
      players,
      self,
      balls: Interpolator.blendBalls(othersFrame),
      timeLeft: last.timeLeft,
      events,
    };
  }
}
