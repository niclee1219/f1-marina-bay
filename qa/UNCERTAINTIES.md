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
