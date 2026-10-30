import { Net } from '/js/net.js';
import { $, el, chip, toast } from '/js/dom.js';
import { loadName, saveName } from '/js/player.js';
import { Input } from './input.js';
import { Renderer } from './render.js';
import { Interpolator } from './interp.js';
import { RULES } from '../shared/physics.js';

const screens = { home: $('home'), lobby: $('lobby'), game: $('game') };
const BASE = '/sharks';
const GAME = 'sharks';

const state = {
  code: null,
  myId: null,
  hostId: null,
  phase: null,
  roster: [],
  net: null,
  results: null,
};

const renderer = new Renderer($('canvas'));
const input = new Input($('canvas'));
const interp = new Interpolator();

// ---------- helpers ----------

function show(name) {
  for (const [key, node] of Object.entries(screens)) node.hidden = key !== name;
  input.enabled = name === 'game';
  if (name === 'game') renderer.resize();
}

function currentName() {
  const name = $('name').value.trim();
  saveName(name);
  return name;
}

function codeFromPath() {
  const m = location.pathname.match(/^\/sharks\/play\/([A-Za-z0-9]{4,8})\/?$/);
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
  interp.reset();
  Object.assign(state, { code, myId: null, hostId: null, phase: null, roster: [], results: null });
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
      interp.push(msg);
      break;
    case 'ended':
      state.results = msg.results;
      showResults();
      break;
    case 'pong':
      $('ping').textContent = `${Math.round(performance.now() - msg.t)} ms`;
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
      interp.reset();
      $('results').hidden = true;
    }
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
  const ready = state.roster.length >= RULES.minPlayers;
  $('lobby-code').textContent = state.code;
  $('invite-url').value = `${location.origin}${BASE}/play/${state.code}`;
  $('player-count').textContent = `(${state.roster.length}/${RULES.maxPlayers})`;
  $('start').hidden = !isHost;
  $('start').disabled = !ready;
  $('need-more').hidden = ready;
  $('waiting').hidden = isHost;
  $('play-again').hidden = !isHost;

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

function showResults() {
  const list = $('results-list');
  const top = state.results[0];
  $('results-title').textContent = top?.won ? `${top.name} survived` : 'Final score';
  list.replaceChildren(...state.results.map((r) => el('li', {}, [
    el('span', { className: 'num', textContent: String(r.placement) }),
    chip(r.color),
    el('span', { textContent: r.name }),
    el('span', { className: 'num', textContent: String(r.score) }),
    el('span', {
      className: 'detail',
      textContent: [
        `${r.crossings} ${r.crossings === 1 ? 'crossing' : 'crossings'}`,
        `${r.tags} ${r.tags === 1 ? 'tag' : 'tags'}`,
        r.won && 'last minnow',
      ].filter(Boolean).join(', '),
    }),
  ])));
  $('results').hidden = false;
}

const STAGE_TEXT = {
  countdown: () => 'Line up',
  running: (view, me) => (me?.r ? 'Catch them' : me?.st ? 'Safe' : 'Run'),
  tally: () => 'Whistle',
  done: () => 'Over',
};

let lastHud = 0;
function updateHud(view) {
  const now = performance.now();
  if (now - lastHud < 100 || !view) return;
  lastHud = now;

  const me = view.self;
  $('clock').textContent = String(Math.ceil(view.stageLeft));
  $('clock').classList.toggle('low', view.stage === 'running' && view.stageLeft <= 5);

  $('stage-label').textContent = STAGE_TEXT[view.stage]?.(view, me) ?? '';
  $('crossing').textContent = `Crossing ${view.crossing}`;
  $('tally-counts').textContent = `${view.minnows} minnow${view.minnows === 1 ? '' : 's'} · ${view.sharks} shark${view.sharks === 1 ? '' : 's'}`;

  const role = $('role');
  const isShark = me?.r === 1;
  role.textContent = me ? (isShark ? 'Shark' : 'Minnow') : '';
  role.classList.toggle('shark', !!isShark);
  role.classList.toggle('minnow', !!me && !isShark);

  $('dash').classList.toggle('ready', me?.d === 1);

  const scores = new Map(view.players.map((p) => [p.id, p]));
  const rows = [...state.roster]
    .map((p) => ({ ...p, snap: scores.get(p.id) }))
    .sort((a, b) => (b.snap?.s ?? 0) - (a.snap?.s ?? 0));
  $('scores').replaceChildren(...rows.map((p) => el('li', {
    className: [p.id === state.myId && 'me', p.snap?.r === 1 && 'is-shark'].filter(Boolean).join(' '),
  }, [
    chip(p.color),
    el('span', { textContent: p.name }),
    el('span', { className: 'pts', textContent: String(p.snap?.s ?? 0) }),
  ])));
}

let currentView = null;
function frame() {
  if (state.phase === 'playing' || state.phase === 'ended') {
    currentView = interp.sample(state.myId);
    renderer.draw(currentView, { myId: state.myId, roster: state.roster, phase: state.phase });
    updateHud(currentView);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Send input at 60 Hz when it changes, plus a keepalive every 250 ms.
let lastSent = '';
let lastSentAt = 0;
setInterval(() => {
  if (state.phase !== 'playing' || !state.net) return;
  const msg = input.build();
  const key = JSON.stringify(msg);
  const now = performance.now();
  if (key !== lastSent || now - lastSentAt > 250) {
    state.net.send(msg);
    lastSent = key;
    lastSentAt = now;
  }
}, 1000 / 60);

setInterval(() => state.net?.send({ type: 'ping', t: performance.now() }), 2000);

// ---------- wiring ----------

$('create').addEventListener('click', createGame);
$('join-form').addEventListener('submit', (e) => { e.preventDefault(); joinGame($('join-code').value); });
$('join-invited').addEventListener('click', () => joinGame(codeFromPath() ?? state.code ?? ''));
$('copy-link').addEventListener('click', copyInvite);
$('start').addEventListener('click', () => state.net?.send({ type: 'start' }));
$('play-again').addEventListener('click', () => state.net?.send({ type: 'start' }));
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

document.fonts?.ready.then(() => { renderer.background = renderer.buildBackground(); });
init();
