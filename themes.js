// Themes: the look of the page, the board and the pieces (colours and pictures are in themes.css,
// the names in i18n.js). Every visit starts with Classic: the choice is never saved.
const $ = (id) => document.getElementById(id);

// `colour` is the browser bar colour on phones.
export const THEMES = [
  { id: 'classic', colour: '#2f6b4f' },
  { id: 'wizard', colour: '#1b1436' },
  { id: 'dragons', colour: '#211b17' },
  { id: 'christmas', colour: '#b3202c' },
  { id: 'halloween', colour: '#170f1e' },
  { id: 'space', colour: '#070b18' },
  { id: 'pirates', colour: '#0c2c47' },
  { id: 'dinosaur', colour: '#13261a' },
  { id: 'ice', colour: '#0b1834' },
  { id: 'neon', colour: '#0b0a1a' },
];
export const DEFAULT_THEME = 'classic';

let current = DEFAULT_THEME;

// A 4×4 corner of a board for each card: every kind of piece in both colours.
const MINI = [
  ['bR', 'bN', 'bQ', 'bK'],
  ['bP', '', '', 'bB'],
  ['', 'wP', 'wB', ''],
  ['wK', 'wQ', 'wN', 'wR'],
];
const KIND = { P: 'pawn', N: 'knight', B: 'bishop', R: 'rook', Q: 'queen', K: 'king' };

function miniBoard(id) {
  const board = document.createElement('span');
  board.className = 'cg-wrap theme-mini';
  board.dataset.theme = id;
  board.setAttribute('aria-hidden', 'true');
  MINI.forEach((row, r) => row.forEach((code, f) => {
    const sq = document.createElement('span');
    if ((r + f) % 2) sq.className = 'dark';
    if (code) {
      const piece = document.createElement('piece');
      piece.className = `${code[0] === 'w' ? 'white' : 'black'} ${KIND[code[1]]}`;
      sq.append(piece);
    }
    board.append(sq);
  }));
  return board;
}

function applyTheme(id) {
  current = id;
  document.documentElement.dataset.theme = id;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = THEMES.find((th) => th.id === id).colour;
  $('themeCards').querySelectorAll('[data-theme-id]').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.themeId === id)));
}

export function initThemes(t) {
  const render = () => {
    $('themeCards').replaceChildren(...THEMES.map((th) => {
      const card = document.createElement('button');
      card.className = 'theme-card';
      card.dataset.themeId = th.id;
      card.dataset.theme = th.id; // the card shows the theme's own colours
      card.setAttribute('aria-pressed', String(th.id === current));
      const name = document.createElement('strong');
      name.textContent = t('themeNames')[th.id];
      card.append(miniBoard(th.id), name);
      return card;
    }));
  };
  const open = () => {
    render();
    $('themePicker').hidden = false;
    $('themeClose').setAttribute('aria-label', t('close'));
    // Open at the top, and scroll only as far as needed to show the current theme.
    $('themeCards').closest('.picker-card').scrollTop = 0;
    const chosen = $('themeCards').querySelector('[aria-pressed="true"]');
    chosen?.focus({ preventScroll: true });
    chosen?.scrollIntoView({ block: 'nearest' });
  };
  const close = () => {
    $('themePicker').hidden = true;
    $('themeButton').focus();
  };
  // The new look appears at once, also in the middle of a game, puzzle or lesson.
  $('themeCards').addEventListener('click', (e) => {
    const card = e.target.closest('[data-theme-id]');
    if (!card) return;
    applyTheme(card.dataset.themeId);
    close();
  });
  $('themeButton').addEventListener('click', open);
  $('themeClose').addEventListener('click', close);
  $('themeBackdrop').addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('themePicker').hidden) close();
  });
  render();
  applyTheme(DEFAULT_THEME);
}

// For automated tests.
export const currentTheme = () => current;
export { applyTheme };
