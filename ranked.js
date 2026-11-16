// Ranked: climb a tower of 18 floors (Pawn I at the bottom to King III at the top) in each time
// control. Every floor has a computer that is a little stronger than the one below. Wins fill the
// bar of the floor, a draw fills it a little, a loss takes a little away; a full bar moves the player
// up, and a loss on an empty bar moves them down (except for the first two losses after moving up).
//
// This is the only part of Chess for All that keeps anything: the progress of each time control
// (and an unfinished game) in localStorage on this device. Nothing is ever sent anywhere.
import { Chessground } from './vendor/chessground/chessground.js';
import { Chess } from './vendor/chess.js/chess.js';
import { engineReady, rankedMove, gameOverInfo } from './analysis.js';
import { play, playMove } from './sounds.js';
import { confetti } from './confetti.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const colourName = (c) => (c === 'w' ? 'white' : 'black');
const other = (c) => (c === 'w' ? 'b' : 'w');
const uciMove = (uci) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });

// Minutes for the game and seconds added after each move; `minutes: 0` is no clock at all.
export const TIME_CONTROLS = [
  { id: 'bullet', minutes: 2, inc: 1, icon: '⚡' },
  { id: 'blitz3', minutes: 3, inc: 2, icon: '🔥' },
  { id: 'blitz5', minutes: 5, inc: 3, icon: '🔥' },
  { id: 'rapid10', minutes: 10, inc: 0, icon: '⏱️' },
  { id: 'rapid15', minutes: 15, inc: 10, icon: '⏱️' },
  { id: 'nolimit', minutes: 0, inc: 0, icon: '♾️' },
];
const tcById = (id) => TIME_CONTROLS.find((tc) => tc.id === id);

// The floors from the bottom. Strength: Stockfish Skill Level, search depth and a share of random
// moves. Pawn I is weaker than opponent level 1, King III plays exactly like level 10; every second
// or third floor matches one of the levels 1–10 (marked), with even steps in between.
// `wins`: wins needed to fill the bar (a draw counts DRAW of a win, a loss takes LOSS of a win away).
const RANKS = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
const STAGES = ['I', 'II', 'III'];
export const FLOORS = [
  { skill: 0, depth: 1, random: 0.65, wins: 2 }, // Pawn I
  { skill: 0, depth: 1, random: 0.5, wins: 2 }, //   Pawn II   = level 1
  { skill: 0, depth: 1, random: 0.4, wins: 2 }, //   Pawn III
  { skill: 0, depth: 1, random: 0.3, wins: 3 }, //   Knight I  = level 2
  { skill: 0, depth: 2, random: 0.22, wins: 3 }, //  Knight II
  { skill: 1, depth: 2, random: 0.15, wins: 3 }, //  Knight III = level 3
  { skill: 2, depth: 3, random: 0.1, wins: 3 }, //   Bishop I
  { skill: 3, depth: 3, random: 0.05, wins: 3 }, //  Bishop II = level 4
  { skill: 4, depth: 4, random: 0.02, wins: 3 }, //  Bishop III
  { skill: 5, depth: 4, random: 0, wins: 4 }, //     Rook I    = level 5
  { skill: 6, depth: 5, random: 0, wins: 4 }, //     Rook II
  { skill: 8, depth: 6, random: 0, wins: 4 }, //     Rook III  = level 6
  { skill: 10, depth: 7, random: 0, wins: 4 }, //    Queen I
  { skill: 11, depth: 8, random: 0, wins: 4 }, //    Queen II  = level 7
  { skill: 13, depth: 9, random: 0, wins: 4 }, //    Queen III
  { skill: 14, depth: 10, random: 0, wins: 5 }, //   King I    = level 8
  { skill: 17, depth: 12, random: 0, wins: 5 }, //   King II   = level 9
  { skill: 20, depth: 14, random: 0, wins: 5 }, //   King III  = level 10
].map((f, i) => ({ ...f, rank: RANKS[Math.floor(i / 3)], stage: STAGES[i % 3] }));
const TOP = FLOORS.length - 1;
const DRAW = 0.4; // a draw fills this much of one win
const LOSS = 0.5; // a loss takes this much of one win away
const SHIELD = 2; // losses after moving up that never move the player down

// ---------- Saved progress (localStorage, this device only) ----------

