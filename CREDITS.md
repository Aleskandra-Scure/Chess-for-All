# Credits and licences

Chess for All is free software: you can redistribute it and/or modify it under the terms of the
**GNU General Public License, version 3** (see [LICENSE](LICENSE)). The whole project uses this
licence because two of the libraries it includes, Stockfish and Chessground, are GPL-3.0.

The complete source code is the website itself: every file the browser loads is the readable
source, and the same files are in this folder.

The libraries and data below are copied into the project unchanged, apart from removing
`//# sourceMappingURL` comments from the JavaScript files of Chessground and chess.js.
Their licences were checked in their packages (`node_modules`) and at their sources.

## Libraries

| What | Version | Files in this project | Authors | Licence |
|---|---|---|---|---|
| [Stockfish.js](https://github.com/nmrugg/stockfish.js) (WASM build of [Stockfish](https://github.com/official-stockfish/Stockfish)), lite single-threaded engine | 19.0.1 | `vendor/stockfish/` | Stockfish.js © 2026 Chess.com, LLC (Nathan Rugg); Stockfish © T. Romstad, M. Costalba, J. Kiiski, G. Linscott and other contributors; neural network by Chris Bao (sscg13) | GPL-3.0 (`"license": "GPL-3.0"` in its package.json; full text in `vendor/stockfish/Copying.txt`) |
| [Chessground](https://github.com/lichess-org/chessground) (the board) | 9.2.1 | `vendor/chessground/*.js`, `chessground.base.css`, `chessground.brown.css` | the lichess.org authors | GPL-3.0-or-later (`"license": "GPL-3.0-or-later"` in its package.json; full text in `vendor/chessground/LICENSE`) |
| cburnett chess pieces, inside `chessground.cburnett.css` | – | `vendor/chessground/chessground.cburnett.css` | [Colin M.L. Burnett](https://en.wikipedia.org/wiki/User:Cburnett) | GPL-2.0-or-later (as listed for `public/piece/cburnett` in [lichess COPYING.md](https://github.com/lichess-org/lila/blob/master/COPYING.md)); used here under GPL-3.0 |
| [chess.js](https://github.com/jhlywa/chess.js) (chess rules) | 1.4.0 | `vendor/chess.js/chess.js` | © 2025 Jeff Hlywa | BSD-2-Clause (`"license": "BSD-2-Clause"` in its package.json; full text in `vendor/chess.js/LICENSE`) |

## Data

| What | Files in this project | Source | Licence |
|---|---|---|---|
| Chess puzzles: 3,000 puzzles chosen from the Lichess puzzle database (rating 400–1599, popular and well-tested puzzles) | `data/puzzles.json` | [database.lichess.org](https://database.lichess.org/#puzzles), file `lichess_db_puzzle.csv.zst` | **CC0** (public domain): “Database exports are released under the Creative Commons CC0 license” on database.lichess.org. Only the broadcast games there have a different licence (CC BY-SA 4.0); they are not used. |
| Opening names (3,865 openings with their moves and positions) | `data/openings.json` | [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings), files `a.tsv` … `e.tsv` | **CC0-1.0** (the repository's `COPYING.txt`, reported by GitHub as “Creative Commons Zero v1.0 Universal”) |

Puzzle and opening data were converted to JSON (puzzle IDs, positions, moves, ratings and theme
tags; opening names, moves and positions). Lichess is not affiliated with this project.

## This project's own files

The game code, the coach sentences, the coach pictures (`avatars/`) and the icons were made for
this project and are released under GPL-3.0 with the rest of it.
