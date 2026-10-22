import { Net } from './net.js';
import { Input } from './input.js';
import { Renderer } from './render.js';
import { Interpolator } from './interp.js';

const $ = (id) => document.getElementById(id);
const screens = { home: $('home'), lobby: $('lobby'), game: $('game') };
const NAME_KEY = 'dodgeball:name';

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
const input = new Input($('canvas'), renderer);
const interp = new Interpolator();

// ---------- helpers ----------

function show(name) {
  for (const [key, el] of Object.entries(screens)) el.hidden = key !== name;
  input.enabled = name === 'game';
  if (name === 'game') renderer.resize();
}

function loadName() {
  try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; }
}
function saveName(name) {
  try { localStorage.setItem(NAME_KEY, name); } catch { /* storage unavailable */ }
}
function currentName() {
  const name = $('name').value.trim();
  saveName(name);
  return name;
}

function codeFromPath() {
  const m = location.pathname.match(/^\/play\/([A-Za-z0-9]{4,8})\/?$/);
  return m ? m[1].toUpperCase() : null;
}

let toastTimer;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function homeError(message) {
  $('home-error').textContent = message;
}

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  for (const c of children) node.append(c);
  return node;
}

function chip(color) {
  const c = el('span', { className: 'chip' });
  c.style.background = color;
  return c;
}

// ---------- home ----------

function setInviteMode(code) {
  $('invite-block').hidden = !code;
  $('host-block').hidden = !!code;
  $('invite-code').textContent = code ?? '';
}

async function loadLeaderboard() {
  try {
    const res = await fetch('/api/leaderboard');
    const data = await res.json();
    if (!data.enabled) return;
    const list = $('leaderboard-list');
    list.replaceChildren();
    if (data.rows.length === 0) {
      list.append(el('li', { className: 'empty', textContent: 'No matches yet. Play one to get on the board.' }));
    }
    data.rows.forEach((r, i) => {
      list.append(el('li', {}, [
        el('span', { textContent: `${i + 1}` }),
        el('span', { textContent: `${r.name}  (${r.wins} ${r.wins === 1 ? 'win' : 'wins'})` }),
        el('span', { className: 'num', textContent: String(r.hits) }),
      ]));
    });
    $('leaderboard').hidden = false;
    $('home-grid').classList.add('with-board');
  } catch {
    // Leaderboard is optional; ignore failures.
  }
}

async function roomExists(code) {
  const res = await fetch(`/api/rooms/${encodeURIComponent(code)}`);
  return res.ok;
}

async function createGame() {
  homeError('');
  try {
    const res = await fetch('/api/rooms', { method: 'POST' });
    if (!res.ok) throw new Error();
    const { code } = await res.json();
    history.pushState({}, '', `/play/${code}`);
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
  if (codeFromPath() !== code) history.pushState({}, '', `/play/${code}`);
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
      homeError(msg.message);
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
  $('lobby-code').textContent = state.code;
  $('invite-url').value = `${location.origin}/play/${state.code}`;
  $('player-count').textContent = `(${state.roster.length}/8)`;
  $('start').hidden = !isHost;
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
  $('results-title').textContent = top && top.score > 0 ? `${top.name} wins` : 'Final score';
  list.replaceChildren(...state.results.map((r) => el('li', {}, [
    el('span', { className: 'num', textContent: String(r.placement) }),
    chip(r.color),
    el('span', { textContent: r.name }),
    el('span', { className: 'num', textContent: String(r.score) }),
    el('span', {
      className: 'detail',
      textContent: `${r.hits} ${r.hits === 1 ? 'hit' : 'hits'}, ${r.catches} ${r.catches === 1 ? 'catch' : 'catches'}, out ${r.outs}×`,
    }),
  ])));
  $('results').hidden = false;
}

function formatClock(seconds) {
  const s = Math.ceil(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

let lastHud = 0;
function updateHud(view) {
  const now = performance.now();
  if (now - lastHud < 100 || !view) return;
  lastHud = now;

  $('clock').textContent = formatClock(view.timeLeft);
  $('clock').classList.toggle('low', view.timeLeft <= 10);

  const scores = new Map(view.players.map((p) => [p.id, p.s]));
  const rows = [...state.roster]
    .map((p) => ({ ...p, score: scores.get(p.id) ?? 0 }))
    .sort((a, b) => b.score - a.score);
  $('scores').replaceChildren(...rows.map((p) => el('li', { className: p.id === state.myId ? 'me' : '' }, [
    chip(p.color),
    el('span', { textContent: p.name }),
    el('span', { className: 'pts', textContent: String(p.score) }),
  ])));
}

let currentView = null;
function frame() {
  if (state.phase === 'playing' || state.phase === 'ended') {
    currentView = interp.sample(state.myId);
    renderer.draw(currentView, {
      myId: state.myId,
      roster: state.roster,
      aim: input.aim(currentView?.self),
      phase: state.phase,
    });
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
  const msg = input.build(currentView?.self);
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
    history.replaceState({}, '', '/');
    homeError(`Game ${code} doesn't exist or has closed. Create a new game to play.`);
  }
  loadLeaderboard();
  $('name').focus();
}

document.fonts?.ready.then(() => { renderer.background = renderer.buildBackground(); });
init();
