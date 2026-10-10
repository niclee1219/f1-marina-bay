// Trackside sponsor boards drawn to a canvas atlas from config.SPONSORS. Each board shows the
// brand's logo file (assets/logos/<logo>.svg, see scripts/fetch_logos.py) on its usual background
// colour, scaled to fit without stretching. A brand whose file is missing or fails to load falls
// back to a simplified text wordmark.
import * as THREE from 'three';
import { SPONSORS } from './config.js';

export const COLS = 4;
export const CELL_W = 512, CELL_H = 128;
export const COUNT = SPONSORS.length;
export const ROWS = Math.ceil(COUNT / COLS);

const FONTS = { sans: '"Titillium Web", system-ui, sans-serif', serif: '"Cinzel", "Times New Roman", serif' };

function fitFont(c, s, text, maxW, size) {
  const fam = FONTS[s.font] || s.font;
  for (; size > 10; size -= 2) {
    c.font = `${s.italic ? 'italic ' : ''}${s.weight || 700} ${size}px ${fam}`;
    if ('letterSpacing' in c) c.letterSpacing = `${(s.tracking || 0) * size}px`;
    if (c.measureText(text).width <= maxW) break;
  }
  return size;
}

// Vector marks, drawn in a cell-local frame (w x h) before / after the word.
const MARKS = {
  // stylised bird in flight: two gold wing sweeps
  'sia-bird'(c, s, x, y, h) {
    c.strokeStyle = s.fg; c.lineWidth = h * 0.06; c.lineCap = 'round';
    c.beginPath(); c.moveTo(x, y + h * 0.1); c.quadraticCurveTo(x + h * 0.35, y - h * 0.25, x + h * 0.8, y - h * 0.05); c.stroke();
    c.beginPath(); c.moveTo(x + h * 0.15, y + h * 0.18); c.quadraticCurveTo(x + h * 0.45, y - h * 0.05, x + h * 0.78, y + h * 0.08); c.stroke();
    return h * 0.95;
  },
  // five-point crown
  crown(c, s, x, y, h) {
    const w = h * 0.7, b = y + h * 0.22, t = y - h * 0.22;
    c.fillStyle = s.fg; c.beginPath(); c.moveTo(x, b);
    for (let i = 0; i <= 4; i++) {
      const px = x + (i / 4) * w;
      c.lineTo(px, t + (i % 2 ? h * 0.08 : 0)); c.lineTo(px + (i < 4 ? w / 8 : 0), b - h * 0.14);
    }
    c.lineTo(x + w, b); c.closePath(); c.fill();
    for (let i = 0; i <= 4; i++) { c.beginPath(); c.arc(x + (i / 4) * w, t - h * 0.04, h * 0.045, 0, Math.PI * 2); c.fill(); }
    return w + h * 0.25;
  },
  // blue/green four-point star burst
  'aramco-star'(c, s, x, y, h) {
    const r = h * 0.3, cx = x + r, cy = y;
    const cols = ['#00a3e0', '#84bd00', '#00843d', '#00a3e0'];
    for (let i = 0; i < 4; i++) {
      c.fillStyle = cols[i];
      c.beginPath(); c.moveTo(cx, cy);
      const a = i * Math.PI / 2;
      c.quadraticCurveTo(cx + Math.cos(a + 0.6) * r * 0.5, cy + Math.sin(a + 0.6) * r * 0.5, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      c.quadraticCurveTo(cx + Math.cos(a - 0.2) * r * 0.4, cy + Math.sin(a - 0.2) * r * 0.4, cx, cy);
      c.fill();
    }
    return r * 2 + h * 0.18;
  },
  'red-star'(c, s, x, y, h) {
    const r = h * 0.26, cx = x + r, cy = y;
    c.fillStyle = '#e4002b'; c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.42 : r;
      c.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    c.closePath(); c.fill();
    return r * 2 + h * 0.15;
  },
  ellipse(c, s, x, y, h, w) {
    c.strokeStyle = s.fg; c.lineWidth = h * 0.035;
    c.beginPath(); c.ellipse(x + w / 2, y, w * 0.28, h * 0.36, 0, 0, Math.PI * 2); c.stroke();
    return 0;
  },
  cloud(c, s, x, y, h, w) {
    const cx = x + w / 2, r = h * 0.4, sx = 1.55;
    c.fillStyle = s.cloud;
    // overlapping puffs, stretched sideways so the word fits inside
    for (const [ox, oy, rr] of [[-1.35, 0.2, 0.75], [-0.45, -0.35, 0.95], [0.65, -0.15, 0.85], [1.45, 0.3, 0.65], [0, 0.35, 0.8], [-0.9, 0.4, 0.6], [0.9, 0.4, 0.6]]) {
      c.beginPath(); c.ellipse(cx + ox * r * sx, y + oy * r, rr * r * sx, rr * r, 0, 0, Math.PI * 2); c.fill();
    }
    return 0;
  },
};

// Drawn after the word (needs its measured extent).
const AFTER = {
  smile(c, s, x0, x1, y, h) {
    c.strokeStyle = '#ff9900'; c.lineWidth = h * 0.06; c.lineCap = 'round';
    const y1 = y + h * 0.3;
    c.beginPath(); c.moveTo(x0 + (x1 - x0) * 0.08, y1); c.quadraticCurveTo((x0 + x1) / 2, y1 + h * 0.2, x1 - (x1 - x0) * 0.08, y1 - h * 0.02); c.stroke();
    c.beginPath(); c.moveTo(x1 - (x1 - x0) * 0.2, y1 - h * 0.06); c.lineTo(x1 - (x1 - x0) * 0.05, y1 - h * 0.03); c.lineTo(x1 - (x1 - x0) * 0.11, y1 + h * 0.1); c.stroke();
  },
  'speed-lines'(c, s, x0, x1, y, h) {
    c.fillStyle = s.fg;
    for (let i = 0; i < 3; i++) c.fillRect(x0 - h * (0.9 - i * 0.12), y - h * 0.18 + i * h * 0.15, h * (0.7 - i * 0.12), h * 0.06);
    for (let i = 0; i < 3; i++) c.fillRect(x1 + h * 0.15, y - h * 0.18 + i * h * 0.15, h * (0.7 - i * 0.12), h * 0.06);
  },
  // the "long P": the bowl's stem runs on under the rest of the word
  'long-p'(c, s, x0, x1, y, h) {
    c.fillStyle = s.fg;
    c.fillRect(x0 + h * 0.02, y + h * 0.26, x1 - x0, h * 0.06);
  },
  lv(c, s, x0, x1, y, h) {
    c.fillStyle = s.fg; c.font = `700 ${h * 0.3}px "Cinzel", serif`;
    if ('letterSpacing' in c) c.letterSpacing = '0px';
    c.textAlign = 'center'; c.fillText('LV', (x0 + x1) / 2, y - h * 0.3);
  },
};

const LOGOS = new Map();   // sponsor name -> loaded Image

// Preload every configured logo before the atlas is drawn. Resolves even when some fail.
export async function loadLogos() {
  await Promise.all(SPONSORS.filter(s => s.logo).map(s => new Promise(resolve => {
    const img = new Image();
    img.onload = () => { if (img.naturalWidth) LOGOS.set(s.name, img); resolve(); };
    img.onerror = () => { console.warn(`sponsor logo missing: ${s.logo}.svg (using wordmark)`); resolve(); };
    img.src = `assets/logos/${s.logo}.svg`;
  })));
  return [...LOGOS.keys()];
}

// Logo fitted into the board's safe area, aspect ratio preserved. `logoTint` recolours a one-colour
// logo (the brand's reverse version) for contrast on a coloured board.
function drawLogo(c, s, img, x, y, w, h) {
  const fw = w * (s.logoFill || 0.82), fh = h * (s.logoHeight || 0.62);
  const ar = img.naturalWidth / img.naturalHeight;
  const dw = Math.min(fw, fh * ar), dh = dw / ar;
  const dx = x + (w - dw) / 2, dy = y + (h - dh) / 2;
  if (!s.logoTint) { c.drawImage(img, dx, dy, dw, dh); return; }
  const t = document.createElement('canvas');
  t.width = Math.ceil(dw * 2); t.height = Math.ceil(dh * 2);
  const tc = t.getContext('2d');
  tc.drawImage(img, 0, 0, t.width, t.height);
  tc.globalCompositeOperation = 'source-in';
  tc.fillStyle = s.logoTint; tc.fillRect(0, 0, t.width, t.height);
  c.drawImage(t, dx, dy, dw, dh);
}

function drawBoard(c, s, x, y, w, h) {
  c.save();
  c.beginPath(); c.rect(x, y, w, h); c.clip();
  c.fillStyle = s.bg; c.fillRect(x, y, w, h);
  // subtle top sheen and a dark seam so neighbouring boards read as separate panels
  const g = c.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, 'rgba(255,255,255,0.10)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.12)');
  c.fillStyle = g; c.fillRect(x, y, w, h);
  const img = LOGOS.get(s.name);
  if (img) {
    drawLogo(c, s, img, x, y, w, h);
    c.restore();
    c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(x + w - 3, y, 3, h);
    return;
  }
  const cy = y + h / 2 + (s.mark === 'lv' ? h * 0.1 : 0);
  let lead = 0;
  if (MARKS[s.mark]) {
    const behind = s.mark === 'ellipse' || s.mark === 'cloud';
    if (behind) MARKS[s.mark](c, s, x, cy, h, w);
  }
  const markFirst = MARKS[s.mark] && !(s.mark === 'ellipse' || s.mark === 'cloud');
  // measure the mark width without drawing (draw off-canvas)
  if (markFirst) { c.save(); c.translate(-99999, 0); lead = MARKS[s.mark](c, s, 0, 0, h * 0.7); c.restore(); }
  const maxW = w * (s.mark === 'cloud' ? 0.62 : 0.86) - lead;
  const size = fitFont(c, s, s.text, maxW, s.mark === 'lv' ? h * 0.36 : h * 0.62);
  const tw = c.measureText(s.text).width;
  const x0 = x + (w - tw - lead) / 2;
  if (markFirst) MARKS[s.mark](c, s, x0, cy, h * 0.7);
  c.fillStyle = s.fg;
  c.textAlign = 'left'; c.textBaseline = 'middle';
  c.fillText(s.text, x0 + lead, cy + size * 0.04);
  if (AFTER[s.mark]) AFTER[s.mark](c, s, x0 + lead, x0 + lead + tw, cy, h);
  c.restore();
  c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(x + w - 3, y, 3, h);
}

