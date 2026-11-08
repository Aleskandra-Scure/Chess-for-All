// Builds data/puzzles.json from the free Lichess puzzle database: 2,000 puzzles for each of the four
// levels. Needs only Node.js (version 24 or newer, for zstd), no packages:
//
//   node scripts/build-puzzles.mjs                      (downloads the database, about 300 MB)
//   node scripts/build-puzzles.mjs lichess_db_puzzle.csv.zst   (or .csv: a copy already on disk)
//
// The database is read as a stream and filtered on the fly; nothing but the result is saved.
// Format (database.lichess.org): PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,…
// FEN is the position before the opponent's move. The first move in Moves is the opponent's;
// the player sees the position after it, and the solution starts with the second move.
//
// How puzzles are chosen:
// - only popular, well-tested puzzles (popularity, number of plays, rating deviation);
// - every 100-point band of a level gets the same number of puzzles, and each band one third
//   opening, one third middlegame and one third endgame (Lichess tags); a band with too few of
//   one phase is topped up from the other two;
// - inside each third: first a few puzzles of every theme the player can choose, then the most played;
// - Grandmaster: at least 40% with a quiet first move (no check, no capture), at most 20% mates
//   and at most 10% where every move of the player gives check.
// Every move of every puzzle is played through with chess.js; a puzzle with an illegal move is left out.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { Readable, Transform } from 'node:stream';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'puzzles.json');
const { Chess } = await import(pathToFileURL(path.join(ROOT, 'vendor', 'chess.js', 'chess.js')).href);
const URL = 'https://database.lichess.org/lichess_db_puzzle.csv.zst';

// Same ranges as LEVELS in puzzles.js. minN/maxN: the player's moves in the solution.
const LEVELS = [
  { name: 'easy', min: 400, max: 800, minN: 1, maxN: 3 },
  { name: 'medium', min: 900, max: 1300, minN: 1, maxN: 3 },
  { name: 'hard', min: 1400, max: 1800, minN: 1, maxN: 3 },
  { name: 'grandmaster', min: 1900, max: 2500, minN: 1, maxN: 6, quietMin: 0.4, mateMax: 0.2, allChecksMax: 0.1 },
];
const PER_LEVEL = 2000;
const BAND = 100;
const PHASES = ['opening', 'middlegame', 'endgame'];
const MIN_POPULARITY = 85; // -100 (worst) … 100 (best)
const MIN_PLAYS = 1000;
const MAX_DEVIATION = 100; // the puzzle's rating is well known

// Themes the player can choose (THEME_FILTERS in puzzles.js, without the phases).
const CHOOSABLE = ['mateIn1', 'mateIn2', 'mateIn3', 'mateIn4', 'mateIn5', 'fork', 'hangingPiece', 'pin', 'skewer', 'discoveredAttack', 'backRankMate', 'promotion', 'trappedPiece'];
const PER_THEME = 7; // per band and phase
const KEEP = 4000; // most played candidates kept per band and phase
const KEEP_THEME = 200; // and per theme

const COLUMNS = ['PuzzleId', 'FEN', 'Moves', 'Rating', 'RatingDeviation', 'Popularity', 'NbPlays', 'Themes'];
const byPlays = (a, b) => b.plays - a.plays || (a.id < b.id ? -1 : 1);

// Keeps the most played puzzles of a list without holding millions of rows.
function keepTop(list, item, cap) {
  list.push(item);
  if (list.length > cap * 2) {
    list.sort(byPlays);
    list.length = cap;
  }
}

// The file is written by pzstd: before every data frame comes a "skippable" frame holding the
// data frame's size. Node's zstd cannot read skippable frames, so they are dropped here.
function dropSkippableFrames() {
  let buf = Buffer.alloc(0);
  let pass = 0; // bytes of a data frame still to pass through
  let passAll = false; // a data frame of unknown size: pass everything from here on
  return new Transform({
    transform(chunk, _enc, done) {
      buf = Buffer.concat([buf, chunk]);
      const out = [];
      for (;;) {
        if (passAll || pass > 0) {
          const n = passAll ? buf.length : Math.min(pass, buf.length);
          out.push(buf.subarray(0, n));
          buf = buf.subarray(n);
          if (!passAll) pass -= n;
          if (!buf.length) break;
          continue;
        }
        if (buf.length < 8) break;
        const magic = buf.readUInt32LE(0);
        if ((magic & 0xfffffff0) !== 0x184d2a50) { passAll = true; continue; }
        const len = buf.readUInt32LE(4);
        if (buf.length < 8 + len) break;
        if (len === 4) pass = buf.readUInt32LE(8); // size of the next data frame
        buf = buf.subarray(8 + len);
      }
      done(null, out.length ? Buffer.concat(out) : undefined);
    },
  });
}

