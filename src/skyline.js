// Hand-built Singapore landmarks around the circuit, plus the atmosphere around them:
// distant parallax skyline layers, searchlights over the SkyPark and fireworks over the bay.
// Landmarks sit on their OSM footprints (city.json), so they line up with the track and the bay.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildingMaterial, tagBuilding, centroid } from './world.js';
import { COLORS, LANDMARKS } from './config.js';

// ---------------------------------------------------------------- helpers
const byName = (city, name) => city.buildings.find(b => b.n === name);

// oriented bounding box of an OSM footprint: centre, long-axis angle (OSM radians), length, width
export function obb(flat) {
  let best = null;
  for (let i = 0; i < flat.length; i += 2) {
    const j = (i + 2) % flat.length;
    const a = Math.atan2(flat[j + 1] - flat[i + 1], flat[j] - flat[i]);
    const c = Math.cos(a), s = Math.sin(a);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (let k = 0; k < flat.length; k += 2) {
      const u = flat[k] * c + flat[k + 1] * s, v = -flat[k] * s + flat[k + 1] * c;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) {
      const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
      best = { area, a, cx: cu * c - cv * s, cy: cu * s + cv * c, len: u1 - u0, wid: v1 - v0 };
    }
  }
  if (best.wid > best.len) { best.a += Math.PI / 2; [best.len, best.wid] = [best.wid, best.len]; }
  return best;
}

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
      const b = Math.sign(sn) * Math.pow(Math.abs(sn), 0.7) * s.h / 2;
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
  };
}

