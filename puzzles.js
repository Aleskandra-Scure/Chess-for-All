// Puzzle mode: its own board, buttons and coach messages. The game in the Play tab is left untouched.
// Puzzles come from data/puzzles.json (Lichess puzzle database). There is no rating, nothing is
// saved: the child picks Easy, Medium or Hard, and while the page is open the puzzles get a little
// harder after a solved one and a little easier after a missed one.
import { Chessground } from './vendor/chessground/chessground.js';
import { Chess } from './vendor/chess.js/chess.js';
import { moveFacts, PIECE } from './analysis.js';
import * as lines from './coach-lines.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const colourName = (c) => (c === 'w' ? 'white' : 'black');

// Lichess puzzle ratings for each level. The target starts in the middle and moves inside its level.
export const LEVELS = {
  easy: { min: 400, max: 800, start: 600 },
  medium: { min: 800, max: 1200, start: 1000 },
  hard: { min: 1200, max: 1600, start: 1400 },
};
const STEP = { clean: 50, hint: 20, failed: -50 }; // how far the target moves after each puzzle
const WINDOW = 100; // puzzles within this distance of the target
const THEME_FILTERS = ['mateIn1', 'mateIn2', 'fork', 'hangingPiece', 'pin', 'skewer', 'discoveredAttack', 'backRankMate', 'promotion', 'trappedPiece'];
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

let all = null;
const loadPuzzles = () => {
  all ||= fetch(new URL('./data/puzzles.json', import.meta.url)).then((r) => r.json()).catch(() => []);
  return all;
};

function material(c, colour) {
  let sum = 0;
  for (const row of c.board()) for (const x of row) if (x && x.color === colour) sum += VALUE[x.type];
  return sum;
}

// Facts about the solution, worked out with chess.js only.
function solutionFacts(p) {
  const c = new Chess(p.fen);
  const play = (uci) => c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  play(p.moves[0]);
  const me = c.turn();
  const them = me === 'w' ? 'b' : 'w';
  const startFen = c.fen();
  const keyMove = moveFacts(startFen, p.moves[1]);
  const before = material(c, me) - material(c, them);
  const lost = [];
  for (const uci of p.moves.slice(1)) {
    const mv = play(uci);
    if (mv.captured && mv.color === me) lost.push(mv.captured);
  }
  // The biggest piece the player won, if the puzzle wins material.
  const won = lost.sort((a, b) => VALUE[b] - VALUE[a])[0];
  const materialWon = material(c, me) - material(c, them) - before;
  return {
    keyMove,
    playerMoves: Math.ceil((p.moves.length - 1) / 2),
    checkmate: c.isCheckmate(),
    materialWon,
    won: materialWon >= 3 && won && won !== 'p' ? PIECE[won] : null,
    themes: p.themes,
  };
}

