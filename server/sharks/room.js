import { BaseRoom, MAX_BUFFERED_BYTES } from '../rooms.js';
import { SharksGame } from './game.js';
import { RULES } from '../../public/games/sharks/shared/physics.js';

export class SharksRoom extends BaseRoom {
  static gameId = 'sharks';
  static maxPlayers = RULES.maxPlayers;
  static minPlayers = RULES.minPlayers;

  constructor(code) {
    super(code);
    this.game = null;
  }

  start() {
    this.game = new SharksGame();
    for (const [id, c] of this.clients) this.game.addPlayer(id, c.name, c.color);
    this.game.begin();
    this.phase = 'playing';
    this.startedAt = new Date();
    this.broadcastRoster();
  }

  step(dt, sendSnapshot) {
    if (this.phase !== 'playing') return;
    // A stage change (the whistle, a crossing ending) gets its own snapshot rather
    // than waiting up to 33 ms, so the countdown and the start line stay in sync.
    const changed = this.game.step(dt);
    if (sendSnapshot || changed) this.broadcastState();
    if (this.game.stage === 'done') this.end();
  }

  broadcastState() {
    const payload = JSON.stringify({ type: 'state', ...this.game.snapshot() });
    for (const { ws } of this.clients.values()) {
      // Skip a frame for slow clients rather than queueing stale state.
      if (ws.readyState === 1 && ws.bufferedAmount < MAX_BUFFERED_BYTES) ws.send(payload);
    }
  }

  end() {
    this.endWith(this.game.results());
  }

  onMessage(id, msg) {
    if (msg.type === 'input' && this.phase === 'playing') this.game.setInput(id, msg);
  }

  onJoin(id) {
    const c = this.clients.get(id);
    this.game.addLatePlayer(id, c.name, c.color);
  }

  onLeave(id) {
    if (!this.game) return;
    this.game.removePlayer(id);
    if (this.phase === 'playing' && this.game.stage === 'done') this.end();
  }

  reset() {
    this.phase = 'lobby';
    this.game = null;
  }
}
