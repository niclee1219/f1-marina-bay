// Loads the pre-built race/city data and answers "what is happening at time t" queries.
// Time t is seconds since race.t0 (grid, before the formation lap).

export const TYRES = {
  SOFT: { c: '#ff2d2c', l: 'S' },
  MEDIUM: { c: '#ffd12e', l: 'M' },
  HARD: { c: '#f0f0ec', l: 'H' },
  INTERMEDIATE: { c: '#43b047', l: 'I' },
  WET: { c: '#0090ff', l: 'W' },
};

async function fetchWithProgress(url, onProgress, type) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const total = +res.headers.get('content-length') || 0;
  if (!res.body || !total) {
    onProgress(1);
    return type === 'json' ? res.json() : res.arrayBuffer();
  }
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress(Math.min(1, got / total));
  }
  const buf = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { buf.set(c, o); o += c.length; }
  return type === 'json' ? JSON.parse(new TextDecoder().decode(buf)) : buf.buffer;
}

// Which session to show: #<id> in the link, then the last one picked here, then the newest.
export function pickSession(sessions) {
  const ids = sessions.map(s => s.id);
  const fromHash = location.hash.slice(1);
  if (ids.includes(fromHash)) return fromHash;
  try {
    const saved = sessionStorage.getItem('f1mb-session');
    if (ids.includes(saved)) return saved;
  } catch { /* storage unavailable */ }
  return ids[0];
}

export async function loadAll(onProgress) {
  const sessions = await (await fetch('data/sessions.json')).json();
  const id = pickSession(sessions);
  const parts = [0, 0, 0];
  const weights = [0.15, 0.15, 0.7];
  const report = () => onProgress(parts.reduce((a, p, i) => a + p * weights[i], 0));
  const [race, city, bin] = await Promise.all([
    fetchWithProgress(`data/${id}/race.json`, p => { parts[0] = p; report(); }, 'json'),
    fetchWithProgress('data/city.json', p => { parts[1] = p; report(); }, 'json'),
    fetchWithProgress(`data/${id}/race.bin`, p => { parts[2] = p; report(); }, 'bin'),
  ]);
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
      const s = cr(sv[0], sv[1], sv[2], sv[3]), d = cr(dv[0], dv[1], dv[2], dv[3]);
      this.curve.at(s, C);
      out[0] = C.x + C.ty * d;
      out[1] = C.y - C.tx * d;
      out[2] = C.e;
      out[3] = 1;
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
