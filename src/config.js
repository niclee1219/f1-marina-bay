// Visual configuration: colours, sponsor boards, landmarks, bridge zones and crowd density.
// Positions are OSM metres (x east, y north) in the same frame as data/city.json; the scene
// maps them to (X, Z) = (x, -y).

export const COLORS = {
  night: 0x131528,               // horizon haze (matches the scene fog)
  lampWarm: [2.4, 1.55, 0.75],   // HDR sodium lamps on the bridges (bloom picks these up)
  heritageWhite: 0xe9e4d8,       // floodlit colonial buildings around the Padang
  copperDome: 0x5f9c86,          // Old Supreme Court dome
  terracotta: 0x8a3b2a,          // Singapore Cricket Club roof, shophouse clay tiles
  fullertonCream: 0xd9c9a4,      // The Fullerton Hotel's granite / cream render
};

// Trackside sponsor boards. `logo` names assets/logos/<logo>.svg (fetched from Wikimedia Commons by
// scripts/fetch_logos.py, sources in assets/logos/SOURCES.md); bg is the board colour. The text /
// font / mark fields are the fallback wordmark if the logo file is missing.
// logoTint: recolour a one-colour logo for contrast (the brand's reverse version), logoFill /
// logoHeight: share of the board the logo may fill.
export const SPONSORS = [
  { name: 'Singapore Airlines', logo: 'singapore-airlines', text: 'SINGAPORE AIRLINES', bg: '#0b2a5b', fg: '#f6b221', font: 'serif', weight: 700, mark: 'sia-bird', title: true, logoTint: '#f6b221', logoFill: 0.9 },
  { name: 'Rolex', logo: 'rolex', text: 'ROLEX', bg: '#006039', fg: '#c8a24b', font: 'serif', weight: 700, mark: 'crown', tracking: 0.12, logoTint: '#c8a24b', logoFill: 0.6 },
  // Aramco: Commons only has the pre-2018 'Saudi Aramco' logo, so the board keeps the wordmark
  { name: 'Aramco', text: 'aramco', bg: '#ffffff', fg: '#00a3e0', font: 'sans', weight: 700, mark: 'aramco-star' },
  { name: 'Heineken', logo: 'heineken', text: 'Heineken', bg: '#ffffff', fg: '#1f6b35', font: 'sans', weight: 900, italic: false, mark: 'red-star', logoFill: 0.72 },
  { name: 'Pirelli', logo: 'pirelli', text: 'PIRELLI', bg: '#ffd500', fg: '#111111', font: 'sans', weight: 900, mark: 'long-p', logoFill: 0.78 },
  { name: 'Emirates', logo: 'emirates', text: 'Emirates', bg: '#d71921', fg: '#ffffff', font: 'serif', weight: 700, italic: true, logoTint: '#ffffff', logoHeight: 0.8 },
  { name: 'DHL', logo: 'dhl', text: 'DHL', bg: '#ffcc00', fg: '#d40511', font: 'sans', weight: 900, italic: true, mark: 'speed-lines', logoHeight: 0.7 },
  { name: 'AWS', logo: 'aws', text: 'aws', bg: '#ffffff', fg: '#232f3e', font: 'sans', weight: 700, mark: 'smile', logoHeight: 0.72 },
  { name: 'Qatar Airways', logo: 'qatar-airways', text: 'QATAR AIRWAYS', bg: '#5c0632', fg: '#ffffff', font: 'sans', weight: 700, tracking: 0.08, logoTint: '#ffffff', logoFill: 0.7 },
  { name: 'MSC', logo: 'msc', text: 'MSC', bg: '#0a1c3a', fg: '#c9a45c', font: 'serif', weight: 700, mark: 'ellipse', tracking: 0.1, logoTint: '#c9a45c', logoHeight: 0.78 },
  { name: 'Lenovo', logo: 'lenovo', text: 'Lenovo', bg: '#e2231a', fg: '#ffffff', font: 'sans', weight: 600, logoTint: '#ffffff', logoFill: 0.62 },
  { name: 'Salesforce', logo: 'salesforce', text: 'salesforce', bg: '#ffffff', fg: '#ffffff', font: 'sans', weight: 700, mark: 'cloud', cloud: '#00a1e0', logoHeight: 0.82 },
  { name: 'Louis Vuitton', logo: 'louis-vuitton', text: 'LOUIS VUITTON', bg: '#3b2a20', fg: '#e9dcc3', font: 'sans', weight: 400, tracking: 0.22, mark: 'lv', logoTint: '#e9dcc3', logoFill: 0.86 },
];

