// Tournament: 3–8 players on one device. Four screens (Format, Players, Settings, Play); the rules
// (pairings, colours, tables, tie-breaks) are in tournament-rules.js. Each player has their own help
// level 0–3, which works as in the Play tab, but only in that player's turn. There is no Undo: a
// move can only be taken back with "Try again" in the pause after a mistake, before the other
// player moves. No AI.
//
// A tournament that is still going is kept in localStorage on this device (so it can be finished
// after the app is closed) and removed completely when it ends. Nothing is ever sent anywhere.
import { Chessground } from './vendor/chessground/chessground.js';
import { Chess } from './vendor/chess.js/chess.js';
import { judgeMove, evaluate, piecesInDanger, gameOverInfo, uciToMove } from './analysis.js';
import { openingsReady, openingOf, openingFamily } from './openings.js';
import { COACHES, coachImage } from './coaches.js';
import { OPPONENTS, opponentImage } from './opponents.js';
import { cannotMate } from './ranked.js';
import * as lines from './coach-lines.js';
import { play, playMove } from './sounds.js';
import { confetti } from './confetti.js';
import * as R from './tournament-rules.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const colourName = (c) => (c === 'w' ? 'white' : 'black');
const other = (c) => (c === 'w' ? 'b' : 'w');
const KEY = 'chess-for-all-tournament';
const NAME_MAX = 12;

// The players' pictures: the coaches' and the computer opponents' faces.
const AVATARS = [
  ...COACHES.map((c) => ({ id: `coach-${c.id}`, kind: 'coach', key: c.id, src: (m) => coachImage(c, m) })),
  ...OPPONENTS.map((o) => ({ id: `opp-${o.id}`, kind: 'opp', key: o.id, src: (m) => opponentImage(o, m) })),
];
const avatarById = (id) => AVATARS.find((a) => a.id === id) || AVATARS[0];

// ---------- Saved tournament (this device only, until it ends) ----------

function loadSaved() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!s || !s.T || !Array.isArray(s.T.players) || !R.FORMAT_IDS.includes(s.T.format) || s.T.finished) return null;
    return s;
  } catch {
    return null;
  }
}

function removeSaved() {
  try {
    localStorage.removeItem(KEY);
  } catch { /* nothing kept anyway */ }
}

