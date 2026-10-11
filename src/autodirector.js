// The Director: picks shots like a TV director so the viewer never has to switch cameras.
// Races: the grid shot (set up by the Start button), then at lights out a dolly that backs away
// ahead of the charging field, a helicopter shot of the pack, and from there a rotation of chase,
// onboard, trackside, helicopter and whole-track aerials. Each shot goes to the car with the most
// going on: an overtake about to happen (it's a replay, so the director can see them coming),
// a close fight, a pit stop, the leader. Shots onto the same car or out to / in from an aerial
// glide; switching to another car's onboard or trackside view is a hard cut, as on TV, unless the
// new shot is close to the old one (the same car in another view, or a car right beside it), which
// glides seamlessly. Two shots are set pieces: a helicopter fly-in from Marina Bay Sands to the pit
// building, and a top-down cable cam on a pit stop worth watching (a car in the top ten, or the one
// the viewer asked for), started as the car enters the lane and held until it is released.
import * as THREE from 'three';
import { isAerial } from './camera.js';
import { DIRECTOR } from './config.js';

const rand = (a, b) => a + Math.random() * (b - a);

export class AutoDirector {
  // setFocus(k): make car k the focused car (tower, card, cameras)
  constructor(race, director, cars, setFocus) {
    this.race = race;
    this.director = director;
    this.cars = cars;
    this.setFocus = setFocus;
    this.active = false;
    // overtakes as [t, attacker k, defender k, position]
    this.passes = race.overtakes.map(([t, a, b, pos]) => [t, race.byNum.get(a), race.byNum.get(b), pos])
      .filter(([, a, b]) => a != null && b != null);
  }

  start(t) {
    this.active = true;
    this.timer = 0;
    this.shot = null;
    this.lastWide = -Infinity;
    this.lastPit = -Infinity;
    this.lastFly = 30 - DIRECTOR.flyEvery;   // the first fly-in comes about half a minute in
    this.clock = 0;
    this.phase = this.race.isRace && t < this.race.race_start ? 'grid' : 'run';
  }

  stop() { this.active = false; }

  // the viewer picked a car: go to it now, and keep coming back to it for a while
  prefer(k) {
    this.wanted = k;
    this.wantedUntil = this.clock + 40;
    this.timer = 0;
  }

  update(dt, t, speed) {
    if (!this.active) return;
    this.clock += dt;
    const race = this.race, order = race.order(t);
    // the pack (first six) for the start dolly to look back at
    const pack = order.slice(0, 6).map(d => this.cars[d.k].world);
    if (pack.length) this.director.pack = pack.reduce((a, p) => a.add(p), pack[0].clone().multiplyScalar(0)).multiplyScalar(1 / pack.length);

    if (this.phase === 'grid') {
      if (t >= race.race_start - 0.3) {
        this.phase = 'start';
        this.cut('dolly', order[0].k, 1.0, DIRECTOR.startDolly);
      }
      return;
    }
    if (this.phase === 'run') this.pitCheck(t, order, speed);
    this.timer -= dt;
    if (this.timer > 0) return;
    if (this.phase === 'start') {
      this.phase = 'run';
      this.cut('heli', order[0].k, 1.8, rand(6, 8));
      return;
    }
    this.next(t, order, speed);
  }

  // a pit stop worth watching is coming up: cut to the cable cam over the box as the car enters the lane
  pitCheck(t, order, speed) {
    const race = this.race;
    if (!race.isRace || !race.pitLane || this.clock - this.lastPit < DIRECTOR.pitEvery) return;
    if (this.shot && (this.shot.mode === 'cable' || this.shot.mode === 'dolly')) return;
    const pos = new Map(order.map((d, i) => [d.k, i + 1]));
    for (const st of race.pitLane.stops) {
      const lead = st.t0 - t;
      if (lead < 2 || lead > DIRECTOR.pitLead + 3) continue;
      const P = pos.get(st.k) || 99;
      if (!(P <= 10 || st.k === this.wanted)) continue;
      const dur = Math.max(5, Math.min(24, (st.t1 + DIRECTOR.pitTail - t) / Math.max(1, speed)));
      this.lastPit = this.clock;
      this.cut('cable', st.k, this.blendTo(st.k, 'cable'), dur);
      return;
    }
  }

