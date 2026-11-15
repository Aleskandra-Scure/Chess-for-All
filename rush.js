// Puzzle Rush: 3 minutes to solve as many puzzles as possible, with 3 lives and no hints.
// Puzzles from data/puzzles.json, from the easiest up, a little harder each time. A wrong move costs a
// life and goes straight on to the next puzzle. The best score is kept only while the page is open.
import { Chessground } from './vendor/chessground/chessground.js';
import { Chess } from './vendor/chess.js/chess.js';
import { play, playMove } from './sounds.js';
import { confetti } from './confetti.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const colourName = (c) => (c === 'w' ? 'white' : 'black');
const uciMove = (uci) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
const randomOf = (list) => list[Math.floor(Math.random() * list.length)];

const LENGTH = 180; // seconds
const LIVES = 3;
const FIRST = 400; // rating of the first puzzle (the bottom of Easy)
const STEP = 50; // each puzzle about this much harder
const MAX_MOVES = 7; // the opponent's move and up to 3 of the player's

let all = null;
const loadPuzzles = () => {
  all ||= fetch(new URL('./data/puzzles.json', import.meta.url)).then((r) => r.json()).catch(() => []);
  return all;
};

// ctx: { t, addMessage(text, kind, box), speak, react, refreshMood, exit() }
export function createRush(ctx) {
  const { t } = ctx;
  let cg = null;
  let running = false;
  let ended = false;
  let visible = false;
  let score = 0;
  let lives = LIVES;
  let best = 0; // this session only
  let newBest = false;
  let length = LENGTH; // seconds of a round (shorter only in automated tests)
  let remaining = LENGTH * 1000;
  let deadline = 0;
  let timer = null;
  let lastSecond = null;
  let round = []; // { n, puzzle, solved }
  let cur = null; // the puzzle on the board
  let seq = 0;
  let replaying = false;
  const used = new Set(); // puzzles already given while the page is open

  const box = () => $('pzMessages');
  const say = (text) => {
    if (!text) return;
    ctx.addMessage(text, '', box());
    ctx.speak(text);
  };
  const fill = (text, n) => text.replace('{n}', String(n));

  // ---------- Display ----------

  function refreshHud() {
    const s = Math.max(0, Math.ceil(remaining / 1000));
    $('rushTime').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    $('rushTime').classList.toggle('low', running && s <= 10);
    $('rushScore').textContent = String(score);
    $('rushLives').replaceChildren(...Array.from({ length: LIVES }, (_, i) => {
      const h = document.createElement('span');
      h.className = i < lives ? 'heart' : 'heart lost';
      h.textContent = '♥';
      return h;
    }));
    $('rushLives').setAttribute('aria-label', `${t('rushLives')}: ${lives}`);
  }

  function setStatus(text) {
    $('rushStatus').textContent = text || '';
  }

  // ---------- Board ----------

  function ensureBoard() {
    if (cg) return cg.redrawAll();
    cg = Chessground($('rushBoard'), {
      movable: { free: false, color: undefined, showDests: true, events: { after: onMove } },
      premovable: { enabled: false },
      highlight: { lastMove: true, check: true },
      animation: { enabled: true, duration: 200 },
    });
  }

  const playersTurn = () => running && cur && !cur.busy && cur.chess.turn() === cur.colour;

  function dests() {
    const map = new Map();
    for (const mv of cur.chess.moves({ verbose: true })) {
      if (!map.has(mv.from)) map.set(mv.from, []);
      map.get(mv.from).push(mv.to);
    }
    return map;
  }

  function sync(lastMove) {
    const c = cur.chess;
    const mine = playersTurn();
    cg.set({
      fen: c.fen(),
      turnColor: colourName(c.turn()),
      check: c.inCheck() ? colourName(c.turn()) : false,
      lastMove: lastMove || cg.state.lastMove,
      movable: { color: mine ? colourName(cur.colour) : undefined, dests: mine ? dests() : new Map() },
    });
  }

  function mark(square, cls) {
    cg.set({ highlight: { custom: square ? new Map([[square, cls]]) : new Map() } });
  }

  // ---------- Timer ----------

  function tick() {
    remaining = Math.max(0, deadline - performance.now());
    const s = Math.ceil(remaining / 1000);
    if (s !== lastSecond) {
      lastSecond = s;
      if (s <= 10 && s > 0) play('tick');
    }
    refreshHud();
    if (remaining <= 0) end('time');
  }

  function startClock() {
    deadline = performance.now() + remaining;
    clearInterval(timer);
    timer = setInterval(tick, 100);
  }

  function stopClock() {
    clearInterval(timer);
    timer = null;
    if (running) remaining = Math.max(0, deadline - performance.now());
  }

  // ---------- Puzzles ----------

  async function pick() {
    const list = (await loadPuzzles()).filter((p) => p.moves.length <= MAX_MOVES);
    const target = FIRST + round.length * STEP;
    let fresh = list.filter((p) => !used.has(p.id));
    if (fresh.length < 20) {
      used.clear();
      fresh = list;
    }
    let near = [];
    for (const width of [40, 80, 160, 400]) {
      near = fresh.filter((p) => Math.abs(p.rating - target) <= width);
      if (near.length >= 3) break;
    }
    const p = randomOf(near.length ? near : fresh);
    if (p) used.add(p.id);
    return p;
  }

  async function nextPuzzle() {
    const my = ++seq;
    mark(null);
    cg.setAutoShapes([]);
    const p = await pick();
    if (my !== seq || !running) return;
    if (!p) return end('time');
    const chess = new Chess(p.fen);
    const colour = chess.turn() === 'w' ? 'b' : 'w';
    cur = { puzzle: p, chess, colour, step: 0, busy: true, last: undefined, n: round.length + 1 };
    cg.set({ orientation: colourName(colour), lastMove: undefined });
    sync();
    setStatus('');
    await sleep(350);
    if (my !== seq || !running) return;
    playStep();
    cur.busy = false;
    sync();
    setStatus(t(colour === 'w' ? 'rushFindWhite' : 'rushFindBlack'));
  }

  function playStep() {
    const mv = cur.chess.move(uciMove(cur.puzzle.moves[cur.step]));
    cur.step += 1;
    cur.last = [mv.from, mv.to];
    playMove(mv, cur.chess);
    sync(cur.last);
    return mv;
  }

  function choosePromotion() {
    document.querySelectorAll('#rushPromo piece').forEach((p) => {
      p.classList.toggle('white', cur.colour === 'w');
      p.classList.toggle('black', cur.colour === 'b');
    });
    $('rushPromo').hidden = false;
    return new Promise((resolve) => {
      $('rushPromo').onclick = (e) => {
        const btn = e.target.closest('[data-promo]');
        if (!btn && e.target.closest('.promo-card')) return;
        $('rushPromo').hidden = true;
        $('rushPromo').onclick = null;
        resolve(btn ? btn.dataset.promo : null);
      };
    });
  }

  async function onMove(orig, dest) {
    if (replaying || !playersTurn()) return;
    const my = seq;
    let promotion = '';
    if (cur.chess.get(orig)?.type === 'p' && (dest[1] === '8' || dest[1] === '1')) {
      promotion = await choosePromotion();
      if (my !== seq || !running) return;
      if (!promotion) return sync(cur.last);
    }
    const uci = orig + dest + promotion;
    const trial = new Chess(cur.chess.fen());
    trial.move({ from: orig, to: dest, promotion: promotion || undefined });
    const right = uci === cur.puzzle.moves[cur.step] || trial.isCheckmate();
    cur.busy = true;

    if (!right) {
      // A wrong move: one life less, and straight on to the next puzzle.
      lives -= 1;
      round.push({ n: cur.n, puzzle: cur.puzzle, solved: false });
      mark(dest, 'pz-wrong');
      play('wrong');
      ctx.react('worried', 1500);
      refreshHud();
      await sleep(450);
      if (my !== seq || !running) return;
      if (lives <= 0) return end('lives');
      return nextPuzzle();
    }

    const mv = cur.chess.move({ from: orig, to: dest, promotion: promotion || undefined });
    cur.step += 1;
    cur.last = [mv.from, mv.to];
    sync(cur.last);
    if (trial.isCheckmate() || cur.step >= cur.puzzle.moves.length) {
      score += 1;
      round.push({ n: cur.n, puzzle: cur.puzzle, solved: true });
      mark(dest, 'pz-right');
      play('right');
      ctx.react('happy', 1500);
      refreshHud();
      await sleep(350);
      if (my !== seq || !running) return;
      return nextPuzzle();
    }
    play('right');
    await sleep(300);
    if (my !== seq || !running) return;
    playStep();
    cur.busy = false;
    sync();
  }

  // ---------- Start and end ----------

  function start() {
    seq += 1;
    running = true;
    ended = false;
    newBest = false;
    replaying = false;
    score = 0;
    lives = LIVES;
    remaining = length * 1000;
    lastSecond = null;
    round = [];
    $('rushIntro').hidden = true;
    $('rushEnd').hidden = true;
    $('rushResults').hidden = true;
    ensureBoard();
    refreshHud();
    say(fill(randomOf(t('rushCoachStart')), 0));
    ctx.refreshMood();
    startClock();
    nextPuzzle();
  }

  function end(why) {
    if (!running) return;
    seq += 1;
    stopClock();
    running = false;
    ended = true;
    remaining = why === 'time' ? 0 : remaining;
    cur = null;
    cg.set({ movable: { color: undefined, dests: new Map() } });
    $('rushPromo').hidden = true;
    newBest = score > best;
    best = Math.max(best, score);
    refreshHud();
    setStatus(t(why === 'time' ? 'rushTimeUp' : 'rushNoLives'));
    showResults(why);
    play('win');
    confetti({ big: newBest });
    if (newBest) {
      ctx.react('celebrate', 6000);
      say(fill(randomOf(t('rushCoachRecord')), score));
    } else {
      ctx.react(score > 0 ? 'happy' : 'neutral', 3000);
      say(fill(randomOf(t(score > 0 ? 'rushCoachEnd' : 'rushCoachNone')), score));
    }
    ctx.refreshMood();
  }

  function showResults(why) {
    if (why) $('rushEndReason').textContent = t(why === 'time' ? 'rushTimeUp' : 'rushNoLives');
    $('rushFinal').textContent = String(score);
    $('rushBestLine').textContent = newBest && score > 0 ? t('rushNewBest') : fill(t('rushBest'), best);
    $('rushBestLine').classList.toggle('record', newBest && score > 0);
    $('rushList').replaceChildren(...round.map((r) => {
      const li = document.createElement('li');
      li.className = r.solved ? 'solved' : 'missed';
      const name = document.createElement('span');
      name.textContent = `${fill(t('rushPuzzle'), r.n)} · ${r.puzzle.rating}`;
      const result = document.createElement('span');
      result.className = 'rush-result';
      result.textContent = `${r.solved ? '✓' : '✗'} ${t(r.solved ? 'rushSolved' : 'rushMissed')}`;
      li.append(name, result);
      if (!r.solved) {
        const b = document.createElement('button');
        b.className = 'rush-solution';
        b.textContent = t('rushShowSolution');
        b.addEventListener('click', () => showSolution(r.puzzle));
        li.append(b);
      }
      return li;
    }));
    $('rushList').hidden = !round.length;
    $('rushRoundTitle').hidden = !round.length;
    $('rushEnd').hidden = false;
  }

  // The whole solution of a missed puzzle, move by move, then back to the results.
  async function showSolution(p) {
    const my = ++seq;
    replaying = true;
    $('rushEnd').hidden = true;
    $('rushResults').hidden = false;
    const chess = new Chess(p.fen);
    const colour = chess.turn() === 'w' ? 'b' : 'w';
    cur = null;
    mark(null);
    cg.set({ orientation: colourName(colour), fen: chess.fen(), lastMove: undefined, check: false, movable: { color: undefined, dests: new Map() } });
    setStatus(t('rushWatch'));
    await sleep(600);
    for (let i = 0; i < p.moves.length; i++) {
      if (my !== seq) return;
      const uci = p.moves[i];
      if (i > 0) {
        cg.setAutoShapes([{ orig: uci.slice(0, 2), dest: uci.slice(2, 4), brush: 'green' }]);
        await sleep(650);
        if (my !== seq) return;
      }
      cg.setAutoShapes([]);
      const mv = chess.move(uciMove(uci));
      playMove(mv, chess);
      cg.set({ fen: chess.fen(), lastMove: [mv.from, mv.to], check: chess.inCheck() ? colourName(chess.turn()) : false });
      await sleep(650);
    }
    if (my === seq) setStatus('');
  }

  function backToResults() {
    seq += 1;
    replaying = false;
    cg.setAutoShapes([]);
    $('rushResults').hidden = true;
    showResults();
  }

  function leave() {
    if (running) end('time');
    ctx.exit();
  }

  $('rushGo').addEventListener('click', start);
  $('rushAgain').addEventListener('click', start);
  $('rushResults').addEventListener('click', backToResults);
  $('rushBack1').addEventListener('click', () => ctx.exit());
  $('rushBack2').addEventListener('click', leave);

  return {
    // The Puzzle Rush board appears (the clock goes on if a round was paused).
    show() {
      visible = true;
      ensureBoard();
      refreshHud();
      if (running) startClock();
    },
    // Another tab or the normal puzzles: the clock waits.
    hide() {
      visible = false;
      if (running) stopClock();
    },
    mood() {
      if (ended && newBest && score > 0) return 'celebrate';
      return 'neutral';
    },
    get state() {
      return { running, ended, visible, score, lives, best, newBest, seconds: Math.ceil(remaining / 1000), round: round.length, ready: playersTurn(), solution: cur ? cur.puzzle.moves.slice(cur.step) : null, colour: cur?.colour || null, fen: cur ? cur.chess.fen() : null, ratings: round.map((r) => r.puzzle.rating) };
    },
    // For automated tests only: shorter rounds.
    setLengthForTests(seconds) {
      length = seconds;
    },
  };
}
