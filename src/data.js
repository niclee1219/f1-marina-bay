// Loads the pre-built race/city data and answers "what is happening at time t" queries.
// Time t is seconds since race.t0 (grid, before the formation lap).
import { GRID, PIT_LANE } from './config.js';

export const TYRES = {
  SOFT: { c: '#ff2d2c', l: 'S' },
  MEDIUM: { c: '#ffd12e', l: 'M' },
  HARD: { c: '#f0f0ec', l: 'H' },
  INTERMEDIATE: { c: '#43b047', l: 'I' },
  WET: { c: '#0090ff', l: 'W' },
};

// The downloads (session index, race.json / race.bin, city, OSM bridges from
// scripts/fetch_bridges.py) are started by src/boot.js before three.js has even loaded.
export async function loadAll() {
  const { sessions, id, race, city, bin, bridges } = await window.__boot.data;
  city.bridges = bridges.ways;
  city.bridgeDeck = bridges.deck;
  return { race: new Race(race, bin), city, sessions, id };
}

// The circuit centreline as a closed Catmull-Rom curve, parameterised by arc length (metres).
// The build script encodes on-track car positions against exactly this curve.
export class TrackCurve {
  constructor(center, elev) {
    this.P = center;
    this.E = elev;
    this.n = center.length;
    this.S = new Float64Array(this.n + 1);
    for (let i = 0; i < this.n; i++) {
      const a = center[i], b = center[(i + 1) % this.n];
      this.S[i + 1] = this.S[i] + Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    this.L = this.S[this.n];
    this.hint = 0;
  }

  // point, unit tangent and elevation at arc length s -> out {x, y, tx, ty, e} (map coords)
  at(s, out) {
    const { S, P, n, L } = this;
    s = ((s % L) + L) % L;
    let i = Math.min(n - 1, Math.max(0, Math.floor(s / L * n)));
    while (i > 0 && S[i] > s) i--;
    while (i < n - 1 && S[i + 1] <= s) i++;
    const u = (s - S[i]) / (S[i + 1] - S[i] || 1);
    const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
    const u2 = u * u, u3 = u2 * u;
    for (let c = 0; c < 2; c++) {
      const a = p0[c], b = p1[c], cc = p2[c], d = p3[c];
      const v = 0.5 * (2 * b + (-a + cc) * u + (2 * a - 5 * b + 4 * cc - d) * u2 + (-a + 3 * b - 3 * cc + d) * u3);
      const dv = 0.5 * ((-a + cc) + 2 * (2 * a - 5 * b + 4 * cc - d) * u + 3 * (-a + 3 * b - 3 * cc + d) * u2);
      if (c === 0) { out.x = v; out.tx = dv; } else { out.y = v; out.ty = dv; }
    }
    const l = Math.hypot(out.tx, out.ty) || 1;
    out.tx /= l; out.ty /= l;
    out.e = this.E[i] + (this.E[(i + 1) % n] - this.E[i]) * u;
    return out;
  }
}

// last index i with arr[i][0] <= t (arr sorted by [0]); -1 if none
function bisect(arr, t, key = 0) {
  let lo = 0, hi = arr.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid][key] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

export class Race {
  constructor(meta, buffer) {
    Object.assign(this, meta);
    this.frames = new Int16Array(buffer);
    this.framesU = new Uint16Array(buffer);
    this.curve = new TrackCurve(meta.track.center, meta.track.elev);
    this._c = {};
    this._q = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
    this.n = this.drivers.length;
    this.duration = this.frames.length / (this.n * 4) / this.hz;
    this.byNum = new Map(this.drivers.map((d, k) => [d.num, k]));
    this.drivers.forEach((d, k) => {
      d.k = k;
      d.pos = [];
      d.stints = [];
      d.pitWindows = [];
    });
    for (const [t, num, p] of this.positions) this.drivers[this.byNum.get(num)].pos.push([t, p]);
    for (const [num, sn, a, b, comp, age] of this.stints) {
      this.drivers[this.byNum.get(num)].stints.push({ sn, a, b, comp, age });
    }
    for (const [t, num, lap, stop, lane] of this.pits) {
      this.drivers[this.byNum.get(num)].pitWindows.push({ t, lap, stop, lane });
    }
    // lap end times + running best sectors, for purple/green timing
    this.lapEvents = [];
    for (const d of this.drivers) {
      for (const L of d.laps) {
        const [lap, start, dur, s1, s2, s3] = L;
        if (dur) this.lapEvents.push({ t: start + dur, k: d.k, lap, dur, s: [s1, s2, s3] });
      }
    }
    this.lapEvents.sort((a, b) => a.t - b.t);
    // mark the laps that set a new overall fastest time (for the purple "fastest lap" toast)
    let bestSoFar = Infinity;
    for (const e of this.lapEvents) {
      if (e.lap > 1 && e.dur < bestSoFar) { bestSoFar = e.dur; e.overallBest = true; }
    }
    this.lapEventT = this.lapEvents.map(e => [e.t]);
    this.isRace = this.session ? this.session.is_race : true;
    this.leaderLaps = (this.drivers.find(d => d.finish === 1) || this.drivers[0]).laps;
    this.raceEnd = this.isRace ? (() => {
      const L = this.leaderLaps[this.leaderLaps.length - 1];
      return L[1] + (L[2] || 95);
    })() : this.session.end;
    // per-driver finish time (crossing the line after the leader has finished)
    for (const d of this.drivers) {
      const last = d.laps[d.laps.length - 1];
      d.finishT = last && last[2] ? last[1] + last[2] : Infinity;
    }
    const tr = this.track;
    tr.n = tr.center.length;
    this.grid = this.isRace ? this.buildGrid() : null;
    this.pitLane = this.buildPitLane();
  }

