import { Chessground } from './vendor/chessground/chessground.js';
import { Chess } from './vendor/chess.js/chess.js';
import { STRINGS, LANG } from './i18n.js';
import { COACHES, DEFAULT_COACH, MOODS, coachById, coachImage } from './coaches.js';
import { createPuzzles } from './puzzles.js';
import { createLearn } from './learn.js';
import { initAbout } from './about.js';
import { openingsReady, openingOf, openingFamily } from './openings.js';
import { engineReady, judgeMove, computerMove, evaluate, hintFor, piecesInDanger, uciToMove, PIECE } from './analysis.js';
import * as lines from './coach-lines.js';

// Nothing is saved: every setting starts fresh each time the page is opened.
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let level = 2;
let helpLevel = 2;
let showBar = true;
let playerColour = 'w'; // colour for the current game; with a friend, the side to move
let vsFriend = false; // the current game is two players on this device
let helpFor = 'both'; // with a friend: help for 'w', 'b', 'both' or 'none'
let flipBoard = true; // with a friend: the board turns to the side to move (on each time the page opens)
let coach = coachById(DEFAULT_COACH);
let mode = 'play'; // 'play', 'puzzles' or 'learn'
let engineOk = null; // null while Stockfish is loading, then true or false

let chess = new Chess();
let moments = [];
let gameActive = false;
let gameOver = false; // finished by mate or draw; Undo can bring it back to life
let busy = false;
let gamesStarted = 0;

// Texts from i18n.js; "pzLevels.easy" reads a nested text.
const t = (key) => key.split('.').reduce((o, k) => o?.[k], STRINGS[LANG]);
const colourName = (c) => (c === 'w' ? 'white' : 'black');
const coachName = (c) => t('coaches')[c.id].name;

// Against the computer the player always gets the chosen help; with a friend only the chosen side(s).
const helped = (c) => !vsFriend || helpFor === 'both' || helpFor === c;
const help = () => (helped(playerColour) ? helpLevel : 0);

function applyTexts() {
  document.documentElement.lang = t('htmlLang');
  document.title = t('title');
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  refreshSoundButton();
  refreshCoach();
  refreshHelpControls();
  renderBar();
  refreshStatus();
}

// ---------- Coach voice ----------

// Only voices that run on the device itself: an online voice would send the text to a server.
const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
let muted = false;
let pendingSpeech = null; // browsers only allow speech after the first tap
let voicesReady = Boolean(synth && synth.getVoices().length); // tablets load the voice list later
let waitingText = null; // said before the voice list arrived
let noVoiceShown = false;

function voicesArrived() {
  voicesReady = true;
  if (!waitingText) return;
  const text = waitingText;
  waitingText = null;
  speak(text);
}

if (synth && !voicesReady) {
  synth.addEventListener('voiceschanged', () => {
    if (synth.getVoices().length) voicesArrived();
  });
  // Some browsers never fire voiceschanged when there are no voices at all.
  setTimeout(() => { if (!voicesReady) voicesArrived(); }, 2000);
}

// A local voice for the page language (British English first, then any English one).
function pickVoice(code) {
  const voices = synth.getVoices().filter((v) => v.localService);
  const norm = (v) => v.lang.replace('_', '-').toLowerCase();
  return voices.find((v) => norm(v) === code.toLowerCase())
    || voices.find((v) => norm(v).startsWith(`${code.slice(0, 2).toLowerCase()}-`) || norm(v) === code.slice(0, 2).toLowerCase())
    || null;
}

function speak(text) {
  if (!synth || muted || !text) return;
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) {
    pendingSpeech = text;
    return;
  }
  if (!voicesReady) {
    waitingText = text;
    return;
  }
  synth.cancel();
  const code = t('voiceLang');
  const voice = pickVoice(code);
  if (!voice) {
    // Without a local voice the coach stays quiet and only writes.
    if (!noVoiceShown) {
      noVoiceShown = true;
      addMessage(t('noVoice'), '', { puzzles: $('pzMessages'), learn: $('lnMessages') }[mode] || $('messages'));
    }
    return;
  }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = code;
  u.voice = voice;
  u.pitch = coach.voice.pitch;
  u.rate = coach.voice.rate;
  u.onstart = () => { speaking = true; refreshTalking(); };
  u.onend = u.onerror = () => { speaking = false; refreshTalking(); };
  synth.speak(u);
}

window.addEventListener('pointerdown', () => {
  if (!pendingSpeech) return;
  const text = pendingSpeech;
  pendingSpeech = null;
  speak(text);
});

function refreshSoundButton() {
  const b = $('sound');
  b.hidden = !synth;
  b.textContent = muted ? '🔇' : '🔊';
  b.setAttribute('aria-pressed', String(!muted));
  b.setAttribute('aria-label', t(muted ? 'soundOff' : 'soundOn'));
  b.title = t(muted ? 'soundOff' : 'soundOn');
}

$('sound').addEventListener('click', () => {
  muted = !muted;
  if (muted && synth) synth.cancel();
  pendingSpeech = null;
  refreshSoundButton();
});

// ---------- Coach messages ----------

// `box` is the game's message list unless the puzzles pass their own.
function addMessage(text, kind = '', box = $('messages')) {
  const el = document.createElement('div');
  el.className = `msg ${kind}`.trim();
  el.textContent = text;
  box.appendChild(el);
  markLatest(el);
  box.scrollTop = box.scrollHeight;
  talkPulse();
  return el;
}

// The newest bubble gets the little tail pointing at the coach.
function markLatest(el) {
  const box = el?.parentElement || $('messages');
  box.querySelectorAll('.msg.latest').forEach((m) => m !== el && m.classList.remove('latest'));
  if (el && el.isConnected && el === [...box.querySelectorAll('.msg')].at(-1)) el.classList.add('latest');
}

