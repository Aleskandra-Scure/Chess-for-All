// Every lesson of the Learn tab: the position, the little animation and the challenges.
// The words (title, explanation, tasks and hints) are in i18n.js under STRINGS.<lang>.lessons.<id>;
// the challenges there are in the same order as here.
//
// Positions are FEN. They may leave out the kings (a rook alone collecting stars): chess.js still
// checks every move, but not whether the position could happen in a real game.
//
// demo: steps played one after another; each waits `wait` ms afterwards (default 900 after a move,
// 1200 otherwise).
//   { fen }                         a new position (shapes and marks are cleared)
//   { move: 'e2e4' }                plays a move ('e7e8q' promotes); the same side may move again
//   { arrows: ['d4d8', 'e8e1:red'] } arrows, green unless a colour is given (green, red, blue, yellow)
//   { circles: ['e4', 'd5:red'] }   circles on squares
//   { labels: { e4: 'e4' } }        a word or number on a square
//   { marks: ['a1', 'a2'] }         yellow squares
//   { clear: true }                 removes arrows, circles, labels and marks
// Arrows, circles and labels given in one step replace the ones shown before.
//
// challenges: 2–3 per lesson. The player always has the side to move (after the `pre` moves).
//   fen        the position
//   pre        moves played by the opponent first, e.g. a pawn moving two squares before en passant
//   only       'r', 'n', …: only this piece may move
//   solution   one right answer; shown as an arrow after two wrong tries, and used by the tests
//   goal       what the child has to do:
//     'tap'        tap one of `squares`
//     'stars'      land on every square in `stars`, in any order and with any number of moves
//     'captureAll' capture every enemy piece (the opponent does not move)
//     'capture'    capture with this move; `target` square and/or `piece` ('q', 'r', …) if given
//     'mate'       give checkmate
//     'escape'     get out of check; `way`: 'king', 'block' or 'capture'
//     'castle'     castle; `side`: 'k' or 'q' if given
//     'promote'    promote a pawn (pawn moves before it are fine); `piece` if given
//     'enPassant'  capture en passant
//     'draw'       a move that makes the game a draw
//     'move'       move a `piece` to one of the squares in `to`
//     'safe'       move the `piece` to a square no enemy piece attacks
//     'defend'     protect the piece on `square` (it stays where it is)
// A legal move that does not do what the goal asks is taken back, like an illegal one, except
// with 'stars', 'captureAll' and 'promote', where moves on the way are fine.

export const GROUPS = ['basics', 'rules', 'tips'];

export const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const EMPTY = '8/8/8/8/8/8/8/8 w - - 0 1';

// The board lesson: one file or rank lights up with its name.
const file = (f) => ({ marks: [1, 2, 3, 4, 5, 6, 7, 8].map((r) => f + r), labels: { [`${f}1`]: f }, wait: 450 });
const rank = (r) => ({ marks: [...'abcdefgh'].map((f) => f + r), labels: { [`a${r}`]: String(r) }, wait: 450 });

