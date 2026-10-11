// Garages, painted pit boxes, overhead box rigs and pit-wall stands, laid out along the fitted pit
// lane (pitlane.js) in lane coordinates: u along the lane, w across it toward the garages, h up.
// Each team's painted box sits where its cars actually stopped (track.pitlane.boxes, measured per
// season); the garage frontage is spaced evenly along the same order (a straight-line fit of the
// box positions), two bays per team, one per driver, with the driver's number board above the door.
// Text only: team names and driver numbers, no logos.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PIT_LANE, PADDOCK } from './config.js';
import { frontage } from './pitlane.js';

const P = PIT_LANE;
// boards over the garages that are not a team's (order is a guess)
const NEUTRAL = ['FIA', 'SAFETY CAR', 'MEDICAL CAR', 'FIA', 'TYRES', 'SCRUTINEERING', 'MARSHALS'];
const C = (r, g, b) => new THREE.Color(r, g, b);

// unit box mapped into lane space: u0..u1 along, w0..w1 across, h0..h1 up
export function laneBox(L, u0, u1, w0, w1, h0, h1) {
  const g = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  const pos = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const u = u0 + (pos.getX(i) + 0.5) * (u1 - u0), h = h0 + (pos.getY(i) + 0.5) * (h1 - h0), w = w0 + (pos.getZ(i) + 0.5) * (w1 - w0);
    L.point(u, w, h, v);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

// upright cylinder in lane space: centre (u, w), h0..h1 up, radius r
export function laneCyl(L, u, w, h0, h1, r, seg = 14) {
  const g = new THREE.CylinderGeometry(r, r, h1 - h0, seg).toNonIndexed();
  const pos = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    L.point(u + pos.getX(i), w + pos.getZ(i), (h0 + h1) / 2 + pos.getY(i), v);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

// vertical quad facing the lane (toward -w) at w, spanning u0..u1, h0..h1, uv rect [a, b, c, d];
// u reads left to right for someone in the lane facing the garages
export function laneSign(L, u0, u1, w, h0, h1, uv) {
  const [ua, ub] = L.side < 0 ? [u0, u1] : [u1, u0];
  const p = (u, h) => L.point(u, w, h);
  const q = [p(ua, h0), p(ub, h0), p(ua, h1), p(ub, h1)];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(q.flatMap(v => [v.x, v.y, v.z]), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([uv[0], uv[1], uv[2], uv[1], uv[0], uv[3], uv[2], uv[3]], 2));
  g.setIndex([0, 1, 2, 1, 3, 2]);
  g.computeVertexNormals();
  return g;
}

// flat quad on the lane: u0..u1, w0..w1; text reads from the pit wall (up = toward the garages)
export function laneDecal(L, u0, u1, w0, w1, uv, lift = 0.03) {
  const [ua, ub] = L.side < 0 ? [u0, u1] : [u1, u0];
  const p = (u, w) => L.point(u, w, lift);
  const q = [p(ua, w0), p(ub, w0), p(ua, w1), p(ub, w1)];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(q.flatMap(v => [v.x, v.y, v.z]), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([uv[0], uv[1], uv[2], uv[1], uv[0], uv[3], uv[2], uv[3]], 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  g.setIndex([0, 1, 2, 1, 3, 2]);
  return g;
}

export function tint(g, c, k = 1) {
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r * k; a[i * 3 + 1] = c.g * k; a[i * 3 + 2] = c.b * k; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

function atlas(cells, cw, ch, draw) {
  const c = document.createElement('canvas');
  c.width = cw * cells.length; c.height = ch;
  const x = c.getContext('2d');
  cells.forEach((cell, i) => { x.save(); x.translate(i * cw, 0); draw(x, cell, cw, ch); x.restore(); });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const fitText = (x, text, max, size, weight = 900, style = '') => {
  let s = size;
  do { x.font = `${style} ${weight} ${s}px "Titillium Web", sans-serif`; s -= 2; } while (x.measureText(text).width > max && s > 8);
};

// -> { frontage: [{team, color, box, c, width, drivers}], from, to } (lane u), or null
export function garageLayout(L, race) {
  const colors = new Map(race.drivers.map(d => [d.team, d.color]));
  const boxes = (L.data.boxes || []).filter(b => colors.has(b.team));
  const fr = frontage(boxes);
  if (!fr) return null;
  return {
    frontage: boxes.map((b, i) => ({
      team: b.team, color: colors.get(b.team), box: b.u, c: fr.centres[i], width: fr.slope,
      drivers: race.drivers.filter(d => d.team === b.team).sort((x, y) => x.num - y.num),
    })),
    from: fr.from, to: fr.to, slope: fr.slope,
  };
}

export function buildGarages(g, track, race) {
  const L = track.lane;
  const lay = L && garageLayout(L, race);
  if (!lay) return null;
  const G = P.garage, D = P.garageDepth, H = P.bayHeight;
  const lit = [], solid = [], signs = [], decals = [], glows = [], nameDecals = [];
  const white = new THREE.Color(0.86, 0.87, 0.9), grey = new THREE.Color(0.32, 0.33, 0.37), dark = new THREE.Color(0.07, 0.075, 0.085);
  const epoxy = new THREE.Color(0.62, 0.63, 0.66), steel = new THREE.Color(0.55, 0.57, 0.62);

  // ---- driver number boards (one per bay) and team names for the boxes
  const bays = lay.frontage.flatMap(f => [0, 1].map(j => ({ f, j, d: f.drivers[j] })));
  const boardTex = atlas(bays, 512, 128, (x, { f, d }, w, h) => {
    x.fillStyle = '#0c0d11'; x.fillRect(0, 0, w, h);
    x.fillStyle = f.color; x.fillRect(0, h - 14, w, 14); x.fillRect(0, 0, 10, h);
    x.textBaseline = 'middle'; x.fillStyle = '#ffffff';
    x.textAlign = 'left';
    fitText(x, d ? String(d.num) : '', 150, 92, 900, 'italic');
    x.fillText(d ? String(d.num) : '', 34, h / 2 - 4);
    x.fillStyle = '#d9dce3';
    fitText(x, d ? d.last.toUpperCase() : f.team.toUpperCase(), 300, 54, 700);
    x.textAlign = 'right';
    x.fillText(d ? d.last.toUpperCase() : f.team.toUpperCase(), w - 28, h / 2 - 2);
  });
  const nameTex = atlas(lay.frontage, 1024, 128, (x, f, w, h) => {
    x.clearRect(0, 0, w, h);
    x.fillStyle = '#ffffff'; x.textAlign = 'center'; x.textBaseline = 'middle';
    fitText(x, f.team.toUpperCase(), w - 60, 96, 900, 'italic');
    x.fillText(f.team.toUpperCase(), w / 2, h / 2 + 4);
  });

  // team-colour beam over each bay with the driver's name, like the garage beams in the paddock
  const beamTex = atlas(bays, 512, 64, (x, { f, d }, w, h) => {
    x.fillStyle = f.color; x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgba(0,0,0,0.22)'; x.fillRect(0, h - 8, w, 8);
    x.fillStyle = '#ffffff'; x.textAlign = 'center'; x.textBaseline = 'middle';
    const name = (d ? d.name : f.team).toUpperCase();
    fitText(x, name, w - 40, 40, 900, 'italic');
    x.fillText(name, w / 2, h / 2 - 2);
  });
  const beams = [];
  const black = C(0.035, 0.035, 0.04);
  const bands = [C(0.85, 0.08, 0.08), C(0.95, 0.8, 0.1), C(0.9, 0.9, 0.92)];   // soft, medium, hard sidewalls
  const screenBlue = C(0.3, 0.55, 1.0);
  lay.bays = new Map();

  lay.frontage.forEach((f, ti) => {
    const col = new THREE.Color(f.color);
    const bayW = f.width / 2;
    for (let j = 0; j < 2; j++) {
      const a = f.c - f.width / 2 + j * bayW, b = a + bayW;
      const a1 = a + 0.3, b1 = b - 0.3;
      // floor, back wall (team colour low, white high), ceiling with light strips
      lit.push(tint(laneBox(L, a1, b1, G, G + D, -0.05, 0.02), epoxy, 0.36));
      lit.push(tint(laneBox(L, a1, b1, G + D - 0.2, G + D, 0, 2.6), col, 0.7));
      lit.push(tint(laneBox(L, a1, b1, G + D - 0.2, G + D, 2.6, H), white, 0.36));
      solid.push(tint(laneBox(L, a1, b1, G, G + D, H, H + 0.2), grey));
      for (let r = 0; r < 3; r++) {
        const w0 = G + 1.5 + r * (D - 3) / 2;
        lit.push(tint(laneBox(L, a1 + 0.8, b1 - 0.8, w0, w0 + 0.35, H - 0.12, H - 0.02), new THREE.Color(1.15, 1.13, 1.08)));
      }
      // side walls: white with a team stripe
      for (const e of [a, b - 0.3]) {
        lit.push(tint(laneBox(L, e, e + 0.3, G, G + D, 0, H), white, 0.3));
        lit.push(tint(laneBox(L, e - 0.01, e + 0.31, G + 0.5, G + D - 0.5, 1.2, 1.6), col, 0.9));
      }
      // tool chests and a tyre rack along the walls
      solid.push(tint(laneBox(L, a1 + 0.2, a1 + 1.0, G + 3, G + 8, 0, 1.0), col, 0.8));
      solid.push(tint(laneBox(L, b1 - 1.0, b1 - 0.2, G + 3, G + 8, 0, 1.0), dark));
      solid.push(tint(laneBox(L, a1 + 1.5, b1 - 1.5, G + D - 1.4, G + D - 0.3, 0, 1.8), dark));
      // open door: roller housing above the opening, team-colour jambs
      solid.push(tint(laneBox(L, a, b, G - 0.15, G + 0.45, H, H + 1.3), dark));
      solid.push(tint(laneBox(L, a, a + 0.35, G - 0.2, G + 0.2, 0, H), col, 0.9));
      solid.push(tint(laneBox(L, b - 0.35, b, G - 0.2, G + 0.2, 0, H), col, 0.9));
      // park the retired car's recovered position: bay centre, nose to the door
      const dr = f.drivers[j];
      if (dr) {
        const uc = (a + b) / 2, wc2 = G + D * 0.5;
        const p = L.point(uc, wc2, 0.1), front = L.point(uc, G, 0.1), back = L.point(uc, G + D, 0.1);
        lay.bays.set(dr.k, { x: p.x, y: p.y, z: p.z, heading: Math.atan2(front.x - back.x, front.z - back.z) });
      }
      // garage dressing: monitor bank + wall TV, tyre stacks, big light panels, name beam, mats
      {
        // timing desk with a row of angled-looking screens, in front of the right wall
        solid.push(tint(laneBox(L, b1 - 1.05, b1 - 0.15, G + 8.2, G + 11.7, 0, 0.95), col, 0.75));
        solid.push(tint(laneBox(L, b1 - 1.1, b1 - 0.1, G + 8.1, G + 11.8, 0.95, 1.02), dark));
        for (let m = 0; m < 5; m++) {
          const w0 = G + 8.25 + m * 0.68;
          solid.push(tint(laneBox(L, b1 - 0.95, b1 - 0.78, w0, w0 + 0.6, 1.1, 1.78), dark));
          lit.push(tint(laneBox(L, b1 - 1.0, b1 - 0.95, w0 + 0.04, w0 + 0.56, 1.14, 1.74), screenBlue, 1.15 - (m % 2) * 0.25));
        }
        // large wall TV high on the back wall, and a strip of status screens either side
        solid.push(tint(laneBox(L, a1 + 3.2, b1 - 3.2, G + D - 0.28, G + D - 0.2, 2.1, 3.3), dark));
        lit.push(tint(laneBox(L, a1 + 3.3, b1 - 3.3, G + D - 0.31, G + D - 0.28, 2.18, 3.22), C(0.25, 0.4, 0.75), 1.1));
        lit.push(tint(laneBox(L, a1 + 3.5, a1 + 5.0, G + D - 0.33, G + D - 0.31, 2.3, 3.0), col, 1.4));
        // tyre stacks in the back corner and beside the door (sidewall colour bands)
        const stacks = [[a1 + 0.75, G + D - 1.0, 5, 0], [a1 + 1.55, G + D - 1.0, 4, 1], [a1 + 0.75, G + D - 1.9, 3, 2], [a1 + 1.4, G + 1.4, 3, (ti + j) % 3]];
        for (const [su, sw, nt, bi] of stacks) {
          for (let q = 0; q < nt; q++) {
            const h0 = q * 0.4;
            solid.push(tint(laneCyl(L, su, sw, h0, h0 + 0.38, 0.33), black));
            solid.push(tint(laneCyl(L, su, sw, h0 + 0.15, h0 + 0.23, 0.336), bands[bi]));
          }
        }
        // second rack: tyre sets stacked on the back-wall rack
        for (let q = 0; q < 4; q++) {
          const ru2 = a1 + 2.2 + q * 0.95;
          if (ru2 > b1 - 2.0) break;
          solid.push(tint(laneCyl(L, ru2, G + D - 0.85, 1.8, 2.2, 0.33), black));
          solid.push(tint(laneCyl(L, ru2, G + D - 0.85, 1.93, 2.07, 0.336), bands[(q + ti) % 3]));
        }
        // big overhead light panels and wall lamps
        for (const w0 of [G + 2.2, G + 5.4, G + 8.6]) lit.push(tint(laneBox(L, a1 + 1.4, b1 - 1.4, w0, w0 + 1.3, H - 0.1, H - 0.03), C(1.6, 1.58, 1.5)));
        for (const e of [a1 + 0.05, b1 - 0.3]) for (const w0 of [G + 3, G + 7.5]) lit.push(tint(laneBox(L, e, e + 0.25, w0, w0 + 1.6, 3.6, 3.75), C(1.4, 1.4, 1.35)));
        // name beam inside the door, floor mats by the desk and the car
        solid.push(tint(laneBox(L, a1, b1, G + 0.5, G + 1.3, H - 0.95, H), col, 0.8));
        beams.push(laneSign(L, a1 + 0.1, b1 - 0.1, G + 0.48, H - 0.9, H - 0.1, [(ti * 2 + j) / bays.length, 0, (ti * 2 + j + 1) / bays.length, 1]));
        solid.push(tint(laneBox(L, b1 - 2.6, b1 - 1.2, G + 8.4, G + 10.8, 0, 0.03), dark));
        solid.push(tint(laneBox(L, a + bayW / 2 - 1.6, a + bayW / 2 + 1.6, G + 0.8, G + 2.2, 0, 0.025), dark));
      }
      // number board over the door
      const k = ti * 2 + j, n = bays.length;
      signs.push(laneSign(L, a + 0.6, b - 0.6, G - 0.17, H + 0.15, H + 1.2, [k / n, 0, (k + 1) / n, 1]));
      // light spilling out of the open door onto the working lane
      glows.push(laneDecal(L, a1, b1, G - 4.5, G, [0, 1, 1, 0], 0.035));   // brightest at the door
    }

    // ---- painted box where the team's cars stopped: tinted fill, outline, wheel marks, name
    const bu = f.box, half = P.boxLen / 2, w0 = P.fast + 0.35, w1 = G - 0.35;
    decals.push(tint(laneDecal(L, bu - half, bu + half, w0, w1, [0, 0, 1, 1], 0.025), col, 0.22));
    const line = (u0, u1, v0, v1) => decals.push(tint(laneDecal(L, u0, u1, v0, v1, [0, 0, 1, 1], 0.03), col, 1.1));
    line(bu - half, bu + half, w0, w0 + 0.22); line(bu - half, bu + half, w1 - 0.22, w1);
    line(bu - half, bu - half + 0.22, w0, w1); line(bu + half - 0.22, bu + half, w0, w1);
    // front and rear wheel marks across the car's track width
    const wc = (w0 + w1) / 2;
    for (const du of [1.8, -1.8]) for (const s of [-1, 1]) decals.push(tint(laneDecal(L, bu + du - 0.35, bu + du + 0.35, wc + s * 0.85 - 0.1, wc + s * 0.85 + 0.1, [0, 0, 1, 1], 0.032), white));
    decals.push(tint(laneDecal(L, bu + 3.3, bu + 3.5, wc - 0.9, wc + 0.9, [0, 0, 1, 1], 0.032), white));
    nameDecals.push(laneDecal(L, bu - half + 0.6, bu + half - 0.6, w1 - 1.25, w1 - 0.3, [ti / lay.frontage.length, 0, (ti + 1) / lay.frontage.length, 1], 0.034));

    // ---- overhead box rig: column at the garage line behind the box, boom out over it with lights
    const ru = bu - half - 0.4;
    solid.push(tint(laneBox(L, ru - 0.2, ru + 0.2, G - 0.6, G - 0.2, 0, 5.9), steel));
    solid.push(tint(laneBox(L, ru - 0.15, ru + 0.15, P.fast + 0.8, G - 0.2, 5.6, 5.9), steel));
    solid.push(tint(laneBox(L, ru, bu + half - 0.8, wc - 0.15, wc + 0.15, 5.45, 5.7), steel));
    lit.push(tint(laneBox(L, ru + 0.6, bu + half - 1.2, wc - 0.12, wc + 0.12, 5.38, 5.45), new THREE.Color(1.5, 1.48, 1.4)));
    solid.push(tint(laneBox(L, ru - 0.16, ru + 0.16, P.fast + 0.8, G - 0.6, 5.9, 6.25), col, 0.9));

    // ---- pit-wall stand opposite the team's garages: deck, desk with timing screens, canopy
    const su = f.c, wi = L.inner(su), sw0 = wi - 2.1, sw1 = wi - 0.25, sl = Math.min(7, f.width * 0.32);
    solid.push(tint(laneBox(L, su - sl / 2, su + sl / 2, sw0, sw1, 0, 0.9), dark));
    solid.push(tint(laneBox(L, su - sl / 2, su + sl / 2, sw0, sw0 + 0.6, 0.9, 1.7), grey));
    lit.push(tint(laneBox(L, su - sl / 2 + 0.3, su + sl / 2 - 0.3, sw0 + 0.62, sw0 + 0.66, 1.75, 2.35), new THREE.Color(0.35, 0.5, 0.75)));
    for (const e of [su - sl / 2 + 0.1, su + sl / 2 - 0.25]) solid.push(tint(laneBox(L, e, e + 0.15, sw1 - 0.3, sw1 - 0.15, 0.9, 3.3), steel));
    solid.push(tint(laneBox(L, su - sl / 2 - 0.3, su + sl / 2 + 0.3, sw0 - 0.3, sw1, 3.3, 3.55), col, 0.9));
  });

  // ---- the rest of the building front (pitlane.js fitFootprint): neutral garages with closed
  // doors and text boards (FIA, safety car, medical car...; which bay is which is a guess)
  const bw = lay.slope / 2, neutral = [], nboards = [];
  const bFrom = L.bldFrom ?? lay.from - PADDOCK.endRun, bTo = L.bldTo ?? lay.to + PADDOCK.endRun;
  const runs = [[bFrom, lay.from, -1], [lay.to, bTo, 1]];
  for (const [a, b, dir] of runs) {
    const n = Math.floor((b - a) / bw);
    for (let k = 0; k < n; k++) {
      // count outward from the team garages so the rhythm continues
      const e = dir < 0 ? lay.from - (k + 1) * bw : lay.to + k * bw, f2 = e + bw;
      solid.push(tint(laneBox(L, e + 0.3, f2 - 0.3, G + 0.1, G + 0.35, 0, H), C(0.62, 0.64, 0.68)));       // roller door
      for (let h = 0.5; h < H; h += 0.5) solid.push(tint(laneBox(L, e + 0.3, f2 - 0.3, G + 0.05, G + 0.1, h, h + 0.04), C(0.45, 0.47, 0.5)));
      solid.push(tint(laneBox(L, e, e + 0.3, G - 0.2, G + 0.4, 0, H), C(0.5, 0.52, 0.56)));
      solid.push(tint(laneBox(L, f2 - 0.3, f2, G - 0.2, G + 0.4, 0, H), C(0.5, 0.52, 0.56)));
      solid.push(tint(laneBox(L, e, f2, G - 0.15, G + 0.45, H, H + 1.3), dark));
      neutral.push(NEUTRAL[(dir < 0 ? k : k + 3) % NEUTRAL.length]);
      nboards.push([e, f2]);
    }
    // whatever is left over at the very end of the building: plain wall
    const used = n * bw;
    if (b - a - used > 0.5) {
      const [p, q] = dir < 0 ? [a, b - used] : [a + used, b];
      solid.push(tint(laneBox(L, p, q, G, G + 0.4, 0, H + 1.3), C(0.5, 0.52, 0.56)));
    }
  }
  const nTex = neutral.length && atlas(neutral, 512, 128, (x, label, w, h) => {
    x.fillStyle = '#20232a'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#e8eaee'; x.textAlign = 'center'; x.textBaseline = 'middle';
    fitText(x, label, w - 60, 64, 700);
    x.fillText(label, w / 2, h / 2 + 2);
  });
  const nSigns = nboards.map(([e, f2], k) => laneSign(L, e + 0.6, f2 - 0.6, G - 0.17, H + 0.15, H + 1.2, [k / nboards.length, 0, (k + 1) / nboards.length, 1]));

  const out = new THREE.Group();
  out.name = 'garages';
  if (beams.length) out.add(new THREE.Mesh(mergeGeometries(beams), new THREE.MeshBasicMaterial({ map: beamTex, color: new THREE.Color(1.15, 1.15, 1.15), side: THREE.DoubleSide })));
  out.add(new THREE.Mesh(mergeGeometries(lit), new THREE.MeshBasicMaterial({ vertexColors: true })));
  out.add(new THREE.Mesh(mergeGeometries(solid), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2, emissive: 0x0a0b0e })));
  out.add(new THREE.Mesh(mergeGeometries(signs), new THREE.MeshBasicMaterial({ map: boardTex, color: new THREE.Color(1.25, 1.25, 1.25), side: THREE.DoubleSide })));
  const decalMat = new THREE.MeshBasicMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
  out.add(new THREE.Mesh(mergeGeometries(decals.map(x => { x.deleteAttribute('uv'); return x; })), decalMat));
  out.add(new THREE.Mesh(mergeGeometries(nameDecals), new THREE.MeshBasicMaterial({ map: nameTex, transparent: true, depthWrite: false, color: new THREE.Color(0.85, 0.85, 0.85), polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 })));
  // warm light pooling on the lane in front of each open door
  const spill = (() => {
    const c = document.createElement('canvas'); c.width = 4; c.height = 64;
    const x = c.getContext('2d'), gr = x.createLinearGradient(0, 64, 0, 0);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 4, 64);
    return new THREE.CanvasTexture(c);
  })();
  out.add(new THREE.Mesh(mergeGeometries(glows), new THREE.MeshBasicMaterial({ map: spill, color: new THREE.Color(0.22, 0.21, 0.19), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -10 })));
  if (nSigns.length) out.add(new THREE.Mesh(mergeGeometries(nSigns), new THREE.MeshBasicMaterial({ map: nTex, color: new THREE.Color(1.1, 1.1, 1.1), side: THREE.DoubleSide })));
  g.add(out);
  return lay;
}