function addDivider() {
  const el = document.createElement('div');
  el.className = 'divider';
  el.textContent = '· · ·';
  $('messages').appendChild(el);
}

// The coach writes and reads a sentence out loud.
function coachSays(text, kind = '') {
  if (!text) return null;
  addMessage(text, kind);
  speak(text);
  return text;
}

// ---------- Coach character ----------

let mood = 'neutral';
let reaction = null; // { mood, timer }: a short-lived face after something happens
let speaking = false;
let pulseTimer = null;

// Face for the current situation (a reaction wins for a few seconds).
function baseMood() {
  if (mode === 'puzzles') return puzzles.mood();
  if (mode === 'learn') return learn.mood();
  if (gameOver && endText === 'youWon') return 'celebrate';
  if (pause) return 'worried';
  if (hintLoading || (hint && hint.fen === chess.fen())) return 'thinking';
  if ((gameActive && busy) || engineOk === null) return 'thinking';
  return 'neutral';
}

function refreshMood() {
  mood = reaction?.mood || baseMood();
  const src = coachImage(coach, mood);
  for (const img of [$('coachImg'), $('pauseImg')]) {
    if (img.getAttribute('src') !== src) img.src = src;
  }
  $('coachButton').dataset.mood = mood;
}

function react(face, ms = 3500) {
  if (reaction) clearTimeout(reaction.timer);
  reaction = { mood: face, timer: setTimeout(() => { reaction = null; refreshMood(); }, ms) };
  refreshMood();
}

function clearReaction() {
  if (reaction) clearTimeout(reaction.timer);
  reaction = null;
  refreshMood();
}

// Gentle bobbing while the coach speaks (or briefly when a message appears with the sound off).
function refreshTalking() {
  const on = speaking || pulseTimer !== null;
  $('coachButton').classList.toggle('talking', on);
  $('pauseImg').classList.toggle('talking', on);
}

function talkPulse() {
  clearTimeout(pulseTimer);
  pulseTimer = setTimeout(() => { pulseTimer = null; refreshTalking(); }, 1800);
  refreshTalking();
}

function refreshCoach() {
  $('coachName').textContent = coachName(coach);
  $('coachImg').alt = coachName(coach);
  $('coachButton').setAttribute('aria-label', `${coachName(coach)} — ${t('changeCoach')}`);
  $('coachButton').title = t('changeCoach');
  $('pickerClose').setAttribute('aria-label', t('close'));
  renderPicker();
  refreshMood();
}

function renderPicker() {
  $('coachCards').replaceChildren(...COACHES.map((c) => {
    const card = document.createElement('button');
    card.className = 'coach-card';
    card.dataset.coach = c.id;
    card.setAttribute('aria-pressed', String(c.id === coach.id));
    const img = document.createElement('img');
    img.src = coachImage(c, 'neutral');
    img.alt = '';
    const name = document.createElement('strong');
    name.textContent = coachName(c);
    const about = document.createElement('span');
    about.textContent = t('coaches')[c.id].about;
    card.append(img, name, about);
    return card;
  }));
}

function openPicker() {
  $('coachPicker').hidden = false;
  $('coachCards').querySelector('[aria-pressed="true"]')?.focus();
}

function closePicker() {
  $('coachPicker').hidden = true;
}

// A new coach takes over straight away, even in the middle of a game.
function chooseCoach(id) {
  coach = coachById(id);
  for (const m of MOODS) new Image().src = coachImage(coach, m);
  refreshCoach();
}

$('coachButton').addEventListener('click', openPicker);
$('pickerClose').addEventListener('click', closePicker);
$('pickerBackdrop').addEventListener('click', closePicker);
$('coachCards').addEventListener('click', (e) => {
  const card = e.target.closest('[data-coach]');
  if (!card) return;
  chooseCoach(card.dataset.coach);
  closePicker();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('coachPicker').hidden) closePicker();
});

// ---------- Board ----------

function dests() {
  const map = new Map();
  for (const mv of chess.moves({ verbose: true })) {
    if (!map.has(mv.from)) map.set(mv.from, []);
    map.get(mv.from).push(mv.to);
  }
  return map;
}

const cg = Chessground($('board'), {
  fen: chess.fen(),
  orientation: colourName(playerColour),
  movable: { free: false, color: undefined, showDests: true, events: { after: (orig, dest) => (vsFriend ? onFriendMove(orig, dest) : onUserMove(orig, dest)) } },
  premovable: { enabled: false },
  highlight: { lastMove: true, check: true },
  animation: { enabled: true, duration: 250 },
});

function syncBoard(lastMove) {
  const playersTurn = gameActive && !busy && chess.turn() === playerColour;
  cg.set({
    fen: chess.fen(),
    turnColor: colourName(chess.turn()),
    check: chess.inCheck() ? colourName(chess.turn()) : false,
    lastMove: lastMove || cg.state.lastMove,
    movable: {
      color: playersTurn ? colourName(playerColour) : undefined,
      dests: playersTurn ? dests() : new Map(),
    },
  });
  refreshStatus();
}

let endText = '';
function refreshStatus() {
  let s = '';
  if (engineOk === false) s = t('engineFailed');
  else if (engineOk === null) s = t('engineLoading');
  else if (endText) s = t(endText);
  else if (gameActive && vsFriend) s = t(chess.turn() === 'w' ? 'whiteToMove' : 'blackToMove');
  else if (gameActive) s = chess.turn() === playerColour ? t('yourMove') : t('thinking');
  $('status').textContent = s;
  const turnShown = vsFriend && gameActive && !endText && engineOk === true;
  $('status').classList.toggle('turn-w', turnShown && chess.turn() === 'w');
  $('status').classList.toggle('turn-b', turnShown && chess.turn() === 'b');
  refreshOpening();
  refreshMood();
  refreshHintButton();
  refreshShowBest();
  refreshUndoButton();
}

// ---------- Opening book ----------

