// Vérifie data/missions.json : node tests/validate-missions.mjs
// - chaque cible correspond à la regex, chaque piège est refusé ;
// - pas de doublon, mots courts (lisibles sur un drone), exemple valide ;
// - champs obligatoires présents, 2 lignes de cours, une raison par piège.
import fs from 'fs';
import { prepareData, levelMatcher, buildWave } from '../js/missions.js';

const MAX_LEN = 16;
const raw = JSON.parse(fs.readFileSync(new URL('../data/missions.json', import.meta.url), 'utf8'));
const data = prepareData(raw);
let problems = 0;
const ids = new Set();

for (const lv of Object.values(data.levels)) {
  const bad = [];
  if (ids.has(lv.id)) bad.push('id en double');
  ids.add(lv.id);
  for (const k of ['notion', 'regex', 'mode', 'cours', 'exemple', 'cibles', 'pieges']) if (!lv[k]) bad.push(`champ manquant : ${k}`);
  if (!['entier', 'contient'].includes(lv.mode)) bad.push(`mode inconnu : ${lv.mode}`);
  if (lv.cours?.length !== 2) bad.push('le cours doit avoir 2 lignes');
  let m;
  try { m = levelMatcher(lv); } catch (e) { bad.push(e.message); }
  if (m) {
    const seen = new Set();
    const word = (w) => {
      if (seen.has(w)) bad.push(`doublon « ${w} »`);
      seen.add(w);
      if (w.length > MAX_LEN) bad.push(`trop long (${w.length}) « ${w} »`);
      if (w !== w.trim()) bad.push(`espace invisible en bord de « ${w} »`);
    };
    for (const c of lv.cibles) { word(c); if (!m.test(c)) bad.push(`CIBLE refusée « ${c} »`); }
    for (const p of lv.pieges) {
      word(p.mot);
      if (m.test(p.mot)) bad.push(`PIÈGE accepté « ${p.mot} »`);
      if (!p.raison) bad.push(`raison manquante « ${p.mot} »`);
    }
    if (!m.test(lv.exemple.mot)) bad.push(`exemple refusé « ${lv.exemple.mot} »`);
    const w = buildWave(lv);
    if (!w[0]?.hostile) bad.push('la vague ne commence pas par une cible');
  }
  const d = lv.difficulty;
  const wave = buildWave(lv);
  const nT = wave.filter((t) => t.hostile).length;
  console.log(
    `${lv.id.padEnd(4)} ${lv.mode.padEnd(8)} ${String(lv.cibles.length).padStart(2)}c/${String(lv.pieges.length).padStart(2)}p`
    + `  vague ${String(wave.length).padStart(2)} (${nT} cibles)  ${d.travel.toFixed(1)}s`
    + `  ${bad.length ? '✗ ' + bad.join(' | ') : '✓'}`
  );
  problems += bad.length;
}
console.log(problems ? `\n${problems} problème(s).` : `\nTous les niveaux sont valides (${ids.size}).`);
process.exit(problems ? 1 : 0);
