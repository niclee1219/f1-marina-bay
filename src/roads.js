// Public roads around the circuit, from the OSM ways in city.roads (class k, lanes l, one-way o:
// scripts/fetch_road_tags.py): black asphalt ribbons, mitred at bends and capped round at the ends,
// with the markings drawn in the shader as on Singapore roads (white dashed lane lines, a double
// white centre line on two-way roads, yellow kerb lines, double on the main roads), and a concrete
// pavement with a lighter kerb edge under the main roads. Expressway decks are built in viaducts.js.
// Two meshes, two draw calls for the whole city.
import * as THREE from 'three';
import { NIGHT } from './config.js';

// small height steps per class so crossing roads of different classes never z-fight
const LEVEL = { motorway: 0.075, trunk: 0.072, primary: 0.07, secondary: 0.066, tertiary: 0.062, link: 0.064, residential: 0.058, service: 0.054 };
const MAJOR = new Set(['motorway', 'trunk', 'primary', 'secondary']);
const F_ONEWAY = 1, F_CAP = 2, F_PLAIN = 4, F_PAVE = 8, F_MAJOR = 16;

export function buildRoads(city, elevated) {
  const road = buffers(), pave = buffers();
  for (const r of city.roads) {
    const p = r.p;
    let up = 0;
    for (let i = 0; i < p.length; i += 2) if (elevated.has(`${Math.round(p[i])},${Math.round(p[i + 1])}`)) up++;
    if (up * 2 >= p.length / 2) continue;
    const pts = [];
    for (let i = 0; i < p.length; i += 2) {
      const x = p[i], z = -p[i + 1], last = pts[pts.length - 1];
      if (!last || Math.hypot(x - last[0], z - last[1]) > 0.3) pts.push([x, z]);
    }
    if (pts.length < 2) continue;
    const k = r.k || 'residential', hw = r.w / 2;
    // lanes in total: OSM counts both directions; narrow roads keep at least one per direction
    const lanes = Math.max(r.o ? 1 : 2, Math.min(r.l || 2, Math.floor(r.w / 2.8)));
    const flags = (r.o ? F_ONEWAY : 0) | (k === 'service' ? F_PLAIN : 0) | (MAJOR.has(k) ? F_MAJOR : 0);
    ribbon(road, pts, hw, LEVEL[k] ?? 0.058, lanes, flags, hw);
    if (k !== 'service' && r.w >= 7) ribbon(pave, pts, hw + 2.6, 0.035, lanes, flags | F_PAVE, hw);
  }
  const group = new THREE.Group();
  group.name = 'roads';
  // indexed, no normals (unlit): the vertex count is what these two meshes cost on the GPU
  const mk = (b, units) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute('aRoad', new THREE.Float32BufferAttribute(b.a, 4));
    g.setAttribute('aInfo', new THREE.Float32BufferAttribute(b.b, 3));
    g.setIndex(b.idx);
    return new THREE.Mesh(g, roadMaterial(units));
  };
  group.add(mk(pave, -3), mk(road, -5));
  return group;
}

const buffers = () => ({ pos: [], a: [], b: [], idx: [] });

// One road as a mitred strip plus round end caps, indexed.
//   aRoad = (lateral m, along m, strip half width, metres to the nearer end)
//   aInfo = (lanes, flags, carriageway half width)
function ribbon(b, pts, hw, y, lanes, flags, roadHw) {
  const n = pts.length, cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const len = cum[n - 1];
  const P = b.pos, A = b.a, B = b.b, I = b.idx;
  const v = (x, z, lat, s, f = flags) => {
    P.push(x, f & F_CAP ? y - 0.004 : y, z); A.push(lat, s, hw, Math.min(s, len - s)); B.push(lanes, f, roadHw);
    return P.length / 3 - 1;
  };
  // a triangle wound to face up (+y), so the surfaces render single-sided
  const tri = (i, j, k) => {
    const ux = P[j * 3] - P[i * 3], uz = P[j * 3 + 2] - P[i * 3 + 2], vx = P[k * 3] - P[i * 3], vz = P[k * 3 + 2] - P[i * 3 + 2];
    if (uz * vx - ux * vz < 0) I.push(i, k, j); else I.push(i, j, k);
  };
  let prev = null;
  for (let i = 0; i < n; i++) {
    // mitre: the average of the two segment normals, lengthened by 1 / cos(half the turn), capped
    const d0 = dir(pts[Math.max(0, i - 1)], pts[Math.max(1, i)]), d1 = dir(pts[Math.min(n - 2, i)], pts[Math.min(n - 1, i + 1)]);
    let nx = -(d0[1] + d1[1]), nz = d0[0] + d1[0];
    const l = Math.hypot(nx, nz) || 1;
    nx /= l; nz /= l;
    const k = Math.min(2, 1 / Math.max(0.5, -nx * d0[1] + nz * d0[0])) * hw;
    const [x, z] = pts[i];
    const cur = [v(x + nx * k, z + nz * k, hw, cum[i]), v(x - nx * k, z - nz * k, -hw, cum[i])];
    if (prev) { tri(prev[0], prev[1], cur[0]); tri(prev[1], cur[1], cur[0]); }
    prev = cur;
  }
  // round caps fill the gaps where roads meet at their ends (no markings on them); a few mm low so
  // a crossing road's strip always wins. Pavements get none: they would cover junction centres
  if (flags & F_PAVE) return;
  const SEG = 8;
  for (const [cx, cz] of [pts[0], pts[n - 1]]) {
    const c = v(cx, cz, 0, 0, flags | F_CAP), ring = [];
    for (let j = 0; j < SEG; j++) ring.push(v(cx + Math.cos(j / SEG * Math.PI * 2) * hw, cz + Math.sin(j / SEG * Math.PI * 2) * hw, hw, 0, flags | F_CAP));
    for (let j = 0; j < SEG; j++) tri(c, ring[j], ring[(j + 1) % SEG]);
  }
}

