import {
  HANGMAN, LETTERS, maskPhrase, isSolved, validatePhrase,
} from '../../public/games/hangman/shared/rules.js';

const LETTER_SET = new Set(LETTERS);
const round1 = (n) => Math.round(n * 10) / 10;

// A co-op match: one player sets a phrase, everyone else votes each turn on the
// letter (or full-phrase guess) to submit. The group solves it or hangs together;
// the setter scores nothing either way.
//
// Stages within a round:
//   writing  setter types a phrase          (writeSeconds)
//   turn     everyone else votes            (turnSeconds, ends early once all have voted)
//   reveal   outcome shown before the next round (revealSeconds)
//   done     match over; the room turns this into results
export class HangmanGame {
  constructor(rounds = HANGMAN.defaultRounds) {
    this.rounds = rounds;
    this.players = new Map(); // id -> { name, color, votes, correctVotes, solves, phrasesSet }
    this.order = [];          // setter rotation, in join order
    this.cursor = 0;

    this.stage = 'writing';
    this.roundNo = 0;
    this.setterId = null;
    this.phrase = '';
    this.revealed = new Set();
    this.used = new Set();
    this.misses = 0;

    this.turnNo = 0;
    this.emptyTurns = 0;
    this.candidates = new Map(); // key -> { key, kind, text, by, votes:Set<id> }
    this.votes = new Map();      // voterId -> key
    this.proposed = new Set();   // ids that already proposed a guess this turn
    this.nextGuessNo = 1;

    this.timer = 0;
    this.last = null;            // what the previous turn submitted
    this.outcome = null;         // set during 'reveal'
    this.history = [];
    this.solvedCount = 0;
    this.ranOut = false;         // too few players to continue
  }

  // ---------- roster ----------

  addPlayer(id, name, color) {
    if (this.players.has(id)) return;
    this.players.set(id, { name, color, votes: 0, correctVotes: 0, solves: 0, phrasesSet: 0 });
    this.order.push(id);
  }

  removePlayer(id) {
    if (!this.players.delete(id)) return;
    this.order = this.order.filter((p) => p !== id);
    this.clearVote(id);
    this.proposed.delete(id);

    if (this.stage === 'done') return;
    if (this.players.size < HANGMAN.minPlayers) {
      this.ranOut = true;
      this.finish();
      return;
    }
    if (id === this.setterId && (this.stage === 'writing' || this.stage === 'turn')) {
      this.endRound('setterLeft');
      return;
    }
    if (this.stage === 'turn') this.resolveIfEveryoneVoted();
  }

  // Everyone except the setter gets a vote.
  eligibleCount() {
    const setterPresent = this.setterId && this.players.has(this.setterId) ? 1 : 0;
    return this.players.size - setterPresent;
  }

  // ---------- round flow ----------

  begin() {
    this.beginRound();
  }

  beginRound() {
    this.roundNo++;
    if (this.roundNo > this.rounds) { this.finish(); return; }

    const setterId = this.nextSetter();
    if (!setterId) { this.finish(); return; }

    this.setterId = setterId;
    this.phrase = '';
    this.revealed = new Set();
    this.used = new Set();
    this.misses = 0;
    this.turnNo = 0;
    this.emptyTurns = 0;
    this.last = null;
    this.outcome = null;
    this.clearBallot();

    this.stage = 'writing';
    this.timer = HANGMAN.writeSeconds;
  }

  nextSetter() {
    if (this.order.length === 0) return null;
    const id = this.order[this.cursor % this.order.length];
    this.cursor++;
    return id;
  }

  beginTurn() {
    this.turnNo++;
    this.clearBallot();
    this.stage = 'turn';
    this.timer = HANGMAN.turnSeconds;
  }

  clearBallot() {
    this.candidates.clear();
    this.votes.clear();
    this.proposed.clear();
    this.nextGuessNo = 1;
  }

