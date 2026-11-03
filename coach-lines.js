// The coach's words without any AI: short sentences picked from the variants in i18n.js and
// filled in with facts worked out by chess.js and Stockfish. At most two sentences each time.
import { STRINGS, LANG } from './i18n.js';

const S = () => STRINGS[LANG];
const lastPick = new Map(); // "coach:key" → the variant used last time, so it is not repeated

// The coach's own variants of a line, or the shared ones.
function variants(coachId, key) {
  const lines = S().lines;
  return lines[coachId]?.[key] || lines.default[key] || [];
}

function fill(text, vars) {
  return text.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
}

export function line(coachId, key, vars = {}) {
  const list = variants(coachId, key);
  if (!list.length) return '';
  const id = `${coachId}:${key}`;
  let i = Math.floor(Math.random() * list.length);
  if (list.length > 1 && i === lastPick.get(id)) i = (i + 1 + Math.floor(Math.random() * (list.length - 1))) % list.length;
  lastPick.set(id, i);
  return fill(list[i], vars);
}

const join = (...parts) => parts.filter(Boolean).join(' ');
const piece = (name) => S().pieces[name] || name;

// "rook", "rook and the queen", "knight, the rook and the queen" (after "the" in the sentence).
function pieceList(names) {
  const words = names.map(piece);
  if (words.length <= 1) return words[0] || '';
  return `${words.slice(0, -1).join(', the ')} ${S().and} the ${words.at(-1)}`;
}

// What a fork hits: the king when it gives check, then the pieces worth going for.
function forkTargets(f) {
  return pieceList([...(f.check ? ['king'] : []), ...f.targets.map((x) => x.piece)]);
}

// ---------- During the game ----------

export const greeting = (coachId) => line(coachId, 'greeting');

// A good move worth a word: checkmate, a fork, a capture or a check (the best move only).
export function praise(coachId, m) {
  const f = m.facts;
  if (m.category === 'checkmate') return line(coachId, 'checkmate');
  if (f.fork) return line(coachId, 'praiseFork', { piece: piece(f.pieceName), targets: forkTargets(f) });
  if (f.captured) return line(coachId, 'praiseCapture', { captured: piece(f.captured.piece) });
  if (f.check) return line(coachId, 'praiseCheck');
  return '';
}

// A mistake: what the opponent can do now (or what was missed), then a nudge in the coach's voice.
export function mistake(coachId, m) {
  const r = m.reply;
  const b = m.best;
  let fact = '';
  if (r?.checkmate) fact = line(coachId, 'replyMate');
  else if (r?.captured && r.captured.piece !== 'pawn') fact = line(coachId, 'replyCapture', { piece: piece(r.pieceName), from: r.from, captured: piece(r.captured.piece) });
  else if (r?.fork) fact = line(coachId, 'replyFork', { piece: piece(r.pieceName), from: r.from });
  else if (b?.checkmate) fact = line(coachId, 'missedMate');
  else if (b?.captured && b.captured.piece !== 'pawn') fact = line(coachId, 'missedCapture', { captured: piece(b.captured.piece), square: b.captured.square });
  else if (r?.captured) fact = line(coachId, 'replyCapture', { piece: piece(r.pieceName), from: r.from, captured: piece(r.captured.piece) });
  else fact = line(coachId, 'mistakeGeneral');
  return join(fact, line(coachId, 'mistakeNudge'));
}

export const gentle = (coachId) => line(coachId, 'gentle');

// Pieces the player's move left in danger.
export function danger(coachId, threats) {
  if (threats.length !== 1) return line(coachId, 'dangerMany');
  const x = threats[0];
  if (x.undefended) return line(coachId, 'dangerUndefended', { piece: piece(x.piece), square: x.square });
  return line(coachId, 'dangerCheaper', { by: piece(x.by), attacker: x.attackers[0], piece: piece(x.piece) });
}

// ---------- Hint ----------

// First tap: a question that leads to the move without naming it.
export function hintQuestion(coachId, f) {
  const p = { piece: piece(f.pieceName) };
  if (f.checkmate) return line(coachId, 'hintMate', p);
  if (f.promotion) return line(coachId, 'hintPromote', p);
  const self = f.saves.find((x) => x.from === f.from);
  if (self) return line(coachId, 'hintSaveSelf', p);
  if (f.captured) return line(coachId, 'hintCapture', p);
  if (f.saves.length) return line(coachId, 'hintSave', { ...p, saved: piece(f.saves[0].piece), square: f.saves[0].square });
  if (f.fork) return line(coachId, 'hintFork', p);
  if (f.check) return line(coachId, 'hintCheck', p);
  return line(coachId, 'hintGeneral', p);
}