// ---------------------------------------------------------------- Marina Bay Sands
// Three towers, each a vertical west leg and a curved east leg that leans in to meet it at the
// top, carrying the boat-shaped SkyPark that cantilevers past the north tower.
function marinaBaySands(city, M, animated) {
  const g = new THREE.Group();
  const towers = city.buildings.filter(b => /^Marina Bay Sands Tower/.test(b.n || '')).sort((a, b) => a.n.localeCompare(b.n));
  if (towers.length !== 3) return g;
  const c = towers.map(t => centroid(t.p));
  const u = new THREE.Vector2().subVectors(c[2], c[0]).normalize();
  const a = Math.atan2(u.y, u.x);
  const H = 194;
  const tint = new THREE.Color(0.30, 0.33, 0.38);
  const geos = [];
  c.forEach((tc, k) => {
    const west = stack([{ y: 0, cx: 0, cz: -13, w: 34, d: 16 }, { y: H, cx: 0, cz: -13, w: 34, d: 16 }]);
    const secs = [];
    for (let j = 0; j <= 12; j++) {
      const y = H * j / 12;
      secs.push({ y, cx: 0, cz: 3 + 15 * Math.pow(1 - y / H, 1.6), w: 34, d: 16 });
    }
    const east = stack(secs);
    for (const leg of [west, east]) {
      geos.push(tagBuilding(toWorld(leg, tc.x, tc.y, a), 0.31 + k * 0.07, H, tint));
    }
  });
  g.add(new THREE.Mesh(mergeGeometries(geos), M.glass));

  // SkyPark hull, along the tower line; local x from the middle tower
  const mid = c[1];
  const d1 = c[0].distanceTo(mid), d3 = c[2].distanceTo(mid);
  const x0 = -d1 - 45, x1 = d3 + 67, W = 38, zc = -4;
  const hull = new THREE.Shape();
  hull.moveTo(x0, zc - W / 2 * 0.85);
  hull.lineTo(x1 - 40, zc - W / 2);
  hull.quadraticCurveTo(x1 + 6, zc - W * 0.15, x1, zc + 2);
  hull.quadraticCurveTo(x1 - 6, zc + W / 2, x1 - 50, zc + W / 2);
  hull.lineTo(x0, zc + W / 2 * 0.85);
  hull.lineTo(x0, zc - W / 2 * 0.85);
  const hg = new THREE.ExtrudeGeometry(hull, { depth: 8, bevelEnabled: true, bevelSize: 1.2, bevelThickness: 1.2, bevelSegments: 2 });
  hg.rotateX(Math.PI / 2);   // shape (x, z) -> extrude downward from y = 0
  hg.translate(0, H + 9, 0);
  g.add(new THREE.Mesh(toWorld(hg, mid.x, mid.y, a), M.metal));
  // underside light lines, the infinity pool on the city (west) edge, trees on the deck
  const lines = [], trees = [];
  for (const z of [zc - W / 2 + 1.5, zc + W / 2 - 1.5]) {
    lines.push(toWorld(new THREE.BoxGeometry(x1 - x0 - 30, 0.5, 0.8).translate((x0 + x1) / 2 - 15, H + 0.4, z), mid.x, mid.y, a));
  }
  g.add(new THREE.Mesh(mergeGeometries(lines), M.led));
  const pool = toWorld(new THREE.BoxGeometry(150, 0.6, 7).translate(x1 - 125, H + 9.4, zc - W / 2 + 4.5), mid.x, mid.y, a);
  g.add(new THREE.Mesh(pool, M.cyan));
  for (let k = 0; k < 26; k++) {
    const x = x0 + 12 + k * (x1 - x0 - 60) / 26, z = zc + 4 + ((k * 7) % 5) * 2.4;
    trees.push(toWorld(new THREE.SphereGeometry(2.2, 6, 4).scale(1, 0.8, 1).translate(x, H + 11.2, z), mid.x, mid.y, a));
  }
  g.add(new THREE.Mesh(mergeGeometries(trees), M.green));

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
    const p = new THREE.Vector3(x0 + 40 + k * (x1 - x0 - 80) / 3, H + 11, zc);
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
function flyer(lm, M, animated) {
  const g = new THREE.Group();
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
  wheel.add(new THREE.Mesh(mergeGeometries(rimGeos.map(x => (x.index ? x.toNonIndexed() : x))), M.metal));
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
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 16, 16).rotateX(Math.PI / 2), M.metal);
  wheel.add(hub);
  g.add(wheel);
  // A-frame legs and the terminal building
  for (const side of [-1, 1]) for (const lean of [-1, 1]) {
    const legLen = Math.hypot(cy, 34);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.2, legLen, 8), M.metal);
    leg.position.set(lean * 17, cy / 2, side * 7);
    leg.rotation.z = lean * Math.atan2(34, cy);
    g.add(leg);
  }
  const base = new THREE.Mesh(new THREE.BoxGeometry(150, 12, 40), new THREE.MeshStandardMaterial({ color: 0x252a35, emissive: 0x141820 }));
  base.position.set(0, 6, -40);
  g.add(base);
  g.position.set(lm.x, 0, -lm.y);
  g.rotation.y = lm.dir;
  animated.push((dt, t) => {
    wheel.rotation.z -= dt * (Math.PI * 2 / 1800);   // one revolution in ~30 minutes
    ledMat.color.setHSL((0.52 + 0.12 * Math.sin(t * 0.08)) % 1, 0.75, 0.62).multiplyScalar(1.8);
  });
  return g;
}

