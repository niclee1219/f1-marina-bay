// Spectators: one InstancedMesh per grandstand / walkway / deck (so each block frustum-culls and
// can be hidden at range). A single low-poly figure is animated in the vertex shader: idle sway,
// arms raised and waved, and phone torches that flash when cars pass the block.
import * as THREE from 'three';
import { CROWD } from './config.js';

const MAX_BLOCKS = 32;
const SKIN = ['#f1c9a5', '#e0ac85', '#c68c63', '#9c6b48', '#6f4a33', '#f5d6bd'];
const CLOTHES = ['#f4f4f4', '#151518', '#1f2a44', '#3a3f4a', '#b91c1c', '#e5e7eb', '#0f766e', '#ca8a04', '#7c3aed', '#9ca3af', '#1d4ed8', '#ef4444'];

// figure facing -x: body, head, two arms (hanging from the shoulders), phone in the right hand
function figure() {
  const parts = [];
  const add = (g, part) => {
    g = g.toNonIndexed();
    g.deleteAttribute('uv');
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(part), 1));
    parts.push(g);
  };
  add(new THREE.BoxGeometry(0.26, 1.36, 0.44).translate(0, 0.68, 0), 0);
  add(new THREE.BoxGeometry(0.2, 0.24, 0.19).translate(0, 1.5, 0), 1);
  add(new THREE.BoxGeometry(0.1, 0.62, 0.1).translate(0, 1.36 - 0.31, -0.28), 2);
  add(new THREE.BoxGeometry(0.1, 0.62, 0.1).translate(0, 1.36 - 0.31, 0.28), 3);
  add(new THREE.BoxGeometry(0.03, 0.14, 0.08).translate(-0.07, 1.36 - 0.6, 0.28), 4);
  const n = parts.reduce((a, g) => a + g.attributes.position.count, 0);
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), part = new Float32Array(n);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3);
    nrm.set(g.attributes.normal.array, o * 3);
    part.set(g.attributes.aPart.array, o);
    o += g.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('aPart', new THREE.BufferAttribute(part, 1));
  return g;
}

