// Game review for Ranked: Stockfish (in the browser, the same engine as the rest of the app) looks at
// every position of a finished game. The player's moves get the same marks as in the Play tab
// (!!, !, ?!, ?, ??, 📖), there is a chart of the advantage, the 2–3 biggest mistakes are the key
// moments (with the better move, the threat and a short explanation from the coach's sentences), and
// each key moment can be tried again like a puzzle. No AI. Nothing is sent anywhere, and the review
// never changes the player's progress in Ranked; only the "reviewed" mark of the game is kept.
import { Chessground } from './vendor/chessground/chessground.js';
import { Chess } from './vendor/chess.js/chess.js';
import { engineReady, reviewSearch, gradeMove, moveFacts, gameOverInfo, uciToMove, uciOf } from './analysis.js';
import { winChance } from './engine.js';
import { openingsReady } from './openings.js';
import * as lines from './coach-lines.js';
import { play, playMove } from './sounds.js';
import { confetti } from './confetti.js';

const $ = (id) => document.getElementById(id);
const colourName = (c) => (c === 'w' ? 'white' : 'black');

// The same marks as on the board in the Play tab.
const MARK = { best: '!!', checkmate: '!!', good: '!', inaccuracy: '?!', mistake: '?', blunder: '??', book: '📖' };
const SUMMARY = ['best', 'good', 'inaccuracy', 'mistake', 'blunder'];
// The names of one move's mark (the same words as the Play tab's legend).
const GRADE_NAME = {
  best: 'gradeBest', checkmate: 'gradeBest', good: 'gradeGood', inaccuracy: 'gradeInaccuracy',
  mistake: 'gradeMistake', blunder: 'gradeBlunder', book: 'gradeBook',
};
const WEAK = new Set(['inaccuracy', 'mistake', 'blunder']);
const COACH = 'default'; // the shared coach sentences (Ranked has no coach of its own)

// Depth of the search for each position. 12 is the depth the Play tab grades moves with. On a slow
// device the rest of the game is looked at less deeply (10, then 8) when the whole review would take
// longer than BUDGET, so it stays short on a phone.
const DEPTHS = [12, 10, 8];
const BUDGET = 15000; // milliseconds
const RIGHT = 8; // a move in "Try again" is right when it loses less than this (a "!" or "!!" move)

// fen → { best, cp, depth } for this visit only (never saved), so a review opened again, or carried on
// after leaving the screen, does not start from the beginning.
const cache = new Map();
const MAX_CACHE = 3000;

