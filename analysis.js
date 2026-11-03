// Everything the server of the original Chess Coach worked out, now in the browser:
// the computer's moves, move grades, pieces in danger and facts about moves (chess.js + Stockfish).
import { Chess } from './vendor/chess.js/chess.js';
import { Engine, scoreToCp, winChance } from './engine.js';
import { openingOf } from './openings.js';

const engine = new Engine();
export const engineReady = engine.ready;

const ANALYSIS_DEPTH = 12;

// One analysis per position (MultiPV 2), remembered by FEN, so the hint, the best-move arrows
// and the move grading always agree. Stockfish can answer differently when asked twice.
const analyses = new Map(); // fen → Promise<{ best, score, lines }>
const MAX_ANALYSES = 500;

export function analysePosition(fen) {
  if (analyses.has(fen)) return analyses.get(fen);
  const job = engine.search(fen, { depth: ANALYSIS_DEPTH, multiPv: 2 }).then((r) => ({
    best: r.lines[0]?.uci || r.best,
    score: r.lines[0]?.score || r.score,
    lines: r.lines,
  }));
  analyses.set(fen, job);
  job.catch(() => analyses.delete(fen));
  if (analyses.size > MAX_ANALYSES) analyses.delete(analyses.keys().next().value);
  return job;
}

// Computer strength, level 1 (easiest) to 10.
const LEVELS = {
  1: { skill: 0, depth: 1, random: 0.5 },
  2: { skill: 0, depth: 1, random: 0.3 },
  3: { skill: 1, depth: 2, random: 0.15 },
  4: { skill: 3, depth: 3, random: 0.05 },
  5: { skill: 5, depth: 4, random: 0 },
  6: { skill: 8, depth: 6, random: 0 },
  7: { skill: 11, depth: 8, random: 0 },
  8: { skill: 14, depth: 10, random: 0 },
  9: { skill: 17, depth: 12, random: 0 },
  10: { skill: 20, depth: 14, random: 0 },
};

export const PIECE = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const NAME_VALUE = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, king: 100 };

export const uciToMove = (uci) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
export const uciOf = (mv) => mv.from + mv.to + (mv.promotion || '');

// Non-king pieces of one colour that the other colour attacks (could capture).
function threatened(c, colour) {
  const enemy = colour === 'w' ? 'b' : 'w';
  const out = [];
  for (const row of c.board()) {
    for (const p of row) {
      if (p && p.color === colour && p.type !== 'k' && c.attackers(p.square, enemy).length) out.push(p.square);
    }
  }
  return out;
}

// Pieces of `colour` that the other side can win right now, worked out from chess.js legal moves only:
// a legal capture where the piece has no legal recapture, or the capturing piece is worth less.
// Returns [{ square, piece, attackers: [squares], undefended, by: cheapest attacker's piece }].
export function piecesInDanger(fen, colour) {
  const parts = fen.split(' ');
  if (parts[1] === colour) {
    // Let the other side be the one to move (no en passant then).
    parts[1] = colour === 'w' ? 'b' : 'w';
    parts[3] = '-';
  }
  let c;
  try {
    c = new Chess(parts.join(' '));
  } catch {
    return [];
  }
  const found = new Map();
  for (const mv of c.moves({ verbose: true })) {
    if (!mv.captured || mv.captured === 'k') continue;
    const square = mv.flags.includes('e') ? mv.to[0] + mv.from[1] : mv.to;
    c.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
    const undefended = !c.moves({ verbose: true }).some((r) => r.to === mv.to);
    c.undo();
    if (!undefended && VALUE[mv.piece] >= VALUE[mv.captured]) continue;
    if (!found.has(square)) found.set(square, { square, piece: PIECE[mv.captured], attackers: [], undefended, by: PIECE[mv.piece] });
    const x = found.get(square);
    if (!x.attackers.includes(mv.from)) x.attackers.push(mv.from);
    if (NAME_VALUE[PIECE[mv.piece]] < NAME_VALUE[x.by]) x.by = PIECE[mv.piece];
  }
  return [...found.values()];
}

// Real facts about a move, worked out with chess.js: what it captures, attacks, protects and saves.
export function moveFacts(fen, uci) {
  const before = new Chess(fen);
  const me = before.turn();
  const enemy = me === 'w' ? 'b' : 'w';
  const after = new Chess(fen);
  const mv = after.move(uciToMove(uci));
  const at = (sq) => ({ piece: PIECE[after.get(sq).type], square: sq });
  // En passant takes a pawn that is not on the destination square.
  const capturedOn = mv.captured ? (mv.flags.includes('e') ? mv.to[0] + mv.from[1] : mv.to) : null;

  // What the moved piece hits or guards from its new square (kings left out; check is its own fact).
  const attacks = [];
  const defends = [];
  for (const row of after.board()) {
    for (const p of row) {
      if (!p || p.type === 'k' || p.square === mv.to) continue;
      if (!after.attackers(p.square, me).includes(mv.to)) continue;
      if (p.color === enemy) attacks.push({ ...at(p.square), defended: after.attackers(p.square, enemy).length > 0 });
      else defends.push(at(p.square));
    }
  }

  // Pieces that could be captured before the move but not after it.
  const stillThreatened = new Set(threatened(after, me));
  const saves = [];
  for (const sq of threatened(before, me)) {
    const nowAt = sq === mv.from ? mv.to : sq;
    if (stillThreatened.has(nowAt)) continue;
    let how = 'blocked';
    if (sq === mv.from) how = 'escaped';
    else if (capturedOn && before.attackers(sq, enemy).includes(capturedOn)) how = 'captured_attacker';
    saves.push({ piece: PIECE[before.get(sq).type], square: nowAt, from: sq, how });
  }

  // A fork: the piece goes for two things at once (the king in check, or pieces other than pawns
  // that are worth more than it or have no defender).
  const targets = attacks.filter((x) => x.piece !== 'pawn' && (!x.defended || NAME_VALUE[x.piece] > VALUE[mv.piece]));
  const fork = targets.length + (after.inCheck() ? 1 : 0) >= 2;

  return {
    san: mv.san,
    pieceName: PIECE[mv.piece],
    from: mv.from,
    to: mv.to,
    promotion: mv.promotion ? PIECE[mv.promotion] : null,
    captured: mv.captured ? { piece: PIECE[mv.captured], square: capturedOn } : null,
    check: after.inCheck(),
    checkmate: after.isCheckmate(),
    attacks,
    defends,
    saves,
    targets,
    fork,
  };
}

