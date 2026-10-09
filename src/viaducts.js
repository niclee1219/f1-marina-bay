// Elevated structures from OpenStreetMap (data/bridges.json, built by scripts/fetch_bridges.py):
// the East Coast Parkway viaducts and the Benjamin Sheares Bridge, which pass over the circuit at
// T1, T4-T5 and T17, the elevated walkways beside them, and the Helix, Jubilee and Cavenagh bridges.
//
// Everything here is ordinary opaque geometry (depthWrite on, normal render order), so the depth
// buffer hides a car under a deck from every camera. Each place a deck crosses the track also
// becomes a shade zone (see Bridges / Track.zoneUniform): asphalt and cars darken underneath, the
// track's floodlight poles are left out there and the deck soffit carries its own lights instead.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { tube, billboardQuad, glowTex } from './bridges.js';
import { COLORS } from './config.js';

const WALL = 10.2;           // track wall offset (matches track.js)
const PIER_CLEAR = WALL + 4; // no pier closer than this to the centreline
const SHADE = { road: 0.42, foot: 0.7 };

// way points [x, y(north), h] -> scene Vector3 (x, h, -y), resampled every `step` metres
function samples(way, step) {
  const P = way.p.map(([x, y, h]) => new THREE.Vector3(x, h, -y));
  const out = [P[0]];
  for (let k = 1; k < P.length; k++) {
    const a = P[k - 1], b = P[k];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
    for (let j = 1; j <= n; j++) out.push(a.clone().lerp(b, j / n));
  }
  // ease the height kinks left by the per-node profile
  for (let pass = 0; pass < 3; pass++) {
    const y = out.map(p => p.y);
    for (let k = 1; k < out.length - 1; k++) out[k].y = (y[k - 1] + 2 * y[k] + y[k + 1]) / 4;
  }
  return out;
}

// unit tangent (XZ) and the horizontal normal at every sample
function frames(S) {
  return S.map((p, k) => {
    const a = S[Math.max(0, k - 1)], b = S[Math.min(S.length - 1, k + 1)];
    const t = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
    return { t, n: new THREE.Vector3(-t.z, 0, t.x) };
  });
}

