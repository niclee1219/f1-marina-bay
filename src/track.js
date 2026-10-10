// Circuit geometry, sampled every ~2 m from the same smooth curve the cars are positioned on.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CROWD, HAZE } from './config.js';
import { sponsorAtlas, boardTexture, titleSponsor, BOARD_UV_GLSL, logoImage } from './sponsors.js';

const HALF = 7.0;           // half track width (m)
const LIFT = 0.18;          // track surface above ground
const WALL = HALF + 3.2;    // concrete wall offset
export const MAX_ZONES = 12; // shade zones the asphalt shader evaluates
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

// Material that tiles a different sponsor board every uv.x unit (cell hashed to a board).
function boardWallMaterial(atlas, front = true) {
  const mat = new THREE.MeshStandardMaterial({ map: atlas, emissiveMap: atlas, emissive: 0xffffff, emissiveIntensity: 0.32, roughness: 0.7, side: THREE.DoubleSide });
  mat.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\n${BOARD_UV_GLSL}\nconst bool uBoardsFront = ${front};`)
      .replace('#include <map_fragment>', `
        // boards face the track; the back of the wall is bare concrete
        float faceTrack = gl_FrontFacing == uBoardsFront ? 1.0 : 0.0;
        diffuseColor.rgb *= mix(vec3(0.42, 0.43, 0.45), texture2D(map, boardUv(vMapUv)).rgb, faceTrack);`)
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance *= mix(vec3(0.12), texture2D(emissiveMap, boardUv(vEmissiveMapUv)).rgb, faceTrack);');
  };
  mat.customProgramCacheKey = () => `boards-${front}`;
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
    // shade zones along the track (s0, s1, shade, feather), filled in by Bridges
    this.zoneUniform = { value: Array.from({ length: MAX_ZONES }, () => new THREE.Vector4(-1e6, -1e6, 1, 1)) };
    // [s0, s1] spans under an overhead deck (expressway viaducts), filled in by Bridges
    this.overhead = [];
  }

  // true when sample i lies under an overhead deck (plus a margin in metres)
  underDeck(i, margin = 6) {
    const s = (((i % this.n) + this.n) % this.n) * this.bin, L = this.length;
    return this.overhead.some(([a, b]) => [s, s + L, s - L].some(x => x > a - margin && x < b + margin));
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
      s.uniforms.uZones = this.zoneUniform;
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vTrackUv;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvTrackUv = uv;');
      s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
          varying vec2 vTrackUv; uniform vec4 uZones[${MAX_ZONES}];
          float zoneShade(float d){
            float v = 1.0;
            for (int k = 0; k < ${MAX_ZONES}; k++) {
              vec4 z = uZones[k];
              float w = smoothstep(z.x - z.w, z.x + z.w, d) * (1.0 - smoothstep(z.y - z.w, z.y + z.w, d));
              v = min(v, 1.0 - (1.0 - z.z) * w);
            }
            return v;
          }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float along = fract(vTrackUv.y / 32.0);
          float pa = (along - 0.5) * 3.2; float pool = exp(-pa * pa);   // (pow() of a negative base is NaN in GLSL)
          float side = 1.0 - smoothstep(0.0, 1.0, abs(vTrackUv.x - 0.5) * 2.0) * 0.45;
          totalEmissiveRadiance += vec3(0.07, 0.072, 0.08) * (0.55 + 1.0 * pool) * side;
          float px = (vTrackUv.x - 0.5) * 4.0; diffuseColor.rgb *= 1.0 - 0.2 * exp(-px * px);
          // bridge zones: the deck structure blocks part of the floodlighting
          float zs = zoneShade(vTrackUv.y);
          diffuseColor.rgb *= zs; totalEmissiveRadiance *= zs;`);
    };
    g.add(new THREE.Mesh(this.ribbon(-HALF, HALF, 0), asphalt));
    // painted verges up to the wall, as at Marina Bay: a yellow band on the track edge, a thin
    // white line, then Singapore blue (references/). uv.x runs inner -> outer edge of each ribbon.
    const verge = (flip) => {
      const t = canvasTex(256, 4, (c, w, h) => {
        const band = (a, b, col) => { c.fillStyle = col; c.fillRect(Math.round(a * w), 0, Math.ceil((b - a) * w), h); };
        band(0, 0.2, '#e8b923'); band(0.2, 0.26, '#f2f2f2'); band(0.26, 1, '#24379a');
      });
      t.wrapS = THREE.ClampToEdgeWrapping;
      if (flip) { t.repeat.x = -1; t.offset.x = 1; }
      return new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.07 });
    };
    g.add(new THREE.Mesh(this.ribbon(HALF, WALL, -0.03), verge(false)));
    g.add(new THREE.Mesh(this.ribbon(-WALL, -HALF, -0.03), verge(true)));

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
    // wall() front faces point toward +N, so the +N wall shows its boards on the back face
    const wallMat = boardWallMaterial(this.atlas, true), wallMatBack = boardWallMaterial(this.atlas, false);
    // boards keep the atlas cell's 4:1 shape on the 1.15 m wall
    const wallL = this.wall(WALL, 1.15, 0, 0, this.n, -1 / 4.6);
    const wallR = this.wall(-WALL, 1.15, 0, 0, this.n, 1 / 4.6);
    g.add(new THREE.Mesh(wallL, wallMatBack), new THREE.Mesh(wallR, wallMat));
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
    this.buildStartGantries(g);
    this.buildGantries(g);
    this.buildStart(g, race);
    this.buildPit(g, race);
    this.buildLanterns(g, this.pitSide || 1);
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

  // a row of sponsor boards (4:1 each) centred on the origin in the local xy plane
  boardRow(ids, h, bright = 1.4) {
    const row = new THREE.Group(), w = h * 4;
    ids.forEach((id, j) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ map: boardTexture(this.atlas, id), color: new THREE.Color(bright, bright, bright) }));
      m.position.x = (j - (ids.length - 1) / 2) * w;
      row.add(m);
    });
    return row;
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
    // (none under the expressway decks: those spans are lit from the deck soffit, see viaducts.js)
    const items = this.every(32, [1]).map((it, k) => ({ i: it.i, o: (k % 2 ? 1 : -1) * (WALL + 1.3) }))
      .filter(it => !this.underDeck(it.i));
    const poleGeo = new THREE.CylinderGeometry(0.22, 0.32, 11, 6).translate(0, 5.5, 0);
    const armGeo = new THREE.BoxGeometry(0.2, 0.2, 5.5).translate(0, 11, 2.75);
    this.instances(g, 'poles', mergeGeometries([poleGeo, armGeo]), new THREE.MeshStandardMaterial({ color: 0x3a3f4a, metalness: 0.6, roughness: 0.5 }), items);
    this.instances(g, 'heads', new THREE.BoxGeometry(2.6, 0.35, 1.2).translate(0, 10.8, 5.2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.15, 2.0) }), items);
    // light shafts in the humid night air under each head: brightest at the lamp, fading to the
    // ground and away near the camera (so onboard / chase views never flash through them)
    if (HAZE.shafts > 0) {
      const cone = new THREE.ConeGeometry(5.5, 10.4, 18, 1, true).translate(0, 10.6 - 5.2, 5.2);
      const shaftMat = new THREE.ShaderMaterial({
        uniforms: { c: { value: new THREE.Color(1.0, 0.95, 0.85).multiplyScalar(HAZE.shafts) } },
        vertexShader: `varying float vH; varying float vD;
          void main(){
            vH = uv.y;
            vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
            vD = -mv.z;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `uniform vec3 c; varying float vH; varying float vD;
          void main(){
            float a = pow(clamp(vH, 0.0, 1.0), 1.6) * smoothstep(6.0, 40.0, vD) * (1.0 - smoothstep(900.0, 2500.0, vD));
            gl_FragColor = vec4(c * a, 1.0);
          }`,
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
      });
      this.instances(g, 'shafts', cone, shaftMat, items);
    }
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

  // A banner gantry spanning the track at sample i. draw(ctx, w, h) paints the banner face.
  bannerGantry(g, i, draw, height = 9) {
    const p = this.P[i], t = this.T[i], span = WALL * 2 + 3;
    const gr = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0x23262d, metalness: 0.7, roughness: 0.4 });
    gr.add(new THREE.Mesh(new THREE.BoxGeometry(span, 3.4, 1.4).translate(0, height, 0), steel));
    for (const sgn of [-1, 1]) gr.add(new THREE.Mesh(new THREE.BoxGeometry(0.8, height + 1.7, 0.8).translate(sgn * (span / 2 - 0.4), (height + 1.7) / 2, 0), steel));
    // canvas in the banner's proportions, so lettering isn't squashed
    const tex = canvasTex(Math.round(256 * (span - 2) / 3), 256, draw, false);
    const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.75, roughness: 0.6 });
    for (const face of [-1, 1]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(span - 2, 3.0), mat);
      m.position.set(0, height, face * 0.72);
      m.rotation.y = face > 0 ? 0 : Math.PI;
      gr.add(m);
    }
    gr.position.set(p.x, p.y - LIFT, p.z);
    gr.rotation.y = Math.atan2(-t.x, -t.z);
    g.add(gr);
  }

  buildStartGantries(g) {
    const at = s => Math.round((((s % this.length) + this.length) % this.length) / this.bin);
    // coral destination banner past the line (references/): the circled SG mark and a rounded
    // lowercase "singapore" wordmark in white, centred as one group
    this.bannerGantry(g, at(150), (c, w, h) => {
      c.fillStyle = '#ef4f4c'; c.fillRect(0, 0, w, h);
      c.fillStyle = c.strokeStyle = '#ffffff';
      c.textBaseline = 'middle';
      const word = 'singapore', wordFont = `700 ${Math.round(h * 0.6)}px "Comfortaa", "Titillium Web", sans-serif`;
      c.font = wordFont;
      const ww = c.measureText(word).width, r = h * 0.3, gap = h * 0.22;
      const x0 = (w - (2 * r + gap + ww)) / 2, cy = h * 0.5;
      c.lineWidth = h * 0.045;
      c.beginPath(); c.arc(x0 + r, cy, r, 0, Math.PI * 2); c.stroke();
      c.font = `700 ${Math.round(r * 0.95)}px "Comfortaa", "Titillium Web", sans-serif`;
      c.textAlign = 'center'; c.fillText('SG', x0 + r, cy + r * 0.04);
      c.font = wordFont;
      c.textAlign = 'left'; c.fillText(word, x0 + 2 * r + gap, cy - h * 0.04);
    }, 10);
    // Singapore Airlines over the run to the line, logo recoloured white on navy
    this.bannerGantry(g, at(-300), (c, w, h) => {
      c.fillStyle = '#13265f'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#f6b221'; c.fillRect(0, h - 14, w, 14);
      const img = logoImage('Singapore Airlines');
      if (img) {
        const ar = img.naturalWidth / img.naturalHeight, dh = h * 0.42, dw = Math.min(w * 0.8, dh * ar);
        const t = document.createElement('canvas'); t.width = Math.ceil(dw); t.height = Math.ceil(dw / ar);
        const tc = t.getContext('2d'); tc.drawImage(img, 0, 0, t.width, t.height);
        tc.globalCompositeOperation = 'source-in'; tc.fillStyle = '#ffffff'; tc.fillRect(0, 0, t.width, t.height);
        c.drawImage(t, (w - dw) / 2, (h - dw / ar) / 2 - 6, dw, dw / ar);
      } else {
        c.fillStyle = '#ffffff'; c.font = `700 ${Math.round(h * 0.4)}px "Titillium Web", sans-serif`;
        c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('SINGAPORE AIRLINES', w / 2, h / 2);
      }
    }, 8.5);
    this.specialGantries = [at(150), at(-300)];
  }

  // Glowing paper lanterns (orange, white, red) strung behind the grandstand side of the pit
  // straight, as in the race-night photos; they sway a little.
  buildLanterns(g, pitSide) {
    const items = [];
    const s0 = this.length - 420, s1 = this.length + 380;
    let k = 0;
    for (let s = s0; s < s1; s += 9, k++) {
      const i = Math.round((s % this.length) / this.bin) % this.n;
      for (const [o, h] of [[WALL + 30, 10.5], [WALL + 37, 8]]) {
        const p = this.at(i, -pitSide * o, h - LIFT);
        items.push({ p, c: [[2.3, 0.95, 0.32], [2.1, 2.0, 1.8], [2.3, 0.38, 0.25]][(k + (o > WALL + 33 ? 1 : 0)) % 3] });
      }
    }
    const geo = new THREE.SphereGeometry(0.75, 12, 8);
    const inst = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff }), items.length);
    const glowTex = canvasTex(64, 64, (c, w, h) => {
      const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.25)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = gr; c.fillRect(0, 0, w, h);
    }, false);
    const glows = new THREE.InstancedMesh(new THREE.PlaneGeometry(4.5, 4.5), new THREE.MeshBasicMaterial({
      map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }), items.length);
    const m4 = new THREE.Matrix4(), col = new THREE.Color();
    items.forEach((it, j) => {
      inst.setMatrixAt(j, m4.makeTranslation(it.p.x, it.p.y, it.p.z));
      inst.setColorAt(j, col.setRGB(...it.c));
      glows.setColorAt(j, col.setRGB(...it.c).multiplyScalar(0.28));
    });
    g.add(inst, glows);
    const q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3();
    let time = 0;
    this.animated.push(dt => {
      time += dt;
      // sway, and keep the glow cards facing the camera (they are flat quads)
      const cam = this.cameraRef;
      items.forEach((it, j) => {
        pos.copy(it.p); pos.y += Math.sin(time * 1.3 + j) * 0.15;
        m4.makeTranslation(pos.x, pos.y, pos.z); inst.setMatrixAt(j, m4);
        if (cam) q.copy(cam.quaternion);
        m4.compose(pos, q, one); glows.setMatrixAt(j, m4);
      });
      inst.instanceMatrix.needsUpdate = true; glows.instanceMatrix.needsUpdate = true;
    });
  }

  buildGantries(g) {
    // sponsor bridges over the straights, with an LED ticker on each face
    const picks = [];
    for (let i = 60; i < this.n - 60; i += 5) {
      let flat = true;
      for (let k = -14; k <= 14; k++) if (Math.abs(this.curv[(i + k) % this.n]) > 0.004) { flat = false; break; }
      const nearSpecial = (this.specialGantries || []).some(j => Math.min(Math.abs(j - i), this.n - Math.abs(j - i)) * this.bin < 160);
      if (flat && !nearSpecial && !this.underDeck(i, 30) && picks.every(p => Math.abs(p - i) > 280)) picks.push(i);
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
      const banner = this.boardRow([k * 2 + 1, k * 2 + 2], 1.7);
      for (const face of [-1, 1]) {
        const ban = banner.clone();
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
    // race name in the middle, title partner boards either side
    const signM = new THREE.Mesh(new THREE.PlaneGeometry(10.8, 1.3),
      new THREE.MeshBasicMaterial({ map: sign, color: new THREE.Color(1.4, 1.4, 1.4) }));
    const title = titleSponsor();
    for (const face of [-1, 1]) {
      const m = signM.clone();
      m.position.set(0, 7.5, face * 0.62); m.rotation.y = face > 0 ? 0 : Math.PI;
      gantry.add(m);
      for (const sx of [-1, 1]) {
        const b = this.boardRow([title], 1.3);
        b.position.set(sx * 8.1, 7.5, face * 0.62); b.rotation.y = face > 0 ? 0 : Math.PI;
        gantry.add(b);
      }
    }
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
    // which side of the start straight the pit lane is on (+1 = +N)
    this.pitSide = Math.sign(this.N[0].dot(new THREE.Vector3().subVectors(pts[pts.length >> 1], this.P[0]).setY(0))) || 1;
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
    // painted lines: white lane edges, and the blue / green bands between the fast lane (track
    // side) and the working lane in front of the garages
    const stripe = (o0, o1, col, lift = 0.02) => {
      const sp = [], si = [];
      frames.forEach((fr, k) => {
        const a0 = o0 * fr.side, a1 = o1 * fr.side;
        sp.push(fr.p.x + fr.nrm.x * a0, fr.y + lift, fr.p.z + fr.nrm.z * a0, fr.p.x + fr.nrm.x * a1, fr.y + lift, fr.p.z + fr.nrm.z * a1);
        if (k) { const q = (k - 1) * 2; si.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); }
      });
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
      sg.setIndex(si); sg.computeVertexNormals();
      g.add(new THREE.Mesh(sg, decal(new THREE.MeshStandardMaterial({ color: col, roughness: 0.7, emissive: new THREE.Color(col).multiplyScalar(0.25), side: THREE.DoubleSide }))));
    };
    stripe(W - 0.45, W - 0.2, 0xf2f2f2);
    stripe(-W + 0.2, -W + 0.45, 0xf2f2f2);
    stripe(-0.15, 0.55, 0x2f6fd6);
    stripe(-0.85, -0.15, 0x56b947);
    // the pit building itself is built in pit.js
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
    // painted crowd reads from the air; up close the instanced spectators (crowd.js) stand in front of it
    const seatMat = new THREE.MeshStandardMaterial({ map: crowd, emissive: 0xffffff, emissiveMap: crowd, emissiveIntensity: 0.45, roughness: 0.9 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x2c313c, metalness: 0.5, roughness: 0.45 });
    const lightMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.1, 1.9) });
    const plan = [[1, 90], [3, 70], [7, 80], [10, 70], [13, 60], [14, 80], [16, 70], [18, 80], [19, 60]];
    const placements = plan.map(([n, len]) => ({ i: this.corners.find(c => c.n === n)?.i, len, tag: n === 1 ? 'T1' : `T${n}` })).filter(p => p.i != null);
    placements.push({ i: Math.floor(this.n * 0.985), len: 110, side: 1, tag: 'pit' }); // opposite the pits
    // the Padang stand faces the track from the field side
    const pd = CROWD.padangStand;
    const pi = Math.round(pd.s / this.bin) % this.n;
    const toward = new THREE.Vector3(pd.toward[0], 0, -pd.toward[1]).sub(this.P[pi]);
    placements.push({ i: pi, len: pd.len, side: Math.sign(toward.dot(this.N[pi])) || 1, tag: 'padang' });
    this.stands = [];
    this.standInfo = [];
    placements.forEach((pl, k) => {
      const outside = pl.side ?? -(Math.sign(this.curv[pl.i]) || 1);
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
      const fascia = this.boardRow(Array.from({ length: Math.floor(len * 0.7 / 4.8) }, (_, j) => k * 3 + j), 1.2, 1.3);
      fascia.position.set(-3.6, top + 4.6, 0);
      fascia.rotation.y = -Math.PI / 2;
      st.add(fascia);
      st.position.set(p.x, this.P[pl.i].y - LIFT, p.z);
      // local +x points away from the track
      st.rotation.y = Math.atan2(-nrm.z * outside, nrm.x * outside);
      g.add(st);
      st.updateMatrixWorld(true);
      this.standInfo.push({ group: st, rows, len, tag: pl.tag });
    });
  }

  update(dt) { for (const f of this.animated) f(dt); }

  setStartLights(n) {
    this.startLights.forEach((m, k) => m.color.setRGB(k < n ? 6 : 0.15, 0, 0));
  }
}
