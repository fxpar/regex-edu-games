// Helpers DOM : échappement, surlignage, modale, toast, fiches de cours.
import { tokenize, segments } from './regex-engine.js';

export const $ = (sel) => document.querySelector(sel);

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Texte avec les espaces rendus visibles (·) pour mieux voir ce qui est capturé. */
function showWs(s) {
  return esc(s).replace(/ /g, '<span class="ws">·</span>');
}

/** HTML d'un texte cible avec ses captures surlignées. */
export function highlightHTML(text, spans, cls = 'hit-ok') {
  return segments(text, spans)
    .map((s) => (s.hit ? `<mark class="${cls}">${showWs(s.text)}</mark>` : esc(s.text)))
    .join('');
}

/** HTML d'un motif regex coloré syntaxiquement. */
export function patternHTML(src) {
  return tokenize(src).map((t) => `<span class="tk-${t.type}">${esc(t.text)}</span>`).join('');
}

export const MODE_INFO = {
  entier: { label: 'MOT ENTIER', help: 'Le mot entier doit correspondre, du premier au dernier caractère.' },
  contient: { label: 'CONTIENT', help: "Il suffit qu'une partie du mot corresponde." },
};

/** Regex complète affichée entre barres obliques, avec ses drapeaux. */
export function regexHTML(src, flags = '') {
  return `<span class="rx-slash">/</span>${patternHTML(src)}<span class="rx-slash">/</span>${flags ? `<span class="rx-flag">${esc(flags)}</span>` : ''}`;
}

// ---------- Modale ----------
const modal = () => $('#modal');
export function openModal(html, { onMount } = {}) {
  $('#modal-card').innerHTML = html;
  modal().hidden = false;
  onMount?.($('#modal-card'));
  const first = $('#modal-card').querySelector('[data-autofocus]') || $('#modal-card').querySelector('button');
  first?.focus({ preventScroll: true });
}
export function closeModal() {
  modal().hidden = true;
  $('#modal-card').innerHTML = '';
}
export const modalOpen = () => !modal().hidden;

// ---------- Toast / flash ----------
let toastT = 0;
export function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), ms);
}
export function flash(color) {
  const f = $('#flash');
  f.className = 'flash ' + color;
  requestAnimationFrame(() => requestAnimationFrame(() => { f.className = 'flash'; }));
}

// ---------- Fiche de cours ----------
/** Une notion, deux lignes, un visuel : la regex, un mot qui correspond, un piège. */
export function courseCardHTML(level, matcher) {
  const ex = level.exemple;
  const trap = level.pieges[0];
  const mi = MODE_INFO[level.mode];
  return `
  <div class="card">
    <h3 class="card-notion">${esc(level.notion)}</h3>
    <p>${esc(level.cours[0])}</p>
    <p>${esc(level.cours[1])}</p>
    <div class="card-visual">
      <div class="cv-row"><span class="cv-k">REGEX</span><span class="cv-v big">${regexHTML(level.regex, level.flags)}</span><span class="badge mode-${level.mode}" title="${esc(mi.help)}">${mi.label}</span></div>
      <div class="cv-row"><span class="cv-k ok">✓ CIBLE</span><span class="cv-v"><span class="w">${highlightHTML(ex.mot, matcher.spans(ex.mot))}</span> <span class="why">${esc(ex.explication)}</span></span></div>
      <div class="cv-row"><span class="cv-k bad">✗ PIÈGE</span><span class="cv-v"><span class="w">${highlightHTML(trap.mot, [])}</span> <span class="why">${esc(trap.raison)}</span></span></div>
    </div>
    <div class="card-meta">${esc(mi.help)}${level.flags.includes('i') ? ' Drapeau <b>i</b> : majuscules et minuscules se valent.' : ''}</div>
  </div>`;
}

/** Mémo : toutes les notions vues jusqu'au niveau courant. */
export function memoHTML(levels, currentId) {
  return `<div class="memo">${levels
    .map((lv) => `<div class="memo-row ${lv.id === currentId ? 'current' : ''}"><b>${esc(lv.notion)}</b><code>${regexHTML(lv.regex, lv.flags)}</code><span>${esc(lv.cours[0])}</span></div>`)
    .join('')}</div>`;
}
