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

// The rooftop SINGAPORE letters (aerial night photo, references/): one extruded letter per roof bay,
// standing on the roof facing the track and leaning back toward the paddock, white faces on red
// returns. The word runs along the roof and reads left to right from the grandstands across the
// track, and from the overhead TV shot. The glyphs are a 9-letter subset of three.js's Helvetiker
// Bold (assets/fonts/roof-letters.json), loaded after the scene is up; two merged meshes.
const LEAN = THREE.MathUtils.degToRad(50);   // from vertical, top toward the paddock
function buildRoofLetters(g, L, word, o) {
  Promise.all([import('three/addons/loaders/FontLoader.js'), import('three/addons/geometries/TextGeometry.js'), fetch('assets/fonts/roof-letters.json').then(r => r.json())])
    .then(([{ Font }, { TextGeometry }, json]) => {
      const font = new Font(json), faces = [], sides = [];
      const inw = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(), z = new THREE.Vector3(), m = new THREE.Matrix4();
      // facing the building from the track, is +u to the viewer's right? then S goes at the low-u end
      const mid = (o.at(0) + o.at(word.length - 1)) / 2;
      const facing = u => inw.subVectors(L.point(u, 10), L.point(u, 0)).setY(0).normalize();
      const along = L.point(mid + 5, 0).sub(L.point(mid - 5, 0));
      const forward = right.crossVectors(facing(mid), THREE.Object3D.DEFAULT_UP).dot(along) > 0;
      [...word].forEach((ch, k) => {
        const geo = new TextGeometry(ch, { font, size: o.size, depth: 1.4, curveSegments: 5, bevelEnabled: false });
        geo.computeBoundingBox();
        const bb = geo.boundingBox;
        geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -1.4);   // base centre, face at z = 0
        const i = forward ? k : word.length - 1 - k;
        const u = o.at(i);
        facing(u);                                                     // track -> paddock
        right.crossVectors(inw, THREE.Object3D.DEFAULT_UP).normalize();
        up.set(0, Math.cos(LEAN), 0).addScaledVector(inw, Math.sin(LEAN));
        z.crossVectors(right, up);                                     // face normal: toward the track, upward
        const p = L.point(u, o.w(u), o.h);
        m.makeBasis(right, up, z).setPosition(p);
        geo.applyMatrix4(m);
        // ExtrudeGeometry groups: 0 = front and back caps, 1 = side walls
        for (const gr of geo.groups) (gr.materialIndex === 0 ? faces : sides).push(slice(geo, gr.start, gr.count));
      });
      const grp = new THREE.Group();
      grp.name = 'roof-letters';
      grp.add(new THREE.Mesh(mergeGeometries(faces), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.86, 0.85, 0.83) })));
      grp.add(new THREE.Mesh(mergeGeometries(sides), new THREE.MeshStandardMaterial({ color: 0xd0303f, emissive: new THREE.Color(0.42, 0.04, 0.07), roughness: 0.5 })));
      g.add(grp);
    })
    .catch(err => console.warn('roof letters:', err));
}

