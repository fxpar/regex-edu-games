// =============================================================
//  MACH-REGEX : Jet Interceptor
//  La regex est affichée dans le cockpit. Les drones portent des mots :
//  on tire sur ceux qui correspondent, on épargne les autres.
//  Boucle 3D, visée (souris / tactile / clavier), chrono de grâce et vies.
// =============================================================
import * as THREE from 'three';
import { glowTexture, reticleTexture, labelTexture } from './textures.js';
import { sfx } from './audio.js';
import { levelMatcher, buildWave, pace } from './missions.js';
import {
  $, esc, highlightHTML, patternHTML, MODE_INFO, regexHTML,
  openModal, closeModal, modalOpen, toast, flash, courseCardHTML, memoHTML,
} from './ui.js';

// Couloirs d'arrivée à l'écran (coordonnées normalisées -1..1), répartis pour éviter les panneaux du HUD
const LANES = [[-0.5, 0.3], [-0.12, 0.36], [0.2, 0.26], [-0.32, 0.08], [0.02, 0.16], [-0.62, 0.14], [0.28, 0.04], [-0.18, 0.0]];
const STATE_HEX = { neutral: 0xffb000, aim: 0x00f0ff, locked: 0xff2bd6 };

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
    this.pointer = null;   // position souris en pixels (null = hors du canvas)
    this.hover = null;     // drone sous la souris
    this.sel = null;       // drone choisi au clavier
    this.kbd = false;      // le joueur utilise le clavier
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
  //  HUD & COMMANDES
  // ---------------------------------------------------------------
  bindHud() {
    const hudBtn = (sel, fn) => $(sel).addEventListener('click', (e) => { e.currentTarget.blur(); fn(); });
    hudBtn('#btn-course', () => this.requestCourse());
    hudBtn('#btn-pause', () => this.pause());

    // Radar : cliquer une ligne = tirer sur ce drone (pratique au doigt)
    $('#radar').addEventListener('click', (e) => {
      const li = e.target.closest('[data-drone]');
      if (!li) return;
      li.blur();
      const d = this.drones.find((x) => x.id === +li.dataset.drone);
      if (d) this.fire(d);
    });
    $('#radar').addEventListener('pointerover', (e) => {
      const li = e.target.closest('[data-drone]');
      this.radarHover = li ? this.drones.find((x) => x.id === +li.dataset.drone) : null;
    });
    $('#radar').addEventListener('pointerleave', () => { this.radarHover = null; });

    // Souris / tactile sur la scène 3D
    this.onPointerMove = (e) => {
      this.pointer = { x: e.clientX, y: e.clientY };
      if (e.pointerType === 'mouse') this.kbd = false;
    };
    this.onPointerLeave = () => { this.pointer = null; };
    this.onPointerDown = (e) => {
      if (this.state !== 'playing') return;
      const slop = e.pointerType === 'touch' ? 34 : 10;
      const d = this.pick(e.clientX, e.clientY, slop);
      if (d) this.fire(d);
      else if (e.pointerType !== 'touch') this.dryFire();
    };

    // Clavier : ←/→ pour choisir, Espace/Entrée pour tirer, Échap pour la pause
    this.onKey = (e) => {
      if (this.app.active !== this) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (this.state === 'playing') this.pause();
        else if (this.state === 'paused' || this.state === 'course') this.resume();
        return;
      }
      if (this.state !== 'playing' || modalOpen()) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        this.kbd = true;
        this.cycle(e.key === 'ArrowRight' ? 1 : -1);
      } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        this.kbd = true;
        if (this.sel && this.alive(this.sel)) this.fire(this.sel);
        else this.cycle(0);
      }
    };
    window.addEventListener('keydown', this.onKey);
  }

  log(html, kind = 'info', ms = 3300) {
    const el = document.createElement('div');
    el.className = 'log-item ' + kind;
    el.style.animationDuration = `${ms}ms`;
    el.innerHTML = html;
    const box = $('#log');
    box.prepend(el);
    while (box.children.length > 4) box.lastChild.remove();
    setTimeout(() => el.remove(), ms);
  }

  wordHTML(mot, withHit = false) {
    const spans = withHit ? this.matcher.spans(mot) : [];
    return `<span class="w">${highlightHTML(mot, spans)}</span>`;
  }

  renderLives() {
    const max = this.cfg.livesPerSquadron;
    $('#hud-lives').innerHTML = Array.from({ length: max }, (_, i) => `<span class="${i < this.lives ? '' : 'lost'}">♥</span>`).join('');
  }
  renderScore() { $('#hud-score').textContent = String(Math.max(0, this.score)).padStart(5, '0'); }

  renderHudStatic() {
    const lv = this.level;
    const mi = MODE_INFO[lv.mode];
    $('#hud-squad').textContent = this.squad.name.split('—')[0].trim();
    $('#hud-level').textContent = `Niveau ${this.levelIdx + 1}/${this.squad.levels.length}`;
    $('#obj-notion').textContent = lv.notion;
    $('#obj-text').innerHTML = `Tire sur les mots qui <b>correspondent</b> à la regex, épargne les autres. ${esc(mi.help)}`;
    $('#ck-regex').innerHTML = regexHTML(lv.regex, lv.flags);
    $('#ck-mode').textContent = mi.label;
    $('#ck-mode').title = mi.help;
    $('#ck-mode').className = `badge mode-${lv.mode}`;
    const fl = $('#ck-flags');
    fl.hidden = !lv.flags;
    fl.textContent = lv.flags.includes('i') ? 'i : casse ignorée' : lv.flags;
    this.renderLives();
    this.renderScore();
    this.renderRadarHead();
  }

  renderRadarHead() {
    const left = this.queue ? this.queue.length + this.drones.length : 0;
    $('#radar-count').textContent = left ? `${left} restant${left > 1 ? 's' : ''}` : '';
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
      if (!g.classList.contains('pressure')) this.log('Le cours coûte désormais 1 ♥', 'bad');
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
    this.level = this.app.data.levels[id];
    this.matcher = levelMatcher(this.level);
    this.queue = buildWave(this.level);
    this.waveSize = this.queue.length;
    const nT = this.queue.filter((t) => t.hostile).length;
    this.stats = { hits: 0, targets: nT, spared: 0, traps: this.waveSize - nT, courseCost: 0 };
    this.errors = [];
    this.levelTime = 0;
    this.lastClock = -1;
    this.spawnTimer = 1.2;
    this.levelScore0 = this.score;
    this.sel = null;
    this.hover = null;
    $('#log').innerHTML = '';
    this.renderHudStatic();
    this.renderClock();
    this.state = 'intro';
    this.showCourse({ intro: true });
  }

  begin() {
    closeModal();
    this.state = 'playing';
    document.activeElement?.blur?.();
    sfx.open();
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
    if (this.inGrace()) { this.showCourse({ paused: true }); return; }
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
    document.activeElement?.blur?.();
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
      else if (a === 'retry') { closeModal(); this.startLevel(); }
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
    const all = Object.values(this.app.data.levels).sort((a, b) => a.global - b.global);
    const upto = all.filter((l) => l.global <= lv.global);
    const graceLeft = Math.ceil(this.cfg.graceSeconds - this.levelTime);
    const note = intro
      ? `<div class="grace-note">Après le décollage, tu as <b>${this.cfg.graceSeconds} s</b> pour revoir ce cours gratuitement (bouton COURS ou Échap). Ensuite, chaque consultation coûte <b>1 ♥</b>.</div>`
      : this.inGrace()
        ? `<div class="grace-note">Fenêtre de grâce : encore <b>${graceLeft} s</b> de consultation gratuite.</div>`
        : '<div class="grace-note cost">Consultation payée : −1 ♥. Le chrono est arrêté pendant la lecture.</div>';
    const controls = intro
      ? `<div class="controls-note"><b>Viser :</b> clique ou touche un drone (ou sa ligne dans le radar).
         Au clavier : <kbd>←</kbd> <kbd>→</kbd> pour choisir, <kbd>Espace</kbd> pour tirer.
         Un piège touché ou une cible manquée coûte <b>1 ♥</b>.</div>`
      : '';
    openModal(`
      <div class="kicker">${intro ? 'BRIEFING' : paused ? 'PAUSE · COURS' : 'COURS'} · ${esc(this.squad.name)} · NIVEAU ${this.levelIdx + 1}/${this.squad.levels.length}</div>
      <div class="tabs">
        <button class="tab active" data-tab="card">Notion du niveau</button>
        <button class="tab" data-tab="memo">Mémo (${upto.length})</button>
      </div>
      <div data-pane="card">${courseCardHTML(lv, this.matcher)}</div>
      <div data-pane="memo" hidden>${memoHTML(upto, lv.id)}</div>
      ${controls}
      ${note}
      <div class="modal-actions">
        <button class="btn ghost" data-act="quit">${intro ? 'Retour' : 'Quitter la mission'}</button>
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
  //  VISÉE
  // ---------------------------------------------------------------
  alive(d) { return d && !d.dead && !d.targeted; }

  /** Position écran (pixels) d'un point 3D. */
  toScreen(v) {
    const p = v.clone().project(this.camera);
    return { x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight, front: p.z < 1 };
  }

  /** Drone sous le point (x, y) : étiquette ou corps, avec une marge en pixels. */
  pick(x, y, slop = 10) {
    let best = null;
    const tanH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    for (const d of this.drones) {
      if (!this.alive(d)) continue;
      const dist = d.obj.position.distanceTo(this.camera.position);
      const ppu = innerHeight / (2 * dist * tanH); // pixels par unité à cette distance
      const lab = this.toScreen(d.obj.position.clone().add(new THREE.Vector3(0, d.label.position.y, 0)));
      const body = this.toScreen(d.obj.position);
      if (!lab.front) continue;
      const w = (d.label.scale.x * ppu) / 2 + slop;
      const h = (d.label.scale.y * ppu) / 2 + slop;
      const r = 3.4 * d.core.scale.x * ppu + slop;
      const onLabel = Math.abs(x - lab.x) < w && Math.abs(y - lab.y) < h;
      const onBody = Math.hypot(x - body.x, y - body.y) < r;
      if ((onLabel || onBody) && (!best || d.p > best.p)) best = d;
    }
    return best;
  }

  /** Choix au clavier : ←/→ parcourt les drones de gauche à droite. */
  cycle(dir) {
    const list = this.drones.filter((d) => this.alive(d));
    if (!list.length) { this.sel = null; return; }
    if (!this.alive(this.sel) || dir === 0) {
      this.sel = list.reduce((a, b) => (b.p > a.p ? b : a)); // le plus proche
    } else {
      const xs = list.map((d) => ({ d, x: this.toScreen(d.obj.position).x })).sort((a, b) => a.x - b.x);
      const i = xs.findIndex((o) => o.d === this.sel);
      this.sel = xs[(i + dir + xs.length) % xs.length].d;
    }
    sfx.key();
  }

  dryFire() {
    sfx.error();
  }

  fire(d) {
    if (this.state !== 'playing' || !this.alive(d)) return;
    sfx.lock();
    this.launch(d);
    if (this.sel === d) this.sel = null;
  }

  loseLife(reason, { silent = false } = {}) {
    this.lives--;
    this.renderLives();
    if (!silent) { flash('red'); this.shake = 1; }
    if (reason && silent) this.log(`−1 ♥ ${esc(reason)}`, 'bad');
    if (this.lives <= 0) this.gameOver();
  }

  // ---------------------------------------------------------------
  //  DRONES & MISSILES
  // ---------------------------------------------------------------
  spawnDrone(item, travel) {
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

    // la cible arrive le long d'un rayon caméra, dans un couloir de l'écran
    const [lx, ly] = LANES[this.lane++ % LANES.length];
    const cam = this.camera;
    const origin = cam.position.clone();
    const dir = new THREE.Vector3(lx + (Math.random() - 0.5) * 0.06, ly + (Math.random() - 0.5) * 0.05, 0.5).unproject(cam).sub(origin).normalize();
    const start = origin.clone().addScaledVector(dir, this.cfg.spawnDistance);
    const end = origin.clone().addScaledVector(dir, this.cfg.impactDistance);
    g.position.copy(start);
    this.scene.add(g);

    const li = document.createElement('li');
    li.className = 'radar-item';
    const id = this.nextId++;
    li.dataset.drone = id;
    li.tabIndex = -1;
    li.innerHTML = `<div class="rt">${highlightHTML(item.mot, [])}</div><div class="bar"></div>`;
    $('#radar').appendChild(li);

    const d = {
      id, item, obj: g, core, wire, ring, label, reticle, li, start, end, travel,
      p: 0, spin: (Math.random() - 0.5) * 2, targeted: false, dead: false, look: '', labelAspect: 4,
    };
    this.drones.push(d);
    this.setLook(d, 'neutral');
  }

  /** Apparence d'un drone : neutre (ambre), visé (cyan), missile en route (rose). */
  setLook(d, look) {
    if (d.look === look) return;
    d.look = look;
    const { texture, aspect } = labelTexture(d.item.mot, [], look);
    d.label.material.map?.dispose();
    d.label.material.map = texture;
    d.label.material.needsUpdate = true;
    d.labelAspect = aspect;
    const hex = STATE_HEX[look];
    d.core.material.emissive.setHex(hex);
    d.wire.material.color.setHex(hex);
    d.reticle.visible = look !== 'neutral';
    d.reticle.material.color.setHex(hex);
    d.li.classList.toggle('aim', look === 'aim');
    d.li.classList.toggle('targeted', look === 'locked');
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
    if (this.sel === d) this.sel = null;
    if (this.hover === d) this.hover = null;
  }

  launch(d) {
    d.targeted = true;
    this.setLook(d, 'locked');
    const obj = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 1.6, 6).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff2bd6, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
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
    const trail = new THREE.Color(0xff2bd6);
    for (const m of this.missiles) {
      m.t += dt;
      const tgt = m.target.obj.position;
      tmp.subVectors(tgt, m.obj.position);
      const dist = tmp.length();
      const speed = 260 + m.t * 300;
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
      if (!m.target.dead) this.resolveShot(m.target);
      return false;
    });
  }

  /** Le missile atteint le drone : cible -> détruite ; piège -> erreur, −1 vie. */
  resolveShot(d) {
    const pos = d.obj.position.clone();
    const { mot, hostile, raison } = d.item;
    if (hostile) {
      this.explode(pos, 0x2bff88);
      sfx.boom();
      const pts = 100 + Math.round(100 * (1 - d.p));
      this.score += pts;
      this.stats.hits++;
      this.log(`✓ ${this.wordHTML(mot, true)} correspond · +${pts}`, 'good');
    } else {
      this.explode(pos, 0xff3860);
      sfx.iff();
      this.errors.push({ kind: 'shot', mot, raison });
      this.log(`✗ ${this.wordHTML(mot)} ne correspond pas<small>${esc(raison)}</small>`, 'bad', 5200);
      this.loseLife();
    }
    this.renderScore();
    this.removeDrone(d);
    this.renderRadarHead();
  }

  /** Le drone arrive sur le jet sans avoir été visé. */
  passDrone(d) {
    const { mot, hostile, raison } = d.item;
    if (hostile) {
      sfx.impact();
      this.explode(d.obj.position.clone(), 0xff3860);
      this.errors.push({ kind: 'missed', mot });
      this.log(`✗ ${this.wordHTML(mot, true)} correspondait : il fallait tirer`, 'bad', 5200);
      this.removeDrone(d);
      this.loseLife();
    } else {
      this.score += 25;
      this.stats.spared++;
      sfx.pass();
      this.log(`✓ ${this.wordHTML(mot)} épargné · +25<small>${esc(raison)}</small>`, 'good', 3800);
      this.removeDrone(d);
    }
    this.renderScore();
    this.renderRadarHead();
  }

  updateDrones(dt) {
    // visée : souris (survol) ou clavier (sélection)
    if (this.kbd && !this.alive(this.sel)) this.cycle(0);
    this.hover = this.pointer && !this.kbd ? this.pick(this.pointer.x, this.pointer.y) : null;
    const aimed = this.kbd ? this.sel : this.radarHover && this.alive(this.radarHover) ? this.radarHover : this.hover;
    this.app.renderer.domElement.style.cursor = this.hover ? 'pointer' : 'crosshair';

    for (const d of this.drones) {
      if (d.dead) continue;
      d.p += dt / d.travel;
      const e = d.p;
      d.obj.position.lerpVectors(d.start, d.end, e);
      d.obj.position.x += Math.sin(this.t * 0.9 + d.id) * 4 * (1 - e);
      d.obj.position.y += Math.sin(this.t * 1.3 + d.id * 2) * 1.5;
      d.core.rotation.x += dt * d.spin;
      d.core.rotation.y += dt * 0.8;
      d.wire.rotation.y -= dt * 0.5;
      d.ring.rotation.z += dt * 1.5;
      d.reticle.material.rotation -= dt * 2;
      if (!d.targeted) this.setLook(d, d === aimed ? 'aim' : 'neutral');
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
      d.li.classList.toggle('urgent', e > 0.75);
      if (e >= 1 && !d.targeted) this.passDrone(d);
      if (this.state !== 'playing') break;
    }
    this.drones = this.drones.filter((d) => !d.dead);
  }

  spawnNext() {
    const q = 1 - this.queue.length / this.waveSize;
    const p = pace(this.level, q);
    this.spawnDrone(this.queue.shift(), p.travel);
    // en fin de niveau, les drones arrivent parfois par deux
    if (this.queue.length && Math.random() < p.double) this.spawnDrone(this.queue.shift(), p.travel * 1.05);
    this.spawnTimer = p.spawnEvery;
    this.renderRadarHead();
  }

  // ---------------------------------------------------------------
  //  FIN DE NIVEAU
  // ---------------------------------------------------------------
  checkEnd() {
    if (this.queue.length || this.drones.length || this.missiles.length) return;
    this.completeLevel();
  }

  errorsHTML() {
    if (!this.errors.length) return '<div class="grace-note">Sans faute : aucun piège touché, aucune cible manquée.</div>';
    return `<p>Tes erreurs :</p><ul class="errors">${this.errors.map((e) => (e.kind === 'shot'
      ? `<li><span class="tag bad">PIÈGE TOUCHÉ</span>${this.wordHTML(e.mot)}<span class="why">${esc(e.raison)}</span></li>`
      : `<li><span class="tag warn">CIBLE MANQUÉE</span>${this.wordHTML(e.mot, true)}<span class="why">Ce mot correspondait à la regex.</span></li>`)).join('')}</ul>`;
  }

  completeLevel() {
    this.state = 'done';
    sfx.levelUp();
    flash('green');
    const p = this.app.progress;
    const lv = this.level;
    const lvScore = this.score - this.levelScore0;
    p.best[lv.id] = Math.max(p.best[lv.id] ?? 0, lvScore);
    p.done[lv.id] = true;
    const last = this.levelIdx >= this.squad.levels.length - 1;
    const squads = this.app.data.games.find((g) => g.id === 'jet').squadrons;
    const sIdx = squads.indexOf(this.squad);
    if (last) p.unlocked.jet = Math.max(p.unlocked.jet ?? 1, sIdx + 2);
    this.app.save();
    // niveau sans faute : une vie regagnée
    const perfect = !this.errors.length;
    const bonusLife = perfect && this.lives < this.cfg.livesPerSquadron;
    if (bonusLife) { this.lives++; this.renderLives(); }
    const st = this.stats;
    openModal(`
      <div class="kicker">${last ? 'ESCADRILLE TERMINÉE' : 'MISSION ACCOMPLIE'} · ${esc(lv.notion)}</div>
      <h2>${regexHTML(lv.regex, lv.flags)} ✓</h2>
      <div class="stats">
        <div class="stat"><b>${st.hits}/${st.targets}</b><span>Cibles détruites</span></div>
        <div class="stat"><b>${st.spared}/${st.traps}</b><span>Pièges épargnés</span></div>
        <div class="stat"><b>${this.errors.length}</b><span>Erreurs</span></div>
        <div class="stat"><b>${lvScore}</b><span>Points</span></div>
      </div>
      ${this.errorsHTML()}
      ${bonusLife ? '<div class="grace-note">Niveau sans faute : <b>+1 ♥</b></div>' : ''}
      ${last && sIdx + 1 < squads.length ? `<div class="grace-note">Nouvelle escadrille débloquée : <b>${esc(squads[sIdx + 1].name)}</b></div>` : ''}
      ${last && sIdx + 1 >= squads.length ? '<div class="grace-note">Toutes les escadrilles sont terminées. Bravo, pilote !</div>' : ''}
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
      <div class="kicker">MISSION ÉCHOUÉE · ${esc(this.level.notion)}</div>
      <h2>Plus de vies</h2>
      <p>Ton appareil est hors de combat. Il faut recommencer <b>${esc(this.squad.name)}</b> depuis le premier niveau.</p>
      <p>Regex du niveau : <span class="solution" style="display:inline-block">${regexHTML(this.level.regex, this.level.flags)}</span></p>
      ${this.errorsHTML()}
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

  enter() {
    const c = this.app.renderer.domElement;
    c.addEventListener('pointermove', this.onPointerMove);
    c.addEventListener('pointerleave', this.onPointerLeave);
    c.addEventListener('pointerdown', this.onPointerDown);
  }

  exit() {
    this.state = 'idle';
    this.clearField();
    const c = this.app.renderer.domElement;
    c.removeEventListener('pointermove', this.onPointerMove);
    c.removeEventListener('pointerleave', this.onPointerLeave);
    c.removeEventListener('pointerdown', this.onPointerDown);
    c.style.cursor = '';
  }

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
      if (this.spawnTimer <= 0 && this.queue.length) this.spawnNext();
      this.updateDrones(dt);
      if (this.state === 'playing') this.updateMissiles(dt);
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
