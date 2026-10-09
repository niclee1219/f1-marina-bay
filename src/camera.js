// Camera director: free orbit, chase, onboard, helicopter and automatic trackside "TV" cuts.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export const MODES = ['orbit', 'tv', 'chase', 'onboard', 'heli'];
export const MODE_LABELS = { orbit: 'Free', tv: 'Broadcast', chase: 'Chase', onboard: 'Onboard', heli: 'Helicopter' };

export class Director {
  constructor(camera, dom, track) {
    this.camera = camera;
    this.track = track;
    this.controls = new OrbitControls(camera, dom);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 4500;
    this.mode = 'orbit';
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.tvSpot = null;
    this.tvSince = 0;
    this.smoothFov = camera.fov;
    // trackside camera spots every ~150 m, on alternating sides
    this.spots = [];
    const step = Math.round(150 / track.bin);
    for (let i = 0, k = 0; i < track.n; i += step, k++) {
      const side = k % 2 ? 1 : -1;
      const p = track.P[i], n = track.N[i];
      // high enough to look over the debris fence, like a gantry or crane camera
      const h = 13 + (k % 3) * 6;
      const off = 17 + (k % 2) * 8;
      this.spots.push({ i, p: new THREE.Vector3(p.x + n.x * side * off, p.y + h, p.z + n.z * side * off) });
    }
  }

  overview() {
    // Looking north-west over the bay: Marina Bay Sands foreground right, Flyer and the CBD behind.
    this.camera.position.set(400, 980, 1380);
    this.controls.target.set(-50, 0, -40);
    this.camera.fov = 42;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  setMode(m) {
    this.mode = m;
    this.controls.enabled = m === 'orbit';
    this.first = true;
    this.tvSpot = null;
    if (m === 'orbit') {
      this.camera.fov = 42;
      this.camera.updateProjectionMatrix();
    }
  }

  update(dt, focus, playing) {
    const cam = this.camera;
    if (this.mode === 'orbit') {
      if (this.follow && focus) {
        // keep orbit centred on the focused car while still letting the user orbit
        const delta = focus.world.clone().sub(this.controls.target);
        this.controls.target.add(delta);
        cam.position.add(delta);
      }
      this.controls.update();
      return;
    }
    if (!focus) return;
    const p = focus.world, d = focus.dir;
    let wantPos, wantLook, fov = 55, lerp = 1 - Math.pow(0.0005, dt);
    if (this.mode === 'chase') {
      wantPos = p.clone().addScaledVector(d, -7.8).add(new THREE.Vector3(0, 2.5, 0));
      wantLook = p.clone().addScaledVector(d, 9).add(new THREE.Vector3(0, 0.9, 0));
      fov = 58;
      lerp = 1 - Math.pow(0.00002, dt);
    } else if (this.mode === 'onboard') {
      wantPos = p.clone().addScaledVector(d, -0.55).add(new THREE.Vector3(0, 1.42, 0));
      wantLook = p.clone().addScaledVector(d, 30).add(new THREE.Vector3(0, 0.4, 0));
      fov = 66;
      lerp = 1;
    } else if (this.mode === 'heli') {
      const side = new THREE.Vector3(d.z, 0, -d.x);
      wantPos = p.clone().addScaledVector(d, -60).addScaledVector(side, 45).add(new THREE.Vector3(0, 110, 0));
      wantLook = p.clone().addScaledVector(d, 15);
      fov = 40;
      lerp = 1 - Math.pow(0.02, dt);
    } else if (this.mode === 'tv') {
      // cut to the trackside spot closest ahead of the car; zoom the lens to keep it framed
      const { i } = this.track.nearest(p.x, p.z);
      const n = this.track.n;
      let best = null, bestScore = Infinity;
      for (const s of this.spots) {
        const ahead = (s.i - i + n) % n;
        const score = ahead < 70 ? ahead : Infinity; // within ~280 m ahead
        if (score < bestScore) { bestScore = score; best = s; }
      }
      if (!best) best = this.spots.reduce((a, s) => (s.p.distanceTo(p) < a.p.distanceTo(p) ? s : a));
      this.tvSince += dt;
      const dist = this.tvSpot ? this.tvSpot.p.distanceTo(p) : Infinity;
      if (!this.tvSpot || (best !== this.tvSpot && (dist > 90 || this.tvSince > 7))) {
        if (dist < 40 && this.tvSpot) { /* car still close: keep shot */ } else {
          this.tvSpot = best; this.tvSince = 0; this.first = true;
        }
      }
      wantPos = this.tvSpot.p;
      wantLook = p.clone().add(new THREE.Vector3(0, 0.8, 0));
      const dd = this.tvSpot.p.distanceTo(p);
      fov = THREE.MathUtils.clamp(2 * Math.atan(9 / Math.max(dd, 1)) * 180 / Math.PI * 2.2, 8, 60);
      lerp = 1;
    }
    if (this.first) {
      this.pos.copy(wantPos); this.look.copy(wantLook); this.smoothFov = fov; this.first = false;
    } else {
      this.pos.lerp(wantPos, lerp);
      this.look.lerp(wantLook, this.mode === 'tv' ? 1 - Math.pow(0.00001, dt) : lerp);
      this.smoothFov += (fov - this.smoothFov) * (1 - Math.pow(0.02, dt));
    }
    cam.position.copy(this.pos);
    cam.lookAt(this.look);
    if (Math.abs(cam.fov - this.smoothFov) > 0.01) {
      cam.fov = this.smoothFov;
      cam.updateProjectionMatrix();
    }

  }
}
