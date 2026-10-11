// Pit lane fitted from telemetry (scripts/fit_pit_lane.py -> race.track.pitlane): the averaged path
// of every pit stop in the built sessions, where it peels off and rejoins the circuit, the 80 km/h
// limiter stretch and each team's box (where its cars stood still). Geometry is laid out across the
// lane in w, metres from the fitted centre toward the garages:
//   inner edge (track side) .. fast lane .. W.fast .. working lane .. W.garage (garage doors)
// OpenF1 locations don't resolve the fast / working lane split (stopped cars sit within half a
// metre of moving ones), so the cars' path is taken as the fast lane and the working lane is laid
// out beside it on the garage side.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PIT_LANE } from './config.js';

const W = PIT_LANE;

export class PitLane {
  constructor(track, data) {
    this.data = data;
    this.side = data.side;
    const c = data.center;
    this.n = c.length;
    this.P = []; this.T = []; this.G = []; this.u = [0]; this.d = []; this.ti = []; this.y = [];
    for (let k = 0; k < this.n; k++) {
      const a = c[Math.max(0, k - 1)], b = c[Math.min(this.n - 1, k + 1)];
      const tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1;
      // scene: (x, -y); right of travel = (ty, 0, tx) as in Track.N; garages on `side` of that
      const t = new THREE.Vector3(tx / l, 0, -ty / l);
      const right = new THREE.Vector3(ty / l, 0, tx / l);
      const p = new THREE.Vector3(c[k][0], 0, -c[k][1]);
      const { i } = track.nearest(p.x, p.z);
      p.y = track.P[i].y;
      this.P.push(p); this.T.push(t); this.G.push(right.multiplyScalar(this.side));
      this.ti.push(i);
      this.d.push(new THREE.Vector3().subVectors(p, track.P[i]).dot(track.N[i]));
      if (k) this.u.push(this.u[k - 1] + Math.hypot(c[k][0] - c[k - 1][0], c[k][1] - c[k - 1][1]));
    }
    this.length = this.u[this.n - 1];
    // where the lane is clear of the track wall: before this the entry road crosses the wall line,
    // after exitGap the exit road crosses it again
    const clear = k => Math.abs(this.d[k]) >= W.wall + W.clear;
    let a = 0; while (a < this.n - 1 && !clear(a)) a++;
    let b = this.n - 1; while (b > 0 && !clear(b)) b--;
    this.entryGap = this.u[a]; this.exitGap = this.u[b];
    // working-lane / garage stretch: from just before the first box to just after the last
    const bu = (data.boxes || []).map(x => x.u);
    this.boxFrom = bu.length ? Math.min(...bu) - W.boxRun : data.limitFrom + 150;
    this.boxTo = bu.length ? Math.max(...bu) + W.boxRun : data.limitTo - 30;
  }

  // index + fraction at lane distance u
  locate(u) {
    u = Math.max(0, Math.min(this.length, u));
    let k = Math.min(this.n - 2, Math.floor(u / this.length * (this.n - 1)));
    while (k > 0 && this.u[k] > u) k--;
    while (k < this.n - 2 && this.u[k + 1] <= u) k++;
    return [k, (u - this.u[k]) / ((this.u[k + 1] - this.u[k]) || 1)];
  }

  // world point at lane distance u, w metres toward the garages, h above the lane surface
  point(u, w = 0, h = 0, out = new THREE.Vector3()) {
    const [k, f] = this.locate(u);
    const p0 = this.P[k], p1 = this.P[k + 1], g0 = this.G[k], g1 = this.G[k + 1];
    return out.set(
      p0.x + (p1.x - p0.x) * f + (g0.x + (g1.x - g0.x) * f) * w,
      p0.y + (p1.y - p0.y) * f + h,
      p0.z + (p1.z - p0.z) * f + (g0.z + (g1.z - g0.z) * f) * w);
  }

  frame(u) {
    const [k] = this.locate(u);
    return { t: this.T[k], g: this.G[k] };
  }

  // signed track offset of the lane centre at lane distance u
  dAt(u) {
    const [k, f] = this.locate(u);
    return this.d[k] + (this.d[k + 1] - this.d[k]) * f;
  }

  // track-side edge of the lane surface (w): never inside the pit wall once the lane is clear
  inner(u) {
    if (u < this.entryGap || u > this.exitGap) return -W.fast;
    return Math.max(-W.fast, W.wall + W.wallGap - Math.abs(this.dAt(u)));
  }

  // garage-side edge: the full working lane along the garages, the fast lane alone on the roads
  outer(u) {
    const ramp = THREE.MathUtils.smoothstep(u, this.boxFrom - W.ramp, this.boxFrom) * (1 - THREE.MathUtils.smoothstep(u, this.boxTo, this.boxTo + W.ramp));
    return W.fast + (W.garage - W.fast) * ramp;
  }

