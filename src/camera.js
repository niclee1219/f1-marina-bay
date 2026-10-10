// Camera director: free orbit, chase, onboard, helicopter and automatic trackside "TV" cuts.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CAMERA } from './config.js';

export const MODES = ['orbit', 'tv', 'chase', 'onboard', 'heli'];
// Opening aerial shots (scene coordinates). `narrow` is used on portrait / phone screens.
export const OVERVIEW = {
  // the overhead TV shot: from the south-east, looking north up the pit straight; SINGAPORE reads
  // along the pit roof (one letter per roof bay), grid and lanterns beside it, the Flyer clear to the left
  wide: { pos: [700, 320, 240], target: [560, 0, -178], fov: 42 },
  // same shot for phones: wider lens, panned so the word sits between the timing tower and minimap
  narrow: { pos: [624, 380, 376], target: [484, 0, -74], fov: 55 },
};

export const MODE_LABELS = { orbit: 'Free', tv: 'Broadcast', chase: 'Chase', onboard: 'Onboard', heli: 'Helicopter' };

export class Director {
  // heightAt(x, z, y): height of whatever stands at (x, z); y lets overhead decks block only their own slab
  // surfaceAt(x, z): top of whatever is under the camera (roof, deck), for the free-camera near plane
  constructor(camera, dom, track, heightAt = () => 0, surfaceAt = () => 0) {
    this.surfaceAt = surfaceAt;
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
    const v = this.camera.aspect < 1 ? OVERVIEW.narrow : OVERVIEW.wide;
    this.camera.position.set(...v.pos);
    this.controls.target.set(...v.target);
    this.camera.fov = v.fov;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  // Opening move. Starts straight above the loading map's framing (src/boot.js `view`: map centre
  // and CSS pixels per metre), at the height where the ground lines up with the map pixel for pixel,
  // north up, then flies down into the overview. It holds still until go() (the loader reveal), then
  // waits `delay` seconds into the crossfade before moving. done() fires when it lands.
  intro(view, dur, done) {
    const v = this.camera.aspect < 1 ? OVERVIEW.narrow : OVERVIEW.wide;
    const fov = THREE.MathUtils.degToRad(v.fov);
    const height = window.innerHeight / (2 * Math.tan(fov / 2) * view.s);
    const endT = new THREE.Vector3(...v.target);
    const endS = new THREE.Spherical().setFromVector3(new THREE.Vector3(...v.pos).sub(endT));
    this.introMove = {
      t: 0, dur, done, hold: true, delay: 0.35,
      t0: new THREE.Vector3(view.cx, 0, view.cz), t1: endT,
      // polar ~0: looking straight down; azimuth 0 keeps north at the top of the screen
      s0: new THREE.Spherical(height, 1e-4, 0), s1: endS,
    };
    this.camera.fov = v.fov;
    this.camera.updateProjectionMatrix();
    this.controls.enabled = false;
    this.stepIntro(0);
  }

  go() {
    if (this.introMove) this.introMove.hold = false;
  }

  // Free-camera move from wherever the camera is to (pos, target), same easing as the intro.
  flyTo(pos, target, dur, done) {
    const t0 = this.controls.target.clone(), t1 = new THREE.Vector3(...target);
    const s0 = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(t0));
    const s1 = new THREE.Spherical().setFromVector3(new THREE.Vector3(...pos).sub(t1));
    // turn the short way round
    s1.theta = s0.theta + Math.atan2(Math.sin(s1.theta - s0.theta), Math.cos(s1.theta - s0.theta));
    this.introMove = { t: 0, dur, done, hold: false, delay: 0, t0, t1, s0, s1 };
    this.controls.enabled = false;
  }

