"""Annotate data/city.json buildings with OpenStreetMap use / heritage / roof tags.

Usage: python3 scripts/fetch_building_tags.py [--cache overpass.json]

city.json already holds the real OSM footprints and heights (scripts/build_data.py --city). This adds,
per building, the fields the renderer uses to pick materials:
  k   kind: hotel | office | residential | retail | civic | religious | heritage | other
  hr  1 for heritage / pre-war buildings (colonial whites, terracotta or tile roofs)
  rc  roof colour, bc wall colour (hex, only where OSM has them)
  rs  roof shape (hipped, gabled, dome, ...) where tagged
  hp  1 if an OSM helipad lies on the roof
Buildings are matched by centroid (and name when both have one).
"""
import argparse
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from osm_util import project  # noqa: E402
from overpass import BBOX, query  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..")
NAMED = {"#ffffff": "#ffffff", "white": "#eeeae0", "red": "#9a3b2c", "brown": "#6b4a36", "grey": "#8a8d91", "gray": "#8a8d91",
         "black": "#202124", "blue": "#3d5a80", "green": "#4f6b4a", "orange": "#c06a35", "yellow": "#d9c27a", "beige": "#d8c9a8",
         "terracotta": "#a5482f", "silver": "#b8bcc2", "cream": "#e9dfc4"}
PREWAR = 1945


def colour(v):
    if not v:
        return None
    v = v.strip().lower()
    if v.startswith("#") and len(v) in (4, 7):
        return v if len(v) == 7 else "#" + "".join(c * 2 for c in v[1:])
    return NAMED.get(v)


def year(v):
    try:
        return int(str(v)[:4])
    except (TypeError, ValueError):
        return None


def kind_of(t):
    b = t.get("building", "")
    if t.get("tourism") in ("hotel", "hostel", "motel") or b == "hotel":
        return "hotel"
    if b in ("cathedral", "church", "chapel", "temple", "mosque", "shrine") or t.get("amenity") == "place_of_worship":
        return "religious"
    if b in ("office", "commercial") or t.get("office"):
        return "office"
    if b in ("apartments", "residential", "house", "dormitory", "terrace"):
        return "residential"
    if b in ("retail", "mall", "supermarket", "kiosk") or t.get("shop"):
        return "retail"
    if b in ("civic", "government", "public", "museum", "train_station", "transportation", "school", "university",
             "college", "hospital", "stadium", "grandstand") or t.get("amenity") in ("theatre", "arts_centre", "townhall",
                                                                                    "courthouse", "library", "college"):
        return "civic"
    return "other"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", help="reuse a saved Overpass response")
    args = ap.parse_args()
    s, w, n, e = BBOX
    if args.cache:
        osm = json.load(open(args.cache))
    else:
        osm = query(f'[out:json][timeout:180];(way["building"]({s},{w},{n},{e});relation["building"]({s},{w},{n},{e});'
                    f'node["aeroway"="helipad"]({s},{w},{n},{e}););out tags center;')
    tagged, helipads = [], []
    for el in osm["elements"]:
        t = el.get("tags", {})
        if el["type"] == "node":
            helipads.append(project(el["lon"], el["lat"]))
            continue
        if "center" not in el:
            continue
        x, y = project(el["center"]["lon"], el["center"]["lat"])
        tagged.append((x, y, t))
    # spatial hash
    cell = 40
    grid = {}
    for k, (x, y, _) in enumerate(tagged):
        grid.setdefault((int(x // cell), int(y // cell)), []).append(k)

    path = os.path.join(ROOT, "data", "city.json")
    city = json.load(open(path))
    stats = {}
    for b in city["buildings"]:
        p = b["p"]
        cx = sum(p[0::2]) / (len(p) / 2)
        cy = sum(p[1::2]) / (len(p) / 2)
        best, bd = None, 12.0
        for i in range(-1, 2):
            for j in range(-1, 2):
                for k in grid.get((int(cx // cell) + i, int(cy // cell) + j), []):
                    x, y, t = tagged[k]
                    d = math.hypot(x - cx, y - cy)
                    if b.get("n") and t.get("name") == b["n"]:
                        d *= 0.2
                    if d < bd:
                        best, bd = t, d
        for key in ("k", "hr", "rc", "bc", "rs", "hp"):
            b.pop(key, None)
        if best is not None:
            k = kind_of(best)
            built = year(best.get("start_date"))
            heritage = bool(best.get("heritage") or best.get("historic") or (built and built < PREWAR)
                            or best.get("building:architecture") in ("neoclassical", "colonial", "gothic_revival", "palladian"))
            if k != "other":
                b["k"] = k
            if heritage:
                b["hr"] = 1
            rc, bc = colour(best.get("roof:colour")), colour(best.get("building:colour"))
            if rc:
                b["rc"] = rc
            if bc:
                b["bc"] = bc
            if best.get("roof:shape") and best["roof:shape"] != "flat":
                b["rs"] = best["roof:shape"]
            stats[k] = stats.get(k, 0) + 1
            stats["heritage"] = stats.get("heritage", 0) + heritage
        else:
            stats["unmatched"] = stats.get("unmatched", 0) + 1
    # helipads: mark the building whose footprint contains the pad
    for hx, hy in helipads:
        for b in city["buildings"]:
            p = b["p"]
            inside = False
            for i in range(0, len(p), 2):
                j = (i - 2) % len(p)
                if (p[i + 1] > hy) != (p[j + 1] > hy) and hx < (p[j] - p[i]) * (hy - p[i + 1]) / (p[j + 1] - p[i + 1]) + p[i]:
                    inside = not inside
            if inside:
                b["hp"] = 1
                stats["helipads"] = stats.get("helipads", 0) + 1
                break
    json.dump(city, open(path, "w"), separators=(",", ":"))
    print("buildings", len(city["buildings"]), stats)


if __name__ == "__main__":
    main()
