// First thing the page runs (a classic script, so it doesn't wait for three.js and the module
// graph): shows the Marina Bay map (data/map.svg, scripts/build_loader_map.py), starts downloading
// the session data straight away, and draws the circuit on the map as the loading progresses.
// main.js picks the downloads up from window.__boot, starts the 3D camera straight above the same
// framing and crossfades the map into the scene.
(() => {
  const B = window.__boot = { progress: 0, view: null };
  const wrap = document.getElementById('ld-map');
  const pctEl = document.getElementById('ld-pct');
  let trk = null, head = null, total = 0, shown = 0;

  // Fit the focus box (the circuit plus a margin) into the viewport and size the viewBox to the
  // screen, so 1 map metre is exactly `s` CSS pixels everywhere. main.js uses `view` to place the
  // 3D camera so the scene lines up with the map.
  function fit() {
    const svg = wrap.firstElementChild;
    if (!svg) return;
    const [x0, y0, x1, y1] = svg.dataset.focus.split(' ').map(Number);
    const W = window.innerWidth, H = window.innerHeight;
    // leave room for the title block under the map on short / narrow screens
    const s = Math.min(W / (x1 - x0), (H * 0.86) / (y1 - y0));
    const cx = (x0 + x1) / 2, cz = (y0 + y1) / 2 + (H * 0.06) / s;
    svg.setAttribute('viewBox', `${cx - W / 2 / s} ${cz - H / 2 / s} ${W / s} ${H / s}`);
    B.view = { cx, cz, s, W, H };
  }

  // the circuit line is drawn up to the eased progress, with a glowing "car" at its head
  function draw() {
    shown += (B.progress - shown) * 0.2;
    if (B.progress - shown < 0.001) shown = B.progress;
    if (trk) {
      trk.style.strokeDashoffset = String(1 - shown);
      const p = trk.getPointAtLength(total * shown);
      head.setAttribute('cx', p.x); head.setAttribute('cy', p.y);
    }
    if (pctEl) pctEl.textContent = `${Math.round(shown * 100)}%`;
    if (!B.done) requestAnimationFrame(draw);
  }

  B.setProgress = p => { B.progress = Math.max(B.progress, Math.min(1, p)); };

  B.map = fetch('data/map.svg').then(r => r.text()).then(text => {
    wrap.innerHTML = text;
    fit();
    trk = wrap.querySelector('#ld-track');
    total = trk.getTotalLength();
    head = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    head.setAttribute('class', 'trk-head');
    head.setAttribute('r', String(Math.max(6, 5 / B.view.s)));
    trk.after(head);
    wrap.classList.add('in');
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