function dir(a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
  return [dx / l, dz / l];
}

function roadMaterial(units) {
  const lift = NIGHT.lift;
  // Unlit: away from the floodlit circuit the scene lights barely reach the ground, so the street
  // lighting is a flat warm term on the surface's own albedo (paint reads brighter than asphalt);
  // the lamp pools (streets.js) add the variation along the road.
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: units,
  });
  // a short fixed key: the default hashes this whole function's source whenever it is looked up
  mat.customProgramCacheKey = () => 'roads-v1';
  mat.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aRoad; attribute vec3 aInfo; varying vec4 vRoad; varying vec3 vInfo;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoad = aRoad; vInfo = aInfo;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec4 vRoad; varying vec3 vInfo;
uniform vec3 uStreetLight;
// line of half-width w at distance d, with fw = metres per pixel across it (fades below a pixel)
float lineAt(float d, float w, float fw) {
  return (1.0 - smoothstep(w - fw, w + fw, d)) * clamp(2.0 * w / fw - 0.3, 0.0, 1.0);
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  // derivatives first, in uniform control flow; then branch-light arithmetic only
  float lat = vRoad.x, along = vRoad.y, hw = vRoad.z;
  float fw = max(fwidth(lat), 1e-4);
  float flags = vInfo.y;
  float pave = step(7.5, mod(flags, 16.0));                         // F_PAVE (8)
  float plain = step(1.5, mod(flags, 8.0));                         // F_CAP (2) or F_PLAIN (4)
  float oneway = mod(flags, 2.0), major = step(15.5, flags);
  vec2 cell = floor(vec2(lat, along) * 1.7);
  float grain = fract(sin(cell.x * 12.9898 + cell.y * 78.233) * 437.585);
  vec3 asphalt = vec3(0.042, 0.044, 0.05) * (0.85 + 0.3 * grain);
  // pavement: concrete with the kerb a lighter band just outside the carriageway (vInfo.z)
  vec3 concrete = mix(vec3(0.15, 0.15, 0.155) * (0.9 + 0.2 * grain), vec3(0.34, 0.34, 0.37), lineAt(abs(abs(lat) - vInfo.z - 0.15), 0.15, fw));
  // markings, x from the left edge of the carriageway
  float x = lat + hw, W = 2.0 * hw, e = W - x;
  float fade = smoothstep(2.0, 6.0, vRoad.w) * (1.0 - plain);
  float yl = lineAt(abs(x - 0.35), 0.07, fw) + lineAt(abs(e - 0.35), 0.07, fw)
           + major * (lineAt(abs(x - 0.6), 0.07, fw) + lineAt(abs(e - 0.6), 0.07, fw));
  float lanes = max(1.0, vInfo.x), lw = W / lanes;
  float k = clamp(floor(x / lw + 0.5), 1.0, max(1.0, lanes - 1.0));
  float inner = step(1.5, lanes);                                   // any lane line at all
  float centre = (1.0 - oneway) * (1.0 - step(0.01, abs(k - lanes * 0.5)));
  float d = abs(x - k * lw);
  float dash = step(fract(along / 9.0), 0.34);
  float wl = inner * mix(lineAt(d, 0.075, fw) * dash, lineAt(abs(d - 0.18), 0.07, fw), centre);
  vec3 road = mix(asphalt, vec3(0.8, 0.6, 0.1), clamp(yl, 0.0, 1.0) * fade);
  road = mix(road, vec3(0.78), clamp(wl, 0.0, 1.0) * fade);
  diffuseColor.rgb = mix(road, concrete, pave) * uStreetLight;
}`);
    s.uniforms.uStreetLight = { value: new THREE.Color(0.42 + lift * 2, 0.35 + lift * 1.5, 0.26 + lift) };
  };
  return mat;
}
