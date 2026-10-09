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

export async function loadAll(onProgress) {
  const parts = [0, 0, 0];
  const weights = [0.15, 0.15, 0.7];
  const report = () => onProgress(parts.reduce((a, p, i) => a + p * weights[i], 0));
  const [race, city, bin] = await Promise.all([
    fetchWithProgress('data/race.json', p => { parts[0] = p; report(); }, 'json'),
    fetchWithProgress('data/city.json', p => { parts[1] = p; report(); }, 'json'),
    fetchWithProgress('data/race.bin', p => { parts[2] = p; report(); }, 'bin'),
  ]);
  return { race: new Race(race, bin), city };
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
    this.lapEventT = this.lapEvents.map(e => [e.t]);
    this.leaderLaps = this.drivers.find(d => d.finish === 1).laps;
    this.raceEnd = (() => {
      const L = this.leaderLaps[this.leaderLaps.length - 1];
      return L[1] + (L[2] || 95);
    })();
    // per-driver finish time (crossing the line after the leader has finished)
    for (const d of this.drivers) {
      const last = d.laps[d.laps.length - 1];
      d.finishT = last && last[2] ? last[1] + last[2] : Infinity;
    }
    const tr = this.track;
    tr.n = tr.center.length;
  }

  frameIndex(t) { return Math.max(0, Math.min(this.duration * this.hz - 1, t * this.hz)); }

  // Catmull-Rom interpolated position (metres; x=east, y=north) into out[0..1]
  pos(k, t, out) {
    const F = this.frames, nf = this.duration * this.hz | 0, base = k * nf * 4;
    const f = this.frameIndex(t);
    const i = Math.floor(f), u = f - i;
    const g = j => Math.max(0, Math.min(nf - 1, j));
    const i0 = base + g(i - 1) * 4, i1 = base + g(i) * 4, i2 = base + g(i + 1) * 4, i3 = base + g(i + 2) * 4;
    const u2 = u * u, u3 = u2 * u;
    for (let c = 0; c < 2; c++) {
      const p0 = F[i0 + c], p1 = F[i1 + c], p2 = F[i2 + c], p3 = F[i3 + c];
      out[c] = 0.05 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
    }
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
        if (/DEPLOYED/.test(msg)) status = /VIRTUAL/.test(msg) ? 'VSC' : 'SC';
        if (/ENDING|IN THIS LAP|WITHDRAWN/.test(msg)) status = 'GREEN';
      }
      if (cat !== 'Flag') continue;
      const sec = (msg.match(/SECTOR (\d+)/) || [])[1];
      if (flag === 'YELLOW' || flag === 'DOUBLE YELLOW') { if (sec) yellow.add(sec); }
      else if (flag === 'CLEAR' && sec) yellow.delete(sec);
      else if (flag === 'GREEN') yellow.clear();
      else if (flag === 'RED') status = 'RED';
      else if (flag === 'CHEQUERED') chequered = true;
    }
    if (chequered) label = 'CHEQUERED';
    else if (status !== 'GREEN') label = status;
    else if (yellow.size) label = 'YELLOW';
    else label = 'GREEN';
    return { label, sectors: [...yellow] };
  }
}
