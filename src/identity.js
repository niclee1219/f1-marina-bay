// Singapore identity around the circuit:
//  - the Turn 1-3 run-off (config RUNOFF) painted in the Marina Bay scheme: deep blue with white and
//    gold stripes sweeping with the corner and a plain-text SINGAPORE wordmark (no logos);
//  - corner number boards before each apex, DRS detection and activation boards (DRS cars only);
//  - marshal posts at MultiViewer's 16 marshal light positions (scripts/fit_marshal_posts.py), whose
//    light panels show the flag state of their marshal sector (Race.marshalState).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RUNOFF, DRS_BOARDS } from './config.js';

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function decal(mat) {
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -3;
  mat.polygonOffsetUnits = -6;
  return mat;
}

// stripes across the run-off, in metres from its inner edge (RUNOFF_SCALE metres per texture width)
const SCALE = 32;
const BANDS = [
  [0, 3, '#1d2c8c'], [3, 4.2, '#f2f2f2'], [4.2, 5.6, '#e8b923'], [5.6, 5.9, '#f07a1a'], [5.9, 11, '#1d2c8c'],
  [11, 11.6, '#f2f2f2'], [11.6, 13, '#e8b923'], [13, 24, '#1f3194'], [24, 25, '#f2f2f2'], [25, 32, '#1d2c8c'],
];

export class Identity {
  constructor(track, race, g) {
    this.track = track; this.race = race;
    this.group = new THREE.Group();
    this.group.name = 'identity';
    g.add(this.group);
    this.buildRunoff();
    this.buildCornerBoards();
    this.buildDrsBoards();
    this.buildMarshals();
  }

