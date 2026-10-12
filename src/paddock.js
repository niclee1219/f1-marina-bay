// Paddock dressing: the ground around the pit building that the paddock itself leaves empty
// (mostly beside the pit exit, where it used to be black). Laid out on a grid of 6 m cells in pit-lane
// coordinates (pitlane.js: u along the lane, w toward the garages, h up). Each free cell is paved plaza
// (marquees, umbrellas and tables, planters, string lights) near the building, or lawn and garden
// (trees, palms, hedges, shrubs) further out, crossed by paved paths with lamp posts. Mesh fences
// stand wherever the area meets a road, the circuit, a building or the pit lane. Text only, no logos.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PIT_LANE } from './config.js';
import { laneBox, laneCyl, laneSign, tint } from './garages.js';
import { arch, laneShape, inRing } from './pit.js';

const S = 6;                 // cell size, m
const REACH = 150;           // how far beyond the garage line the dressing may reach
const TRACK_GAP = 14;        // keep this far from the circuit centreline

const C = (r, g, b) => new THREE.Color(r, g, b);
const hash = (a, b, k = 0) => {
  let h = (a * 374761393 + b * 668265263 + k * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177 | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function glowTex() {
  return canvasTex(64, 64, (x) => {
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  }, false);
}

const pavingTex = () => canvasTex(128, 128, (x, w, h) => {
  x.fillStyle = '#6b6d72'; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 500; i++) { const v = 90 + Math.random() * 40 | 0; x.fillStyle = `rgba(${v},${v},${v + 4},0.35)`; x.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  x.strokeStyle = 'rgba(30,31,34,0.75)'; x.lineWidth = 2;
  for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(0, i * h / 4); x.lineTo(w, i * h / 4); x.stroke(); x.beginPath(); x.moveTo(i * w / 4, 0); x.lineTo(i * w / 4, h); x.stroke(); }
});

const lawnTex = () => canvasTex(128, 128, (x, w, h) => {
  x.fillStyle = '#2f5a2d'; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) { const g = 70 + Math.random() * 60 | 0; x.fillStyle = `rgba(${g * 0.5 | 0},${g},${g * 0.4 | 0},0.45)`; x.fillRect(Math.random() * w, Math.random() * h, 2, 3); }
});

const meshTex = () => canvasTex(64, 64, (x, w, h) => {
  x.clearRect(0, 0, w, h);
  x.strokeStyle = '#ffffff'; x.lineWidth = 3;
  for (let i = -h; i < w + h; i += 16) {
    x.beginPath(); x.moveTo(i, 0); x.lineTo(i + h, h); x.stroke();
    x.beginPath(); x.moveTo(i + h, 0); x.lineTo(i, h); x.stroke();
  }
});

// quad on the ground / upright between lane points, with uv
function quadGeo(pts, uvs, up = true) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flatMap(v => [v.x, v.y, v.z]), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  if (up) g.setAttribute('normal', new THREE.Float32BufferAttribute(pts.flatMap(() => [0, 1, 0]), 3));
  g.setIndex([0, 1, 2, 1, 3, 2]);
  if (!up) g.computeVertexNormals();
  return g;
}

