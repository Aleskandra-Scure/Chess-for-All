// Tournament rules (tournament.js draws them): formats, the order of the games, fair colours,
// results, tables and tie-breaks. Only plain data, no page and no storage, so the rules can be
// checked on their own. `rng` is a function like Math.random.
//
// A game: { id, no, kind, white, black, stage, ..., result: null | 'w' | 'b' | 'd', winner, reason, done }
//   kind 'game'       a normal game (counts in the table)
//        'rematch'    Knockout: the second game after a draw, colours swapped
//        'armageddon' Knockout decider after two draws (White 5 min, Black 4 min, a draw wins for Black)
//        'playoff'    an Armageddon game to separate two players level on everything in a table
//        'coin'       a coin toss between two players (`winner`), when there is no clock
//        'lots'       drawing lots for three or more players level on everything (`order`)

export const FORMAT_IDS = ['rr', 'drr', 'ko', 'groups', 'wso'];
export const FORMATS = {
  rr: { min: 3, max: 6 },
  drr: { min: 3, max: 5 },
  ko: { min: 4, max: 8 },
  groups: { min: 6, max: 8 },
  wso: { min: 3, max: 8 },
};
export const MAX_PLAYERS = 8;
export const CLOCKS = [
  { id: 'none', minutes: 0, inc: 0 },
  { id: '3+2', minutes: 3, inc: 2 },
  { id: '5+3', minutes: 5, inc: 3 },
  { id: '10', minutes: 10, inc: 0 },
  { id: '15+10', minutes: 15, inc: 10 },
];
export const WSO_GAMES = [6, 10, 15];
export const WSO_MINUTES = [30, 45, 60];
export const ARMAGEDDON = { w: 5 * 60000, b: 4 * 60000, inc: 0 };
const BOARD_KINDS = new Set(['game', 'rematch', 'armageddon', 'playoff']);
const TABLE_KINDS = new Set(['game']);
const TABLE_STAGES = new Set(['rr', 'group', 'wso']); // not the Knockout games after the groups

export const clockById = (id) => CLOCKS.find((c) => c.id === id) || CLOCKS[0];
export const fits = (format, n) => n >= FORMATS[format].min && n <= FORMATS[format].max;
export const isBoardGame = (g) => BOARD_KINDS.has(g.kind);

function shuffle(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Every pair once, in rounds (the circle method); with an odd number one player rests each round.
export function roundRobin(ids) {
  const list = ids.length % 2 ? [...ids, null] : ids.slice();
  const n = list.length;
  const rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = list[i];
      const b = list[n - 1 - i];
      if (a !== null && b !== null) pairs.push(r % 2 ? [b, a] : [a, b]);
    }
    rounds.push(pairs);
    list.splice(1, 0, list.pop()); // the first stays, the others turn round
  }
  return rounds;
}

// Colours for a whole schedule (Round Robin, groups): of all the ways to share them out, one where
// White and Black are as even as possible for everyone, then with the fewest games in a row with
// the same colour. Pairs: [[a, b], ...] in the order they are played; returns [[white, black], ...].
export function scheduleColours(pairs, rng = Math.random) {
  const m = pairs.length;
  let best = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 1 << m; mask++) {
    const bal = {};
    const run = {};
    const last = {};
    let worstRun = 0;
    let repeats = 0;
    for (let i = 0; i < m; i++) {
      const [a, b] = pairs[i];
      const [w, k] = mask & (1 << i) ? [b, a] : [a, b];
      bal[w] = (bal[w] || 0) + 1;
      bal[k] = (bal[k] || 0) - 1;
      for (const [id, c] of [[w, 'w'], [k, 'b']]) {
        run[id] = last[id] === c ? run[id] + 1 : 1;
        if (run[id] > 1) repeats += 1;
        last[id] = c;
        worstRun = Math.max(worstRun, run[id]);
      }
    }
    const score = Math.max(...Object.values(bal).map(Math.abs)) * 10000 + worstRun * 100 + repeats;
    if (score < bestScore) {
      bestScore = score;
      best = mask;
    }
  }
  const flip = rng() < 0.5; // swapping every game keeps it just as fair
  return pairs.map(([a, b], i) => (Boolean(best & (1 << i)) !== flip ? [b, a] : [a, b]));
}

// ---------- A new tournament ----------

