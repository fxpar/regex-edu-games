// =============================================================
//  LE JARDIN DES BULLES — version douce de Mach-Regex
//  Mêmes niveaux (data/missions.json), autre forme : des mots flottent
//  dans des bulles ; on cueille ceux qui correspondent à la regex.
//  Rythme lent, peu de bulles à la fois, une cible manquée repasse.
//  Jeu 100 % DOM (pas de 3D) : les bulles sont des <button>, donc
//  utilisables à la souris, au doigt et au clavier (Tab + Entrée).
// =============================================================
import { softSfx, initAudio, stopMusic } from './audio.js';
import { levelMatcher, buildWave } from './missions.js';
import { UNLOCK_ALL } from './storage.js';
import {
  $, esc, highlightHTML, regexHTML, MODE_INFO,
  openModal, closeModal, modalOpen, toast, courseCardHTML, memoHTML,
} from './ui.js';

const LEAVES = 5;            // vies, en feuilles
const PASS_RATIO = 0.7;      // part des cibles à cueillir pour réussir un niveau
const key = (id) => `garden:${id}`;

/** Mot affiché dans une bulle : espaces rendus visibles. */
function wordHTML(mot, spans = []) {
  return highlightHTML(mot, spans).replace(/ (?![^<]*>)/g, '<span class="ws">·</span>');
}

/** Rythme du jardin : lent au début, un peu plus soutenu ensuite, jamais frénétique. */
function gardenPace(level, narrow) {
  const g = level.difficulty.g;
  return {
    words: 10 + Math.round(4 * g),        // 10 -> 14 bulles
    rise: 16 - 4 * g,                     // secondes pour traverser l'écran
    gap: 3.4 - 0.9 * g,                   // délai entre deux bulles
    maxOn: (narrow ? 2 : 3) + (g > 0.5 ? 1 : 0),
  };
}

export class GardenGame {
  constructor(app) {
    this.app = app;
    this.scene = null; // pas de rendu 3D : main.js masque le canvas
    this.state = 'idle';
    this.bubbles = [];
    this.nextId = 1;
    this.field = $('#gd-field');
    this.bind();
  }

  // ---------------------------------------------------------------
  //  BRANCHEMENTS
  // ---------------------------------------------------------------
  bind() {
    const on = (sel, fn) => $(sel).addEventListener('click', (e) => { e.currentTarget.blur(); initAudio(); fn(); });
    on('#gd-course', () => this.requestCourse());
    on('#gd-pause', () => this.pause());
    on('#gd-quit', () => this.quit());
    on('#gdm-back', () => this.app.toWelcome());
    this.field.addEventListener('click', (e) => {
      const el = e.target.closest('.bubble');
      if (!el) return;
      const b = this.bubbles.find((x) => x.id === +el.dataset.id);
      if (b) this.pick(b);
    });
    window.addEventListener('keydown', (e) => {
      if (this.app.active !== this || e.key !== 'Escape') return;
      if (this.state === 'playing') { e.preventDefault(); this.pause(); }
      else if (this.state === 'paused' || this.state === 'course') { e.preventDefault(); this.resume(); }
    });
  }

  // ---------------------------------------------------------------
  //  MENU DES PARCELLES (= escadrilles)
  // ---------------------------------------------------------------
  squads() { return this.app.data.games.find((g) => g.id === 'jet').squadrons; }
  parcelName(s, i) { return `Parcelle ${i + 1} · ${s.name.split('—')[1]?.trim() || s.name}`; }

