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

// The Ranked computer's move (ranked.js): its own strength for each floor of the tower,
// cfg = { skill, depth, random } like LEVELS.
export async function rankedMove(fen, cfg) {
  const c = new Chess(fen);
  if (Math.random() < cfg.random) {
    const moves = c.moves({ verbose: true });
    return uciOf(moves[Math.floor(Math.random() * moves.length)]);
  }
  const { best } = await engine.search(fen, { depth: cfg.depth, skill: cfg.skill });
  return best;
}

// ---------- Opponents with a playing style (opponents.js) ----------

// How far (centipawns) a move chosen for its style may be from the move the level would play anyway.
// Small enough that the style never makes an opponent clearly weaker (or stronger) than its level.
const STYLE_WINDOW = { 1: 60, 2: 60, 3: 50, 4: 40, 5: 30, 6: 30, 7: 25, 8: 25, 9: 15, 10: 0 };

const sameLine = (a, b, n) => a.slice(0, n).every((m, i) => m === b[i]);

// The next move of one of the opponent's favourite openings, while the game is still on that line.
export function favouriteMove(opp, line, fen) {
  const c = new Chess(fen);
  const legal = new Set(c.moves({ verbose: true }).map(uciOf));
  const options = opp.openings
    .filter((o) => o.length > line.length && sameLine(o, line, line.length) && legal.has(o[line.length]))
    .map((o) => o[line.length]);
  return options.length ? options[Math.floor(Math.random() * options.length)] : null;
}

const fileOf = (sq) => sq.charCodeAt(0) - 97;
const rankOf = (sq) => Number(sq[1]) - 1;
const squareAt = (f, r) => String.fromCharCode(97 + f) + (r + 1);
const DIRS = { b: [[1, 1], [1, -1], [-1, 1], [-1, -1]], r: [[1, 0], [-1, 0], [0, 1], [0, -1]] };
DIRS.q = [...DIRS.b, ...DIRS.r];

// Empty squares a bishop, rook or queen can reach from `sq`, and whether it pins an enemy piece
// (an enemy piece on the line with a more valuable enemy piece, or the king, behind it).
function lineFacts(c, sq, type, colour) {
  let reach = 0;
  let pin = false;
  for (const [df, dr] of DIRS[type] || []) {
    let f = fileOf(sq) + df;
    let r = rankOf(sq) + dr;
    let first = null;
    while (f >= 0 && f < 8 && r >= 0 && r < 8) {
      const p = c.get(squareAt(f, r));
      if (p) {
        if (first) {
          if (p.color !== colour && VALUE[p.type] > VALUE[first.type]) pin = true;
          break;
        }
        if (p.color === colour) break;
        first = p;
      } else if (!first) reach += 1;
      f += df;
      r += dr;
    }
  }
  return { reach, pin };
}

// How much a move fits the opponent's style (0 = nothing special). Facts come from chess.js only.
export function styleScore(style, fen, mv) {
  if (!style || !Object.keys(style).length) return 0;
  const before = new Chess(fen);
  const me = before.turn();
  const after = new Chess(fen);
  after.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
  const facts = moveFacts(fen, uciOf(mv));
  const forward = me === 'w' ? rankOf(mv.to) - rankOf(mv.from) : rankOf(mv.from) - rankOf(mv.to);
  const enemyKing = after.board().flat().find((p) => p && p.type === 'k' && p.color !== me)?.square;
  const nearKing = enemyKing ? Math.max(Math.abs(fileOf(mv.to) - fileOf(enemyKing)), Math.abs(rankOf(mv.to) - rankOf(enemyKing))) : 9;
  const lines = lineFacts(after, mv.to, mv.piece, me);
  const castle = mv.flags.includes('k') || mv.flags.includes('q');
  const early = before.moveNumber() <= 12;
  const homeRank = me === 'w' ? '1' : '8';

  const f = {
    capture: mv.captured ? 0.5 + VALUE[mv.captured] / 3 : 0,
    knight: mv.piece === 'n' ? 1 : 0,
    pawn: mv.piece === 'p' ? 1 + Math.max(0, forward) * 0.2 : 0,
    longRange: 'bqr'.includes(mv.piece) ? 0.6 + lines.reach / 10 : 0,
    defence: facts.defends.length * 0.4 + facts.saves.length + (castle ? 1.5 : 0) + (forward < 0 ? 0.3 : 0) - (forward > 1 ? 0.3 : 0),
    tactics: (facts.fork ? 2 : 0) + (lines.pin ? 2 : 0) + facts.attacks.filter((x) => !x.defended && x.piece !== 'pawn').length * 0.7,
    attack: (after.inCheck() ? 2 : 0) + (nearKing <= 2 ? 1 : 0)
      + (mv.piece === 'p' && enemyKing && Math.abs(fileOf(mv.to) - fileOf(enemyKing)) <= 1 && forward > 0 ? 0.7 : 0),
    textbook: early
      ? (castle ? 2 : 0) + ('nb'.includes(mv.piece) && mv.from[1] === homeRank ? 1.5 : 0)
        + (mv.piece === 'p' && 'de'.includes(mv.from[0]) ? 1 : 0) - (mv.piece === 'q' ? 1 : 0)
      : (castle ? 1 : 0) + facts.defends.length * 0.2,
  };
  let total = 0;
  for (const [k, weight] of Object.entries(style)) total += weight * (f[k] || 0);
  return total;
}

