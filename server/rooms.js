import { Game } from './game.js';
import { RULES } from '../public/shared/physics.js';
import { saveMatch } from './db.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I
const CODE_LENGTH = 5;
const COLORS = ['#E8433A', '#2F7DE1', '#F2B134', '#2DB37A', '#9B5DE5', '#F07C2E', '#17B5C9', '#E05A9C'];
const EMPTY_ROOM_TTL_MS = 60_000;
const RESULTS_MS = 10_000;
const MAX_BUFFERED_BYTES = 256 * 1024;

function makeCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

function cleanName(raw) {
  const s = String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 16);
  return s || 'Player';
}

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

export class Room {
  constructor(code) {
    this.code = code;
    this.clients = new Map(); // id -> { ws, name, color }
    this.hostId = null;
    this.phase = 'lobby';     // lobby | playing | ended
    this.game = null;
    this.startedAt = null;
    this.lastResults = null;
    this.resultsTimer = null;
    this.nextId = 1;
    this.emptySince = Date.now();
  }

  summary() {
    return { code: this.code, phase: this.phase, players: this.clients.size, maxPlayers: RULES.maxPlayers };
  }

  connect(ws, rawName) {
    if (this.clients.size >= RULES.maxPlayers) {
      send(ws, { type: 'error', message: `This game is full (${RULES.maxPlayers} players max).` });
      ws.close(4003, 'full');
      return;
    }

    const id = `p${this.nextId++}`;
    const name = this.uniqueName(cleanName(rawName));
    const color = COLORS.find((c) => ![...this.clients.values()].some((cl) => cl.color === c)) ?? COLORS[0];
    this.clients.set(id, { ws, name, color });
    this.emptySince = null;
    if (!this.hostId) this.hostId = id;

    send(ws, { type: 'welcome', id, code: this.code });
    if (this.phase === 'playing') this.game.addPlayer(id, name, color);
    if (this.phase === 'ended') send(ws, { type: 'ended', results: this.lastResults });
    this.broadcastRoster();

    ws.on('message', (data) => this.onMessage(id, data));
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

  onMessage(id, data) {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;

    switch (msg.type) {
      case 'input':
        if (this.phase === 'playing') this.game.setInput(id, msg);
        break;
      case 'start':
        if (id === this.hostId && this.phase !== 'playing') this.start();
        break;
      case 'ping': {
        const client = this.clients.get(id);
        if (client) send(client.ws, { type: 'pong', t: msg.t });
        break;
      }
    }
  }

  start() {
    clearTimeout(this.resultsTimer);
    this.game = new Game();
    for (const [id, c] of this.clients) this.game.addPlayer(id, c.name, c.color);
    this.phase = 'playing';
    this.startedAt = new Date();
    this.broadcastRoster();
  }

  step(dt, sendSnapshot) {
    if (this.phase !== 'playing') return;
    this.game.step(dt);
    if (sendSnapshot) {
      const payload = JSON.stringify({ type: 'state', ...this.game.snapshot() });
      for (const { ws } of this.clients.values()) {
        // Skip a frame for slow clients rather than queueing stale state.
        if (ws.readyState === 1 && ws.bufferedAmount < MAX_BUFFERED_BYTES) ws.send(payload);
      }
    }
    if (this.game.timeLeft <= 0) this.end();
  }

  end() {
    const results = this.game.results();
    this.phase = 'ended';
    this.lastResults = results;
    this.broadcast({ type: 'ended', results });
    this.broadcastRoster();
    saveMatch(this.code, this.startedAt, results).catch((err) => console.error(err));

    this.resultsTimer = setTimeout(() => {
      if (this.phase !== 'ended') return;
      this.phase = 'lobby';
      this.game = null;
      this.broadcastRoster();
    }, RESULTS_MS);
  }

  leave(id) {
    if (!this.clients.delete(id)) return;
    this.game?.removePlayer(id);
    if (this.hostId === id) this.hostId = this.clients.keys().next().value ?? null;

    if (this.clients.size === 0) {
      this.emptySince = Date.now();
      clearTimeout(this.resultsTimer);
      this.phase = 'lobby';
      this.game = null;
      return;
    }
    this.broadcastRoster();
  }

  broadcast(obj) {
    const payload = JSON.stringify(obj);
    for (const { ws } of this.clients.values()) if (ws.readyState === 1) ws.send(payload);
  }

  broadcastRoster() {
    this.broadcast({
      type: 'roster',
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      players: [...this.clients].map(([id, c]) => ({ id, name: c.name, color: c.color })),
    });
  }
}

export class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.sweeper = setInterval(() => this.sweep(), 10_000);
    this.sweeper.unref();
  }

  create() {
    let code;
    do { code = makeCode(); } while (this.rooms.has(code));
    const room = new Room(code);
    this.rooms.set(code, room);
    return room;
  }

  get(code) {
    return this.rooms.get(String(code).toUpperCase());
  }

  count() {
    return this.rooms.size;
  }

  step(dt, sendSnapshot) {
    for (const room of this.rooms.values()) room.step(dt, sendSnapshot);
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