let openingsTalked = new Set(); // opening families the coach has spoken about this game
let booksLoaded = false;
openingsReady.then(() => { booksLoaded = true; refreshOpening(); });

const uciLine = () => chess.history({ verbose: true }).map((m) => m.from + m.to + (m.promotion || ''));

// The last known opening of the game (positions are compared with the opening book);
// it stays as "last known" once the game leaves the book.
function currentOpening() {
  if (!booksLoaded) return null;
  const line = uciLine();
  if (!line.length) return null;
  const { opening, inBook } = openingOf(line);
  return opening ? { ...opening, family: openingFamily(opening.name), inBook, ply: line.length } : null;
}

function refreshOpening() {
  const o = currentOpening();
  const el = $('opening');
  el.hidden = !o;
  if (!o) return;
  el.textContent = t(o.inBook ? 'opening' : 'lastOpening').replace('{name}', o.name);
  el.classList.toggle('out', !o.inBook);
}

// The opening's book moves as [{ to, piece }], for the coach's sentence about it.
function bookMoves(o) {
  const c = new Chess();
  return o.uci.map((u) => {
    const mv = c.move(uciToMove(u));
    return { to: mv.to, piece: PIECE[mv.piece] };
  });
}

// Help 2–3: the coach says a few words once per new opening. The first time it waits until move 3
// (or until the game leaves the book), so it does not talk after every early move.
function maybeTalkOpening() {
  if (help() < 2 || !gameActive) return;
  const o = currentOpening();
  if (!o || openingsTalked.has(o.family)) return;
  if (openingsTalked.size === 0 && o.inBook && o.ply < 6) return;
  openingsTalked.add(o.family);
  coachSays(lines.opening(coach.id, o.name, bookMoves(o), playerColour));
}

// ---------- Arrows ----------

const uciArrow = (uci, brush, kind) => ({ orig: uci.slice(0, 2), dest: uci.slice(2, 4), brush, kind });
let arrows = []; // pause and hint shapes
let hintOnBoard = false; // the hint's circle or arrows are on the board
let dangerArrows = []; // help 2–3: attacker → piece left in danger by the player's last move
let turnShapes = []; // help 3: circles on pieces in danger and the two best moves

function drawShapes() {
  cg.setAutoShapes([...dangerArrows, ...turnShapes, ...arrows]);
  refreshLegend();
}

function setArrows(list, fromHint = false) {
  arrows = list;
  hintOnBoard = fromHint && list.length > 0;
  drawShapes();
}

// The legends list only the arrow colours that are on the board right now.
function refreshLegend() {
  const kinds = new Set([...dangerArrows, ...turnShapes, ...arrows].map((x) => x.kind).filter(Boolean));
  const show = (list) => {
    let any = false;
    list.querySelectorAll('li[data-kind]').forEach((li) => {
      li.hidden = !kinds.has(li.dataset.kind);
      if (!li.hidden) any = true;
    });
    return any;
  };
  show($('helpLegend'));
  $('helpLegend').hidden = help() < 2;
  $('hintLegend').hidden = !show($('hintLegend'));
}

// ---------- Help level ----------

function refreshHelpControls() {
  document.querySelectorAll('[data-help]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.help) === helpLevel)));
  $('helpName').textContent = t('helpNames')[helpLevel];
  refreshLegend();
  refreshShowBest();
}

// After the help level (or, with a friend, the side that gets help) changes.
function applyHelp() {
  if (help() < 2) {
    hideBadge();
    dangerArrows = [];
    drawShapes();
  }
  if (help() < 3) clearTurnHelp();
  else if (!turn) startTurnHelp();
  refreshHelpControls();
  refreshHintButton();
}

document.querySelectorAll('[data-help]').forEach((b) =>
  b.addEventListener('click', () => {
    helpLevel = Number(b.dataset.help);
    applyHelp();
  }),
);

// Grade of the player's move on its destination square; stays until the player's next move.
const GRADE = {
  book: '📖', best: '!!', checkmate: '!!', good: '!', inaccuracy: '?!', mistake: '?', blunder: '??',
};

let badgeMoment = null; // the move the badge belongs to, so it can move with the board when it turns

function showBadge(moment) {
  const mark = GRADE[moment.category];
  if (!mark || help() < 2) return hideBadge();
  badgeMoment = moment;
  placeBadge();
  const b = $('badge');
  b.textContent = mark;
  b.className = `badge ${moment.category === 'checkmate' ? 'best' : moment.category}`;
  b.hidden = false;
}

function placeBadge() {
  if (!badgeMoment) return;
  const white = cg.state.orientation === 'white';
  const file = 'abcdefgh'.indexOf(badgeMoment.to[0]);
  const rank = Number(badgeMoment.to[1]);
  const col = white ? file : 7 - file;
  const row = white ? 8 - rank : rank - 1;
  $('badge').style.left = `${(col + 1) * 12.5}%`;
  $('badge').style.top = `${row * 12.5}%`;
}

function hideBadge() {
  $('badge').hidden = true;
  badgeMoment = null;
}

// Red arrows from the opponent's piece to the player's piece it can win, and a short warning about
// pieces that were not in danger after the last move (unless the coach already spoke about this move).
let warnedAbout = new Set(); // "square piece" of the pieces in danger after the player's last move

function showDanger(threats, quiet) {
  dangerArrows = threats.flatMap((x) => x.attackers.map((a) => ({ orig: a, dest: x.square, brush: 'red', kind: 'danger' })));
  drawShapes();
  const key = (x) => `${x.square} ${x.piece}`;
  const fresh = threats.filter((x) => !warnedAbout.has(key(x)));
  warnedAbout = new Set(threats.map(key));
  if (!fresh.length) return;
  if (!quiet) coachSays(lines.danger(coach.id, fresh), 'warn');
  react('worried');
}

// ---------- Engine evaluation (advantage bar, best moves) ----------

const analyses = new Map(); // fen → promise of { evalWhite, lines }

function analyse(fen) {
  if (!analyses.has(fen)) analyses.set(fen, evaluate(fen).catch(() => null));
  return analyses.get(fen);
}

// Same curve as winChance in engine.js.
const winChance = (cp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * Math.max(-1000, Math.min(1000, cp)))) - 1);
let barWhite = 50; // White's share of the bar, 0–100

