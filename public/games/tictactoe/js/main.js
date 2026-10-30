import { Net } from '/js/net.js';
import { $, el, chip, toast } from '/js/dom.js';
import { loadName, saveName } from '/js/player.js';
import { Board } from './board.js';
import { TTT } from '../shared/rules.js';

const screens = { home: $('home'), lobby: $('lobby'), game: $('game') };
const BASE = '/tictactoe';
const GAME = 'tictactoe';

const state = {
  code: null,
  myId: null,
  hostId: null,
  phase: null,
  roster: [],
  net: null,
  view: null,
  results: null,
};

const board = new Board($('board'), (cell) => {
  if (state.phase !== 'playing') return;
  state.net?.send({ type: 'play', cell });
});

// ---------- helpers ----------

function show(name) {
  for (const [key, node] of Object.entries(screens)) node.hidden = key !== name;
}

function currentName() {
  const name = $('name').value.trim();
  saveName(name);
  return name;
}

function codeFromPath() {
  const m = location.pathname.match(/^\/tictactoe\/play\/([A-Za-z0-9]{4,8})\/?$/);
  return m ? m[1].toUpperCase() : null;
}

function homeError(message) {
  $('home-error').textContent = message;
}

const nameOf = (id) => state.roster.find((p) => p.id === id)?.name ?? 'Your opponent';

// ---------- home ----------

function setInviteMode(code) {
  $('invite-block').hidden = !code;
  $('host-block').hidden = !!code;
  $('invite-code').textContent = code ?? '';
}

async function roomExists(code) {
  const res = await fetch(`/api/rooms/${encodeURIComponent(code)}`);
  if (!res.ok) return false;
  // Codes are shared across games, so this one might belong to another game.
  const info = await res.json().catch(() => null);
  if (info?.game && info.game !== GAME) {
    location.href = `/${info.game}/play/${code}`;
    return false;
  }
  return true;
}

async function createGame() {
  homeError('');
  try {
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ game: GAME }),
    });
    if (!res.ok) throw new Error();
    const { code } = await res.json();
    history.pushState({}, '', `${BASE}/play/${code}`);
    connect(code);
  } catch {
    homeError('Could not create a game. Check that the server is running, then try again.');
  }
}

async function joinGame(code) {
  homeError('');
  code = code.trim().toUpperCase();
  if (!code) { homeError('Enter a game code to join.'); return; }
  if (!(await roomExists(code))) {
    homeError(`Game ${code} doesn't exist or has closed. Check the code, or create a new game.`);
    return;
  }
  if (codeFromPath() !== code) history.pushState({}, '', `${BASE}/play/${code}`);
  connect(code);
}

// ---------- connection ----------

function connect(code) {
  state.net?.close();
  Object.assign(state, { code, myId: null, hostId: null, phase: null, roster: [], view: null, results: null });
  state.net = new Net(code, currentName(), { onMessage, onClose });
}

function onMessage(msg) {
  switch (msg.type) {
    case 'welcome':
      state.myId = msg.id;
      break;
    case 'roster':
      applyRoster(msg);
      break;
    case 'state':
      state.view = msg;
      renderGame();
      break;
    case 'ended':
      state.results = msg.results;
      showResults();
      break;
    case 'error':
      // Once we're past the home screen its error line is hidden, so those
      // messages have to surface as a toast instead.
      if (state.phase) toast(msg.message);
      else homeError(msg.message);
      break;
  }
}

function onClose(event, closedByUs) {
  if (closedByUs) return;
  state.net = null;
  state.phase = null;
  show('home');
  setInviteMode(state.code);
  if (!$('home-error').textContent) {
    homeError('Lost connection to the game. Select Join game to reconnect.');
  }
}

function applyRoster(msg) {
  const prevPhase = state.phase;
  state.roster = msg.players;
  state.hostId = msg.hostId;
  state.phase = msg.phase;

  renderLobby();

  if (msg.phase === 'playing') {
    if (prevPhase !== 'playing') {
      state.results = null;
      $('results').hidden = true;
    }
    show('game');
    renderGame();
  } else if (msg.phase === 'ended') {
    show('game');
  } else {
    $('results').hidden = true;
    show('lobby');
  }
}

// ---------- lobby ----------

function renderLobby() {
  const isHost = state.myId === state.hostId;
  const ready = state.roster.length >= TTT.minPlayers;

  $('lobby-code').textContent = state.code;
  $('invite-url').value = `${location.origin}${BASE}/play/${state.code}`;
  $('player-count').textContent = `(${state.roster.length}/${TTT.maxPlayers})`;
  $('rounds-row').hidden = !isHost;
  $('start').hidden = !isHost;
  $('start').disabled = !ready;
  $('waiting').hidden = isHost;
  $('play-again').hidden = !isHost;
  $('need-two').hidden = ready;

  const list = $('player-list');
  list.replaceChildren(...state.roster.map((p) => {
    const tags = [p.id === state.myId && 'you', p.id === state.hostId && 'host'].filter(Boolean).join(', ');
    return el('li', {}, [chip(p.color), el('span', { textContent: p.name }), el('span', { className: 'tag', textContent: tags })]);
  }));
}

