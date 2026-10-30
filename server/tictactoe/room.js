import { BaseRoom } from '../rooms.js';
import { TicTacToeGame } from './game.js';
import { TTT } from '../../public/games/tictactoe/shared/rules.js';

const CLOCK_INTERVAL = 1; // seconds between keep-alive state pushes

export class TicTacToeRoom extends BaseRoom {
  static gameId = 'tictactoe';
  static maxPlayers = TTT.maxPlayers;
  static minPlayers = TTT.minPlayers;

  constructor(code) {
    super(code);
    this.game = null;
    this.sinceBroadcast = 0;
  }

  start(msg) {
    const rounds = TTT.roundOptions.includes(msg?.rounds) ? msg.rounds : TTT.defaultRounds;
    this.game = new TicTacToeGame(rounds);
    for (const [id, c] of this.clients) this.game.addPlayer(id, c.name, c.color);
    this.game.begin();
    this.phase = 'playing';
    this.startedAt = new Date();
    this.sinceBroadcast = 0;
    this.broadcastRoster();
    this.broadcastState();
  }

  // Turn-based, so this only advances the clock: moves are handled as they arrive.
  // One state push a second keeps client countdowns honest.
  step(dt) {
    if (this.phase !== 'playing') return;

    const changed = this.game.step(dt);
    if (this.game.stage === 'done') { this.end(); return; }

    this.sinceBroadcast += dt;
    if (changed || this.sinceBroadcast >= CLOCK_INTERVAL) this.broadcastState();
  }

  end() {
    this.endWith(this.game.results());
  }

  onMessage(id, msg) {
    if (this.phase !== 'playing' || msg.type !== 'play') return;

    const result = this.game.play(id, msg.cell);
    if (!result.ok) {
      this.toClient(id, { type: 'error', message: result.error });
      return;
    }
    if (this.game.stage === 'done') { this.end(); return; }
    this.broadcastState();
  }

  onLeave(id) {
    if (!this.game) return;
    this.game.removePlayer(id);
    if (this.phase === 'playing' && this.game.stage === 'done') this.end();
  }

  broadcastState() {
    this.sinceBroadcast = 0;
    this.broadcast({ type: 'state', ...this.game.snapshot() });
  }

  reset() {
    this.phase = 'lobby';
    this.game = null;
  }
}
