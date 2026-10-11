// City traffic for atmosphere: cars, taxis and buses driving the roads around the circuit with
// headlights and tail lights, so the city reads as alive from the air (streams of white and red)
// and from trackside. Ground roads come from OSM (city.roads, the main ones only) and are cut
// wherever they come close to the circuit, which is closed for the race; traffic also runs on the
// elevated East Coast Parkway / Sheares decks (city.bridges) at their real deck height, over the
// track. Singapore drives on the left, one-way streets run in their OSM direction, cars stop at red
// signals (streets.js), and every road closed for the race is blocked with water-filled barriers
// where it meets the closure. Traffic runs in real time, independent of the replay clock.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { elevatedRoadKeys } from './viaducts.js';
import { CAR_PAINT } from './world.js';
import { TRAFFIC } from './config.js';

export class Traffic {
  constructor(scene, city, track, streets = null) {
    this.paths = [];
    this.streets = streets;
    const cuts = [];   // [x, z, road direction x, z, width] where an open road meets the closure
    // the circuit is closed for the race, and so is the paddock behind the pit building
    const closed = (x, z) => track.nearest(x, z).d < TRAFFIC.circuitGap || !!(track.inPaddock && track.inPaddock(x, z));
    const addPath = (pts, w, oneway = false) => {
      if (pts.length < 2) return;
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
      const len = cum[cum.length - 1];
      if (len > TRAFFIC.minPath) this.paths.push({ pts, cum, len, w, oneway, stops: [] });
    };
    // ground roads: densify to ~10 m, split where the circuit is (or where a viaduct replaces them)
    const elevated = elevatedRoadKeys(city);
    for (const r of city.roads) {
      if (r.w < TRAFFIC.minWidth || r.k === 'service') continue;
      // OSM (x, y north) -> scene (x, z = -y), every ~10 m along the way
      const dense = [];
      for (let i = 0; i < r.p.length; i += 2) {
        const x = r.p[i], y = r.p[i + 1], raised = elevated.has(`${Math.round(x)},${Math.round(y)}`);
        if (i) {
          const px = r.p[i - 2], py = r.p[i - 1], n = Math.ceil(Math.hypot(x - px, y - py) / 10);
          for (let k = 1; k < n; k++) dense.push([px + (x - px) * k / n, -(py + (y - py) * k / n), raised]);
        }
        dense.push([x, -y, raised]);
      }
      let run = [], wasClosed = false, prev = null;
      for (const [x, z, raised] of dense) {
        const shut = !raised && closed(x, z);
        if (raised || shut) {
          // barrier where the open road runs into the closure
          if (shut && !wasClosed && prev) cuts.push([prev[0], prev[1], x - prev[0], z - prev[1], r.w]);
          addPath(run, r.w, !!r.o); run = [];
        } else {
          if (wasClosed && prev) cuts.push([x, z, x - prev[0], z - prev[1], r.w]);
          run.push(new THREE.Vector3(x, 0.08, z));
        }
        wasClosed = shut; prev = [x, z];
      }
      addPath(run, r.w, !!r.o);
    }
    // expressway decks, with their deck height
    for (const w of city.bridges || []) {
      if (w.kind !== 'road') continue;
      const pts = [];
      for (let i = 0; i < w.p.length; i++) {
        const [x, y, h] = w.p[i];
        if (i) {
          const [px, py, ph] = w.p[i - 1], n = Math.max(1, Math.ceil(Math.hypot(x - px, y - py) / 10));
          for (let k = 1; k < n; k++) pts.push(new THREE.Vector3(px + (x - px) * k / n, ph + (h - ph) * k / n + 0.08, -(py + (y - py) * k / n)));
        }
        pts.push(new THREE.Vector3(x, h + 0.08, -y));
      }
      addPath(pts, w.w);
    }
    // where each ground path passes a signalled junction: distance along it and which signal axis
    if (streets) {
      streets.signals.forEach((g, gi) => {
        for (const p of this.paths) {
          for (let k = 0; k < p.pts.length; k++) {
            const a = p.pts[k];
            if (Math.abs(a.x - g.x) > 9 || Math.abs(a.z - g.z) > 9 || a.y > 1) continue;
            const b = p.pts[Math.min(p.pts.length - 1, k + 1)], c = p.pts[Math.max(0, k - 1)];
            const h = Math.atan2(b.x - c.x, b.z - c.z);
            p.stops.push({ s: p.cum[k], g: gi, axisA: Math.abs(Math.cos(h - g.axis)) > 0.707 });
            break;
          }
        }
      });
    }
    this.buildBarriers(scene, cuts);

    const total = this.paths.reduce((a, p) => a + p.len, 0);
    this.weights = [];
    let acc = 0;
    for (const p of this.paths) { acc += p.len; this.weights.push(acc / total); }

    // vehicles: one instanced body (cars, taxis and buses by scale and colour) and light pairs
    const n = Math.round(THREE.MathUtils.clamp(total / TRAFFIC.spacing, 60, TRAFFIC.max));
    const body = mergeGeometries([
      new THREE.BoxGeometry(1.8, 0.85, 4.4).translate(0, 0.62, 0),
      new THREE.BoxGeometry(1.6, 0.55, 2.2).translate(0, 1.32, -0.25),
    ]);
    const lamp = (z, x) => new THREE.BoxGeometry(0.34, 0.16, 0.06).translate(x, 0.78, z);
    this.body = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.55 }), n);
    this.heads = new THREE.InstancedMesh(mergeGeometries([lamp(2.22, -0.6), lamp(2.22, 0.6)]),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 3.0, 2.6) }), n);
    this.tails = new THREE.InstancedMesh(mergeGeometries([lamp(-2.22, -0.65), lamp(-2.22, 0.65)]),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.12, 0.08) }), n);
    for (const m of [this.body, this.heads, this.tails]) { m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); }

    this.v = [];
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const bus = Math.random() < TRAFFIC.buses, taxi = !bus && Math.random() < 0.18;
      const v = { bus, cruise: bus ? 8 + Math.random() * 3 : 10 + Math.random() * 7, lane: Math.random() < 0.5 ? 0 : 1 };
      v.speed = v.cruise;
      this.spawn(v, true);
      this.v.push(v);
      this.body.setColorAt(i, c.set(bus ? '#e8e8e2' : taxi ? (Math.random() < 0.5 ? '#2a6fdb' : '#f2c230') : CAR_PAINT[i % CAR_PAINT.length]));
    }
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.s = new THREE.Vector3(); this.p = new THREE.Vector3();
    this.update(0);
  }

  // red and white water-filled barriers across each road where it meets the race closure
  buildBarriers(scene, cuts) {
    if (!cuts.length) return;
    const items = [];
    for (const [x, z, dx, dz, w] of cuts) {
      const l = Math.hypot(dx, dz) || 1, tx = dx / l, tz = dz / l, n = Math.ceil((w + 2) / 2);
      for (let k = 0; k < n; k++) {
        const o = (k - (n - 1) / 2) * 2.0;
        items.push([x + tz * o, z - tx * o, Math.atan2(tx, tz), k % 2]);   // long side across the road
      }
    }
    const geo = new THREE.BoxGeometry(1.95, 0.9, 0.55).translate(0, 0.45, 0);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.5, emissive: 0x150505 }), items.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
    items.forEach(([x, z, a, red], i) => {
      mesh.setMatrixAt(i, m.compose(new THREE.Vector3(x, 0.05, z), q.setFromAxisAngle(up, a), new THREE.Vector3(1, 1, 1)));
      mesh.setColorAt(i, c.set(red ? '#c8202a' : '#e8e8e8'));
    });
    mesh.name = 'road-closures';
    scene.add(mesh);
    this.barrierCount = cuts.length;
  }

  // put a vehicle on a random road (length-weighted), anywhere along it at the start
  spawn(v, anywhere) {
    const r = Math.random();
    let lo = 0, hi = this.weights.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.weights[mid] < r) lo = mid + 1; else hi = mid; }
    v.path = this.paths[lo];
    v.dir = v.path.oneway || Math.random() < 0.5 ? 1 : -1;
    v.s = anywhere ? Math.random() * v.path.len : v.dir > 0 ? 0 : v.path.len;
    v.seg = 0;
  }

  update(dt) {
    const up = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3();
    for (let i = 0; i < this.v.length; i++) {
      const v = this.v[i];
      // red or amber signal ahead: brake to the stop line 8 m before the junction
      let want = v.cruise;
      if (this.streets && v.path.stops.length) {
        for (const st of v.path.stops) {
          const ds = (st.s - v.s) * v.dir - 8;
          if (ds < -1 || ds > 40) continue;
          const ph = this.streets.phase(st.g, st.axisA);
          if (ph === 2 || (ph === 1 && ds > 6)) want = Math.min(want, Math.max(0, ds) * 0.45);
        }
      }
      v.speed += (want - v.speed) * Math.min(1, dt * 2.5);
      if (v.speed < 0.05 && want === 0) v.speed = 0;
      v.s += v.dir * v.speed * dt;
      if (v.s < 0 || v.s > v.path.len) this.spawn(v, false);
      const { pts, cum, w } = v.path;
      // segment containing s (vehicles move a little each frame, so walk from the last one)
      let k = Math.min(v.seg, cum.length - 2);
      while (k > 0 && cum[k] > v.s) k--;
      while (k < cum.length - 2 && cum[k + 1] < v.s) k++;
      v.seg = k;
      const a = pts[k], b = pts[k + 1], f = (v.s - cum[k]) / Math.max(1e-6, cum[k + 1] - cum[k]);
      this.p.lerpVectors(a, b, f);
      d.subVectors(b, a).setY(0).normalize().multiplyScalar(v.dir);
      // keep left: offset to the left of the direction of travel, outer lane on wide roads
      const off = v.path.oneway ? w * (v.lane ? -0.15 : 0.2) : w * (w > 10 && v.lane ? 0.36 : 0.18);
      this.p.x += d.z * off; this.p.z -= d.x * off;
      this.q.setFromAxisAngle(up, Math.atan2(d.x, d.z));
      if (v.bus) this.s.set(1.4, 1.9, 2.7); else this.s.set(1, 1, 1);
      this.m.compose(this.p, this.q, this.s);
      this.body.setMatrixAt(i, this.m);
      this.heads.setMatrixAt(i, this.m);
      this.tails.setMatrixAt(i, this.m);
    }
    this.body.instanceMatrix.needsUpdate = this.heads.instanceMatrix.needsUpdate = this.tails.instanceMatrix.needsUpdate = true;
  }
}
