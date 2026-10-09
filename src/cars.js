// Stylised 2025-spec F1 cars driven by the recorded telemetry.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { TYRES } from './data.js';

const TRAIL_N = 28;
const TRAIL_DT = 0.07;

function box(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

// Build the shared geometries once, grouped by material slot.
function carGeometries() {
  const body = [], carbon = [], accent = [];
  // monocoque + nose
  body.push(box(0.78, 0.46, 1.7, 0, 0.42, 0.55));
  const nose = new THREE.CylinderGeometry(0.1, 0.27, 1.5, 10);
  nose.rotateX(Math.PI / 2); nose.scale(1, 0.62, 1); nose.translate(0, 0.33, 2.0);
  body.push(nose);
  // engine cover / airbox from a side profile
  const prof = new THREE.Shape();
  [[0.15, 0.3], [0.15, 0.98], [-0.15, 1.04], [-0.75, 0.82], [-2.05, 0.52], [-2.05, 0.3]].forEach(([z, y], i) =>
    (i ? prof.lineTo(z, y) : prof.moveTo(z, y)));
  const cover = new THREE.ExtrudeGeometry(prof, { depth: 0.56, bevelEnabled: false });
  cover.translate(0, 0, -0.28); cover.rotateY(-Math.PI / 2);
  body.push(cover);
  // sidepods: tapered towards the rear
  const pod = new THREE.Shape();
  [[0.75, 0.2], [0.75, 0.6], [0.2, 0.62], [-1.3, 0.42], [-1.3, 0.2]].forEach(([z, y], i) => (i ? pod.lineTo(z, y) : pod.moveTo(z, y)));
  for (const sx of [-1, 1]) {
    const p = new THREE.ExtrudeGeometry(pod, { depth: 0.42, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 2 });
    p.translate(0, 0, -0.21); p.rotateY(-Math.PI / 2); p.translate(sx * 0.56, 0, -0.1);
    body.push(p);
  }
  // floor, plank, diffuser
  carbon.push(box(1.62, 0.05, 3.9, 0, 0.09, -0.25));
  carbon.push(box(1.0, 0.18, 0.5, 0, 0.18, -2.25));
  // front wing: mainplane + flaps + endplates
  carbon.push(box(1.95, 0.04, 0.42, 0, 0.1, 2.62));
  accent.push(box(1.7, 0.03, 0.22, 0, 0.19, 2.52));
  for (const sx of [-1, 1]) carbon.push(box(0.04, 0.26, 0.55, sx * 0.97, 0.18, 2.6));
  // rear wing endplates + beam wing
  for (const sx of [-1, 1]) carbon.push(box(0.05, 0.72, 0.62, sx * 0.52, 0.72, -2.42));
  carbon.push(box(1.0, 0.05, 0.25, 0, 0.5, -2.45));
  // halo
  const halo = new THREE.TorusGeometry(0.36, 0.035, 6, 18, Math.PI);
  halo.rotateX(-Math.PI / 2); halo.translate(0, 0.82, 0.5);
  carbon.push(halo);
  carbon.push(box(0.05, 0.3, 0.05, 0, 0.7, 0.86));
  // suspension arms
  for (const sx of [-1, 1]) {
    carbon.push(box(0.55, 0.03, 0.06, sx * 0.55, 0.36, 1.75));
    carbon.push(box(0.5, 0.03, 0.06, sx * 0.55, 0.4, -1.85));
  }
  // mirrors
  for (const sx of [-1, 1]) accent.push(box(0.16, 0.07, 0.05, sx * 0.48, 0.72, 0.85));
  const flat = list => mergeGeometries(list.map(g => (g.index ? g.toNonIndexed() : g)));
  return { body: flat(body), carbon: flat(carbon), accent: flat(accent) };
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class Cars {
  constructor(scene, race, track) {
    this.race = race; this.track = track;
    this.scale = 1;
    const G = carGeometries();
    const tyreGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.38, 20); tyreGeo.rotateZ(Math.PI / 2);
    const rearTyreGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.44, 20); rearTyreGeo.rotateZ(Math.PI / 2);
    const bandGeo = new THREE.TorusGeometry(0.27, 0.025, 4, 24); bandGeo.rotateY(Math.PI / 2);
    const rimGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.39, 10); rimGeo.rotateZ(Math.PI / 2);
    const tyreMat = new THREE.MeshStandardMaterial({ color: 0x131315, roughness: 0.85 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x55585f, metalness: 0.8, roughness: 0.3 });
    const carbonMat = new THREE.MeshStandardMaterial({ color: 0x0d0d10, roughness: 0.4, metalness: 0.5 });
    const glowTex = glowTexture();
    const helmetGeo = new THREE.SphereGeometry(0.16, 12, 8);
    const rearWingGeo = new THREE.BoxGeometry(1.0, 0.04, 0.3);
    const flapGeo = new THREE.BoxGeometry(1.0, 0.03, 0.2);

    // count teammates to pick T-cam colours (first car black, second yellow)
    const teamSeen = new Map();
    this.cars = race.drivers.map(d => {
      const col = new THREE.Color(d.color);
      const bodyMat = new THREE.MeshStandardMaterial({
        color: col, metalness: 0.45, roughness: 0.32, emissive: col, emissiveIntensity: 0.18,
      });
      const accentMat = new THREE.MeshStandardMaterial({ color: col.clone().lerp(new THREE.Color(1, 1, 1), 0.5), roughness: 0.4 });
      const root = new THREE.Group();
      const car = new THREE.Group();
      root.add(car);
      car.add(new THREE.Mesh(G.body, bodyMat), new THREE.Mesh(G.carbon, carbonMat), new THREE.Mesh(G.accent, accentMat));
      const helmet = new THREE.Mesh(helmetGeo, new THREE.MeshStandardMaterial({ color: col.clone().lerp(new THREE.Color(0xdddddd), 0.4), roughness: 0.4, metalness: 0.2 }));
      helmet.position.set(0, 0.8, 0.32);
      car.add(helmet);
      const nth = teamSeen.get(d.team) || 0; teamSeen.set(d.team, nth + 1);
      const tcam = new THREE.Mesh(box(0.2, 0.07, 0.12, 0, 1.07, -0.1),
        new THREE.MeshBasicMaterial({ color: nth ? 0xffe000 : 0x050505 }));
      car.add(tcam);
      const rw = new THREE.Mesh(rearWingGeo, bodyMat); rw.position.set(0, 1.0, -2.45);
      const flap = new THREE.Mesh(flapGeo, carbonMat);
      const flapPivot = new THREE.Group(); flapPivot.position.set(0, 1.04, -2.32);
      flap.position.set(0, 0.05, -0.1);
      flapPivot.add(flap);
      car.add(rw, flapPivot);
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.04), new THREE.MeshBasicMaterial({ color: 0x400000 }));
      tail.position.set(0, 0.42, -2.58);
      car.add(tail);
      const wheels = [];
      const bands = [];
      for (const [x, z, front] of [[-0.82, 1.78, 1], [0.82, 1.78, 1], [-0.82, -1.82, 0], [0.82, -1.82, 0]]) {
        const w = new THREE.Group();
        w.position.set(x, 0.36, z);
        w.add(new THREE.Mesh(front ? tyreGeo : rearTyreGeo, tyreMat));
        const rim = new THREE.Mesh(rimGeo, rimMat); w.add(rim);
        const bandMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        for (const s of [-1, 1]) {
          const b = new THREE.Mesh(bandGeo, bandMat); b.position.x = s * (front ? 0.195 : 0.225);
          w.add(b);
        }
        bands.push(bandMat);
        car.add(w);
        wheels.push(w);
      }
      // ground glow so cars read from the overview camera
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
        map: glowTex, color: col.clone().multiplyScalar(0.9), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      glow.rotation.x = -Math.PI / 2; glow.position.y = 0.06; glow.scale.set(3.6, 7, 1);
      car.add(glow);

      // trail ribbon
      const tpos = new Float32Array(TRAIL_N * 2 * 3);
      const talpha = new Float32Array(TRAIL_N * 2);
      const tidx = [];
      for (let j = 0; j < TRAIL_N; j++) {
        talpha[j * 2] = talpha[j * 2 + 1] = Math.pow(1 - j / (TRAIL_N - 1), 1.6);
        if (j) { const a = (j - 1) * 2; tidx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      const tg = new THREE.BufferGeometry();
      tg.setAttribute('position', new THREE.BufferAttribute(tpos, 3));
      tg.setAttribute('alpha', new THREE.BufferAttribute(talpha, 1));
      tg.setIndex(tidx);
      const trail = new THREE.Mesh(tg, new THREE.ShaderMaterial({
        uniforms: { color: { value: col.clone().multiplyScalar(1.5) }, opacity: { value: 0.7 } },
        vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
        fragmentShader: 'uniform vec3 color; uniform float opacity; varying float vA; void main(){ gl_FragColor = vec4(color * vA * opacity, 1.0); }',
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
      trail.frustumCulled = false;
      scene.add(trail);

      // label
      const el = document.createElement('div');
      el.className = 'car-label';
      el.innerHTML = `<span class="bar" style="background:${d.color}"></span><span class="code">${d.code}</span><span class="pos"></span>`;
      el.addEventListener('click', () => this.onSelect && this.onSelect(d.k));
      const label = new CSS2DObject(el);
      label.position.set(0, 3, 0);
      label.center.set(0.5, 1);
      root.add(label);

      scene.add(root);
      return {
        d, root, car, wheels, bands, flapPivot, tail, trail, label, el, elPos: el.querySelector('.pos'),
        heading: null, xy: [0, 0], world: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1), y: 0, ti: 0, spin: 0,
        lastComp: null,
      };
    });
    this.tmp = [0, 0];
    this.tmp2 = [0, 0];
  }

  elevation(x, z, c) {
    const { i, d } = this.track.nearest(x, z);
    c.offTrack = d > 16; // pit lane, garage or run-off
    return d < 40 ? this.track.P[i].y : 0.2;
  }

  update(t, dt, cameraPos, focusK, opts) {
    const race = this.race;
    const a = this.tmp, b = this.tmp2;
    for (const c of this.cars) {
      const k = c.d.k;
      race.pos(k, t, c.xy);
      const x = c.xy[0], z = -c.xy[1];
      race.pos(k, t - 0.2, a); race.pos(k, t + 0.2, b);
      const dx = b[0] - a[0], dz = -(b[1] - a[1]);
      const moved = Math.hypot(dx, dz);
      if (moved > 0.6) c.heading = Math.atan2(dx, dz);
      else if (c.heading === null || opts.jumped) {
        const { i } = this.track.nearest(x, z);
        const tt = this.track.T[i];
        c.heading = Math.atan2(tt.x, tt.z);
      }
      const y = this.elevation(x, z, c);
      c.root.position.set(x, y, z);
      c.car.rotation.y = c.heading;
      c.world.set(x, y, z);
      c.dir.set(Math.sin(c.heading), 0, Math.cos(c.heading));

      // adaptive scale: real size up close, exaggerated from the helicopter
      const dist = cameraPos.distanceTo(c.root.position);
      const s = opts.realScale ? 1 : THREE.MathUtils.clamp(dist / 140, 1, 9);
      c.car.scale.setScalar(s);
      c.label.position.y = 1.6 * s + 1.4;

      const tel = race.tel(k, t);
      c.tel = tel;
      c.spin += tel.speed / 3.6 / 0.36 * dt;
      for (const w of c.wheels) w.children.forEach(m => { if (m.geometry.type === 'CylinderGeometry') m.rotation.x = c.spin; });
      c.flapPivot.rotation.x = tel.drs ? 0.75 : 0;
      c.tail.material.color.setRGB(tel.brake ? 6 : 0.6, 0, 0);
      const tyre = race.tyre(k, t);
      if (tyre && tyre.comp !== c.lastComp) {
        c.lastComp = tyre.comp;
        c.bands.forEach(m => m.color.set((TYRES[tyre.comp] || TYRES.HARD).c));
      }

      // trail
      const P = c.trail.geometry.attributes.position.array;
      const w = 0.45 * s;
      let px = x, pz = z;
      for (let j = 0; j < TRAIL_N; j++) {
        const tj = t - j * TRAIL_DT * Math.max(1, s * 0.6);
        race.pos(k, tj, a);
        const qx = a[0], qz = -a[1];
        let nx = -(pz - qz), nz = px - qx;
        const L = Math.hypot(nx, nz);
        if (L > 1e-3) { nx /= L; nz /= L; } else { nx = c.dir.z; nz = -c.dir.x; }
        const yy = y + 0.25;
        P[j * 6] = qx + nx * w; P[j * 6 + 1] = yy; P[j * 6 + 2] = qz + nz * w;
        P[j * 6 + 3] = qx - nx * w; P[j * 6 + 4] = yy; P[j * 6 + 5] = qz - nz * w;
        px = qx; pz = qz;
      }
      c.trail.geometry.attributes.position.needsUpdate = true;
      c.trail.visible = opts.trails && tel.speed > 30 && !(opts.realScale && k === focusK);

      // in practice, cars parked in the garage would pile their labels on top of each other
      const parked = !race.isRace && c.offTrack && tel.speed < 5 && k !== focusK;
      c.label.visible = opts.labels && !(opts.onboard && k === focusK) && !parked;
      c.el.classList.toggle('focus', k === focusK);
    }
  }

  setPositions(order) {
    order.forEach((d, i) => { this.cars[d.k].elPos.textContent = i + 1; });
  }
}
