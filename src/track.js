// Circuit geometry, sampled every ~2 m from the same smooth curve the cars are positioned on.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const HALF = 7.0;           // half track width (m)
const LIFT = 0.18;          // track surface above ground
const WALL = HALF + 3.2;    // concrete wall offset
export const TRACK_HALF = HALF;

function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// Painted layers sit a few cm above the asphalt; polygon offset keeps them from flickering at range.
function decal(mat) {
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -2;
  mat.polygonOffsetUnits = -4;
  return mat;
}

// Fictional trackside sponsors, one 256 px board each in a 2048 px strip.
const BOARDS = [
  { bg: '#e10600', fg: '#ffffff', text: 'SINGAPORE GP', style: 'italic 900' },
  { bg: '#ffd400', fg: '#111111', text: 'APEX TYRES', style: '900' },
  { bg: '#0b6b3a', fg: '#ffffff', text: 'MARINA', style: '700', mark: '#ffffff' },
  { bg: '#0d1520', fg: '#22d3ee', text: 'NIGHTLINE', style: 'italic 700' },
  { bg: '#f4f4f4', fg: '#d50f25', text: 'LION CITY', style: '900' },
  { bg: '#16307a', fg: '#fbbf24', text: 'SG AIRWAYS', style: '700' },
  { bg: '#5b21b6', fg: '#ffffff', text: 'VOLTA', style: 'italic 900' },
  { bg: '#050505', fg: '#ffffff', text: 'TIMEKEEPER', style: '600', stripe: '#ff7a00' },
];
export function sponsorAtlas() {
  const tex = canvasTex(2048, 128, (c, w, h) => {
    BOARDS.forEach((b, i) => {
      const x = i * 256;
      c.fillStyle = b.bg; c.fillRect(x, 0, 256, h);
      if (b.stripe) { c.fillStyle = b.stripe; c.fillRect(x, h - 18, 256, 10); }
      if (b.mark) { c.strokeStyle = b.mark; c.lineWidth = 5; c.beginPath(); c.arc(x + 38, h / 2, 20, 0, Math.PI * 2); c.stroke(); }
      c.fillStyle = b.fg;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      let size = 54;
      do { c.font = `${b.style} ${size}px "Titillium Web", sans-serif`; size -= 2; } while (c.measureText(b.text).width > 222);
      c.fillText(b.text, x + (b.mark ? 140 : 128), h / 2 + 3);
      c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(x + 254, 0, 2, h);
    });
  }, false);
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}
export function boardTexture(atlas, id) {
  const t = atlas.clone();
  t.repeat.set(1 / BOARDS.length, 1);
  t.offset.set(id / BOARDS.length, 0);
  t.needsUpdate = true;
  return t;
}

