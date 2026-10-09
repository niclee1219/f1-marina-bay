// Hand-built Singapore landmarks around the circuit, plus the atmosphere around them:
// distant parallax skyline layers, searchlights over the SkyPark and fireworks over the bay.
// Landmarks sit on their OSM footprints (city.json), so they line up with the track and the bay.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildingMaterial, tagBuilding, centroid, obb, KIND } from './world.js';

export { obb };
import { COLORS, LANDMARKS } from './config.js';

// ---------------------------------------------------------------- helpers
const byName = (city, name) => city.buildings.find(b => b.n === name);

// Local frame: +x along OSM angle a, +z toward OSM direction (sin a, -cos a), +y up.
export function toWorld(g, cx, cy, a) {
  g.rotateY(a);
  g.translate(cx, 0, -cy);
  return g;
}

// rotate the local frame so local +z faces the OSM point (px, py)
function facing(o, px, py) {
  const toward = { x: px - o.cx, y: py - o.cy };
  const zDir = { x: Math.sin(o.a), y: -Math.cos(o.a) };
  return toward.x * zDir.x + toward.y * zDir.y >= 0 ? o.a : o.a + Math.PI;
}

// stack of horizontal rectangles {y, cx, cz, w, d}: a slab whose centre can drift with height
function stack(sections) {
  const pos = [], idx = [];
  sections.forEach(s => {
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) pos.push(s.cx + sx * s.w / 2, s.y, s.cz + sz * s.d / 2);
  });
  for (let j = 1; j < sections.length; j++) {
    for (let k = 0; k < 4; k++) {
      const a = (j - 1) * 4 + k, b = (j - 1) * 4 + (k + 1) % 4, c = j * 4 + k, d = j * 4 + (k + 1) % 4;
      idx.push(a, c, b, b, c, d);   // outward-facing walls
    }
  }
  const top = (sections.length - 1) * 4;
  idx.push(top, top + 2, top + 1, top, top + 3, top + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g.toNonIndexed();
}

// sweep a superellipse section along a spine with explicit side / normal vectors per point
function sweep(spine, ring = 10) {
  const pos = [], idx = [];
  for (const s of spine) {
    for (let k = 0; k < ring; k++) {
      const t = k / ring * Math.PI * 2;
      const c = Math.cos(t), sn = Math.sin(t);
      const a = Math.sign(c) * Math.pow(Math.abs(c), 0.7) * s.w / 2;
      // camber: bend the section into a shallow cup (a petal shell), deepest on the centre line
      const b = Math.sign(sn) * Math.pow(Math.abs(sn), 0.7) * s.h / 2 + (s.cam || 0) * (1 - Math.pow(2 * a / s.w, 2));
      pos.push(s.p.x + s.side.x * a + s.nrm.x * b, s.p.y + s.side.y * a + s.nrm.y * b, s.p.z + s.side.z * a + s.nrm.z * b);
    }
  }
  for (let j = 1; j < spine.length; j++) {
    for (let k = 0; k < ring; k++) {
      const a = (j - 1) * ring + k, b = (j - 1) * ring + (k + 1) % ring, c = j * ring + k, d = j * ring + (k + 1) % ring;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function prism(len, h, d) {
  // gabled roof: triangle cross-section (d wide, h tall) extruded along x
  const sh = new THREE.Shape();
  sh.moveTo(-d / 2, 0); sh.lineTo(d / 2, 0); sh.lineTo(0, h); sh.lineTo(-d / 2, 0);
  const g = new THREE.ExtrudeGeometry(sh, { depth: len, bevelEnabled: false });
  g.translate(0, 0, -len / 2);
  g.rotateY(Math.PI / 2);
  return g;
}

function octagon(w) {
  const sh = new THREE.Shape();
  for (let k = 0; k < 8; k++) {
    const a = (k + 0.5) / 8 * Math.PI * 2;
    const x = Math.cos(a) * w / 2 / Math.cos(Math.PI / 8), y = Math.sin(a) * w / 2 / Math.cos(Math.PI / 8);
    if (k) sh.lineTo(x, y); else sh.moveTo(x, y);
  }
  return sh;
}

// square of side w with its corners cut back by c * w (a chamfered, faceted plan)
function chamferedSquare(w, c) {
  const h = w / 2, k = c * w, sh = new THREE.Shape();
  [[-h + k, -h], [h - k, -h], [h, -h + k], [h, h - k], [h - k, h], [-h + k, h], [-h, h - k], [-h, -h + k]]
    .forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y)));
  return sh;
}

function extrudeUp(shape, from, to) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: to - from, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  g.translate(0, from, 0);
  return g;
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// ---------------------------------------------------------------- materials
function materials() {
  return {
    glass: buildingMaterial(),
    heritage: new THREE.MeshStandardMaterial({ color: COLORS.heritageWhite, roughness: 0.85, emissive: 0x3b2c1b }),
    heritageDark: new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.9, emissive: 0x2a1a08 }),
    windowLit: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.05, 0.55) }),
    copper: new THREE.MeshStandardMaterial({ color: COLORS.copperDome, roughness: 0.55, metalness: 0.3, emissive: 0x0f2a22 }),
    roof: new THREE.MeshStandardMaterial({ color: COLORS.terracotta, roughness: 0.8, emissive: 0x1a0905 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x8e96a0, metalness: 0.8, roughness: 0.3, emissive: 0x101318 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0x6d6a66, roughness: 0.9, emissive: 0x15130f }),
    white: new THREE.MeshStandardMaterial({ color: 0xf1efe9, roughness: 0.6, emissive: 0x5a5650, side: THREE.DoubleSide }),
    litGlass: new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.2, metalness: 0.6, emissive: new THREE.Color(0.42, 0.33, 0.2) }),
    led: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 1.1, 0.95) }),
    cyan: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 1.3, 2.2) }),
    green: new THREE.MeshStandardMaterial({ color: 0x1f3d22, roughness: 1, emissive: 0x08160a }),
    floodWhite: new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.7, emissive: new THREE.Color(0.46, 0.45, 0.43) }),
    slate: new THREE.MeshStandardMaterial({ color: 0x4a4f57, roughness: 0.8, emissive: 0x0c0d10 }),
    cream: new THREE.MeshStandardMaterial({ color: COLORS.fullertonCream, roughness: 0.8, emissive: new THREE.Color(0.36, 0.28, 0.16) }),
    floodlit: new THREE.MeshStandardMaterial({ color: 0xd8d0c0, roughness: 0.7, emissive: new THREE.Color(0.62, 0.56, 0.46) }),
  };
}

// ---------------------------------------------------------------- Marina Bay Sands
// Three 55-storey hotel towers (~194 m) on a gentle arc. Each tower is two slabs: a vertical west
// leg and an east leg that curves in to meet it near the top. The long east / west faces are
// glass (warm hotel rooms, banded by floor); the narrow north / south ends carry the cream
// structural edges that read from across the bay. The SkyPark (~340 m) is a boat-shaped hull with
// a lit underside, its prow cantilevering ~66 m past the north tower.

// One leg: glass on the long faces, cream edge strips around glass on the narrow ends.
// secs: [{ y, cx, cz, w, d }] in tower-local metres (x along the tower line, z across it).
function leg(secs, glass, cream, edge = 2.6) {
  const quad = (out, A, B, C, D) => out.push(A, B, C, A, C, D);
  const G = [], W = [];
  for (let j = 1; j < secs.length; j++) {
    const s0 = secs[j - 1], s1 = secs[j];
    const P = (s, x, z) => [s.cx + x, s.y, s.cz + z];
    const run = (out, x0, z0, x1, z1) => quad(out, P(s0, x0(s0), z0(s0)), P(s0, x1(s0), z1(s0)), P(s1, x1(s1), z1(s1)), P(s1, x0(s1), z0(s1)));
    const hw = s => s.w / 2, hd = s => s.d / 2;
    const neg = f => s => -f(s);
    // long faces (+z, -z), left to right as seen from outside
    run(G, neg(hw), hd, hw, hd);
    run(G, hw, neg(hd), neg(hw), neg(hd));
    // narrow ends (+x: z from + to -, -x: z from - to +), split into edge / glass / edge strips
    const zs = [s => s.d / 2, s => s.d / 2 - edge, s => -s.d / 2 + edge, s => -s.d / 2];
    for (let k = 0; k < 3; k++) run(k === 1 ? G : W, hw, zs[k], hw, zs[k + 1]);
    for (let k = 3; k > 0; k--) run(k === 2 ? G : W, neg(hw), zs[k], neg(hw), zs[k - 1]);
  }
  const top = secs[secs.length - 1];
  const t = (x, z) => [top.cx + x, top.y, top.cz + z];
  quad(W, t(-top.w / 2, top.d / 2), t(top.w / 2, top.d / 2), t(top.w / 2, -top.d / 2), t(-top.w / 2, -top.d / 2));
  const mk = list => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(list.flat(), 3));
    g.computeVertexNormals();
    return g;
  };
  glass.push(mk(G));
  cream.push(mk(W));
}