function setBar(evalWhite) {
  barWhite = winChance(evalWhite);
  renderBar();
}

function renderBar() {
  $('evalBar').hidden = !showBar;
  $('evalText').hidden = !showBar;
  $('barToggle').checked = showBar;
  $('evalBar').classList.toggle('flip', cg.state.orientation === 'black');
  const fill = $('evalFill');
  fill.style.height = '';
  fill.style.width = '';
  fill.style.setProperty(matchMedia('(max-width: 600px)').matches ? 'width' : 'height', `${barWhite}%`);
  if (vsFriend) {
    const key = barWhite >= 60 ? 'barWhiteWinning' : barWhite <= 40 ? 'barBlackWinning' : 'barEven';
    $('evalText').textContent = t(key);
    $('evalText').className = 'eval-text';
    return;
  }
  const mine = playerColour === 'w' ? barWhite : 100 - barWhite;
  const key = mine >= 60 ? 'barWinning' : mine <= 40 ? 'barLosing' : 'barEven';
  $('evalText').textContent = t(key);
  $('evalText').className = `eval-text ${key === 'barWinning' ? 'winning' : key === 'barLosing' ? 'losing' : ''}`.trim();
}

// Asks the engine about the position on the board and moves the bar when the answer comes.
async function updateBar() {
  if (!showBar) return;
  const fen = chess.fen();
  const a = await analyse(fen);
  if (a && chess.fen() === fen) setBar(a.evalWhite);
}

$('barToggle').addEventListener('change', () => {
  showBar = $('barToggle').checked;
  renderBar();
  if (gameActive) updateBar();
});
matchMedia('(max-width: 600px)').addEventListener('change', renderBar);

// ---------- Help during the player's turn (level 3) ----------

let turn = null; // { fen, circles, lines, shown, timer }

function startTurnHelp() {
  clearTurnHelp();
  if (help() < 3 || !hintAllowed()) return;
  const fen = chess.fen();
  const id = gameId;
  const me = { fen, circles: [], lines: null, shown: false, timer: null };
  turn = me;
  const current = () => turn === me && chess.fen() === fen && id === gameId;
  me.circles = piecesInDanger(fen, playerColour).map((x) => ({ orig: x.square, brush: 'red', kind: 'dangerCircle' }));
  drawTurn();
  analyse(fen).then((a) => {
    if (!current() || !a) return;
    me.lines = a.lines;
    drawTurn();
  });
  // The two best moves appear by themselves after 8 seconds.
  me.timer = setTimeout(() => {
    if (!current() || hintOnBoard) return;
    me.shown = true;
    drawTurn();
  }, 8000);
  refreshShowBest();
}

function drawTurn() {
  if (!turn) return;
  const shapes = [...turn.circles];
  const custom = new Map();
  if (turn.shown && turn.lines) {
    turn.lines.slice(0, 2).forEach((l, i) => {
      shapes.push(uciArrow(l.uci, i === 0 ? 'green' : 'paleGreen', i === 0 ? 'best' : 'second'));
      const from = l.uci.slice(0, 2);
      if (!custom.has(from)) custom.set(from, i === 0 ? 'best-piece' : 'second-piece');
    });
  }
  turnShapes = shapes;
  cg.set({ highlight: { custom } });
  drawShapes();
  refreshShowBest();
}

function clearTurnHelp() {
  if (turn?.timer) clearTimeout(turn.timer);
  turn = null;
  turnShapes = [];
  cg.set({ highlight: { custom: new Map() } });
  drawShapes();
  refreshShowBest();
}

function refreshShowBest() {
  $('showBest').hidden = help() < 3;
  $('showBest').disabled = !turn || turn.shown || !hintAllowed();
}

$('showBest').addEventListener('click', () => {
  if (!turn || turn.shown) return;
  if (hintOnBoard) {
    setArrows([]);
    if (hint) hint.stage = 0;
    refreshHintButton();
  }
  turn.shown = true;
  drawTurn();
});

// The hint takes the best-move arrows away.
function hideBestMoves() {
  if (!turn?.shown) return;
  turn.shown = false;
  drawTurn();
}

// Everything that belongs to the start of the player's turn.
function playerTurnStarts() {
  startTurnHelp();
  updateBar();
}

// ---------- Pause after a mistake ----------

let pause = null; // { resolve, moment }

function placePause() {
  // Keep the bubble away from the arrows: if they sit in the lower half of the board, show it on top.
  // The green "better move" arrow matters most once it is shown.
  const green = arrows.filter((a) => a.brush === 'green');
  const ranks = (green.length ? green : arrows).flatMap((a) => [a.orig[1], a.dest[1]]).map(Number);
  const fromBottom = (r) => (cg.state.orientation === 'white' ? r : 9 - r);
  const low = ranks.length && ranks.filter((r) => fromBottom(r) <= 4).length > ranks.length / 2;
  $('pause').classList.toggle('top', Boolean(low));
}

// Waits for the player to choose 'retry' or 'continue' (or 'abort' when a new game starts).
// `gentle` (help level 1) shows no arrows and no better move, only the question.
function pauseForMistake(moment, text, gentle = false) {
  $('pauseText').textContent = text || '';
  if (text) talkPulse();
  $('showBetter').hidden = gentle || !moment.bestUci;
  $('showBetter').disabled = false;
  setArrows(!gentle && moment.replyUci ? [uciArrow(moment.replyUci, 'red', 'danger')] : []);
  placePause();
  $('pause').hidden = false;
  const choice = new Promise((resolve) => { pause = { resolve, moment }; });
  refreshUndoButton();
  return choice;
}

