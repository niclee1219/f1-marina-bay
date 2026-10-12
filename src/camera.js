// Camera director: free orbit, chase, onboard, helicopter and automatic trackside "TV" cuts, plus
// two shots the automatic Director (autodirector.js) uses: the start-line dolly and the wide
// whole-track aerial. A change of shot glides from the current view (blend) unless asked to cut.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CAMERA, FLYIN } from './config.js';

const UP = new THREE.Vector3(0, 1, 0);

// 'auto' is the Director (autodirector.js picking shots); the rest are camera modes here
// ('tv', the trackside cuts, is a shot the Director uses, no longer a button of its own)
export const MODES = ['auto', 'orbit', 'chase', 'onboard', 'heli'];
const ease = k => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
// Opening aerial shots (scene coordinates). `narrow` is used on portrait / phone screens.
export const OVERVIEW = {
  // the overhead TV shot: from the south-east, looking north up the pit straight; SINGAPORE reads
  // along the pit roof (one letter per roof bay), grid and lanterns beside it, the Flyer clear to the left
  wide: { pos: [700, 320, 240], target: [560, 0, -178], fov: 42 },
  // same shot for phones: wider lens, panned so the word sits between the timing tower and minimap
  narrow: { pos: [624, 380, 376], target: [484, 0, -74], fov: 55 },
};

export const MODE_LABELS = { auto: 'Broadcast', orbit: 'Free', tv: 'Trackside', chase: 'Chase', onboard: 'Onboard', heli: 'Helicopter', flyin: 'Fly-in', cable: 'Pit cable', tour: 'Tour' };
const AERIAL = new Set(['heli', 'wide', 'orbit', 'flyin', 'cable', 'tour']);
export const isAerial = m => AERIAL.has(m);

export class Director {
  // heightAt(x, z, y): height of whatever stands at (x, z); y lets overhead decks block only their own slab
  // surfaceAt(x, z): top of whatever is under the camera (roof, deck), for the free-camera near plane
  constructor(camera, dom, track, heightAt = () => 0, surfaceAt = () => 0) {
    this.surfaceAt = surfaceAt;
    this.heightAt = heightAt;
    // the circuit's centre and size, for the wide whole-track aerial
    const box = new THREE.Box3().setFromPoints(track.P);
    this.trackC = box.getCenter(new THREE.Vector3());
    this.trackR = box.getSize(new THREE.Vector3()).setY(0).length() / 2;
    this.wideA = 0;
    this.blend = null;
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

  // Pre-start tour (main.js builds the shots from the pit lane): while the viewer waits at the Start
  // button the camera cycles through them, each crossfading into the next. A shot is
  // { dur, fov, near, pose(k, out) } where k runs 0..1 and pose sets out.pos, out.look and
  // optionally out.up. Any other shot (setMode) ends the tour.
  startTour(shots) {
    if (!shots || !shots.length) return;
    this.tour = { shots, i: 0, t: 0, out: { pos: new THREE.Vector3(), look: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) } };
    this.setMode('tour', 0);
    this.tour.i = 0; this.tour.t = 0;
  }

  stepTour(dt) {
    const T = this.tour, cam = this.camera;
    T.t += dt;
    let sh = T.shots[T.i];
    if (T.t >= sh.dur) {
      // next shot: glide from where this one ended (a blend over the first second and a half)
      T.i = (T.i + 1) % T.shots.length; T.t = 0; sh = T.shots[T.i];
      this.blend = { t: 0, dur: 1.8, pos: cam.position.clone(), q: cam.quaternion.clone(), fov: cam.fov };
    }
    const k = Math.min(1, T.t / sh.dur), o = T.out;
    o.up.set(0, 1, 0);
    sh.pose(k, o);
    cam.position.copy(o.pos);
    this.pos.copy(o.pos); this.look.copy(o.look);
    cam.up.copy(o.up);
    cam.lookAt(o.look);
    if (Math.abs(cam.fov - sh.fov) > 0.01) { cam.fov += (sh.fov - cam.fov) * Math.min(1, dt * 3) || 0; cam.updateProjectionMatrix(); }
    this.setNear(sh.near || 2);
    this.applyBlend(dt);
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
    this.blend = null;
  }