export const LESSONS = [
  // ---------- Basics ----------
  {
    id: 'board',
    group: 'basics',
    icon: '🏁',
    demo: [
      { fen: EMPTY, wait: 600 },
      ...[...'abcdefgh'].map(file),
      ...[1, 2, 3, 4, 5, 6, 7, 8].map(rank),
      { marks: ['e4'], labels: { e4: 'e4' }, wait: 1500 },
      { fen: START, wait: 1500 },
    ],
    challenges: [
      { fen: EMPTY, goal: 'tap', squares: ['e4'], solution: ['e4'] },
      { fen: EMPTY, goal: 'tap', squares: ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8'], solution: ['f4'] },
      { fen: START, goal: 'tap', squares: ['d1'], solution: ['d1'] },
    ],
  },
  {
    id: 'pawn',
    group: 'basics',
    icon: 'pawn',
    demo: [
      { fen: '8/8/8/8/8/8/4P3/8 w - - 0 1', wait: 500 },
      { arrows: ['e2e3', 'e2e4'], wait: 1500 },
      { clear: true, move: 'e2e4' },
      { move: 'e4e5' },
      { fen: '8/8/3p4/4P3/8/8/8/8 w - - 0 1', wait: 500 },
      { arrows: ['e5d6:red'], wait: 1300 },
      { clear: true, move: 'e5d6' },
    ],
    challenges: [
      { fen: '8/8/8/8/8/8/4P3/8 w - - 0 1', goal: 'stars', stars: ['e4', 'e6'], solution: ['e2e4', 'e4e5', 'e5e6'] },
      { fen: '8/8/8/3pp3/3P4/8/8/8 w - - 0 1', goal: 'capture', solution: ['d4e5'] },
      { fen: '8/8/8/1pp5/1P6/8/8/8 w - - 0 1', goal: 'stars', stars: ['c6'], solution: ['b4c5', 'c5c6'] },
    ],
  },
  {
    id: 'rook',
    group: 'basics',
    icon: 'rook',
    demo: [
      { fen: '8/8/8/8/3R4/8/8/8 w - - 0 1', wait: 500 },
      { arrows: ['d4d8', 'd4d1', 'd4a4', 'd4h4'], wait: 1800 },
      { clear: true, move: 'd4d7' },
      { move: 'd7h7' },
    ],
    challenges: [
      { fen: '8/8/8/8/8/8/8/R7 w - - 0 1', goal: 'stars', stars: ['a6', 'f6', 'f2'], solution: ['a1a6', 'a6f6', 'f6f2'] },
      { fen: '8/8/8/2p4p/8/8/2p5/7R w - - 0 1', goal: 'captureAll', solution: ['h1h5', 'h5c5', 'c5c2'] },
      { fen: '8/8/8/8/P7/8/8/R7 w - - 0 1', goal: 'stars', stars: ['a8'], only: 'r', solution: ['a1b1', 'b1b8', 'b8a8'] },
    ],
  },
  {
    id: 'bishop',
    group: 'basics',
    icon: 'bishop',
    demo: [
      { fen: '8/8/8/8/3B4/8/8/8 w - - 0 1', wait: 500 },
      { arrows: ['d4h8', 'd4a1', 'd4a7', 'd4g1'], wait: 1800 },
      { clear: true, move: 'd4g7' },
      { move: 'g7c3' },
    ],
    challenges: [
      { fen: '8/8/8/8/8/8/8/2B5 w - - 0 1', goal: 'stars', stars: ['e3', 'h6', 'f8'], solution: ['c1e3', 'e3h6', 'h6f8'] },
      { fen: '4n3/8/8/1p6/8/3p4/8/5B2 w - - 0 1', goal: 'captureAll', solution: ['f1d3', 'd3b5', 'b5e8'] },
      { fen: '8/8/8/8/8/8/8/2B2B2 w - - 0 1', goal: 'stars', stars: ['g5', 'b5', 'a6'], solution: ['c1g5', 'f1b5', 'b5a6'] },
    ],
  },
  {
    id: 'queen',
    group: 'basics',
    icon: 'queen',
    demo: [
      { fen: '8/8/8/8/3Q4/8/8/8 w - - 0 1', wait: 500 },
      { arrows: ['d4d8', 'd4d1', 'd4a4', 'd4h4', 'd4h8', 'd4a1', 'd4a7', 'd4g1'], wait: 2000 },
      { clear: true, move: 'd4h8' },
      { move: 'h8a8' },
    ],
    challenges: [
      { fen: '8/8/8/8/8/8/8/3Q4 w - - 0 1', goal: 'stars', stars: ['d5', 'a8', 'h8'], solution: ['d1d5', 'd5a8', 'a8h8'] },
      { fen: '8/2p3n1/8/8/8/2p5/8/Q7 w - - 0 1', goal: 'captureAll', solution: ['a1c3', 'c3c7', 'c7g7'] },
    ],
  },
  {
    id: 'knight',
    group: 'basics',
    icon: 'knight',
    demo: [
      { fen: '8/8/8/8/3N4/8/8/8 w - - 0 1', wait: 500 },
      { circles: ['b3', 'b5', 'c2', 'c6', 'e2', 'e6', 'f3', 'f5'], wait: 1800 },
      { clear: true, move: 'd4e6' },
      { fen: '8/8/8/8/8/8/PPP5/1N6 w - - 0 1', wait: 500 },
      { arrows: ['b1c3'], wait: 1200 },
      { clear: true, move: 'b1c3' },
    ],
    challenges: [
      { fen: '8/8/8/8/8/8/8/1N6 w - - 0 1', goal: 'stars', stars: ['c3', 'e4', 'f6'], solution: ['b1c3', 'c3e4', 'e4f6'] },
      { fen: '8/8/8/8/8/5p2/4PPPP/6N1 w - - 0 1', goal: 'capture', only: 'n', solution: ['g1f3'] },
      { fen: '8/8/8/8/8/8/8/6N1 w - - 0 1', goal: 'stars', stars: ['g3'], solution: ['g1e2', 'e2g3'] },
    ],
  },
  {
    id: 'king',
    group: 'basics',
    icon: 'king',
    demo: [
      { fen: '8/8/8/8/4K3/8/8/8 w - - 0 1', wait: 500 },
      { circles: ['d3', 'd4', 'd5', 'e3', 'e5', 'f3', 'f4', 'f5'], wait: 1800 },
      { clear: true, move: 'e4e5' },
      { move: 'e5f6' },
    ],
    challenges: [
      { fen: '8/8/8/8/8/8/8/4K3 w - - 0 1', goal: 'stars', stars: ['d2', 'e3', 'f3'], solution: ['e1d2', 'd2e3', 'e3f3'] },
      { fen: '8/8/8/8/6p1/4p3/8/4K3 w - - 0 1', goal: 'captureAll', solution: ['e1e2', 'e2e3', 'e3f4', 'f4g4'] },
    ],
  },
  {
    id: 'capturing',
    group: 'basics',
    icon: '⚔️',
    demo: [
      { fen: '8/8/n7/8/8/8/8/R7 w - - 0 1', wait: 500 },
      { arrows: ['a1a6:red'], wait: 1300 },
      { clear: true, move: 'a1a6' },
      { fen: '8/8/8/3p4/4P3/8/8/8 w - - 0 1', wait: 500 },
      { arrows: ['e4d5:red'], wait: 1300 },
      { clear: true, move: 'e4d5' },
    ],
    challenges: [
      { fen: '8/8/8/8/5n2/8/8/2B4R w - - 0 1', goal: 'capture', target: 'f4', solution: ['c1f4'] },
      { fen: '8/4q3/8/3N4/8/8/8/R7 w - - 0 1', goal: 'capture', target: 'e7', solution: ['d5e7'] },
      { fen: '8/8/8/4r3/8/3NP3/8/4R3 w - - 0 1', goal: 'capture', target: 'e5', solution: ['d3e5'] },
    ],
  },

  // ---------- Rules ----------
  {
    id: 'check',
    group: 'rules',
    icon: '⚠️',
    demo: [
      { fen: 'R3r3/7k/8/8/8/8/8/4KB2 w - - 0 1', wait: 500 },
      { arrows: ['e8e1:red'], wait: 1500 },
      { arrows: ['e8e1:red', 'e1d2'], wait: 1500 },
      { arrows: ['e8e1:red', 'f1e2'], wait: 1500 },
      { arrows: ['e8e1:red', 'a8e8'], wait: 1500 },
      { clear: true, move: 'a8e8' },
    ],
    challenges: [
      { fen: '4r2k/8/8/8/8/8/8/4K3 w - - 0 1', goal: 'escape', way: 'king', solution: ['e1d1'] },
      { fen: '4k3/8/8/8/8/4B3/6PP/r6K w - - 0 1', goal: 'escape', way: 'block', solution: ['e3g1'] },
      { fen: 'k7/4R3/8/8/8/8/5PPP/4r1K1 w - - 0 1', goal: 'escape', way: 'capture', solution: ['e7e1'] },
    ],
  },
  {
    id: 'checkmate',
    group: 'rules',
    icon: '👑',
    demo: [
      { fen: '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', wait: 500 },
      { arrows: ['a1a8'], wait: 1200 },
      { clear: true, move: 'a1a8' },
      { circles: ['f8:red', 'h8:red', 'f7:red', 'g7:red', 'h7:red'], wait: 2000 },
    ],
    challenges: [
      { fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', goal: 'mate', solution: ['d1d8'] },
      { fen: '7k/8/6K1/8/8/8/8/Q7 w - - 0 1', goal: 'mate', solution: ['a1a8'] },
      { fen: '6k1/R7/8/8/8/8/8/1R4K1 w - - 0 1', goal: 'mate', solution: ['b1b8'] },
    ],
  },
  {
    id: 'castling',
    group: 'rules',
    icon: 'rook',
    demo: [
      { fen: 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1', wait: 500 },
      { arrows: ['e1g1', 'h1f1:blue'], wait: 1500 },
      { clear: true, move: 'e1g1', wait: 1500 },
      { fen: 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1', wait: 500 },
      { arrows: ['e1c1', 'a1d1:blue'], wait: 1500 },
      { clear: true, move: 'e1c1' },
    ],
    challenges: [
      { fen: '4k3/pppppppp/8/8/8/8/PPPPPPPP/RNBQK2R w KQ - 0 1', goal: 'castle', side: 'k', solution: ['e1g1'] },
      { fen: '4k3/pppppppp/8/8/8/8/PPPPPPPP/R3KBNR w KQ - 0 1', goal: 'castle', side: 'q', solution: ['e1c1'] },
      { fen: '4k3/8/b7/8/8/8/PPP2PPP/R3K2R w KQ - 0 1', goal: 'castle', solution: ['e1c1'] },
    ],
  },
  {
    id: 'promotion',
    group: 'rules',
    icon: 'queen',
    demo: [
      { fen: '8/4P3/8/8/8/8/8/8 w - - 0 1', wait: 500 },
      { arrows: ['e7e8'], wait: 1200 },
      { clear: true, move: 'e7e8q', wait: 1500 },
    ],
    challenges: [
      { fen: '8/8/8/4P3/8/8/8/8 w - - 0 1', goal: 'promote', piece: 'q', solution: ['e5e6', 'e6e7', 'e7e8q'] },
      { fen: 'rnr5/1P6/8/8/8/8/8/8 w - - 0 1', goal: 'promote', solution: ['b7a8q'] },
    ],
  },
  {
    id: 'enPassant',
    group: 'rules',
    icon: 'pawn',
    demo: [
      { fen: '8/3p4/8/4P3/8/8/8/8 b - - 0 1', wait: 600 },
      { move: 'd7d5', wait: 1000 },
      { arrows: ['e5d6:red'], circles: ['d5:red'], wait: 1800 },
      { clear: true, move: 'e5d6', wait: 1200 },
    ],
    challenges: [
      { fen: '8/3p4/8/4P3/8/8/8/8 b - - 0 1', pre: ['d7d5'], goal: 'enPassant', solution: ['e5d6'] },
      { fen: '8/5p2/8/1P2P3/8/8/8/8 b - - 0 1', pre: ['f7f5'], goal: 'enPassant', solution: ['e5f6'] },
    ],
  },
  {
    id: 'stalemate',
    group: 'rules',
    icon: '🤝',
    demo: [
      { fen: '7k/8/8/6Q1/8/8/8/K7 w - - 0 1', wait: 500 },
      { move: 'g5g6', wait: 600 },
      { circles: ['g8:red', 'g7:red', 'h7:red'], wait: 2200 },
      { fen: '8/8/3k4/8/8/4K3/8/8 w - - 0 1', wait: 500 },
      { circles: ['d6:yellow', 'e3:yellow'], wait: 1800 },
    ],
    challenges: [
      { fen: '7k/8/5K2/8/8/8/8/6Q1 w - - 0 1', goal: 'mate', solution: ['g1g7'] },
      { fen: '8/8/4k3/8/4p3/4K3/8/8 w - - 0 1', goal: 'draw', solution: ['e3e4'] },
    ],
  },

  // ---------- First tips ----------
  {
    id: 'values',
    group: 'tips',
    icon: '⚖️',
    demo: [
      { fen: '8/8/8/8/PNBRQ3/8/8/8 w - - 0 1', wait: 500 },
      { labels: { a3: '1', b3: '3', c3: '3', d3: '5', e3: '9' }, wait: 3500 },
    ],
    challenges: [
      { fen: '8/8/4r3/1p6/3N4/8/8/8 w - - 0 1', goal: 'capture', piece: 'r', solution: ['d4e6'] },
      { fen: '8/8/3b4/8/8/8/8/3R3q w - - 0 1', goal: 'capture', piece: 'q', solution: ['d1h1'] },
      { fen: '8/8/4p3/3p3p/8/8/8/3Q4 w - - 0 1', goal: 'capture', target: 'h5', solution: ['d1h5'] },
    ],
  },
  {
    id: 'protect',
    group: 'tips',
    icon: '🛡️',
    demo: [
      { fen: '8/8/8/3p4/4N3/8/8/8 w - - 0 1', wait: 500 },
      { arrows: ['d5e4:red'], wait: 1500 },
      { clear: true, move: 'e4c3', wait: 1200 },
      { fen: '8/8/1n6/8/2B5/8/1P6/8 w - - 0 1', wait: 500 },
      { arrows: ['b6c4:red'], wait: 1300 },
      { move: 'b2b3', wait: 500 },
      { arrows: ['b6c4:red', 'b3c4:blue'], wait: 1800 },
    ],
    challenges: [
      { fen: '8/2b3p1/1p6/3p4/4N3/8/8/8 w - - 0 1', goal: 'safe', piece: 'n', solution: ['e4c3'] },
      { fen: '8/8/1n6/8/2B5/8/1P1P4/8 w - - 0 1', goal: 'defend', square: 'c4', solution: ['b2b3'] },
      { fen: '8/8/8/8/8/2n5/1P1P4/3Q4 w - - 0 1', goal: 'capture', target: 'c3', solution: ['b2c3'] },
    ],
  },
  {
    id: 'firstMoves',
    group: 'tips',
    icon: '🚀',
    demo: [
      { fen: START, wait: 600 },
      { move: 'e2e4', wait: 700 },
      { move: 'e7e5', wait: 700 },
      { move: 'g1f3', wait: 700 },
      { move: 'b8c6', wait: 700 },
      { move: 'f1c4', wait: 700 },
      { move: 'f8c5', wait: 700 },
      { move: 'e1g1', wait: 1500 },
    ],
    challenges: [
      { fen: START, goal: 'move', piece: 'p', to: ['e4', 'd4'], solution: ['e2e4'] },
      { fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', goal: 'move', piece: 'n', to: ['f3', 'c3'], solution: ['g1f3'] },
      { fen: 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4', goal: 'castle', solution: ['e1g1'] },
    ],
  },
];
