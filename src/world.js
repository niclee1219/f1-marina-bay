// Night-time Marina Bay: sky, ground, water, parks, roads, buildings and landmarks.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { elevatedRoadKeys } from './viaducts.js';
import { COLORS } from './config.js';

// OSM metres (x east, y north) -> scene (X, Z)
export const sx = x => x;
export const sz = y => -y;

// Degenerate triangles (duplicate OSM nodes) give zero-length normals, which turn into NaN
// in the lighting and get smeared across the screen by the bloom pass. Point them up instead.
function fixNormals(geo) {
  const n = geo.attributes.normal.array;
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]);
    if (!(l > 1e-6)) { n[i] = 0; n[i + 1] = 1; n[i + 2] = 0; }
  }
  return geo;
}

function ringToShape(flat) {
  const pts = [];
  for (let i = 0; i < flat.length; i += 2) pts.push(new THREE.Vector2(flat[i], flat[i + 1]));
  return new THREE.Shape(pts);
}

// Flat polygon set lying on the ground at height y.
function flatPolys(rings, y) {
  const geos = [];
  for (const r of rings) {
    if (r.length < 6) continue;
    const g = new THREE.ShapeGeometry(ringToShape(r));
    g.rotateX(-Math.PI / 2);
    g.translate(0, y, 0);
    geos.push(g);
  }
  return geos.length ? mergeGeometries(geos) : new THREE.BufferGeometry();
}

export function buildSky(scene) {
  const geo = new THREE.SphereGeometry(9000, 48, 24);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {},
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `
      varying vec3 vDir;
      float hash(vec3 p){ p = fract(p*0.3183099+.1); p*=17.; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      void main(){
        float h = vDir.y;
        vec3 top = vec3(0.012,0.016,0.045);
        vec3 mid = vec3(0.045,0.035,0.10);
        vec3 glow = vec3(0.32,0.12,0.16);   // sodium/neon city glow on the haze
        vec3 c = mix(mid, top, smoothstep(0.02, 0.55, h));
        c = mix(c, glow, (1.0 - smoothstep(-0.02, 0.16, h)) * 0.55);
        float s = hash(floor(vDir*900.));
        c += vec3(step(0.9985, s) * smoothstep(0.1, 0.5, h) * 0.6);
        gl_FragColor = vec4(c, 1.);
      }`,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.renderOrder = -1;
  scene.add(sky);
  return sky;
}

