// The computer opponents: one for each strength level 1–10. Names, descriptions and their sentences
// are in i18n.js (STRINGS.<lang>.opponents and .opponentLines).
//
// level:    the strength, exactly the settings of the old computer level with this number (analysis.js).
// style:    which kind of move the opponent likes (see styleScore in analysis.js). It only chooses
//           between moves that Stockfish rates almost the same as the move it would play anyway.
// openings: favourite book lines (UCI from the start). The opponent plays the next move of a line
//           while the game is still on it.
// voice:    pitch and rate for the browser's speech (different from the coaches).
// Pictures: ./avatars/opponents/<id>/<mood>.svg with the same moods as the coaches.

export const DEFAULT_OPPONENT = 'bonnie';

export const OPPONENTS = [
  {
    id: 'pip', level: 1, style: { pawn: 0.5 }, voice: { pitch: 1.6, rate: 1.05 },
    openings: [
      ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4'], // Italian Game
      ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5'], // Italian Game, as Black
    ],
  },
  {
    id: 'bonnie', level: 2, style: { knight: 3 }, voice: { pitch: 1.75, rate: 1.15 },
    openings: [
      ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'b1c3', 'g8f6'], // Four Knights Game
      ['e2e4', 'g8f6'], // Alekhine Defence, as Black
    ],
  },
  {
    id: 'milo', level: 3, style: { pawn: 3 }, voice: { pitch: 1.5, rate: 1.2 },
    openings: [
      ['e2e4', 'e7e5', 'f2f4'], // King's Gambit
      ['e2e4', 'e7e6', 'd2d4', 'd7d5'], // French Defence, as Black
    ],
  },
  {
    id: 'barnacle', level: 4, style: { capture: 3 }, voice: { pitch: 0.7, rate: 0.95 },
    openings: [
      ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'd2d4', 'e5d4'], // Scotch Game
      ['e2e4', 'd7d5', 'e4d5', 'd8d5'], // Scandinavian Defence, as Black
    ],
  },
  {
    id: 'shield', level: 5, style: { defence: 2.5 }, voice: { pitch: 0.85, rate: 0.9 },
    openings: [
      ['d2d4', 'd7d5', 'c1f4'], // London System
      ['e2e4', 'c7c6', 'd2d4', 'd7d5'], // Caro-Kann Defence, as Black
    ],
  },
  {
    id: 'nova', level: 6, style: { longRange: 2.5 }, voice: { pitch: 1.2, rate: 1.0 },
    openings: [
      ['d2d4', 'g8f6', 'c2c4', 'e7e6', 'g2g3'], // Catalan Opening
      ['e2e4', 'g7g6', 'd2d4', 'f8g7'], // Modern Defence, as Black
    ],
  },
  {
    id: 'luna', level: 7, style: { tactics: 3 }, voice: { pitch: 1.3, rate: 0.95 },
    openings: [
      ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4'], // Italian Game
      ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6'], // Two Knights Defence, as Black
    ],
  },
  {
    id: 'rex', level: 8, style: { attack: 3 }, voice: { pitch: 0.6, rate: 1.05 },
    openings: [
      ['e2e4', 'e7e5', 'f2f4'], // King's Gambit
      ['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4', 'c5d4', 'f3d4', 'g8f6', 'b1c3', 'g7g6'], // Sicilian, Dragon Variation, as Black
    ],
  },
  {
    id: 'professor', level: 9, style: { textbook: 2 }, voice: { pitch: 0.9, rate: 0.85 },
    openings: [
      ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6', 'b5a4', 'g8f6', 'e1g1'], // Ruy Lopez
      ['d2d4', 'd7d5', 'c2c4', 'e7e6', 'b1c3', 'g8f6'], // Queen's Gambit Declined, as Black
    ],
  },
  {
    id: 'ember', level: 10, style: {}, voice: { pitch: 0.5, rate: 0.9 },
    openings: [
      ['d2d4', 'd7d5', 'c2c4', 'e7e6', 'b1c3', 'g8f6', 'c1g5'], // Queen's Gambit Declined
      ['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4', 'c5d4', 'f3d4', 'g8f6', 'b1c3', 'a7a6'], // Sicilian, Najdorf Variation, as Black
    ],
  },
];

export const OPPONENT_MOODS = ['neutral', 'happy', 'worried', 'thinking', 'celebrate'];

export function opponentById(id) {
  return OPPONENTS.find((o) => o.id === id) || OPPONENTS.find((o) => o.id === DEFAULT_OPPONENT);
}

export const opponentImage = (o, mood) => `./avatars/opponents/${o.id}/${mood}.svg`;
