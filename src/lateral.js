// Keeps cars from driving through each other.
//
// The telemetry gives every car a lateral offset d from the centreline, but cars running nose to
// tail, or one passing another, are almost always recorded on the same line (the feed is ~4 Hz
// and a few tenths of a metre coarse), so in a pass the two models would overlap. Each frame this
// looks only at cars adjacent in arc length s: where two are closer than LATERAL.overlapS along the
// track and LATERAL.gapD across it, it asks them to move apart sideways to gapD, within the track
// limits. The ask is a target; the car's actual sideways offset follows it through a critically
// damped spring (LATERAL.ease), so a car never snaps sideways and settles back after the pass.
//
// Sign convention here and in data.js: d is positive to the RIGHT of travel (the +N side).
import { LATERAL, TRACK_HALF_WIDTH } from './config.js';

const HIST = 512;          // offset samples kept per car for the trails
const HIST_DT = 0.03;      // replay seconds between samples
const MAX_LEAD = 12;       // furthest ahead of the overlap (m along the track) a closing pair starts moving apart
const LEAD_TIME = 1.6;     // ...as a multiple of the ease time, so the gap has opened by the time they reach each other
const LEAN_FLIP = 1.0;     // recorded lateral difference (m) strong enough to overrule a chosen side

export class Separation {
  constructor(race, track) {
    this.race = race;
    this.track = track;
    this.tmp = [0, 0, 0, 0, 0, 0];
    this.mem = new Map();    // driver pair -> side the lower-numbered driver holds (+1 right, -1 left)
    this.lastT = -1e9;
    this.pairs = [];         // overlapping pairs found this frame (read by the debug view)
  }

  attach(c) {
    c.off = 0; c.offV = 0; c.target = 0; c.baseS = 0; c.baseD = 0; c.sepV = 0; c.sepOK = false;
    c.hT = new Float32Array(HIST); c.hO = new Float32Array(HIST); c.hN = 0; c.hHead = 0;
  }

  // +1 / -1: the side the next corner bends toward, i.e. the inside, where a pass is made under braking
  insideAt(s) {
    const tr = this.track, n = tr.n;
    let acc = 0;
    for (let m = 30; m <= 120; m += 15) acc += tr.curv[Math.round((s + m) / tr.bin) % n];
    return acc >= 0 ? 1 : -1;
  }