  // how to move to a shot of car k: a seamless glide when it is near the current one (the same car in
  // another view, or a car right beside it, or anything in the air); otherwise a hard cut, as on TV
  blendTo(k, mode) {
    const prev = this.shot, from = prev ? prev.mode : this.director.mode;
    const a = prev && this.cars[prev.k], b = this.cars[k];
    const dist = a && b ? a.world.distanceTo(b.world) : Infinity;
    const near = (prev && prev.k === k) || dist < 70;
    if (near) return THREE.MathUtils.clamp(0.8 + dist / 90, 0.8, 2.0);
    if ((isAerial(from) || isAerial(mode)) && (from === 'wide' || mode === 'wide')) return 2.4;
    return 0;
  }

  cut(mode, k, blend, dur) {
    this.setFocus(k);
    this.director.setMode(mode, blend);
    this.shot = { mode, k };
    this.timer = dur;
  }

  next(t, order, speed) {
    const race = this.race, prev = this.shot;
    const pos = new Map(order.map((d, i) => [d.k, i + 1]));
    const firstLaps = race.isRace && race.leaderLap(t) <= 2;

    // --- which car: score everyone, best wins
    let best = null;
    const consider = (k, score, why) => { if (!best || score > best.score) best = { k, score, why }; };
    // an overtake coming up in the next few seconds of race time (the attacker)
    const horizon = Math.max(6, DIRECTOR.lookahead * Math.min(speed, 4));
    for (const [ot, a, , p] of this.passes) {
      if (ot > t + 1.5 && ot < t + horizon && p <= 14) consider(a, 30 - p * 0.5, { pass: ot });
    }
    for (const d of order) {
      const k = d.k, c = this.cars[k], tel = c.tel;
      if (!tel) continue;
      const P = pos.get(k);
      const stopped = tel.speed < 30 && !race.inPit(k, t);
      if (stopped) continue;
      let s = Math.random() * 2;
      if (P === 1) s += 4;
      s += Math.max(0, 12 - P) * 0.35;
      const g = race.isRace ? race.gap(k, t) : null;
      if (g && typeof g.interval === 'number' && P > 1 && g.interval < 1.2) s += 10 * (1.2 - g.interval);
      if (race.inPit(k, t)) s += 6;
      if (!race.isRace && tel.speed > 200) s += 4;   // practice / qualifying: someone on a flying lap
      if (prev && prev.k === k) s -= prev.mode === 'cable' ? -8 : 6;   // after a pit shot, follow the car out; else keep it moving
      consider(k, s, {});
    }
    if (this.wanted != null && this.clock < this.wantedUntil && Math.random() < 0.75) best = { k: this.wanted, why: {} };
    if (!best) return;

    // --- which shot
    const weights = { tv: 3, chase: 2.2, onboard: 1.8, heli: 1.6, wide: 0.9 };
    if (firstLaps) { weights.heli += 2; weights.tv += 1; weights.onboard -= 1; }
    // the fly-in from Marina Bay Sands to the pit building, now and then (not in the opening laps)
    weights.flyin = !firstLaps && this.clock - this.lastFly > DIRECTOR.flyEvery ? 1.8 : 0;
    if (prev && prev.mode === 'cable') { weights.chase += 3; weights.onboard += 1; weights.tv = 0; weights.wide = 0; weights.flyin = 0; }
    if (best.why.pass) { weights.chase += 3; weights.tv += 2; weights.wide = 0; }
    if (this.clock - this.lastWide < DIRECTOR.wideEvery) weights.wide = 0;
    if (prev) weights[prev.mode] = (weights[prev.mode] || 0) * 0.15;
    let r = Math.random() * Object.values(weights).reduce((a, w) => a + Math.max(0, w), 0), mode = 'tv';
    for (const [m, w] of Object.entries(weights)) { r -= Math.max(0, w); if (r <= 0) { mode = m; break; } }
    if (mode === 'wide') this.lastWide = this.clock;
    if (mode === 'flyin') this.lastFly = this.clock;

    // glide when the move makes sense in the air (same car, or out to / in from the wide aerial);
    // otherwise cut, as a TV director would
    const from = prev ? prev.mode : this.director.mode;
    // hold an overtake shot until just after the pass (shot length is in real seconds)
    let dur = rand(...DIRECTOR.shot[mode]);
    if (best.why.pass) dur = Math.min(16, Math.max(5, (best.why.pass - t) / speed + 4));
    this.cut(mode, best.k, this.blendTo(best.k, mode), dur);
  }
}