  // The fitted pit lane in map coordinates (see scripts/fit_pit_lane.py), each team's box, and the
  // stops: when each car stood in its box and for how long (OpenF1 stop_duration, races only).
  buildPitLane() {
    const D = this.track.pitlane;
    if (!D || !D.center || D.center.length < 5) return null;
    const c = D.center, n = c.length, u = new Float32Array(n), gx = new Float32Array(n), gy = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const a = c[Math.max(0, k - 1)], b = c[Math.min(n - 1, k + 1)];
      const tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1;
      // right of travel in map coords is (ty, -tx); garages on `side` of it
      gx[k] = D.side * ty / l; gy[k] = -D.side * tx / l;
      if (k) u[k] = u[k - 1] + Math.hypot(c[k][0] - c[k - 1][0], c[k][1] - c[k - 1][1]);
    }
    const boxes = new Map((D.boxes || []).map(b => [b.team, b]));
    const lane = { c, n, u, gx, gy, boxes, wBox: (PIT_LANE.fast + PIT_LANE.garage) / 2 };
    // stops: first stationary frame after entering the lane, near the team's own box
    lane.stops = [];
    const o = [0, 0, 0, 0];
    for (const d of this.drivers) {
      const box = boxes.get(d.team);
      if (!box) continue;
      for (const w of d.pitWindows) {
        if (!(w.stop > 0)) continue;
        // OpenF1's pit timestamp is close to the lane exit: search back across the lane time
        for (let t = w.t - (w.lane || 30) - 8; t < w.t + 4; t += 0.25) {
          if (this.tel(d.k, t).speed > 0) continue;
          this.pos(d.k, t, o);
          const q = this.laneNear(lane, o[0], o[1]);
          if (q && Math.abs(q.u - box.u) < 14) lane.stops.push({ k: d.k, team: d.team, t0: t, t1: t + w.stop, u: box.u });
          break;
        }
      }
    }
    lane.stops.sort((a, b) => a.t0 - b.t0);
    return lane;
  }

