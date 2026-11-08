// Textures générées sur <canvas> : halo, réticule, étiquettes de cibles, écrans de bornes.
import * as THREE from 'three';
import { segments } from './regex-engine.js';

const MONO = '"JetBrains Mono", ui-monospace, Consolas, monospace';
const TITLE = '"Orbitron", "Segoe UI", sans-serif';

function canvasTex(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

let glowTex = null;
export function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  glowTex = canvasTex(c);
  return glowTex;
}

let reticleTex = null;
export function reticleTexture() {
  if (reticleTex) return reticleTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.strokeStyle = '#fff';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(128, 128, 92, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 10;
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    g.beginPath();
    g.arc(128, 128, 116, a - 0.3, a + 0.3);
    g.stroke();
  }
  g.lineWidth = 5;
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    g.beginPath();
    g.moveTo(128 + Math.cos(a) * 70, 128 + Math.sin(a) * 70);
    g.lineTo(128 + Math.cos(a) * 100, 128 + Math.sin(a) * 100);
    g.stroke();
  }
  reticleTex = canvasTex(c);
  return reticleTex;
}

const STATUS_COLOR = {
  neutral: '#ffb000', // en approche
  aim: '#00f0ff',     // sous le viseur
  locked: '#ff2bd6',  // missile en route
};

/**
 * Étiquette d'une cible : texte avec captures surlignées.
 * Retourne { texture, aspect }.
 */
export function labelTexture(text, spans, status) {
  const fontPx = 44;
  const pad = 22;
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = `600 ${fontPx}px ${MONO}`;
  const w = Math.ceil(g.measureText(text).width) + pad * 2;
  const h = fontPx + pad * 2;
  c.width = Math.min(4096, w);
  c.height = h;
  const col = STATUS_COLOR[status] ?? '#ffb000';
  // panneau
  g.fillStyle = 'rgba(6,0,24,0.82)';
  g.strokeStyle = col;
  g.lineWidth = status === 'neutral' ? 4 : 8;
  roundRect(g, 2, 2, c.width - 4, h - 4, 14);
  g.fill();
  g.stroke();
  // texte
  g.font = `600 ${fontPx}px ${MONO}`;
  g.textBaseline = 'middle';
  let x = pad;
  const hitBg = status === 'locked' ? 'rgba(43,255,136,.35)' : 'rgba(255,56,96,.4)';
  const hitFg = status === 'locked' ? '#c8ffe0' : '#ffd0da';
  for (const s of segments(text, spans)) {
    const sw = g.measureText(s.text).width;
    if (s.hit) {
      g.fillStyle = hitBg;
      g.fillRect(x - 2, pad - 6, sw + 4, fontPx + 12);
      g.fillStyle = hitFg;
    } else g.fillStyle = '#efeaff';
    g.fillText(s.text, x, h / 2 + 2);
    x += sw;
  }
  return { texture: canvasTex(c), aspect: c.width / h };
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Écran d'une borne d'arcade (redessiné pour l'animation). */
export function drawCabinetScreen(canvas, game, t, unlockedInfo) {
  const g = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, '#12002e');
  grd.addColorStop(1, '#05000f');
  g.fillStyle = grd;
  g.fillRect(0, 0, W, H);
  // grille synthwave
  g.strokeStyle = game.color + '55';
  g.lineWidth = 2;
  const hor = H * 0.62;
  for (let i = 0; i < 9; i++) {
    const y = hor + Math.pow((i + ((t * 0.6) % 1)) / 9, 2) * (H - hor);
    g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
  }
  for (let i = -8; i <= 8; i++) {
    g.beginPath(); g.moveTo(W / 2 + i * 14, hor); g.lineTo(W / 2 + i * 90, H); g.stroke();
  }
  // soleil
  const sg = g.createLinearGradient(0, hor - 110, 0, hor);
  sg.addColorStop(0, '#ffe066');
  sg.addColorStop(1, game.color);
  g.fillStyle = sg;
  g.beginPath(); g.arc(W / 2, hor, 100, Math.PI, 0); g.fill();
  g.fillStyle = '#0a0020';
  for (let i = 0; i < 5; i++) g.fillRect(W / 2 - 110, hor - 12 - i * 18, 220, 4 + i * 0.6);
  // titres
  g.textAlign = 'center';
  g.shadowColor = game.color;
  g.shadowBlur = 18;
  g.fillStyle = '#ffffff';
  g.font = `900 46px ${TITLE}`;
  g.fillText(game.title.toUpperCase(), W / 2, 70);
  g.font = `700 24px ${TITLE}`;
  g.fillStyle = game.color;
  g.fillText(game.subtitle.toUpperCase(), W / 2, 108);
  g.shadowBlur = 0;
  // statut
  g.font = `700 22px ${TITLE}`;
  const playable = game.status === 'playable';
  if (playable) {
    if (Math.floor(t * 2) % 2 === 0) {
      g.fillStyle = '#ffffff';
      g.fillText('▶ APPUIE POUR JOUER', W / 2, H - 26);
    }
    if (unlockedInfo) {
      g.font = `600 18px ${MONO}`;
      g.fillStyle = '#9a92c7';
      g.fillText(unlockedInfo, W / 2, 140);
    }
  } else {
    g.fillStyle = '#ffb000';
    g.fillText('EN DÉVELOPPEMENT', W / 2, H - 26);
  }
  // scanlines
  g.fillStyle = 'rgba(0,0,0,.18)';
  for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 2);
}

export function neonTextTexture(text, color, w = 1024, h = 192) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `900 ${Math.round(h * 0.55)}px ${TITLE}`;
  g.shadowColor = color;
  for (const blur of [40, 20, 8]) {
    g.shadowBlur = blur;
    g.fillStyle = color;
    g.fillText(text, w / 2, h / 2);
  }
  g.shadowBlur = 4;
  g.fillStyle = '#ffffff';
  g.fillText(text, w / 2, h / 2);
  return canvasTex(c);
}