function endPause(choice) {
  if (!pause) return;
  const { resolve } = pause;
  pause = null;
  $('pause').hidden = true;
  resolve(choice);
  clearReaction();
}

$('tryAgain').addEventListener('click', () => endPause('retry'));
$('keepPlaying').addEventListener('click', () => endPause('continue'));
$('showBetter').addEventListener('click', () => {
  if (!pause?.moment.bestUci) return;
  setArrows([...arrows, uciArrow(pause.moment.bestUci, 'green', 'best')]);
  placePause();
  $('showBetter').disabled = true;
});

// ---------- Hint ----------

let hint = null; // { fen, data, stage } for the position on the board
let hintUsed = null; // 'question' or 'shown' for the move the player is about to make
let hintLoading = false;

function hintAllowed() {
  return engineOk === true && gameActive && !busy && !pause && chess.turn() === playerColour && helped(playerColour);
}

function refreshHintButton() {
  const stage = hint && hint.fen === chess.fen() ? hint.stage : 0;
  $('hintLabel').textContent = t(stage === 1 ? 'showMe' : 'hint');
  $('hint').disabled = !hintAllowed() || hintLoading || stage === 2;
  refreshMood();
}

function clearHint() {
  hint = null;
  refreshHintButton();
}

$('hint').addEventListener('click', async () => {
  if (!hintAllowed() || hintLoading) return;
  const fen = chess.fen();
  const id = gameId;
  if (!hint || hint.fen !== fen) {
    hintLoading = true;
    refreshHintButton();
    let data = null;
    try {
      data = await hintFor(fen);
    } catch { /* no hint */ }
    hintLoading = false;
    if (!data || id !== gameId || chess.fen() !== fen) return refreshHintButton();
    hint = { fen, data, stage: 0 };
  }

  const { data } = hint;
  if (hint.stage === 0) {
    // First tap: circle the piece and ask a guiding question.
    hint.stage = 1;
    if (hintUsed !== 'shown') hintUsed = 'question';
    hideBestMoves();
    setArrows([{ orig: data.from, brush: 'green' }], true);
    coachSays(lines.hintQuestion(coach.id, data.facts));
  } else if (hint.stage === 1) {
    // Second tap: show the move and what it does.
    hint.stage = 2;
    hintUsed = 'shown';
    const f = data.facts;
    const shapes = [uciArrow(data.uci, 'green', 'move')];
    if (f.captured) shapes.push({ orig: f.captured.square, brush: 'red', kind: 'attack' });
    for (const x of f.attacks) shapes.push({ orig: f.to, dest: x.square, brush: 'red', kind: 'attack' });
    for (const x of f.defends) shapes.push({ orig: f.to, dest: x.square, brush: 'blue', kind: 'defend' });
    for (const x of f.saves) shapes.push({ orig: x.square, brush: 'yellow', kind: 'save' });
    hideBestMoves();
    setArrows(shapes, true);
    coachSays(lines.hintExplanation(coach.id, f));
  }
  refreshHintButton();
});

// ---------- Undo ----------

const playerMoves = () => chess.history({ verbose: true }).filter((m) => m.color === playerColour);

function refreshUndoButton() {
  const thinking = busy && !pause;
  const moves = vsFriend ? chess.history().length : playerMoves().length;
  $('undo').disabled = !(gameActive || gameOver) || thinking || moves === 0;
}

// With a friend: takes back one move (whoever played it). No limit.
function undoFriendMove() {
  if (pause) {
    pause.moment.retried = true;
    endPause('abort');
    chess.undo();
  } else {
    const undone = chess.undo();
    const m = moments.findLast((x) => !x.retried && x.san === undone.san && x.moveNumber === chess.moveNumber());
    if (m) m.retried = true;
  }
  if (gameOver) {
    gameOver = false;
    gameActive = true;
    endText = '';
  }
  busy = false;
  hintUsed = null;
  hideBadge();
  dangerArrows = [];
  warnedAbout = new Set();
  setArrows([]);
  clearHint();
  const prev = chess.history({ verbose: true }).at(-1);
  cg.set({ lastMove: prev ? [prev.from, prev.to] : undefined });
  playerColour = chess.turn();
  turnBoard();
  syncBoard();
  playerTurnStarts();
  refreshFriendControls();
}

// Takes back the player's last move and the computer's answer to it (if it was played). No limit.
$('undo').addEventListener('click', () => {
  if ($('undo').disabled) return;
  if (vsFriend) return undoFriendMove();
  if (pause) {
    // Paused after a mistake: the computer has not answered yet.
    pause.moment.retried = true;
    endPause('abort');
    chess.undo();
  } else {
    if (chess.history({ verbose: true }).at(-1).color !== playerColour) chess.undo();
    const undone = chess.undo();
    const m = moments.findLast((x) => !x.retried && x.san === undone.san && x.moveNumber === chess.moveNumber());
    if (m) m.retried = true;
  }
  if (gameOver) {
    gameOver = false;
    gameActive = true;
    endText = '';
  }
  busy = false;
  hintUsed = null;
  hideBadge();
  dangerArrows = [];
  setArrows([]);
  clearHint();
  const prev = chess.history({ verbose: true }).at(-1);
  cg.set({ lastMove: prev ? [prev.from, prev.to] : undefined });
  syncBoard();
  playerTurnStarts();
});

// ---------- Game flow ----------

let gameId = 0; // guards against answers that arrive after a new game has started

function localGameOver() {
  if (!chess.isGameOver()) return null;
  if (chess.isCheckmate()) return { reason: 'checkmate', winner: chess.turn() === 'w' ? 'b' : 'w' };
  if (chess.isStalemate()) return { reason: 'stalemate', winner: null };
  return { reason: 'draw', winner: null };
}

