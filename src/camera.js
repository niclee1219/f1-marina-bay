// Camera director: free orbit, chase, onboard, helicopter and automatic trackside "TV" cuts.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export const MODES = ['orbit', 'tv', 'chase', 'onboard', 'heli'];
export const MODE_LABELS = { orbit: 'Free', tv: 'Broadcast', chase: 'Chase', onboard: 'Onboard', heli: 'Helicopter' };

export class Director {
  // heightAt(x, z, y): height of whatever stands at (x, z); y lets overhead decks block only their own slab
  constructor(camera, dom, track, heightAt = () => 0) {
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
      const sp = new THREE.Vector3(p.x + n.x * side * off, p.y + h, p.z + n.z * side * off);
      // skip spots inside a grandstand roof, or whose view of the track is blocked by a building
      if ((track.stands || []).some(s => Math.hypot(s.p.x - sp.x, s.p.z - sp.z) < s.r)) continue;
      let blocked = false;
      for (let a = -60; a <= 120 && !blocked; a += 20) {
        const q = track.P[(i + Math.round(a / track.bin) + track.n) % track.n];
        for (let f = 0; f <= 1; f += 0.1) {
          const x = sp.x + (q.x - sp.x) * f, z = sp.z + (q.z - sp.z) * f, y = sp.y + (q.y + 1 - sp.y) * f;
          if (heightAt(x, z, y) > y) { blocked = true; break; }
        }
      }
      if (blocked) continue;
      this.spots.push({ i, p: sp });
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
    this.camYaw = null;
    if (m === 'orbit') {
      this.camera.fov = 42;
      this.camera.updateProjectionMatrix();
    }
  }

  // Near plane follows the shot: tight for cockpit views, pushed out for wide aerials so the
  // painted lines and kerbs keep their depth precision (no z-fighting at range).
  setNear(near) {
    if (Math.abs(this.camera.near - near) > near * 0.05) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }
  }

  update(dt, focus, playing) {
    const cam = this.camera;
    this.speedFactor = 0;
    if (this.mode === 'orbit') {
      if (this.follow && focus) {
        // keep orbit centred on the focused car while still letting the user orbit
        const delta = focus.world.clone().sub(this.controls.target);
        this.controls.target.add(delta);
        cam.position.add(delta);
      }
      this.controls.update();
      this.setNear(THREE.MathUtils.clamp(cam.position.distanceTo(this.controls.target) * 0.004, 0.3, 12));
      return;
    }
    if (!focus) return;
    const p = focus.world;
    const speed = focus.tel ? focus.tel.speed : 0;
    const sp = Math.min(1, speed / 330);
    // heading smoothed a little more for the camera than for the car body
    const target = Math.atan2(focus.dir.x, focus.dir.z);
    if (this.first || this.camYaw == null) this.camYaw = target;
    let dy = target - this.camYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const k = this.mode === 'onboard' ? 1 - Math.pow(1e-5, dt) : 1 - Math.pow(1e-3, dt);
    this.camYaw += dy * k;
    const d = new THREE.Vector3(Math.sin(this.camYaw), 0, Math.cos(this.camYaw));
    this.time = (this.time || 0) + dt * (playing ? 1 : 0);
    let wantPos, wantLook, fov = 55, lerp = 1 - Math.pow(0.0005, dt);
    if (this.mode === 'chase') {
      wantPos = p.clone().addScaledVector(d, -7.4 - sp * 1.2).add(new THREE.Vector3(0, 2.3, 0));
      wantLook = p.clone().addScaledVector(d, 10).add(new THREE.Vector3(0, 0.8, 0));
      fov = 56 + sp * 14;
      lerp = 1;
      this.speedFactor = sp * 0.7;
      this.setNear(0.15);
    } else if (this.mode === 'onboard') {
      // T-cam above the airbox, rigidly mounted, with engine/kerb vibration that grows with speed
      const shake = (0.006 + sp * 0.02) * (playing ? 1 : 0);
      const t = this.time;
      const jitter = new THREE.Vector3(
        Math.sin(t * 61.3) * shake * 0.6,
        Math.sin(t * 73.1) * shake + Math.sin(t * 17.7) * shake * 0.5,
        0);
      wantPos = p.clone().addScaledVector(d, -0.55).add(new THREE.Vector3(0, 1.42, 0)).add(jitter);
      wantLook = p.clone().addScaledVector(d, 30).add(new THREE.Vector3(0, 0.35, 0)).add(jitter.multiplyScalar(4));
      fov = 64 + sp * 16;
      lerp = 1;
      this.speedFactor = sp;
      this.setNear(0.05);
    } else if (this.mode === 'heli') {
      const side = new THREE.Vector3(d.z, 0, -d.x);
      wantPos = p.clone().addScaledVector(d, -60).addScaledVector(side, 45).add(new THREE.Vector3(0, 110, 0));
      wantLook = p.clone().addScaledVector(d, 15);
      fov = 40;
      lerp = 1 - Math.pow(0.02, dt);
      this.setNear(2);
    } else if (this.mode === 'tv') {
      // cut to the trackside spot closest ahead of the car; zoom the lens to keep it framed
      const { i } = this.track.nearest(p.x, p.z);
      const n = this.track.n;
      let best = null, bestScore = Infinity;
      for (const s of this.spots) {
        const ahead = (s.i - i + n) % n;
        const score = ahead < 280 / this.track.bin ? ahead : Infinity; // within ~280 m ahead
        if (score < bestScore) { bestScore = score; best = s; }
      }
      if (!best) best = this.spots.reduce((a, s) => (s.p.distanceTo(p) < a.p.distanceTo(p) ? s : a));
      this.tvSince += dt;
      const dist = this.tvSpot ? this.tvSpot.p.distanceTo(p) : Infinity;
      if (!this.tvSpot || (best !== this.tvSpot && (dist > 90 || this.tvSince > 7))) {
        if (!(dist < 40 && this.tvSpot)) { this.tvSpot = best; this.tvSince = 0; this.first = true; }
      }
      wantPos = this.tvSpot.p;
      wantLook = p.clone().add(new THREE.Vector3(0, 0.8, 0));
      const dd = this.tvSpot.p.distanceTo(p);
      fov = THREE.MathUtils.clamp(2 * Math.atan(9 / Math.max(dd, 1)) * 180 / Math.PI * 2.2, 8, 60);
      lerp = 1;
      this.setNear(Math.min(2, dd * 0.05));
    }
    if (this.first) {
      this.pos.copy(wantPos); this.look.copy(wantLook); this.smoothFov = fov; this.first = false;
    } else {
      this.pos.lerp(wantPos, lerp);
      this.look.lerp(wantLook, this.mode === 'tv' ? 1 - Math.pow(0.00001, dt) : lerp);
      this.smoothFov += (fov - this.smoothFov) * (1 - Math.pow(0.05, dt));
    }
    cam.position.copy(this.pos);
    cam.lookAt(this.look);
    if (Math.abs(cam.fov - this.smoothFov) > 0.01) {
      cam.fov = this.smoothFov;
      cam.updateProjectionMatrix();
    }
  }
}
