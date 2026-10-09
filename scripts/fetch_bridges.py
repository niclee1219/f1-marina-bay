"""Fetch the elevated structures around the circuit from OpenStreetMap and cache data/bridges.json.

Usage: python3 scripts/fetch_bridges.py [--session data/2026-sq]

Keeps three kinds of OSM bridge ways (local metres, x east / y north, same frame as city.json):
  road  - the East Coast Parkway (Benjamin Sheares Bridge and its approach viaducts) and its
          ramps: motorway / motorway_link / trunk_link ways with bridge=yes
  foot  - elevated footways that cross the track
  named - the Helix, Jubilee and Cavenagh bridges (scenery near the circuit)
Ways the circuit itself drives over (Anderson Bridge, Esplanade Bridge) are left to bridges.js.

OSM has no deck heights, so each node gets one: the viaduct leaves the ground at a 4.5 % grade
from every free end of the chain, levels off at a cruise height (higher for each extra layer)
and climbs toward the Benjamin Sheares navigation span over water. Wherever a deck crosses the
track it is raised so its underside clears the asphalt by at least CLEAR metres.
"""
import argparse
import heapq
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from osm_util import project  # noqa: E402
from overpass import BBOX, query  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..")
GRADE = 0.045          # motorway ramp grade
END_H = 1.2            # deck height where a bridge way meets the embankment
LAND_H = 11.0          # cruise height of the ECP viaduct over land (layer 1)
LAYER_STEP = 7.0       # each extra OSM layer stacks this much higher
WATER_H = 30.0         # Benjamin Sheares Bridge navigation clearance is ~26-29 m
DECK = 2.0             # structural depth of a motorway box girder
CLEAR = 6.5            # minimum gap between the track surface and a deck underside
ROAD_KINDS = {"motorway", "motorway_link", "trunk_link"}
FOOT_KINDS = {"footway", "pedestrian", "path", "cycleway", "steps", "corridor"}
NAMED = {"The Helix": "helix", "Jubilee Bridge": "jubilee", "Cavenagh Bridge": "cavenagh"}


def seg_inter(p, q, r, s):
    d = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0])
    if abs(d) < 1e-9:
        return None
    t = ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / d
    u = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d
    return (t, u) if 0 <= t <= 1 and 0 <= u <= 1 else None


