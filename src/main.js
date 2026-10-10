import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { loadAll } from './data.js';
import { buildSky, buildCity, buildWater } from './world.js';
import { buildSkyline, hiddenBuilding } from './skyline.js';
import { Track } from './track.js';
import { loadLogos } from './sponsors.js';
import { Cars } from './cars.js';
import { Bridges } from './bridges.js';
import { Viaducts } from './viaducts.js';
import { buildPitComplex } from './pit.js';
import { Crowd } from './crowd.js';
import { Director, MODES } from './camera.js';
import { CAMERA } from './config.js';
import { UI } from './ui.js';

const pods = [...document.querySelectorAll('.pod')];
const status = document.getElementById('ld-status');
const setLights = n => pods.forEach((p, i) => p.classList.toggle('on', i < n));

async function boot() {
  const { race, city, sessions, id } = await loadAll(p => setLights(Math.min(5, Math.floor(p * 5.01))));
  try { sessionStorage.setItem('f1mb-session', id); } catch { /* storage unavailable */ }
  status.textContent = 'Building Marina Bay…';
  // sponsor boards and signs are drawn to canvas in the web font, so wait for it
  const fonts = ['900 40px "Titillium Web"', '700 40px "Titillium Web"', '600 40px "Titillium Web"', '400 40px "Titillium Web"', '700 40px "Cinzel"'];
  try { await Promise.race([Promise.all(fonts.map(f => document.fonts.load(f))), new Promise(r => setTimeout(r, 2500))]); } catch { /* fallback font */ }
  await Promise.race([loadLogos(), new Promise(r => setTimeout(r, 4000))]);   // sponsor board logos
  await new Promise(r => setTimeout(r, 30));

  // ---------------------------------------------------------------- renderer
  const stage = document.getElementById('stage');
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  stage.appendChild(renderer.domElement);
  const labelRenderer = new CSS2DRenderer({ element: document.getElementById('labels') });
  labelRenderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0c1020, 0.00028);
  const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, CAMERA.free.nearMin, CAMERA.free.far);

  scene.add(new THREE.HemisphereLight(0x4a5a8a, 0x1a1210, 0.5));
  const moon = new THREE.DirectionalLight(0x9fb4ff, 0.55);
  moon.position.set(-600, 900, 400);
  scene.add(moon);
  // warm floodlight wash over the circuit
  const wash = new THREE.DirectionalLight(0xfff1dc, 0.3);
  wash.position.set(200, 600, -300);
  scene.add(wash);

  buildSky(scene);
  const { beacons, update: updateCity, heightAt, domes } = buildCity(scene, city, hiddenBuilding);
  const skyline = buildSkyline(scene, city, domes);
  const water = buildWater(scene, city, renderer);
  const track = new Track(race);
  const viaducts = new Viaducts(city, track, race);
  const bridges = new Bridges(track, viaducts.zones);   // sets the shade zones before the asphalt material compiles
  track.build(scene, race);
  bridges.build(scene);
  viaducts.build(scene);
  const pit = buildPitComplex(track.group, city, race, track);
  const cars = new Cars(scene, race, track, bridges);
  const crowd = new Crowd(scene, track, race, pit.decks);
  const director = new Director(camera, renderer.domElement, track, (x, z, y) => (viaducts.blocks(x, y, z) ? Infinity : heightAt(x, z)),
    (x, z) => Math.max(heightAt(x, z), viaducts.topAt(x, z)));
  director.overview();

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.7, 0.5, 0.9);
  composer.addPass(bloom);
  // radial "zoom" blur + vignette that builds with speed in the chase and onboard cameras
  const speedPass = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, strength: { value: 0 }, center: { value: new THREE.Vector2(0.5, 0.55) }, aspect: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float strength; uniform vec2 center; uniform float aspect; varying vec2 vUv;
      void main(){
        vec2 dir = vUv - center;
        float d = length(dir * vec2(aspect, 1.0));
        float amt = strength * smoothstep(0.06, 0.75, d);
        vec3 c = vec3(0.0);
        for (int i = 0; i < 14; i++) {
          float s = 1.0 - amt * float(i) / 13.0;
          vec2 uv = center + dir * s;
          // slight chromatic split at the edges
          c.r += texture2D(tDiffuse, center + dir * (s + amt * 0.04)).r;
          c.g += texture2D(tDiffuse, uv).g;
          c.b += texture2D(tDiffuse, center + dir * (s - amt * 0.04)).b;
        }
        c /= 14.0;
        c *= 1.0 - strength * 2.2 * smoothstep(0.35, 1.05, d);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  speedPass.enabled = false;
  composer.addPass(speedPass);
  composer.addPass(new OutputPass());

  // ---------------------------------------------------------------- state
  // races open on the grid just before lights out; other sessions once cars are out on track
  const fastest = race.drivers.findIndex(d => d.finish === 1);
  const state = {
    t: race.isRace ? race.race_start - 10 : race.race_start + 90, speed: 1, playing: true,
    focusK: fastest >= 0 ? fastest : 0,
    opts: { labels: true, trails: true, realScale: false, onboard: false, jumped: true },
    prevToastT: null,
  };

  const ui = new UI(race, track, sessions, id, {
    select: k => { state.focusK = k; if (director.mode === 'orbit') director.follow = true; },
    seek: t => { state.t = t; state.opts.jumped = true; state.prevToastT = null; },
    skip: s => { state.t = Math.max(0, Math.min(race.duration, state.t + s)); state.opts.jumped = true; state.prevToastT = null; },
    togglePlay: () => { state.playing = !state.playing; ui.setPlaying(state.playing); },
    speed: s => { state.speed = s; ui.setSpeed(s); },
    camera: m => setCamera(m),
    toggle: (id, on) => {
      if (id === 'labels') state.opts.labels = on;
      if (id === 'trails') state.opts.trails = on;
      if (id === 'drs') track.drsMesh.visible = on;
      if (id === 'reflect') water.visible = on, waterFlat.visible = !on;
    },
  });
  cars.onSelect = k => { state.focusK = k; };

  // flat fallback when reflections are off
  const waterFlat = new THREE.Mesh(water.geometry, new THREE.MeshStandardMaterial({ color: 0x06121f, roughness: 0.25, metalness: 0.6, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
  waterFlat.position.y = 0.01; waterFlat.visible = false;
  scene.add(waterFlat);

  function setCamera(m) {
    director.setMode(m);
    director.follow = false;
    state.opts.onboard = m === 'onboard';
    state.opts.realScale = m === 'onboard' || m === 'chase';
    ui.setCamera(m);
  }
  setCamera('orbit');
  if (location.search.includes('debug')) window.__f1 = { scene, camera, state, director, cars, race, track, bridges, viaducts, renderer, crowd, pit, skyline, composer };
  ui.setPlaying(true);
  ui.setSpeed(1);

  window.addEventListener('keydown', e => {
    if (e.target.closest('input, textarea')) return;
    if (e.code === 'Space') { e.preventDefault(); state.playing = !state.playing; ui.setPlaying(state.playing); }
    else if (e.key === 'ArrowLeft') { state.t = Math.max(0, state.t - 10); state.opts.jumped = true; state.prevToastT = null; }
    else if (e.key === 'ArrowRight') { state.t = Math.min(race.duration, state.t + 10); state.opts.jumped = true; state.prevToastT = null; }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const order = race.order(state.t);
      const i = order.findIndex(d => d.k === state.focusK);
      const j = Math.max(0, Math.min(order.length - 1, i + (e.key === 'ArrowUp' ? -1 : 1)));
      state.focusK = order[j].k;
    } else if (/^[1-5]$/.test(e.key)) setCamera(MODES[+e.key - 1]);
    else if (e.key === 'f' || e.key === 'F') director.follow = !director.follow;
  });

  window.addEventListener('resize', () => {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.setSize(w, h); composer.setSize(w, h); labelRenderer.setSize(w, h);
  });

  // driver labels inside the rooftop sign's screen rectangle are faded (see Cars.update)
  const signRect = { x0: 0, x1: 0, y0: 0, y1: 0 }, tmpV = new THREE.Vector3();
  function updateSignRect() {
    const b = pit.signBox;
    signRect.x0 = signRect.y0 = Infinity; signRect.x1 = signRect.y1 = -Infinity;
    if (!b) return;
    for (let k = 0; k < 8; k++) {
      tmpV.set(k & 1 ? b.max.x : b.min.x, k & 2 ? b.max.y : b.min.y, k & 4 ? b.max.z : b.min.z).project(camera);
      if (tmpV.z > 1) { signRect.x0 = Infinity; return; }   // behind the camera
      signRect.x0 = Math.min(signRect.x0, tmpV.x); signRect.x1 = Math.max(signRect.x1, tmpV.x);
      signRect.y0 = Math.min(signRect.y0, tmpV.y); signRect.y1 = Math.max(signRect.y1, tmpV.y);
    }
  }
  state.opts.labelMask = (p) => {
    tmpV.copy(p).project(camera);
    // labels hang above the car: test a little above its projected position
    return tmpV.x > signRect.x0 - 0.02 && tmpV.x < signRect.x1 + 0.02 && tmpV.y > signRect.y0 - 0.08 && tmpV.y < signRect.y1 + 0.02;
  };

  // ---------------------------------------------------------------- loop
  const clock = new THREE.Clock();
  let uiAcc = 1, slowAcc = 1, order = race.order(state.t), timing = race.timing(state.t);
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.1);
    if (state.playing) {
      state.t += dt * state.speed;
      if (state.t >= race.duration) { state.t = race.duration; state.playing = false; ui.setPlaying(false); }
    }
    const t = state.t;
    updateSignRect();
    // pixels per radian at the screen centre, for size-on-screen decisions (car decals)
    state.opts.pixelScale = renderer.domElement.clientHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    cars.update(t, state.playing ? dt * state.speed : 0, camera.position, state.focusK, state.opts);
    state.opts.jumped = false;
    // simDt: replay time this frame, so the onboard spring keeps up with the car at 5x-60x
    director.update(dt, cars.cars[state.focusK], state.playing, state.playing ? dt * state.speed : dt);

    // start lights: one per second, out at lights-out
    const ls = race.race_start - t;
    track.setStartLights(race.isRace && ls > 0 && ls < 6 ? Math.min(5, Math.floor(6 - ls)) : 0);

    water.material.uniforms.time.value += dt;
    updateCity(dt);
    skyline.update(dt);
    crowd.update(dt, cars.cars, camera.position);
    track.update(dt);
    // speed blur follows the focused car's speed (only while playing)
    const want = state.playing ? (director.speedFactor || 0) * 0.075 * Math.min(1, state.speed) : 0;
    const su = speedPass.uniforms.strength;
    su.value += (want - su.value) * (1 - Math.pow(0.02, dt));
    speedPass.uniforms.aspect.value = camera.aspect;
    speedPass.enabled = su.value > 0.002;
    beacons.material.color.setRGB(2 + 2.5 * (Math.sin(clock.elapsedTime * 3) > 0.6 ? 1 : 0), 0.12, 0.08);

    uiAcc += dt;
    if (uiAcc > 0.12) {
      uiAcc = 0;
      order = race.order(t);
      ui.updateTimeline(t);
      ui.updateMinimap(cars.cars, order, state.focusK);
      cars.setPositions(order);
      ui.toasts(state.prevToastT, t);
      // pit exit is closed until the start (races) and under a red flag
      pit.setExit(!(race.isRace && t < race.race_start) && race.flagState(t).label !== 'RED');
      state.prevToastT = t;
    }
    slowAcc += dt;
    if (slowAcc > 0.25) {
      slowAcc = 0;
      timing = race.timing(t);
      ui.updateTower(t, order, state.focusK, timing, cars.cars);
    }
    ui.updateCard(t, state.focusK, timing);

    composer.render();
    labelRenderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  status.textContent = race.isRace ? 'Lights out' : 'Pit exit open';
  setLights(5);
  setTimeout(() => {
    setLights(0);
    document.getElementById('loader').classList.add('done');
  }, 600);
  requestAnimationFrame(frame);
}

boot().catch(err => {
  console.error(err);
  status.textContent = `Failed to load: ${err.message}`;
});
