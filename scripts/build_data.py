"""Turn raw OpenF1 + OSM downloads into compact files the web app loads.

Usage: python3 scripts/build_data.py [raw_dir] [out_dir]

Outputs (out_dir, default ./data):
  race.json  - drivers, timeline events, track geometry, corners, DRS zones
  city.json  - buildings, water, parks, roads (local metres, x=east, y=north)
  race.bin   - per-driver telemetry frames at 4 Hz (see FRAME LAYOUT below)
"""
import json
import math
import os
import sys
from datetime import datetime, timezone

import numpy as np
from scipy.spatial import cKDTree

sys.path.insert(0, os.path.dirname(__file__))
from osm_util import OSM  # noqa: E402

HERE = os.path.dirname(__file__)
RAW = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "raw")
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, "..", "data")
CIRCUIT_REL = "421263"
T0 = datetime(2025, 10, 5, 11, 59, 30, tzinfo=timezone.utc)  # grid, before formation lap
T1 = datetime(2025, 10, 5, 13, 47, 30, tzinfo=timezone.utc)  # after the cool-down lap
HZ = 4


def ts(s):
    return datetime.fromisoformat(s).timestamp() - T0.timestamp()


def load(name):
    return json.load(open(os.path.join(RAW, name)))


def densify(coords, step=2.0):
    out = []
    for a, b in zip(coords, coords[1:]):
        n = max(1, int(math.dist(a, b) / step))
        out += [(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n) for k in range(n)]
    out.append(coords[-1])
    return out


# ---------------------------------------------------------------- alignment
def fit_similarity(src, dst_tree, dst):
    """Trimmed ICP for a mirrored rigid transform (OpenF1 decimetres -> OSM metres)."""
    best = None
    for flip, ang in [(f, a) for f in (1.0, -1.0) for a in np.radians(np.arange(0, 360, 10))]:
        c, s = math.cos(ang), math.sin(ang)
        R = np.array([[c, -s], [s, c]])
        M = np.diag([1.0, flip])
        sc = 0.1
        A = (src @ M.T) @ R.T * sc
        t = dst.mean(0) - A.mean(0)
        for _ in range(50):
            X = (src @ M.T) @ R.T * sc + t
            d, i = dst_tree.query(X)
            keep = d < np.percentile(d, 90)
            Xs, Ys = (src @ M.T)[keep], dst[i[keep]]
            mx, my = Xs.mean(0), Ys.mean(0)
            Xc, Yc = Xs - mx, Ys - my
            U, S, Vt = np.linalg.svd(Xc.T @ Yc)
            D = np.diag([1, np.sign(np.linalg.det(Vt.T @ U.T))])
            R = Vt.T @ D @ U.T
            t = my - sc * (R @ mx)
        X = (src @ M.T) @ R.T * sc + t
        err = math.sqrt((dst_tree.query(X)[0] ** 2).mean())
        if best is None or err < best[0]:
            best = (err, R @ M * sc, t)
    print("transform", best[1].round(5).tolist(), best[2].round(1).tolist())
    return best