export function gameOverInfo(c) {
  if (!c.isGameOver()) return null;
  if (c.isCheckmate()) return { reason: 'checkmate', winner: c.turn() === 'w' ? 'b' : 'w' };
  if (c.isStalemate()) return { reason: 'stalemate', winner: null };
  if (c.isThreefoldRepetition()) return { reason: 'repetition', winner: null };
  if (c.isInsufficientMaterial()) return { reason: 'insufficient', winner: null };
  return { reason: 'draw', winner: null };
}

// The computer's move at the chosen level (UCI).
export async function computerMove(fen, level) {
  const c = new Chess(fen);
  const cfg = LEVELS[level] || LEVELS[3];
  if (Math.random() < cfg.random) {
    const moves = c.moves({ verbose: true });
    return uciOf(moves[Math.floor(Math.random() * moves.length)]);
  }
  const { best } = await engine.search(fen, { depth: cfg.depth, skill: cfg.skill });
  return best;
}

// Judges the player's move: grade, better move, the opponent's best answer, pieces left in danger.
// `line`: all moves of the game so far in UCI, the player's move last (for the opening book).
export async function judgeMove(fen, move, line) {
  const before = new Chess(fen);
  const playerColour = before.turn() === 'w' ? 'white' : 'black';
  const moveNumber = before.moveNumber();

  const pre = await analysePosition(fen);

  const after = new Chess(fen);
  const played = after.move(uciToMove(move));
  const fenAfter = after.fen();
  const over = gameOverInfo(after);

  let evalAfter;
  let replyUci = null;
  if (over) {
    evalAfter = over.reason === 'checkmate' ? 10000 : 0;
  } else {
    const post = await analysePosition(fenAfter);
    evalAfter = -scoreToCp(post.score);
    replyUci = post.best || null;
  }

  const evalBefore = scoreToCp(pre.score);
  const lost = winChance(evalBefore) - winChance(evalAfter);
  const playedUci = uciOf(played);
  const isBest = pre.best === playedUci;

  // Grades like chess.com, from lost winning chances: best !!, good !, inaccuracy ?!, mistake ?, blunder ??.
  // A book move is not marked ?! for small differences in Stockfish's score. A real mistake that
  // happens to be in the book (trap lines are in it too) keeps its ? or ??.
  const inBook = lost < 18 && line.at(-1) === playedUci && openingOf(line).inBook;
  let category = 'good';
  if (over?.reason === 'checkmate') category = 'checkmate';
  else if (inBook) category = 'book';
  else if (lost >= 30) category = 'blunder';
  else if (lost >= 18) category = 'mistake';
  else if (isBest) category = 'best';
  else if (lost >= 8) category = 'inaccuracy';

  const facts = moveFacts(fen, playedUci);
  const moment = {
    moveNumber,
    playerColour,
    san: played.san,
    from: played.from,
    to: played.to,
    pieceName: PIECE[played.piece],
    capturedName: played.captured ? PIECE[played.captured] : null,
    check: after.inCheck(),
    category,
    facts,
    bestUci: pre.best || null,
    best: pre.best && !isBest ? moveFacts(fen, pre.best) : null,
    replyUci,
    reply: replyUci ? moveFacts(fenAfter, replyUci) : null,
  };

  // The coach speaks on mistakes, checkmate, and best moves that capture, give check or fork.
  moment.worthComment =
    category === 'blunder' ||
    category === 'mistake' ||
    category === 'checkmate' ||
    (category === 'best' && Boolean(moment.capturedName || moment.check || facts.fork));

  return {
    moment,
    fenAfter,
    gameOver: over,
    threats: over ? [] : piecesInDanger(fenAfter, before.turn()),
    evalWhite: before.turn() === 'w' ? evalAfter : -evalAfter,
  };
}

// Evaluation for the advantage bar (centipawns, White's view) and the best lines.
export async function evaluate(fen) {
  const c = new Chess(fen);
  const { score, lines } = await analysePosition(fen);
  const cp = scoreToCp(score);
  return { evalWhite: c.turn() === 'w' ? cp : -cp, lines: lines.map((l) => ({ uci: l.uci })) };
}

// The best move of the shared analysis (the same move as the green "best move" arrow) and its facts.
export async function hintFor(fen) {
  const { best } = await analysePosition(fen);
  if (!best) return null;
  const facts = moveFacts(fen, best);
  return { uci: best, from: facts.from, to: facts.to, facts };
}
