// First thing the page runs (a classic script, so it doesn't wait for three.js and the module
// graph): shows the Marina Bay map (data/map.svg, scripts/build_loader_map.py), starts downloading
// the session data straight away, and draws the circuit over it (on a canvas) as the loading progresses,
// with the HUD around the progress ring (index.html, styles.css).
// main.js picks the downloads up from window.__boot, starts the 3D camera straight above the same
// framing and crossfades the map into the scene.
(() => {
  const B = window.__boot = { progress: 0, view: null };
  const wrap = document.getElementById('ld-map');
  const live = document.getElementById('ld-live');
  const pctEl = document.getElementById('ld-pct');
  const arc = document.getElementById('ld-arc');
  const chips = [...document.querySelectorAll('#ld-chips span')];
  const ARC = 2 * Math.PI * 33;   // circumference of the reactor's progress ring (r = 33)
  let path = null, total = 0, shown = 0, last = performance.now(), ctx = null, dpr = 1;
  let vb = null;   // the map's viewBox: [x0, y0, w, h] in map metres

  // Fit the focus box (the circuit plus a margin) into the viewport and size the viewBox to the
  // screen, so 1 map metre is exactly `s` CSS pixels everywhere. main.js uses `view` to place the
  // 3D camera so the scene lines up with the map.
  function fit() {
    const svg = wrap.firstElementChild;
    if (!svg) return;
    const [x0, y0, x1, y1] = svg.dataset.focus.split(' ').map(Number);
    const W = window.innerWidth, H = window.innerHeight;
    // leave room for the title block under the map on short / narrow screens
    const s = Math.min(W / (x1 - x0), (H * 0.8) / (y1 - y0));
    const cx = (x0 + x1) / 2, cz = (y0 + y1) / 2 + (H * 0.09) / s;
    vb = [cx - W / 2 / s, cz - H / 2 / s, W / s, H / s];
    svg.setAttribute('viewBox', vb.join(' '));
    B.view = { cx, cz, s, W, H };
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    live.width = Math.round(W * dpr); live.height = Math.round(H * dpr);
  }

  // The circuit draws on its own canvas above the map, so the map (tens of thousands of path
  // segments) is rasterised once and never repainted. A soft wide stroke under a crisp one stands in
  // for a glow filter, and a bright head with a halo leads the line.
  function paint(now) {
    const { s, W, H } = B.view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, live.width, live.height);
    if (shown <= 0) return;
    const k = s * dpr;
    ctx.setTransform(k, 0, 0, k, -vb[0] * k, -vb[1] * k);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.setLineDash([total * shown, total * 2]);
    ctx.strokeStyle = 'rgba(255, 40, 20, .22)'; ctx.lineWidth = 13 / s; ctx.stroke(path);
    ctx.strokeStyle = 'rgba(255, 70, 40, .5)'; ctx.lineWidth = 7 / s; ctx.stroke(path);
    ctx.strokeStyle = '#e10600'; ctx.lineWidth = 4 / s; ctx.stroke(path);
    ctx.setLineDash([]);
    const p = path.pt(total * shown);
    const pulse = 0.5 + 0.5 * Math.sin(now / 160);
    const r = (9 + 3 * pulse) / s, g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.4);
    g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(0.18, 'rgba(255,120,80,.8)'); g.addColorStop(1, 'rgba(255,40,20,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, r * 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p.x, p.y, 3.2 / s, 0, Math.PI * 2); ctx.fill();
  }

  // Progress is eased by real elapsed time, not frame count: after a long frame (the scene building
  // on the main thread) the line catches up in a smooth sweep instead of a jump, and it never
  // overshoots or runs backwards.
  function draw(now) {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    const gap = B.progress - shown;
    if (gap > 0) shown = Math.min(B.progress, shown + Math.max(gap * (1 - Math.exp(-dt * 4.5)), Math.min(gap, dt * 0.025)));
    if (ctx && path && vb) paint(now);
    const pct = Math.round(shown * 100);
    if (pct !== B.pct) {
      B.pct = pct;
      if (pctEl) pctEl.textContent = `${pct}%`;
      if (arc) arc.style.strokeDashoffset = String(ARC * (1 - shown));
      for (const c of chips) if (!c.classList.contains('ok') && shown >= +c.dataset.at - 0.004) c.classList.add('ok');
    }
    if (!B.done) requestAnimationFrame(draw);
  }

  B.setProgress = p => { B.progress = Math.max(B.progress, Math.min(1, p)); };

  B.map = fetch('data/map.svg').then(r => r.text()).then(text => {
    wrap.innerHTML = text;
    fit();
    // lift the circuit out of the map: it is drawn on the canvas instead
    const trk = wrap.querySelector('#ld-track');
    const d = trk.getAttribute('d');
    trk.remove();
    path = new Path2D(d);
    // point at a distance along the circuit (SVG path geometry, measured on a detached copy)
    const ref = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    ref.setAttribute('d', d); ref.setAttribute('fill', 'none');
    wrap.firstElementChild.appendChild(ref);
    total = ref.getTotalLength();
    // sampled once, so the frame loop does no DOM geometry calls
    const N = 1500, pts = [];
    for (let i = 0; i <= N; i++) { const q = ref.getPointAtLength(total * i / N); pts.push([q.x, q.y]); }
    ref.remove();
    path.pt = len => {
      const f = Math.max(0, Math.min(N, len / total * N)), i = Math.min(N - 1, Math.floor(f)), u = f - i;
      return { x: pts[i][0] + (pts[i + 1][0] - pts[i][0]) * u, y: pts[i][1] + (pts[i + 1][1] - pts[i][1]) * u };
    };
    ctx = live.getContext('2d');
    wrap.classList.add('in'); live.classList.add('in');
    window.addEventListener('resize', () => { if (!B.done) fit(); });
  }).catch(() => { /* no map: the plain loader still works */ });
  requestAnimationFrame(draw);

  // Which session to show: #<id> in the link, then the last one picked here, then the newest.
  B.pickSession = sessions => {
    const ids = sessions.map(s => s.id);
    const fromHash = location.hash.slice(1);
    if (ids.includes(fromHash)) return fromHash;
    try {
      const saved = sessionStorage.getItem('f1mb-session');
      if (ids.includes(saved)) return saved;
    } catch { /* storage unavailable */ }
    return ids[0];
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
  B.fetchWithProgress = fetchWithProgress;

  // downloads fill the first 70% of the line; building the scene (main.js) draws the rest
  B.data = (async () => {
    const sessions = await (await fetch('data/sessions.json')).json();
    const id = B.pickSession(sessions);
    const parts = [0, 0, 0], weights = [0.12, 0.18, 0.7];
    const report = () => B.setProgress(0.7 * parts.reduce((a, p, i) => a + p * weights[i], 0));
    const [race, city, bin, bridges] = await Promise.all([
      fetchWithProgress(`data/${id}/race.json`, p => { parts[0] = p; report(); }, 'json'),
      fetchWithProgress('data/city.json', p => { parts[1] = p; report(); }, 'json'),
      fetchWithProgress(`data/${id}/race.bin`, p => { parts[2] = p; report(); }, 'bin'),
      fetch('data/bridges.json').then(r => r.json()),
    ]);
    return { sessions, id, race, city, bin, bridges };
  })();
  B.data.catch(() => { /* reported by main.js */ });
})();
