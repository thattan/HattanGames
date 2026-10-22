# Gym Class

A small site of browser party games. The landing page is a game picker. Create a game, share the invite link, play.

**Dodgeball** — a real-time multiplayer 2D platformer. Up to 8 players throw, catch, and bank shots off the gym walls in two-minute rounds.

**Hangman** — co-op and turn-based. One player sets a phrase; everyone else gets 30-second turns to vote on the next letter, or gamble on solving the whole thing. Most votes wins the turn, a wrong call costs a limb, and six hangs the group.

Express serves the clients and a small REST API, `ws` handles real-time play, and Postgres (optional) records dodgeball match history for an all-time leaderboard.

## Quick start

```bash
docker compose up --build
```

Open http://localhost:3000, pick a game, select **Create game**, and send the invite link (or open it in a second browser window to test alone — hangman needs two players, so you'll want the second window either way).

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
  index.js        Express routes, WebSocket upgrade, fixed-step loop, room registry
  games.js        Game catalogue behind the landing page and /api/games
  rooms.js        BaseRoom (codes, roster, host, lifecycle) + RoomManager
  db.js           Optional Postgres: schema setup, saving matches, leaderboard
  dodgeball/
    room.js       Wires the simulation to a room
    game.js       Authoritative simulation: throws, catches, hits, respawns
  hangman/
    room.js       Wires the round machine to a room
    game.js       Rounds, ballot, vote resolution, misses, contribution stats
public/
  index.html      Landing page: the game picker
  style.css       Shared shell: palette, banner, panels, buttons, game cards
  js/
    landing.js    Renders the picker from /api/games
    net.js        WebSocket wrapper (shared)
    dom.js        $, el, chip, toast (shared)
    player.js     Your name, remembered across games
  games/dodgeball/
    index.html    Home, lobby, and game screens (single page)
    style.css     Dodgeball-only styles
    shared/
      physics.js  Constants, arena layout, player and ball physics (server AND client)
    js/
      main.js     App flow, lobby UI, HUD, input send loop
      interp.js   Snapshot buffer and interpolation
      input.js    Keyboard and mouse
      render.js   Canvas drawing and effects
  games/hangman/
    index.html    Home, lobby, and game screens (single page)
    style.css     Hangman-only styles
    shared/
      rules.js    Tuning, phrase normalization and masking (server AND client)
    js/
      main.js     App flow, lobby UI, results
      board.js    Gallows, phrase board, ballot, room panel
db/schema.sql     Applied on server start (idempotent)
```

The clients are plain ES modules with no build step. If you want to move the lobby and HUD to Vue, keep `render.js`, `interp.js`, and `input.js` as they are and mount the canvas inside a component; the game loop doesn't depend on the UI framework.

### Adding a game

1. Create `public/games/<id>/index.html` and link `/style.css` first, then your own sheet. Reference assets by absolute path (`/games/<id>/...`) so deep links work.
2. Add a `BaseRoom` subclass in `server/<id>/room.js` with a `static gameId`, and register it in the `RoomManager` map in `server/index.js`. That map also generates the `/<id>` and `/<id>/play/:code` routes.
3. Add an entry to `GAMES` in `server/games.js`. Use `status: 'soon'` to list a card without a link.

`BaseRoom` already handles room codes, the roster, host handoff, join/leave, ping, and the lobby → playing → ended cycle. Turn-based games can ignore the 60 Hz loop; hangman's `step()` only advances its turn clocks.

## How it works

**Rooms and invites.** `POST /api/rooms` with `{ "game": "hangman" }` (or `dodgeball`, the default) returns a 5-character code (no 0/O or 1/I). The URL `/<game>/play/CODE` serves that game's page, which joins over `ws://host/ws?room=CODE&name=...` (the older `/play/CODE` redirects to dodgeball). Codes are unique across games, so pasting a hangman code into dodgeball bounces you to the right client. The first player in is the host and can start the round; if they leave, hosting passes to the next player. Empty rooms are cleaned up after a minute.