async function copyInvite() {
  const url = $('invite-url').value;
  try {
    await navigator.clipboard.writeText(url);
    toast('Invite link copied');
  } catch {
    $('invite-url').select();
    toast('Press Ctrl+C to copy the invite link');
  }
}

// ---------- game ----------

function statusText(view) {
  if (view.stage === 'reveal') {
    const late = view.lastMove?.auto ? ' on the clock' : '';
    if (view.outcome?.draw) return 'Draw — nobody takes the round.';
    if (view.outcome?.winnerId === state.myId) return `You take the round${late}.`;
    return `${nameOf(view.outcome?.winnerId)} takes the round${late}.`;
  }
  if (view.stage === 'turn') {
    return view.turnId === state.myId ? 'Your move.' : `${nameOf(view.turnId)} is thinking…`;
  }
  return '';
}

function renderGame() {
  const view = state.view;
  if (!view) return;

  board.render(view, state.myId);

  $('round').textContent = `Round ${view.round} of ${view.rounds}`;
  const clock = $('clock');
  clock.textContent = String(Math.ceil(view.timeLeft));
  clock.classList.toggle('low', view.stage === 'turn' && view.timeLeft <= 5);
  clock.classList.toggle('idle', view.stage !== 'turn');

  const status = $('status');
  status.textContent = statusText(view);
  status.classList.toggle('yours', view.stage === 'turn' && view.turnId === state.myId);

  const wins = new Map(view.scores.map((s) => [s.id, s]));
  $('scores').replaceChildren(...state.roster.map((p) => {
    const mark = view.marks.X === p.id ? 'X' : view.marks.O === p.id ? 'O' : '';
    return el('li', { className: [p.id === state.myId && 'me', view.turnId === p.id && 'turn'].filter(Boolean).join(' ') }, [
      chip(p.color),
      el('span', { className: `seat mark-${mark.toLowerCase()}`, textContent: mark }),
      el('span', { textContent: p.name }),
      el('span', { className: 'pts', textContent: String(wins.get(p.id)?.wins ?? 0) }),
    ]);
  }));

  const draws = view.scores[0]?.draws ?? 0;
  $('draws').textContent = draws ? `${draws} ${draws === 1 ? 'draw' : 'draws'}` : '';
}

function showResults() {
  const list = $('results-list');
  const winner = state.results.find((r) => r.won);
  $('results-title').textContent = winner
    ? (winner.id === state.myId ? 'You win the match' : `${winner.name} wins the match`)
    : 'All square';

  list.replaceChildren(...state.results.map((r) => el('li', {}, [
    el('span', { className: 'num', textContent: String(r.placement) }),
    chip(r.color),
    el('span', { textContent: r.name }),
    el('span', { className: 'num', textContent: String(r.wins) }),
    el('span', {
      className: 'detail',
      textContent: [
        `${r.wins} ${r.wins === 1 ? 'round' : 'rounds'}`,
        r.draws ? `${r.draws} drawn` : null,
        r.timeouts ? `${r.timeouts} on the clock` : null,
      ].filter(Boolean).join(', '),
    }),
  ])));
  $('results').hidden = false;
}

// ---------- wiring ----------

$('create').addEventListener('click', createGame);
$('join-form').addEventListener('submit', (e) => { e.preventDefault(); joinGame($('join-code').value); });
$('join-invited').addEventListener('click', () => joinGame(codeFromPath() ?? state.code ?? ''));
$('copy-link').addEventListener('click', copyInvite);
$('start').addEventListener('click', () => state.net?.send({ type: 'start', rounds: Number($('rounds').value) }));
$('play-again').addEventListener('click', () => state.net?.send({ type: 'start', rounds: Number($('rounds').value) }));
$('name').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (!$('invite-block').hidden) $('join-invited').click();
  else createGame();
});

window.addEventListener('popstate', () => {
  state.net?.close();
  state.net = null;
  state.phase = null;
  init();
});

async function init() {
  show('home');
  homeError('');
  $('name').value = loadName();
  const code = codeFromPath();
  setInviteMode(code);
  if (code && !(await roomExists(code).catch(() => false))) {
    setInviteMode(null);
    history.replaceState({}, '', BASE);
    homeError(`Game ${code} doesn't exist or has closed. Create a new game to play.`);
  }
  $('name').focus();
}

init();
