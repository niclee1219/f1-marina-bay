// Circuit geometry built from the telemetry-averaged centreline.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const HALF = 7.0;           // half track width (m)
const LIFT = 0.18;          // track surface above ground
export const TRACK_HALF = HALF;

function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

export class Track {
  constructor(race) {
    const tr = race.track;
    this.n = tr.n;
    this.bin = tr.bin;
    this.P = tr.center.map(([x, y], i) => new THREE.Vector3(x, LIFT + tr.elev[i], -y));
    this.T = []; this.N = []; this.S = [0];
    for (let i = 0; i < this.n; i++) {
      const a = this.P[(i - 1 + this.n) % this.n], b = this.P[(i + 1) % this.n];
      const t = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
      this.T.push(t);
      this.N.push(new THREE.Vector3(-t.z, 0, t.x)); // left-hand normal (driver's right is -N)
      if (i) this.S.push(this.S[i - 1] + this.P[i].distanceTo(this.P[i - 1]));
    }
    this.length = this.S[this.n - 1] + this.P[0].distanceTo(this.P[this.n - 1]);
    // signed curvature for kerb side selection
    this.curv = this.T.map((t, i) => {
      const nx = this.T[(i + 3) % this.n], pv = this.T[(i - 3 + this.n) % this.n];
      return pv.x * nx.z - pv.z * nx.x;
    });
    // spatial hash for nearest-centreline lookups
    this.cell = 25;
    this.grid = new Map();
    this.P.forEach((p, i) => {
      const key = `${Math.floor(p.x / this.cell)},${Math.floor(p.z / this.cell)}`;
      if (!this.grid.has(key)) this.grid.set(key, []);
      this.grid.get(key).push(i);
    });
  }

