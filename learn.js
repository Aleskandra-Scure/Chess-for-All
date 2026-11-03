// Learn mode: short lessons with its own board and coach messages. The game in the Play tab and
// the puzzles are left untouched. Each lesson: the coach explains the idea, a little animation shows
// it on the board, then the child does 2–3 small challenges. Positions and challenges are in
// lessons.js, the words in i18n.js. Nothing is saved: a lesson starts from the beginning every time.
import { Chessground } from './vendor/chessground/chessground.js';
import { Chess } from './vendor/chess.js/chess.js';
import { LESSONS, GROUPS, EMPTY } from './lessons.js';
import * as lines from './coach-lines.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const colourName = (c) => (c === 'w' ? 'white' : 'black');
const other = (c) => (c === 'w' ? 'b' : 'w');
const PIECE = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const uciMove = (uci) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });

// Lesson positions may have no kings, so chess.js is told not to check the position itself.
const load = (fen) => new Chess(fen, { skipValidation: true });

// The same side moves again (in the animations and between the moves of a challenge).
function withTurn(c, colour) {
  if (c.turn() === colour) return;
  const f = c.fen().split(' ');
  f[1] = colour;
  f[3] = '-';
  c.load(f.join(' '), { skipValidation: true });
}

// ---------- Challenges (no page needed, so they can be tested on their own) ----------

export function challengeState(def) {
  const chess = load(def.fen);
  // With `pre` moves the opponent starts, so the player has the other colour.
  const colour = def.pre ? other(chess.turn()) : chess.turn();
  return { chess, colour, stars: new Set(def.stars || []), moves: [] };
}

function enemiesLeft(c, colour) {
  return c.board().flat().filter((x) => x && x.color === other(colour) && x.type !== 'k').length;
}

// 'done', 'progress' (a fine move on the way) or 'wrong'. `mv` has already been played.
function judge(def, ch, mv) {
  const c = ch.chess;
  const them = other(ch.colour);
  switch (def.goal) {
    case 'stars':
      ch.stars.delete(mv.to);
      return ch.stars.size ? 'progress' : 'done';
    case 'captureAll':
      return enemiesLeft(c, ch.colour) ? 'progress' : 'done';
    case 'capture':
      if (!mv.captured || (def.target && mv.to !== def.target) || (def.piece && mv.captured !== def.piece)) return 'wrong';
      return 'done';
    case 'mate':
      return c.isCheckmate() ? 'done' : 'wrong';
    case 'escape': {
      const way = mv.piece === 'k' ? 'king' : mv.captured ? 'capture' : 'block';
      return !def.way || def.way === way ? 'done' : 'wrong';
    }
    case 'castle': {
      const side = mv.flags.includes('k') ? 'k' : mv.flags.includes('q') ? 'q' : null;
      return side && (!def.side || def.side === side) ? 'done' : 'wrong';
    }
    case 'promote':
      if (!mv.promotion) return mv.piece === 'p' ? 'progress' : 'wrong';
      return !def.piece || def.piece === mv.promotion ? 'done' : 'wrong';
    case 'enPassant':
      return mv.flags.includes('e') ? 'done' : 'wrong';
    case 'draw':
      return c.isDraw() ? 'done' : 'wrong';
    case 'move':
      return (!def.piece || mv.piece === def.piece) && def.to.includes(mv.to) ? 'done' : 'wrong';
    case 'safe':
      return mv.piece === def.piece && !c.isAttacked(mv.to, them) ? 'done' : 'wrong';
    case 'defend':
      return c.get(def.square)?.color === ch.colour && c.isAttacked(def.square, ch.colour) ? 'done' : 'wrong';
    default:
      return 'wrong';
  }
}

// Tries the child's move. Returns { result: 'illegal' | 'wrong' | 'progress' | 'done', reason, mv }.
// A wrong move is taken back; after a move on the way it is the player's turn again.
export function tryMove(def, ch, uci) {
  const c = ch.chess;
  let { from, to, promotion } = uciMove(uci);
  // Dropping the king on its own rook means castling.
  const piece = c.get(from);
  const target = c.get(to);
  if (piece?.type === 'k' && target?.type === 'r' && target.color === piece.color && from[1] === to[1]) {
    to = (to[0] > from[0] ? 'g' : 'c') + from[1];
  }
  if (def.only && piece && piece.type !== def.only) return { result: 'wrong', reason: 'only' };
  const before = c.fen();
  let mv = null;
  try {
    mv = c.move({ from, to, promotion });
  } catch { /* illegal */ }
  if (!mv) return { result: 'illegal' };
  const result = judge(def, ch, mv);
  if (result === 'wrong') {
    c.load(before, { skipValidation: true });
    return { result, mv };
  }
  ch.moves.push(mv.from + mv.to + (mv.promotion || ''));
  if (result === 'progress') withTurn(c, ch.colour);
  return { result, mv };
}

