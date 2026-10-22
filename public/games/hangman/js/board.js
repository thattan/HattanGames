// Draws a hangman state payload into the game screen. No game logic lives here:
// the server decides everything, this just renders what it sent.
import { $, el, chip } from '/js/dom.js';
import { HANGMAN, LETTERS } from '/games/hangman/shared/rules.js';

const STAGE_SECONDS = {
  writing: HANGMAN.writeSeconds,
  turn: HANGMAN.turnSeconds,
  reveal: HANGMAN.revealSeconds,
};

const OUTCOMES = {
  solved: (s) => `Solved it in ${s.turn} ${s.turn === 1 ? 'turn' : 'turns'}.`,
  hanged: () => 'Hanged. Six misses.',
  abandoned: () => 'Nobody voted, so the round was dropped.',
  noPhrase: (s, name) => `${name} never set a phrase.`,
  setterLeft: (s, name) => `${name} left, so the round was dropped.`,
};

export class Board {
  constructor({ onVote, onPropose, onPhrase }) {
    this.onVote = onVote;
    this.onPropose = onPropose;
    this.state = null;
    this.myId = null;
    this.roster = [];

    this.letterButtons = new Map();
    for (const ch of LETTERS) {
      const button = el('button', { type: 'button', className: 'letter' }, [
        el('span', { className: 'ch', textContent: ch }),
        el('span', { className: 'count' }),
      ]);
      button.addEventListener('click', () => this.onVote(ch));
      this.letterButtons.set(ch, button);
    }
    $('letters').replaceChildren(...this.letterButtons.values());

    $('phrase-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('phrase-input');
      if (input.value.trim()) onPhrase(input.value);
    });

    $('guess-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('guess-input');
      if (!input.value.trim()) return;
      this.onPropose(input.value);
      input.value = '';
    });

    this.parts = [...document.querySelectorAll('#gallows .part')];
    this.clockEndsAt = 0;
    this.clockTotal = HANGMAN.turnSeconds;
  }

  setRoster(roster, myId) {
    this.roster = roster;
    this.myId = myId;
    // Someone joined or left: redraw the room panel without waiting for a push.
    if (this.state) this.renderPlayers(this.state);
  }

  nameOf(id) {
    return this.roster.find((p) => p.id === id)?.name ?? 'Someone';
  }

  render(state) {
    const first = !this.state || this.state.round !== state.round || this.state.stage !== state.stage;
    this.state = state;
    const amSetter = state.setterId === this.myId;

    $('hm-round').textContent = `Round ${state.round} of ${state.rounds}`;
    $('hm-solved').textContent = `Solved ${state.solved}`;

    this.clockTotal = STAGE_SECONDS[state.stage] ?? HANGMAN.turnSeconds;
    this.clockEndsAt = performance.now() + state.timeLeft * 1000;

    this.renderGallows(state);
    this.renderPhrase(state);
    this.renderNote(state, amSetter);
    this.renderLast(state);

    $('write-panel').hidden = !(state.stage === 'writing' && amSetter);
    $('vote-panel').hidden = !(state.stage === 'turn' && !amSetter);
    if (first && state.stage === 'writing' && amSetter) {
      $('phrase-input').value = '';
      $('phrase-input').focus();
    }

    if (state.stage === 'turn' && !amSetter) {
      this.renderLetters(state);
      this.renderGuesses(state);
    }
    this.renderPlayers(state);
  }

  renderGallows(state) {
    for (const part of this.parts) {
      part.classList.toggle('shown', Number(part.dataset.part) <= state.misses);
    }
    $('hm-misses').textContent = `${state.misses} of ${state.maxMisses} misses`;
  }

  renderPhrase(state) {
    const board = $('hm-board');
    // Blank board while the setter is still typing.
    if (!state.mask) {
      board.replaceChildren(el('p', { className: 'hm-empty', textContent: 'Waiting for a phrase…' }));
      return;
    }

    // Once the round is over the whole phrase goes up, with the letters nobody
    // guessed marked so you can see what you missed.
    const over = state.stage === 'reveal' || state.stage === 'done';
    const text = over && state.phrase ? state.phrase : state.mask;

    let i = 0;
    const words = text.split(' ').map((word) => {
      const tiles = [...word].map((ch) => {
        const hidden = state.mask[i] === '_';
        i++;
        if (!over && hidden) return el('span', { className: 'tile blank' });
        return el('span', { className: hidden ? 'tile missed' : 'tile', textContent: ch });
      });
      i++; // the space between words
      return el('span', { className: 'word' }, tiles);
    });
    board.replaceChildren(...words);
  }

  renderNote(state, amSetter) {
    const note = $('hm-note');
    const setter = this.nameOf(state.setterId);

    if (state.stage === 'writing') {
      note.textContent = amSetter
        ? 'Type a phrase for everyone else to guess.'
        : `${setter} is thinking of a phrase…`;
    } else if (state.stage === 'turn') {
      note.textContent = amSetter
        ? `Your phrase: ${state.phrase ?? ''} — sit tight while they vote.`
        : `Turn ${state.turn}. Vote for a letter, or back a guess at the whole phrase.`;
    } else if (state.stage === 'reveal') {
      const describe = OUTCOMES[state.outcome] ?? (() => 'Round over.');
      const phrase = state.phrase ? ` The phrase was "${state.phrase}".` : '';
      note.textContent = `${describe(state, setter)}${phrase}`;
    } else {
      note.textContent = '';
    }
    note.className = state.stage === 'reveal' ? `hm-note outcome ${state.outcome}` : 'hm-note';
  }

  renderLast(state) {
    const last = state.last;
    const line = $('hm-last');
    line.className = 'hm-last';
    if (!last || state.stage === 'writing') { line.textContent = ''; return; }

    if (last.kind === 'none') {
      line.textContent = 'Last turn: nobody voted.';
      return;
    }
    const what = last.kind === 'letter' ? `letter ${last.value}` : `"${last.value}"`;
    const votes = `${last.votes} ${last.votes === 1 ? 'vote' : 'votes'}`;
    const tie = last.tied ? ', coin flip' : '';
    line.textContent = `Submitted ${what} — ${votes}${tie} — ${last.correct ? 'hit' : 'miss'}.`;
    line.className = last.correct ? 'hm-last hit' : 'hm-last miss';
  }

  renderLetters(state) {
    const byKey = new Map(state.candidates.filter((c) => c.kind === 'letter').map((c) => [c.key, c]));
    for (const [ch, button] of this.letterButtons) {
      const used = state.used.includes(ch);
      const hit = used && state.mask.includes(ch);
      const candidate = byKey.get(ch);
      const votes = candidate?.votes.length ?? 0;

      button.disabled = used;
      button.classList.toggle('used', used);
      button.classList.toggle('hit', hit);
      button.classList.toggle('miss', used && !hit);
      button.classList.toggle('mine', !!candidate?.votes.includes(this.myId));
      button.querySelector('.count').textContent = votes > 0 ? String(votes) : '';
    }
  }

  renderGuesses(state) {
    const guesses = state.candidates.filter((c) => c.kind === 'phrase');
    const list = $('guesses');
    if (guesses.length === 0) {
      list.replaceChildren(el('li', { className: 'muted', textContent: 'No phrase guesses on the ballot.' }));
      return;
    }
    list.replaceChildren(...guesses.map((g) => {
      const mine = g.votes.includes(this.myId);
      const button = el('button', { type: 'button', className: mine ? 'btn guess mine' : 'btn guess' }, [
        el('span', { className: 'guess-text', textContent: g.text }),
        el('span', { className: 'guess-by', textContent: `${this.nameOf(g.by)} · ${g.votes.length}` }),
      ]);
      button.addEventListener('click', () => this.onVote(g.key));
      return el('li', {}, [button]);
    }));
  }

  renderPlayers(state) {
    const voted = new Set(state.candidates.flatMap((c) => c.votes));
    const eligible = this.roster.filter((p) => p.id !== state.setterId);
    $('hm-votes-count').textContent = state.stage === 'turn'
      ? `(${voted.size}/${eligible.length} voted)`
      : '';

    $('hm-players').replaceChildren(...this.roster.map((p) => {
      const tags = [];
      if (p.id === state.setterId) tags.push('setter');
      else if (state.stage === 'turn') tags.push(voted.has(p.id) ? 'voted' : 'thinking');
      if (p.id === this.myId) tags.unshift('you');
      return el('li', { className: voted.has(p.id) ? 'voted' : '' }, [
        chip(p.color),
        el('span', { textContent: p.name }),
        el('span', { className: 'tag', textContent: tags.join(', ') }),
      ]);
    }));
  }

  // Called every frame: counts the clock down between server pushes.
  tick() {
    if (!this.state || this.state.stage === 'done') return;
    const left = Math.max(0, (this.clockEndsAt - performance.now()) / 1000);
    $('hm-clock').textContent = String(Math.ceil(left));
    $('hm-clock').classList.toggle('low', left <= 5 && this.state.stage === 'turn');
    $('hm-timebar').firstElementChild.style.width = `${Math.min(100, (left / this.clockTotal) * 100)}%`;
  }
}