  openMenu() {
    closeModal();
    this.state = 'idle';
    this.clearField();
    const p = this.app.progress;
    const unlocked = UNLOCK_ALL ? 99 : p.unlocked.garden ?? 1;
    const lv = this.app.data.levels;
    $('#gdm-list').innerHTML = this.squads().map((s, i) => {
      const locked = i + 1 > unlocked;
      const done = s.levels.filter((id) => p.done[key(id)]).length;
      const chips = s.levels.map((id) => `<span class="gd-chip ${p.done[key(id)] ? 'done' : ''}" title="/${esc(lv[id].regex)}/">${esc(lv[id].notion)}</span>`).join('');
      return `<article class="gd-parcel ${locked ? 'locked' : ''}">
        <h3>${esc(this.parcelName(s, i))}</h3>
        <div class="gd-chips">${chips}</div>
        <div class="gd-meta">${done}/${s.levels.length} fleurs écloses</div>
        <button class="gd-btn ${locked ? '' : 'primary'}" type="button" data-parcel="${i}" ${locked ? 'disabled' : ''}>${locked ? 'Termine la parcelle précédente' : 'Entrer ▸'}</button>
      </article>`;
    }).join('');
    $('#gdm-list').querySelectorAll('[data-parcel]').forEach((b) => b.addEventListener('click', () => {
      initAudio();
      softSfx.open();
      this.start(this.squads()[+b.dataset.parcel]);
    }));
  }

  // ---------------------------------------------------------------
  //  CYCLE DE VIE
  // ---------------------------------------------------------------
  start(squad) {
    this.squad = squad;
    this.squadIdx = this.squads().indexOf(squad);
    this.levelIdx = 0;
    this.leaves = LEAVES;
    this.score = 0;
    this.app.setScreen('screen-garden');
    this.startLevel();
  }

  startLevel() {
    this.clearField();
    this.level = this.app.data.levels[this.squad.levels[this.levelIdx]];
    this.matcher = levelMatcher(this.level);
    this.pace = gardenPace(this.level, this.field.clientWidth < 560);
    const lv = this.level;
    this.queue = buildWave({ ...lv, difficulty: { ...lv.difficulty, drones: this.pace.words } });
    this.stats = { picked: 0, targets: this.queue.filter((w) => w.hostile).length, spared: 0, traps: this.queue.filter((w) => !w.hostile).length };
    this.errors = [];
    this.time = 0;
    this.timer = 0.8;
    this.lastSec = -1;
    this.levelScore0 = this.score;
    $('#gd-msg').innerHTML = '';
    $('#gd-parcel').textContent = this.parcelName(this.squad, this.squadIdx);
    $('#gd-level').textContent = `Fleur ${this.levelIdx + 1}/${this.squad.levels.length}`;
    $('#gd-regex').innerHTML = regexHTML(lv.regex, lv.flags);
    const mi = MODE_INFO[lv.mode];
    $('#gd-mode').textContent = lv.mode === 'entier' ? 'le mot entier' : 'une partie du mot suffit';
    $('#gd-mode').title = mi.help;
    $('#gd-flags').hidden = !lv.flags;
    $('#gd-flags').textContent = lv.flags.includes('i') ? 'majuscules = minuscules' : lv.flags;
    this.renderLeaves();
    this.renderScore();
    this.renderGrace();
    this.state = 'intro';
    this.showCourse({ intro: true });
  }

  begin() {
    closeModal();
    this.state = 'playing';
    this.field.classList.remove('frozen');
  }

  clearField() {
    for (const b of this.bubbles) b.el.remove();
    this.bubbles = [];
    this.field.innerHTML = '';
  }

  quit() {
    closeModal();
    this.app.openGarden();
  }

  // ---------------------------------------------------------------
  //  HUD
  // ---------------------------------------------------------------
  renderLeaves() {
    $('#gd-leaves').innerHTML = Array.from({ length: LEAVES }, (_, i) => `<span class="${i < this.leaves ? '' : 'lost'}">🍃</span>`).join('');
    $('#gd-leaves').setAttribute('aria-label', `${this.leaves} feuilles sur ${LEAVES}`);
  }
  renderScore() {
    $('#gd-score').textContent = this.score;
    $('#gd-jar-count').textContent = this.stats ? this.stats.picked : 0;
  }
  inGrace() { return this.time < this.app.data.config.graceSeconds; }
  renderGrace() {
    const left = Math.ceil(this.app.data.config.graceSeconds - this.time);
    const el = $('#gd-course');
    el.textContent = left > 0 ? `Cours · libre ${left}s` : 'Cours · 1 🍃';
    el.classList.toggle('cost', left <= 0);
  }