  // nearest lane sample to map point (x, y): {k, u, dist, lat (toward the garages)}
  laneNear(lane, x, y) {
    let best = -1, bd = Infinity;
    for (let k = 0; k < lane.n; k += 2) {
      const d = (lane.c[k][0] - x) ** 2 + (lane.c[k][1] - y) ** 2;
      if (d < bd) { bd = d; best = k; }
    }
    for (const k of [best - 1, best + 1]) {
      if (k < 0 || k >= lane.n) continue;
      const d = (lane.c[k][0] - x) ** 2 + (lane.c[k][1] - y) ** 2;
      if (d < bd) { bd = d; best = k; }
    }
    // project onto the neighbouring segments, so u and the offset vary smoothly with the position
    let res = null;
    for (const k0 of [best - 1, best]) {
      const k1 = k0 + 1;
      if (k0 < 0 || k1 >= lane.n) continue;
      const ax = lane.c[k0][0], ay = lane.c[k0][1], dx = lane.c[k1][0] - ax, dy = lane.c[k1][1] - ay;
      const f = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
      const px = ax + dx * f, py = ay + dy * f, dist = Math.hypot(x - px, y - py);
      if (!res || dist < res.dist) {
        const gx = lane.gx[k0] + (lane.gx[k1] - lane.gx[k0]) * f, gy = lane.gy[k0] + (lane.gy[k1] - lane.gy[k0]) * f;
        res = { k: k0, f, u: lane.u[k0] + (lane.u[k1] - lane.u[k0]) * f, dist, gx, gy, lat: (x - px) * gx + (y - py) * gy };
      }
    }
    return res || { k: best, f: 0, u: lane.u[best], dist: Math.sqrt(bd), gx: lane.gx[best], gy: lane.gy[best], lat: 0 };
  }

  // Sideways move into the team's box while a car stops (OpenF1 does not resolve the fast lane from
  // the working lane: stopped cars are recorded on the same line as moving ones). Only during the
  // car's own pit window, only near its own box, never along the lane, so timing is untouched.
  pitShift(k, t, out) {
    const lane = this.pitLane;
    if (!lane || !PIT_LANE.boxShift) return;
    const d = this.drivers[k], box = lane.boxes.get(d.team);
    if (!box || !d.pitWindows.some(w => t > w.t - (w.lane || 30) - 15 && t < w.t + 10)) return;
    const q = this.laneNear(lane, out[0], out[1]);
    if (q.dist > 7) return;
    const sm = (a, b, x) => { const v = Math.min(1, Math.max(0, (x - a) / (b - a))); return v * v * (3 - 2 * v); };
    const w = (1 - sm(PIT_LANE.boxShift[0], PIT_LANE.boxShift[1], Math.abs(q.u - box.u))) * (1 - sm(3, 7, q.dist));
    if (w <= 0) return;
    const off = w * (lane.wBox - box.lat);
    out[0] += q.gx * off;
    out[1] += q.gy * off;
  }

  // Grid slots in (arc length, lateral offset). The slot positions follow the regulation stagger
  // from where the pole car actually stopped; each car's own recorded stop point is kept so the
  // replay can ease it into its slot (see gridShift).
  buildGrid() {
    const L = this.curve.L, F = this.frames, U = this.framesU, nf = this.duration * this.hz | 0;
    const t = this.race_start - 3, fi = Math.round(this.frameIndex(t));
    const wrap = s => (s > L / 2 ? s - L : s);
    const cars = [], anchors = [];
    for (const d of this.drivers) {
      const p = this.position(d.k, this.race_start), j = (d.k * nf + fi) * 4;
      const on = (F[j + 3] >> 13) & 1;
      const g = { k: d.k, p, sTel: on ? wrap(U[j] / 10) : null, dTel: on ? F[j + 1] / 100 : 0 };
      if (on && F[j + 2] < 5) anchors.push(g.sTel + (p - 1) * GRID.spacing);
      cars.push(g);
    }
    if (!anchors.length) return null;
    anchors.sort((a, b) => a - b);
    const sPole = anchors[anchors.length >> 1];
    const left = GRID.poleSide === 'left' ? -1 : 1;   // +d is right of travel
    for (const g of cars) {
      g.sSlot = sPole - (g.p - 1) * GRID.spacing;
      g.dSlot = (g.p % 2 ? left : -left) * GRID.column;
    }
    return {
      sPole, cars, slots: cars.map(g => ({ p: g.p, s: g.sSlot, d: g.dSlot })).sort((a, b) => a.p - b.p),
      from: this.race_start - 150, until: this.race_start + 60,
    };
  }