async function openInput() {
  const file = process.argv[2];
  let raw;
  if (file) {
    console.log(`Reading ${file} …`);
    raw = fs.createReadStream(file);
    if (!file.endsWith('.zst')) return { input: raw, failed: () => null };
  } else {
    console.log(`Downloading and filtering ${URL} …`);
    const res = await fetch(URL);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    raw = Readable.fromWeb(res.body);
  }
  const unzip = zlib.createZstdDecompress();
  const input = raw.pipe(dropSkippableFrames()).pipe(unzip);
  let failed = null;
  unzip.on('error', (e) => { failed = e; input.destroy(e); });
  return { input, failed: () => failed };
}

// Plays every move with chess.js. Returns null if one is illegal, else facts about the solution.
function facts(p) {
  try {
    const c = new Chess(p.fen);
    let first = null;
    let allChecks = true;
    p.moves.forEach((uci, i) => {
      const mv = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      if (i === 1) first = mv;
      if (i % 2 === 1 && !/[+#]/.test(mv.san)) allChecks = false;
    });
    return { quiet: !/[+#]/.test(first.san) && !first.captured, allChecks, mate: p.themes.includes('mate') };
  } catch {
    return null;
  }
}

// ---------- Read the database ----------

const groups = new Map(); // "level:band:phase" → { all, themes }
const group = (key) => {
  if (!groups.has(key)) groups.set(key, { all: [], themes: Object.fromEntries(CHOOSABLE.map((t) => [t, []])) });
  return groups.get(key);
};

const { input, failed } = await openInput();
const lines = readline.createInterface({ input, crlfDelay: Infinity });
let header = null;
let rows = 0;
let kept = 0;
for await (const line of lines) {
  if (!header) {
    header = line.split(',');
    for (const c of COLUMNS) if (!header.includes(c)) throw new Error(`Column ${c} is missing; the format has changed: ${line}`);
    continue;
  }
  rows += 1;
  if (rows % 1000000 === 0) console.log(`  ${rows.toLocaleString('en-GB')} rows read, ${kept.toLocaleString('en-GB')} candidates`);
  // No field before Themes contains commas, so a plain split is safe here.
  const f = line.split(',');
  const col = (name) => f[header.indexOf(name)];
  const rating = Number(col('Rating'));
  const lv = LEVELS.find((l) => rating >= l.min && rating < l.max);
  if (!lv) continue;
  if (Number(col('RatingDeviation')) > MAX_DEVIATION) continue;
  if (Number(col('Popularity')) < MIN_POPULARITY) continue;
  const plays = Number(col('NbPlays'));
  if (plays < MIN_PLAYS) continue;
  const moves = col('Moves').split(' ');
  const n = Math.ceil((moves.length - 1) / 2);
  if (moves.length < 2 || n < lv.minN || n > lv.maxN) continue;
  const themes = col('Themes').split(' ').filter(Boolean);
  const phase = PHASES.find((x) => themes.includes(x));
  if (!phase) continue;

  const item = { id: col('PuzzleId'), fen: col('FEN'), moves, rating, plays, themes };
  const g = group(`${lv.name}:${Math.floor(rating / BAND) * BAND}:${phase}`);
  keepTop(g.all, item, KEEP);
  for (const t of CHOOSABLE) if (themes.includes(t)) keepTop(g.themes[t], item, KEEP_THEME);
  kept += 1;
}
if (failed()) throw failed();
if (rows < 1000000) throw new Error(`Only ${rows} rows were read; the file looks incomplete.`);
console.log(`Read ${rows.toLocaleString('en-GB')} puzzles, ${kept.toLocaleString('en-GB')} matched the filters.`);

// ---------- Choose ----------

const known = new Map(); // id → facts (or null: illegal move)
const factsOf = (p) => {
  if (!known.has(p.id)) known.set(p.id, facts(p));
  return known.get(p.id);
};

// Up to `share` puzzles of one band and phase, within the level's limits.
function choosePhase(lv, g, share) {
  const all = g.all.sort(byPlays);
  const chosen = new Map();
  let mates = 0;
  let checks = 0;
  let quiet = 0;
  const add = (p) => {
    if (chosen.has(p.id) || chosen.size >= share) return false;
    const x = factsOf(p);
    if (!x) return false;
    if (lv.mateMax != null && x.mate && mates + 1 > lv.mateMax * share) return false;
    if (lv.allChecksMax != null && x.allChecks && checks + 1 > lv.allChecksMax * share) return false;
    chosen.set(p.id, p);
    if (x.mate) mates += 1;
    if (x.allChecks) checks += 1;
    if (x.quiet) quiet += 1;
    return true;
  };
  for (const t of CHOOSABLE) {
    let n = 0;
    for (const p of g.themes[t].sort(byPlays)) {
      if (n >= PER_THEME) break;
      if (add(p)) n += 1;
    }
  }
  if (lv.quietMin) {
    const need = Math.ceil(lv.quietMin * share);
    for (const p of all) {
      if (quiet >= need) break;
      if (factsOf(p)?.quiet) add(p);
    }
  }
  for (const p of all) {
    if (chosen.size >= share) break;
    add(p);
  }
  return [...chosen.values()];
}

const out = [];
for (const lv of LEVELS) {
  const bands = [];
  for (let b = lv.min; b < lv.max; b += BAND) bands.push(b);
  bands.forEach((b, i) => {
    // equal shares; the remainder goes to the first bands (and phases)
    const bandShare = Math.floor(PER_LEVEL / bands.length) + (i < PER_LEVEL % bands.length ? 1 : 0);
    const chosen = [];
    PHASES.forEach((ph, j) => {
      const share = Math.floor(bandShare / 3) + (j < bandShare % 3 ? 1 : 0);
      chosen.push(...choosePhase(lv, group(`${lv.name}:${b}:${ph}`), share));
    });
    // A phase with too few puzzles: the most played of the other phases fill the gap.
    if (chosen.length < bandShare) {
      const ids = new Set(chosen.map((p) => p.id));
      const rest = PHASES.flatMap((ph) => group(`${lv.name}:${b}:${ph}`).all).sort(byPlays);
      for (const p of rest) {
        if (chosen.length >= bandShare) break;
        if (!ids.has(p.id) && factsOf(p)) { chosen.push(p); ids.add(p.id); }
      }
    }
    const count = (ph) => chosen.filter((p) => p.themes.includes(ph)).length;
    console.log(`  ${lv.name.padEnd(12)} ${b}–${b + BAND - 1}: ${chosen.length} puzzles (opening ${count('opening')}, middlegame ${count('middlegame')}, endgame ${count('endgame')})`);
    out.push(...chosen);
  });
}

// ---------- Check and save ----------

const pct = (n, d) => `${Math.round((100 * n) / d)}%`;
for (const lv of LEVELS) {
  const list = out.filter((p) => p.rating >= lv.min && p.rating < lv.max);
  const n = list.length;
  const x = list.map(factsOf);
  const count = (ph) => list.filter((p) => p.themes.includes(ph)).length;
  console.log(`${lv.name}: ${n} puzzles; opening ${pct(count('opening'), n)}, middlegame ${pct(count('middlegame'), n)}, endgame ${pct(count('endgame'), n)}; `
    + `quiet first move ${pct(x.filter((f) => f.quiet).length, n)}, mates ${pct(x.filter((f) => f.mate).length, n)}, only checks ${pct(x.filter((f) => f.allChecks).length, n)}`);
}
for (const p of out) if (!facts(p)) throw new Error(`Puzzle ${p.id} has an illegal move.`);
if (new Set(out.map((p) => p.id)).size !== out.length) throw new Error('A puzzle was chosen twice.');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out.map(({ id, fen, moves, rating, themes }) => ({ id, fen, moves, rating, themes }))));
console.log(`Saved ${out.length} puzzles to data/puzzles.json (${Math.round(fs.statSync(OUT).size / 1024)} KB). All moves checked with chess.js.`);