  stepIntro(dt) {
    const m = this.introMove, cam = this.camera;
    if (m.hold) dt = 0;
    else if (m.delay > 0) { m.delay -= dt; dt = 0; }
    m.t = Math.min(m.dur, m.t + dt);
    const e = ease(m.t / m.dur);
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

  // Switch shot. blend > 0 glides from the current view over `blend` seconds (position, rotation
  // and lens); 0 is a hard cut. Free (orbit) starts orbiting from wherever the camera is.
  setMode(m, blend = 1.2) {
    const prev = this.mode, cam = this.camera;
    if (this.introMove && !this.introMove.hold) this.introMove = null;   // a new shot replaces a fly-to
    this.mode = m;
    if (m !== 'tour') this.tour = null;
    this.controls.enabled = m === 'orbit';
    this.first = true;
    this.tvSpot = null;
    this.tvHidden = 0;
    this.camYaw = null;
    if (m === 'orbit') {
      // orbit about the point the camera was looking at, so nothing jumps
      if (prev !== 'orbit') {
        const fwd = cam.getWorldDirection(new THREE.Vector3());
        const dist = THREE.MathUtils.clamp(this.look.distanceTo(cam.position) || 60, 20, 400);
        this.controls.target.copy(cam.position).addScaledVector(fwd, dist);
        cam.up.set(0, 1, 0);
        this.controls.update();
      }
      blend = 0;   // OrbitControls reads the camera back each frame, so it can't be blended over
    }
    if (m === 'wide') {
      // continue round the circuit from the side the camera is already on
      const c = this.trackC;
      this.wideA = Math.atan2(cam.position.x - c.x, cam.position.z - c.z);
    }
    if (m === 'dolly') this.dollyT = 0;
    if (m === 'flyin') this.flyT = 0;
    if (m === 'cable') { this.cable = null; this.cableSide = null; }
    this.blend = blend > 0 && prev !== m ? { t: 0, dur: blend, pos: cam.position.clone(), q: cam.quaternion.clone(), fov: cam.fov } : null;
  }

  // ease the camera from the pose it had when the shot changed into the new shot's pose
  applyBlend(dt) {
    const b = this.blend, cam = this.camera;
    if (!b) return;
    b.t += dt;
    const e = ease(Math.min(1, b.t / b.dur));
    cam.position.lerpVectors(b.pos, cam.position.clone(), e);
    cam.quaternion.copy(b.q.clone().slerp(cam.quaternion, e));
    cam.fov = THREE.MathUtils.lerp(b.fov, cam.fov, e);
    cam.updateProjectionMatrix();
    if (b.t >= b.dur) this.blend = null;
  }

  // clear line of sight from a to b (buildings and overhead decks; heightAt is Infinity in a deck)
  canSee(a, b) {
    for (let f = 0.06; f < 0.95; f += 0.08) {
      const x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f, z = a.z + (b.z - a.z) * f;
      if (this.heightAt(x, z, y) > y) return false;
    }
    return true;
  }

  // the trackside camera to cut to for a car at p: the visible spot nearest ~130 m ahead of it
  pickSpot(p, aim, d) {
    const { i } = this.track.nearest(p.x, p.z);
    const n = this.track.n, bin = this.track.bin;
    const cands = [];
    for (const s of this.spots) {
      let ahead = ((s.i - i + n) % n) * bin;
      if (ahead > n * bin / 2) ahead -= n * bin;
      if (ahead > -60 && ahead < 300) cands.push({ s, score: Math.abs(ahead - 130) });
    }
    cands.sort((a, b) => a.score - b.score);
    for (const c of cands.slice(0, 14)) if (this.canSee(c.s.p, aim)) return c.s;
    // nothing trackside can see it (under a deck, between towers): a crane shot behind and above
    return { i, p: p.clone().addScaledVector(d, -30).add(new THREE.Vector3(0, 28, 0)), crane: true };
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
        // a lens carried over from the previous shot eases back to the free camera's 42°
        if (Math.abs(cam.fov - 42) > 0.05) { cam.fov += (42 - cam.fov) * (1 - Math.exp(-3 * dt)); cam.updateProjectionMatrix(); }
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
    if (this.mode === 'tour' && this.tour) { this.stepTour(dt); return; }
    if (this.mode === 'flyin') {
      // helicopter fly-in from Marina Bay Sands across the bay to the pit building: the camera runs along a
      // path while its aim swings from the tower's crown to the pit lane (src/config.js FLYIN)
      this.flyT += dt;
      const F = FLYIN, u = Math.min(1, this.flyT / F.dur);
      if (!this.flyPath) this.flyPath = new THREE.CatmullRomCurve3(F.path.map(p => new THREE.Vector3(...p)), false, 'catmullrom', 0.5);
      this.flyPath.getPoint(ease(u) * 0.7 + u * 0.3, cam.position);
      const k = THREE.MathUtils.smoothstep(u, 0.15, 0.85);
      this.look.set(F.from[0], F.from[1], F.from[2]).lerp(new THREE.Vector3(...F.to), k);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.look);
      const fov = THREE.MathUtils.lerp(52, 38, k);
      if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
      this.setNear(2);
      this.done = u >= 1;
      this.applyBlend(dt);
      return;
    }
    if (this.mode === 'wide') {
      // the whole circuit from high up, slowly circling it
      const c = this.trackC, R = this.trackR;
      this.wideA += dt * 0.035;
      cam.position.set(c.x + Math.sin(this.wideA) * R * 1.05, R * 0.8, c.z + Math.cos(this.wideA) * R * 1.05);
      cam.up.set(0, 1, 0);
      cam.lookAt(c.x, 0, c.z);
      if (Math.abs(cam.fov - 40) > 0.01) { cam.fov = 40; cam.updateProjectionMatrix(); }
      this.setNear(5);
      this.applyBlend(dt);
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
      if (this.first || this.camY == null) { this.camY = p.y; this.lean = 0; this.nod = 0; this.lookYaw = 0; }
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
      // look into the corner: a few degrees of head yaw toward the turn (left turn = +yaw)
      this.lookYaw += (THREE.MathUtils.clamp(this.yawRate * O.look, -0.09, 0.09) - this.lookYaw) * k;
      const base = new THREE.Vector3(p.x, this.camY, p.z);
      wantPos = base.clone().addScaledVector(d, -0.25).add(new THREE.Vector3(0, O.eye, 0)).add(jitter);
      wantLook = base.clone().addScaledVector(d, 30).add(new THREE.Vector3(0, O.eye - 0.35 - this.nod, 0)).add(jitter.multiplyScalar(2));
      fov = 72 + sp * 10;
      lerp = 1;
      this.speedFactor = sp;
      this.setNear(0.03);
    } else if (this.mode === 'cable') {
      // pit cable cam: straight down on the pit lane from 24 m, riding along it with the car on a damped
      // wire, so the stop (crew running out, jacks, wheels off and on) reads from above
      if (!this.cable) this.cable = p.clone();
      this.cable.lerp(p, 1 - Math.exp(-2.4 * dt));
      // steeply from above and from the track side of the lane (the pit building's roof overhangs the garage side)
      const near = this.track.nearest(this.cable.x, this.cable.z);
      const away = new THREE.Vector3(this.track.P[near.i].x - this.cable.x, 0, this.track.P[near.i].z - this.cable.z);
      if (away.lengthSq() < 4) away.set(-d.z, 0, d.x); else away.normalize();
      this.cableSide = (this.cableSide || away.clone()).lerp(away, 1 - Math.exp(-3 * dt)).normalize();
      wantPos = this.cable.clone().addScaledVector(this.cableSide, 6.5).add(new THREE.Vector3(0, 18, 0));
      wantLook = this.cable.clone();
      fov = 46;
      lerp = 1;
      this.setNear(1);
    } else if (this.mode === 'heli') {
      // behind and to one side; if a deck or tower hides the car, swing round to the other side
      if (this.first || !this.heliSide) { this.heliSide = 1; this.heliHidden = 0; }
      const side = new THREE.Vector3(d.z, 0, -d.x).multiplyScalar(this.heliSide);
      wantPos = p.clone().addScaledVector(d, -60).addScaledVector(side, 45).add(new THREE.Vector3(0, 110, 0));
      this.heliHidden = this.canSee(this.pos.lengthSq() ? this.pos : wantPos, p) ? 0 : this.heliHidden + dt;
      if (this.heliHidden > 0.4) { this.heliSide *= -1; this.heliHidden = -1.5; }   // then give the swing time
      wantLook = p.clone().addScaledVector(d, 15);
      fov = 40;
      lerp = 1 - Math.pow(0.02, dt);
      this.setNear(2);
    } else if (this.mode === 'dolly') {
      // race start: from ahead of the leader, back away and rise as the field charges at the lens
      this.dollyT += dt;
      // (short and low enough to hand over before the field reaches the deck over Turn 1)
      const k = ease(Math.min(1, this.dollyT / 6.5));
      const pack = this.pack || p;
      wantPos = p.clone().addScaledVector(d, 28 + 30 * k).add(new THREE.Vector3(0, 9 + 20 * k, 0));
      wantLook = pack.clone().add(new THREE.Vector3(0, 1, 0));
      fov = 52 - 10 * k;
      lerp = 1 - Math.pow(0.02, dt);
      this.setNear(0.5);
    } else if (this.mode === 'tv') {
      // Trackside cameras: cut to the visible spot ~130 m ahead of the car and zoom to keep it framed.
      // Cut away early when the car goes behind a building or under a deck, out of range, or the
      // shot has run its course.
      const aim = p.clone().add(new THREE.Vector3(0, 0.8, 0));
      this.tvSince += dt;
      const cur = this.tvSpot;
      this.tvHidden = cur && this.canSee(cur.p, aim) ? 0 : (this.tvHidden || 0) + dt;
      const dist = cur ? cur.p.distanceTo(p) : Infinity;
      if (!cur || this.tvHidden > 0.25 || dist > 220 || (this.tvSince > 8 && dist > 80)) {
        const next = this.pickSpot(p, aim, d);
        if (!cur || next.i !== cur.i || next.crane !== cur.crane) { this.tvSpot = next; this.tvSince = 0; this.tvHidden = 0; this.first = true; }
      }
      wantPos = this.tvSpot.p;
      wantLook = aim;
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
    cam.up.copy(UP);
    cam.lookAt(this.look);
    if (this.mode === 'onboard') { cam.rotateX(-CAMERA.onboard.pitch); cam.rotateZ(this.lean); cam.rotateY(this.lookYaw || 0); }
    if (Math.abs(cam.fov - this.smoothFov) > 0.01) {
      cam.fov = this.smoothFov;
      cam.updateProjectionMatrix();
    }
    this.applyBlend(dt);
  }
}
