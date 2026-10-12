// Trackside dressing for the whole lap, in the spirit of the paddock (paddock.js): everywhere beside
// the circuit that is not road, building, water, grandstand or pit complex gets a promenade of pavers
// with lamp posts, team flags and string lights along the fence, hedges and planters behind it, then
// lawn and garden (trees, palms, shrubs), with a fan zone (marquees, umbrellas and tables, planters,
// a lit gateway) every ~200 m. Text only, no logos.
//
// Ground is laid out on a strip of 8 m cells beside the track: station i along the lap (every 8 m),
// band k outward from the wall (8 m each). A cell is used when its centre and corners are on free
// ground (see `free`). The strings of bulbs, searchlight beams and lamp glows are the lap's light
// show: setShow(level) turns the bulbs to a colour chase and sweeps the beams (fireworks.js drives it).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PIT_LANE, TRACK_HALF_WIDTH } from './config.js';
import { inRing } from './pit.js';
import { QUALITY } from './quality.js';
import { tint } from './garages.js';

const STEP = 8;        // m between stations along the lap
const CELL = 8;        // m between bands
const BANDS = 7;       // cells outward from the wall
const FIRST = 8;       // centre of band 0 beyond the wall line, m
const MAX_ELEV = 3.2;  // no dressing where the circuit rides on bridges and ramps; elsewhere it follows the circuit's own level
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
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
export function glowTex() {
  return canvasTex(64, 64, (x) => {
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  }, false);
}
const pavingTex = () => canvasTex(128, 128, (x, w, h) => {
  x.fillStyle = '#6f7176'; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 500; i++) { const v = 95 + Math.random() * 40 | 0; x.fillStyle = `rgba(${v},${v},${v + 4},0.35)`; x.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  x.strokeStyle = 'rgba(30,31,34,0.7)'; x.lineWidth = 2;
  for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(0, i * h / 4); x.lineTo(w, i * h / 4); x.stroke(); x.beginPath(); x.moveTo(i * w / 4, 0); x.lineTo(i * w / 4, h); x.stroke(); }
});
const lawnTex = () => canvasTex(128, 128, (x, w, h) => {
  x.fillStyle = '#2f5a2d'; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) { const g = 70 + Math.random() * 60 | 0; x.fillStyle = `rgba(${g * 0.5 | 0},${g},${g * 0.4 | 0},0.45)`; x.fillRect(Math.random() * w, Math.random() * h, 2, 3); }
});

// the fan-zone gateway lettering
const SIGNS = ['FAN ZONE', 'MARINA BAY', 'GRID WALK', 'SINGAPORE GP', 'RACE WEEK', 'NIGHT RACE'];
function signAtlas() {
  return canvasTex(1024, 128 * SIGNS.length, (x, w, h) => {
    SIGNS.forEach((s, k) => {
      const y = k * 128;
      x.fillStyle = '#101216'; x.fillRect(0, y, w, 128);
      x.fillStyle = '#e10600'; x.fillRect(0, y + 118, w, 10);
      x.fillStyle = '#f2f2f2'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.font = '700 70px "Titillium Web", sans-serif';
      if ('letterSpacing' in x) x.letterSpacing = '14px';
      x.fillText(s, w / 2, y + 58);
    });
  }, false);
}

// fan of palm fronds drooping from the origin (as paddock.js)
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

// uniform-grid index of 2D items, queried by one point (items are inserted into every cell they reach)
class Grid {
  constructor(cell) { this.cell = cell; this.m = new Map(); }
  add(x0, z0, x1, z1, item) {
    const c = this.cell;
    for (let i = Math.floor(x0 / c); i <= Math.floor(x1 / c); i++) for (let j = Math.floor(z0 / c); j <= Math.floor(z1 / c); j++) {
      const k = i * 100003 + j;
      let l = this.m.get(k); if (!l) this.m.set(k, l = []);
      l.push(item);
    }
  }
  at(x, z) { return this.m.get(Math.floor(x / this.cell) * 100003 + Math.floor(z / this.cell)) || []; }
}

// bulbs, lamp glows and beam cores in one draw call: colour, size and a phase per point. At rest they
// are warm; with the show up they chase through the spectrum along the string
const BULB_VERT = `
  attribute vec3 aColor; attribute float aSize; attribute float aPhase;
  uniform float uTime; uniform float uShow; uniform float uScale;
  varying vec3 vCol;
  vec3 hue(float h){ return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
  void main(){
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float chase = 0.5 + 0.5 * sin(uTime * 7.0 - aPhase * 6.0);
    // aPhase < 0: a steady lamp glow that only brightens a little during the show
    vec3 col = aColor;
    float k = 1.0;
    if (aPhase >= 0.0) {
      vec3 rainbow = mix(vec3(1.0), hue(fract(aPhase * 0.35 - uTime * 0.35)), 0.8) * 1.5;
      col = mix(aColor, rainbow, uShow);
      k = mix(1.0, 0.25 + 1.35 * chase, uShow);
    } else k = 1.0 + 0.5 * uShow;
    vCol = col * k;
    gl_PointSize = clamp(aSize * uScale / -mv.z, 1.0, 46.0);
    gl_Position = projectionMatrix * mv;
  }`;
const BULB_FRAG = `
  uniform sampler2D uMap; varying vec3 vCol;
  void main(){ float a = texture2D(uMap, gl_PointCoord).a; if (a < 0.02) discard; gl_FragColor = vec4(vCol * a, a); }`;

