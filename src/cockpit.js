// Onboard cockpit: what the driver sees, bolted to the camera (camera space: -z ahead, +y up,
// metres from the driver's eyes). Composition follows the in-game onboard: a thin halo (one centre
// pillar splitting into a hoop over the top of the frame), livery-coloured cockpit walls and cowl
// rising either side of a big, near-flat butterfly wheel with gloved hands, small stalk mirrors on
// the walls, and the front tyres out wide on their wishbones. The nose stays hidden behind the cowl.
// The focused car's own model is hidden in this view (cars.js), so nothing clips the lens.
import * as THREE from 'three';
import { STEERING, CAMERA } from './config.js';
import { TYRES } from './data.js';

const EYE = 0.74;                      // driver's eye height above the road (m)
const AXLE = 1.5;                      // front axle ahead of the eyes (m)
const TRACK = 0.9;                    // front tyre centre either side of the car centreline (m)
const R = 0.34, TW = 0.36;             // front tyre radius / width (m)
const GEAR_TOP = [0, 100, 140, 175, 210, 245, 280, 310, 345];
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// small canvas -> texture helper
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// a night "environment" the cockpit materials reflect: city glow at the horizon, a few bright
// floodlight heads, dark ground. Only the cockpit uses it (scene.environment stays untouched).
function nightEnv() {
  const t = canvasTex(512, 256, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#0e1730'); g.addColorStop(0.45, '#4a5d82'); g.addColorStop(0.52, '#8a97b0');
    g.addColorStop(0.58, '#262a33'); g.addColorStop(1, '#14161b');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 16; i++) {
      const x = (i / 16) * w + (i % 3) * 9, y = h * (0.22 + 0.08 * ((i * 7) % 4) / 3);
      const r = c.createRadialGradient(x, y, 0, x, y, 26);
      r.addColorStop(0, 'rgba(255,244,222,1)'); r.addColorStop(1, 'rgba(255,244,222,0)');
      c.fillStyle = r; c.fillRect(x - 26, y - 26, 52, 52);
    }
  });
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}

