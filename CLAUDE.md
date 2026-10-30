# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**Gym Class** — a small site of browser party games. The landing page at `/` is a picker.

- **Dodgeball** (`/dodgeball`) — real-time multiplayer 2D platformer. Up to 8 players per room throw, catch, and bank balls off gym walls in 2-minute rounds.
- **Hangman** (`/hangman`) — turn-based and co-op. One player sets a phrase; everyone else votes each 30-second turn on a letter or a full-phrase guess, and the top vote is submitted.
- **Sharks & Minnows** (`/sharks`) — real-time, same platformer engine shape as dodgeball. Up to 16 players sprint between two safe walls while sharks patrol the middle; tagged minnows turn shark, last minnow standing wins.
- **Tic Tac Toe** (`/tictactoe`) — strictly two players, turn-based. Best of 3 or 5 rounds, 20 seconds a move, with the X seat alternating every round.

Express serves the clients and a small REST API, `ws` handles real-time play, Postgres (optional) records dodgeball match history for an all-time leaderboard.

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

### Site layout and adding a game

```
public/
  index.html        landing page (game picker)
  style.css         shared shell: palette, banner, panel, btn, toast, game cards
  js/landing.js     renders the picker from /api/games
  js/net.js         WebSocket wrapper, shared by every game
  js/dom.js         $, el, chip, toast
  js/player.js      the player's name, remembered across games
  games/<id>/       one game: index.html, style.css, js/, shared/
server/
  games.js          the catalogue behind /api/games and the landing page
  rooms.js          BaseRoom + RoomManager, game-agnostic
  <id>/room.js      one BaseRoom subclass per game
  <id>/game.js      that game's rules
```

To add a game:

1. `public/games/<id>/index.html`, linking `/style.css` first and its own sheet second. Reference assets by absolute path (`/games/<id>/js/main.js`) so deep links like `/dodgeball/play/CODE` resolve.
2. A `BaseRoom` subclass in `server/<id>/room.js` with `static gameId`, and register it in the `RoomManager` map in `server/index.js` — that one map also generates the `/<id>` and `/<id>/play/:code` routes.
3. An entry in `GAMES` in `server/games.js` (`status: 'soon'` lists a card without a link).

The landing page keeps a hardcoded copy of the card markup as a no-JS fallback — update it when the catalogue changes meaningfully.

### Rooms are shared, games are not

`BaseRoom` owns everything that isn't gameplay: room codes (unique across *all* games), the roster, host assignment and handoff, join/leave, ping, and the lobby → playing → ended → lobby cycle. Subclasses implement `start`, `step`, `onMessage`, `onJoin`, `onLeave`, and call `endWith(results)`.

Two things to watch:

- `this.gameId` is the game's id; `this.game` is free for a subclass to use for its simulation. Don't add a `game` getter to the base or subclass assignment throws.
- Because codes are global, a code typed into the wrong game's join box resolves to the other game. `GET /api/rooms/:code` returns `game`, and each client redirects to `/<game>/play/<code>` when it doesn't match.

