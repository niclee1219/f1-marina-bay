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
  stands: { T1: 1.0, main: 0.95, padang: 1.0 }, // tags set in Track.buildGrandstands
  // seated grandstands along the pit straight, opposite the pits: centres (arc length from the line, m)
  mainStands: { at: [-150, -25, 100], len: 115 },
  teamShare: 0.32,                               // fraction wearing a team colour
  seated: 0.72,                                  // grandstand figures are seated: height share of a standing one
  walkways: [
    // corner number (or 'start') +- metres, which side ('out' | 'in'), density
    { at: 1, from: -140, to: 40, side: 'out', density: 0.9 },
    { at: 10, from: -260, to: 20, side: 'out', density: 0.85 },
    { at: 7, from: -60, to: 60, side: 'out', density: 0.6 },
    { at: 14, from: -40, to: 60, side: 'out', density: 0.5 },
  ],
  maxDrawDistance: 1400,
  // extra grandstand on the Padang side of St Andrew's Road (arc length along the track, metres)
  padangStand: { s: 2390, len: 130, toward: [-682, 78] },
};

// Night lift for surfaces that otherwise render near-black: flat roofs and off-circuit roads.
// `lift` is the emissive radiance added (0 = old look, ~0.1 = clearly readable); the track and cars
// are not affected, so they keep visual priority.
export const NIGHT = { lift: 0.035 };

// Race-night atmosphere: humid haze that the floodlights and the city glow light up.
// fog: colour / density of the scene fog; shafts: brightness of the light shafts under the track
// floodlights (0 = off).
export const HAZE = { fogColor: 0x131528, fogDensity: 0.00034, shafts: 0.05 };

// Cameras. onboard.shake scales the cockpit vibration (1 = strong shake; 0 = none);
// onboard.smoothing is how fast the cockpit view follows the car's heading / height (per second;
// lower = smoother); eye: driver's eye above the car origin (m); lean: head roll per g of
// cornering (rad); nod: how far the view dips under braking (m at 30 m ahead). free: the free camera's depth range (near grows with distance to the orbit target but
// never beyond `nearHeightShare` of the camera's height above ground, so close decks aren't clipped).
export const CAMERA = {
  onboard: { shake: 0.1, smoothing: 7, maxYawRate: 2.4, eye: 0.74, lean: 0.03, nod: 1.2 },
  free: { nearPerMetre: 0.004, nearHeightShare: 0.35, nearMin: 0.3, nearMax: 12, far: 20000 },
};

// Title wordmark shown in the HUD.
export const TITLE = { word: 'SINGAPORE', sub: 'GRAND PRIX' };

// The automatic Director (src/autodirector.js): shot lengths in real seconds per camera, the
// start dolly's length, the least time between whole-track aerials, and how far ahead (race
// seconds at 1x) it looks for an overtake to cut to.
export const DIRECTOR = {
  shot: { tv: [6, 10], chase: [6, 9], onboard: [6, 9], heli: [7, 10], wide: [7, 10] },
  startDolly: 6.5,
  wideEvery: 45,
  lookahead: 12,
};

// City traffic (src/traffic.js): roads at least minWidth wide, kept circuitGap metres clear of the
// circuit (closed for the race); one vehicle per `spacing` metres of road, at most `max`;
// `buses` is the share of buses.
export const TRAFFIC = { minWidth: 7, circuitGap: 22, minPath: 60, spacing: 38, max: 700, buses: 0.05 };

// Car size in the free / broadcast / helicopter cameras: real size within `dist` metres of the
// camera, then grown with distance (so a far car still shows) up to `max` times real size.
export const CAR_ZOOM = { dist: 300, max: 3 };

// Starting grid (src/data.js Race.buildGrid, src/track.js buildStart). OpenF1 car locations put
// every grid car on the centreline, so the columns come from the regulations, anchored on the
// recorded stop points: 8 m between successive positions (the 2025 race fits 7.9 m), odd
// positions on the pole side. Pole is on the left at Marina Bay: the inside of the left-hand
// Turn 1 and the pit-building side (the start photo in references/, shot from T1 back down the
// grid, has the leading car of every pair on the garage side). column: centre of each column from the track centre (m). startAhead: start
// line ahead of the pole car's centre. blend: distance (m) over which a car eases from its box
// into its telemetry position as it pulls away (and back in as it arrives).
export const GRID = { spacing: 8, column: 2.8, poleSide: 'left', boxFront: 3.0, startAhead: 9, blend: [1.5, 70], poleFallback: 84 };

// Pit lane layout across the fitted lane (src/pitlane.js), metres from the lane centre toward the
// garages. The fitted path is taken as the fast lane; the working lane and garage line beside it are
// standard dimensions, not measured (OpenF1 does not resolve them). wall: circuit wall offset
// (track.js WALL); clear: how far past the wall line the lane centre must be before the wall closes
// again (the entry / exit roads cross it before that); wallGap: lane edge to pit wall; boxRun:
// working lane before the first / after the last box; entryLine / exitLine: white line on the
// circuit before the entry and after the exit merge; bollards: per nose.
// boxShift: OpenF1 records stopped cars on the same line as moving ones (it cannot resolve the
// working lane), so during its own pit window a car eases sideways into its team's box, fully
// within boxShift[0] m of the box and not at all beyond boxShift[1] m. Sideways only: timing and
// the distance along the lane are the telemetry's. Set to null to play the raw positions.
// garageDepth / bayHeight: the garages behind the doors; boxLen: painted box length.
export const PIT_LANE = {
  wall: 10.2, clear: 2.6, wallGap: 0.3, fast: 2.6, garage: 8.1, boxRun: 25, ramp: 15, entryLine: 45, exitLine: 45, bollards: 6,
  boxShift: [6, 24], garageDepth: 12, bayHeight: 5.2, boxLen: 10,
};

// Pit building and paddock (src/pit.js), metres. depth: building depth behind the garage line;
// endRun: building beyond the first / last garage; mastEvery: roof floodlight masts; podium over the
// pit lane mid-building (podiumShift moves it along the lane); sign: the lettering on the sloped
// roof fascia and its length; depth / endRun: only used when the OSM footprint is missing; paddock: gap behind the building, width, central walkway, hospitality units; trackClear:
// no unit or truck closer than this to the circuit centreline.
export const PADDOCK = {
  depth: 30, endRun: 30, mastEvery: 24, podiumShift: 0, podiumWidth: 20, sign: 'SINGAPORE GRAND PRIX', signLength: 80,
  gap: 6, width: 72, walkway: 10, unitLength: 18, unitDepth: 14, unitHeight: 9.5, trackClear: 24,
};

// Run-off where the wall stands further back (track.js initRunoff): on the outside of the Turn 1-3
// complex (outside of T1 and T3 is the right of travel, +1), measured against the
// corner apexes; the area is painted in the Singapore blue and gold scheme (identity.js). Widths are
// read off the reference photos, not measured.
export const RUNOFF = {
  zones: [
    { from: 1, to: 3, before: -70, after: 25, side: 1, width: 24, taper: 35, paint: true, word: 'SINGAPORE' },
  ],
};

// Floodlight trusses lining the circuit (track.js buildLights): spacing, truss length along the
// track, height and reach over the barrier, lamp heads per truss.
export const TRUSS = { every: 32, length: 22, height: 11, reach: 5.2, heads: 7 };

// DRS boards (identity.js): activation where cars opened DRS; detection is not in OpenF1, so it is
// placed this many metres before the last corner ahead of each zone (a guess). side: +1 = right of
// travel, flipped where the pit lane is.
export const DRS_BOARDS = { side: 1, detectBefore: 60 };
