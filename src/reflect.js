// Live reflections for the cars and the cockpit: a small cube map of the surroundings, captured
// from the focused car one face per frame (so the cost is a single cheap extra pass, and the map
// rolls forward a sixth at a time instead of jumping all at once). Car and cockpit materials use `texture` as their envMap, so the
// bodywork shows the floodlights, grandstands and track around it. three.js converts the render
// target to a prefiltered map by itself once `needsPMREMUpdate` is set, which is why roughness works.
import * as THREE from 'three';
import { QUALITY } from './quality.js';

// small maps: reflections of the floodlit surroundings are low-frequency; low-end GPUs get an even smaller one
const SIZE = QUALITY.level === 'high' ? 64 : 32;

export class Reflections {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.rt = new THREE.WebGLCubeRenderTarget(SIZE, { type: THREE.HalfFloatType, generateMipmaps: false });
    this.cam = new THREE.CubeCamera(0.4, 1500, this.rt);
    // layer 0 only: skips the crowd, city roads, street furniture and traffic (layer 1), which is most of the draw calls
    this.cam.children.forEach(c => c.layers.set(0));
    this.face = 0;
    this.seeded = false;
    this.hidden = [];
  }

  get texture() { return this.rt.texture; }

  // pos: where the map is captured (world); hide: objects left out of it (the car itself, the cockpit);
  // active: refresh a face this frame (false = keep the last map; the first call always fills it)
  update(pos, hide, active) {
    if (!active && this.seeded) return;
    const r = this.renderer, prev = r.getRenderTarget(), prevAuto = r.autoClear;
    this.cam.position.copy(pos);
    this.cam.updateMatrixWorld(true);
    const vis = hide.map(o => o.visible);
    hide.forEach(o => { o.visible = false; });
    const faces = this.seeded ? [this.face++ % 6] : [0, 1, 2, 3, 4, 5];
    for (const f of faces) {
      r.setRenderTarget(this.rt, f);
      r.clear();
      r.render(this.scene, this.cam.children[f]);
    }
    this.rt.texture.needsPMREMUpdate = true;     // every face: a small map is cheap to prefilter, and the reflection then rolls on continuously
    this.seeded = true;
    hide.forEach((o, i) => { o.visible = vis[i]; });
    r.setRenderTarget(prev);
    r.autoClear = prevAuto;
  }
}
