# Chess for All

A free chess game for children, for anyone who wants it: families, schools and clubs. Children
play against the computer with a friendly coach, or solve chess puzzles.

- **Play** against the computer, strength 1–10.
- **Help levels 0–3**: from no help at all to move grades (!!, !, ?!, ?, ??, 📖 book move), red
  arrows to pieces in danger, a pause after a mistake (*Try again* / *Keep playing*), and the two
  best moves shown on the board.
- **Hint** (first the piece, then the move and what it does), **Show best moves**, unlimited
  **Undo**, a choice of piece when a pawn promotes, and an **advantage bar** (on by default).
- **Opening names** from the Lichess opening book, with a 📖 mark for book moves.
- **Five coaches** with faces that change with the game, and a voice (the device's own British
  English voice, with a mute button). The coach talks in short sentences picked from ready-made
  variants and filled in with facts worked out by chess.js and Stockfish. There is no AI and no
  internet service behind it.
- **Puzzles** from the Lichess puzzle database: choose *Easy*, *Medium* or *Hard*, and the puzzles
  get a little harder after a solved one and a little easier after a missed one. Puzzles can be
  filtered by theme (forks, pins, mate in 1 and so on).

| Puzzle level | Lichess puzzle rating | Starts at |
|---|---|---|
| Easy | 400–799 | 600 |
| Medium | 800–1199 | 1000 |
| Hard | 1200–1599 | 1400 |

After a puzzle solved without help the target moves up 50 points, after one solved with a hint up
20, and after a missed one (wrong move, the move shown, or *Show solution*) down 50. It stays within
the chosen level, and the next puzzle is picked within about 100 points of it.

## Privacy: nothing is saved, nothing is sent

- It is a static website: no server program, no accounts, no logins, no database.
- Nothing about the player is stored: no cookies, no localStorage, no analytics, no outside
  scripts or fonts. Close the page and everything starts fresh.
- The chess engine (Stockfish) runs inside the browser, in a Web Worker.
- The page never contacts any other address. All libraries are copied into `vendor/`.
- The coach's voice uses only voices that run on the device (`localService`), never an online voice.
- To work offline, a service worker keeps a copy of the site's own files in the browser's cache
  (about 4.5 MB). Those are only the game's files, never anything about the player.

## Run it on your computer

The site has to be opened through a small local web server: browsers do not run Web Workers or
service workers from files opened directly from the disk (`file://`). Any static file server works.
In this folder, run one of these:

```
python -m http.server 8000
```

```
npx serve -l 8000
```

Then open <http://localhost:8000>.

Opening it from another device on your home network (for example `http://192.168.1.10:8000`) also
works for playing. Offline mode needs `localhost` or an `https://` address, so on other devices it
works once the site is on Vercel.

## Put it on Vercel

The site needs no build step: the files in this folder are the website.

**Option 1: Vercel website (with GitHub, GitLab or Bitbucket)**

1. Put this folder in a Git repository of your own and push it.
2. On [vercel.com](https://vercel.com), choose **Add New… → Project** and import the repository.
3. *Framework Preset*: **Other**. Leave *Build Command* empty and set *Output Directory* to `.`
   (or leave the defaults: with no `package.json` Vercel serves the folder as it is).
4. Click **Deploy**. The game will be at `https://<project-name>.vercel.app`.

**Option 2: Vercel command line (no Git needed)**

```
npm i -g vercel
vercel          # first time: log in and answer the questions (no build command)
vercel --prod   # publish to https://<project-name>.vercel.app
```

Vercel sends `.wasm` files with the right type (`application/wasm`), and the single-threaded
Stockfish build needs no special headers, so no `vercel.json` is required.

### After changing files

The service worker keeps the old files on devices that have already opened the site. After any
change, raise `VERSION` in `sw.js` (for example to `chess-for-all-v2`) so devices fetch the new
files. They switch over the next time the page is opened.

## Files

| File | What it does |
|---|---|
| `index.html`, `style.css` | The page |
| `app.js` | The game against the computer, the coach, help levels, hint, undo |
| `puzzles.js` | Puzzle mode and the Easy / Medium / Hard levels |
| `analysis.js` | Move grades, pieces in danger and facts about moves (chess.js + Stockfish) |
| `engine.js` | Talks to Stockfish in a Web Worker |
| `openings.js` | Finds the opening name for the moves played |
| `coach-lines.js` | Builds the coach's sentences from facts |
| `i18n.js` | **Every text on the page and all coach sentences**, so other languages can be added |
| `coaches.js` | The coaches' pictures and voices |
| `sw.js`, `manifest.webmanifest` | Offline mode and the "add to home screen" app |
| `data/` | Puzzles and openings from Lichess |
| `vendor/` | Stockfish, Chessground and chess.js |

### Adding a language

Copy the `en` block in `i18n.js`, translate it under a new key (for example `de`), and set `LANG`
to that key. The coach's voice follows `voiceLang` in the same block.

## Licence

GPL-3.0: see [LICENSE](LICENSE). The libraries and data used, with their licences, are listed in
[CREDITS.md](CREDITS.md).