// players: [{ id, name, avatar, help }]; settings: { clock, flip, end: { type: 'games' | 'time', value } }
export function createTournament(format, players, settings, rng = Math.random) {
  const T = {
    v: 1, format, players: players.map((p) => ({ ...p })), settings: structuredClone(settings),
    games: [], schedule: [], next: 0, playoffs: [], finished: false, ranking: null,
  };
  const ids = shuffle(players.map((p) => p.id), rng);
  if (format === 'rr' || format === 'drr') {
    const rounds = roundRobin(ids);
    rounds.forEach((pairs, r) => pairs.forEach(([a, b]) => T.schedule.push({ a, b, stage: 'rr', round: r + 1, cycle: 1 })));
    withColours(T.schedule, rng);
    if (format === 'drr') {
      // The second time round every pair meets again with the colours the other way.
      const first = T.schedule.slice();
      rounds.forEach((pairs, r) => pairs.forEach(([a, b]) => {
        const s1 = first.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
        T.schedule.push({ a, b, white: s1.black, black: s1.white, stage: 'rr', round: rounds.length + r + 1, cycle: 2 });
      }));
    }
  } else if (format === 'groups') {
    const half = Math.ceil(ids.length / 2);
    T.groups = { A: ids.slice(0, half), B: ids.slice(half) };
    const ra = roundRobin(T.groups.A);
    const rb = roundRobin(T.groups.B);
    for (let r = 0; r < Math.max(ra.length, rb.length); r++) {
      for (const [group, rounds] of [['A', ra], ['B', rb]]) {
        for (const [a, b] of rounds[r] || []) T.schedule.push({ a, b, stage: 'group', group, round: r + 1, cycle: 1 });
      }
    }
    for (const group of ['A', 'B']) withColours(T.schedule.filter((x) => x.group === group), rng);
  } else if (format === 'ko') {
    const size = ids.length <= 4 ? 4 : 8;
    const byes = size - ids.length;
    // Byes (random players, as the order is random) go to every other match first, so they are spread out.
    const byeSlots = [0, 2, 1, 3].slice(0, byes);
    const matches = [];
    const rest = ids.slice();
    const withBye = rest.splice(0, byes);
    for (let i = 0; i < size / 2; i++) {
      const k = byeSlots.indexOf(i);
      if (k >= 0) matches.push(match(T, withBye[k], null));
      else matches.push(match(T, rest.shift(), rest.shift()));
    }
    T.ko = { rounds: [matches] };
  } else if (format === 'wso') {
    T.wso = { queue: ids, king: null, streak: {}, bonus: {}, played: 0, elapsed: 0 };
  }
  return T;
}

function withColours(items, rng) {
  scheduleColours(items.map((x) => [x.a, x.b]), rng).forEach(([white, black], i) => Object.assign(items[i], { white, black }));
}

function match(T, a, b, extra = {}) {
  T.matches = (T.matches || 0) + 1;
  return { id: `m${T.matches}`, a, b, winner: b === null ? a : null, games: [], ...extra };
}

// ---------- Colours ----------

function colourBalance(T, id) {
  let bal = 0;
  let last = null;
  for (const g of T.games) {
    if (!isBoardGame(g) || g.kind === 'armageddon' || g.kind === 'playoff') continue;
    if (g.white === id) { bal += 1; last = 'w'; }
    if (g.black === id) { bal -= 1; last = 'b'; }
  }
  return { bal, last };
}

// Fair colours: the player who has had White less often gets White; when level, the one who had
// Black last time; otherwise by chance.
export function fairColours(T, a, b, rng = Math.random) {
  const A = colourBalance(T, a);
  const B = colourBalance(T, b);
  if (A.bal !== B.bal) return A.bal < B.bal ? [a, b] : [b, a];
  if (A.last !== B.last) {
    if (A.last === 'b' || B.last === 'w') return [a, b];
    if (B.last === 'b' || A.last === 'w') return [b, a];
  }
  return rng() < 0.5 ? [a, b] : [b, a];
}

function addGame(T, fields) {
  const g = { id: `g${T.games.length + 1}`, no: T.games.length + 1, result: null, winner: null, reason: null, done: false, moves: [], ...fields };
  T.games.push(g);
  return g;
}

// ---------- Results ----------