// ctx: { t, onBack(), onReviewed(entry) }
export function createReview(ctx) {
  const { t } = ctx;
  const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));

  let entry = null; // the game: { moves, colour, result, floor, at, reviewed, tc }
  let state = 'idle'; // 'working', 'paused' (left during the work), 'done' or 'failed'
  let token = 0; // a new number stops an older piece of work
  let fens = [];
  let plies = []; // one per move: { uci, san, colour, mine, from, to, category, lost, best, reply, ... }
  let chances = []; // the player's winning chances (0–100) in each position
  let keys = []; // indexes into plies of the key moments, in the order of the game
  let at = 0; // the position on the board: 0 = start, k = after k moves
  let trying = null; // "Try again from here": { p, busy, solved }
  let cg = null;
  let visible = false;
  let tryTimer = null;

  // Names for screen readers (the buttons show only arrows).
  for (const [id, key] of [['rvFirst', 'rvFirst'], ['rvPrev', 'rvPrev'], ['rvNext', 'rvNext'], ['rvLast', 'rvLast'], ['rvChart', 'rvChartLabel'], ['rvMoves', 'rvMovesLabel']]) {
    $(id).setAttribute('aria-label', t(key));
  }

  // ---------- Opening and leaving ----------

  function open(e, about) {
    entry = e;
    $('rvAbout').textContent = about;
    $('rvDone').hidden = true;
    $('rvFailed').hidden = true;
    $('rvWorking').hidden = false;
    setProgress(0);
    visible = true;
    start();
  }

  function start() {
    token += 1;
    state = 'working';
    trying = null;
    const my = token;
    analyse(my).then((ok) => {
      if (my !== token || !ok) return;
      state = 'done';
      ready();
      if (!entry.reviewed) {
        entry.reviewed = true;
        ctx.onReviewed?.(entry);
      }
    }).catch(() => {
      if (my !== token) return;
      state = 'failed';
      $('rvWorking').hidden = true;
      $('rvFailed').hidden = false;
    });
  }

  // Leaving the screen stops the work; coming back carries on (positions already done are remembered).
  function hide() {
    visible = false;
    clearTimeout(tryTimer);
    if (state === 'working') {
      token += 1;
      state = 'paused';
    }
  }

  function show() {
    visible = true;
    if (state === 'paused') start();
    else if (state === 'done') {
      cg?.redrawAll();
      renderChart();
      goTo(at);
    }
  }

  function close() {
    hide();
    entry = null;
    state = 'idle';
  }

  $('rvBack').addEventListener('click', () => {
    close();
    ctx.onBack();
  });

  function setProgress(share) {
    const pct = Math.round(100 * share);
    $('rvProgress').style.width = `${pct}%`;
    $('rvProgressBar').setAttribute('aria-valuenow', String(pct));
  }

  // ---------- The work: every position of the game ----------

  async function analyse(my) {
    await engineReady;
    await openingsReady.catch(() => {});
    if (my !== token) return false;
    const c = new Chess();
    fens = [c.fen()];
    const moves = [];
    const overs = [null];
    for (const u of entry.moves) {
      moves.push(c.move(uciToMove(u)));
      fens.push(c.fen());
      overs.push(gameOverInfo(c));
    }
    const n = fens.length;
    const evals = new Array(n);
    let level = 0;
    const t0 = performance.now();
    let levelStart = t0;
    let levelCount = 0;
    for (let i = 0; i < n; i++) {
      if (overs[i]) {
        // From the side to move: checkmated, or a draw.
        evals[i] = { best: null, cp: overs[i].reason === 'checkmate' ? -10000 : 0 };
      } else {
        const depth = DEPTHS[level];
        const hit = cache.get(fens[i]);
        if (hit && hit.depth >= depth) evals[i] = hit;
        else {
          const r = await reviewSearch(fens[i], depth);
          if (my !== token) return false;
          evals[i] = { ...r, depth };
          cache.set(fens[i], evals[i]);
          if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
          levelCount += 1;
          // Slow device: when the rest would make the review too long, think less from now on.
          const now = performance.now();
          const perPosition = (now - levelStart) / levelCount;
          if (levelCount >= 4 && level < DEPTHS.length - 1 && now - t0 + perPosition * (n - 1 - i) > BUDGET) {
            level += 1;
            levelStart = now;
            levelCount = 0;
          }
        }
      }
      setProgress((i + 1) / n);
    }

    plies = moves.map((mv, i) => {
      const uci = uciOf(mv);
      const mine = mv.color === entry.colour;
      const p = {
        index: i, uci, san: mv.san, colour: mv.color, mine, from: mv.from, to: mv.to,
        fenBefore: fens[i], fenAfter: fens[i + 1], best: evals[i].best, reply: evals[i + 1].best,
        evalBefore: evals[i].cp, category: null, lost: 0,
      };
      if (mine) {
        Object.assign(p, gradeMove({
          evalBefore: evals[i].cp,
          evalAfter: -evals[i + 1].cp,
          isBest: evals[i].best === uci,
          checkmate: overs[i + 1]?.reason === 'checkmate',
          line: entry.moves.slice(0, i + 1),
          uci,
        }));
      }
      return p;
    });
    chances = evals.map((e, i) => {
      const mine = fens[i].split(' ')[1] === entry.colour;
      if (overs[i]?.reason === 'checkmate') return mine ? 0 : 100;
      return winChance(mine ? e.cp : -e.cp);
    });

    // Key moments: the player's biggest mistakes (? and ??), at most 3; with fewer than 2, the biggest
    // "not quite" moves (?!) make up the two.
    const mineWeak = plies.filter((p) => p.mine && p.best && p.best !== p.uci && WEAK.has(p.category)).sort((a, b) => b.lost - a.lost);
    const big = mineWeak.filter((p) => p.category !== 'inaccuracy').slice(0, 3);
    const extra = mineWeak.filter((p) => p.category === 'inaccuracy').slice(0, Math.max(0, 2 - big.length));
    keys = [...big, ...extra].map((p) => p.index).sort((a, b) => a - b);
    return true;
  }

  // ---------- The finished review ----------

  function ready() {
    $('rvWorking').hidden = true;
    $('rvDone').hidden = false;
    ensureBoard();
    renderSummary();
    // "No big mistakes" also when the key moments are only "not quite" (?!) moves.
    $('rvNoKey').hidden = keys.some((k) => plies[k].category !== 'inaccuracy');
    renderMoves();
    renderChart();
    goTo(keys.length ? keys[0] + 1 : 0, false);
  }

  function ensureBoard() {
    if (cg) return cg.redrawAll();
    cg = Chessground($('rvBoard'), {
      movable: { free: false, color: undefined, showDests: true, events: { after: onTryMove } },
      premovable: { enabled: false },
      drawable: { enabled: false, visible: true },
      highlight: { lastMove: true, check: true },
      animation: { enabled: true, duration: 200 },
    });
  }

  function renderSummary() {
    const counts = Object.fromEntries([...SUMMARY, 'book'].map((k) => [k, 0]));
    for (const p of plies) {
      if (!p.mine) continue;
      const k = p.category === 'checkmate' ? 'best' : p.category;
      if (counts[k] !== undefined) counts[k] += 1;
    }
    const names = t('rvMarkNames');
    const items = [...SUMMARY, ...(counts.book ? ['book'] : [])].map((k) => {
      const li = document.createElement('li');
      li.className = `rv-chip${counts[k] ? '' : ' none'}`;
      const b = document.createElement('span');
      b.className = `badge-mini ${k}`;
      b.textContent = MARK[k];
      b.setAttribute('aria-hidden', 'true');
      const n = document.createElement('strong');
      n.textContent = String(counts[k]);
      const name = document.createElement('span');
      name.textContent = names[k];
      li.append(b, name, n);
      return li;
    });
    $('rvSummary').replaceChildren(...items);
  }

  function renderMoves() {
    const rows = [];
    let row = null;
    plies.forEach((p, i) => {
      if (p.colour === 'w' || !row) {
        row = document.createElement('li');
        row.className = 'rv-row';
        const num = document.createElement('span');
        num.className = 'rv-num';
        num.textContent = `${p.fenBefore.split(' ')[5]}.`;
        row.append(num);
        if (p.colour === 'b') row.append(document.createElement('span'));
        rows.push(row);
      }
      const b = document.createElement('button');
      b.className = `rv-move${p.mine ? ' mine' : ''}${keys.includes(i) ? ' key' : ''}`;
      b.dataset.ply = String(i + 1);
      const san = document.createElement('span');
      san.textContent = p.san;
      b.append(san);
      if (p.mine && MARK[p.category]) {
        const m = document.createElement('span');
        m.className = `badge-mini ${p.category === 'checkmate' ? 'best' : p.category}`;
        m.textContent = MARK[p.category];
        b.append(m);
        b.setAttribute('aria-label', `${p.san}, ${t(GRADE_NAME[p.category])}`);
      }
      row.append(b);
    });
    $('rvMoves').replaceChildren(...rows);
  }

  $('rvMoves').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ply]');
    if (b) goTo(Number(b.dataset.ply));
  });

  // ---------- The chart of the advantage (the player's winning chances) ----------

  const PAD = 8;
  const chartX = (i, w) => (chances.length > 1 ? PAD + (i * (w - 2 * PAD)) / (chances.length - 1) : w / 2);

  function renderChart() {
    const svg = $('rvChart');
    if (!chances.length || !svg.clientWidth) return;
    const w = svg.clientWidth;
    const h = svg.clientHeight || 110;
    const y = (v) => 4 + ((100 - v) * (h - 8)) / 100;
    const mid = y(50);
    const pts = chances.map((v, i) => `${chartX(i, w).toFixed(1)},${y(v).toFixed(1)}`);
    const area = `M${chartX(0, w)},${mid} L${pts.join(' L')} L${chartX(chances.length - 1, w)},${mid} Z`;
    const ns = 'http://www.w3.org/2000/svg';
    const make = (tag, attrs) => {
      const e = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      return e;
    };
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const defs = make('defs', {});
    const up = make('clipPath', { id: 'rvClipUp' });
    up.append(make('rect', { x: 0, y: 0, width: w, height: mid }));
    const down = make('clipPath', { id: 'rvClipDown' });
    down.append(make('rect', { x: 0, y: mid, width: w, height: h - mid }));
    defs.append(up, down);
    const parts = [
      defs,
      make('path', { d: area, class: 'rv-area-up', 'clip-path': 'url(#rvClipUp)' }),
      make('path', { d: area, class: 'rv-area-down', 'clip-path': 'url(#rvClipDown)' }),
      make('line', { x1: 0, x2: w, y1: mid, y2: mid, class: 'rv-mid' }),
      make('polyline', { points: pts.join(' '), class: 'rv-line' }),
      make('line', { id: 'rvCursor', x1: 0, x2: 0, y1: 0, y2: h, class: 'rv-cursor' }),
    ];
    for (const k of keys) parts.push(make('circle', { cx: chartX(k + 1, w), cy: y(chances[k + 1]), r: 6, class: 'rv-key-dot' }));
    svg.replaceChildren(...parts);
    placeCursor();
  }

  function placeCursor() {
    const c = $('rvCursor');
    if (!c) return;
    const x = chartX(at, $('rvChart').clientWidth);
    c.setAttribute('x1', x);
    c.setAttribute('x2', x);
  }

  $('rvChart').addEventListener('click', (e) => {
    if (state !== 'done' || chances.length < 2) return;
    const box = $('rvChart').getBoundingClientRect();
    const step = (box.width - 2 * PAD) / (chances.length - 1);
    goTo(Math.round((e.clientX - box.left - PAD) / step));
  });

  if ('ResizeObserver' in window) new ResizeObserver(() => { if (state === 'done' && visible) renderChart(); }).observe($('rvChart'));

  // ---------- Going through the game ----------

  function goTo(k, sound = true) {
    if (state !== 'done') return;
    endTry();
    k = Math.max(0, Math.min(plies.length, k));
    const forward = k === at + 1;
    at = k;
    const p = plies[k - 1];
    const c = new Chess(fens[k]);
    cg.set({
      fen: fens[k],
      orientation: colourName(entry.colour),
      turnColor: colourName(c.turn()),
      check: c.inCheck() ? colourName(c.turn()) : false,
      lastMove: p ? [p.from, p.to] : undefined,
      movable: { color: undefined, dests: new Map() },
    });
    if (sound && forward && p) {
      const b = new Chess(p.fenBefore);
      playMove(b.move(uciToMove(p.uci)), b);
    }
    showBadge(p);
    const key = p ? keys.indexOf(p.index) : -1;
    const shapes = [];
    if (p?.mine && WEAK.has(p.category) && p.best && p.best !== p.uci) {
      shapes.push({ orig: p.best.slice(0, 2), dest: p.best.slice(2, 4), brush: 'green' });
      const r = key >= 0 && p.reply ? moveFacts(p.fenAfter, p.reply) : null;
      if (r && (r.checkmate || r.captured || r.fork || r.check)) shapes.push({ orig: r.from, dest: r.to, brush: 'red' });
    }
    cg.setAutoShapes(shapes);
    $('rvLegendGreen').hidden = !shapes.some((s) => s.brush === 'green');
    $('rvLegendRed').hidden = !shapes.some((s) => s.brush === 'red');
    $('rvLegend').hidden = !shapes.length;

    $('rvKeyLabel').hidden = key < 0;
    $('rvKeyLabel').textContent = key >= 0 ? fill(t('rvKeyMoment'), { n: key + 1, total: keys.length }) : '';
    $('rvText').textContent = explain(p, key >= 0);
    $('rvTry').hidden = key < 0;
    $('rvNextKey').hidden = !keys.length;
    $('rvAnswer').hidden = true;
    $('rvBackReview').hidden = true;
    $('rvFirst').disabled = k === 0;
    $('rvPrev').disabled = k === 0;
    $('rvNext').disabled = k === plies.length;
    $('rvLast').disabled = k === plies.length;

    document.querySelectorAll('#rvMoves .rv-move').forEach((b) => {
      const on = Number(b.dataset.ply) === k;
      b.classList.toggle('current', on);
      if (on) b.setAttribute('aria-current', 'true');
      else b.removeAttribute('aria-current');
    });
    const cur = $('rvMoves').querySelector('.current');
    const list = $('rvMoves');
    if (cur) list.scrollTop = Math.max(0, cur.offsetTop - list.clientHeight / 2);
    else if (k === 0) list.scrollTop = 0;
    placeCursor();
  }

  // What happened in a move, in the coach's words (sentences from i18n.js, no AI).
  function explain(p, key) {
    if (!p) return t('rvStart');
    if (!p.mine) return fill(t('rvComputerMove'), { san: p.san });
    let text = `${fill(t('rvYouPlayed'), { san: p.san })} ${t('rvGrade')[p.category] || ''}`.trim();
    if (WEAK.has(p.category) && p.best && p.best !== p.uci) {
      const best = moveFacts(p.fenBefore, p.best);
      if (key) {
        const fact = mistakeFact(p, best);
        if (fact) text += ` ${fact}`;
      }
      text += ` ${fill(t('rvBetter'), { san: best.san })} ${lines.hintExplanation(COACH, best)}`;
    }
    return text;
  }

  // The first sentence of the coach's words after a mistake in the Play tab (what the opponent can do
  // now, or what was missed), without the nudge to look again.
  function mistakeFact(p, b) {
    const r = p.reply ? moveFacts(p.fenAfter, p.reply) : null;
    const pc = (name) => t('pieces')[name] || name;
    if (r?.checkmate) return lines.line(COACH, 'replyMate');
    if (r?.captured && r.captured.piece !== 'pawn') return lines.line(COACH, 'replyCapture', { piece: pc(r.pieceName), from: r.from, captured: pc(r.captured.piece) });
    if (r?.fork) return lines.line(COACH, 'replyFork', { piece: pc(r.pieceName), from: r.from });
    if (b.checkmate) return lines.line(COACH, 'missedMate');
    if (b.captured && b.captured.piece !== 'pawn') return lines.line(COACH, 'missedCapture', { captured: pc(b.captured.piece), square: b.captured.square });
    if (r?.captured) return lines.line(COACH, 'replyCapture', { piece: pc(r.pieceName), from: r.from, captured: pc(r.captured.piece) });
    return lines.line(COACH, 'mistakeGeneral');
  }

  // The player's mark on the square the piece went to.
  function showBadge(p) {
    const b = $('rvBadge');
    if (!p?.mine || !MARK[p.category]) {
      b.hidden = true;
      return;
    }
    const white = entry.colour === 'w';
    const file = 'abcdefgh'.indexOf(p.to[0]);
    const rank = Number(p.to[1]);
    b.style.left = `${((white ? file : 7 - file) + 1) * 12.5}%`;
    b.style.top = `${(white ? 8 - rank : rank - 1) * 12.5}%`;
    b.textContent = MARK[p.category];
    b.className = `badge ${p.category === 'checkmate' ? 'best' : p.category}`;
    b.hidden = false;
  }

  $('rvFirst').addEventListener('click', () => goTo(0));
  $('rvPrev').addEventListener('click', () => goTo(at - 1));
  $('rvNext').addEventListener('click', () => goTo(at + 1));
  $('rvLast').addEventListener('click', () => goTo(plies.length));
  $('rvNextKey').addEventListener('click', () => {
    if (!keys.length) return;
    const next = keys.find((k) => k + 1 > at) ?? keys[0];
    goTo(next + 1, false);
  });
  document.addEventListener('keydown', (e) => {
    if (!visible || state !== 'done' || $('rkReview').hidden || !$('rkConfirm').hidden) return;
    if (e.target.closest?.('input, select, textarea')) return;
    if (e.key === 'ArrowLeft') goTo(at - 1);
    else if (e.key === 'ArrowRight') goTo(at + 1);
    else return;
    e.preventDefault();
  });

  // ---------- "Try again from here": find a better move, like a puzzle ----------

  $('rvTry').addEventListener('click', () => {
    const p = plies[at - 1];
    if (!p || !keys.includes(p.index)) return;
    trying = { p, busy: false, solved: false };
    setTryBoard();
    $('rvKeyLabel').hidden = false;
    $('rvText').textContent = t('rvTryAsk');
    $('rvTry').hidden = true;
    $('rvNextKey').hidden = true;
    $('rvAnswer').hidden = false;
    $('rvBackReview').hidden = false;
    $('rvLegend').hidden = true;
  });

  // The position before the player's move, the player to move.
  function setTryBoard() {
    const { p } = trying;
    const prev = plies[p.index - 1];
    const c = new Chess(p.fenBefore);
    const dests = new Map();
    for (const mv of c.moves({ verbose: true })) {
      if (!dests.has(mv.from)) dests.set(mv.from, []);
      dests.get(mv.from).push(mv.to);
    }
    $('rvBadge').hidden = true;
    cg.setAutoShapes([]);
    cg.set({
      fen: p.fenBefore,
      turnColor: colourName(c.turn()),
      check: c.inCheck() ? colourName(c.turn()) : false,
      lastMove: prev ? [prev.from, prev.to] : undefined,
      movable: { color: colourName(entry.colour), dests },
    });
  }

  async function onTryMove(orig, dest) {
    if (!trying || trying.busy || trying.solved) return;
    const tr = trying;
    const c = new Chess(tr.p.fenBefore);
    // A pawn that reaches the last row becomes a queen here.
    const piece = c.get(orig);
    const promotion = piece?.type === 'p' && (dest[1] === '8' || dest[1] === '1') ? 'q' : undefined;
    let mv;
    try {
      mv = c.move({ from: orig, to: dest, promotion });
    } catch {
      return setTryBoard();
    }
    playMove(mv, c);
    const uci = uciOf(mv);
    tr.busy = true;
    cg.set({ movable: { color: undefined, dests: new Map() } });
    let right = uci === tr.p.best || c.isCheckmate();
    if (!right) {
      $('rvText').textContent = t('rvChecking');
      const over = gameOverInfo(c);
      let after = 0;
      try {
        if (!over) {
          const hit = cache.get(c.fen());
          const r = hit && hit.depth >= DEPTHS[0] ? hit : await reviewSearch(c.fen(), DEPTHS[0]);
          if (!hit) cache.set(c.fen(), { ...r, depth: DEPTHS[0] });
          after = -r.cp;
        }
      } catch {
        after = -Infinity;
      }
      if (trying !== tr) return;
      right = winChance(tr.p.evalBefore) - winChance(after) < RIGHT;
    }
    tr.busy = false;
    const facts = moveFacts(tr.p.fenBefore, uci);
    if (right) {
      tr.solved = true;
      play('right');
      confetti();
      $('rvText').textContent = `${t('rvTryRight')} ${lines.hintExplanation(COACH, facts)}`;
      $('rvAnswer').hidden = true;
      return;
    }
    play('wrong');
    const best = moveFacts(tr.p.fenBefore, tr.p.best);
    $('rvText').textContent = `${lines.puzzleLine(COACH, 'pzWrong')} ${lines.hintQuestion(COACH, best)}`;
    clearTimeout(tryTimer);
    tryTimer = setTimeout(() => {
      if (trying === tr && !tr.solved) setTryBoard();
    }, 900);
  }

  $('rvAnswer').addEventListener('click', () => {
    if (!trying) return;
    const tr = trying;
    tr.solved = true;
    clearTimeout(tryTimer);
    setTryBoard();
    cg.set({ movable: { color: undefined, dests: new Map() } });
    const best = moveFacts(tr.p.fenBefore, tr.p.best);
    cg.setAutoShapes([{ orig: best.from, dest: best.to, brush: 'green' }]);
    $('rvText').textContent = `${fill(t('rvTheAnswer'), { san: best.san })} ${lines.hintExplanation(COACH, best)}`;
    $('rvAnswer').hidden = true;
    $('rvLegend').hidden = false;
    $('rvLegendGreen').hidden = false;
    $('rvLegendRed').hidden = true;
  });

  $('rvBackReview').addEventListener('click', () => goTo(at, false));

  function endTry() {
    clearTimeout(tryTimer);
    trying = null;
  }

  return {
    open,
    hide,
    show,
    close,
    get state() {
      return {
        state,
        at,
        moves: plies.length,
        keys: keys.map((k) => k + 1),
        marks: plies.map((p) => (p.mine ? p.category : null)),
        chances: chances.map((v) => Math.round(v)),
        trying: trying ? { ply: trying.p.index + 1, solved: trying.solved, busy: trying.busy, best: trying.p.best } : null,
        text: $('rvText').textContent,
        shapes: cg ? cg.state.drawable.autoShapes.map((s) => `${s.brush}:${s.orig}${s.dest || ''}`) : [],
      };
    },
  };
}