  // ---------------------------------------------------------------- run-off paint
  buildRunoff() {
    const tr = this.track, H = tr.half, edge = H + 1.6;
    const tex = canvasTex(512, 4, (x, w, h) => {
      for (const [a, b, c] of BANDS) { x.fillStyle = c; x.fillRect(Math.floor(a / SCALE * w), 0, Math.ceil((b - a) / SCALE * w), h); }
    });
    tex.wrapS = THREE.ClampToEdgeWrapping;
    const geos = [];
    for (const z of tr.runoffZones) {
      if (!z.paint) continue;
      const side = z.side, inner = side * edge;
      const geo = side > 0 ? tr.ribbon(inner, tr.wallLine(1), 0.0, z.i0 + tr.n, z.i1 + tr.n) : tr.ribbon(tr.wallLine(-1), inner, 0.0, z.i0 + tr.n, z.i1 + tr.n);
      // uv.x in metres from the inner edge, so the stripes keep their width as the run-off widens
      const pos = geo.attributes.position, uv = geo.attributes.uv;
      for (let v = 0; v < pos.count; v += 2) {
        const a = new THREE.Vector3().fromBufferAttribute(pos, v), b = new THREE.Vector3().fromBufferAttribute(pos, v + 1);
        const wdt = a.distanceTo(b);
        if (side > 0) { uv.setX(v, 0); uv.setX(v + 1, wdt / SCALE); } else { uv.setX(v, wdt / SCALE); uv.setX(v + 1, 0); }
      }
      geos.push(geo);
    }
    if (!geos.length) return;
    this.group.add(new THREE.Mesh(mergeGeometries(geos), decal(new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.16, roughness: 0.8 }))));
    // wordmark where the run-off is widest, reading for spectators behind the wall
    for (const z of tr.runoffZones) if (z.word) this.paintWord(z);
  }

  paintWord(z) {
    const tr = this.track, word = z.word, n = word.length;
    const atlas = canvasTex(160 * n, 200, (x, w, h) => {
      x.clearRect(0, 0, w, h);
      x.fillStyle = '#ffffff'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.font = 'italic 900 190px "Titillium Web", sans-serif';
      [...word].forEach((L, i) => x.fillText(L, 160 * (i + 0.5), h / 2 + 8));
    });
    // the stretch where the run-off is at full width
    let best = -1, run = 0, bestRun = 0, start = 0;
    for (let i = z.i0; i <= z.i1; i++) {
      const full = tr.runoff[z.side > 0 ? 1 : -1][((i % tr.n) + tr.n) % tr.n] >= z.width * 0.95;
      if (full) { if (!run) start = i; run++; if (run > bestRun) { bestRun = run; best = start; } } else run = 0;
    }
    if (best < 0) return;
    const sMid = (best + bestRun / 2) * tr.bin, pitch = 6.2, lw = 5.4, depth = 8;
    const edge = tr.half + 1.6 + 14;   // letters across 14..22 m from the inner edge of the paint
    const geos = [];
    // even spacing along the line the letters sit on (on the outside of a bend it is longer than
    // the centreline): cumulative distance along that offset line, then look up s for each letter
    const iMid = Math.round(sMid / tr.bin), span = Math.round((n * pitch * 1.6) / tr.bin);
    const ss = [], dd = [0];
    for (let i = iMid - span; i <= iMid + span; i++) {
      ss.push(i * tr.bin);
      if (ss.length > 1) dd.push(dd[dd.length - 1] + tr.at(i, z.side * (edge + depth / 2)).distanceTo(tr.at(i - 1, z.side * (edge + depth / 2))));
    }
    const dMid = dd[span];
    const sAt = d => { let j = 1; while (j < dd.length - 1 && dd[j] < d) j++; const f = (d - dd[j - 1]) / ((dd[j] - dd[j - 1]) || 1); return ss[j - 1] + (ss[j] - ss[j - 1]) * f; };
    [...word].forEach((_, k) => {
      // reading left to right for someone behind the wall facing the track
      const s = sAt(dMid + (k - (n - 1) / 2) * pitch * (z.side > 0 ? 1 : -1));
      const q = tr.paintQuad(s, z.side * edge, z.side * (edge + depth), -lw / 2, lw / 2, [0, 0, 1, 1], 0.05);
      // uv: u along the track (letter width), v across toward the track (letter up)
      const uv = q.attributes.uv;
      // vertices: (lx0,lz0) (lx1,lz0) (lx0,lz1) (lx1,lz1); lx0 is the track side
      const u0 = k / n, u1 = (k + 1) / n;
      const flip = z.side > 0;
      uv.setXY(0, flip ? u0 : u1, 1); uv.setXY(1, flip ? u0 : u1, 0);
      uv.setXY(2, flip ? u1 : u0, 1); uv.setXY(3, flip ? u1 : u0, 0);
      geos.push(q);
    });
    this.group.add(new THREE.Mesh(mergeGeometries(geos), decal(new THREE.MeshBasicMaterial({ map: atlas, transparent: true, depthWrite: false, color: new THREE.Color(0.86, 0.86, 0.88) }))));
  }

  // ---------------------------------------------------------------- boards
  // a board facing the oncoming cars at sample i, lateral offset o, centre height h; uv rect
  board(i, o, h, w, hh, uv) {
    const tr = this.track, k = ((i % tr.n) + tr.n) % tr.n;
    const p = tr.at(k, o), t = tr.T[k];
    const g = new THREE.PlaneGeometry(w, hh);
    const a = g.attributes.uv;
    for (let q = 0; q < a.count; q++) a.setXY(q, uv[0] + a.getX(q) * (uv[2] - uv[0]), uv[1] + a.getY(q) * (uv[3] - uv[1]));
    g.rotateY(Math.atan2(-t.x, -t.z));
    return g.translate(p.x, tr.P[k].y - 0.18 + h, p.z);
  }

  post(i, o, h) {
    const tr = this.track, k = ((i % tr.n) + tr.n) % tr.n, p = tr.at(k, o);
    return new THREE.BoxGeometry(0.1, h, 0.1).translate(p.x, tr.P[k].y - 0.18 + h / 2, p.z);
  }

  buildCornerBoards() {
    const tr = this.track, cs = tr.corners;
    const atlas = canvasTex(128 * cs.length, 128, (x, w, h) => {
      cs.forEach((c, k) => {
        x.fillStyle = '#1d2c8c'; x.fillRect(128 * k, 0, 128, h);
        x.strokeStyle = '#ffffff'; x.lineWidth = 6; x.strokeRect(128 * k + 6, 6, 116, h - 12);
        x.fillStyle = '#ffffff'; x.textAlign = 'center'; x.textBaseline = 'middle';
        x.font = '900 78px "Titillium Web", sans-serif';
        x.fillText(String(c.n), 128 * k + 64, h / 2 + 4);
      });
    });
    const boards = [], posts = [];
    cs.forEach((c, k) => {
      const outside = -(Math.sign(tr.curv[c.i]) || 1);
      let i = c.i - Math.round(35 / tr.bin), side = outside;
      if (tr.inPitLane(i, side * (tr.wallAt(i, side) + 1)) || tr.pitGap(i, side)) side = -side;
      const o = side * (tr.wallAt(i, side) - 0.45);
      boards.push(this.board(i, o, 2.6, 1.5, 1.5, [k / cs.length, 0, (k + 1) / cs.length, 1]));
      posts.push(this.post(i, o, 1.9));
    });
    this.group.add(new THREE.Mesh(mergeGeometries(boards), new THREE.MeshStandardMaterial({ map: atlas, emissiveMap: atlas, emissive: 0xffffff, emissiveIntensity: 0.55, side: THREE.DoubleSide })));
    this.group.add(new THREE.Mesh(mergeGeometries(posts), new THREE.MeshStandardMaterial({ color: 0x8c929c })));
  }

  // DRS detection and activation boards. Activation: where cars actually opened DRS (the start of
  // each zone, track.drs, adjacent pieces merged). Detection: OpenF1 does not give it, so it is
  // placed DRS_BOARDS.detectBefore metres before the last corner ahead of the zone (a guess).
  buildDrsBoards() {
    const tr = this.track;
    if (this.race.has_drs === false || !tr.drs.length) return;
    const zones = [...tr.drs].map(([a, b]) => [a % tr.n, b]).sort((x, y) => x[0] - y[0]);
    const merged = [];
    for (const z of zones) {
      const last = merged[merged.length - 1];
      if (last && z[0] - last[1] <= 4) last[1] = Math.max(last[1], z[1]); else merged.push([...z]);
    }
    // a zone that ends at the lap end continues one that starts at 0
    if (merged.length > 1 && merged[0][0] <= 2 && merged[merged.length - 1][1] >= tr.n - 4) merged.shift();
    const tex = canvasTex(512, 128, (x, w, h) => {
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, 256, h);
      x.fillStyle = '#111'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.font = '900 60px "Titillium Web", sans-serif'; x.fillText('DRS', 128, 44);
      x.font = '700 30px "Titillium Web", sans-serif'; x.fillText('DETECTION', 128, 96);
      x.fillStyle = '#111'; x.fillRect(256, 0, 256, h);
      x.fillStyle = '#ffffff'; x.font = '900 76px "Titillium Web", sans-serif'; x.fillText('DRS', 384, 56);
      x.font = '700 30px "Titillium Web", sans-serif'; x.fillText('ACTIVATION', 384, 106);
    });
    const boards = [], posts = [];
    const place = (i, uv) => {
      let side = DRS_BOARDS.side;
      if (tr.inPitLane(i, side * (tr.wallAt(i, side) + 1)) || tr.pitGap(i, side)) side = -side;
      const o = side * (tr.wallAt(i, side) - 0.45);
      boards.push(this.board(i, o, 2.7, 2.6, 1.3, uv));
      posts.push(this.post(i, o, 2.05));
    };
    this.drsPoints = [];
    for (const [a] of merged) {
      place(a, [0.5, 0, 1, 1]);
      // detection: before the last corner ahead of the activation point
      const prev = [...tr.corners].sort((x, y) => x.i - y.i).filter(c => c.i < a - 10).pop() || tr.corners[tr.corners.length - 1];
      const di = prev.i - Math.round(DRS_BOARDS.detectBefore / tr.bin);
      place(di, [0, 0, 0.5, 1]);
      this.drsPoints.push({ activation: a * tr.bin, detection: di * tr.bin, corner: prev.n });
    }
    this.group.add(new THREE.Mesh(mergeGeometries(boards), new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.55, side: THREE.DoubleSide })));
    this.group.add(new THREE.Mesh(mergeGeometries(posts), new THREE.MeshStandardMaterial({ color: 0x8c929c })));
  }

  // ---------------------------------------------------------------- marshal posts
  buildMarshals() {
    const tr = this.track, M = this.race.track.marshal;
    if (!M || !M.lights) return;
    const sectors = [...M.sectors].sort((a, b) => a.s - b.s);
    const sectorOf = s => (sectors.filter(x => x.s <= s).pop() || sectors[sectors.length - 1]).n;
    const items = [], panels = [];
    this.lights = M.lights.map(l => {
      const i = Math.round(l.s / tr.bin) % tr.n;
      let side = l.side;
      if (tr.inPitLane(i, side * (tr.wallAt(i, side) + 2)) || tr.pitGap(i, side)) side = -side;
      items.push({ i, o: side * (tr.wallAt(i, side) + 2.2) });
      // panel on a post at the wall, facing the oncoming cars
      panels.push({ i, o: side * (tr.wallAt(i, side) - 0.3), rot: side * Math.PI / 2 });
      // MultiViewer numbers the lights after their sectors, light n at the start of sector n
      return { n: l.n, sector: sectors.some(x => x.n === l.n) ? l.n : sectorOf(l.s) };
    });
    tr.instances(this.group, 'marshal', new THREE.BoxGeometry(2.4, 2.6, 2.0).translate(0, 1.3, -0.6),
      new THREE.MeshStandardMaterial({ color: 0xd7d9de, roughness: 0.6, emissive: 0x202226 }), items);
    tr.instances(this.group, 'marshal-pole', new THREE.BoxGeometry(0.12, 3.6, 0.12).translate(0, 1.8, -0.1),
      new THREE.MeshStandardMaterial({ color: 0x5b616c }), panels);
    tr.instances(this.group, 'marshal-panel-back', new THREE.BoxGeometry(1.5, 1.0, 0.12).translate(0, 3.6, 0),
      new THREE.MeshStandardMaterial({ color: 0x15171c }), panels);
    this.panels = tr.instances(this.group, 'marshal-panel', new THREE.PlaneGeometry(1.3, 0.8).translate(0, 3.6, 0.07),
      new THREE.MeshBasicMaterial({ color: 0xffffff }), panels, () => '#111111');
    this.stateT = -1;
    this.state = null;
  }

  // light panels: re-read race control a few times a second, blink every frame
  update(t, time) {
    if (!this.panels) return;
    if (Math.abs(t - this.stateT) > 0.25) { this.state = this.race.marshalState(t); this.stateT = t; }
    const { all, sectors } = this.state, c = new THREE.Color();
    const blink = f => (Math.sin(time * Math.PI * 2 * f) > 0 ? 1 : 0.03);
    this.lights.forEach((l, k) => {
      const st = all || sectors.get(l.sector) || sectors.get('*') || '';
      if (st === 'red') c.setRGB(2.6, 0.08, 0.06);
      else if (st === 'sc' || st === 'vsc') c.setRGB(2.4 * blink(1.5), 1.8 * blink(1.5), 0.05);
      else if (st === 'yellow') c.setRGB(2.4 * blink(1.5), 1.8 * blink(1.5), 0.05);
      else if (st === 'dyellow') c.setRGB(2.4 * blink(3), 1.8 * blink(3), 0.05);
      else if (st === 'green') c.setRGB(0.15, 2.4, 0.5);
      else if (st === 'chequered') { const b = blink(1); c.setRGB(1.8 * b, 1.8 * b, 1.8 * b); }
      else c.setRGB(0.04, 0.045, 0.05);
      this.panels.setColorAt(k, c);
    });
    this.panels.instanceColor.needsUpdate = true;
  }
}
