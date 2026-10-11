// Pit crews for race stops (race.pitLane.stops: when the car came to rest in its box and the OpenF1
// stop_duration). The crew waits at the garage line, runs out as the car arrives, works for the
// recorded stop time (wheel guns on all four corners, front and rear jacks under the car) and walks
// back. Instanced figures in team colours; only built on the 'high' quality level.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PIT_LANE } from './config.js';
import { QUALITY } from './quality.js';

const glowTex = () => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
};
const rand = (n) => { const v = Math.sin(n * 127.1) * 43758.5453; return v - Math.floor(v); };

const OUT = 2.5, BACK = 2.6, PRE = 6, POST = 5;   // run out / walk back (s), visible before / after
// waiting spot: just inside the garage door, measured from the box centre (where the car stops)
const WAIT = PIT_LANE.garage - (PIT_LANE.fast + PIT_LANE.garage) / 2 + 0.6;
// stations around the car, in car-local metres: [along (+ = nose), across (+ = garage side), kneel, role]
const STATIONS = [];
for (const [along, nm] of [[1.8, 'f'], [-1.8, 'r']]) {
  for (const s of [-1, 1]) {
    STATIONS.push([along, s * 1.45, 1, 'gun']);                 // wheel gun, kneeling at the wheel
    STATIONS.push([along + 0.75, s * 1.75, 0, 'off']);          // tyre off
    STATIONS.push([along - 0.75, s * 1.85, 0, 'on']);           // tyre on
  }
}
STATIONS.push([3.6, 0, 0, 'jackF'], [-3.4, 0, 0, 'jackR'], [0.2, 1.4, 0, 'stab'], [0.2, -1.4, 0, 'stab']);
STATIONS.push([4.9, 0.3, 0, 'lolli'], [2.6, 3.2, 0, 'crew'], [-2.6, 3.2, 0, 'crew']);   // signal board at the nose, mechanics standing by
const PER = STATIONS.length;

