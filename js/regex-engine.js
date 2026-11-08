// =============================================================
//  Regex Engine : compilation, évaluation, comparaison, surlignage
//  et tokenisation pour la coloration syntaxique.
//  Module pur (aucune dépendance DOM) — testable sous Node.
// =============================================================

// Classes POSIX (syntaxe Excel/PCRE) -> équivalents JavaScript Unicode
const POSIX = {
  upper: '\\p{Lu}',
  lower: '\\p{Ll}',
  alpha: '\\p{L}',
  digit: '\\d',
  alnum: '\\p{L}\\p{N}',
  space: '\\s',
  punct: '\\p{P}',
};

/** Traduit les spécificités PCRE/Excel en syntaxe JS. */
export function translatePattern(src) {
  return src.replace(/\[:(\w+):\]/g, (m, name) => POSIX[name] ?? m);
}

const ERRORS_FR = [
  [/Unterminated character class/i, 'Crochet [ non refermé'],
  [/Unterminated group/i, 'Parenthèse ( non refermée'],
  [/Unmatched '\)'/i, 'Parenthèse ) en trop'],
  [/Nothing to repeat/i, 'Quantificateur sans rien à répéter (ex : * en début)'],
  [/Invalid escape/i, 'Échappement invalide'],
  [/Invalid group/i, 'Groupe invalide'],
  [/numbers out of order/i, 'Quantificateur {min,max} dans le mauvais ordre'],
  [/Range out of order/i, 'Intervalle [a-z] dans le mauvais ordre'],
  [/Lone quantifier/i, 'Quantificateur isolé'],
  [/Invalid property name/i, 'Propriété \\p{…} inconnue'],
  [/Incomplete quantifier/i, 'Quantificateur incomplet'],
];

function frenchError(msg) {
  for (const [re, fr] of ERRORS_FR) if (re.test(msg)) return fr;
  return 'Expression invalide';
}

/**
 * Compile une saisie utilisateur.
 * Le drapeau "u" n'est ajouté que si le motif utilise \p{…} :
 * cela garde un comportement tolérant proche de PCRE (\- ou \' acceptés).
 */
export function compile(src, extraFlags = '') {
  if (!src) return { ok: false, empty: true };
  const pattern = translatePattern(src);
  const needsU = /\\[pP]\{/.test(pattern);
  const base = (needsU ? 'u' : '') + extraFlags.replace(/[gu]/g, '');
  try {
    return {
      ok: true,
      src,
      re: new RegExp(pattern, base),
      reG: new RegExp(pattern, base + 'g'),
    };
  } catch (e) {
    return { ok: false, error: frenchError(e.message) };
  }
}

const MAX_MATCHES = 50;

/**
 * Évalue un motif compilé sur un texte.
 * mode "first" : 1re correspondance (REGEX.EXTRAIRE mode 0)
 * mode "all"   : toutes les correspondances (REGEX.EXTRAIRE ;1)
 * mode "test"  : VRAI / FAUX (REGEX.TEST)
 * Retourne { value, spans:[{start,end}] }.
 */
export function evaluate(compiled, text, mode) {
  if (!compiled || !compiled.ok) {
    return { value: mode === 'all' ? [] : mode === 'test' ? false : null, spans: [] };
  }
  if (mode === 'all') {
    const value = [];
    const spans = [];
    compiled.reG.lastIndex = 0;
    for (const m of text.matchAll(compiled.reG)) {
      if (m[0] === '') continue;
      value.push(m[0]);
      spans.push({ start: m.index, end: m.index + m[0].length });
      if (value.length >= MAX_MATCHES) break;
    }
    return { value, spans };
  }
  const m = compiled.re.exec(text);
  if (mode === 'test') {
    const spans = m && m[0] !== '' ? [{ start: m.index, end: m.index + m[0].length }] : [];
    return { value: !!m, spans };
  }
  // first
  if (!m || m[0] === '') return { value: null, spans: [] };
  return { value: m[0], spans: [{ start: m.index, end: m.index + m[0].length }] };
}

export function isMatch(value, mode) {
  if (mode === 'all') return value.length > 0;
  if (mode === 'test') return value === true;
  return value !== null;
}

export function sameOutcome(a, b, mode) {
  if (mode === 'all') return a.length === b.length && a.every((v, i) => v === b[i]);
  return a === b;
}

/**
 * Statut d'une cible pour le radar :
 *  locked : cible hostile, capture exacte  -> tir autorisé
 *  wrong  : cible hostile, capture incorrecte
 *  none   : rien de capturé
 *  iff    : balise alliée capturée (faux positif) -> erreur IFF
 *  clear  : balise alliée ignorée (correct)
 */
export function classify(playerValue, solutionValue, mode) {
  const hostile = isMatch(solutionValue, mode);
  const matched = isMatch(playerValue, mode);
  if (hostile) {
    if (sameOutcome(playerValue, solutionValue, mode)) return 'locked';
    return matched ? 'wrong' : 'none';
  }
  return matched ? 'iff' : 'clear';
}

export function formatValue(value, mode) {
  if (mode === 'all') return value.length ? value.join(' │ ') : '∅';
  if (mode === 'test') return value ? 'VRAI' : 'FAUX';
  return value ?? '∅';
}

/** Découpe un texte en segments surlignés / non surlignés. */
export function segments(text, spans) {
  const out = [];
  let pos = 0;
  for (const { start, end } of spans) {
    if (start > pos) out.push({ text: text.slice(pos, start), hit: false });
    out.push({ text: text.slice(start, end), hit: true });
    pos = end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), hit: false });
  return out;
}

