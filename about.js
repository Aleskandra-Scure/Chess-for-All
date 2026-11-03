// The About screen: what Chess for All is, privacy, offline use, credits and licences.
// Every word is in i18n.js (STRINGS.<lang>.about); this file only lays it out.
const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

// A link that leaves the site opens in a new tab and tells the other site nothing about this one.
function link(text, href) {
  const a = el('a', '', text);
  a.href = href;
  if (/^https?:/.test(href)) {
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  }
  return a;
}

function render(a) {
  $('aboutBody').replaceChildren(...a.sections.map((s) => {
    const sec = el('section', 'about-section');
    sec.append(el('h3', '', s.heading));
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
  }));
}

export function initAbout(t) {
  const open = () => {
    render(t('about'));
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
}
