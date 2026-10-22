// Landing page: renders the game picker from /api/games.
// The markup in index.html is the fallback if this never runs or the fetch fails.

const el = (tag, props = {}, children = []) => {
  const node = Object.assign(document.createElement(tag), props);
  for (const c of children) node.append(c);
  return node;
};

function card(game) {
  const live = game.status !== 'soon';
  const body = [
    el('h2', { textContent: game.name }),
    el('p', { className: 'game-tagline', textContent: game.tagline ?? '' }),
    el('p', { className: 'game-blurb', textContent: game.blurb ?? '' }),
    el('span', { className: 'game-meta' }, [
      el('span', { className: 'badge', textContent: game.players ?? '' }),
      el('span', { className: 'play', textContent: live ? 'Play' : 'Coming soon' }),
    ]),
  ];

  const inner = live
    ? el('a', { className: 'panel game-card', href: game.path }, body)
    : el('div', { className: 'panel game-card soon' }, body);
  inner.style.setProperty('--accent', game.accent ?? 'var(--court-red)');
  return el('li', {}, [inner]);
}

async function load() {
  try {
    const res = await fetch('/api/games');
    if (!res.ok) throw new Error('bad response');
    const { games } = await res.json();
    if (!Array.isArray(games) || games.length === 0) return;
    document.getElementById('games').replaceChildren(...games.map(card));
  } catch {
    // Keep the markup that shipped with the page and say why it may be stale.
    document.getElementById('games-error').textContent =
      "Couldn't load the game list. The games below may be out of date.";
  }
}

load();