// Asks which piece the pawn becomes. Resolves with 'q', 'r', 'b' or 'n', or null if the child taps elsewhere.
function choosePromotion() {
  document.querySelectorAll('#promo piece').forEach((p) => p.classList.toggle('white', playerColour === 'w'));
  document.querySelectorAll('#promo piece').forEach((p) => p.classList.toggle('black', playerColour === 'b'));
  $('promo').hidden = false;
  return new Promise((resolve) => {
    const done = (choice) => {
      $('promo').hidden = true;
      $('promo').onclick = null;
      resolve(choice);
    };
    $('promo').onclick = (e) => {
      const btn = e.target.closest('[data-promo]');
      if (btn) done(btn.dataset.promo);
      else if (!e.target.closest('.promo-card')) done(null);
    };
  });
}

// Plays a UCI move for the computer and returns what the board needs.
function applyComputerMove(uci) {
  const mv = chess.move(uciToMove(uci));
  return { from: mv.from, to: mv.to };
}

async function onUserMove(orig, dest) {
  const piece = chess.get(orig);
  let promotion = '';
  if (piece?.type === 'p' && (dest[1] === '8' || dest[1] === '1')) {
    promotion = await choosePromotion();
    if (!promotion) {
      // Tapped outside the choice: the pawn goes back to its square.
      const prev = chess.history({ verbose: true }).at(-1);
      cg.set({ lastMove: prev ? [prev.from, prev.to] : undefined });
      syncBoard();
      return;
    }
  }
  const fenBefore = chess.fen();
  const id = gameId;
  const usedHint = hintUsed;
  hintUsed = null;
  clearHint();
  clearTurnHelp();
  hideBadge();
  dangerArrows = [];
  chess.move({ from: orig, to: dest, promotion: promotion || undefined });

  busy = true;
  setArrows([]);
  syncBoard([orig, dest]);

  const uci = orig + dest + promotion;
  let r;
  try {
    r = await judgeMove(fenBefore, uci, uciLine());
  } catch {
    if (id !== gameId) return;
    busy = false;
    syncBoard();
    return;
  }
  if (id !== gameId) return;

  if (usedHint) r.moment.hint = usedHint;
  moments.push(r.moment);
  showBadge(r.moment);
  if (r.moment.category === 'checkmate') react('celebrate');
  else if (helpLevel >= 2) react(['best', 'good', 'book'].includes(r.moment.category) ? 'happy' : 'worried');
  if (showBar) {
    analyses.set(r.fenAfter, Promise.resolve({ evalWhite: r.evalWhite, lines: [] }));
    setBar(r.evalWhite);
  }
  const over = localGameOver();
  if (over) {
    busy = false;
    if (helpLevel >= 2 && r.moment.worthComment) coachSays(lines.praise(coach.id, r.moment));
    return endGame(over, helpLevel >= 2);
  }

  // Help 0: no comments or pauses. Help 1: only a gentle pause before a blunder. Help 2–3: as before.
  const isMistake = r.moment.category === 'blunder' || r.moment.category === 'mistake';
  const gentle = helpLevel === 1;
  const pauses = helpLevel >= 2 ? isMistake : gentle && r.moment.category === 'blunder';
  let comment = null;
  if (gentle && pauses) {
    comment = lines.gentle(coach.id);
    speak(comment);
  } else if (helpLevel >= 2 && r.moment.worthComment) {
    comment = coachSays(isMistake ? lines.mistake(coach.id, r.moment) : lines.praise(coach.id, r.moment), isMistake ? 'warn' : '');
  }

  // The move leaves a piece that can be won: show it before the computer answers.
  const danger = helpLevel >= 2 && r.threats?.length > 0;
  if (danger) showDanger(r.threats, Boolean(comment));
  else warnedAbout = new Set();

  // The computer's answer is worked out while the child reads (it is thrown away on "Try again").
  const answer = computerMove(r.fenAfter, level).catch(() => null);

  if (pauses) {
    const choice = await pauseForMistake(r.moment, comment, gentle);
    if (choice === 'abort' || id !== gameId) return;
    if (choice === 'retry') {
      // Take the move back; the computer's prepared answer is thrown away.
      r.moment.retried = true;
      chess.undo();
      hideBadge();
      dangerArrows = [];
      setArrows(arrows.filter((a) => a.brush === 'green')); // the better move still fits this position
      busy = false;
      const prev = chess.history({ verbose: true }).at(-1);
      cg.set({ lastMove: prev ? [prev.from, prev.to] : undefined });
      syncBoard();
      playerTurnStarts();
      return;
    }
  } else {
    await sleep(danger ? 1500 : 500);
    if (id !== gameId) return;
  }

  const reply = await answer;
  if (id !== gameId) return;
  if (!reply) {
    busy = false;
    syncBoard();
    return;
  }
  const mv = applyComputerMove(reply);
  busy = false;
  // Keep only the danger arrows that still fit: the attacker and the player's piece are both still there.
  dangerArrows = dangerArrows.filter((a) => chess.get(a.orig)?.color && chess.get(a.orig).color !== playerColour && chess.get(a.dest)?.color === playerColour);
  setArrows([]);
  syncBoard([mv.from, mv.to]);

  const overAfter = localGameOver();
  if (overAfter) endGame(overAfter);
  else {
    playerTurnStarts();
    // Not on top of a move comment or a danger warning; it can come on a later move.
    if (!comment && !danger) maybeTalkOpening();
  }
}

// ---------- Two players on one device ----------

// The side at the bottom: the player against the computer; with a friend White, or the side to move.
function boardSide() {
  if (!vsFriend) return colourName(playerColour);
  return flipBoard ? colourName(chess.turn()) : 'white';
}

// Turns the board if needed; the bar, the badge and the pause bubble follow.
function turnBoard() {
  if (cg.state.orientation === boardSide()) return;
  cg.set({ orientation: boardSide() });
  renderBar();
  placeBadge();
}