  say(html, kind = 'info', ms = 4200) {
    const box = $('#gd-msg');
    const el = document.createElement('div');
    el.className = `gd-note ${kind}`;
    el.style.animationDuration = `${ms}ms`;
    el.innerHTML = html;
    box.prepend(el);
    while (box.children.length > 3) box.lastChild.remove();
    setTimeout(() => el.remove(), ms);
  }

  loseLeaf() {
    this.leaves--;
    this.renderLeaves();
    $('#gd-leaves').classList.remove('shake');
    void $('#gd-leaves').offsetWidth;
    $('#gd-leaves').classList.add('shake');
    if (this.leaves <= 0) this.gameOver();
  }

  // ---------------------------------------------------------------
  //  BULLES
  // ---------------------------------------------------------------
  spawn(item) {
    const W = this.field.clientWidth;
    const lanes = W < 560 ? [0.28, 0.72] : [0.14, 0.38, 0.62, 0.86];
    // couloir le moins encombré près du bas
    const busy = lanes.map((x) => this.bubbles.filter((b) => b.lane === x && b.p < 0.35).length);
    const free = lanes.filter((_, i) => busy[i] === Math.min(...busy));
    const lane = free[Math.floor(Math.random() * free.length)];
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'bubble';
    el.dataset.id = this.nextId;
    el.innerHTML = `<span class="bw">${wordHTML(item.mot)}</span>`;
    el.setAttribute('aria-label', `Bulle : ${item.mot}`);
    el.style.setProperty('--hue', String(Math.floor(Math.random() * 360)));
    this.field.appendChild(el);
    const b = { id: this.nextId++, item, el, lane, p: 0, phase: Math.random() * 6.28, w: el.offsetWidth, h: el.offsetHeight, done: false };
    this.bubbles.push(b);
    this.place(b);
  }

  place(b) {
    const W = this.field.clientWidth;
    const H = this.field.clientHeight;
    const sway = Math.sin(this.time * 0.9 + b.phase) * Math.min(26, W * 0.03);
    const x = Math.max(6, Math.min(W - b.w - 6, b.lane * W - b.w / 2 + sway));
    const y = H + 10 - b.p * (H + b.h + 30);
    b.x = x;
    b.y = y;
    b.el.style.transform = `translate(${x}px, ${y}px)`;
  }

  /** Clic sur une bulle. */
  pick(b) {
    if (this.state !== 'playing' || b.done) return;
    b.done = true;
    const { mot, hostile, raison } = b.item;
    if (hostile) {
      this.stats.picked++;
      const pts = 50 + Math.round(50 * (1 - b.p));
      this.score += pts;
      softSfx.chime();
      this.toJar(b);
      this.say(`✿ <b class="w">${wordHTML(mot, this.matcher.spans(mot))}</b> correspond · +${pts}`, 'good', 2600);
    } else {
      softSfx.oops();
      b.el.classList.add('wrong');
      setTimeout(() => this.drop(b), 900);
      this.errors.push({ kind: 'shot', mot, raison });
      this.say(`<b class="w">${wordHTML(mot)}</b> ne correspond pas<small>${esc(raison)}</small>`, 'bad', 6000);
      this.loseLeaf();
    }
    this.renderScore();
  }