  solve(cars, t, dt, jumped) {
    const { race } = this, o = this.tmp, L = race.curve.L, half = TRACK_HALF_WIDTH - LATERAL.carWidth / 2;
    const jump = jumped || t < this.lastT - 1e-3 || t - this.lastT > Math.max(1, dt * 2 + 0.1);
    this.lastT = t;
    const list = [];
    for (const c of cars) {
      c.target = 0;
      race.pos(c.d.k, t, o);
      c.baseS = o[4]; c.baseD = o[5];
      // on the track proper and moving: not the grid, the garage or the pit lane
      const kph = race.tel(c.d.k, t).speed;
      c.sepV = kph / 3.6;
      c.sepOK = o[3] === 1 && kph >= LATERAL.minKph && !race.inPit(c.d.k, t);
      if (c.sepOK) list.push(c);
    }
    list.sort((a, b) => a.baseS - b.baseS);

    // pairs adjacent in s (a behind, b ahead), going round the lap
    const pairs = this.pairs; pairs.length = 0;
    const n = list.length;
    for (let i = 0; i < n; i++) {
      for (let m = 1; m < n; m++) {
        const a = list[i], b = list[(i + m) % n];
        const ds = (b.baseS - a.baseS + L) % L;
        if (ds >= LATERAL.overlapS + MAX_LEAD) break;
        // a car closing on another starts moving over early enough to be clear when it arrives
        const lead = Math.min(MAX_LEAD, Math.max(0, a.sepV - b.sepV) * LATERAL.ease * LEAD_TIME);
        if (ds >= LATERAL.overlapS + lead) continue;
        if (Math.abs(a.baseD - b.baseD) >= LATERAL.gapD) continue;
        pairs.push({ a, b, ds, side: this.sideOf(a, b, t) });
      }
    }

    // push apart; three sweeps let a chain of cars (three abreast) settle
    const move = (c, dd) => {
      const lim = Math.max(half, Math.abs(c.baseD));
      const d0 = c.baseD + c.target, d1 = Math.max(-lim, Math.min(lim, d0 + dd));
      c.target += d1 - d0;
      return d1 - d0;
    };
    for (let sweep = 0; sweep < 3 && pairs.length; sweep++) {
      for (const p of pairs) {
        const { a, b } = p, low = a.d.k < b.d.k ? a : b, high = low === a ? b : a, side = p.side;
        const deficit = LATERAL.gapD - (low.baseD + low.target - high.baseD - high.target) * side;
        if (deficit <= 1e-3) continue;
        // each moves apart by half; `used` counts only movement in the wanted direction
        const usedLow = side * move(low, side * deficit / 2), usedHigh = -side * move(high, -side * deficit / 2);
        let rem = deficit - usedLow - usedHigh;
        // a car against the limit cannot give way: the other one takes the rest
        if (rem > 1e-3) rem -= side * move(low, side * rem);
        if (rem > 1e-3) move(high, -side * rem);
      }
    }
    for (const [key, v] of this.mem) if (t - v.t > 2 || t < v.t) this.mem.delete(key);

    // ease each offset toward its target (critically damped, exact for a fixed target over dt)
    const w = 5 / LATERAL.ease;
    for (const c of cars) {
      if (jump) { c.off = c.target; c.offV = 0; c.hN = 0; c.hHead = 0; continue; }
      if (dt > 0) {
        const x0 = c.off - c.target, k = c.offV + w * x0, e = Math.exp(-w * dt);
        c.off = c.target + (x0 + k * dt) * e;
        c.offV = (c.offV - w * k * dt) * e;
      }
    }
    for (const c of cars) this.record(c, t);
  }

  // Which side the lower-numbered driver of the pair holds. Taken from the recorded lateral lean
  // when that is clear; otherwise the car behind takes the inside of the next corner. Once chosen
  // it sticks for as long as the pair stays close, so a pass is made on one side only.
  sideOf(a, b, t) {
    const low = a.d.k < b.d.k ? a : b, high = low === a ? b : a;
    const key = low.d.k * 64 + high.d.k;
    const lean = low.baseD - high.baseD;
    let v = this.mem.get(key);
    if (!v) {
      let side;
      if (Math.abs(lean) >= LATERAL.leanMin) side = Math.sign(lean);
      else {
        const behind = this.insideAt(a.baseS);        // a is behind b
        side = low === a ? behind : -behind;
      }
      v = { side, t };
      this.mem.set(key, v);
    } else if (Math.abs(lean) >= LEAN_FLIP && Math.sign(lean) !== v.side) v.side = Math.sign(lean);
    v.t = t;
    return v.side;
  }

  record(c, t) {
    const last = c.hN ? c.hT[(c.hHead - 1 + HIST) % HIST] : -1e9;
    if (t - last < HIST_DT && t >= last) return;
    c.hT[c.hHead] = t; c.hO[c.hHead] = c.off;
    c.hHead = (c.hHead + 1) % HIST; c.hN = Math.min(HIST, c.hN + 1);
  }

  // The car's lateral push at replay time tau (past: from the history, ahead: along its current
  // velocity, for the heading), so trails and heading follow where the car really was / is going.
  offAt(c, tau, t) {
    if (tau >= t) return c.off + c.offV * Math.min(tau - t, 0.3);
    const n = c.hN;
    if (!n) return c.off;
    const idx = i => (c.hHead - n + i + HIST) % HIST;
    if (tau <= c.hT[idx(0)]) return c.hO[idx(0)];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (c.hT[idx(mid)] <= tau) lo = mid; else hi = mid; }
    const t0 = c.hT[idx(lo)], t1 = c.hT[idx(hi)], f = t1 > t0 ? Math.min(1, (tau - t0) / (t1 - t0)) : 0;
    return c.hO[idx(lo)] + (c.hO[idx(hi)] - c.hO[idx(lo)]) * f;
  }
}
