// =============================================================
//  Missions : préparation des niveaux, correspondance et difficulté.
//  Module pur (aucune dépendance DOM) — testable sous Node.
// =============================================================
import { compile, evaluate } from './regex-engine.js';

/**
 * Compile la regex d'un niveau selon son mode :
 *  - "entier"   : le mot entier doit correspondre  -> ^(?:regex)$
 *  - "contient" : une partie du mot suffit         -> regex.test(mot)
 */
export function levelMatcher(level) {
  const flags = level.flags || '';
  const inner = compile(level.regex, flags);
  if (!inner.ok) throw new Error(`Regex invalide (${level.id}) : ${level.regex}`);
  const whole = level.mode === 'entier' ? compile(`^(?:${level.regex})$`, flags) : inner;
  return {
    test: (word) => { whole.re.lastIndex = 0; return whole.re.test(word); },
    /** Zones à surligner : le mot entier, ou la 1re correspondance trouvée. */
    spans: (word) => {
      if (level.mode === 'entier') return whole.re.test(word) ? [{ start: 0, end: word.length }] : [];
      return evaluate(inner, word, 'first').spans;
    },
  };
}

/**
 * Transforme le fichier missions.json en structures prêtes à jouer :
 * data.games[jet].squadrons = [{ id, name, levels:[id…] }], data.levels = { id: niveau }.
 */
export function prepareData(raw) {
  const all = raw.escadrilles.flatMap((e) => e.niveaux);
  const total = all.length;
  const levels = {};
  raw.escadrilles.forEach((e, si) => {
    e.niveaux.forEach((n, li) => {
      const gi = all.indexOf(n);
      levels[n.id] = { ...n, flags: n.flags || '', squad: si, index: li, global: gi, difficulty: difficulty(gi, total, n) };
    });
  });
  const squadrons = raw.escadrilles.map((e) => ({ id: e.id, name: e.nom, levels: e.niveaux.map((n) => n.id) }));
  const games = raw.games.map((g) => (g.id === 'jet' ? { ...g, squadrons } : g));
  return { ...raw, games, levels };
}

/**
 * Difficulté d'un niveau, de 0 (premier) à 1 (dernier) :
 * plus de drones, proportion de cibles qui baisse, drones plus rapides et plus serrés.
 * Un niveau peut forcer ses valeurs avec un objet "difficulte" dans le JSON.
 */
export function difficulty(gi, total, level = {}) {
  const g = total > 1 ? gi / (total - 1) : 0;
  const d = {
    g,
    drones: 14 + Math.round(9 * g),       // 14 -> 23 drones
    targetRatio: 0.6 - 0.25 * g,           // 60 % -> 35 % de cibles
    travel: 12 - 4 * g,                    // secondes pour traverser l'écran
    spawnEvery: 2.6 - 0.8 * g,             // intervalle de départ entre deux drones
    doubleChance: 0.1 + 0.3 * g,           // chance de doublé en fin de niveau
  };
  return { ...d, ...(level.difficulte || {}) };
}

const shuffle = (a, rnd) => {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
};

/**
 * Construit la file de drones d'un niveau.
 * Les cibles arrivent plutôt au début, les pièges plutôt à la fin :
 * plus on avance dans le niveau, moins il y a de bons éléments à viser.
 */
export function buildWave(level, rnd = Math.random) {
  const d = level.difficulty;
  const nP = Math.min(level.pieges.length, Math.round(d.drones * (1 - d.targetRatio)));
  // la proportion de cibles est respectée même quand les pièges sont en nombre limité
  const nT = Math.min(level.cibles.length, Math.max(4, Math.round((nP * d.targetRatio) / (1 - d.targetRatio))));
  const targets = shuffle(level.cibles, rnd).slice(0, nT).map((mot) => ({ mot, hostile: true }));
  const traps = shuffle(level.pieges, rnd).slice(0, nP).map((p) => ({ mot: p.mot, raison: p.raison, hostile: false }));
  // clé de tri biaisée : cibles vers le début, pièges vers la fin
  const keyed = [
    ...targets.map((t) => ({ t, k: Math.pow(rnd(), 1.7) })),
    ...traps.map((t) => ({ t, k: Math.pow(rnd(), 0.6) })),
  ];
  keyed.sort((a, b) => a.k - b.k);
  const wave = keyed.map((x) => x.t);
  // jamais un piège en tout premier : le joueur doit d'abord voir une cible
  const first = wave.findIndex((t) => t.hostile);
  if (first > 0) wave.unshift(wave.splice(first, 1)[0]);
  return wave;
}

/** Rythme au fil du niveau (q = part de la vague déjà lancée, de 0 à 1). */
export function pace(level, q) {
  const d = level.difficulty;
  return {
    travel: d.travel * (1 - 0.15 * q),
    spawnEvery: d.spawnEvery * (1 - 0.35 * q),
    double: q > 0.4 ? d.doubleChance * q : 0,
  };
}
