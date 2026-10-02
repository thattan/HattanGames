# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Multiplayer 2D platformer dodgeball. Up to 8 players per room throw, catch, and bank balls off gym walls in 2-minute rounds. Express serves the client and a small REST API, `ws` handles real-time play, Postgres (optional) records match history for an all-time leaderboard.

Node >= 20, ES modules throughout. No build step, no test suite, no linter configured.

## Commands

```bash
docker compose up --build              # full stack with Postgres + live reload (http://localhost:3000)
docker compose -f docker-compose.yml up --build   # production-style image, no live reload
docker compose down -v                 # wipe the database volume

npm install && npm run dev             # no Docker, no database, node --watch
npm start                              # plain node server/index.js
```

`docker compose up` auto-merges `docker-compose.override.yml`, which bind-mounts `server/`, `public/`, `db/` and runs `node --watch`. Server edits restart the process (**in-progress games reset**); client edits only need a browser refresh.

`DATABASE_URL` is the only required env var for match history. Without it the game runs fine and the leaderboard is simply hidden — never make a code path assume the DB exists.

## Architecture

### Authoritative server, dumb client

The server owns all simulation. Clients send input only; every hit, catch, and respawn decision is made server-side. Do not add gameplay logic to the client.

- `server/index.js` — Express routes, WebSocket upgrade on `/ws`, and the single global fixed-step loop. One `setInterval` drives **all** rooms: physics at `TICK_RATE` (60 Hz), snapshot broadcast every `TICK_RATE/SNAPSHOT_RATE` ticks (30 Hz). Accumulator is clamped to 0.25 s so a stalled process doesn't spiral.
- `server/rooms.js` — `RoomManager` (code generation, 10 s sweeper for rooms empty > 60 s) and `Room` (lobby/playing/ended phase machine, host assignment and handoff, roster broadcast, results). Room codes are 5 chars from an alphabet with no `0/O` or `1/I`; lookups uppercase the input.
- `server/game.js` — the simulation itself: players, balls, throws, catches, hits, respawns, scoring, and `snapshot()` / `results()`.
- `server/db.js` — optional Postgres. `initDb()` retries 5 times with backoff then gives up and runs without history. `db/schema.sql` is applied on every start and must stay idempotent.

### Shared physics

`public/shared/physics.js` is imported by **both** the server and the browser. It holds `WORLD`, `PLAYER`, `BALL`, `RULES`, `PLATFORMS`, `SPAWNS`, `BALL_SPAWNS`, and the pure step functions `stepPlayer` / `stepBall` / `circleRect`. Keep it dependency-free — no Node APIs, no DOM. All game tuning lives here; change a constant and both sides agree.

This file is also the foundation for the planned client-side prediction, so resist moving step logic into `server/game.js`.

### Client (plain ES modules, no bundler)

`public/index.html` is a single page with three screens (home / lobby / game) toggled by `hidden`.

- `js/main.js` — app flow, screen switching, lobby and HUD DOM, results, and the 60 Hz input send loop (sends only when the input payload changes, plus a 250 ms keepalive).
- `js/net.js` — thin WebSocket wrapper; distinguishes "we closed it" from a real disconnect.
- `js/interp.js` — snapshot buffer. Estimates the client↔server clock offset by tracking the *lowest* observed delta (drifting slowly upward), then renders other players ~100 ms in the past and your own player ~40 ms back so controls feel tighter. Hit/catch events are queued and released on the same delayed timeline so effects line up with what you see.
- `js/input.js` — keyboard + mouse. WASD/arrows move, J/left-click throw, K/right-click catch; aim follows the mouse.
- `js/render.js` — canvas drawing. The gym background is pre-rendered once to an offscreen canvas (`buildBackground()`), rebuilt after fonts load.

If the UI is ever moved to a framework, `render.js`, `interp.js`, and `input.js` are framework-agnostic and should stay as-is.

### Input press counters

Button presses (jump/throw/catch) are sent as **ever-increasing counters** (`js`, `ts`, `cs`), not booleans, so a tap shorter than one 16 ms server tick is never dropped. In `Game.setInput` the first value seen for a key only syncs the counter — it does not fire the action — because it may be left over from a previous round. Preserve this when touching input handling.

### Wire protocol

Client → server: `input`, `start` (host only), `ping`.
Server → client: `welcome` (your id), `roster` (players, host, phase), `state` (snapshot + events), `ended` (results), `pong`, `error`.

Snapshot fields are deliberately short (`x y vx vy f a h i c r s` for players, `id x st o` for balls) and rounded to 1 decimal — these go out 30× per second to every client. Keep additions terse. Slow clients with > 256 KB buffered are skipped for that frame rather than queueing stale state.

### REST API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/rooms` | Create a game, returns `{ code }` |
| GET | `/api/rooms/:code` | Exists check; returns phase and player count |
| GET | `/api/leaderboard` | Top 10 by total hits (`enabled: false` without a DB) |
| GET | `/health` | Docker healthcheck |

`/play/:CODE` serves the same `index.html`; the client reads the code off the path.

## Game rules (all tunable in `public/shared/physics.js`)

- Hit → thrower scores, target is out 2 s, respawns with 1.5 s invulnerability.
- Catch → catcher scores and the thrower is knocked out. 0.25 s window, 0.8 s cooldown, impossible while holding a ball.
- Thrown balls use `liveGravity` (flat arc) and die on floor/platform contact or after `liveTime`; wall and ceiling bounces stay live.
- Platforms are one-way except the floor; press down to drop through.
- Ball count scales with player count, 2–4.