// result: 'w', 'b' or 'd' for games on the board; `winner` for a coin toss; `order` for lots.
export function recordResult(T, gameId, { result = null, reason = null, winner = null, order = null, moves = null } = {}) {
  const g = T.games.find((x) => x.id === gameId);
  if (!g || g.done) return g;
  g.done = true;
  g.reason = reason;
  if (moves) g.moves = moves.slice();
  if (g.kind === 'coin') g.winner = winner;
  else if (g.kind === 'lots') g.order = order.slice();
  else {
    g.result = result;
    if (result === 'w') g.winner = g.white;
    else if (result === 'b') g.winner = g.black;
    else if (g.kind === 'armageddon' || g.kind === 'playoff') g.winner = g.black; // a draw wins for Black
  }
  if (g.match) {
    const m = allMatches(T).find((x) => x.id === g.match);
    if (m && g.winner) m.winner = g.winner;
  }
  if (g.playoff) {
    const order = g.kind === 'lots' ? g.order : [g.winner, g.playoff.ids.find((x) => x !== g.winner)];
    T.playoffs.push({ scope: g.playoff.scope, key: keyOf(g.playoff.ids), order });
  }
  if (T.format === 'wso' && g.kind === 'game') wsoAfter(T, g);
  return g;
}

function wsoAfter(T, g) {
  const W = T.wso;
  W.played += 1;
  const players = [g.white, g.black];
  for (const id of players) {
    if (g.winner === id) {
      W.streak[id] = (W.streak[id] || 0) + 1;
      if (W.streak[id] % 3 === 0) W.bonus[id] = (W.bonus[id] || 0) + 1; // +1 for every 3 wins in a row
    } else W.streak[id] = 0;
  }
  if (g.winner) {
    const loser = players.find((x) => x !== g.winner);
    W.king = g.winner;
    W.queue.push(loser);
  } else {
    // A draw: both go to the back (the one who was staying on first), the next two play.
    const stayer = W.king && players.includes(W.king) ? W.king : g.white;
    W.queue.push(stayer, players.find((x) => x !== stayer));
    W.king = null;
  }
}

// The points `id` got from a game of a table (null if it is not such a game, or they did not play).
export function scoreOf(g, id) {
  if (!g.done || !TABLE_KINDS.has(g.kind) || (g.white !== id && g.black !== id)) return null;
  if (g.result === 'd') return 0.5;
  return g.winner === id ? 1 : 0;
}

// ---------- Tables and tie-breaks ----------

const keyOf = (ids) => ids.slice().sort().join(',');

// Games of a table: the normal games among these players (a group, or everyone).
function tableGames(T, ids) {
  const set = new Set(ids);
  return T.games.filter((g) => g.done && TABLE_KINDS.has(g.kind) && TABLE_STAGES.has(g.stage) && set.has(g.white) && set.has(g.black));
}

function points(T, id, games) {
  let pts = 0;
  for (const g of games) pts += scoreOf(g, id) ?? 0;
  if (T.format === 'wso') pts += T.wso.bonus[id] || 0;
  return pts;
}

// Rows of a table, best first: points, then head-to-head among those level, then Sonneborn-Berger,
// then wins, then a play-off (Armageddon or a coin toss for two players, lots for three or more)
// for places up to `upto`; players still level below that share their place.
// Returns { rows: [{ id, pts, w, d, l, played, bonus, sb, place, shared }], pending: { ids } | null }
export function table(T, ids, scope, upto) {
  const games = tableGames(T, ids);
  const pts = Object.fromEntries(ids.map((id) => [id, points(T, id, games)]));
  const stat = (id) => {
    let w = 0, d = 0, l = 0, sb = 0;
    for (const g of games) {
      const s = scoreOf(g, id);
      if (s === null) continue;
      const opp = g.white === id ? g.black : g.white;
      if (s === 1) { w += 1; sb += pts[opp]; } else if (s === 0.5) { d += 1; sb += pts[opp] / 2; } else l += 1;
    }
    return { id, pts: pts[id], w, d, l, played: w + d + l, sb, bonus: T.format === 'wso' ? T.wso.bonus[id] || 0 : 0 };
  };
  const rows = ids.map(stat);
  // Groups of players level after each step are split by the next one.
  const h2h = (group) => {
    const g2 = tableGames(T, group);
    return Object.fromEntries(group.map((id) => [id, g2.reduce((s, g) => s + (scoreOf(g, id) ?? 0), 0)]));
  };
  const steps = [
    (group) => Object.fromEntries(group.map((id) => [id, pts[id]])),
    h2h,
    (group) => Object.fromEntries(group.map((id) => [id, rows.find((r) => r.id === id).sb])),
    (group) => Object.fromEntries(group.map((id) => [id, rows.find((r) => r.id === id).w])),
  ];
  const split = (group, step) => {
    if (group.length < 2 || step >= steps.length) return [group];
    const val = steps[step](group);
    const sorted = group.slice().sort((a, b) => val[b] - val[a]);
    const out = [];
    for (const id of sorted) {
      const last = out.at(-1);
      if (last && Math.abs(val[last[0]] - val[id]) < 1e-9) last.push(id);
      else out.push([id]);
    }
    return out.flatMap((sub) => split(sub, step + 1));
  };
  const groups = split(ids.slice().sort(), 0);
  // Play-offs already decided, and the first group that still needs one.
  let pending = null;
  const ordered = [];
  const tiedAt = [];
  for (const group of groups) {
    const start = ordered.length;
    if (group.length > 1) {
      const done = T.playoffs.find((p) => p.scope === scope && p.key === keyOf(group));
      if (done) {
        ordered.push(...done.order);
        continue;
      }
      if (start < upto && !pending) pending = { ids: group, scope };
      for (const id of group) tiedAt.push([id, start]);
    }
    ordered.push(...group);
  }
  const shared = new Map(tiedAt);
  return {
    rows: ordered.map((id, i) => ({ ...rows.find((r) => r.id === id), place: (shared.get(id) ?? i) + 1, shared: shared.has(id) })),
    pending,
  };
}

