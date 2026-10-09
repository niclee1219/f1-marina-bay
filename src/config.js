// Visual configuration: colours, sponsor boards, landmarks, bridge zones and crowd density.
// Positions are OSM metres (x east, y north) in the same frame as data/city.json; the scene
// maps them to (X, Z) = (x, -y).

export const COLORS = {
  night: 0x0c1020,               // horizon haze (matches the scene fog)
  lampWarm: [2.4, 1.55, 0.75],   // HDR sodium lamps on the bridges (bloom picks these up)
  heritageWhite: 0xe9e4d8,       // floodlit colonial buildings around the Padang
  copperDome: 0x5f9c86,          // Old Supreme Court dome
  terracotta: 0x8a3b2a,          // Singapore Cricket Club roof
};

// Trackside sponsor wordmarks. Drawn procedurally as text + simple vector marks (no logo files).
// font: 'sans' (Titillium Web), 'serif' (Cinzel), or any CSS font family string.
// mark: optional vector mark drawn next to / behind the word (see sponsors.js).
export const SPONSORS = [
  { name: 'Singapore Airlines', text: 'SINGAPORE AIRLINES', bg: '#0b2a5b', fg: '#f6b221', font: 'serif', weight: 700, mark: 'sia-bird', title: true },
  { name: 'Rolex', text: 'ROLEX', bg: '#006039', fg: '#c8a24b', font: 'serif', weight: 700, mark: 'crown', tracking: 0.12 },
  { name: 'Aramco', text: 'aramco', bg: '#ffffff', fg: '#00a3e0', font: 'sans', weight: 700, mark: 'aramco-star' },
  { name: 'Heineken', text: 'Heineken', bg: '#1f6b35', fg: '#ffffff', font: 'sans', weight: 900, italic: false, mark: 'red-star' },
  { name: 'Pirelli', text: 'PIRELLI', bg: '#ffd500', fg: '#111111', font: 'sans', weight: 900, mark: 'long-p' },
  { name: 'Emirates', text: 'Emirates', bg: '#d71921', fg: '#ffffff', font: 'serif', weight: 700, italic: true },
  { name: 'DHL', text: 'DHL', bg: '#ffcc00', fg: '#d40511', font: 'sans', weight: 900, italic: true, mark: 'speed-lines' },
  { name: 'AWS', text: 'aws', bg: '#232f3e', fg: '#ffffff', font: 'sans', weight: 700, mark: 'smile' },
  { name: 'Qatar Airways', text: 'QATAR AIRWAYS', bg: '#5c0632', fg: '#ffffff', font: 'sans', weight: 700, tracking: 0.08 },
  { name: 'MSC', text: 'MSC', bg: '#0a1c3a', fg: '#c9a45c', font: 'serif', weight: 700, mark: 'ellipse', tracking: 0.1 },
  { name: 'Lenovo', text: 'Lenovo', bg: '#e2231a', fg: '#ffffff', font: 'sans', weight: 600 },
  { name: 'Salesforce', text: 'salesforce', bg: '#ffffff', fg: '#ffffff', font: 'sans', weight: 700, mark: 'cloud', cloud: '#00a1e0' },
  { name: 'Louis Vuitton', text: 'LOUIS VUITTON', bg: '#3b2a20', fg: '#e9dcc3', font: 'sans', weight: 400, tracking: 0.22, mark: 'lv' },
];

// Team liveries (primary from the session data unless overridden; secondary / accent here). Unknown teams fall back to
// a darkened primary with white accents.
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

// Hand-built landmarks. `replaces` lists OSM building names whose plain extrusions are hidden
// because the landmark is modelled here instead.
export const LANDMARKS = {
  mbs: { replaces: [/^Marina Bay Sands Tower/, /^SkyPark$/] },     // positions come from the OSM tower footprints
  artScience: { x: 8, y: -452, h: 60, petals: 10 },
  padang: {
    cityHall: { match: 'Old City Hall', h: 27 },
    oldSupremeCourt: { match: 'Old Supreme Court', h: 24, dome: 46 },
    newSupremeCourt: { match: 'Supreme Court of Singapore', h: 64 },
    cricketClub: { match: 'Singapore Cricket Club', h: 14 },
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
  extraHidden: [/^UOB Plaza$/],
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

// Backlit lettering standing on the pit building roof (pit.js). Sized to read from the default
// overview camera: letters are spread along the whole roof and face the side that camera sees.
export const PIT_SIGN = {
  word: 'SINGAPORE',
  height: 19,          // letter cap height (m)
  lift: 3.5,           // gap between the roof slab and the bottom of the letters (truss)
  fill: 0.88,          // fraction of the roof length the word spans
  face: [1.12, 1.1, 1.05],  // letter face (just over 1 so bloom adds a soft edge without smearing)
  halo: [1.0, 0.06, 0.08],   // backlight glow behind the letters (F1 red)
};

// Title wordmark shown in the HUD.
export const TITLE = { word: 'SINGAPORE', sub: 'GRAND PRIX' };
