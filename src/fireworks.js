// Fireworks and the show that drives them.
//
// Fireworks: every spark is a point in one pooled Points object; the vertex shader flies it from its
// launch data (origin, velocity, drag, gravity, birth, life), so a burst costs a buffer write and no
// per-frame JS. A rocket is a bright head with a short spark trail that rises, then its burst is
// spawned at the apex (peony, ring, willow, double colour).
//
// Shows: when the lights go out a chain of rockets runs the length of the paddock and on down the
// pit straight; when the winner crosses the line a finale fires along the straight, the paddock and
// the city; every tenth lap a volley goes up; and through the race single rockets rise near the
// camera, with the occasional full light show (bulb strings chase, searchlights sweep) in between.
import * as THREE from 'three';
import { glowTex } from './trackdecor.js';

const MAX = 16000;
const STRIDE = 14;   // origin 3, vel 3, birth, life, drag, grav, size, colour 3
const PALETTE = [
  [1.0, 0.22, 0.18], [1.0, 0.68, 0.12], [0.25, 0.65, 1.0], [0.35, 1.0, 0.45],
  [0.85, 0.3, 1.0], [1.0, 0.95, 0.85], [1.0, 0.45, 0.1], [0.2, 1.0, 0.9], [1.0, 0.3, 0.7],
];

const VERT = `
  attribute vec3 aVel; attribute vec2 aTime; attribute vec3 aMotion; attribute vec3 aColor;
  uniform float uTime; uniform float uScale;
  varying vec3 vCol; varying float vA;
  void main(){
    float age = uTime - aTime.x;
    if (age < 0.0 || age > aTime.y) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vA = 0.0; vCol = vec3(0.0); return; }
    float k = max(aMotion.x, 0.001);
    vec3 p = position + aVel * ((1.0 - exp(-k * age)) / k);
    p.y -= 0.5 * aMotion.y * age * age;
    float t01 = age / aTime.y;
    vA = pow(1.0 - t01, 1.4) * (0.75 + 0.25 * sin(age * 38.0 + aTime.x * 91.0));
    vCol = aColor;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = clamp(aMotion.z * uScale / -mv.z * (0.55 + 0.45 * (1.0 - t01)), 0.0, 120.0);
    gl_Position = projectionMatrix * mv;
  }`;
const FRAG = `
  uniform sampler2D uMap; varying vec3 vCol; varying float vA;
  void main(){ float a = texture2D(uMap, gl_PointCoord).a * vA; if (a < 0.01) discard; gl_FragColor = vec4(vCol * a * 4.5, a); }`;

const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);

export class Fireworks {
  constructor(scene) {
    this.buf = new THREE.InterleavedBuffer(new Float32Array(MAX * STRIDE), STRIDE);
    this.buf.setUsage(THREE.DynamicDrawUsage);
    const geo = new THREE.BufferGeometry();
    const at = (n, off) => new THREE.InterleavedBufferAttribute(this.buf, n, off);
    geo.setAttribute('position', at(3, 0));
    geo.setAttribute('aVel', at(3, 3));
    geo.setAttribute('aTime', at(2, 6));      // birth, life
    geo.setAttribute('aMotion', at(3, 8));    // drag, gravity, size
    geo.setAttribute('aColor', at(3, 11));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.uniforms = { uTime: { value: 0 }, uScale: { value: 400 }, uMap: { value: glowTex() } };
    this.mesh = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.time = 0; this.head = 0; this.dirty = false; this.aliveUntil = 0;
    this.queue = [];
    this.bursts = 0;
  }

  spawn(x, y, z, vx, vy, vz, life, drag, grav, size, c, delay = 0) {
    const a = this.buf.array, o = this.head * STRIDE;
    a[o] = x; a[o + 1] = y; a[o + 2] = z; a[o + 3] = vx; a[o + 4] = vy; a[o + 5] = vz;
    a[o + 6] = this.time + delay; a[o + 7] = life; a[o + 8] = drag; a[o + 9] = grav; a[o + 10] = size;
    a[o + 11] = c[0]; a[o + 12] = c[1]; a[o + 13] = c[2];
    this.head = (this.head + 1) % MAX;
    this.dirty = true;
    this.aliveUntil = Math.max(this.aliveUntil, this.time + delay + life);
  }