Dodgeball and sharks need the 60 Hz loop; hangman and tic tac toe only need their turn clocks, so their `step()` just advances timers and broadcasts on change (plus a 1 Hz push so client countdowns don't drift).

### Authoritative server, dumb client

The server owns all simulation. Clients send input only; every hit, catch, vote, and respawn decision is made server-side. Do not add gameplay logic to the client.

- `server/index.js` — Express routes, WebSocket upgrade on `/ws`, and the single global fixed-step loop. One `setInterval` drives **all** rooms of every game: 60 Hz steps, with a snapshot flag every `TICK_RATE/SNAPSHOT_RATE` ticks (30 Hz) that dodgeball uses to broadcast. Accumulator is clamped to 0.25 s so a stalled process doesn't spiral.
- `server/rooms.js` — `RoomManager` (code generation, 10 s sweeper for rooms empty > 60 s) and `BaseRoom`. Room codes are 5 chars from an alphabet with no `0/O` or `1/I`; lookups uppercase the input.
- `server/dodgeball/game.js` — the dodgeball simulation: players, balls, throws, catches, hits, respawns, scoring, and `snapshot()` / `results()`.
- `server/hangman/game.js` — the hangman round machine: setter rotation, the ballot, vote resolution, misses, and per-player contribution stats.
- `server/sharks/game.js` — the sharks crossing machine: role assignment, the countdown/running/tally stages, safe-wall containment, tagging, and scoring.
- `server/tictactoe/game.js` — the tic tac toe match machine: seat alternation, move validation, win and draw detection, and the move clock.
- `server/db.js` — optional Postgres, dodgeball only. `initDb()` retries 5 times with backoff then gives up and runs without history. `db/schema.sql` is applied on every start and must stay idempotent.

### Dodgeball

Everything from here to "Hangman" is dodgeball unless it says otherwise.

#### Shared physics

`public/games/dodgeball/shared/physics.js` is imported by **both** the server and the browser. It holds `WORLD`, `PLAYER`, `BALL`, `RULES`, `PLATFORMS`, `SPAWNS`, `BALL_SPAWNS`, and the pure step functions `stepPlayer` / `stepBall` / `circleRect`. Keep it dependency-free — no Node APIs, no DOM. All game tuning lives here; change a constant and both sides agree.

This file is also the foundation for the planned client-side prediction, so resist moving step logic into `server/dodgeball/game.js`.

#### Client (plain ES modules, no bundler)

`public/games/dodgeball/index.html` is a single page with three screens (home / lobby / game) toggled by `hidden`. Paths below are relative to `public/games/dodgeball/`.

- `js/main.js` — app flow, screen switching, lobby and HUD DOM (DOM helpers come from `/js/dom.js`, the socket from `/js/net.js`), results, and the 60 Hz input send loop (sends only when the input payload changes, plus a 250 ms keepalive).
- `js/interp.js` — snapshot buffer. Estimates the client↔server clock offset by tracking the *lowest* observed delta (drifting slowly upward), then renders other players ~100 ms in the past and your own player ~40 ms back so controls feel tighter. Hit/catch events are queued and released on the same delayed timeline so effects line up with what you see.
- `js/input.js` — keyboard + mouse. WASD/arrows move, J/left-click throw, K/right-click catch; aim follows the mouse.
- `js/render.js` — canvas drawing. The gym background is pre-rendered once to an offscreen canvas (`buildBackground()`), rebuilt after fonts load.

If the UI is ever moved to a framework, `render.js`, `interp.js`, and `input.js` are framework-agnostic and should stay as-is.

#### Input press counters

Button presses (jump/throw/catch) are sent as **ever-increasing counters** (`js`, `ts`, `cs`), not booleans, so a tap shorter than one 16 ms server tick is never dropped. In `Game.setInput` (`server/dodgeball/game.js`) the first value seen for a key only syncs the counter — it does not fire the action — because it may be left over from a previous round. Preserve this when touching input handling.

#### Wire protocol

Client → server: `input`, `start` (host only), `ping`.
Server → client: `welcome` (your id), `roster` (players, host, phase), `state` (snapshot + events), `ended` (results), `pong`, `error`.

Snapshot fields are deliberately short (`x y vx vy f a h i c r s` for players, `id x st o` for balls) and rounded to 1 decimal — these go out 30× per second to every client. Keep additions terse. Slow clients with > 256 KB buffered are skipped for that frame rather than queueing stale state.

### Hangman

Co-op and turn-based. `public/games/hangman/shared/rules.js` is imported by both sides and holds all tuning plus `normalizePhrase` / `validatePhrase` / `maskPhrase` / `isSolved` — phrases are normalized identically on both ends, so the client never has to guess how the server will read a guess.

A round is a four-stage machine in `HangmanGame`: `writing` (60 s for the setter) → `turn` (30 s of voting, repeated) → `reveal` (6 s) → the next round, then `done`. The room turns `done` into results.

- **The ballot.** A letter joins the ballot the moment someone votes for it, and leaves when its last backer drops it. Phrase guesses are proposed (one per player per turn, `maxGuesses` on the ballot) and stay even at zero votes. Voting for your current pick again clears it.
- **Resolution.** Highest vote count wins; ties are broken at random (`last.tied` tells the client to say "coin flip"). A turn resolves early once every eligible player has voted — so with two players a single vote resolves immediately. `emptyTurnLimit` consecutive turns with no votes abandons the round so an idle room can't stall forever.
- **Everything costs a limb except a correct guess**, including a wrong full-phrase guess. Six misses hangs the group.
- **The setter never votes and never scores.** They're the one client that gets `phrase` in their snapshot while a round is live (`snapshotFor`) — the broadcast payload omits it, so don't "simplify" that into a single broadcast.
- Setter rotation is a cursor over join order. If the setter leaves mid-round the round is dropped (`setterLeft`); if the room falls below `minPlayers` the match ends with `cutShort: true`.

Client → server: `phrase` (setter), `vote` (`key` is a letter or a guess key like `g1`, or `null` to clear), `propose`, plus the shared `start` (carries `rounds`) and `ping`. Only single-character keys are uppercased — uppercasing a guess key breaks the lookup.

### Sharks & Minnows

Real-time, and the closest relative of dodgeball — but a deliberate sibling, not a reuse. `public/games/sharks/shared/physics.js` holds its own `WORLD`, `PLAYER`, `SPEED`, `DASH`, `RULES`, `SAFE`, `PLATFORMS` and its own copy of `stepPlayer`. **Don't collapse that into an import of dodgeball's physics**: the two games pull the same constants in opposite directions, and sharing the file means retuning one silently retunes the other. The ~60 duplicated lines are the price of that independence.

A match is a sequence of crossings, each a three-stage machine in `SharksGame`: `countdown` (3 s, minnows penned at the starting wall) → `running` (20 s of live tagging) → `tally` (3 s) → the next crossing with the direction flipped, or `done`.

- **The walls are the whole game.** They're enforced in `confine()` rather than in the shared step, because they're a rule, not physics. Sharks are pushed out of the destination wall always, and out of the *starting* wall only for `graceSeconds` after the whistle — after that a minnow who stayed home is fair game, which is what stops camping.
- **Tagged minnows turn shark immediately**, mid-crossing, so a crossing gets more dangerous as it runs. Anyone still in the water at the whistle is converted too (`stranded`).
- **A shark takes one minnow at a time** (`tagCooldown`). Without it, one shark running through the start-line pile converts the entire pack in a single frame.
- **Minnows are 7% faster flat out** (`SPEED`), applied via `p.speedMul` inside `stepPlayer`. That one number is what makes the game a game: a shark can't just run a minnow down from behind, it has to cut them off or spend its lunge. If you ever make sharks faster, there is no counterplay left.
- Sharks start in a band well clear of both walls (`PATROL_MARGIN`); starting them on the line wipes the pack out on the first crossing.
- The match ends when one minnow faces a pack of two or more (they win, `won`), when the sharks have everyone, or at `maxCrossings`. With exactly two players the lone shark isn't a pack, so that match runs until the minnow is finally caught.

Client → server: `input` (`left right down jump` plus the `js`/`ds` press counters), plus the shared `start` and `ping`. Server → client adds `stage`, `stageLeft`, `crossing`, `dir`, `grace`, `minnows`, `sharks` to the snapshot; per-player fields are `x y vx vy f r st d k s` (`r` shark, `st` safe, `d` dash ready, `k` dashing).

### Tic Tac Toe

Strictly two seats — a third connection gets `BaseRoom`'s room-full close. Turn-based, so it follows hangman's room shape: `step()` only advances the clock and pushes state on change plus 1 Hz. There's no per-player secret state, so unlike hangman a single `broadcast` is correct.

`public/games/tictactoe/shared/rules.js` holds `TTT`, `LINES`, `winningLine`, `isFull`, `openCells`, `isPlayable` — the client uses the same validation the server enforces, so the board can disable squares without guessing.

- **X always moves first and the X seat alternates every round** (`beginRound` indexes join order by round number), so neither player keeps the first-move advantage. If you change round handling, keep that alternation.
- **The move clock auto-plays a random open square** rather than forfeiting, so one idle player can't freeze the match. It's counted as a `timeout` against them and shown on the results screen.
- A walkout ends the match with `cutShort` and crowns nobody; so does a tied series. There's no tiebreak round.

Client → server: `play` (`cell`, 0–8), plus the shared `start` (carries `rounds`) and `ping`.

### REST API

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/rooms` | Create a game; body `{ game }` (default `dodgeball`), returns `{ code, game }` |
| GET | `/api/rooms/:code` | Exists check; returns `game`, phase and player count |
| GET | `/api/leaderboard` | Top 10 by total hits (`enabled: false` without a DB) |
| GET | `/api/games` | Catalogue for the landing page, `{ games: [...] }` |
| GET | `/health` | Docker healthcheck |

`/<game>/play/:CODE` serves that game's `index.html`; the client reads the code off the path. The old `/play/:CODE` 302s to `/dodgeball/play/:CODE` so invite links shared before the landing page still work.

## Dodgeball rules (all tunable in `public/games/dodgeball/shared/physics.js`)

- Hit → thrower scores, target is out 2 s, respawns with 1.5 s invulnerability.
- Catch → catcher scores and the thrower is knocked out. 0.25 s window, 0.8 s cooldown, impossible while holding a ball.
- Thrown balls use `liveGravity` (flat arc) and die on floor/platform contact or after `liveTime`; wall and ceiling bounces stay live.
- Platforms are one-way except the floor; press down to drop through.
- Ball count scales with player count, 2–4.

## Hangman rules (all tunable in `public/games/hangman/shared/rules.js`)

- The host picks 3 or 5 rounds; one player per round sets the phrase, rotating in join order.
- 30 s per turn. Most-voted letter or phrase guess is submitted; ties are a coin flip; the turn ends early once everyone has voted.
- A wrong letter *or* a wrong phrase guess costs a limb. 6 misses and the group is hanged.
- Co-op: the setter scores nothing. Results show rounds solved plus each player's winning votes and solves.
- Phrases are 3–48 chars, A–Z/0–9/space/apostrophe/hyphen. Digits show from the start; only letters are guessable.

## Sharks & Minnows rules (all tunable in `public/games/sharks/shared/physics.js`)

- 2–16 players. One starting shark per 6 players, minimum one, picked at random.
- 20 s a crossing, after a 3 s countdown. Reach the far painted wall to score a point and sit the rest of the crossing out safely.
- Tagged → you turn shark on the spot and score a point per tag of your own. Still in the water at the whistle and the sharks get you too.
- Sharks can never enter the far wall, and can't enter the starting wall for the first 3 s. After that the whole floor is live.
- Minnows run 7% faster; sharks get the longer dash (650 vs 520) on a slower cooldown (1.1 s vs 0.75 s). A ground dash hops slightly, an air dash is flat so it can't double as a second jump.
- A shark can only take one minnow every 0.4 s.
- Last minnow against two or more sharks wins and takes a 3-point bonus. Hard cap of 12 crossings.

## Tic Tac Toe rules (all tunable in `public/games/tictactoe/shared/rules.js`)

- Exactly 2 players. Host picks 3 or 5 rounds.
- 20 s a move; run the clock out and a random empty square is played for you and counted against you.
- X moves first; the X seat swaps every round.
- Most rounds won takes the match. Draws count for neither player and an even series has no tiebreak.