// ---------------------------------------------------------------- Esplanade
// Two "durian" shells: a bulging ellipsoid clad in thousands of triangular aluminium sunshades.
function esplanade(domes, M) {
  const g = new THREE.Group();
  const shellMat = new THREE.MeshStandardMaterial({ color: 0x2a251f, roughness: 0.5, metalness: 0.4, emissive: new THREE.Color(0.3, 0.17, 0.06) });
  const spikeMat = new THREE.MeshStandardMaterial({ color: 0xb4b2ac, roughness: 0.3, metalness: 0.8, emissive: 0x2a2620 });
  const spike = new THREE.ConeGeometry(0.95, 1.9, 3).translate(0, 0.95, 0);
  const p = 2.6;   // superellipse exponent: fuller than a hemisphere
  for (const b of domes) {
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    for (let i = 0; i < b.p.length; i += 2) {
      minx = Math.min(minx, b.p[i]); maxx = Math.max(maxx, b.p[i]);
      miny = Math.min(miny, b.p[i + 1]); maxy = Math.max(maxy, b.p[i + 1]);
    }
    const ax = (maxx - minx) / 2 * 0.96, az = (maxy - miny) / 2 * 0.96, h = b.h;
    const cx = (minx + maxx) / 2, cz = -(miny + maxy) / 2;
    const prof = [];
    for (let k = 0; k <= 24; k++) {
      const f = k / 24 * Math.PI / 2;
      prof.push(new THREE.Vector2(Math.pow(Math.cos(f), 2 / p), Math.pow(Math.sin(f), 2 / p)));
    }
    const shell = new THREE.LatheGeometry(prof, 64);
    shell.scale(ax, h, az);
    const sm = new THREE.Mesh(shell, shellMat);
    sm.position.set(cx, 0, cz);
    g.add(sm);
    // spikes on a latitude / longitude grid, oriented along the surface normal
    const items = [];
    const rows = 26;
    for (let r = 1; r < rows; r++) {
      const f = r / rows * Math.PI / 2 * 0.97;
      const ring = Math.max(6, Math.round(Math.pow(Math.cos(f), 2 / p) * Math.PI * (ax + az) / 3.6));
      for (let k = 0; k < ring; k++) {
        const th = (k + (r % 2) * 0.5) / ring * Math.PI * 2;
        const rr = Math.pow(Math.cos(f), 2 / p), yy = Math.pow(Math.sin(f), 2 / p);
        const x = Math.cos(th) * rr * ax, z = Math.sin(th) * rr * az, y = yy * h;
        const n = new THREE.Vector3(x / (ax * ax), y / (h * h), z / (az * az)).normalize();
        items.push({ pos: new THREE.Vector3(cx + x, y, cz + z), n });
      }
    }
    const inst = new THREE.InstancedMesh(spike, spikeMat, items.length);
    const q = new THREE.Quaternion(), m = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    items.forEach((it, k) => {
      q.setFromUnitVectors(up, it.n);
      m.compose(it.pos, q, one);
      inst.setMatrixAt(k, m);
    });
    g.add(inst);
  }
  return g;
}

