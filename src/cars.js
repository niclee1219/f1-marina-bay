// Ground-effect era F1 cars driven by the recorded telemetry.
// Car frame: +z forward, +x left, +y up; ~5.6 m long, 2.0 m wide, 3.6 m wheelbase.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { TYRES } from './data.js';
import { LIVERIES, LIVERY_DECALS } from './config.js';

const TRAIL_N = 28;
const TRAIL_DT = 0.07;
// paint slots baked into the body geometry, coloured per team
const PRIMARY = 0, SECONDARY = 1, ACCENT = 2, CARBON = 3, DARK = 4;

// ---------------------------------------------------------------- geometry helpers
function slotted(g, slot) {
  g = g.index ? g.toNonIndexed() : g;
  g.deleteAttribute('uv');
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count;
  const a = new Float32Array(n);
  if (typeof slot === 'function') {
    const p = g.attributes.position;
    for (let i = 0; i < n; i++) a[i] = slot(p.getX(i), p.getY(i), p.getZ(i));
  } else a.fill(slot);
  g.setAttribute('aSlot', new THREE.BufferAttribute(a, 1));
  return g;
}

function box(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z);
  return g;
}

function rod(a, b, r) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const d = B.clone().sub(A), len = d.length();
  const g = new THREE.CylinderGeometry(r, r, len, 5, 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}