const KEY = 'chess-for-all-ranked';
let storageOk = true;

const fresh = () => ({ floor: 0, progress: 0, best: 0, shield: 0, wins: 0, draws: 0, losses: 0, game: null });
const num = (v, lo, hi, d = lo) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

function load() {
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    storageOk = false;
  }
  const data = {};
  for (const tc of TIME_CONTROLS) {
    const r = raw?.[tc.id] || {};
    const rec = fresh();
    rec.floor = Math.round(num(r.floor, 0, TOP));
    rec.progress = num(r.progress, 0, FLOORS[rec.floor].wins);
    rec.best = Math.round(num(r.best, rec.floor, TOP, rec.floor));
    rec.shield = Math.round(num(r.shield, 0, SHIELD));
    for (const k of ['wins', 'draws', 'losses']) rec[k] = Math.round(num(r[k], 0, 1e6));
    rec.game = validGame(r.game) ? r.game : null;
    data[tc.id] = rec;
  }
  return data;
}

function validGame(g) {
  if (!g || !Array.isArray(g.moves) || !['w', 'b'].includes(g.colour)) return false;
  try {
    const c = new Chess();
    for (const m of g.moves) c.move(uciMove(m));
    return !c.isGameOver() && Number.isInteger(g.floor) && g.floor >= 0 && g.floor <= TOP;
  } catch {
    return false;
  }
}

function store() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    storageOk = true;
  } catch {
    storageOk = false;
  }
}

let data = load();

// ---------- Rules: who can still give checkmate ----------

// True when `colour` has too little left to ever checkmate, so running out of time is only a draw.
export function cannotMate(chess, colour) {
  const mine = [];
  const theirs = [];
  for (const row of chess.board()) {
    for (const p of row) {
      if (p && p.type !== 'k') (p.color === colour ? mine : theirs).push(p);
    }
  }
  if (!mine.length) return true;
  if (mine.some((p) => 'pqr'.includes(p.type))) return false;
  const shade = (sq) => (sq.charCodeAt(0) + Number(sq[1])) % 2;
  if (mine.length === 1 && mine[0].type === 'n') return theirs.every((p) => p.type === 'q');
  if (mine.every((p) => p.type === 'b')) {
    const s = shade(mine[0].square);
    return mine.every((p) => shade(p.square) === s) && theirs.every((p) => p.type === 'b' && shade(p.square) === s);
  }
  return false;
}

// ---------- The mode ----------

