// Marina Bay pit complex: a long three-level building on the OSM "F1 Pit Building" footprint,
// fronting the pit lane (see references/: race-weekend photos). Garages at ground level lit in team
// colours; above them a continuous yellow DHL parapet band, the glazed Paddock Club with its
// balcony, a row of floodlights under the roof overhang and SINGAPORE GRAND PRIX lettering on the
// fascia. The flat dark roof is split into bays with one huge raised white letter of SINGAPORE in
// each, lying along the building so the word reads from across the track like the overhead TV shot.
// Team pit-wall stands and the pit-exit light.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { obb, toWorld } from './skyline.js';
import { PIT_SIGN } from './config.js';
import { logoImage } from './sponsors.js';

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

// One cell per letter, white on transparent. The same atlas is alpha-tested for the white face and
// for the red side-wall slices under it.
function letterAtlas(word) {
  const cw = 256, ch = 320, c = document.createElement('canvas');
  c.width = cw * word.length; c.height = ch;
  const x = c.getContext('2d');
  const base = ch * 0.8;
  x.font = `700 ${Math.round(ch * 0.8)}px "Titillium Web", sans-serif`;
  x.textAlign = 'center'; x.textBaseline = 'alphabetic';
  const cap = x.measureText('S').actualBoundingBoxAscent || ch * 0.57;
  const widths = [];
  x.fillStyle = '#fff';
  [...word].forEach((L, i) => {
    widths.push(x.measureText(L).width);
    x.fillText(L, cw * (i + 0.5), base);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { tex, cw, ch, base, cap, widths };
}

// Roof lettering as in the overhead photo (references/): one raised letter per roof bay, baseline
// along the building and each letter's top toward the back (away from the pit lane, local -z), so
// SINGAPORE reads S..E like ordinary text from the grandstands and TV cameras across the track.
// With the top at -z, reading direction +x runs south to north, so S lands at the south end.
// Each letter is a white face over a stack of red slices, which reads as a red-sided block.
function roofLetters(len, roofW) {
  const S = PIT_SIGN, word = S.word, n = word.length;
  const A = letterAtlas(word);
  const span = len * S.fill, bay = span / n;
  // cap height across the roof, shrunk if the widest letter would overrun its bay
  const k = Math.min(roofW * S.letter / A.cap, bay * 0.86 / Math.max(...A.widths));
  const capH = A.cap * k;
  const plane = (i, y) => {
    const g = new THREE.PlaneGeometry(A.cw * k, A.ch * k);
    const uv = g.attributes.uv;
    for (let q = 0; q < uv.count; q++) uv.setX(q, (i + uv.getX(q)) / n);
    // centre the cap height on the roof: baseline below centre by half the cap
    g.translate(0, (A.ch / 2 - A.base) * k + capH / 2, 0);
    g.rotateX(-Math.PI / 2);                                // lie flat, letter top toward -z
    return g.translate(-span / 2 + (i + 0.5) * bay, y, 0);
  };
  const faces = [], sides = [], dividers = [];
  for (let i = 0; i < n; i++) {
    faces.push(plane(i, S.raise));
    for (let j = 0; j < S.slices; j++) sides.push(plane(i, S.raise * j / S.slices));
  }
  for (let i = 0; i <= n; i++) {
    dividers.push(new THREE.BoxGeometry(0.6, 0.5, roofW - 1.5).translate(-span / 2 + i * bay, 0.25, 0));
  }
  dividers.push(new THREE.BoxGeometry(span, 0.5, 0.6).translate(0, 0.25, roofW / 2 - 0.75));
  dividers.push(new THREE.BoxGeometry(span, 0.5, 0.6).translate(0, 0.25, -roofW / 2 + 0.75));
  const face = new THREE.Mesh(mergeGeometries(faces), new THREE.MeshBasicMaterial({
    map: A.tex, color: new THREE.Color(...S.face), alphaTest: 0.5,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  }));
  face.name = 'pit-sign-face';
  const side = new THREE.Mesh(mergeGeometries(sides), new THREE.MeshBasicMaterial({
    map: A.tex, color: new THREE.Color(...S.side), alphaTest: 0.5,
  }));
  const div = new THREE.Mesh(mergeGeometries(dividers), new THREE.MeshStandardMaterial({ color: 0x3a3e46, roughness: 0.7, emissive: new THREE.Color(0.07, 0.075, 0.085) }));
  return [face, side, div];
}

// Continuous sponsor band: the logo repeated on its colour (falls back to the word when the file
// is missing). Tiled along x by the geometry's uvs.
function bandTexture(name, bg, fg, word) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, 1024, 128);
  const img = logoImage(name);
  if (img) {
    const ar = img.naturalWidth / img.naturalHeight, h = 96, w = h * ar;
    x.drawImage(img, (1024 - w) / 2, 16, w, h);
  } else {
    x.fillStyle = fg; x.font = 'italic 900 92px "Titillium Web", sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(word, 512, 66);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function textTexture(text, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = '#0b0c10'; x.fillRect(0, 0, w, h);
  x.fillStyle = '#ffffff';
  x.font = `900 ${Math.round(h * 0.68)}px "Titillium Web", sans-serif`;
  if ('letterSpacing' in x) x.letterSpacing = `${Math.round(h * 0.06)}px`;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, w / 2, h * 0.54);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

let _spot;
function spotGlow() {
  if (_spot) return _spot;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  _spot = new THREE.CanvasTexture(c);
  return _spot;
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

  const roofSlab = [];
  const shell = [], glass = [], lit = [], dark = [], white = [], accentGeos = [], boards = [], led = [], rail = [];
  // structure: ground-floor slab, office level, Paddock Club, roof
  // garages are recessed 2 m behind the door line
  shell.push(new THREE.BoxGeometry(len, G0, DEPTH - 2).translate(0, G0 / 2, front - 2 - (DEPTH - 2) / 2));
  glass.push(new THREE.BoxGeometry(len, L1 - G0 - 0.6, DEPTH - 1).translate(0, (G0 + 0.6 + L1) / 2, front - DEPTH / 2 - 0.5));
  glass.push(new THREE.BoxGeometry(len, L2 - L1 - 0.7, DEPTH + 2).translate(0, (L1 + 0.7 + L2) / 2, front - DEPTH / 2 + 1));
  white.push(new THREE.BoxGeometry(len + 2, 0.6, DEPTH + 4).translate(0, G0 + 0.3, front - DEPTH / 2 + 1));
  white.push(new THREE.BoxGeometry(len + 2, 0.7, DEPTH + 6).translate(0, L1 + 0.35, front - DEPTH / 2 + 2));   // balcony slab
  roofSlab.push(new THREE.BoxGeometry(len + 2, 0.8, DEPTH + 4).translate(0, L2 + 0.4, front - DEPTH / 2 + 1));   // matte dark roof
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
      // interior glow in the team's colour (kept under the bloom threshold so it doesn't blow out)
      accentGeos.push({ g: new THREE.BoxGeometry(dw, 4.6, 0.2).translate(bx, 2.4, front - 1.95), c: c.clone().lerp(new THREE.Color(1, 0.97, 0.9), 0.55).multiplyScalar(0.48) });
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
    roof: new THREE.MeshStandardMaterial({ color: 0x0e1014, roughness: 0.95, metalness: 0.0, emissive: 0x050608 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x22303f, metalness: 0.8, roughness: 0.12, emissive: new THREE.Color(0.24, 0.19, 0.13) }),
    lit: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.05, 1.05, 1.0) }),
    dark: new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.6 }),
    white: new THREE.MeshStandardMaterial({ color: 0xe8eaee, roughness: 0.5, emissive: 0x2a2c30, side: THREE.DoubleSide }),
    led: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.7, 1.0) }),
    rail: new THREE.MeshStandardMaterial({ color: 0x9fb4c8, transparent: true, opacity: 0.35, metalness: 0.5, roughness: 0.1 }),
  };
  const add = (list, mat) => { if (list.length) g.add(new THREE.Mesh(place(mergeGeometries(list.map(x => (x.index ? x.toNonIndexed() : x)).map(x => { if (x.attributes.uv) x.deleteAttribute('uv'); return x; }))), mat)); };
  add(shell, mats.shell); add(roofSlab, mats.roof); add(glass, mats.glass); add(lit, mats.lit); add(dark, mats.dark); add(white, mats.white); add(led, mats.led); add(rail, mats.rail);
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

  // SINGAPORE lettering in the roof bays, reading along the building
  const roofZ = front - DEPTH / 2 + 1, roofW = DEPTH + 4;
  for (const m of roofLetters(len, roofW)) {
    m.geometry.translate(0, L2 + 0.82, roofZ);
    place(m.geometry);
    g.add(m);
    if (m.name === 'pit-sign-face') {
      m.geometry.computeBoundingBox();
      out.signBox = m.geometry.boundingBox;   // world space (the pit group sits at the origin)
    }
  }

  // yellow DHL parapet band along the first floor, the whole length of the building
  const bandH = 2.6, bandTex = bandTexture('DHL', '#ffcc00', '#d40511', 'DHL');
  const band = new THREE.PlaneGeometry(len, bandH).translate(0, G0 + 0.9, front + 3.12);
  const buv = band.attributes.uv;
  for (let q = 0; q < buv.count; q++) buv.setX(q, buv.getX(q) * len / (bandH * 5.5));
  g.add(new THREE.Mesh(place(band), new THREE.MeshStandardMaterial({ map: bandTex, emissiveMap: bandTex, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.6 })));
  g.add(new THREE.Mesh(place(new THREE.BoxGeometry(len, bandH, 0.3).translate(0, G0 + 0.9, front + 2.95)), mats.dark));

  // fascia under the roof edge with SINGAPORE GRAND PRIX lettering (one long panel mid-building)
  g.add(new THREE.Mesh(place(new THREE.BoxGeometry(len + 2, 2.4, 0.4).translate(0, L2 - 0.6, front + 3.05)), mats.dark));
  const tw = Math.min(len * 0.45, 110), tex = textTexture('SINGAPORE GRAND PRIX', 2048, 96);
  g.add(new THREE.Mesh(place(new THREE.PlaneGeometry(tw, 2.0).translate(0, L2 - 0.6, front + 3.27)),
    new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.15, 1.15, 1.15) })));

  // floodlights on a truss under the roof overhang, aimed at the pit lane
  const truss = [], heads = [], glows = [];
  truss.push(new THREE.BoxGeometry(len, 0.35, 0.35).translate(0, L2 - 2.1, front + 3.4));
  for (let x = -len / 2 + 3; x < len / 2 - 2; x += 6) {
    heads.push(new THREE.BoxGeometry(0.9, 0.55, 0.5).rotateX(-0.5).translate(x, L2 - 2.55, front + 3.7));
    glows.push(new THREE.PlaneGeometry(2.4, 2.4).translate(x, L2 - 2.6, front + 3.98));
  }
  g.add(new THREE.Mesh(place(mergeGeometries(truss)), mats.dark));
  g.add(new THREE.Mesh(place(mergeGeometries(heads)), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.57, 1.5) })));
  g.add(new THREE.Mesh(place(mergeGeometries(glows)), new THREE.MeshBasicMaterial({
    map: spotGlow(), color: new THREE.Color(0.32, 0.31, 0.29), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  })));

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
  const bc = toW(0, front + 1.9);
  out.decks = [
    { ...bc, y: y0 + L1 + 0.7, len: len - 4, wid: 1.6, angle: a, density: 0.7, tag: 'balcony' },
  ];
  out.setExit = (open) => {
    red.color.setRGB(open ? 0.15 : 6, 0, 0);
    green.color.setRGB(0, open ? 5 : 0.15, 0);
  };
  out.setExit(true);
  return out;
}