  /** La bulle cueillie s'envole vers le bocal. */
  toJar(b) {
    const jar = $('#gd-jar').getBoundingClientRect();
    const f = this.field.getBoundingClientRect();
    b.el.classList.add('caught');
    b.el.style.transform = `translate(${jar.left - f.left + jar.width / 2 - b.w / 2}px, ${jar.top - f.top}px) scale(.25)`;
    const jarEl = $('#gd-jar');
    setTimeout(() => { this.drop(b); jarEl.classList.remove('bump'); void jarEl.offsetWidth; jarEl.classList.add('bump'); }, 650);
  }

  drop(b) {
    b.el.remove();
    this.bubbles = this.bubbles.filter((x) => x !== b);
  }

  /** La bulle sort par le haut sans avoir été cueillie. */
  escape(b) {
    b.done = true;
    const { mot, hostile, raison } = b.item;
    if (hostile) {
      if (!b.item.retry) {
        // une cible manquée repasse une fois, plus tard
        this.queue.push({ ...b.item, retry: true });
        this.say(`<b class="w">${wordHTML(mot, this.matcher.spans(mot))}</b> correspondait… elle repassera`, 'warn', 4500);
      } else {
        this.errors.push({ kind: 'missed', mot });
        this.say(`<b class="w">${wordHTML(mot, this.matcher.spans(mot))}</b> correspondait`, 'warn', 4500);
      }
      softSfx.drift();
    } else {
      this.stats.spared++;
      this.score += 10;
      this.say(`<b class="w">${wordHTML(mot)}</b> s'envole, bien vu · +10<small>${esc(raison)}</small>`, 'info', 4200);
      this.renderScore();
    }
    b.el.classList.add('away');
    setTimeout(() => this.drop(b), 500);
  }

  // ---------------------------------------------------------------
  //  COURS / PAUSE
  // ---------------------------------------------------------------
  requestCourse() {
    if (this.state !== 'playing' && this.state !== 'paused') return;
    if (!this.inGrace()) {
      if (this.leaves <= 1) { toast('Dernière feuille : le cours est fermé'); softSfx.oops(); return; }
      this.loseLeaf();
      this.say('Cours consulté : −1 🍃', 'bad', 3000);
    }
    this.state = 'course';
    this.showCourse({});
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.field.classList.add('frozen');
    if (this.inGrace()) { this.showCourse({ paused: true }); return; }
    openModal(`
      <div class="kicker">PAUSE</div>
      <h2>Le jardin attend</h2>
      <p>Les bulles sont immobiles. Revoir le cours coûte maintenant une feuille 🍃.</p>
      <div class="modal-actions">
        <button class="btn ghost" data-act="quit">Quitter</button>
        <button class="btn pink" data-act="course" ${this.leaves <= 1 ? 'disabled' : ''}>Voir le cours (1 🍃)</button>
        <button class="btn" data-act="resume" data-autofocus>Reprendre</button>
      </div>`, { onMount: (el) => this.wire(el) });
  }

  resume() {
    closeModal();
    if (this.state === 'intro') { this.begin(); return; }
    this.state = 'playing';
    this.field.classList.remove('frozen');
  }

