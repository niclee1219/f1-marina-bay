// Detail level for the costly extras (pit crews, crowd density): ?quality=low | high in the URL,
// otherwise 'low' on devices that look low-powered (few cores, little memory, or a phone-sized
// touch screen) and 'high' everywhere else.
function detect() {
  const q = new URLSearchParams(location.search).get('quality');
  if (q === 'low' || q === 'high') return q;
  const cores = navigator.hardwareConcurrency || 8;
  const mem = navigator.deviceMemory || 8;
  const phone = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;
  return cores <= 4 || mem <= 4 || phone ? 'low' : 'high';
}

const level = detect();

export const QUALITY = {
  level,
  // pit crews that run out for each stop (pitcrew.js)
  crew: level === 'high',
  // share of the crowd figures that are drawn (crowd.js)
  crowd: level === 'high' ? 1 : 0.45,
};