// Material that tiles a different sponsor board every uv.x unit (cell hashed to a board).
function boardWallMaterial(atlas) {
  const mat = new THREE.MeshStandardMaterial({ map: atlas, emissiveMap: atlas, emissive: 0xffffff, emissiveIntensity: 0.32, roughness: 0.7, side: THREE.DoubleSide });
  mat.onBeforeCompile = (s) => {
    const fn = `vec2 boardUv(vec2 uv){ float cell = floor(uv.x); float h = fract(sin(cell * 12.9898 + 4.1) * 43758.5453);
      float id = floor(h * ${BOARDS.length}.0); return vec2((id + fract(uv.x)) / ${BOARDS.length}.0, uv.y); }`;
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\n${fn}`)
      .replace('#include <map_fragment>', 'diffuseColor *= texture2D(map, boardUv(vMapUv));')
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance *= texture2D(emissiveMap, boardUv(vEmissiveMapUv)).rgb;');
  };
  return mat;
}

export class Track {
  constructor(race) {
    const curve = race.curve;
    this.curve = curve;
    this.n = Math.round(curve.L / 2);
    this.bin = curve.L / this.n;
    this.length = curve.L;
    this.P = []; this.T = []; this.N = []; this.S = [];
    const C = {};
    for (let i = 0; i < this.n; i++) {
      const s = i * this.bin;
      curve.at(s, C);
      this.P.push(new THREE.Vector3(C.x, LIFT + C.e, -C.y));
      this.T.push(new THREE.Vector3(C.tx, 0, -C.ty));
      this.N.push(new THREE.Vector3(C.ty, 0, C.tx)); // N = (-t.z, 0, t.x): the +offset side
      this.S.push(s);
    }
    // signed curvature (1/m), positive when the track bends toward +N; lightly smoothed
    const raw = this.T.map((_, i) => {
      const a = this.T[(i - 1 + this.n) % this.n], b = this.T[(i + 1) % this.n];
      return ((b.x - a.x) * this.N[i].x + (b.z - a.z) * this.N[i].z) / (2 * this.bin);
    });
    this.curv = raw.map((_, i) => {
      let acc = 0;
      for (let k = -3; k <= 3; k++) acc += raw[(i + k + this.n) % this.n];
      return acc / 7;
    });
    // original (4 m bin) indices -> this sampling
    const idx = i => Math.round(curve.S[i] / this.bin) % this.n;
    this.corners = race.track.corners.map(c => ({ ...c, i: idx(c.i) }));
    this.drs = race.track.drs.map(([a, b]) => { const A = idx(a); let B = idx(b); if (B < A) B += this.n; return [A, B]; });
    this.offsetCache = new Map();
    // spatial hash for nearest-centreline lookups
    this.cell = 25;
    this.grid = new Map();
    this.P.forEach((p, i) => {
      const key = `${Math.floor(p.x / this.cell)},${Math.floor(p.z / this.cell)}`;
      if (!this.grid.has(key)) this.grid.set(key, []);
      this.grid.get(key).push(i);
    });
    this.animated = [];
  }

  nearest(x, z) {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    let best = -1, bd = Infinity;
    for (let r = 1; r <= 6 && best < 0; r += 2) {
      for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
        const L = this.grid.get(`${cx + i},${cz + j}`);
        if (!L) continue;
        for (const k of L) {
          const p = this.P[k], d = (p.x - x) ** 2 + (p.z - z) ** 2;
          if (d < bd) { bd = d; best = k; }
        }
      }
    }
    return { i: best < 0 ? 0 : best, d: Math.sqrt(bd) };
  }

  // Lateral offset o at every sample, pulled in on the inside of tight bends so offset
  // curves (walls, fences, run-off) never fold back on themselves.
  offsets(o) {
    if (this.offsetCache.has(o)) return this.offsetCache.get(o);
    const n = this.n, a = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const k = this.curv[i];
      let v = o;
      if (o * k > 0) v = Math.sign(o) * Math.min(Math.abs(o), 0.8 / Math.abs(k));
      a[i] = Math.abs(v);
    }
    const W = 6, mn = new Float32Array(n), out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let m = Infinity;
      for (let k = -W; k <= W; k++) m = Math.min(m, a[(i + k + n) % n]);
      mn[i] = m;
    }
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let k = -W; k <= W; k++) acc += mn[(i + k + n) % n];
      out[i] = Math.sign(o) * acc / (2 * W + 1);
    }
    this.offsetCache.set(o, out);
    return out;
  }

  at(i, o, y = 0, out = new THREE.Vector3()) {
    i = ((i % this.n) + this.n) % this.n;
    const off = o === 0 ? 0 : this.offsets(o)[i];
    const p = this.P[i], nrm = this.N[i];
    return out.set(p.x + nrm.x * off, p.y + y, p.z + nrm.z * off);
  }

  // ribbon between lateral offsets o0..o1 (metres, + = N side), over index range
  ribbon(o0, o1, y = 0, from = 0, to = this.n) {
    const pos = [], uv = [], idx = [];
    const closed = from === 0 && to === this.n;
    const count = to - from + 1;
    const A = o0 === 0 ? null : this.offsets(o0), B = o1 === 0 ? null : this.offsets(o1);
    for (let c = 0; c < count; c++) {
      const i = (from + c) % this.n;
      const p = this.P[i], nrm = this.N[i];
      const s = closed && c === this.n ? this.length : this.S[i] + (i < from % this.n ? this.length : 0);
      const a = A ? A[i] : 0, b = B ? B[i] : 0;
      pos.push(p.x + nrm.x * a, p.y + y, p.z + nrm.z * a, p.x + nrm.x * b, p.y + y, p.z + nrm.z * b);
      uv.push(0, s, 1, s);
      if (c) {
        const k = (c - 1) * 2;
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); // counter-clockwise seen from above
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, j) => (j % 3 === 1 ? 1 : 0)), 3));
    return g;
  }

  // vertical strip at lateral offset o, from y0 to y0 + h above the track surface
  wall(o, h, y0 = 0, from = 0, to = this.n, uScale = 1) {
    const pos = [], uv = [], idx = [];
    const closed = from === 0 && to === this.n;
    const count = to - from + 1;
    const O = this.offsets(o);
    for (let c = 0; c < count; c++) {
      const i = (from + c) % this.n;
      const p = this.P[i], nrm = this.N[i];
      const s = closed && c === this.n ? this.length : this.S[i] + (i < from % this.n ? this.length : 0);
      const x = p.x + nrm.x * O[i], z = p.z + nrm.z * O[i];
      pos.push(x, p.y + y0 - (y0 === 0 ? 0.4 : 0), z, x, p.y + y0 + h, z);
      uv.push(s * uScale, 0, s * uScale, 1);
      if (c) {
        const k = (c - 1) * 2;
        idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  build(scene, race) {
    const g = new THREE.Group();
    scene.add(g);
    this.group = g;
    this.atlas = sponsorAtlas();

    // ---------- asphalt: aggregate texture, floodlight pools, rubbered-in line
    const asphaltTex = canvasTex(512, 512, (c, w, h) => {
      c.fillStyle = '#25272c'; c.fillRect(0, 0, w, h);
      const img = c.getImageData(0, 0, w, h);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = (Math.random() - 0.5) * 18 + (Math.random() < 0.04 ? 22 : 0);
        img.data[i] += v; img.data[i + 1] += v; img.data[i + 2] += v + 1;
      }
      c.putImageData(img, 0, 0);
    });
    asphaltTex.repeat.set(4, 1 / 4);
    const asphalt = new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.72, metalness: 0.05 });
    asphalt.onBeforeCompile = (s) => {
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vTrackUv;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvTrackUv = uv;');
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vTrackUv;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float along = fract(vTrackUv.y / 32.0);
          float pool = exp(-pow((along - 0.5) * 3.2, 2.0));
          float side = 1.0 - smoothstep(0.0, 1.0, abs(vTrackUv.x - 0.5) * 2.0) * 0.45;
          totalEmissiveRadiance += vec3(0.07, 0.072, 0.08) * (0.55 + 1.0 * pool) * side;
          diffuseColor.rgb *= 1.0 - 0.2 * exp(-pow((vTrackUv.x - 0.5) * 4.0, 2.0));`);
    };
    g.add(new THREE.Mesh(this.ribbon(-HALF, HALF, 0), asphalt));
    // run-off / shoulder up to the wall
    const shoulderMat = new THREE.MeshStandardMaterial({ color: 0x1b1d23, roughness: 0.95, emissive: 0x08090b });
    g.add(new THREE.Mesh(this.ribbon(HALF, WALL, -0.03), shoulderMat));
    g.add(new THREE.Mesh(this.ribbon(-WALL, -HALF, -0.03), shoulderMat));

    // ---------- white edge lines
    const lineMat = decal(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.8, 0.8, 0.8) }));
    g.add(new THREE.Mesh(mergeGeometries([this.ribbon(HALF - 0.45, HALF - 0.15, 0.015), this.ribbon(-HALF + 0.15, -HALF + 0.45, 0.015)]), lineMat));

    // ---------- kerbs: inside (apex) and exit side of every corner, slightly raised
    const kerbTex = canvasTex(64, 64, (c, w, h) => {
      c.fillStyle = '#f2f2f2'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#e10600'; c.fillRect(0, 0, w, h / 2);
    });
    const kerbMat = decal(new THREE.MeshStandardMaterial({ map: kerbTex, roughness: 0.55, emissive: 0xffffff, emissiveMap: kerbTex, emissiveIntensity: 0.22 }));
    const kerbs = [];
    for (const c of this.corners) {
      const span = 18;
      const inside = Math.sign(this.curv[c.i]) || 1;
      for (const side of [inside, -inside]) {
        const f = side === inside ? c.i - span : c.i;
        const len = side === inside ? span * 2 : span + 6;
        const geo = side > 0 ? this.ribbon(HALF - 0.1, HALF + 1.5, 0.05, f + this.n, f + this.n + len)
          : this.ribbon(-HALF - 1.5, -HALF + 0.1, 0.05, f + this.n, f + this.n + len);
        const uv = geo.attributes.uv;
        for (let k = 0; k < uv.count; k++) uv.setY(k, uv.getY(k) / 2.2);
        kerbs.push(geo);
      }
    }
    g.add(new THREE.Mesh(mergeGeometries(kerbs), kerbMat));

    // ---------- DRS zones: thin green line down the middle (2025 only)
    const drsMat = decal(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.08, 0.8, 0.3), transparent: true, opacity: 0.55 }));
    this.drsMesh = new THREE.Mesh(mergeGeometries(this.drs.map(([a, b]) => this.ribbon(-0.18, 0.18, 0.03, a, b))), drsMat);
    this.drsMesh.visible = race.has_drs !== false;
    g.add(this.drsMesh);

    // ---------- walls: concrete with sponsor boards every 12 m; debris fence with posts
    const wallMat = boardWallMaterial(this.atlas);
    const wallL = this.wall(WALL, 1.15, 0, 0, this.n, -1 / 12);
    const wallR = this.wall(-WALL, 1.15, 0, 0, this.n, 1 / 12);
    g.add(new THREE.Mesh(mergeGeometries([wallL, wallR]), wallMat));
    const capMat = new THREE.MeshStandardMaterial({ color: 0x9aa0aa, roughness: 0.8, emissive: 0x15161a });
    g.add(new THREE.Mesh(mergeGeometries([this.ribbon(WALL - 0.12, WALL + 0.12, 1.15), this.ribbon(-WALL - 0.12, -WALL + 0.12, 1.15)]), capMat));
    const fenceTex = canvasTex(64, 64, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      c.strokeStyle = 'rgba(170,180,200,0.38)'; c.lineWidth = 1;
      for (let i = -w; i < w * 2; i += 8) {
        c.beginPath(); c.moveTo(i, 0); c.lineTo(i + h, h); c.stroke();
        c.beginPath(); c.moveTo(i, h); c.lineTo(i + h, 0); c.stroke();
      }
    });
    const fence = new THREE.Mesh(mergeGeometries([this.wall(WALL + 0.05, 3.0, 1.15, 0, this.n, 1 / 3), this.wall(-WALL - 0.05, 3.0, 1.15, 0, this.n, 1 / 3)]),
      new THREE.MeshBasicMaterial({ map: fenceTex, transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0.3 }));
    g.add(fence);
    this.instances(g, 'post', new THREE.CylinderGeometry(0.06, 0.06, 3.1, 5).translate(0, 2.7, 0),
      new THREE.MeshStandardMaterial({ color: 0x8c929c, metalness: 0.7, roughness: 0.4 }),
      this.every(4, [WALL + 0.1, -WALL - 0.1]));

    this.buildBarriers(g);
    this.buildLights(g);
    this.buildMarshals(g);
    this.buildBrakeBoards(g);
    this.buildGantries(g);
    this.buildStart(g, race);
    this.buildPit(g, race);
    this.buildGrandstands(g);
    return g;
  }

  // placements every `spacing` metres on the given offsets: [{i, o}]
  every(spacing, offsets, phase = 0) {
    const out = [];
    const step = Math.max(1, Math.round(spacing / this.bin));
    for (let i = phase; i < this.n; i += step) for (const o of offsets) out.push({ i, o });
    return out;
  }

  // InstancedMesh at track placements, local +z facing the track centre
  instances(g, name, geo, mat, items, colorOf) {
    const mesh = new THREE.InstancedMesh(geo, mat, items.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    items.forEach((it, k) => {
      it.i = ((it.i % this.n) + this.n) % this.n;
      this.at(it.i, it.o, 0, v);
      v.y = this.P[it.i].y - LIFT + (it.y || 0);
      const nrm = this.N[it.i], sgn = Math.sign(it.o) || 1;
      q.setFromAxisAngle(up, Math.atan2(-nrm.x * sgn, -nrm.z * sgn) + (it.rot || 0));
      sc.set(1, it.sy || 1, 1);
      m.compose(v, q, sc);
      mesh.setMatrixAt(k, m);
      if (colorOf) mesh.setColorAt(k, col.set(colorOf(it, k)));
    });
    mesh.name = name;
    g.add(mesh);
    return mesh;
  }

  buildBarriers(g) {
    // TecPro blocks lining the outside of every braking zone, in red/blue/white
    const items = [];
    for (const c of this.corners) {
      const outside = -(Math.sign(this.curv[c.i]) || 1);
      for (let k = -24; k <= 8; k += 1) items.push({ i: c.i + k, o: outside * (WALL - 0.55) });
    }
    const pal = ['#d32f2f', '#1e4fd8', '#e9e9e9', '#1e4fd8'];
    this.instances(g, 'tecpro', new THREE.BoxGeometry(1.95, 1.0, 0.9).translate(0, 0.68, 0),
      new THREE.MeshStandardMaterial({ roughness: 0.6, emissive: 0x111111 }), items, (it, k) => pal[k % pal.length]);
  }

  buildLights(g) {
    // Floodlight towers every ~32 m, alternating sides, arm reaching over the barrier.
    const items = this.every(32, [1]).map((it, k) => ({ i: it.i, o: (k % 2 ? 1 : -1) * (WALL + 1.3) }));
    const poleGeo = new THREE.CylinderGeometry(0.22, 0.32, 11, 6).translate(0, 5.5, 0);
    const armGeo = new THREE.BoxGeometry(0.2, 0.2, 5.5).translate(0, 11, 2.75);
    this.instances(g, 'poles', mergeGeometries([poleGeo, armGeo]), new THREE.MeshStandardMaterial({ color: 0x3a3f4a, metalness: 0.6, roughness: 0.5 }), items);
    this.instances(g, 'heads', new THREE.BoxGeometry(2.6, 0.35, 1.2).translate(0, 10.8, 5.2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.15, 2.0) }), items);
  }

  buildMarshals(g) {
    // marshal posts with their green light panels, roughly every 220 m
    const items = this.every(220, [1], 40).map((it, k) => ({ i: it.i, o: (k % 2 ? 1 : -1) * (WALL + 2.2) }));
    this.instances(g, 'marshal', new THREE.BoxGeometry(2.4, 2.6, 2.0).translate(0, 1.3, -0.6),
      new THREE.MeshStandardMaterial({ color: 0xd7d9de, roughness: 0.6, emissive: 0x202226 }), items);
    this.instances(g, 'marshal-light', new THREE.BoxGeometry(1.2, 0.7, 0.1).translate(0, 3.2, 0.45),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 2.2, 0.6) }), items);
  }

  buildBrakeBoards(g) {
    // 100 / 50 m countdown boards before the slow corners
    const mk = label => canvasTex(128, 128, (c, w, h) => {
      c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h);
      c.strokeStyle = '#111'; c.lineWidth = 8; c.strokeRect(6, 6, w - 12, h - 12);
      c.fillStyle = '#111'; c.font = '900 60px "Titillium Web", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(label, w / 2, h / 2 + 4);
    }, false);
    const posts = [];
    for (const [dist, label] of [[100, '100'], [50, '50']]) {
      const boards = [];
      for (const c of this.corners) {
        if (c.v > 150) continue;
        const outside = -(Math.sign(this.curv[c.i]) || 1);
        const i = c.i - Math.round((dist + 30) / this.bin);
        const p = this.at(i, outside * (HALF + 2.0));
        const t = this.T[((i % this.n) + this.n) % this.n];
        const b = new THREE.PlaneGeometry(1.5, 1.5).translate(0, 2.2, 0);
        b.rotateY(Math.atan2(-t.x, -t.z));
        b.translate(p.x, this.P[((i % this.n) + this.n) % this.n].y - LIFT, p.z);
        boards.push(b);
        posts.push(new THREE.BoxGeometry(0.1, 1.5, 0.1).translate(p.x, this.P[((i % this.n) + this.n) % this.n].y - LIFT + 0.75, p.z));
      }
      const tex = mk(label);
      g.add(new THREE.Mesh(mergeGeometries(boards), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.5, side: THREE.DoubleSide })));
    }
    g.add(new THREE.Mesh(mergeGeometries(posts), new THREE.MeshStandardMaterial({ color: 0x8c929c })));
  }

  buildGantries(g) {
    // sponsor bridges over the straights, with an LED ticker on each face
    const picks = [];
    for (let i = 60; i < this.n - 60; i += 5) {
      let flat = true;
      for (let k = -14; k <= 14; k++) if (Math.abs(this.curv[(i + k) % this.n]) > 0.004) { flat = false; break; }
      if (flat && picks.every(p => Math.abs(p - i) > 280)) picks.push(i);
    }
    const ticker = canvasTex(1024, 64, (c, w, h) => {
      c.fillStyle = '#07070b'; c.fillRect(0, 0, w, h);
      c.font = 'italic 900 40px "Titillium Web", sans-serif'; c.textBaseline = 'middle';
      const msgs = ['SINGAPORE GRAND PRIX', 'MARINA BAY', 'NIGHT RACE', 'LIGHTS OUT'];
      let x = 10;
      msgs.forEach((m, k) => { c.fillStyle = k % 2 ? '#ffffff' : '#ff2a20'; c.fillText(m, x, h / 2 + 2); x += c.measureText(m).width + 40; });
    });
    this.animated.push(dt => { ticker.offset.x = (ticker.offset.x + dt * 0.06) % 1; });
    const steel = new THREE.MeshStandardMaterial({ color: 0x2b2f38, metalness: 0.7, roughness: 0.4 });
    const tickMat = new THREE.MeshBasicMaterial({ map: ticker, color: new THREE.Color(1.5, 1.5, 1.5) });
    picks.slice(0, 8).forEach((i, k) => {
      const p = this.P[i], t = this.T[i];
      const gr = new THREE.Group();
      const span = WALL * 2 + 3;
      const beam = new THREE.Mesh(new THREE.BoxGeometry(span, 2.2, 1.6), steel);
      beam.position.y = 8.5;
      gr.add(beam);
      for (const sgn of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.9, 9.6, 0.9), steel);
        leg.position.set(sgn * (span / 2 - 0.5), 4.8, 0);
        gr.add(leg);
      }
      const board = new THREE.MeshStandardMaterial({ map: boardTexture(this.atlas, k % BOARDS.length), emissive: 0xffffff, emissiveIntensity: 0.6 });
      board.emissiveMap = board.map;
      for (const face of [-1, 1]) {
        const ban = new THREE.Mesh(new THREE.PlaneGeometry(span * 0.62, 1.7), board);
        ban.position.set(-span * 0.17, 8.5, face * 0.81);
        ban.rotation.y = face > 0 ? 0 : Math.PI;
        const led = new THREE.Mesh(new THREE.PlaneGeometry(span * 0.32, 1.5), tickMat);
        led.position.set(span * 0.32, 8.5, face * 0.81);
        led.rotation.y = face > 0 ? 0 : Math.PI;
        gr.add(ban, led);
      }
      gr.position.set(p.x, p.y - LIFT, p.z);
      gr.rotation.y = Math.atan2(-t.x, -t.z);
      g.add(gr);
    });
  }

  buildStart(g, race) {
    const chk = canvasTex(128, 16, (c, w, h) => {
      for (let x = 0; x < w; x += 8) for (let y = 0; y < h; y += 8) {
        c.fillStyle = ((x + y) / 8) % 2 ? '#111' : '#f4f4f4'; c.fillRect(x, y, 8, 8);
      }
    }, false);
    const p = this.P[0], t = this.T[0];
    const line = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, 1.4),
      decal(new THREE.MeshStandardMaterial({ map: chk, emissive: 0xffffff, emissiveMap: chk, emissiveIntensity: 0.4 })));
    line.rotation.x = -Math.PI / 2;
    const holder = new THREE.Group();
    holder.add(line);
    holder.position.set(p.x, p.y + 0.03, p.z);
    holder.rotation.y = Math.atan2(t.x, t.z);
    g.add(holder);

    // gantry with five red start lights
    const gantry = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0x2b2f38, metalness: 0.7, roughness: 0.4 });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(WALL * 2 + 2, 1.6, 1.2), steel);
    beam.position.y = 7.5;
    gantry.add(beam);
    for (const sgn of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.8, 8.3, 0.8), steel);
      leg.position.set(sgn * (WALL + 0.6), 4.15, 0);
      gantry.add(leg);
    }
    this.startLights = [];
    for (let k = 0; k < 5; k++) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.4, 0.5), new THREE.MeshStandardMaterial({ color: 0x0a0a0a }));
      box.position.set((k - 2) * 1.5, 5.9, 0.4);
      const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.36, 16), new THREE.MeshBasicMaterial({ color: 0x220000 }));
      lamp.position.set((k - 2) * 1.5, 5.6, 0.68);
      const lamp2 = lamp.clone(); lamp2.position.y = 6.3; lamp2.material = lamp.material;
      gantry.add(box, lamp, lamp2);
      this.startLights.push(lamp.material);
    }
    const sign = canvasTex(512, 64, (c, w, h) => {
      c.fillStyle = '#e10600'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#fff'; c.font = 'italic 900 40px "Titillium Web", sans-serif'; c.textAlign = 'center';
      c.fillText('SINGAPORE GRAND PRIX', w / 2, 46);
    }, false);
    const signM = new THREE.Mesh(new THREE.PlaneGeometry(WALL * 2, 1.4),
      new THREE.MeshBasicMaterial({ map: sign, color: new THREE.Color(1.4, 1.4, 1.4) }));
    signM.position.set(0, 7.5, -0.62); signM.rotation.y = Math.PI;
    const signF = signM.clone(); signF.position.z = 0.62; signF.rotation.y = 0;
    gantry.add(signM, signF);
    gantry.position.set(p.x + t.x * 3, p.y - LIFT, p.z + t.z * 3);
    gantry.rotation.y = Math.atan2(-t.x, -t.z);
    g.add(gantry);

    // grid boxes painted where the cars actually lined up (races only)
    if (!race.isRace) return;
    const tmp = [0, 0, 0, 0];
    const tGrid = race.race_start - 3;
    const boxes = [];
    race.drivers.forEach(d => {
      race.pos(d.k, tGrid, tmp);
      const x = tmp[0], z = -tmp[1];
      const { i } = this.nearest(x, z);
      const tt = this.T[i];
      const b = new THREE.PlaneGeometry(2.6, 0.25);
      const b2 = new THREE.PlaneGeometry(0.25, 1.6); b2.translate(-1.2, -0.8, 0);
      const b3 = b2.clone(); b3.translate(2.4, 0, 0);
      const m = mergeGeometries([b, b2, b3]);
      m.translate(0, 2.6, 0);
      m.rotateX(-Math.PI / 2);
      m.rotateY(Math.atan2(-tt.x, -tt.z));
      m.translate(x, this.P[i].y + 0.03, z);
      boxes.push(m);
    });
    g.add(new THREE.Mesh(mergeGeometries(boxes), decal(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.75, 0.75, 0.75) }))));
  }

  buildPit(g, race) {
    const pit = race.track.pit;
    if (!pit.length) return;
    const pts = pit.map(([x, y]) => new THREE.Vector3(x, 0, -y));
    const mid = pts[pts.length >> 1];
    const { i } = this.nearest(mid.x, mid.z);
    const away = new THREE.Vector3().subVectors(mid, this.P[i]).setY(0).normalize();
    const curve = new THREE.CatmullRomCurve3(pts);
    const N = 200, W = 5.5;
    const pos = [], idx = [], frames = [];
    for (let k = 0; k <= N; k++) {
      const p = curve.getPointAt(k / N), t = curve.getTangentAt(k / N);
      const nrm = new THREE.Vector3(-t.z, 0, t.x);
      const { i: ci } = this.nearest(p.x, p.z);
      const y = this.P[ci].y + 0.01;
      frames.push({ p, t, nrm, y, side: Math.sign(nrm.dot(away)) || 1 });
      pos.push(p.x + nrm.x * W, y, p.z + nrm.z * W, p.x - nrm.x * W, y, p.z - nrm.z * W);
      if (k) { const a = (k - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x2a2c33, roughness: 0.8, emissive: 0x18191d, side: THREE.DoubleSide })));

    // pit building: team garages below, glass hospitality level above, continuous along the lane
    const teams = [...new Map(race.drivers.map(d => [d.team, d.color])).entries()];
    const from = Math.floor(N * 0.2), to = Math.floor(N * 0.85);
    const bays = teams.length * 2;
    const shell = new THREE.MeshStandardMaterial({ color: 0x1c1f27, metalness: 0.4, roughness: 0.55 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x2a3446, metalness: 0.8, roughness: 0.15, emissive: new THREE.Color(1.0, 0.82, 0.6), emissiveIntensity: 0.55 });
    const roof = new THREE.MeshStandardMaterial({ color: 0x3a3f4a, metalness: 0.5, roughness: 0.4 });
    for (let k = 0; k < bays; k++) {
      const f = frames[from + Math.floor((k + 0.5) / bays * (to - from))];
      const len = (to - from) / N * curve.getLength() / bays;
      const ctr = f.p.clone().addScaledVector(f.nrm, f.side * (W + 8));
      const bay = new THREE.Group();
      const ground = new THREE.Mesh(new THREE.BoxGeometry(len - 0.3, 6, 14), shell);
      ground.position.y = 3;
      const club = new THREE.Mesh(new THREE.BoxGeometry(len - 0.1, 4, 16), glass);
      club.position.set(0, 8, -1);
      const lid = new THREE.Mesh(new THREE.BoxGeometry(len, 0.5, 18), roof);
      lid.position.set(0, 10.25, -1.5);
      const col = new THREE.Color(teams[Math.floor(k / 2)][1]);
      const door = new THREE.Mesh(new THREE.PlaneGeometry(len - 2, 4.4), new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(1.4) }));
      door.position.set(0, 2.4, -7.05);
      door.rotation.y = Math.PI;
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(len - 0.3, 0.5), new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(2) }));
      stripe.position.set(0, 5.6, -7.06);
      stripe.rotation.y = Math.PI;
      bay.add(ground, club, lid, door, stripe);
      bay.position.set(ctr.x, f.y - LIFT, ctr.z);
      // local -z faces the pit lane
      const face = f.nrm.clone().multiplyScalar(-f.side);
      bay.rotation.y = Math.atan2(-face.x, -face.z);
      g.add(bay);
    }
  }

  buildGrandstands(g) {
    // tiered stands with roofs, lit fascia and crowd, at the classic viewing spots
    const crowd = canvasTex(256, 64, (c, w, h) => {
      c.fillStyle = '#0d0f15'; c.fillRect(0, 0, w, h);
      const pal = ['#e10600', '#ffffff', '#ffb000', '#3671c6', '#27f4d2', '#ff8000', '#e8002d', '#9ca3af'];
      for (let y = 2; y < h; y += 8) {
        for (let x = 1; x < w; x += 3) {
          if (Math.random() < 0.18) continue;
          c.fillStyle = pal[(Math.random() * pal.length) | 0];
          c.globalAlpha = 0.35 + Math.random() * 0.65;
          c.fillRect(x + Math.random(), y + Math.random() * 2, 1.6, 3);
        }
      }
      c.globalAlpha = 1;
    });
    const seatMat = new THREE.MeshStandardMaterial({ map: crowd, emissive: 0xffffff, emissiveMap: crowd, emissiveIntensity: 0.65, roughness: 0.9 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x2c313c, metalness: 0.5, roughness: 0.45 });
    const lightMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.1, 1.9) });
    const plan = [[1, 90], [3, 70], [7, 80], [10, 70], [13, 60], [14, 80], [16, 70], [18, 80], [19, 60]];
    const placements = plan.map(([n, len]) => ({ i: this.corners.find(c => c.n === n)?.i, len })).filter(p => p.i != null);
    placements.push({ i: Math.floor(this.n * 0.985), len: 110, straight: true }); // opposite the pits
    this.stands = [];
    placements.forEach((pl, k) => {
      const outside = pl.straight ? 1 : -(Math.sign(this.curv[pl.i]) || 1);
      const p = this.at(pl.i, outside * (WALL + 5));
      this.stands.push({ p: p.clone(), r: pl.len / 2 + 25 });
      const nrm = this.N[pl.i];
      const st = new THREE.Group();
      const rows = 14, depth = rows * 0.85, len = pl.len;
      const tiers = [];
      for (let r = 0; r < rows; r++) {
        const h = 1.4 + r * 0.55;
        const b = new THREE.BoxGeometry(0.85, h, len);
        b.translate(r * 0.85 + 0.425, h / 2, 0);
        const uv = b.attributes.uv;
        for (let q = 0; q < uv.count; q++) uv.setX(q, uv.getX(q) * len / 9);
        tiers.push(b);
      }
      st.add(new THREE.Mesh(mergeGeometries(tiers), seatMat));
      const top = 1.4 + rows * 0.55;
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.4, top + 4, len), frameMat);
      back.position.set(depth + 0.2, (top + 4) / 2, 0);
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(depth + 4, 0.45, len + 2), frameMat);
      canopy.position.set(depth / 2 - 1.5, top + 4.2, 0);
      canopy.rotation.z = -0.06;
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, len), lightMat);
      strip.position.set(-3.2, top + 3.8, 0);
      st.add(back, canopy, strip);
      for (let z = -len / 2 + 4; z <= len / 2 - 4; z += 12) {
        const colm = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, top + 4.2, 6), frameMat);
        colm.position.set(depth - 0.4, (top + 4.2) / 2, z);
        st.add(colm);
      }
      // sponsor fascia under the canopy edge
      const fascia = new THREE.Mesh(new THREE.PlaneGeometry(len * 0.6, 1.2),
        new THREE.MeshBasicMaterial({ map: boardTexture(this.atlas, (k + 3) % BOARDS.length), color: new THREE.Color(1.3, 1.3, 1.3) }));
      fascia.position.set(-3.6, top + 4.6, 0);
      fascia.rotation.y = -Math.PI / 2;
      st.add(fascia);
      st.position.set(p.x, this.P[pl.i].y - LIFT, p.z);
      // local +x points away from the track
      st.rotation.y = Math.atan2(-nrm.z * outside, nrm.x * outside);
      g.add(st);
    });
  }

  update(dt) { for (const f of this.animated) f(dt); }

  setStartLights(n) {
    this.startLights.forEach((m, k) => m.color.setRGB(k < n ? 6 : 0.15, 0, 0));
  }
}
