// Imported by BOTH the server and the browser. Keep it dependency-free:
// no Node APIs, no DOM. All hangman tuning lives here.

export const HANGMAN = {
  maxPlayers: 8,
  minPlayers: 2,          // a setter plus at least one guesser

  maxMisses: 6,           // head, body, two arms, two legs
  roundOptions: [3, 5],   // host picks in the lobby
  defaultRounds: 3,

  writeSeconds: 60,       // setter has this long to type a phrase
  turnSeconds: 30,        // voting window per turn
  revealSeconds: 6,       // between rounds

  minPhrase: 3,
  maxPhrase: 48,
  maxGuesses: 6,          // phrase candidates on the ballot at once
  emptyTurnLimit: 3,      // consecutive turns with no votes before the round is abandoned
};

export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const GUESSABLE = /[A-Z]/;
const DISALLOWED = /[^A-Z0-9 '-]/g;
const RUNS_OF_SPACES = / +/g;

// Uppercase, drop anything we can't display on the board, collapse whitespace.
// Disallowed characters become spaces so "stop—go" reads as two words, not one.
export function normalizePhrase(raw) {
  return String(raw ?? '')
    .toUpperCase()
    .replace(DISALLOWED, ' ')
    .replace(RUNS_OF_SPACES, ' ')
    .trim();
}

export function validatePhrase(raw) {
  const value = normalizePhrase(raw);
  if (value.length < HANGMAN.minPhrase) {
    return { ok: false, error: `Phrases need at least ${HANGMAN.minPhrase} characters.` };
  }
  if (value.length > HANGMAN.maxPhrase) {
    return { ok: false, error: `Phrases can be at most ${HANGMAN.maxPhrase} characters.` };
  }
  if (!GUESSABLE.test(value)) {
    return { ok: false, error: 'Phrases need at least one letter to guess.' };
  }
  return { ok: true, value };
}

export const isGuessable = (ch) => GUESSABLE.test(ch);

// Digits and punctuation are shown from the start; only letters are hidden.
export function maskPhrase(phrase, revealed) {
  let out = '';
  for (const ch of phrase) out += isGuessable(ch) && !revealed.has(ch) ? '_' : ch;
  return out;
}

export function isSolved(phrase, revealed) {
  for (const ch of phrase) if (isGuessable(ch) && !revealed.has(ch)) return false;
  return true;
}