  // Offset (ds, dd) that moves car k from its telemetry position into its grid box: full while it
  // sits at its recorded stop point, fading out with the distance from it, so there is no jump
  // as the car arrives from the formation lap or pulls away at the start.
  gridShift(k, t, s) {
    const G = this.grid;
    if (!G || t < G.from || t > G.until) return null;
    const g = G.cars[k];
    if (g.sTel == null) return null;
    const L = this.curve.L;
    let ds = s - g.sTel;
    ds -= Math.round(ds / L) * L;
    const [a, b] = GRID.blend;
    const x = Math.min(1, Math.max(0, (Math.abs(ds) - a) / (b - a)));
    const w = 1 - x * x * (3 - 2 * x);
    if (w <= 0) return null;
    return [w * (g.sSlot - g.sTel), w * (g.dSlot - g.dTel)];
  }

  frameIndex(t) { return Math.max(0, Math.min(this.duration * this.hz - 1, t * this.hz)); }

  // Interpolated position into out: [x east, y north, elevation (NaN off track), on-track 0/1].
  // On-track frames hold (arc length, lateral offset) and are interpolated along the curve,
  // so cars follow the circuit smoothly between the 4 Hz samples.
  pos(k, t, out) {
    const F = this.frames, U = this.framesU, nf = this.duration * this.hz | 0, base = k * nf * 4;
    const f = this.frameIndex(t);
    const i = Math.floor(f), u = f - i;
    const g = j => base + Math.max(0, Math.min(nf - 1, j)) * 4;
    const idx = [g(i - 1), g(i), g(i + 1), g(i + 2)];
    const on = idx.map(j => (F[j + 3] >> 13) & 1);
    const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
    const C = this._c;
    if (on[1] && on[2]) {
      // unwrap arc lengths around frame i so the lap line does not cause a jump
      const L = this.curve.L, s1 = U[idx[1]] / 10;
      const sv = idx.map((j, m) => {
        if (!on[m]) return null;
        let v = U[j] / 10;
        if (v - s1 > L / 2) v -= L; else if (s1 - v > L / 2) v += L;
        return v;
      });
      const dv = idx.map((j, m) => (on[m] ? F[j + 1] / 100 : null));
      if (sv[0] == null) { sv[0] = 2 * sv[1] - sv[2]; dv[0] = dv[1]; }
      if (sv[3] == null) { sv[3] = 2 * sv[2] - sv[1]; dv[3] = dv[2]; }
      let s = cr(sv[0], sv[1], sv[2], sv[3]), d = cr(dv[0], dv[1], dv[2], dv[3]);
      const gs = this.grid && this.gridShift(k, t, s);
      if (gs) { s += gs[0]; d += gs[1]; }
      this.curve.at(s, C);
      out[0] = C.x + C.ty * d;
      out[1] = C.y - C.tx * d;
      out[2] = C.e;
      out[3] = 1;
      if (this.pitLane) this.pitShift(k, t, out);
      return out;
    }
    // off track (or switching): convert every frame to x/y and interpolate those
    const q = this._q;
    for (let m = 0; m < 4; m++) {
      const j = idx[m];
      if (on[m]) {
        this.curve.at(U[j] / 10, C);
        const d = F[j + 1] / 100;
        q[m][0] = C.x + C.ty * d; q[m][1] = C.y - C.tx * d;
      } else {
        q[m][0] = F[j] / 10; q[m][1] = F[j + 1] / 10;
      }
    }
    out[0] = cr(q[0][0], q[1][0], q[2][0], q[3][0]);
    out[1] = cr(q[0][1], q[1][1], q[2][1], q[3][1]);
    out[2] = NaN;
    out[3] = 0;
    if (this.pitLane) this.pitShift(k, t, out);
    return out;
  }

