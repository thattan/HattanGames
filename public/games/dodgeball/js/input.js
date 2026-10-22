import { PLAYER } from '../shared/physics.js';

const KEYS = {
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  down: ['KeyS', 'ArrowDown'],
  jump: ['KeyW', 'ArrowUp', 'Space'],
  throw: ['KeyJ'],
  catch: ['KeyK'],
};
const GAME_KEYS = new Set(Object.values(KEYS).flat());

export class Input {
  constructor(canvas, renderer) {
    this.held = new Set();
    // Presses are sent as ever-increasing counters, so taps shorter than a server tick still register.
    this.seq = { jump: 0, throw: 0, catch: 0 };
    this.mouse = null;
    this.enabled = false;

    window.addEventListener('keydown', (e) => {
      if (!this.enabled || !GAME_KEYS.has(e.code)) return;
      e.preventDefault();
      if (!e.repeat) {
        if (KEYS.jump.includes(e.code)) this.seq.jump++;
        if (KEYS.throw.includes(e.code)) this.seq.throw++;
        if (KEYS.catch.includes(e.code)) this.seq.catch++;
      }
      this.held.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());

    canvas.addEventListener('pointermove', (e) => {
      this.mouse = renderer.toWorld(e.clientX, e.clientY);
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      this.mouse = renderer.toWorld(e.clientX, e.clientY);
      if (e.button === 0) this.seq.throw++;
      if (e.button === 2) this.seq.catch++;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  is(action) {
    return KEYS[action].some((k) => this.held.has(k));
  }

  // Aim angle from your player toward the mouse, or straight ahead if there's no mouse yet.
  aim(self) {
    if (!self) return 0;
    if (!this.mouse) return self.f > 0 ? -0.15 : Math.PI + 0.15;
    const cx = self.x + PLAYER.w / 2;
    const cy = self.y + PLAYER.h / 2;
    return Math.atan2(this.mouse.y - cy, this.mouse.x - cx);
  }

  build(self) {
    return {
      type: 'input',
      left: this.is('left'),
      right: this.is('right'),
      down: this.is('down'),
      jump: this.is('jump'),
      aim: Math.round(this.aim(self) * 100) / 100,
      js: this.seq.jump,
      ts: this.seq.throw,
      cs: this.seq.catch,
    };
  }
}