export function renderResults(results) {
  // Only a full match counts as a sweep — a match cut short doesn't.
  const sweep = !results.cutShort && results.rounds > 0 && results.solved === results.rounds;
  $('results-title').textContent = sweep
    ? 'Clean sweep'
    : `Solved ${results.solved} of ${results.rounds}`;
  $('results-sub').textContent = results.cutShort
    ? 'Match ended early — too few players left.'
    : `${results.solved} ${results.solved === 1 ? 'phrase' : 'phrases'} cracked.`;

  $('results-rounds').replaceChildren(...results.history.map((h) => el('li', { className: h.outcome }, [
    el('span', { className: 'round-no', textContent: `R${h.round}` }),
    el('span', { className: 'round-phrase', textContent: h.phrase || '(no phrase)' }),
    el('span', { className: 'round-by', textContent: `by ${h.setter}` }),
    el('span', { className: 'round-outcome', textContent: outcomeLabel(h.outcome) }),
  ])));

  $('results-list').replaceChildren(...results.players.map((p, i) => el('li', {}, [
    el('span', { className: 'num', textContent: String(i + 1) }),
    chip(p.color),
    el('span', { textContent: p.name }),
    el('span', { className: 'num', textContent: String(p.score) }),
    el('span', {
      className: 'detail',
      textContent: `${p.correctVotes}/${p.votes} winning votes right, ${p.solves} ${p.solves === 1 ? 'solve' : 'solves'}, ${p.phrasesSet} set`,
    }),
  ])));
}

function outcomeLabel(outcome) {
  if (outcome === 'solved') return 'solved';
  if (outcome === 'hanged') return 'hanged';
  if (outcome === 'noPhrase') return 'no phrase';
  if (outcome === 'setterLeft') return 'setter left';
  return 'dropped';
}