  // a rocket from (x, z) on the ground: rises for `rise` s with a spark trail, then bursts
  launch(x, y, z, o = {}) {
    const rise = o.rise ?? rnd(1.0, 1.35), height = o.height ?? rnd(95, 150), drag = 0.9;
    // vertical speed that reaches `height` after `rise` s under this drag
    const vy = height * drag / (1 - Math.exp(-drag * rise));
    const drift = rnd(-6, 6), driftZ = rnd(-6, 6), delay = o.delay ?? 0;
    const apexAt = tau => ({ x: x + drift * (1 - Math.exp(-drag * tau)) / drag, y: y + vy * (1 - Math.exp(-drag * tau)) / drag, z: z + driftZ * (1 - Math.exp(-drag * tau)) / drag });
    // head and trail
    this.spawn(x, y, z, drift, vy, driftZ, rise, drag, 0, 8, [1.0, 0.85, 0.55], delay);
    for (let j = 1; j < 14; j++) {
      const tau = j * rise / 14, p = apexAt(tau);
      this.spawn(p.x, p.y, p.z, rnd(-1.5, 1.5), rnd(-4, -1), rnd(-1.5, 1.5), 0.55, 1.5, 3, 4, [1.0, 0.7, 0.3], delay + tau);
    }
    this.queue.push({ at: this.time + delay + rise, fn: () => { const p = apexAt(rise); this.burst(p.x, p.y, p.z, o); } });
  }

  burst(x, y, z, o = {}) {
    this.bursts++;
    const type = o.type || ['peony', 'peony', 'ring', 'willow', 'double'][Math.random() * 5 | 0];
    const c1 = o.color || PALETTE[Math.random() * PALETTE.length | 0];
    let c2 = PALETTE[Math.random() * PALETTE.length | 0];
    if (c2 === c1) c2 = [1, 1, 1];
    const dir = new THREE.Vector3(), u = new THREE.Vector3(), w = new THREE.Vector3();
    this.spawn(x, y, z, 0, 0, 0, 0.22, 1, 0, 190, [1, 0.95, 0.85]);   // flash
    const N = o.count || (type === 'ring' ? 70 : type === 'willow' ? 90 : 120);
    const sph = () => { const a = rnd(0, 6.2832), cz = rnd(-1, 1), s = Math.sqrt(1 - cz * cz); return dir.set(s * Math.cos(a), cz, s * Math.sin(a)); };
    if (type === 'ring') {
      // a circle in a random plane
      sph(); u.set(-dir.z, 0, dir.x).normalize(); if (u.lengthSq() < 0.1) u.set(1, 0, 0); w.crossVectors(dir, u);
      for (let j = 0; j < N; j++) {
        const a = j / N * 6.2832, sp = 68;
        this.spawn(x, y, z, (u.x * Math.cos(a) + w.x * Math.sin(a)) * sp, (u.y * Math.cos(a) + w.y * Math.sin(a)) * sp, (u.z * Math.cos(a) + w.z * Math.sin(a)) * sp, rnd(2.0, 2.4), 1.6, 7, 6, c1);
      }
      for (let j = 0; j < 22; j++) { sph(); this.spawn(x, y, z, dir.x * 24, dir.y * 24, dir.z * 24, rnd(1.4, 1.9), 1.6, 7, 4.5, c2); }
    } else if (type === 'willow') {
      const gold = [1.0, 0.72, 0.25];
      for (let j = 0; j < N; j++) { sph(); const sp = rnd(30, 55); this.spawn(x, y, z, dir.x * sp, dir.y * sp, dir.z * sp, rnd(3.4, 4.6), 1.1, 9.5, 4.2, gold); }
    } else {
      for (let j = 0; j < N; j++) {
        sph();
        const sp = type === 'double' ? (j % 2 ? 80 : 46) : rnd(62, 80), col = type === 'double' ? (j % 2 ? c1 : c2) : c1;
        this.spawn(x, y, z, dir.x * sp, dir.y * sp, dir.z * sp, rnd(2.0, 2.8), 1.6, 7, 6, col);
      }
    }
  }