export class PitCrew {
  constructor(scene, race, track) {
    this.stops = (race.pitLane && race.pitLane.stops) || [];
    this.enabled = QUALITY.crew && this.stops.length > 0 && !!track.lane;
    if (!this.enabled) return;
    this.race = race; this.L = track.lane;
    // where each stop happens: the car's position (after the box shift) and the lane direction
    const o = [0, 0, 0, 0];
    for (const st of this.stops) {
      race.pos(st.k, st.t0 + 0.3, o);
      const p = new THREE.Vector3(o[0], 0, -o[1]);
      const { i } = track.nearest(p.x, p.z);
      p.y = track.P[i].y - 0.18;
      const fr = this.L.frame(st.u);
      st.p = p; st.t = fr.t.clone(); st.g = fr.g.clone();
      st.color = new THREE.Color(race.drivers[st.k].color);
    }
    const maxLive = this.maxConcurrent() * PER;
    const legs = new THREE.BoxGeometry(0.36, 0.8, 0.24).translate(0, 0.4, 0);
    const body = new THREE.BoxGeometry(0.46, 0.66, 0.3).translate(0, 1.13, 0);
    const head = new THREE.SphereGeometry(0.15, 10, 8).translate(0, 1.62, 0);
    this.legs = new THREE.InstancedMesh(legs, new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.8 }), maxLive);
    this.body = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ roughness: 0.7, emissive: 0x111111 }), maxLive);
    this.head = new THREE.InstancedMesh(head, new THREE.MeshStandardMaterial({ color: 0xe9eaee, roughness: 0.3, metalness: 0.2 }), maxLive);
    // wheel gun (held at the hub) and the jacks
    const gun = mergeGeometries([new THREE.CylinderGeometry(0.07, 0.07, 0.45, 8).rotateX(Math.PI / 2).translate(0, 0.42, 0.42), new THREE.BoxGeometry(0.08, 0.25, 0.08).translate(0, 0.3, 0.3)]);
    const jack = mergeGeometries([new THREE.BoxGeometry(0.12, 0.12, 1.4).rotateX(-0.45).translate(0, 0.55, 0.6), new THREE.BoxGeometry(0.7, 0.15, 0.3).translate(0, 0.1, 1.25)]);
    this.guns = new THREE.InstancedMesh(gun, new THREE.MeshStandardMaterial({ color: 0x2c2f36, metalness: 0.7, roughness: 0.35 }), maxLive);
    this.jacks = new THREE.InstancedMesh(jack, new THREE.MeshStandardMaterial({ color: 0xc9ccd3, metalness: 0.6, roughness: 0.4 }), maxLive);
    for (const m of [this.legs, this.body, this.head, this.guns, this.jacks]) {
      m.count = 0; m.frustumCulled = false; m.name = 'pit-crew';
      scene.add(m);
    }
    // machinery and lights: fresh tyre stacks (their top ring in the new compound's colour), the signal
    // board at the nose (red while the car is on the jacks, green on release), work-light stands with
    // glow, and sparks from the wheel guns
    const live = this.maxConcurrent();
    const tyre = new THREE.CylinderGeometry(0.33, 0.33, 0.38, 18);
    const ring = new THREE.RingGeometry(0.18, 0.3, 18).rotateX(-Math.PI / 2).translate(0, 0.192, 0);
    this.stackTyres = new THREE.InstancedMesh(tyre, new THREE.MeshStandardMaterial({ color: 0x3b3d43, roughness: 0.85 }), live * 4);
    this.stackBands = new THREE.InstancedMesh(ring, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), live * 4);
    const stand = mergeGeometries([new THREE.BoxGeometry(0.06, 2.4, 0.06).translate(0, 1.2, 0), new THREE.BoxGeometry(0.5, 0.06, 0.5).translate(0, 0.03, 0),
      new THREE.BoxGeometry(0.8, 0.5, 0.08).translate(0, 2.5, 0.0)]);
    this.stands = new THREE.InstancedMesh(stand, new THREE.MeshStandardMaterial({ color: 0x2c2f36, metalness: 0.5, roughness: 0.5 }), live * 2);
    const panel = new THREE.PlaneGeometry(0.72, 0.42).translate(0, 2.5, 0.045);
    this.panels = new THREE.InstancedMesh(panel, new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 3.1, 2.8), toneMapped: false }), live * 2);
    const board = mergeGeometries([new THREE.BoxGeometry(0.04, 1.9, 0.04).translate(0, 0.95, 0), new THREE.BoxGeometry(0.55, 0.4, 0.04).translate(0, 2.05, 0)]);
    this.boards = new THREE.InstancedMesh(board, new THREE.MeshBasicMaterial({ toneMapped: false }), live);
    for (const m of [this.stackTyres, this.stackBands, this.stands, this.panels, this.boards]) { m.count = 0; m.frustumCulled = false; m.name = 'pit-crew'; scene.add(m); }
    const pts = (max, size, color) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
      const o = new THREE.Points(g, new THREE.PointsMaterial({ map: glowTex(), size, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color, toneMapped: false }));
      o.frustumCulled = false; o.name = 'pit-crew'; g.setDrawRange(0, 0); scene.add(o); return o;
    };
    this.oldTyres = new THREE.InstancedMesh(tyre, new THREE.MeshStandardMaterial({ color: 0x2f3136, roughness: 0.9 }), live * 4);
    this.oldBands = new THREE.InstancedMesh(ring, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), live * 4);
    for (const m of [this.oldTyres, this.oldBands]) { m.count = 0; m.frustumCulled = false; m.name = 'pit-crew'; scene.add(m); }
    this.glow = pts(live * 2, 3.4, new THREE.Color(1, 0.93, 0.8));
    this.sparks = pts(live * 4, 0.7, new THREE.Color(1, 0.62, 0.2));
    for (const st of this.stops) {
      const ty = race.tyre(st.k, st.t1 + 1);
      const was = race.tyre(st.k, st.t0 - 1);
      st.oldColor = new THREE.Color(((was && { SOFT: '#ff2d2c', MEDIUM: '#ffd12e', HARD: '#f0f0ec', INTERMEDIATE: '#43b047', WET: '#0090ff' }[was.comp]) || '#f0f0ec'));
      st.newColor = new THREE.Color(((ty && { SOFT: '#ff2d2c', MEDIUM: '#ffd12e', HARD: '#f0f0ec', INTERMEDIATE: '#43b047', WET: '#0090ff' }[ty.comp]) || '#f0f0ec'));
    }
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.v = new THREE.Vector3(); this.s = new THREE.Vector3();
  }

  maxConcurrent() {
    let best = 1;
    for (const a of this.stops) best = Math.max(best, this.stops.filter(b => b.t0 - PRE < a.t1 + POST && b.t1 + POST > a.t0 - PRE).length);
    return best;
  }

  update(t) {
    if (!this.enabled) return;
    let n = 0, ng = 0, nj = 0, nt = 0, ns = 0, nb = 0, nl = 0, nsp = 0, no = 0;
    const gp = this.glow.geometry.attributes.position, sp = this.sparks.geometry.attributes.position;
    const { m, q, v, s } = this, up = new THREE.Vector3(0, 1, 0);
    for (const st of this.stops) {
      if (t < st.t0 - PRE || t > st.t1 + POST) continue;
      // 0 at the garage line .. 1 at the station
      const k = t < st.t0 ? THREE.MathUtils.smoothstep(t, st.t0 - OUT, st.t0 - 0.2)
        : t > st.t1 ? 1 - THREE.MathUtils.smoothstep(t, st.t1 + 0.4, st.t1 + BACK) : 1;
      const working = t >= st.t0 && t <= st.t1;
      const yawCar = Math.atan2(st.t.x, st.t.z);
      STATIONS.forEach(([along, across, kneel, role], j) => {
        // station in world space (across: toward the garages)
        const sx = st.p.x + st.t.x * along + st.g.x * across, sz = st.p.z + st.t.z * along + st.g.z * across;
        // waiting spot on the garage line, spread along the box
        const wx = st.p.x + st.t.x * (along * 0.8) + st.g.x * WAIT + st.g.x * (j % 3) * 0.6;
        const wz = st.p.z + st.t.z * (along * 0.8) + st.g.z * WAIT + st.g.z * (j % 3) * 0.6;
        v.set(wx + (sx - wx) * k, st.p.y, wz + (sz - wz) * k);
        // face the car at the station, the garage while walking back
        const toCar = Math.atan2(st.p.x + st.t.x * along - v.x, st.p.z + st.t.z * along - v.z);
        const yaw = role === 'jackF' ? yawCar + Math.PI : role === 'jackR' ? yawCar : (across === 0 ? yawCar : toCar);
        q.setFromAxisAngle(up, yaw);
        const kn = kneel && k > 0.95 ? 0.62 : 1;
        s.set(1, kn, 1);
        m.compose(v, q, s);
        this.legs.setMatrixAt(n, m); this.body.setMatrixAt(n, m); this.head.setMatrixAt(n, m);
        this.body.setColorAt(n, st.color);
        if (role === 'gun') {
          // a little rattle on the gun while the wheel is off
          const jig = working ? Math.sin(t * 60 + j) * 0.01 : 0;
          v.y += jig;
          m.compose(v, q, s);
          this.guns.setMatrixAt(ng++, m);
        }
        if (role === 'jackF' || role === 'jackR') this.jacks.setMatrixAt(nj++, m);
        if (role === 'lolli') {
          // signal board held up in front of the car: red until the car is released, then green
          m.compose(v, q, s.set(1, 1, 1));
          this.boards.setMatrixAt(nb, m);
          this.boards.setColorAt(nb++, t < st.t1 - 0.25 ? new THREE.Color(4, 0.15, 0.1) : new THREE.Color(0.2, 3, 0.4));
          s.set(1, kn, 1);
        }
        if (role === 'gun' && working && rand(Math.floor(t * 22) + j * 7.3 + st.k) > 0.35) {
          // a flash of sparks at the hub as the gun runs
          const k2 = nsp++;
          sp.setXYZ(k2, st.p.x + st.t.x * along + st.g.x * across * 0.72 + (rand(t * 90 + j) - 0.5) * 0.25, st.p.y + 0.35 + rand(t * 70 + j) * 0.2, st.p.z + st.t.z * along + st.g.z * across * 0.72 + (rand(t * 50 + j) - 0.5) * 0.25);
        }
        n++;
      });
      // tyre stacks on the garage side (the compound about to go on shows in the top ring): the tyres travel
      // to the hubs as the old ones come off, and are on the car by the middle of the stop; the old ones drop beside it
      const D = st.t1 - st.t0, tOn = st.t0 + D * 0.55, tOff = st.t0 + 0.9;
      const WH = [[1.8, 0.9], [1.8, -0.9], [-1.8, 0.9], [-1.8, -0.9]];
      [[2.4, 0], [2.4, 1], [-2.4, 0], [-2.4, 1]].forEach(([al, lv], j) => {
        if (t >= tOn || nt >= this.stackTyres.instanceMatrix.count) return;
        const kk = THREE.MathUtils.smoothstep(t, st.t0 + D * 0.22, tOn);
        const [wa, wc] = WH[j];
        const ax = al + (wa - al) * kk, ac = 4.1 + (wc - 4.1) * kk, yy = 0.19 + lv * 0.4 * (1 - kk) + 0.17 * kk;
        v.set(st.p.x + st.t.x * ax + st.g.x * ac, st.p.y + yy, st.p.z + st.t.z * ax + st.g.z * ac);
        m.compose(v, q.identity(), s.set(1, 1, 1));
        this.stackTyres.setMatrixAt(nt, m); this.stackBands.setMatrixAt(nt, m); this.stackBands.setColorAt(nt, st.newColor); nt++;
      });
      if (t >= tOff && working || t > st.t1) {
        WH.forEach(([wa, wc]) => {
          if (no >= this.oldTyres.instanceMatrix.count) return;
          const kk = THREE.MathUtils.smoothstep(t, tOff, tOff + 0.5), ac = wc * (1 + 1.35 * kk), yy = 0.36 - 0.17 * kk;
          v.set(st.p.x + st.t.x * wa + st.g.x * ac, st.p.y + yy, st.p.z + st.t.z * wa + st.g.z * ac);
          m.compose(v, q.identity(), s.set(1, 1, 1));
          this.oldTyres.setMatrixAt(no, m); this.oldBands.setMatrixAt(no, m); this.oldBands.setColorAt(no, st.oldColor); no++;
        });
      }
      // work lights: two stands either end of the box lighting the car, with glow
      for (const al of [4.2, -4.2]) {
        if (nl >= this.stands.instanceMatrix.count) break;
        v.set(st.p.x + st.t.x * al + st.g.x * 3.9, st.p.y, st.p.z + st.t.z * al + st.g.z * 3.9);
        q.setFromAxisAngle(up, Math.atan2(-st.g.x, -st.g.z));
        m.compose(v, q, s.set(1, 1, 1));
        this.stands.setMatrixAt(nl, m); this.panels.setMatrixAt(nl, m);
        const flick = working ? 0.92 + 0.08 * rand(Math.floor(t * 12) + nl) : 1;
        gp.setXYZ(nl, v.x - st.g.x * 0.3, v.y + 2.5, v.z - st.g.z * 0.3);
        nl++;
        void flick;
      }
    }
    this.sparks.geometry.setDrawRange(0, nsp); sp.needsUpdate = true;
    this.glow.geometry.setDrawRange(0, nl); gp.needsUpdate = true;
    for (const [mesh, c] of [[this.oldTyres, no], [this.oldBands, no], [this.stackTyres, nt], [this.stackBands, nt], [this.stands, nl], [this.panels, nl], [this.boards, nb]]) { mesh.count = c; mesh.instanceMatrix.needsUpdate = true; }
    if (this.stackBands.instanceColor) this.stackBands.instanceColor.needsUpdate = true;
    if (this.oldBands.instanceColor) this.oldBands.instanceColor.needsUpdate = true;
    if (this.boards.instanceColor) this.boards.instanceColor.needsUpdate = true;
    for (const [mesh, c] of [[this.legs, n], [this.body, n], [this.head, n], [this.guns, ng], [this.jacks, nj]]) {
      mesh.count = c;
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
  }
}
