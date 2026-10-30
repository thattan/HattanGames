// Shared between the server (authoritative simulation) and the browser (rendering
// and, later, client-side prediction). Keep this file dependency-free — no Node
// APIs, no DOM. All sharks-and-minnows tuning lives here; change a constant and
// both sides agree.
//
// Deliberately a sibling of dodgeball's physics rather than an import of it. The
// two games pull the same constants in opposite directions — sharks run faster and
// jump lower — and a cross-game import would mean retuning one silently retunes the
// other. The duplicated `stepPlayer` is the price of letting each game stand alone.
//
// The global tick and snapshot rates are a server concern and stay in dodgeball's
// physics; this game just rides the same loop.

export const WORLD = { w: 1280, h: 720 };

export const PLAYER = {
  w: 26,
  h: 42,
  speed: 345,
  accel: 3000,
  airAccel: 1700,
  friction: 2600,
  jumpV: 760,
  gravity: 2200,
  maxFall: 1100,
  coyote: 0.08,      // seconds you can still jump after running off a ledge
  jumpBuffer: 0.1,   // seconds a jump press is remembered before landing
  dropTime: 0.25,    // seconds platforms are ignored after pressing down
};

// Minnows are a shade quicker flat out. That one number is what makes the game a
// game: a shark can't simply run a minnow down from behind, it has to cut them off
// or spend its lunge, and a missed lunge costs a second of cooldown.
export const SPEED = { shark: 1, minnow: 1.07 };

// One mechanic, two tunings. The shark's lunge is the committing move — longer,
// slower to come back. The minnow's is a short juke that recovers fast enough to
// use twice inside one shark cooldown.
export const DASH = {
  shark: { speed: 650, lift: 140, time: 0.22, cooldown: 1.1 },
  minnow: { speed: 520, lift: 165, time: 0.16, cooldown: 0.75 },
  drag: 2.2,         // how fast a dash bleeds off once it's underway
};

export const RULES = {
  maxPlayers: 16,
  minPlayers: 2,
  countdownSeconds: 3,
  crossingSeconds: 20,
  tallySeconds: 3,
  graceSeconds: 3,   // how long the starting wall keeps sheltering minnows
  tagCooldown: 0.4,  // a shark takes one minnow at a time, not a whole pile at once
  maxCrossings: 12,  // a backstop so one brilliant minnow can't play forever
  lastMinnowBonus: 3,
  sharksPerPlayers: 6, // one starting shark per this many players, minimum one
};

// The two end walls. Minnows are safe inside one; sharks may never enter it.
export const SAFE = { w: 150 };

// side > 0 is the right-hand wall, side < 0 the left.
export const safeZone = (side) => (side > 0
  ? { x: WORLD.w - SAFE.w, w: SAFE.w, side: 1 }
  : { x: 0, w: SAFE.w, side: -1 });

export const FLOOR_Y = 680;

// One-way platforms (the floor is solid). Tiers stay within ~130 px of a reachable
// neighbour — a jump lifts the feet jumpV^2 / (2 * gravity) ~= 131 px — and all of
// them sit in open water, so neither safe wall has cover above it.
export const PLATFORMS = [
  { x: 0, y: FLOOR_Y, w: WORLD.w, h: 40, solid: true },
  { x: 290, y: 560, w: 180, h: 16 },
  { x: 810, y: 560, w: 180, h: 16 },
  { x: 540, y: 470, w: 200, h: 16 },
  { x: 165, y: 440, w: 150, h: 16 },
  { x: 965, y: 440, w: 150, h: 16 },
  { x: 395, y: 345, w: 160, h: 16 },
  { x: 725, y: 345, w: 160, h: 16 },
];

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Both bodies are the same size, so an axis-aligned overlap is just a centre distance.
export function touching(a, b, pad = 0) {
  return Math.abs(a.x - b.x) < PLAYER.w + pad && Math.abs(a.y - b.y) < PLAYER.h + pad;
}

// A player counts as inside a wall once their middle crosses the line — forgiving
// on purpose, so a dive that only just reaches still counts.
export function inZone(p, zone) {
  const cx = p.x + PLAYER.w / 2;
  return cx >= zone.x && cx <= zone.x + zone.w;
}

export function startDash(p, role, dir) {
  const cfg = DASH[role];
  const d = dir !== 0 ? dir : p.facing;
  p.facing = d;
  p.vx = d * cfg.speed;
  // A standing dash hops a little; an airborne one is flat, so it can't double as a
  // second jump.
  if (p.onGround) p.vy = -cfg.lift;
  p.dash = cfg.time;
  p.dashCd = cfg.cooldown;
}

export function stepPlayer(p, input, dt) {
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);

  if (p.dash > 0) {
    // A dash is committed: no steering, no friction, it just bleeds off.
    p.dash -= dt;
    p.vx *= 1 - DASH.drag * dt;
    if (dir !== 0) p.facing = dir;
  } else if (dir !== 0) {
    const accel = p.onGround ? PLAYER.accel : PLAYER.airAccel;
    const top = PLAYER.speed * (p.speedMul ?? 1);
    p.vx = clamp(p.vx + dir * accel * dt, -top, top);
    p.facing = dir;
  } else if (p.onGround) {
    const f = PLAYER.friction * dt;
    p.vx = Math.abs(p.vx) <= f ? 0 : p.vx - Math.sign(p.vx) * f;
  } else {
    p.vx *= 1 - 2 * dt;
  }

  // Drop through a one-way platform.
  if (input.down && p.onGround && !p.groundSolid) {
    p.dropTimer = PLAYER.dropTime;
    p.onGround = false;
  }
  if (p.dropTimer > 0) p.dropTimer -= dt;

  // Jumping with coyote time and a jump buffer.
  p.coyote = p.onGround ? PLAYER.coyote : Math.max(0, p.coyote - dt);
  if (p.jumpBuffer > 0) p.jumpBuffer -= dt;
  if (p.jumpBuffer > 0 && p.coyote > 0) {
    p.vy = -PLAYER.jumpV;
    p.jumpBuffer = 0;
    p.coyote = 0;
    p.onGround = false;
  }
  // Releasing jump early gives a shorter hop.
  if (!input.jump && p.vy < -PLAYER.jumpV * 0.45) p.vy = -PLAYER.jumpV * 0.45;

  p.vy = Math.min(p.vy + PLAYER.gravity * dt, PLAYER.maxFall);

  p.x += p.vx * dt;
  if (p.x < 0) { p.x = 0; p.vx = 0; }
  if (p.x > WORLD.w - PLAYER.w) { p.x = WORLD.w - PLAYER.w; p.vx = 0; }

  const prevBottom = p.y + PLAYER.h;
  p.y += p.vy * dt;
  p.onGround = false;
  if (p.vy >= 0) {
    for (const pl of PLATFORMS) {
      if (!pl.solid && p.dropTimer > 0) continue;
      const overlapsX = p.x + PLAYER.w > pl.x && p.x < pl.x + pl.w;
      if (overlapsX && prevBottom <= pl.y + 0.5 && p.y + PLAYER.h >= pl.y) {
        p.y = pl.y - PLAYER.h;
        p.vy = 0;
        p.onGround = true;
        p.groundSolid = !!pl.solid;
        break;
      }
    }
  }
  if (p.y < 0) { p.y = 0; if (p.vy < 0) p.vy = 0; }
}