// Team liveries (primary from the session data unless overridden; secondary / accent here). Unknown teams fall back to
// a darkened primary with white accents.
//
// Sponsor decals: a team gets logo decals only when `reference` lists livery reference images it
// was checked against AND `decals` maps slots to logo files (assets/logos/<file>.svg), e.g.
//   'Example Team': { ..., reference: ['reference/liveries/example-2026-side.jpg'],
//                     decals: { sidepod: 'aws', engineCover: 'rolex', rearWingEndplate: 'dhl', frontWingEndplate: 'pirelli' } }
// No reference livery images have been supplied yet, so every team runs in clean team colours
// (a clean car is better than a wrong one).
export const LIVERIES = {
  'Red Bull Racing': { secondary: '#1b2a4a', accent: '#e8002d' },
  'Ferrari': { secondary: '#ed1131', accent: '#ffffff' },
  'Mercedes': { primary: '#1d1e22', secondary: '#0e0f11', accent: '#00d7b6' },
  'McLaren': { secondary: '#16171a', accent: '#f47600' },
  'Aston Martin': { secondary: '#0b3d2c', accent: '#cedc00' },
  'Alpine': { secondary: '#0a1d3d', accent: '#ff87bc' },
  'Williams': { secondary: '#041e42', accent: '#00a3e0' },
  'Racing Bulls': { secondary: '#f2f2f2', accent: '#1534cc' },
  'Kick Sauber': { secondary: '#111111', accent: '#01c00e' },
  'Audi': { secondary: '#1a1a1a', accent: '#f50537' },
  'Haas F1 Team': { primary: '#f2f2f2', secondary: '#16171a', accent: '#e8002d' },
  'Cadillac': { secondary: '#111111', accent: '#ffffff' },
};

// Where decals sit on the car (car-local metres: +z forward, +x left, +y up; both sides mirrored)
// and how big the car must be on screen before they are drawn.
export const LIVERY_DECALS = {
  minPixels: 110,   // projected car length in pixels; below this, decals are hidden (unreadable)
  slots: {
    sidepod: { x: 0.83, y: 0.47, z: 0.1, w: 0.52, h: 0.17 },
    engineCover: { x: 0.215, y: 0.6, z: -1.3, w: 0.42, h: 0.12 },
    rearWingEndplate: { x: 0.53, y: 0.8, z: -2.42, w: 0.5, h: 0.18 },
    frontWingEndplate: { x: 0.975, y: 0.19, z: 2.55, w: 0.5, h: 0.15 },
  },
};

// Hand-built landmarks. `replaces` lists OSM building names whose plain extrusions are hidden
// because the landmark is modelled here instead.
export const LANDMARKS = {
  mbs: { replaces: [/^Marina Bay Sands Tower/, /^SkyPark$/] },     // positions come from the OSM tower footprints
  artScience: { x: 8, y: -452, h: 60, petals: 10 },
  flyer: { terminal: 'Singapore Flyer' },      // OSM terminal footprint, rebuilt under the wheel
  // the two Esplanade shells differ in size: the Theatre is the larger one (heights in metres);
  // `spring` is where the shell lifts off its glazed base
  esplanade: { heights: { 'Esplanade Theatre': 45, 'Esplanade Concert Hall': 37 }, spring: 7 },
  padang: {
    cityHall: { match: 'Old City Hall', h: 27 },
    oldSupremeCourt: { match: 'Old Supreme Court', h: 24, dome: 46 },
    newSupremeCourt: { match: 'Supreme Court of Singapore', h: 64 },
    cricketClub: { match: 'Singapore Cricket Club', h: 14 },
    recreationClub: { match: 'Singapore Recreation Club' },
    standrews: { match: "Saint Andrew's Cathedral" },
    fullerton: { match: 'The Fullerton Hotel', h: 25 },
  },
  cbd: [
    { key: 'uob1', match: 'UOB Plaza Tower 1', h: 280, style: 'uob' },
    { key: 'uob2', match: 'UOB Plaza Tower 2', h: 162, style: 'uob' },
    { key: 'ocbc', match: 'OCBC Bank', h: 198, style: 'ocbc' },
    { key: 'orqN', match: 'One Raffles Quay North Tower', h: 245, style: 'crown' },
    { key: 'orqS', match: 'One Raffles Quay South Tower', h: 140, style: 'crown' },
  ],
  // the F1 pit building footprint is replaced by the pit complex in pit.js
  pit: { replaces: [/^F1 Pit Building$/] },
  // hidden extrusions that sit under the hand-built Padang / CBD models
  extraHidden: [/^UOB Plaza$/, /^Singapore Flyer$/],
};