  tel(k, t) {
    const nf = this.duration * this.hz | 0;
    const i = (k * nf + Math.round(this.frameIndex(t))) * 4;
    const F = this.frames, w = F[i + 3];
    return { speed: F[i + 2], throttle: w & 127, gear: (w >> 7) & 15, drs: (w >> 11) & 1, brake: (w >> 12) & 1 };
  }

  lap(k, t) {
    const L = this.drivers[k].laps;
    const i = bisect(L, t, 1);
    return i < 0 ? 0 : L[i][0];
  }

  leaderLap(t) {
    const i = bisect(this.leaderLaps, t, 1);
    return i < 0 ? 0 : this.leaderLaps[i][0];
  }

  position(k, t) {
    const P = this.drivers[k].pos;
    const i = bisect(P, t);
    return i < 0 ? (P[0] ? P[0][1] : 20) : P[i][1];
  }

  order(t) {
    return this.drivers.map(d => ({ d, p: this.position(d.k, t) })).sort((a, b) => a.p - b.p).map(e => e.d);
  }

  gap(k, t) {
    const I = this.drivers[k].intervals;
    const i = bisect(I, t);
    return i < 0 ? null : { leader: I[i][1], interval: I[i][2] };
  }

  tyre(k, t) {
    const lap = Math.max(1, this.lap(k, t));
    const S = this.drivers[k].stints;
    const s = S.find(s => lap >= s.a && lap <= s.b) || S[S.length - 1];
    if (!s) return null;
    return { comp: s.comp, age: s.age + (lap - s.a), sn: s.sn };
  }

  inPit(k, t) {
    return this.drivers[k].pitWindows.some(p => t >= p.t - 2 && t <= p.t + (p.lane || 25));
  }

  // qualifying phase at time t: {phase, left (s), state: 'running' | 'paused' | 'before' | 'done'}
  qualiPhase(t) {
    const P = this.session && this.session.phases;
    if (!P || !P.length) return null;
    for (const ph of P) {
      if (t < ph.start) return { phase: ph, state: 'before', left: ph.start - t };
      if (t <= ph.end) {
        let paused = 0, inPause = false;
        for (const [a, b] of ph.pauses) {
          if (t > a) paused += Math.min(t, b) - a;
          if (t >= a && t < b) inPause = true;
        }
        const left = Math.max(0, ph.minutes * 60 - (t - ph.start - paused));
        return { phase: ph, state: inPause ? 'paused' : 'running', left };
      }
    }
    return { phase: P[P.length - 1], state: 'done', left: 0 };
  }

  // grid positions that drop out at the end of Q1 and Q2 (22 cars: 6 + 6; 20 cars: 5 + 5)
  qualiCuts() {
    const n = this.drivers.length;
    return [n >= 22 ? 16 : 15, 10];
  }

  pitCount(k, t) {
    return this.drivers[k].pitWindows.filter(p => p.t + 3 < t).length;
  }