// Loft cross-sections [[o, dy], ...] (o across, dy down from the deck) along local x stations.
function hull(stations, profile, out) {
  for (let e = 0; e + 1 < profile.length; e++) {
    const pos = [];
    for (let k = 1; k < stations.length; k++) {
      const A = stations[k - 1], B = stations[k];
      const p = (S, [o, dy]) => [S.x, S.y + dy * S.depth, S.zc + o * S.hw];
      const a0 = p(A, profile[e]), a1 = p(A, profile[e + 1]), b0 = p(B, profile[e]), b1 = p(B, profile[e + 1]);
      pos.push(...a0, ...b1, ...b0, ...a0, ...a1, ...b1);   // outward: profile direction turned +90 degrees
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    out.push(g);
  }
}

function marinaBaySands(city, M, animated) {
  const g = new THREE.Group();
  const towers = city.buildings.filter(b => /^Marina Bay Sands Tower/.test(b.n || '')).sort((a, b) => a.n.localeCompare(b.n));
  if (towers.length !== 3) return g;
  const c = towers.map(t => centroid(t.p));
  const u = new THREE.Vector2().subVectors(c[2], c[0]).normalize();
  const a = Math.atan2(u.y, u.x);
  const H = 194;
  const glassTint = new THREE.Color(0.2, 0.22, 0.26), creamTint = new THREE.Color(0.86, 0.82, 0.74);
  const glass = [], cream = [];
  c.forEach((tc, k) => {
    // each tower follows the arc: oriented along the chord of its neighbours
    const p0 = c[Math.max(0, k - 1)], p1 = c[Math.min(2, k + 1)];
    const ak = Math.atan2(p1.y - p0.y, p1.x - p0.x);
    const G = [], W = [];
    leg([{ y: 0, cx: 0, cz: -13, w: 36, d: 17 }, { y: H, cx: 0, cz: -13, w: 36, d: 17 }], G, W);
    const secs = [];
    for (let j = 0; j <= 16; j++) {
      const y = H * j / 16;
      secs.push({ y, cx: 0, cz: 4.5 + 15 * Math.pow(1 - y / H, 1.7), w: 36, d: 17 });
    }
    leg(secs, G, W);
    for (const geo of G) glass.push(tagBuilding(toWorld(geo, tc.x, tc.y, ak), 0.31 + k * 0.07, H, glassTint, KIND.hotel));
    for (const geo of W) cream.push(tagBuilding(toWorld(geo, tc.x, tc.y, ak), 0.2 + k * 0.1, H, creamTint, KIND.solid));
  });
  g.add(new THREE.Mesh(mergeGeometries([...glass, ...cream]), M.glass));

  // SkyPark hull along the tower chord; local x from the middle tower, +z toward the east legs
  const mid = c[1];
  const d1 = c[0].distanceTo(mid), d3 = c[2].distanceTo(mid);
  const x0 = -d1 - 48, x1 = d3 + 66, L = x1 - x0, xm = (x0 + x1) / 2, W = 38, zc = -4, top = H + 7;
  const stations = [];
  for (let k = 0; k <= 64; k++) {
    const x = x0 + L * k / 64, t = (x - xm) / (L / 2);
    // plan: rounded stern at the south end, a long pointed prow at the north (cantilever) end
    const plan = t > 0 ? Math.pow(Math.max(0, 1 - Math.pow(t, 2.2)), 0.55) : Math.pow(Math.max(0, 1 - Math.pow(-t, 6)), 0.35);
    // hull depth: deepest over the towers, thinning to the tips
    const depth = 3.5 + 8.5 * Math.pow(Math.max(0, 1 - t * t), 0.7);
    stations.push({ x, y: top, zc, hw: Math.max(0.6, W / 2 * plan), depth });
  }
  const deck = [], side = [], under = [];
  hull(stations, [[-1, 0], [1, 0]], deck);
  hull(stations, [[1, 0], [1, 0.18], [0.92, 0.42]], side);
  hull(stations, [[-0.92, 0.42], [-1, 0.18], [-1, 0]], side);
  hull(stations, [[0.92, 0.42], [0.7, 0.75], [0.35, 0.95], [0, 1], [-0.35, 0.95], [-0.7, 0.75], [-0.92, 0.42]], under);
  const place = geo => toWorld(geo, mid.x, mid.y, a);
  g.add(new THREE.Mesh(place(mergeGeometries(deck)), new THREE.MeshStandardMaterial({ color: 0x24332a, roughness: 0.9, emissive: 0x0b140d })));
  g.add(new THREE.Mesh(place(mergeGeometries(side)), M.metal));
  // underside: lit soffit panels (a soft cool wash, like the nightly underside lighting)
  g.add(new THREE.Mesh(place(mergeGeometries(under)), new THREE.MeshStandardMaterial({
    color: 0x8f96a6, roughness: 0.6, metalness: 0.2, emissive: new THREE.Color(0.42, 0.44, 0.58), side: THREE.DoubleSide,
  })));
  // LED lines along both deck edges, the infinity pool on the city (west) edge, gardens on the deck
  const lines = [], trees = [], trunks = [];
  for (const sgn of [-1, 1]) {
    const pts = stations.filter((_, k) => k % 2 === 0).map(S => new THREE.Vector3(S.x, top - 0.6, S.zc + sgn * (S.hw + 0.05)));
    for (let k = 1; k < pts.length; k++) {
      const d = pts[k].clone().sub(pts[k - 1]);
      lines.push(new THREE.BoxGeometry(d.length(), 0.35, 0.35).rotateY(-Math.atan2(d.z, d.x)).translate((pts[k].x + pts[k - 1].x) / 2, top - 0.6, (pts[k].z + pts[k - 1].z) / 2));
    }
  }
  g.add(new THREE.Mesh(place(mergeGeometries(lines.map(x => x.toNonIndexed()))), M.led));
  const pool = new THREE.BoxGeometry(146, 0.5, 6).translate(d3 - 40, top + 0.3, zc - W / 2 + 4);
  g.add(new THREE.Mesh(place(pool), M.cyan));
  let seed = 3;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 70; k++) {
    const x = x0 + 18 + rnd() * (L - 70);
    const S = stations[Math.round((x - x0) / L * 64)];
    const z = S.zc - S.hw * 0.25 + rnd() * S.hw * 1.1;
    const r = 1.6 + rnd() * 1.4;
    trees.push(new THREE.SphereGeometry(r, 7, 5).scale(1, 0.75, 1).translate(x, top + 2.4 + r * 0.5, z));
    trunks.push(new THREE.CylinderGeometry(0.18, 0.25, 2.6, 5).translate(x, top + 1.3, z));
  }
  g.add(new THREE.Mesh(place(mergeGeometries(trees)), M.green));
  g.add(new THREE.Mesh(place(mergeGeometries(trunks)), M.metal));
  // observation-deck rail at the prow
  const rail = [];
  for (let k = 54; k < 64; k++) {
    for (const sgn of [-1, 1]) {
      const A = stations[k], B = stations[k + 1];
      rail.push(new THREE.BoxGeometry(B.x - A.x + 0.2, 1.1, 0.08).translate((A.x + B.x) / 2, top + 0.55, zc + sgn * (A.hw + B.hw) / 2 * 0.98));
    }
  }
  g.add(new THREE.Mesh(place(mergeGeometries(rail.map(x => x.toNonIndexed()))), M.metal));
  const x0b = x0, x1b = x1;

  // sweeping searchlights from the SkyPark, like the nightly light show
  const beamMat = () => new THREE.ShaderMaterial({
    uniforms: { c: { value: new THREE.Color() } },
    vertexShader: 'varying float vY; void main(){ vY = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 c; varying float vY; void main(){ gl_FragColor = vec4(c * pow(vY, 3.0) * 0.07, 1.0); }',
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  const cone = new THREE.ConeGeometry(9, 900, 20, 1, true).translate(0, -450, 0);
  const beams = [];
  for (let k = 0; k < 4; k++) {
    const hold = new THREE.Group();
    const p = new THREE.Vector3(x0b + 40 + k * (x1b - x0b - 80) / 3, top + 1, zc);
    p.applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
    hold.position.set(p.x + mid.x, p.y, p.z - mid.y);
    const m = new THREE.Mesh(cone, beamMat());
    m.rotation.x = Math.PI;   // cone points up from the deck
    hold.add(m);
    g.add(hold);
    beams.push({ hold, m, ph: k * 1.3 });
  }
  animated.push((dt, t) => {
    const on = Math.sin(t * 0.05) > -0.3;
    beams.forEach((b, k) => {
      b.hold.visible = on;
      b.hold.rotation.z = Math.sin(t * 0.35 + b.ph) * 0.45;
      b.hold.rotation.x = Math.cos(t * 0.27 + b.ph * 0.7) * 0.35;
      b.m.material.uniforms.c.value.setHSL((0.55 + k * 0.08 + t * 0.01) % 1, 0.6, 0.65);
    });
  });
  return g;
}

// ---------------------------------------------------------------- Singapore Flyer
function flyer(city, lm, M, animated) {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xe6e8ea, metalness: 0.5, roughness: 0.35, emissive: 0x2a2c30 });
  const R = 75, H = 165, cy = H - R;
  const wheel = new THREE.Group();
  wheel.position.y = cy;
  // truss rim: two rings tied by cross members
  const rimGeos = [];
  for (const z of [-1.8, 1.8]) rimGeos.push(new THREE.TorusGeometry(R, 0.6, 6, 180).translate(0, 0, z));
  for (let i = 0; i < 112; i++) {
    const a = i / 112 * Math.PI * 2, b = (i + 0.5) / 112 * Math.PI * 2;
    const p = new THREE.Vector3(Math.sin(a) * R, Math.cos(a) * R, -1.8), q = new THREE.Vector3(Math.sin(b) * R, Math.cos(b) * R, 1.8);
    const d = q.clone().sub(p);
    const cyl = new THREE.CylinderGeometry(0.12, 0.12, d.length(), 4);
    cyl.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    cyl.translate((p.x + q.x) / 2, (p.y + q.y) / 2, 0);
    rimGeos.push(cyl);
  }
  // cable spokes
  for (let i = 0; i < 56; i++) {
    const a = i / 56 * Math.PI * 2;
    const s = new THREE.CylinderGeometry(0.1, 0.1, R, 3).translate(0, R / 2, 0);
    s.rotateX((i % 2 ? 1 : -1) * 0.03); s.rotateZ(a);
    rimGeos.push(s);
  }
  wheel.add(new THREE.Mesh(mergeGeometries(rimGeos.map(x => (x.index ? x.toNonIndexed() : x))), white));
  // LED rings that slowly cycle through colours
  const ledMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.0, 1.9) });
  wheel.add(new THREE.Mesh(mergeGeometries([
    new THREE.TorusGeometry(R + 0.9, 0.3, 6, 200).translate(0, 0, -1.8), new THREE.TorusGeometry(R + 0.9, 0.3, 6, 200).translate(0, 0, 1.8),
  ]), ledMat));
  // 28 capsules on the outside of the rim
  const capGeo = new THREE.CapsuleGeometry(2.4, 7, 4, 12).rotateX(Math.PI / 2);
  const caps = new THREE.InstancedMesh(capGeo,
    new THREE.MeshStandardMaterial({ color: 0x223040, emissive: new THREE.Color(0.9, 1.0, 1.2), emissiveIntensity: 0.9, metalness: 0.3, roughness: 0.2 }), 28);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 28; i++) {
    const a = i / 28 * Math.PI * 2 + 0.11;
    caps.setMatrixAt(i, m4.makeTranslation(Math.sin(a) * (R + 3.6), Math.cos(a) * (R + 3.6), 0));
  }
  wheel.add(caps);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 16, 16).rotateX(Math.PI / 2), white);
  wheel.add(hub);
  g.add(wheel);
  // A-frame: two raking legs splayed along the axle (a single column seen face-on, an A from the side)
  for (const side of [-1, 1]) {
    const foot = new THREE.Vector3(0, 14, side * 32), head = new THREE.Vector3(0, cy, side * 5);
    const d = head.clone().sub(foot);
    const legG = new THREE.CylinderGeometry(1.3, 2.1, d.length(), 10)
      .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()))
      .translate((foot.x + head.x) / 2, (foot.y + head.y) / 2, (foot.z + head.z) / 2);
    g.add(new THREE.Mesh(legG, white));
  }
  g.position.set(lm.x, 0, -lm.y);
  g.rotation.y = lm.dir;
  const term = byName(city, LANDMARKS.flyer.terminal);
  const out = new THREE.Group();
  out.add(g);
  if (term) {
    const shape = new THREE.Shape(Array.from({ length: term.p.length / 2 }, (_, i) => new THREE.Vector2(term.p[i * 2], term.p[i * 2 + 1])));
    const body = new THREE.ExtrudeGeometry(shape, { depth: 13, bevelEnabled: false }).rotateX(-Math.PI / 2);
    out.add(new THREE.Mesh(tagBuilding(body, 0.57, 13, new THREE.Color(0.16, 0.19, 0.22), KIND.retail), M.glass));
    const roof = new THREE.ExtrudeGeometry(shape, { depth: 1.2, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0, 13, 0);
    const c = centroid(term.p);
    roof.translate(-c.x, 0, c.y).scale(1.04, 1, 1.04).translate(c.x, 0, -c.y);
    out.add(new THREE.Mesh(roof, white));
  }
  animated.push((dt, t) => {
    wheel.rotation.z -= dt * (Math.PI * 2 / 1800);   // one revolution in ~30 minutes
    ledMat.color.setHSL((0.52 + 0.12 * Math.sin(t * 0.08)) % 1, 0.75, 0.62).multiplyScalar(1.8);
  });
  return out;
}