  stepIntro(dt) {
    const m = this.introMove, cam = this.camera;
    if (m.hold) dt = 0;
    else if (m.delay > 0) { m.delay -= dt; dt = 0; }
    m.t = Math.min(m.dur, m.t + dt);
    const k = m.t / m.dur, e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;   // ease in-out
    const tgt = this.controls.target.lerpVectors(m.t0, m.t1, e);
    // radius eased in log space so the descent feels like a constant zoom
    const s = new THREE.Spherical(
      Math.exp(THREE.MathUtils.lerp(Math.log(m.s0.radius), Math.log(m.s1.radius), e)),
      THREE.MathUtils.lerp(m.s0.phi, m.s1.phi, e),
      THREE.MathUtils.lerp(m.s0.theta, m.s1.theta, e));
    cam.position.setFromSpherical(s).add(tgt);
    cam.lookAt(tgt);
    if (m.t >= m.dur) {
      this.introMove = null;
      this.controls.enabled = this.mode === 'orbit';
      this.controls.update();
      m.done && m.done();
    }
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

  update(dt, focus, playing, simDt = dt) {
    const cam = this.camera;
    this.speedFactor = 0;
    if (this.introMove || this.mode === 'orbit') {
      if (this.introMove) this.stepIntro(dt);
      else {
        if (this.follow && focus) {
          // keep orbit centred on the focused car while still letting the user orbit
          const delta = focus.world.clone().sub(this.controls.target);
          this.controls.target.add(delta);
          cam.position.add(delta);
        }
        this.controls.update();
      }
      // near grows with the orbit distance (depth precision for aerials) but stays below the
      // camera's height above ground, so a bridge deck close to the lens is never sliced off
      const F = CAMERA.free;
      const byTarget = cam.position.distanceTo(this.controls.target) * F.nearPerMetre;
      const below = this.surfaceAt(cam.position.x, cam.position.z);
      const clearance = cam.position.y > below ? cam.position.y - below : Math.max(0, cam.position.y);
      const byHeight = clearance * F.nearHeightShare;
      this.setNear(THREE.MathUtils.clamp(Math.min(byTarget, byHeight), F.nearMin, F.nearMax));
      return;
    }
    if (!focus) return;
    const p = focus.world;
    const speed = focus.tel ? focus.tel.speed : 0;
    const sp = Math.min(1, speed / 330);
    // heading smoothed a little more for the camera than for the car body
    const target = Math.atan2(focus.dir.x, focus.dir.z);
    if (this.first || this.camYaw == null) this.camYaw = target;
    // the car's yaw rate (rad/s of replay time), smoothed: steering and lean in the cockpit
    if (this.first || this.prevHeading == null) { this.prevHeading = target; this.yawRate = 0; }
    const dh = Math.atan2(Math.sin(target - this.prevHeading), Math.cos(target - this.prevHeading));
    this.prevHeading = target;
    if (simDt > 1e-4) this.yawRate += (THREE.MathUtils.clamp(dh / simDt, -2, 2) - this.yawRate) * (1 - Math.exp(-6 * dt));
    let dy = target - this.camYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    if (this.mode === 'onboard') {
      // T-cam: follow the (already filtered) car heading through a frame-rate independent
      // exponential spring, with the yaw rate clamped so a noisy sample can never whip the view
      const O = CAMERA.onboard;
      // (in replay time: the car turns 10x faster at 10x, and the camera must keep up)
      const step = dy * (1 - Math.exp(-O.smoothing * simDt));
      this.camYaw += THREE.MathUtils.clamp(step, -O.maxYawRate * simDt, O.maxYawRate * simDt);
    } else {
      this.camYaw += dy * (1 - Math.pow(1e-3, dt));
    }
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
      // Driver's eye in the cockpit (src/cockpit.js draws the car around it). Height follows the car
      // through a spring (soaks up kerb steps); vibration is low-frequency (no 60 fps aliasing) and
      // scaled by CAMERA.onboard.shake. The head leans with cornering load and nods under braking.
      const O = CAMERA.onboard;
      if (this.first || this.camY == null) { this.camY = p.y; this.lean = 0; this.nod = 0; }
      this.camY += (p.y - this.camY) * (1 - Math.exp(-O.smoothing * 1.5 * simDt));
      const shake = (0.004 + sp * 0.014) * O.shake * (playing ? 1 : 0);
      const t = this.time;
      const jitter = new THREE.Vector3(
        Math.sin(t * 9.3) * shake * 0.6,
        Math.sin(t * 13.7) * shake + Math.sin(t * 5.1) * shake * 0.5,
        0);
      const latG = (speed / 3.6) * this.yawRate / 9.81;
      const k = 1 - Math.exp(-4 * dt);
      this.lean += (THREE.MathUtils.clamp(latG * O.lean, -0.09, 0.09) - this.lean) * k;
      this.nod += ((focus.tel && focus.tel.brake ? O.nod : 0) - this.nod) * k;
      const base = new THREE.Vector3(p.x, this.camY, p.z);
      wantPos = base.clone().addScaledVector(d, -0.25).add(new THREE.Vector3(0, O.eye, 0)).add(jitter);
      wantLook = base.clone().addScaledVector(d, 30).add(new THREE.Vector3(0, O.eye - 0.35 - this.nod, 0)).add(jitter.multiplyScalar(2));
      fov = 72 + sp * 10;
      lerp = 1;
      this.speedFactor = sp;
      this.setNear(0.03);
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
    if (this.mode === 'onboard') cam.rotateZ(this.lean);
    if (Math.abs(cam.fov - this.smoothFov) > 0.01) {
      cam.fov = this.smoothFov;
      cam.updateProjectionMatrix();
    }
  }
}
