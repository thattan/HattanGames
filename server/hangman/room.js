import { BaseRoom, send } from '../rooms.js';
import { HangmanGame } from './game.js';
import { HANGMAN } from '../../public/games/hangman/shared/rules.js';

const CLOCK_INTERVAL = 1; // seconds between keep-alive state pushes

export class HangmanRoom extends BaseRoom {
  static gameId = 'hangman';
  static maxPlayers = HANGMAN.maxPlayers;
  static minPlayers = HANGMAN.minPlayers;

  constructor(code) {
    super(code);
    this.game = null;
    this.sinceBroadcast = 0;
  }

  start(msg) {
    const rounds = HANGMAN.roundOptions.includes(msg?.rounds) ? msg.rounds : HANGMAN.defaultRounds;
    this.game = new HangmanGame(rounds);
    for (const [id, c] of this.clients) this.game.addPlayer(id, c.name, c.color);
    this.game.begin();
    this.phase = 'playing';
    this.startedAt = new Date();
    this.sinceBroadcast = 0;
    this.broadcastRoster();
    this.broadcastState();
  }

  // Turn-based, so this only advances clocks: the heavy lifting happens in
  // response to messages. One state push a second keeps client countdowns honest.
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
    if (this.phase !== 'playing') return;

    let result;
    switch (msg.type) {
      case 'phrase':
        result = this.game.setPhrase(id, msg.text);
        break;
      case 'vote':
        result = this.game.vote(id, msg.key ?? null);
        break;
      case 'propose':
        result = this.game.propose(id, msg.text);
        break;
      default:
        return;
    }

    if (!result.ok) {
      this.toClient(id, { type: 'error', message: result.error });
      return;
    }
    if (this.game.stage === 'done') { this.end(); return; }
    this.broadcastState();
  }

  onJoin(id) {
    const c = this.clients.get(id);
    this.game.addPlayer(id, c.name, c.color);
    this.broadcastState();
  }

  onLeave(id) {
    if (!this.game) return;
    this.game.removePlayer(id);
    if (this.phase !== 'playing') return;
    if (this.game.stage === 'done') { this.end(); return; }
    this.broadcastState();
  }

  broadcastState() {
    this.sinceBroadcast = 0;
    const base = this.game.snapshot();
    const common = JSON.stringify({ type: 'state', ...base });
    for (const [id, { ws }] of this.clients) {
      if (ws.readyState !== 1) continue;
      // The setter is the one client that sees the phrase while it's being guessed.
      if (id === this.game.setterId) send(ws, { type: 'state', ...this.game.snapshotFor(id, base) });
      else ws.send(common);
    }
  }

  reset() {
    this.phase = 'lobby';
    this.game = null;
  }
}
