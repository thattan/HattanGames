import { Net } from '/js/net.js';
import { $, el, chip, toast } from '/js/dom.js';
import { loadName, saveName } from '/js/player.js';
import { HANGMAN } from '/games/hangman/shared/rules.js';
import { Board, renderResults } from './board.js';

const GAME = 'hangman';
const BASE = `/${GAME}`;
const screens = { home: $('home'), lobby: $('lobby'), game: $('game') };

const state = {
  code: null,
  myId: null,
  hostId: null,
  phase: null,
  roster: [],
  net: null,
};

const board = new Board({
  onVote: (key) => state.net?.send({ type: 'vote', key }),
  onPropose: (text) => state.net?.send({ type: 'propose', text }),
  onPhrase: (text) => state.net?.send({ type: 'phrase', text }),
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
  const m = location.pathname.match(/^\/hangman\/play\/([A-Za-z0-9]{4,8})\/?$/);
  return m ? m[1].toUpperCase() : null;
}

function homeError(message) {
  $('home-error').textContent = message;
}

// ---------- home ----------

function setInviteMode(code) {
  $('invite-block').hidden = !code;
  $('host-block').hidden = !!code;
  $('invite-code').textContent = code ?? '';
}

async function roomExists(code) {
  const res = await fetch(`/api/rooms/${encodeURIComponent(code)}`);
  if (!res.ok) return false;
  // Room codes are shared across games, so this code may belong to another one.
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
  Object.assign(state, { code, myId: null, hostId: null, phase: null, roster: [] });
  state.net = new Net(code, currentName(), { onMessage, onClose });
}

function onMessage(msg) {
  switch (msg.type) {
    case 'welcome':
      state.myId = msg.id;
      board.setRoster(state.roster, state.myId);
      break;
    case 'roster':
      applyRoster(msg);
      break;
    case 'state':
      board.render(msg);
      board.tick();
      break;
    case 'ended':
      renderResults(msg.results);
      $('results').hidden = false;
      break;
    case 'pong':
      break;
    case 'error':
      if (state.phase === 'playing') toast(msg.message);
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
  state.roster = msg.players;
  state.hostId = msg.hostId;
  state.phase = msg.phase;
  board.setRoster(state.roster, state.myId);

  renderLobby();
  if (msg.phase === 'playing') {
    $('results').hidden = true;
    show('game');
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
  const enough = state.roster.length >= HANGMAN.minPlayers;

  $('lobby-code').textContent = state.code;
  $('invite-url').value = `${location.origin}${BASE}/play/${state.code}`;
  $('player-count').textContent = `(${state.roster.length}/${HANGMAN.maxPlayers})`;
  $('host-controls').hidden = !isHost;
  $('start').disabled = !enough;
  $('waiting').hidden = isHost;
  $('need-players').hidden = enough || !isHost;
  $('play-again').hidden = !isHost;

  $('player-list').replaceChildren(...state.roster.map((p) => {
    const tags = [p.id === state.myId && 'you', p.id === state.hostId && 'host'].filter(Boolean).join(', ');
    return el('li', {}, [chip(p.color), el('span', { textContent: p.name }), el('span', { className: 'tag', textContent: tags })]);
  }));
}

async function copyInvite() {
  try {
    await navigator.clipboard.writeText($('invite-url').value);
    toast('Invite link copied');
  } catch {
    $('invite-url').select();
    toast('Press Ctrl+C to copy the invite link');
  }
}

function startGame() {
  state.net?.send({ type: 'start', rounds: Number($('rounds').value) });
}

// ---------- loop ----------

function frame() {
  if (state.phase === 'playing') board.tick();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

setInterval(() => state.net?.send({ type: 'ping', t: performance.now() }), 10_000);

// ---------- wiring ----------

$('create').addEventListener('click', createGame);
$('join-form').addEventListener('submit', (e) => { e.preventDefault(); joinGame($('join-code').value); });
$('join-invited').addEventListener('click', () => joinGame(codeFromPath() ?? state.code ?? ''));
$('copy-link').addEventListener('click', copyInvite);
$('start').addEventListener('click', startGame);
$('play-again').addEventListener('click', startGame);
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