// The next player's turn: the board turns to them (after the move has been seen) and their help starts.
async function friendTurn(lastMove) {
  const id = gameId;
  if (flipBoard && cg.state.orientation !== colourName(chess.turn())) {
    busy = true;
    syncBoard(lastMove);
    await sleep(600);
    if (id !== gameId) return;
  }
  busy = false;
  playerColour = chess.turn();
  setArrows([]);
  turnBoard();
  syncBoard(lastMove);
  playerTurnStarts();
}

// A move in a game with a friend. The side that gets help is judged as against the computer
// (grade, comments, danger warnings, pause after a mistake); the other side just plays.
async function onFriendMove(orig, dest) {
  const piece = chess.get(orig);
  let promotion = '';
  if (piece?.type === 'p' && (dest[1] === '8' || dest[1] === '1')) {
    promotion = await choosePromotion();
    if (!promotion) {
      const prev = chess.history({ verbose: true }).at(-1);
      cg.set({ lastMove: prev ? [prev.from, prev.to] : undefined });
      syncBoard();
      return;
    }
  }
  const fenBefore = chess.fen();
  const id = gameId;
  const usedHint = hintUsed;
  const level = help();
  hintUsed = null;
  clearHint();
  clearTurnHelp();
  hideBadge();
  dangerArrows = [];
  chess.move({ from: orig, to: dest, promotion: promotion || undefined });

  busy = true;
  setArrows([]);
  syncBoard([orig, dest]);

  let r = null;
  if (level > 0) {
    try {
      r = await judgeMove(fenBefore, orig + dest + promotion, uciLine());
    } catch { /* no judgement: the game goes on */ }
    if (id !== gameId) return;
  }
  if (r) {
    if (usedHint) r.moment.hint = usedHint;
    moments.push(r.moment);
    showBadge(r.moment);
    if (r.moment.category === 'checkmate') react('celebrate');
    else if (level >= 2) react(['best', 'good', 'book'].includes(r.moment.category) ? 'happy' : 'worried');
    if (showBar) {
      analyses.set(r.fenAfter, Promise.resolve({ evalWhite: r.evalWhite, lines: [] }));
      setBar(r.evalWhite);
    }
  }
  const over = localGameOver();
  if (over) {
    busy = false;
    if (r && level >= 2 && r.moment.worthComment) coachSays(lines.praise(coach.id, r.moment));
    return endGame(over, Boolean(r) && level >= 2);
  }

  if (r) {
    const isMistake = r.moment.category === 'blunder' || r.moment.category === 'mistake';
    const gentle = level === 1;
    const pauses = level >= 2 ? isMistake : gentle && r.moment.category === 'blunder';
    let comment = null;
    if (gentle && pauses) {
      comment = lines.gentle(coach.id);
      speak(comment);
    } else if (level >= 2 && r.moment.worthComment) {
      comment = coachSays(isMistake ? lines.mistake(coach.id, r.moment) : lines.praise(coach.id, r.moment), isMistake ? 'warn' : '');
    }
    const danger = level >= 2 && r.threats?.length > 0;
    if (danger) showDanger(r.threats, Boolean(comment));
    else warnedAbout = new Set();

    if (pauses) {
      const choice = await pauseForMistake(r.moment, comment, gentle);
      if (choice === 'abort' || id !== gameId) return;
      if (choice === 'retry') {
        r.moment.retried = true;
        chess.undo();
        hideBadge();
        dangerArrows = [];
        setArrows(arrows.filter((a) => a.brush === 'green'));
        busy = false;
        const prev = chess.history({ verbose: true }).at(-1);
        cg.set({ lastMove: prev ? [prev.from, prev.to] : undefined });
        syncBoard();
        playerTurnStarts();
        return;
      }
    } else if (!comment && !danger) {
      maybeTalkOpening();
    }
  }
  friendTurn([orig, dest]);
}

// The coach's words at the end, only for the side(s) that had help.
function friendReview(winner) {
  const sides = ['w', 'b'].filter(helped);
  if (helpFor === 'none' || !sides.length) return;
  if (sides.length === 2) {
    if (winner) react('celebrate', 6000);
    coachSays(winner ? lines.line(coach.id, 'friendWin', { colour: t(colourName(winner)) }) : lines.line(coach.id, 'draw'));
    return;
  }
  const side = sides[0];
  const result = !winner ? 'draw' : winner === side ? 'win' : 'loss';
  const counts = { best: 0, mistake: 0, blunder: 0, total: 0 };
  for (const m of moments) {
    if (m.retried || m.playerColour !== colourName(side)) continue;
    counts.total += 1;
    if (counts[m.category] !== undefined) counts[m.category] += 1;
  }
  if (result === 'win') react('celebrate', 6000);
  coachSays(lines.review(coach.id, result, counts, helpLevel));
}

// Resign (the side to move gives up) or a draw both players agree on.
function finishByChoice(key, winner) {
  if (!vsFriend || !gameActive) return;
  gameId += 1;
  endPause('abort');
  gameActive = false;
  gameOver = false;
  busy = false;
  clearTurnHelp();
  clearHint();
  setArrows([]);
  endText = key;
  syncBoard();
  refreshFriendControls();
  friendReview(winner);
}

$('resign').addEventListener('click', () => {
  const loser = chess.turn();
  finishByChoice(loser === 'w' ? 'whiteResigned' : 'blackResigned', loser === 'w' ? 'b' : 'w');
});
$('agreeDraw').addEventListener('click', () => finishByChoice('drawAgreed', null));