  endRound(outcome) {
    this.stage = 'reveal';
    this.outcome = outcome;
    this.timer = HANGMAN.revealSeconds;
    if (outcome === 'solved') this.solvedCount++;
    this.history.push({
      round: this.roundNo,
      setterId: this.setterId,
      setter: this.players.get(this.setterId)?.name ?? 'Someone',
      phrase: this.phrase,
      outcome,
      misses: this.misses,
      turns: this.turnNo,
    });
  }

  finish() {
    this.stage = 'done';
    this.timer = 0;
    this.clearBallot();
  }

  step(dt) {
    if (this.stage === 'done') return false;
    this.timer -= dt;
    if (this.timer > 0) return false;

    this.timer = 0;
    switch (this.stage) {
      case 'writing': this.endRound('noPhrase'); break;
      case 'turn': this.resolveTurn(); break;
      case 'reveal': this.beginRound(); break;
    }
    return true;
  }

  // ---------- player actions ----------

  setPhrase(id, raw) {
    if (this.stage !== 'writing') return { ok: false, error: 'The phrase is already set.' };
    if (id !== this.setterId) return { ok: false, error: "You're not setting the phrase this round." };

    const check = validatePhrase(raw);
    if (!check.ok) return check;

    this.phrase = check.value;
    this.players.get(id).phrasesSet++;
    this.beginTurn();
    return { ok: true };
  }

  vote(id, rawKey) {
    if (this.stage !== 'turn') return { ok: false, error: 'Voting is closed.' };
    if (id === this.setterId) return { ok: false, error: "You set this phrase — you can't vote." };
    if (!this.players.has(id)) return { ok: false, error: 'Unknown player.' };

    // Letters are case-insensitive; guess keys ("g1") are not.
    const key = typeof rawKey === 'string' && rawKey.length === 1 ? rawKey.toUpperCase() : rawKey;

    // Clearing your vote.
    if (key === null) {
      this.clearVote(id);
      return { ok: true };
    }

    const candidate = this.candidateFor(key);
    if (!candidate) {
      const tried = typeof key === 'string' && this.used.has(key);
      return { ok: false, error: tried ? 'That letter has already been tried.' : 'That option is no longer on the ballot.' };
    }

    // Voting for your current pick again takes the vote back.
    if (this.votes.get(id) === candidate.key) {
      this.clearVote(id);
      return { ok: true };
    }

    this.clearVote(id);
    this.votes.set(id, candidate.key);
    candidate.votes.add(id);
    return { ok: true, resolved: this.resolveIfEveryoneVoted() };
  }

  propose(id, raw) {
    if (this.stage !== 'turn') return { ok: false, error: 'Voting is closed.' };
    if (id === this.setterId) return { ok: false, error: "You set this phrase — you can't guess." };
    if (!this.players.has(id)) return { ok: false, error: 'Unknown player.' };
    if (this.proposed.has(id)) return { ok: false, error: 'One guess each per turn.' };

    const check = validatePhrase(raw);
    if (!check.ok) return check;

    // Someone already put this guess on the ballot: back theirs instead.
    const existing = [...this.candidates.values()].find((c) => c.kind === 'phrase' && c.text === check.value);
    if (existing) return this.vote(id, existing.key);

    const guesses = [...this.candidates.values()].filter((c) => c.kind === 'phrase');
    if (guesses.length >= HANGMAN.maxGuesses) {
      return { ok: false, error: 'The ballot is full this turn.' };
    }

    const key = `g${this.nextGuessNo++}`;
    this.candidates.set(key, { key, kind: 'phrase', text: check.value, by: id, votes: new Set() });
    this.proposed.add(id);
    return this.vote(id, key);
  }

  // Letters go on the ballot the moment someone votes for one.
  candidateFor(key) {
    if (this.candidates.has(key)) return this.candidates.get(key);
    if (typeof key !== 'string' || !LETTER_SET.has(key) || this.used.has(key)) return null;
    const candidate = { key, kind: 'letter', text: key, by: null, votes: new Set() };
    this.candidates.set(key, candidate);
    return candidate;
  }