// Bridges the circuit crosses. `from` / `to` are OSM end points of the bridge deck; the zone along
// the track (arc length range) is found by projecting them onto the centreline at load time.
export const BRIDGES = [
  // 1910 steel through-arch: lattice ribs rise beside the roadway, stone portals at both ends
  { key: 'anderson', name: 'Anderson Bridge', from: [-698, -272], to: [-633, -324], style: 'arch', shade: 0.55, margin: 6 },
  // 1997 concrete deck on shallow arches; the circuit uses the western carriageway
  { key: 'esplanade', name: 'Esplanade Bridge', from: [-583, -366], to: [-525, -80], style: 'deck', shade: 0.8, margin: 4, extraWidth: 16 },
];

// Spectator density per stand (0..1) and walkway crowds along the barriers.
export const CROWD = {
  baseDensity: 0.55,
  stands: { T1: 1.0, pit: 0.95, padang: 1.0 },  // tags set in Track.buildGrandstands
  teamShare: 0.32,                               // fraction wearing a team colour
  walkways: [
    // corner number (or 'start') +- metres, which side ('out' | 'in'), density
    { at: 1, from: -140, to: 40, side: 'out', density: 0.9 },
    { at: 'start', from: -160, to: 120, side: 'in', density: 0.8 },
    { at: 10, from: -260, to: 20, side: 'out', density: 0.85 },
    { at: 7, from: -60, to: 60, side: 'out', density: 0.6 },
    { at: 14, from: -40, to: 60, side: 'out', density: 0.5 },
  ],
  maxDrawDistance: 1400,
  // extra grandstand on the Padang side of St Andrew's Road (arc length along the track, metres)
  padangStand: { s: 2390, len: 130, toward: [-682, 78] },
};

// SINGAPORE lettering lying on the pit building roof (pit.js), one raised letter per roof bay,
// baselines along the building so the word reads from across the track like the overhead TV shot
// (references/). fill: share of the roof length the word spans; letter: cap height as a share of
// the roof depth; raise: letter thickness (m) drawn as `slices` red layers; face / side: HDR colours.
export const PIT_SIGN = {
  word: 'SINGAPORE',
  fill: 0.94,
  letter: 0.7,
  raise: 1.2,
  slices: 6,
  face: [0.84, 0.83, 0.78],  // warm white, under the bloom threshold (0.9), so the letters stay crisp
  side: [0.62, 0.05, 0.06],  // red letter sides
};

// Night lift for surfaces that otherwise render near-black: flat roofs and off-circuit roads.
// `lift` is the emissive radiance added (0 = old look, ~0.1 = clearly readable); the track and cars
// are not affected, so they keep visual priority.
export const NIGHT = { lift: 0.035 };

// Race-night atmosphere: humid haze that the floodlights and the city glow light up.
// fog: colour / density of the scene fog; shafts: brightness of the light shafts under the track
// floodlights (0 = off).
export const HAZE = { fogColor: 0x131528, fogDensity: 0.00034, shafts: 0.05 };

// Cameras. onboard.shake scales the T-cam vibration (1 = the old, strong shake; 0 = none);
// onboard.smoothing is how fast the T-cam follows the car's heading / height (per second; lower =
// smoother). free: the free camera's depth range (near grows with distance to the orbit target but
// never beyond `nearHeightShare` of the camera's height above ground, so close decks aren't clipped).
export const CAMERA = {
  onboard: { shake: 0.1, smoothing: 7, maxYawRate: 2.4 },
  free: { nearPerMetre: 0.004, nearHeightShare: 0.35, nearMin: 0.3, nearMax: 12, far: 20000 },
};

// Title wordmark shown in the HUD.
export const TITLE = { word: 'SINGAPORE', sub: 'GRAND PRIX' };