// Second tap: what the move does (one sentence, two when it does two clear things).
export function hintExplanation(coachId, f) {
  const p = { piece: piece(f.pieceName), to: f.to };
  if (f.checkmate) return line(coachId, 'explainMate', p);
  if (f.promotion) return line(coachId, 'explainPromote', { ...p, promotion: piece(f.promotion) });
  const self = f.saves.find((x) => x.from === f.from);
  const parts = [];
  if (f.captured) parts.push(line(coachId, 'explainCapture', { ...p, captured: piece(f.captured.piece) }));
  else if (self) parts.push(line(coachId, 'explainSaveSelf', p));
  else if (f.saves.length) parts.push(line(coachId, 'explainSave', { ...p, saved: piece(f.saves[0].piece) }));
  if (f.fork) parts.push(line(coachId, 'explainFork', { ...p, targets: forkTargets(f) }));
  else if (f.check) parts.push(line(coachId, 'explainCheck', p));
  if (!parts.length && f.attacks.length) parts.push(line(coachId, 'explainAttack', { ...p, attacked: piece(f.attacks[0].piece) }));
  if (!parts.length && f.defends.length) parts.push(line(coachId, 'explainDefend', { ...p, defended: piece(f.defends[0].piece) }));
  if (!parts.length) parts.push(line(coachId, 'explainGeneral', p));
  // The second sentence starts with "The {piece} goes to …" again; say it shorter.
  if (parts.length === 2) parts[1] = parts[1].replace(/^The \w+ goes to \w+ and /, 'It also ');
  return join(...parts.slice(0, 2));
}

// ---------- Openings ----------

const CENTRE = new Set(['d4', 'e4', 'd5', 'e5', 'c4', 'c5']);

// The opening's name and one idea that can be seen in the player's own book moves.
// `moves`: the opening's book moves as [{ to, piece }], White's first.
export function opening(coachId, name, moves, playerColour) {
  const mine = moves.filter((_, i) => (playerColour === 'b' ? i % 2 === 1 : i % 2 === 0));
  const first = line(coachId, 'openingName', { name });
  const pawnsToCentre = mine.some((m) => m.piece === 'pawn' && CENTRE.has(m.to));
  const count = (x) => mine.filter((m) => m.piece === x).length;
  const developed = ['knight', 'bishop'].filter(count).map((x) => (count(x) > 1 ? S().piecesPlural[x] : piece(x)));
  if (developed.length) return join(first, line(coachId, 'openingDevelop', { pieces: developed.join(` ${S().and} `) }));
  if (pawnsToCentre) return join(first, line(coachId, 'openingCentre'));
  return join(first, line(coachId, 'openingIdea'));
}

// ---------- After the game ----------

export function review(coachId, result, counts, helpLevel) {
  const first = line(coachId, result === 'win' ? 'win' : result === 'loss' ? 'loss' : 'draw');
  let second = '';
  if (helpLevel > 0 && counts.total >= 5 && counts.blunder === 0 && counts.mistake <= 1) second = line(coachId, 'reviewLowerHelp', { help: helpLevel - 1 });
  else if (counts.best >= 2) second = line(coachId, 'reviewBest', { n: counts.best });
  else if (counts.best === 1) second = line(coachId, 'reviewBestOne');
  else if (counts.blunder + counts.mistake > 0) second = line(coachId, 'reviewTip');
  return join(first, second);
}

// ---------- Puzzles ----------

// Why the solution works: the key move, then one idea from the puzzle's theme (or what it wins).
export function puzzle(coachId, f) {
  const k = f.keyMove;
  const p = { piece: piece(k.pieceName), square: k.to };
  let first;
  if (f.checkmate && f.playerMoves === 1) first = line(coachId, 'pzMate1', p);
  else if (f.checkmate) first = line(coachId, 'pzMateN', p);
  else if (k.fork) first = line(coachId, 'pzFork', p);
  else if (k.captured && f.playerMoves === 1) first = line(coachId, 'pzCapture', { captured: piece(k.captured.piece), square: k.captured.square });
  else if (f.won) first = line(coachId, 'pzWinPiece', { ...p, won: piece(f.won) });
  else if (f.materialWon > 0) first = line(coachId, 'pzWinMaterial', p);
  else first = line(coachId, 'pzKey', p);
  const ideas = S().lines.default.themeIdea;
  const theme = f.themes.find((x) => ideas[x] && !(x === 'fork' && k.fork));
  return join(first, theme ? ideas[theme] : '');
}

export const puzzleLine = (coachId, key) => line(coachId, key);
