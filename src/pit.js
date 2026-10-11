// Marina Bay pit building and paddock (references/: race-weekend photos), laid out in pit-lane
// coordinates (pitlane.js: u along the lane, w toward the garages, h up) so the building front sits
// exactly on the garage line of the lane fitted from telemetry.
//   ground floor   garages (garages.js), back-of-house behind them
//   level 1        team offices, the yellow DHL parapet band (text wordmark) over the garages
//   levels 2 - 3   glazed hospitality suites with balconies over the pit lane
//   roof           lit parapet, floodlight masts aimed at the pit lane
// The building runs the length of its OSM footprint and as deep as it (back edge); plus the podium
// cantilevered over the pit lane mid-building, race control at the pit exit end, the lettering on
// the sloped roof fascia, and behind the building the paddock, confined to the strip before the
// next road: team hospitality units facing the building and the teams' trucks. Text only, no logos.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PIT_LANE, PADDOCK } from './config.js';
import { laneBox, laneSign, tint, garageLayout } from './garages.js';

const P = PIT_LANE, K = PADDOCK;

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

let _spot;
function spotGlow() {
  if (_spot) return _spot;
  _spot = canvasTex(64, 64, (x) => {
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  });
  _spot.colorSpace = THREE.NoColorSpace;
  return _spot;
}

