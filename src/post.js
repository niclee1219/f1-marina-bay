// Post-processing chain, by quality level (quality.js: ?quality=low | high, else auto):
//   scene     HalfFloat target; 2x MSAA on 'high' (the composer bypasses the canvas antialias)
//   bloom     UnrealBloom on the lamps, signs and floodlit asphalt (lighter on 'low')
//   ...       passes main.js inserts (the speed blur)
//   output    ACES filmic tone mapping (renderer.toneMapping) and sRGB
//   grade     subtle night grade after tone mapping: cool shadows, warm sodium highlights, a touch
//             of saturation, and a soft vignette
//   FXAA      on 'low' instead of MSAA
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { QUALITY } from './quality.js';

export const POST = {
  high: { samples: 2, fxaa: false, bloom: [0.5, 0.35, 0.95] },   // 4x cost ~3.5 ms more on an M1 Pro
  low: { samples: 0, fxaa: true, bloom: [0.4, 0.3, 0.96] },
  grade: { vignette: 0.22, saturation: 1.06, shadows: [0.97, 1.0, 1.05], highlights: [1.04, 1.0, 0.95] },
};

// Scene render + bloom. main.js adds its own passes, then calls finishComposer().
export function buildComposer(renderer, scene, camera) {
  const q = POST[QUALITY.level] || POST.high;
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: q.samples });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const [strength, radius, threshold] = q.bloom;
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), strength, radius, threshold);
  // a smaller bloom buffer on 'low' (QUALITY.bloom): the glow is soft, so half size hardly shows
  const setSize = bloom.setSize.bind(bloom);
  bloom.setSize = (w, h) => setSize(Math.max(1, Math.round(w * QUALITY.bloom)), Math.max(1, Math.round(h * QUALITY.bloom)));
  composer.addPass(bloom);
  return { composer, bloom };
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null }, vignette: { value: POST.grade.vignette }, saturation: { value: POST.grade.saturation },
    shadows: { value: new THREE.Vector3(...POST.grade.shadows) }, highlights: { value: new THREE.Vector3(...POST.grade.highlights) },
    aspect: { value: 1 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float vignette, saturation, aspect; uniform vec3 shadows, highlights;
    varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, saturation);
      c *= mix(shadows, highlights, smoothstep(0.05, 0.7, l));
      vec2 d = (vUv - 0.5) * vec2(aspect, 1.0);
      c *= 1.0 - vignette * smoothstep(0.35, 1.05, length(d));
      gl_FragColor = vec4(c, 1.0);
    }`,
};

// Tone mapping / sRGB, the grade, and FXAA on 'low'. Keeps FXAA's texel size with the canvas.
export function finishComposer(composer, renderer) {
  const q = POST[QUALITY.level] || POST.high;
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  let fxaa = null;
  if (q.fxaa) {
    fxaa = new ShaderPass(FXAAShader);
    composer.addPass(fxaa);
  }
  const fit = () => {
    const s = renderer.getDrawingBufferSize(new THREE.Vector2());
    grade.uniforms.aspect.value = s.x / Math.max(1, s.y);
    if (fxaa) fxaa.material.uniforms.resolution.value.set(1 / s.x, 1 / s.y);
  };
  const setSize = composer.setSize.bind(composer);
  composer.setSize = (w, h) => { setSize(w, h); fit(); };
  fit();
  return { grade, fxaa };
}
