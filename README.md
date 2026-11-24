# Chess for All

A free chess game for children, for anyone who wants it: families, schools and clubs. Children
play against the computer with a friendly coach, or solve chess puzzles.

- **Ten computer opponents** with their own character, one for each strength level 1–10:
  Pip the Pawn (1), Bonnie the Bunny (2), Milo the Monkey (3), Captain Barnacle (4), Sir Shield (5),
  Nova the Astronaut (6), Luna the Wizard (7), Rex the Dino (8), Professor Rook (9) and Ember the
  Dragon (10). The child picks one in *Choose your opponent* (this replaces the old strength
  slider); the new opponent takes over at once.
  - **Strength:** opponent number N plays with exactly the settings of the old level N.
  - **Style:** Stockfish works out its best lines (MultiPV), and the opponent picks among the
    moves that are rated almost the same as the one its level would play: Bonnie likes knight moves,
    Milo pawn moves, Barnacle captures, Sir Shield safe and defending moves, Nova bishops, rooks and
    the queen on open lines, Luna pins and forks, Rex checks and attacks on the king, and Professor
    Rook developing and castling. So the style never makes an opponent clearly weaker than its level.
    Each opponent also has two favourite openings from the book, which it plays when it can.
  - **Face and words:** each opponent has a picture with five faces (thinking while it chooses a
    move, happy after a capture or check, worried when it is losing, celebrating when it is
    winning) and short sentences in its own style in a bubble above the board: a greeting,
    captures, checks, a lost piece, and the end of the game. They come at most every few moves,
    and are read aloud with a voice that differs from the coach's.
  - The coach and its help work as before, whichever opponent is chosen. Two players on one device
    play as before, without an opponent.
- **Help levels 0–3**: from no help at all to move grades (!!, !, ?!, ?, ??, 📖 book move), red
  arrows to pieces in danger, a pause after a mistake (*Try again* / *Keep playing*), and the two
  best moves shown on the board.
- **Hint** (first the piece, then the move and what it does), **Show best moves**, unlimited
  **Undo**, a choice of piece when a pawn promotes, and an **advantage bar** (on by default).
- **Opening names** from the Lichess opening book, with a 📖 mark for book moves.
- **Ten themes** (button *Theme*): Classic, Wizard Academy, Dragons & Dungeons, Christmas,
  Halloween, Space, Pirates & Ocean, Dinosaur Jungle, Ice Kingdom and Neon Arcade. Each one changes
  the board, the page, the buttons and panels, and has its own set of pieces. The look changes at
  once, even in the middle of a game; it is not saved, so the page always
  opens with Classic.
- **Five coaches** with faces that change with the game, and a voice (the device's own British
  English voice, with a mute button). The coach talks in short sentences picked from ready-made
  variants and filled in with facts worked out by chess.js and Stockfish. There is no AI and no
  internet service behind it.
- **Puzzles** from the Lichess puzzle database: choose *Easy*, *Medium* or *Hard*, and the puzzles
  get a little harder after a solved one and a little easier after a missed one. Puzzles can be
  filtered by theme (forks, pins, mate in 1 and so on).
- **Puzzle Rush** (in the Puzzles tab): 3 minutes to solve as many puzzles as possible. They start
  at the bottom of *Easy* and get about 50 rating points harder each time. There are 3 lives: a
  wrong move costs one and goes straight to the next puzzle, and the round ends at 0 lives or when
  the time is up. No hints. At the end: the score, the best score of this visit (kept only until
  the page is closed), the puzzles of the round with the solution of each missed one, and
  *Play again*.
- **Sounds and confetti:** soft sounds for a move, a capture, a check, a win, a right and a wrong
  answer in a puzzle, and ticking in the last 10 seconds of Puzzle Rush. They are made in the
  browser with the Web Audio API, with no sound files. A short burst of confetti (about 1.5 seconds)
  comes after a win by checkmate, a solved puzzle, a finished lesson and the end of Puzzle Rush
  (a bigger one for a new best). The sound button mutes both the sounds and the voices. Confetti is
  left out when the device asks for reduced motion.
