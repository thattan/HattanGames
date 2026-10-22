import { BaseRoom, MAX_BUFFERED_BYTES } from '../rooms.js';
import { Game } from './game.js';
import { RULES } from '../../public/games/dodgeball/shared/physics.js';
import { saveMatch } from '../db.js';

export class DodgeballRoom extends BaseRoom {
  static gameId = 'dodgeball';
  static maxPlayers = RULES.maxPlayers;
  static minPlayers = 1;

  constructor(code) {
    super(code);
    this.game = null;
  }

  start() {
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
    saveMatch(this.code, this.startedAt, results).catch((err) => console.error(err));
    this.endWith(results);
  }

  onMessage(id, msg) {
    if (msg.type === 'input' && this.phase === 'playing') this.game.setInput(id, msg);
  }

  onJoin(id) {
    const c = this.clients.get(id);
    this.game.addPlayer(id, c.name, c.color);
  }

  onLeave(id) {
    this.game?.removePlayer(id);
  }

  reset() {
    this.phase = 'lobby';
    this.game = null;
  }
}