  wire(el) {
    el.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.act;
      if (a === 'resume') this.resume();
      else if (a === 'begin') this.begin();
      else if (a === 'course') { this.state = 'paused'; this.requestCourse(); }
      else if (a === 'quit') this.quit();
      else if (a === 'next') { closeModal(); this.levelIdx++; this.startLevel(); }
      else if (a === 'retry') { closeModal(); this.startLevel(); }
      else if (a === 'restart') { closeModal(); this.start(this.squad); }
      else if (a === 'menu') this.quit();
    }));
    el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      el.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('active', x === b));
      el.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.tab; });
    }));
  }

  showCourse({ intro = false, paused = false }) {
    const lv = this.level;
    const upto = Object.values(this.app.data.levels).filter((l) => l.global <= lv.global).sort((a, b) => a.global - b.global);
    const left = Math.ceil(this.app.data.config.graceSeconds - this.time);
    const note = intro
      ? `<div class="grace-note">Pendant les <b>${this.app.data.config.graceSeconds} premières secondes</b>, tu peux revoir ce cours librement (bouton Cours ou Échap). Ensuite, il coûte une feuille 🍃.</div>`
      : this.inGrace()
        ? `<div class="grace-note">Encore <b>${left} s</b> de consultation libre.</div>`
        : '<div class="grace-note cost">Consultation : −1 🍃. Les bulles attendent pendant ta lecture.</div>';
    const how = intro
      ? `<div class="controls-note"><b>Comment jouer :</b> clique ou touche les bulles dont le mot <b>correspond</b> à la regex pour les cueillir.
         Laisse s'envoler les autres. Au clavier : <kbd>Tab</kbd> puis <kbd>Entrée</kbd>.
         Une bulle manquée repasse une fois ; cueillir un mot qui ne correspond pas coûte une feuille 🍃.
         Il faut cueillir ${Math.round(PASS_RATIO * 100)} % des bons mots pour faire éclore la fleur.</div>`
      : '';
    openModal(`
      <div class="kicker">${intro ? 'NOUVELLE FLEUR' : paused ? 'PAUSE · COURS' : 'COURS'} · ${esc(this.parcelName(this.squad, this.squadIdx))} · ${this.levelIdx + 1}/${this.squad.levels.length}</div>
      <div class="tabs">
        <button class="tab active" data-tab="card">La notion</button>
        <button class="tab" data-tab="memo">Mémo (${upto.length})</button>
      </div>
      <div data-pane="card">${courseCardHTML(lv, this.matcher)}</div>
      <div data-pane="memo" hidden>${memoHTML(upto, lv.id)}</div>
      ${how}${note}
      <div class="modal-actions">
        <button class="btn ghost" data-act="quit">${intro ? 'Retour' : 'Quitter'}</button>
        <button class="btn pink" data-act="${intro ? 'begin' : 'resume'}" data-autofocus>${intro ? 'Commencer ▸' : 'Reprendre'}</button>
      </div>`, { onMount: (el) => this.wire(el) });
    softSfx.open();
  }

  // ---------------------------------------------------------------
  //  FIN DE NIVEAU
  // ---------------------------------------------------------------
  errorsHTML() {
    if (!this.errors.length) return '<div class="grace-note">Aucune erreur : bravo !</div>';
    return `<p>À revoir :</p><ul class="errors">${this.errors.map((e) => (e.kind === 'shot'
      ? `<li><span class="tag bad">CUEILLI À TORT</span><span class="w">${wordHTML(e.mot)}</span><span class="why">${esc(e.raison)}</span></li>`
      : `<li><span class="tag warn">OUBLIÉ</span><span class="w">${wordHTML(e.mot, this.matcher.spans(e.mot))}</span><span class="why">Ce mot correspondait.</span></li>`)).join('')}</ul>`;
  }

  complete() {
    this.state = 'done';
    const lv = this.level;
    const st = this.stats;
    const need = Math.ceil(PASS_RATIO * st.targets);
    const ok = st.picked >= need;
    const stats = `
      <div class="stats">
        <div class="stat"><b>${st.picked}/${st.targets}</b><span>Mots cueillis</span></div>
        <div class="stat"><b>${st.spared}/${st.traps}</b><span>Pièges évités</span></div>
        <div class="stat"><b>${this.score - this.levelScore0}</b><span>Points</span></div>
      </div>`;
    if (!ok) {
      softSfx.sad();
      openModal(`
        <div class="kicker">PRESQUE !</div>
        <h2>${regexHTML(lv.regex, lv.flags)}</h2>
        ${stats}
        <p>Il fallait cueillir au moins <b>${need}</b> bons mots. Tu peux réessayer cette fleur, tes feuilles sont conservées.</p>
        ${this.errorsHTML()}
        <div class="modal-actions">
          <button class="btn ghost" data-act="menu">Parcelles</button>
          <button class="btn pink" data-act="retry" data-autofocus>Réessayer ▸</button>
        </div>`, { onMount: (el) => this.wire(el) });
      return;
    }
    softSfx.done();
    const p = this.app.progress;
    p.best[key(lv.id)] = Math.max(p.best[key(lv.id)] ?? 0, this.score - this.levelScore0);
    p.done[key(lv.id)] = true;
    const last = this.levelIdx >= this.squad.levels.length - 1;
    const squads = this.squads();
    if (last) p.unlocked.garden = Math.max(p.unlocked.garden ?? 1, this.squadIdx + 2);
    this.app.save();
    const bonus = !this.errors.length && this.leaves < LEAVES;
    if (bonus) { this.leaves++; this.renderLeaves(); }
    openModal(`
      <div class="kicker">${last ? 'PARCELLE EN FLEURS' : 'LA FLEUR A ÉCLOS'} · ${esc(lv.notion)}</div>
      <h2>${regexHTML(lv.regex, lv.flags)} ✿</h2>
      ${stats}
      ${this.errorsHTML()}
      ${bonus ? '<div class="grace-note">Sans erreur : une feuille repousse 🍃</div>' : ''}
      ${last && this.squadIdx + 1 < squads.length ? `<div class="grace-note">Nouvelle parcelle ouverte : <b>${esc(this.parcelName(squads[this.squadIdx + 1], this.squadIdx + 1))}</b></div>` : ''}
      ${last && this.squadIdx + 1 >= squads.length ? '<div class="grace-note">Tout le jardin est en fleurs. Bravo !</div>' : ''}
      <div class="modal-actions">
        <button class="btn ghost" data-act="menu">Parcelles</button>
        ${last ? '' : '<button class="btn pink" data-act="next" data-autofocus>Fleur suivante ▸</button>'}
      </div>`, { onMount: (el) => this.wire(el) });
  }

  gameOver() {
    if (this.state === 'over') return;
    this.state = 'over';
    this.field.classList.add('frozen');
    softSfx.sad();
    openModal(`
      <div class="kicker">PLUS DE FEUILLES</div>
      <h2>On recommence la parcelle</h2>
      <p>Toutes les feuilles sont tombées. La parcelle <b>${esc(this.parcelName(this.squad, this.squadIdx))}</b> reprend depuis sa première fleur.</p>
      <p>Regex : <span class="solution" style="display:inline-block">${regexHTML(this.level.regex, this.level.flags)}</span></p>
      ${this.errorsHTML()}
      <div class="modal-actions">
        <button class="btn ghost" data-act="menu">Parcelles</button>
        <button class="btn pink" data-act="restart" data-autofocus>Recommencer ▸</button>
      </div>`, { onMount: (el) => this.wire(el) });
  }

  // ---------------------------------------------------------------
  //  INTERFACE COMMUNE AVEC main.js (enter / exit / resize / update)
  // ---------------------------------------------------------------
  enter() { stopMusic(); document.body.classList.add('soft'); }
  exit() {
    this.state = 'idle';
    this.clearField();
    document.body.classList.remove('soft');
  }
  resize() {}

  update(dt) {
    if (this.state !== 'playing' || modalOpen()) return;
    this.time += dt;
    const sec = Math.floor(this.time);
    if (sec !== this.lastSec) { this.lastSec = sec; this.renderGrace(); }
    this.timer -= dt;
    const live = this.bubbles.filter((b) => !b.done).length;
    if (this.timer <= 0 && this.queue.length && live < this.pace.maxOn) {
      this.spawn(this.queue.shift());
      this.timer = this.pace.gap;
    }
    for (const b of this.bubbles) {
      if (b.done) continue;
      b.p += dt / this.pace.rise;
      this.place(b);
      if (b.p >= 1) this.escape(b);
    }
    if (this.state === 'playing' && !this.queue.length && !this.bubbles.length) this.complete();
  }
}
