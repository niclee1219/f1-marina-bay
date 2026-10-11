# Shape and colour details I was unsure about

Everything below is a judgement call made from the Commons reference photos in `reference/` or from
OSM data that lacks the detail. Each is a single value in `src/config.js` or `src/skyline.js`.

## Bridges and viaducts
- ECP / Benjamin Sheares deck heights: OSM has none. Derived: ~11 m over land, +7 m per extra OSM
  layer, up to 30 m over water (navigation clearance ~26-29 m), 4.5 % ramps, at least 6.5 m clear
  over the track. The real profile near T17 may differ by several metres.
- Pier spacing (32 m) and hammerhead shape are generic; real ECP piers vary.
- The elevated walkways beside the ECP (OSM footways, layer 1-2) are drawn as roofed footbridges at
  ~8.7 m; I could not confirm their real height or whether they hang off the viaduct.
- Helix, Jubilee and Cavenagh bridges: no reference photos fetched; deck heights (4.5 / 3-4.6 /
  2.6 m), the Helix tube radii and pitch, and Cavenagh's tower and chain shape are approximate.

## Marina Bay Sands
- Leg thickness (17 m) and the curve of the east leg (meets the west leg near the top, leaving a
  narrow slot) are fitted by eye.
- SkyPark underside colour: it changes nightly (red, blue, white in the photos); I used a soft cool
  white. Infinity pool position (north half, city edge) and the hull depth (~12 m) are estimates.

## ArtScience Museum
- Finger heights, splay and widths, the bowl height (13 m) and the number of raking columns (9).

## Singapore Flyer
- Leg splay and foot positions of the A-frame; terminal height (13 m) and roof overhang.

## Esplanade
- Shell heights: Theatre 45 m, Concert Hall 37 m (OSM says 35 m for both). The Theatre being the
  larger is from the footprints; exact heights are a guess.
- Diamond size (~3.3 m), spring height of the shells (7 m) and the number of V-struts.

## UOB Plaza
- Tier heights and chamfers of the crowns; UOB Plaza Two's 162 m vs One's 280 m are from config.
  Which OSM footprint is "Tower 1" vs "Tower 2" was taken as tagged.
- Granite colour and the floodlit band (top quarter).

## Civic district
- Supreme Court disc diameter (66 % of the building width) and the glass drum on top.
- National Gallery roof "veil" between the Old Supreme Court and City Hall: size, height and colour.
- St Andrew's Cathedral: spire height (~63 m), which end the spire is on (south-west, from the aerial
  photo), transept position, and the slate-grey roof colour.
- Singapore Recreation Club: roof drawn as three gabled masses (the real roof is hipped).
- The Fullerton Hotel: column count, rooftop lantern size and the cream tone.
- Padang cricket square position and boundary-rope radius.

## City-wide
- Shophouse pastel palette: OSM rarely tags wall colours, so heritage shophouses cycle through six
  muted pastels; roofs use OSM `roof:colour` where tagged, otherwise terracotta.
- Helipads: OSM has none in this area, so none are drawn. Water tanks are added on residential
  blocks over 20 m (typical of Singapore flats, but not from data).
- The 25 tallest towers get four red corner lights; the real set of lit towers will differ.
- "Filler" range: untagged blocks over 1150 m from the circuit centre are drawn plainly.

## Sponsor boards
- Singapore Airlines, Rolex, Qatar Airways, MSC, Lenovo, Emirates and Louis Vuitton use their
  official logo files recoloured to a single reverse colour for contrast on the board colour.
- Board background colours are my reading of each brand's usual colours.
- Aramco: Commons only has the pre-2018 "Saudi Aramco" logo, so the board keeps the text wordmark.
- The Rolex file is the wordmark only (no crown).

## Cars
- No livery reference images were supplied, so all teams run in clean team colours and no decals
  are drawn. Decal slot positions in `LIVERY_DECALS` were placed on the generic body and will need
  adjusting per team when references are added.

## Grid, pit lane and pit building (qa/grid-pit/)
Measured from the data: grid spacing (7.9 m fit, 8 m used), where the pole car stopped, the pit
lane path (328 stops averaged), where it peels off and rejoins, the 80 km/h limiter stretch, each
team's box position and the pit order (both seasons match the previous year's championship),
stop times, marshal light and sector positions (MultiViewer, 2 m corner-fit RMS).
Guessed:
- Pole side: left (inside of Turn 1, pit side), read off the start photo shot from T1 back down the
  grid. OpenF1 puts every grid car on the centreline, so the data cannot confirm it.
- Grid column offset (2.8 m either side), box shape, and the start line 9 m ahead of the pole car.
  The control line (s = 0, where OpenF1 laps start) is drawn as the chequered finish / timing line;
  pole stops ~84 m after it, so the start line is a separate line.
- Fast lane / working lane split and garage depth: OpenF1 records stopped cars on the same line as
  moving ones, so the fitted path is used as the fast lane and the working lane (5.5 m) and garage
  line are standard dimensions. Cars ease sideways into their box during their own stop
  (PIT_LANE.boxShift) for the same reason.
- Bollard count and spacing, pit exit light position (6 m after the limiter line), entry / exit
  line lengths on the circuit (45 m).
- Garage frontage is spaced evenly (a fit of the measured boxes); real bay widths may differ.
- Pit building: storey heights, balcony depth, podium position (mid-building) and size, race
  control at the pit exit end, the paddock layout (two rows of hospitality units and the trucks).
- Pit crew: 16 figures at standard positions; their run-out and walk-back times are invented,
  the time at the car is OpenF1's stop_duration.

## Singapore identity
- Turn 1-3 run-off width (24 m), extent and stripe widths are read off the reference photos; the
  stripe order (white, gold, thin orange on deep blue) follows them loosely.
- Floodlight truss length (14 m), height and four heads per truss.
- Corner boards: placed 35 m before each apex on the outside wall; colours chosen to match.
- DRS detection points are not in OpenF1: each board is 60 m before the last corner ahead of
  its zone. Activation boards are at the start of each measured zone.
- Marshal posts: MultiViewer's light positions are on the track line (1-2 m off), so which side
  of the track each post stands on is a guess (and moved off the pit lane where needed).
  Panels light only for what race control reports (yellow / double yellow per sector, green for
  8 s after a clear, red, SC / VSC, chequered); blue flags are per car and are not shown.
