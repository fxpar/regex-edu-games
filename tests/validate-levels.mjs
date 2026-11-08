// Vérifie les niveaux : solution compilable, au moins une cible hostile,
// et les réponses « naïves » attendues comme insuffisantes échouent bien.
// Usage : node tests/validate-levels.mjs
import { readFileSync } from 'node:fs';
import { compile, evaluate, classify, formatValue, isMatch } from '../js/regex-engine.js';

const data = JSON.parse(readFileSync(new URL('../data/levels.json', import.meta.url), 'utf8'));

// Réponses incomplètes qui DOIVENT échouer sur au moins une cible
const NAIVE = {
  L02: ['.*'], L03: ['\\d'], L06: ['\\S+'], L07: ['..'], L08: ['..\\*'],
  L09: ['Château|Saint|St|Ch.'], L10: ['Château|Saint|St|Ch\\.'],
  L12: ['[A-Z]+'], L13: ['[A-Z]{3}'], L14: ['[A-Z]{2,}'], L15: ['[[:upper:]]{2,}'],
};
// Réponses alternatives qui DOIVENT réussir
const ALT = { L14: ['\\p{Lu}{2,}'], L15: ['[\\p{Lu}\\-]{2,}'], L03: ['[0-9]+'] };

let fail = 0;
for (const [id, lv] of Object.entries(data.levels)) {
  const sol = compile(lv.solution, lv.flags);
  if (!sol.ok) { console.log(`✗ ${id} solution invalide: ${sol.error}`); fail++; continue; }
  const res = lv.targets.map(t => evaluate(sol, t, lv.mode).value);
  const hostiles = res.filter(v => isMatch(v, lv.mode)).length;
  console.log(`\n${id} ${lv.notion}  /${lv.solution}/${lv.flags}  mode=${lv.mode}  hostiles=${hostiles}/${lv.targets.length}`);
  lv.targets.forEach((t, i) => console.log(`   ${isMatch(res[i], lv.mode) ? '◆' : '·'} ${t.padEnd(66)} → ${formatValue(res[i], lv.mode)}`));
  if (!hostiles) { console.log('   ✗ aucune cible hostile'); fail++; }

  const run = (src) => {
    const c = compile(src, lv.flags);
    return lv.targets.map((t, i) => classify(evaluate(c, t, lv.mode).value, res[i], lv.mode));
  };
  for (const n of NAIVE[id] ?? []) {
    const st = run(n);
    const ok = st.every(s => s === 'locked' || s === 'clear');
    console.log(`   naïf /${n}/ → ${ok ? '✗ PASSE (devrait échouer)' : '✓ échoue'} [${st.join(',')}]`);
    if (ok) fail++;
  }
  for (const a of ALT[id] ?? []) {
    const st = run(a);
    const ok = st.every(s => s === 'locked' || s === 'clear');
    console.log(`   alt /${a}/ → ${ok ? '✓ réussit' : '✗ ÉCHOUE'}`);
    if (!ok) fail++;
  }
}
console.log(fail ? `\n${fail} problème(s)` : '\nTous les niveaux sont valides.');
process.exit(fail ? 1 : 0);
