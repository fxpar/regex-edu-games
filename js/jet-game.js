// =============================================================
//  MACH-REGEX : Jet Interceptor
//  Boucle de jeu 3D, cibles, missiles, chrono de grâce et vies.
// =============================================================
import * as THREE from 'three';
import { compile, evaluate, classify, formatValue, isMatch } from './regex-engine.js';
import { glowTexture, reticleTexture, labelTexture } from './textures.js';
import { sfx } from './audio.js';
import {
  $, esc, highlightHTML, patternHTML, MODE_LABEL, RegexInput,
  openModal, closeModal, toast, flash, courseCardHTML, memoHTML,
} from './ui.js';

const STATUS_TXT = { locked: 'VERROUILLÉ', wrong: 'CAPTURE FAUSSE', iff: '⚠ IFF ALLIÉ', none: 'NON VERROUILLÉ', clear: 'NON VERROUILLÉ' };
const STATUS_HEX = { locked: 0x2bff88, wrong: 0xff3860, iff: 0xff3860, none: 0xffb000, clear: 0xffb000 };
const KEYS = ['.', '*', '+', '?', '\\d', '\\w', '\\s', '\\S', '\\b', '^', '$', '[ ]', '( )', '|', '{ }', '\\', '-', '#', ':'];

const shuffle = (a) => {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
};

