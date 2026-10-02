import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { RoomManager } from './rooms.js';
import { initDb, dbEnabled, getLeaderboard, closeDb } from './db.js';
import { TICK_RATE, SNAPSHOT_RATE } from '../public/shared/physics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = Number(process.env.PORT) || 3000;

const rooms = new RoomManager();
const app = express();

app.use(express.json({ limit: '10kb' }));
app.use(express.static(PUBLIC_DIR));

app.get('/health', (req, res) => {
  res.json({ ok: true, rooms: rooms.count(), db: dbEnabled() });
});

app.post('/api/rooms', (req, res) => {
  const room = rooms.create();
  res.status(201).json({ code: room.code });
});

app.get('/api/rooms/:code', (req, res) => {
  const room = rooms.get(req.params.code);
  if (!room) return res.status(404).json({ error: 'Game not found' });
  res.json(room.summary());
});

app.get('/api/leaderboard', async (req, res) => {
  if (!dbEnabled()) return res.json({ enabled: false, rows: [] });
  try {
    res.json({ enabled: true, rows: await getLeaderboard(10) });
  } catch (err) {
    console.error('[api] leaderboard', err.message);
    res.status(500).json({ error: 'Leaderboard unavailable' });
  }
});

// Invite links like /play/K7XQ2 load the same single-page client.
app.get('/play/:code', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 2048 });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('error', () => {});

    const room = rooms.get(url.searchParams.get('room') || '');
    if (!room) {
      ws.send(JSON.stringify({ type: 'error', message: 'That game no longer exists. Create a new one.' }));
      ws.close(4004, 'not found');
      return;
    }
    room.connect(ws, url.searchParams.get('name'));
  });
});

// Drop connections that stop answering pings (closed laptops, dead Wi-Fi).
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 15_000);

// Fixed-step simulation: physics at TICK_RATE, snapshots at SNAPSHOT_RATE.
const STEP = 1 / TICK_RATE;
const TICKS_PER_SNAPSHOT = Math.max(1, Math.round(TICK_RATE / SNAPSHOT_RATE));
let last = performance.now();
let acc = 0;
let tick = 0;
const loop = setInterval(() => {
  const now = performance.now();
  acc += Math.min((now - last) / 1000, 0.25);
  last = now;
  while (acc >= STEP) {
    acc -= STEP;
    tick++;
    rooms.step(STEP, tick % TICKS_PER_SNAPSHOT === 0);
  }
}, 1000 / TICK_RATE);

await initDb();
server.listen(PORT, () => console.log(`Dodgeball running at http://localhost:${PORT}`));

function shutdown() {
  console.log('Shutting down');
  clearInterval(loop);
  clearInterval(heartbeat);
  for (const ws of wss.clients) ws.close(1001, 'server shutting down');
  server.close(() => closeDb().finally(() => process.exit(0)));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