// ---------- Knockout ----------

export const allMatches = (T) => [...(T.ko?.rounds.flat() || [])];

// The name of a Knockout round from the number of its matches.
export function roundName(T, r) {
  const round = T.ko.rounds[r];
  if (round.some((m) => m.final)) return 'final';
  return round.length === 4 ? 'quarter' : round.length === 2 ? 'semi' : 'final';
}

function koNext(T, rng) {
  for (let r = 0; r < T.ko.rounds.length; r++) {
    const round = T.ko.rounds[r];
    for (const m of round) {
      if (m.winner) continue;
      const games = m.games.map((id) => T.games.find((g) => g.id === id));
      const last = games.at(-1);
      const stage = m.third ? 'third' : m.final ? 'final' : 'ko';
      const base = { stage, match: m.id, round: r };
      if (!last) {
        const [white, black] = fairColours(T, m.a, m.b, rng);
        return linkGame(m, addGame(T, { ...base, kind: 'game', white, black }));
      }
      if (last.kind === 'game') return linkGame(m, addGame(T, { ...base, kind: 'rematch', white: last.black, black: last.white }));
      // Two draws: Armageddon with a clock (colours by chance), a coin toss without one.
      if (T.settings.clock !== 'none') {
        const [white, black] = rng() < 0.5 ? [m.a, m.b] : [m.b, m.a];
        return linkGame(m, addGame(T, { ...base, kind: 'armageddon', white, black }));
      }
      return linkGame(m, addGame(T, { ...base, kind: 'coin', a: m.a, b: m.b }));
    }
    // This round is finished: the next one.
    if (r === T.ko.rounds.length - 1) {
      if (round.some((m) => m.final) || round.length === 1) return null;
      const winners = round.map((m) => m.winner);
      if (round.length === 2) {
        const losers = round.map((m) => (m.winner === m.a ? m.b : m.a));
        T.ko.rounds.push([match(T, losers[0], losers[1], { third: true }), match(T, winners[0], winners[1], { final: true })]);
      } else {
        const next = [];
        for (let i = 0; i < winners.length; i += 2) next.push(match(T, winners[i], winners[i + 1]));
        T.ko.rounds.push(next);
      }
    }
  }
  return null;
}

function linkGame(m, g) {
  m.games.push(g.id);
  return g;
}

function koRanking(T) {
  const out = [];
  const last = T.ko.rounds.at(-1);
  const final = last.find((m) => m.final) || last[0];
  const third = last.find((m) => m.third);
  const lose = (m) => (m.winner === m.a ? m.b : m.a);
  out.push({ id: final.winner, place: 1 }, { id: lose(final), place: 2 });
  if (third) out.push({ id: third.winner, place: 3 }, { id: lose(third), place: 4 });
  // Earlier rounds: the players who lost there share a place.
  for (let r = T.ko.rounds.length - 2; r >= 0; r--) {
    if (third && r === T.ko.rounds.length - 2) continue; // the semi-final losers played for third
    const losers = T.ko.rounds[r].filter((m) => m.b !== null).map(lose);
    const place = out.length + 1;
    for (const id of losers) out.push({ id, place, shared: losers.length > 1 });
  }
  return out;
}

