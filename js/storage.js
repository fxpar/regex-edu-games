// Progression locale (localStorage) — toujours protégée par try/catch.
const KEY = 'regexArcade.v1';
// ?unlock=all : tout débloquer le temps de la session (pratique pour l'enseignant), sans l'enregistrer
export const UNLOCK_ALL = new URLSearchParams(location.search).get('unlock') === 'all';

const DEFAULT = { unlocked: { jet: 1 }, best: {}, done: {}, muted: false };

export function loadProgress() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { p = {}; }
  const merged = { ...structuredClone(DEFAULT), ...p };
  return merged;
}

export function saveProgress(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* stockage indisponible */ }
}

export function resetProgress() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
