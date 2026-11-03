// Opening book from data/openings.json (Lichess chess-openings, positions included).
// Positions are compared, not move orders, like Lichess does: 1.d4 d5 2.Bf4 Nf6 3.e3 and
// 1.d4 Nf6 2.Bf4 d5 3.e3 reach the same opening.
import { Chess } from './vendor/chess.js/chess.js';

// Position without move counters and en passant, the same way the data file stores them.
const positionKey = (c) => c.fen().split(' ').slice(0, 3).join(' ');

const named = new Map(); // position at the end of a book line → opening (the first one listed)
let bookPositions = new Set(); // every position on the way along any book line

export const openingsReady = fetch(new URL('./data/openings.json', import.meta.url))
  .then((r) => r.json())
  .then((data) => {
    for (const o of data.openings) if (!named.has(o.position)) named.set(o.position, o);
    bookPositions = new Set(data.positions);
  })
  .catch(() => console.warn('[openings] data/openings.json could not be loaded'));

// "Italian Game: Giuoco Piano" → "Italian Game"
export const openingFamily = (name) => name.split(':')[0].trim();

// For the moves of a game (UCI, from the start): the last known opening and whether the game is still in the book.
// A book move = the position after it is a book position.
export function openingOf(line) {
  const c = new Chess();
  let found = null;
  let inBook = false;
  try {
    for (const uci of line) {
      c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      const key = positionKey(c);
      if (named.has(key)) found = named.get(key);
      inBook = bookPositions.has(key);
    }
  } catch {
    return { opening: null, inBook: false };
  }
  return { opening: found, inBook: line.length > 0 && inBook };
}
