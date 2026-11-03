// Service worker: keeps the page's own files so Chess for All opens without internet after the
// first visit. It stores only these files (no user data) and never contacts any other address.
// After changing any file of the site, raise VERSION so devices pick up the new files.
const VERSION = 'chess-for-all-v6';

const FILES = [
  './',
  './manifest.webmanifest',
  './about.js',
  './analysis.js',
  './app.js',
  './apple-touch-icon.png',
  './avatars/blitz/celebrate.svg',
  './avatars/blitz/happy.svg',
  './avatars/blitz/neutral.svg',
  './avatars/blitz/thinking.svg',
  './avatars/blitz/worried.svg',
  './avatars/gambit/celebrate.svg',
  './avatars/gambit/happy.svg',
  './avatars/gambit/neutral.svg',
  './avatars/gambit/thinking.svg',
  './avatars/gambit/worried.svg',
  './avatars/kai/celebrate.svg',
  './avatars/kai/happy.svg',
  './avatars/kai/neutral.svg',
  './avatars/kai/thinking.svg',
  './avatars/kai/worried.svg',
  './avatars/r7/celebrate.svg',
  './avatars/r7/happy.svg',
  './avatars/r7/neutral.svg',
  './avatars/r7/thinking.svg',
  './avatars/r7/worried.svg',
  './avatars/viktor/celebrate.svg',
  './avatars/viktor/happy.svg',
  './avatars/viktor/neutral.svg',
  './avatars/viktor/thinking.svg',
  './avatars/viktor/worried.svg',
  './coaches.js',
  './coach-lines.js',
  './data/openings.json',
  './data/puzzles.json',
  './engine.js',
  './favicon-32.png',
  './i18n.js',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './learn.js',
  './lessons.js',
  './openings.js',
  './puzzles.js',
  './style.css',
  './vendor/chess.js/chess.js',
  './vendor/chessground/anim.js',
  './vendor/chessground/api.js',
  './vendor/chessground/autoPieces.js',
  './vendor/chessground/board.js',
  './vendor/chessground/chessground.base.css',
  './vendor/chessground/chessground.brown.css',
  './vendor/chessground/chessground.cburnett.css',
  './vendor/chessground/chessground.js',
  './vendor/chessground/config.js',
  './vendor/chessground/drag.js',
  './vendor/chessground/draw.js',
  './vendor/chessground/drop.js',
  './vendor/chessground/events.js',
  './vendor/chessground/explosion.js',
  './vendor/chessground/fen.js',
  './vendor/chessground/premove.js',
  './vendor/chessground/render.js',
  './vendor/chessground/state.js',
  './vendor/chessground/svg.js',
  './vendor/chessground/sync.js',
  './vendor/chessground/types.js',
  './vendor/chessground/util.js',
  './vendor/chessground/wrap.js',
  './vendor/stockfish/stockfish-19-lite-single.js',
  './vendor/stockfish/stockfish-19-lite-single.wasm',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

// Old versions of the files are removed.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Files of this site come from the cache first; anything not cached yet is fetched and kept.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch (e) {
        // Offline and not cached: a page request still gets the game.
        if (req.mode === 'navigate') return cache.match('./');
        throw e;
      }
    }),
  );
});
