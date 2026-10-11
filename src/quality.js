// Detail level for the costly extras (pit crews, crowd density, post-processing, reflections,
// resolution): ?quality=low | high in the URL, otherwise 'low' on devices that look low-powered
// (few cores, little memory, a phone-sized touch screen, or an integrated / mobile GPU, which is
// what most mid-range laptops have) and 'high' everywhere else.
function detect() {
  const q = new URLSearchParams(location.search).get('quality');
  if (q === 'low' || q === 'high') return q;
  const cores = navigator.hardwareConcurrency || 8;
  const mem = navigator.deviceMemory || 8;
  const phone = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;
  return cores <= 4 || mem <= 4 || phone || integratedGpu() ? 'low' : 'high';
}

// Intel UHD / Iris, AMD APU "Radeon Graphics", base Apple M-series (not Pro / Max / Ultra), and
// phone / tablet GPUs. Unknown renderers count as discrete.
function integratedGpu() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /Intel|Iris|UHD Graphics|Radeon(\(TM\))? Graphics|Radeon Vega|Mali|Adreno|PowerVR|Apple M\d(?! (Pro|Max|Ultra))\b|Apple GPU/i.test(name);
  } catch {
    return false;
  }
}

const level = detect();

export const QUALITY = {
  level,
  // pit crews that run out for each stop (pitcrew.js): cheap instanced figures, on at every level
  crew: true,
  // share of the crowd figures that are drawn (crowd.js)
  crowd: level === 'high' ? 1 : 0.45,
  // planar water reflections on at start (the toolbar's Reflections button still switches them):
  // they redraw the whole scene, the costliest single item (main.js)
  reflections: level === 'high',
  // water reflection texture size, as a share of the canvas (world.js buildWater)
  reflect: level === 'high' ? 1 : 0.5,
  // bloom buffer size, as a share of the canvas (post.js); MSAA vs FXAA is set in post.js POST
  bloom: level === 'high' ? 1 : 0.5,
  // device pixel ratio cap (main.js)
  maxDpr: level === 'high' ? 1.75 : 1,
};
