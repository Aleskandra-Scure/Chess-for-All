// The About screen (what Chess for All is, privacy, offline use, credits) and the folding
// "Licences & source code" section at the bottom of the page, which shows the same credits.
// Every word is in i18n.js (STRINGS.<lang>.about and .source); this file only lays it out.
const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

// A link that leaves the site opens in a new tab and tells the other site nothing about this one.
// "#sourceCode" leads to the section at the bottom of the page.
function link(text, href) {
  const a = el('a', '', text);
  a.href = href;
  if (/^https?:/.test(href)) {
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  }
  if (href === '#sourceCode') {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      $('about').hidden = true;
      $('sourceCode').open = true;
      $('sourceCode').scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('sourceCode').querySelector('summary').focus({ preventScroll: true });
    });
  }
  return a;
}

function section(s, heading = 'h3') {
  const sec = el('section', 'about-section');
  sec.append(el(heading, '', s.heading));
  for (const p of s.paragraphs || []) sec.append(el('p', '', p));
  if (s.list) {
    const ul = el('ul');
    for (const item of s.list) ul.append(el('li', '', item));
    sec.append(ul);
  }
  if (s.credits) {
    const dl = el('dl', 'about-credits');
    for (const c of s.credits) {
      const row = el('div');
      row.append(el('dt', '', c.name), el('dd', '', c.what), el('dd', 'about-licence', c.licence));
      dl.append(row);
    }
    sec.append(dl);
  }
  if (s.links) {
    const p = el('p', 'about-links');
    s.links.forEach((l, i) => {
      if (i) p.append(' · ');
      p.append(link(l.text, l.href));
    });
    sec.append(p);
  }
  return sec;
}

// The bottom section: GPL-3.0, the credits from About, and the download.
function renderSource(t) {
  const src = t('source');
  const credits = t('about').sections.find((s) => s.credits);
  const download = el('a', 'source-download');
  download.href = './source.zip';
  download.download = 'chess-for-all-source.zip';
  download.append(el('span', '', '⬇'), ' ', el('span', '', src.download));
  download.firstChild.setAttribute('aria-hidden', 'true');
  $('sourceBody').replaceChildren(
    el('p', 'source-intro', src.intro),
    section(credits),
    download,
    el('p', 'source-note', src.downloadNote),
  );
}

export function initAbout(t) {
  const open = () => {
    $('aboutBody').replaceChildren(...t('about').sections.map((s) => section(s)));
    $('about').hidden = false;
    $('aboutClose').setAttribute('aria-label', t('close'));
    $('aboutClose').focus();
  };
  const close = () => {
    $('about').hidden = true;
    $('aboutButton').focus();
  };
  $('aboutButton').addEventListener('click', open);
  $('aboutClose').addEventListener('click', close);
  $('aboutBackdrop').addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('about').hidden) close();
  });
  renderSource(t);
}