export class Cockpit {
  constructor(camera, envTexture = null) {
    this.root = new THREE.Group();
    this.root.visible = false;
    this.root.renderOrder = 10;
    camera.add(this.root);
    this.steer = 0;
    this.spin = 0;
    this.lastLcd = 0;

    // Nothing is pure black: dark greys with roughness variation, a faint blue emissive so edges
    // read against the night sky, and the shared night env map for floodlight highlights.
    const env = envTexture || nightEnv();   // the live surroundings map (src/reflect.js) when given
    const std = (o) => new THREE.MeshStandardMaterial({ envMap: env, ...o });
    const carbon = std({ color: 0x3a3d45, roughness: 0.5, metalness: 0.45, emissive: 0x0b1018, envMapIntensity: 1.1 });
    const satin = std({ color: 0x3b3e46, roughness: 0.6, metalness: 0.3, emissive: 0x080b10, envMapIntensity: 0.9 });
    const rubber = std({ color: 0x35373c, roughness: 0.85, metalness: 0.0, emissive: 0x06080b, envMapIntensity: 0.5 });
    const glove = std({ color: 0x3a3d45, roughness: 0.75, metalness: 0.05, emissive: 0x07090c, envMapIntensity: 0.6 });
    this.paint = new THREE.MeshPhysicalMaterial({ envMap: env, color: 0xcc0000, roughness: 0.25, metalness: 0.45, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 2.2, side: THREE.DoubleSide });
    const add = (geo, mat, parent = this.root) => { const m = new THREE.Mesh(geo, mat); parent.add(m); return m; };
    const tube = (pts, r, mat, seg = 40) => add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg, r, 8), mat);
    const y0 = -EYE;   // road level in camera space

    // ------------------------------------------------------------- halo: thin pillar -> hoop over the frame top
    tube([V(0, -0.3, -0.98), V(0, -0.1, -0.9), V(0, 0.05, -0.82)], 0.014, carbon, 10);
    for (const s of [-1, 1]) {
      tube([V(0, 0.05, -0.82), V(s * 0.12, 0.13, -0.72), V(s * 0.3, 0.19, -0.5), V(s * 0.46, 0.21, -0.2), V(s * 0.55, 0.17, 0.2)], 0.009, carbon, 36);
    }
    const mount = add(new THREE.SphereGeometry(0.03, 12, 8), carbon);   // pillar foot
    mount.scale.set(1.1, 0.6, 1.8); mount.position.set(0, -0.29, -0.98);

    // ------------------------------------------------------------- cockpit walls (livery), rim and cowl
    const rimTop = new THREE.CatmullRomCurve3([V(0.62, -0.08, 0.2), V(0.54, -0.13, -0.25), V(0.43, -0.18, -0.62), V(0.31, -0.23, -0.98), V(0.2, -0.27, -1.25)]);
    for (const s of [-1, 1]) {
      const top = rimTop.getPoints(24), pos = [], idx = [];
      top.forEach((p, i) => {
        pos.push(s * p.x, p.y, p.z, s * p.x * 0.8, -0.5, p.z);
        if (i < top.length - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      add(g, this.paint);
      tube(top.map(p => V(s * p.x, p.y + 0.004, p.z)), 0.011, carbon, 30);   // carbon rim trim
    }
    const tub = add(new THREE.PlaneGeometry(0.7, 1.6), carbon);     // dark tub floor between the walls
    tub.rotation.x = -Math.PI / 2; tub.position.set(0, -0.5, -0.6);
    // cowl between the walls, in front of the wheel; the nose drops away behind its front edge
    const cowl = add(new THREE.BoxGeometry(0.5, 0.05, 0.62), this.paint);
    cowl.position.set(0, -0.28, -1.0); cowl.rotation.x = -0.1;
    const cowlLip = add(new THREE.BoxGeometry(0.46, 0.03, 0.04), carbon);
    cowlLip.position.set(0, -0.25, -0.7);
    const nose = new THREE.Shape();
    nose.moveTo(-0.22, 0); nose.lineTo(0.22, 0); nose.lineTo(0.07, -2.2); nose.lineTo(-0.07, -2.2); nose.closePath();
    const noseGeo = new THREE.ExtrudeGeometry(nose, { depth: 0.14, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 3 });
    noseGeo.rotateX(Math.PI / 2);
    const noseM = add(noseGeo, this.paint);
    noseM.position.set(0, -0.46, -1.25); noseM.rotation.x = -0.16;     // dips away below the cowl line
    // front wing: main plane, flap and endplates (mostly hidden, glimpsed past the cowl)
    const wing = new THREE.Group(); wing.position.set(0, y0 + 0.02, -3.1); this.root.add(wing);
    add(new THREE.BoxGeometry(1.75, 0.025, 0.4), carbon, wing);
    const flap = add(new THREE.BoxGeometry(1.7, 0.02, 0.2), this.paint, wing); flap.position.set(0, 0.07, -0.05); flap.rotation.x = 0.2;
    for (const s of [-1, 1]) { const ep = add(new THREE.BoxGeometry(0.02, 0.2, 0.46), this.paint, wing); ep.position.set(s * 0.88, 0.07, 0); }

    // ------------------------------------------------------------- mirrors: tapered housings on thin stalks
    // Each face shows a real (tiny) render of the scene from behind the car, flipped like a mirror
    // image; renderMirrors() refreshes them, alternating sides so it costs about one extra pass a frame.
    const lozenge = (w, h, n = 2.6) => {                  // rounded, tapering toward the outboard edge
      const pts = [];
      for (let i = 0; i < 48; i++) {
        const a = i / 48 * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
        const x = Math.sign(c) * Math.abs(c) ** (2 / n), y = Math.sign(sn) * Math.abs(sn) ** (2 / n);
        pts.push(new THREE.Vector2(x * w / 2, y * (h / 2) * (1 - 0.28 * (x + 1) / 2)));
      }
      return new THREE.Shape(pts);
    };
    const faceShape = lozenge(0.12, 0.066);
    this.mirrors = [];
    for (const s of [-1, 1]) {
      const g = new THREE.Group(); g.position.set(s * 0.44, -0.075, -0.7); g.rotation.y = -s * 0.45; this.root.add(g);
      add(new THREE.CylinderGeometry(0.006, 0.006, 0.1, 6), carbon, g).position.set(-s * 0.01, -0.05, 0);
      const housing = add(new THREE.ExtrudeGeometry(lozenge(0.134, 0.078), { depth: 0.03, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.008, bevelSegments: 3 }), this.paint, g);
      housing.position.z = -0.032;
      const fg = new THREE.ShapeGeometry(faceShape);
      const uv = fg.attributes.uv;
      for (let k = 0; k < uv.count; k++) {                 // map the shape to 0..1, flipped: a mirror image
        uv.setXY(k, 1 - (fg.attributes.position.getX(k) + 0.06) / 0.12, (fg.attributes.position.getY(k) + 0.033) / 0.066);
      }
      const rt = new THREE.WebGLRenderTarget(256, 128, { depthBuffer: true });
      const face = add(fg, new THREE.MeshBasicMaterial({ map: rt.texture, color: 0xdddddd }), g);
      face.position.z = 0.0105;
      this.mirrors.push({ g, s, rt, cam: new THREE.PerspectiveCamera(38, 2, 0.5, 1500) });
    }
    this.mirrorTick = 0;

    // ------------------------------------------------------------- front tyres + suspension
    this.tyres = [];
    this.bandMat = new THREE.MeshBasicMaterial({ color: 0xf0f0ec, side: THREE.DoubleSide });
    const hh = TW / 2;
    const prof = [[0.6, -hh], [0.9, -hh], [0.97, -hh * 0.93], [1, -hh * 0.72], [1, hh * 0.72], [0.97, hh * 0.93], [0.9, hh], [0.6, hh]]
      .map(([k, y]) => new THREE.Vector2(k * R, y));
    const tyreGeo = new THREE.LatheGeometry(prof, 40);
    tyreGeo.rotateZ(Math.PI / 2);
    const treadMat = std({
      color: 0x5a5d64, roughness: 0.8, envMapIntensity: 0.6, emissive: 0x0c0e12,
      map: canvasTex(8, 64, (c, w, h) => { c.fillStyle = '#9a9ca2'; c.fillRect(0, 0, w, h); c.fillStyle = '#4a4c52'; for (const y of [18, 32, 46]) c.fillRect(0, y, w, 3); }),
    });
    const sideTex = canvasTex(256, 256, (c, w, h) => {      // lighter sidewall, compound stripe, hub with lugs
      const m = w / 2;
      c.fillStyle = '#3a3c42'; c.beginPath(); c.arc(m, m, m, 0, 7); c.fill();
      c.strokeStyle = '#555861'; c.lineWidth = 3; c.beginPath(); c.arc(m, m, m * 0.97, 0, 7); c.stroke();
      c.fillStyle = '#6a6e78'; c.beginPath(); c.arc(m, m, m * 0.6, 0, 7); c.fill();       // wheel face
      c.fillStyle = '#4a4d56';
      for (let i = 0; i < 5; i++) { const a = i * 1.2566; c.beginPath(); c.arc(m + Math.cos(a) * m * 0.42, m + Math.sin(a) * m * 0.42, m * 0.11, 0, 7); c.fill(); }
      c.fillStyle = '#c9ccd3'; c.beginPath(); c.arc(m, m, m * 0.12, 0, 7); c.fill();
      c.fillStyle = '#e8e8ea'; c.fillRect(m - 4, m * 0.62, 8, m * 0.16);                   // marker so spin reads
    });
    const sideMat = std({ map: sideTex, roughness: 0.55, metalness: 0.25, emissive: 0x0a0c10, envMapIntensity: 0.7 });
    for (const s of [-1, 1]) {
      const knuckle = new THREE.Group();
      knuckle.position.set(s * TRACK, y0 + R, -AXLE);
      this.root.add(knuckle);
      const wheel = new THREE.Group();
      knuckle.add(wheel);
      add(tyreGeo, treadMat, wheel);
      const face = add(new THREE.CircleGeometry(R * 0.97, 40), sideMat, wheel);
      face.rotation.y = s * Math.PI / 2; face.position.x = s * (hh + 0.002);
      const inner = add(new THREE.CircleGeometry(R * 0.97, 40), sideMat, wheel);   // inboard sidewall, the side the driver sees
      inner.rotation.y = -s * Math.PI / 2; inner.position.x = -s * (hh + 0.002);
      // compound band on both sidewalls, coloured from the stint's actual tyre (setCompound)
      for (const side of [-1, 1]) {
        const band = add(new THREE.RingGeometry(R * 0.78, R * 0.86, 48), this.bandMat, wheel);
        band.rotation.y = side * Math.PI / 2; band.position.x = side * (hh + 0.004);
      }
      this.tyres.push({ knuckle, wheel });
      // upper and lower wishbones from the chassis to the upright
      for (const [dy, dz] of [[0.12, 0.2], [-0.1, -0.1]]) {
        const a = V(s * 0.2, y0 + R + dy, -AXLE + 0.4 + dz);
        const b = V(s * (TRACK - TW / 2), y0 + R + dy * 0.8, -AXLE);
        const arm = add(new THREE.CylinderGeometry(0.014, 0.014, a.distanceTo(b), 6), carbon);
        arm.position.copy(a).add(b).multiplyScalar(0.5);
        arm.quaternion.setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize());
      }
    }

    // ------------------------------------------------------------- butterfly steering wheel
    // Near-flat to the eye (face normal tipped up toward the driver), about twice the old size on screen.
    this.wheel = new THREE.Group();
    this.wheel.position.set(0, -0.225, -0.37);
    this.wheel.scale.setScalar(1.12);
    this.wheel.rotation.x = -0.4;
    this.root.add(this.wheel);
    const rr = (w, h, r) => {                              // rounded rectangle shape
      const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
      s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r);
      s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
      s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y); return s;
    };
    const bodyGeo = new THREE.ExtrudeGeometry(rr(0.31, 0.17, 0.025), { depth: 0.025, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 2 });
    add(bodyGeo, carbon, this.wheel).position.z = -0.03;
    // face plate: buttons, rotary dials and tiny labels around the display
    const face = canvasTex(512, 280, (c, w, h) => {
      c.fillStyle = '#25272d'; c.fillRect(0, 0, w, h);
      c.textAlign = 'center'; c.textBaseline = 'middle';
      const btn = (x, y, col, label, r = 15) => {
        c.fillStyle = '#15171b'; c.beginPath(); c.arc(x, y, r + 4, 0, 7); c.fill();
        c.fillStyle = col; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
        c.fillStyle = col === '#f2f2f2' || col === '#ffd12e' ? '#222' : '#fff'; c.font = '700 13px sans-serif'; c.fillText(label, x, y + 1);
      };
      btn(40, 52, '#2e8f4a', 'N'); btn(40, 112, '#2f6fe0', '-10'); btn(40, 172, '#ffd12e', 'WR');
      btn(472, 52, '#e8590c', 'P'); btn(472, 112, '#2f6fe0', '+1'); btn(472, 172, '#2e8f4a', 'DRS');
      btn(100, 212, '#f2f2f2', 'BB-', 13); btn(412, 212, '#f2f2f2', 'BB+', 13);
      btn(86, 252, '#e03a2c', 'X', 11); btn(426, 252, '#2e8f4a', 'OK', 11);
      // rotary dials: ringed with coloured segments and a pointer
      const dial = (x, y, r, cols, rot) => {
        c.fillStyle = '#15171b'; c.beginPath(); c.arc(x, y, r + 5, 0, 7); c.fill();
        cols.forEach((col, i) => { c.fillStyle = col; c.beginPath(); c.moveTo(x, y); c.arc(x, y, r, i * 6.2832 / cols.length, (i + 1) * 6.2832 / cols.length); c.fill(); });
        c.fillStyle = '#2a2d34'; c.beginPath(); c.arc(x, y, r * 0.55, 0, 7); c.fill();
        c.strokeStyle = '#f2f2f2'; c.lineWidth = 4; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(rot) * r * 0.9, y + Math.sin(rot) * r * 0.9); c.stroke();
      };
      dial(180, 232, 30, ['#e8c82c', '#2f8bff', '#e03a2c', '#2e8f4a', '#b25cff'], -1.0);
      dial(256, 236, 34, ['#2f8bff', '#e8c82c', '#2e8f4a', '#e03a2c'], 0.6);
      dial(332, 232, 30, ['#2e8f4a', '#2f8bff', '#e8c82c', '#e03a2c', '#b25cff'], -2.2);
      c.fillStyle = '#9aa0ab'; c.font = '600 11px sans-serif';
      c.fillText('ENTRY', 180, 198); c.fillText('MULT', 256, 196); c.fillText('HPP', 332, 198);
    });
    const plate = add(new THREE.PlaneGeometry(0.31, 0.17), new THREE.MeshStandardMaterial({ map: face, roughness: 0.55, metalness: 0.2, envMap: env, envMapIntensity: 0.5 }), this.wheel);
    plate.position.z = 0.0075;
    // emissive display (drawn a few times a second)
    this.lcd = document.createElement('canvas');
    this.lcd.width = 256; this.lcd.height = 128;
    this.lcdTex = new THREE.CanvasTexture(this.lcd);
    this.lcdTex.colorSpace = THREE.SRGBColorSpace;
    this.lcdTex.anisotropy = 8;
    add(new THREE.PlaneGeometry(0.15, 0.075), new THREE.MeshBasicMaterial({ map: this.lcdTex, toneMapped: false }), this.wheel).position.set(0, 0.022, 0.0085);
    // grips with gloved hands on them: back of hand, four fingers over the grip, thumb
    for (const s of [-1, 1]) {
      const grip = add(new THREE.CapsuleGeometry(0.024, 0.13, 4, 10), rubber, this.wheel);
      grip.position.set(s * 0.178, -0.01, -0.005);
      grip.rotation.z = s * 0.12;
      const hand = new THREE.Group(); hand.position.set(s * 0.183, 0.0, 0.0); hand.rotation.z = s * 0.12; this.wheel.add(hand);
      add(new THREE.SphereGeometry(0.036, 14, 10), glove, hand).scale.set(0.75, 1.25, 0.8);
      for (let f = 0; f < 4; f++) {
        const fing = add(new THREE.CapsuleGeometry(0.0085, 0.032, 3, 8), glove, hand);
        fing.rotation.z = Math.PI / 2; fing.position.set(-s * 0.016, 0.045 - f * 0.0235 - 0.02, 0.026);
      }
      const thumb = add(new THREE.CapsuleGeometry(0.009, 0.035, 3, 8), glove, hand);
      thumb.position.set(-s * 0.03, 0.045, 0.012); thumb.rotation.z = s * 0.7;
      const cuff = add(new THREE.CylinderGeometry(0.03, 0.033, 0.03, 12), new THREE.MeshStandardMaterial({ color: 0xe8590c, roughness: 0.7 }), hand);
      cuff.position.set(s * 0.01, -0.062, 0.0); cuff.rotation.z = s * 0.15;
    }
    // a few raised knobs on the plate for relief
    const knob = new THREE.CylinderGeometry(0.011, 0.011, 0.012, 14); knob.rotateX(Math.PI / 2);
    [[-0.1, 0.055, 0xffd54a], [0.1, 0.055, 0x2f8bff], [-0.1, -0.02, 0xe03a2c], [0.1, -0.02, 0x2e8f4a]].forEach(([x, y, col]) => {
      add(knob, new THREE.MeshStandardMaterial({ color: col, roughness: 0.4 }), this.wheel).position.set(x, y, 0.012);
    });

    this.root.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.renderOrder = 10; } });
  }

  // the stint's tyre compound, so the sidewall band matches the real tyre (same colours as the HUD)
  setCompound(comp) {
    if (comp !== this.comp) { this.comp = comp; this.bandMat.color.set((TYRES[comp] || TYRES.HARD).c); }
  }

  setTeam(color) {
    if (color !== this.team) { this.team = color; this.paint.color.set(color); }
  }

  // Refresh one mirror per call (alternating): render the world from the mirror, looking back along the car.
  renderMirrors(renderer, scene) {
    if (!this.root.visible) return;
    const m = this.mirrors[this.mirrorTick++ & 1];
    this.root.updateWorldMatrix(true, true);
    const p = new THREE.Vector3(), t = new THREE.Vector3(m.s * 0.44 + m.s * 3.5, -0.2, -0.7 + 10);
    m.g.getWorldPosition(p);
    this.root.localToWorld(t);
    m.cam.position.copy(p); m.cam.up.set(0, 1, 0); m.cam.lookAt(t); m.cam.updateMatrixWorld();
    const prev = renderer.getRenderTarget(), vis = this.root.visible;
    this.root.visible = false;
    renderer.setRenderTarget(m.rt); renderer.render(scene, m.cam);
    renderer.setRenderTarget(prev); this.root.visible = vis;
  }

  // lookYaw: the camera's look-into-corner yaw (rad), which
  // the cockpit counter-rotates so the car stays put while the view turns; tel: speed / gear / ...
  // road: road wheel angle (rad, + = left) from the rendered path (cars.js steer), smoothed and in phase
  // with the car; the wheel, gloves and front tyres all turn from it.
  update(dt, simDt, tel, road, lookYaw = 0) {
    if (!this.root.visible || !tel) return;
    this.root.rotation.set(CAMERA.onboard.pitch, -lookYaw, 0);   // rides up with the tilted view (camera.js)
    this.steer = road;
    this.wheel.rotation.z = THREE.MathUtils.clamp(road * STEERING.ratio, -STEERING.maxWheel, STEERING.maxWheel);   // left turn = anticlockwise
    this.spin += (tel.speed / 3.6 / R) * simDt;
    for (const t of this.tyres) {
      t.knuckle.rotation.y = this.steer;
      t.wheel.rotation.x = -this.spin;
    }
    const now = performance.now();
    if (now - this.lastLcd > 70) { this.lastLcd = now; this.drawLcd(tel); }
  }

  drawLcd(tel) {
    const c = this.lcd.getContext('2d'), w = 256, h = 128;
    c.fillStyle = '#0a1014'; c.fillRect(0, 0, w, h);
    // rev lights along the top edge: estimated revs (no RPM channel), speed against the gear's top speed
    const top = GEAR_TOP[Math.min(tel.gear, 8)] || 345;
    const rpm = tel.gear === 0 ? 4000 : Math.min(12400, Math.max(4000, 5200 + (tel.speed / top) * 7000));
    const lit = Math.round(Math.min(1, Math.max(0, (rpm - 9000) / 3000)) * 15);
    for (let i = 0; i < 15; i++) {
      c.fillStyle = i >= lit ? '#1d2329' : i < 5 ? '#2bff61' : i < 10 ? '#ff2a1a' : '#b25cff';
      c.beginPath(); c.arc(20 + i * 15.2, 11, 5.5, 0, Math.PI * 2); c.fill();
    }
    c.textBaseline = 'middle';
    c.fillStyle = '#ffffff'; c.textAlign = 'center'; c.font = '900 84px "Titillium Web", sans-serif';
    c.fillText(tel.gear === 0 ? 'N' : String(tel.gear), w / 2, 68);
    c.textAlign = 'left'; c.fillStyle = '#9fe7ff'; c.font = '700 28px "Titillium Web", sans-serif';
    c.fillText(String(Math.round(tel.speed)), 10, 40);
    c.font = '600 13px "Titillium Web", sans-serif'; c.fillStyle = '#8b94a3'; c.fillText('KM/H', 10, 62);
    c.textAlign = 'right'; c.fillStyle = tel.brake ? '#ff4d3d' : '#2bff61'; c.font = '700 22px "Titillium Web", sans-serif';
    c.fillText(tel.brake ? 'BRK' : `${Math.round(tel.throttle)}%`, w - 10, 40);
    // throttle / brake bar along the bottom
    c.fillStyle = '#1d2329'; c.fillRect(10, 104, w - 20, 14);
    c.fillStyle = '#2bff61'; c.fillRect(10, 104, (w - 20) * tel.throttle / 100, 14);
    if (tel.brake) { c.fillStyle = '#ff2a1a'; c.fillRect(10, 104, w - 20, 14); }
    this.lcdTex.needsUpdate = true;
  }
}
