// The Director: picks shots like a TV director so the viewer never has to switch cameras.
// Races: the grid shot (set up by the Start button), then at lights out a dolly that backs away
// ahead of the charging field, a helicopter shot of the pack, and from there a rotation of chase,
// onboard, trackside, helicopter and whole-track aerials. Each shot goes to the car with the most
// going on: an overtake about to happen (it's a replay, so the director can see them coming),
// a close fight, a pit stop, the leader. Shots onto the same car or out to / in from an aerial
// glide; switching to another car's onboard or trackside view is a hard cut, as on TV.
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
    this.timer -= dt;
    if (this.timer > 0) return;
    if (this.phase === 'start') {
      this.phase = 'run';
      this.cut('heli', order[0].k, 1.8, rand(6, 8));
      return;
    }
    this.next(t, order, speed);
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
      if (prev && prev.k === k) s -= 6;              // keep it moving between cars
      consider(k, s, {});
    }
    if (this.wanted != null && this.clock < this.wantedUntil && Math.random() < 0.75) best = { k: this.wanted, why: {} };
    if (!best) return;

    // --- which shot
    const weights = { tv: 3, chase: 2.2, onboard: 1.8, heli: 1.6, wide: 0.9 };
    if (firstLaps) { weights.heli += 2; weights.tv += 1; weights.onboard -= 1; }
    if (best.why.pass) { weights.chase += 3; weights.tv += 2; weights.wide = 0; }
    if (this.clock - this.lastWide < DIRECTOR.wideEvery) weights.wide = 0;
    if (prev) weights[prev.mode] = (weights[prev.mode] || 0) * 0.15;
    let r = Math.random() * Object.values(weights).reduce((a, w) => a + Math.max(0, w), 0), mode = 'tv';
    for (const [m, w] of Object.entries(weights)) { r -= Math.max(0, w); if (r <= 0) { mode = m; break; } }
    if (mode === 'wide') this.lastWide = this.clock;

    // glide when the move makes sense in the air (same car, or out to / in from the wide aerial);
    // otherwise cut, as a TV director would
    const from = prev ? prev.mode : this.director.mode, same = prev && prev.k === best.k;
    const glide = (isAerial(from) || isAerial(mode)) && (same || from === 'wide' || mode === 'wide');
    // hold an overtake shot until just after the pass (shot length is in real seconds)
    let dur = rand(...DIRECTOR.shot[mode]);
    if (best.why.pass) dur = Math.min(16, Math.max(5, (best.why.pass - t) / speed + 4));
    this.cut(mode, best.k, glide ? (mode === 'wide' || from === 'wide' ? 2.4 : 1.6) : 0, dur);
  }
}