// The opponent's move (UCI): a favourite opening move if the game is on one of its lines, otherwise a
// move at exactly the strength of its level. Stockfish is asked for its best lines (MultiPV 4, which
// Stockfish uses for weaker skill levels anyway, so the strength does not change); from the lines rated
// almost the same as the move the level would play, the one that suits the opponent best is chosen.
export async function opponentMove(fen, opp, line = []) {
  const book = favouriteMove(opp, line, fen);
  if (book) return book;
  const c = new Chess(fen);
  const cfg = LEVELS[opp.level] || LEVELS[3];
  const moves = c.moves({ verbose: true });
  if (Math.random() < cfg.random) {
    // The same share of random moves as the level, but a random move the opponent likes is more likely.
    const weights = moves.map((m) => 1 + 1.5 * Math.max(0, styleScore(opp.style, fen, m)));
    let x = Math.random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < moves.length; i++) if ((x -= weights[i]) <= 0) return uciOf(moves[i]);
    return uciOf(moves.at(-1));
  }
  const range = STYLE_WINDOW[opp.level] ?? 0;
  const styled = range > 0 && Object.keys(opp.style).length > 0;
  const r = await engine.search(fen, { depth: cfg.depth, skill: cfg.skill, multiPv: styled ? 4 : 1 });
  if (!styled || !r.best) return r.best;
  const chosen = r.lines.find((l) => l.uci === r.best);
  if (!chosen) return r.best;
  const base = scoreToCp(chosen.score);
  const byUci = new Map(moves.map((m) => [uciOf(m), m]));
  let pick = r.best;
  let pickValue = styleScore(opp.style, fen, byUci.get(r.best));
  for (const l of r.lines) {
    const cp = scoreToCp(l.score);
    if (l.uci === r.best || !byUci.has(l.uci) || Math.abs(cp - base) > range) continue;
    const value = styleScore(opp.style, fen, byUci.get(l.uci)) - Math.max(0, base - cp) / 50;
    if (value > pickValue + 0.25) {
      pick = l.uci;
      pickValue = value;
    }
  }
  return pick;
}

// The grade of a move from the evaluations before it (best play) and after it, both from the mover's
// side in centipawns. Grades like chess.com, from lost winning chances: best !!, good !,
// inaccuracy ?!, mistake ?, blunder ??. A book move is not marked ?! for small differences in
// Stockfish's score. A real mistake that happens to be in the book (trap lines are in it too)
// keeps its ? or ??. `line`: all moves of the game so far in UCI, this move (`uci`) last.
// Used for the Play tab and for the Ranked game review, so both follow the same rules.
export function gradeMove({ evalBefore, evalAfter, isBest, checkmate, line, uci }) {
  const lost = winChance(evalBefore) - winChance(evalAfter);
  const inBook = lost < 18 && line.at(-1) === uci && openingOf(line).inBook;
  let category = 'good';
  if (checkmate) category = 'checkmate';
  else if (inBook) category = 'book';
  else if (lost >= 30) category = 'blunder';
  else if (lost >= 18) category = 'mistake';
  else if (isBest) category = 'best';
  else if (lost >= 8) category = 'inaccuracy';
  return { category, lost };
}

// One position of the Ranked game review (review.js): Stockfish at full strength, one line, at the
// given depth. Not kept in the shared analysis above, which uses its own depth and two lines.
export async function reviewSearch(fen, depth) {
  const r = await engine.search(fen, { depth, multiPv: 1 });
  return { best: r.lines[0]?.uci || r.best, cp: scoreToCp(r.lines[0]?.score || r.score) };
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
  const playedUci = uciOf(played);
  const isBest = pre.best === playedUci;
  const { category } = gradeMove({ evalBefore, evalAfter, isBest, checkmate: over?.reason === 'checkmate', line, uci: playedUci });

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
