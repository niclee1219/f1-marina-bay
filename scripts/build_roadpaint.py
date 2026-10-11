"""Road paint for the circuit surface, from the real streets under it (OpenStreetMap).

The Marina Bay circuit is public roads, so its surface should carry what those roads carry: the lane
count and one-way / two-way markings, bus lanes, pedestrian crossings and the stop lines at traffic
signals. For each centreline sample of the track (race.json track.center, 4 m apart) this finds the
street under it and writes data/roadpaint.json:

  lanes   lanes in the direction of travel's carriageway (OSM `lanes`, else a default per class)
  one     1 if the street is one-way (lane dividers all dashed), 0 if two-way (double centre line)
  bus     0 none, -1 bus lane on the left kerb, +1 on the right kerb, in the race's direction of travel
  zebra   [s, ...] arc length of pedestrian crossings (highway=crossing nodes on the circuit)
  stop    [s, ...] stop lines, a few metres before each traffic signal, in the race direction
  text    [s, ...] where BUS LANE is stencilled on the road

Usage: python3 scripts/build_roadpaint.py [osm folder] [race.json]
(the OSM tiles are the cache scripts/fetch_data.py writes to raw/common/osm)
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from osm_util import OSM, project  # noqa: E402,F401

ROOT = os.path.join(os.path.dirname(__file__), "..")
OSM_DIR = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "raw", "common", "osm")
RACE = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, "data", "2026-race", "race.json")
OUT = os.path.join(ROOT, "data", "roadpaint.json")
LANES = {"motorway": 4, "trunk": 3, "primary": 3, "secondary": 3, "tertiary": 2, "residential": 2,
         "unclassified": 2, "service": 2, "primary_link": 2, "secondary_link": 2, "trunk_link": 2, "motorway_link": 2}
RANK = {"motorway": 0, "trunk": 1, "primary": 2, "secondary": 3, "tertiary": 4, "unclassified": 5, "residential": 5,
        "service": 7, "primary_link": 3, "secondary_link": 4, "trunk_link": 3, "motorway_link": 3}
REACH = 9.0   # a street counts as under the circuit within this many metres of the centreline


def is_bus(tags):
    """A bus lane on the left kerb (busway:left=lane / lanes:bus) or the right kerb; 0 if none."""
    n = tags.get("lanes:bus", "")
    left = tags.get("busway:left") in ("lane", "opposite_lane") or tags.get("bus:lanes", "").split("|")[:1] == ["designated"]
    right = tags.get("busway:right") in ("lane", "opposite_lane")
    if n.isdigit() and int(n) > 0 and not right:
        left = True
    return -1 if left else 1 if right else 0


def main():
    race = json.load(open(RACE))
    C = race["track"]["center"]
    n = len(C)
    print("loading OSM...", flush=True)
    osm = OSM(OSM_DIR)
    # street segments in a coarse grid
    grid = {}
    segs = []
    for wid, (refs, tags) in osm.ways.items():
        hw = tags.get("highway")
        if hw not in RANK:
            continue
        if tags.get("tunnel") == "yes" or tags.get("layer", "0") not in ("0", "-0"):
            if tags.get("bridge") == "yes" or tags.get("tunnel") == "yes":
                continue
        pts = [osm.nodes[r] for r in refs if r in osm.nodes]
        lanes = int(tags["lanes"]) if tags.get("lanes", "").isdigit() else LANES[hw]
        info = dict(hw=hw, lanes=lanes, one=1 if tags.get("oneway") in ("yes", "1", "true") else 0, bus=is_bus(tags),
                    fwd=int(tags.get("lanes:forward", 0) or 0), bwd=int(tags.get("lanes:backward", 0) or 0))
        for a, b in zip(pts, pts[1:]):
            segs.append((a, b, info))
            for gx in range(int(min(a[0], b[0]) // 40), int(max(a[0], b[0]) // 40) + 1):
                for gy in range(int(min(a[1], b[1]) // 40), int(max(a[1], b[1]) // 40) + 1):
                    grid.setdefault((gx, gy), []).append(len(segs) - 1)
    print(len(segs), "street segments", flush=True)

    def nearest(px, py, hx, hy):
        best = None
        for gx in range(int((px - REACH) // 40), int((px + REACH) // 40) + 1):
            for gy in range(int((py - REACH) // 40), int((py + REACH) // 40) + 1):
                for si in grid.get((gx, gy), []):
                    a, b, info = segs[si]
                    dx, dy = b[0] - a[0], b[1] - a[1]
                    L2 = dx * dx + dy * dy or 1e-9
                    t = max(0, min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / L2))
                    d = math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy))
                    if d > REACH:
                        continue
                    L = math.sqrt(L2)
                    along = (dx * hx + dy * hy) / L          # >0: street drawn the same way the race runs
                    if abs(along) < 0.7:
                        continue                              # a crossing street, not the one under the circuit
                    score = d + RANK[info["hw"]] * 1.5
                    if best is None or score < best[0]:
                        best = (score, info, along > 0)
        return best

    lanes_a, one_a, bus_a = [], [], []
    for i in range(n):
        p0, p1 = C[(i - 1) % n], C[(i + 1) % n]
        hx, hy = p1[0] - p0[0], p1[1] - p0[1]
        L = math.hypot(hx, hy) or 1
        hx, hy = hx / L, hy / L
        best = nearest(C[i][0], C[i][1], hx, hy)
        if best is None:
            lanes_a.append(lanes_a[-1] if lanes_a else 4); one_a.append(one_a[-1] if one_a else 1); bus_a.append(0)
            continue
        _, info, same = best
        lanes = info["lanes"]
        one = info["one"]
        if not one and (info["fwd"] or info["bwd"]):
            lanes = info["fwd"] if same else info["bwd"]   # lanes in the race's direction (two-way: the carriageway's own)
            lanes = lanes or max(1, info["lanes"] // 2)
        elif not one:
            lanes = max(1, info["lanes"] // 2)
        lanes_a.append(max(1, min(5, lanes)))
        one_a.append(one)
        bus = 0
        if info["bus"]:
            bus = info["bus"] if same or one else -info["bus"]   # tagged side, in the way's direction (drive on the left)
        bus_a.append(bus)
    # smooth out one-sample flickers (a street segment boundary)
    for arr in (lanes_a, one_a, bus_a):
        for _ in range(2):
            for i in range(n):
                a, b, c = arr[(i - 1) % n], arr[i], arr[(i + 1) % n]
                if a == c and b != a:
                    arr[i] = a
    # crossings and signals: OSM nodes within reach of the circuit
    zebra, stop = [], []
    import xml.etree.ElementTree as ET
    import glob
    for f in sorted(glob.glob(os.path.join(OSM_DIR, "t_*.xml"))):
        for e in ET.parse(f).getroot():
            if e.tag != "node":
                continue
            tags = {t.get("k"): t.get("v") for t in e.findall("tag")}
            hw, cr = tags.get("highway"), tags.get("crossing")
            kind = "zebra" if (hw == "crossing" or cr) else "signal" if hw == "traffic_signals" else None
            if not kind:
                continue
            x, y = project(float(e.get("lon")), float(e.get("lat")))
            bd, bi = 1e9, -1
            for i in range(n):
                d = math.hypot(C[i][0] - x, C[i][1] - y)
                if d < bd:
                    bd, bi = d, i
            if bd > 8:
                continue
            s = bi * race["track"]["bin"]
            (zebra if kind == "zebra" else stop).append(round(s, 1))
    def thin(v, gap):
        out = []
        for s in sorted(v):
            if not out or s - out[-1] > gap:
                out.append(s)
        return out
    zebra = thin(zebra, 12)
    # a stop line sits 6 m before the signal (drivers stop before the lights), on signalised ones only
    stop = [round(s - 6, 1) for s in thin(stop, 25)]
    # BUS LANE stencil every ~60 m along bus lane runs
    text, last = [], -1e9
    bin_ = race["track"]["bin"]
    for i in range(n):
        if bus_a[i] and i * bin_ - last > 60:
            text.append(i * bin_); last = i * bin_
    out = dict(bin=bin_, n=n, lanes=lanes_a, one=one_a, bus=bus_a, zebra=zebra, stop=stop, text=text)
    json.dump(out, open(OUT, "w"), separators=(",", ":"))
    from collections import Counter
    print("lanes", Counter(lanes_a), "one-way", sum(one_a), "bus samples", sum(1 for b in bus_a if b),
          "zebras", len(zebra), "stops", len(stop), "bus text", len(text))


if __name__ == "__main__":
    main()