export function sponsorAtlas() {
  const cv = document.createElement('canvas');
  cv.width = COLS * CELL_W; cv.height = ROWS * CELL_H;
  const c = cv.getContext('2d');
  c.fillStyle = '#111'; c.fillRect(0, 0, cv.width, cv.height);
  SPONSORS.forEach((s, i) => drawBoard(c, s, (i % COLS) * CELL_W, Math.floor(i / COLS) * CELL_H, CELL_W, CELL_H));
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  // the wall shader picks a board per cell, so uv jumps at cell edges; mipmaps would show seams there
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

// texture showing just board `id`
export function boardTexture(atlas, id) {
  id = ((id % COUNT) + COUNT) % COUNT;
  const t = atlas.clone();
  t.repeat.set(1 / COLS, 1 / ROWS);
  // canvas row 0 is the top of the image; with flipY it is the top of uv space
  t.offset.set((id % COLS) / COLS, 1 - (Math.floor(id / COLS) + 1) / ROWS);
  t.needsUpdate = true;
  return t;
}

export const titleSponsor = () => Math.max(0, SPONSORS.findIndex(s => s.title));

// GLSL: map a running uv (x in boards, y 0..1) to the atlas, one hashed sponsor per board.
export const BOARD_UV_GLSL = `
  vec2 boardUv(vec2 uv){
    float cell = floor(uv.x);
    float h = fract(sin(cell * 12.9898 + 4.1) * 43758.5453);
    float id = floor(h * ${COUNT}.0);
    float col = mod(id, ${COLS}.0), row = floor(id / ${COLS}.0);
    return vec2((col + fract(uv.x)) / ${COLS}.0, 1.0 - (row + 1.0 - uv.y) / ${ROWS}.0);
  }`;