// Lofted body: superellipse cross-sections {z, w, h, y (centre), x (centre), p (squareness)}.
function loft(sections, ring = 18) {
  const pos = [], idx = [];
  sections.forEach(s => {
    const p = s.p || 3.2;
    for (let k = 0; k < ring; k++) {
      const a = k / ring * Math.PI * 2;
      const c = Math.cos(a), sn = Math.sin(a);
      const x = (s.x || 0) + Math.sign(c) * Math.pow(Math.abs(c), 2 / p) * s.w / 2;
      const y = s.y + Math.sign(sn) * Math.pow(Math.abs(sn), 2 / p) * s.h / 2;
      pos.push(x, y, s.z);
    }
  });
  for (let j = 1; j < sections.length; j++) {
    for (let k = 0; k < ring; k++) {
      const a = (j - 1) * ring + k, b = (j - 1) * ring + (k + 1) % ring;
      const c = j * ring + k, d = j * ring + (k + 1) % ring;
      idx.push(a, c, b, b, c, d);
    }
  }
  // end caps
  for (const [j, flip] of [[0, true], [sections.length - 1, false]]) {
    const s = sections[j];
    const ci = pos.length / 3;
    pos.push(s.x || 0, s.y, s.z);
    for (let k = 0; k < ring; k++) {
      const a = j * ring + k, b = j * ring + (k + 1) % ring;
      if (flip) idx.push(ci, b, a); else idx.push(ci, a, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// thin aerofoil plate spanning x, chord along z, cambered
// inverted aerofoil (suction side down); pitch raises the trailing edge
function wingElement(span, chord, thick, x, y, z, pitch, camber = -0.03) {
  const sh = new THREE.Shape();
  const N = 8;
  for (let k = 0; k <= N; k++) {
    const u = k / N, zz = chord * (0.5 - u), yy = camber * 4 * u * (1 - u) + thick * 0.5 * Math.sin(Math.PI * u);
    if (k) sh.lineTo(zz, yy); else sh.moveTo(zz, yy);
  }
  for (let k = N; k >= 0; k--) {
    const u = k / N, zz = chord * (0.5 - u), yy = camber * 4 * u * (1 - u) - thick * 0.5 * Math.sin(Math.PI * u);
    sh.lineTo(zz, yy);
  }
  const g = new THREE.ExtrudeGeometry(sh, { depth: span, bevelEnabled: false });
  g.translate(0, 0, -span / 2);
  g.rotateY(-Math.PI / 2);         // extrusion now along x, leading edge toward +z
  g.rotateX(pitch);
  g.translate(x, y, z);
  return g;
}

function bodyGeometry() {
  const P = [];
  // chassis + nose: secondary underside, primary on top
  const chassisSlot = (x, y, z) => (y < 0.33 ? SECONDARY : z > 2.25 ? ACCENT : PRIMARY);
  P.push(slotted(loft([
    { z: 2.62, w: 0.12, h: 0.09, y: 0.27 },
    { z: 2.35, w: 0.22, h: 0.15, y: 0.30 },
    { z: 1.95, w: 0.34, h: 0.25, y: 0.36 },
    { z: 1.45, w: 0.46, h: 0.36, y: 0.43 },
    { z: 0.95, w: 0.58, h: 0.45, y: 0.48 },
    { z: 0.45, w: 0.70, h: 0.50, y: 0.50 },
    { z: -0.15, w: 0.74, h: 0.50, y: 0.50 },
    { z: -0.45, w: 0.70, h: 0.46, y: 0.47 },
  ]), chassisSlot));
  // engine cover with airbox and a spine stripe
  P.push(slotted(loft([
    { z: 0.12, w: 0.26, h: 0.26, y: 1.0, p: 2.6 },
    { z: -0.05, w: 0.36, h: 0.48, y: 0.88, p: 2.8 },
    { z: -0.4, w: 0.46, h: 0.66, y: 0.72 },
    { z: -1.0, w: 0.46, h: 0.52, y: 0.62 },
    { z: -1.6, w: 0.32, h: 0.36, y: 0.52 },
    { z: -2.2, w: 0.14, h: 0.2, y: 0.42 },
  ]), (x, y) => (Math.abs(x) < 0.06 && y > 0.75 ? ACCENT : PRIMARY)));
  // airbox intake and roll-hoop cut-outs
  P.push(slotted(box(0.17, 0.16, 0.04, 0, 1.0, 0.13), DARK));
  P.push(slotted(box(0.08, 0.1, 0.03, 0.15, 0.86, 0.0), DARK), slotted(box(0.08, 0.1, 0.03, -0.15, 0.86, 0.0), DARK));
  // shark fin
  P.push(slotted(box(0.02, 0.24, 1.1, 0, 0.95, -1.2, 0.18), PRIMARY));
  // sidepods: downwashing top, undercut painted secondary, black inlet
  for (const sx of [-1, 1]) {
    P.push(slotted(loft([
      { z: 0.82, w: 0.26, h: 0.36, y: 0.45, x: sx * 0.6, p: 3.6 },
      { z: 0.55, w: 0.44, h: 0.44, y: 0.45, x: sx * 0.6, p: 3.4 },
      { z: -0.1, w: 0.42, h: 0.4, y: 0.43, x: sx * 0.58 },
      { z: -0.8, w: 0.3, h: 0.3, y: 0.36, x: sx * 0.48 },
      { z: -1.55, w: 0.14, h: 0.18, y: 0.28, x: sx * 0.36 },
    ]), (x, y) => (y < 0.38 ? SECONDARY : PRIMARY)));
    P.push(slotted(box(0.3, 0.26, 0.03, sx * 0.62, 0.5, 0.84), DARK));
    // mirrors on stalks
    P.push(slotted(box(0.17, 0.08, 0.06, sx * 0.55, 0.78, 0.7), PRIMARY));
    P.push(slotted(rod([sx * 0.33, 0.66, 0.68], [sx * 0.49, 0.76, 0.7], 0.012), CARBON));
  }
  // cockpit opening and headrest
  P.push(slotted(loft([
    { z: 0.62, w: 0.36, h: 0.06, y: 0.745, p: 2 },
    { z: 0.2, w: 0.46, h: 0.08, y: 0.75, p: 2 },
    { z: -0.08, w: 0.4, h: 0.06, y: 0.755, p: 2 },
  ], 14), DARK));
  // floor with edge wings, plank, diffuser
  const floor = new THREE.Shape();
  [[1.25, 0.32], [0.9, 0.78], [-1.55, 0.8], [-1.95, 0.55], [-1.95, -0.55], [-1.55, -0.8], [0.9, -0.78], [1.25, -0.32]]
    .forEach(([z, x], i) => (i ? floor.lineTo(x, z) : floor.moveTo(x, z)));
  const fg = new THREE.ExtrudeGeometry(floor, { depth: 0.04, bevelEnabled: false });
  fg.rotateX(Math.PI / 2); fg.translate(0, 0.1, 0);
  P.push(slotted(fg, CARBON));
  P.push(slotted(box(0.3, 0.03, 2.6, 0, 0.065, -0.3), CARBON));
  P.push(slotted(box(1.05, 0.04, 0.6, 0, 0.17, -2.2, -0.32), CARBON));
  for (const sx of [-1, 0, 1]) P.push(slotted(box(0.02, 0.18, 0.55, sx * 0.3, 0.17, -2.2, -0.32), CARBON));
  // front wing: mainplane + three flaps, endplates, nose pillars
  P.push(slotted(wingElement(1.9, 0.34, 0.03, 0, 0.09, 2.62, 0.05), CARBON));
  P.push(slotted(wingElement(1.7, 0.22, 0.02, 0, 0.15, 2.48, 0.32), SECONDARY));
  P.push(slotted(wingElement(1.55, 0.18, 0.02, 0, 0.21, 2.38, 0.55), PRIMARY));
  P.push(slotted(wingElement(1.35, 0.15, 0.02, 0, 0.27, 2.3, 0.8), ACCENT));
  for (const sx of [-1, 1]) {
    P.push(slotted(box(0.025, 0.26, 0.62, sx * 0.96, 0.17, 2.55), ACCENT));
    P.push(slotted(box(0.02, 0.16, 0.12, sx * 0.08, 0.17, 2.5), CARBON));
  }
  // rear wing: endplates (accent), mainplane, pillar, beam wing
  for (const sx of [-1, 1]) {
    const ep = new THREE.Shape();
    [[0.32, 0.38], [0.32, 0.98], [-0.32, 1.05], [-0.34, 0.5]].forEach(([z, y], i) => (i ? ep.lineTo(z, y) : ep.moveTo(z, y)));
    const e = new THREE.ExtrudeGeometry(ep, { depth: 0.025, bevelEnabled: false });
    e.rotateY(-Math.PI / 2); e.translate(sx * 0.5 + 0.0125, 0, -2.42);
    P.push(slotted(e, (x, y) => (y > 0.9 ? ACCENT : PRIMARY)));
  }
  P.push(slotted(wingElement(0.98, 0.3, 0.035, 0, 0.92, -2.45, 0.14, -0.04), CARBON));
  P.push(slotted(wingElement(0.98, 0.2, 0.03, 0, 0.55, -2.4, 0.2), CARBON));
  P.push(slotted(box(0.04, 0.42, 0.06, 0, 0.72, -2.32), CARBON));
  // halo: arc over the cockpit + front pillar
  const halo = new THREE.TorusGeometry(0.34, 0.03, 6, 20, Math.PI);
  halo.rotateX(-Math.PI / 2); halo.scale(1, 1, 1.35); halo.translate(0, 0.86, 0.18);
  P.push(slotted(halo, CARBON));
  P.push(slotted(rod([0, 0.86, 0.64], [0, 0.66, 0.78], 0.028), CARBON));
  for (const sx of [-1, 1]) P.push(slotted(rod([sx * 0.33, 0.86, 0.18], [sx * 0.35, 0.72, 0.05], 0.025), CARBON));
  // suspension: wishbones and push/pull rods
  for (const sx of [-1, 1]) {
    for (const [z, zIn] of [[1.78, 1.6], [-1.82, -1.65]]) {
      P.push(slotted(rod([sx * 0.25, 0.48, zIn + 0.2], [sx * 0.72, 0.42, z], 0.018), CARBON));
      P.push(slotted(rod([sx * 0.25, 0.48, zIn - 0.25], [sx * 0.72, 0.42, z], 0.018), CARBON));
      P.push(slotted(rod([sx * 0.3, 0.3, zIn + 0.15], [sx * 0.72, 0.28, z], 0.016), CARBON));
      P.push(slotted(rod([sx * 0.3, 0.3, zIn - 0.2], [sx * 0.72, 0.28, z], 0.016), CARBON));
    }
  }
  return mergeGeometries(P);
}

function flapGeometry() {
  return slotted(wingElement(0.96, 0.2, 0.025, 0, 0, -0.1, 0.25), PRIMARY);
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function numberTexture(num, fill) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const x = c.getContext('2d');
  x.font = 'italic 900 112px "Titillium Web", sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = 12; x.strokeStyle = 'rgba(0,0,0,0.85)';
  x.strokeText(String(num), 128, 70);
  x.fillStyle = fill; x.fillText(String(num), 128, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// paint the slot attribute with the team palette
function paint(geo, pal) {
  const g = geo.clone();
  const s = g.attributes.aSlot, n = s.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const c = pal[s.getX(i)];
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// scale outgoing light by a per-car uniform (bridge shade)
// selfLit adds a little of the paint colour as emission so liveries read under the floodlights
function shaded(mat, shade, selfLit = 0) {
  mat.onBeforeCompile = (s) => {
    s.uniforms.uShade = shade;
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uShade;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * ${selfLit.toFixed(3)};`)
      .replace('#include <opaque_fragment>', 'outgoingLight *= uShade;\n#include <opaque_fragment>');
  };
  mat.customProgramCacheKey = () => `car-shade-${selfLit}`;
  return mat;
}

// ---------------------------------------------------------------- sparks
class Sparks {
  constructor(scene, max = 1500) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.age = new Float32Array(max).fill(1e9);
    this.col = new Float32Array(max * 3);
    this.next = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.09, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, n, scale) {
    for (let k = 0; k < n; k++) {
      const i = this.next; this.next = (this.next + 1) % this.max;
      this.pos[i * 3] = x + (Math.random() - 0.5) * 0.5 * scale;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.5 * scale;
      this.vel[i * 3] = vx + (Math.random() - 0.5) * 6;
      this.vel[i * 3 + 1] = vy + Math.random() * 3.5;
      this.vel[i * 3 + 2] = vz + (Math.random() - 0.5) * 6;
      this.life[i] = 0.18 + Math.random() * 0.35;
      this.age[i] = 0;
    }
  }

  update(dt) {
    const { pos, vel, col, life, age } = this;
    const drag = Math.exp(-2.2 * dt);
    for (let i = 0; i < this.max; i++) {
      if (age[i] > life[i]) { if (col[i * 3] !== 0) col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0; continue; }
      age[i] += dt;
      vel[i * 3] *= drag; vel[i * 3 + 2] *= drag;
      vel[i * 3 + 1] -= 9.8 * dt;
      pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      if (pos[i * 3 + 1] < 0.02) { pos[i * 3 + 1] = 0.02; vel[i * 3 + 1] *= -0.3; }
      const f = Math.max(0, 1 - age[i] / life[i]);
      col[i * 3] = 3.2 * f; col[i * 3 + 1] = 1.7 * f * f; col[i * 3 + 2] = 0.5 * f * f * f;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- sponsor decals
const decalTextures = new Map();
function decalTexture(file) {
  if (!decalTextures.has(file)) {
    const t = new THREE.TextureLoader().load(`assets/logos/${file}.svg`);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    decalTextures.set(file, t);
  }
  return decalTextures.get(file);
}

// Logo planes on both sides of each configured slot, parented to the car body (so they scale with
// it). Only for teams with a livery reference and decal map in config.LIVERIES.
export function buildDecals(car, decals, shade) {
  const g = new THREE.Group();
  g.name = 'decals';
  for (const [slot, file] of Object.entries(decals || {})) {
    const p = LIVERY_DECALS.slots[slot];
    if (!p || !file) continue;
    const mat = shaded(new THREE.MeshStandardMaterial({
      map: decalTexture(file), transparent: true, alphaTest: 0.05, roughness: 0.4,
      polygonOffset: true, polygonOffsetFactor: -2, side: THREE.FrontSide,
    }), shade);
    for (const sx of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.h), mat);
      m.rotation.y = sx * Math.PI / 2;
      m.position.set(sx * p.x, p.y, p.z);
      g.add(m);
    }
  }
  g.visible = false;
  car.add(g);
  return g;
}

// ---------------------------------------------------------------- cars
export class Cars {
  constructor(scene, race, track, bridges = null) {
    this.race = race; this.track = track; this.bridges = bridges;
    this.sparks = new Sparks(scene);
    const BODY = bodyGeometry();
    const FLAP = flapGeometry();
    // tyre: lathe profile with rounded shoulders (18" rim, low profile)
    const prof = [];
    for (let k = 0; k <= 12; k++) {
      const a = -Math.PI / 2 + k / 12 * Math.PI;
      prof.push(new THREE.Vector2(0.255 + 0.105 * Math.cos(a) * 1.0 + 0.0, 0.17 * Math.sin(a)));
    }
    // per wheel: rubber + wheel cover in one vertex-coloured mesh, both compound bands in one,
    // both brake-glow rings in one (keeps draw calls down with 20+ cars and the water reflection)
    const tinted = (g, hex) => {
      g = g.toNonIndexed(); g.deleteAttribute('uv');
      const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
      return g;
    };
    const wheelGeo = (wide) => {
      const tyre = new THREE.LatheGeometry(prof, 28); tyre.rotateZ(Math.PI / 2); tyre.scale(wide, 1, 1);
      const cover = new THREE.CylinderGeometry(0.2, 0.2, 0.3 * wide, 22); cover.rotateZ(Math.PI / 2);
      return mergeGeometries([tinted(tyre, 0x141416), tinted(cover, 0x26262b)]);
    };
    const ringPair = (r, tube, segs, half) => mergeGeometries([-1, 1].map(s => {
      const g = new THREE.TorusGeometry(r, tube, 4, segs); g.rotateY(Math.PI / 2); g.translate(s * half, 0, 0);
      return g;
    }));
    const tyreF = wheelGeo(1), tyreR = wheelGeo(1.18);
    const bandF = ringPair(0.3, 0.014, 32, 0.165), bandR = ringPair(0.3, 0.014, 32, 0.195);
    const brakeF = ringPair(0.215, 0.018, 28, 0.16), brakeR = ringPair(0.215, 0.018, 28, 0.19);
    const glowTex = glowTexture();
    const helmetGeo = new THREE.SphereGeometry(0.15, 14, 10);
    const visorGeo = new THREE.SphereGeometry(0.152, 14, 6, Math.PI / 2 - 0.9, 1.8, 1.15, 0.5);
    const numGeoNose = new THREE.PlaneGeometry(0.36, 0.18);
    numGeoNose.rotateX(-Math.PI / 2 + 0.22); numGeoNose.translate(0, 0.65, 1.42);
    const numGeoSides = [-1, 1].map(sx => {
      const g = new THREE.PlaneGeometry(0.5, 0.25);
      g.rotateY(sx * Math.PI / 2); g.translate(sx * 0.236, 0.7, -0.85);
      return g;
    });
    const numGeo = mergeGeometries([numGeoNose, ...numGeoSides]);

    const teamSeen = new Map();
    this.cars = race.drivers.map(d => {
      const col = new THREE.Color(d.color);
      const L = LIVERIES[d.team] || {};
      const pal = [
        new THREE.Color(L.primary || d.color),
        new THREE.Color(L.secondary || col.clone().multiplyScalar(0.35)),
        new THREE.Color(L.accent || '#ffffff'),
        new THREE.Color(0x0e0e11),
        new THREE.Color(0x030304),
      ];
      const shade = { value: 1 };
      const bodyMat = shaded(new THREE.MeshStandardMaterial({
        vertexColors: true, metalness: 0.35, roughness: 0.3,
      }), shade, 0.2);
      const tyreMat = shaded(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.2 }), shade);
      const root = new THREE.Group();
      const car = new THREE.Group();
      root.add(car);
      car.add(new THREE.Mesh(paint(BODY, pal), bodyMat));
      const nth = teamSeen.get(d.team) || 0; teamSeen.set(d.team, nth + 1);
      // helmet with dark visor; T-cam black on the first car of a team, yellow on the second
      const helmet = new THREE.Mesh(helmetGeo, shaded(new THREE.MeshStandardMaterial({ color: pal[2].clone().lerp(col, 0.4), roughness: 0.35, metalness: 0.2 }), shade));
      helmet.position.set(0, 0.84, 0.3);
      const visor = new THREE.Mesh(visorGeo, shaded(new THREE.MeshStandardMaterial({ color: 0x050608, metalness: 0.9, roughness: 0.1 }), shade));
      visor.position.copy(helmet.position);
      car.add(helmet, visor);
      const tcam = new THREE.Mesh(box(0.2, 0.07, 0.12, 0, 1.17, -0.02),
        new THREE.MeshBasicMaterial({ color: nth ? 0xffe000 : 0x050505 }));
      car.add(tcam);
      // race number on the nose and engine cover
      const numMat = shaded(new THREE.MeshStandardMaterial({
        map: numberTexture(d.num, '#ffffff'), transparent: true, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2,
      }), shade);
      const numMesh = new THREE.Mesh(numGeo, numMat);
      car.add(numMesh);
      // DRS flap
      const flapPivot = new THREE.Group(); flapPivot.position.set(0, 1.0, -2.3);
      flapPivot.add(new THREE.Mesh(paint(FLAP, pal), bodyMat));
      car.add(flapPivot);
      // rear rain light + endplate LEDs (flash while harvesting / braking)
      const tailMat = new THREE.MeshBasicMaterial({ color: 0x400000 });
      const tail = new THREE.Mesh(mergeGeometries([
        new THREE.BoxGeometry(0.16, 0.08, 0.03).translate(0, 0.42, -2.62),
        new THREE.BoxGeometry(0.03, 0.16, 0.03).translate(0.53, 0.82, -2.72),
        new THREE.BoxGeometry(0.03, 0.16, 0.03).translate(-0.53, 0.82, -2.72),
      ]), tailMat);
      car.add(tail);
      const tailGlow = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshBasicMaterial({
        map: glowTex, color: new THREE.Color(1, 0.05, 0.02), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      tailGlow.position.set(0, 0.42, -2.66); tailGlow.rotation.y = Math.PI;
      car.add(tailGlow);
      // wheels: steer group (front) > spin group > tyre, cover, compound band, brake glow ring
      const wheels = [], spins = [], steers = [];
      const bandMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const brakeMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
      for (const [x, z, front] of [[-0.8, 1.78, 1], [0.8, 1.78, 1], [-0.8, -1.82, 0], [0.8, -1.82, 0]]) {
        const steer = new THREE.Group();
        steer.position.set(x, 0.36, z);
        const spin = new THREE.Group();
        steer.add(spin);
        spin.add(new THREE.Mesh(front ? tyreF : tyreR, tyreMat),
          new THREE.Mesh(front ? bandF : bandR, bandMat), new THREE.Mesh(front ? brakeF : brakeR, brakeMat));
        car.add(steer);
        wheels.push(steer); spins.push(spin);
        if (front) steers.push(steer);
      }
      // ground glow so cars read from the overview camera
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
        map: glowTex, color: col.clone().multiplyScalar(0.9), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      glow.rotation.x = -Math.PI / 2; glow.position.y = 0.06; glow.scale.set(3.6, 7, 1);
      car.add(glow);

      // trail ribbon
      const tpos = new Float32Array(TRAIL_N * 2 * 3);
      const talpha = new Float32Array(TRAIL_N * 2);
      const tidx = [];
      for (let j = 0; j < TRAIL_N; j++) {
        talpha[j * 2] = talpha[j * 2 + 1] = Math.pow(1 - j / (TRAIL_N - 1), 1.6);
        if (j) { const a = (j - 1) * 2; tidx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      const tg = new THREE.BufferGeometry();
      tg.setAttribute('position', new THREE.BufferAttribute(tpos, 3));
      tg.setAttribute('alpha', new THREE.BufferAttribute(talpha, 1));
      tg.setIndex(tidx);
      const trail = new THREE.Mesh(tg, new THREE.ShaderMaterial({
        uniforms: { color: { value: col.clone().multiplyScalar(1.5) }, opacity: { value: 0.7 } },
        vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
        fragmentShader: 'uniform vec3 color; uniform float opacity; varying float vA; void main(){ gl_FragColor = vec4(color * vA * opacity, 1.0); }',
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
      trail.frustumCulled = false;
      scene.add(trail);

      // label
      const el = document.createElement('div');
      el.className = 'car-label';
      el.innerHTML = `<span class="bar" style="background:${d.color}"></span><span class="num">${d.num}</span><span class="code">${d.code}</span><span class="pos"></span>`;
      el.addEventListener('click', () => this.onSelect && this.onSelect(d.k));
      const label = new CSS2DObject(el);
      label.position.set(0, 3, 0);
      label.center.set(0.5, 1);
      root.add(label);

      scene.add(root);
      // small parts that vanish below a pixel or two from the aerial cameras (cheap LOD)
      const details = [helmet, visor, tcam, numMesh, tail, ...spins.flatMap(sp => sp.children.slice(1))];
      return {
        // sponsor decals only for liveries checked against reference images (config.LIVERIES)
        decals: L.reference && L.decals ? buildDecals(car, L.decals, shade) : null,
        d, root, car, wheels, spins, steers, bandMat, brakeMat, flapPivot, tailMat, tailGlow, glow, trail, label, el, details, detailed: true,
        elPos: el.querySelector('.pos'), shade,
        heading: null, xy: [0, 0, 0, 0], world: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1), y: 0, spin: 0,
        heat: 0, steer: 0, s: 0, lastComp: null,
      };
    });
    this.tmp = [0, 0, 0, 0];
    this.tmp2 = [0, 0, 0, 0];
    // apex kerbs (+-12 m around each corner apex), where cars ride the kerbs and spark. The
    // telemetry line is smoothed toward the centreline, so this goes by position along the lap.
    this.kerbAt = new Uint8Array(track.n);
    for (const c of track.corners) for (let k = -6; k <= 6; k++) this.kerbAt[((c.i + k) % track.n + track.n) % track.n] = 1;
  }

  elevation(x, z, c) {
    const { i, d } = this.track.nearest(x, z);
    c.offTrack = d > 16; // pit lane, garage or run-off
    c.ti = i;
    return d < 40 ? this.track.P[i].y : 0.2;
  }

  update(t, dt, cameraPos, focusK, opts) {
    const race = this.race;
    const a = this.tmp, b = this.tmp2;
    const time = performance.now() / 1000;
    for (const c of this.cars) {
      const k = c.d.k;
      race.pos(k, t, c.xy);
      const x = c.xy[0], z = -c.xy[1];
      race.pos(k, t - 0.12, a); race.pos(k, t + 0.12, b);
      const dx = b[0] - a[0], dz = -(b[1] - a[1]);
      const moved = Math.hypot(dx, dz);
      const prevHeading = c.heading;
      if (moved > 0.4) c.heading = Math.atan2(dx, dz);
      else if (c.heading === null || opts.jumped) {
        const { i } = this.track.nearest(x, z);
        const tt = this.track.T[i];
        c.heading = Math.atan2(tt.x, tt.z);
      }
      const yNear = this.elevation(x, z, c);
      const y = c.xy[3] ? c.xy[2] + 0.18 : yNear; // on track: elevation straight from the curve
      c.root.position.set(x, y, z);
      c.car.rotation.y = c.heading;
      c.world.set(x, y, z);
      c.dir.set(Math.sin(c.heading), 0, Math.cos(c.heading));
      c.s = c.ti * this.track.bin;

      // adaptive scale: real size up close, exaggerated from the helicopter
      const dist = cameraPos.distanceTo(c.root.position);
      const s = opts.realScale ? 1 : THREE.MathUtils.clamp(dist / 140, 1, 9);
      c.car.scale.setScalar(s);
      c.label.position.y = 1.6 * s + 1.4;
      const detailed = dist < 450;
      // decals only once the car is big enough on screen to read them
      if (c.decals) c.decals.visible = 5.6 * s / Math.max(dist, 0.1) * (opts.pixelScale || 800) >= LIVERY_DECALS.minPixels;
      if (detailed !== c.detailed) { c.detailed = detailed; for (const m of c.details) m.visible = detailed; }

      const tel = race.tel(k, t);
      c.tel = tel;
      c.spin += tel.speed / 3.6 / 0.36 * dt;
      for (const sp of c.spins) sp.rotation.x = c.spin;
      // front wheels steer with the rate of turn
      if (dt > 0 && prevHeading != null && !opts.jumped) {
        let dh = c.heading - prevHeading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        const want = THREE.MathUtils.clamp(dh / dt * 0.12, -0.35, 0.35);
        c.steer += (want - c.steer) * (1 - Math.exp(-10 * dt));
      }
      for (const st of c.steers) st.rotation.y = c.steer;
      c.flapPivot.rotation.x = tel.drs ? 0.75 : 0;
      // rear light: steady, flashing while braking / harvesting
      const flash = tel.brake && Math.sin(time * 25) > 0;
      c.tailMat.color.setRGB(flash ? 7 : 1.2, flash ? 0.1 : 0, 0);
      c.tailGlow.material.opacity = flash ? 0.9 : 0.25;
      // brake discs heat up under braking and cool on the straights
      c.heat = THREE.MathUtils.clamp(c.heat + (tel.brake && tel.speed > 80 ? dt * 2.5 : -dt * 0.9), 0, 1);
      const h = c.heat * c.heat;
      c.brakeMat.color.setRGB(2.6 * h, 0.75 * h, 0.12 * h);
      const tyre = race.tyre(k, t);
      if (tyre && tyre.comp !== c.lastComp) {
        c.lastComp = tyre.comp;
        c.bandMat.color.set((TYRES[tyre.comp] || TYRES.HARD).c);
      }
      // shade inside bridge zones
      const want = this.bridges && !c.offTrack ? this.bridges.shadeAt(c.s) : 1;
      c.shade.value += (want - c.shade.value) * (opts.jumped ? 1 : 1 - Math.exp(-12 * Math.max(dt, 1 / 60)));

      // sparks: skid blocks on kerbs and on the bumpier high-speed sections, only near the camera
      if (dt > 0 && s < 3 && !c.offTrack && dist < 420) {
        const onKerb = this.kerbAt[c.ti] && tel.speed > 110 && Math.random() < dt * 9;
        const bump = tel.speed > 255 && Math.random() < dt * 1.2;
        if (onKerb || bump) {
          const v = tel.speed / 3.6;
          const n = 6 + Math.round(Math.random() * (onKerb ? 14 : 8));
          this.sparks.emit(x - c.dir.x * 1.9 * s, y + 0.06, z - c.dir.z * 1.9 * s, c.dir.x * v * 0.45, 0.6, c.dir.z * v * 0.45, n, s);
        }
      }

      // trail
      const P = c.trail.geometry.attributes.position.array;
      const w = 0.45 * s;
      let px = x, pz = z;
      for (let j = 0; j < TRAIL_N; j++) {
        const tj = t - j * TRAIL_DT * Math.max(1, s * 0.6);
        race.pos(k, tj, a);
        const qx = a[0], qz = -a[1];
        let nx = -(pz - qz), nz = px - qx;
        const L = Math.hypot(nx, nz);
        if (L > 1e-3) { nx /= L; nz /= L; } else { nx = c.dir.z; nz = -c.dir.x; }
        const yy = y + 0.25;
        P[j * 6] = qx + nx * w; P[j * 6 + 1] = yy; P[j * 6 + 2] = qz + nz * w;
        P[j * 6 + 3] = qx - nx * w; P[j * 6 + 4] = yy; P[j * 6 + 5] = qz - nz * w;
        px = qx; pz = qz;
      }
      c.trail.geometry.attributes.position.needsUpdate = true;
      // a subtle trail at real scale, the bright light streak from the air
      c.trail.material.uniforms.opacity.value = opts.realScale ? 0.25 : 0.7;
      c.glow.material.opacity = opts.realScale ? 0.3 : 1;
      c.trail.visible = opts.trails && tel.speed > 30 && !(opts.realScale && k === focusK);

      // in practice, cars parked in the garage would pile their labels on top of each other
      const parked = !race.isRace && c.offTrack && tel.speed < 5 && k !== focusK;
      c.label.visible = opts.labels && !(opts.onboard && k === focusK) && !parked;
      // labels fade where they would cover the rooftop SINGAPORE sign
      c.el.classList.toggle('masked', !!(opts.labelMask && c.label.visible && opts.labelMask(c.root.position)));
      c.el.classList.toggle('focus', k === focusK);
    }
    this.sparks.update(dt);
  }

  setPositions(order) {
    order.forEach((d, i) => { this.cars[d.k].elPos.textContent = i + 1; });
  }
}