  // schedule a function `after` seconds from now (real time)
  later(after, fn) { this.queue.push({ at: this.time + after, fn }); }

  update(dt, viewH) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    this.uniforms.uScale.value = viewH / 2;
    for (let j = this.queue.length - 1; j >= 0; j--) {
      const e = this.queue[j];
      if (e.at <= this.time) { this.queue.splice(j, 1); e.fn(); }
    }
    if (this.dirty) { this.buf.needsUpdate = true; this.dirty = false; }
    this.mesh.visible = this.time < this.aliveUntil + 0.1;
  }
}

// ---------------------------------------------------------------------------------------------
export class Shows {
  constructor(fw, decor, race, track, pit) {
    this.fw = fw; this.decor = decor; this.race = race; this.track = track; this.pit = pit;
    this.prevT = null;
    this.fired = new Set();
    this.sinceAmbient = 0; this.nextAmbient = 5;
    this.sinceShow = 0; this.nextShow = rnd(55, 80);
    this.showUntil = 0; this.clock = 0;
    const win = race.drivers.find(d => d.finish === 1);
    this.winnerT = win && Number.isFinite(win.finishT) ? win.finishT : null;
    this.sites = decor.sites;
    this.tenth = race.isRace ? race.leaderLaps.map((l, k) => ({ lap: k + 1, t: l[1] })).filter(e => e.lap % 10 === 0 && e.lap < race.total_laps) : [];
  }

  // ground points for a show: along the paddock, down the pit straight (outside), around the track
  paddockPoints() {
    const tr = this.track, L = tr.lane, pit = this.pit;
    if (this._paddock) return this._paddock;
    const out = [];
    if (L && pit && pit.span) {
      for (let u = pit.span.u0 - 30; u <= pit.span.u1 + 90; u += 14) out.push(L.point(u, 8.1 + 36, 0));
    }
    return (this._paddock = out);
  }
  straightPoints() {
    const tr = this.track;
    if (this._straight) return this._straight;
    const out = [], side = -(tr.pitSide || 1);
    for (let s = -420; s <= 160; s += 16) {
      const i = Math.round((((s % tr.length) + tr.length) % tr.length) / tr.bin) % tr.n;
      out.push(tr.at(i, side * (tr.wallAt(i, side) + 26), 0, new THREE.Vector3()));
    }
    return (this._straight = out);
  }

  // lights out: rockets chase along the paddock, then on down the straight
  startShow() {
    const fw = this.fw, pad = this.paddockPoints(), str = this.straightPoints();
    pad.forEach((p, k) => {
      fw.launch(p.x, p.y || 0, p.z, { delay: k * 0.28, height: rnd(90, 135), type: k % 5 === 4 ? 'ring' : k % 3 === 0 ? 'peony' : undefined });
      if (k % 2 === 0) fw.launch(p.x + rnd(-8, 8), p.y || 0, p.z + rnd(-8, 8), { delay: k * 0.28 + 0.2, height: rnd(60, 100) });
    });
    const t0 = pad.length * 0.28 + 0.4;
    str.forEach((p, k) => fw.launch(p.x, p.y || 0, p.z, { delay: t0 + k * 0.22, height: rnd(80, 130) }));
    this.showFor(26);
  }

