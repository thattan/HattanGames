// The catalogue behind the landing page and `GET /api/games`.
//
// To add a game: drop its client under `public/games/<id>/` with an `index.html`,
// add an entry here, and register any extra routes it needs in `index.js`.
// `status: 'soon'` lists a card without a link, so you can announce a game early.
export const GAMES = [
  {
    id: 'dodgeball',
    name: 'Dodgeball',
    tagline: 'Throw, catch, and bank it off the wall.',
    blurb: 'Up to 8 players, two-minute rounds. Hit someone to score; catch their throw to score and knock them out.',
    players: '2-8 players',
    path: '/dodgeball',
    status: 'live',
    accent: '#c7362d',
  },
  {
    id: 'hangman',
    name: 'Hangman',
    tagline: 'Vote a letter. Don’t hang the group.',
    blurb: 'One player sets a phrase, everyone else gets 30 seconds a turn to vote on the next letter — or gamble on solving it outright.',
    players: '2-8 players',
    path: '/hangman',
    status: 'live',
    accent: '#2f8f5b',
  },
];

export function getGame(id) {
  return GAMES.find((g) => g.id === id) ?? null;
}