// ---------- Shapes ----------

// A five-pointed star, drawn on the square (custom SVG in a 100 × 100 box).
const STAR = (() => {
  const pts = [];
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 ? 15 : 36;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${(50 + r * Math.cos(a)).toFixed(1)},${(53 + r * Math.sin(a)).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(' ')}" fill="#f6c343" stroke="#b5821b" stroke-width="4" stroke-linejoin="round"/>`;
})();

const labelSvg = (text) => `<text x="50" y="50" dy="0.35em" text-anchor="middle" font-family="system-ui, sans-serif" font-size="${text.length > 1 ? 40 : 52}" font-weight="800" fill="#2b2620" stroke="#ffffff" stroke-width="8" paint-order="stroke">${text}</text>`;

function demoShapes(s) {
  const list = [];
  for (const a of s.arrows || []) {
    const [uci, brush = 'green'] = a.split(':');
    list.push({ orig: uci.slice(0, 2), dest: uci.slice(2, 4), brush });
  }
  for (const x of s.circles || []) {
    const [sq, brush = 'green'] = x.split(':');
    list.push({ orig: sq, brush });
  }
  for (const [sq, text] of Object.entries(s.labels || {})) list.push({ orig: sq, customSvg: { html: labelSvg(text), center: 'label' } });
  return list;
}