- **Ranked** (the fourth tab): climb a tower of 18 floors, from Pawn I at the bottom to King III at
  the top (Pawn, Knight, Bishop, Rook, Queen and King, each in three steps I, II and III).
  - **Time controls:** Bullet 2 | 1, Blitz 3 | 2, Blitz 5 | 3, Rapid 10 min, Rapid 15 | 10 and No
    limit ("X | Y" means X minutes for the game plus Y seconds after each move). Each one has its
    own tower and its own progress.
  - **The game:** no coach, no help levels, hints, arrows, move marks, pause after a mistake or
    undo, and no advantage bar. The child chooses White, Black or Random. Two clocks; the clock
    starts after White's first move; the last 10 seconds are red and tick. Running out of time
    loses, unless the other side has too little left to ever checkmate (then it is a draw).
    The computer has a clock too, but answers quickly. Resigning counts as a loss.
  - **Progress:** no numbers are shown. A win clearly fills the bar of the floor, a draw fills it
    a little (0.4 of a win) and a loss takes a little away (half a win). A full bar moves the child
    up ("Promoted to …", with confetti and a sound, and the pawn walks up the tower). A loss on an
    empty bar moves them down one floor (landing with half a bar), except for the first two losses
    after moving up; Pawn I is the lowest floor. A flag marks the highest floor reached.
  - **Strength:** depends only on the floor, the same in every time control. Pawn I is weaker
    than opponent level 1, King III plays exactly like level 10 (Ember).
  - **Saved on the device:** only Ranked keeps anything (see Privacy). When the app is hidden or
    closed the clock stops and the game is kept, so it can be finished later; starting a new game
    then asks whether to finish the old one or resign it (a loss). *Reset progress* clears one
    time control, together with its recent games.
  - **Recent games:** under *Play* on the tower, the last 5 finished games of that time control
    (each time control has its own list; a new game pushes out the oldest). Each row shows the
    result, the player's colour, the number of moves, the floor it was played on, when (for
    example "today 18:42", "yesterday" or "12 Nov") and a *Review* button, with a ✓ once the game
    has been reviewed. The end screen of a game has *Review game* too.
  - **Game review** (`review.js`): Stockfish looks at every position of the game in the browser,
    with a progress bar. Depth 12 (the depth the Play tab grades moves with), one line; if the
    device is slow and the review would take longer than about 15 seconds, the rest of the game is
    looked at with depth 10, then 8. A 40-move game takes 1–3 seconds on a desktop computer.
    Leaving the screen stops the work; coming back carries on. Then:
    - the player's moves get the same marks as in the Play tab (!!, !, ?!, ?, ??, 📖), worked out
      by the same function; the computer's moves get none. At the top: how many moves got each
      mark (no accuracy percentage and no other numbers);
    - a chart of the advantage from the player's side, in the theme's colours; tapping it goes to
      that move;
    - the board (from the player's side) with ⏮ ◀ ▶ ⏭, the ← → keys and a list of moves to tap;
    - **key moments:** the player's 2–3 biggest mistakes (? and ??; if there are fewer than two,
      the biggest ?! moves make up two), marked in the list and on the chart, with *Next key
      moment*. Each one shows a green arrow with a better move, a red arrow with the opponent's
      threat after the player's move (when there is a real one: a capture, a check, a fork or
      checkmate) and a short explanation built from the coach's sentences;
    - **Try again from here:** the position before the mistake, to find a better move like a
      puzzle. A move that loses less than a "!" move would (the best move or close to it) is
      right: confetti and a sound. A wrong move is taken back with a short hint. *Show the answer*
      shows the move with a green arrow; *Back to the review* returns.
    - A review never changes the floor, the bar or the wins, draws and losses.