// fan of palm fronds drooping from the origin
function palmCrown() {
  const pos = [];
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2 + (i % 2) * 0.2, c = Math.cos(a), s = Math.sin(a);
    const tipX = c * 3.4, tipZ = s * 3.4, midX = c * 1.7, midZ = s * 1.7, px = -s * 0.45, pz = c * 0.45;
    pos.push(0, 0.25, 0, midX + px, 0.55, midZ + pz, midX - px, 0.55, midZ - pz);
    pos.push(midX + px, 0.55, midZ + pz, tipX, -0.9, tipZ, midX - px, 0.55, midZ - pz);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export function buildPaddockDecor(g, track, city, race, pit) {
  const out = { decks: [] };
  const L = track.lane, pd = pit && pit.paddock, span = pit && pit.span;
  if (!L || !pd || !span) return out;
  const G = PIT_LANE.garage, { room, nearRoad, lay, depth, used } = pd;
  const { u0, u1 } = span;
  const roomOf = u => room.find(r => u >= r.a && u < r.b);

  // ---- which cells are free ground, which belong to the paddock already, which are blocked
  const uA = Math.max(0, u0 - 50), uB = Math.min(L.length - 2, u1 + REACH);
  const wA = G + 2.5;
  const nu = Math.ceil((uB - uA) / S), nw = Math.ceil(REACH / S);
  const state = new Uint8Array(nu * nw);   // 0 blocked, 1 free, 2 taken by the paddock
  const P = new THREE.Vector3();
  const isFree = (u, w) => {
    L.point(u, w, 0, P);
    return !nearRoad(P.x, -P.z) && track.nearest(P.x, P.z).d > TRACK_GAP
      && !city.buildings.some(bd => inRing(bd.p, P.x, -P.z));
  };
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nw; j++) {
      const u = uA + (i + 0.5) * S, w = wA + (j + 0.5) * S;
      let st;
      if (u >= u0 - 2 && u < u1 + 2 && (w < G + depth(u) + 2.5 || (() => { const r = roomOf(u); return r && r.wr - r.wb > 6 && w <= r.wr + 2; })())) st = 2;
      else st = [[0, 0], [-2.5, -2.5], [2.5, -2.5], [-2.5, 2.5], [2.5, 2.5]].every(([a, b]) => isFree(u + a, w + b)) ? 1 : 0;
      state[i * nw + j] = st;
    }
  }
  const at = (i, j) => (i < 0 || j < 0 || i >= nu || j >= nw ? 0 : state[i * nw + j]);
  let count = 0; for (const s of state) if (s === 1) count++;
  if (count < 4) return out;

  // plaza: paved, near the building end and the paddock; lawn and garden beyond
  const hub = L.point(u1 - 6, G + 22), ph = new THREE.Vector3();
  const cellPos = (i, j, du = 0, dw = 0) => ({ u: uA + (i + 0.5) * S + du, w: wA + (j + 0.5) * S + dw });
  const isPlaza = (i, j) => {
    const c = cellPos(i, j);
    L.point(c.u, c.w, 0, ph);
    return Math.hypot(ph.x - hub.x, ph.z - hub.z) < 58;
  };
  const isPath = (i, j) => i % 6 === 2 || (j % 7 === 3 && j < nw - 6);

  const solid = [], lit = [], tents = [], pools = [], fenceMesh = [], flagQuads = [];
  const glows = [], bulbs = [];
  const paving = [], lawn = [];
  const trees = [];   // [kind, x, y, z, yaw, size, shade]
  const box = (a, b, w0, w1, h0, h1, col, list = solid, k = 1) => list.push(tint(laneBox(L, a, b, w0, w1, h0, h1), col, k));
  const teamCols = lay ? lay.frontage.map(f => new THREE.Color(f.color)) : [C(0.8, 0.1, 0.1)];
  const white = C(0.86, 0.87, 0.9), dark = C(0.08, 0.085, 0.1), warm = C(1.0, 0.82, 0.58), steel = C(0.3, 0.32, 0.36);

  const lamp = (u, w) => {
    box(u - 0.07, u + 0.07, w - 0.07, w + 0.07, 0, 5.6, steel);
    box(u - 0.5, u + 0.5, w - 0.12, w + 0.12, 5.55, 5.7, steel);
    box(u - 0.45, u + 0.45, w - 0.2, w + 0.2, 5.38, 5.5, C(1.9, 1.6, 1.15), lit);
    const p = L.point(u, w, 5.3); glows.push(p.x, p.y, p.z);
    const q = [L.point(u - 8, w - 8, 0.07), L.point(u + 8, w - 8, 0.07), L.point(u - 8, w + 8, 0.07), L.point(u + 8, w + 8, 0.07)];
    pools.push(quadGeo(q, [0, 0, 1, 0, 0, 1, 1, 1]));
  };
  const addTree = (u, w, kind, rnd) => {
    const p = L.point(u, w, 0);
    trees.push([kind, p.x, p.y, p.z, rnd * 6.28, kind ? 0.8 + rnd * 0.5 : 0.8 + rnd * 0.7, rnd]);
    if (rnd > 0.35) { const b = L.point(u, w, 0.15); glows.push(b.x, b.y + 0.2, b.z); }   // uplighter at the trunk
  };
  const shrub = (u, w, r, col) => {
    const geo = new THREE.IcosahedronGeometry(r, 1);
    const pos = geo.attributes.position, v = new THREE.Vector3();
    for (let k = 0; k < pos.count; k++) { L.point(u + pos.getX(k), w + pos.getZ(k), r * 0.75 + pos.getY(k) * 0.8, v); pos.setXYZ(k, v.x, v.y, v.z); }
    geo.deleteAttribute('uv'); geo.computeVertexNormals();
    solid.push(tint(geo, col));
  };
  const green = rnd => C(0.1 + rnd * 0.06, 0.3 + rnd * 0.16, 0.1 + rnd * 0.05);

  // ---- ground and what stands on it
  const marquee = (u, w, a, b) => {
    box(u - a, u + a, w - b, w + b, 0, 2.7, C(0.82, 0.83, 0.85), tents);
    tents.push(tint(laneShape(L, arch(), u - a, u + a, w - b, w + b, 2.7, 4.7), C(0.93, 0.94, 0.96)));
    box(u - a + 0.4, u + a - 0.4, w - b - 0.03, w - b, 0.3, 2.4, warm, lit, 0.4);
    box(u - a + 0.4, u + a - 0.4, w + b, w + b + 0.03, 0.3, 2.4, warm, lit, 0.3);
    const p = L.point(u, w, 2.2); glows.push(p.x, p.y, p.z);
  };
  const umbrella = (u, w, rnd) => {
    const col = rnd > 0.5 ? white : teamCols[(rnd * 97 | 0) % teamCols.length];
    solid.push(tint(laneCyl(L, u, w, 0, 2.5, 0.04, 6), steel));
    const cone = new THREE.ConeGeometry(1.7, 0.7, 8, 1, true).toNonIndexed();
    const pos = cone.attributes.position, v = new THREE.Vector3();
    for (let k = 0; k < pos.count; k++) { L.point(u + pos.getX(k), w + pos.getZ(k), 2.5 + pos.getY(k), v); pos.setXYZ(k, v.x, v.y, v.z); }
    cone.deleteAttribute('uv'); cone.computeVertexNormals();
    tents.push(tint(cone, col, 0.92));
    solid.push(tint(laneCyl(L, u, w, 0, 0.78, 0.55, 10), C(0.16, 0.17, 0.2)));
    for (const [a, b] of [[1.3, 0], [-1.3, 0], [0, 1.3], [0, -1.3]]) solid.push(tint(laneCyl(L, u + a, w + b, 0, 0.45, 0.22, 8), C(0.9, 0.9, 0.92)));
  };
  const planter = (u, w, rnd) => {
    box(u - 1.2, u + 1.2, w - 1.2, w + 1.2, 0, 0.7, white, solid, 0.8);
    if (rnd > 0.5) { shrub(u, w, 0.95, green(rnd)); } else { shrub(u - 0.5, w, 0.7, green(rnd)); shrub(u + 0.6, w + 0.2, 0.6, green(rnd * 0.8)); }
    if (rnd > 0.75) addTree(u, w, 1, rnd);
  };
  const cart = (u, w, col) => {
    box(u - 1.4, u + 1.4, w - 0.55, w + 0.55, 0.25, 0.85, col);
    box(u - 1.4, u + 0.2, w - 0.5, w + 0.5, 0.85, 1.0, white);
    box(u - 1.3, u + 0.1, w - 0.5, w + 0.5, 1.9, 2.0, white);
    for (const du of [-1.15, 1.15]) for (const dw of [-0.55, 0.55]) box(u + du - 0.3, u + du + 0.3, w + dw - 0.08, w + dw + 0.08, 0, 0.6, dark);
  };

  let tableU = 0;
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nw; j++) {
      if (state[i * nw + j] !== 1) continue;
      const { u, w } = cellPos(i, j);
      const plaza = isPlaza(i, j), path = isPath(i, j), r1 = hash(i, j, 1), r2 = hash(i, j, 2), r3 = hash(i, j, 3);
      const v = 0.85 + 0.3 * r1;
      const tile = quadGeo([L.point(u - S / 2, w - S / 2, 0.045), L.point(u + S / 2, w - S / 2, 0.045), L.point(u - S / 2, w + S / 2, 0.045), L.point(u + S / 2, w + S / 2, 0.045)], [0, 0, 2, 0, 0, 2, 2, 2]);
      (plaza || path ? paving : lawn).push(tint(tile, plaza || path ? C(v, v, v) : C(v, v, v), 1));
      if (path && !plaza) {
        // lamp posts down the paths
        if ((i + j) % 4 === 0) lamp(u + S / 2 - 0.2, w + S / 2 - 0.2);
        continue;
      }
      if (plaza) {
        if (r2 < 0.2 && at(i - 1, j) && at(i + 1, j) && at(i, j - 1) && at(i, j + 1)) marquee(u, w, 2.6, 2.6);
        else if (r2 < 0.52) { umbrella(u - 1.4, w - 1.2, r3); umbrella(u + 1.6, w + 1.4, hash(i, j, 4)); tableU++; }
        else if (r2 < 0.7) planter(u + (r3 - 0.5) * 2, w + (r1 - 0.5) * 2, r3);
        else if (r2 < 0.74) cart(u, w, teamCols[(r3 * 99 | 0) % teamCols.length]);
        if (i % 3 === 0 && j % 3 === 0) lamp(u + S / 2, w + S / 2);
        continue;
      }
      // garden: trees, palms, hedges and shrubs
      if (r2 < 0.5) addTree(u + (r1 - 0.5) * 3, w + (r3 - 0.5) * 3, r3 > 0.6 ? 1 : 0, r1);
      else if (r2 < 0.66) { shrub(u - 1, w, 1.0 + r1 * 0.6, green(r1)); shrub(u + 1.2, w + 0.8, 0.8 + r3 * 0.5, green(r3)); }
      else if (r2 < 0.78) { box(u - S / 2 + 0.4, u + S / 2 - 0.4, w - 0.6, w + 0.6, 0, 1.1 + r1 * 0.4, green(r1), solid, 1); }   // hedge
      if (r2 > 0.45 && r2 < 0.5) lamp(u + 2, w + 2);
    }
  }

  // ---- the paddock proper: the paved strip behind the building, between the units. Cells the units,
  // marquees, walkways and trucks do not take get lighter paving, planters with trees, umbrellas and
  // tables, extra marquees, hedges, lamps and a few carts; the far edge is fenced
  const padCells = new Set();
  const overlaps = (u, w) => used.some(r => u + S / 2 > r.a && u - S / 2 < r.b && w + S / 2 > r.w0 && w - S / 2 < r.w1);
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nw; j++) {
      if (state[i * nw + j] !== 2) continue;
      const { u, w } = cellPos(i, j), r = roomOf(u);
      if (!r || r.wr - r.wb <= 6 || w < r.wb + 3 || w > r.wr - 1 || overlaps(u, w)) continue;
      padCells.add(i * nw + j);
      const r1 = hash(i, j, 21), r2 = hash(i, j, 22), r3 = hash(i, j, 23), v = 0.9 + 0.25 * r1;
      paving.push(tint(quadGeo([L.point(u - S / 2, w - S / 2, 0.075), L.point(u + S / 2, w - S / 2, 0.075), L.point(u - S / 2, w + S / 2, 0.075), L.point(u + S / 2, w + S / 2, 0.075)], [0, 0, 2, 0, 0, 2, 2, 2]), C(v, v, v * 1.03)));
      const near = (di, dj) => padCells.has((i + di) * nw + j + dj);
      if (r2 < 0.12) marquee(u, w, 2.5, 2.5);
      else if (r2 < 0.38) { umbrella(u - 1.4, w - 1.2, r3); umbrella(u + 1.6, w + 1.4, hash(i, j, 24)); }
      else if (r2 < 0.64) planter(u + (r3 - 0.5) * 2, w + (r1 - 0.5) * 2, r3);
      else if (r2 < 0.72) { box(u - S / 2 + 0.4, u + S / 2 - 0.4, w - 0.6, w + 0.6, 0, 1.0 + r1 * 0.4, green(r1)); }
      else if (r2 < 0.76) cart(u, w, teamCols[(r3 * 99 | 0) % teamCols.length]);
      else if (r2 < 0.82) { addTree(u + (r1 - 0.5) * 2, w + (r3 - 0.5) * 2, 1, r1); shrub(u + 1.8, w - 1.4, 0.7, green(r3)); }
      if (i % 3 === 0 && j % 3 === 0) lamp(u + S / 2, w + S / 2);
      void near;
    }
  }
  // people between the units: a block every ~45 m along the strip, off the walkway and the units
  const padList = [...padCells];
  for (let n = 0; n < 7 && padList.length; n++) {
    const c = padList[Math.floor(padList.length * (n + 0.5) / 7)], i = Math.floor(c / nw), j = c % nw;
    const q = cellPos(i, j), p = L.point(q.u, q.w, 0.1), { t } = L.frame(q.u);
    out.decks.push({ x: p.x, z: p.z, y: p.y, len: 16, wid: 10, angle: Math.atan2(-t.z, t.x), density: 0.1, tag: 'paddock' });
  }
  // string lights across the strip between lamp lattice points
  for (let i = 0; i < nu - 3; i += 3) for (let j = 0; j < nw - 3; j += 3) {
    if (!padCells.has(i * nw + j)) continue;
    const a = cellPos(i, j, S / 2, S / 2);
    for (const [di, dj] of [[3, 0], [0, 3]]) {
      if (!padCells.has((i + di) * nw + j + dj)) continue;
      const b = cellPos(i + di, j + dj, S / 2, S / 2);
      for (let k = 1; k < 12; k++) { const f = k / 12, p = L.point(a.u + (b.u - a.u) * f, a.w + (b.w - a.w) * f, 5.3 - Math.sin(f * Math.PI) * 0.9); bulbs.push(p.x, p.y, p.z); }
    }
  }
  // flags along the back of the strip's walkway, one per team colour
  for (let u = u0 + 8, k = 0; u < u1 - 8; u += 20, k++) {
    const r = roomOf(u); if (!r || r.wr - r.wb <= 6) continue;
    const w = r.wb + 1.2;
    box(u - 0.08, u + 0.08, w - 0.08, w + 0.08, 0, 9, steel);
    const q = [L.point(u + 0.1, w, 8.8), L.point(u + 2.6, w + 0.4, 8.6), L.point(u + 0.1, w, 7.1), L.point(u + 2.6, w + 0.4, 7.3)];
    flagQuads.push(tint(quadGeo(q, [0, 1, 1, 1, 0, 0, 1, 0], false), teamCols[k % teamCols.length], 1.1));
  }

  // ---- fences where the dressed ground meets something blocked
  const fenceH = 2.3;
  const post = (u, w) => box(u - 0.06, u + 0.06, w - 0.06, w + 0.06, 0, fenceH + 0.1, steel);
  const panelU = (ua, ub, w) => {   // along u at fixed w
    fenceMesh.push(quadGeo([L.point(ua, w, 0.1), L.point(ub, w, 0.1), L.point(ua, w, fenceH), L.point(ub, w, fenceH)], [0, 0, (ub - ua) / 1.2, 0, 0, 1.9, (ub - ua) / 1.2, 1.9], false));
    box(ua, ub, w - 0.04, w + 0.04, fenceH, fenceH + 0.08, steel);
  };
  const panelW = (u, wa, wb) => {   // along w at fixed u
    fenceMesh.push(quadGeo([L.point(u, wa, 0.1), L.point(u, wb, 0.1), L.point(u, wa, fenceH), L.point(u, wb, fenceH)], [0, 0, (wb - wa) / 1.2, 0, 0, 1.9, (wb - wa) / 1.2, 1.9], false));
    box(u - 0.04, u + 0.04, wa, wb, fenceH, fenceH + 0.08, steel);
  };
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nw; j++) {
      if (state[i * nw + j] !== 1 && !padCells.has(i * nw + j)) continue;
      const { u, w } = cellPos(i, j), h = S / 2;
      const edge = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (const [di, dj] of edge) {
        if (at(i + di, j + dj) !== 0) continue;
        if (padCells.has(i * nw + j) && dj < 0) continue;   // the building side stays open
        if (hash(i * 5 + di, j * 7 + dj, 9) < 0.06) continue;   // an open gate now and then
        if (di) { const uu = u + di * h; panelW(uu, w - h, w + h); post(uu, w - h); post(uu, w + h); post(uu, w); }
        else { const ww = w + dj * h; panelU(u - h, u + h, ww); post(u - h, ww); post(u + h, ww); post(u, ww); }
      }
    }
  }

  // ---- string lights between the lamps over the plaza, flags along the lane side, the entry arch
  for (let i = 0; i < nu - 3; i += 3) {
    for (let j = 0; j < nw - 3; j += 3) {
      if (!isPlaza(i, j) || state[i * nw + j] !== 1) continue;
      const a = cellPos(i, j, S / 2, S / 2);
      for (const [di, dj] of [[3, 0], [0, 3]]) {
        if (state[(i + di) * nw + (j + dj)] !== 1 || !isPlaza(i + di, j + dj)) continue;
        const b = cellPos(i + di, j + dj, S / 2, S / 2);
        for (let k = 1; k < 12; k++) {
          const f = k / 12, p = L.point(a.u + (b.u - a.u) * f, a.w + (b.w - a.w) * f, 5.3 - Math.sin(f * Math.PI) * 0.9);
          bulbs.push(p.x, p.y, p.z);
        }
      }
    }
  }
  const FLAG_H = 10;
  for (let u = u1 - 10, k = 0; u < Math.min(uB, u1 + 70); u += 11, k++) {
    const w = G + 3.4;
    if (!isFree(u, w) || !isFree(u, w + 2)) continue;
    box(u - 0.08, u + 0.08, w - 0.08, w + 0.08, 0, FLAG_H, steel);
    const col = teamCols[k % teamCols.length];
    const q = [L.point(u + 0.1, w, FLAG_H - 0.2), L.point(u + 2.6, w + 0.5, FLAG_H - 0.4), L.point(u + 0.1, w, FLAG_H - 1.9), L.point(u + 2.6, w + 0.5, FLAG_H - 1.7)];
    flagQuads.push(tint(quadGeo(q, [0, 1, 1, 1, 0, 0, 1, 0], false), col, 1.1));
  }
  // PADDOCK CLUB gateway over the central path where it leaves the paddock
  const gate = (() => {
    for (let i = 0; i < nu; i++) if (isPath(i, 0) && i * S + uA > u1 - 20 && state[i * nw + 0] === 1 && state[i * nw + 1] === 1) return cellPos(i, 0);
    return null;
  })();
  if (gate) {
    const gu = gate.u, gw = gate.w + 1;
    box(gu - 4.2, gu - 3.8, gw - 0.2, gw + 0.2, 0, 7, white); box(gu + 3.8, gu + 4.2, gw - 0.2, gw + 0.2, 0, 7, white);
    box(gu - 4.4, gu + 4.4, gw - 0.3, gw + 0.3, 6.2, 7.6, dark);
    const tex = canvasTex(1024, 160, (x, w, h) => {
      x.fillStyle = '#101216'; x.fillRect(0, 0, w, h);
      x.fillStyle = '#e10600'; x.fillRect(0, h - 10, w, 10);
      x.fillStyle = '#f2f2f2'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.font = '700 82px "Titillium Web", sans-serif';
      if ('letterSpacing' in x) x.letterSpacing = '16px';
      x.fillText('PADDOCK CLUB', w / 2, h / 2 - 4);
    }, false);
    const sign = laneSign(L, gu - 4.3, gu + 4.3, gw - 0.34, 6.25, 7.55, [0, 0, 1, 1]);
    g.add(new THREE.Mesh(sign, new THREE.MeshBasicMaterial({ map: tex, color: C(1.1, 1.1, 1.1), side: THREE.DoubleSide })));
    box(gu - 4, gu + 4, gw - 0.2, gw + 0.2, 6.1, 6.2, C(1.5, 0.1, 0.08), lit);
  }

  // ---- people on the plaza (crowd.js decks), a couple of blocks only
  const plazaCells = [];
  for (let i = 0; i < nu; i++) for (let j = 0; j < nw; j++) if (state[i * nw + j] === 1 && isPlaza(i, j) && !isPath(i, j)) plazaCells.push([i, j]);
  for (const k of [0.3, 0.65]) {
    const c = plazaCells[Math.floor(plazaCells.length * k)];
    if (!c) continue;
    const q = cellPos(c[0], c[1]), p = L.point(q.u, q.w, 0.1), { t } = L.frame(q.u);
    out.decks.push({ x: p.x, z: p.z, y: p.y, len: 22, wid: 10, angle: Math.atan2(-t.z, t.x), density: 0.05, tag: 'paddock' });
  }

  // ---- meshes
  const grp = new THREE.Group();
  grp.name = 'paddock-decor';
  const add = (geos, mat, extra = {}) => { if (geos.length) { const m = new THREE.Mesh(mergeGeometries(geos), mat); Object.assign(m, extra); grp.add(m); return m; } };
  const offset = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 };
  add(paving, new THREE.MeshStandardMaterial({ map: pavingTex(), vertexColors: true, roughness: 0.92, emissive: 0x08090a, side: THREE.DoubleSide, ...offset }));
  add(lawn, new THREE.MeshStandardMaterial({ map: lawnTex(), vertexColors: true, roughness: 1, emissive: 0x040a04, side: THREE.DoubleSide, ...offset }));
  add(solid, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.1, emissive: 0x0a0b0d, flatShading: true }));
  add(lit, new THREE.MeshBasicMaterial({ vertexColors: true }));
  add(tents, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, emissive: 0x2a2a2c, side: THREE.DoubleSide }));
  add(flagQuads, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, emissive: 0x181818, side: THREE.DoubleSide }));
  add(fenceMesh, new THREE.MeshBasicMaterial({ map: meshTex(), color: C(0.34, 0.36, 0.4), transparent: true, alphaTest: 0.4, side: THREE.DoubleSide }));
  const poolMesh = add(pools, new THREE.MeshBasicMaterial({ map: glowTex(), color: C(0.5, 0.38, 0.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
  if (poolMesh) poolMesh.renderOrder = 2;

  const points = (arr, size, col) => {
    if (!arr.length) return;
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    grp.add(new THREE.Points(gg, new THREE.PointsMaterial({ map: glowTex(), size, sizeAttenuation: true, color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
  };
  points(glows, 5, C(0.5, 0.42, 0.3));
  points(bulbs, 1.1, C(1.0, 0.8, 0.45));

  // trees: one instanced trunk + canopy per species
  const roundT = trees.filter(t => !t[0]), palmT = trees.filter(t => t[0]);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pp = new THREE.Vector3(), col = new THREE.Color();
  const inst = (geo, mat, list, place, color) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((t, k) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t[4]);
      place(t, pp, sc);
      im.setMatrixAt(k, m4.compose(pp, q, sc));
      if (color) im.setColorAt(k, color(t, col));
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.frustumCulled = false;
    grp.add(im);
  };
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 1, emissive: 0x0a0806 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, emissive: 0x0b1a0b, flatShading: true });
  inst(new THREE.CylinderGeometry(0.16, 0.26, 1, 6).translate(0, 0.5, 0), trunkMat, roundT, (t, p, s) => { p.set(t[1], t[2], t[3]); s.set(1, 3.2 * t[5], 1); });
  inst(new THREE.IcosahedronGeometry(1, 1), leafMat, roundT, (t, p, s) => { p.set(t[1], t[2] + 3.2 * t[5] + 1.0 * t[5], t[3]); s.set(2.2 * t[5], 1.9 * t[5], 2.2 * t[5]); },
    (t, c) => c.setRGB(0.12 + t[6] * 0.1, 0.34 + t[6] * 0.2, 0.12 + t[6] * 0.06));
  inst(new THREE.CylinderGeometry(0.1, 0.2, 1, 6).translate(0, 0.5, 0), trunkMat, palmT, (t, p, s) => { p.set(t[1], t[2], t[3]); s.set(1, 6.5 * t[5], 1); });
  inst(palmCrown(), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, emissive: 0x0b1a0b, side: THREE.DoubleSide }), palmT,
    (t, p, s) => { p.set(t[1], t[2] + 6.5 * t[5], t[3]); s.set(t[5], t[5], t[5]); },
    (t, c) => c.setRGB(0.16 + t[6] * 0.1, 0.42 + t[6] * 0.18, 0.14));
  g.add(grp);
  out.cells = count;
  out.trees = trees.length;
  return out;
}