// Settings for the next game (opponent) and for the game on the board (help for, flip).
function refreshFriendControls() {
  const friendChosen = $('opponent').value === 'friend';
  $('colourRow').hidden = friendChosen;
  $('levelRow').hidden = friendChosen;
  $('helpForRow').hidden = !friendChosen;
  $('flipRow').hidden = !friendChosen;
  $('friendButtons').hidden = !(vsFriend && gameActive);
  document.querySelectorAll('[data-help-for]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.helpFor === helpFor)));
  $('flipToggle').checked = flipBoard;
}

$('opponent').addEventListener('change', refreshFriendControls);
document.querySelectorAll('[data-help-for]').forEach((b) => b.addEventListener('click', () => {
  helpFor = b.dataset.helpFor;
  refreshFriendControls();
  if (vsFriend && gameActive && !busy) applyHelp();
}));
$('flipToggle').addEventListener('change', () => {
  flipBoard = $('flipToggle').checked;
  if (vsFriend && !busy) turnBoard();
});

async function computerStarts() {
  const id = gameId;
  busy = true;
  syncBoard();
  const [uci] = await Promise.all([computerMove(chess.fen(), level), sleep(400)]);
  if (id !== gameId) return;
  const mv = applyComputerMove(uci);
  busy = false;
  syncBoard([mv.from, mv.to]);
  playerTurnStarts();
}

function resultFor(over) {
  if (!over.winner) return 'draw';
  return over.winner === playerColour ? 'win' : 'loss';
}

function gameCounts() {
  const counts = { best: 0, mistake: 0, blunder: 0, total: moments.length };
  for (const m of moments) if (counts[m.category] !== undefined) counts[m.category] += 1;
  return counts;
}

// The coach's last words on the game: the result, then one thing about how it went.
async function endGame(over, delay = false) {
  gameActive = false;
  gameOver = true;
  clearTurnHelp();
  if (showBar) setBar(over.reason === 'checkmate' ? (over.winner === 'w' ? 10000 : -10000) : 0);
  const result = resultFor(over);
  if (vsFriend) endText = over.reason === 'checkmate' ? (over.winner === 'w' ? 'whiteWins' : 'blackWins') : over.reason === 'stalemate' ? 'stalemate' : 'draw';
  else endText = over.reason === 'checkmate' ? (result === 'win' ? 'youWon' : 'youLost') : over.reason === 'stalemate' ? 'stalemate' : 'draw';
  syncBoard();
  if (vsFriend) refreshFriendControls();
  const id = gameId;
  if (delay) await sleep(2500); // after the "Checkmate!" praise has been read
  if (id !== gameId) return;
  if (vsFriend) return friendReview(over.winner);
  if (result === 'win') react('celebrate', 6000);
  coachSays(lines.review(coach.id, result, gameCounts(), helpLevel));
}

function newGame() {
  if (!engineOk) return;
  gameId += 1;
  gameOver = false;
  endPause('abort');
  clearReaction();
  hideBadge();
  dangerArrows = [];
  clearTurnHelp();
  setArrows([]);
  hintUsed = null;
  clearHint();

  vsFriend = $('opponent').value === 'friend';
  playerColour = vsFriend ? 'w' : $('colour').value;
  chess = new Chess();
  moments = [];
  openingsTalked = new Set();
  warnedAbout = new Set();
  endText = '';
  gameActive = true;
  busy = false;
  cg.set({ orientation: boardSide(), lastMove: undefined });
  syncBoard();
  barWhite = 50;
  renderBar();
  refreshFriendControls();
  refreshHelpControls();

  if (gamesStarted++ > 0) addDivider();
  if (!vsFriend || helpFor !== 'none') coachSays(lines.greeting(coach.id));
  if (!vsFriend && playerColour === 'b') computerStarts();
  else playerTurnStarts();
}

// ---------- Play / Puzzles / Learn ----------

const puzzles = createPuzzles({
  t,
  coach: () => coach,
  addMessage,
  speak,
  react,
  refreshMood,
  talkPulse,
});

const learn = createLearn({
  t,
  coach: () => coach,
  addMessage,
  speak,
  react,
  refreshMood,
  play: () => setMode('play'),
});

// Switching keeps the game exactly as it is; it carries on when the player comes back.
function setMode(m) {
  if (m === mode) return;
  mode = m;
  if (synth) synth.cancel();
  pendingSpeech = null;
  waitingText = null;
  speaking = false;
  refreshTalking();
  const play = mode === 'play';
  const pz = mode === 'puzzles';
  const ln = mode === 'learn';
  document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  $('playView').hidden = !play;
  $('playControls').hidden = !play;
  $('messages').hidden = !play;
  $('puzzleView').hidden = !pz;
  $('puzzleControls').hidden = !pz;
  $('pzMessages').hidden = !pz;
  $('learnView').hidden = !ln;
  $('lnMessages').hidden = !ln;
  clearReaction();
  if (pz) puzzles.show();
  else if (ln) learn.show();
  else cg.redrawAll();
}

document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

// ---------- Controls ----------

$('colour').value = playerColour;
$('level').value = String(level);
$('levelValue').textContent = String(level);
$('level').addEventListener('input', () => {
  level = Number($('level').value);
  $('levelValue').textContent = String(level);
});
$('newGame').addEventListener('click', newGame);

applyTexts();
refreshFriendControls();
initAbout(t);

// Offline: the service worker keeps the page's own files so it opens without internet.
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

try {
  await engineReady;
  engineOk = true;
} catch (e) {
  console.error(e);
  engineOk = false;
}
$('newGame').disabled = !engineOk;
refreshStatus();
newGame();

// For automated tests: a read-only look at the state (nothing here is stored anywhere).
window.chessForAll = {
  get fen() { return chess.fen(); },
  get busy() { return busy; },
  get paused() { return Boolean(pause); },
  get gameOver() { return gameOver; },
  get moments() { return moments; },
  get puzzles() { return puzzles.state; },
  get learn() { return learn.state; },
  get vsFriend() { return vsFriend; },
  get orientation() { return cg.state.orientation; },
  get status() { return $('status').textContent; },
};
