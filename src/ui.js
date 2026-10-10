// Broadcast-style overlay: timing tower, driver card, minimap, timeline and race-control toasts.
import { TYRES } from './data.js';
import { MODES, MODE_LABELS } from './camera.js';
import { TITLE } from './config.js';

const $ = (sel, root = document) => root.querySelector(sel);

export function fmtClock(s) {
  const sign = s < 0 ? '-' : '';
  s = Math.abs(s);
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = Math.floor(s % 60);
  return h ? `${sign}${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${sign}${m}:${String(sec).padStart(2, '0')}`;
}
export function fmtLap(s) {
  if (s == null) return '—';
  const m = Math.floor(s / 60), r = s - m * 60;
  return m ? `${m}:${r.toFixed(3).padStart(6, '0')}` : r.toFixed(3);
}

function tyreBadge(t) {
  if (!t) return '';
  const T = TYRES[t.comp] || { c: '#888', l: '?' };
  return `<span class="tyre" style="--tc:${T.c}" title="${t.comp} · ${t.age} laps">${T.l}</span>`;
}

export class UI {
  constructor(race, track, sessions, sessionId, handlers) {
    this.race = race;
    this.track = track;
    this.h = handlers;
    this.buildSessions(sessions, sessionId);
    this.gapMode = 'interval';
    this.rows = new Map();
    this.lastToastT = null;
    this.buildTower();
    this.buildTimeline();
    this.buildControls();
    this.buildMinimap();
    const s = race.session || { name: 'Race', date: '2025-10-05' };
    const date = new Date(`${s.date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    $('#ev-title').innerHTML = `<span class="ev-word">${TITLE.word}</span><span class="ev-gp">${TITLE.sub}</span>`;
    $('#ev-title').setAttribute('aria-label', `${TITLE.word} ${TITLE.sub}`);
    $('#ev-sub').textContent = `${race.circuit} · ${s.name} · ${date}`;
    if (!race.isRace) {
      $('.th-title').textContent = s.name.toUpperCase();
      $('#gap-toggle').hidden = true;
      $('.lapbox .lbl').textContent = 'TIME LEFT';
      $('.lapbox .of').hidden = true;
      $('#lap-total').hidden = true;
    }
    if (race.has_drs === false) {
      $('#t-drs').hidden = true;
      $('#c-drs').hidden = true;
    }
    document.documentElement.style.setProperty('--rows', race.drivers.length);
    $('#wx').innerHTML = `<span>AIR ${race.weather.air.toFixed(0)}°C</span><span>TRACK ${race.weather.track.toFixed(0)}°C</span><span>HUM ${race.weather.humidity.toFixed(0)}%</span>`;
  }

  // ---------------------------------------------------------------- session picker
  buildSessions(sessions, current) {
    const box = $('#sessions');
    for (const s of sessions) {
      const b = document.createElement('button');
      b.textContent = s.label;
      b.title = `${s.name} · ${s.date.slice(0, 10)}`;
      b.classList.toggle('on', s.id === current);
      b.addEventListener('click', () => {
        if (s.id === current) return;
        try { sessionStorage.setItem('f1mb-session', s.id); } catch { /* storage unavailable */ }
        location.hash = s.id;
        location.reload();
      });
      box.appendChild(b);
    }
  }

  // ---------------------------------------------------------------- tower
  buildTower() {
    const list = $('#tower-list');
    for (const d of this.race.drivers) {
      const row = document.createElement('button');
      row.className = 'row';
      row.style.setProperty('--team', d.color);
      row.innerHTML = `<span class="p"></span><span class="team"></span><span class="code">${d.code}</span>
        <span class="flags"></span><span class="gap"></span><span class="ty"></span>`;
      row.addEventListener('click', () => this.h.select(d.k));
      list.appendChild(row);
      this.rows.set(d.k, { row, p: $('.p', row), gap: $('.gap', row), ty: $('.ty', row), flags: $('.flags', row), lastTy: '' });
    }
    $('#gap-toggle').addEventListener('click', () => {
      this.gapMode = this.gapMode === 'interval' ? 'leader' : 'interval';
      $('#gap-toggle').textContent = this.gapMode === 'interval' ? 'INTERVAL' : 'LEADER';
    });
  }

  updateTower(t, order, focusK, timing, cars) {
    const race = this.race;
    if (!race.isRace) return this.updatePracticeTower(t, order, focusK, timing, cars);
    const leaderDone = t >= race.raceEnd;
    order.forEach((d, i) => {
      const r = this.rows.get(d.k);
      r.row.style.transform = `translateY(${i * 100}%)`;
      r.p.textContent = i + 1;
      r.row.classList.toggle('focus', d.k === focusK);
      let gapTxt = '';
      const g = race.gap(d.k, t);
      if (t < race.race_start) gapTxt = '';
      else if (i === 0) gapTxt = this.gapMode === 'interval' ? 'Interval' : 'Leader';
      else if (g) {
        const v = this.gapMode === 'interval' ? g.interval : g.leader;
        gapTxt = typeof v === 'string' ? v : v == null ? '' : `+${v.toFixed(3)}`;
      }
      const inPit = race.inPit(d.k, t);
      const finished = leaderDone && t >= d.finishT;
      if (inPit && t > race.race_start) gapTxt = 'PIT';
      r.gap.textContent = gapTxt;
      r.gap.classList.toggle('pit', inPit && t > race.race_start);
      let flags = '';
      if (timing.best.lapK === d.k) flags += '<span class="fl purple" title="Fastest lap">⏱</span>';
      if (finished) flags += '<span class="fl chq" title="Finished"></span>';
      if (r.flagsHtml !== flags) { r.flags.innerHTML = flags; r.flagsHtml = flags; }
      const ty = race.tyre(d.k, t);
      const key = ty ? ty.comp + ty.age : '';
      if (key !== r.lastTy) { r.ty.innerHTML = tyreBadge(ty); r.lastTy = key; }
    });
  }

  // practice / qualifying: ordered by best lap, gap to the fastest time
  updatePracticeTower(t, order, focusK, timing, cars) {
    const race = this.race;
    const best = timing.best.lap;
    // qualifying: drivers knocked out in earlier phases are greyed, the live cut-off is marked
    const q = race.qualiPhase(t);
    let outFrom = Infinity, cutAt = null;
    if (q) {
      const [c1, c2] = race.qualiCuts();
      const n = q.phase.n;
      // phases fully completed so far decide who is out; the running phase shows its cut line
      const completed = q.state === 'done' ? n : n - 1;
      if (completed >= 2) outFrom = c2; else if (completed === 1) outFrom = c1;
      if (q.state === 'running' || q.state === 'paused') cutAt = n === 1 ? c1 : n === 2 ? c2 : null;
    }
    const line = $('#cutline');
    line.hidden = cutAt == null;
    if (cutAt != null) line.style.transform = `translateY(calc(${cutAt} * var(--row-h) - 1px))`;
    order.forEach((d, i) => {
      const r = this.rows.get(d.k);
      r.row.style.transform = `translateY(${i * 100}%)`;
      r.p.textContent = i + 1;
      r.row.classList.toggle('focus', d.k === focusK);
      r.row.classList.toggle('out', i >= outFrom);
      const pb = timing.pb[d.k].lap;
      let gapTxt;
      if (pb === Infinity) gapTxt = 'NO TIME';
      else if (pb === best) gapTxt = fmtLap(pb);
      else gapTxt = `+${(pb - best).toFixed(3)}`;
      const inPit = cars[d.k].offTrack && t > race.race_start;
      r.gap.textContent = inPit ? 'PIT' : gapTxt;
      r.gap.classList.toggle('pit', inPit);
      r.gap.classList.toggle('none', pb === Infinity && !inPit);
      const flags = timing.best.lapK === d.k ? '<span class="fl purple" title="Fastest lap">⏱</span>' : '';
      if (r.flagsHtml !== flags) { r.flags.innerHTML = flags; r.flagsHtml = flags; }
      const ty = race.tyre(d.k, t);
      const key = ty ? ty.comp + ty.age : '';
      if (key !== r.lastTy) { r.ty.innerHTML = tyreBadge(ty); r.lastTy = key; }
    });
  }

  // ---------------------------------------------------------------- driver card
  updateCard(t, k, timing) {
    const race = this.race, d = race.drivers[k];
    const card = $('#card');
    card.style.setProperty('--team', d.color);
    if (this.cardK !== k) {
      this.cardK = k;
      $('#card-num').textContent = d.num;
      $('#card-first').textContent = d.first;
      $('#card-last').textContent = d.last.toUpperCase();
      $('#card-team').textContent = d.team;
    }
    const tel = race.tel(k, t);
    $('#c-speed').textContent = tel.speed;
    $('#c-gear').textContent = tel.gear === 0 ? 'N' : tel.gear;
    $('#c-thr').style.transform = `scaleX(${tel.throttle / 100})`;
    $('#c-brk').style.transform = `scaleX(${tel.brake ? 1 : 0})`;
    $('#c-drs').classList.toggle('on', !!tel.drs);
    const rpmPct = Math.min(1, tel.speed / 340);
    $('#c-arc').style.strokeDashoffset = String(251 * (1 - rpmPct));
    const pos = race.order(t).findIndex(x => x.k === k) + 1;
    $('#c-pos').textContent = `P${pos}`;
    const lap = race.lap(k, t);
    $('#c-lap').textContent = lap ? `LAP ${lap}` : 'GRID';
    const ty = race.tyre(k, t);
    $('#c-tyre').innerHTML = ty ? `${tyreBadge(ty)}<span>${ty.comp[0] + ty.comp.slice(1).toLowerCase()} · ${ty.age} laps</span>` : '';
    if (race.isRace) $('#c-stops').textContent = `${race.pitCount(k, t)} stop${race.pitCount(k, t) === 1 ? '' : 's'}`;
    else $('#c-stops').parentElement.hidden = true;
    const last = timing.last[k];
    $('#c-last').textContent = last ? fmtLap(last.dur) : '—';
    $('#c-last').className = `v ${last ? last.lc : ''}`;
    const pb = timing.pb[k].lap;
    $('#c-best').textContent = pb < Infinity ? fmtLap(pb) : '—';
    for (let j = 0; j < 3; j++) {
      const el = $(`#c-s${j + 1}`);
      el.textContent = last && last.s[j] ? last.s[j].toFixed(3) : '—';
      el.className = `sec ${last ? last.colours[j] : ''}`;
    }
  }

