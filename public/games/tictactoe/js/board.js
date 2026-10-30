import { el } from '/js/dom.js';
import { CELLS, SIZE } from '../shared/rules.js';

// The 3x3 grid. Real buttons, so the board is keyboard and screen-reader navigable
// for free — the squares disable themselves when it isn't your turn.
export class Board {
  constructor(node, onPlay) {
    this.node = node;
    this.cells = Array.from({ length: CELLS }, (_, i) => {
      const cell = el('button', { type: 'button', className: 'cell' });
      cell.setAttribute('aria-label', `Row ${Math.floor(i / SIZE) + 1}, column ${(i % SIZE) + 1}`);
      cell.addEventListener('click', () => onPlay(i));
      return cell;
    });
    node.replaceChildren(...this.cells);
  }

  render(view, myId) {
    const yours = view.stage === 'turn' && view.turnId === myId;
    const line = new Set(view.outcome?.line ?? []);

    view.board.forEach((mark, i) => {
      const cell = this.cells[i];
      cell.textContent = mark ?? '';
      cell.className = [
        'cell',
        mark ? `mark-${mark.toLowerCase()}` : 'empty',
        line.has(i) && 'win',
        !line.size && view.lastMove?.cell === i && 'last',
      ].filter(Boolean).join(' ');
      cell.disabled = !yours || mark !== null;
      cell.setAttribute('aria-disabled', String(cell.disabled));
    });

    this.node.classList.toggle('your-turn', yours);
    this.node.classList.toggle('decided', line.size > 0);
  }
}
