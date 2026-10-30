// Imported by BOTH the server and the browser. Keep it dependency-free:
// no Node APIs, no DOM. All tic tac toe tuning lives here.

export const TTT = {
  maxPlayers: 2,          // head to head; a third person gets the room-full message
  minPlayers: 2,

  roundOptions: [3, 5],   // host picks in the lobby
  defaultRounds: 3,

  turnSeconds: 20,        // per move
  revealSeconds: 3,       // between rounds, showing the winning line
};

export const SIZE = 3;
export const CELLS = SIZE * SIZE;
export const MARKS = ['X', 'O'];

export const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
  [0, 4, 8], [2, 4, 6],            // diagonals
];

export const emptyBoard = () => Array(CELLS).fill(null);

// The three cells that won it, or null if nobody has yet.
export function winningLine(board) {
  for (const line of LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return line;
  }
  return null;
}

export const isFull = (board) => board.every((cell) => cell !== null);

export function openCells(board) {
  const out = [];
  for (let i = 0; i < board.length; i++) if (board[i] === null) out.push(i);
  return out;
}

export const isPlayable = (board, cell) =>
  Number.isInteger(cell) && cell >= 0 && cell < CELLS && board[cell] === null;