// ---------- The next game ----------

// The game to play now (an unfinished one, or a new one), or null when the tournament is over
// (then T.finished and T.ranking are set).
export function nextGame(T, rng = Math.random) {
  if (T.finished) return null;
  const open = T.games.find((g) => !g.done);
  if (open) return open;
  const ids = T.players.map((p) => p.id);
  const fmt = T.format;

  if (fmt === 'rr' || fmt === 'drr' || (fmt === 'groups' && !T.ko)) {
    if (T.next < T.schedule.length) {
      const s = T.schedule[T.next];
      T.next += 1;
      return addGame(T, { kind: 'game', white: s.white, black: s.black, stage: s.stage, group: s.group, round: s.round, cycle: s.cycle });
    }
    if (fmt === 'groups') {
      for (const gr of ['A', 'B']) {
        const t = table(T, T.groups[gr], gr, 2);
        if (t.pending) return playoff(T, t.pending, rng);
      }
      const A = table(T, T.groups.A, 'A', 2).rows;
      const B = table(T, T.groups.B, 'B', 2).rows;
      T.ko = { rounds: [[match(T, A[0].id, B[1].id), match(T, B[0].id, A[1].id)]] };
      return nextGame(T, rng);
    }
    const t = table(T, ids, 'final', 3);
    if (t.pending) return playoff(T, t.pending, rng);
    return finish(T, t.rows.map((r) => ({ id: r.id, place: r.place, shared: r.shared })));
  }

  if (fmt === 'ko' || fmt === 'groups') {
    const g = koNext(T, rng);
    if (g) return g;
    let ranking = koRanking(T);
    if (fmt === 'groups') {
      // After the four in the semi-finals: the others by their place in their group.
      const A = table(T, T.groups.A, 'A', 2).rows;
      const B = table(T, T.groups.B, 'B', 2).rows;
      ranking = ranking.filter((r) => r.place <= 4);
      for (let pos = 2; pos < Math.max(A.length, B.length); pos++) {
        const same = [A[pos], B[pos]].filter(Boolean).map((r) => r.id);
        const place = ranking.length + 1;
        for (const id of same) ranking.push({ id, place, shared: same.length > 1 });
      }
    }
    return finish(T, ranking);
  }

  if (fmt === 'wso') {
    const W = T.wso;
    const end = T.settings.end;
    const over = end.type === 'games' ? W.played >= end.value : W.elapsed >= end.value * 60000;
    if (!over) {
      const a = W.king ?? W.queue.shift();
      const b = W.queue.shift();
      const [white, black] = fairColours(T, a, b, rng);
      return addGame(T, { kind: 'game', white, black, stage: 'wso', round: W.played + 1, king: W.king || null });
    }
    // A game that was waiting in the queue is not started once the end has come.
    const t = table(T, ids, 'final', 3);
    if (t.pending) return playoff(T, t.pending, rng);
    return finish(T, t.rows.map((r) => ({ id: r.id, place: r.place, shared: r.shared })));
  }
  return null;
}

function playoff(T, pending, rng) {
  const info = { scope: pending.scope, ids: pending.ids.slice() };
  if (pending.ids.length > 2) return addGame(T, { kind: 'lots', stage: 'playoff', players: pending.ids.slice(), playoff: info });
  const [a, b] = pending.ids;
  if (T.settings.clock !== 'none') {
    const [white, black] = rng() < 0.5 ? [a, b] : [b, a];
    return addGame(T, { kind: 'playoff', stage: 'playoff', white, black, playoff: info });
  }
  return addGame(T, { kind: 'coin', stage: 'playoff', a, b, playoff: info });
}

function finish(T, ranking) {
  T.finished = true;
  T.ranking = ranking;
  return null;
}

// Clocks for a game in milliseconds: { w, b, inc } (null with no clock).
export function gameClock(T, g) {
  if (g.kind === 'armageddon' || g.kind === 'playoff') return { ...ARMAGEDDON };
  const c = clockById(T.settings.clock);
  if (!c.minutes) return null;
  return { w: c.minutes * 60000, b: c.minutes * 60000, inc: c.inc * 1000 };
}

// How many games a format will have (when it is known in advance).
export function plannedGames(T) {
  if (T.format === 'rr' || T.format === 'drr') return T.schedule.length;
  if (T.format === 'wso' && T.settings.end.type === 'games') return T.settings.end.value;
  return null;
}