  clearVote(id) {
    const key = this.votes.get(id);
    if (key === undefined) return;
    this.votes.delete(id);
    const candidate = this.candidates.get(key);
    if (!candidate) return;
    candidate.votes.delete(id);
    // Keep proposed guesses on the ballot, but drop letters nobody is backing.
    if (candidate.kind === 'letter' && candidate.votes.size === 0) this.candidates.delete(key);
  }

  resolveIfEveryoneVoted() {
    const eligible = this.eligibleCount();
    if (eligible <= 0 || this.votes.size < eligible) return false;
    this.resolveTurn();
    return true;
  }

  // ---------- resolution ----------

  resolveTurn() {
    const ballot = [...this.candidates.values()].filter((c) => c.votes.size > 0);

    if (ballot.length === 0) {
      this.emptyTurns++;
      this.last = { kind: 'none', value: null, correct: false, by: null, votes: 0 };
      if (this.emptyTurns >= HANGMAN.emptyTurnLimit) this.endRound('abandoned');
      else this.beginTurn();
      return;
    }

    this.emptyTurns = 0;
    const most = Math.max(...ballot.map((c) => c.votes.size));
    const tied = ballot.filter((c) => c.votes.size === most);
    const winner = tied[Math.floor(Math.random() * tied.length)];

    const correct = winner.kind === 'letter'
      ? this.submitLetter(winner.text)
      : winner.text === this.phrase;

    for (const voterId of winner.votes) {
      const player = this.players.get(voterId);
      if (!player) continue;
      player.votes++;
      if (correct) player.correctVotes++;
    }
    if (correct && winner.kind === 'phrase') {
      const author = this.players.get(winner.by);
      if (author) author.solves++;
    }

    this.last = {
      kind: winner.kind,
      value: winner.text,
      correct,
      by: winner.by,
      byName: winner.by ? this.players.get(winner.by)?.name ?? null : null,
      votes: winner.votes.size,
      tied: tied.length > 1,
    };

    const solved = winner.kind === 'phrase'
      ? correct
      : isSolved(this.phrase, this.revealed);

    if (solved) { this.endRound('solved'); return; }

    if (!correct) {
      this.misses++;
      if (this.misses >= HANGMAN.maxMisses) { this.endRound('hanged'); return; }
    }
    this.beginTurn();
  }

  submitLetter(letter) {
    this.used.add(letter);
    if (!this.phrase.includes(letter)) return false;
    this.revealed.add(letter);
    return true;
  }

  // ---------- views ----------

  snapshot() {
    const showPhrase = this.stage === 'reveal' || this.stage === 'done';
    return {
      stage: this.stage,
      round: this.roundNo,
      rounds: this.rounds,
      solved: this.solvedCount,
      setterId: this.setterId,
      mask: maskPhrase(this.phrase, this.revealed),
      used: [...this.used].sort().join(''),
      misses: this.misses,
      maxMisses: HANGMAN.maxMisses,
      turn: this.turnNo,
      timeLeft: round1(Math.max(0, this.timer)),
      voters: this.eligibleCount(),
      candidates: [...this.candidates.values()].map((c) => ({
        key: c.key,
        kind: c.kind,
        text: c.text,
        by: c.by,
        votes: [...c.votes],
      })),
      last: this.last,
      outcome: this.outcome,
      phrase: showPhrase ? this.phrase : undefined,
    };
  }

  // The setter sees their own phrase while everyone else guesses it.
  snapshotFor(id, base = this.snapshot()) {
    if (id !== this.setterId || !this.phrase || base.phrase !== undefined) return base;
    return { ...base, phrase: this.phrase };
  }

  results() {
    const players = [...this.players]
      .map(([id, p]) => ({
        id,
        name: p.name,
        color: p.color,
        correctVotes: p.correctVotes,
        votes: p.votes,
        solves: p.solves,
        phrasesSet: p.phrasesSet,
        score: p.correctVotes + 3 * p.solves,
      }))
      .sort((a, b) => b.score - a.score || b.correctVotes - a.correctVotes);

    return {
      game: 'hangman',
      solved: this.solvedCount,
      rounds: this.history.length,
      target: this.rounds,
      cutShort: this.ranOut,
      history: this.history,
      players,
    };
  }
}
