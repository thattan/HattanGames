import {
  TTT, emptyBoard, winningLine, isFull, openCells, isPlayable,
} from '../../public/games/tictactoe/shared/rules.js';

const round1 = (n) => Math.round(n * 10) / 10;

// A match is a fixed number of rounds. Each round is a two-stage machine:
//
//   turn (20 s per move)  players alternate until someone lines up three or the board fills
//   reveal (3 s)          the winning line stays up
//   -> next round, or `done`
//
// X always moves first and the X seat alternates every round, so neither player
// keeps the first-move advantage.
export class TicTacToeGame {
  constructor(rounds) {
    this.rounds = rounds;
    this.round = 0;
    this.players = new Map();
    this.order = [];
    this.board = emptyBoard();
    this.marks = { X: null, O: null };
    this.stage = 'turn';   // turn | reveal | done
    this.turnId = null;
    this.timeLeft = TTT.turnSeconds;
    this.lastMove = null;  // { cell, by, auto }
    this.outcome = null;   // { line, winnerId, draw } while stage is 'reveal'
    this.cutShort = false;
  }

  // ---------- roster ----------

  addPlayer(id, name, color) {
    this.players.set(id, { id, name, color, wins: 0, draws: 0, timeouts: 0 });
    this.order.push(id);
  }

  // Tic tac toe needs both seats filled, so a walkout ends the match — there's no
  // meaningful way to carry on.
  removePlayer(id) {
    if (!this.players.delete(id)) return;
    this.order = this.order.filter((x) => x !== id);
    if (this.stage === 'done') return;
    this.cutShort = true;
    this.finish();
  }

  // ---------- match flow ----------

  begin() {
    this.beginRound(1);
  }

  beginRound(n) {
    this.round = n;
    this.board = emptyBoard();
    this.lastMove = null;
    this.outcome = null;

    const first = this.order[(n - 1) % this.order.length];
    this.marks = { X: first, O: this.order.find((x) => x !== first) ?? null };
    this.stage = 'turn';
    this.turnId = first;
    this.timeLeft = TTT.turnSeconds;
  }

  markOf(id) {
    if (this.marks.X === id) return 'X';
    if (this.marks.O === id) return 'O';
    return null;
  }

  other(id) {
    return this.order.find((x) => x !== id) ?? id;
  }

  play(id, cell) {
    if (this.stage !== 'turn') return { ok: false, error: 'Wait for the next round.' };
    if (id !== this.turnId) return { ok: false, error: "It's not your turn." };
    if (!isPlayable(this.board, cell)) return { ok: false, error: 'Pick an empty square.' };
    this.commit(id, cell, false);
    return { ok: true };
  }

  commit(id, cell, auto) {
    this.board[cell] = this.markOf(id);
    this.lastMove = { cell, by: id, auto };

    const line = winningLine(this.board);
    if (line) {
      const p = this.players.get(id);
      if (p) p.wins++;
      this.outcome = { line, winnerId: id, draw: false };
      this.endRound();
      return;
    }
    if (isFull(this.board)) {
      for (const p of this.players.values()) p.draws++;
      this.outcome = { line: null, winnerId: null, draw: true };
      this.endRound();
      return;
    }

    this.turnId = this.other(id);
    this.timeLeft = TTT.turnSeconds;
  }

  endRound() {
    this.stage = 'reveal';
    this.turnId = null;
    this.timeLeft = TTT.revealSeconds;
  }

  // Returns true when something changed, so the room can broadcast immediately.
  step(dt) {
    if (this.stage === 'done') return false;

    this.timeLeft = Math.max(0, this.timeLeft - dt);
    if (this.timeLeft > 0) return false;

    if (this.stage === 'turn') {
      // Out of time: a random open square is played for you. One player wandering
      // off shouldn't be able to freeze the match.
      const open = openCells(this.board);
      if (open.length === 0) { this.endRound(); return true; }
      const p = this.players.get(this.turnId);
      if (p) p.timeouts++;
      this.commit(this.turnId, open[Math.floor(Math.random() * open.length)], true);
      return true;
    }

    if (this.round >= this.rounds) { this.finish(); return true; }
    this.beginRound(this.round + 1);
    return true;
  }

  finish() {
    this.stage = 'done';
    this.turnId = null;
    this.timeLeft = 0;
  }

  // ---------- wire ----------

  snapshot() {
    return {
      round: this.round,
      rounds: this.rounds,
      stage: this.stage,
      timeLeft: round1(this.timeLeft),
      board: this.board,
      marks: this.marks,
      turnId: this.turnId,
      lastMove: this.lastMove,
      outcome: this.outcome,
      scores: [...this.players.values()].map((p) => ({ id: p.id, wins: p.wins, draws: p.draws })),
    };
  }

  results() {
    const rows = [...this.players.values()]
      .map((p) => ({
        id: p.id, name: p.name, color: p.color,
        wins: p.wins, draws: p.draws, timeouts: p.timeouts,
      }))
      .sort((a, b) => b.wins - a.wins || a.timeouts - b.timeouts);

    // A walkout doesn't crown anyone, and neither does a tied match.
    const decided = !this.cutShort && rows.length > 1 && rows[0].wins > rows[1].wins;
    return rows.map((r, i) => ({ ...r, placement: i + 1, won: decided && i === 0 }));
  }
}
