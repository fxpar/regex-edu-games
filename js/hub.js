// Hub : salle d'arcade néon en 3D avec une borne par mini-jeu.
import * as THREE from 'three';
import { drawCabinetScreen, neonTextTexture, glowTexture } from './textures.js';

export class HubScene {
  constructor(app) {
    this.app = app;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
    this.cabinets = [];
    this.pointer = new THREE.Vector2(9, 9);
    this.parallax = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();
    this.hovered = null;
    this.t = 0;
    this.build();
    this.onMove = this.onMove.bind(this);
    this.onClick = this.onClick.bind(this);
  }

  build() {
    const s = this.scene;
    s.background = new THREE.Color(0x07001a);
    s.fog = new THREE.FogExp2(0x07001a, 0.045);

    s.add(new THREE.HemisphereLight(0x6a4cff, 0x110022, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 0.5);
    key.position.set(2, 6, 6);
    s.add(key);

    // Sol : plaque sombre + grille néon
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.MeshStandardMaterial({ color: 0x0b0322, metalness: 0.7, roughness: 0.35 })
    );
    floor.rotation.x = -Math.PI / 2;
    s.add(floor);
    const grid = new THREE.GridHelper(80, 60, 0xff2bd6, 0x3d1470);
    grid.position.y = 0.01;
    s.add(grid);

    // Mur du fond avec enseigne
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 14), new THREE.MeshStandardMaterial({ color: 0x0a0220, roughness: 0.9 }));
    wall.position.set(0, 7, -6);
    s.add(wall);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 1.7),
      new THREE.MeshBasicMaterial({ map: neonTextTexture('REGEX ARCADE', '#ff2bd6'), transparent: true, toneMapped: false })
    );
    sign.position.set(0, 6.3, -5.9);
    s.add(sign);
    this.sign = sign;

    // Néons verticaux sur le mur
    const tube = new THREE.CylinderGeometry(0.04, 0.04, 6, 8);
    [-7, -5.4, 5.4, 7].forEach((x, i) => {
      const m = new THREE.Mesh(tube, new THREE.MeshBasicMaterial({ color: i % 2 ? 0x00f0ff : 0xff2bd6, toneMapped: false }));
      m.position.set(x, 3.5, -5.8);
      s.add(m);
    });

    // Bornes
    const games = this.app.data.games;
    const n = games.length;
    games.forEach((game, i) => {
      const x = (i - (n - 1) / 2) * 3.1;
      const cab = this.makeCabinet(game);
      cab.group.position.set(x, 0, -1.2 - Math.abs(i - (n - 1) / 2) * 0.5);
      cab.group.rotation.y = -(i - (n - 1) / 2) * 0.22;
      s.add(cab.group);
      this.cabinets.push(cab);
    });

    // Poussière lumineuse
    const N = 300;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 20;
      pos[i * 3 + 1] = Math.random() * 8;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 12;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.06, map: glowTexture(), color: 0x9d6bff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    s.add(this.dust);
  }

  makeCabinet(game) {
    const group = new THREE.Group();
    const color = new THREE.Color(game.color);
    const body = new THREE.MeshStandardMaterial({ color: 0x140a33, metalness: 0.4, roughness: 0.5 });
    const edgeMat = new THREE.LineBasicMaterial({ color, toneMapped: false });
    const add = (geo, mat, x, y, z, rx = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.x = rx;
      group.add(m);
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat);
      e.position.copy(m.position);
      e.rotation.copy(m.rotation);
      group.add(e);
      return m;
    };
    add(new THREE.BoxGeometry(2.1, 1.3, 1.3), body, 0, 0.65, 0);           // socle
    add(new THREE.BoxGeometry(2.1, 0.25, 0.9), body, 0, 1.38, 0.25, -0.35); // pupitre
    add(new THREE.BoxGeometry(2.1, 1.9, 0.9), body, 0, 2.45, -0.2);          // tête
    // marquee lumineux
    const marquee = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.4, 0.95), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
    marquee.position.set(0, 3.6, -0.18);
    group.add(marquee);
    // joystick + boutons
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.25), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    stick.position.set(-0.45, 1.6, 0.35);
    group.add(stick);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff2bd6, toneMapped: false }));
    ball.position.set(-0.45, 1.74, 0.35);
    group.add(ball);
    [0.15, 0.4, 0.65].forEach((x, k) => {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 16), new THREE.MeshBasicMaterial({ color: [0x00f0ff, 0xffb000, 0x2bff88][k], toneMapped: false }));
      b.position.set(x, 1.52, 0.3);
      b.rotation.x = -0.35;
      group.add(b);
    });
    // écran (texture canvas animée)
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 384;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.35), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    screen.position.set(0, 2.45, 0.26);
    group.add(screen);
    // halo au sol
    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 3),
      new THREE.MeshBasicMaterial({ map: glowTexture(), color, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.set(0, 0.02, 0.6);
    group.add(halo);
    const light = new THREE.PointLight(color, 4, 6, 1.6);
    light.position.set(0, 2.6, 1.4);
    group.add(light);

    group.userData.game = game;
    group.traverse((o) => { o.userData.cabinet = group; });
    return { group, game, canvas, tex, screen, halo, light, hover: 0 };
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    // en portrait on recule pour voir les 3 bornes
    this.baseZ = Math.max(8, 4.9 / (Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.aspect));
    // en portrait, on vise plus bas pour remonter les bornes au-dessus des cartes HTML
    this.lookY = this.camera.aspect < 1 ? -3 : 2.1;
    this.camera.updateProjectionMatrix();
  }

  enter() {
    const c = this.app.renderer.domElement;
    c.addEventListener('pointermove', this.onMove);
    c.addEventListener('click', this.onClick);
  }
  exit() {
    const c = this.app.renderer.domElement;
    c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('click', this.onClick);
    this.hovered = null;
    document.body.style.cursor = '';
  }

  onMove(e) {
    this.pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    this.parallax.copy(this.pointer);
  }

  pick() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.cabinets.map((c) => c.group), true);
    return hits.length ? hits[0].object.userData.cabinet : null;
  }

  onClick(e) {
    this.onMove(e);
    const g = this.pick();
    if (g) this.app.selectGame(g.userData.game.id);
  }

  setHover(gameId) {
    this.forcedHover = gameId;
  }

  update(dt) {
    this.t += dt;
    const cam = this.camera;
    const tx = this.parallax.x * 0.8 + Math.sin(this.t * 0.25) * 0.4;
    const ty = 2.6 + this.parallax.y * 0.3;
    cam.position.x += (tx - cam.position.x) * 0.05;
    cam.position.y += (ty - cam.position.y) * 0.05;
    cam.position.z = this.baseZ ?? 8;
    cam.lookAt(0, this.lookY ?? 2.1, -1);

    const g = this.pick();
    this.hovered = g;
    document.body.style.cursor = g ? 'pointer' : '';
    const prog = this.app.progress;
    for (const cab of this.cabinets) {
      const isHover = cab.group === g || this.forcedHover === cab.game.id;
      cab.hover += ((isHover ? 1 : 0) - cab.hover) * 0.15;
      cab.group.position.y = cab.hover * 0.12;
      cab.light.intensity = 3 + cab.hover * 6 + Math.sin(this.t * 3 + cab.group.position.x) * 0.5;
      cab.halo.material.opacity = 0.3 + cab.hover * 0.4;
      if (Math.floor(this.t * 20) !== cab.lastDraw) {
        cab.lastDraw = Math.floor(this.t * 20);
        const info = cab.game.status === 'playable' ? `Escadrille ${Math.min(prog.unlocked[cab.game.id] ?? 1, cab.game.squadrons.length)} / ${cab.game.squadrons.length} débloquée` : '';
        drawCabinetScreen(cab.canvas, cab.game, this.t + cab.group.position.x, info);
        cab.tex.needsUpdate = true;
      }
    }
    this.sign.material.opacity = Math.random() > 0.985 ? 0.4 : 1;
    this.dust.rotation.y += dt * 0.02;
    this.dust.position.y = Math.sin(this.t * 0.3) * 0.2;
  }
}