| Floors | Stockfish Skill Level | Depth | Random moves | Wins to move up |
|---|---|---|---|---|
| Pawn I · II · III | 0 · 0 · 0 | 1 · 1 · 1 | 65% · 50% · 40% | 2 each |
| Knight I · II · III | 0 · 0 · 1 | 1 · 2 · 2 | 30% · 22% · 15% | 3 each |
| Bishop I · II · III | 2 · 3 · 4 | 3 · 3 · 4 | 10% · 5% · 2% | 3 each |
| Rook I · II · III | 5 · 6 · 8 | 4 · 5 · 6 | 0% | 4 each |
| Queen I · II · III | 10 · 11 · 13 | 7 · 8 · 9 | 0% | 4 each |
| King I · II · III | 14 · 17 · 20 | 10 · 12 · 14 | 0% | 5 each (King III is the top) |

Pawn II, Knight I, Knight III, Bishop II, Rook I, Rook III, Queen II, King I, King II and King III
have exactly the settings of opponent levels 1–10; the floors in between are halfway steps.

| Puzzle level | Lichess puzzle rating | Starts at |
|---|---|---|
| Easy | 400–799 | 600 |
| Medium | 900–1299 | 1100 |
| Hard | 1400–1799 | 1600 |
| Grandmaster | 1900–2499 | 2200 |

After a puzzle solved without help the target moves up 50 points, after one solved with a hint up
20, and after a missed one (wrong move, the move shown, or *Show solution*) down 50. It stays within
the chosen level, and the next puzzle is picked within about 100 points of it.

## Privacy: only Ranked progress and recent games are saved, nothing is sent

- It is a static website: no server program, no accounts, no logins, no database.
- Only the Ranked mode keeps anything: its progress in each time control (floor, bar, wins,
  draws, losses), an unfinished game and the last 5 finished games of each time control (only
  their moves, result, colour, floor, time control, date and whether they have been reviewed), in
  `localStorage` on this device (key `chess-for-all-ranked`). The results of a game review are
  not saved. It never leaves the device. *Reset progress* clears one time control and its recent
  games; clearing the site's data in the browser removes it all. If the browser does not allow storage,
  Ranked still works and says that the progress lasts only until the page is closed.
- Nothing else is stored: no cookies, no analytics, no outside scripts or fonts. Outside Ranked,
  close the page and everything starts fresh.
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
| `themes.js`, `themes.css` | The ten themes: colours of the page and board, decorations and piece sets |
| `pieces/` | The piece pictures of each theme (`classic/` holds the cburnett pieces) |
| `app.js` | The game against the computer, the coach, the opponent, help levels, hint, undo |
| `opponents.js` | The ten opponents: strength level, playing style, favourite openings, voice |
| `puzzles.js` | Puzzle mode and the Easy / Medium / Hard levels |
| `rush.js` | Puzzle Rush |
| `ranked.js` | Ranked: time controls, the tower, clocks, progress and recent games (the only things saved, in localStorage) |
| `review.js` | Ranked game review: marks, the advantage chart, key moments and *Try again from here* |
| `sounds.js`, `confetti.js` | The sounds (Web Audio API) and the confetti |
| `analysis.js` | Move grades, pieces in danger, facts about moves and the opponents' moves (chess.js + Stockfish) |
| `engine.js` | Talks to Stockfish in a Web Worker |
| `openings.js` | Finds the opening name for the moves played |
| `coach-lines.js` | Builds the coach's sentences from facts |
| `i18n.js` | **Every text on the page and all coach sentences**, so other languages can be added |
| `coaches.js` | The coaches' pictures and voices |
| `avatars/` | The pictures of the coaches, and of the opponents in `avatars/opponents/` |
| `sw.js`, `manifest.webmanifest` | Offline mode and the "add to home screen" app |
| `data/` | Puzzles and openings from Lichess |
| `vendor/` | Stockfish, Chessground and chess.js |

### Adding a language

Copy the `en` block in `i18n.js`, translate it under a new key (for example `de`), and set `LANG`
to that key. The coach's voice follows `voiceLang` in the same block.

## Licence

GPL-3.0: see [LICENSE](LICENSE). The libraries and data used, with their licences, are listed in
[CREDITS.md](CREDITS.md).
