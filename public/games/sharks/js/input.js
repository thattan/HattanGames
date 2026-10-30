const KEYS = {
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  down: ['KeyS', 'ArrowDown'],
  jump: ['KeyW', 'ArrowUp', 'Space'],
  dash: ['KeyJ', 'ShiftLeft', 'ShiftRight'],
};
const GAME_KEYS = new Set(Object.values(KEYS).flat());

export class Input {
  constructor(canvas) {
    this.held = new Set();
    // Presses are sent as ever-increasing counters, so taps shorter than a server tick still register.
    this.seq = { jump: 0, dash: 0 };
    this.enabled = false;

    window.addEventListener('keydown', (e) => {
      if (!this.enabled || !GAME_KEYS.has(e.code)) return;
      e.preventDefault();
      if (!e.repeat) {
        if (KEYS.jump.includes(e.code)) this.seq.jump++;
        if (KEYS.dash.includes(e.code)) this.seq.dash++;
      }
      this.held.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());

    canvas.addEventListener('pointerdown', (e) => {
      if (!this.enabled || e.button !== 0) return;
      this.seq.dash++;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  is(action) {
    return KEYS[action].some((k) => this.held.has(k));
  }

  build() {
    return {
      type: 'input',
      left: this.is('left'),
      right: this.is('right'),
      down: this.is('down'),
      jump: this.is('jump'),
      js: this.seq.jump,
      ds: this.seq.dash,
    };
  }
}
