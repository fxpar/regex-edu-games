// Helpers DOM : échappement, surlignage, modale, toast, fiches de cours.
import { tokenize, compile, evaluate, segments, formatValue } from './regex-engine.js';

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

export const MODE_LABEL = {
  first: '1re correspondance',
  all: 'Toutes les correspondances (;1)',
  test: 'Test VRAI / FAUX',
};

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
export function courseCardHTML(level) {
  const ex = level.course.example;
  const c = compile(ex.pattern, level.flags);
  const r = evaluate(c, ex.text, ex.mode);
  return `
  <div class="card">
    <div class="card-symbol">${esc(level.notion)}</div>
    <h3>${esc(level.title)}</h3>
    <p>${esc(level.course.lines[0])}</p>
    <p>${esc(level.course.lines[1])}</p>
    <div class="card-visual">
      <div class="cv-row"><span class="cv-k">MOTIF</span><span class="cv-v">/${patternHTML(ex.pattern)}/</span></div>
      <div class="cv-row"><span class="cv-k">TEXTE</span><span class="cv-v">${highlightHTML(ex.text, r.spans)}</span></div>
      <div class="cv-row"><span class="cv-k">RÉSULTAT</span><span class="cv-v"><b>${esc(formatValue(r.value, ex.mode))}</b></span></div>
    </div>
    <div class="card-meta">${esc(level.source)} · Mode radar : ${esc(MODE_LABEL[level.mode])}${level.flags ? ` · drapeau <b>${esc(level.flags)}</b>` : ''}</div>
  </div>`;
}

/** Mémo : toutes les notions vues jusqu'au niveau courant. */
export function memoHTML(levels, currentId) {
  return `<div class="memo">${levels
    .map((lv) => `<div class="memo-row ${lv.id === currentId ? 'current' : ''}"><code>${esc(lv.notion)}</code><span>${esc(lv.course.lines[0])}</span></div>`)
    .join('')}</div>`;
}

// ---------- Saisie regex avec coloration ----------
export class RegexInput {
  constructor(input, hl, onChange) {
    this.input = input;
    this.hl = hl;
    const sync = () => { this.hl.scrollLeft = this.input.scrollLeft; };
    input.addEventListener('input', () => { this.render(); onChange(input.value); });
    for (const ev of ['scroll', 'keyup', 'click', 'select']) input.addEventListener(ev, sync);
    this.render();
  }
  render() {
    this.hl.innerHTML = patternHTML(this.input.value) + ' ';
    this.hl.scrollLeft = this.input.scrollLeft;
  }
  set(v) { this.input.value = v; this.render(); }
  insert(text) {
    const el = this.input;
    const s = el.selectionStart ?? el.value.length;
    const e = el.selectionEnd ?? el.value.length;
    el.setRangeText(text, s, e, 'end');
    el.dispatchEvent(new Event('input'));
    el.focus({ preventScroll: true });
  }
}