function crowdMaterial(uniforms) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aPart; attribute vec4 aInfo;
        uniform float uTime; uniform float uExcite[${MAX_BLOCKS}];
        varying float vPart; varying float vSkin; varying float vFlash;
        float chash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <begin_vertex>', `
        vec3 transformed = position;
        float seed = aInfo.x;
        float excite = uExcite[int(aInfo.y + 0.5)];
        float ph = seed * 6.2831;
        vPart = aPart; vSkin = aInfo.w;
        // idle: weight shifts and a little bounce when the cars come through
        transformed.y += (0.025 + 0.06 * excite) * max(0.0, sin(uTime * (2.0 + 3.0 * excite) + ph));
        transformed.z += 0.03 * sin(uTime * 0.7 + ph);
        if (aPart > 1.5) {
          float side = aPart < 2.5 ? -1.0 : 1.0;
          // some fans always have an arm up; everyone gets excited as cars pass
          float want = aInfo.z * (0.35 + 1.1 * excite) * (side > 0.0 ? 1.0 : step(0.55, fract(seed * 7.1)));
          float raise = clamp(want, 0.0, 1.0) * (0.78 + 0.22 * sin(uTime * (3.5 + seed * 2.0) + ph));
          float ang = -side * raise * 2.6;
          vec3 sh = vec3(0.0, 1.36, side * 0.28);
          vec3 q = transformed - sh;
          float c = cos(ang), sn = sin(ang);
          transformed = sh + vec3(q.x, c * q.y - sn * q.z, sn * q.y + c * q.z);
        }
        vFlash = aPart > 3.5 ? step(0.35, excite) * step(0.82, chash(vec2(seed * 91.0, floor(uTime * 7.0 + seed * 13.0)))) : 0.0;`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vPart; varying float vSkin; varying float vFlash;
        uniform vec3 uSkin[${SKIN.length}];`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (vPart > 0.5 && vPart < 3.5) diffuseColor.rgb = uSkin[int(vSkin + 0.5)];
        if (vPart > 3.5) diffuseColor.rgb = vec3(0.03);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // floodlight spill so the crowd reads at night, plus phone torches
        totalEmissiveRadiance += diffuseColor.rgb * 0.32 + vFlash * vec3(4.0, 4.0, 3.6);`);
  };
  return mat;
}

export class Crowd {
  constructor(scene, track, race, pitDecks = []) {
    this.track = track;
    this.blocks = [];
    this.uniforms = {
      uTime: { value: 0 },
      uExcite: { value: new Array(MAX_BLOCKS).fill(0) },
      uSkin: { value: SKIN.map(c => new THREE.Color(c)) },
    };
    this.geo = figure();
    this.mat = crowdMaterial(this.uniforms);
    const teamCols = [...new Set(race.drivers.map(d => d.color))];
    let seed = 1234;
    this.rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    this.pickColor = () => (this.rnd() < CROWD.teamShare
      ? teamCols[(this.rnd() * teamCols.length) | 0]
      : CLOTHES[(this.rnd() * CLOTHES.length) | 0]);

    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    // grandstands: one figure per seat on each tier, density by stand tag
    for (const s of track.standInfo || []) {
      const dens = CROWD.stands[s.tag] ?? CROWD.baseDensity;
      const items = [];
      for (let r = 0; r < s.rows; r++) {
        const y = 1.4 + r * 0.55, x = r * 0.85 + 0.35;
        for (let z = -s.len / 2 + 0.4; z < s.len / 2 - 0.4; z += 0.55) {
          if (this.rnd() > dens) continue;
          q.setFromAxisAngle(up, (this.rnd() - 0.5) * 0.35);
          m.compose(new THREE.Vector3(x, y, z + (this.rnd() - 0.5) * 0.12), q, new THREE.Vector3(1, 0.92 + this.rnd() * 0.16, 1));
          items.push(m.clone().premultiply(s.group.matrixWorld));
        }
      }
      this.addBlock(scene, items, s.group.getWorldPosition(new THREE.Vector3()), 0.45);
    }
    // walkways behind the fences
    for (const w of CROWD.walkways) {
      const ci = w.at === 'start' ? 0 : track.corners.find(c => c.n === w.at)?.i;
      if (ci == null) continue;
      const curvSign = Math.sign(track.curv[ci]) || 1;
      const side = w.at === 'start' ? (w.side === 'in' ? 1 : -1) : (w.side === 'out' ? -curvSign : curvSign);
      const items = [];
      const centre = new THREE.Vector3();
      const i0 = ci + Math.round(w.from / track.bin), i1 = ci + Math.round(w.to / track.bin);
      for (let i = i0; i <= i1; i++) {
        const k = ((i % track.n) + track.n) % track.n;
        const P = track.P[k], N = track.N[k];
        for (let row = 0; row < 3; row++) {
          for (let sub = 0; sub < 3; sub++) {
            if (this.rnd() > w.density * (1 - row * 0.2)) continue;
            const off = side * (10.2 + 3.2 + row * 0.9 + this.rnd() * 0.3);
            const along = (sub / 3 - 0.5) * track.bin;
            const T = track.T[k];
            const x = P.x + N.x * off + T.x * along, z = P.z + N.z * off + T.z * along;
            if ((track.stands || []).some(st => Math.hypot(st.p.x - x, st.p.z - z) < st.r - 8)) continue;
            // face the track: local -x toward -N*side
            const fx = -N.x * side, fz = -N.z * side;
            q.setFromAxisAngle(up, Math.atan2(fz, -fx) + (this.rnd() - 0.5) * 0.5);
            m.compose(new THREE.Vector3(x, P.y - 0.18, z), q, new THREE.Vector3(1, 0.92 + this.rnd() * 0.16, 1));
            items.push(m.clone());
            centre.x += x; centre.z += z;
          }
        }
      }
      if (items.length) this.addBlock(scene, items, centre.multiplyScalar(1 / items.length).setY(5), 0.35);
    }
    // pit-building decks
    for (const d of pitDecks) {
      const items = [];
      const c = Math.cos(d.angle), s = Math.sin(d.angle);
      const step = d.wid < 3 ? 0.7 : 1.1;
      for (let lx = -d.len / 2; lx < d.len / 2; lx += step) {
        for (let lz = -d.wid / 2; lz <= d.wid / 2; lz += step) {
          if (this.rnd() > d.density) continue;
          // local (lx, lz) -> world, matching skyline.toWorld (rotateY(angle))
          const x = d.x + lx * c + lz * s, z = d.z - lx * s + lz * c;
          q.setFromAxisAngle(up, d.angle + Math.PI / 2 + (this.rnd() - 0.5) * 1.2);
          m.compose(new THREE.Vector3(x + (this.rnd() - 0.5) * 0.3, d.y, z), q, new THREE.Vector3(1, 0.92 + this.rnd() * 0.16, 1));
          items.push(m.clone());
        }
      }
      this.addBlock(scene, items, new THREE.Vector3(d.x, d.y, d.z), 0.3);
    }
  }

  addBlock(scene, matrices, centre, waveShare) {
    if (!matrices.length || this.blocks.length >= MAX_BLOCKS) return;
    const k = this.blocks.length;
    const mesh = new THREE.InstancedMesh(this.geo.clone(), this.mat, matrices.length);
    const info = new Float32Array(matrices.length * 4);
    const col = new THREE.Color();
    matrices.forEach((mm, i) => {
      mesh.setMatrixAt(i, mm);
      mesh.setColorAt(i, col.set(this.pickColor()));
      info[i * 4] = this.rnd();
      info[i * 4 + 1] = k;
      info[i * 4 + 2] = this.rnd() < waveShare ? 0.6 + this.rnd() * 0.4 : this.rnd() * 0.25;
      info[i * 4 + 3] = (this.rnd() * SKIN.length) | 0;
    });
    mesh.geometry.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 4));
    mesh.computeBoundingSphere();
    mesh.name = 'crowd';
    scene.add(mesh);
    this.blocks.push({ mesh, centre, excite: 0 });
  }

  // cars: array of {world: Vector3}; camera position for range culling
  update(dt, cars, cameraPos) {
    this.uniforms.uTime.value += dt;
    const ex = this.uniforms.uExcite.value;
    this.blocks.forEach((b, k) => {
      const far = b.centre.distanceTo(cameraPos) > CROWD.maxDrawDistance;
      b.mesh.visible = !far;
      if (far) return;
      let d = Infinity;
      for (const c of cars) d = Math.min(d, (c.world.x - b.centre.x) ** 2 + (c.world.z - b.centre.z) ** 2);
      const want = THREE.MathUtils.smoothstep(-Math.sqrt(d), -160, -25);
      b.excite += (want - b.excite) * (1 - Math.exp(-(want > b.excite ? 4 : 0.8) * dt));
      ex[k] = b.excite;
    });
  }
}
