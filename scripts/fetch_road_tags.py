"""Rebuild data/city.json roads with their OpenStreetMap class, lanes and direction, plus the
traffic signals, from the cached OSM tiles (raw/common/osm, scripts/fetch_data.py).

Usage: python3 scripts/fetch_road_tags.py

Same ways, filters, widths and simplification as build_data.py build_city, so the geometry is
unchanged; each road gains
  k   class: motorway | trunk | primary | secondary | tertiary | link | residential | service
  l   lanes (OSM `lanes`, else a default per class)
  o   1 if one-way
and city.json gains
  signals   [x, y, ...] of OSM highway=traffic_signals nodes within the city radius
"""
import json
import math
import os
import sys
import xml.etree.ElementTree as ET
import glob

sys.path.insert(0, os.path.dirname(__file__))
from osm_util import OSM, project  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..")
OSM_DIR = os.path.join(ROOT, "raw", "common", "osm")
CITY = os.path.join(ROOT, "data", "city.json")
WIDTH = {"motorway": 16, "trunk": 14, "primary": 12, "secondary": 10, "tertiary": 8,
         "motorway_link": 8, "trunk_link": 8, "primary_link": 7}
LANES = {"motorway": 4, "trunk": 3, "primary": 3, "secondary": 2, "tertiary": 2, "link": 1, "residential": 2,
         "unclassified": 2, "service": 1}
KEEP = ("motorway", "trunk", "primary", "secondary", "tertiary", "motorway_link", "trunk_link", "primary_link",
        "residential", "unclassified", "service")


def simplify(pts, tol=1):
    if len(pts) < 4:
        return pts
    out = [pts[0]]
    for p in pts[1:-1]:
        if math.dist(p, out[-1]) > tol:
            out.append(p)
    out.append(pts[-1])
    return out


def main():
    city = json.load(open(CITY))
    cx, cy = city["centre"]
    radius = city["radius"]
    osm = OSM(OSM_DIR)

    def near(pts):
        mx = sum(p[0] for p in pts) / len(pts)
        my = sum(p[1] for p in pts) / len(pts)
        return math.hypot(mx - cx, my - cy) < radius

    roads = []
    for wid, (refs, t) in osm.ways.items():
        hw = t.get("highway")
        if hw not in KEEP or "building" in t:
            continue
        closed = refs[0] == refs[-1]   # build_city files closed water / park ways before roads
        if closed and (t.get("natural") == "water" or t.get("waterway") in ("riverbank", "dock") or "building:part" in t
                       or t.get("leisure") in ("park", "garden", "pitch") or t.get("landuse") in ("grass", "meadow", "recreation_ground")
                       or t.get("natural") in ("wood", "scrub", "grassland")):
            continue
        pts = [osm.nodes[r] for r in refs if r in osm.nodes]
        if len(pts) < 2 or t.get("tunnel") == "yes" or t.get("layer", "0").startswith("-") or not near(pts):
            continue
        k = "link" if hw.endswith("_link") else ("residential" if hw == "unclassified" else hw)
        try:
            lanes = int(t.get("lanes", "").split(";")[0])
        except ValueError:
            lanes = LANES.get(k, 2)
        r = {"w": WIDTH.get(hw, 5), "p": [round(v, 1) for p in simplify(pts) for v in p], "k": k, "l": max(1, min(lanes, 6))}
        if t.get("oneway") in ("yes", "1", "true") or hw in ("motorway", "motorway_link") or t.get("junction") == "roundabout":
            r["o"] = 1
        roads.append(r)

    old = city["roads"]
    same = len(old) == len(roads) and all(a["p"] == b["p"] and a["w"] == b["w"] for a, b in zip(old, roads))
    print(f"roads: {len(roads)} (was {len(old)}), geometry {'unchanged' if same else 'CHANGED'}")

    signals = []
    for f in sorted(glob.glob(f"{OSM_DIR}/t_*.xml")):
        for e in ET.parse(f).getroot().iter("node"):
            if any(tg.get("k") == "highway" and tg.get("v") == "traffic_signals" for tg in e.findall("tag")):
                x, y = project(float(e.get("lon")), float(e.get("lat")))
                if math.hypot(x - cx, y - cy) < radius:
                    signals += [round(x, 1), round(y, 1)]
    # tiles overlap at their edges: drop duplicates
    seen, uniq = set(), []
    for i in range(0, len(signals), 2):
        key = (signals[i], signals[i + 1])
        if key not in seen:
            seen.add(key)
            uniq += list(key)
    print("signals:", len(uniq) // 2)
    city["roads"] = roads
    city["signals"] = uniq
    json.dump(city, open(CITY, "w"), separators=(",", ":"))


if __name__ == "__main__":
    main()