  // timing state at time t: last lap of each driver, best laps, sector colours
  timing(t) {
    const best = { lap: Infinity, lapK: -1, s: [Infinity, Infinity, Infinity] };
    const pb = this.drivers.map(() => ({ lap: Infinity, s: [Infinity, Infinity, Infinity] }));
    const last = this.drivers.map(() => null);
    const n = bisect(this.lapEventT, t);
    for (let i = 0; i <= n; i++) {
      const e = this.lapEvents[i];
      const colours = e.s.map((s, j) => {
        if (s == null) return '';
        let c = 'yellow';
        if (s < pb[e.k].s[j]) { pb[e.k].s[j] = s; c = 'green'; }
        if (s < best.s[j]) { best.s[j] = s; c = 'purple'; }
        return c;
      });
      let lc = 'yellow';
      if (e.dur < pb[e.k].lap) { pb[e.k].lap = e.dur; lc = 'green'; }
      if (e.dur < best.lap && e.lap > 1) { best.lap = e.dur; best.lapK = e.k; lc = 'purple'; }
      last[e.k] = { lap: e.lap, dur: e.dur, s: e.s, colours, lc, t: e.t };
    }
    return { best, pb, last };
  }

  // What the marshal light panels show at time t, from race control: { all, sectors } where all is
  // '' | 'red' | 'sc' | 'vsc' | 'chequered' (every panel) and sectors maps a marshal sector number
  // ('TRACK SECTOR n') to 'yellow' | 'dyellow' | 'green' (green for a few seconds after it clears).
  marshalState(t, greenFor = 8) {
    let all = '';
    const yellow = new Map(), green = new Map();
    let allGreenUntil = -1;
    for (const [mt, , cat, flag, msg] of this.race_control) {
      if (mt > t) break;
      if (cat === 'SafetyCar') {
        if (/DEPLOYED/.test(msg)) all = /VIRTUAL|VSC/.test(msg) ? 'vsc' : 'sc';
        if (/ENDING|IN THIS LAP|WITHDRAWN/.test(msg) && (all === 'sc' || all === 'vsc')) { all = ''; allGreenUntil = mt + greenFor; }
      }
      if (cat !== 'Flag') continue;
      const sec = +(String(msg).match(/TRACK SECTOR (\d+)/) || [])[1];
      if ((flag === 'YELLOW' || flag === 'DOUBLE YELLOW') && sec) { yellow.set(sec, flag === 'YELLOW' ? 'yellow' : 'dyellow'); green.delete(sec); }
      else if (flag === 'CLEAR' && sec) { yellow.delete(sec); green.set(sec, mt + greenFor); }
      else if (flag === 'GREEN') { yellow.clear(); if (all === 'red') all = ''; allGreenUntil = mt + greenFor; }
      else if (flag === 'RED') all = 'red';
      else if (flag === 'CHEQUERED') all = 'chequered';
    }
    const sectors = new Map(yellow);
    for (const [n, until] of green) if (t < until && !sectors.has(n)) sectors.set(n, 'green');
    if (t < allGreenUntil && !all) sectors.set('*', 'green');
    return { all, sectors };
  }

  flagState(t) {
    // walk race control flag messages to find the current track status
    let status = 'GREEN', yellow = new Set(), chequered = false, label = '';
    for (const [mt, , cat, flag, msg] of this.race_control) {
      if (mt > t) break;
      if (cat === 'SafetyCar') {
        if (/DEPLOYED/.test(msg)) status = /VIRTUAL|VSC/.test(msg) ? 'VSC' : 'SC';
        if (/ENDING|IN THIS LAP|WITHDRAWN/.test(msg)) status = 'GREEN';
      }
      if (cat !== 'Flag') continue;
      const sec = (msg.match(/SECTOR (\d+)/) || [])[1];
      if (flag === 'YELLOW' || flag === 'DOUBLE YELLOW') { if (sec) yellow.add(sec); }
      else if (flag === 'CLEAR' && sec) yellow.delete(sec);
      else if (flag === 'GREEN') { yellow.clear(); if (status === 'RED') status = 'GREEN'; chequered = false; }
      else if (flag === 'RED') status = 'RED';
      else if (flag === 'CHEQUERED') { chequered = true; status = 'GREEN'; }
    }
    if (chequered) label = 'CHEQUERED';
    else if (status !== 'GREEN') label = status;
    else if (yellow.size) label = 'YELLOW';
    else label = 'GREEN';
    return { label, sectors: [...yellow] };
  }
}
