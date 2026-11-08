// Point d'entrée : renderer partagé, post-traitement néon, navigation Hub <-> jeux.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { HubScene } from './hub.js';
import { JetGame } from './jet-game.js';
import { loadProgress, saveProgress, resetProgress, UNLOCK_ALL } from './storage.js';
import { initAudio, setMuted, isMuted, sfx, startMusic, stopMusic } from './audio.js';
import { $, esc, toast, closeModal, modalOpen } from './ui.js';

const data = await fetch('data/levels.json').then((r) => r.json());
await document.fonts?.ready;

const canvas = $('#gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const lowPower = matchMedia('(max-width: 760px)').matches;
renderer.setPixelRatio(Math.min(devicePixelRatio, lowPower ? 1.5 : 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
composer.addPass(renderPass);
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.6, 0.4, 0.3);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const app = {
  data,
  renderer,
  progress: loadProgress(),
  active: null,
  save() { saveProgress(this.progress); },
  setScreen(id) {
    for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id && !(id === 'screen-squad' && s.id === 'screen-hub');
    if (id === 'screen-squad') $('#screen-hub').querySelectorAll('.hub-cards, .hub-foot').forEach((e) => (e.style.visibility = 'hidden'));
    else $('#screen-hub').querySelectorAll('.hub-cards, .hub-foot').forEach((e) => (e.style.visibility = ''));
  },
  activate(sceneObj) {
    if (this.active === sceneObj) return;
    this.active?.exit();
    this.active = sceneObj;
    sceneObj.enter();
    resize();
  },
  toHub() {
    closeModal();
    this.activate(hub);
    this.setScreen('screen-hub');
    renderHubCards();
  },
  selectGame(id) {
    initAudio();
    const game = data.games.find((g) => g.id === id);
    if (game.status !== 'playable') { sfx.error(); toast(`« ${game.title} » est en développement : bientôt disponible !`); return; }
    sfx.open();
    this.openSquadrons();
  },
  openSquadrons() {
    closeModal();
    this.activate(hub);
    this.setScreen('screen-squad');
    renderSquadrons();
  },
  startSquadron(idx) {
    initAudio();
    const squad = data.games.find((g) => g.id === 'jet').squadrons[idx];
    this.setScreen('screen-game');
    this.activate(jet);
    jet.start(squad);
  },
};

const hub = new HubScene(app);
const jet = new JetGame(app);

// ---------- Hub : cartes HTML (accessibles, et pratiques sur mobile) ----------
function renderHubCards() {
  const box = $('#hub-cards');
  box.innerHTML = data.games.map((g) => {
    const playable = g.status === 'playable';
    const state = playable ? `▶ Jouer · ${g.squadrons.length} escadrilles` : `En développement · ${(g.notions || []).join(', ')}`;
    return `<button type="button" class="hub-card ${playable ? '' : 'locked'}" style="--c:${g.color}" data-game="${g.id}">
      <h3>${esc(g.title)}</h3><p>${esc(g.subtitle)}</p><span class="state" style="color:${g.color}">${esc(state)}</span></button>`;
  }).join('');
  box.querySelectorAll('[data-game]').forEach((b) => {
    b.addEventListener('click', () => app.selectGame(b.dataset.game));
    b.addEventListener('mouseenter', () => hub.setHover(b.dataset.game));
    b.addEventListener('mouseleave', () => hub.setHover(null));
  });
}

function renderSquadrons() {
  const game = data.games.find((g) => g.id === 'jet');
  const unlocked = UNLOCK_ALL ? 99 : app.progress.unlocked.jet ?? 1;
  $('#squad-list').innerHTML = game.squadrons.map((s, i) => {
    const locked = i + 1 > unlocked;
    const best = s.levels.reduce((a, id) => a + (app.progress.best[id] ?? 0), 0);
    const chips = s.levels.map((id) => `<span class="chip ${app.progress.done[id] ? 'done' : ''}" title="${esc(data.levels[id].title)}">${esc(data.levels[id].notion)}</span>`).join('');
    return `<article class="squad ${locked ? 'locked' : ''}">
      <h3>${esc(s.name)}</h3>
      <div class="chips">${chips}</div>
      <div class="meta">${s.levels.length} niveaux · ${data.config.livesPerSquadron} ♥ · meilleur total : ${best} pts</div>
      <button class="btn ${locked ? '' : 'pink'}" type="button" data-squad="${i}" ${locked ? 'disabled' : ''}>${locked ? '🔒 Terminer l\'escadrille précédente' : 'Lancer ▶'}</button>
    </article>`;
  }).join('');
  $('#squad-list').querySelectorAll('[data-squad]').forEach((b) => b.addEventListener('click', () => { sfx.click(); app.startSquadron(+b.dataset.squad); }));
}

$('#btn-squad-back').addEventListener('click', () => { sfx.click(); app.toHub(); });
$('#btn-reset').addEventListener('click', () => {
  if (!confirm('Effacer toute la progression enregistrée sur ce navigateur ?')) return;
  resetProgress();
  app.progress = loadProgress();
  renderHubCards();
  toast('Progression réinitialisée');
});

// ---------- Son ----------
function syncSoundButtons() {
  const on = !isMuted();
  $('#btn-sound-hub').textContent = `♪ Son : ${on ? 'ON' : 'OFF'}`;
  $('#btn-sound').textContent = on ? '♪' : '✕♪';
}
function toggleSound() {
  initAudio();
  setMuted(!isMuted());
  app.progress.muted = isMuted();
  app.save();
  if (isMuted()) stopMusic(); else startMusic();
  syncSoundButtons();
}
setMuted(!!app.progress.muted);
syncSoundButtons();
$('#btn-sound-hub').addEventListener('click', toggleSound);
$('#btn-sound').addEventListener('click', toggleSound);
// La musique démarre au premier geste (règle d'autoplay des navigateurs)
window.addEventListener('pointerdown', () => { initAudio(); if (!isMuted()) startMusic(); }, { once: true });
window.addEventListener('keydown', () => { initAudio(); if (!isMuted()) startMusic(); }, { once: true });

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#screen-squad').hidden && !modalOpen()) app.toHub();
});

// Onglet masqué -> pause automatique
document.addEventListener('visibilitychange', () => {
  if (document.hidden && app.active === jet && jet.state === 'playing') jet.pause();
});

// ---------- Redimensionnement & boucle ----------
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  hub.resize(w, h);
  jet.resize(w, h);
}
addEventListener('resize', resize);

const clock = new THREE.Clock();
function loop() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const a = app.active;
  if (a) {
    a.update(dt);
    renderPass.scene = a.scene;
    renderPass.camera = a.camera;
    composer.render(dt);
  }
  requestAnimationFrame(loop);
}

app.toHub();
resize();
loop();
$('#loader').classList.add('done');

// Accès debug pour l'enseignant (console)
window.regexArcade = app;