// A solid between w0(u) and w1(u) over u0..u1, h0..h1, sampled every `step` metres, so a back edge
// that runs oblique to the lane is one smooth wall instead of a staircase of boxes. w0 / w1 are
// numbers or functions of u. Non-indexed, flat normals, no uv (to merge with laneBox pieces).
function laneSolid(L, u0, u1, w0, w1, h0, h1, step = 2) {
  const f0 = typeof w0 === 'function' ? w0 : () => w0, f1 = typeof w1 === 'function' ? w1 : () => w1;
  const N = Math.max(1, Math.ceil((u1 - u0) / step)), pos = [];
  const P = (u, w, h) => { const v = L.point(u, w, h); return [v.x, v.y, v.z]; };
  const quad = (a, b, c, d) => pos.push(...a, ...b, ...c, ...b, ...d, ...c);
  for (let j = 0; j < N; j++) {
    const ua = u0 + (u1 - u0) * j / N, ub = u0 + (u1 - u0) * (j + 1) / N;
    const A = [f0(ua), f1(ua)], B = [f0(ub), f1(ub)];
    quad(P(ua, A[0], h1), P(ub, B[0], h1), P(ua, A[1], h1), P(ub, B[1], h1));   // top
    quad(P(ua, A[1], h0), P(ub, B[1], h0), P(ua, A[1], h1), P(ub, B[1], h1));   // back (w1)
    quad(P(ub, B[0], h0), P(ua, A[0], h0), P(ub, B[0], h1), P(ua, A[0], h1));   // front (w0)
  }
  for (const [u, s] of [[u0, 1], [u1, -1]]) {                                      // end caps
    const a = P(u, f0(u), h0), b = P(u, f1(u), h0), c = P(u, f0(u), h1), d = P(u, f1(u), h1);
    s > 0 ? quad(b, a, d, c) : quad(a, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  // face winding depends on which side of the lane the garages are: make every normal point out
  g.computeVertexNormals();
  if (L.side > 0) {
    const p = g.attributes.position.array;
    for (let i = 0; i < p.length; i += 9) for (let k = 0; k < 3; k++) [p[i + 3 + k], p[i + 6 + k]] = [p[i + 6 + k], p[i + 3 + k]];
    g.computeVertexNormals();
  }
  return g;
}

// a unit shape (inside the -0.5..0.5 cube) bent onto the lane like laneBox
function laneShape(L, geo, u0, u1, w0, w1, h0, h1) {
  const g = geo.index ? geo.toNonIndexed() : geo, pos = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    L.point(u0 + (pos.getX(i) + 0.5) * (u1 - u0), w0 + (pos.getZ(i) + 0.5) * (w1 - w0), h0 + (pos.getY(i) + 0.5) * (h1 - h0), v);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}
// barrel-vault roof along x: half cylinder rising from y = -0.5 to 0.5
const arch = () => new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1, true, 0, Math.PI).rotateZ(Math.PI / 2).scale(1, 2, 1).translate(0, -0.5, 0);

// one draw group of a non-indexed geometry, as its own geometry
function slice(geo, start, count) {
  const out = new THREE.BufferGeometry();
  for (const k of ['position', 'normal']) {
    const a = geo.attributes[k];
    out.setAttribute(k, new THREE.Float32BufferAttribute(a.array.slice(start * 3, (start + count) * 3), 3));
  }
  return out;
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
  const solid = [], lit = [], glass = [], rail = [], glows = [], tents = [];
  const C = (r, gg, b) => new THREE.Color(r, gg, b);
  const concrete = C(0.5, 0.52, 0.56), white = C(0.86, 0.87, 0.9), dark = C(0.08, 0.085, 0.1), warm = C(1.0, 0.82, 0.58);
  const box = (a, b, w0, w1, h0, h1, col, list = solid, k = 1) => list.push(tint(laneBox(L, a, b, w0, w1, h0, h1), col, k));
  const STEP = 4;

  // ---- building body: continuous along the footprint's back edge (Gd), the paddock face set back
  // behind its balconies (PB), so the Paddock Club suites have a deck on the paddock side too
  const Gd = u => G + depth(u), PB = u => Gd(u) - 3.2;
  const solidPiece = (w0, w1, h0, h1, col, list = solid, k = 1) => list.push(tint(laneSolid(L, u0, u1, w0, w1, h0, h1), col, k));
  solidPiece(G + GD, u => Gd(u) - 1.2, 0, H0, concrete);                          // back-of-house
  solidPiece(G - 1.6, Gd, H0 - 0.15, H0 + 0.3, white);                            // slab over the garages
  solidPiece(G + 0.8, PB, H0 + 0.3, H1, concrete);                                // offices
  glass.push(laneSolid(L, u0, u1, G - 1.0, PB, H1, H3));                          // hospitality suites
  solidPiece(G - 3.4, u => Gd(u) + 0.5, H3, HR, dark);                            // roof, overhanging both balconies
  for (let u = u0 + 1.5; u < u1 - 1.5; u += 3.0) box(u, u + 2.4, G + 0.7, G + 0.8, H0 + 1.3, H1 - 0.5, warm, lit, 0.45);   // office windows

  // ---- Paddock Club: the paddock face. Glazed suites on levels 2-3 with warm rooms behind the
  // glass, balconies with glass rails, offices on level 1 with PADDOCK CLUB lettering, and the teams'
  // back doors at ground level under canvas awnings
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let u = u0 + 0.6; u < u1 - 3; u += 3) {
    const pb = PB(u + 1.5);
    box(u - 0.1, u + 0.1, pb - 0.05, pb + 0.1, H1, H3, white);                                       // mullions
    for (const [ha, hb] of [[H1 + 0.3, H2 - 0.25], [H2 + 0.25, H3 - 0.3]]) {
      const k = rnd();
      if (k > 0.12) box(u + 0.25, u + 2.75, pb + 0.02, pb + 0.06, ha, hb, warm, lit, 0.22 + 0.3 * k);    // lit suite
    }
    if ((u - u0) % 12 < 3) {                                                                         // ground floor
      const gd = Gd(u + 1.5) - 1.2;
      box(u + 0.4, u + 2.6, gd, gd + 0.08, 0.1, 3.6, C(0.42, 0.44, 0.47));                         // roller door
      box(u + 0.2, u + 2.8, gd, gd + 2.4, 3.9, 4.05, C(0.9, 0.9, 0.92));                            // awning
      box(u + 0.6, u + 2.4, gd + 0.1, gd + 0.3, 3.7, 3.85, C(1.4, 1.2, 0.9), lit);                   // door light
    }
  }
  box(u0, u1, G + 0.8, G + 0.9, H2 - 0.2, H2 + 0.1, white);
  for (const h of [H1, H2]) {                                                                       // paddock-side balconies
    solidPiece(PB, u => Gd(u) - 0.2, h - 0.3, h + 0.05, white);
    rail.push(laneSolid(L, u0, u1, u => Gd(u) - 0.3, u => Gd(u) - 0.2, h + 0.05, h + 1.1));
    solidPiece(u => Gd(u) - 0.32, u => Gd(u) - 0.18, h + 1.1, h + 1.17, C(0.85, 0.7, 0.5), lit);
  }
  const clubTex = canvasTex(1024, 96, (x, w, h) => {
    x.fillStyle = '#121418'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#f2f2f2'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = '700 58px "Titillium Web", sans-serif';
    if ('letterSpacing' in x) x.letterSpacing = '14px';
    x.fillText('PADDOCK CLUB', w / 2, h / 2 + 3);
  });
  const clubSigns = [];
  for (let u = u0 + 30; u < u1 - 40; u += 70) {
    const w = PB(u + 9) + 0.15;
    clubSigns.push(laneSign(L, u + 18, u, w, H0 + 1.0, H1 - 0.6, [0, 0, 1, 1]));   // reversed u: faces the paddock
  }
  g.add(new THREE.Mesh(mergeGeometries(clubSigns), new THREE.MeshBasicMaterial({ map: clubTex, color: C(0.9, 0.9, 0.9), side: THREE.DoubleSide })));
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

  // ---- roof (aerial night photo, references/): dark membrane in bays, each bay framed by a raised
  // beam with a warm light line, plant along the paddock edge, and one standing letter per bay
  const roofTex = canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = '#25272c'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) {   // membrane grain
      const v = 30 + Math.random() * 18 | 0;
      x.fillStyle = `rgba(${v},${v + 1},${v + 4},0.5)`; x.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    x.strokeStyle = 'rgba(70,74,82,0.9)'; x.lineWidth = 2;   // standing seams across the roof every 2 m
    for (let y = 0; y < h; y += 64) { x.beginPath(); x.moveTo(0, y + 1); x.lineTo(w, y + 1); x.stroke(); }
    x.strokeStyle = 'rgba(14,15,18,0.9)';                      // drainage lines along it
    for (const fx of [0.33, 0.66]) { x.beginPath(); x.moveTo(fx * w, 0); x.lineTo(fx * w, h); x.stroke(); }
  });
  roofTex.wrapS = roofTex.wrapT = THREE.RepeatWrapping;
  roofTex.repeat.set(1, 1 / 8);
  const roofTop = L.strip(u0, u1, G - 3.4, u => G + depth(u) + 0.5, HR + 0.03, 2);
  g.add(new THREE.Mesh(roofTop, new THREE.MeshStandardMaterial({ map: roofTex, roughness: 0.85, metalness: 0.1, emissive: 0x050608 })));
  const letters = 'SINGAPORE';
  const margin = 18, bay = (u1 - u0 - 2 * margin) / letters.length;
  const dRoof = u => depth(u) + 0.5;
  for (let i = 0; i <= letters.length; i++) {
    const u = u0 + margin + i * bay;
    box(u - 0.6, u + 0.6, G - 3.2, G + dRoof(u) - 0.3, HR, HR + 0.7, C(0.2, 0.21, 0.24));
    box(u - 0.62, u + 0.62, G - 3.2, G + dRoof(u) - 0.3, HR + 0.7, HR + 0.78, C(1.3, 0.75, 0.38), lit);   // lit beam edge
  }
  box(u0, u1, G - 3.4, G - 3.0, HR, HR + 0.9, C(0.2, 0.21, 0.24));                                    // front parapet
  box(u0, u1, G - 3.42, G - 2.98, HR + 0.9, HR + 0.96, C(1.3, 0.75, 0.38), lit);
  solidPiece(u => Gd(u) + 0.1, u => Gd(u) + 0.5, HR, HR + 0.9, C(0.2, 0.21, 0.24));                // back parapet
  // plant along the paddock edge: plant rooms, condenser banks, duct runs (not under race control)
  const plantTo = u1 - 28;
  for (let u = u0 + margin + 4; u < plantTo - 10; u += 26) {
    const d = Math.min(dRoof(u), dRoof(u + 10)), wb = G + d - 2;
    box(u, u + 9, wb - 7, wb, HR, HR + 3.2, C(0.33, 0.34, 0.37));                                     // plant room
    box(u - 0.1, u + 9.1, wb - 7.1, wb + 0.1, HR + 3.2, HR + 3.45, C(0.16, 0.17, 0.19));
    for (let k = 0; k < 4; k++) for (let j = 0; j < 2; j++) {                                           // condensers
      const cu = u + 11 + k * 2.6, cw = wb - 1.4 - j * 2.6;
      box(cu, cu + 2.1, cw - 2.1, cw, HR, HR + 1.1, C(0.5, 0.52, 0.55));
      box(cu + 0.3, cu + 1.8, cw - 1.8, cw - 0.3, HR + 1.1, HR + 1.14, C(0.05, 0.05, 0.06));          // fan grille
    }
    box(u + 9, u + 26, wb - 8.6, wb - 7.8, HR, HR + 0.9, C(0.42, 0.44, 0.47));                         // duct
  }
  buildRoofLetters(g, L, letters, {
    at: i => u0 + margin + (i + 0.5) * bay,
    w: u => G + 0.1 * dRoof(u), h: HR + 0.1,
    size: Math.min(0.8 * bay, 0.72 * K.depth, 20),
  });

  // ---- paddock: the strip between the back of the building and the next road (OSM), never over
  // a road, an OSM building or near the circuit
  const centre = L.point((u0 + u1) / 2, G + 20);
  const segs = [];
  for (const r of city.roads) {
    if (r.k === 'service') continue;   // the paddock's own access lanes (scripts/fetch_road_tags.py)
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
  // paving: one strip over the stretches with room, its far edge following the room per chunk
  const roomOf = u => room.find(r => u >= r.a && u < r.b) || room[room.length - 1];
  const paved = [];
  for (const r of room) {
    const ok = r.wr - r.wb > 6, last = paved[paved.length - 1];
    if (ok && last && last.b === r.a) last.b = r.b; else if (ok) paved.push({ a: r.a, b: r.b });
  }
  for (const s of paved) {
    const geo = L.strip(s.a, s.b, u => roomOf(u).wb - 0.5, u => roomOf(u).wr, 0.04, STEP);
    g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x3a3c41, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 })));
  }
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
      // white marquee (barrel roof) in front of the unit where the strip allows, as in the aerial photo
      if (space >= K.unitDepth + 19) {
        const m0 = w0 - 9.5, m1 = w0 - 2.6;
        box(a + 1, b - 1, m0, m1, 0, 2.8, C(0.82, 0.83, 0.85), tents);
        tents.push(tint(laneShape(L, arch(), a + 1, b - 1, m0, m1, 2.8, 4.8), C(0.92, 0.93, 0.95)));
        box(a + 2, b - 2, m0 - 0.02, m0, 0.3, 2.4, warm, lit, 0.35);                    // lit side wall
      }
      // walkway with lamps and people between the building and the units
      const wl = wb + 4;
      box(a - 2, b + 2, wb + 1.5, wb + 6.5, -0.11, -0.05, C(0.42, 0.43, 0.45));
      box(a - 0.08, a + 0.08, wl - 0.08, wl + 0.08, 0, 5, C(0.3, 0.32, 0.36));
      box(a - 0.35, a + 0.35, wl - 0.35, wl + 0.35, 4.9, 5.15, C(1.7, 1.5, 1.1), lit);
      const p = L.point((a + b) / 2, wl, 0), { t } = L.frame((a + b) / 2);
      out.decks.push({ x: p.x, z: p.z, y: p.y, len: unitLen + 2, wid: 4, angle: Math.atan2(-t.z, t.x), density: 0.07, tag: 'paddock' });
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
  if (tents.length) grp.add(new THREE.Mesh(mergeGeometries(tents), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, emissive: 0x2a2a2c, side: THREE.DoubleSide })));
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