  nearest(x, z) {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    let best = -1, bd = Infinity;
    for (let r = 1; r <= 6 && best < 0; r += 2) {
      for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
        const L = this.grid.get(`${cx + i},${cz + j}`);
        if (!L) continue;
        for (const k of L) {
          const p = this.P[k], d = (p.x - x) ** 2 + (p.z - z) ** 2;
          if (d < bd) { bd = d; best = k; }
        }
      }
    }
    return { i: best < 0 ? 0 : best, d: Math.sqrt(bd) };
  }

  // ribbon between lateral offsets o0..o1 (metres, + = left), over index range
  ribbon(o0, o1, y = 0, from = 0, to = this.n, opts = {}) {
    const pos = [], uv = [], idx = [];
    const closed = from === 0 && to === this.n;
    const count = closed ? this.n + 1 : to - from + 1;
    for (let c = 0; c < count; c++) {
      const i = (from + c) % this.n;
      const p = this.P[i], nrm = this.N[i];
      const s = closed && c === this.n ? this.length : this.S[i] - (closed ? 0 : this.S[from % this.n]);
      for (const [o, u] of [[o0, 0], [o1, 1]]) {
        pos.push(p.x + nrm.x * o, p.y + y, p.z + nrm.z * o);
        uv.push(u, s / (opts.vScale || 1));
      }
      if (c) {
        const a = (c - 1) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); // counter-clockwise seen from above
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // vertical wall strip at lateral offset o
  wall(o, h, y0 = 0, from = 0, to = this.n) {
    const pos = [], uv = [], idx = [];
    const closed = from === 0 && to === this.n;
    const count = closed ? this.n + 1 : to - from + 1;
    for (let c = 0; c < count; c++) {
      const i = (from + c) % this.n;
      const p = this.P[i], nrm = this.N[i];
      const s = closed && c === this.n ? this.length : this.S[i];
      pos.push(p.x + nrm.x * o, y0 - 0.2, p.z + nrm.z * o, p.x + nrm.x * o, p.y + y0 + h, p.z + nrm.z * o);
      uv.push(s, 0, s, 1);
      if (c) {
        const a = (c - 1) * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  build(scene, race) {
    const g = new THREE.Group();
    scene.add(g);
    this.group = g;
    const tr = race.track;

    // ---------- asphalt with light pools under the floodlights
    const asphaltTex = canvasTex(256, 256, (c, w, h) => {
      c.fillStyle = '#26282e'; c.fillRect(0, 0, w, h);
      const img = c.getImageData(0, 0, w, h);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = (Math.random() - 0.5) * 22;
        img.data[i] += v; img.data[i + 1] += v; img.data[i + 2] += v + 1;
      }
      c.putImageData(img, 0, 0);
    });
    const asphalt = new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.75, metalness: 0.05 });
    asphalt.onBeforeCompile = (s) => {
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vTrackUv;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvTrackUv = uv;');
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vTrackUv;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float along = fract(vTrackUv.y / 32.0);
          float pool = exp(-pow((along - 0.5) * 3.2, 2.0));
          float side = 1.0 - smoothstep(0.0, 1.0, abs(vTrackUv.x - 0.5) * 2.0) * 0.45;
          totalEmissiveRadiance += vec3(0.075, 0.077, 0.085) * (0.55 + 1.0 * pool) * side;
          // rubbered-in racing line
          diffuseColor.rgb *= 1.0 - 0.18 * exp(-pow((vTrackUv.x - 0.5) * 5.0, 2.0));`);
    };
    // uv: x across (0..1), y along the lap in metres
    g.add(new THREE.Mesh(this.ribbon(-HALF, HALF, 0), asphalt));
    // run-off / shoulder
    const shoulderMat = new THREE.MeshStandardMaterial({ color: 0x1d1f25, roughness: 0.95, emissive: 0x08090b });
    g.add(new THREE.Mesh(this.ribbon(HALF, HALF + 3.2, -0.04), shoulderMat));
    g.add(new THREE.Mesh(this.ribbon(-HALF - 3.2, -HALF, -0.04), shoulderMat));

    // ---------- white edge lines
    const lineMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.85, 0.85, 0.85) });
    g.add(new THREE.Mesh(this.ribbon(HALF - 0.45, HALF - 0.15, 0.02), lineMat));
    g.add(new THREE.Mesh(this.ribbon(-HALF + 0.15, -HALF + 0.45, 0.02), lineMat));

    // ---------- kerbs at every corner: inside (apex) and exit side
    const kerbTex = canvasTex(64, 64, (c, w, h) => {
      c.fillStyle = '#f2f2f2'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#e10600'; c.fillRect(0, 0, w, h / 2);
    });
    kerbTex.colorSpace = THREE.SRGBColorSpace;
    const kerbMat = new THREE.MeshStandardMaterial({ map: kerbTex, roughness: 0.6, emissive: 0xffffff, emissiveMap: kerbTex, emissiveIntensity: 0.25 });
    const kerbs = [];
    for (const c of tr.corners) {
      const span = 9;
      const from = (c.i - span + this.n) % this.n, to = from + span * 2;
      const inside = Math.sign(this.curv[c.i]) || 1; // + = left-hand corner
      for (const side of [inside, -inside]) {
        const len = side === inside ? span * 2 : span;
        const f = side === inside ? from : c.i;
        const geo = side > 0 ? this.ribbon(HALF, HALF + 1.6, 0.05, f, f + len) : this.ribbon(-HALF - 1.6, -HALF, 0.05, f, f + len);
        const uv = geo.attributes.uv;
        for (let k = 0; k < uv.count; k++) uv.setY(k, uv.getY(k) / 2.2);
        kerbs.push(geo);
      }
    }
    g.add(new THREE.Mesh(mergeGeometries(kerbs), kerbMat));

    // ---------- DRS zones: glowing green strip along the left edge
    const drsMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.08, 0.8, 0.3), transparent: true, opacity: 0.55 });
    const drs = tr.drs.map(([a, b]) => this.ribbon(-0.18, 0.18, 0.03, a, b));
    this.drsMesh = new THREE.Mesh(mergeGeometries(drs), drsMat);
    g.add(this.drsMesh);

    // ---------- barriers: concrete wall with livery band + debris fence
    const band = canvasTex(1024, 64, (c, w, h) => {
      c.fillStyle = '#15151e'; c.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 256) {
        c.fillStyle = '#e10600'; c.fillRect(x, 0, 128, h);
        c.fillStyle = '#ffffff'; c.font = 'bold 34px "Titillium Web", sans-serif';
        c.fillText('SINGAPORE', x + 138, 44);
        c.fillStyle = '#ffffff'; c.fillText('GP', x + 30, 44);
      }
    });
    const wallMat = new THREE.MeshStandardMaterial({ map: band, emissive: 0xffffff, emissiveMap: band, emissiveIntensity: 0.3, roughness: 0.8 });
    // the two walls face each other; flip u on one so the lettering reads correctly from the track
    const wallGeo = [this.wall(HALF + 3.2, 1.1), this.wall(-HALF - 3.2, 1.1)];
    wallGeo.forEach((w, side) => {
      const uv = w.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setX(k, (side ? 1 : -1) * uv.getX(k) / 24);
    });
    const walls = new THREE.Mesh(mergeGeometries(wallGeo), wallMat);
    walls.material.side = THREE.DoubleSide;
    g.add(walls);
    const fenceTex = canvasTex(64, 64, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      c.strokeStyle = 'rgba(170,180,200,0.4)'; c.lineWidth = 1;
      for (let i = -w; i < w * 2; i += 8) {
        c.beginPath(); c.moveTo(i, 0); c.lineTo(i + h, h); c.stroke();
        c.beginPath(); c.moveTo(i, h); c.lineTo(i + h, 0); c.stroke();
      }
      c.fillStyle = 'rgba(220,220,230,0.9)'; c.fillRect(0, 0, 3, h);
    });
    const fenceGeo = [this.wall(HALF + 3.25, 3.0, 1.1), this.wall(-HALF - 3.25, 3.0, 1.1)];
    fenceGeo.forEach(w => { const uv = w.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) / 3); });
    const fence = new THREE.Mesh(mergeGeometries(fenceGeo), new THREE.MeshBasicMaterial({
      map: fenceTex, transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0.35,
    }));
    g.add(fence);

    this.buildLights(g);
    this.buildStart(g, race);
    this.buildPit(g, race);
    this.buildGrandstands(g, race);
    return g;
  }

  buildLights(g) {
    // Floodlight towers every ~32 m, alternating sides, arm reaching over the barrier.
    const spacing = Math.round(32 / this.bin);
    const items = [];
    for (let i = 0, k = 0; i < this.n; i += spacing, k++) items.push({ i, side: k % 2 ? 1 : -1 });
    const poleGeo = new THREE.CylinderGeometry(0.22, 0.32, 11, 6); poleGeo.translate(0, 5.5, 0);
    const armGeo = new THREE.BoxGeometry(0.2, 0.2, 5.5); armGeo.translate(0, 11, 2.75);
    const headGeo = new THREE.BoxGeometry(2.6, 0.35, 1.2); headGeo.translate(0, 10.8, 5.2);
    const pole = new THREE.InstancedMesh(mergeGeometries([poleGeo, armGeo]),
      new THREE.MeshStandardMaterial({ color: 0x3a3f4a, metalness: 0.6, roughness: 0.5 }), items.length);
    const head = new THREE.InstancedMesh(headGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 3.1, 2.9) }), items.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    items.forEach(({ i, side }, k) => {
      const p = this.P[i], nrm = this.N[i];
      v.set(p.x + nrm.x * side * (HALF + 4.5), 0, p.z + nrm.z * side * (HALF + 4.5));
      // arm (+z local) should point toward the track centre
      const ang = Math.atan2(-nrm.x * side, -nrm.z * side);
      q.setFromAxisAngle(up, ang);
      m.compose(v, q, s);
      pole.setMatrixAt(k, m);
      head.setMatrixAt(k, m);
    });
    g.add(pole, head);
  }

  buildStart(g, race) {
    // chequered start/finish line
    const chk = canvasTex(128, 16, (c, w, h) => {
      for (let x = 0; x < w; x += 8) for (let y = 0; y < h; y += 8) {
        c.fillStyle = ((x + y) / 8) % 2 ? '#111' : '#f4f4f4'; c.fillRect(x, y, 8, 8);
      }
    }, false);
    const p = this.P[0], t = this.T[0], nrm = this.N[0];
    const line = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, 1.4),
      new THREE.MeshStandardMaterial({ map: chk, emissive: 0xffffff, emissiveMap: chk, emissiveIntensity: 0.4 }));
    line.rotation.x = -Math.PI / 2;
    const holder = new THREE.Group();
    holder.add(line);
    holder.position.set(p.x, p.y + 0.04, p.z);
    holder.rotation.y = Math.atan2(t.x, t.z);
    g.add(holder);

    // gantry with five red start lights
    const gantry = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0x2b2f38, metalness: 0.7, roughness: 0.4 });
    const beam = new THREE.Mesh(new THREE.BoxGeometry(HALF * 2 + 8, 1.6, 1.2), steel);
    beam.position.y = 7.5;
    gantry.add(beam);
    for (const sgn of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.8, 8.3, 0.8), steel);
      leg.position.set(sgn * (HALF + 4), 4.15, 0);
      gantry.add(leg);
    }
    this.startLights = [];
    for (let k = 0; k < 5; k++) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.4, 0.5), new THREE.MeshStandardMaterial({ color: 0x0a0a0a }));
      box.position.set((k - 2) * 1.5, 5.9, 0.4);
      const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.36, 16), new THREE.MeshBasicMaterial({ color: 0x220000 }));
      lamp.position.set((k - 2) * 1.5, 5.6, 0.68);
      const lamp2 = lamp.clone(); lamp2.position.y = 6.3; lamp2.material = lamp.material;
      gantry.add(box, lamp, lamp2);
      this.startLights.push(lamp.material);
    }
    const sign = canvasTex(512, 64, (c, w, h) => {
      c.fillStyle = '#e10600'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#fff'; c.font = 'italic 900 40px "Titillium Web", sans-serif'; c.textAlign = 'center';
      c.fillText('SINGAPORE GRAND PRIX', w / 2, 46);
    }, false);
    const signM = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2 + 6, 1.4),
      new THREE.MeshBasicMaterial({ map: sign, color: new THREE.Color(1.4, 1.4, 1.4) }));
    signM.position.set(0, 7.5, -0.62); signM.rotation.y = Math.PI;
    const signF = signM.clone(); signF.position.z = 0.62; signF.rotation.y = 0;
    gantry.add(signM, signF);
    gantry.position.set(p.x + t.x * 3, p.y, p.z + t.z * 3);
    // face oncoming cars: local +z should point back down the straight
    gantry.rotation.y = Math.atan2(-t.x, -t.z);
    g.add(gantry);

    // grid boxes painted where the cars actually lined up
    const tmp = [0, 0];
    const tGrid = race.race_start - 3;
    const boxes = [];
    race.drivers.forEach(d => {
      race.pos(d.k, tGrid, tmp);
      const x = tmp[0], z = -tmp[1];
      const { i } = this.nearest(x, z);
      const tt = this.T[i];
      const b = new THREE.PlaneGeometry(2.6, 0.25);
      const b2 = new THREE.PlaneGeometry(0.25, 1.6); b2.translate(-1.2, -0.8, 0);
      const b3 = b2.clone(); b3.translate(2.4, 0, 0);
      const m = mergeGeometries([b, b2, b3]);
      m.translate(0, 2.6, 0); // box line just ahead of the car's front wing
      m.rotateX(-Math.PI / 2);
      m.rotateY(Math.atan2(-tt.x, -tt.z));
      m.translate(x, this.P[i].y + 0.03, z);
      boxes.push(m);
    });
    g.add(new THREE.Mesh(mergeGeometries(boxes), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.75, 0.75, 0.75) })));
  }

  buildPit(g, race) {
    const pit = race.track.pit;
    if (!pit.length) return;
    const pts = pit.map(([x, y]) => new THREE.Vector3(x, 0, -y));
    // which side of the pit lane faces away from the race track?
    const mid = pts[pts.length >> 1];
    const { i } = this.nearest(mid.x, mid.z);
    const away = new THREE.Vector3().subVectors(mid, this.P[i]).setY(0).normalize();
    const curve = new THREE.CatmullRomCurve3(pts);
    const N = 160;
    const pos = [], idx = [];
    const W = 5.5;
    const frames = [];
    for (let k = 0; k <= N; k++) {
      const p = curve.getPointAt(k / N), t = curve.getTangentAt(k / N);
      const nrm = new THREE.Vector3(-t.z, 0, t.x);
      const { i: ci } = this.nearest(p.x, p.z);
      const y = this.P[ci].y + 0.02;
      frames.push({ p, t, nrm, y });
      pos.push(p.x + nrm.x * W, y, p.z + nrm.z * W, p.x - nrm.x * W, y, p.z - nrm.z * W);
      if (k) { const a = (k - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x2a2c33, roughness: 0.8, emissive: 0x18191d, side: THREE.DoubleSide })));

    // pit building with lit garages in team colours, behind the pit lane
    const teams = [...new Map(race.drivers.map(d => [d.team, d.color])).entries()];
    const gar = new THREE.Group();
    const from = Math.floor(N * 0.25), to = Math.floor(N * 0.8);
    const steps = to - from;
    for (let k = 0; k < 10; k++) {
      const f = frames[from + Math.floor((k + 0.5) / 10 * steps)];
      const side = Math.sign(f.nrm.dot(away)) || 1;
      const off = f.nrm.clone().multiplyScalar(side * (W + 9));
      const garage = new THREE.Mesh(new THREE.BoxGeometry(22, 9, 16),
        new THREE.MeshStandardMaterial({ color: 0x1b1e26, metalness: 0.4, roughness: 0.6 }));
      garage.position.set(f.p.x + off.x, f.y + 4.5, f.p.z + off.z);
      garage.rotation.y = Math.atan2(f.t.x, f.t.z) + Math.PI / 2;
      const col = new THREE.Color(teams[k % teams.length][1]);
      const door = new THREE.Mesh(new THREE.PlaneGeometry(18, 5),
        new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(1.6) }));
      door.position.set(0, -1.5, -side * 8.05);
      door.rotation.y = side > 0 ? Math.PI : 0;
      garage.add(door);
      gar.add(garage);
    }
    g.add(gar);
  }

  buildGrandstands(g, race) {
    // A few stands at the classic viewing spots: pit straight, T1, T7, T10, T14 and T18.
    const at = [1, 7, 10, 14, 18].map(n => race.track.corners.find(c => c.n === n)?.i).filter(i => i != null);
    at.push(Math.floor(this.n * 0.97));
    const crowd = canvasTex(256, 64, (c, w, h) => {
      c.fillStyle = '#101219'; c.fillRect(0, 0, w, h);
      const pal = ['#e10600', '#ffffff', '#ffb000', '#3671c6', '#27f4d2', '#ff8000', '#e8002d'];
      for (let i = 0; i < 700; i++) {
        c.fillStyle = pal[(Math.random() * pal.length) | 0];
        c.globalAlpha = 0.3 + Math.random() * 0.7;
        c.fillRect(Math.random() * w, Math.random() * h, 1.6, 1.6);
      }
    });
    const standMat = new THREE.MeshStandardMaterial({ map: crowd, emissive: 0xffffff, emissiveMap: crowd, emissiveIntensity: 0.7, roughness: 0.9 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x2c313c, metalness: 0.5, roughness: 0.4 });
    for (const i0 of at) {
      const outside = -(Math.sign(this.curv[i0]) || 1);
      const p = this.P[i0], nrm = this.N[i0];
      const st = new THREE.Group();
      const len = 70, depth = 16, height = 11;
      const shape = new THREE.Shape();
      shape.moveTo(0, 0); shape.lineTo(depth, 0); shape.lineTo(depth, height); shape.lineTo(0, 1.5); shape.lineTo(0, 0);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false });
      geo.translate(0, 0, -len / 2);
      const uv = geo.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) / 16, uv.getY(k) / 16);
      const m = new THREE.Mesh(geo, standMat);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(depth + 2, 0.5, len), roofMat);
      roof.position.set(depth / 2, height + 4, 0);
      st.add(m, roof);
      st.position.set(p.x + nrm.x * outside * (HALF + 6), 0, p.z + nrm.z * outside * (HALF + 6));
      // local +x points away from the track
      st.rotation.y = Math.atan2(-nrm.z * outside, nrm.x * outside);
      g.add(st);
    }
  }

  setStartLights(n) {
    this.startLights.forEach((m, k) => m.color.setRGB(k < n ? 6 : 0.15, 0, 0));
  }
}