// ctx: { t, coach(), addMessage(text, kind, box), speak, react, refreshMood, talkPulse }
export function createPuzzles(ctx) {
  const { t } = ctx;
  let cg = null;
  let theme = 'mixed';
  let level = null; // 'easy' | 'medium' | 'hard', chosen by the child
  let target = 0; // puzzle rating the next puzzle is picked around
  const seen = new Set(); // puzzles already given while the page is open
  let pz = null; // the puzzle on the board
  let seq = 0; // a newer puzzle makes older timers stop
  let loading = false;
  let statusKey = '';

  // ---------- Coach messages ----------

  const box = () => $('pzMessages');

  function say(text, kind = '') {
    if (!text) return;
    ctx.addMessage(text, kind, box());
    ctx.speak(text);
  }

  // ---------- Board ----------

  function playersTurn() {
    return pz && !pz.done && !pz.busy && pz.chess.turn() === pz.colour;
  }

  function dests() {
    const map = new Map();
    for (const mv of pz.chess.moves({ verbose: true })) {
      if (!map.has(mv.from)) map.set(mv.from, []);
      map.get(mv.from).push(mv.to);
    }
    return map;
  }

  function sync(lastMove) {
    const c = pz.chess;
    const mine = playersTurn();
    cg.set({
      fen: c.fen(),
      turnColor: colourName(c.turn()),
      check: c.inCheck() ? colourName(c.turn()) : false,
      lastMove: lastMove || cg.state.lastMove,
      movable: { color: mine ? colourName(pz.colour) : undefined, dests: mine ? dests() : new Map() },
    });
    refreshButtons();
  }

  function mark(square, cls) {
    cg.set({ highlight: { custom: square ? new Map([[square, cls]]) : new Map() } });
  }

  const uciMove = (uci) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });

  function setStatus(key) {
    statusKey = key;
    refreshStatus();
  }

  function refreshStatus() {
    $('pzStatus').textContent = statusKey ? t(statusKey) : '';
  }

  const findKey = () => (pz.colour === 'w' ? 'pzFindWhite' : 'pzFindBlack');

  function refreshButtons() {
    const stage = pz?.hintStage || 0;
    $('pzHintLabel').textContent = t(stage === 1 ? 'showMe' : 'hint');
    $('pzHint').disabled = !playersTurn() || stage === 2;
    $('pzSolution').disabled = !pz || pz.done || pz.busy;
    $('pzNext').disabled = loading || !level;
  }

  // ---------- Level ----------

  function refreshLevel() {
    document.querySelectorAll('[data-pz-level]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pzLevel === level)));
    $('pzStart').hidden = Boolean(level);
    $('pzLevelRow').hidden = !level;
  }

  function chooseLevel(l) {
    if (!LEVELS[l]) return;
    level = l;
    target = LEVELS[l].start;
    refreshLevel();
    next();
  }

  document.querySelectorAll('[data-pz-level]').forEach((b) => b.addEventListener('click', () => chooseLevel(b.dataset.pzLevel)));

  // The result of a puzzle moves the target (once per puzzle).
  function adapt(outcome) {
    if (!pz || pz.counted || !level) return 0;
    pz.counted = true;
    const { min, max } = LEVELS[level];
    const before = target;
    target = Math.min(max, Math.max(min, target + STEP[outcome]));
    return target - before;
  }

  // ---------- Theme choice ----------

  function renderThemes() {
    const sel = $('pzTheme');
    sel.replaceChildren(...['mixed', ...THEME_FILTERS].map((id) => {
      const o = document.createElement('option');
      o.value = id;
      o.textContent = t('pzFilters')[id] || id;
      return o;
    }));
    sel.value = theme;
  }

  $('pzTheme').addEventListener('change', () => {
    theme = $('pzTheme').value;
    if (level) next();
  });

  // Themes only after the puzzle, so the answer is not given away.
  function showInfo(moved) {
    const info = $('pzInfo');
    const names = pz.themes.map((x) => t('themes')[x]).filter(Boolean);
    info.replaceChildren();
    for (const n of names) {
      const tag = document.createElement('span');
      tag.className = 'theme-tag';
      tag.textContent = n;
      info.append(tag, ' ');
    }
    if (moved) {
      const note = document.createElement('span');
      note.className = 'pz-adapt';
      note.textContent = t(moved > 0 ? 'pzHarder' : 'pzEasier');
      info.append(note);
    }
    info.hidden = !info.childNodes.length;
  }

  // ---------- Choosing a puzzle ----------

  async function pick() {
    const list = (await loadPuzzles()).filter((p) => theme === 'mixed' || p.themes.includes(theme));
    const { min, max } = LEVELS[level];
    const inLevel = list.filter((p) => p.rating >= min && p.rating < max);
    let fresh = inLevel.filter((p) => !seen.has(p.id));
    if (!fresh.length) fresh = inLevel.length ? inLevel : list;
    // Close to the target; the window grows when there are too few puzzles in it.
    let near = [];
    for (const width of [WINDOW, 2 * WINDOW, 4 * WINDOW]) {
      near = fresh.filter((p) => Math.abs(p.rating - target) <= width);
      if (near.length >= 5) break;
    }
    if (!near.length) near = fresh;
    const p = near[Math.floor(Math.random() * near.length)] || null;
    if (p) seen.add(p.id);
    return p;
  }

  // ---------- Puzzle flow ----------

  async function load() {
    const my = ++seq;
    loading = true;
    if (pz && box().lastElementChild && !box().lastElementChild.classList.contains('divider')) {
      const d = document.createElement('div');
      d.className = 'divider';
      d.textContent = '· · ·';
      box().append(d);
    }
    pz = null;
    $('pzInfo').hidden = true;
    cg.setAutoShapes([]);
    mark(null);
    cg.set({ movable: { color: undefined, dests: new Map() } });
    setStatus('pzLoading');
    refreshButtons();
    ctx.refreshMood();
    const p = await pick();
    if (my !== seq) return;
    loading = false;
    if (!p) {
      setStatus('pzNone');
      refreshButtons();
      return ctx.refreshMood();
    }

    // Lichess: the FEN is before the opponent's move; the first move is the opponent's, the solution starts after it.
    const chess = new Chess(p.fen);
    const colour = chess.turn() === 'w' ? 'b' : 'w';
    pz = {
      id: p.id, puzzle: p, themes: p.themes, chess, colour, solution: p.moves, step: 0, busy: true, done: false,
      hintStage: 0, hintUsed: false, failed: false, touched: false, counted: false,
    };
    cg.set({ orientation: colourName(colour), lastMove: undefined });
    sync();
    setStatus('pzOpponent');
    ctx.refreshMood();
    await sleep(800);
    if (my !== seq) return;
    playStep();
    await sleep(350);
    if (my !== seq) return;
    pz.busy = false;
    sync();
    setStatus(findKey());
  }

  // Plays the next move of the solution on the board (the opponent's, or one shown by "Show solution").
  function playStep() {
    const mv = pz.chess.move(uciMove(pz.solution[pz.step]));
    pz.step += 1;
    pz.last = [mv.from, mv.to];
    sync(pz.last);
    return mv;
  }

  // Promotion: same four big buttons as in the game; a tap elsewhere cancels the move.
  function choosePromotion() {
    document.querySelectorAll('#pzPromo piece').forEach((p) => {
      p.classList.toggle('white', pz.colour === 'w');
      p.classList.toggle('black', pz.colour === 'b');
    });
    $('pzPromo').hidden = false;
    return new Promise((resolve) => {
      $('pzPromo').onclick = (e) => {
        const btn = e.target.closest('[data-promo]');
        if (!btn && e.target.closest('.promo-card')) return;
        $('pzPromo').hidden = true;
        $('pzPromo').onclick = null;
        resolve(btn ? btn.dataset.promo : null);
      };
    });
  }

  async function onMove(orig, dest) {
    if (!playersTurn()) return;
    const my = seq;
    const piece = pz.chess.get(orig);
    let promotion = '';
    if (piece?.type === 'p' && (dest[1] === '8' || dest[1] === '1')) {
      promotion = await choosePromotion();
      if (my !== seq) return;
      if (!promotion) return sync(pz.last);
    }
    pz.touched = true;
    const uci = orig + dest + promotion;
    const expected = pz.solution[pz.step];
    // A move that gives checkmate is always right, even if it is not the one in the solution.
    const trial = new Chess(pz.chess.fen());
    trial.move({ from: orig, to: dest, promotion: promotion || undefined });
    const mate = trial.isCheckmate();

    if (uci === expected || mate) {
      pz.chess.move({ from: orig, to: dest, promotion: promotion || undefined });
      pz.step += 1;
      pz.last = [orig, dest];
      pz.hintStage = 0;
      cg.setAutoShapes([]);
      mark(dest, 'pz-right');
      if (mate || pz.step >= pz.solution.length) return finish(true);
      pz.busy = true;
      sync([orig, dest]);
      setStatus('pzCorrect');
      ctx.react('happy', 2000);
      await sleep(600);
      if (my !== seq) return;
      mark(null);
      playStep();
      pz.busy = false;
      sync();
      return;
    }

    // Wrong: the piece goes back, and the puzzle no longer counts as solved.
    pz.busy = true;
    pz.failed = true;
    cg.set({ movable: { color: undefined, dests: new Map() } });
    refreshButtons();
    mark(dest, 'pz-wrong');
    say(lines.puzzleLine(ctx.coach().id, 'pzWrong'), 'warn');
    ctx.react('worried');
    await sleep(700);
    if (my !== seq) return;
    mark(null);
    pz.busy = false;
    sync(pz.last);
    setStatus(findKey());
  }

  function finish(byPlayer) {
    pz.done = true;
    pz.busy = false;
    sync();
    const outcome = pz.failed ? 'failed' : pz.hintUsed ? 'hint' : 'clean';
    let key = 'pzFinished';
    if (byPlayer) key = outcome === 'clean' ? 'pzSolvedClean' : outcome === 'hint' ? 'pzSolvedHelp' : 'pzSolved';
    pz.outcome = outcome;
    setStatus(key);
    if (outcome === 'clean') ctx.react('celebrate', 5000);
    else if (byPlayer) ctx.react('happy');
    const moved = adapt(outcome);
    showInfo(moved);
    ctx.refreshMood();
    say(lines.puzzle(ctx.coach().id, solutionFacts(pz.puzzle)) || t(key));
  }

  // ---------- Buttons ----------

  // First tap: the piece to move is circled. Second tap: the move is shown (then it counts as not solved).
  $('pzHint').addEventListener('click', () => {
    if (!playersTurn() || pz.hintStage === 2) return;
    pz.touched = true;
    const uci = pz.solution[pz.step];
    if (pz.hintStage === 0) {
      pz.hintStage = 1;
      pz.hintUsed = true;
      cg.setAutoShapes([{ orig: uci.slice(0, 2), brush: 'green' }]);
      say(lines.puzzleLine(ctx.coach().id, 'pzHintPiece'));
    } else {
      pz.hintStage = 2;
      pz.failed = true;
      cg.setAutoShapes([{ orig: uci.slice(0, 2), dest: uci.slice(2, 4), brush: 'green' }]);
      say(lines.puzzleLine(ctx.coach().id, 'pzHintMove'));
    }
    ctx.react('thinking', 1500);
    refreshButtons();
  });

  $('pzSolution').addEventListener('click', async () => {
    if (!pz || pz.done || pz.busy) return;
    const my = seq;
    pz.failed = true;
    pz.busy = true;
    setStatus('pzWatch');
    mark(null);
    sync();
    while (pz.step < pz.solution.length) {
      const uci = pz.solution[pz.step];
      cg.setAutoShapes([{ orig: uci.slice(0, 2), dest: uci.slice(2, 4), brush: 'green' }]);
      await sleep(700);
      if (my !== seq) return;
      cg.setAutoShapes([]);
      playStep();
      await sleep(600);
      if (my !== seq) return;
    }
    finish(false);
  });

  // A puzzle that was started and left unfinished counts as missed.
  function next() {
    if (pz && !pz.done && pz.touched) adapt('failed');
    load();
  }
  $('pzNext').addEventListener('click', next);

  renderThemes();
  refreshLevel();

  return {
    show() {
      if (!cg) {
        cg = Chessground($('pzBoard'), {
          movable: { free: false, color: undefined, showDests: true, events: { after: onMove } },
          premovable: { enabled: false },
          highlight: { lastMove: true, check: true },
          animation: { enabled: true, duration: 300 },
        });
        refreshButtons();
        loadPuzzles(); // start loading while the child picks a level
      } else {
        cg.redrawAll();
      }
    },
    // Face for the coach while in puzzle mode.
    mood() {
      if (loading) return 'thinking';
      if (pz?.done && pz.outcome === 'clean') return 'celebrate';
      return 'neutral';
    },
    // For tests and the curious: the current level and target rating (memory only).
    get state() {
      return { level, target, seen: seen.size, id: pz?.id || null, rating: pz?.puzzle.rating || null, ready: playersTurn(), done: Boolean(pz?.done) };
    },
  };
}
