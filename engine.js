// Stockfish (lite, single-threaded WASM) running in the browser as a Web Worker, speaking UCI.
// The single-threaded build needs no special server headers, so it works on any static host.

const ENGINE_URL = new URL('./vendor/stockfish/stockfish-19-lite-single.js', import.meta.url);

export class Engine {
  constructor() {
    this.worker = new Worker(ENGINE_URL);
    this.listeners = new Set();
    this.queue = Promise.resolve();
    this.multiPv = 1; // Stockfish default
    this.worker.onmessage = (e) => {
      const text = typeof e.data === 'string' ? e.data : '';
      for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (line) for (const fn of [...this.listeners]) fn(line);
      }
    };
    // A browser without WebAssembly (or a missing file) stops the worker: say so instead of waiting for ever.
    const failed = new Promise((_, reject) => {
      this.worker.onerror = (e) => reject(new Error(e.message || 'Stockfish could not start'));
    });
    this.ready = Promise.race([this.init(), failed]);
  }

  send(cmd) {
    this.worker.postMessage(cmd);
  }

  waitFor(predicate) {
    return new Promise((resolve) => {
      const fn = (line) => {
        if (predicate(line)) {
          this.listeners.delete(fn);
          resolve(line);
        }
      };
      this.listeners.add(fn);
    });
  }

  async init() {
    const uciok = this.waitFor((l) => l === 'uciok');
    this.send('uci');
    await uciok;
    await this.isReady();
  }

  async isReady() {
    const ok = this.waitFor((l) => l === 'readyok');
    this.send('isready');
    await ok;
  }

  // Requests are queued so only one search runs at a time.
  run(task) {
    const result = this.queue.then(() => this.ready).then(task);
    this.queue = result.catch(() => {});
    return result;
  }

  // Returns { best: 'e2e4' | null, score: { type: 'cp'|'mate', value } | null, lines: [{ uci, score }] }
  // Score is from the point of view of the side to move. multiPv > 1 also returns the next best lines.
  search(fen, { depth = 10, skill = 20, multiPv = 1 } = {}) {
    return this.run(async () => {
      this.send(`setoption name Skill Level value ${skill}`);
      if (multiPv !== this.multiPv) {
        this.send(`setoption name MultiPV value ${multiPv}`);
        this.multiPv = multiPv;
      }
      await this.isReady();

      const lines = [];
      const onInfo = (line) => {
        const m = line.match(/ score (cp|mate) (-?\d+)/);
        const pv = line.match(/ pv (\S+)/);
        if (!m || !pv) return;
        const k = Number(line.match(/ multipv (\d+)/)?.[1] || 1);
        lines[k - 1] = { uci: pv[1], score: { type: m[1], value: Number(m[2]) } };
      };
      this.listeners.add(onInfo);

      const done = this.waitFor((l) => l.startsWith('bestmove'));
      this.send(`position fen ${fen}`);
      this.send(`go depth ${depth}`);
      const line = await done;
      this.listeners.delete(onInfo);

      const best = line.split(' ')[1];
      return {
        best: best && best !== '(none)' ? best : null,
        score: lines[0]?.score || null,
        lines: lines.filter(Boolean),
      };
    });
  }
}

// Converts an engine score to centipawns (mate scores become large numbers).
export function scoreToCp(score) {
  if (!score) return 0;
  if (score.type === 'cp') return score.value;
  if (score.value > 0) return 10000 - score.value * 10;
  return -10000 - score.value * 10;
}

// Winning chances (0–100) from centipawns, same curve Lichess uses.
export function winChance(cp) {
  const capped = Math.max(-1000, Math.min(1000, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * capped)) - 1);
}