// ctx: { t, coach(), addMessage(text, kind, box), speak, react, refreshMood, play() }
export function createLearn(ctx) {
  const { t } = ctx;
  let cg = null;
  let index = null; // the open lesson (position in LESSONS), null while the list is shown
  let step = -1; // -1 while the animation plays, then the number of the challenge
  let ch = null; // the challenge on the board
  let finished = false;
  let seq = 0; // a newer lesson or step makes older timers stop
  let welcomed = false;
  let shapes = []; // arrows, circles and labels (animation or hint)
  let marks = new Map(); // coloured squares

  const lesson = () => LESSONS[index];
  const words = () => t('lessons')[lesson().id];
  const box = () => $('lnMessages');
  const coachId = () => ctx.coach().id;

  // ---------- Coach messages ----------

  function say(text, kind = '') {
    if (!text) return;
    ctx.addMessage(text, kind, box());
    ctx.speak(text);
  }

  function divider() {
    const last = box().lastElementChild;
    if (!last || last.classList.contains('divider')) return;
    const d = document.createElement('div');
    d.className = 'divider';
    d.textContent = '· · ·';
    box().append(d);
  }

  // Waits for the coach to finish speaking (at least `min`, at most 10 s) so the next sentence does not cut it off.
  async function speechDone(my, min = 0) {
    const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
    const start = Date.now();
    await sleep(min);
    while (my === seq && synth && (synth.speaking || synth.pending) && Date.now() - start < 10000) await sleep(150);
    return my === seq;
  }

  // ---------- Lesson list ----------

  function icon(name) {
    const el = document.createElement('span');
    el.setAttribute('aria-hidden', 'true');
    if (Object.values(PIECE).includes(name)) {
      el.className = 'cg-wrap ln-icon';
      const p = document.createElement('piece');
      p.className = `white ${name}`;
      el.append(p);
    } else {
      el.className = 'ln-icon';
      el.textContent = name;
    }
    return el;
  }

  function renderList() {
    $('lnGroups').replaceChildren(...GROUPS.map((g) => {
      const group = document.createElement('section');
      group.className = 'ln-group';
      const title = document.createElement('h3');
      title.textContent = t('lnGroups')[g];
      const cards = document.createElement('div');
      cards.className = 'ln-cards';
      LESSONS.forEach((l, i) => {
        if (l.group !== g) return;
        const card = document.createElement('button');
        card.className = 'ln-card';
        card.dataset.lesson = String(i);
        const num = document.createElement('span');
        num.className = 'ln-num';
        num.textContent = String(i + 1);
        const name = document.createElement('span');
        name.textContent = t('lessons')[l.id].title;
        card.append(num, icon(l.icon), name);
        cards.append(card);
      });
      group.append(title, cards);
      return group;
    }));
  }

  $('lnGroups').addEventListener('click', (e) => {
    const card = e.target.closest('[data-lesson]');
    if (card) open(Number(card.dataset.lesson));
  });

  function showList() {
    seq += 1;
    index = null;
    ch = null;
    finished = false;
    $('lnLesson').hidden = true;
    $('lnList').hidden = false;
    ctx.refreshMood();
  }

  // ---------- Board ----------

  function ensureBoard() {
    if (cg) return cg.redrawAll();
    cg = Chessground($('lnBoard'), {
      fen: EMPTY,
      movable: { free: false, color: undefined, showDests: false, events: { after: onMove } },
      premovable: { enabled: false },
      highlight: { lastMove: true, check: true },
      animation: { enabled: true, duration: 300 },
      events: { select: onSelect },
    });
  }

  // A new position appears at once; pieces do not fly over from the last one.
  function jump(apply) {
    cg.set({ animation: { enabled: false } });
    apply();
    cg.set({ animation: { enabled: true } });
  }

  function draw() {
    const list = [...shapes];
    if (ch) for (const sq of ch.stars) list.push({ orig: sq, customSvg: { html: STAR, center: 'label' } });
    cg.setAutoShapes(list);
    cg.set({ highlight: { custom: marks } });
  }

  // Every piece may be put on any square without a piece of its own colour, so the child can also try
  // a move that is not allowed and hear why. The king may also be put on its rook to castle.
  function targets() {
    const c = ch.chess;
    const map = new Map();
    const empty = [];
    for (const f of 'abcdefgh') for (let r = 1; r <= 8; r += 1) if (!c.get(f + r) || c.get(f + r).color !== ch.colour) empty.push(f + r);
    for (const row of c.board()) {
      for (const x of row) {
        if (!x || x.color !== ch.colour) continue;
        const list = [...empty];
        if (x.type === 'k') {
          for (const mv of c.moves({ square: x.square, verbose: true })) {
            if (mv.flags.includes('k')) list.push(`h${x.square[1]}`);
            if (mv.flags.includes('q')) list.push(`a${x.square[1]}`);
          }
        }
        map.set(x.square, list);
      }
    }
    return map;
  }

  // The squares the piece can really go to: shown as dots after a wrong try.
  function legalSquares(square) {
    return new Map(ch.chess.moves({ square, verbose: true }).map((mv) => [mv.to, 'ln-dest']));
  }

  const playersTurn = () => Boolean(ch && !ch.busy && !finished && ch.def.goal !== 'tap');

  function sync() {
    const c = ch.chess;
    const mine = playersTurn();
    cg.set({
      fen: c.fen(),
      turnColor: colourName(c.turn()),
      check: c.inCheck() ? colourName(c.turn()) : false,
      lastMove: ch.last,
      movable: { color: mine ? colourName(ch.colour) : undefined, dests: mine ? targets() : new Map() },
    });
    draw();
    refreshInfo();
  }

  function setStatus(text) {
    $('lnStatus').textContent = text || '';
  }

  // Stars or pieces still to collect.
  function refreshInfo() {
    const el = $('lnInfo');
    let text = '';
    if (ch?.def.goal === 'stars' && ch.stars.size) text = t('lnStarsLeft').replace('{n}', ch.stars.size);
    else if (ch?.def.goal === 'captureAll' && !finished) text = t('lnPiecesLeft').replace('{n}', enemiesLeft(ch.chess, ch.colour));
    el.textContent = text;
    el.hidden = !text;
  }

  // Watch, then one dot per challenge.
  function refreshSteps() {
    const items = [{ text: '👁', label: t('lnStepWatch'), done: step >= 0, current: step === -1 }];
    lesson().challenges.forEach((_, k) => items.push({
      text: String(k + 1),
      label: t('lnStep').replace('{n}', k + 1),
      done: k < step || finished,
      current: k === step && !finished,
    }));
    $('lnSteps').replaceChildren(...items.map((x) => {
      const li = document.createElement('li');
      li.textContent = x.text;
      li.title = x.label;
      li.setAttribute('aria-label', x.label);
      li.classList.toggle('done', x.done);
      li.classList.toggle('current', x.current);
      if (x.current) li.setAttribute('aria-current', 'step');
      return li;
    }));
    $('lnReplay').disabled = step === -1;
  }

  // ---------- Lesson flow ----------

  async function open(i) {
    const my = ++seq;
    index = i;
    finished = false;
    $('lnList').hidden = true;
    $('lnLesson').hidden = false;
    $('lnDone').hidden = true;
    $('lnPromo').hidden = true;
    ensureBoard();
    $('lnTitle').textContent = `${i + 1}. ${words().title}`;
    divider();
    ctx.refreshMood();
    say(words().intro);
    if (!(await playDemo(my))) return;
    if (!(await speechDone(my, 300))) return;
    startChallenge(0, my);
  }

  async function playDemo(my) {
    step = -1;
    ch = null;
    shapes = [];
    marks = new Map();
    refreshSteps();
    refreshInfo();
    setStatus(t('lnWatching'));
    cg.set({ orientation: 'white', movable: { color: undefined, dests: new Map() } });
    let c = load(EMPTY);
    for (const s of lesson().demo) {
      if (my !== seq) return false;
      if (s.fen) {
        c = load(s.fen);
        shapes = [];
        marks = new Map();
        jump(() => cg.set({ fen: c.fen(), lastMove: undefined, check: false }));
      }
      if (s.clear) {
        shapes = [];
        marks = new Map();
      }
      if (s.move) {
        const m = uciMove(s.move);
        withTurn(c, c.get(m.from).color);
        const mv = c.move(m);
        cg.set({ fen: c.fen(), lastMove: [mv.from, mv.to], check: c.inCheck() ? colourName(c.turn()) : false });
      }
      if (s.arrows || s.circles || s.labels) shapes = demoShapes(s);
      if (s.marks) marks = new Map(s.marks.map((sq) => [sq, 'ln-mark']));
      draw();
      await sleep(s.wait ?? (s.move ? 900 : 1200));
    }
    if (my !== seq) return false;
    shapes = [];
    marks = new Map();
    draw();
    return true;
  }

  async function startChallenge(k, my) {
    const def = lesson().challenges[k];
    step = k;
    finished = false;
    ch = { def, ...challengeState(def), wrong: 0, busy: true, showDests: false, last: undefined };
    shapes = [];
    marks = new Map();
    jump(() => {
      cg.set({ orientation: colourName(ch.colour), lastMove: undefined });
      sync();
    });
    refreshSteps();
    if (def.pre) {
      setStatus(t('lnWatching'));
      for (const uci of def.pre) {
        await sleep(800);
        if (my !== seq) return;
        const mv = ch.chess.move(uciMove(uci));
        ch.last = [mv.from, mv.to];
        sync();
      }
      await sleep(300);
      if (my !== seq) return;
    }
    ch.busy = false;
    sync();
    const task = words().challenges[k].task;
    setStatus(task);
    say(task);
  }

  // Promotion: the same four big buttons as in the game; a tap elsewhere cancels the move.
  function choosePromotion() {
    document.querySelectorAll('#lnPromo piece').forEach((p) => {
      p.classList.toggle('white', ch.colour === 'w');
      p.classList.toggle('black', ch.colour === 'b');
    });
    $('lnPromo').hidden = false;
    return new Promise((resolve) => {
      $('lnPromo').onclick = (e) => {
        const btn = e.target.closest('[data-promo]');
        if (!btn && e.target.closest('.promo-card')) return;
        $('lnPromo').hidden = true;
        $('lnPromo').onclick = null;
        resolve(btn ? btn.dataset.promo : null);
      };
    });
  }

  async function onMove(orig, dest) {
    if (!playersTurn()) return;
    const my = seq;
    const c = ch.chess;
    let promotion = '';
    const pawn = c.get(orig)?.type === 'p';
    if (pawn && (dest[1] === '8' || dest[1] === '1') && c.moves({ square: orig, verbose: true }).some((m) => m.to === dest)) {
      ch.busy = true;
      promotion = await choosePromotion();
      if (my !== seq) return;
      ch.busy = false;
      if (!promotion) return sync();
    }
    const r = tryMove(ch.def, ch, orig + dest + promotion);
    if (r.result === 'illegal' || r.result === 'wrong') return wrong(my, r, dest);
    ch.last = [r.mv.from, r.mv.to];
    shapes = [];
    marks = new Map();
    sync();
    if (r.result === 'done') success(my, r.mv.to);
  }

  // Board lesson: tapping squares. In the other lessons, after a wrong try, the chosen piece shows its moves.
  function onSelect(key) {
    if (playersTurn()) {
      if (!ch.showDests) return;
      marks = ch.chess.get(key)?.color === ch.colour ? legalSquares(key) : new Map();
      return draw();
    }
    if (!ch || ch.busy || finished || ch.def.goal !== 'tap') return;
    const my = seq;
    if (ch.def.squares.includes(key)) {
      ch.moves.push(key);
      success(my, key);
    } else {
      wrong(my, { result: 'wrong' }, key);
    }
  }

  // The hint for a wrong try: why the move is not allowed, or what to look for.
  function hintText(r) {
    const w = words().challenges[step];
    if (r.reason === 'only') return t('lnOnly').replace('{piece}', t('pieces')[PIECE[ch.def.only]]);
    if (r.result === 'illegal') return w.illegal || words().rule || w.hint;
    return w.hint;
  }

  // After two wrong tries the right move is shown, if the child is still on the way of the solution.
  function solutionShape() {
    const sol = ch.def.solution || [];
    const n = ch.moves.length;
    if (sol.slice(0, n).join() !== ch.moves.join() || !sol[n]) return [];
    if (ch.def.goal === 'tap') return [{ orig: sol[n], brush: 'green' }];
    return [{ orig: sol[n].slice(0, 2), dest: sol[n].slice(2, 4), brush: 'green' }];
  }

  // The piece goes back, the coach gives a short hint, and the possible moves are shown from now on.
  async function wrong(my, r, square) {
    ch.busy = true;
    ch.wrong += 1;
    cg.set({ movable: { color: undefined, dests: new Map() } });
    marks = new Map([[square, 'ln-wrong']]);
    draw();
    say(`${lines.line(coachId(), 'learnWrong')} ${hintText(r)}`, 'warn');
    ctx.react('worried');
    await sleep(700);
    if (my !== seq) return;
    marks = new Map();
    ch.busy = false;
    ch.showDests = true;
    if (ch.wrong >= 2) shapes = solutionShape();
    sync();
  }

  async function success(my, square) {
    ch.busy = true;
    shapes = [];
    marks = new Map([[square, 'ln-right']]);
    sync();
    if (step === lesson().challenges.length - 1) return finish(my);
    ctx.react('happy', 2500);
    say(lines.line(coachId(), 'learnRight'));
    if (!(await speechDone(my, 1300))) return;
    startChallenge(step + 1, my);
  }

  async function finish(my) {
    finished = true;
    refreshSteps();
    refreshInfo();
    setStatus(t('lnLessonDone'));
    ctx.react('celebrate', 6000);
    say(lines.line(coachId(), 'learnDone'));
    await sleep(1200);
    if (my !== seq) return;
    $('lnNext').hidden = index >= LESSONS.length - 1;
    $('lnDone').hidden = false;
  }

  // Watch again: the animation, then the same challenge from the start (or the end of the lesson).
  async function replay() {
    if (index === null || step === -1) return;
    const my = ++seq;
    const k = step;
    const wasFinished = finished;
    $('lnDone').hidden = true;
    $('lnPromo').hidden = true;
    finished = false;
    ctx.refreshMood();
    say(words().intro);
    if (!(await playDemo(my))) return;
    if (!(await speechDone(my, 300))) return;
    if (wasFinished) {
      step = lesson().challenges.length - 1;
      finished = true;
      refreshSteps();
      setStatus(t('lnLessonDone'));
      ctx.refreshMood();
      $('lnDone').hidden = false;
      return;
    }
    startChallenge(k, my);
  }

  // ---------- Buttons ----------

  $('lnReplay').addEventListener('click', replay);
  $('lnBack').addEventListener('click', showList);
  $('lnBackDone').addEventListener('click', showList);
  $('lnNext').addEventListener('click', () => {
    if (index !== null && index < LESSONS.length - 1) open(index + 1);
  });
  $('lnTryGame').addEventListener('click', () => ctx.play());

  renderList();

  return {
    show() {
      if (cg && index !== null) cg.redrawAll();
      if (!welcomed) {
        welcomed = true;
        say(lines.line(coachId(), 'learnWelcome'));
      }
    },
    // Face for the coach while in Learn mode.
    mood() {
      return finished ? 'celebrate' : 'neutral';
    },
    // For tests: what is on the screen (memory only).
    get state() {
      return {
        lesson: index === null ? null : lesson().id,
        step,
        ready: playersTurn() || Boolean(ch && !ch.busy && !finished && ch.def.goal === 'tap'),
        finished,
        stars: ch ? [...ch.stars] : [],
        fen: ch ? ch.chess.fen() : null,
        orientation: ch ? colourName(ch.colour) : 'white',
      };
    },
  };
}
