// Pre-start camera tour: what the viewer sees while the Start button waits. Shots are laid out from
// the pit lane (pitlane.js, u along the lane, w toward the garages, h up) so they follow the pit
// building wherever the lane runs: the opening overhead drift, a slow track-side hover along the
// building, a descent from the Singapore Flyer to the pit lane, an arc over the roof and paddock, and
// a top-down shot of the lane and grid. Director.startTour (camera.js) crossfades between them.
import * as THREE from 'three';
import { OVERVIEW } from './camera.js';
import { PIT_LANE } from './config.js';

const ease = k => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
const smooth = (k, a, b) => THREE.MathUtils.smoothstep(k, a, b);
const lerp = THREE.MathUtils.lerp;
const Y = new THREE.Vector3(0, 1, 0);

// anchor(): world position of the pole car (or null), for the top-down shot
export function buildTour(camera, track, city, span, anchor = () => null) {
  const L = track.lane;
  if (!L || !span) return null;
  const G = PIT_LANE.garage, { u0, u1 } = span, um = (u0 + u1) / 2;
  // where the circuit's centreline sits across the lane (negative: on the track side)
  const k = L.locate(um)[0], tp = track.P[L.ti[k]], gm = L.G[k], pm = L.P[k];
  const wc = (tp.x - pm.x) * gm.x + (tp.z - pm.z) * gm.z;
  const flyer = city.landmarks.find(l => l.type === 'flyer');
  const pt = (u, w, h) => L.point(u, w, h);
  const v = new THREE.Vector3();

  const shots = [];

  // 1. the overhead TV framing the intro landed on, easing in a little
  shots.push({
    dur: 8, fov: 42, near: 2,
    pose(f, o) {
      const ov = camera.aspect < 1 ? OVERVIEW.narrow : OVERVIEW.wide, tg = new THREE.Vector3(...ov.target);
      o.look.copy(tg);
      o.pos.set(...ov.pos).sub(tg).multiplyScalar(1 - 0.1 * ease(f)).add(tg);
      o.pos.y += 6 * Math.sin(f * Math.PI);
      shots[0].fov = ov.fov;
    },
  });

  // 2. hover: along the building from the circuit side, high enough to read the facade and roof lettering
  shots.push({
    dur: 14, fov: 52, near: 2,
    pose(f, o) {
      const e = ease(f), u = lerp(u0 + 30, u1 - 40, e);
      o.pos.copy(pt(u, wc - 26 - 8 * e, 30 + 12 * e));
      o.look.copy(pt(u + 34, G + 4, 15 + 5 * e));
    },
  });

  // 3. fly-in from the Singapore Flyer down to the pit lane, then low along it toward the exit
  // start clear of the wheel (its spokes and capsules fill the lens inside ~60 m), on the pit lane's side of it
  const fp = flyer ? new THREE.Vector3(flyer.x, 150, -flyer.y).lerp(pt(um, wc, 0).setY(150), 0.3) : pt(u0 - 250, wc - 60, 120);
  const path = new THREE.CatmullRomCurve3([
    fp,
    fp.clone().lerp(pt(u0 + 20, wc * 0.7, 40), 0.5).setY(105),
    pt(u0 - 30, wc * 0.7, 40),
    pt(u0 + (um - u0) * 0.7, wc * 0.55, 15),
    pt(um + (u1 - um) * 0.5, wc * 0.5, 8),
  ], false, 'centripetal');
  const roofLook = pt(um, G + 6, 14), exitLook = pt(u1 - 10, wc * 0.4, 1.5);
  shots.push({
    dur: 18, fov: 50, near: 1.5,
    pose(f, o) {
      path.getPoint(ease(f) * 0.8 + f * 0.2, o.pos);
      o.look.copy(roofLook).lerp(exitLook, smooth(f, 0.35, 0.95));
    },
  });

  // 4. an arc over the paddock and roof, ending behind the pit exit looking back down the building
  const C = pt(um, G + 16, 10);
  shots.push({
    dur: 13, fov: 48, near: 2,
    pose(f, o) {
      const a = lerp(Math.PI * 0.5, Math.PI * 0.12, ease(f)), R = 125 - 25 * f;
      const t = L.frame(um).t, gd = L.frame(um).g;
      o.pos.copy(C).addScaledVector(gd, Math.sin(a) * R).addScaledVector(t, Math.cos(a) * R);
      o.pos.y = 48 + 10 * f;
      o.look.copy(C).setY(8);
    },
  });

  // 5. straight down on the pit lane and the grid, drifting up and turning slowly
  shots.push({
    dur: 12, fov: 46, near: 2,
    pose(f, o) {
      const a = anchor();
      let c;
      if (a) c = v.copy(a);
      else c = pt(um, wc * 0.5, 0);
      // lane direction at the anchor: the nearest lane sample
      let best = 0, bd = Infinity;
      for (let i = 0; i < L.n; i++) { const d = (L.P[i].x - c.x) ** 2 + (L.P[i].z - c.z) ** 2; if (d < bd) { bd = d; best = i; } }
      const t = L.T[best], gd = L.G[best];
      // landscape screens: the lane runs across; portrait: up and down
      const up = (camera.aspect > 1 ? gd : t).clone().applyAxisAngle(Y, lerp(0.0, -0.35, ease(f)));
      const h = lerp(150, 105, ease(f));
      o.look.set(c.x + t.x * 22 * f, 0, c.z + t.z * 22 * f).addScaledVector(gd, -9);
      o.pos.set(o.look.x, h, o.look.z).addScaledVector(up, -0.5);
      o.up.copy(up);
    },
  });

  return shots;
}