  // ---------------------------------------------------------------- minimap
  buildMinimap() {
    const svg = $('#minimap');
    const P = this.track.P;
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
    for (const p of P) { minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x); minz = Math.min(minz, p.z); maxz = Math.max(maxz, p.z); }
    const pad = 40;
    this.mm = { minx: minx - pad, minz: minz - pad, w: maxx - minx + pad * 2, h: maxz - minz + pad * 2 };
    svg.setAttribute('viewBox', `${this.mm.minx} ${this.mm.minz} ${this.mm.w} ${this.mm.h}`);
    const d = 'M' + P.filter((_, i) => i % 2 === 0).map(p => `${p.x.toFixed(1)},${p.z.toFixed(1)}`).join('L') + 'Z';
    const drs = this.track.drs.map(([a, b]) => {
      const pts = [];
      for (let i = a; i <= b; i += 2) pts.push(P[i % P.length]);
      return 'M' + pts.map(p => `${p.x.toFixed(1)},${p.z.toFixed(1)}`).join('L');
    }).join('');
    const corners = this.track.corners.map(c => {
      const p = P[c.i], n = this.track.N[c.i], s = this.track.curv[c.i] > 0 ? -1 : 1;
      return `<text x="${(p.x + n.x * s * 42).toFixed(0)}" y="${(p.z + n.z * s * 42).toFixed(0)}">${c.n}</text>`;
    }).join('');
    const sf = P[0], sfn = this.track.N[0];
    svg.innerHTML = `<path class="mm-out" d="${d}"/><path class="mm-track" d="${d}"/>${this.race.has_drs === false ? '' : `<path class="mm-drs" d="${drs}"/>`}
      <line class="mm-sf" x1="${sf.x + sfn.x * 22}" y1="${sf.z + sfn.z * 22}" x2="${sf.x - sfn.x * 22}" y2="${sf.z - sfn.z * 22}"/>
      <g class="mm-corners">${corners}</g><g id="mm-dots"></g>`;
    const g = $('#mm-dots');
    this.dots = this.race.drivers.map(dr => {
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      c.innerHTML = `<circle r="17" fill="${dr.color}"/><text y="6">${dr.code[0]}</text>`;
      c.style.cursor = 'pointer';
      c.addEventListener('click', () => this.h.select(dr.k));
      g.appendChild(c);
      return c;
    });
  }

  updateMinimap(cars, order, focusK) {
    // draw back-to-front so the leader sits on top
    const g = $('#mm-dots');
    for (let i = order.length - 1; i >= 0; i--) {
      const k = order[i].k, c = cars[k], dot = this.dots[k];
      dot.setAttribute('transform', `translate(${c.world.x.toFixed(1)},${c.world.z.toFixed(1)})`);
      dot.classList.toggle('focus', k === focusK);
      g.appendChild(dot);
    }
    g.appendChild(this.dots[focusK]);
  }

  // ---------------------------------------------------------------- timeline
  buildTimeline() {
    const race = this.race;
    const bar = $('#scrub');
    const ticks = $('#scrub-ticks');
    const pct = t => `${(t / race.duration) * 100}%`;
    let html = '';
    if (race.isRace) {
      for (const [lap, start] of race.leaderLaps) {
        const major = lap === 1 || lap % 10 === 0;
        html += `<span class="tick${major ? ' major' : ''}" style="left:${pct(start)}">${major ? `<b>L${lap}</b>` : ''}</span>`;
      }
    } else {
      // session clock: a tick every 5 minutes, labelled every 10
      for (let m = 0; race.race_start + m * 60 <= race.duration; m += 5) {
        const major = m % 10 === 0;
        html += `<span class="tick${major ? ' major' : ''}" style="left:${pct(race.race_start + m * 60)}">${major ? `<b>${m}'</b>` : ''}</span>`;
      }
    }
    for (const p of race.pits) {
      const d = race.drivers[race.byNum.get(p[1])];
      html += `<span class="mk pit" style="left:${pct(p[0])};--c:${d.color}" title="${d.code} pit stop, lap ${p[2]}"></span>`;
    }
    // yellow flag spans
    let open = null;
    for (const [t, , cat, flag, msg] of race.race_control) {
      if (cat !== 'Flag' || t < 0) continue;
      if (/YELLOW/.test(flag || '') && open == null) open = t;
      if ((flag === 'CLEAR' || flag === 'GREEN') && open != null) {
        html += `<span class="mk yellow" style="left:${pct(open)};width:${pct(Math.max(4, t - open))}" title="${msg}"></span>`;
        open = null;
      }
    }
    html += `<span class="mk chq" style="left:${pct(race.raceEnd)}" title="Chequered flag"></span>`;
    ticks.innerHTML = html;
    const seek = (e) => {
      const r = bar.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      this.h.seek(f * race.duration);
    };
    let drag = false;
    bar.addEventListener('pointerdown', e => { drag = true; bar.setPointerCapture(e.pointerId); seek(e); });
    bar.addEventListener('pointermove', e => {
      const r = bar.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const hov = $('#scrub-hover');
      const tt = f * race.duration;
      const lap = race.leaderLap(tt);
      if (race.isRace) hov.textContent = tt < race.race_start ? 'Formation' : `Lap ${lap} · ${fmtClock(tt - race.race_start)}`;
      else hov.textContent = tt < race.race_start ? 'Before the session' : fmtClock(tt - race.race_start);
      hov.style.left = `${f * 100}%`;
      if (drag) seek(e);
    });
    bar.addEventListener('pointerup', () => { drag = false; });
  }

  updateTimeline(t) {
    const race = this.race;
    $('#scrub-fill').style.width = `${(t / race.duration) * 100}%`;
    const el = t - race.race_start;
    $('#clock').textContent = el < 0 ? `START IN ${fmtClock(-el)}` : fmtClock(Math.min(el, race.raceEnd - race.race_start + (t > race.raceEnd ? t - race.raceEnd : 0)));
    const local = new Date(Date.parse(race.t0) + t * 1000 + 8 * 3600 * 1000);
    $('#local').textContent = `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')} SGT`;
    if (race.isRace) {
      const lap = race.leaderLap(t);
      $('#lap-now').textContent = t < race.race_start ? '—' : Math.min(lap, race.total_laps);
      $('#lap-total').textContent = race.total_laps;
    } else {
      const q = race.qualiPhase(t);
      if (q) {
        // knockout qualifying: phase clock (stops during red flags), countdown to the next phase
        // phase as a red chip, then what the clock means: [SQ1] TIME LEFT 9:54
        const words = { before: 'STARTS IN', done: '' }[q.state] ?? 'TIME LEFT';
        const html = `<span class="ph">${q.phase.name}</span>${words}`;
        const lbl = $('.lapbox .lbl');
        if (lbl.innerHTML !== html) lbl.innerHTML = html;
        $('#lap-now').textContent = q.state === 'done' ? 'FINISHED' : fmtClock(q.left);
      } else {
        $('#lap-now').textContent = fmtClock(Math.max(0, race.raceEnd - Math.max(t, race.race_start)));
      }
    }
    const fs = race.flagState(t);
    const chip = $('#flag');
    const label = t < race.race_start ? (race.isRace ? 'FORMATION' : 'PIT EXIT CLOSED') : fs.label;
    chip.dataset.flag = label;
    chip.textContent = label === 'YELLOW' ? `YELLOW · S${fs.sectors.join(', S')}` : label;
  }

  // ---------------------------------------------------------------- controls
  buildControls() {
    $('#play').addEventListener('click', () => this.h.togglePlay());
    $('#back').addEventListener('click', () => this.h.skip(-10));
    $('#fwd').addEventListener('click', () => this.h.skip(10));
    const speeds = [1, 2, 5, 10, 30, 60];
    const sp = $('#speeds');
    sp.innerHTML = speeds.map(s => `<button data-s="${s}">${s}×</button>`).join('');
    sp.addEventListener('click', e => { const s = e.target.dataset.s; if (s) this.h.speed(+s); });
    const cams = $('#cams');
    cams.innerHTML = MODES.map((m, i) => `<button data-m="${m}" title="${MODE_LABELS[m]} (${i + 1})">${MODE_LABELS[m]}</button>`).join('');
    cams.addEventListener('click', e => { const m = e.target.dataset.m; if (m) this.h.camera(m); });
    for (const id of ['labels', 'trails', 'drs', 'reflect']) {
      const b = $(`#t-${id}`);
      b.addEventListener('click', () => { b.classList.toggle('on'); this.h.toggle(id, b.classList.contains('on')); });
    }
    $('#fs').addEventListener('click', () => {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.()?.catch(() => {});
      else document.exitFullscreen?.()?.catch(() => {});
    });
    $('#help-btn').addEventListener('click', () => $('#help').classList.toggle('show'));
    $('#help').addEventListener('click', () => $('#help').classList.remove('show'));
    $('#tower-collapse').addEventListener('click', () => $('#tower').classList.toggle('collapsed'));
  }

  setPlaying(p) { $('#play').classList.toggle('playing', p); $('#play').setAttribute('aria-label', p ? 'Pause' : 'Play'); }
  setSpeed(s) { document.querySelectorAll('#speeds button').forEach(b => b.classList.toggle('on', +b.dataset.s === s)); }
  setCamera(m) { document.querySelectorAll('#cams button').forEach(b => b.classList.toggle('on', b.dataset.m === m)); }

  // ---------------------------------------------------------------- toasts
  toasts(prevT, t) {
    if (prevT == null || t < prevT || t - prevT > 5) return; // only while playing forward
    const race = this.race;
    for (const [mt, , cat, flag, msg] of race.race_control) {
      if (mt <= prevT || mt > t) continue;
      if (flag === 'BLUE' || /^DRS (EN|DIS)ABLED IN ZONE/.test(msg)) continue;
      let kind = 'rc';
      if (/YELLOW/.test(flag || '')) kind = 'yellow';
      else if (flag === 'GREEN' || flag === 'CLEAR') kind = 'green';
      else if (flag === 'CHEQUERED') kind = 'chq';
      else if (/PENALTY|INVESTIGAT|DELETED/.test(msg)) kind = 'steward';
      this.toast(kind, cat === 'Flag' ? 'TRACK STATUS' : 'RACE CONTROL', msg);
    }
    for (const [ot, a, b, pos] of race.overtakes) {
      if (ot <= prevT || ot > t || pos > 10) continue;
      const A = race.drivers[race.byNum.get(a)], B = race.drivers[race.byNum.get(b)];
      this.toast('ovt', 'OVERTAKE', `<b style="color:${A.color}">${A.code}</b> passes <b style="color:${B.color}">${B.code}</b> for P${pos}`, true);
    }
    for (const e of race.lapEvents) {
      if (e.t <= prevT || e.t > t || !e.overallBest || e.t < race.race_start) continue;
      const d = race.drivers[e.k];
      this.toast('fl', 'FASTEST LAP', `<b style="color:${d.color}">${d.code}</b> ${fmtLap(e.dur)}`, true);
    }
    for (const p of race.isRace ? race.pits : []) {
      if (p[0] <= prevT || p[0] > t) continue;
      const d = race.drivers[race.byNum.get(p[1])];
      const stop = p[3] ? ` · ${p[3].toFixed(1)}s stop` : '';
      this.toast('pit', 'PIT STOP', `<b style="color:${d.color}">${d.code}</b> pits on lap ${p[2]}${stop}`, true);
    }
  }

  toast(kind, title, body, html = false) {
    const box = $('#toasts');
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.innerHTML = `<div class="tt">${title}</div><div class="tb"></div>`;
    if (html) $('.tb', el).innerHTML = body; else $('.tb', el).textContent = body;
    box.prepend(el);
    while (box.children.length > 4) box.lastChild.remove();
    setTimeout(() => el.classList.add('out'), 5200);
    setTimeout(() => el.remove(), 5800);
  }
}