export class JetGame {
  constructor(app) {
    this.app = app;
    this.cfg = app.data.config;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.5, 3000);
    this.camBase = new THREE.Vector3(0, 8.5, 15);
    this.lane = 0;
    this.drones = [];
    this.missiles = [];
    this.state = 'idle';
    this.t = 0;
    this.shake = 0;
    this.nextId = 1;
    this.buildWorld();
    this.buildParticles();
    this.bindHud();
  }

  // ---------------------------------------------------------------
  //  MONDE 3D
  // ---------------------------------------------------------------
  buildWorld() {
    const s = this.scene;
    const fogColor = new THREE.Color(0x2a0547);
    s.fog = new THREE.Fog(fogColor, 300, 1600);
    s.background = new THREE.Color(0x07001a);

    // Ciel dégradé synthwave
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(1500, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `varying vec3 vP;
          void main(){
            float h = vP.y;
            vec3 hor = vec3(0.75, 0.12, 0.42);
            vec3 mid = vec3(0.16, 0.02, 0.3);
            vec3 top = vec3(0.02, 0.0, 0.07);
            vec3 c = mix(hor, mid, smoothstep(-0.02, 0.12, h));
            c = mix(c, top, smoothstep(0.12, 0.55, h));
            if (h < -0.02) c = vec3(0.16, 0.02, 0.28);
            gl_FragColor = vec4(c, 1.0);
          }`,
      })
    );
    s.add(sky);

    // Soleil rayé
    this.sunMat = new THREE.ShaderMaterial({
      transparent: true, fog: false, depthWrite: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform float uTime; varying vec2 vUv;
        void main(){
          vec2 p = vUv - 0.5;
          if (length(p) > 0.5) discard;
          float y = vUv.y;
          if (y < 0.52) {
            float band = fract(y * 14.0 + uTime * 0.25);
            if (band < 0.18 + (0.52 - y) * 1.1) discard;
          }
          vec3 c = mix(vec3(1.0, 0.16, 0.6), vec3(1.0, 0.86, 0.3), smoothstep(0.1, 0.9, y));
          gl_FragColor = vec4(c * 0.95, 1.0);
        }`,
    });
    const sun = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), this.sunMat);
    sun.position.set(0, 120, -1300);
    s.add(sun);

    // Étoiles
    const N = 900;
    const sp = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.random() * 0.45 + 0.08;
      sp[i * 3] = Math.cos(th) * Math.cos(ph) * 1300;
      sp[i * 3 + 1] = Math.sin(ph) * 1300;
      sp[i * 3 + 2] = Math.sin(th) * Math.cos(ph) * 1300;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    s.add(new THREE.Points(sg, new THREE.PointsMaterial({ size: 2.2, color: 0xffffff, fog: false, sizeAttenuation: false, transparent: true, opacity: 0.8 })));

    // Océan-grille néon (shader défilant)
    this.gridMat = new THREE.ShaderMaterial({
      fog: false,
      uniforms: { uTime: { value: 0 }, uFog: { value: fogColor } },
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform float uTime; uniform vec3 uFog; varying vec3 vW;
        void main(){
          vec2 c = vec2(vW.x, vW.z + uTime * 90.0) / 24.0;
          vec2 g = abs(fract(c - 0.5) - 0.5) / fwidth(c);
          float line = 1.0 - min(min(g.x, g.y), 1.0);
          float d = length(vW.xz) / 1000.0;
          vec3 base = vec3(0.03, 0.0, 0.08);
          vec3 lc = vec3(1.0, 0.17, 0.84);
          vec3 col = base + lc * line * 0.75 * (1.0 - smoothstep(0.15, 0.9, d));
          col = mix(col, uFog, smoothstep(0.25, 0.95, d));
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), this.gridMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -6;
    s.add(ground);

    // Montagnes low-poly sur les côtés (recyclées)
    this.mountains = [];
    const mGeo = new THREE.ConeGeometry(1, 1, 4, 1);
    const mMat = new THREE.MeshStandardMaterial({ color: 0x12052e, flatShading: true, roughness: 0.9 });
    const eMat = new THREE.LineBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.55 });
    const eGeo = new THREE.EdgesGeometry(mGeo);
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < 18; i++) {
        const m = new THREE.Group();
        m.add(new THREE.Mesh(mGeo, mMat));
        m.add(new THREE.LineSegments(eGeo, eMat));
        const sc = 30 + Math.random() * 50;
        m.scale.set(sc * 1.4, sc * (0.8 + Math.random()), sc * 1.4);
        m.position.set(side * (170 + Math.random() * 160), -6 + m.scale.y / 2, -i * 60 - Math.random() * 40);
        m.rotation.y = Math.random() * Math.PI;
        s.add(m);
        this.mountains.push(m);
      }
    }

    // Lumières
    s.add(new THREE.HemisphereLight(0x8a7bff, 0x220033, 0.9));
    const dl = new THREE.DirectionalLight(0xffb0e0, 1.2);
    dl.position.set(-20, 40, -60);
    s.add(dl);

    // Le jet
    this.jet = this.buildJet();
    this.jet.position.set(0, 4, 0);
    s.add(this.jet);
  }

  buildJet() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x1b2148, metalness: 0.7, roughness: 0.3, flatShading: true });
    const edge = new THREE.LineBasicMaterial({ color: 0x00f0ff, toneMapped: false });
    const add = (geo, m = mat) => {
      const mesh = new THREE.Mesh(geo, m);
      g.add(mesh);
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), edge);
      g.add(e);
      return [mesh, e];
    };
    // fuselage + nez
    const fus = new THREE.CylinderGeometry(0.42, 0.62, 6, 6);
    fus.rotateX(Math.PI / 2);
    add(fus);
    const nose = new THREE.ConeGeometry(0.42, 2.6, 6);
    nose.rotateX(-Math.PI / 2);
    nose.translate(0, 0, -4.3);
    add(nose);
    // ailes delta
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0.3, -1.2);
    wingShape.lineTo(4.2, 2.0);
    wingShape.lineTo(4.2, 2.6);
    wingShape.lineTo(0.3, 2.7);
    const wing = new THREE.ExtrudeGeometry(wingShape, { depth: 0.1, bevelEnabled: false });
    wing.rotateX(Math.PI / 2);
    add(wing);
    const wingL = wing.clone();
    wingL.scale(-1, 1, 1);
    add(wingL);
    // dérives
    const finShape = new THREE.Shape();
    finShape.moveTo(0, 0);
    finShape.lineTo(1.6, 1.8);
    finShape.lineTo(2.3, 1.8);
    finShape.lineTo(2.0, 0);
    const fin = new THREE.ExtrudeGeometry(finShape, { depth: 0.08, bevelEnabled: false });
    fin.rotateY(-Math.PI / 2);
    fin.translate(0.45, 0.3, 1.0);
    const finR = fin.clone();
    fin.rotateZ(0.25);
    finR.translate(-0.9, 0, 0);
    finR.rotateZ(-0.25);
    add(fin);
    add(finR);
    // cockpit
    const canopy = new THREE.SphereGeometry(0.5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    canopy.scale(0.9, 0.8, 2.4);
    canopy.translate(0, 0.32, -1.6);
    g.add(new THREE.Mesh(canopy, new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.55, toneMapped: false })));
    // réacteurs
    const glowMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff7a2b, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.flames = [];
    for (const x of [-0.28, 0.28]) {
      const f = new THREE.Sprite(glowMat);
      f.position.set(x, 0, 3.3);
      f.scale.set(0.9, 0.9, 1);
      g.add(f);
      this.flames.push(f);
    }
    const flameCone = new THREE.Mesh(
      new THREE.ConeGeometry(0.4, 2.4, 10, 1, true).rotateX(Math.PI / 2).translate(0, 0, 4.3),
      new THREE.MeshBasicMaterial({ color: 0xff2bd6, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    );
    g.add(flameCone);
    this.flameCone = flameCone;
    return g;
  }

  // Système de particules unique (traînées + explosions)
  buildParticles() {
    const N = 3000;
    this.pN = N;
    this.pPos = new Float32Array(N * 3);
    this.pCol = new Float32Array(N * 3);
    this.pVel = new Float32Array(N * 3);
    this.pLife = new Float32Array(N);
    this.pMax = new Float32Array(N);
    this.pBase = new Float32Array(N * 3);
    this.pHead = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.particles = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 1.1, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    }));
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);
  }

  emit(pos, vel, color, life) {
    const i = this.pHead;
    this.pHead = (this.pHead + 1) % this.pN;
    this.pPos.set([pos.x, pos.y, pos.z], i * 3);
    this.pVel.set([vel.x, vel.y, vel.z], i * 3);
    this.pBase.set([color.r, color.g, color.b], i * 3);
    this.pLife[i] = life;
    this.pMax[i] = life;
  }

  updateParticles(dt) {
    const P = this.pPos, V = this.pVel, C = this.pCol, B = this.pBase;
    for (let i = 0; i < this.pN; i++) {
      if (this.pLife[i] <= 0) {
        if (this.pLife[i] > -1) { C[i * 3] = C[i * 3 + 1] = C[i * 3 + 2] = 0; P[i * 3 + 1] = -1e5; this.pLife[i] = -2; }
        continue;
      }
      this.pLife[i] -= dt;
      const k = Math.max(0, this.pLife[i] / this.pMax[i]);
      P[i * 3] += V[i * 3] * dt;
      P[i * 3 + 1] += V[i * 3 + 1] * dt;
      P[i * 3 + 2] += V[i * 3 + 2] * dt + 90 * dt * 0.3; // le décor défile
      V[i * 3] *= 0.97; V[i * 3 + 1] *= 0.97; V[i * 3 + 2] *= 0.97;
      C[i * 3] = B[i * 3] * k; C[i * 3 + 1] = B[i * 3 + 1] * k; C[i * 3 + 2] = B[i * 3 + 2] * k;
    }
    this.particles.geometry.attributes.position.needsUpdate = true;
    this.particles.geometry.attributes.color.needsUpdate = true;
  }

  explode(pos, hex = 0xffa040) {
    const base = new THREE.Color(hex);
    const tmp = new THREE.Vector3();
    const cols = [base, new THREE.Color(0xffe066), new THREE.Color(0xff2bd6)];
    for (let i = 0; i < 90; i++) {
      tmp.randomDirection().multiplyScalar(10 + Math.random() * 45);
      this.emit(pos, tmp, cols[i % 3], 0.6 + Math.random() * 0.7);
    }
    // flash + onde de choc
    const fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffd0a0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    fl.position.copy(pos);
    this.scene.add(fl);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1.1, 40),
      new THREE.MeshBasicMaterial({ color: hex, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    );
    ring.position.copy(pos);
    ring.lookAt(this.camera.position);
    this.scene.add(ring);
    this.fx = this.fx || [];
    this.fx.push({ fl, ring, t: 0 });
  }

  updateFx(dt) {
    if (!this.fx) return;
    for (const f of this.fx) {
      f.t += dt;
      const k = f.t / 0.55;
      f.fl.scale.setScalar(4 + k * 26);
      f.fl.material.opacity = Math.max(0, 1 - k);
      f.ring.scale.setScalar(1 + k * 14);
      f.ring.material.opacity = Math.max(0, 1 - k);
      f.fl.position.z += 27 * dt;
      f.ring.position.z += 27 * dt;
    }
    this.fx = this.fx.filter((f) => {
      if (f.t < 0.55) return true;
      this.scene.remove(f.fl, f.ring);
      f.fl.material.dispose();
      f.ring.geometry.dispose();
      f.ring.material.dispose();
      return false;
    });
  }

  // ---------------------------------------------------------------
  //  HUD
  // ---------------------------------------------------------------
  bindHud() {
    this.rx = new RegexInput($('#rx'), $('#rx-hl'), (v) => this.onRegexChange(v));
    $('#rx').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.fire(); }
      else if (e.key.length === 1) sfx.key();
    });
    $('#btn-fire').addEventListener('click', () => this.fire());
    $('#btn-course').addEventListener('click', () => this.requestCourse());
    $('#btn-pause').addEventListener('click', () => this.pause());
    const kp = $('#keypad');
    for (const k of KEYS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'key';
      b.textContent = k;
      b.addEventListener('pointerdown', (e) => e.preventDefault()); // garde le focus sur l'input
      b.addEventListener('click', () => {
        const ins = { '[ ]': '[]', '( )': '()', '{ }': '{}' }[k] ?? k;
        this.rx.insert(ins);
        if (ins.length === 2 && '[({'.includes(ins[0])) {
          const el = $('#rx');
          el.setSelectionRange(el.selectionStart - 1, el.selectionStart - 1);
        }
      });
      kp.appendChild(b);
    }
    this.onKey = (e) => {
      if (this.app.active !== this) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (this.state === 'playing') this.pause();
        else if (this.state === 'paused' || this.state === 'course') this.resume();
      }
    };
    window.addEventListener('keydown', this.onKey);
    if (matchMedia('(max-width: 760px)').matches) $('#log').classList.add('mobile');
  }

  log(msg, kind = 'info') {
    const el = document.createElement('div');
    el.className = 'log-item ' + kind;
    el.textContent = msg;
    const box = $('#log');
    box.prepend(el);
    while (box.children.length > 4) box.lastChild.remove();
    setTimeout(() => el.remove(), 3300);
  }

  renderLives() {
    const max = this.cfg.livesPerSquadron;
    $('#hud-lives').innerHTML = Array.from({ length: max }, (_, i) => `<span class="${i < this.lives ? '' : 'lost'}">♥</span>`).join('');
  }
  renderScore() { $('#hud-score').textContent = String(Math.max(0, this.score)).padStart(5, '0'); }

  renderHudStatic() {
    const lv = this.level;
    $('#hud-squad').textContent = this.squad.name.split('—')[0].trim();
    $('#hud-level').textContent = `Niveau ${this.levelIdx + 1}/${this.squad.levels.length}`;
    $('#obj-notion').textContent = lv.notion;
    $('#obj-title').textContent = lv.title;
    $('#obj-text').textContent = lv.objective;
    $('#obj-mode').textContent = MODE_LABEL[lv.mode];
    const fl = $('#obj-flags');
    fl.hidden = !lv.flags;
    fl.textContent = lv.flags ? `Drapeau ${lv.flags} : insensible à la casse` : '';
    $('#rx-flags').textContent = lv.flags;
    this.renderLives();
    this.renderScore();
  }

  renderClock() {
    const t = Math.floor(this.levelTime);
    if (t === this.lastClock) return;
    this.lastClock = t;
    $('#hud-time').textContent = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    const g = $('#hud-grace');
    const left = Math.ceil(this.cfg.graceSeconds - this.levelTime);
    if (left > 0) {
      g.classList.remove('pressure');
      g.querySelector('.hud-value').textContent = `LIBRE ${left}s`;
      $('#btn-course').textContent = 'COURS';
    } else {
      if (!g.classList.contains('pressure')) this.log('Mode pression : le cours coûte désormais 1 ♥', 'bad');
      g.classList.add('pressure');
      g.querySelector('.hud-value').textContent = '−1 ♥';
      $('#btn-course').textContent = 'COURS −1♥';
    }
  }

  // ---------------------------------------------------------------
  //  CYCLE DE VIE : escadrille / niveau
  // ---------------------------------------------------------------
  start(squad) {
    this.squad = squad;
    this.levelIdx = 0;
    this.lives = this.cfg.livesPerSquadron;
    this.score = 0;
    this.startLevel();
  }

  startLevel() {
    this.clearField();
    const id = this.squad.levels[this.levelIdx];
    this.level = { id, ...this.app.data.levels[id] };
    const lv = this.level;
    const sol = compile(lv.solution, lv.flags);
    this.targets = shuffle(lv.targets).map((text) => {
      const s = evaluate(sol, text, lv.mode).value;
      return { text, sol: s, hostile: isMatch(s, lv.mode) };
    });
    this.queue = this.targets.slice();
    this.stats = { kills: 0, impacts: 0, iff: 0, wrong: 0, hostiles: this.targets.filter((t) => t.hostile).length, courseCost: 0 };
    this.levelTime = 0;
    this.lastClock = -1;
    this.spawnTimer = 1.2;
    this.committed = null;
    this.live = null;
    this.levelScore0 = this.score;
    this.rx.set('');
    this.onRegexChange('');
    this.renderHudStatic();
    this.renderClock();
    this.state = 'intro';
    this.showCourse({ intro: true });
  }

  begin() {
    closeModal();
    this.state = 'playing';
    sfx.open();
    $('#rx').focus({ preventScroll: true });
  }

  clearField() {
    for (const d of this.drones) this.removeDrone(d);
    for (const m of this.missiles) this.scene.remove(m.obj);
    this.drones = [];
    this.missiles = [];
    $('#radar').innerHTML = '';
  }

  // ---------------------------------------------------------------
  //  COURS / PAUSE  (fenêtre de grâce de 30 s, puis −1 vie)
  // ---------------------------------------------------------------
  inGrace() { return this.levelTime < this.cfg.graceSeconds; }

  requestCourse() {
    if (this.state !== 'playing' && this.state !== 'paused') return;
    if (!this.inGrace()) {
      if (this.lives <= 1) { toast('Dernière vie : le cours est verrouillé !'); sfx.error(); return; }
      this.loseLife('Consultation du cours', { silent: true });
      this.stats.courseCost++;
    }
    this.state = 'course';
    this.showCourse({});
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    const grace = this.inGrace();
    if (grace) { this.showCourse({ paused: true }); return; }
    openModal(`
      <div class="kicker">PAUSE</div>
      <h2>Vol suspendu</h2>
      <p>Le chrono est arrêté. La fenêtre de grâce est terminée : consulter le cours coûte <b>1 ♥</b>.</p>
      <div class="modal-actions">
        <button class="btn ghost" data-act="quit">Quitter la mission</button>
        <button class="btn pink" data-act="course" ${this.lives <= 1 ? 'disabled' : ''}>Voir le cours (−1 ♥)</button>
        <button class="btn" data-act="resume" data-autofocus>Reprendre</button>
      </div>`, { onMount: (el) => this.wireActions(el) });
  }

  resume() {
    closeModal();
    if (this.state === 'intro') { this.begin(); return; }
    this.state = 'playing';
    $('#rx').focus({ preventScroll: true });
  }

  wireActions(el) {
    el.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
      sfx.click();
      const a = b.dataset.act;
      if (a === 'resume') this.resume();
      else if (a === 'begin') this.begin();
      else if (a === 'course') { this.state = 'paused'; this.requestCourse(); }
      else if (a === 'quit') this.quit();
      else if (a === 'next') this.nextLevel();
      else if (a === 'restart') this.start(this.squad);
      else if (a === 'menu') this.app.openSquadrons();
    }));
    el.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      el.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('active', x === b));
      el.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.tab; });
    }));
  }

  showCourse({ intro = false, paused = false }) {
    const lv = this.level;
    const game = this.app.data.games.find((g) => g.id === 'jet');
    const all = game.squadrons.flatMap((s) => s.levels);
    const upto = all.slice(0, all.indexOf(lv.id) + 1).map((id) => ({ id, ...this.app.data.levels[id] }));
    const graceLeft = Math.ceil(this.cfg.graceSeconds - this.levelTime);
    const note = intro
      ? `<div class="grace-note">Après le décollage, tu as <b>${this.cfg.graceSeconds} s</b> pour revoir ce cours gratuitement (bouton COURS ou Échap). Ensuite, chaque consultation coûte <b>1 ♥</b>.</div>`
      : this.inGrace()
        ? `<div class="grace-note">Fenêtre de grâce : encore <b>${graceLeft} s</b> de consultation gratuite.</div>`
        : `<div class="grace-note cost">Consultation payée : −1 ♥. Le chrono est arrêté pendant la lecture.</div>`;
    openModal(`
      <div class="kicker">${intro ? 'BRIEFING' : paused ? 'PAUSE · COURS' : 'COURS'} · ${esc(this.squad.name)} · NIVEAU ${this.levelIdx + 1}</div>
      <h2>${esc(lv.title)}</h2>
      <div class="tabs">
        <button class="tab active" data-tab="card">Notion du niveau</button>
        <button class="tab" data-tab="memo">Mémo des notions (${upto.length})</button>
      </div>
      <div data-pane="card">
        ${courseCardHTML(lv)}
        <p style="margin:14px 0 0"><b>Mission :</b> ${esc(lv.objective)}</p>
      </div>
      <div data-pane="memo" hidden>${memoHTML(upto, lv.id)}</div>
      ${note}
      <div class="modal-actions">
        ${intro ? '<button class="btn ghost" data-act="quit">Retour</button>' : '<button class="btn ghost" data-act="quit">Quitter la mission</button>'}
        <button class="btn pink" data-act="${intro ? 'begin' : 'resume'}" data-autofocus>${intro ? 'DÉCOLLAGE ▶' : 'Reprendre le vol'}</button>
      </div>`, { onMount: (el) => this.wireActions(el) });
    sfx.open();
  }

  quit() {
    closeModal();
    this.state = 'idle';
    this.clearField();
    this.app.openSquadrons();
  }

  // ---------------------------------------------------------------
  //  REGEX : aperçu en direct + tir
  // ---------------------------------------------------------------
  onRegexChange(src) {
    const lv = this.level;
    if (!lv) return;
    const field = $('.rx-field');
    const info = $('#rx-info');
    const c = compile(src, lv.flags);
    this.live = c;
    field.classList.toggle('invalid', !c.ok && !c.empty);
    if (!c.ok && !c.empty) info.innerHTML = `<span class="err">⚠ ${esc(c.error)}</span>`;
    for (const d of this.drones) this.evalDrone(d);
    this.renderInfo();
  }

  renderInfo() {
    const c = this.live;
    if (!c || !c.ok) {
      if (c?.empty) $('#rx-info').innerHTML = 'Entrée = tirer · Échap = pause · les captures s\'affichent en direct sur le radar';
      return;
    }
    const counts = { locked: 0, wrong: 0, iff: 0 };
    for (const d of this.drones) counts[d.status] = (counts[d.status] ?? 0) + 1;
    const parts = [`<span class="ok">${counts.locked} verrouillée(s)</span>`];
    if (counts.wrong) parts.push(`<span class="bad">${counts.wrong} capture(s) fausse(s)</span>`);
    if (counts.iff) parts.push(`<span class="bad">${counts.iff} allié(s) visé(s) ⚠</span>`);
    if (this.committed) parts.push(`armé : /${patternHTML(this.committed.src)}/`);
    $('#rx-info').innerHTML = parts.join(' · ');
  }

  evalDrone(d) {
    const lv = this.level;
    const r = evaluate(this.live, d.target.text, lv.mode);
    const status = this.live?.ok ? classify(r.value, d.target.sol, lv.mode) : (d.target.hostile ? 'none' : 'clear');
    const key = status + '|' + JSON.stringify(r.spans);
    d.value = r.value;
    d.status = status;
    if (key === d.renderKey) return;
    d.renderKey = key;
    // étiquette 3D
    const { texture, aspect } = labelTexture(d.target.text, r.spans, status);
    d.label.material.map?.dispose();
    d.label.material.map = texture;
    d.label.material.needsUpdate = true;
    d.labelAspect = aspect;
    const hex = STATUS_HEX[status];
    d.core.material.emissive.setHex(hex);
    d.wire.material.color.setHex(hex);
    d.reticle.visible = status === 'locked' || status === 'wrong' || status === 'iff';
    d.reticle.material.color.setHex(hex);
    // radar HTML
    const cls = status === 'locked' ? 'hit-ok' : 'hit-bad';
    d.li.className = `radar-item ${status}${d.targeted ? ' targeted' : ''}`;
    d.li.querySelector('.rt').innerHTML = highlightHTML(d.target.text, r.spans, cls);
    const shown = this.live?.ok && isMatch(r.value, lv.mode) ? formatValue(r.value, lv.mode) : '—';
    d.li.querySelector('.rv').innerHTML = `<span>Capture : <b>${esc(shown)}</b></span><span class="rs">${STATUS_TXT[status]}</span>`;
  }

  fire() {
    if (this.state !== 'playing') return;
    const c = this.live;
    if (!c || !c.ok) {
      sfx.error();
      const f = $('.rx-field');
      f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake');
      return;
    }
    this.committed = c;
    let fired = 0, iff = 0, wrong = 0;
    for (const d of this.drones) {
      if (d.targeted || d.dead) continue;
      if (d.status === 'locked') { this.launch(d); fired++; }
      else if (d.status === 'iff') iff++;
      else if (d.status === 'wrong') wrong++;
    }
    if (fired) sfx.lock();
    if (wrong) {
      this.stats.wrong += wrong;
      this.score -= 20 * wrong;
      this.log(`${wrong} capture(s) incorrecte(s) : tir refusé (−${20 * wrong})`, 'bad');
    }
    if (iff) {
      this.stats.iff += iff;
      this.loseLife(`IFF : ${iff} balise(s) alliée(s) verrouillée(s) !`);
      sfx.iff();
    }
    if (!fired && !wrong && !iff) { this.log('Aucune cible verrouillée', 'info'); sfx.error(); }
    this.renderScore();
    this.renderInfo();
  }

  loseLife(reason, { silent = false } = {}) {
    this.lives--;
    this.renderLives();
    this.log(`−1 ♥ ${reason}`, 'bad');
    if (!silent) { flash('red'); this.shake = 1; }
    if (this.lives <= 0) this.gameOver();
  }

  // ---------------------------------------------------------------
  //  DRONES & MISSILES
  // ---------------------------------------------------------------
  spawnDrone(target) {
    const g = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(2, 0),
      new THREE.MeshStandardMaterial({ color: 0x150a2e, emissive: 0xffb000, emissiveIntensity: 0.55, flatShading: true, metalness: 0.5, roughness: 0.4 })
    );
    const wire = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(2.7, 0)),
      new THREE.LineBasicMaterial({ color: 0xffb000, toneMapped: false, fog: false })
    );
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.09, 6, 40), wire.material);
    ring.rotation.x = Math.PI / 2;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false, toneMapped: false, fog: false }));
    label.position.y = 5.2;
    label.renderOrder = 10;
    const reticle = new THREE.Sprite(new THREE.SpriteMaterial({ map: reticleTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    reticle.scale.setScalar(9);
    reticle.visible = false;
    g.add(core, wire, ring, label, reticle);

    // Couloirs répartis à l'écran : la cible arrive le long d'un rayon caméra
    const LANES = [[-0.45, 0.3], [-0.12, 0.36], [-0.32, 0.06], [0.02, 0.16], [-0.6, 0.12], [-0.2, 0.22], [0.06, 0.0]];
    const [lx, ly] = LANES[this.lane++ % LANES.length];
    const cam = this.camera;
    const origin = cam.position.clone();
    const dir = new THREE.Vector3(lx + (Math.random() - 0.5) * 0.08, ly + (Math.random() - 0.5) * 0.06, 0.5).unproject(cam).sub(origin).normalize();
    const start = origin.clone().addScaledVector(dir, this.cfg.spawnDistance);
    const end = origin.clone().addScaledVector(dir, this.cfg.impactDistance);
    g.position.copy(start);
    this.scene.add(g);

    const li = document.createElement('li');
    li.className = 'radar-item';
    li.innerHTML = '<div class="rt"></div><div class="rv"></div><div class="bar"></div>';
    $('#radar').appendChild(li);

    const d = {
      id: this.nextId++, target, obj: g, core, wire, ring, label, reticle, li, start, end,
      p: 0, spin: (Math.random() - 0.5) * 2, targeted: false, dead: false, renderKey: '', labelAspect: 4,
    };
    this.drones.push(d);
    this.evalDrone(d);

    // Regex déjà armée : verrouillage automatique des nouvelles cibles
    if (this.committed) {
      const r = evaluate(this.committed, target.text, this.level.mode);
      if (classify(r.value, target.sol, this.level.mode) === 'locked') {
        d.autoFire = 0.6; // délai de verrouillage (temps de jeu, donc figé en pause)
      }
    }
    this.renderInfo();
  }

  removeDrone(d) {
    d.dead = true;
    this.scene.remove(d.obj);
    d.obj.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && o.material !== this.particles.material) {
        if (o.material.map && o.material.map !== reticleTexture()) o.material.map.dispose();
        o.material.dispose();
      }
    });
    d.li.remove();
  }

  launch(d) {
    d.targeted = true;
    d.li.classList.add('targeted');
    const obj = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1.6, 6).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x2bff88, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    glow.scale.setScalar(3);
    obj.add(body, glow);
    const side = this.missiles.length % 2 ? 1 : -1;
    obj.position.set(this.jet.position.x + side * 2.5, this.jet.position.y - 0.4, this.jet.position.z);
    this.scene.add(obj);
    const vel = new THREE.Vector3(side * 12, 6, -60);
    this.missiles.push({ obj, target: d, vel, t: 0 });
    sfx.missile();
  }

  updateMissiles(dt) {
    const tmp = new THREE.Vector3();
    const trail = new THREE.Color(0x2bff88);
    for (const m of this.missiles) {
      m.t += dt;
      const tgt = m.target.obj.position;
      tmp.subVectors(tgt, m.obj.position);
      const dist = tmp.length();
      const speed = 240 + m.t * 260;
      tmp.normalize().multiplyScalar(speed);
      m.vel.lerp(tmp, Math.min(1, dt * (3 + m.t * 8)));
      m.obj.position.addScaledVector(m.vel, dt);
      m.obj.lookAt(tmp.copy(m.obj.position).add(m.vel));
      for (let k = 0; k < 2; k++) this.emit(m.obj.position, new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, 10), trail, 0.28);
      if (dist < 3.5 || m.t > 4) m.hit = true;
    }
    this.missiles = this.missiles.filter((m) => {
      if (!m.hit) return true;
      this.scene.remove(m.obj);
      const d = m.target;
      if (!d.dead) this.kill(d);
      return false;
    });
  }

  kill(d) {
    const pos = d.obj.position.clone();
    this.explode(pos, 0x2bff88);
    sfx.boom();
    const bonus = Math.round(100 * (1 - d.p));
    this.score += 100 + bonus;
    this.stats.kills++;
    this.renderScore();
    this.log(`Cible détruite +${100 + bonus}`, 'good');
    this.removeDrone(d);
  }

  updateDrones(dt) {
    const v = 1 / this.level.speed;
    for (const d of this.drones) {
      if (d.dead) continue;
      d.p += dt * v;
      const e = d.p;
      d.obj.position.lerpVectors(d.start, d.end, e);
      d.obj.position.x += Math.sin(this.t * 0.9 + d.id) * 4 * (1 - e);
      d.obj.position.y += Math.sin(this.t * 1.3 + d.id * 2) * 1.5;
      d.core.rotation.x += dt * d.spin;
      d.core.rotation.y += dt * 0.8;
      d.wire.rotation.y -= dt * 0.5;
      d.ring.rotation.z += dt * 1.5;
      d.reticle.material.rotation -= dt * 2;
      // taille à l'écran à peu près constante (lisible de loin), bornée en largeur
      const dist = d.obj.position.distanceTo(this.camera.position);
      const visW = 2 * dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.aspect;
      const h = Math.min(0.034 * dist + 1.2, (0.42 * visW) / d.labelAspect);
      const bodyScale = 1 + dist / 160;
      d.core.scale.setScalar(bodyScale);
      d.wire.scale.setScalar(bodyScale);
      d.ring.scale.setScalar(bodyScale);
      d.reticle.scale.setScalar(9 * bodyScale);
      d.label.scale.set(h * d.labelAspect, h, 1);
      d.label.position.y = 3.6 * bodyScale + h * 0.6;
      d.li.querySelector('.bar').style.width = `${(1 - e) * 100}%`;
      if (d.status === 'iff') d.core.material.emissiveIntensity = 0.4 + Math.abs(Math.sin(this.t * 10)) * 0.8;
      if (d.autoFire !== undefined && !d.targeted) {
        d.autoFire -= dt;
        if (d.autoFire <= 0) { sfx.lock(); this.launch(d); }
      }
      if (e >= 1 && !d.targeted) this.passDrone(d);
    }
    this.drones = this.drones.filter((d) => !d.dead);
  }

  passDrone(d) {
    const lv = this.level;
    if (d.target.hostile) {
      this.stats.impacts++;
      sfx.impact();
      this.explode(d.obj.position.clone(), 0xff3860);
      this.removeDrone(d);
      this.log(`Impact ! Attendu : ${formatValue(d.target.sol, lv.mode)}`, 'bad');
      this.loseLife('Drone hostile non intercepté');
    } else {
      this.score += 25;
      this.renderScore();
      sfx.pass();
      this.log('Balise alliée épargnée +25', 'good');
      this.removeDrone(d);
    }
  }

  // ---------------------------------------------------------------
  //  FIN DE NIVEAU
  // ---------------------------------------------------------------
  checkEnd() {
    if (this.queue.length || this.drones.length || this.missiles.length) return;
    this.completeLevel();
  }

  completeLevel() {
    this.state = 'done';
    sfx.levelUp();
    flash('green');
    const p = this.app.progress;
    const lvScore = this.score - this.levelScore0;
    p.best[this.level.id] = Math.max(p.best[this.level.id] ?? 0, lvScore);
    p.done[this.level.id] = true;
    const last = this.levelIdx >= this.squad.levels.length - 1;
    const game = this.app.data.games.find((g) => g.id === 'jet');
    const sIdx = game.squadrons.indexOf(this.squad);
    if (last) p.unlocked.jet = Math.max(p.unlocked.jet ?? 1, sIdx + 2);
    this.app.save();
    const st = this.stats;
    const lv = this.level;
    const mine = this.committed ? `/${patternHTML(this.committed.src)}/${esc(lv.flags)}` : '—';
    openModal(`
      <div class="kicker">${last ? 'ESCADRILLE TERMINÉE' : 'MISSION ACCOMPLIE'}</div>
      <h2>${esc(lv.title)} ✓</h2>
      <div class="stats">
        <div class="stat"><b>${st.kills}/${st.hostiles}</b><span>Cibles détruites</span></div>
        <div class="stat"><b>${st.impacts}</b><span>Impacts</span></div>
        <div class="stat"><b>${st.iff}</b><span>Erreurs IFF</span></div>
        <div class="stat"><b>${lvScore}</b><span>Points niveau</span></div>
      </div>
      <p>Ta dernière regex armée :</p>
      <div class="solution">${mine}</div>
      <p>Solution de référence :</p>
      <div class="solution">/${patternHTML(lv.solution)}/${esc(lv.flags)}</div>
      ${last && sIdx + 1 < game.squadrons.length ? `<div class="grace-note">Nouvelle escadrille débloquée : <b>${esc(game.squadrons[sIdx + 1].name)}</b></div>` : ''}
      ${last && sIdx + 1 >= game.squadrons.length ? '<div class="grace-note">Toutes les escadrilles sont terminées. Bravo, pilote !</div>' : ''}
      <div class="modal-actions">
        <button class="btn ghost" data-act="menu">Escadrilles</button>
        ${last ? '' : '<button class="btn pink" data-act="next" data-autofocus>Niveau suivant ▶</button>'}
      </div>`, { onMount: (el) => this.wireActions(el) });
  }

  nextLevel() {
    closeModal();
    this.levelIdx++;
    this.startLevel();
  }

  gameOver() {
    if (this.state === 'over') return;
    this.state = 'over';
    sfx.gameOver();
    openModal(`
      <div class="kicker">MISSION ÉCHOUÉE</div>
      <h2>Plus de vies</h2>
      <p>Ton appareil est hors de combat. Il faut recommencer la séquence de <b>${esc(this.squad.name)}</b> depuis le premier niveau.</p>
      <p>Notion du niveau : <code>${esc(this.level.notion)}</code> — solution possible : <span class="solution" style="display:inline-block">/${patternHTML(this.level.solution)}/${esc(this.level.flags)}</span></p>
      <div class="modal-actions">
        <button class="btn ghost" data-act="menu">Escadrilles</button>
        <button class="btn pink" data-act="restart" data-autofocus>Recommencer l'escadrille</button>
      </div>`, { onMount: (el) => this.wireActions(el) });
  }

  // ---------------------------------------------------------------
  //  BOUCLE PRINCIPALE
  // ---------------------------------------------------------------
  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.fov = this.camera.aspect < 1 ? 80 : 62;
    this.camera.updateProjectionMatrix();
  }

  enter() {}
  exit() { this.state = 'idle'; this.clearField(); }

  update(dt) {
    this.t += dt;
    const playing = this.state === 'playing';
    // décor : défile toujours (sauf pause) pour l'ambiance
    const flow = this.state === 'paused' || this.state === 'course' ? 0 : dt;
    this.gridMat.uniforms.uTime.value += flow;
    this.sunMat.uniforms.uTime.value += flow;
    for (const m of this.mountains) {
      m.position.z += 90 * flow * 0.6;
      if (m.position.z > 60) m.position.z -= 1080;
    }
    // jet : léger roulis
    this.jet.position.y = 4 + Math.sin(this.t * 1.4) * 0.35;
    this.jet.rotation.z = Math.sin(this.t * 0.7) * 0.08;
    this.jet.position.x = Math.sin(this.t * 0.5) * 1.2;
    const fl = 0.8 + Math.random() * 0.4;
    for (const f of this.flames) f.scale.set(fl, fl, 1);
    this.flameCone.scale.z = 0.8 + Math.random() * 0.4;

    if (playing) {
      this.levelTime += dt;
      this.renderClock();
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0 && this.queue.length) {
        this.spawnDrone(this.queue.shift());
        this.spawnTimer = this.level.spawnEvery;
      }
      this.updateDrones(dt);
      this.updateMissiles(dt);
      if (this.state === 'playing') this.checkEnd();
    }
    this.updateParticles(flow);
    this.updateFx(flow);

    // caméra + tremblement
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const s = this.shake * 0.9;
    this.camera.position.set(
      this.camBase.x + this.jet.position.x * 0.4 + (Math.random() - 0.5) * s,
      this.camBase.y + (Math.random() - 0.5) * s,
      this.camBase.z
    );
    this.camera.lookAt(this.jet.position.x * 0.3, 5, -60);
  }
}
