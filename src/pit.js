// Marina Bay pit building and paddock (references/: race-weekend photos), laid out in pit-lane
// coordinates (pitlane.js: u along the lane, w toward the garages, h up) so the building front sits
// exactly on the garage line of the lane fitted from telemetry.
//   ground floor   garages (garages.js), back-of-house behind them
//   level 1        team offices, the yellow DHL parapet band (text wordmark) over the garages
//   levels 2 - 3   glazed hospitality suites with balconies over the pit lane
//   roof           lit parapet, floodlight masts aimed at the pit lane
// plus the podium cantilevered over the pit lane mid-building, the race control tower at the pit
// exit end, one SINGAPORE sign on the roof fascia, and behind the building the paddock: team
// hospitality units either side of a lit walkway and the teams' trucks. Text only, no logos.
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
  const G = P.garage, GD = P.garageDepth, D = K.depth;
  const u0 = lay.from - K.endRun, u1 = lay.to + K.endRun;
  const H0 = P.bayHeight + 1.4, H1 = H0 + 4.2, H2 = H1 + 4, H3 = H2 + 4, HR = H3 + 0.8;
  const solid = [], lit = [], glass = [], rail = [], glows = [];
  const C = (r, gg, b) => new THREE.Color(r, gg, b);
  const concrete = C(0.5, 0.52, 0.56), white = C(0.86, 0.87, 0.9), dark = C(0.08, 0.085, 0.1), warm = C(1.0, 0.82, 0.58);
  const box = (a, b, w0, w1, h0, h1, col, list = solid, k = 1) => list.push(tint(laneBox(L, a, b, w0, w1, h0, h1), col, k));

  // ---- building body
  box(u0, u1, G + GD, G + D, 0, H0, concrete);                                   // back-of-house
  box(u0, u1, G - 1.6, G + D, H0 - 0.15, H0 + 0.3, white);                       // slab over the garages
  box(u0, u1, G + 0.8, G + D, H0 + 0.3, H1, concrete);                           // offices
  for (let u = u0 + 1.5; u < u1 - 1.5; u += 3.0) box(u, u + 2.4, G + 0.7, G + 0.8, H0 + 1.3, H1 - 0.5, warm, lit, 0.45);   // office windows
  // hospitality suites: glazed, stepped forward over the lane, balconies at both levels
  glass.push(laneBox(L, u0, u1, G - 1.0, G + D - 2, H1, H3));
  for (const h of [H1, H2]) {
    box(u0, u1, G - 3.6, G - 1.0, h - 0.25, h + 0.1, white);
    rail.push(laneBox(L, u0, u1, G - 3.6, G - 3.5, h + 0.1, h + 1.15));
    box(u0, u1, G - 3.62, G - 3.48, h + 1.15, h + 1.23, C(0.85, 0.7, 0.5), lit);   // lit handrail
  }
  for (let u = u0; u <= u1; u += 3) box(u - 0.1, u + 0.1, G - 1.08, G - 0.98, H1, H3, white);   // mullions
  box(u0, u1, G - 1.05, G - 0.95, H2 - 0.2, H2 + 0.1, white);
  // roof: slab, lit parapet, floodlight masts along the front edge aimed down at the pit lane
  box(u0 - 0.5, u1 + 0.5, G - 2.0, G + D + 0.5, H3, HR, dark);
  box(u0 - 0.5, u1 + 0.5, G - 2.1, G - 1.9, HR, HR + 0.9, C(0.3, 0.32, 0.36));
  box(u0 - 0.5, u1 + 0.5, G - 2.15, G - 2.05, HR + 0.8, HR + 0.9, C(1.6, 1.6, 1.7), lit);
  for (let u = u0 + 6; u < u1 - 4; u += K.mastEvery) {
    box(u - 0.15, u + 0.15, G - 1.2, G - 0.9, HR, HR + 6, C(0.25, 0.27, 0.3));
    box(u - 1.4, u + 1.4, G - 1.8, G - 1.1, HR + 5.4, HR + 6.2, C(1.6, 1.58, 1.5), lit);
    const p = L.point(u, G - 2.4, HR + 5.6);
    glows.push(p.x, p.y, p.z);
  }
  // under-roof downlights over the balcony (the warm row in the night photos)
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

  // ---- podium, cantilevered over the pit lane mid-building, below the SINGAPORE sign
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

  // ---- one SINGAPORE sign on the roof fascia, over the podium
  const signTex = canvasTex(2048, 256, (x, w) => {
    x.clearRect(0, 0, w, 256);
    x.fillStyle = '#ffffff'; x.textAlign = 'center'; x.textBaseline = 'alphabetic';
    x.font = '700 200px "Titillium Web", sans-serif';
    if ('letterSpacing' in x) x.letterSpacing = '36px';
    x.fillText(K.sign, w / 2, 205);
    x.fillStyle = '#e10600'; x.fillRect(w * 0.2, 226, w * 0.6, 12);
  });
  const sl = K.signLength / 2, sh = K.signLength / 8;
  box(uc - sl - 1.5, uc + sl + 1.5, G - 2.45, G - 2.15, HR + 0.9, HR + 1.5 + sh, dark);
  g.add(new THREE.Mesh(laneSign(L, uc - sl, uc + sl, G - 2.5, HR + 1.2, HR + 1.2 + sh, [0, 0, 1, 1]),
    new THREE.MeshBasicMaterial({ map: signTex, transparent: true, color: C(1.05, 1.05, 1.05), side: THREE.DoubleSide })));

  // ---- race control tower at the pit exit end (glass box above the roof, antenna)
  const rc0 = u1 - 24, rc1 = u1 - 3, rh = HR + 13;
  box(rc0, rc1, G + 5, G + 24, HR, HR + 1, concrete);
  glass.push(laneBox(L, rc0 + 0.5, rc1 - 0.5, G + 5.5, G + 23.5, HR + 1, rh));
  for (let h = HR + 3.5; h < rh; h += 3.3) box(rc0 + 0.4, rc1 - 0.4, G + 5.4, G + 23.6, h, h + 0.3, white);
  box(rc0, rc1, G + 4.8, G + 24.2, rh, rh + 0.8, dark);
  box((rc0 + rc1) / 2 - 0.2, (rc0 + rc1) / 2 + 0.2, G + 14, G + 14.4, rh + 0.8, rh + 9, C(0.6, 0.62, 0.66));
  box((rc0 + rc1) / 2 - 0.3, (rc0 + rc1) / 2 + 0.3, G + 13.9, G + 14.5, rh + 8.7, rh + 9.2, C(4, 0.1, 0.1), lit);   // aviation light
  const rcTex = canvasTex(1024, 128, (x, w, h) => {
    x.fillStyle = '#0b0c10'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#ffffff'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = '700 76px "Titillium Web", sans-serif';
    if ('letterSpacing' in x) x.letterSpacing = '10px';
    x.fillText('RACE CONTROL', w / 2, h / 2 + 4);
  });
  g.add(new THREE.Mesh(laneSign(L, rc0 + 2, rc1 - 2, G + 4.75, rh - 2.6, rh - 0.4, [0, 0, 1, 1]), new THREE.MeshBasicMaterial({ map: rcTex, side: THREE.DoubleSide })));

  // ---- paddock behind the building: paving, the walkway, hospitality units, trucks
  const wb = G + D, pw0 = wb + K.gap, pw1 = pw0 + K.width;
  const pu0 = u0 - 10, pu1 = u1 + 10;
  const blocked = (a, b, w0, w1) => {
    // skip anything that would stand on an OSM building or crowd the circuit (the Turn 1 loop)
    for (const [u, w] of [[a, w0], [b, w0], [a, w1], [b, w1], [(a + b) / 2, (w0 + w1) / 2]]) {
      const p = L.point(u, w);
      if (track.nearest(p.x, p.z).d < K.trackClear) return true;
      if (city.buildings.some(bd => bd.n !== 'F1 Pit Building' && inRing(bd.p, p.x, -p.z))) return true;
    }
    return false;
  };
  box(pu0, pu1, wb, pw1, -3, -0.12, C(0.24, 0.25, 0.28));
  const wm = (pw0 + pw1) / 2, ww = K.walkway / 2;
  box(pu0, pu1, wm - ww, wm + ww, -0.12, -0.08, C(0.42, 0.42, 0.44));
  for (let u = pu0 + 6; u < pu1; u += 16) for (const s of [-1, 1]) {
    const w = wm + s * (ww + 0.6);
    box(u - 0.08, u + 0.08, w - 0.08, w + 0.08, 0, 5, C(0.3, 0.32, 0.36));
    box(u - 0.35, u + 0.35, w - 0.35, w + 0.35, 4.9, 5.15, C(1.7, 1.5, 1.1), lit);
  }
  const teams = lay.frontage;
  const rowA = teams.slice(0, Math.ceil(teams.length / 2)), rowB = teams.slice(Math.ceil(teams.length / 2));
  const unitLen = K.unitLength, step = unitLen + 4;
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
  const units = (row, wFront, dir) => {
    const total = row.length * step, s0 = (pu0 + pu1) / 2 - total / 2;
    row.forEach((f, i) => {
      const a = s0 + i * step + 2, b = a + unitLen;
      const wf = wFront, wbk = wFront + dir * K.unitDepth;
      const [w0, w1] = dir > 0 ? [wf, wbk] : [wbk, wf];
      if (blocked(a, b, w0, w1)) return;
      const col = new THREE.Color(f.color);
      box(a, b, w0, w1, -0.1, K.unitHeight, C(0.2, 0.21, 0.24));
      // glazed front toward the walkway, lit inside; team-colour band and name along the top
      const gf = wf - dir * 0.05;
      box(a + 0.6, b - 0.6, Math.min(gf, gf - dir * 0.1), Math.max(gf, gf - dir * 0.1), 0.4, K.unitHeight - 1.4, warm, lit, 0.42);
      box(a, b, Math.min(wf, wf - dir * 0.3), Math.max(wf, wf - dir * 0.3), K.unitHeight - 1.3, K.unitHeight, col, solid, 0.9);
      const k = teams.indexOf(f), n = teams.length;
      names.push(laneSign(L, a + 2, b - 2, wf - dir * 0.35, K.unitHeight - 1.2, K.unitHeight - 0.1, [0, 1 - (k + 1) / n, 1, 1 - k / n]));
      // awning over the entrance
      box(a + unitLen / 2 - 3, a + unitLen / 2 + 3, Math.min(wf, wf - dir * 2.5), Math.max(wf, wf - dir * 2.5), 3.0, 3.2, white);
    });
  };
  units(rowA, wm - ww - 1.5, -1);
  units(rowB, wm + ww + 1.5, 1);
  // trucks, parked along the back of the paddock in pit order
  const tw = pw1 - 6, tstep = (pu1 - pu0) / Math.max(1, teams.length);
  teams.forEach((f, i) => {
    const a = pu0 + i * tstep + 3;
    if (blocked(a, a + 17, tw - 1.3, tw + 1.3)) return;
    const col = new THREE.Color(f.color);
    box(a, a + 13.6, tw - 1.25, tw + 1.25, 1.1, 4.0, col, solid, 0.75);       // trailer
    box(a + 13.9, a + 16.4, tw - 1.2, tw + 1.2, 0.9, 3.6, C(0.18, 0.19, 0.22)); // cab
    box(a + 0.5, a + 16, tw - 1.0, tw + 1.0, 0.0, 1.1, C(0.06, 0.06, 0.07));    // chassis and wheels
  });

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
    return u > pu0 - 5 && u < pu1 + 5 && w > G - 2 && w < pw1 + 4;
  };
  out.span = { u0, u1 };
  return out;
}
