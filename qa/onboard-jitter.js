// Dev-only: measure onboard camera jitter deterministically. In the console on /?debug:
//   const m = await import('/qa/onboard-jitter.js'); m.measure(300, 6)
// Steps the app's own update functions (cars, then camera director) at a fixed 1/60 s for
// `secs` seconds from session time `t0`, with the onboard camera on the focused car, and reports:
//   yawAccel   RMS second difference of the view yaw (deg / frame^2): twitchiness of the heading
//   posWobble  RMS distance of the camera from a 7-frame moving average of its path (mm): shake
export function measure(t0 = 300, secs = 6, fps = 60, speed = 1) {
  const f = window.__f1;
  const dt = 1 / fps;
  f.state.playing = false;   // the live loop keeps rendering, but time only moves here
  f.director.setMode('onboard');
  const opts = { ...f.state.opts, onboard: true, realScale: true, jumped: true };
  const car = () => f.cars.cars[f.state.focusK];
  let t = t0;
  f.cars.update(t, 0, f.camera.position, f.state.focusK, opts);
  opts.jumped = false;
  f.director.update(dt, car(), true);
  const yaw = [], pos = [];
  let lag = 0;
  const d = f.camera.position.clone();
  for (let i = 0; i < secs * fps; i++) {
    t += dt * speed;
    f.cars.update(t, dt * speed, f.camera.position, f.state.focusK, opts);
    f.director.update(dt, car(), true, dt * speed);
    lag = Math.max(lag, Math.abs(Math.atan2(Math.sin(f.director.camYaw - car().heading), Math.cos(f.director.camYaw - car().heading))));
    f.camera.getWorldDirection(d);
    yaw.push(Math.atan2(d.x, d.z));
    pos.push(f.camera.position.clone());
  }
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  let acc = 0, n = 0;
  for (let i = 2; i < yaw.length; i++) {
    const a = wrap(yaw[i] - yaw[i - 1]) - wrap(yaw[i - 1] - yaw[i - 2]);
    acc += (a * 180 / Math.PI) ** 2; n++;
  }
  let wob = 0, m = 0;
  for (let i = 3; i < pos.length - 3; i++) {
    const avg = pos[i - 3].clone();
    for (let k = -2; k <= 3; k++) avg.add(pos[i + k]);
    avg.multiplyScalar(1 / 7);
    wob += pos[i].distanceToSquared(avg); m++;
  }
  return { speed: car().tel.speed | 0, yawAccel: +Math.sqrt(acc / n).toFixed(4), posWobbleMm: +(Math.sqrt(wob / m) * 1000).toFixed(2), maxLagDeg: +(lag * 180 / Math.PI).toFixed(1) };
}