export class TrackDecor {
  constructor(scene, track, city, pit, elevated = new Set()) {
    this.track = track;
    this.elevated = elevated;
    this.group = new THREE.Group();
    this.group.name = 'track-decor';
    this.sites = { around: [], paddock: [], straight: [] };
    this.beams = [];
    this.fans = []; this.archSpots = [];
    this.level = 0; this.target = 0; this.time = 0;
    this.uniforms = { uTime: { value: 0 }, uShow: { value: 0 }, uScale: { value: 400 }, uMap: { value: glowTex() } };
    const t0 = performance.now();
    this.build(city, pit);
    scene.add(this.group);
    this.group.traverse(o => o.layers.set(1));   // not in the water reflection
    this.buildMs = performance.now() - t0;
  }

  // ---- ground queries
  index(city) {
    const tr = this.track;
    // a coarse map of everything within REACH of the circuit (nearest() only looks ~125 m)
    const REACH = 1000, cc = 150, R = Math.ceil(REACH / cc), seen = new Set();
    for (let i = 0; i < tr.n; i += 6) {
      const cx = Math.floor(tr.P[i].x / cc), cz = Math.floor(tr.P[i].z / cc);
      for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) seen.add((cx + a) * 100003 + cz + b);
    }
    this.within = (x, z) => seen.has(Math.floor(x / cc) * 100003 + Math.floor(z / cc));
    this.roads = new Grid(40);
    for (const r of city.roads) {
      const rad = r.w / 2 + 1.2;
      for (let i = 2; i < r.p.length; i += 2) {
        const ax = r.p[i - 2], az = -r.p[i - 1], bx = r.p[i], bz = -r.p[i + 1];
        if (!this.within((ax + bx) / 2, (az + bz) / 2)) continue;
        this.roads.add(Math.min(ax, bx) - rad, Math.min(az, bz) - rad, Math.max(ax, bx) + rad, Math.max(az, bz) + rad, [ax, az, bx, bz, rad]);
      }
    }
    this.blds = new Grid(40);
    for (const b of city.buildings) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let i = 0; i < b.p.length; i += 2) { x0 = Math.min(x0, b.p[i]); x1 = Math.max(x1, b.p[i]); z0 = Math.min(z0, -b.p[i + 1]); z1 = Math.max(z1, -b.p[i + 1]); }
      if (!this.within((x0 + x1) / 2, (z0 + z1) / 2)) continue;
      this.blds.add(x0 - 3, z0 - 3, x1 + 3, z1 + 3, { p: b.p, x0, x1, z0, z1 });
    }
    this.water = city.water.map(p => {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, -p[i + 1]); z1 = Math.max(z1, -p[i + 1]); }
      return { p, x0, x1, z0, z1 };
    });
  }
  inWater(x, z) {
    let n = 0;
    for (const w of this.water) if (x >= w.x0 && x <= w.x1 && z >= w.z0 && z <= w.z1 && inRing(w.p, x, -z)) n++;
    return n & 1;
  }
  onRoad(x, z) {
    for (const [ax, az, bx, bz, r] of this.roads.at(x, z)) {
      const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      if (Math.hypot(x - ax - dx * t, z - az - dz * t) < r) return true;
    }
    return false;
  }
  inBuilding(x, z) {
    for (const b of this.blds.at(x, z)) {
      if (x > b.x0 - 3 && x < b.x1 + 3 && z > b.z0 - 3 && z < b.z1 + 3) {
        if (inRing(b.p, x, -z)) return true;
        const p = b.p;   // a footprint corner poking into the cell
        for (let i = 0; i < p.length; i += 2) if (Math.abs(p[i] - x) < 5 && Math.abs(-p[i + 1] - z) < 5) return true;
      }
    }
    return false;
  }
  free(x, z) {
    return !this.onRoad(x, z) && !this.inBuilding(x, z) && !this.inWater(x, z);
  }

  build(city, pit) {
    const tr = this.track, n = tr.n, hi = QUALITY.level === 'high';
    this.index(city);
    const L = tr.lane, G = PIT_LANE.garage;
    // the pit complex and paddock dressing own the ground around the pit building
    const pitC = (L && pit && pit.span) ? L.point((pit.span.u0 + pit.span.u1) / 2, G + 30) : null;
    const nearPit = (x, z) => pitC && Math.hypot(x - pitC.x, z - pitC.z) < 230;
    const standBlock = (x, z) => (tr.stands || []).some(s => Math.hypot(s.p.x - x, s.p.z - z) < s.r);
    const pitSide = tr.lane ? tr.pitSide : 0;
    const pitLaneNear = i => {
      for (let k = -50; k <= 50; k += 5) if (Number.isFinite(tr.laneD[((i + k) % n + n) % n])) return true;
      return false;
    };

    // ---- collected geometry and instances
    const paving = [], lawn = [], hedges = [], shrubs = [], solid = [], lit = [], flags = [], tents = [], signs = [];
    const inst = { roundTree: [], palm: [], lamp: [], pole: [], umbrella: [], marquee: [], planter: [], bollard: [] };
    const glow = [];   // x, y, z, r, g, b, size, phase
    const white = C(0.86, 0.87, 0.9), steel = C(0.3, 0.32, 0.36), warm = C(1.0, 0.82, 0.58);
    const teamCols = [C(0.9, 0.08, 0.06), C(0.1, 0.25, 0.9), C(1.0, 0.5, 0.0), C(0.0, 0.8, 0.7), C(0.9, 0.9, 0.92), C(0.0, 0.55, 0.3), C(0.55, 0.1, 0.8), C(0.95, 0.75, 0.0)];
    const green = r => C(0.1 + r * 0.06, 0.3 + r * 0.16, 0.1 + r * 0.05);
    const quad = (pts, uvs) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flatMap(v => [v.x, v.y, v.z]), 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(pts.flatMap(() => [0, 1, 0]), 3));
      g.setIndex([0, 1, 2, 1, 3, 2]);
      return g;
    };

    const occupied = new Set();
    const v = new THREE.Vector3();
    const stations = [];    // per station: { i, side, cells: [{k, x, z, ok}] }
    const free = new Map();   // `${i}|${side}|${k}` -> cell centre

    const stepI = Math.max(1, Math.round(STEP / tr.bin));
    // ---- pass 1: which cells are free. A cell is `full` when its centre and corners are all clear;
    // when only the centre is (a pavement, a gap between a road and a wall) it takes small items
    const pts5 = [[0, 0], [3.4, 3.4], [-3.4, 3.4], [3.4, -3.4], [-3.4, -3.4]];
    for (let i = 0; i < n; i += stepI) {
      if (tr.underDeck(i, 25) || tr.P[i].y - 0.18 > MAX_ELEV) continue;
      for (const side of [1, -1]) {
        if (side === pitSide && pitLaneNear(i)) continue;
        const wall = tr.wallAt(i, side);
        for (let k = 0; k < BANDS; k++) {
          const o = wall + FIRST + k * CELL;
          tr.at(i, side * o, 0, v);
          const x = v.x, z = v.z;
          if (nearPit(x, z) || standBlock(x, z)) break;
          if (tr.nearest(x, z).d <= o - 3 || !this.free(x, z)) continue;
          const key = Math.floor(x / 5) * 100003 + Math.floor(z / 5);
          if (occupied.has(key)) continue;
          occupied.add(key);
          free.set(`${i}|${side}|${k}`, { x, z, o, full: pts5.every(([a, b]) => this.free(x + a, z + b)) });
        }
      }
    }
    const has = (i, side, k) => { const c = free.get(`${((i % n) + n) % n}|${side}|${k}`); return !!c && c.full; };
    const any = (i, side, k) => free.has(`${((i % n) + n) % n}|${side}|${k}`);

    // ---- pass 2: dress the free cells
    let m = 0, fanLast = -999;
    const prevPole = { 1: null, '-1': null };
    for (let i = 0; i < n; i += stepI, m++) {
      const T = tr.T[i], N = tr.N[i], yaw = Math.atan2(-T.z, T.x), gy = tr.P[i].y - 0.18;
      for (const side of [1, -1]) {
            const pt = (dx, dz, y = 0, k = 0) => {
          const c = free.get(`${i}|${side}|${k}`);
          const base = tr.at(i, side * c.o, 0, new THREE.Vector3());
          return new THREE.Vector3(base.x + T.x * dx + N.x * side * dz, gy + y, base.z + T.z * dx + N.z * side * dz);
        };
        const tile = (k, dz0, dz1, y, list, col) => {
          const a = pt(-STEP / 2, dz0, y, k), b = pt(STEP / 2, dz0, y, k), c = pt(-STEP / 2, dz1, y, k), d = pt(STEP / 2, dz1, y, k);
          list.push(tint(quad([a, b, c, d], [0, 0, 2, 0, 0, 2, 2, 2]), col));
        };
        // a fan zone: five stations of paved plaza in bands 1-4, one per ~210 m, alternating sides
        if (!any(i, side, 0)) prevPole[side] = null;
        const zone = Math.floor(m / 26), zpos = m % 26;
        const inFan = zpos >= 4 && zpos < 9 && (zone & 1) === (side > 0 ? 0 : 1) && [1, 2, 3, 4].every(k => has(i, side, k));
        if (inFan && zpos === 4) {
          // gateway over the promenade, lettered on both faces, with a searchlight beside it
          const g0 = pt(0, -3.8, 0, 1), g1 = pt(0, 3.8, 0, 1);
          const sgn = (zone + (side > 0 ? 0 : 3)) % SIGNS.length;
          for (const p of [g0, g1]) solid.push(tint(new THREE.BoxGeometry(0.4, 7, 0.4).translate(p.x, p.y + 3.5, p.z), white));
          const mid = g0.clone().add(g1).multiplyScalar(0.5), len = g0.distanceTo(g1) + 1;
          const ang = Math.atan2(g1.x - g0.x, g1.z - g0.z);
          solid.push(tint(new THREE.BoxGeometry(0.5, 1.5, len).rotateY(ang).translate(mid.x, mid.y + 6.6, mid.z), C(0.07, 0.075, 0.09)));
          const face = new THREE.PlaneGeometry(len - 0.4, 1.3);
          const uv = face.attributes.uv; for (let q = 0; q < uv.count; q++) uv.setY(q, (SIGNS.length - 1 - sgn + uv.getY(q)) / SIGNS.length);
          face.rotateY(Math.atan2(T.x, T.z));
          signs.push(face.clone().translate(mid.x + T.x * 0.3, mid.y + 6.6, mid.z + T.z * 0.3), face.clone().rotateY(Math.PI).translate(mid.x - T.x * 0.3, mid.y + 6.6, mid.z - T.z * 0.3));
          lit.push(tint(new THREE.BoxGeometry(0.2, 0.2, len).rotateY(ang).translate(mid.x, mid.y + 5.8, mid.z), C(1.5, 0.1, 0.08)));
          glow.push(mid.x, mid.y + 6.0, mid.z, 1.0, 0.25, 0.2, 7, -1);
          this.fans.push({ x: mid.x, y: mid.y, z: mid.z });
          this.beamAt(pt(0, 4, 0, 4), side, hash(m, side, 70));
        }
        for (let k = 0; k < BANDS; k++) {
          if (!any(i, side, k)) continue;
          const c = free.get(`${i}|${side}|${k}`);
          const P = (dx = 0, dz = 0) => pt(dx, dz, 0, k);
          if (!c.full) {
            // a pavement or a gap: small items only
            const q1 = hash(i, side * 7 + k, 11), q2 = hash(i, side * 7 + k, 12);
            const p = P();
            if (q1 < 0.22) inst.lamp.push([p.x, p.y, p.z, yaw, 1]), glow.push(p.x, p.y + 5.4, p.z, 0.8, 0.66, 0.46, 5, -1);
            else if (q1 < 0.5) { inst.planter.push([p.x, p.y, p.z, yaw, 1, green(q2)]); if (q2 > 0.5) inst.roundTree.push([p.x, p.y, p.z, q2 * 6.28, 0.6 + q2 * 0.3, q2]); }
            else if (q1 < 0.62) { inst.bollard.push([p.x, p.y, p.z, yaw, 1]); glow.push(p.x, p.y + 0.95, p.z, 1.0, 0.5, 0.2, 1.1, m * 0.21); }
            continue;
          }
          const r1 = hash(i, side * 7 + k, 1), r2 = hash(i, side * 7 + k, 2), r3 = hash(i, side * 7 + k, 3);
          const vv = 0.85 + 0.3 * r1;
          const plaza = k === 0 || (inFan && k <= 4);
          const col = C(vv, vv, vv);
          tile(k, -CELL / 2, CELL / 2, 0.06, plaza ? paving : lawn, col);
          if (k === 0) {
            // promenade: lamp posts, team flags on poles with strings of bulbs between them, bollards
            if (m % 3 === 0) { const p = P(0, 3); inst.lamp.push([p.x, p.y, p.z, yaw, 1]); glow.push(p.x, p.y + 5.4, p.z, 0.8, 0.66, 0.46, 5, -1); }
            if (m % 4 === 1) {
              const p = P(0, -2.4);
              inst.pole.push([p.x, p.y, p.z, yaw, 1, teamCols[(m / 4 | 0) % teamCols.length]]);
              const top = new THREE.Vector3(p.x, p.y + 9.6, p.z), pr = prevPole[side];
              if (pr && pr.distanceTo(top) < STEP * 4 + 6) {
                const cnt = 13;
                for (let q = 1; q < cnt; q++) {
                  const f = q / cnt, w = pr.clone().lerp(top, f);
                  w.y -= Math.sin(f * Math.PI) * 1.1;
                  glow.push(w.x, w.y, w.z, 1.0, 0.78, 0.42, 1.0, (m * 0.37 + f * 4 + side));
                }
              }
              prevPole[side] = top;
            }
            if (m % 2 === 0) { const p = P(0, -4); inst.bollard.push([p.x, p.y, p.z, yaw, 1]); glow.push(p.x, p.y + 0.95, p.z, 1.0, 0.5, 0.2, 1.1, m * 0.21); }
            continue;
          }
          if (k === 1 && !inFan) {
            // behind the promenade: hedge runs and planters with small trees
            if (r2 < 0.5) hedges.push([P().x, P().y, P().z, yaw, STEP - 0.6, 1.0 + r1 * 0.4, 1.4, green(r1)]);
            else if (r2 < 0.8) { const p = P(0, (r3 - 0.5) * 2); inst.planter.push([p.x, p.y, p.z, yaw, 1, green(r3)]); if (r3 > 0.55) inst.roundTree.push([p.x, p.y, p.z, r1 * 6.28, 0.7 + r3 * 0.4, r3]); }
            if (m % 4 === 2) { const p = P(2, 3); inst.lamp.push([p.x, p.y, p.z, yaw, 1]); glow.push(p.x, p.y + 5.4, p.z, 0.8, 0.66, 0.46, 5, -1); }
            continue;
          }
          if (inFan) {
            // fan zone: marquees, umbrellas with tables, planters, lamps
            if (r2 < 0.2 && k >= 2 && k <= 3 && (m & 1) === 0) {
              const p = P(); inst.marquee.push([p.x, p.y, p.z, yaw, 1]); glow.push(p.x, p.y + 2.3, p.z, 1.0, 0.8, 0.5, 5.5, -1);
            } else if (r2 < 0.62) {
              for (const [dx, dz] of [[-1.5, -1.3], [1.7, 1.5]]) { const p = P(dx, dz); inst.umbrella.push([p.x, p.y, p.z, yaw, 1, hash(i, k, 5) > 0.5 ? white : teamCols[(r3 * 99 | 0) % teamCols.length]]); }
            } else if (r2 < 0.82) { const p = P((r3 - 0.5) * 2, (r1 - 0.5) * 2); inst.planter.push([p.x, p.y, p.z, yaw, 1, green(r3)]); if (r3 > 0.6) inst.palm.push([p.x, p.y, p.z, r1 * 6.28, 0.8 + r3 * 0.4, r3]); }
            if ((m + k) % 4 === 0) { const p = P(3, 3); inst.lamp.push([p.x, p.y, p.z, yaw, 1]); glow.push(p.x, p.y + 5.4, p.z, 0.8, 0.66, 0.46, 5, -1); }
            continue;
          }
          // garden: trees, palms, shrub clumps, the odd lamp
          if (r2 < (hi ? 0.5 : 0.32)) {
            const p = P((r1 - 0.5) * 4, (r3 - 0.5) * 4);
            if (r3 > 0.62) inst.palm.push([p.x, p.y, p.z, r1 * 6.28, 0.8 + r1 * 0.5, r1]); else inst.roundTree.push([p.x, p.y, p.z, r1 * 6.28, 0.8 + r1 * 0.7, r1]);
            if (r1 > 0.4) glow.push(p.x, p.y + 0.35, p.z, 0.5, 0.42, 0.3, 4, -1);    // uplighter at the trunk
          } else if (r2 < 0.68) {
            for (const [dx, dz, rr] of [[-1.2, 0, 1.0 + r1 * 0.6], [1.4, 1.0, 0.8 + r3 * 0.5]]) { const p = P(dx, dz); shrubs.push([p.x, p.y, p.z, rr, green(r1)]); }
          } else if (r2 < 0.78) { const p = P(); hedges.push([p.x, p.y, p.z, yaw, STEP - 0.8, 1.1 + r1 * 0.4, 1.2, green(r1)]); }
          if (r2 > 0.9 && k >= 2 && m % 3 === 0) { const p = P(2, 2); inst.lamp.push([p.x, p.y, p.z, yaw, 1]); glow.push(p.x, p.y + 5.4, p.z, 0.8, 0.66, 0.46, 5, -1); }
        }
        // searchlight and launch sites on the outer free cell of some stations
        if (m % 10 === 5) {
          let kk = 0; while (kk + 1 < BANDS && has(i, side, kk + 1)) kk++;
          if (kk >= 1) {
            const p = pt(0, 0, 0, kk);
            this.sites.around.push({ x: p.x, y: p.y, z: p.z, s: tr.S[i], side });
            if (m % 30 === 5) this.beamAt(p, side, hash(m, side, 71));
          }
        }
      }
    }

    // ---- along the wall: team pennant poles with bulb strings between them
    const stepA = Math.max(1, Math.round(18 / tr.bin));
    for (const side of [1, -1]) {
      let prev = null, j = 0;
      for (let i = stepA >> 1; i < n; i += stepA, j++) {
        const y = tr.P[i].y - 0.18;
        if (tr.underDeck(i, 10) || y > MAX_ELEV || tr.pitGap(i, side) || (side === pitSide && pitLaneNear(i))) { prev = null; continue; }
        tr.at(i, side * (tr.wallAt(i, side) + 2.8), 0, v);
        if (this.inBuilding(v.x, v.z) || this.inWater(v.x, v.z) || standBlock(v.x, v.z) || nearPit(v.x, v.z)) { prev = null; continue; }
        inst.pole.push([v.x, y, v.z, Math.atan2(-tr.T[i].z, tr.T[i].x), 1, teamCols[(j + (side > 0 ? 3 : 0)) % teamCols.length]]);
        const top = new THREE.Vector3(v.x, y + 9.6, v.z);
        if (prev && prev.distanceTo(top) < stepA * tr.bin + 4) {
          for (let q = 1; q < 15; q++) {
            const f = q / 15, w = prev.clone().lerp(top, f);
            w.y -= Math.sin(f * Math.PI) * 1.3;
            glow.push(w.x, w.y, w.z, 1.0, 0.78, 0.42, 1.0, j * 0.6 + f * 4 + (side > 0 ? 0 : 2));
          }
        }
        glow.push(v.x, y + 0.5, v.z, 0.5, 0.42, 0.3, 4, -1);   // uplight at the pole foot
        prev = top;
      }
    }

    // ---- light arches over straight stretches: rings of bulbs every 7 m that chase in a show
    const archPal = [[1.0, 0.3, 0.2], [0.3, 0.6, 1.0], [1.0, 0.7, 0.2], [0.4, 1.0, 0.6], [0.8, 0.35, 1.0], [1.0, 1.0, 0.9]];
    const gates = [0, ...(tr.specialGantries || [])];
    const nearIdx = (i, j) => Math.min(Math.abs(i - j), n - Math.abs(i - j));
    const stepArch = Math.max(2, Math.round(7 / tr.bin)), spanSamples = stepArch * 6;
    const straight = i => {
      for (let k = -spanSamples - 8; k <= spanSamples + 8; k += 4) {
        const j = ((i + k) % n + n) % n;
        if (Math.abs(tr.curv[j]) > 0.004 || tr.underDeck(j, 20) || tr.P[j].y - 0.18 > MAX_ELEV || gates.some(g => nearIdx(j, g) < 30)) return false;
      }
      return true;
    };
    const nGroups = QUALITY.level === 'high' ? 16 : 10;
    let placed = 0;
    for (let g = 0; g < nGroups; g++) {
      const target = Math.round((g + 0.37) * n / nGroups);
      let at = -1;
      for (let d = 0; d < n / nGroups / 2 && at < 0; d += 4) for (const sgn of [1, -1]) if (at < 0 && straight(((target + sgn * d) % n + n) % n)) at = ((target + sgn * d) % n + n) % n;
      if (at < 0) continue;
      placed++;
      this.archSpots.push({ x: tr.P[at].x, y: tr.P[at].y, z: tr.P[at].z });
      const col = archPal[g % archPal.length];
      for (let a = 0; a < 6; a++) {
        const ii = (at + a * stepArch) % n, base = tr.P[ii].y - 0.18;
        for (let q = 0; q <= 26; q++) {
          const th = q / 26 * Math.PI, lat = Math.cos(th) * (TRACK_HALF_WIDTH + 2.2), h = 0.6 + Math.sin(th) * 8.6;
          tr.at(ii, lat, 0, v);
          glow.push(v.x, base + h, v.z, col[0], col[1], col[2], 1.15, g * 0.7 + a * 0.9 + th * 0.5);
        }
      }
    }
    this.arches = placed;

    // ---- city trees: avenues along the public roads and scattered through the parks
    const treeCap = hi ? 4500 : 2200;
    let nStreet = 0;
    const cityTree = (x, z, rr, kind) => {
      if (this.onRoad(x, z) || this.inBuilding(x, z) || this.inWater(x, z) || tr.nearest(x, z).d < 24) return false;
      (kind ? inst.palm : inst.roundTree).push([x, 0, z, rr * 6.28, kind ? 0.8 + rr * 0.5 : 0.7 + rr * 0.6, rr]);
      return true;
    };
    for (const r of city.roads) {
      if (r.k === 'service' || r.k === 'motorway' || r.k === 'link' || r.k === 'trunk' || r.w < 6 || nStreet >= treeCap) continue;
      const p = r.p;
      let carry = 8, side = 1;
      for (let i = 2; i < p.length; i += 2) {
        const ax = p[i - 2], ay = p[i - 1], bx = p[i], by = p[i + 1], Ln = Math.hypot(bx - ax, by - ay);
        if (!Ln || !this.within((ax + bx) / 2, -(ay + by) / 2)) continue;
        const tx = (bx - ax) / Ln, ty = (by - ay) / Ln, off = r.w / 2 + 2.4, every = r.k === 'primary' ? 14 : 20;
        for (let d = carry; d < Ln; d += every) {
          const x = ax + tx * d - ty * off * side, y = ay + ty * d + tx * off * side;
          if (!this.elevated.has(`${Math.round(ax + tx * d)},${Math.round(ay + ty * d)}`) && cityTree(x, -y, hash(Math.round(x), Math.round(y), 31), r.k === 'primary' && hash(Math.round(y), Math.round(x), 32) > 0.55 ? 1 : 0)) nStreet++;
          side = -side;
        }
        carry = ((carry - Ln) % every + every) % every;
      }
    }
    let nPark = 0;
    for (const ring of city.parks) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = 0; i < ring.length; i += 2) { x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]); y0 = Math.min(y0, ring[i + 1]); y1 = Math.max(y1, ring[i + 1]); }
      if (!this.within((x0 + x1) / 2, -(y0 + y1) / 2) || nPark >= treeCap) continue;
      const sp = 15;
      for (let x = x0; x < x1; x += sp) for (let y = y0; y < y1; y += sp) {
        const jx = x + hash(Math.round(x), Math.round(y), 41) * sp, jy = y + hash(Math.round(y), Math.round(x), 42) * sp;
        if (hash(Math.round(jx), Math.round(jy), 43) > 0.55 || !inRing(ring, jx, jy)) continue;
        if (cityTree(jx, -jy, hash(Math.round(jx), Math.round(jy), 44), hash(Math.round(jy), Math.round(jx), 45) > 0.8 ? 1 : 0)) nPark++;
      }
    }
    this.cityTrees = nStreet + nPark;

    // rockets also go up from behind the wall where there is no free cell: keep ~60 launch sites around the lap
    for (let i = 0, j = 0; i < n && this.sites.around.length < 60; i += Math.round(90 / tr.bin), j++) {
      if (tr.underDeck(i, 20)) continue;
      const side = j & 1 ? 1 : -1;
      tr.at(i, side * (tr.wallAt(i, side) + 22), 0, v);
      if (!this.inWater(v.x, v.z) && !nearPit(v.x, v.z)) this.sites.around.push({ x: v.x, y: tr.P[i].y - 0.18, z: v.z, s: tr.S[i], side });
    }

    // ---- meshes
    const lit1 = new THREE.MeshBasicMaterial({ vertexColors: true });
    const grp = this.group;
    const offset = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 };
    const add = (geos, mat) => { if (geos.length) { const mesh = new THREE.Mesh(mergeGeometries(geos), mat); grp.add(mesh); return mesh; } };
    add(paving, new THREE.MeshStandardMaterial({ map: pavingTex(), vertexColors: true, roughness: 0.92, emissive: 0x08090a, side: THREE.DoubleSide, ...offset }));
    add(lawn, new THREE.MeshStandardMaterial({ map: lawnTex(), vertexColors: true, roughness: 1, emissive: 0x040a04, side: THREE.DoubleSide, ...offset }));
    add(solid, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.1, emissive: 0x0a0b0d, flatShading: true }));
    add(lit, lit1);
    if (signs.length) {
      const sg = mergeGeometries(signs);
      grp.add(new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ map: signAtlas(), color: C(1.1, 1.1, 1.1), side: THREE.DoubleSide })));
    }

    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pp = new THREE.Vector3(), cc = new THREE.Color();
    const Y = new THREE.Vector3(0, 1, 0);
    // list items: [x, y, z, yaw, scale, colour?]; trees: [x, y, z, yaw, scale, shade]
    const instances = (geo, mat, list, scaleOf, colorOf) => {
      if (!list.length) return null;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((t, k) => {
        q.setFromAxisAngle(Y, t[3]);
        const s = scaleOf ? scaleOf(t) : [t[4], t[4], t[4]];
        pp.set(t[0], t[1], t[2]); sc.set(...s);
        im.setMatrixAt(k, m4.compose(pp, q, sc));
        if (colorOf) im.setColorAt(k, colorOf(t, cc));
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.frustumCulled = false;
      grp.add(im);
      return im;
    };
    const stdSolid = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.1, emissive: 0x0a0b0d, flatShading: true, vertexColors: true });
    const geoOf = (parts) => mergeGeometries(parts.map(([g, c]) => tint(g.toNonIndexed(), c)));
    const steelC = steel, darkC = C(0.16, 0.17, 0.2);
    // lamp post: pole, arm, lit head (two meshes sharing the placements)
    instances(geoOf([[new THREE.CylinderGeometry(0.07, 0.1, 5.6, 6).translate(0, 2.8, 0), steelC], [new THREE.BoxGeometry(1.0, 0.12, 0.24).translate(0, 5.6, 0), steelC]]), stdSolid, inst.lamp);
    instances(tint(new THREE.BoxGeometry(0.9, 0.12, 0.4).translate(0, 5.45, 0), C(1.9, 1.6, 1.15)), lit1, inst.lamp);
    // flag pole with a pennant in a team colour
    instances(geoOf([[new THREE.CylinderGeometry(0.06, 0.1, 9.8, 6).translate(0, 4.9, 0), steelC]]), stdSolid, inst.pole);
    instances(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0.08, 9.4, 0, 2.6, 9.0, 0.5, 0.08, 7.6, 0, 2.6, 9.0, 0.5, 2.6, 8.2, 0.5, 0.08, 7.6, 0], 3)).setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3)),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, emissive: 0x181818, side: THREE.DoubleSide }), inst.pole, null, (t, c) => c.copy(t[5]).multiplyScalar(1.1));
    // bollards with a glow band
    instances(geoOf([[new THREE.CylinderGeometry(0.16, 0.2, 0.9, 8).translate(0, 0.45, 0), C(0.22, 0.24, 0.28)]]), stdSolid, inst.bollard);
    instances(tint(new THREE.CylinderGeometry(0.17, 0.17, 0.12, 8).translate(0, 0.95, 0), C(2.0, 0.8, 0.3)), lit1, inst.bollard);
    // umbrella with a table and four chairs
    instances(geoOf([[new THREE.CylinderGeometry(0.04, 0.04, 2.5, 5).translate(0, 1.25, 0), steelC], [new THREE.CylinderGeometry(0.55, 0.55, 0.78, 10).translate(0, 0.39, 0), darkC],
      ...[[1.3, 0], [-1.3, 0], [0, 1.3], [0, -1.3]].map(([a, b]) => [new THREE.CylinderGeometry(0.22, 0.22, 0.45, 8).translate(a, 0.225, b), C(0.9, 0.9, 0.92)])]), stdSolid, inst.umbrella);
    instances(new THREE.ConeGeometry(1.7, 0.7, 8, 1, true).translate(0, 2.85, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, emissive: 0x2a2a2c, side: THREE.DoubleSide }), inst.umbrella, null, (t, c) => c.copy(t[5]));
    // marquee: white body, gabled roof, warm lit panels
    instances(geoOf([[new THREE.BoxGeometry(5, 2.7, 5).translate(0, 1.35, 0), C(0.82, 0.83, 0.85)], [new THREE.ConeGeometry(4.3, 2.2, 4).rotateY(Math.PI / 4).translate(0, 3.8, 0), C(0.93, 0.94, 0.96)]]),
      new THREE.MeshStandardMaterial({ roughness: 0.9, emissive: 0x2a2a2c, vertexColors: true }), inst.marquee);
    instances(geoOf([[new THREE.BoxGeometry(4.2, 2.1, 0.06).translate(0, 1.4, 2.53), warm], [new THREE.BoxGeometry(4.2, 2.1, 0.06).translate(0, 1.4, -2.53), warm]]), lit1, inst.marquee);
    // planters
    instances(geoOf([[new THREE.BoxGeometry(2.4, 0.7, 2.4).translate(0, 0.35, 0), white]]), stdSolid, inst.planter);
    instances(new THREE.IcosahedronGeometry(0.95, 1).translate(0, 1.2, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, emissive: 0x0b1a0b, flatShading: true }), inst.planter, null, (t, c) => c.copy(t[5]));
    // hedges and shrubs
    if (hedges.length) instances(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0x081208, flatShading: true }), hedges, t => [t[4], t[5], t[6]], (t, c) => c.copy(t[7]));
    if (shrubs.length) instances(new THREE.IcosahedronGeometry(1, 1).translate(0, 0.75, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, emissive: 0x0b1a0b, flatShading: true }), shrubs.map(t => [t[0], t[1], t[2], 0, t[3], t[4]]), t => [t[4], t[4] * 0.8, t[4]], (t, c) => c.copy(t[5]));
    // trees
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 1, emissive: 0x0a0806 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, emissive: 0x0b1a0b, flatShading: true });
    const R = inst.roundTree.map(t => [t[0], t[1], t[2], t[3], t[4], t[5]]), P = inst.palm.map(t => [t[0], t[1], t[2], t[3], t[4], t[5]]);
    instances(new THREE.CylinderGeometry(0.16, 0.26, 1, 6).translate(0, 0.5, 0), trunkMat, R, t => [1, 3.2 * t[4], 1]);
    instances(new THREE.IcosahedronGeometry(1, 1), leafMat, R.map(t => [t[0], t[1] + 4.2 * t[4], t[2], t[3], t[4], t[5]]), t => [2.2 * t[4], 1.9 * t[4], 2.2 * t[4]], (t, c) => c.setRGB(0.12 + t[5] * 0.1, 0.34 + t[5] * 0.2, 0.12 + t[5] * 0.06));
    instances(new THREE.CylinderGeometry(0.1, 0.2, 1, 6).translate(0, 0.5, 0), trunkMat, P, t => [1, 6.5 * t[4], 1]);
    instances(palmCrown(), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, emissive: 0x0b1a0b, side: THREE.DoubleSide }), P.map(t => [t[0], t[1] + 6.5 * t[4], t[2], t[3], t[4], t[5]]), null, (t, c) => c.setRGB(0.16 + t[5] * 0.1, 0.42 + t[5] * 0.18, 0.14));

    // glows, bulbs: one Points object
    if (glow.length) {
      const cnt = glow.length / 8, pos = new Float32Array(cnt * 3), col = new Float32Array(cnt * 3), size = new Float32Array(cnt), ph = new Float32Array(cnt);
      for (let j = 0; j < cnt; j++) {
        const b = j * 8;
        pos.set([glow[b], glow[b + 1], glow[b + 2]], j * 3); col.set([glow[b + 3], glow[b + 4], glow[b + 5]], j * 3); size[j] = glow[b + 6]; ph[j] = glow[b + 7];
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
      geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
      geo.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
      const pts = new THREE.Points(geo, new THREE.ShaderMaterial({
        uniforms: this.uniforms, vertexShader: BULB_VERT, fragmentShader: BULB_FRAG,
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      }));
      pts.frustumCulled = false;
      grp.add(pts);
      this.bulbs = cnt;
    }
    this.buildBeams();
    this.cells = free.size;
  }

  // ---- searchlight beams: a slim additive cone from the ground; at rest a faint steady column, in a
  // show they sweep and shift colour
  beamAt(p, side, rnd) {
    this.beams.push({ x: p.x, y: p.y, z: p.z, side, yaw: rnd * 6.28, speed: (rnd > 0.5 ? 1 : -1) * (0.35 + rnd * 0.4), tilt: 0.25 + rnd * 0.25, hue: rnd });
  }
  buildBeams() {
    const cnt = this.beams.length;
    if (!cnt) return;
    const H = 320;
    const geo = new THREE.CylinderGeometry(13, 0.5, H, 14, 1, true).translate(0, H / 2, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uInt: { value: 0.06 } },
      vertexShader: `varying float vH; varying vec3 vN; varying vec3 vV; varying vec3 vC;
        void main(){
          vH = position.y / ${H.toFixed(1)};
          mat4 M = modelMatrix * instanceMatrix;
          vN = normalize(mat3(M) * normal);
          vec4 wp = M * vec4(position, 1.0);
          vV = normalize(cameraPosition - wp.xyz);
          #ifdef USE_INSTANCING_COLOR
            vC = instanceColor;
          #else
            vC = vec3(1.0);
          #endif
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `uniform float uInt; varying float vH; varying vec3 vN; varying vec3 vV; varying vec3 vC;
        void main(){
          float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
          float a = pow(clamp(1.0 - vH, 0.0, 1.0), 1.3) * edge * uInt;
          gl_FragColor = vec4(vC * a, 1.0);
        }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, cnt);
    mesh.frustumCulled = false;
    mesh.layers.set(1);
    this.beamMesh = mesh; this.beamMat = mat;
    this.group.add(mesh);
    this.updateBeams(0);
  }
  updateBeams(dt) {
    if (!this.beamMesh) return;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), qy = new THREE.Quaternion(), qx = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3(), col = new THREE.Color();
    const Y = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0), lvl = this.level;
    this.beams.forEach((b, j) => {
      b.yaw += b.speed * dt * (0.25 + 2.2 * lvl);
      qy.setFromAxisAngle(Y, b.yaw);
      qx.setFromAxisAngle(X, b.tilt * (0.15 + 0.85 * lvl) + Math.sin(this.time * 0.9 + j) * 0.06 * lvl);
      q.copy(qy).multiply(qx);
      pos.set(b.x, b.y, b.z);
      this.beamMesh.setMatrixAt(j, m4.compose(pos, q, sc));
      const h = (b.hue + this.time * 0.08 * lvl) % 1;
      col.setHSL(h, 0.85, 0.55);
      this.beamMesh.setColorAt(j, lvl > 0.02 ? col.multiplyScalar(2.2) : col.setRGB(0.9, 0.85, 0.7));
    });
    this.beamMesh.instanceMatrix.needsUpdate = true;
    if (this.beamMesh.instanceColor) this.beamMesh.instanceColor.needsUpdate = true;
    this.beamMat.uniforms.uInt.value = 0.06 + 0.94 * lvl;
  }

  // 0..1: how far the lap's light show is up (bulbs colour-chase, beams sweep)
  setShow(level) { this.target = Math.max(0, Math.min(1, level)); }

  update(dt, viewH) {
    this.time += dt;
    this.level += (this.target - this.level) * (1 - Math.exp(-dt * (this.target > this.level ? 2.5 : 0.6)));
    if (Math.abs(this.level - this.target) < 0.002) this.level = this.target;
    const u = this.uniforms;
    u.uTime.value = this.time; u.uShow.value = this.level; u.uScale.value = viewH / 2;
    this.updateBeams(dt);
  }
}