  // strip between w0(u) and w1(u) over u0..u1, as a flat ribbon lifted `lift` above the lane
  strip(u0, u1, w0, w1, lift = 0.01, step = 2) {
    const pos = [], uv = [], idx = [];
    const f0 = typeof w0 === 'function' ? w0 : () => w0, f1 = typeof w1 === 'function' ? w1 : () => w1;
    const N = Math.max(1, Math.ceil((u1 - u0) / step));
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (let j = 0; j <= N; j++) {
      const u = u0 + (u1 - u0) * j / N;
      this.point(u, f0(u), lift, a); this.point(u, f1(u), lift, b);
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      uv.push(0, u, 1, u);
      if (j) { const q = (j - 1) * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    // face up: with the garages on the left, w runs right to left, the reverse of Track.ribbon
    if (this.side < 0) for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    g.setIndex(idx);
    return g;
  }
}

function decal(mat) {
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -2;
  mat.polygonOffsetUnits = -4;
  return mat;
}

function textTex(lines, w, h, bg, fg) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, w, h);
  x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
  lines.forEach(([text, size, y]) => { x.font = `900 ${size}px "Titillium Web", sans-serif`; x.fillText(text, w / 2, y); });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Lane surface and markings, the entry / exit lines on the circuit, speed-limit lines and boards,
// bollards on the entry and exit noses, and the pit exit light. Returns { setExit(open) }.
export function buildPitLane(track, g) {
  const L = track.lane;
  const out = { setExit() {} };
  if (!L) return out;
  const D = L.data;

  // lane asphalt: smoother and darker than the circuit, sits just under the track surface so the
  // track wins where the entry and exit roads overlap it
  const surf = L.strip(0, L.length, u => L.inner(u), u => L.outer(u), -0.012);
  g.add(new THREE.Mesh(surf, decal(new THREE.MeshStandardMaterial({ color: 0x3a3c43, roughness: 0.78, emissive: new THREE.Color(0.1, 0.103, 0.112) }))));

  const white = [], yellow = [];
  const line = (u0, u1, w, half = 0.12, list = white) => {
    const f = typeof w === 'function' ? w : () => w;
    list.push(L.strip(u0, u1, u => f(u) - half, u => f(u) + half, 0.02, 1));
  };
  // lane edges and the fast / working lane line (the working lane only along the garages)
  line(0, L.length, u => L.inner(u) + 0.25);
  line(0, L.length, u => L.outer(u) - 0.25);
  line(L.boxFrom, L.boxTo, W.fast, 0.1);
  // pit entry line: from the track edge before the peel-off, along the lane's track-side edge to
  // the wall nose; pit exit line: from the exit nose back onto the track edge after the merge
  const edgeLine = (s0, s1, uLane, toLane) => {
    const pos = [], idx = [], N = 24, a = new THREE.Vector3(), b = new THREE.Vector3();
    const end = L.point(uLane, L.inner(uLane) + 0.25, 0.02);
    for (let j = 0; j <= N; j++) {
      const f = j / N, s = s0 + (s1 - s0) * f;
      const fr = track.frameAt(s);
      const sideSign = Math.sign(L.d[0]) || -1;
      const onEdge = fr.p.clone().addScaledVector(fr.n, sideSign * (track.half - 0.35));
      const k = toLane ? f * f : 1 - (1 - f) * (1 - f);
      const p = toLane ? onEdge.lerp(end, k * k) : end.clone().lerp(onEdge, k);
      const tdir = new THREE.Vector3(-fr.t.z, 0, fr.t.x).multiplyScalar(0.12);
      a.copy(p).add(tdir); b.copy(p).sub(tdir);
      pos.push(a.x, fr.p.y + 0.025, a.z, b.x, fr.p.y + 0.025, b.z);
      if (j) { const q = (j - 1) * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2, q, q + 2, q + 1, q + 1, q + 2, q + 3); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    white.push(geo);
  };
  edgeLine(D.entryS - W.entryLine, D.entryS, 0, true);
  line(0, L.entryGap, u => L.inner(u) + 0.25, 0.14);
  edgeLine(D.exitS, D.exitS + W.exitLine, L.length, false);
  line(L.exitGap, L.length, u => L.inner(u) + 0.25, 0.14);
  // speed-limit lines across the lane, with the limit painted before / after them
  for (const u of [D.limitFrom, D.limitTo]) white.push(L.strip(u - 0.3, u + 0.3, L.inner(u), L.outer(u), 0.02, 0.6));
  const merge = list => mergeGeometries(list.map(x => { if (x.attributes.uv) x.deleteAttribute('uv'); return x; }));
  g.add(new THREE.Mesh(merge(white), decal(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.85, 0.85, 0.85) }))));
  if (yellow.length) g.add(new THREE.Mesh(merge(yellow), decal(new THREE.MeshBasicMaterial({ color: 0xd8b21d }))));
  const kph = String(D.limitKph || 80);
  const limTex = textTex([['PIT', 70, 52], [kph, 150, 160]], 256, 230, 'rgba(0,0,0,0)', '#e8e8e8');
  const numbers = [];
  for (const [u, dir] of [[D.limitFrom + 3.5, 1], [D.limitTo - 3.5, -1]]) {
    // reads upright for a car arriving at the line (before it at the start, after it at the end)
    const q = L.strip(u - 2.2, u + 2.2, -1.5, 1.5, 0.025, 4.4);
    const uv = q.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      const uu = uv.getY(i) > u ? 1 : 0, ww = uv.getX(i);
      // x across the lane (toward the inner edge reads left for a car heading +u)
      uv.setXY(i, L.side > 0 ? 1 - ww : ww, dir > 0 ? uu : 1 - uu);
      if (dir < 0) uv.setX(i, 1 - uv.getX(i));
    }
    numbers.push(q);
  }
  g.add(new THREE.Mesh(mergeGeometries(numbers), decal(new THREE.MeshBasicMaterial({ map: limTex, transparent: true, depthWrite: false }))));

  // 80 signs on posts at both lines, on the pit-wall side
  const signTex = textTex([[kph, 120, 132]], 256, 256, 'rgba(0,0,0,0)', '#111');
  const disc = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.beginPath(); x.arc(128, 128, 124, 0, Math.PI * 2); x.fill();
    x.strokeStyle = '#d4131b'; x.lineWidth = 26; x.beginPath(); x.arc(128, 128, 108, 0, Math.PI * 2); x.stroke();
    x.drawImage(signTex.image, 0, 0);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const steel = new THREE.MeshStandardMaterial({ color: 0x5b616c, metalness: 0.6, roughness: 0.5 });
  const discMat = new THREE.MeshStandardMaterial({ map: disc, emissive: 0xffffff, emissiveMap: disc, emissiveIntensity: 0.45, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide });
  const posts = [], discs = [];
  for (const [u, face] of [[D.limitFrom, -1], [D.limitTo, 1]]) {
    const w = L.inner(u) - 0.6;
    const p = L.point(u, w), { t } = L.frame(u);
    posts.push(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 6).translate(p.x, p.y + 1.2, p.z));
    const dg = new THREE.CircleGeometry(0.45, 24);
    dg.rotateY(Math.atan2(t.x * face, t.z * face));
    discs.push(dg.translate(p.x, p.y + 2.3, p.z));
  }
  g.add(new THREE.Mesh(mergeGeometries(posts), steel));
  g.add(new THREE.Mesh(mergeGeometries(discs), discMat));

  // bollards: a short row on each nose, where the pit wall begins between track and lane
  const bol = [];
  for (const [u0, dir] of [[L.entryGap, -1], [L.exitGap, 1]]) {
    for (let k = 0; k < W.bollards; k++) {
      const u = u0 + dir * k * 2.2;
      bol.push(L.point(u, L.inner(u) - 0.3));
    }
  }
  const bGeo = new THREE.CylinderGeometry(0.11, 0.13, 0.9, 10).translate(0, 0.45, 0);
  const bands = new THREE.CylinderGeometry(0.115, 0.115, 0.14, 10).translate(0, 0.72, 0);
  const bm = new THREE.InstancedMesh(bGeo, new THREE.MeshStandardMaterial({ color: 0xf2c014, emissive: 0x3a2c00, roughness: 0.5 }), bol.length);
  const bb = new THREE.InstancedMesh(bands, new THREE.MeshBasicMaterial({ color: new THREE.Color(1.1, 1.1, 1.1) }), bol.length);
  const m = new THREE.Matrix4();
  bol.forEach((p, k) => { m.makeTranslation(p.x, p.y - 0.18, p.z); bm.setMatrixAt(k, m); bb.setMatrixAt(k, m); });
  bm.name = 'pit-bollards';
  g.add(bm, bb);

  // pit exit light: red / green lamps on a post at the end of the lane, facing the cars, on the
  // pit-wall side just after the speed-limit line
  const ue = Math.min(L.length - 2, D.limitTo + 6);
  const ep = L.point(ue, L.inner(ue) - 0.8), { t: et } = L.frame(ue);
  const sig = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.6 });
  sig.add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 3.6, 8).translate(0, 1.8, 0), dark));
  sig.add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.6, 0.4).translate(0, 4.1, 0), dark));
  const red = new THREE.MeshBasicMaterial({ color: 0x220000 }), green = new THREE.MeshBasicMaterial({ color: 0x002200 });
  const lampR = new THREE.Mesh(new THREE.CircleGeometry(0.22, 16), red); lampR.position.set(0, 4.5, 0.21);
  const lampG = new THREE.Mesh(new THREE.CircleGeometry(0.22, 16), green); lampG.position.set(0, 3.75, 0.21);
  sig.add(lampR, lampG);
  sig.position.set(ep.x, ep.y - 0.18, ep.z);
  sig.rotation.y = Math.atan2(-et.x, -et.z);   // local +z toward the oncoming cars
  sig.name = 'pit-exit-light';
  g.add(sig);
  out.setExit = (open) => {
    red.color.setRGB(open ? 0.15 : 6, 0, 0);
    green.color.setRGB(0, open ? 5 : 0.15, 0);
  };
  out.setExit(true);
  return out;
}