// ctx: { t, coach(), speak(text) }
export function createTournamentMode(ctx) {
  const { t } = ctx;
  const T_ = (key) => t(`tn.${key}`);
  const fill = (text, vars) => String(text).replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));

  let screen = 'format'; // 'format', 'players', 'settings' or 'play'
  let sub = 'next'; // on the Play screen: 'next', 'toss', 'game', 'result' or 'podium'
  let format = null;
  let players = []; // [{ id, name, avatar, help }] (kept only in memory until a tournament starts)
  let settings = { clock: 'none', flip: true, end: { type: 'games', value: 10 } };
  let T = null; // the tournament (tournament-rules.js)
  let current = null; // the game (or coin toss) being played: a game of T
  let G = null; // the board: { chess, moves, clock, side, clockSide, over, busy, threats, ... }
  let visible = false;
  let asked = false; // "Continue tournament?" asked once per visit
  let storageOk = true;
  let cg = null;
  let seq = 0;
  let turnStart = null;
  let ticker = null;
  let lastSecond = null;
  let elapsedTimer = null;
  let editing = null; // the player in the editor (null = a new one)
  let askResolve = null;
  let pause = null; // { resolve, moment }
  let turnHelp = null; // level 3: { fen, circles, lines, shown, timer }
  let dangerShapes = [];
  let pauseShapes = [];
  let lastToss = null;

  const playerById = (id) => (T?.players || players).find((p) => p.id === id);
  const helpOf = (side) => playerById(current?.[side === 'w' ? 'white' : 'black'])?.help ?? 0;
  const nameOf = (id) => playerById(id)?.name || '';

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // A player's picture (with a mood), name and help level.
  function face(id, mood = 'neutral', cls = 'tn-face') {
    const p = playerById(id);
    const img = el('img', cls);
    img.src = avatarById(p?.avatar).src(mood);
    img.alt = '';
    return img;
  }
  function helpBadge(level) {
    const b = el('span', `tn-help h${level}`, String(level));
    b.title = `${T_('helpLevel')} ${level}: ${T_('helps')[level].name}`;
    b.setAttribute('aria-label', b.title);
    return b;
  }
  function who(id, mood = 'neutral') {
    const w = el('span', 'tn-who');
    const p = playerById(id);
    w.append(face(id, mood), el('span', 'tn-name', p?.name || ''), helpBadge(p?.help ?? 0));
    return w;
  }
  function pieceIcon(kind, colour, cls = 'rk-icon small') {
    const wrap = el('span', `cg-wrap ${cls}`);
    wrap.setAttribute('aria-hidden', 'true');
    const p = document.createElement('piece');
    p.className = `${colour} ${kind}`;
    wrap.append(p);
    return wrap;
  }

  function save() {
    if (!T || T.finished) return;
    const s = { v: 1, T, live: null, at: Date.now() };
    if (G && current && !G.over && R.isBoardGame(current)) {
      s.live = { game: current.id, moves: G.moves.slice(), clock: G.clock ? { w: Math.round(left('w')), b: Math.round(left('b')), inc: G.clock.inc } : null };
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
      storageOk = true;
    } catch {
      storageOk = false;
    }
  }

  // ---------- Questions in the page (never a browser dialog) ----------

  function ask(text, yes, no, { cancel = true } = {}) {
    $('tnAskText').textContent = text;
    $('tnAskYes').textContent = yes;
    $('tnAskNo').textContent = no;
    $('tnAsk').dataset.cancel = String(cancel);
    $('tnAsk').hidden = false;
    $('tnAskNo').focus();
    return new Promise((resolve) => { askResolve = resolve; });
  }
  function answer(v) {
    if (v === null && $('tnAsk').dataset.cancel !== 'true') return;
    $('tnAsk').hidden = true;
    const r = askResolve;
    askResolve = null;
    r?.(v);
  }
  $('tnAskYes').addEventListener('click', () => answer(true));
  $('tnAskNo').addEventListener('click', () => answer(false));
  $('tnAskBackdrop').addEventListener('click', () => answer(null));
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('tnAsk').hidden) answer(null);
    else if (!$('tnEditor').hidden) closeEditor();
    else if (!$('tnStandingsBox').hidden) $('tnStandingsBox').hidden = true;
  });

  // ---------- Screens ----------

  function showScreen(s) {
    if (s !== screen && visible) window.scrollTo(0, 0);
    screen = s;
    for (const [id, name] of [['tnFormat', 'format'], ['tnPlayers', 'players'], ['tnSettings', 'settings'], ['tnPlay', 'play']]) $(id).hidden = s !== name;
    document.querySelectorAll('#tnSteps li').forEach((li, i) => {
      const idx = ['format', 'players', 'settings', 'play'].indexOf(s);
      li.classList.toggle('current', i === idx);
      li.classList.toggle('done', i < idx);
      if (i === idx) li.setAttribute('aria-current', 'step');
      else li.removeAttribute('aria-current');
    });
    if (s === 'format') renderFormats();
    if (s === 'players') renderPlayers();
    if (s === 'settings') renderSettings();
  }

  function showSub(s) {
    sub = s;
    for (const [id, name] of [['tnNext', 'next'], ['tnToss', 'toss'], ['tnGame', 'game'], ['tnResult', 'result'], ['tnPodium', 'podium']]) $(id).hidden = s !== name;
    $('tnTopButtons').hidden = s === 'podium';
    if (s === 'game') ensureBoard();
    if (visible) window.scrollTo(0, 0);
  }

  // ---------- 1. Format ----------

  function renderFormats() {
    const n = players.length;
    $('tnFormats').replaceChildren(...R.FORMAT_IDS.map((id) => {
      const f = R.FORMATS[id];
      const text = T_('formats')[id];
      const card = el('div', 'tn-format');
      const off = n >= 3 && !R.fits(id, n);
      card.classList.toggle('off', off);
      card.classList.toggle('chosen', format === id);
      const btn = el('button', 'tn-format-pick');
      btn.dataset.format = id;
      btn.setAttribute('aria-pressed', String(format === id));
      btn.disabled = off;
      btn.append(el('strong', 'tn-format-name', text.name), el('span', 'tn-format-about', text.about),
        el('span', 'tn-format-count', fill(T_('playersRange'), { min: f.min, max: f.max })));
      if (off) btn.append(el('span', 'tn-format-why', fill(T_('notFor'), { n, min: f.min, max: f.max })));
      const how = el('details', 'tn-how');
      how.append(el('summary', '', T_('howItWorks')));
      const ul = el('ul');
      for (const line of text.how) ul.append(el('li', '', line));
      how.append(ul);
      card.append(btn, how);
      return card;
    }));
    $('tnFormatNext').disabled = !format || (n >= 3 && !R.fits(format, n));
  }

  $('tnFormats').addEventListener('click', (e) => {
    const b = e.target.closest('[data-format]');
    if (!b || b.disabled) return;
    format = b.dataset.format;
    renderFormats();
  });
  $('tnFormatNext').addEventListener('click', () => showScreen('players'));

  // ---------- 2. Players ----------

  function renderPlayers() {
    const f = R.FORMATS[format];
    $('tnPlayersLead').textContent = fill(T_('playersLead'), { format: T_('formats')[format].name, min: f.min, max: f.max });
    $('tnPlayerList').replaceChildren(...players.map((p) => {
      const li = el('li', 'tn-player');
      li.append(face(p.id, 'neutral', 'tn-face big'));
      const text = el('span', 'tn-player-text');
      const name = el('strong', 'tn-name', p.name);
      const help = el('span', 'tn-player-help');
      help.append(helpBadge(p.help), el('span', '', T_('helps')[p.help].name));
      text.append(name, help);
      const edit = el('button', 'tn-small', T_('edit'));
      edit.dataset.edit = p.id;
      edit.setAttribute('aria-label', `${T_('edit')}: ${p.name}`);
      const del = el('button', 'tn-small danger', T_('remove'));
      del.dataset.remove = p.id;
      del.setAttribute('aria-label', `${T_('remove')}: ${p.name}`);
      li.append(text, edit, del);
      return li;
    }));
    const n = players.length;
    $('tnPlayersEmpty').hidden = n > 0;
    $('tnAdd').disabled = n >= f.max;
    let note = '';
    if (n < f.min) note = fill(T_(f.min - n === 1 ? 'needOneMore' : 'needMore'), { n: f.min - n });
    else if (n >= f.max) note = fill(T_('full'), { max: f.max });
    $('tnPlayersNote').textContent = note;
    $('tnPlayersNext').disabled = !R.fits(format, n);
  }

  $('tnPlayerList').addEventListener('click', (e) => {
    const ed = e.target.closest('[data-edit]');
    const rm = e.target.closest('[data-remove]');
    if (ed) openEditor(players.find((p) => p.id === ed.dataset.edit));
    if (rm) {
      players = players.filter((p) => p.id !== rm.dataset.remove);
      renderPlayers();
    }
  });
  $('tnAdd').addEventListener('click', () => openEditor(null));
  $('tnPlayersBack').addEventListener('click', () => showScreen('format'));
  $('tnPlayersNext').addEventListener('click', () => showScreen('settings'));

  // The player editor: name, picture and help level.
  let draft = null;
  function openEditor(p) {
    editing = p;
    const taken = new Set(players.filter((x) => x !== p).map((x) => x.avatar));
    draft = p ? { ...p } : { name: '', avatar: AVATARS.find((a) => !taken.has(a.id)).id, help: 2 };
    $('tnEditorTitle').textContent = T_(p ? 'editPlayer' : 'addPlayer');
    $('tnName').value = draft.name;
    $('tnNameError').textContent = '';
    renderEditor();
    $('tnEditor').hidden = false;
    $('tnName').focus();
  }
  function renderEditor() {
    const taken = new Set(players.filter((x) => x !== editing).map((x) => x.avatar));
    $('tnAvatars').replaceChildren(...AVATARS.map((a) => {
      const b = el('button', 'tn-avatar');
      b.dataset.avatar = a.id;
      b.setAttribute('aria-pressed', String(draft.avatar === a.id));
      b.disabled = taken.has(a.id);
      const name = a.kind === 'coach' ? t('coaches')[a.key].name : t('opponents')[a.key].name;
      b.setAttribute('aria-label', taken.has(a.id) ? `${name} (${T_('taken')})` : name);
      b.title = name;
      const img = el('img');
      img.src = a.src('neutral');
      img.alt = '';
      b.append(img);
      return b;
    }));
    $('tnHelpCards').replaceChildren(...[0, 1, 2, 3].map((lvl) => {
      const b = el('button', 'tn-help-card');
      b.dataset.help = String(lvl);
      b.setAttribute('aria-pressed', String(draft.help === lvl));
      const head = el('span', 'tn-help-head');
      head.append(helpBadge(lvl), el('strong', '', T_('helps')[lvl].name));
      b.append(head, el('span', 'tn-help-about', T_('helps')[lvl].about));
      return b;
    }));
  }
  $('tnAvatars').addEventListener('click', (e) => {
    const b = e.target.closest('[data-avatar]');
    if (!b || b.disabled) return;
    draft.avatar = b.dataset.avatar;
    renderEditor();
  });
  $('tnHelpCards').addEventListener('click', (e) => {
    const b = e.target.closest('[data-help]');
    if (!b) return;
    draft.help = Number(b.dataset.help);
    renderEditor();
  });
  function closeEditor() {
    $('tnEditor').hidden = true;
    editing = null;
    draft = null;
  }
  $('tnEditorCancel').addEventListener('click', closeEditor);
  $('tnEditorBackdrop').addEventListener('click', closeEditor);
  $('tnEditorForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('tnName').value.trim().replace(/\s+/g, ' ');
    let error = '';
    if (!name) error = T_('nameNeeded');
    else if (name.length > NAME_MAX) error = fill(T_('nameLong'), { n: NAME_MAX });
    else if (players.some((p) => p !== editing && p.name.toLowerCase() === name.toLowerCase())) error = T_('nameTaken');
    $('tnNameError').textContent = error;
    if (error) return $('tnName').focus();
    if (editing) Object.assign(editing, { name, avatar: draft.avatar, help: draft.help });
    else {
      const id = `p${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
      players.push({ id, name, avatar: draft.avatar, help: draft.help });
    }
    closeEditor();
    renderPlayers();
  });

  // ---------- 3. Settings ----------

  function renderSettings() {
    document.querySelectorAll('[data-tn-clock]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tnClock === settings.clock)));
    $('tnFlip').checked = settings.flip;
    $('tnEndRow').hidden = format !== 'wso';
    document.querySelectorAll('[data-tn-end]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tnEnd === `${settings.end.type}:${settings.end.value}`)));
    const sizes = { rr: players.length * (players.length - 1) / 2, drr: players.length * (players.length - 1) };
    const parts = [T_('formats')[format].name, fill(T_('nPlayers'), { n: players.length })];
    if (sizes[format]) parts.push(fill(T_('nGames'), { n: sizes[format] }));
    $('tnSummary').textContent = parts.join(' · ');
  }
  document.querySelectorAll('[data-tn-clock]').forEach((b) => b.addEventListener('click', () => {
    settings.clock = b.dataset.tnClock;
    renderSettings();
  }));
  $('tnFlip').addEventListener('change', () => { settings.flip = $('tnFlip').checked; });
  document.querySelectorAll('[data-tn-end]').forEach((b) => b.addEventListener('click', () => {
    const [type, value] = b.dataset.tnEnd.split(':');
    settings.end = { type, value: Number(value) };
    renderSettings();
  }));
  $('tnSettingsBack').addEventListener('click', () => showScreen('players'));
  $('tnGo').addEventListener('click', () => startTournament());

  function startTournament() {
    T = R.createTournament(format, players, settings);
    current = null;
    G = null;
    showScreen('play');
    goNext();
    countTime();
  }

  // ---------- 4. Play ----------

  function progressText() {
    if (!T) return '';
    const done = T.games.filter((g) => g.kind === 'game' && g.done).length;
    const planned = R.plannedGames(T);
    if (T.format === 'wso' && T.settings.end.type === 'time') {
      const leftMin = Math.max(0, Math.ceil((T.settings.end.value * 60000 - T.wso.elapsed) / 60000));
      return fill(T_('timeLeft'), { n: leftMin, done });
    }
    if (planned) return fill(T_('gamesPlayed'), { done, total: planned });
    return fill(T_('gamesPlayedOnly'), { done });
  }

  function refreshHeader() {
    if (!T) return;
    $('tnTitle').textContent = T_('formats')[T.format].name;
    $('tnProgress').textContent = progressText();
  }

  // What a game is: round, stage, kind.
  function gameLabel(g) {
    const parts = [];
    if (g.stage === 'rr') parts.push(fill(T_('roundN'), { n: g.round }));
    if (g.stage === 'group') parts.push(fill(T_('groupRound'), { group: g.group, n: g.round }));
    if (g.stage === 'ko') parts.push(T_('rounds')[R.roundName(T, g.round)]);
    if (g.stage === 'third') parts.push(T_('rounds').third);
    if (g.stage === 'final') parts.push(T_('rounds').final);
    if (g.stage === 'wso') parts.push(fill(T_('gameN'), { n: g.round }));
    if (g.stage === 'playoff') parts.push(T_('playoff'));
    if (g.kind === 'rematch') parts.push(T_('rematch'));
    if (g.kind === 'armageddon' || g.kind === 'playoff') parts.push(T_('armageddon'));
    return parts.join(' · ');
  }

  function goNext() {
    current = R.nextGame(T);
    G = null;
    save();
    refreshHeader();
    if (!current) return showPodium();
    if (current.kind === 'coin' || current.kind === 'lots') return showToss();
    renderNext();
  }

  // "Next game": the two players, their colours, and Start.
  function renderNext(resume = false) {
    showSub('next');
    refreshHeader();
    $('tnNextLabel').textContent = gameLabel(current);
    const card = (id, colour) => {
      const box = el('div', `tn-next-player ${colour}`);
      const col = el('span', 'tn-next-colour');
      col.append(pieceIcon('king', colour), el('span', '', t(colour)));
      box.append(face(id, 'happy', 'tn-face huge'), el('strong', 'tn-name', nameOf(id)), helpBadgeLine(id), col);
      return box;
    };
    const vs = el('span', 'tn-vs', 'VS');
    $('tnNextPlayers').replaceChildren(card(current.white, 'white'), vs, card(current.black, 'black'));
    let note = '';
    if (current.kind === 'armageddon' || current.kind === 'playoff') note = T_('armageddonNote');
    else if (current.kind === 'rematch') note = T_('rematchNote');
    else if (T.format === 'wso' && current.king) {
      const n = T.wso.streak[current.king] || 0;
      note = fill(T_(n === 1 ? 'staysOnOne' : 'staysOn'), { name: nameOf(current.king), n });
    }
    $('tnNextNote').textContent = note;
    $('tnNextNote').hidden = !note;
    $('tnStart').querySelector('span:last-child').textContent = T_(resume ? 'continueGame' : 'startGame');
  }
  function helpBadgeLine(id) {
    const p = playerById(id);
    const line = el('span', 'tn-player-help');
    line.append(helpBadge(p.help), el('span', '', T_('helps')[p.help].name));
    return line;
  }

  $('tnStart').addEventListener('click', () => {
    if (!current) return;
    const saved = loadSaved();
    if (!G && saved?.live?.game === current.id) startGame(saved.live);
    else if (G && !G.over) resumeGame();
    else startGame(null);
  });

  // ---------- Coin toss and drawing lots ----------

  function showToss() {
    showSub('toss');
    const lots = current.kind === 'lots';
    $('tnTossTitle').textContent = T_(lots ? 'lotsTitle' : 'coinTitle');
    $('tnTossLabel').textContent = gameLabel(current);
    $('tnTossText').textContent = T_(lots ? 'lotsText' : current.stage === 'playoff' ? 'coinPlayoffText' : 'coinKoText');
    $('tnTossResult').textContent = '';
    $('tnTossGo').hidden = false;
    $('tnTossDone').hidden = true;
    $('tnCoin').hidden = lots;
    const ids = lots ? current.players : [current.a, current.b];
    $('tnTossPlayers').replaceChildren(...ids.map((id) => {
      const b = el('div', 'tn-toss-player');
      b.dataset.id = id;
      b.append(face(id), el('strong', 'tn-name', nameOf(id)), helpBadge(playerById(id).help));
      return b;
    }));
    if (!lots) {
      $('tnCoinA').replaceChildren(face(current.a, 'neutral', 'tn-coin-img'));
      $('tnCoinB').replaceChildren(face(current.b, 'neutral', 'tn-coin-img'));
      $('tnCoin').style.transition = 'none';
      $('tnCoin').style.transform = 'rotateY(0deg)';
    }
  }

  $('tnTossGo').addEventListener('click', async () => {
    if (!current || (current.kind !== 'coin' && current.kind !== 'lots')) return;
    $('tnTossGo').hidden = true;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const g = current;
    if (g.kind === 'coin') {
      const winner = Math.random() < 0.5 ? g.a : g.b;
      const coin = $('tnCoin');
      coin.getBoundingClientRect();
      coin.style.transition = reduce ? 'none' : 'transform 2200ms cubic-bezier(.2, .7, .3, 1)';
      coin.style.transform = `rotateY(${winner === g.a ? 1800 : 1980}deg)`;
      play('tick');
      if (!reduce) await sleep(2300);
      if (current !== g) return;
      R.recordResult(T, g.id, { winner });
      lastToss = { winner };
      $('tnTossResult').textContent = fill(T_('coinWinner'), { name: nameOf(winner) });
    } else {
      const order = g.players.slice().sort(() => Math.random() - 0.5);
      const boxes = [...$('tnTossPlayers').children];
      if (!reduce) {
        for (let i = 0; i < 14; i++) {
          boxes.forEach((b) => b.classList.remove('lit'));
          boxes[Math.floor(Math.random() * boxes.length)].classList.add('lit');
          play('tick');
          await sleep(110);
        }
      }
      if (current !== g) return;
      boxes.forEach((b) => b.classList.remove('lit'));
      R.recordResult(T, g.id, { order });
      $('tnTossPlayers').replaceChildren(...order.map((id, i) => {
        const b = el('div', 'tn-toss-player done');
        b.append(el('span', 'tn-toss-place', `${i + 1}.`), face(id), el('strong', 'tn-name', nameOf(id)), helpBadge(playerById(id).help));
        return b;
      }));
      $('tnTossResult').textContent = T_('lotsDone');
    }
    play('right');
    save();
    $('tnTossDone').hidden = false;
    $('tnTossDone').focus();
  });
  $('tnTossDone').addEventListener('click', () => goNext());

  // ---------- The board ----------

  function ensureBoard() {
    if (cg) return cg.redrawAll();
    cg = Chessground($('tnBoard'), {
      movable: { free: false, color: undefined, showDests: true, events: { after: onMove } },
      premovable: { enabled: false },
      drawable: { enabled: false, visible: true },
      highlight: { lastMove: true, check: true },
      animation: { enabled: true, duration: 220 },
    });
  }

  function dests(chess) {
    const map = new Map();
    for (const mv of chess.moves({ verbose: true })) {
      if (!map.has(mv.from)) map.set(mv.from, []);
      map.get(mv.from).push(mv.to);
    }
    return map;
  }

  const canMove = () => G && !G.over && !G.busy && !pause && visible && sub === 'game';

  function boardSide() {
    if (!T.settings.flip) return 'white';
    return colourName(G.side);
  }

  function sync(lastMove) {
    const c = G.chess;
    const mine = canMove() && c.turn() === G.side;
    cg.set({
      fen: c.fen(),
      orientation: boardSide(),
      turnColor: colourName(c.turn()),
      check: c.inCheck() ? colourName(c.turn()) : false,
      lastMove: lastMove || cg.state.lastMove,
      movable: { color: mine ? colourName(G.side) : undefined, dests: mine ? dests(c) : new Map() },
    });
    placeBadge();
    renderBars();
    refreshGameButtons();
  }

  function drawShapes() {
    const turn = [];
    if (turnHelp) {
      turn.push(...turnHelp.circles);
      if (turnHelp.shown && turnHelp.lines) {
        turnHelp.lines.slice(0, 2).forEach((l, i) => turn.push({ orig: l.uci.slice(0, 2), dest: l.uci.slice(2, 4), brush: i === 0 ? 'green' : 'paleGreen' }));
      }
    }
    cg?.setAutoShapes([...dangerShapes, ...turn, ...pauseShapes]);
    const kinds = new Set([...dangerShapes, ...turn, ...pauseShapes].map((s) => s.brush + (s.dest ? '' : 'Circle')));
    $('tnLegendRed').hidden = !kinds.has('red');
    $('tnLegendRedCircle').hidden = !kinds.has('redCircle');
    $('tnLegendGreen').hidden = !kinds.has('green');
    $('tnLegend').hidden = !kinds.size;
  }

  // The two player bars: the side at the bottom of the board below it.
  function renderBars() {
    if (!G || !current) return;
    const bottom = boardSide() === 'white' ? 'w' : 'b';
    for (const [id, side] of [['tnBarTop', other(bottom)], ['tnBarBottom', bottom]]) {
      const bar = $(id);
      const pid = side === 'w' ? current.white : current.black;
      const mood = G.over ? (G.winner === side ? 'celebrate' : G.winner ? 'worried' : 'neutral') : 'neutral';
      bar.querySelector('.tn-bar-who').replaceChildren(pieceIcon('king', colourName(side)), who(pid, mood));
      bar.classList.toggle('active', !G.over && G.side === side);
      const time = bar.querySelector('.rk-time');
      time.hidden = !G.clock;
      if (G.clock) {
        const ms = left(side);
        time.textContent = format_(ms);
        bar.classList.toggle('low', ms < 10000);
      } else bar.classList.remove('low');
    }
  }

  function format_(ms) {
    if (ms < 10000) return `0:0${(Math.floor(ms / 100) / 10).toFixed(1)}`;
    const s = Math.ceil(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function refreshGameButtons() {
    const on = canMove();
    $('tnResign').disabled = !on;
    $('tnDraw').disabled = !on;
    $('tnShowBest').hidden = !(G && helpOf(G.side) >= 3 && !G.over);
    $('tnShowBest').disabled = !on || !turnHelp || turnHelp.shown;
    if (!G || G.over) return;
    const pid = G.side === 'w' ? current.white : current.black;
    let status = fill(T_(G.chess.inCheck() && !pause ? 'toMoveCheck' : 'toMove'), { name: nameOf(pid), colour: t(colourName(G.side)) });
    if (pause) status = fill(T_('paused'), { name: nameOf(pid) });
    else if (G.busy) status = T_('looking');
    $('tnStatus').textContent = status;
    $('tnStatus').className = `status turn-${G.side}`;
  }

  // ---------- Clocks (as in Ranked) ----------

  // Milliseconds left for `side` now.
  function left(side) {
    if (!G?.clock) return 0;
    let ms = G.clock[side];
    if (turnStart !== null && side === G.clockSide) ms -= performance.now() - turnStart;
    return Math.max(0, ms);
  }
  const clockActive = () => visible && !document.hidden && screen === 'play' && sub === 'game';

  // The clock of `side` runs (or none). The clock starts after White's first move.
  function setClock(side) {
    stopClock();
    if (!G?.clock || G.over) return;
    G.clockSide = G.moves.length > 0 ? side : null;
    resumeClock();
  }
  function resumeClock() {
    if (!G?.clock || G.over || !G.clockSide || turnStart !== null || !clockActive()) return renderBars();
    turnStart = performance.now();
    if (!ticker) ticker = setInterval(tick, 100);
    renderBars();
  }
  function stopClock() {
    if (G?.clock && turnStart !== null && G.clockSide) G.clock[G.clockSide] = left(G.clockSide);
    turnStart = null;
    clearInterval(ticker);
    ticker = null;
  }
  function tick() {
    if (!G || G.over) return;
    renderBars();
    if (turnStart === null || !G.clockSide) return;
    const ms = left(G.clockSide);
    const s = Math.ceil(ms / 1000);
    if (s !== lastSecond) {
      lastSecond = s;
      if (s <= 10 && s > 0) play('tick');
    }
    if (ms <= 0) flag(G.clockSide);
  }

  function flag(side) {
    if (!G || G.over) return;
    // Out of time during the pause after a mistake: the move had not been kept.
    if (pause) {
      endPause('abort');
      G.chess.undo();
    }
    if (cannotMate(G.chess, other(side))) return finishGame('d', 'timeoutDraw');
    finishGame(side === 'w' ? 'b' : 'w', 'timeout');
  }

  // ---------- A game ----------

  function startGame(live) {
    seq += 1;
    stopClock();
    const chess = new Chess();
    const moves = [];
    if (live) {
      for (const u of live.moves) {
        try {
          chess.move(uciToMove(u));
          moves.push(u);
        } catch { break; }
      }
    }
    const clock = R.gameClock(T, current);
    if (clock && live?.clock) Object.assign(clock, { w: live.clock.w, b: live.clock.b });
    G = { chess, moves, clock, side: chess.turn(), clockSide: null, over: false, busy: false, threats: { w: [], b: [] }, talked: new Set(), winner: null };
    lastSecond = null;
    pause = null;
    turnHelp = null;
    dangerShapes = [];
    pauseShapes = [];
    $('tnPause').hidden = true;
    $('tnPromo').hidden = true;
    hideBadge();
    coachLine('');
    showSub('game');
    $('tnGameLabel').textContent = gameLabel(current);
    const last = moves.at(-1);
    cg.set({ lastMove: last ? [last.slice(0, 2), last.slice(2, 4)] : undefined });
    turnStarts(G.chess.turn());
    save();
  }

  // Back to a game that was waiting (another tab, or the Standings).
  function resumeGame() {
    showSub('game');
    sync();
    resumeClock();
  }

  // A player's turn starts: the board turns to them, their clock runs and their help starts.
  function turnStarts(side) {
    G.side = side;
    G.busy = false;
    hideBadge();
    clearTurnHelp();
    dangerShapes = [];
    pauseShapes = [];
    coachLine('');
    sync();
    setClock(side);
    const level = helpOf(side);
    // Level 2–3: pieces this player's last move left in danger, if they still are.
    if (level >= 2) {
      const still = G.threats[side].filter((x) => G.chess.get(x.square)?.color === side
        && x.attackers.some((a) => G.chess.get(a) && G.chess.get(a).color !== side));
      if (still.length) {
        dangerShapes = still.flatMap((x) => x.attackers.filter((a) => G.chess.get(a)?.color === other(side)).map((a) => ({ orig: a, dest: x.square, brush: 'red' })));
        coachLine(lines.danger(ctx.coach().id, still), 'warn');
      }
    }
    if (level >= 3) startTurnHelp(side);
    drawShapes();
    refreshGameButtons();
  }

  // Level 3: the player's pieces in danger before they move, and the two best moves after 8 seconds.
  function startTurnHelp(side) {
    const fen = G.chess.fen();
    const my = seq;
    const me = { fen, circles: piecesInDanger(fen, side).map((x) => ({ orig: x.square, brush: 'red' })), lines: null, shown: false, timer: null };
    turnHelp = me;
    const still = () => turnHelp === me && my === seq && G && G.chess.fen() === fen;
    evaluate(fen).then((a) => {
      if (!still() || !a) return;
      me.lines = a.lines;
      drawShapes();
    }).catch(() => {});
    me.timer = setTimeout(() => {
      if (!still()) return;
      me.shown = true;
      drawShapes();
      refreshGameButtons();
    }, 8000);
  }
  function clearTurnHelp() {
    if (turnHelp?.timer) clearTimeout(turnHelp.timer);
    turnHelp = null;
  }
  $('tnShowBest').addEventListener('click', () => {
    if (!turnHelp || turnHelp.shown) return;
    turnHelp.shown = true;
    drawShapes();
    refreshGameButtons();
  });

  // The coach's words for the player whose turn it is (help 1–3), under the board.
  function coachLine(text, kind = '') {
    $('tnCoach').hidden = !text;
    $('tnCoachText').textContent = text || '';
    $('tnCoach').className = `tn-coach ${kind}`.trim();
    const c = ctx.coach();
    $('tnCoachImg').src = coachImage(c, kind === 'warn' ? 'worried' : 'happy');
    if (text) ctx.speak(text);
  }

  // The mark of the player's move (help 2–3) on the square it went to.
  let badgeSquare = null;
  function showBadge(moment) {
    const MARK = { book: '📖', best: '!!', checkmate: '!!', good: '!', inaccuracy: '?!', mistake: '?', blunder: '??' };
    const mark = MARK[moment.category];
    if (!mark) return hideBadge();
    badgeSquare = moment.to;
    $('tnBadge').textContent = mark;
    $('tnBadge').className = `badge ${moment.category === 'checkmate' ? 'best' : moment.category}`;
    $('tnBadge').hidden = false;
    placeBadge();
  }
  function placeBadge() {
    if (!badgeSquare || !cg) return;
    const white = cg.state.orientation === 'white';
    const file = 'abcdefgh'.indexOf(badgeSquare[0]);
    const rank = Number(badgeSquare[1]);
    $('tnBadge').style.left = `${((white ? file : 7 - file) + 1) * 12.5}%`;
    $('tnBadge').style.top = `${(white ? 8 - rank : rank - 1) * 12.5}%`;
  }
  function hideBadge() {
    $('tnBadge').hidden = true;
    badgeSquare = null;
  }

  function choosePromotion(side) {
    document.querySelectorAll('#tnPromo piece').forEach((p) => {
      p.classList.toggle('white', side === 'w');
      p.classList.toggle('black', side === 'b');
    });
    $('tnPromo').hidden = false;
    return new Promise((resolve) => {
      $('tnPromo').onclick = (e) => {
        const btn = e.target.closest('[data-promo]');
        if (!btn && e.target.closest('.promo-card')) return;
        $('tnPromo').hidden = true;
        $('tnPromo').onclick = null;
        resolve(btn ? btn.dataset.promo : null);
      };
    });
  }

  async function onMove(orig, dest) {
    if (!canMove()) return;
    const my = seq;
    const side = G.side;
    const c = G.chess;
    let promotion = '';
    if (c.get(orig)?.type === 'p' && (dest[1] === '8' || dest[1] === '1')) {
      promotion = await choosePromotion(side);
      if (my !== seq || !G || G.over) return;
      if (!promotion) return sync();
    }
    const fenBefore = c.fen();
    const uci = orig + dest + promotion;
    const level = helpOf(side);
    clearTurnHelp();
    hideBadge();
    dangerShapes = [];
    pauseShapes = [];
    coachLine('');
    const mv = c.move({ from: orig, to: dest, promotion: promotion || undefined });
    playMove(mv, c);
    // The engine looks at the move: the player's clock waits (it is not their time).
    stopClock();
    G.busy = true;
    sync([orig, dest]);
    drawShapes();

    let r = null;
    if (level > 0) {
      try {
        r = await judgeMove(fenBefore, uci, [...G.moves, uci]);
      } catch { /* no judgement: the game goes on */ }
      if (my !== seq || !G || G.over) return;
    }
    if (r && level >= 2) showBadge(r.moment);
    const over = gameOverInfo(c);
    if (over) {
      confirmMove(side, uci);
      if (r && level >= 2 && r.moment.category === 'checkmate') coachLine(lines.praise(ctx.coach().id, r.moment));
      const result = over.winner ? over.winner : 'd';
      return finishGame(result, over.reason === 'draw' ? 'fifty' : over.reason);
    }
    let comment = '';
    if (r) {
      const cat = r.moment.category;
      const isMistake = cat === 'blunder' || cat === 'mistake';
      const pauses = level >= 2 ? isMistake : level === 1 && cat === 'blunder';
      if (pauses) {
        const gentle = level === 1;
        const text = gentle ? lines.gentle(ctx.coach().id) : lines.mistake(ctx.coach().id, r.moment);
        // The pause: the player's clock keeps running while they decide.
        G.clockSide = G.moves.length > 0 ? side : null;
        resumeClock();
        const choice = await pauseForMistake(r.moment, text, gentle);
        if (choice === 'abort' || my !== seq || !G || G.over) return;
        stopClock();
        if (choice === 'retry') {
          // The move is taken back; it is still this player's turn (their clock goes on).
          c.undo();
          hideBadge();
          pauseShapes = pauseShapes.filter((s) => s.brush === 'green');
          G.busy = false;
          const prev = G.moves.at(-1);
          cg.set({ lastMove: prev ? [prev.slice(0, 2), prev.slice(2, 4)] : undefined });
          sync();
          drawShapes();
          setClock(side);
          if (level >= 3) startTurnHelp(side);
          return;
        }
      } else if (level >= 2 && r.moment.worthComment) {
        comment = lines.praise(ctx.coach().id, r.moment);
      }
      if (level >= 2) G.threats[side] = r.threats || [];
    }
    pauseShapes = [];
    confirmMove(side, uci);
    if (comment) coachLine(comment);
    else if (level >= 2) talkOpening(side);
    // The mark stays a moment so the player sees it, then the next player's turn starts.
    const wait = $('tnBadge').hidden && !comment ? 0 : 1200;
    const turnAfter = T.settings.flip && boardSide() !== colourName(other(side)) ? 600 : 0;
    if (wait + turnAfter) await sleep(wait + turnAfter);
    if (my !== seq || !G || G.over) return;
    turnStarts(other(side));
  }

  // The move is kept: the increment (not for White's first move), and it is saved.
  function confirmMove(side, uci) {
    if (G.clock && G.moves.length > 0) G.clock[side] += G.clock.inc;
    G.moves.push(uci);
    save();
  }

  // Help 2–3: a few words about the opening, once per opening family.
  function talkOpening(side) {
    try {
      const { opening, inBook } = openingOf(G.moves);
      if (!opening || G.moves.length < 6) return;
      const family = openingFamily(opening.name);
      if (G.talked.has(family) || !inBook) return;
      G.talked.add(family);
      const c = new Chess();
      const book = opening.uci.map((u) => {
        const mv = c.move(uciToMove(u));
        return { to: mv.to, piece: { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' }[mv.piece] };
      });
      coachLine(lines.opening(ctx.coach().id, opening.name, book, side));
    } catch { /* no opening words */ }
  }
  openingsReady.catch(() => {});

  // ---------- The pause after a mistake (help 1: big mistakes only, 2–3: mistakes too) ----------

  function pauseForMistake(moment, text, gentle) {
    $('tnPauseText').textContent = text || '';
    $('tnPauseImg').src = coachImage(ctx.coach(), 'worried');
    $('tnShowBetter').hidden = gentle || !moment.bestUci;
    $('tnShowBetter').disabled = false;
    pauseShapes = !gentle && moment.replyUci ? [{ orig: moment.replyUci.slice(0, 2), dest: moment.replyUci.slice(2, 4), brush: 'red' }] : [];
    drawShapes();
    $('tnPause').hidden = false;
    $('tnTryAgain').focus({ preventScroll: true });
    if (text) ctx.speak(text);
    const choice = new Promise((resolve) => { pause = { resolve, moment }; });
    refreshGameButtons();
    return choice;
  }
  function endPause(choice) {
    if (!pause) return;
    const { resolve } = pause;
    pause = null;
    $('tnPause').hidden = true;
    resolve(choice);
  }
  $('tnTryAgain').addEventListener('click', () => endPause('retry'));
  $('tnKeepPlaying').addEventListener('click', () => endPause('continue'));
  $('tnShowBetter').addEventListener('click', () => {
    if (!pause?.moment.bestUci) return;
    const b = pause.moment.bestUci;
    pauseShapes = [...pauseShapes, { orig: b.slice(0, 2), dest: b.slice(2, 4), brush: 'green' }];
    $('tnShowBetter').disabled = true;
    drawShapes();
  });

  // ---------- Resign, draw offer, end of a game ----------

  $('tnResign').addEventListener('click', async () => {
    if (!canMove()) return;
    const side = G.side;
    const pid = side === 'w' ? current.white : current.black;
    const opp = side === 'w' ? current.black : current.white;
    const ok = await ask(fill(T_('resignAsk'), { name: nameOf(pid), other: nameOf(opp) }), T_('resignYes'), T_('cancel'));
    if (ok && G && !G.over && G.side === side) finishGame(other(side), 'resign');
  });
  $('tnDraw').addEventListener('click', async () => {
    if (!canMove()) return;
    const side = G.side;
    const pid = side === 'w' ? current.white : current.black;
    const opp = side === 'w' ? current.black : current.white;
    const ok = await ask(fill(T_('drawAsk'), { name: nameOf(pid), other: nameOf(opp) }), T_('drawYes'), T_('drawNo'));
    if (!G || G.over) return;
    if (ok) finishGame('d', 'agreed');
    else $('tnStatus').textContent = fill(T_('drawDeclined'), { other: nameOf(opp) });
  });

  // result: 'w', 'b' or 'd'
  function finishGame(result, reason) {
    if (!G || G.over) return;
    seq += 1;
    stopClock();
    endPause('abort');
    clearTurnHelp();
    G.over = true;
    G.clockSide = null;
    G.busy = false;
    $('tnPromo').hidden = true;
    const armageddon = current.kind === 'armageddon' || current.kind === 'playoff';
    G.winner = result === 'd' ? (armageddon ? 'b' : null) : result;
    cg.set({ movable: { color: undefined, dests: new Map() } });
    R.recordResult(T, current.id, { result, reason, moves: G.moves });
    save();
    sync();
    if (G.winner) {
      play('win');
      confetti();
    } else play('right');
    showResult(result, reason);
  }

  // After a game: the result, and the table or the bracket.
  function showResult(result, reason) {
    const g = current;
    const armageddon = g.kind === 'armageddon' || g.kind === 'playoff';
    const winnerId = g.winner;
    let title;
    if (winnerId) title = fill(T_('wins'), { name: nameOf(winnerId) });
    else title = T_('drawn');
    $('tnResultTitle').textContent = title;
    let why = T_('reasons')[reason] || '';
    if (armageddon && result === 'd') why = `${why} ${T_('armageddonDrawWin')}`.trim();
    $('tnResultReason').textContent = why;
    const faces = el('div', 'tn-result-faces');
    for (const [id, side] of [[g.white, 'w'], [g.black, 'b']]) {
      const box = el('div', 'tn-result-player');
      const mood = !winnerId ? 'neutral' : winnerId === id ? 'celebrate' : 'worried';
      box.append(face(id, mood, 'tn-face huge'), el('strong', 'tn-name', nameOf(id)), helpBadge(playerById(id).help));
      const col = el('span', 'tn-next-colour');
      col.append(pieceIcon('king', colourName(side)), el('span', '', t(colourName(side))));
      box.append(col);
      if (winnerId === id) box.classList.add('winner');
      faces.append(box);
    }
    $('tnResultFaces').replaceChildren(faces);
    $('tnResultStandings').replaceChildren(renderStandings());
    showSub('result');
    refreshHeader();
    // Is there another game (or toss) to come? Worked out on a copy, so nothing changes yet.
    const more = !T.finished && R.nextGame(structuredClone(T)) !== null;
    $('tnResultNext').querySelector('span:last-child').textContent = T_(more ? 'nextGame' : 'seeResults');
    $('tnResultNext').focus({ preventScroll: true });
  }
  $('tnResultNext').addEventListener('click', () => goNext());

  // ---------- Standings: tables and the bracket ----------

  function renderStandings() {
    const box = el('div', 'tn-standings');
    if (T.format === 'groups') {
      for (const gr of ['A', 'B']) {
        box.append(el('h3', 'tn-st-title', fill(T_('groupName'), { group: gr })));
        box.append(tableEl(R.table(T, T.groups[gr], gr, 2).rows, { qualify: 2 }));
      }
      if (T.ko) box.append(el('h3', 'tn-st-title', T_('finals')), bracketEl());
    } else if (T.format === 'ko') {
      box.append(bracketEl());
    } else {
      box.append(tableEl(R.table(T, T.players.map((p) => p.id), 'final', 3).rows, { bonus: T.format === 'wso' }));
      if (T.format === 'wso') box.append(queueEl());
    }
    return box;
  }

  function tableEl(rows, { bonus = false, qualify = 0, places = null } = {}) {
    const wrap = el('div', 'tn-table-wrap');
    const table = el('table', 'tn-table');
    const head = el('tr');
    const cols = ['#', T_('col').player, T_('col').played, T_('col').w, T_('col').d, T_('col').l];
    if (bonus) cols.push(T_('col').bonus);
    cols.push(T_('col').pts);
    for (const c of cols) head.append(el('th', '', c));
    const thead = el('thead');
    thead.append(head);
    const body = el('tbody');
    rows.forEach((r, i) => {
      const tr = el('tr');
      if (qualify && i < qualify) tr.classList.add('qualify');
      const place = places ? places.get(r.id) : r;
      tr.append(el('td', 'tn-place', place ? `${place.place}${place.shared ? '=' : ''}` : ''));
      const name = el('td', 'tn-td-player');
      name.append(who(r.id));
      tr.append(name);
      for (const v of [r.played, r.w, r.d, r.l]) tr.append(el('td', '', String(v)));
      if (bonus) tr.append(el('td', '', r.bonus ? `+${r.bonus}` : '0'));
      tr.append(el('td', 'tn-pts', pts(r.pts)));
      body.append(tr);
    });
    table.append(thead, body);
    wrap.append(table);
    return wrap;
  }
  const pts = (x) => (Number.isInteger(x) ? String(x) : `${Math.floor(x) || ''}½`);

  function queueEl() {
    const W = T.wso;
    const box = el('div', 'tn-queue');
    box.append(el('h3', 'tn-st-title', T_('queue')));
    const ol = el('ol', 'tn-queue-list');
    const open = T.games.find((g) => !g.done && g.kind === 'game');
    const order = [...(open ? [open.white, open.black] : W.king ? [W.king] : []), ...W.queue.filter((id) => !open || (id !== open.white && id !== open.black))];
    for (const id of order) {
      const li = el('li');
      li.append(face(id, 'neutral', 'tn-face small'), el('span', 'tn-name', nameOf(id)), helpBadge(playerById(id).help));
      if (W.streak[id]) li.append(el('span', 'tn-streak', fill(T_('streak'), { n: W.streak[id] })));
      ol.append(li);
    }
    box.append(ol);
    return box;
  }

  function bracketEl() {
    const box = el('div', 'tn-bracket');
    T.ko.rounds.forEach((round, r) => {
      const col = el('div', 'tn-round');
      const name = round.some((m) => m.final) ? T_('rounds').final : T_('rounds')[R.roundName(T, r)];
      col.append(el('h4', 'tn-round-name', name));
      for (const m of round) col.append(matchEl(m));
      box.append(col);
    });
    // Rounds still to come, empty.
    const size = T.ko.rounds[0].length;
    const total = T.format === 'groups' ? 2 : size === 4 ? 3 : 2;
    for (let r = T.ko.rounds.length; r < total; r++) {
      const col = el('div', 'tn-round later');
      const names = size === 4 ? ['quarter', 'semi', 'final'] : ['semi', 'final'];
      col.append(el('h4', 'tn-round-name', T_('rounds')[names[r]]));
      const count = r === total - 1 ? 2 : size / 2 ** r;
      for (let i = 0; i < count; i++) {
        const box2 = el('div', 'tn-match empty');
        box2.append(el('div', 'tn-match-row', '…'), el('div', 'tn-match-row', '…'));
        if (r === total - 1 && i === 0) box2.dataset.label = T_('rounds').third;
        col.append(box2);
      }
      box.append(col);
    }
    return box;
  }

  function matchEl(m) {
    const box = el('div', 'tn-match');
    if (m.third) box.dataset.label = T_('rounds').third;
    const games = m.games.map((id) => T.games.find((g) => g.id === id));
    for (const id of [m.a, m.b]) {
      const row = el('div', 'tn-match-row');
      if (id === null) {
        row.append(el('span', 'tn-bye', T_('bye')));
        row.classList.add('bye');
      } else {
        row.append(face(id, m.winner === id ? 'happy' : 'neutral', 'tn-face small'), el('span', 'tn-name', nameOf(id)), helpBadge(playerById(id).help));
        const marks = el('span', 'tn-match-marks');
        for (const g of games.filter((x) => x.done)) {
          let s;
          if (g.kind === 'coin') s = g.winner === id ? '🪙' : '·';
          else s = g.result === 'd' ? (g.kind === 'armageddon' && g.winner === id ? '1' : g.kind === 'armageddon' ? '0' : '½') : g.winner === id ? '1' : '0';
          marks.append(el('span', `tn-mark ${g.kind}`, s));
        }
        row.append(marks);
        if (m.winner === id) row.classList.add('won');
        if (m.winner && m.winner !== id) row.classList.add('lost');
      }
      box.append(row);
    }
    return box;
  }

  $('tnStandingsOpen').addEventListener('click', () => {
    if (!T) return;
    $('tnStandingsBody').replaceChildren(renderStandings());
    $('tnStandingsBox').hidden = false;
    $('tnStandingsClose').focus();
  });
  $('tnStandingsClose').addEventListener('click', () => { $('tnStandingsBox').hidden = true; });
  $('tnStandingsBackdrop').addEventListener('click', () => { $('tnStandingsBox').hidden = true; });

  $('tnEnd').addEventListener('click', async () => {
    const ok = await ask(T_('endAsk'), T_('endYes'), T_('cancel'));
    if (!ok) return;
    endTournament();
    showScreen('format');
  });

  function endTournament() {
    seq += 1;
    stopClock();
    endPause('abort');
    clearTurnHelp();
    T = null;
    current = null;
    G = null;
    removeSaved();
  }

  // ---------- The end: podium ----------

  function showPodium() {
    stopClock();
    showSub('podium');
    removeSaved(); // the tournament is over: nothing is kept
    const rank = T.ranking;
    const at = (place) => rank.filter((r) => r.place === place);
    const steps = [[2, 'second'], [1, 'first'], [3, 'third']];
    $('tnPodiumSteps').replaceChildren(...steps.map(([place, cls]) => {
      const col = el('div', `tn-step ${cls}`);
      for (const r of at(place)) {
        const p = el('div', 'tn-step-player');
        p.append(face(r.id, place === 1 ? 'celebrate' : 'happy', 'tn-face huge'), el('strong', 'tn-name', nameOf(r.id)), helpBadge(playerById(r.id).help));
        col.append(p);
      }
      col.append(el('div', 'tn-step-block', String(place)));
      return col;
    }));
    $('tnChampion').textContent = fill(T_('champion'), { name: at(1).map((r) => nameOf(r.id)).join(' & ') });
    // The full table: in table formats the final table, otherwise the places.
    const places = new Map(rank.map((r) => [r.id, r]));
    if (T.format === 'rr' || T.format === 'drr' || T.format === 'wso') {
      const rows = R.table(T, T.players.map((p) => p.id), 'final', 3).rows;
      rows.sort((a, b) => places.get(a.id).place - places.get(b.id).place);
      $('tnFinalTable').replaceChildren(tableEl(rows, { bonus: T.format === 'wso', places }));
    } else {
      const ol = el('ol', 'tn-final-list');
      for (const r of rank) {
        const li = el('li');
        li.append(el('span', 'tn-place', `${r.place}${r.shared ? '=' : ''}`), who(r.id, r.place === 1 ? 'celebrate' : 'neutral'));
        ol.append(li);
      }
      $('tnFinalTable').replaceChildren(ol);
    }
    play('win');
    confetti({ big: true });
  }

  $('tnAgain').addEventListener('click', () => {
    if (!T) return;
    players = T.players.map((p) => ({ ...p }));
    format = T.format;
    settings = structuredClone(T.settings);
    startTournament();
  });
  $('tnNew').addEventListener('click', () => {
    T = null;
    players = [];
    format = null;
    showScreen('format');
  });

  // ---------- Winner Stays On: playing time ----------

  function countTime() {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
    if (!T || T.format !== 'wso' || T.settings.end.type !== 'time' || T.finished || !visible) return;
    let last = performance.now();
    let n = 0;
    elapsedTimer = setInterval(() => {
      const now = performance.now();
      if (!document.hidden) T.wso.elapsed += now - last;
      last = now;
      refreshHeader();
      if (++n % 10 === 0) save();
    }, 1000);
  }

  // ---------- Hidden page or app closed: the clock stops and everything is kept ----------

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      save();
      stopClock();
    } else if (visible && G && !G.over) resumeClock();
  });
  window.addEventListener('pagehide', () => save());

  // Opening the tab with a tournament kept from last time.
  async function offerSaved() {
    const s = loadSaved();
    if (!s || T) return;
    const go = await ask(fill(T_('savedAsk'), { format: T_('formats')[s.T.format].name, n: s.T.players.length }), T_('continueTournament'), T_('endIt'), { cancel: false });
    if (!go) {
      removeSaved();
      return showScreen('format');
    }
    T = s.T;
    players = T.players.map((p) => ({ ...p }));
    format = T.format;
    settings = structuredClone(T.settings);
    showScreen('play');
    current = R.nextGame(T);
    refreshHeader();
    countTime();
    if (!current) return showPodium();
    if (current.kind === 'coin' || current.kind === 'lots') return showToss();
    renderNext(Boolean(s.live && s.live.game === current.id && s.live.moves.length));
  }

  showScreen('format');

  return {
    show() {
      visible = true;
      showScreen(screen);
      if (screen === 'play') {
        refreshHeader();
        if (sub === 'game' && G && !G.over) {
          cg?.redrawAll();
          sync();
          resumeClock();
        }
      }
      countTime();
      if (!asked) {
        asked = true;
        offerSaved();
      }
    },
    hide() {
      visible = false;
      save();
      stopClock();
      countTime();
    },
    get state() {
      return {
        screen, sub, format, storageOk,
        players: players.map((p) => ({ ...p })),
        settings: structuredClone(settings),
        tournament: T ? {
          format: T.format, finished: T.finished, ranking: T.ranking,
          games: T.games.map((g) => ({ id: g.id, kind: g.kind, stage: g.stage, white: g.white, black: g.black, result: g.result, winner: g.winner, done: g.done, a: g.a, b: g.b })),
          wso: T.wso ? { ...T.wso } : null,
          current: current ? { id: current.id, kind: current.kind, white: current.white, black: current.black } : null,
        } : null,
        game: G ? {
          fen: G.chess.fen(), side: G.side, moves: G.moves.length, over: G.over, busy: G.busy, paused: Boolean(pause),
          clockSide: G.clockSide, running: turnStart !== null,
          clock: G.clock ? { w: Math.round(left('w')), b: Math.round(left('b')) } : null,
          orientation: cg?.state.orientation, movable: cg?.state.movable.color || null, shapes: cg ? cg.state.drawable.autoShapes.map((s) => `${s.brush}:${s.orig}${s.dest || ''}`) : [],
          badge: $('tnBadge').hidden ? null : $('tnBadge').textContent,
          coach: $('tnCoach').hidden ? '' : $('tnCoachText').textContent,
          turnHelp: turnHelp ? { circles: turnHelp.circles.length, shown: turnHelp.shown } : null,
        } : null,
      };
    },
    // For automated tests only.
    forTests: {
      setClocks(w, b) {
        if (!G?.clock) return;
        const running = turnStart !== null;
        stopClock();
        G.clock.w = w;
        G.clock.b = b;
        if (running) resumeClock();
        renderBars();
      },
      addElapsed(ms) {
        if (T?.wso) T.wso.elapsed += ms;
        refreshHeader();
      },
      // Plays out the tournament's results without boards: [{ result }] for the next games.
      record(result, reason = 'test') {
        if (!current || !G) return false;
        finishGame(result, reason);
        return true;
      },
    },
  };
}