// ---------------------------------------------------------------- the Padang
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
  const white = [], dark = [], lit = [], copper = [], roof = [], glassBox = [];

  const place = (b, build) => {
    if (!b) return;
    const o = obb(b.p);
    const a = facing(o, pad.x, pad.y);   // local +z toward the Padang
    const local = { white: [], dark: [], lit: [], copper: [], roof: [], glassBox: [] };
    build(o, local);
    for (const [k, list] of Object.entries(local)) {
      for (const geo of list) ({ white, dark, lit, copper, roof, glassBox })[k].push(toWorld(geo, o.cx, o.cy, a));
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
    L.white.push(new THREE.CylinderGeometry(2.5, 2.5, 8, 12).translate(0, h - 4, 0));
    L.white.push(new THREE.CylinderGeometry(Math.min(len, wid) * 0.62, Math.min(len, wid) * 0.55, 4.5, 48).translate(0, h + 1.5, 0));
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

  const add = (list, mat) => { if (list.length) g.add(new THREE.Mesh(mergeGeometries(list.map(x => (x.index ? x.toNonIndexed() : x)).map(x => { if (x.attributes.uv) x.deleteAttribute('uv'); return x; })), mat)); };
  add(white, M.heritage); add(dark, M.heritageDark); add(lit, M.windowLit); add(copper, M.copper); add(roof, M.roof); add(glassBox, M.litGlass);
  return g;
}

// ---------------------------------------------------------------- ArtScience Museum
// Ten "fingers" of a lotus rising from a round base, each a curved, tapering shell.
function artScience(M) {
  const cfg = LANDMARKS.artScience;
  const g = new THREE.Group();
  const geos = [], tips = [];
  const base = new THREE.CylinderGeometry(19, 10, 12, 40).translate(0, 8, 0);
  geos.push(base.toNonIndexed());
  geos.push(new THREE.CylinderGeometry(4.5, 5.5, 4, 16).translate(0, 2, 0).toNonIndexed());
  for (let k = 0; k < cfg.petals; k++) {
    const a = k / cfg.petals * Math.PI * 2;
    const tall = 0.62 + 0.38 * (0.5 + 0.5 * Math.cos(a - 0.6)) * (k % 2 ? 0.86 : 1);
    const radial = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const side = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
    const spine = [];
    for (let j = 0; j <= 10; j++) {
      const u = j / 10;
      // fingers splay out and up from the bowl; broad all the way to a rounded tip
      const r = 9 + 22 * u + 4 * u * u;
      const y = 9 + cfg.h * tall * Math.pow(u, 1.35);
      const p = radial.clone().multiplyScalar(r).setY(y);
      const tan = radial.clone().multiplyScalar(22 + 8 * u).setY(cfg.h * tall * 1.35 * Math.pow(Math.max(u, 0.03), 0.35)).normalize();
      const nrm = new THREE.Vector3().crossVectors(side, tan).normalize();
      const w = (u > 0.94 ? Math.sqrt(Math.max(0, 1 - Math.pow((u - 0.94) / 0.06, 2))) : 1) * (9 + 16 * u * (1.25 - u)) + 0.5;
      spine.push({ p, side, nrm, w, h: 4.2 - 2.4 * u });
    }
    geos.push(sweep(spine).toNonIndexed());
    const tip = spine[spine.length - 1].p;
    tips.push(new THREE.SphereGeometry(1.4, 8, 6).translate(tip.x, tip.y + 0.6, tip.z));
  }
  g.add(new THREE.Mesh(mergeGeometries(geos.map(x => { if (x.attributes.uv) x.deleteAttribute('uv'); return x; })), M.white));
  g.add(new THREE.Mesh(mergeGeometries(tips), M.led));
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
  const glass = [], metal = [], led = [];
  const tint = new THREE.Color(0.28, 0.3, 0.34);
  for (const t of LANDMARKS.cbd) {
    const b = byName(city, t.match);
    if (!b) continue;
    const o = obb(b.p);
    const H = t.h;
    if (t.style === 'uob') {
      // UOB Plaza: octagonal shaft, a rotated upper stage and the flat disc roof on short columns
      const w = t.key === 'uob1' ? 44 : 36;
      const shaft = extrudeUp(octagon(w), 0, H * 0.84);
      const upper = extrudeUp(octagon(w * 0.86), H * 0.84, H * 0.95);
      upper.rotateY(Math.PI / 8);
      for (const [geo, s] of [[shaft, 0.41], [upper, 0.43]]) glass.push(tagBuilding(toWorld(geo, o.cx, o.cy, o.a), s, H, tint));
      for (let k = 0; k < 8; k++) {
        const a = k / 8 * Math.PI * 2;
        metal.push(toWorld(new THREE.CylinderGeometry(0.8, 0.8, H * 0.05, 6).translate(Math.cos(a) * w * 0.32, H * 0.975, Math.sin(a) * w * 0.32), o.cx, o.cy, o.a));
      }
      metal.push(toWorld(new THREE.CylinderGeometry(w * 0.62, w * 0.6, 3, 40).translate(0, H + 1.5, 0), o.cx, o.cy, o.a));
      led.push(toWorld(new THREE.TorusGeometry(w * 0.62, 0.35, 4, 48).rotateX(Math.PI / 2).translate(0, H + 0.2, 0), o.cx, o.cy, o.a));
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
  if ([p.cityHall, p.oldSupremeCourt, p.newSupremeCourt, p.cricketClub].some(x => x.match === name)) return true;
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
  if (fl) g.add(flyer(fl, M, animated));
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
