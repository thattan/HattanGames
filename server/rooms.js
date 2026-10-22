// Game-agnostic room plumbing: codes, roster, host handoff, lifecycle.
// Each game subclasses BaseRoom (see server/<game>/room.js) and fills in the hooks:
//
//   maxPlayers        how many clients may join
//   minPlayers        how many are needed before the host can start
//   start(options)    begin a match; must set phase and broadcast
//   step(dt, tock)    called from the global loop; no-op for turn-based games
//   onJoin(id)        a client joined mid-match
//   onLeave(id)       a client left
//   onMessage(id,msg) game-specific client messages (base handles start/ping)
//
// Rooms are keyed by code across all games, so a code is enough to find a room
// and `summary().game` tells the client which game client to load.

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I
const CODE_LENGTH = 5;
const COLORS = ['#E8433A', '#2F7DE1', '#F2B134', '#2DB37A', '#9B5DE5', '#F07C2E', '#17B5C9', '#E05A9C'];
const EMPTY_ROOM_TTL_MS = 60_000;

export const RESULTS_MS = 10_000;
export const MAX_BUFFERED_BYTES = 256 * 1024;

function makeCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

function cleanName(raw) {
  const printable = [...String(raw ?? '')].filter((ch) => {
    const code = ch.codePointAt(0);
    return code >= 32 && code !== 127;
  });
  const s = printable.join('').trim().slice(0, 16);
  return s || 'Player';
}

export function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

export class BaseRoom {
  static gameId = 'base';
  static maxPlayers = 8;
  static minPlayers = 1;

  constructor(code) {
    this.code = code;
    this.clients = new Map(); // id -> { ws, name, color }
    this.hostId = null;
    this.phase = 'lobby';     // lobby | playing | ended
    this.startedAt = null;
    this.lastResults = null;
    this.resultsTimer = null;
    this.nextId = 1;
    this.emptySince = Date.now();
  }

  // `gameId`, not `game`: subclasses keep their simulation on `this.game`.
  get gameId() { return this.constructor.gameId; }
  get maxPlayers() { return this.constructor.maxPlayers; }
  get minPlayers() { return this.constructor.minPlayers; }

  summary() {
    return {
      code: this.code,
      game: this.gameId,
      phase: this.phase,
      players: this.clients.size,
      maxPlayers: this.maxPlayers,
    };
  }

  connect(ws, rawName) {
    if (this.clients.size >= this.maxPlayers) {
      send(ws, { type: 'error', message: `This game is full (${this.maxPlayers} players max).` });
      ws.close(4003, 'full');
      return;
    }

    const id = `p${this.nextId++}`;
    const name = this.uniqueName(cleanName(rawName));
    const color = COLORS.find((c) => ![...this.clients.values()].some((cl) => cl.color === c)) ?? COLORS[0];
    this.clients.set(id, { ws, name, color });
    this.emptySince = null;
    if (!this.hostId) this.hostId = id;

    send(ws, { type: 'welcome', id, code: this.code, game: this.gameId });
    if (this.phase === 'playing') this.onJoin(id);
    if (this.phase === 'ended') send(ws, { type: 'ended', results: this.lastResults });
    this.broadcastRoster();

    ws.on('message', (data) => this.receive(id, data));
    ws.on('close', () => this.leave(id));
  }

  uniqueName(name) {
    const taken = new Set([...this.clients.values()].map((c) => c.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let n = 2; ; n++) {
      const candidate = `${name.slice(0, 13)} ${n}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  receive(id, data) {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;

    switch (msg.type) {
      case 'start':
        if (id !== this.hostId || this.phase === 'playing') return;
        if (this.clients.size < this.minPlayers) {
          this.toClient(id, { type: 'error', message: `You need at least ${this.minPlayers} players to start.` });
          return;
        }
        clearTimeout(this.resultsTimer);
        this.start(msg);
        return;
      case 'ping':
        this.toClient(id, { type: 'pong', t: msg.t });
        return;
      default:
        this.onMessage(id, msg);
    }
  }

  leave(id) {
    if (!this.clients.delete(id)) return;
    this.onLeave(id);
    if (this.hostId === id) this.hostId = this.clients.keys().next().value ?? null;

    if (this.clients.size === 0) {
      this.emptySince = Date.now();
      clearTimeout(this.resultsTimer);
      this.reset();
      return;
    }
    this.broadcastRoster();
  }

  // Back to the lobby a few seconds after a match ends.
  endWith(results) {
    this.phase = 'ended';
    this.lastResults = results;
    this.broadcast({ type: 'ended', results });
    this.broadcastRoster();

    this.resultsTimer = setTimeout(() => {
      if (this.phase !== 'ended') return;
      this.reset();
      this.broadcastRoster();
    }, RESULTS_MS);
  }

  reset() {
    this.phase = 'lobby';
  }

  toClient(id, obj) {
    const client = this.clients.get(id);
    if (client) send(client.ws, obj);
  }

  broadcast(obj) {
    const payload = JSON.stringify(obj);
    for (const { ws } of this.clients.values()) if (ws.readyState === 1) ws.send(payload);
  }

  broadcastRoster() {
    this.broadcast({
      type: 'roster',
      code: this.code,
      game: this.gameId,
      phase: this.phase,
      hostId: this.hostId,
      players: [...this.clients].map(([id, c]) => ({ id, name: c.name, color: c.color })),
    });
  }

  // Hooks with no useful default.
  start() {}
  step() {}
  onJoin() {}
  onLeave() {}
  onMessage() {}
}

export class RoomManager {
  // roomClasses: { [gameId]: class extends BaseRoom }
  constructor(roomClasses) {
    this.roomClasses = roomClasses;
    this.rooms = new Map();
    this.sweeper = setInterval(() => this.sweep(), 10_000);
    this.sweeper.unref();
  }

  supports(game) {
    return Object.hasOwn(this.roomClasses, game);
  }

  create(game) {
    const RoomClass = this.roomClasses[game];
    if (!RoomClass) return null;
    let code;
    do { code = makeCode(); } while (this.rooms.has(code));
    const room = new RoomClass(code);
    this.rooms.set(code, room);
    return room;
  }

  get(code) {
    return this.rooms.get(String(code).toUpperCase());
  }

  count() {
    return this.rooms.size;
  }

  step(dt, tock) {
    for (const room of this.rooms.values()) room.step(dt, tock);
  }

  // Remove rooms that have been empty for a while (including ones never joined).
  sweep() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (room.emptySince !== null && now - room.emptySince > EMPTY_ROOM_TTL_MS) {
        clearTimeout(room.resultsTimer);
        this.rooms.delete(code);
      }
    }
  }
}