// Sweep an open cross-section polyline [[offset, dy], ...] along the samples. Each profile edge
// gets its own strip so the box girder keeps hard edges.
function sweep(S, F, profile, out) {
  for (let e = 0; e + 1 < profile.length; e++) {
    const pos = [], idx = [];
    for (let k = 0; k < S.length; k++) {
      for (const [o, dy] of [profile[e], profile[e + 1]]) {
        pos.push(S[k].x + F[k].n.x * o, S[k].y + dy, S[k].z + F[k].n.z * o);
      }
      if (k) {
        const q = (k - 1) * 2;
        idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    out.push(g);
  }
}

// non-indexed, position + normal (+ colour) only, so mixed primitives merge
function plain(g) {
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g.index ? g.toNonIndexed() : g;
}

// merge ways of one named bridge into continuous chains (shared end points)
function chains(ways) {
  const list = ways.map(w => w.p.slice());
  const key = p => `${Math.round(p[0])},${Math.round(p[1])}`;
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < list.length; i++) {
      for (let j = 0; j < list.length; j++) {
        if (i === j) continue;
        const a = list[i], b = list[j];
        if (key(a[a.length - 1]) === key(b[0])) list[i] = a.concat(b.slice(1));
        else if (key(a[a.length - 1]) === key(b[b.length - 1])) list[i] = a.concat(b.slice(0, -1).reverse());
        else continue;
        list.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }
  return list.map(p => ({ ...ways[0], p }));
}

export class Viaducts {
  constructor(city, track, race) {
    this.city = city;
    this.track = track;
    this.deck = city.bridgeDeck || 2;
    this.ways = city.bridges || [];
    this.zones = this.findZones(race);
    // deck slabs on a 20 m grid, for line-of-sight tests (trackside camera placement)
    this.cells = new Map();
    for (const w of this.ways) {
      if (w.kind === 'named') continue;
      for (const p of samples(w, 4)) {
        const key = `${Math.floor(p.x / 20)},${Math.floor(p.z / 20)}`;
        if (!this.cells.has(key)) this.cells.set(key, []);
        this.cells.get(key).push({ x: p.x, z: p.z, r: w.w / 2 + 1, y0: p.y - this.deck - 1, y1: p.y + (w.kind === 'foot' ? 3.6 : 1.6) });
      }
    }
  }

  // true when the point (scene x, y, z) is inside a deck slab
  blocks(x, y, z) {
    const cx = Math.floor(x / 20), cz = Math.floor(z / 20);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const d of this.cells.get(`${cx + i},${cz + j}`) || []) {
        if (y > d.y0 && y < d.y1 && (d.x - x) ** 2 + (d.z - z) ** 2 < d.r * d.r) return true;
      }
    }
    return false;
  }

  // shade zones where a road deck or footbridge crosses the track, merged when they overlap
  findZones(race) {
    const t = this.track, S = race.curve.S;
    const raw = [];
    for (const w of this.ways) {
      if (w.kind !== 'road' && w.kind !== 'foot') continue;
      for (const x of w.x) {
        const i0 = Math.floor(x), f = x - i0;
        const s = S[i0 % S.length] + f * ((S[(i0 + 1) % S.length] || t.length) - S[i0 % S.length]);
        // crossing angle from the deck segment nearest the crossing
        const i = Math.round(s / t.bin) % t.n, T = t.T[i];
        let best = null, bd = Infinity;
        for (let k = 1; k < w.p.length; k++) {
          const ax = w.p[k - 1][0], az = -w.p[k - 1][1], bx = w.p[k][0], bz = -w.p[k][1];
          const d = Math.hypot((ax + bx) / 2 - t.P[i].x, (az + bz) / 2 - t.P[i].z);
          if (d < bd) { bd = d; best = new THREE.Vector3(bx - ax, 0, bz - az).normalize(); }
        }
        const sin = Math.max(0.3, Math.abs(best.x * T.z - best.z * T.x));
        const half = (w.w / 2 + 1.5) / sin;
        raw.push({ s0: s - half, s1: s + half, shade: SHADE[w.kind] });
      }
    }
    raw.sort((a, b) => a.s0 - b.s0);
    const zones = [];
    for (const z of raw) {
      const last = zones[zones.length - 1];
      if (last && z.s0 < last.s1 + 12) {
        last.s1 = Math.max(last.s1, z.s1);
        last.shade = Math.min(last.shade, z.shade);
      } else zones.push({ ...z });
    }
    return zones.map((z, k) => ({
      key: `overhead${k}`, name: 'East Coast Parkway', overhead: true, feather: 5, ...z,
      i0: Math.floor(z.s0 / t.bin), i1: Math.ceil(z.s1 / t.bin),
    }));
  }

  build(scene) {
    const g = new THREE.Group();
    g.name = 'viaducts';
    scene.add(g);
    const parts = { top: [], concrete: [], soffit: [], steel: [], glass: [], lamp: [], flood: [], glow: [], white: [], led: [] };
    for (const w of this.ways) {
      if (w.kind === 'road') this.road(w, parts);
      else if (w.kind === 'foot') this.foot(w, parts);
    }
    const byStyle = {};
    for (const w of this.ways) if (w.kind === 'named') (byStyle[w.style] ||= []).push(w);
    for (const [style, ways] of Object.entries(byStyle)) {
      for (const c of chains(ways)) this[style](c, parts);
    }
    const lampCol = new THREE.Color(...COLORS.lampWarm);
    const mats = {
      top: new THREE.MeshStandardMaterial({ color: 0x2b2d33, roughness: 0.85, emissive: 0x0d0c0b }),
      concrete: new THREE.MeshStandardMaterial({ color: 0xa29d93, roughness: 0.88, emissive: 0x1d1912 }),
      soffit: new THREE.MeshStandardMaterial({ color: 0x5d5a55, roughness: 0.95, emissive: 0x16120c }),
      steel: new THREE.MeshStandardMaterial({ color: 0x9aa3a8, metalness: 0.7, roughness: 0.3, emissive: 0x15181b }),
      glass: new THREE.MeshStandardMaterial({ color: 0x3c5566, metalness: 0.4, roughness: 0.15, emissive: 0x0a1418 }),
      white: new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: 0.6, emissive: 0x2a2824 }),
      lamp: new THREE.MeshBasicMaterial({ color: lampCol }),
      flood: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.15, 2.0) }),
      led: new THREE.MeshBasicMaterial({ vertexColors: true }),
    };
    for (const [k, list] of Object.entries(parts)) {
      if (!list.length || k === 'glow') continue;
      g.add(new THREE.Mesh(mergeGeometries(list.map(plain)), mats[k]));
    }
    if (parts.glow.length) {
      g.add(new THREE.Mesh(mergeGeometries(parts.glow), new THREE.MeshBasicMaterial({
        map: glowTex(), color: new THREE.Color(0.55, 0.34, 0.16), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      })));
    }
    this.group = g;
    return g;
  }

  overTrack(p, margin = 0) {
    return this.track.nearest(p.x, p.z).d < WALL + 2 + margin;
  }

  // East Coast Parkway: concrete box girder with parapets, hammerhead piers, deck lamps
  road(w, parts) {
    const S = samples(w, 4), F = frames(S), W = w.w, hw = W / 2, D = this.deck;
    // cross-section: road top, parapets, cantilever fascia, sloped webs, flat soffit
    sweep(S, F, [[-hw + 0.45, 0.02], [hw - 0.45, 0.02]], parts.top);
    for (const s of [-1, 1]) {
      sweep(S, F, s < 0
        ? [[-hw + 0.45, 0.02], [-hw + 0.45, 1.1], [-hw, 1.1], [-hw, -0.55]]
        : [[hw, -0.55], [hw, 1.1], [hw - 0.45, 1.1], [hw - 0.45, 0.02]], parts.concrete);
    }
    const web = hw * 0.62;
    sweep(S, F, [[-hw, -0.55], [-web, -0.7], [-web * 0.9, -D]], parts.soffit);
    sweep(S, F, [[web * 0.9, -D], [web, -0.7], [hw, -0.55]], parts.soffit);
    sweep(S, F, [[-web * 0.9, -D], [web * 0.9, -D]], parts.soffit);
    // piers every ~32 m (never on the circuit), lamps every ~40 m alternating sides
    let acc = 16, lampAcc = 0, side = 1;
    for (let k = 1; k < S.length; k++) {
      const d = S[k].distanceTo(S[k - 1]);
      acc += d; lampAcc += d;
      const p = S[k], { t, n } = F[k], yaw = Math.atan2(n.x, n.z);
      if (acc >= 32 && p.y - D > 2.2 && !this.overTrack(p, 4)) {
        acc = 0;
        const top = p.y - D, colW = Math.min(4.2, W * 0.3);
        const col = new THREE.CylinderGeometry(1, 1, top + 1, 10, 1);
        col.scale(colW / 2, 1, 0.95);
        parts.concrete.push(col.rotateY(yaw).translate(p.x, (top - 1) / 2, p.z));
        const cap = new THREE.BoxGeometry(web * 2.1, 1.3, 2.3).rotateY(yaw);
        parts.concrete.push(cap.translate(p.x, top - 0.65, p.z));
      }
      if (lampAcc >= 40 && p.y > 4) {
        lampAcc = 0; side = -side;
        const base = p.clone().addScaledVector(n, side * (hw - 0.25));
        const head = p.clone().addScaledVector(n, side * (hw - 2.2)).setY(p.y + 9.6);
        parts.steel.push(tube(base.clone().setY(p.y + 1.1), base.clone().setY(p.y + 9.4), 0.11, 6), tube(base.clone().setY(p.y + 9.4), head, 0.08, 5));
        parts.lamp.push(new THREE.BoxGeometry(0.85, 0.16, 0.38).rotateY(Math.atan2(t.x, t.z)).translate(head.x, head.y - 0.1, head.z));
        parts.glow.push(billboardQuad(head, 2.4));
      }
      // floodlights under the soffit where the deck spans the circuit
      if (k % 2 === 0 && this.overTrack(p, -3) && p.y - D > 4) {
        for (const o of [-web * 0.45, web * 0.45]) {
          const q = p.clone().addScaledVector(n, o).setY(p.y - D - 0.12);
          parts.flood.push(new THREE.BoxGeometry(1.8, 0.14, 0.5).rotateY(yaw).translate(q.x, q.y, q.z));
        }
      }
    }
  }

  // elevated walkways: slab, glass balustrades, a light canopy on slim steel columns
  foot(w, parts) {
    const S = samples(w, 3), F = frames(S), hw = w.w / 2;
    sweep(S, F, [[-hw, 0], [hw, 0]], parts.top);
    sweep(S, F, [[hw, 0], [hw, -0.5], [-hw, -0.5], [-hw, 0]], parts.white);
    sweep(S, F, [[-hw, 0], [-hw, 1.15]], parts.glass);
    sweep(S, F, [[hw, 1.15], [hw, 0]], parts.glass);
    sweep(S, F, [[-hw - 0.3, 3.1], [0, 3.4], [hw + 0.3, 3.1]], parts.white);
    let acc = 9;
    for (let k = 1; k < S.length; k++) {
      acc += S[k].distanceTo(S[k - 1]);
      const p = S[k], { n } = F[k];
      if (acc >= 18) {
        acc = 0;
        for (const s of [-1, 1]) {
          const q = p.clone().addScaledVector(n, s * (hw - 0.15));
          parts.steel.push(tube(q, q.clone().setY(p.y + 3.25), 0.07, 5));
        }
        if (!this.overTrack(p, 2)) parts.steel.push(tube(p.clone().setY(-0.5), p.clone().setY(p.y - 0.5), 0.35, 8));
        // canopy downlights
        parts.lamp.push(new THREE.BoxGeometry(0.5, 0.06, 0.5).translate(p.x, p.y + 3.08, p.z));
      }
    }
  }

  // The Helix: a double helix of steel tubes around the deck, lit in sequences of coloured LEDs
  helix(w, parts) {
    const S = samples({ ...w, p: w.p.map(([x, y]) => [x, y, 4.5]) }, 1.5), F = frames(S), hw = 3;
    sweep(S, F, [[-hw, 0], [hw, 0]], parts.top);
    sweep(S, F, [[hw, 0], [hw * 0.8, -0.8], [-hw * 0.8, -0.8], [-hw, 0]], parts.white);
    const outer = [], inner = [], led = [];
    let s = 0;
    const PITCH = 13, Ro = 5.4, Ri = 4.3, yc = 2.6;
    for (let k = 0; k < S.length; k++) {
      if (k) s += S[k].distanceTo(S[k - 1]);
      const a = s / PITCH * Math.PI * 2, { n } = F[k];
      const at = (R, ph) => S[k].clone().addScaledVector(n, Math.cos(a + ph) * R).setY(S[k].y + yc + Math.sin(a + ph) * R);
      outer.push(at(Ro, 0)); inner.push(at(Ri, Math.PI));
      if (k % 3 === 0) parts.steel.push(tube(at(Ro, 0), at(Ri, Math.PI * 0.85), 0.05, 4));
      if (k % 2 === 0) led.push(at(Ri - 0.25, Math.PI));
    }
    for (let k = 1; k < S.length; k++) {
      parts.steel.push(tube(outer[k - 1], outer[k], 0.22, 6), tube(inner[k - 1], inner[k], 0.13, 5));
    }
    // c, g, a, t letter pairs light the inner helix in red, green, yellow and blue
    const pal = [[2.2, 0.25, 0.2], [0.3, 2.0, 0.45], [2.2, 1.7, 0.3], [0.35, 0.7, 2.4]];
    led.forEach((p, k) => {
      const c = pal[Math.floor(k / 4) % 4];
      const geo = new THREE.SphereGeometry(0.14, 6, 4).translate(p.x, p.y, p.z);
      const col = new Float32Array(geo.attributes.position.count * 3);
      for (let i = 0; i < col.length; i += 3) col.set(c, i);
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      parts.led.push(geo.toNonIndexed());
    });
    this.waterPiers(S, parts, 60, 4.5 - 0.8);
  }

  // Jubilee Bridge: slim concrete deck on a low arch line beside Esplanade Bridge
  jubilee(w, parts) {
    const P = w.p, L = P.length;
    const S = samples({ ...w, p: P.map(([x, y], k) => [x, y, 3.2 + 1.4 * Math.sin(Math.PI * k / Math.max(1, L - 1))]) }, 2);
    const F = frames(S), hw = 3.2;
    sweep(S, F, [[-hw, 0], [hw, 0]], parts.top);
    sweep(S, F, [[hw, 0], [hw, -0.9], [-hw, -0.9], [-hw, 0]], parts.white);
    sweep(S, F, [[-hw, 0], [-hw, 1.1]], parts.glass);
    sweep(S, F, [[hw, 1.1], [hw, 0]], parts.glass);
    S.forEach((p, k) => {
      if (k % 4) return;
      for (const s of [-1, 1]) {
        const q = p.clone().addScaledVector(F[k].n, s * hw).setY(p.y - 0.95);
        parts.lamp.push(new THREE.SphereGeometry(0.12, 6, 4).translate(q.x, q.y, q.z));
      }
    });
    this.waterPiers(S, parts, 36, 2.3);
  }

  // Cavenagh Bridge: white 1869 suspension bridge, chains between paired iron towers at each end
  cavenagh(w, parts) {
    const S = samples({ ...w, p: w.p.map(([x, y]) => [x, y, 2.6]) }, 1.5), F = frames(S), hw = 3.1;
    sweep(S, F, [[-hw, 0], [hw, 0]], parts.top);
    sweep(S, F, [[hw, 0], [hw, -0.7], [-hw, -0.7], [-hw, 0]], parts.white);
    const n = S.length - 1, a0 = Math.round(n * 0.08), a1 = Math.round(n * 0.92), TH = 9.5;
    for (const s of [-1, 1]) {
      const off = k => S[k].clone().addScaledVector(F[k].n, s * (hw + 0.2));
      for (const k of [a0, a1]) {
        const b = off(k);
        parts.white.push(new THREE.BoxGeometry(0.9, TH + 2.6, 0.9).translate(b.x, b.y + TH / 2 - 1.3, b.z));
        parts.white.push(new THREE.BoxGeometry(1.2, 0.5, 1.2).translate(b.x, b.y + TH + 0.2, b.z));
        parts.lamp.push(new THREE.SphereGeometry(0.28, 8, 6).translate(b.x, b.y + TH + 0.8, b.z));
      }
      // chains: catenary between the towers, back-stays down to the abutments
      const chain = [];
      for (let k = a0; k <= a1; k++) {
        const u = (k - a0) / (a1 - a0);
        chain.push(off(k).setY(S[k].y + 1.2 + (TH - 1.2) * Math.pow(2 * u - 1, 2)));
      }
      for (let k = 1; k < chain.length; k++) parts.white.push(tube(chain[k - 1], chain[k], 0.12, 5));
      for (let k = 2; k < chain.length - 2; k += 2) parts.white.push(tube(chain[k], off(a0 + k), 0.035, 4));
      parts.white.push(tube(off(0).setY(S[0].y), chain[0], 0.12, 5), tube(off(n).setY(S[n].y), chain[chain.length - 1], 0.12, 5));
    }
  }

  // round piers down into the water every `spacing` metres
  waterPiers(S, parts, spacing, top) {
    let acc = spacing / 2;
    for (let k = 1; k < S.length - 1; k++) {
      acc += S[k].distanceTo(S[k - 1]);
      if (acc < spacing) continue;
      acc = 0;
      parts.concrete.push(new THREE.CylinderGeometry(0.7, 0.8, top + 1, 10).translate(S[k].x, (top - 1) / 2, S[k].z));
    }
  }
}

// Point (x, y north) sets used to drop the flat ribbons of roads that are now elevated decks.
export function elevatedRoadKeys(city) {
  const keys = new Set();
  for (const w of city.bridges || []) {
    if (w.kind === 'named') continue;
    for (const [x, y] of w.p) keys.add(`${Math.round(x)},${Math.round(y)}`);
  }
  return keys;
}