const WINDOW_GLSL = /* glsl */`
  float bhash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;

// Building kinds (aKind): drive floor height, bay width, window shape and light colour.
export const KIND = { other: 0, office: 1, hotel: 2, residential: 3, retail: 4, civic: 4, heritage: 5, religious: 5, filler: 6, tile: 7, solid: 8, stone: 9 };

const buildingTime = { value: 0 };

// Night facades, banded by floor:
//  office      continuous glass ribbons between dark spandrels, cool light, whole floors lit or dark
//  hotel       warm room-by-room windows with balcony fins, a few dark floors
//  residential punched windows, warm / neutral, about half lit
//  heritage    tall shuttered windows, warm, on colonial white walls
//  stone       stone-clad office tower: punched windows in a granite grid, lit like offices
//  filler      distant generic blocks: dim and plain so the landmarks read first
//  tile        pitched clay-tile roof surfaces (no windows), solid: blank cladding washed by uplights
// Roofs are a dark membrane, with a lit parapet edge on taller blocks.
export function buildingMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.35, vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = buildingTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aSeed; attribute float aTop; attribute float aKind;
        varying float vSeed; varying float vTop; varying float vKind; varying vec3 vWPos; varying vec3 vWN;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vSeed = aSeed; vTop = aTop; vKind = aKind;
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWN = normalize(mat3(modelMatrix) * objectNormal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        varying float vSeed; varying float vTop; varying float vKind; varying vec3 vWPos; varying vec3 vWN;` + WINDOW_GLSL)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float wall = 1.0 - step(0.6, abs(vWN.y));
          float roof = step(0.6, vWN.y);
          float k = floor(vKind + 0.5);
          float tall = step(45.0, vTop);
          float isStone = float(k == 9.0);
          float isOffice = float(k == 1.0) + float(k == 0.0 || k == 4.0) * tall;
          float isHotel = float(k == 2.0);
          float isRes = float(k == 3.0) + float(k == 0.0 || k == 4.0) * (1.0 - tall);
          float isHer = float(k == 5.0);
          float isFill = float(k == 6.0);
          float isTile = float(k == 7.0);
          float isSolid = float(k == 8.0);
          float glazed = 1.0 - isTile - isSolid;

          vec2 tg = normalize(vec2(-vWN.z, vWN.x) + 1e-5);
          float u = dot(vWPos.xz, tg);
          float v = vWPos.y;
          float fh = isOffice * 4.0 + isHotel * 3.2 + isRes * 3.0 + isHer * 4.6 + isFill * 3.4 + isStone * 4.0;
          float bay = isOffice * 1.6 + isHotel * 4.2 + isRes * 3.6 + isHer * 3.4 + isFill * 3.0 + isStone * 2.2;
          fh = max(fh, 3.0); bay = max(bay, 1.5);
          float fl = floor(v / fh), fv = fract(v / fh);
          float bx = floor(u / bay), bu = fract(u / bay);
          // facade id so each face of a block has its own pattern of lit floors
          float face = floor(atan(vWN.z, vWN.x + 1e-4) * 1.27 + 4.0);   // (atan(0, 0) on roofs is NaN on some GPUs)

          // window openings
          float oOffice = step(0.24, fv) * step(fv, 0.93) * step(0.04, bu);
          float oHotel = step(0.2, fv) * step(fv, 0.86) * step(0.1, bu) * step(bu, 0.9);
          float oRes = step(0.3, fv) * step(fv, 0.8) * step(0.22, bu) * step(bu, 0.78);
          float oHer = step(0.22, fv) * step(fv, 0.86) * step(0.32, bu) * step(bu, 0.68);
          float oStone = step(0.3, fv) * step(fv, 0.86) * step(0.18, bu) * step(bu, 0.82);
          float open = isOffice * oOffice + isHotel * oHotel + isRes * oRes + isHer * oHer + isFill * oRes + isStone * oStone;

          // which windows are lit: whole office floors, hotel rooms, flats
          float floorH = bhash(vec2(fl * 1.37 + face * 17.0, vSeed * 97.0));
          float roomH = bhash(vec2(bx, fl) + vSeed * 31.7 + face);
          // office floors are lit in zones: groups of bays share a level, with some dark patches
          float zoneH = bhash(vec2(floor(bx / 6.0), fl) + vSeed * 13.1 + face);
          float litOffice = step(0.38, floorH) * step(0.3, zoneH) * (0.3 + 0.45 * zoneH + 0.1 * roomH);
          float litHotel = step(0.1, floorH) * step(0.32, roomH) * (0.55 + 0.45 * fract(roomH * 7.3));
          float litRes = step(0.5, roomH) * (0.5 + 0.5 * fract(roomH * 5.1));
          float litHer = step(0.42, roomH) * (0.7 + 0.3 * fract(roomH * 3.7));
          float lit = (isOffice + isStone) * litOffice + isHotel * litHotel + isRes * litRes + isHer * litHer + isFill * litRes * 0.35;
          lit *= step(2.6, v) * step(v, vTop - 1.2);

          vec3 cool = vec3(0.72, 0.86, 1.0), warm = vec3(1.0, 0.66, 0.36), neutral = vec3(1.0, 0.85, 0.66);
          vec3 wc = isOffice * mix(cool, neutral, step(0.85, fract(floorH * 13.1)))
                  + isStone * mix(neutral, cool, step(0.7, fract(floorH * 13.1)))
                  + isHotel * warm
                  + isRes * mix(warm, neutral, step(0.55, fract(roomH * 9.7)))
                  + (isHer + isFill) * mix(warm, neutral, 0.3);
          vec3 pattern = open * lit * wc * 1.05;
          // lobby / shopfront glow along the ground floor of towers and shops
          float lobby = (isOffice + isHotel + isStone + float(k == 4.0)) * step(0.6, v) * step(v, 5.5) * step(0.1, bu);
          pattern += lobby * neutral * 0.55;

          // when a window cell shrinks to a few pixels, fade to its average glow (no shimmer)
          float px = max(fwidth(u / bay), fwidth(v / fh));
          float far = smoothstep(0.3, 0.9, px);
          float avgLit = isStone * 0.3 + isOffice * 0.3 + isHotel * 0.42 + isRes * 0.3 + isHer * 0.3 + isFill * 0.08;
          float avgOpen = isStone * 0.38 + isOffice * 0.66 + isHotel * 0.53 + isRes * 0.28 + isHer * 0.23 + isFill * 0.28;
          vec3 avg = wc * avgLit * avgOpen * step(2.6, v) * 0.9;
          totalEmissiveRadiance += wall * glazed * mix(pattern, avg, far);

          // spandrels and mullions read darker than the glass between them
          float frame = (1.0 - open) * (1.0 - far);
          diffuseColor.rgb *= 1.0 - 0.35 * frame * wall * glazed;

          // glass towers mirror the night sky: purple haze low, deep blue overhead
          vec3 V = normalize(vWPos - cameraPosition);
          vec3 R = reflect(V, vWN);
          vec3 env = mix(vec3(0.06, 0.04, 0.07), vec3(0.01, 0.03, 0.055), smoothstep(-0.1, 0.5, R.y));
          float fres = pow(1.0 - max(dot(-V, vWN), 0.0), 3.0);
          totalEmissiveRadiance += wall * glazed * (isOffice + isHotel) * tall * env * (0.2 + 0.8 * fres) * (1.0 - open * lit);
          // faint facade bounce so massing reads at night (weaker for distant filler)
          totalEmissiveRadiance += wall * vec3(0.016, 0.02, 0.032) * (0.6 + 0.4 * smoothstep(0.0, 80.0, v)) * (1.0 - 0.6 * isFill);

          // parapet edge lighting on taller blocks
          float parapet = wall * step(28.0, vTop) * smoothstep(vTop - 0.9, vTop - 0.3, v) * step(v, vTop) * step(0.3, fract(vSeed * 3.1)) * (1.0 - isFill);
          totalEmissiveRadiance += parapet * mix(vec3(0.85, 0.92, 1.0), vec3(1.0, 0.82, 0.6), step(0.5, fract(vSeed * 5.3))) * 1.1;
          // a few towers carry vertical LED strips that slowly shift colour
          float strip = tall * wall * glazed * step(0.86, vSeed) * step(0.965, fract(u / 9.0)) * step(4.0, v) * step(v, vTop) * (1.0 - isHotel);
          vec3 ledc = 0.5 + 0.5 * cos(6.2831 * (uTime * 0.05 + vSeed + vec3(0.0, 0.33, 0.67)));
          totalEmissiveRadiance += strip * ledc * 1.4;

          // stone towers: the crown (top quarter) is floodlit warm white
          totalEmissiveRadiance += isStone * wall * vec3(0.95, 0.88, 0.74) * 0.55 * smoothstep(0.72, 0.8, v / max(vTop, 1.0));
          // blank cladding (landmark spines, plinths): washed by uplights from the base
          totalEmissiveRadiance += isSolid * wall * diffuseColor.rgb * (0.12 + 0.3 * (1.0 - smoothstep(0.0, max(vTop, 1.0), v)));
          // clay-tile roofs: keep their colour, catch a little warm street light
          totalEmissiveRadiance += isTile * diffuseColor.rgb * vec3(0.16, 0.1, 0.06);

          // flat roofs: dark membrane with a little gravel texture (never the default grey)
          float grit = bhash(floor(vWPos.xz * 1.3)) * 0.012;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.032, 0.037) + grit, roof * (1.0 - isTile) * (1.0 - isSolid));
        }`);
  };
  mat.customProgramCacheKey = () => 'building-v2';
  return mat;
}

// Geometry for buildingMaterial(): non-indexed, no uv, with per-vertex seed / roof height / colour / kind.
export function tagBuilding(g, seed, top, color, kind = KIND.other) {
  g = g.index ? g.toNonIndexed() : g;
  if (g.attributes.uv) g.deleteAttribute('uv');
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count;
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(new Float32Array(n).fill(seed), 1));
  g.setAttribute('aTop', new THREE.Float32BufferAttribute(new Float32Array(n).fill(top), 1));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(new Float32Array(n).fill(kind), 1));
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = color.r; col[i * 3 + 1] = color.g; col[i * 3 + 2] = color.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// footprint ring scaled about its centroid, as a Shape
function scaledShape(flat, k) {
  const c = centroid(flat);
  const pts = [];
  for (let i = 0; i < flat.length; i += 2) {
    pts.push(new THREE.Vector2(c.x + (flat[i] - c.x) * k, c.y + (flat[i + 1] - c.y) * k));
  }
  return new THREE.Shape(pts);
}

// beyond this distance from the circuit centre, untagged blocks are drawn as plain filler (metres)
const FILLER_RANGE = 1150;

// OSM point at local (u along the long axis, v across) of an oriented box
function local(o, u, v) {
  const c = Math.cos(o.a), s = Math.sin(o.a);
  return { x: o.cx + u * c - v * s, y: o.cy + u * s + v * c };
}

// hipped roof over an oriented box footprint: ridge along the long axis, eaves at y0
function hipRoof(o, y0, rise) {
  const L = o.len / 2 + 0.4, W = o.wid / 2 + 0.4, r = Math.max(0, L - W);
  const P = [[-L, -W], [L, -W], [L, W], [-L, W]].map(([u, v]) => local(o, u, v));
  const R = [local(o, -r, 0), local(o, r, 0)];
  const V = p => [p.x, y0, -p.y], T = p => [p.x, y0 + rise, -p.y];
  // long sides, then hip ends; a square footprint collapses the ridge to a point, so drop the
  // zero-area triangles that leaves (their normals would be NaN)
  const tris = [
    [V(P[0]), V(P[1]), T(R[1])], [V(P[0]), T(R[1]), T(R[0])],
    [V(P[2]), V(P[3]), T(R[0])], [V(P[2]), T(R[0]), T(R[1])],
    [V(P[1]), V(P[2]), T(R[1])], [V(P[3]), V(P[0]), T(R[0])],
  ].filter(([a, b, c]) => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    return Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) > 1e-3;
  });
  // wind every face so it points up (depends on the box orientation)
  const pos = [];
  for (const [a, b, c] of tris) {
    const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    pos.push(...a, ...(ny >= 0 ? b : c), ...(ny >= 0 ? c : b));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export function buildCity(scene, city, hidden = () => false) {
  const group = new THREE.Group();
  scene.add(group);

  // ground
  const ground = new THREE.Mesh(new THREE.CircleGeometry(9000, 64),
    new THREE.MeshStandardMaterial({ color: 0x161a23, roughness: 1, emissive: 0x05060a }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  group.add(ground);

  // parks
  const parks = new THREE.Mesh(flatPolys(city.parks, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x0f261a, roughness: 1, emissive: 0x04100a }));
  group.add(parks);

  // roads: flat ribbons (expressway viaducts are built as elevated decks in viaducts.js)
  const elevated = elevatedRoadKeys(city);
  const roadPos = [];
  for (const r of city.roads) {
    const p = r.p, hw = r.w / 2;
    let up = 0;
    for (let i = 0; i < p.length; i += 2) if (elevated.has(`${Math.round(p[i])},${Math.round(p[i + 1])}`)) up++;
    if (up * 2 >= p.length / 2) continue;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], ay = -p[i + 1], bx = p[i + 2], by = -p[i + 3];
      const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
      const nx = -dy / L * hw, ny = dx / L * hw;
      roadPos.push(ax + nx, 0.05, ay + ny, ax - nx, 0.05, ay - ny, bx + nx, 0.05, by + ny,
        ax - nx, 0.05, ay - ny, bx - nx, 0.05, by - ny, bx + nx, 0.05, by + ny);
    }
  }
  const roadGeo = new THREE.BufferGeometry();
  roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadPos, 3));
  roadGeo.setAttribute('normal', new THREE.Float32BufferAttribute(
    new Float32Array(roadPos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  const roads = new THREE.Mesh(roadGeo, new THREE.MeshStandardMaterial({
    color: 0x1c1e25, roughness: 0.9, emissive: 0x1e150a, side: THREE.DoubleSide,
  }));
  group.add(roads);

  // buildings: real OSM footprints and heights; materials from the OSM use / heritage tags
  const geos = [], domes = [], beacons = [], masts = [];
  const tint = new THREE.Color();
  const block = (shape, from, to, seed, top, color, kind) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.5, to - from), bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    g.translate(0, from, 0);
    geos.push(tagBuilding(g, seed, top, color, kind));
  };
  const centre = { x: city.centre[0], y: city.centre[1] };
  const tallest = city.buildings.filter(b => !hidden(b.n)).map(b => b.h).sort((a, b) => b - a)[24] || 150;
  city.buildings.forEach((b, idx) => {
    if (b.dome) { domes.push(b); return; }
    if (hidden(b.n)) return;   // modelled by hand in skyline.js / pit.js
    const shape = ringToShape(b.p);
    const area = Math.abs(THREE.ShapeUtils.area(shape.getPoints()));
    if (area < 6) return;
    const minh = b.m || 0;
    const seed = ((idx * 9301 + 49297) % 233280) / 233280;
    const c = centroid(b.p);
    const far = Math.hypot(c.x - centre.x, c.y - centre.y) > FILLER_RANGE;
    let kind = KIND[b.k] ?? KIND.other;
    if (b.hr) kind = KIND.heritage;
    // distant generic blocks are filler: plain, dim, no crowns or roof furniture
    const filler = far && kind === KIND.other;
    if (filler) kind = KIND.filler;
    if (b.bc) tint.set(b.bc).multiplyScalar(0.8);
    else if (kind === KIND.heritage) {
      // civic and church buildings in colonial white; conserved shophouses in faded pastels
      if (b.k === 'civic' || b.k === 'religious' || b.h > 20) tint.setRGB(0.8, 0.77, 0.7);
      else tint.setHSL([0.02, 0.1, 0.14, 0.33, 0.55, 0.95][idx % 6], 0.32, 0.62 + seed * 0.1);
    } else if (filler) tint.setHSL(0.62, 0.1, 0.07 + seed * 0.03);
    else if (b.h > 60) tint.setHSL(0.6 + seed * 0.05, 0.22, 0.12 + seed * 0.07);
    else tint.setHSL(0.07 + seed * 0.5, 0.08, 0.11 + seed * 0.07);
    const o = obb(b.p);
    const rect = area / (o.len * o.wid);
    if (!filler && b.h > 85 && area > 350 && seed > 0.25) {
      // stepped crown: podium-to-top shaft, then two setbacks
      block(shape, minh, b.h * 0.74, seed, b.h, tint, kind);
      block(scaledShape(b.p, 0.84), b.h * 0.74, b.h * 0.9, seed, b.h, tint, kind);
      block(scaledShape(b.p, 0.62), b.h * 0.9, b.h, seed, b.h, tint, kind);
    } else {
      block(shape, minh, b.h, seed, b.h, tint, kind);
    }
    if (filler) return;
    // pitched clay-tile roofs on heritage low-rises (OSM roof colour where tagged)
    if (kind === KIND.heritage && b.h < 40) {
      const tile = new THREE.Color(b.rc && b.rc !== '#ff3333' ? b.rc : COLORS.terracotta);
      if (b.rc === '#ff3333' || !b.rc) tile.offsetHSL(0, 0, (seed - 0.5) * 0.08);
      if (rect > 0.78 && o.wid < 40) geos.push(tagBuilding(hipRoof(o, b.h, Math.min(o.wid * 0.32, 5)), seed, b.h, tile, KIND.tile));
      else block(scaledShape(b.p, 0.97), b.h, b.h + 0.6, seed, b.h, tile, KIND.tile);
      return;
    }
    // roof furniture: plant rooms, residential water tanks, helipads (OSM)
    const plant = new THREE.Color(0.07, 0.075, 0.08);
    if (b.h > 18 && area > 160) block(scaledShape(b.p, 0.38), b.h, b.h + 3.2, seed, b.h + 3.2, plant, KIND.solid);
    if (kind === KIND.residential && b.h > 20 && area > 200) {
      for (const s of [-1, 1]) {
        const p = local(o, s * o.len * 0.22, 0);
        geos.push(tagBuilding(new THREE.CylinderGeometry(1.7, 1.7, 3.4, 10).translate(p.x, b.h + 3.2 + 1.7, -p.y), seed, b.h + 6.6, new THREE.Color(0.32, 0.36, 0.4), KIND.solid));
      }
    }
    if (b.hp) {
      const pad = new THREE.CylinderGeometry(Math.min(o.wid, o.len) * 0.3, Math.min(o.wid, o.len) * 0.3, 0.4, 24).translate(c.x, b.h + 0.2, -c.y);
      geos.push(tagBuilding(pad, seed, b.h + 0.4, new THREE.Color(0.12, 0.3, 0.16), KIND.solid));
    }
    // red aviation lights: mast tip on tall towers, plus the four roof corners on the tallest
    if (b.h > 110) {
      const mh = 10 + seed * 22;
      masts.push(new THREE.CylinderGeometry(0.25, 0.6, mh, 6).translate(c.x, b.h + mh / 2, -c.y));
      beacons.push(new THREE.Vector3(c.x, b.h + mh + 0.8, -c.y));
    }
    if (b.h >= tallest) {
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const p = local(o, sx * o.len * 0.46, sy * o.wid * 0.46);
        beacons.push(new THREE.Vector3(p.x, b.h + 1.2, -p.y));
      }
    }
  });
  const merged = fixNormals(mergeGeometries(geos));
  const buildings = new THREE.Mesh(merged, buildingMaterial());
  group.add(buildings);
  if (masts.length) {
    group.add(new THREE.Mesh(mergeGeometries(masts), new THREE.MeshStandardMaterial({ color: 0x6b7280, metalness: 0.8, roughness: 0.35 })));
  }

  // aircraft warning beacons on towers
  const bGeo = new THREE.SphereGeometry(1.4, 8, 6);
  const bMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.15, 0.1) });
  const bInst = new THREE.InstancedMesh(bGeo, bMat, beacons.length);
  const m4 = new THREE.Matrix4();
  beacons.forEach((p, i) => bInst.setMatrixAt(i, m4.makeTranslation(p.x, p.y, p.z)));
  group.add(bInst);

  const animated = [];
  for (const lm of city.landmarks) {
    if (lm.type === 'stage') group.add(makeStage(lm, animated, lm.name === 'Padang' ? 1 : 0.7));
  }
  // building height at a scene position (0 if open ground), for camera line-of-sight checks
  const CELL = 50, cells = new Map();
  city.buildings.forEach((b, bi) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < b.p.length; i += 2) {
      x0 = Math.min(x0, b.p[i]); x1 = Math.max(x1, b.p[i]);
      z0 = Math.min(z0, -b.p[i + 1]); z1 = Math.max(z1, -b.p[i + 1]);
    }
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
      for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
        const key = cx * 100000 + cz;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(bi);
      }
    }
  });
  const heightAt = (x, z) => {
    const list = cells.get(Math.floor(x / CELL) * 100000 + Math.floor(z / CELL));
    if (!list) return 0;
    let h = 0;
    for (const bi of list) {
      const p = city.buildings[bi].p;
      let inside = false;
      for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
        const xi = p[i], zi = -p[i + 1], xj = p[j], zj = -p[j + 1];
        if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
      }
      if (inside) h = Math.max(h, city.buildings[bi].h);
    }
    return h;
  };
  const update = (dt) => {
    buildingTime.value += dt;
    for (const f of animated) f(dt, buildingTime.value);
  };
  return { group, beacons: bInst, update, heightAt, domes, animated };
}

export function buildWater(scene, city, renderer) {
  const geo = flatPolys(city.water, 0);
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const shader = {
    uniforms: {
      color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null },
      time: { value: 0 }, fogColor: { value: new THREE.Color(0x0c1020) },
    },
    vertexShader: `
      uniform mat4 textureMatrix; varying vec4 vUv; varying vec3 vW; varying float vDepth;
      void main(){
        vUv = textureMatrix * vec4(position, 1.0);
        vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
        vec4 mv = viewMatrix * w; vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 color; uniform sampler2D tDiffuse; uniform float time; uniform vec3 fogColor;
      varying vec4 vUv; varying vec3 vW; varying float vDepth;
      float h21(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
      float vnoise(vec2 p){
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
      }
      void main(){
        vec2 w = vW.xz;
        // small wind ripples; distortion shrinks with distance so far water stays calm instead of noisy
        float n1 = vnoise(w * 0.08 + vec2(time * 0.25, time * 0.18));
        float n2 = vnoise(w * 0.21 - vec2(time * 0.31, -time * 0.22));
        vec2 ripple = (vec2(n1, n2) - 0.5) * 0.012 / (1.0 + vDepth * 0.004);
        vec2 base = vUv.xy / vUv.w + ripple;
        // vertical smear: city lights stretch into long streaks on the water, like a night photo
        vec3 refl = vec3(0.0); float wsum = 0.0;
        for (int k = -4; k <= 4; k++) {
          float fk = float(k);
          float wk = exp(-fk * fk * 0.18);
          refl += texture2D(tDiffuse, base + vec2(0.0, fk * 0.0045)).rgb * wk;
          wsum += wk;
        }
        refl /= wsum;
        vec3 V = normalize(vW - cameraPosition);
        float fres = 0.3 + 0.7 * pow(1.0 - abs(V.y), 4.0);
        vec3 deep = vec3(0.006, 0.016, 0.032);
        vec3 c = deep + refl * color * fres;
        float fog = 1.0 - exp(-pow(vDepth * 0.00028, 2.0));
        gl_FragColor = vec4(mix(c, fogColor, fog), 1.0);
        #include <colorspace_fragment>
      }`,
  };
  const ratio = Math.min(1, 1600 / size.x);
  const water = new Reflector(geo, {
    textureWidth: Math.round(size.x * ratio), textureHeight: Math.round(size.y * ratio),
    color: 0x9aa6c0, clipBias: 0.002, shader,
  });
  water.position.y = 0.03;
  scene.add(water);
  return water;
}

// Concert stage with an LED wall, truss, moving-head beams and a crowd of phone lights.
function makeStage(lm, animated, k) {
  const g = new THREE.Group();
  const ax = new THREE.Vector2(Math.cos(lm.dir), Math.sin(lm.dir));
  const end = lm.half * 0.7;
  g.position.set(lm.x + ax.x * end, 0, -(lm.y + ax.y * end));
  // local +z faces the audience (back toward the middle of the field)
  g.rotation.y = Math.atan2(-ax.x, ax.y);
  g.scale.setScalar(k);
  const dark = new THREE.MeshStandardMaterial({ color: 0x15171d, metalness: 0.5, roughness: 0.5 });
  const truss = new THREE.MeshStandardMaterial({ color: 0x9ca3af, metalness: 0.8, roughness: 0.3, emissive: 0x111317 });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(46, 2.2, 18), dark);
  deck.position.y = 1.1;
  g.add(deck);
  for (const x of [-22, 22]) for (const z of [-8, 8]) {
    const tw = new THREE.Mesh(new THREE.BoxGeometry(1.2, 23, 1.2), truss);
    tw.position.set(x, 11.5, z);
    g.add(tw);
  }
  for (const z of [-8, 0, 8]) {
    const bm = new THREE.Mesh(new THREE.BoxGeometry(45, 1.0, 1.0), truss);
    bm.position.set(0, 22.5, z);
    g.add(bm);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(48, 0.6, 20), dark);
  roof.position.y = 23.4;
  g.add(roof);
  // LED wall + side screens
  const led = new THREE.ShaderMaterial({
    uniforms: { t: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform float t; varying vec2 vUv;
      void main(){
        float col = floor(vUv.x * 24.0);
        float lvl = 0.15 + 0.8 * abs(sin(t * 2.7 + col * 1.7)) * abs(sin(t * 1.1 + col * 0.6));
        float bar = step(fract(vUv.x * 24.0), 0.82) * step(vUv.y, lvl);
        vec3 grad = 0.5 + 0.5 * cos(6.2831 * (t * 0.07 + vUv.x * 0.6 + vec3(0.0, 0.33, 0.67)));
        vec3 c = mix(vec3(0.015, 0.012, 0.03), grad * 2.2, bar);
        c += vec3(2.4, 0.15, 0.08) * smoothstep(0.93, 1.0, vUv.y);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(38, 15), led);
  wall.position.set(0, 10.5, -7.4);
  g.add(wall);
  for (const x of [-28, 28]) {
    const sc = new THREE.Mesh(new THREE.PlaneGeometry(9, 6), led);
    sc.position.set(x, 12, -1);
    g.add(sc);
    const spk = new THREE.Mesh(new THREE.BoxGeometry(1.6, 9, 1.6), dark);
    spk.position.set(x * 0.86, 14, 6);
    g.add(spk);
  }
  // moving-head beams
  const beamMat = (color) => new THREE.ShaderMaterial({
    uniforms: { c: { value: color } },
    vertexShader: 'varying float vY; void main(){ vY = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 c; varying float vY; void main(){ gl_FragColor = vec4(c * pow(vY, 3.0) * 0.16, 1.0); }',
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const coneGeo = new THREE.ConeGeometry(5, 46, 24, 1, true).translate(0, -23, 0);
  const beams = [];
  for (let i = 0; i < 12; i++) {
    const front = i >= 8;
    const holder = new THREE.Group();
    holder.position.set(front ? (i - 9.5) * 11 : (i - 3.5) * 5.5, 21.8, front ? 7.5 : -5.5);
    const color = new THREE.Color().setHSL(i / 12, 0.9, 0.6);
    const cone = new THREE.Mesh(coneGeo, beamMat(color));
    holder.add(cone);
    g.add(holder);
    beams.push({ holder, cone, phase: i * 0.7, color });
  }
  // lasers fanning out over the crowd
  const laserMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.1, 1.6, 0.35), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
  const lasers = [];
  for (let i = 0; i < 6; i++) {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 160, 4).translate(0, 80, 0), laserMat);
    l.position.set((i - 2.5) * 4, 20, 2);
    g.add(l);
    lasers.push(l);
  }
  // crowd: phone torches and wristbands
  const N = 1800, pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  const c = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const r = Math.sqrt(Math.random());
    pos[i * 3] = (Math.random() - 0.5) * 70 * (0.5 + r);
    pos[i * 3 + 1] = 1.5 + Math.random() * 0.6;
    pos[i * 3 + 2] = 14 + r * 95;
    if (Math.random() < 0.2) c.setRGB(0.9, 0.85, 0.75); else c.setHSL(Math.random(), 0.9, 0.18);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  pg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.add(new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.35, vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false })));
  animated.push((dt, t) => {
    led.uniforms.t.value = t;
    beams.forEach((b, i) => {
      b.holder.rotation.x = 0.55 + Math.sin(t * 0.9 + b.phase) * 0.45;
      b.holder.rotation.z = Math.sin(t * 0.6 + b.phase * 1.3) * 0.7;
      b.cone.material.uniforms.c.value.setHSL((t * 0.05 + i / 12) % 1, 1.0, 0.45);
    });
    lasers.forEach((l, i) => {
      l.rotation.x = 1.0 + Math.sin(t * 0.8 + i) * 0.25;
      l.rotation.z = (i - 2.5) * 0.18 + Math.sin(t * 1.3 + i * 0.5) * 0.2;
      l.visible = Math.sin(t * 0.4) > -0.2;
    });
  });
  return g;
}

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

export function centroid(flat) {
  let x = 0, y = 0;
  for (let i = 0; i < flat.length; i += 2) { x += flat[i]; y += flat[i + 1]; }
  return new THREE.Vector2(x / (flat.length / 2), y / (flat.length / 2));
}
