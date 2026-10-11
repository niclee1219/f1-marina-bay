// Singapore Airlines title-sponsor artwork, drawn to 2D canvases (race-night photos, references/):
//  - the gold bird mark (assets/logos/sia-bird.png, preloaded by sponsors.js loadLogos);
//  - the banner face on the gantries over the track: the SINGAPORE AIRLINES wordmark (the logo
//    file, recoloured white) followed by the bird, on navy between light-blue rules, as on the
//    start-line banner;
//  - the run-off artwork at Turn 1 and the last corner: wordmark and bird to lay on the blue paint.
import { logoImage } from './sponsors.js';

export const SIA = { navy: '#14277a', deep: '#0d1b5c', rule: '#4f7fd6', gold: '#fbb034' };

// The bird, fitted into a box of height h with its top-left at (x, y); returns the width drawn.
// Without the image (failed to load): a plain gold block of the same proportions' width, so the
// layout holds.
export function drawSiaBird(c, x, y, h) {
  const img = logoImage('sia-bird');
  const w = img ? h * img.naturalWidth / img.naturalHeight : h * 0.72;
  if (img) c.drawImage(img, x, y, w, h);
  return w;
}

const birdWidth = h => { const img = logoImage('sia-bird'); return img ? h * img.naturalWidth / img.naturalHeight : 0; };

// the wordmark logo file recoloured to one colour, without its gold underline (the top 72%)
function wordmark(col) {
  const img = logoImage('Singapore Airlines');
  if (!img) return null;
  const crop = 0.72, t = document.createElement('canvas');
  t.width = img.naturalWidth; t.height = Math.ceil(img.naturalHeight * crop);
  const x = t.getContext('2d');
  x.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight);
  x.globalCompositeOperation = 'source-in'; x.fillStyle = col; x.fillRect(0, 0, t.width, t.height);
  return t;
}

// wordmark (or a text fallback) of cap height th at (x0, y-centre cy); returns its width
function paintWordmark(c, x0, cy, th, maxW, dry = false) {
  const wm = wordmark('#ffffff');
  if (wm) {
    let tw = th * wm.width / wm.height;
    if (tw > maxW) { th *= maxW / tw; tw = maxW; }
    if (!dry) c.drawImage(wm, x0, cy - th / 2, tw, th);
    return tw;
  }
  c.font = `700 ${Math.round(th)}px "Titillium Web", sans-serif`;
  const tw = Math.min(maxW, c.measureText('SINGAPORE AIRLINES').width);
  if (!dry) { c.fillStyle = '#ffffff'; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText('SINGAPORE AIRLINES', x0, cy, maxW); }
  return tw;
}

// A banner face (w x h) for the gantries over the track.
export function drawSiaBanner(c, w, h) {
  c.fillStyle = SIA.navy; c.fillRect(0, 0, w, h);
  const rule = Math.round(h * 0.07), edge = Math.round(h * 0.02);
  c.fillStyle = SIA.rule; c.fillRect(0, 0, w, rule); c.fillRect(0, h - rule, w, rule);
  c.fillStyle = SIA.deep; c.fillRect(0, rule, w, edge); c.fillRect(0, h - rule - edge, w, edge);
  const bh = h * 0.66, bw = birdWidth(bh), gap = bw ? h * 0.22 : 0;
  const th = h * 0.42, tw = paintWordmark(c, 0, 0, th, w - bw - gap - h * 0.6, true);
  const x0 = (w - (tw + gap + bw)) / 2;
  paintWordmark(c, x0, h / 2, th, tw + 1);
  if (bw) drawSiaBird(c, x0 + tw + gap, (h - bh) / 2, bh);
}

// Run-off artwork: the white wordmark then the gold bird on a transparent canvas. Its aspect
// (width / height) sets how far it runs along the track for a given depth across it.
export function siaRunoffArt() {
  const h = 256, th = h * 0.5, bw = birdWidth(h), gap = bw ? h * 0.35 : 0;
  const m = document.createElement('canvas').getContext('2d');
  const tw = paintWordmark(m, 0, 0, th, 1e5, true);
  const c = document.createElement('canvas');
  c.width = Math.ceil(tw + gap + bw); c.height = h;
  const x = c.getContext('2d');
  paintWordmark(x, 0, h * 0.58, th, tw + 1);
  if (bw) drawSiaBird(x, tw + gap, 0, h);
  return c;
}
