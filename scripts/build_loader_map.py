"""Bake the loading-screen map: a small SVG of Marina Bay drawn while the 3D scene loads.

Usage: python3 scripts/build_loader_map.py [--track data/2025-race/race.json]

Reads data/city.json (water, parks, roads, buildings) and the circuit centreline, and writes
data/map.svg in scene coordinates (x east, y = -north, metres), the same frame the 3D camera uses,
so src/boot.js can frame it and main.js can start the 3D camera straight above the same view and
crossfade into it. The root carries data-focus="x0 y0 x1 y1": the box that must stay on screen.
The circuit is <path id="ld-track">, drawn progressively as the data loads.
"""
import argparse
import json
import math
import os

HERE = os.path.dirname(__file__)
ap = argparse.ArgumentParser()
ap.add_argument("--city", default=os.path.join(HERE, "..", "data", "city.json"))
ap.add_argument("--track", default=os.path.join(HERE, "..", "data", "2025-race", "race.json"))
ap.add_argument("--out", default=os.path.join(HERE, "..", "data", "map.svg"))
ARGS = ap.parse_args()

PAD = 150            # metres around the circuit that stay visible
EXTENT = 2300        # half-size of the drawn area around the focus centre (fills wide screens)
BUILDING_R = 1700    # buildings beyond this distance from the focus centre are left out
MIN_AREA = 200       # m²; smaller footprints are sub-pixel at loader scale
SERVICE_R = 1200     # narrow (w=5) roads are kept within this distance only

# Labels at OSM local metres (x east, y north); see qa/qa.js SHOTS for the landmark positions.
LABELS = [
    ("MARINA BAY", -150, -330, "w"),
    ("MARINA BAY SANDS", 193, -790, ""),
    ("SINGAPORE FLYER", 447, 10, ""),
    ("ESPLANADE", -395, 45, ""),
    ("PADANG", -682, 150, ""),
]


def pts(flat):
    return [(flat[i], -flat[i + 1]) for i in range(0, len(flat) - 1, 2)]


def simplify(p, tol):
    """Douglas-Peucker on a list of (x, y)."""
    if len(p) < 3:
        return p
    a, b = p[0], p[-1]
    dx, dy = b[0] - a[0], b[1] - a[1]
    n = math.hypot(dx, dy) or 1e-9
    worst, wi = 0.0, 0
    for i in range(1, len(p) - 1):
        d = abs(dy * (p[i][0] - a[0]) - dx * (p[i][1] - a[1])) / n if n > 1e-6 else math.hypot(p[i][0] - a[0], p[i][1] - a[1])
        if d > worst:
            worst, wi = d, i
    if worst <= tol:
        return [a, b]
    return simplify(p[: wi + 1], tol)[:-1] + simplify(p[wi:], tol)


def path(p, close, tol=1.5):
    p = simplify(p, tol)
    if len(p) < 2:
        return ""
    out, px, py = [], round(p[0][0]), round(p[0][1])
    out.append(f"M{px} {py}")
    for x, y in p[1:]:
        x, y = round(x), round(y)
        if (x, y) == (px, py):
            continue
        out.append(f"l{x - px} {y - py}")
        px, py = x, y
    return "".join(out) + ("z" if close else "")


def area(p):
    return abs(sum(p[i][0] * p[i - 1][1] - p[i - 1][0] * p[i][1] for i in range(len(p)))) / 2


def near(p, c, r):
    return any(abs(x - c[0]) < r and abs(y - c[1]) < r for x, y in p)


def main():
    city = json.load(open(ARGS.city))
    track = json.load(open(ARGS.track))["track"]
    center = [(x, -y) for x, y in track["center"]]
    pit = [(x, -y) for x, y in track["pit"]]
    xs, ys = [p[0] for p in center], [p[1] for p in center]
    fx0, fx1, fy0, fy1 = min(xs) - PAD, max(xs) + PAD, min(ys) - PAD, max(ys) + PAD
    c = ((fx0 + fx1) / 2, (fy0 + fy1) / 2)
    vx, vy = c[0] - EXTENT, c[1] - EXTENT

    water = "".join(path(pts(w), True, 2) for w in city["water"] if near(pts(w), c, EXTENT * 1.2))
    parks = "".join(path(pts(w), True, 2) for w in city["parks"] if near(pts(w), c, EXTENT))
    roads = {}
    for r in city["roads"]:
        p = pts(r["p"])
        # narrow service roads only near the circuit; at loader scale they are sub-pixel further out
        if near(p, c, EXTENT if r["w"] > 5 else SERVICE_R):
            roads.setdefault(r["w"], []).append(path(p, False, 3))
    blds = "".join(path(pts(b["p"]), True, 2.5) for b in city["buildings"]
                   if area(pts(b["p"])) >= MIN_AREA and near(pts(b["p"]), c, BUILDING_R))

    road_svg = "".join(
        f'<path class="r" stroke-width="{w}" d="{"".join(ds)}"/>' for w, ds in sorted(roads.items())
    )
    labels = "".join(
        f'<text x="{round(x)}" y="{round(-y)}" class="{cls}">{t}</text>' for t, x, y, cls in LABELS
    )
    corners = []
    n = len(center)
    for k in track["corners"]:
        i = k["i"]
        a, b = center[(i - 2) % n], center[(i + 2) % n]
        tx, ty = b[0] - a[0], b[1] - a[1]
        tl = math.hypot(tx, ty) or 1
        # push the number out from the curve's inside: normal on the side away from the centroid
        nx, ny = -ty / tl, tx / tl
        p = center[i]
        if (p[0] + nx - c[0]) ** 2 + (p[1] + ny - c[1]) ** 2 < (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2:
            nx, ny = -nx, -ny
        corners.append(f'<text x="{round(p[0] + nx * 34)}" y="{round(p[1] + ny * 34)}">{k["n"]}</text>')

    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{round(vx)} {round(vy)} {EXTENT * 2} {EXTENT * 2}" '
        f'data-focus="{round(fx0)} {round(fy0)} {round(fx1)} {round(fy1)}" preserveAspectRatio="xMidYMid slice">'
        f'<rect class="land" x="{round(vx)}" y="{round(vy)}" width="{EXTENT * 2}" height="{EXTENT * 2}"/>'
        f'<path class="water" fill-rule="evenodd" d="{water}"/>'
        f'<path class="park" d="{parks}"/>'
        f'<g class="roads">{road_svg}</g>'
        f'<path class="bld" d="{blds}"/>'
        f'<path class="pit" d="{path(pit, False, 1)}"/>'
        f'<path class="trk-base" d="{path(center, True, 0.8)}"/>'
        f'<path id="ld-track" class="trk" pathLength="1" d="{path(center, True, 0.8)}"/>'
        f'<g class="corners">{"".join(corners)}</g>'
        f'<g class="labels">{labels}</g>'
        "</svg>\n"
    )
    with open(ARGS.out, "w") as f:
        f.write(svg)
    print("wrote", ARGS.out, len(svg), "bytes")


if __name__ == "__main__":
    main()
