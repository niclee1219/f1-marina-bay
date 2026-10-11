// Pit crews for race stops (race.pitLane.stops: when the car came to rest in its box and the OpenF1
// stop_duration). The crew waits at the garage line, runs out as the car arrives, works for the
// recorded stop time (wheel guns on all four corners, front and rear jacks under the car) and walks
// back. Instanced figures in team colours; only built on the 'high' quality level.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PIT_LANE } from './config.js';
import { QUALITY } from './quality.js';

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
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.v = new THREE.Vector3(); this.s = new THREE.Vector3();
  }

  maxConcurrent() {
    let best = 1;
    for (const a of this.stops) best = Math.max(best, this.stops.filter(b => b.t0 - PRE < a.t1 + POST && b.t1 + POST > a.t0 - PRE).length);
    return best;
  }

  update(t) {
    if (!this.enabled) return;
    let n = 0, ng = 0, nj = 0;
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
        n++;
      });
    }
    for (const [mesh, c] of [[this.legs, n], [this.body, n], [this.head, n], [this.guns, ng], [this.jacks, nj]]) {
      mesh.count = c;
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
  }
}
