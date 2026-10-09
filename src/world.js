// Night-time Marina Bay: sky, ground, water, parks, roads, buildings and landmarks.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Reflector } from 'three/addons/objects/Reflector.js';

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

function buildingMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.35, vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aSeed; attribute float aTop; varying float vSeed; varying float vTop; varying vec3 vWPos; varying vec3 vWN;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vSeed = aSeed; vTop = aTop;
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWN = normalize(mat3(modelMatrix) * objectNormal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vSeed; varying float vTop; varying vec3 vWPos; varying vec3 vWN;` + WINDOW_GLSL)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float wall = 1.0 - step(0.6, abs(vWN.y));
          vec2 tg = normalize(vec2(-vWN.z, vWN.x) + 1e-5);
          float u = dot(vWPos.xz, tg);
          float v = vWPos.y;
          float tall = step(60.0, vTop);
          vec2 cs = mix(vec2(3.4, 3.8), vec2(2.2, 4.2), tall);
          vec2 cell = floor(vec2(u, v) / cs);
          vec2 f = fract(vec2(u, v) / cs);
          float win = step(0.16, f.x) * step(f.x, 0.84) * step(0.22, f.y) * step(f.y, 0.78);
          float h = bhash(cell + vSeed * 31.7);
          float density = mix(0.6, 0.45, tall);
          float lit = step(density, h) * step(2.5, v) * step(v, vTop - 1.5);
          vec3 warm = vec3(1.0, 0.70, 0.40);
          vec3 cool = vec3(0.70, 0.85, 1.0);
          vec3 wc = mix(warm, cool, step(0.55, fract(h * 7.31 + vSeed)));
          float inten = 0.3 + 1.15 * fract(h * 13.7);
          vec3 pattern = win * lit * wc * inten;
          // when a window cell shrinks below a few pixels, fade to its average glow (no sparkle)
          float px = max(fwidth(u / cs.x), fwidth(v / cs.y));
          float far = smoothstep(0.3, 0.9, px);
          vec3 avg = mix(warm, cool, 0.45) * (1.0 - density) * 0.36 * 0.55 * step(2.5, v);
          totalEmissiveRadiance += wall * mix(pattern, avg, far);
          // faint facade bounce so massing reads at night
          totalEmissiveRadiance += wall * vec3(0.018, 0.022, 0.034) * (0.6 + 0.4 * smoothstep(0.0, 80.0, v));
          // crown lighting on tall towers
          float crown = tall * wall * smoothstep(vTop - 6.0, vTop - 0.5, v) * step(0.5, fract(vSeed * 3.1));
          totalEmissiveRadiance += crown * mix(vec3(0.6, 0.8, 1.0), vec3(1.0, 0.85, 0.6), fract(vSeed * 5.3)) * 1.4;
          diffuseColor.rgb *= mix(1.0, 0.55, wall * win * (1.0 - far));
        }`);
  };
  return mat;
}

