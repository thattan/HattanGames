// Your display name, remembered across games on this site.
const NAME_KEY = 'gymclass:name';
const LEGACY_KEYS = ['dodgeball:name'];

export function loadName() {
  try {
    const saved = localStorage.getItem(NAME_KEY);
    if (saved) return saved;
    for (const key of LEGACY_KEYS) {
      const old = localStorage.getItem(key);
      if (old) return old;
    }
    return '';
  } catch {
    return '';
  }
}

export function saveName(name) {
  try { localStorage.setItem(NAME_KEY, name); } catch { /* storage unavailable */ }
}