**Authoritative server.** One fixed-step loop drives every room of every game. Dodgeball simulates physics at 60 Hz and broadcasts snapshots at 30 Hz; clients only send input (held directions, aim angle, and press counters for jump, throw, and catch — counters mean a tap shorter than one server tick is never dropped). Hangman is turn-based, so its rooms only advance turn clocks and push state when something changes. Every hit, catch, and vote is decided server-side, so there is nothing to argue about.

**Smooth rendering.** The client estimates the server clock offset and renders other players about 100 ms in the past, interpolating between snapshots. Your own player renders about 40 ms behind so controls feel tighter. Hit and catch effects are scheduled on the same delayed timeline so they line up with what you see.

**Dodgeball rules** (all tunable in `public/games/dodgeball/shared/physics.js`):

- Hitting a player scores a point and sends them out for 2 s, then they respawn with 1.5 s of invulnerability.
- Catching a live ball scores a point and knocks the thrower out. The catch window is 0.25 s with a 0.8 s cooldown, so it's a timing move, not something to spam.
- You can't catch while holding a ball.
- Thrown balls fly flat (light gravity) and die when they touch the floor or a platform. Wall and ceiling bounces stay live.
- Ball count scales with players: 2 to 4.

**Hangman rules** (all tunable in `public/games/hangman/shared/rules.js`):

- The host picks 3 or 5 rounds. Each round a different player sets the phrase, rotating in join order.
- Turns are 30 seconds. Click a letter to vote for it, or propose a guess at the whole phrase (one per player per turn) and others can back that instead. Tallies are live.
- Whatever has the most votes when the clock runs out is submitted. Ties are a coin flip, and the turn ends early once everyone has voted.
- A wrong letter or a wrong phrase guess costs a limb. Six misses and the group is hanged.
- It is co-op: the setter scores nothing, so there is no incentive to pick something unguessable. Results show the rounds solved plus each player's winning votes and solves.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/rooms` | Create a game; body `{ game }` (default `dodgeball`), returns `{ code, game }` |
| GET | `/api/rooms/:code` | Check a game exists; returns `game`, phase and player count |
| GET | `/api/leaderboard` | Top 10 by total hits (`enabled: false` without a database) |
| GET | `/api/games` | Game catalogue for the landing page |
| GET | `/health` | Used by the Docker healthcheck |

### WebSocket messages

Shared by both games — client to server: `start` (host only), `ping`. Server to client: `welcome` (your id), `roster` (players, host, phase), `state`, `ended` (results), `pong`, `error`.

Dodgeball adds `input` (client to server); its `state` is a snapshot plus events.
Hangman adds `phrase`, `vote`, and `propose` (client to server); its `state` carries the stage, masked phrase, misses, and the live ballot. The phrase itself is only ever sent to the player who set it, until the round ends.

## Ideas for the rest of the jam

Hangman first, since it's the newest:

1. **Hangman history and stats.** The `matches` schema is dodgeball-shaped (hits, catches, outs). A `game` column plus a generic per-player stats blob would let hangman rounds land on the leaderboard too.
2. **A phrase bank.** Let the setter press a button for a random category-tagged phrase when nobody can think of one, and show the category as a hint.
3. **Chat or reactions during a turn.** Half the fun is arguing about the vote; right now you can only vote.
4. **Spectators.** Players who join mid-round are full voters immediately — a spectate-until-next-round state would be fairer.

Then dodgeball, ordered roughly by how much they improve the game per hour spent.

1. **Client-side prediction for your own player.** `physics.js` is already shared. Tag each input with a sequence number, have the server echo the last one it applied, and replay unacknowledged inputs on top of each snapshot. This is the biggest feel improvement on real networks.
2. **Teams mode.** Two colors, friendly fire off, a center line you can't cross. Most of it is a `team` field on players and one check in `resolveLiveBall`.
3. **Power-ups.** Speed shoes, a fireball that doesn't die on the first bounce, a shield that eats one hit.
4. **More arenas.** Move `PLATFORMS` and `SPAWNS` into a map list and let the host pick one in the lobby.
5. **Sound.** A thunk on hits and a slap on catches add a lot for very little code.
6. **Mobile controls.** On-screen buttons that bump the same press counters `input.js` uses.
7. **Persistent player identity.** The leaderboard groups by name today; a random id saved in the browser would stop name collisions.