// ctx: { t }
export function createRanked(ctx) {
  const { t } = ctx;
  const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
  const rankName = (i) => `${t('rankedRanks')[FLOORS[i].rank]} ${FLOORS[i].stage}`;
  const tcName = (tc) => t('rankedTc')[tc.id].name;
  const winsLeft = (rec) => Math.max(1, Math.ceil(FLOORS[rec.floor].wins - rec.progress - 1e-9));

  let screen = 'pick'; // 'pick', 'tower' or 'game'
  let tc = null; // the chosen time control
  let colourChoice = 'random';
  let visible = false;
  let cg = null;
  let game = null; // { tc, colour, chess, moves, clock: { w, b }, floor, over, thinking, result }
  let seq = 0;
  let turnStart = null; // performance.now() when the clock of the side to move started
  let ticker = null;
  let lastSecond = null;
  let lastChange = null; // the result of the last game, for the tower animation
  let confirmResolve = null;

  const timed = () => Boolean(game && tcById(game.tc).minutes);
  const clockOn = () => timed() && !game.over && game.moves.length > 0; // runs after White's first move
  const rec = () => data[tc.id];

  // ---------- Small pieces of the page ----------

  function pieceIcon(kind, colour = 'white', cls = 'rk-icon') {
    const wrap = document.createElement('span');
    wrap.className = `cg-wrap ${cls}`;
    wrap.setAttribute('aria-hidden', 'true');
    const p = document.createElement('piece');
    p.className = `${colour} ${kind}`;
    wrap.append(p);
    return wrap;
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function bar(r) {
    const b = el('div', 'rk-bar');
    const f = el('div', 'rk-bar-fill');
    f.style.width = `${Math.round((100 * r.progress) / FLOORS[r.floor].wins)}%`;
    b.append(f);
    b.setAttribute('role', 'progressbar');
    b.setAttribute('aria-valuemin', '0');
    b.setAttribute('aria-valuemax', '100');
    b.setAttribute('aria-valuenow', String(Math.round((100 * r.progress) / FLOORS[r.floor].wins)));
    return b;
  }

  function showScreen(s) {
    if (s !== screen && visible) window.scrollTo(0, 0);
    screen = s;
    $('rkPick').hidden = s !== 'pick';
    $('rkTowerScreen').hidden = s !== 'tower';
    $('rkGame').hidden = s !== 'game';
    if (s === 'game') ensureBoard();
  }

  // A question in the page itself (never a browser dialog): resolves true for `yes`, false for `no`
  // and null when it is closed without an answer.
  function ask(text, yes, no) {
    $('rkConfirmText').textContent = text;
    $('rkConfirmYes').textContent = yes;
    $('rkConfirmNo').textContent = no;
    $('rkConfirm').hidden = false;
    $('rkConfirmNo').focus();
    return new Promise((resolve) => { confirmResolve = resolve; });
  }
  function answer(v) {
    $('rkConfirm').hidden = true;
    const r = confirmResolve;
    confirmResolve = null;
    r?.(v);
  }
  $('rkConfirmYes').addEventListener('click', () => answer(true));
  $('rkConfirmNo').addEventListener('click', () => answer(false));
  $('rkConfirmBackdrop').addEventListener('click', () => answer(null));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('rkConfirm').hidden) answer(null);
  });

  // ---------- Screen 1: choose a time control ----------

  function renderPick() {
    $('rkCards').replaceChildren(...TIME_CONTROLS.map((c) => {
      const r = data[c.id];
      const b = el('button', 'rk-tc');
      b.dataset.tc = c.id;
      const head = el('span', 'rk-tc-head');
      head.append(el('span', 'rk-tc-icon', c.icon), el('strong', '', tcName(c)));
      head.firstChild.setAttribute('aria-hidden', 'true');
      const rank = el('span', 'rk-tc-rank');
      rank.append(pieceIcon(FLOORS[r.floor].rank), el('span', '', rankName(r.floor)));
      b.append(head, el('span', 'rk-tc-about', t('rankedTc')[c.id].about), rank, bar(r));
      if (r.game) b.append(el('span', 'rk-tc-tag', t('rankedUnfinishedTag')));
      return b;
    }));
    $('rkStorageNote').hidden = storageOk;
  }

  $('rkCards').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tc]');
    if (!b) return;
    tc = tcById(b.dataset.tc);
    openTower();
  });

  // ---------- Screen 2: the tower ----------

  function openTower(change = null) {
    showScreen('tower');
    renderTower(change);
  }

  function renderTower(change = null) {
    const r = rec();
    $('rkTcName').textContent = `${tc.icon} ${tcName(tc)}`;
    $('rkTcAbout').textContent = t('rankedTc')[tc.id].about;
    const floors = [];
    for (let i = TOP; i >= 0; i--) {
      const li = el('li', 'rk-floor');
      li.dataset.floor = String(i);
      li.classList.add(i < r.floor ? 'done' : i === r.floor ? 'current' : 'locked');
      li.classList.add(`rank-${FLOORS[i].rank}`);
      const main = el('div', 'rk-floor-main');
      main.append(pieceIcon(FLOORS[i].rank), el('span', 'rk-floor-name', rankName(i)));
      if (i === r.best) {
        const flag = el('span', 'rk-flag', '🚩');
        flag.title = t('rankedBest');
        flag.setAttribute('aria-label', t('rankedBest'));
        main.append(flag);
      }
      if (i === r.floor) {
        const here = el('span', 'rk-here');
        const token = el('span', 'rk-token');
        token.append(pieceIcon('pawn', 'white', 'rk-token-piece'));
        here.append(token, el('span', 'rk-here-text', t('rankedYouAreHere')));
        main.append(here);
      }
      li.append(main);
      if (i === r.floor) li.append(bar(r));
      floors.push(li);
    }
    $('rkTower').replaceChildren(...floors);

    $('rkHereName').textContent = rankName(r.floor);
    $('rkHereBar').replaceChildren(bar(r));
    if (r.floor === TOP) $('rkNext').textContent = t('rankedTop');
    else {
      const n = winsLeft(r);
      $('rkNext').textContent = fill(t('rankedNext'), { rank: rankName(r.floor + 1) }) + ' · '
        + fill(t(n === 1 ? 'rankedWinsLeftOne' : 'rankedWinsLeft'), { n });
    }
    $('rkShield').hidden = !(r.shield > 0 && r.floor > 0);
    $('rkShield').textContent = fill(t(r.shield === 1 ? 'rankedProtectedOne' : 'rankedProtected'), { n: r.shield });
    $('rkWins').textContent = String(r.wins);
    $('rkDraws').textContent = String(r.draws);
    $('rkLosses').textContent = String(r.losses);
    $('rkUnfinished').hidden = !r.game;
    document.querySelectorAll('[data-rk-colour]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.rkColour === colourChoice)));
    $('rkStorageNote2').hidden = storageOk;

    // The current floor in the middle of the tower's window (the page itself does not jump).
    const box = $('rkTowerBox');
    const cur = $('rkTower').querySelector('.current');
    requestAnimationFrame(() => {
      box.scrollTop = cur.offsetTop - box.clientHeight / 2 + cur.offsetHeight / 2;
      if (change && change.from !== change.to) climb(change.from, change.to);
    });
  }

  // The player's pawn walks from the old floor to the new one.
  function climb(from, to) {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const tower = $('rkTower');
    const oldRow = tower.querySelector(`[data-floor="${from}"]`);
    const token = tower.querySelector('.current .rk-token');
    if (!oldRow || !token || reduce) return;
    const dy = oldRow.offsetTop - tower.querySelector('.current').offsetTop;
    token.style.transition = 'none';
    token.style.transform = `translateY(${dy}px)`;
    token.getBoundingClientRect();
    token.style.transition = 'transform 1100ms cubic-bezier(.3, 1.4, .5, 1)';
    token.style.transform = '';
    token.classList.add('moving');
    setTimeout(() => token.classList.remove('moving'), 1200);
  }

  document.querySelectorAll('[data-rk-colour]').forEach((b) => b.addEventListener('click', () => {
    colourChoice = b.dataset.rkColour;
    renderTower();
  }));

  $('rkChange').addEventListener('click', () => {
    showScreen('pick');
    renderPick();
  });

  $('rkReset').addEventListener('click', async () => {
    const ok = await ask(fill(t('rankedResetAsk'), { tc: tcName(tc) }), t('rankedResetYes'), t('rankedCancel'));
    if (!ok) return;
    data[tc.id] = fresh();
    store();
    renderTower();
  });

  $('rkPlay').addEventListener('click', async () => {
    const r = rec();
    if (r.game) {
      const finish = await ask(t('rankedUnfinishedAsk'), t('rankedFinish'), t('rankedResignIt'));
      if (finish === null) return;
      if (finish) return resumeSaved();
      // Resigning the old game counts as a loss; then the new game starts (on the floor after it).
      applyResult(r, 'loss');
      r.game = null;
      store();
    }
    newGame();
  });

  // ---------- The board ----------

  function ensureBoard() {
    if (cg) return cg.redrawAll();
    cg = Chessground($('rkBoard'), {
      movable: { free: false, color: undefined, showDests: true, events: { after: onMove } },
      premovable: { enabled: false },
      drawable: { enabled: false },
      highlight: { lastMove: true, check: true },
      animation: { enabled: true, duration: 200 },
    });
  }

  const playersTurn = () => game && !game.over && !game.thinking && game.chess.turn() === game.colour;

  function dests() {
    const map = new Map();
    for (const mv of game.chess.moves({ verbose: true })) {
      if (!map.has(mv.from)) map.set(mv.from, []);
      map.get(mv.from).push(mv.to);
    }
    return map;
  }

  function sync(lastMove) {
    const c = game.chess;
    const mine = playersTurn();
    cg.set({
      fen: c.fen(),
      orientation: colourName(game.colour),
      turnColor: colourName(c.turn()),
      check: c.inCheck() ? colourName(c.turn()) : false,
      lastMove: lastMove || cg.state.lastMove,
      movable: { color: mine ? colourName(game.colour) : undefined, dests: mine ? dests() : new Map() },
    });
    refreshStatus();
  }

  function refreshStatus() {
    if (!game || game.over) return;
    let text = t('rankedThinking');
    if (playersTurn()) text = t(game.chess.inCheck() ? 'rankedCheck' : 'rankedYourMove');
    $('rkStatus').textContent = text;
  }

  // ---------- Clocks ----------

  // Milliseconds left for `side` right now.
  function left(side) {
    let ms = game.clock[side];
    if (turnStart !== null && side === game.chess.turn()) ms -= performance.now() - turnStart;
    return Math.max(0, ms);
  }

  function format(ms) {
    if (ms < 10000) return `0:0${(Math.floor(ms / 100) / 10).toFixed(1)}`;
    const s = Math.ceil(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function renderClocks() {
    if (!game) return;
    const has = timed();
    for (const [id, side] of [['rkClockMe', game.colour], ['rkClockThem', other(game.colour)]]) {
      const box = $(id);
      const time = box.querySelector('.rk-time');
      time.hidden = !has;
      box.querySelector('.rk-nolimit').hidden = has;
      box.classList.toggle('active', !game.over && game.chess.turn() === side);
      if (!has) continue;
      const ms = left(side);
      time.textContent = format(ms);
      box.classList.toggle('low', ms < 10000);
    }
  }

  function tick() {
    if (!game || game.over) return;
    renderClocks();
    if (turnStart === null) return;
    const side = game.chess.turn();
    const ms = left(side);
    if (side === game.colour) {
      const s = Math.ceil(ms / 1000);
      if (s !== lastSecond) {
        lastSecond = s;
        if (s <= 10 && s > 0) play('tick');
      }
    }
    if (ms <= 0) flag(side);
  }

  // The clock of the side to move starts (only while the Ranked board can be seen).
  function runClock() {
    if (!game || game.over || !visible || document.hidden || screen !== 'game') return;
    if (clockOn() && turnStart === null) turnStart = performance.now();
    if (!ticker) ticker = setInterval(tick, 100);
    renderClocks();
  }

  // The clock stops: the time used so far is taken off.
  function stopClock() {
    if (game && turnStart !== null) game.clock[game.chess.turn()] = left(game.chess.turn());
    turnStart = null;
    clearInterval(ticker);
    ticker = null;
    if (game) renderClocks();
  }

  function flag(side) {
    if (cannotMate(game.chess, other(side))) return finish('draw', 'timeoutDraw');
    if (side === game.colour) finish('loss', 'timeoutLoss');
    else finish('win', 'timeoutWin');
  }

  // ---------- A game ----------

  function saveGame() {
    if (!game || game.over) return;
    const r = data[game.tc];
    r.game = {
      colour: game.colour,
      moves: game.moves.slice(),
      clock: { w: Math.round(left('w')), b: Math.round(left('b')) },
      floor: game.floor,
    };
    store();
  }

  function startGame(g) {
    seq += 1;
    stopClock();
    game = g;
    lastSecond = null;
    $('rkEnd').hidden = true;
    $('rkPromo').hidden = true;
    $('rkResign').disabled = false;
    showScreen('game');
    const f = game.floor;
    $('rkThemName').textContent = t('rankedComputer');
    $('rkThemRank').replaceChildren(pieceIcon(FLOORS[f].rank, 'white', 'rk-icon small'), el('span', '', rankName(f)));
    $('rkMeName').textContent = t('rankedYou');
    $('rkGameTc').textContent = `${tc.icon} ${tcName(tc)}`;
    cg.set({ lastMove: undefined });
    const last = game.moves.at(-1);
    sync(last ? [last.slice(0, 2), last.slice(2, 4)] : undefined);
    renderClocks();
    saveGame();
    runClock();
    if (game.chess.turn() !== game.colour) computerTurn();
  }

  async function newGame() {
    const r = rec();
    const colour = colourChoice === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : colourChoice;
    const ms = tc.minutes * 60000;
    startGame({ tc: tc.id, colour, chess: new Chess(), moves: [], clock: { w: ms, b: ms }, floor: r.floor, over: false, thinking: false });
  }

  function resumeSaved() {
    const s = rec().game;
    const chess = new Chess();
    for (const m of s.moves) chess.move(uciMove(m));
    const ms = tc.minutes * 60000;
    const clock = { w: num(s.clock?.w, 0, 1e8, ms), b: num(s.clock?.b, 0, 1e8, ms) };
    startGame({ tc: tc.id, colour: s.colour, chess, moves: s.moves.slice(), clock, floor: s.floor, over: false, thinking: false });
  }

  function apply(uci) {
    const side = game.chess.turn();
    stopClock();
    const mv = game.chess.move(uciMove(uci));
    if (timed() && game.moves.length > 0) game.clock[side] += tcById(game.tc).inc * 1000;
    game.moves.push(uci);
    playMove(mv, game.chess);
    sync([mv.from, mv.to]);
    const over = gameOverInfo(game.chess);
    if (over) {
      const result = !over.winner ? 'draw' : over.winner === game.colour ? 'win' : 'loss';
      const reason = over.reason === 'draw' ? 'fifty' : over.reason;
      finish(result, reason);
      return true;
    }
    saveGame();
    runClock();
    return false;
  }

  async function computerTurn() {
    if (!game || game.over || game.thinking) return;
    const my = seq;
    game.thinking = true;
    refreshStatus();
    const t0 = performance.now();
    const fen = game.chess.fen();
    let cfg = FLOORS[game.floor];
    // Short of time: it thinks less, so it answers quickly.
    if (timed() && left(game.chess.turn()) < 15000) cfg = { ...cfg, depth: Math.min(cfg.depth, 5) };
    let uci = null;
    try {
      await engineReady;
      uci = await rankedMove(fen, cfg);
    } catch { /* a random move below */ }
    if (my !== seq || !game || game.over) return;
    if (!uci || !game.chess.moves({ verbose: true }).some((m) => m.from + m.to + (m.promotion || '') === uci)) {
      const all = game.chess.moves({ verbose: true });
      const m = all[Math.floor(Math.random() * all.length)];
      uci = m.from + m.to + (m.promotion || '');
    }
    const wait = (timed() ? 300 : 550) - (performance.now() - t0);
    if (wait > 0) await sleep(wait);
    if (my !== seq || !game || game.over) return;
    game.thinking = false;
    apply(uci);
  }

  function choosePromotion() {
    document.querySelectorAll('#rkPromo piece').forEach((p) => {
      p.classList.toggle('white', game.colour === 'w');
      p.classList.toggle('black', game.colour === 'b');
    });
    $('rkPromo').hidden = false;
    return new Promise((resolve) => {
      $('rkPromo').onclick = (e) => {
        const btn = e.target.closest('[data-promo]');
        if (!btn && e.target.closest('.promo-card')) return;
        $('rkPromo').hidden = true;
        $('rkPromo').onclick = null;
        resolve(btn ? btn.dataset.promo : null);
      };
    });
  }

  async function onMove(orig, dest) {
    if (!playersTurn()) return;
    const my = seq;
    let promotion = '';
    if (game.chess.get(orig)?.type === 'p' && (dest[1] === '8' || dest[1] === '1')) {
      promotion = await choosePromotion();
      if (my !== seq || !game || game.over) return;
      if (!promotion) return sync();
    }
    if (apply(orig + dest + promotion)) return;
    computerTurn();
  }

  $('rkResign').addEventListener('click', async () => {
    if (!game || game.over) return;
    const ok = await ask(t('rankedResignAsk'), t('rankedResignYes'), t('rankedCancel'));
    if (ok && game && !game.over) finish('loss', 'resign');
  });

  // ---------- Results ----------

  // Changes the progress of a time control after a game; returns what happened.
  function applyResult(r, result) {
    const from = r.floor;
    let kind = result;
    if (result === 'win' || result === 'draw') {
      r[result === 'win' ? 'wins' : 'draws'] += 1;
      r.progress = Math.min(FLOORS[r.floor].wins, r.progress + (result === 'win' ? 1 : DRAW));
      if (r.floor < TOP && r.progress >= FLOORS[r.floor].wins - 1e-9) {
        r.floor += 1;
        r.progress = 0;
        r.shield = SHIELD;
        r.best = Math.max(r.best, r.floor);
        kind = 'promoted';
      }
    } else {
      r.losses += 1;
      const empty = r.progress <= 1e-9;
      r.progress = Math.max(0, r.progress - LOSS);
      if (empty && r.floor > 0 && r.shield === 0) {
        r.floor -= 1;
        r.progress = FLOORS[r.floor].wins / 2;
        kind = 'demoted';
      } else if (empty && r.floor > 0) kind = 'protected';
      else if (empty) kind = 'bottom';
      if (r.shield > 0) r.shield -= 1;
    }
    r.progress = Math.round(r.progress * 100) / 100;
    lastChange = { from, to: r.floor, kind, result };
    return lastChange;
  }

  function finish(result, reason) {
    if (!game || game.over) return;
    seq += 1;
    stopClock();
    game.over = true;
    game.thinking = false;
    game.result = result;
    $('rkPromo').hidden = true;
    $('rkResign').disabled = true;
    cg.set({ movable: { color: undefined, dests: new Map() } });
    const r = data[game.tc];
    r.game = null;
    const change = applyResult(r, result);
    store();
    renderClocks();
    $('rkStatus').textContent = '';

    $('rkEndTitle').textContent = t(result === 'win' ? 'rankedWon' : result === 'draw' ? 'rankedDrawn' : 'rankedLost');
    $('rkEndTitle').className = `rk-end-title ${result}`;
    $('rkEndReason').textContent = t('rankedReasons')[reason] || '';
    const rank = rankName(r.floor);
    const next = r.floor < TOP ? rankName(r.floor + 1) : '';
    let line;
    if (change.kind === 'promoted') line = fill(t('rankedPromoted'), { rank });
    else if (change.kind === 'demoted') line = fill(t('rankedDemoted'), { rank });
    else if (change.kind === 'protected') line = fill(t('rankedProtectedNow'), { rank });
    else if (change.kind === 'bottom') line = fill(t('rankedBottom'), { rank });
    else if (r.floor === TOP) line = t('rankedTopLine');
    else if (result === 'win') line = fill(t(winsLeft(r) === 1 ? 'rankedAfterWinOne' : 'rankedAfterWin'), { n: winsLeft(r), rank: next });
    else if (result === 'draw') line = fill(t('rankedAfterDraw'), { rank: next });
    else line = t('rankedAfterLoss');
    $('rkEndChange').textContent = line;
    $('rkEndChange').className = `rk-end-change ${change.kind}`;
    $('rkEndRank').replaceChildren(pieceIcon(FLOORS[r.floor].rank), el('span', '', rank));
    $('rkEndBar').replaceChildren(bar(r));
    $('rkEnd').hidden = false;

    if (change.kind === 'promoted') {
      play('win');
      confetti({ big: true });
    } else if (result === 'win') {
      play('win');
      confetti();
    } else if (result === 'draw') play('right');
    else play('wrong');
  }

  $('rkAgain').addEventListener('click', () => newGame());
  $('rkBack').addEventListener('click', () => {
    const change = lastChange;
    lastChange = null;
    game = null;
    openTower(change);
  });

  // ---------- Hidden page or app closed: the clock stops and the game is kept ----------

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      saveGame();
      stopClock();
    } else if (visible) {
      runClock();
      if (game && !game.over && !game.thinking && game.chess.turn() !== game.colour) computerTurn();
    }
  });
  window.addEventListener('pagehide', saveGame);

  return {
    show() {
      visible = true;
      showScreen(screen);
      if (screen === 'pick') renderPick();
      if (screen === 'tower') renderTower();
      if (screen === 'game' && game) {
        sync();
        runClock();
        if (!game.over && !game.thinking && game.chess.turn() !== game.colour) computerTurn();
      }
    },
    hide() {
      visible = false;
      saveGame();
      stopClock();
    },
    get state() {
      const r = tc ? data[tc.id] : null;
      return {
        screen,
        tc: tc?.id || null,
        storageOk,
        progress: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, { ...v, game: v.game ? { moves: v.game.moves.length, clock: v.game.clock } : null }])),
        floor: r?.floor ?? null,
        game: game ? {
          fen: game.chess.fen(), colour: game.colour, turn: game.chess.turn(), over: game.over, result: game.result || null,
          thinking: game.thinking, moves: game.moves.length, floor: game.floor,
          clock: { w: Math.round(left('w')), b: Math.round(left('b')) }, running: turnStart !== null,
        } : null,
        lastChange,
      };
    },
    // For automated tests only: set the time left on both clocks (milliseconds).
    setClocksForTests(w, b) {
      if (!game) return;
      const running = turnStart !== null;
      stopClock();
      game.clock = { w, b };
      if (running) runClock();
      renderClocks();
    },
  };
}
