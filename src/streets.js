// Street furniture on the public roads (roads.js draws the surfaces): warm street lamps with their
// light pools, and working traffic signals at the junctions OSM tags highway=traffic_signals
// (city.signals, scripts/fetch_road_tags.py). Each junction runs a two-phase cycle, one phase per
// road axis; traffic.js stops at red. Everything is instanced: a handful of draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glowTexture } from './world.js';
import { QUALITY } from './quality.js';

export const SIGNAL = { cycle: 44, green: 19, amber: 3 };   // seconds; the other axis mirrors it
const LAMP = { every: 34, height: 8.5, clear: 18 };            // spacing, mast height, no lamps this close to the circuit

export class Streets {
  constructor(scene, city, track, elevated) {
    this.track = track;
    const up = new THREE.Vector3(0, 1, 0), m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
    // ---- street lamps: along the public roads, alternating sides, every LAMP.every metres
    const lamps = [];
    const every = QUALITY.level === 'high' ? LAMP.every : LAMP.every * 1.6;
    for (const r of city.roads) {
      if (r.k === 'service' || r.w < 7) continue;
      const p = r.p;
      let carry = every * 0.5, side = 1;
      for (let i = 2; i < p.length; i += 2) {
        const ax = p[i - 2], az = -p[i - 1], bx = p[i], bz = -p[i + 1];
        const L = Math.hypot(bx - ax, bz - az);
        if (!L) continue;
        const tx = (bx - ax) / L, tz = (bz - az) / L;
        for (let d = carry; d < L; d += every) {
          const x = ax + tx * d, z = az + tz * d;
          side = -side;
          if (elevated.has(`${Math.round(x)},${Math.round(-z)}`) || track.nearest(x, z).d < LAMP.clear) continue;
          const off = r.w / 2 + 1.2;
          // the arm (local +z) reaches back over the carriageway
          lamps.push([x - tz * off * side, z + tx * off * side, Math.atan2(tz * side, -tx * side)]);
        }
        carry = (carry - L) % every;
        if (carry < 0) carry += every;
      }
    }
    if (lamps.length) {
      const pole = mergeGeometries([
        new THREE.CylinderGeometry(0.09, 0.13, LAMP.height, 6).translate(0, LAMP.height / 2, 0),
        new THREE.BoxGeometry(0.1, 0.1, 2.2).translate(0, LAMP.height - 0.1, 1.0),
      ]);
      const poles = new THREE.InstancedMesh(pole, new THREE.MeshStandardMaterial({ color: 0x4a4f57, metalness: 0.5, roughness: 0.6 }), lamps.length);
      const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.45, 0.16, 0.9).translate(0, LAMP.height - 0.25, 1.9),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(2.3, 1.55, 0.7) }), lamps.length);
      // sodium-warm pool on the road, centred under the head
      const pools = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.12),
        new THREE.MeshBasicMaterial({ map: glowTexture(), color: new THREE.Color(0.15, 0.1, 0.042), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetUnits: -8 }),
        lamps.length);
      lamps.forEach(([x, z, a], i) => {
        q.setFromAxisAngle(up, a);
        m.compose(new THREE.Vector3(x, 0, z), q, s);
        poles.setMatrixAt(i, m); heads.setMatrixAt(i, m);
        const hx = x + Math.sin(a) * 1.9, hz = z + Math.cos(a) * 1.9;
        pools.setMatrixAt(i, new THREE.Matrix4().makeScale(14, 1, 14).setPosition(hx, 0.1, hz));
      });
      poles.name = 'street-lamps';
      scene.add(poles, heads, pools);
    }
    this.lampCount = lamps.length;

    // ---- traffic signals: a corner mast per junction with one head per road axis
    const segs = [];
    for (const r of city.roads) {
      if (r.k === 'service') continue;
      for (let i = 2; i < r.p.length; i += 2) segs.push([r.p[i - 2], -r.p[i - 1], r.p[i], -r.p[i + 1], r.w]);
    }
    this.signals = [];
    const sig = city.signals || [];
    for (let i = 0; i < sig.length; i += 2) {
      const x = sig[i], z = -sig[i + 1];
      if (track.nearest(x, z).d < 20) continue;   // junctions on the closed circuit are switched off
      let best = null, bd = 12;
      for (const [ax, az, bx, bz, w] of segs) {
        const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
        const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
        if (d < bd) { bd = d; best = { a: Math.atan2(dx, dz), w }; }
      }
      if (!best) continue;
      this.signals.push({ x, z, axis: best.a, w: best.w, offset: ((i * 7919) % 97) / 97 * SIGNAL.cycle });
    }
    const n = this.signals.length;
    if (n) {
      const mast = mergeGeometries([
        new THREE.CylinderGeometry(0.12, 0.14, 5.6, 6).translate(0, 2.8, 0),
        new THREE.BoxGeometry(0.4, 1.1, 0.35).translate(0, 4.9, 0),          // head, axis A
        new THREE.BoxGeometry(0.35, 1.1, 0.4).translate(0, 3.6, 0),          // head, axis B
      ]);
      this.masts = new THREE.InstancedMesh(mast, new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.6 }), n);
      // the lit lamp of each head: on both faces of the head, so it shows from either approach
      const lampA = mergeGeometries([new THREE.PlaneGeometry(0.3, 0.3).translate(0, 4.9, 0.18), new THREE.PlaneGeometry(0.3, 0.3).rotateY(Math.PI).translate(0, 4.9, -0.18)]);
      const lampB = mergeGeometries([new THREE.PlaneGeometry(0.3, 0.3).rotateY(Math.PI / 2).translate(0.21, 3.6, 0), new THREE.PlaneGeometry(0.3, 0.3).rotateY(-Math.PI / 2).translate(-0.21, 3.6, 0)]);
      const lm = () => new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
      this.lampsA = new THREE.InstancedMesh(lampA, lm(), n);
      this.lampsB = new THREE.InstancedMesh(lampB, lm(), n);
      this.signals.forEach((g, i) => {
        // on the corner of the junction, past the kerb
        const off = g.w / 2 + 1.5, cx = Math.sin(g.axis), cz = Math.cos(g.axis);
        q.setFromAxisAngle(up, g.axis);
        m.compose(new THREE.Vector3(g.x + (cx + cz) * off, 0, g.z + (cz - cx) * off), q, s);
        this.masts.setMatrixAt(i, m); this.lampsA.setMatrixAt(i, m); this.lampsB.setMatrixAt(i, m);
      });
      this.masts.name = 'traffic-signals';
      scene.add(this.masts, this.lampsA, this.lampsB);
    }
    this.time = 0;
    this.update(0);
  }

  // 0 green, 1 amber, 2 red, for road axis A (true) or B of signal i
  phase(i, axisA) {
    const g = this.signals[i], half = SIGNAL.cycle / 2;
    const t = ((this.time + g.offset) % SIGNAL.cycle + (axisA ? 0 : half)) % SIGNAL.cycle;
    return t < SIGNAL.green ? 0 : t < SIGNAL.green + SIGNAL.amber ? 1 : 2;
  }

  update(dt) {
    this.time += dt;
    if (!this.signals.length) return;
    const COL = [new THREE.Color(0.1, 2.6, 0.9), new THREE.Color(3, 1.5, 0.1), new THREE.Color(3.2, 0.12, 0.06)];
    for (let i = 0; i < this.signals.length; i++) {
      this.lampsA.setColorAt(i, COL[this.phase(i, true)]);
      this.lampsB.setColorAt(i, COL[this.phase(i, false)]);
    }
    this.lampsA.instanceColor.needsUpdate = this.lampsB.instanceColor.needsUpdate = true;
  }
}
