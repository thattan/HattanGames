// Shared between the server (authoritative simulation) and the client (rendering,
// aim preview, and later client-side prediction). Keep this file dependency-free.

export const WORLD = { w: 1280, h: 720 };

export const TICK_RATE = 60;      // physics steps per second on the server
export const SNAPSHOT_RATE = 30;  // state broadcasts per second

export const PLAYER = {
  w: 28,
  h: 44,
  speed: 330,
  accel: 3200,
  airAccel: 1800,
  friction: 2800,
  jumpV: 820,
  gravity: 2200,
  maxFall: 1100,
  coyote: 0.08,      // seconds you can still jump after walking off a ledge
  jumpBuffer: 0.1,   // seconds a jump press is remembered before landing
  dropTime: 0.25,    // seconds platforms are ignored after pressing down
};

export const BALL = {
  r: 11,
  throwSpeed: 950,
  gravity: 900,      // dead balls drop like normal
  liveGravity: 260,  // thrown balls fly flat, like a real dodgeball throw
  bounce: 0.55,
  friction: 700,
  liveTime: 1.6,     // a thrown ball stops being dangerous after this long
  catchReach: 12,    // extra radius when the target is actively catching
};

export const RULES = {
  roundSeconds: 120,
  respawnSeconds: 2,
  invulnSeconds: 1.5,
  catchWindow: 0.25,
  catchCooldown: 0.8,
  throwCooldown: 0.3,
  maxPlayers: 8,
};

// Platforms are one-way (you can jump up through them) unless solid.
// Tiers are 120 px apart. A jump lifts the feet jumpV^2 / (2 * gravity) ~= 153 px,
// so every tier is reachable from the one below with margin to spare — keep any
// new tier within ~130 px of its neighbour or it becomes dead space.
export const PLATFORMS = [
  { x: 0, y: 680, w: 1280, h: 40, solid: true }, // floor
  { x: 110, y: 560, w: 210, h: 16 },
  { x: 960, y: 560, w: 210, h: 16 },
  { x: 20, y: 440, w: 140, h: 16 },
  { x: 430, y: 440, w: 190, h: 16 },
  { x: 660, y: 440, w: 190, h: 16 },
  { x: 1120, y: 440, w: 140, h: 16 },
  { x: 190, y: 320, w: 230, h: 16 },
  { x: 860, y: 320, w: 230, h: 16 },
  { x: 540, y: 200, w: 200, h: 16 },
];

// Feet positions for spawning players.
export const SPAWNS = [
  { x: 90, y: 680 }, { x: 1190, y: 680 }, { x: 640, y: 680 },
  { x: 215, y: 560 }, { x: 1065, y: 560 },
  { x: 300, y: 320 }, { x: 975, y: 320 },
  { x: 640, y: 200 },
];

export const BALL_SPAWNS = [
  { x: 640, y: 150 }, { x: 215, y: 510 }, { x: 1065, y: 510 }, { x: 640, y: 620 },
];

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function circleRect(cx, cy, r, x, y, w, h) {
  const nx = clamp(cx, x, x + w);
  const ny = clamp(cy, y, y + h);
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy <= r * r;
}

export function stepPlayer(p, input, dt) {
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);

  if (dir !== 0) {
    const accel = p.onGround ? PLAYER.accel : PLAYER.airAccel;
    p.vx = clamp(p.vx + dir * accel * dt, -PLAYER.speed, PLAYER.speed);
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

  // Horizontal movement, clamped to the arena walls.
  p.x += p.vx * dt;
  if (p.x < 0) { p.x = 0; p.vx = 0; }
  if (p.x > WORLD.w - PLAYER.w) { p.x = WORLD.w - PLAYER.w; p.vx = 0; }

  // Vertical movement with one-way platform landing.
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

// Returns true if the ball touched the floor or a platform this step
// (which ends a live throw). Wall and ceiling bounces keep it live.
export function stepBall(b, dt) {
  let touchedGround = false;
  b.vy += (b.state === 'live' ? BALL.liveGravity : BALL.gravity) * dt;

  b.x += b.vx * dt;
  if (b.x < BALL.r) { b.x = BALL.r; b.vx = -b.vx * BALL.bounce; }
  if (b.x > WORLD.w - BALL.r) { b.x = WORLD.w - BALL.r; b.vx = -b.vx * BALL.bounce; }

  const prevBottom = b.y + BALL.r;
  b.y += b.vy * dt;
  if (b.y < BALL.r) { b.y = BALL.r; b.vy = -b.vy * BALL.bounce; }

  b.onGround = false;
  if (b.vy >= 0) {
    for (const pl of PLATFORMS) {
      if (b.x > pl.x && b.x < pl.x + pl.w && prevBottom <= pl.y + 0.5 && b.y + BALL.r >= pl.y) {
        b.y = pl.y - BALL.r;
        b.vy = Math.abs(b.vy) < 90 ? 0 : -b.vy * BALL.bounce;
        b.onGround = b.vy === 0;
        touchedGround = true;
        break;
      }
    }
  }
  if (b.onGround) {
    const f = BALL.friction * dt;
    b.vx = Math.abs(b.vx) <= f ? 0 : b.vx - Math.sign(b.vx) * f;
  }
  return touchedGround;
}