def main():
    os.makedirs(OUT, exist_ok=True)
    osm = OSM(os.path.join(RAW, "osm"))
    drivers = load("drivers.json")
    nums = [d["driver_number"] for d in drivers]

    # OSM circuit polyline (minus pit lane) as the alignment target.
    members, _ = osm.rels[CIRCUIT_REL]
    circ = []
    pit_osm = None
    for ty, ref, role in members:
        if ty != "way" or ref not in osm.ways:
            continue
        if role == "pitlane":
            pit_osm = osm.way_coords(ref)
            continue
        circ += densify(osm.way_coords(ref), 3)
    circ = np.array(circ)
    tree = cKDTree(circ)

    loc = {n: [p for p in load(f"loc/{n}.json") if p["x"] or p["y"]] for n in nums}
    laps = load("laps.json")

    def lap_window(num, lap):
        l = next(x for x in laps if x["driver_number"] == num and x["lap_number"] == lap)
        a = ts(l["date_start"])
        return a, a + l["lap_duration"]

    a, b = lap_window(63, 10)
    ref_raw = np.array([[p["x"], p["y"]] for p in loc[63] if a <= ts(p["date"]) <= b], float)
    err, A, t = fit_similarity(ref_raw, tree, circ)
    print(f"alignment rms {err:.2f} m")

    def xf(arr):
        return np.asarray(arr, float) @ A.T + t

    # ------------------------------------------------------------ centreline
    # Average many clean racing laps into arc-length bins along a reference lap.
    ref = xf(ref_raw)
    ref = np.vstack([ref, ref[:1]])
    seg = np.linalg.norm(np.diff(ref, axis=0), axis=1)
    cum = np.concatenate([[0], np.cumsum(seg)])
    L = cum[-1]
    dense_s = np.arange(0, L, 0.5)
    dense = np.stack([np.interp(dense_s, cum, ref[:, 0]), np.interp(dense_s, cum, ref[:, 1])], 1)
    dtree = cKDTree(dense)

    car = {n: load(f"car/{n}.json") for n in nums}
    BIN = 4.0
    nb = int(L // BIN)
    acc = np.zeros((nb, 2)); cnt = np.zeros(nb); zacc = np.zeros(nb)
    spd_acc = np.zeros(nb); spd_cnt = np.zeros(nb); drs_acc = np.zeros(nb)
    pits = load("pit.json")
    pit_laps = {(p["driver_number"], p["lap_number"]) for p in pits}
    for n in nums:
        ct = np.array([ts(c["date"]) for c in car[n]])
        cs = np.array([c["speed"] for c in car[n]])
        cd = np.array([c["drs"] for c in car[n]])
        lt = np.array([ts(p["date"]) for p in loc[n]])
        lxy = xf([[p["x"], p["y"]] for p in loc[n]])
        lz = np.array([p["z"] / 10.0 for p in loc[n]])
        for lap in range(5, 60, 3):
            if (n, lap) in pit_laps or (n, lap - 1) in pit_laps:
                continue
            try:
                a, b = lap_window(n, lap)
            except (StopIteration, TypeError):
                continue
            m = (lt >= a) & (lt <= b)
            d, i = dtree.query(lxy[m])
            ok = d < 12
            bins = (dense_s[i[ok]] // BIN).astype(int) % nb
            np.add.at(acc, bins, lxy[m][ok]); np.add.at(cnt, bins, 1); np.add.at(zacc, bins, lz[m][ok])
            sidx = np.clip(np.searchsorted(ct, lt[m][ok]), 0, len(ct) - 1)
            np.add.at(spd_acc, bins, cs[sidx]); np.add.at(spd_cnt, bins, 1)
            np.add.at(drs_acc, bins, (cd[sidx] >= 10).astype(float))
    good = cnt > 0
    idx = np.arange(nb)
    cl = np.stack([np.interp(idx, idx[good], acc[good, k] / cnt[good], period=nb) for k in range(2)], 1)
    z = np.interp(idx, idx[good], zacc[good] / cnt[good], period=nb)
    speed = np.interp(idx, idx[good], spd_acc[good] / spd_cnt[good], period=nb)
    drs = np.interp(idx, idx[good], drs_acc[good] / spd_cnt[good], period=nb)

    def smooth(v, k):
        w = np.exp(-0.5 * (np.arange(-3 * k, 3 * k + 1) / k) ** 2); w /= w.sum()
        pad = np.concatenate([v[-3 * k:], v, v[:3 * k]])
        return np.convolve(pad, w, mode="valid")
    cl = np.stack([smooth(cl[:, 0], 2), smooth(cl[:, 1], 2)], 1)
    z = smooth(z, 6); z -= z.min()
    speed = smooth(speed, 2)

    # Start/finish: where the leader is at the start of lap 2.
    a, _ = lap_window(63, 2)
    lt = np.array([ts(p["date"]) for p in loc[63]])
    j = np.searchsorted(lt, a)
    sf_xy = xf([[loc[63][j]["x"], loc[63][j]["y"]]])[0]
    sf_i = int(cKDTree(cl).query(sf_xy)[1])
    # rotate so index 0 is the start/finish line
    cl = np.roll(cl, -sf_i, 0); z = np.roll(z, -sf_i); speed = np.roll(speed, -sf_i); drs = np.roll(drs, -sf_i)
    # direction check: track should run in the order cars drive
    p0 = xf([[loc[63][j + 3]["x"], loc[63][j + 3]["y"]]])[0]
    if np.linalg.norm(p0 - cl[3]) > np.linalg.norm(p0 - cl[-3]):
        raise SystemExit("centreline runs backwards")

    # Corners: official numbering, snapped to the centreline; min speed from the averaged laps.
    ctree = cKDTree(cl)
    corners = []
    for c in load("circuit.json")["corners"]:
        p = xf([[c["trackPosition"]["x"], c["trackPosition"]["y"]]])[0]
        i = int(ctree.query(p)[1])
        win = [(i + k) % nb for k in range(-6, 7)]
        corners.append({"n": c["number"], "i": i, "v": round(float(min(speed[w] for w in win)))})
    print("corners", [(c["n"], c["i"], c["v"]) for c in corners])

    drs_zones = []
    on = drs > 0.12
    i = 0
    while i < nb:
        if on[i]:
            s = i
            while i < nb and on[i]:
                i += 1
            if i - s > 20:
                drs_zones.append([s, i - 1])
        i += 1

    # ------------------------------------------------------------ frames
    nframes = int((T1 - T0).total_seconds() * HZ)
    grid = np.arange(nframes) / HZ
    frames = np.zeros((len(nums), nframes, 4), np.int16)
    for k, n in enumerate(nums):
        lt = np.array([ts(p["date"]) for p in loc[n]])
        xy = xf([[p["x"], p["y"]] for p in loc[n]])
        frames[k, :, 0] = np.round(np.interp(grid, lt, xy[:, 0]) * 10)
        frames[k, :, 1] = np.round(np.interp(grid, lt, xy[:, 1]) * 10)
        ct = np.array([ts(c["date"]) for c in car[n]])
        sidx = np.clip(np.searchsorted(ct, grid), 0, len(ct) - 1)
        cs = np.array([c["speed"] for c in car[n]])[sidx]
        thr = np.clip(np.array([c["throttle"] for c in car[n]])[sidx], 0, 100)
        gear = np.clip(np.array([c["n_gear"] for c in car[n]])[sidx], 0, 8)
        dr = (np.array([c["drs"] for c in car[n]])[sidx] >= 10).astype(int)
        br = (np.array([c["brake"] for c in car[n]])[sidx] > 0).astype(int)
        frames[k, :, 2] = cs
        frames[k, :, 3] = thr | (gear << 7) | (dr << 11) | (br << 12)
    # FRAME LAYOUT: int16[driver][frame][x_dm, y_dm, speed_kph, thr(7b)|gear(4b)<<7|drs<<11|brake<<12]
    frames.tofile(os.path.join(OUT, "race.bin"))

    # ------------------------------------------------------------ timeline
    def rnd(v, k=2):
        return None if v is None else round(v, k)

    lap_rows = {}
    for l in laps:
        if l["date_start"] is None:
            continue
        lap_rows.setdefault(l["driver_number"], []).append(
            [l["lap_number"], rnd(ts(l["date_start"])), rnd(l["lap_duration"], 3),
             rnd(l["duration_sector_1"], 3), rnd(l["duration_sector_2"], 3), rnd(l["duration_sector_3"], 3)])
    for v in lap_rows.values():
        v.sort()
    result = {r["driver_number"]: r for r in load("session_result.json")}
    intervals = {}
    for r in load("intervals.json"):
        t_ = ts(r["date"])
        if t_ < 0:
            continue
        g = r["gap_to_leader"]; iv = r["interval"]
        intervals.setdefault(r["driver_number"], []).append(
            [rnd(t_, 1), g if isinstance(g, str) else rnd(g, 3), iv if isinstance(iv, str) else rnd(iv, 3)])
    # OpenF1 occasionally emits null interval/gap samples; carry the last known value forward.
    for rows in intervals.values():
        last = [None, None]
        for r in rows:
            for j in (1, 2):
                if r[j] is None:
                    r[j] = last[j - 1]
                else:
                    last[j - 1] = r[j]
    positions = [[rnd(max(ts(p["date"]), 0), 2), p["driver_number"], p["position"]] for p in load("position.json")]
    rc = [[rnd(ts(m["date"]), 1), m.get("lap_number"), m["category"], m.get("flag"), m["message"]]
          for m in load("race_control.json") if ts(m["date"]) > -60]
    overtakes = [[rnd(ts(o["date"]), 2), o["overtaking_driver_number"], o["overtaken_driver_number"], o["position"]]
                 for o in load("overtakes.json") if ts(o["date"]) > 0]
    weather = load("weather.json")
    w = weather[len(weather) // 2]

    race = {
        "event": "Singapore Grand Prix 2025", "circuit": "Marina Bay Street Circuit",
        "t0": T0.isoformat(), "hz": HZ, "frames": nframes,
        "race_start": rnd(ts(next(x for x in laps if x["lap_number"] == 1)["date_start"])),
        "total_laps": max(l["lap_number"] for l in laps),
        "weather": {"air": w["air_temperature"], "track": w["track_temperature"], "humidity": w["humidity"]},
        "drivers": [{
            "num": d["driver_number"], "code": d["name_acronym"], "name": d["full_name"],
            "first": d["first_name"], "last": d["last_name"], "team": d["team_name"],
            "color": "#" + (d["team_colour"] or "888888"),
            "finish": result.get(d["driver_number"], {}).get("position"),
            "laps": lap_rows.get(d["driver_number"], []),
            "intervals": intervals.get(d["driver_number"], []),
        } for d in drivers],
        "positions": positions,
        "stints": [[s["driver_number"], s["stint_number"], s["lap_start"], s["lap_end"], s["compound"],
                    s["tyre_age_at_start"]] for s in load("stints.json")],
        "pits": [[rnd(ts(p["date"])), p["driver_number"], p["lap_number"], p.get("stop_duration"),
                  p.get("lane_duration")] for p in pits],
        "race_control": rc,
        "overtakes": overtakes,
        "track": {
            "bin": BIN,
            "center": [[round(float(x), 2), round(float(y), 2)] for x, y in cl],
            "elev": [round(float(v), 2) for v in z],
            "speed": [round(float(v)) for v in speed],
            "drs": drs_zones,
            "corners": corners,
            "pit": [[round(x, 2), round(y, 2)] for x, y in pit_osm] if pit_osm else [],
            "length": round(float(nb * BIN)),
        },
    }
    json.dump(race, open(os.path.join(OUT, "race.json"), "w"), separators=(",", ":"))
    build_city(osm, cl)
    print("frames", frames.shape, "written to", OUT)


# ------------------------------------------------------------------ city
def build_city(osm, cl):
    centre = cl.mean(0)
    RADIUS = 2300.0

    def near(pts):
        c = np.mean(pts, 0)
        return np.linalg.norm(c - centre) < RADIUS

    def flat(pts, k=1):
        return [round(v, k) for p in pts for v in p]

    def simplify(pts, tol=0.6):
        if len(pts) < 4:
            return pts
        out = [pts[0]]
        for p in pts[1:-1]:
            if math.dist(p, out[-1]) > tol:
                out.append(p)
        out.append(pts[-1])
        return out

    def height_of(t):
        h = None
        for key in ("height", "building:height"):
            try:
                h = float(t[key].replace("m", "").strip())
                break
            except (KeyError, ValueError):
                pass
        if not h:
            try:
                h = float(t["building:levels"]) * 3.6 + 2
            except (KeyError, ValueError):
                h = None
        return h

    buildings, water, parks, roads, landmarks = [], [], [], [], []
    rings_done = set()

    def add_building(pts, t, wid):
        if len(pts) < 4 or not near(pts):
            return
        h = height_of(t)
        btype = t.get("building", "yes")
        if btype in ("roof", "construction"):
            h = h or 8
        if h is None or h <= 0:
            h = 12 + (int(wid) % 7) * 3  # unknown: modest, deterministic variety
        minh = 0.0
        try:
            minh = float(t.get("min_height", 0))
        except ValueError:
            pass
        name = t.get("name", "")
        if t.get("location") == "underground" or t.get("layer", "0").startswith("-"):
            return
        b = {"p": flat(simplify(pts[:-1] if pts[0] == pts[-1] else pts)), "h": round(min(h, 290), 1)}
        if minh:
            b["m"] = round(minh, 1)
        if name:
            b["n"] = name
        buildings.append(b)

    for wid, (refs, t) in osm.ways.items():
        pts = [osm.nodes[r] for r in refs if r in osm.nodes]
        if len(pts) < 2:
            continue
        if t.get("attraction") == "big_wheel":
            c = np.mean(pts, 0)
            # wheel plane is along the longer axis of its footprint
            P = np.array(pts) - c
            ev = np.linalg.eigh(P.T @ P)[1][:, -1]
            landmarks.append({"type": "flyer", "x": round(c[0], 1), "y": round(c[1], 1),
                              "dir": round(math.atan2(ev[1], ev[0]), 3)})
            continue
        if "building" in t and refs[0] == refs[-1]:
            add_building(pts, t, wid)
        elif "building:part" in t and refs[0] == refs[-1]:
            continue
        elif (t.get("natural") == "water" or t.get("waterway") in ("riverbank", "dock")) and refs[0] == refs[-1]:
            if near(pts):
                water.append(flat(simplify(pts, 2)))
        elif (t.get("leisure") in ("park", "garden", "pitch") or t.get("landuse") in ("grass", "meadow", "recreation_ground")
              or t.get("natural") in ("wood", "scrub", "grassland")) and refs[0] == refs[-1]:
            if near(pts):
                parks.append(flat(simplify(pts, 2)))
        elif t.get("highway") in ("motorway", "trunk", "primary", "secondary", "tertiary", "motorway_link",
                                  "trunk_link", "primary_link", "residential", "unclassified", "service"):
            if t.get("tunnel") == "yes" or t.get("layer", "0").startswith("-") or not near(pts):
                continue
            w = {"motorway": 16, "trunk": 14, "primary": 12, "secondary": 10, "tertiary": 8,
                 "motorway_link": 8, "trunk_link": 8, "primary_link": 7}.get(t["highway"], 5)
            roads.append({"w": w, "p": flat(simplify(pts, 1))})

    for rid, (members, t) in osm.rels.items():
        if t.get("type") != "multipolygon":
            continue
        is_b = "building" in t
        is_w = t.get("natural") == "water"
        is_p = t.get("leisure") in ("park", "garden") or t.get("landuse") in ("grass",)
        if not (is_b or is_w or is_p):
            continue
        for pts, closed in osm.multipolygon_rings(rid):
            if len(pts) < 4:
                continue
            if is_b and closed:
                add_building(pts, t, rid)
            elif is_w:
                # Unclosed rings (clipped by the download box) are closed straight across.
                water.append(flat(simplify(pts, 2)))
            elif is_p and closed and near(pts):
                parks.append(flat(simplify(pts, 2)))

    for b in buildings:
        n = b.get("n", "")
        if n.startswith("Esplanade Theatre") or n == "Esplanade Concert Hall":
            b["dome"] = 1
    print("city: buildings", len(buildings), "water", len(water), "parks", len(parks), "roads", len(roads),
          "landmarks", landmarks)
    city = {"buildings": buildings, "water": water, "parks": parks, "roads": roads, "landmarks": landmarks,
            "centre": [round(float(centre[0]), 1), round(float(centre[1]), 1)], "radius": RADIUS}
    json.dump(city, open(os.path.join(OUT, "city.json"), "w"), separators=(",", ":"))


if __name__ == "__main__":
    main()