  // the winner crosses the line: a long finale over the straight, paddock and city
  finishShow() {
    const fw = this.fw, str = this.straightPoints(), pad = this.paddockPoints(), all = this.sites.around;
    str.forEach((p, k) => { fw.launch(p.x, p.y || 0, p.z, { delay: k * 0.18, height: rnd(90, 150) }); fw.launch(p.x + rnd(-10, 10), p.y || 0, p.z + rnd(-10, 10), { delay: k * 0.18 + 0.35, height: rnd(110, 170), type: 'willow' }); });
    pad.forEach((p, k) => fw.launch(p.x, p.y || 0, p.z, { delay: 2 + k * 0.25, height: rnd(90, 140) }));
    for (let r = 0; r < 4; r++) {
      const wave = 6 + r * 4;
      for (let k = 0; k < 10; k++) {
        const s = all.length ? all[Math.random() * all.length | 0] : str[0];
        if (s) fw.launch(s.x, s.y || 0, s.z, { delay: wave + k * 0.3 + rnd(0, 0.3), height: rnd(100, 170) });
      }
    }
    // the closing salvo: everything at once
    for (let k = 0; k < 16; k++) {
      const p = k % 2 ? str[(k * 3) % str.length] : pad[(k * 2) % Math.max(1, pad.length)] || str[0];
      if (p) fw.launch(p.x + rnd(-6, 6), p.y || 0, p.z + rnd(-6, 6), { delay: 24 + k * 0.12, height: rnd(110, 170), count: 150 });
    }
    this.showFor(48);
  }

  // every tenth lap: a volley down the straight
  volley() {
    const fw = this.fw, str = this.straightPoints();
    str.forEach((p, k) => fw.launch(p.x, p.y || 0, p.z, { delay: k * 0.25, height: rnd(85, 130) }));
    this.showFor(16);
  }

  showFor(seconds) {
    this.showUntil = Math.max(this.showUntil, this.clock + seconds);
    this.decor.setShow(1);
  }

  // single rockets near the camera so they are seen
  ambient(camPos) {
    const sites = this.sites.around;
    if (!sites.length) return;
    const near = sites.filter(s => Math.hypot(s.x - camPos.x, s.z - camPos.z) < 700);
    const pool = near.length > 3 ? near : sites;
    const n = 1 + (Math.random() < 0.4 ? 1 : 0) + (Math.random() < 0.15 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const s = pool[Math.random() * pool.length | 0];
      this.fw.launch(s.x, s.y || 0, s.z, { delay: k * rnd(0.3, 0.9), height: rnd(85, 150) });
    }
  }

  // a light show in the middle of the race: bulbs chase, beams sweep, a salvo near the camera
  lightShow(camPos) {
    this.showFor(22);
    const sites = this.sites.around;
    const near = sites.filter(s => Math.hypot(s.x - camPos.x, s.z - camPos.z) < 800);
    const pool = near.length > 4 ? near : sites;
    for (let k = 0; k < 14 && pool.length; k++) {
      const s = pool[Math.random() * pool.length | 0];
      this.fw.launch(s.x, s.y || 0, s.z, { delay: 1 + k * 0.7 + rnd(0, 0.4), height: rnd(85, 150) });
    }
  }

  // t: replay time; playing/speed: the replay is running at that speed; jumped: the viewer sought
  update(dt, t, playing, camPos, jumped) {
    const race = this.race;
    this.clock += dt;
    if (this.clock > this.showUntil) this.decor.setShow(0);
    const prev = this.prevT;
    this.prevT = t;
    if (!race.isRace || prev == null) return;
    // a seek is not a crossing; going back before the start re-arms the shows
    const step = Math.abs(t - prev);
    if (t < race.race_start - 15) this.fired.clear();
    if (jumped || step > 8) { return; }
    const crossed = at => prev < at && t >= at;
    if (!this.fired.has('start') && crossed(race.race_start + 0.15)) { this.fired.add('start'); this.startShow(); }
    if (this.winnerT != null && !this.fired.has('finish') && crossed(this.winnerT)) { this.fired.add('finish'); this.finishShow(); }
    for (const e of this.tenth) if (!this.fired.has('lap' + e.lap) && crossed(e.t)) { this.fired.add('lap' + e.lap); this.volley(); }
    // through the race: rockets and now and then a full light show (real time, while playing)
    const racing = playing && t > race.race_start + 25 && (this.winnerT == null || t < this.winnerT - 5);
    if (!racing) return;
    this.sinceAmbient += dt; this.sinceShow += dt;
    if (this.sinceAmbient > this.nextAmbient) { this.sinceAmbient = 0; this.nextAmbient = rnd(8, 16); this.ambient(camPos); }
    if (this.sinceShow > this.nextShow) { this.sinceShow = 0; this.nextShow = rnd(70, 110); this.lightShow(camPos); }
  }
}
