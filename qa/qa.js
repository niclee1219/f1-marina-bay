// Dev-only QA helpers (not deployed). In the browser console on /?debug:
//   const qa = await import('/qa/qa.js'); await qa.ready(); await qa.shot('mbs'); qa.hud(false);
// Shots frame a landmark from a compass azimuth (deg, 0 = north), distance and elevation (deg).
export const SHOTS = {
  mbs: { t: [193, -704, 95], az: 330, d: 640, el: 10 },
  artscience: { t: [8, -452, 25], az: 345, d: 200, el: 14 },
  flyer: { t: [447, -74, 85], az: 322, d: 420, el: 8 },
  esplanade: { t: [-395, -35, 18], az: 150, d: 300, el: 16 },
  uob: { t: [-925, -503, 130], az: 75, d: 520, el: 8 },
  civic: { t: [-830, 20, 22], az: 95, d: 360, el: 22 },
  standrews: { t: [-750, 262, 22], az: 200, d: 200, el: 14 },
  fullerton: { t: [-656, -422, 14], az: 55, d: 230, el: 14 },
  chinatown: { t: [-1300, -700, 10], az: 60, d: 350, el: 25 },
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function ready() {
  for (let k = 0; k < 120 && !window.__f1; k++) await sleep(500);
  if (!window.__f1) throw new Error('app did not boot');
  window.__f1.state.playing = false;
  return window.__f1;
}

export function hud(show) {
  let s = document.getElementById('qa-hide');
  if (!s) {
    s = document.createElement('style');
    s.id = 'qa-hide';
    s.textContent = '#hud-top,#tower,#side,#dock,#labels,#card,#toasts,#minimap{display:none!important}';
    document.head.appendChild(s);
  }
  s.disabled = !!show;
}

export async function shot(key, over = {}) {
  const f = window.__f1, s = { ...SHOTS[key], ...over };
  const [x, y, h] = s.t;
  const az = s.az * Math.PI / 180, el = s.el * Math.PI / 180;
  f.camera.position.set(x + s.d * Math.cos(el) * Math.sin(az), h + s.d * Math.sin(el), -y - s.d * Math.cos(el) * Math.cos(az));
  f.director.controls.target.set(x, h, -y);
  f.camera.fov = s.fov || 42;
  f.camera.updateProjectionMatrix();
  f.director.controls.update();
  hud(false);
  await sleep(900);
  return key;
}
