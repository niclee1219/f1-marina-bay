// Marina Bay pit complex: a long three-level building on the OSM "F1 Pit Building" footprint,
// fronting the pit lane. Garages at ground level, glass offices above, the Paddock Club with a
// cantilevered balcony, a rooftop hospitality deck, team pit-wall stands and the pit-exit light.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { obb, toWorld } from './skyline.js';
import { PIT_SIGN } from './config.js';
import { OVERVIEW } from './camera.js';

const G0 = 6.5, L1 = 11, L2 = 16;     // garage roof, office roof, Paddock Club roof (m)
const DEPTH = 30;                      // building depth from the pit-lane face

function teamBoards(teams) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 64 * teams.length;
  const x = c.getContext('2d');
  teams.forEach(([name, col], i) => {
    x.fillStyle = '#0d0e12'; x.fillRect(0, i * 64, 512, 64);
    x.fillStyle = col; x.fillRect(0, i * 64 + 54, 512, 10); x.fillRect(0, i * 64, 14, 64);
    x.fillStyle = '#ffffff';
    x.font = 'italic 900 34px "Titillium Web", sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(name.toUpperCase(), 263, i * 64 + 28);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// One cell per letter: top row crisp (alpha-tested face), bottom row blurred (backlight halo).
function letterAtlas(word) {
  const cw = 256, ch = 320, c = document.createElement('canvas');
  c.width = cw * word.length; c.height = ch * 2;
  const x = c.getContext('2d');
  const base = ch * 0.8;
  x.font = `900 ${Math.round(ch * 0.8)}px "Titillium Web", sans-serif`;
  x.textAlign = 'center'; x.textBaseline = 'alphabetic';
  const cap = x.measureText('S').actualBoundingBoxAscent || ch * 0.57;
  const widths = [];
  [...word].forEach((L, i) => {
    widths.push(x.measureText(L).width);
    x.fillStyle = '#fff';
    x.filter = 'none';
    x.fillText(L, cw * (i + 0.5), base);
    x.filter = 'blur(16px)';
    x.strokeStyle = '#fff'; x.lineWidth = 26; x.lineJoin = 'round';
    x.strokeText(L, cw * (i + 0.5), ch + base);
    x.fillText(L, cw * (i + 0.5), ch + base);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { tex, cw, ch, base, cap, widths };
}

// Backlit SINGAPORE letters standing along the roof, on a dark steel truss. Built facing local
// +z with the word centred on x = 0; `flip` turns it to face -z (still reading left to right).
function roofSign(len, flip) {
  const S = PIT_SIGN, word = S.word, n = word.length;
  const A = letterAtlas(word), k = S.height / A.cap;       // metres per atlas pixel
  const pw = A.cw * k, ph = A.ch * k;
  const span = len * S.fill, pitch = span / n;
  const bottom = S.lift;
  const face = [], halo = [], truss = [];
  for (let i = 0; i < n; i++) {
    const xc = -span / 2 + (i + 0.5) * pitch;
    const yc = bottom + (A.base - A.ch / 2) * k;           // baseline sits on `bottom`
    for (const [list, row, scale, dz] of [[face, 0, 1, 0], [halo, 1, 1.18, -0.9]]) {
      const g = new THREE.PlaneGeometry(pw * scale, ph * scale);
      const uv = g.attributes.uv;
      for (let q = 0; q < uv.count; q++) uv.setXY(q, (i + uv.getX(q)) / n, (1 - row) * 0.5 + uv.getY(q) * 0.5);
      list.push(g.translate(xc, yc + (scale - 1) * ph * 0.08, dz));
    }
    // a post behind every letter down to the roof
    const lw = A.widths[i] * k;
    for (const s of [-0.3, 0.3]) truss.push(new THREE.BoxGeometry(0.35, bottom + S.height * 0.9, 0.35).translate(xc + s * lw, (bottom + S.height * 0.9) / 2, -1.6));
  }
  // horizontal chords and a diagonal brace line
  for (const y of [bottom - 0.4, bottom + S.height * 0.55]) truss.push(new THREE.BoxGeometry(span, 0.5, 0.5).translate(0, y, -1.6));
  for (let i = 0; i < n; i++) {
    const g = new THREE.BoxGeometry(0.22, Math.hypot(pitch, S.height * 0.55), 0.22);
    g.rotateZ(Math.atan2(pitch, S.height * 0.55) * (i % 2 ? 1 : -1));
    truss.push(g.translate(-span / 2 + (i + 0.5) * pitch, bottom + S.height * 0.27, -1.7));
  }
  // matte black board behind the letters: the halo glows on it, and it keeps the white faces
  // readable against the floodlit roof and the city lights beyond
  const board = new THREE.BoxGeometry(span + pitch * 0.25, S.height * 1.45, 0.3).translate(0, bottom + S.height * 0.48, -1.15);
  const geos = { face: mergeGeometries(face), halo: mergeGeometries(halo), truss: mergeGeometries(truss), board };
  if (flip) Object.values(geos).forEach(g => g.rotateY(Math.PI));
  const mats = {
    face: new THREE.MeshBasicMaterial({ map: A.tex, color: new THREE.Color(...S.face), alphaTest: 0.5, side: THREE.DoubleSide }),
    halo: new THREE.MeshBasicMaterial({ map: A.tex, color: new THREE.Color(...S.halo), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    truss: new THREE.MeshStandardMaterial({ color: 0x1a1c22, metalness: 0.6, roughness: 0.5 }),
    board: new THREE.MeshBasicMaterial({ color: 0x040406 }),
  };
  return Object.entries(geos).map(([key, geo]) => {
    const m = new THREE.Mesh(geo, mats[key]);
    m.name = `pit-sign-${key}`;
    return m;
  });
}

export function buildPitComplex(g, city, race, track) {
  const pitPts = race.track.pit;
  const fp = city.buildings.find(b => b.n === 'F1 Pit Building');
  const out = { decks: [], setExit() {} };
  if (!fp || pitPts.length < 4) return out;
  const o = obb(fp.p);
  // lane centre beside the middle of the building; local +z faces it
  let best = null;
  for (const p of pitPts) {
    const d = Math.hypot(p[0] - o.cx, p[1] - o.cy);
    if (!best || d < best.d) best = { d, p };
  }
  const zdir = [Math.sin(o.a), -Math.cos(o.a)];
  let dz = (best.p[0] - o.cx) * zdir[0] + (best.p[1] - o.cy) * zdir[1];
  const a = dz >= 0 ? o.a : o.a + Math.PI;
  dz = Math.abs(dz);
  const front = dz - 6.8;              // garage doors stand just off the working lane
  const len = o.len * 0.96;
  const cx = o.cx, cy = o.cy;
  const y0 = track.P[track.nearest(cx, -cy).i].y - 0.18;
  const place = geo => toWorld(geo.translate(0, y0, 0), cx, cy, a);

  const teams = [...new Map(race.drivers.map(d => [d.team, d.color])).entries()];
  const bays = teams.length * 2;
  const bayLen = (len * 0.86) / bays;
  const x0 = -len * 0.43;

  const shell = [], glass = [], lit = [], dark = [], white = [], accentGeos = [], boards = [], led = [], rail = [];
  // structure: ground-floor slab, office level, Paddock Club, roof
  // garages are recessed 2 m behind the door line
  shell.push(new THREE.BoxGeometry(len, G0, DEPTH - 2).translate(0, G0 / 2, front - 2 - (DEPTH - 2) / 2));
  glass.push(new THREE.BoxGeometry(len, L1 - G0 - 0.6, DEPTH - 1).translate(0, (G0 + 0.6 + L1) / 2, front - DEPTH / 2 - 0.5));
  glass.push(new THREE.BoxGeometry(len, L2 - L1 - 0.7, DEPTH + 2).translate(0, (L1 + 0.7 + L2) / 2, front - DEPTH / 2 + 1));
  white.push(new THREE.BoxGeometry(len + 2, 0.6, DEPTH + 4).translate(0, G0 + 0.3, front - DEPTH / 2 + 1));
  white.push(new THREE.BoxGeometry(len + 2, 0.7, DEPTH + 6).translate(0, L1 + 0.35, front - DEPTH / 2 + 2));   // balcony slab
  white.push(new THREE.BoxGeometry(len + 2, 0.8, DEPTH + 4).translate(0, L2 + 0.4, front - DEPTH / 2 + 1));
  // mullions on the glass levels (front face)
  for (let x = -len / 2; x <= len / 2; x += 3) {
    white.push(new THREE.BoxGeometry(0.25, L1 - G0, 0.3).translate(x, (G0 + L1) / 2, front - 0.9));
    white.push(new THREE.BoxGeometry(0.2, L2 - L1, 0.3).translate(x, (L1 + L2) / 2, front + 2.05));
  }
  // glass balustrade along the Paddock Club balcony, with a lit handrail
  rail.push(new THREE.BoxGeometry(len, 1.1, 0.06).translate(0, L1 + 1.25, front + 2.9));
  led.push(new THREE.BoxGeometry(len, 0.08, 0.12).translate(0, L1 + 1.85, front + 2.9));

  // garages: lit interior behind each door, team-colour back wall, door frame and name board
  const boardTex = teamBoards(teams);
  teams.forEach(([name, col], ti) => {
    const c = new THREE.Color(col);
    for (let k = 0; k < 2; k++) {
      const bx = x0 + (ti * 2 + k + 0.5) * bayLen;
      const dw = bayLen - 1.6;
      lit.push(new THREE.BoxGeometry(dw, 4.6, 0.2).translate(bx, 2.4, front - 1.95));                      // interior glow
      accentGeos.push({ g: new THREE.BoxGeometry(dw, 1.2, 0.25).translate(bx, 4.2, front - 1.8), c });      // team wall panel
      dark.push(new THREE.BoxGeometry(dw, 1.0, 0.3).translate(bx, 5.2, front - 0.2));                        // half-raised door
      for (const s of [-1, 1]) accentGeos.push({ g: new THREE.BoxGeometry(0.35, G0 - 0.4, 0.4).translate(bx + s * (dw / 2 + 0.2), (G0 - 0.4) / 2, front + 0.05), c });
      // epoxy garage floor
      dark.push(new THREE.BoxGeometry(dw, 0.05, 3).translate(bx, 0.05, front - 0.2));
    }
    // name board spanning the team's two garages
    const bg = new THREE.PlaneGeometry(bayLen * 2 - 1, 1.1).translate(x0 + (ti * 2 + 1) * bayLen, G0 - 1.2, front + 0.32);
    const uv = bg.attributes.uv;
    for (let q = 0; q < uv.count; q++) uv.setY(q, (teams.length - 1 - ti + uv.getY(q)) / teams.length);
    boards.push(bg);
    // team-colour stripe along the office level above the team's garages
    accentGeos.push({ g: new THREE.BoxGeometry(bayLen * 2 - 0.6, 0.35, 0.2).translate(x0 + (ti * 2 + 1) * bayLen, G0 + 0.9, front + 0.2), c });
  });

  // rooftop hospitality deck: sail canopies on masts, string lights, railings
  const deck = { x: 0, z: front - DEPTH / 2 + 2, len: len - 10, wid: DEPTH - 2, y: y0 + L2 + 0.8 };
  for (let x = -len / 2 + 15; x < len / 2 - 10; x += 26) {
    const sail = new THREE.BufferGeometry();
    const h = L2 + 0.8;
    sail.setAttribute('position', new THREE.Float32BufferAttribute([
      x - 11, h + 4.2, front - 3, x + 11, h + 5.8, front - 3, x, h + 3.6, front - DEPTH + 4,
      x - 11, h + 4.2, front - 3, x, h + 3.6, front - DEPTH + 4, x + 11, h + 5.8, front - 3,
    ], 3));
    sail.computeVertexNormals();
    white.push(sail);
    for (const [px, pz, ph] of [[x - 11, front - 3, 4.2], [x + 11, front - 3, 5.8], [x, front - DEPTH + 4, 3.6]]) {
      shell.push(new THREE.CylinderGeometry(0.12, 0.12, ph, 5).translate(px, h + ph / 2, pz));
    }
  }
  for (let x = -len / 2 + 2; x < len / 2 - 2; x += 1.6) {
    for (const z of [front - 1.5, front - DEPTH + 3]) led.push(new THREE.SphereGeometry(0.09, 5, 4).translate(x, L2 + 3.3 + Math.sin(x * 0.4) * 0.25, z));
  }
  rail.push(new THREE.BoxGeometry(len, 1.1, 0.06).translate(0, L2 + 1.35, front + 0.9));

  // pit-wall stands: one per team on the track side of the lane
  const standZ = front + 6.8 + 6.2;
  teams.forEach(([, col], ti) => {
    const c = new THREE.Color(col);
    const bx = x0 + (ti * 2 + 1) * bayLen;
    dark.push(new THREE.BoxGeometry(6, 1.6, 2.2).translate(bx, 0.8, standZ));
    accentGeos.push({ g: new THREE.BoxGeometry(6.6, 0.3, 3).translate(bx, 3.3, standZ), c });
    for (const s of [-1, 1]) dark.push(new THREE.BoxGeometry(0.15, 3.2, 0.15).translate(bx + s * 3, 1.6, standZ - 1));
    lit.push(new THREE.BoxGeometry(5.2, 0.9, 0.1).translate(bx, 2.3, standZ - 0.9));   // monitors
  });

  const mats = {
    shell: new THREE.MeshStandardMaterial({ color: 0x2b2f38, metalness: 0.5, roughness: 0.5, emissive: 0x0b0c10 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x22303f, metalness: 0.8, roughness: 0.12, emissive: new THREE.Color(0.24, 0.19, 0.13) }),
    lit: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.05, 1.05, 1.0) }),
    dark: new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.6 }),
    white: new THREE.MeshStandardMaterial({ color: 0xe8eaee, roughness: 0.5, emissive: 0x2a2c30, side: THREE.DoubleSide }),
    led: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.7, 1.0) }),
    rail: new THREE.MeshStandardMaterial({ color: 0x9fb4c8, transparent: true, opacity: 0.35, metalness: 0.5, roughness: 0.1 }),
  };
  const add = (list, mat) => { if (list.length) g.add(new THREE.Mesh(place(mergeGeometries(list.map(x => (x.index ? x.toNonIndexed() : x)).map(x => { if (x.attributes.uv) x.deleteAttribute('uv'); return x; }))), mat)); };
  add(shell, mats.shell); add(glass, mats.glass); add(lit, mats.lit); add(dark, mats.dark); add(white, mats.white); add(led, mats.led); add(rail, mats.rail);
  // team colours via vertex colour
  const ag = accentGeos.map(({ g: geo, c }) => {
    geo = geo.toNonIndexed(); geo.deleteAttribute('uv');
    const n = geo.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r * 1.6; col[i * 3 + 1] = c.g * 1.6; col[i * 3 + 2] = c.b * 1.6; }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return geo;
  });
  g.add(new THREE.Mesh(place(mergeGeometries(ag)), new THREE.MeshBasicMaterial({ vertexColors: true })));
  g.add(new THREE.Mesh(place(mergeGeometries(boards)), new THREE.MeshBasicMaterial({ map: boardTex, color: new THREE.Color(1.3, 1.3, 1.3) })));

  // rooftop SINGAPORE sign, on the roof edge that faces the default overview camera
  const camOsm = [OVERVIEW.wide.pos[0], -OVERVIEW.wide.pos[2]];
  const zWorld = [Math.sin(a), -Math.cos(a)];
  const towardCam = (camOsm[0] - cx) * zWorld[0] + (camOsm[1] - cy) * zWorld[1] >= 0;
  const signZ = towardCam ? front - 2 : front - DEPTH + 3;
  for (const m of roofSign(len, !towardCam)) {
    m.geometry.translate(0, L2 + 0.8, signZ);
    place(m.geometry);
    g.add(m);
    if (m.name === 'pit-sign-face') {
      m.geometry.computeBoundingBox();
      out.signBox = m.geometry.boundingBox;   // world space (the pit group sits at the origin)
    }
  }

  // pit-exit light: red / green signal on a post at the end of the lane
  const exit = pitPts[Math.max(0, pitPts.length - 4)], prev = pitPts[pitPts.length - 6] || pitPts[0];
  const dir = new THREE.Vector2(exit[0] - prev[0], exit[1] - prev[1]).normalize();
  const side = new THREE.Vector2(-dir.y, dir.x);   // left of travel
  const ex = exit[0] + side.x * 6.5, ey = exit[1] + side.y * 6.5;
  const ey0 = track.P[track.nearest(ex, -ey).i].y - 0.18;
  const sig = new THREE.Group();
  sig.add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 3.6, 8).translate(0, 1.8, 0), mats.dark));
  sig.add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.6, 0.4).translate(0, 4.1, 0), mats.dark));
  const red = new THREE.MeshBasicMaterial({ color: 0x220000 }), green = new THREE.MeshBasicMaterial({ color: 0x002200 });
  const lampR = new THREE.Mesh(new THREE.CircleGeometry(0.22, 16), red); lampR.position.set(0, 4.5, 0.21);
  const lampG = new THREE.Mesh(new THREE.CircleGeometry(0.22, 16), green); lampG.position.set(0, 3.75, 0.21);
  sig.add(lampR, lampG);
  sig.position.set(ex, ey0, -ey);
  // face oncoming cars: local +z toward the direction cars come from
  sig.rotation.y = Math.atan2(-dir.x, dir.y);
  g.add(sig);

  // deck areas for the crowd (world space)
  const toW = (lx, lz) => {
    const v = new THREE.Vector3(lx, 0, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
    return { x: v.x + cx, z: v.z - cy };
  };
  const dc = toW(deck.x, deck.z), bc = toW(0, front + 1.9);
  out.decks = [
    { ...dc, y: deck.y, len: deck.len, wid: deck.wid * 0.85, angle: a, density: 0.55, tag: 'roof' },
    { ...bc, y: y0 + L1 + 0.7, len: len - 4, wid: 1.6, angle: a, density: 0.7, tag: 'balcony' },
  ];
  out.setExit = (open) => {
    red.color.setRGB(open ? 0.15 : 6, 0, 0);
    green.color.setRGB(0, open ? 5 : 0.15, 0);
  };
  out.setExit(true);
  return out;
}
