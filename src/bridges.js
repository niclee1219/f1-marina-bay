// Anderson Bridge and Esplanade Bridge, which the circuit crosses (T12 -> T13 and T13 -> T14).
// Each bridge is also an occlusion / shade zone: an arc-length range along the track spline.
// Occlusion itself comes from the depth buffer: the arch ribs, railings and portals are real
// geometry beside and above the cars, so any car (from any camera) is hidden where they are in
// front of it. Inside a zone the asphalt and every car are darkened (see shadeAt / zoneUniform).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BRIDGES, COLORS } from './config.js';
import { MAX_ZONES } from './track.js';

const WALL = 10.2;      // track wall offset (matches track.js)
const UP = new THREE.Vector3(0, 1, 0);

export function tube(a, b, r, seg = 6) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

// box centred at p, long axis along the track tangent t
function boxAt(p, t, w, h, d, yaw = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.rotateY(Math.atan2(t.x, t.z) + yaw);
  g.translate(p.x, p.y, p.z);
  return g;
}

// quad strip from two point rows (a[k] -> b[k])
export function strip(a, b, flip = false) {
  const pos = [], idx = [];
  for (let k = 0; k < a.length; k++) {
    pos.push(a[k].x, a[k].y, a[k].z, b[k].x, b[k].y, b[k].z);
    if (k) {
      const q = (k - 1) * 2;
      if (flip) idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3);
      else idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export class Bridges {
  // overhead: zones under elevated decks the track passes beneath (Viaducts.zones)
  constructor(track, overhead = []) {
    this.track = track;
    const n = track.n;
    this.zones = BRIDGES.map(b => {
      let i0 = track.nearest(b.from[0], -b.from[1]).i;
      let i1 = track.nearest(b.to[0], -b.to[1]).i;
      // order along the direction of travel (neither bridge straddles the start line)
      if ((i1 - i0 + n) % n > n / 2) [i0, i1] = [i1, i0];
      if (i1 < i0) i1 += n;
      const m = Math.round(b.margin / track.bin);
      return {
        ...b, i0: i0 - m, i1: i1 + m,
        s0: (i0 - m) * track.bin, s1: (i1 + m) * track.bin,
        feather: 6,
      };
    });
    this.zones.push(...overhead);
    track.overhead = overhead.map(z => [z.s0, z.s1]);
    // shared with the asphalt shader: (s0, s1, shade, feather) per zone
    const u = track.zoneUniform.value;
    if (this.zones.length > MAX_ZONES) console.warn(`bridges: ${this.zones.length} shade zones, shader takes ${MAX_ZONES}`);
    this.zones.slice(0, MAX_ZONES).forEach((z, k) => u[k].set(z.s0, z.s1, z.shade, z.feather));
  }

  // 1 outside every zone, the zone's shade factor inside, feathered at the ends
  shadeAt(s) {
    const L = this.track.length;
    let v = 1;
    for (const z of this.zones) {
      let x = s;
      if (x < z.s0 - z.feather) x += L;
      const a = THREE.MathUtils.smoothstep(x, z.s0 - z.feather, z.s0 + z.feather);
      const b = 1 - THREE.MathUtils.smoothstep(x, z.s1 - z.feather, z.s1 + z.feather);
      v = Math.min(v, 1 - (1 - z.shade) * a * b);
    }
    return v;
  }

  zoneAt(s) {
    const L = this.track.length;
    return this.zones.find(z => (s >= z.s0 && s <= z.s1) || (s + L >= z.s0 && s + L <= z.s1)) || null;
  }

  build(scene) {
    const g = new THREE.Group();
    g.name = 'bridges';
    scene.add(g);
    this.mats = {
      stone: new THREE.MeshStandardMaterial({ color: 0xbdb4a2, roughness: 0.85, emissive: 0x1c1a16 }),
      steel: new THREE.MeshStandardMaterial({ color: 0x9aa3a8, metalness: 0.65, roughness: 0.35, emissive: 0x15181b }),
      concrete: new THREE.MeshStandardMaterial({ color: 0x8d8a84, roughness: 0.9, emissive: 0x2e2418 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x22252b, roughness: 0.8 }),
      road: new THREE.MeshStandardMaterial({ color: 0x24262c, roughness: 0.85, emissive: 0x0b0b0d }),
      rail: new THREE.MeshStandardMaterial({ color: 0x2d3a34, metalness: 0.6, roughness: 0.4 }),
      lamp: new THREE.MeshBasicMaterial({ color: new THREE.Color(...COLORS.lampWarm) }),
    };
    for (const z of this.zones) {
      if (z.overhead) continue;    // built by Viaducts
      if (z.style === 'arch') this.buildArch(g, z);
      else this.buildDeck(g, z);
    }
    return g;
  }

  frame(i) {
    const t = this.track, k = ((i % t.n) + t.n) % t.n;
    return { p: t.P[k], n: t.N[k], t: t.T[k] };
  }

  // point at (fractional) track index i, lateral offset o, height y above the track surface
  pt(i, o, y) {
    const i0 = Math.floor(i), f = i - i0;
    const A = this.frame(i0), B = this.frame(i0 + 1);
    const lerp = (a, b) => a + (b - a) * f;
    const nx = lerp(A.n.x, B.n.x), nz = lerp(A.n.z, B.n.z);
    return new THREE.Vector3(lerp(A.p.x, B.p.x) + nx * o, lerp(A.p.y, B.p.y) + y, lerp(A.p.z, B.p.z) + nz * o);
  }

  // deck slab, fascias, railings and abutments shared by both bridges (o0 < 0 < o1 offsets)
  deckShell(z, o0, o1, depth, parts) {
    const rows = [];
    for (let i = z.i0; i <= z.i1; i++) rows.push(i);
    const row = (o, y) => rows.map(i => this.pt(i, o, y));
    // underside and both fascia faces
    parts.dark.push(strip(row(o1, -depth), row(o0, -depth)));
    parts.fascia.push(strip(row(o0, -depth), row(o0, 0.02), true), strip(row(o1, -depth), row(o1, 0.02)));
    // pavement between the track wall and the bridge edge
    parts.road.push(strip(row(o0, -0.02), row(-WALL, -0.02)), strip(row(WALL, -0.02), row(o1, -0.02)));
    // abutments at both ends, down into the water
    for (const i of [z.i0, z.i1]) {
      const { p, t } = this.frame(i);
      parts.fascia.push(boxAt(new THREE.Vector3(p.x, (p.y - depth) / 2, p.z).addScaledVector(this.frame(i).n, (o0 + o1) / 2), t, o1 - o0 + 1.5, p.y - depth + 0.4, 3));
    }
    // railings: top rail + balusters every 1.6 m on both outer edges
    for (const o of [o0 + 0.25, o1 - 0.25]) {
      const top = row(o, 1.15);
      for (let k = 1; k < top.length; k++) parts.rail.push(tube(top[k - 1], top[k], 0.06, 5));
      const mid = row(o, 0.55);
      for (let k = 1; k < mid.length; k++) parts.rail.push(tube(mid[k - 1], mid[k], 0.035, 4));
      for (let k = 0; k < rows.length; k += 1) {
        const a = this.pt(rows[k], o, 0), b = this.pt(rows[k], o, 1.15);
        parts.rail.push(tube(a, b, 0.04, 4));
        if (k + 1 < rows.length) {
          const c = this.pt(rows[k] + 0.5, o, 0), d = this.pt(rows[k] + 0.5, o, 1.15);
          parts.rail.push(tube(c, d, 0.03, 4));
        }
      }
    }
    // warm lamps tucked under both fascias, every ~6 m: they light the water beneath the deck
    for (let i = z.i0 + 1; i < z.i1; i += 3) {
      for (const o of [o0 + 0.6, o1 - 0.6]) {
        const p = this.pt(i, o, -depth - 0.12);
        parts.lamp.push(new THREE.SphereGeometry(0.22, 8, 6).translate(p.x, p.y, p.z));
      }
    }
  }

  flush(g, parts) {
    const m = this.mats;
    const add = (list, mat) => { if (list.length) g.add(new THREE.Mesh(mergeGeometries(list), mat)); };
    add(parts.dark, m.dark); add(parts.fascia, parts.fasciaMat || m.stone); add(parts.road, m.road);
    add(parts.rail, m.rail); add(parts.steel, m.steel); add(parts.stone, m.stone); add(parts.concrete, m.concrete);
    add(parts.lamp, m.lamp);
    if (parts.glow.length) {
      const glow = new THREE.Mesh(mergeGeometries(parts.glow), new THREE.MeshBasicMaterial({
        map: glowTex(), color: new THREE.Color(0.55, 0.32, 0.14), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      g.add(glow);
    }
  }

  newParts() { return { dark: [], fascia: [], road: [], rail: [], steel: [], stone: [], concrete: [], lamp: [], glow: [] }; }

  // Anderson Bridge: lattice through-arch ribs on both sides, stone portals with lanterns.
  buildArch(g, z) {
    const parts = this.newParts();
    const W = WALL + 2.2, depth = 1.6;
    this.deckShell(z, -W, W, depth, parts);
    const portal = Math.round(7 / this.track.bin);
    const a0 = z.i0 + portal, a1 = z.i1 - portal, span = a1 - a0;
    const H = 12.5;
    for (const side of [-1, 1]) {
      const o = side * (W - 1.0);
      // top and bottom chords: a shallow parabola springing from just below deck level
      const topPts = [], botPts = [];
      const segs = Math.max(16, span * 2);
      for (let k = 0; k <= segs; k++) {
        const u = k / segs, i = a0 + u * span;
        const rise = 1 - Math.pow(2 * u - 1, 2);
        const t = this.pt(i, o, -0.8 + H * rise);
        const b = this.pt(i, o, -0.8 + (H - 1.4 - 0.6 * (1 - rise)) * rise);
        topPts.push(t); botPts.push(b);
      }
      for (let k = 1; k <= segs; k++) {
        parts.steel.push(tube(topPts[k - 1], topPts[k], 0.32, 6), tube(botPts[k - 1], botPts[k], 0.26, 6));
        // N-truss lattice between the chords
        parts.steel.push(tube(botPts[k - 1], topPts[k], 0.09, 4), tube(botPts[k], topPts[k], 0.1, 4));
      }
      // vertical hangers from the bottom chord down to the deck edge, and a lamp on every second one
      for (let k = 2; k < segs - 1; k += 2) {
        const b = botPts[k];
        const d = this.pt(a0 + k / segs * span, o, 0);
        if (b.y - d.y > 0.8) parts.steel.push(tube(b, d, 0.07, 4));
        if (k % 4 === 0) {
          const l = topPts[k];
          parts.lamp.push(new THREE.SphereGeometry(0.2, 8, 6).translate(l.x, l.y + 0.45, l.z));
        }
      }
      // stone portal piers with lanterns at both ends of each rib
      for (const i of [z.i0 + portal * 0.5, z.i1 - portal * 0.5]) {
        const { t } = this.frame(Math.round(i));
        const p = this.pt(i, side * (W - 0.2), 0);
        const pier = boxAt(p.clone().setY(p.y + 4.2), t, 3.2, 8.4 + depth, 5.5);
        pier.translate(0, -depth / 2, 0);
        parts.stone.push(pier);
        parts.stone.push(boxAt(p.clone().setY(p.y + 8.7), t, 3.8, 0.6, 6.1));
        parts.stone.push(boxAt(p.clone().setY(p.y + 9.3), t, 2.4, 0.8, 4.2));
        parts.dark.push(boxAt(p.clone().setY(p.y + 10.2), t, 0.25, 1.4, 0.25));
        const lp = p.clone().setY(p.y + 11.1);
        parts.lamp.push(new THREE.SphereGeometry(0.45, 10, 8).translate(lp.x, lp.y, lp.z));
        parts.glow.push(billboardQuad(lp, 3.2));
      }
    }
    // glow pools on the water under the deck lamps
    for (let i = z.i0 + 2; i < z.i1; i += 6) {
      const p = this.pt(i, 0, 0);
      parts.glow.push(new THREE.PlaneGeometry(W * 1.6, 9).rotateX(-Math.PI / 2).rotateY(Math.atan2(this.frame(i).t.x, this.frame(i).t.z)).translate(p.x, 0.12, p.z));
    }
    this.flush(g, parts);
  }

  // Esplanade Bridge: wide concrete deck on shallow arched spans, tall lamp posts on both edges.
  buildDeck(g, z) {
    const parts = this.newParts();
    parts.fasciaMat = this.mats.concrete;
    const depth = 1.3;
    // the eastern carriageway sits beside the circuit; widen the deck on that side
    const mid = this.frame(Math.round((z.i0 + z.i1) / 2));
    const east = Math.sign(mid.n.x) || 1;
    const o0 = east < 0 ? -(WALL + 2 + z.extraWidth) : -(WALL + 2);
    const o1 = east > 0 ? WALL + 2 + z.extraWidth : WALL + 2;
    this.deckShell(z, o0, o1, depth, parts);
    // the other carriageway's road surface and lane lines
    const rows = [];
    for (let i = z.i0; i <= z.i1; i++) rows.push(i);
    const r0 = east > 0 ? WALL + 1.2 : o0 + 0.6, r1 = east > 0 ? o1 - 0.6 : -WALL - 1.2;
    // 8 cm above the pavement strip it overlaps (2 cm z-fought at range)
    parts.road.push(strip(rows.map(i => this.pt(i, r1, 0.08)), rows.map(i => this.pt(i, r0, 0.08)), true));
    // spans: piers in the water, arched soffits rising to the deck at mid-span
    const nSpan = 5, len = z.i1 - z.i0;
    for (let s = 0; s < nSpan; s++) {
      const a = z.i0 + (s / nSpan) * len, b = z.i0 + ((s + 1) / nSpan) * len;
      for (const o of [o0, o1]) {
        // spandrel face: from the arch curve up to the deck underside
        const top = [], bot = [];
        for (let k = 0; k <= 12; k++) {
          const u = k / 12, i = a + u * (b - a);
          const base = this.frame(Math.round(i)).p.y - depth;
          const y = (base - 0.2) * Math.sqrt(Math.max(0, 1 - Math.pow(2 * u - 1, 2))) * 0.85 + 0.2;
          top.push(this.pt(i, o, -depth)); bot.push(new THREE.Vector3().copy(this.pt(i, o, 0)).setY(y));
        }
        parts.concrete.push(strip(bot, top, o > 0));
        // soffit uplights along the arch edge
        for (let k = 1; k < 12; k++) {
          const p = bot[k];
          parts.lamp.push(new THREE.SphereGeometry(0.14, 6, 5).translate(p.x, p.y - 0.12, p.z));
        }
      }
      // soffit vault across the width
      const vault = [];
      for (let k = 0; k <= 12; k++) {
        const u = k / 12, i = a + u * (b - a);
        const base = this.frame(Math.round(i)).p.y - depth;
        const y = (base - 0.2) * Math.sqrt(Math.max(0, 1 - Math.pow(2 * u - 1, 2))) * 0.85 + 0.2;
        vault.push([this.pt(i, o0, 0).setY(y), this.pt(i, o1, 0).setY(y)]);
      }
      parts.dark.push(strip(vault.map(v => v[1]), vault.map(v => v[0])));
      // pier at the end of the span
      if (s < nSpan - 1) {
        const { t } = this.frame(Math.round(b));
        const p = this.pt(b, (o0 + o1) / 2, 0);
        parts.concrete.push(boxAt(p.clone().setY(0.6), t, o1 - o0 + 1.2, 1.6, 3.2));
      }
    }
    // street lamps on both edges every ~30 m
    for (let i = z.i0 + 4; i < z.i1 - 2; i += 15) {
      for (const o of [o0 + 0.6, o1 - 0.6]) {
        const base = this.pt(i, o, 0), top = this.pt(i, o * 0.94, 9.5);
        parts.dark.push(tube(base, this.pt(i, o, 9.2), 0.12, 6), tube(this.pt(i, o, 9.2), top, 0.08, 5));
        parts.lamp.push(new THREE.BoxGeometry(0.9, 0.18, 0.4).translate(top.x, top.y - 0.1, top.z));
        parts.glow.push(billboardQuad(top, 2.6));
      }
    }
    for (let i = z.i0 + 3; i < z.i1; i += 7) {
      const p = this.pt(i, (o0 + o1) / 2, 0);
      parts.glow.push(new THREE.PlaneGeometry(o1 - o0, 9).rotateX(-Math.PI / 2).rotateY(Math.atan2(this.frame(i).t.x, this.frame(i).t.z)).translate(p.x, 0.12, p.z));
    }
    this.flush(g, parts);
  }
}

// small horizontal glow card (reads as a halo from above and from the side through bloom)
export function billboardQuad(p, size) {
  const a = new THREE.PlaneGeometry(size, size).translate(p.x, p.y, p.z);
  const b = new THREE.PlaneGeometry(size, size).rotateY(Math.PI / 2).translate(p.x, p.y, p.z);
  return mergeGeometries([a, b]);
}

let _glow;
export function glowTex() {
  if (_glow) return _glow;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)');
  gr.addColorStop(0.3, 'rgba(255,255,255,0.3)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  _glow = new THREE.CanvasTexture(c);
  return _glow;
}