export function buildCity(scene, city) {
  const group = new THREE.Group();
  scene.add(group);

  // ground
  const ground = new THREE.Mesh(new THREE.CircleGeometry(9000, 64),
    new THREE.MeshStandardMaterial({ color: 0x10131b, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  group.add(ground);

  // parks
  const parks = new THREE.Mesh(flatPolys(city.parks, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x0f261a, roughness: 1, emissive: 0x04100a }));
  group.add(parks);

  // roads: flat ribbons
  const roadPos = [];
  for (const r of city.roads) {
    const p = r.p, hw = r.w / 2;
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

  // buildings
  const geos = [], domes = [], beacons = [];
  const tint = new THREE.Color();
  city.buildings.forEach((b, idx) => {
    if (b.dome) { domes.push(b); return; }
    const shape = ringToShape(b.p);
    if (Math.abs(THREE.ShapeUtils.area(shape.getPoints())) < 6) return;
    const minh = b.m || 0;
    const g = new THREE.ExtrudeGeometry(shape, { depth: b.h - minh, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    g.translate(0, minh, 0);
    g.deleteAttribute('uv');
    const n = g.attributes.position.count;
    const seed = ((idx * 9301 + 49297) % 233280) / 233280;
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(new Float32Array(n).fill(seed), 1));
    g.setAttribute('aTop', new THREE.Float32BufferAttribute(new Float32Array(n).fill(b.h), 1));
    // slate/blue-grey glass palette, a touch warmer for low-rise heritage blocks
    if (b.h > 60) tint.setHSL(0.6 + seed * 0.05, 0.22, 0.12 + seed * 0.07);
    else tint.setHSL(0.07 + seed * 0.5, 0.08, 0.11 + seed * 0.07);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = tint.r; col[i * 3 + 1] = tint.g; col[i * 3 + 2] = tint.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geos.push(g);
    if (b.h > 110) {
      let cx = 0, cy = 0;
      for (let i = 0; i < b.p.length; i += 2) { cx += b.p[i]; cy += b.p[i + 1]; }
      beacons.push(new THREE.Vector3(cx / (b.p.length / 2), b.h + 3, -cy / (b.p.length / 2)));
    }
  });
  const merged = fixNormals(mergeGeometries(geos));
  const buildings = new THREE.Mesh(merged, buildingMaterial());
  group.add(buildings);

  // aircraft warning beacons on towers
  const bGeo = new THREE.SphereGeometry(1.4, 8, 6);
  const bMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.15, 0.1) });
  const bInst = new THREE.InstancedMesh(bGeo, bMat, beacons.length);
  const m4 = new THREE.Matrix4();
  beacons.forEach((p, i) => bInst.setMatrixAt(i, m4.makeTranslation(p.x, p.y, p.z)));
  group.add(bInst);

  // Esplanade "durian" domes
  for (const b of domes) group.add(makeDome(b));

  // Marina Bay Sands SkyPark across the three towers
  const towers = city.buildings.filter(b => /^Marina Bay Sands Tower/.test(b.n || ''))
    .sort((a, b) => a.n.localeCompare(b.n));
  if (towers.length === 3) group.add(makeSkyPark(towers));

  for (const lm of city.landmarks) if (lm.type === 'flyer') group.add(makeFlyer(lm));

  return { group, beacons: bInst };
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
      void main(){
        vec2 w = vW.xz;
        vec2 ripple = vec2(sin(w.x*0.09 + time*0.9) + sin(w.y*0.13 - time*0.7),
                           cos(w.y*0.07 + time*0.6) + sin(w.x*0.11 + w.y*0.05 + time)) * 0.0006;
        vec4 uv = vUv; uv.xy += ripple * uv.w;
        vec3 refl = texture2DProj(tDiffuse, uv).rgb;
        vec3 base = vec3(0.008, 0.02, 0.04);
        vec3 c = base + refl * color;
        float fog = 1.0 - exp(-pow(vDepth * 0.00028, 2.0));
        gl_FragColor = vec4(mix(c, fogColor, fog), 1.0);
        #include <colorspace_fragment>
      }`,
  };
  const water = new Reflector(geo, {
    textureWidth: size.x * 0.5, textureHeight: size.y * 0.5, color: 0x8a96b0, clipBias: 0.003, shader,
  });
  water.position.y = 0.01;
  scene.add(water);
  return water;
}

function makeDome(b) {
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (let i = 0; i < b.p.length; i += 2) {
    minx = Math.min(minx, b.p[i]); maxx = Math.max(maxx, b.p[i]);
    miny = Math.min(miny, b.p[i + 1]); maxy = Math.max(maxy, b.p[i + 1]);
  }
  const geo = new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: 0x8c7f6c, metalness: 0.6, roughness: 0.35 });
  mat.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = position;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vLocal;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float a = atan(vLocal.z, vLocal.x) * 24.0 / 3.14159;
        float e = asin(clamp(vLocal.y, 0.0, 1.0)) * 16.0;
        vec2 f = fract(vec2(a + e * 0.5, e));
        float tri = step(abs(f.x - 0.5) * 2.0, f.y);
        diffuseColor.rgb *= mix(0.45, 1.1, tri);
        totalEmissiveRadiance += vec3(1.0, 0.75, 0.45) * (1.0 - tri) * 0.12 * smoothstep(0.0, 0.3, vLocal.y);`);
  };
  const m = new THREE.Mesh(geo, mat);
  m.scale.set((maxx - minx) / 2, b.h, (maxy - miny) / 2);
  m.position.set((minx + maxx) / 2, 0, -(miny + maxy) / 2);
  return m;
}

function centroid(flat) {
  let x = 0, y = 0;
  for (let i = 0; i < flat.length; i += 2) { x += flat[i]; y += flat[i + 1]; }
  return new THREE.Vector2(x / (flat.length / 2), y / (flat.length / 2));
}