// point-in-polygon on a flat [x0, y0, x1, y1, ...] OSM ring
function inRing(p, x, y) {
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function buildPitComplex(g, city, race, track) {
  const L = track.lane;
  const out = { decks: [], setExit: open => track.pitLaneCtl && track.pitLaneCtl.setExit(open) };
  const lay = L && garageLayout(L, race);
  if (!lay) return out;
  const G = P.garage, GD = P.garageDepth;
  // the building runs the length of its OSM footprint (pitlane.js fitFootprint); depth per metre of
  // lane is the footprint's back edge behind the garage line
  const u0 = L.bldFrom ?? lay.from - K.endRun, u1 = L.bldTo ?? lay.to + K.endRun;
  const depth = u => Math.max(GD + 4, L.depthAt(u, K.depth));
  const H0 = P.bayHeight + 1.4, H1 = H0 + 4.2, H2 = H1 + 4, H3 = H2 + 4, HR = H3 + 0.8;
  const solid = [], lit = [], glass = [], rail = [], glows = [];
  const C = (r, gg, b) => new THREE.Color(r, gg, b);
  const concrete = C(0.5, 0.52, 0.56), white = C(0.86, 0.87, 0.9), dark = C(0.08, 0.085, 0.1), warm = C(1.0, 0.82, 0.58);
  const box = (a, b, w0, w1, h0, h1, col, list = solid, k = 1) => list.push(tint(laneBox(L, a, b, w0, w1, h0, h1), col, k));
  // the same piece in 4 m chunks, its back edge following the footprint (back = metres in front of it)
  const STEP = 4;
  const chunks = (a, b, f) => { for (let u = a; u < b - 0.01; u += STEP) f(u, Math.min(b, u + STEP), depth(u + STEP / 2)); };

  // ---- building body
  chunks(u0, u1, (a, b, d) => {
    box(a, b, G + GD, G + d, 0, H0, concrete);                                    // back-of-house
    box(a, b, G - 1.6, G + d, H0 - 0.15, H0 + 0.3, white);                        // slab over the garages
    box(a, b, G + 0.8, G + d, H0 + 0.3, H1, concrete);                            // offices
    glass.push(laneBox(L, a, b, G - 1.0, G + d - 2, H1, H3));                     // hospitality suites
    box(a, b, G - 2.0, G + d + 0.5, H3, HR, dark);                                // roof
  });
  for (let u = u0 + 1.5; u < u1 - 1.5; u += 3.0) box(u, u + 2.4, G + 0.7, G + 0.8, H0 + 1.3, H1 - 0.5, warm, lit, 0.45);   // office windows
  // balconies at both hospitality levels
  for (const h of [H1, H2]) {
    box(u0, u1, G - 3.6, G - 1.0, h - 0.25, h + 0.1, white);
    rail.push(laneBox(L, u0, u1, G - 3.6, G - 3.5, h + 0.1, h + 1.15));
    box(u0, u1, G - 3.62, G - 3.48, h + 1.15, h + 1.23, C(0.85, 0.7, 0.5), lit);   // lit handrail
  }
  for (let u = u0; u <= u1; u += 3) box(u - 0.1, u + 0.1, G - 1.08, G - 0.98, H1, H3, white);   // mullions
  box(u0, u1, G - 1.05, G - 0.95, H2 - 0.2, H2 + 0.1, white);
  // the row of big round floodlights on brackets in front of the upper glazing (night photos)
  for (let u = u0 + 4; u < u1 - 2; u += 9) {
    box(u - 0.08, u + 0.08, G - 3.0, G - 1.0, H3 - 0.9, H3 - 0.75, C(0.3, 0.32, 0.36));
    box(u - 0.5, u + 0.5, G - 3.4, G - 2.8, H3 - 1.4, H3 - 0.6, C(1.6, 1.58, 1.5), lit);
    const p = L.point(u, G - 3.5, H3 - 1.0);
    glows.push(p.x, p.y, p.z);
  }
  // under-roof downlights over the balcony
  for (let u = u0 + 3; u < u1 - 2; u += 6) box(u - 0.5, u + 0.5, G - 2.6, G - 2.0, H3 - 0.12, H3, C(1.5, 1.4, 1.2), lit);

  // ---- yellow DHL parapet band over the garages: the brand as a text wordmark, no logo file
  const bandTex = canvasTex(1024, 128, (x, w, h) => {
    x.fillStyle = '#ffcc00'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#d40511'; x.font = 'italic 900 92px "Titillium Web", sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('DHL', w / 2, h / 2 + 4);
  });
  bandTex.wrapS = THREE.RepeatWrapping;
  const band = laneSign(L, u0, u1, G - 1.65, H0 + 0.35, H0 + 2.7, [0, 0, (u1 - u0) / 13, 1]);
  g.add(new THREE.Mesh(band, new THREE.MeshStandardMaterial({ map: bandTex, emissiveMap: bandTex, emissive: 0xffffff, emissiveIntensity: 0.5, roughness: 0.6, side: THREE.DoubleSide })));
  box(u0, u1, G - 1.6, G - 1.3, H0 + 0.3, H0 + 2.75, dark);

  // ---- podium, cantilevered over the pit lane mid-building
  const uc = (lay.from + lay.to) / 2 + K.podiumShift, pw = K.podiumWidth / 2;
  const left = L.side < 0 ? -1 : 1;    // viewer's left (from the lane, facing the building) in u
  box(uc - pw, uc + pw, G - 7.5, G - 1.0, H1 - 0.45, H1 + 0.05, C(0.62, 0.64, 0.68));
  rail.push(laneBox(L, uc - pw, uc + pw, G - 7.6, G - 7.4, H1 + 0.05, H1 + 1.15));
  box(uc - pw + 0.5, uc + pw - 0.5, G - 7.3, G - 6.9, H1 - 0.6, H1 - 0.45, C(1.4, 1.4, 1.5), lit);   // soffit light strip
  box(uc - pw, uc + pw, G - 1.2, G - 0.9, H1 + 0.05, H2 - 0.3, C(0.12, 0.02, 0.03));                   // backdrop
  box(uc - pw, uc + pw, G - 1.25, G - 1.15, H2 - 1.2, H2 - 0.9, C(1.4, 0.08, 0.06), lit);              // red light line
  for (const [du, hh, wdt] of [[0, 1.25, 2.6], [left * 3.0, 0.9, 2.4], [-left * 3.0, 0.65, 2.4]]) {
    box(uc + du - wdt / 2, uc + du + wdt / 2, G - 5.2, G - 3.4, H1 + 0.05, H1 + 0.05 + hh, C(0.16, 0.17, 0.2));
    box(uc + du - wdt / 2, uc + du + wdt / 2, G - 5.25, G - 3.35, H1 + hh, H1 + hh + 0.1, C(1.2, 1.2, 1.25), lit);
  }
  box(uc - pw - 0.5, uc + pw + 0.5, G - 8.0, G - 0.9, H2 - 0.15, H2 + 0.15, white);                    // canopy

  // ---- sloped fascia along the roof edge with the lettering mounted on it, as in the night photo
  // of the pit lane (references/): white letters on the dark fascia, no box above the roof
  const FB = { w: G - 2.1, h: HR - 0.2 }, FT = { w: G - 3.3, h: HR + 2.8 };
  const tilted = (a, b, uv, lift = 0) => {
    const [ua, ub] = L.side < 0 ? [a, b] : [b, a];
    const q = [L.point(ua, FB.w - lift, FB.h), L.point(ub, FB.w - lift, FB.h), L.point(ua, FT.w - lift, FT.h), L.point(ub, FT.w - lift, FT.h)];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(q.flatMap(v => [v.x, v.y, v.z]), 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([uv[0], uv[1], uv[2], uv[1], uv[0], uv[3], uv[2], uv[3]], 2));
    geo.setIndex([0, 1, 2, 1, 3, 2]);
    geo.computeVertexNormals();
    return geo;
  };
  const fascia = [];
  for (let u = u0 - 0.5; u < u1 + 0.5; u += STEP) fascia.push(tilted(u, Math.min(u1 + 0.5, u + STEP), [0, 0, 1, 1]));
  g.add(new THREE.Mesh(mergeGeometries(fascia), new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.55, metalness: 0.4, emissive: 0x08090b, side: THREE.DoubleSide })));
  const signTex = canvasTex(4096, 256, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    x.fillStyle = '#f2f3f5'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = '700 190px "Titillium Web", sans-serif';
    if ('letterSpacing' in x) x.letterSpacing = '22px';
    x.fillText(K.sign, w / 2, h / 2 + 8);
  });
  const sl = K.signLength / 2;
  // in the same 4 m pieces as the fascia (one long flat quad would cut behind it where the lane bends)
  const pieces = [];
  for (let a = uc - sl; a < uc + sl - 0.01; a += STEP) {
    const b = Math.min(uc + sl, a + STEP), f0 = (a - (uc - sl)) / (2 * sl), f1 = (b - (uc - sl)) / (2 * sl);
    pieces.push(tilted(a, b, L.side < 0 ? [f0, 0, f1, 1] : [1 - f1, 0, 1 - f0, 1], 0.1));
  }
  g.add(new THREE.Mesh(mergeGeometries(pieces),
    new THREE.MeshBasicMaterial({ map: signTex, alphaTest: 0.5, color: C(0.82, 0.82, 0.84), side: THREE.DoubleSide })));

  // ---- race control at the pit exit end of the building (glass box on the roof, antenna)
  const rcBack = Math.min(24, depth(u1 - 12) - 2);
  const rc0 = u1 - 24, rc1 = u1 - 3, rh = HR + 10;
  box(rc0, rc1, G + 5, G + rcBack, HR, HR + 1, concrete);
  glass.push(laneBox(L, rc0 + 0.5, rc1 - 0.5, G + 5.5, G + rcBack - 0.5, HR + 1, rh));
  for (let h = HR + 3.5; h < rh; h += 3.3) box(rc0 + 0.4, rc1 - 0.4, G + 5.4, G + rcBack - 0.4, h, h + 0.3, white);
  box(rc0, rc1, G + 4.8, G + rcBack + 0.2, rh, rh + 0.8, dark);
  box((rc0 + rc1) / 2 - 0.2, (rc0 + rc1) / 2 + 0.2, G + 12, G + 12.4, rh + 0.8, rh + 9, C(0.6, 0.62, 0.66));
  box((rc0 + rc1) / 2 - 0.3, (rc0 + rc1) / 2 + 0.3, G + 11.9, G + 12.5, rh + 8.7, rh + 9.2, C(4, 0.1, 0.1), lit);   // aviation light
  const rcTex = canvasTex(1024, 128, (x, w, h) => {
    x.fillStyle = '#0b0c10'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#ffffff'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = '700 76px "Titillium Web", sans-serif';
    if ('letterSpacing' in x) x.letterSpacing = '10px';
    x.fillText('RACE CONTROL', w / 2, h / 2 + 4);
  });
  g.add(new THREE.Mesh(laneSign(L, rc0 + 2, rc1 - 2, G + 4.75, rh - 2.6, rh - 0.4, [0, 0, 1, 1]), new THREE.MeshBasicMaterial({ map: rcTex, side: THREE.DoubleSide })));

  // ---- paddock: the strip between the back of the building and the next road (OSM), never over
  // a road, an OSM building or near the circuit
  const centre = L.point((u0 + u1) / 2, G + 20);
  const segs = [];
  for (const r of city.roads) {
    for (let i = 2; i < r.p.length; i += 2) {
      const ax = r.p[i - 2], ay = r.p[i - 1], bx = r.p[i], by = r.p[i + 1];
      if (Math.hypot((ax + bx) / 2 - centre.x, (ay + by) / 2 + centre.z) < 400) segs.push([ax, ay, bx, by, r.w / 2 + 2]);
    }
  }
  const nearRoad = (x, y) => segs.some(([ax, ay, bx, by, r]) => {
    const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(x - ax - dx * t, y - ay - dy * t) < r;
  });
  const free = (u, w) => {
    const p = L.point(u, w);
    return !nearRoad(p.x, -p.z) && track.nearest(p.x, p.z).d > K.trackClear && !city.buildings.some(bd => bd.n !== 'F1 Pit Building' && inRing(bd.p, p.x, -p.z));
  };
  // room behind the building, per chunk: how far the paddock can reach (0 = none)
  const room = [];
  for (let u = u0; u < u1 - 0.01; u += STEP) {
    const m = u + STEP / 2, wb = G + depth(m);
    let w = wb + 2;
    while (w < wb + K.width && free(m, w) && free(u, w) && free(Math.min(u1, u + STEP), w)) w += 1;
    room.push({ a: u, b: Math.min(u1, u + STEP), wb, wr: w - 1 });
  }
  for (const r of room) if (r.wr - r.wb > 6) box(r.a, r.b, r.wb, r.wr, -3, -0.12, C(0.24, 0.25, 0.28));   // paving
  // hospitality units in team order along the far side of the paddock, facing the building, where
  // the strip is deep enough; trucks where it is not
  const teams = lay.frontage;
  const unitLen = K.unitLength;
  const nameTex = canvasTex(512, 64 * teams.length, (x, w) => {
    teams.forEach((f, i) => {
      x.fillStyle = '#0d0e12'; x.fillRect(0, i * 64, w, 64);
      x.fillStyle = f.color; x.fillRect(0, i * 64 + 56, w, 8);
      x.fillStyle = '#ffffff'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.font = 'italic 900 34px "Titillium Web", sans-serif';
      x.fillText(f.team.toUpperCase(), w / 2, i * 64 + 28);
    });
  });
  const names = [];
  const roomAt = (a, b) => room.filter(r => r.b > a && r.a < b);
  const minRoom = (a, b) => Math.min(...roomAt(a, b).map(r => r.wr), Infinity);
  const backAt = (a, b) => Math.max(...roomAt(a, b).map(r => r.wb), -Infinity);
  let ti = 0, tk = 0;
  for (let a = u0 + 4; a < u1 - unitLen && (ti < teams.length || tk < teams.length); ) {
    const b = a + unitLen, wb = backAt(a, b), wr = minRoom(a, b), space = wr - wb;
    if (ti < teams.length && space >= K.unitDepth + 10) {
      const f = teams[ti], k = ti++, col = new THREE.Color(f.color);
      const w1 = wr - 1, w0 = w1 - K.unitDepth;                // the unit, its front (w0) toward the building
      box(a, b, w0, w1, -0.1, K.unitHeight, C(0.2, 0.21, 0.24));
      box(a + 0.6, b - 0.6, w0 - 0.1, w0, 0.4, K.unitHeight - 1.4, warm, lit, 0.42);
      box(a, b, w0 - 0.3, w0, K.unitHeight - 1.3, K.unitHeight, col, solid, 0.9);
      names.push(laneSign(L, a + 2, b - 2, w0 - 0.35, K.unitHeight - 1.2, K.unitHeight - 0.1, [0, 1 - (k + 1) / teams.length, 1, 1 - k / teams.length]));
      box(a + unitLen / 2 - 3, a + unitLen / 2 + 3, w0 - 2.5, w0, 3.0, 3.2, white);   // awning
      // walkway lamps between the building and the units
      const wl = (wb + w0) / 2;
      box(a - 0.08, a + 0.08, wl - 0.08, wl + 0.08, 0, 5, C(0.3, 0.32, 0.36));
      box(a - 0.35, a + 0.35, wl - 0.35, wl + 0.35, 4.9, 5.15, C(1.7, 1.5, 1.1), lit);
      a = b + 4;
    } else if (tk < teams.length && space >= 7) {
      // a team truck parked along the back of the building
      const f = teams[tk++], col = new THREE.Color(f.color), tw = wb + 3.5;
      box(a, a + 13.6, tw - 1.25, tw + 1.25, 1.1, 4.0, col, solid, 0.75);        // trailer
      box(a + 13.9, a + 16.4, tw - 1.2, tw + 1.2, 0.9, 3.6, C(0.18, 0.19, 0.22));  // cab
      box(a + 0.5, a + 16, tw - 1.0, tw + 1.0, 0.0, 1.1, C(0.06, 0.06, 0.07));     // chassis and wheels
      a += 18;
    } else a += STEP;
  }

  // ---- meshes
  const grp = new THREE.Group();
  grp.name = 'pit-building';
  grp.add(new THREE.Mesh(mergeGeometries(solid), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, metalness: 0.15, emissive: 0x0b0c0f })));
  grp.add(new THREE.Mesh(mergeGeometries(lit), new THREE.MeshBasicMaterial({ vertexColors: true })));
  grp.add(new THREE.Mesh(mergeGeometries(glass), new THREE.MeshStandardMaterial({ color: 0x22303f, metalness: 0.8, roughness: 0.12, emissive: new THREE.Color(0.26, 0.2, 0.13) })));
  grp.add(new THREE.Mesh(mergeGeometries(rail), new THREE.MeshStandardMaterial({ color: 0x9fb4c8, transparent: true, opacity: 0.35, metalness: 0.5, roughness: 0.1 })));
  // floodlight glow: camera-facing points
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.Float32BufferAttribute(glows, 3));
  grp.add(new THREE.Points(gg, new THREE.PointsMaterial({
    map: spotGlow(), size: 5, sizeAttenuation: true, color: C(0.45, 0.44, 0.41), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  })));
  if (names.length) grp.add(new THREE.Mesh(mergeGeometries(names), new THREE.MeshBasicMaterial({ map: nameTex, color: C(1.2, 1.2, 1.2), side: THREE.DoubleSide })));
  g.add(grp);

  // ---- balcony decks for the crowd (crowd.js), one per 40 m so they follow the lane
  for (const h of [H1, H2]) {
    for (let a = u0 + 2; a < u1 - 2; a += 40) {
      const b = Math.min(u1 - 2, a + 40), m = (a + b) / 2;
      if (h === H1 && Math.abs(m - uc) < pw + 20) continue;   // the podium
      const p = L.point(m, G - 2.3, h + 0.1), { t } = L.frame(m);
      out.decks.push({ x: p.x, z: p.z, y: p.y, len: b - a - 1, wid: 1.8, angle: Math.atan2(-t.z, t.x), density: 0.6, tag: 'balcony' });
    }
  }
  // paddock footprint, for the city traffic (no cars through the paddock)
  out.inPaddock = (x, z) => {
    let best = -1, bd = Infinity;
    for (let k = 0; k < L.n; k++) { const d = (L.P[k].x - x) ** 2 + (L.P[k].z - z) ** 2; if (d < bd) { bd = d; best = k; } }
    const u = L.u[best], w = (x - L.P[best].x) * L.G[best].x + (z - L.P[best].z) * L.G[best].z;
    const r = room.find(c => u >= c.a && u < c.b);
    return !!r && w > G - 2 && w < Math.max(r.wb, r.wr) + 1;
  };
  out.span = { u0, u1 };
  return out;
}