// -------------------------------------------------------------
//  Tokeniseur pour la coloration syntaxique en temps réel
// -------------------------------------------------------------
// types : esc | set | group | alt | quant | anchor | dot | backref | lit
export function tokenize(src) {
  const toks = [];
  let i = 0;
  const push = (text, type) => toks.push({ text, type });
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      const n = src[i + 1];
      if (n === undefined) { push('\\', 'lit'); i++; continue; }
      if ((n === 'p' || n === 'P') && src[i + 2] === '{') {
        const end = src.indexOf('}', i);
        const j = end === -1 ? src.length : end + 1;
        push(src.slice(i, j), 'esc'); i = j; continue;
      }
      if (/[1-9]/.test(n)) { push(src.slice(i, i + 2), 'backref'); i += 2; continue; }
      const type = /[dDwWsSbBnrt]/.test(n) ? 'esc' : 'lit';
      push(src.slice(i, i + 2), type); i += 2; continue;
    }
    if (c === '[') {
      let j = i + 1;
      if (src[j] === '^') j++;
      if (src[j] === ']') j++;
      while (j < src.length && src[j] !== ']') {
        if (src[j] === '\\') j += 2;
        else if (src[j] === '[' && src[j + 1] === ':') {
          const e = src.indexOf(':]', j + 2);
          j = e === -1 ? j + 1 : e + 2;
        } else j++;
      }
      j = Math.min(j + 1, src.length);
      push(src.slice(i, j), 'set'); i = j; continue;
    }
    if (c === '(') {
      const m = /^\((\?<=|\?<!|\?=|\?!|\?:)?/.exec(src.slice(i));
      push(m[0], 'group'); i += m[0].length; continue;
    }
    if (c === ')') { push(c, 'group'); i++; continue; }
    if (c === '|') { push(c, 'alt'); i++; continue; }
    if (c === '*' || c === '+' || c === '?') {
      let j = i + 1;
      if (src[j] === '?') j++;
      push(src.slice(i, j), 'quant'); i = j; continue;
    }
    if (c === '{') {
      const m = /^\{\d+(,\d*)?\}\??/.exec(src.slice(i));
      if (m) { push(m[0], 'quant'); i += m[0].length; continue; }
    }
    if (c === '^' || c === '$') { push(c, 'anchor'); i++; continue; }
    if (c === '.') { push(c, 'dot'); i++; continue; }
    push(c, 'lit'); i++;
  }
  return toks;
}