function makeSkyPark(towers) {
  const c = towers.map(t => centroid(t.p));
  const a = c[0], b = c[2];
  const dir = new THREE.Vector2().subVectors(b, a);
  const len = dir.length();
  const mid = new THREE.Vector2().addVectors(a, b).multiplyScalar(0.5);
  const g = new THREE.Group();
  // hull: a long, slightly tapered boat
  const shape = new THREE.Shape();
  const L = len + 140, W = 38;
  shape.moveTo(-L / 2, -W / 2 * 0.8);
  shape.lineTo(L / 2 - 30, -W / 2);
  shape.quadraticCurveTo(L / 2 + 10, 0, L / 2 - 30, W / 2);
  shape.lineTo(-L / 2, W / 2 * 0.8);
  shape.lineTo(-L / 2, -W / 2 * 0.8);
  const hull = new THREE.ExtrudeGeometry(shape, { depth: 9, bevelEnabled: false });
  hull.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: 0x3a4250, metalness: 0.7, roughness: 0.3, emissive: 0x0a0d14 });
  const mesh = new THREE.Mesh(hull, mat);
  g.add(mesh);
  // glowing underside strip
  const strip = new THREE.Mesh(new THREE.BoxGeometry(L - 40, 0.6, 2),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(1.1, 0.95, 0.8) }));
  strip.position.set(-10, 0.2, W / 2 * 0.85);
  g.add(strip);
  const strip2 = strip.clone(); strip2.position.z = -W / 2 * 0.85; g.add(strip2);
  // the pool line on top
  const pool = new THREE.Mesh(new THREE.BoxGeometry(150, 0.4, 5),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 1.2, 2.0) }));
  pool.position.set(L / 2 - 120, 9.3, W / 2 - 6);
  g.add(pool);
  g.position.set(mid.x, 193, -mid.y);
  // shape x-axis along the towers; extrusion is in local frame (x, -y)
  g.rotation.y = Math.atan2(dir.y, dir.x);
  // cantilever pointing north (toward tower 1's far side)
  return g;
}

function makeFlyer(lm) {
  const g = new THREE.Group();
  const R = 75, H = 165;
  const cy = H - R;
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xb8c2d0, metalness: 0.8, roughness: 0.3 });
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.95, 1.8) });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.9, 8, 160), rimMat);
  rim.position.y = cy;
  const rimGlow = new THREE.Mesh(new THREE.TorusGeometry(R + 1.2, 0.35, 6, 160), glow);
  rimGlow.position.y = cy;
  const rimGlow2 = new THREE.Mesh(new THREE.TorusGeometry(R - 3, 0.3, 6, 160), glow);
  rimGlow2.position.y = cy;
  g.add(rim, rimGlow, rimGlow2);
  // spokes
  const spokeGeo = [];
  for (let i = 0; i < 28; i++) {
    const a = i / 28 * Math.PI * 2;
    const s = new THREE.CylinderGeometry(0.18, 0.18, R, 4);
    s.translate(0, R / 2, 0);
    s.rotateZ(a);
    s.translate(0, cy, 0);
    spokeGeo.push(s);
  }
  g.add(new THREE.Mesh(mergeGeometries(spokeGeo), new THREE.MeshBasicMaterial({ color: 0x6f7c90 })));
  // capsules
  const capGeo = new THREE.CapsuleGeometry(2.6, 6, 4, 12);
  capGeo.rotateX(Math.PI / 2);
  const caps = new THREE.InstancedMesh(capGeo,
    new THREE.MeshStandardMaterial({ color: 0x223040, emissive: new THREE.Color(0.9, 1.0, 1.2), emissiveIntensity: 0.8 }), 28);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 28; i++) {
    const a = i / 28 * Math.PI * 2 + 0.11;
    caps.setMatrixAt(i, m4.makeTranslation(Math.sin(a) * (R + 3), cy - Math.cos(a) * (R + 3), 0));
  }
  g.add(caps);
  // hub and A-frame legs
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 16, 16), rimMat);
  hub.rotation.x = Math.PI / 2; hub.position.y = cy;
  g.add(hub);
  for (const side of [-1, 1]) {
    for (const lean of [-1, 1]) {
      const legLen = Math.hypot(cy, 34);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.2, legLen, 8), rimMat);
      leg.position.set(lean * 17, cy / 2, side * 7);
      leg.rotation.z = lean * Math.atan2(34, cy);
      g.add(leg);
    }
  }
  // terminal building beneath
  const base = new THREE.Mesh(new THREE.BoxGeometry(150, 12, 40),
    new THREE.MeshStandardMaterial({ color: 0x252a35, emissive: 0x141820 }));
  base.position.set(0, 6, -40);
  g.add(base);
  g.position.set(lm.x, 0, -lm.y);
  g.rotation.y = lm.dir; // wheel plane along the long axis of the OSM footprint
  return g;
}
