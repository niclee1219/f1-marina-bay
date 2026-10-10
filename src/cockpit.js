// Onboard cockpit: what the driver sees, bolted to the camera (camera space: -z ahead, +y up,
// metres from the driver's eyes). The halo hoop and centre pillar, the nose and cockpit rims in
// team colour, mirrors, the front tyres turning with speed and steering on their suspension arms,
// and the steering wheel with a live LCD (rev lights, gear, speed) turning with the car's yaw rate.
// The focused car's own model is hidden in this view (cars.js), so nothing clips the lens.
import * as THREE from 'three';

const EYE = 0.92;                      // driver's eye height above the road (m)
const AXLE = 1.75;                     // front axle ahead of the eyes (m)
const TRACK = 0.8;                     // front tyre centre either side of the car centreline (m)
const R = 0.36, TW = 0.38;             // front tyre radius / width (m)
const GEAR_TOP = [0, 100, 140, 175, 210, 245, 280, 310, 345];

export class Cockpit {
  constructor(camera) {
    this.root = new THREE.Group();
    this.root.visible = false;
    this.root.renderOrder = 10;
    camera.add(this.root);
    this.steer = 0;
    this.spin = 0;
    this.lastLcd = 0;

    const carbon = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.45, metalness: 0.35 });
    const satin = new THREE.MeshStandardMaterial({ color: 0x24262c, roughness: 0.6, metalness: 0.2 });
    this.paint = new THREE.MeshStandardMaterial({ color: 0xcc0000, roughness: 0.35, metalness: 0.25 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.9 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x0a0d12, roughness: 0.05, metalness: 0.9 });
    const add = (geo, mat, parent = this.root) => { const m = new THREE.Mesh(geo, mat); parent.add(m); return m; };
    const y0 = -EYE;   // road level in camera space

    // ------------------------------------------------------------- halo: hoop just below eye level + pillar
    const hoop = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.4, -0.2, 0.25), new THREE.Vector3(-0.38, -0.16, -0.2),
      new THREE.Vector3(-0.25, -0.14, -0.6), new THREE.Vector3(0, -0.13, -0.74),
      new THREE.Vector3(0.25, -0.14, -0.6), new THREE.Vector3(0.38, -0.16, -0.2),
      new THREE.Vector3(0.4, -0.2, 0.25),
    ]);
    add(new THREE.TubeGeometry(hoop, 48, 0.022, 10), carbon);
    const pillar = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -0.13, -0.74), new THREE.Vector3(0, -0.24, -0.9), new THREE.Vector3(0, -0.42, -1.02),
    ]);
    add(new THREE.TubeGeometry(pillar, 12, 0.026, 10), carbon);

    // ------------------------------------------------------------- chassis: nose, cockpit rims
    // nose: a tapering wedge from the cockpit opening to the front wing, painted on top
    const nose = new THREE.Shape();
    nose.moveTo(-0.24, 0); nose.lineTo(0.24, 0); nose.lineTo(0.1, -3.2); nose.lineTo(-0.1, -3.2); nose.closePath();
    const noseGeo = new THREE.ExtrudeGeometry(nose, { depth: 0.16, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.04, bevelSegments: 3 });
    noseGeo.rotateX(Math.PI / 2);                       // shape y -> -z (ahead), extrude down
    const noseM = add(noseGeo, this.paint);
    noseM.position.set(0, -0.45, -0.95);
    noseM.rotation.x = -0.06;                           // dips toward the front wing
    // cockpit rims either side of the driver, the dash top in front of the wheel
    for (const s of [-1, 1]) {
      const rim = add(new THREE.BoxGeometry(0.12, 0.1, 1.4), this.paint);
      rim.position.set(s * 0.34, -0.44, -0.3);
      rim.rotation.z = s * 0.15;
    }
    const dash = add(new THREE.BoxGeometry(0.56, 0.06, 0.3), carbon);
    dash.position.set(0, -0.44, -0.8);

    // mirrors on stalks
    for (const s of [-1, 1]) {
      const stalk = add(new THREE.BoxGeometry(0.03, 0.12, 0.03), carbon);
      stalk.position.set(s * 0.6, -0.3, -0.62);
      const housing = add(new THREE.BoxGeometry(0.2, 0.07, 0.06), this.paint);
      housing.position.set(s * 0.62, -0.22, -0.62);
      const mirror = add(new THREE.PlaneGeometry(0.17, 0.05), glass);
      mirror.position.set(s * 0.62, -0.22, -0.588);
    }

    // ------------------------------------------------------------- front tyres + suspension
    this.tyres = [];
    const tyreGeo = new THREE.CylinderGeometry(R, R, TW, 36, 1);
    tyreGeo.rotateZ(Math.PI / 2);
    const rimGeo = new THREE.CylinderGeometry(R * 0.62, R * 0.62, TW + 0.01, 24, 1);
    rimGeo.rotateZ(Math.PI / 2);
    // a stripe on the sidewall shows the tyre turning
    const stripe = new THREE.TorusGeometry(R * 0.82, 0.018, 6, 36);
    stripe.rotateY(Math.PI / 2);
    this.stripeMat = new THREE.MeshBasicMaterial({ color: 0xffd12e });
    for (const s of [-1, 1]) {
      const knuckle = new THREE.Group();
      knuckle.position.set(s * TRACK, y0 + R, -AXLE);
      this.root.add(knuckle);
      const wheel = new THREE.Group();
      knuckle.add(wheel);
      add(tyreGeo, rubber, wheel);
      add(rimGeo, satin, wheel);
      const st = add(stripe, this.stripeMat, wheel);
      st.position.x = s * (TW / 2 + 0.002);
      // a spoke so the rotation reads even when the stripe blurs
      const spoke = add(new THREE.BoxGeometry(0.01, R * 1.1, 0.04), satin, wheel);
      spoke.position.x = s * (TW / 2 + 0.006);
      this.tyres.push({ knuckle, wheel });
      // wishbones from the chassis to the upright
      for (const [dy, dz] of [[0.12, 0.18], [-0.08, -0.12]]) {
        const a = new THREE.Vector3(s * 0.2, y0 + R + dy, -AXLE + 0.35 + dz);
        const b = new THREE.Vector3(s * (TRACK - TW / 2), y0 + R + dy * 0.8, -AXLE);
        const len = a.distanceTo(b);
        const arm = add(new THREE.CylinderGeometry(0.014, 0.014, len, 6), carbon);
        arm.position.copy(a).add(b).multiplyScalar(0.5);
        arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      }
    }

    // ------------------------------------------------------------- steering wheel with LCD
    this.wheel = new THREE.Group();
    this.wheel.position.set(0, -0.23, -0.46);
    this.wheel.scale.setScalar(1.0);
    this.wheel.rotation.x = 0.32;                         // tilted back toward the driver
    this.root.add(this.wheel);
    const body = new THREE.Shape();
    body.moveTo(-0.14, -0.06); body.lineTo(0.14, -0.06);
    body.quadraticCurveTo(0.16, 0.0, 0.14, 0.07); body.lineTo(-0.14, 0.07); body.quadraticCurveTo(-0.16, 0.0, -0.14, -0.06);
    const bodyGeo = new THREE.ExtrudeGeometry(body, { depth: 0.03, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 2 });
    add(bodyGeo, carbon, this.wheel).position.z = -0.03;
    for (const s of [-1, 1]) {
      const grip = add(new THREE.CapsuleGeometry(0.028, 0.12, 4, 10), rubber, this.wheel);
      grip.position.set(s * 0.155, -0.005, 0.0);
      grip.rotation.z = s * 0.18;
      // gloves holding the grips
      const glove = add(new THREE.SphereGeometry(0.036, 12, 10), satin, this.wheel);
      glove.scale.set(0.9, 1.25, 1);
      glove.position.set(s * 0.165, 0.01, 0.02);
    }
    // the LCD, drawn to a canvas a few times a second
    this.lcd = document.createElement('canvas');
    this.lcd.width = 256; this.lcd.height = 128;
    this.lcdTex = new THREE.CanvasTexture(this.lcd);
    this.lcdTex.colorSpace = THREE.SRGBColorSpace;
    const screen = add(new THREE.PlaneGeometry(0.15, 0.075), new THREE.MeshBasicMaterial({ map: this.lcdTex, toneMapped: false }), this.wheel);
    screen.position.set(0, 0.005, 0.009);
    // rotary knobs and buttons around the screen
    const knob = new THREE.CylinderGeometry(0.011, 0.011, 0.012, 14); knob.rotateX(Math.PI / 2);
    const cols = [0xffd54a, 0xe03a2c, 0x2f8bff, 0x3a3f48, 0x3a3f48, 0xe03a2c];
    [[-0.11, 0.045], [0.11, 0.045], [-0.11, -0.04], [0.11, -0.04], [-0.05, -0.05], [0.05, -0.05]].forEach(([x, y], i) => {
      add(knob, new THREE.MeshStandardMaterial({ color: cols[i], roughness: 0.4 }), this.wheel).position.set(x, y, 0.012);
    });

    this.root.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.renderOrder = 10; } });
  }

  setTeam(color) {
    if (color !== this.team) { this.team = color; this.paint.color.set(color); }
  }

  // yawRate: rad/s of the car's heading; tel: speed / gear / throttle / brake; dt real, simDt replay
  update(dt, simDt, tel, yawRate) {
    if (!this.root.visible || !tel) return;
    // steering from the yaw rate at this speed: radius = v / yawRate, Ackermann angle = wheelbase / radius
    const v = Math.max(tel.speed / 3.6, 1);
    const want = THREE.MathUtils.clamp(Math.atan(3.6 * yawRate / v), -0.35, 0.35);
    this.steer += (want - this.steer) * (1 - Math.exp(-10 * dt));
    this.wheel.rotation.z = -this.steer * 4.5;         // steering ratio: the wheel turns more than the tyres
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
    c.fillStyle = '#04080a'; c.fillRect(0, 0, w, h);
    // estimated revs (no RPM channel): speed against the gear's top speed
    const top = GEAR_TOP[Math.min(tel.gear, 8)] || 345;
    const rpm = tel.gear === 0 ? 4000 : Math.min(12400, Math.max(4000, 5200 + (tel.speed / top) * 7000));
    const lit = Math.round(Math.min(1, Math.max(0, (rpm - 9000) / 3000)) * 15);
    for (let i = 0; i < 15; i++) {
      c.fillStyle = i >= lit ? '#15191d' : i < 5 ? '#2bff61' : i < 10 ? '#ff2a1a' : '#b25cff';
      c.beginPath(); c.arc(18 + i * 15.7, 12, 5.5, 0, Math.PI * 2); c.fill();
    }
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#ffffff'; c.font = '900 72px "Titillium Web", sans-serif';
    c.fillText(tel.gear === 0 ? 'N' : String(tel.gear), w / 2, 74);
    c.font = '700 26px "Titillium Web", sans-serif'; c.fillStyle = '#9fe7ff';
    c.textAlign = 'left'; c.fillText(String(Math.round(tel.speed)), 12, 64);
    c.font = '600 13px "Titillium Web", sans-serif'; c.fillStyle = '#6b7280'; c.fillText('KM/H', 12, 86);
    c.textAlign = 'right'; c.fillStyle = tel.brake ? '#ff4d3d' : '#2bff61';
    c.font = '700 22px "Titillium Web", sans-serif';
    c.fillText(tel.brake ? 'BRK' : `${Math.round(tel.throttle)}%`, w - 12, 64);
    c.font = '600 13px "Titillium Web", sans-serif'; c.fillStyle = '#6b7280'; c.fillText(tel.brake ? 'BRAKE' : 'THR', w - 12, 86);
    // throttle / brake bars along the bottom
    c.fillStyle = '#15191d'; c.fillRect(12, 106, w - 24, 10);
    c.fillStyle = '#2bff61'; c.fillRect(12, 106, (w - 24) * tel.throttle / 100, 10);
    if (tel.brake) { c.fillStyle = '#ff2a1a'; c.fillRect(12, 106, w - 24, 4); }
    this.lcdTex.needsUpdate = true;
  }
}