// ---------------------------------------------------------------- Esplanade
// Two "durian" shells of different sizes (Theatre larger, Concert Hall smaller): a bulging,
// elongated glass lattice behind triangular aluminium sunshades. At night the halls glow warm
// gold through the lattice; each shell lifts off a glazed base on a white ring beam and V-struts.
function shellMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0x8f8a80, roughness: 0.45, metalness: 0.6, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aGrid; varying vec2 vGrid;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvGrid = aGrid;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGrid;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          // diamond lattice: two families of diagonals; each diamond split into an open glass
          // triangle (warm glow) and a sunshade triangle (dim aluminium)
          float a = vGrid.x + vGrid.y, b = vGrid.x - vGrid.y;
          float fa = fract(a), fb = fract(b);
          float edge = min(min(fa, 1.0 - fa), min(fb, 1.0 - fb));
          float px = max(fwidth(a), fwidth(b));
          float frame = 1.0 - smoothstep(0.05, 0.05 + px * 1.5, edge);
          float shade = step(fa, fb);
          vec3 glow = vec3(1.0, 0.62, 0.28);
          vec3 cell = mix(glow * 0.85, glow * 0.22, shade);
          vec3 lat = mix(cell, vec3(0.42, 0.4, 0.37), frame);
          // far away the lattice averages to a soft gold
          float far = smoothstep(0.25, 0.8, px);
          totalEmissiveRadiance += mix(lat, glow * 0.42, far);
        }`);
  };
  mat.customProgramCacheKey = () => 'esplanade-shell';
  return mat;
}

function esplanade(domes, M) {
  const g = new THREE.Group();
  const cfg = LANDMARKS.esplanade;
  const shellMat = shellMaterial();
  // the sunshades catch the warm light from inside, so they read silver-gold rather than dark
  const spikeMat = new THREE.MeshStandardMaterial({ color: 0xb4afa4, roughness: 0.35, metalness: 0.7, emissive: new THREE.Color(0.32, 0.22, 0.11) });
  const spike = new THREE.ConeGeometry(0.7, 1.1, 3).translate(0, 0.55, 0);
  const whites = [], glassBase = [];
  const p = 2.6;   // superellipse exponent: fuller than a hemisphere
  for (const b of domes) {
    const o = obb(b.p);
    const ax = o.len / 2 * 0.98, az = o.wid / 2 * 0.98;
    const H = cfg.heights[b.n] || b.h, s0 = cfg.spring;
    const h = H - s0, ye = 0.16 * h;    // bulge (widest) a little above the spring line
    // profile (r, y) from the spring line, out to the bulge, then over the top
    const prof = [];
    for (let k = 0; k <= 4; k++) {
      const t = k / 4;
      prof.push(new THREE.Vector2(0.86 + 0.14 * Math.sin(t * Math.PI / 2), ye * t));
    }
    for (let k = 1; k <= 24; k++) {
      const f = k / 24 * Math.PI / 2;
      prof.push(new THREE.Vector2(Math.pow(Math.cos(f), 2 / p), ye + (h - ye) * Math.pow(Math.sin(f), 2 / p)));
    }
    prof[prof.length - 1].x = 0.001;
    const shell = new THREE.LatheGeometry(prof.map(v => new THREE.Vector2(v.x, v.y)), 96);
    // lattice coordinates: ~3.3 m diamonds around and up the shell
    const uv = shell.attributes.uv, grid = new Float32Array(uv.count * 2);
    const around = Math.PI * (ax + az) / 3.3, up = (h + (ax + az) / 2) / 3.3;
    for (let i = 0; i < uv.count; i++) { grid[i * 2] = uv.getX(i) * Math.round(around); grid[i * 2 + 1] = uv.getY(i) * up; }
    shell.setAttribute('aGrid', new THREE.BufferAttribute(grid, 2));
    shell.scale(ax, 1, az);
    shell.rotateY(o.a);
    shell.translate(o.cx, s0, -o.cy);
    g.add(new THREE.Mesh(shell, shellMat));
    // sunshade spikes on a latitude / longitude grid, oriented along the surface normal
    const items = [];
    for (let r = 1; r < 24; r++) {
      const f = r / 24 * Math.PI / 2 * 0.97;
      const rr = Math.pow(Math.cos(f), 2 / p), yy = ye + (h - ye) * Math.pow(Math.sin(f), 2 / p);
      const ring = Math.max(6, Math.round(rr * Math.PI * (ax + az) / 4.2));
      for (let k = 0; k < ring; k++) {
        const th = (k + (r % 2) * 0.5) / ring * Math.PI * 2;
        const lx = Math.cos(th) * rr * ax, lz = Math.sin(th) * rr * az;
        const n = new THREE.Vector3(lx / (ax * ax), (yy - ye) / (h * h) * 1.4, lz / (az * az)).normalize();
        const pos = new THREE.Vector3(lx, s0 + yy, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), o.a);
        n.applyAxisAngle(new THREE.Vector3(0, 1, 0), o.a);
        items.push({ pos: pos.add(new THREE.Vector3(o.cx, 0, -o.cy)), n });
      }
    }
    const inst = new THREE.InstancedMesh(spike, spikeMat, items.length);
    const q = new THREE.Quaternion(), m = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1), upV = new THREE.Vector3(0, 1, 0);
    items.forEach((it, k) => { q.setFromUnitVectors(upV, it.n); m.compose(it.pos, q, one); inst.setMatrixAt(k, m); });
    g.add(inst);
    // glazed base, white ring beam and V-struts under the spring line
    const ring = new THREE.TorusGeometry(1, 0.035, 6, 96).rotateX(Math.PI / 2).scale(ax * 0.86, 1, az * 0.86);
    whites.push(ring.scale(1, 18, 1).rotateY(o.a).translate(o.cx, s0, -o.cy));
    glassBase.push(new THREE.CylinderGeometry(1, 1, s0 - 0.6, 64, 1, true).scale(ax * 0.8, 1, az * 0.8).rotateY(o.a).translate(o.cx, (s0 - 0.6) / 2, -o.cy));
    const nV = Math.round(Math.PI * (ax + az) * 0.86 / 9);
    for (let k = 0; k < nV; k++) {
      const t0 = k / nV * Math.PI * 2, t1 = (k + 0.5) / nV * Math.PI * 2;
      const P = (t, r, y) => new THREE.Vector3(Math.cos(t) * ax * r, y, Math.sin(t) * az * r).applyAxisAngle(upV, o.a).add(new THREE.Vector3(o.cx, 0, -o.cy));
      for (const [A, B] of [[P(t0, 0.84, 0), P(t1, 0.86, s0)], [P(t1 * 2 - t0, 0.84, 0), P(t1, 0.86, s0)]]) {
        const d = B.clone().sub(A);
        whites.push(new THREE.CylinderGeometry(0.28, 0.32, d.length(), 6).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(upV, d.clone().normalize())).translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2));
      }
    }
  }
  const plain = x => { x = x.index ? x.toNonIndexed() : x; if (x.attributes.uv) x.deleteAttribute('uv'); return x; };
  if (whites.length) g.add(new THREE.Mesh(mergeGeometries(whites.map(plain)), M.white));
  if (glassBase.length) g.add(new THREE.Mesh(mergeGeometries(glassBase.map(plain)), new THREE.MeshStandardMaterial({ color: 0x1c1a17, roughness: 0.2, metalness: 0.4, emissive: new THREE.Color(0.55, 0.38, 0.2), side: THREE.DoubleSide })));
  return g;
}

// ---------------------------------------------------------------- the Padang
function pointIn(x, y, r) {
  let ins = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    if ((r[i + 1] > y) !== (r[j + 1] > y) && x < (r[j] - r[i]) * (y - r[i + 1]) / (r[j + 1] - r[i + 1]) + r[i]) ins = !ins;
  }
  return ins;
}

// a flat ground polygon built in OSM (x, y) and flipped into scene (x, -y): make it face up
function fixUp(g) {
  g.computeVertexNormals();
  if (g.attributes.normal.getY(0) < 0) {
    const idx = g.index.array;
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    g.computeVertexNormals();
  }
  return g;
}

function columns(geos, n, len, h, r, x0, z, y0 = 0) {
  for (let k = 0; k < n; k++) {
    const x = x0 - len / 2 + (k + 0.5) * len / n;
    geos.push(new THREE.CylinderGeometry(r * 0.85, r, h, 10).translate(x, y0 + h / 2, z));
    geos.push(new THREE.BoxGeometry(r * 2.4, 0.8, r * 2.4).translate(x, y0 + h + 0.4, z));   // capital
  }
}

function windowRows(geos, lit, len, wid, h, floors, rnd) {
  // tall arched-window rows on the long faces: dark frames, some lit
  for (const side of [-1, 1]) {
    for (let f = 0; f < floors; f++) {
      const y = 3 + f * (h - 4) / floors;
      for (let x = -len / 2 + 4; x < len / 2 - 3; x += 4.2) {
        const w = new THREE.BoxGeometry(1.6, (h - 4) / floors * 0.6, 0.3).translate(x, y + (h - 4) / floors * 0.35, side * (wid / 2 + 0.1));
        (rnd() < 0.55 ? lit : geos).push(w);
      }
    }
  }
}

function padang(city, M, lm) {
  const g = new THREE.Group();
  const cfg = LANDMARKS.padang;
  const pad = lm || { x: -682, y: 78 };
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const white = [], dark = [], lit = [], copper = [], roof = [], glassBox = [], led = [], slate = [], cream = [], bright = [];

  const place = (b, build) => {
    if (!b) return;
    const o = obb(b.p);
    const a = facing(o, pad.x, pad.y);   // local +z toward the Padang
    const local = { white: [], dark: [], lit: [], copper: [], roof: [], glassBox: [], led: [], slate: [], cream: [] };
    build(o, local, a);
    for (const [k, list] of Object.entries(local)) {
      for (const geo of list) ({ white, dark, lit, copper, roof, glassBox, led, slate, cream })[k].push(toWorld(geo, o.cx, o.cy, a));
    }
  };

  // City Hall: long neo-classical block with a colonnade of 18 Corinthian columns facing the Padang
  place(byName(city, cfg.cityHall.match), (o, L) => {
    const h = cfg.cityHall.h, len = o.len * 0.92, wid = o.wid * 0.7;
    L.white.push(new THREE.BoxGeometry(len, h, wid).translate(0, h / 2, -1.5));
    L.white.push(new THREE.BoxGeometry(len + 1, 1.4, wid + 1).translate(0, h + 0.7, -1.5));  // cornice
    L.white.push(new THREE.BoxGeometry(len * 0.62, 2.6, 6).translate(0, 1.3, wid / 2 + 1.5));  // plinth + steps
    columns(L.white, 18, len * 0.6, h - 6, 0.85, 0, wid / 2 + 2.2, 2.6);
    L.white.push(new THREE.BoxGeometry(len * 0.62, 1.8, 4.6).translate(0, h - 2.5, wid / 2 + 2.2));  // entablature
    windowRows(L.dark, L.lit, len, wid - 3, h, 3, rnd);
  });

  // Old Supreme Court: portico with pediment, and the green copper dome on a drum
  place(byName(city, cfg.oldSupremeCourt.match), (o, L) => {
    const h = cfg.oldSupremeCourt.h, len = o.len * 0.9, wid = o.wid * 0.75;
    L.white.push(new THREE.BoxGeometry(len, h, wid).translate(0, h / 2, -2));
    L.white.push(new THREE.BoxGeometry(len + 1, 1.2, wid + 1).translate(0, h + 0.6, -2));
    columns(L.white, 8, len * 0.42, h - 7, 0.9, 0, wid / 2 + 1.5, 2);
    L.white.push(new THREE.BoxGeometry(len * 0.45, 1.6, 4).translate(0, h - 4.2, wid / 2 + 1.5));
    const ped = new THREE.Shape();
    ped.moveTo(-len * 0.24, 0); ped.lineTo(len * 0.24, 0); ped.lineTo(0, 6.5); ped.lineTo(-len * 0.24, 0);
    L.white.push(new THREE.ExtrudeGeometry(ped, { depth: 3, bevelEnabled: false }).translate(0, h - 3.4, wid / 2 + 0.2));
    // drum, dome and lantern, set toward the back of the block
    const dz = -wid * 0.12, r = 9.5;
    L.white.push(new THREE.CylinderGeometry(r + 0.6, r + 1.2, 7, 32).translate(0, h + 1.2 + 3.5, dz));
    L.copper.push(new THREE.SphereGeometry(r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 1.15, 1).translate(0, h + 8.2, dz));
    L.white.push(new THREE.CylinderGeometry(1.6, 1.8, 3.6, 12).translate(0, h + 8.2 + r * 1.15 + 1.6, dz));
    L.copper.push(new THREE.SphereGeometry(1.8, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, h + 8.2 + r * 1.15 + 3.4, dz));
    for (let k = 0; k < 16; k++) {
      const a = k / 16 * Math.PI * 2;
      L.lit.push(new THREE.BoxGeometry(1.2, 3.2, 0.3).rotateY(-a).translate(Math.sin(a) * (r + 0.7), h + 4.7, dz + Math.cos(a) * (r + 0.7)));
    }
    windowRows(L.dark, L.lit, len, wid - 3, h, 3, rnd);
  });

  // Supreme Court of Singapore (2005): glass block crowned by the floating disc
  place(byName(city, cfg.newSupremeCourt.match), (o, L) => {
    const h = cfg.newSupremeCourt.h, len = o.len * 0.7, wid = o.wid * 0.6;
    L.white.push(new THREE.BoxGeometry(len, 8, wid + 6).translate(0, 4, 0));
    L.glassBox.push(new THREE.BoxGeometry(len * 0.94, h - 16, wid * 0.94).translate(0, 8 + (h - 16) / 2, 0));
    for (let x = -len / 2 + 2; x <= len / 2 - 2; x += 3.2) L.white.push(new THREE.BoxGeometry(0.35, h - 16, wid).translate(x, 8 + (h - 16) / 2, 0));
    // the "saucer": a lens-shaped disc on a short stem, with the glass viewing drum on top
    const R = Math.min(len, wid) * 0.66;
    L.white.push(new THREE.CylinderGeometry(3, 3, 9, 16).translate(0, h - 4.5, 0));
    const lens = [];
    for (let k = 0; k <= 12; k++) { const t = k / 12; lens.push(new THREE.Vector2(R * Math.sin(t * Math.PI / 2), -2.4 * Math.cos(t * Math.PI / 2))); }
    for (let k = 1; k <= 12; k++) { const t = k / 12; lens.push(new THREE.Vector2(R * Math.cos(t * Math.PI / 2), 1.6 * Math.sin(t * Math.PI / 2))); }
    L.white.push(new THREE.LatheGeometry(lens, 64).translate(0, h + 1.8, 0));
    L.glassBox.push(new THREE.CylinderGeometry(R * 0.36, R * 0.36, 6, 40).translate(0, h + 6.4, 0));
    L.white.push(new THREE.CylinderGeometry(R * 0.38, R * 0.38, 0.6, 40).translate(0, h + 9.6, 0));
    L.led.push(new THREE.TorusGeometry(R * 0.995, 0.25, 4, 96).rotateX(Math.PI / 2).translate(0, h + 1.8, 0));
  });

  // Singapore Cricket Club: two-storey pavilion, verandah on the Padang side, red tiled roof
  place(byName(city, cfg.cricketClub.match), (o, L) => {
    const h = cfg.cricketClub.h * 0.62, len = o.len * 0.85, wid = o.wid * 0.6;
    L.white.push(new THREE.BoxGeometry(len, h, wid).translate(0, h / 2, -2));
    columns(L.white, 12, len * 0.9, h - 1, 0.35, 0, wid / 2 + 1.2);
    L.white.push(new THREE.BoxGeometry(len, 0.6, 4).translate(0, h - 0.3, wid / 2));
    L.roof.push(prism(len + 1.5, 5.5, wid + 5).translate(0, h, -0.5));
    windowRows(L.dark, L.lit, len, wid, h, 2, rnd);
  });


  // National Gallery: the metal roof "veil" that links the Old Supreme Court and City Hall
  const osc = byName(city, cfg.oldSupremeCourt.match), ch = byName(city, cfg.cityHall.match);
  if (osc && ch) {
    const A = centroid(osc.p), B = centroid(ch.p), mid = A.clone().add(B).multiplyScalar(0.5);
    const ang = Math.atan2(B.y - A.y, B.x - A.x);
    const veil = new THREE.BoxGeometry(A.distanceTo(B) * 0.42, 0.5, 60).translate(0, cfg.cityHall.h + 4.5, 0);
    led.push(toWorld(new THREE.BoxGeometry(A.distanceTo(B) * 0.42, 0.2, 0.4).translate(0, cfg.cityHall.h + 4.2, 30), mid.x, mid.y, ang));
    cream.push(toWorld(veil, mid.x, mid.y, ang));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      white.push(toWorld(new THREE.CylinderGeometry(0.5, 0.6, cfg.cityHall.h + 4.5, 8).translate(sx * A.distanceTo(B) * 0.18, (cfg.cityHall.h + 4.5) / 2, sz * 26), mid.x, mid.y, ang));
    }
  }

  // St Andrew's Cathedral: white Gothic nave and transepts under slate roofs, the west tower and
  // its tall octagonal spire with corner pinnacles, lancet windows lit from inside
  const sac = byName(city, cfg.standrews.match);
  if (sac) {
    const o = obb(sac.p);
    // spire at the south-west end of the long axis
    const flip = Math.cos(o.a) + Math.sin(o.a) > 0 ? 0 : Math.PI;   // local -x is the south-west end
    const L = { white: [], dark: [], lit: [], slate: [] };
    const len = o.len * 0.92, nw = Math.min(o.wid * 0.42, 22), wh = 15;
    L.white.push(new THREE.BoxGeometry(len, wh, nw).translate(0, wh / 2, 0));
    L.slate.push(prism(len + 1, 8, nw + 2).translate(0, wh, 0));
    const tx = len * 0.12;
    L.white.push(new THREE.BoxGeometry(14, wh, o.wid * 0.85).translate(tx, wh / 2, 0));
    L.slate.push(prism(o.wid * 0.85 + 1, 8, 16).rotateY(Math.PI / 2).translate(tx, wh, 0));
    // west tower and spire
    const sx = -len / 2 - 4;
    L.white.push(new THREE.BoxGeometry(10, 32, 10).translate(sx, 16, 0));
    L.white.push(new THREE.ConeGeometry(4.6, 30, 8).translate(sx, 32 + 15, 0));
    for (const [px, pz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      L.white.push(new THREE.ConeGeometry(0.9, 7, 4).translate(sx + px * 4.4, 32 + 3.5, pz * 4.4));
    }
    // buttresses and lit lancet windows along the nave
    for (let x = -len / 2 + 5; x < len / 2 - 3; x += 5.5) {
      for (const s2 of [-1, 1]) {
        L.white.push(new THREE.BoxGeometry(1.2, wh * 0.85, 1.6).translate(x, wh * 0.42, s2 * (nw / 2 + 0.6)));
        L.lit.push(new THREE.BoxGeometry(1.4, 7, 0.3).translate(x + 2.7, 7, s2 * (nw / 2 + 0.1)));
      }
    }
    L.lit.push(new THREE.BoxGeometry(0.3, 6, 3).translate(sx - 5.1, 12, 0));   // west door / window
    for (const [k, list] of Object.entries(L)) {
      for (const geo of list) ({ white: bright, dark, lit, slate })[k].push(toWorld(geo.rotateY(flip), o.cx, o.cy, o.a));
    }
  }

  // The Fullerton Hotel: long cream neo-classical block, giant Doric colonnades on every face,
  // cornice and attic, a rooftop lantern; floodlit warm at night
  const ful = byName(city, cfg.fullerton.match);
  if (ful) {
    const o = obb(ful.p), h = cfg.fullerton.h;
    const len = o.len * 0.96, wid = o.wid * 0.94;
    const C = [];
    C.push(new THREE.BoxGeometry(len, h - 3, wid).translate(0, (h - 3) / 2, 0));
    C.push(new THREE.BoxGeometry(len + 1.6, 1.4, wid + 1.6).translate(0, h - 3.6, 0));     // cornice
    C.push(new THREE.BoxGeometry(len - 6, 3, wid - 6).translate(0, h - 1.5, 0));          // attic
    C.push(new THREE.BoxGeometry(len + 0.8, 6, wid + 0.8).translate(0, 3, 0));             // rusticated base
    for (const s2 of [-1, 1]) {
      columns(C, Math.round(len / 4.4), len * 0.86, h - 13, 0.75, 0, s2 * (wid / 2 + 1), 7);
      const cw = [];
      columns(cw, Math.round(wid / 4.4), wid * 0.8, h - 13, 0.75, 0, s2 * (len / 2 + 1), 7);
      cw.forEach(g2 => C.push(g2.rotateY(Math.PI / 2)));
    }
    C.push(new THREE.BoxGeometry(8, 5, 8).translate(0, h + 2.5, 0));
    C.push(new THREE.CylinderGeometry(0.15, 0.15, 10, 5).translate(0, h + 10, 0));
    const W = [], Lt = [];
    windowRows(W, Lt, len, wid, h - 3, 4, rnd);
    const wr = [], lr = [];
    windowRows(wr, lr, wid, len, h - 3, 4, rnd);
    wr.forEach(g2 => W.push(g2.rotateY(Math.PI / 2)));
    lr.forEach(g2 => Lt.push(g2.rotateY(Math.PI / 2)));
    for (const geo of C) cream.push(toWorld(geo, o.cx, o.cy, o.a));
    for (const geo of W) dark.push(toWorld(geo, o.cx, o.cy, o.a));
    for (const geo of Lt) lit.push(toWorld(geo, o.cx, o.cy, o.a));
  }

  // Singapore Recreation Club: two white storeys under grey hipped roofs, a central pediment
  // with green trim over a columned porch facing the Padang
  place(byName(city, cfg.recreationClub.match), (o, L) => {
    const h = 9, len = o.len * 0.9, wid = o.wid * 0.7;
    L.white.push(new THREE.BoxGeometry(len, h, wid).translate(0, h / 2, 0));
    L.slate.push(prism(len * 0.62, 6, wid + 2).translate(0, h, 0));
    for (const s2 of [-1, 1]) L.slate.push(prism(wid * 0.9, 5, len * 0.22).rotateY(Math.PI / 2).translate(s2 * len * 0.38, h, 0));
    const ped = new THREE.Shape();
    ped.moveTo(-9, 0); ped.lineTo(9, 0); ped.lineTo(0, 5); ped.lineTo(-9, 0);
    L.white.push(new THREE.ExtrudeGeometry(ped, { depth: 1.2, bevelEnabled: false }).translate(0, h, wid / 2 + 3));
    L.led.push(new THREE.BoxGeometry(18.5, 0.25, 0.25).translate(0, h + 0.1, wid / 2 + 4.3));
    columns(L.white, 6, 18, h - 1, 0.55, 0, wid / 2 + 3.6);
    windowRows(L.dark, L.lit, len, wid, h, 2, rnd);
  });

  // the Padang: a floodlit lawn with the cricket square and a white boundary rope
  const lawnRing = (city.parks || []).find(r => pointIn(pad.x, pad.y, r));
  if (lawnRing) {
    const sh = new THREE.Shape(Array.from({ length: lawnRing.length / 2 }, (_, i) => new THREE.Vector2(lawnRing[i * 2], lawnRing[i * 2 + 1])));
    const lawn = new THREE.ShapeGeometry(sh).rotateX(-Math.PI / 2).translate(0, 0.05, 0);
    g.add(new THREE.Mesh(fixUp(lawn), new THREE.MeshStandardMaterial({ color: 0x2f5f2a, roughness: 0.95, emissive: new THREE.Color(0.02, 0.07, 0.025) })));
    const sq = new THREE.PlaneGeometry(22, 4).rotateX(-Math.PI / 2).rotateY(-pad.dir).translate(pad.x + Math.cos(pad.dir) * 40, 0.08, -(pad.y + Math.sin(pad.dir) * 40));
    g.add(new THREE.Mesh(sq, new THREE.MeshStandardMaterial({ color: 0x8d7d58, roughness: 1, emissive: 0x1a160c })));
    g.add(new THREE.Mesh(new THREE.TorusGeometry(62, 0.12, 3, 96).rotateX(Math.PI / 2).translate(pad.x + Math.cos(pad.dir) * 40, 0.15, -(pad.y + Math.sin(pad.dir) * 40)), M.led));
  }

  const add = (list, mat) => { if (list.length) g.add(new THREE.Mesh(mergeGeometries(list.map(x => (x.index ? x.toNonIndexed() : x)).map(x => { if (x.attributes.uv) x.deleteAttribute('uv'); return x; })), mat)); };
  add(white, M.heritage); add(dark, M.heritageDark); add(lit, M.windowLit); add(copper, M.copper); add(roof, M.roof); add(glassBox, M.litGlass);
  add(led, M.led); add(slate, M.slate); add(cream, M.cream); add(bright, M.floodWhite);
  return g;
}

// ---------------------------------------------------------------- ArtScience Museum
// A lotus of ten "fingers" over a lily pond: broad cupped shells that flare out of a central bowl
// and sweep up into crescents of different heights, each ending in a blunt tip with a glass
// skylight. The bowl stands on raking dark columns.
function artScience(M) {
  const cfg = LANDMARKS.artScience;
  const g = new THREE.Group();
  const shells = [], glass = [], dark = [];
  const y0 = 13;                       // underside of the bowl / spring line of the fingers
  // the bowl: a shallow lathe from the column heads up to the finger roots
  const bowl = [];
  for (let k = 0; k <= 10; k++) {
    const t = k / 10;
    bowl.push(new THREE.Vector2(4 + 9 * Math.sin(t * Math.PI / 2), y0 - 5 + 7 * (1 - Math.cos(t * Math.PI / 2))));
  }
  shells.push(new THREE.LatheGeometry(bowl, 40));
  shells.push(new THREE.CylinderGeometry(13.2, 13.2, 1.2, 40).translate(0, y0 + 2.4, 0));
  // raking columns from the pond to the bowl
  for (let k = 0; k < 9; k++) {
    const a = k / 9 * Math.PI * 2 + 0.2;
    const foot = new THREE.Vector3(Math.cos(a) * 15, 0, Math.sin(a) * 15), head = new THREE.Vector3(Math.cos(a + 0.35) * 7, y0 - 4, Math.sin(a + 0.35) * 7);
    const d = head.clone().sub(foot);
    dark.push(new THREE.CylinderGeometry(0.8, 1.0, d.length(), 8).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize())).translate((foot.x + head.x) / 2, (foot.y + head.y) / 2, (foot.z + head.z) / 2));
  }
  // fingers: heights rise toward one side (the tallest ~60 m faces the bay), alternate a little
  for (let k = 0; k < cfg.petals; k++) {
    const az = k / cfg.petals * Math.PI * 2;
    const tall = 0.25 + 0.75 * Math.pow(0.5 + 0.5 * Math.cos(az - 0.6), 1.6) * (k % 2 ? 0.82 : 1);
    const B = 5 + (cfg.h - y0 - 5) * Math.pow(tall, 1.25);   // rise
    const A = 40 - 12 * tall;                                  // outward reach: low fingers splay wide
    const Wmax = 17 + 6 * tall;
    const radial = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
    const side = new THREE.Vector3(-Math.sin(az), 0, Math.cos(az));
    const spine = [];
    const N = 18, thMax = THREE.MathUtils.degToRad(38 + 52 * tall);
    for (let j = 0; j <= N; j++) {
      const u = j / N, th = u * thMax;
      const p = radial.clone().multiplyScalar(10 + A * Math.sin(th)).setY(y0 + 2 + B * (1 - Math.cos(th)) / (1 - Math.cos(thMax)));
      const tan = radial.clone().multiplyScalar(A * Math.cos(th)).setY(B * Math.sin(th) / (1 - Math.cos(thMax))).normalize();
      const nrm = new THREE.Vector3().crossVectors(side, tan).normalize();
      // broad through the middle, rounding off to a blunt tip
      let w = Wmax * (0.5 + 0.5 * Math.pow(Math.sin(Math.PI * Math.min(u, 0.85) / 1.7 + 0.25), 0.8));
      if (u > 0.9) w *= Math.sqrt(Math.max(0.04, 1 - Math.pow((u - 0.9) / 0.1, 2)));
      spine.push({ p, side, nrm, w, h: 1.8 - 0.9 * u, cam: 3.6 * Math.min(1, u * 3) });
    }
    shells.push(sweep(spine, 16));
    // skylight glazing on the blunt end of each finger
    const tip = spine[N - 1], q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(tip.side, tip.nrm, new THREE.Vector3().crossVectors(tip.side, tip.nrm)));
    glass.push(new THREE.SphereGeometry(1, 14, 8).scale(tip.w * 0.32, 0.35, 1.4).applyQuaternion(q).translate(tip.p.x, tip.p.y, tip.p.z));
  }
  const plain = x => { x = x.index ? x.toNonIndexed() : x; if (x.attributes.uv) x.deleteAttribute('uv'); if (!x.attributes.normal) x.computeVertexNormals(); return x; };
  g.add(new THREE.Mesh(mergeGeometries(shells.map(plain)), M.white));
  g.add(new THREE.Mesh(mergeGeometries(glass.map(plain)), new THREE.MeshStandardMaterial({ color: 0x1d3a3a, roughness: 0.15, metalness: 0.5, emissive: new THREE.Color(0.12, 0.38, 0.36) })));
  g.add(new THREE.Mesh(mergeGeometries(dark.map(plain)), M.concrete));
  // the lily pond around it
  const pond = new THREE.Mesh(new THREE.CircleGeometry(58, 48), new THREE.MeshStandardMaterial({ color: 0x07131c, roughness: 0.2, metalness: 0.6 }));
  pond.rotation.x = -Math.PI / 2; pond.position.y = 0.08;
  g.add(pond);
  g.position.set(cfg.x, 0, -cfg.y);
  return g;
}

// ---------------------------------------------------------------- CBD towers
function cbd(city, M) {
  const g = new THREE.Group();
  const glass = [], metal = [], led = [], flood = [];
  const tint = new THREE.Color(0.28, 0.3, 0.34);
  for (const t of LANDMARKS.cbd) {
    const b = byName(city, t.match);
    if (!b) continue;
    const o = obb(b.p);
    const H = t.h;
    if (t.style === 'uob') {
      // UOB Plaza: granite-clad square shafts with chamfered corners, stepping up through faceted
      // tiers (alternately rotated 45 degrees) to a small round crown; the crown is floodlit
      const w = t.key === 'uob1' ? 46 : 38;
      const stone = new THREE.Color(0.36, 0.31, 0.26);
      const tiers = [
        [0, 0.76, 1, 0.2, 0], [0.76, 0.84, 0.88, 0.32, Math.PI / 4], [0.84, 0.91, 0.72, 0.2, 0],
        [0.91, 0.96, 0.56, 0.32, Math.PI / 4], [0.96, 0.985, 0.4, 0.2, 0],
      ];
      tiers.forEach(([y0, y1, s, ch, rot], k) => {
        const geo = extrudeUp(chamferedSquare(w * s, ch), H * y0, H * y1).rotateY(rot);
        // one facade for every tier (windows continue into the crown); the shader floodlights the top
        glass.push(tagBuilding(toWorld(geo, o.cx, o.cy, o.a), 0.41 + (t.key === 'uob1' ? 0 : 0.2), H, stone, KIND.stone));
      });
      flood.push(toWorld(new THREE.CylinderGeometry(w * 0.17, w * 0.19, H * 0.03, 32).translate(0, H * 0.985 + H * 0.015, 0), o.cx, o.cy, o.a));
      led.push(toWorld(new THREE.TorusGeometry(w * 0.18, 0.3, 4, 40).rotateX(Math.PI / 2).translate(0, H + 0.3, 0), o.cx, o.cy, o.a));
    } else if (t.style === 'ocbc') {
      // OCBC Centre, "the calculator": a slab between two half-round service cores
      const len = 44, wid = 21;
      glass.push(tagBuilding(toWorld(new THREE.BoxGeometry(len, H, wid).translate(0, H / 2, 0), o.cx, o.cy, o.a), 0.12, H, tint));
      for (const s of [-1, 1]) {
        metal.push(toWorld(new THREE.CylinderGeometry(wid / 2, wid / 2, H + 6, 24, 1, false, s > 0 ? 0 : Math.PI, Math.PI).translate(s * len / 2, (H + 6) / 2, 0), o.cx, o.cy, o.a));
        // two vertical fins on each face split the window wall into three bays
        for (const f of [-1, 1]) metal.push(toWorld(new THREE.BoxGeometry(1.4, H, 1.6).translate(s * len / 6, H / 2, f * (wid / 2 + 0.5)), o.cx, o.cy, o.a));
      }
      led.push(toWorld(new THREE.BoxGeometry(len, 0.6, wid + 0.4).translate(0, H + 0.3, 0), o.cx, o.cy, o.a));
    } else {
      // crown lights tracing the roofline of an OSM-extruded tower (One Raffles Quay)
      const c = Math.cos(o.a), s = Math.sin(o.a);
      for (const [dx, dy, len, rot] of [[0, o.wid / 2, o.len, 0], [0, -o.wid / 2, o.len, 0], [o.len / 2, 0, o.wid, Math.PI / 2], [-o.len / 2, 0, o.wid, Math.PI / 2]]) {
        const x = o.cx + dx * c - dy * s, y = o.cy + dx * s + dy * c;
        led.push(new THREE.BoxGeometry(len, 0.7, 0.7).rotateY(o.a + rot).translate(x, b.h + 0.4, -y));
      }
      metal.push(new THREE.CylinderGeometry(0.3, 0.7, 22, 6).translate(o.cx, b.h + 11, -o.cy));
    }
  }
  if (glass.length) g.add(new THREE.Mesh(mergeGeometries(glass), M.glass));
  if (metal.length) g.add(new THREE.Mesh(mergeGeometries(metal.map(x => (x.index ? x.toNonIndexed() : x))), M.metal));
  if (led.length) g.add(new THREE.Mesh(mergeGeometries(led.map(x => (x.index ? x.toNonIndexed() : x))), M.led));
  if (flood.length) g.add(new THREE.Mesh(mergeGeometries(flood.map(x => (x.index ? x.toNonIndexed() : x))), M.floodlit));
  return g;
}

// ---------------------------------------------------------------- atmosphere
// Distant skyline bands on three cylinders: each band moves at its own rate as the camera moves
// (parallax), and fades toward the haze colour with distance. Sea sectors carry ship lights.
function horizonLayers(scene) {
  const g = new THREE.Group();
  const haze = new THREE.Color(COLORS.night);
  const layers = [
    { r: 3300, h: 260, dens: 1.0, fade: 0.35 },
    { r: 4600, h: 330, dens: 0.8, fade: 0.55 },
    { r: 6400, h: 380, dens: 0.6, fade: 0.75 },
  ];
  // OSM angle (radians, east = 0, north = pi/2) of open sea: Singapore Strait to the south-east / south
  const isSea = a => a > -2.6 && a < -0.15;
  layers.forEach((L, li) => {
    const W = 4096, Hc = 256;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = Hc;
    const c = cv.getContext('2d');
    let seed = 99 + li * 31;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const sil = new THREE.Color(0.02, 0.025, 0.05).lerp(haze, L.fade);
    for (let x = 0; x < W;) {
      // canvas u -> cylinder theta -> OSM angle (theta - pi/2, mirrored by the back-face view)
      const theta = x / W * Math.PI * 2;
      const osm = Math.atan2(-Math.cos(theta), Math.sin(theta));
      const bw = 6 + rnd() * 26;
      if (isSea(osm)) {
        // anchored ships: a few warm dots on the horizon line
        if (rnd() < 0.18 * L.dens) {
          c.fillStyle = `rgba(255,${190 + rnd() * 50 | 0},120,${0.5 - li * 0.12})`;
          c.fillRect(x, Hc - 6 - rnd() * 4, 2, 2);
        }
        x += bw; continue;
      }
      const tall = rnd() < 0.12 ? 0.55 + rnd() * 0.45 : 0.08 + rnd() * 0.35;
      const bh = Hc * tall * L.dens;
      c.fillStyle = `rgb(${sil.r * 255 | 0},${sil.g * 255 | 0},${sil.b * 255 | 0})`;
      c.fillRect(x, Hc - bh, bw, bh);
      // lit windows, dimmer and sparser with distance
      const lights = Math.floor(bw * bh / 60 * (1 - L.fade * 0.6));
      for (let k = 0; k < lights; k++) {
        if (rnd() > 0.45) continue;
        const warm = rnd() < 0.6;
        c.fillStyle = warm ? `rgba(255,190,120,${0.55 - L.fade * 0.4})` : `rgba(190,215,255,${0.5 - L.fade * 0.4})`;
        c.fillRect(x + rnd() * (bw - 1), Hc - bh + 2 + rnd() * (bh - 3), 1.2, 1.2);
      }
      if (tall > 0.6 && rnd() < 0.5) { c.fillStyle = 'rgba(255,40,30,0.8)'; c.fillRect(x + bw / 2, Hc - bh - 2, 2, 2); }
      x += bw + (rnd() < 0.2 ? rnd() * 20 : 0);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(L.r, L.r, L.h, 160, 1, true).translate(0, L.h / 2 - 4, 0),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.BackSide, depthWrite: false, fog: false, color: new THREE.Color(1.15, 1.15, 1.15) }));
    mesh.renderOrder = -1 + li * 0.01;
    g.add(mesh);
  });
  // a low glow of city light in the haze, brightest over the CBD
  const glow = new THREE.Mesh(new THREE.CylinderGeometry(7000, 7000, 900, 96, 1, true).translate(0, 420, 0), new THREE.ShaderMaterial({
    uniforms: { c: { value: new THREE.Color(0.32, 0.13, 0.15) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 c; varying vec2 vUv; void main(){ float a = pow(1.0 - vUv.y, 2.5) * (0.6 + 0.4 * sin(vUv.x * 6.2831 + 1.2)); gl_FragColor = vec4(c * a * 0.5, 1.0); }',
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide, fog: false,
  }));
  g.add(glow);
  scene.add(g);
  return g;
}

// Occasional firework bursts over Marina Bay.
class Fireworks {
  constructor(scene, max = 4000) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.base = new Float32Array(max * 3);
    this.age = new Float32Array(max).fill(99);
    this.life = new Float32Array(max).fill(1);
    this.next = 0;
    this.timer = 4;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({
      size: 2.6, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    // launch spots over the bay (OSM metres)
    this.spots = [[-190, -360], [-80, -470], [-260, -250]];
  }

  burst() {
    const [sx, sy] = this.spots[(Math.random() * this.spots.length) | 0];
    const x = sx + (Math.random() - 0.5) * 80, z = -(sy + (Math.random() - 0.5) * 80), y = 150 + Math.random() * 90;
    const c = new THREE.Color().setHSL(Math.random(), 0.85, 0.6).multiplyScalar(3);
    const n = 260, speed = 22 + Math.random() * 14;
    for (let k = 0; k < n; k++) {
      const i = this.next; this.next = (this.next + 1) % this.max;
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      const v = speed * (0.85 + Math.random() * 0.3);
      this.pos.set([x, y, z], i * 3);
      this.vel.set([s * Math.cos(th) * v, u * v, s * Math.sin(th) * v], i * 3);
      this.base.set([c.r, c.g, c.b], i * 3);
      this.age[i] = 0; this.life[i] = 2 + Math.random() * 1.2;
    }
  }

  update(dt) {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.burst();
      if (Math.random() < 0.5) setTimeout(() => this.burst(), 350);
      this.timer = 7 + Math.random() * 12;
    }
    const drag = Math.exp(-1.4 * dt);
    let any = false;
    for (let i = 0; i < this.max; i++) {
      if (this.age[i] > this.life[i]) { if (this.col[i * 3] !== 0) this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0; continue; }
      any = true;
      this.age[i] += dt;
      for (let a = 0; a < 3; a++) this.vel[i * 3 + a] *= drag;
      this.vel[i * 3 + 1] -= 4.5 * dt;
      for (let a = 0; a < 3; a++) this.pos[i * 3 + a] += this.vel[i * 3 + a] * dt;
      const f = 1 - this.age[i] / this.life[i];
      const twinkle = f < 0.35 ? (Math.random() < 0.5 ? 1.6 : 0.2) : 1;
      for (let a = 0; a < 3; a++) this.col[i * 3 + a] = this.base[i * 3 + a] * f * f * twinkle;
    }
    if (any || this.dirty) {
      this.points.geometry.attributes.position.needsUpdate = true;
      this.points.geometry.attributes.color.needsUpdate = true;
    }
    this.dirty = any;
  }
}

// ---------------------------------------------------------------- entry point
export function hiddenBuilding(name) {
  if (!name) return false;
  const pats = [...LANDMARKS.mbs.replaces, ...LANDMARKS.pit.replaces, ...LANDMARKS.extraHidden];
  if (pats.some(p => p.test(name))) return true;
  const p = LANDMARKS.padang;
  if ([p.cityHall, p.oldSupremeCourt, p.newSupremeCourt, p.cricketClub, p.recreationClub, p.standrews, p.fullerton].some(x => x.match === name)) return true;
  return LANDMARKS.cbd.some(t => t.match === name && t.style !== 'crown');
}

export function buildSkyline(scene, city, domes) {
  const M = materials();
  const g = new THREE.Group();
  g.name = 'skyline';
  scene.add(g);
  const animated = [];
  g.add(marinaBaySands(city, M, animated));
  const fl = city.landmarks.find(l => l.type === 'flyer');
  if (fl) g.add(flyer(city, fl, M, animated));
  g.add(esplanade(domes, M));
  g.add(padang(city, M, city.landmarks.find(l => l.name === 'Padang')));
  g.add(artScience(M));
  g.add(cbd(city, M));
  horizonLayers(scene);
  const fireworks = new Fireworks(scene);
  let t = 0;
  return {
    group: g,
    update(dt) {
      t += dt;
      for (const f of animated) f(dt, t);
      fireworks.update(dt);
    },
  };
}
