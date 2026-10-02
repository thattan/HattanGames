# Dodgeball

A multiplayer 2D platformer dodgeball game. Create a game, share the invite link, and up to 8 players throw, catch, and bank shots off the gym walls in two-minute rounds.

Express serves the client and a small REST API, `ws` handles real-time play, and Postgres (optional) records match history for an all-time leaderboard.

## Quick start

```bash
docker compose up --build
```

Open http://localhost:3000, select **Create game**, and send the invite link (or open it in a second browser window to test alone).

`docker compose up` automatically merges `docker-compose.override.yml`, which bind-mounts `server/`, `public/`, and `db/` and runs Node with `--watch`. Server edits restart the process (in-progress games reset); client edits show up on browser refresh.

To run the production-style image without live reload:

```bash
docker compose -f docker-compose.yml up --build
```

To wipe the database: `docker compose down -v`.

### Without Docker

```bash
npm install
npm run dev          # http://localhost:3000, no database
```

Set `DATABASE_URL=postgres://user:pass@host:5432/db` to enable match history. Without it the game runs fine and the leaderboard is hidden.

## Project layout

```
server/
  index.js     Express routes, WebSocket upgrade, fixed-step game loop
  rooms.js     Room codes, lobby, host, round lifecycle, results
  game.js      Authoritative simulation: throws, catches, hits, respawns
  db.js        Optional Postgres: schema setup, saving matches, leaderboard
public/
  index.html   Home, lobby, and game screens (single page)
  style.css
  shared/
    physics.js Constants, arena layout, player and ball physics (used by server AND client)
  js/
    main.js    App flow, lobby UI, HUD, input send loop
    net.js     WebSocket wrapper
    interp.js  Snapshot buffer and interpolation
    input.js   Keyboard and mouse
    render.js  Canvas drawing and effects
db/schema.sql  Applied on server start (idempotent)
```

The client is plain ES modules with no build step. If you want to move the lobby and HUD to Vue, keep `render.js`, `interp.js`, and `input.js` as they are and mount the canvas inside a component; the game loop doesn't depend on the UI framework.

## How it works

**Rooms and invites.** `POST /api/rooms` returns a 5-character code (no 0/O or 1/I). The URL `/play/CODE` serves the same page, which joins over `ws://host/ws?room=CODE&name=...`. The first player in is the host and can start the round; if they leave, hosting passes to the next player. Empty rooms are cleaned up after a minute.

**Authoritative server.** The server simulates physics at 60 Hz with a fixed timestep and broadcasts snapshots at 30 Hz. Clients only send input: held directions, aim angle, and press counters for jump, throw, and catch. Counters mean a tap shorter than one server tick is never dropped. All hit and catch decisions happen on the server, so there's nothing to argue about.

**Smooth rendering.** The client estimates the server clock offset and renders other players about 100 ms in the past, interpolating between snapshots. Your own player renders about 40 ms behind so controls feel tighter. Hit and catch effects are scheduled on the same delayed timeline so they line up with what you see.

**Rules** (all tunable in `public/shared/physics.js`):

- Hitting a player scores a point and sends them out for 2 s, then they respawn with 1.5 s of invulnerability.
- Catching a live ball scores a point and knocks the thrower out. The catch window is 0.25 s with a 0.8 s cooldown, so it's a timing move, not something to spam.
- You can't catch while holding a ball.
- Thrown balls fly flat (light gravity) and die when they touch the floor or a platform. Wall and ceiling bounces stay live.
- Ball count scales with players: 2 to 4.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/rooms` | Create a game, returns `{ code }` |
| GET | `/api/rooms/:code` | Check a game exists, returns phase and player count |
| GET | `/api/leaderboard` | Top 10 by total hits (`enabled: false` without a database) |
| GET | `/health` | Used by the Docker healthcheck |

### WebSocket messages

Client to server: `input`, `start` (host only), `ping`.
Server to client: `welcome` (your id), `roster` (players, host, phase), `state` (snapshot + events), `ended` (results), `pong`, `error`.

## Ideas for the rest of the jam

These are ordered roughly by how much they improve the game per hour spent.

1. **Client-side prediction for your own player.** `physics.js` is already shared. Tag each input with a sequence number, have the server echo the last one it applied, and replay unacknowledged inputs on top of each snapshot. This is the biggest feel improvement on real networks.
2. **Teams mode.** Two colors, friendly fire off, a center line you can't cross. Most of it is a `team` field on players and one check in `resolveLiveBall`.
3. **Power-ups.** Speed shoes, a fireball that doesn't die on the first bounce, a shield that eats one hit.
4. **More arenas.** Move `PLATFORMS` and `SPAWNS` into a map list and let the host pick one in the lobby.
5. **Sound.** A thunk on hits and a slap on catches add a lot for very little code.
6. **Mobile controls.** On-screen buttons that bump the same press counters `input.js` uses.
7. **Persistent player identity.** The leaderboard groups by name today; a random id saved in the browser would stop name collisions.