def inside(pt, ring):
    x, y = pt
    c = False
    for i in range(0, len(ring), 2):
        j = (i - 2) % len(ring)
        xi, yi, xj, yj = ring[i], ring[i + 1], ring[j], ring[j + 1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            c = not c
    return c


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--session", default=os.path.join(ROOT, "data", "2026-sq"))
    ap.add_argument("--cache", help="reuse a saved Overpass JSON response instead of querying")
    args = ap.parse_args()

    race = json.load(open(os.path.join(args.session, "race.json")))
    C, E = race["track"]["center"], race["track"]["elev"]
    n = len(C)
    water = json.load(open(os.path.join(ROOT, "data", "city.json")))["water"]

    s, w, nn, e = BBOX
    if args.cache:
        osm = json.load(open(args.cache))
    else:
        osm = query(f'[out:json][timeout:120];(way["bridge"]({s},{w},{nn},{e});way["man_made"="bridge"]({s},{w},{nn},{e}););out body geom;')

    def track_dist(p):
        return min(math.dist(p, c) for c in C)

    def crossings(pts):
        out = []
        for a in range(len(pts) - 1):
            for i in range(n):
                r = seg_inter(C[i], C[(i + 1) % n], pts[a], pts[a + 1])
                if r:
                    out.append((a + r[1], i + r[0]))
        return out

    ways = []
    for el in osm["elements"]:
        t = el.get("tags", {})
        if "geometry" not in el:
            continue
        pts = [project(g["lon"], g["lat"]) for g in el["geometry"]]
        name = t.get("name") or t.get("bridge:name") or ""
        hw = t.get("highway", "")
        layer = int(t.get("layer", "1") or 1) if t.get("layer", "1").lstrip("-").isdigit() else 1
        on_track = sum(1 for p in pts if track_dist(p) < 12) / len(pts)
        if on_track > 0.5:
            continue  # the circuit drives on it (Anderson / Esplanade Bridge)
        if name in NAMED and hw in FOOT_KINDS | {""}:
            if hw == "" and t.get("man_made") != "bridge":
                continue
            kind = "named"
        elif hw in ROAD_KINDS and t.get("bridge") not in (None, "no"):
            kind = "road"
        elif hw in FOOT_KINDS and t.get("bridge") not in (None, "no") and crossings(pts):
            kind = "foot"
        else:
            continue
        if t.get("man_made") == "bridge" and kind == "named":
            continue  # outline polygons: the centreline ways carry the shape
        lanes = int(t["lanes"]) if t.get("lanes", "").isdigit() else (3 if hw == "motorway" else 2)
        try:
            tagged_w = float(t.get("width", "").split()[0])
        except (ValueError, IndexError):
            tagged_w = 6.0
        width = {"road": lanes * 3.6 + 2.4, "foot": 4.0}.get(kind, tagged_w)
        ways.append({"id": el["id"], "name": name, "kind": kind, "style": NAMED.get(name, kind), "hw": hw, "layer": max(1, layer),
                     "w": round(width, 1), "nodes": el["nodes"], "pts": pts, "x": crossings(pts)})

    # ---------------------------------------------------------------- road deck heights
    roads = [w for w in ways if w["kind"] == "road"]
    deg = {}
    for w in roads:
        for nid in (w["nodes"][0], w["nodes"][-1]):
            deg[nid] = deg.get(nid, 0) + 1
    adj, pos, cap = {}, {}, {}
    for w in roads:
        for k, nid in enumerate(w["nodes"]):
            pos[nid] = w["pts"][k]
            over_water = any(inside(w["pts"][k], r) for r in water)
            c = WATER_H if over_water else LAND_H + LAYER_STEP * (w["layer"] - 1)
            cap[nid] = max(cap.get(nid, 0), c)
            if k:
                a, b = w["nodes"][k - 1], nid
                d = math.dist(w["pts"][k - 1], w["pts"][k])
                adj.setdefault(a, []).append((b, d))
                adj.setdefault(b, []).append((a, d))
    # interior node ids shared with another bridge way (a ramp branching off the mainline) are not ends
    shared = {}
    for w in roads:
        for nid in w["nodes"]:
            shared[nid] = shared.get(nid, 0) + 1
    ground = [nid for nid, dg in deg.items() if dg == 1 and shared[nid] == 1]
    dist = {nid: math.inf for nid in pos}
    pq = [(0.0, nid) for nid in ground]
    for _, nid in pq:
        dist[nid] = 0.0
    heapq.heapify(pq)
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist[u]:
            continue
        for v, wgt in adj.get(u, []):
            if d + wgt < dist[v]:
                dist[v] = d + wgt
                heapq.heappush(pq, (d + wgt, v))
    # the cap itself changes gradually (water span, layer stacks): limit its slope too
    h = {nid: min(cap[nid], END_H + GRADE * (dist[nid] if dist[nid] < math.inf else 1e4)) for nid in pos}
    for _ in range(200):
        changed = False
        for u, lst in adj.items():
            for v, wgt in lst:
                if h[v] > h[u] + GRADE * wgt + 1e-6 and dist[v] > 0:
                    h[v] = h[u] + GRADE * wgt
                    changed = True
        if not changed:
            break
    # clearance over the track: lift the deck around each crossing, falling away at the grade
    need = {}
    for w in roads:
        for (a, i) in w["x"]:
            k = int(a)
            req = E[int(i) % n] + 0.18 + CLEAR + DECK
            for kk in (k, min(k + 1, len(w["nodes"]) - 1)):
                need[w["nodes"][kk]] = max(need.get(w["nodes"][kk], 0), req)
    for src, req in need.items():
        best = {src: req}
        pq = [(-req, src)]
        while pq:
            r, u = heapq.heappop(pq)
            r = -r
            if r < best.get(u, -1):
                continue
            h[u] = max(h[u], r)
            for v, wgt in adj.get(u, []):
                rv = r - GRADE * wgt
                if rv > best.get(v, -1) and rv > h[v]:
                    best[v] = rv
                    heapq.heappush(pq, (-rv, v))

    out = []
    for w in ways:
        if w["kind"] == "road":
            hs = [h[nid] for nid in w["nodes"]]
        elif w["kind"] == "foot":
            # level footbridge: deck underside clears the highest crossing point
            top = max(E[int(i) % n] for _, i in w["x"]) + 0.18 + CLEAR + 1.0
            hs = [top] * len(w["pts"])
        else:
            hs = [0.0] * len(w["pts"])   # named bridges: built from the water/bank level at runtime
        out.append({
            "id": w["id"], "name": w["name"], "kind": w["kind"], "style": w["style"], "layer": w["layer"], "w": w["w"],
            "p": [[round(p[0], 1), round(p[1], 1), round(hh, 2)] for p, hh in zip(w["pts"], hs)],
            "x": [round(i, 1) for _, i in w["x"]],
        })
    json.dump({"source": "OpenStreetMap contributors (ODbL), via Overpass", "deck": DECK, "ways": out},
              open(os.path.join(ROOT, "data", "bridges.json"), "w"), separators=(",", ":"))
    for o in out:
        if o["x"] or o["kind"] != "road":
            under = [round(min(pp[2] for pp in o["p"]), 1), round(max(pp[2] for pp in o["p"]), 1)]
            print(f"{o['kind']:5} {o['style']:9} {o['name'] or '-':22} L{o['layer']} w={o['w']} h={under} crosses track bins {o['x']}")
    print("ways:", len(out), "road:", len(roads))


if __name__ == "__main__":
    main()
