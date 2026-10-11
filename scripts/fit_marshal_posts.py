"""Marshal light panels and marshal sectors from MultiViewer's circuit data -> track.marshal.

Usage:
  python3 scripts/fit_marshal_posts.py      # needs raw/common/circuit.json (scripts/fetch_data.py)

MultiViewer gives the 16 marshal light panels and the starts of the 16 marshal sectors (the
'TRACK SECTOR n' of race control's yellow flags) in its own circuit frame. The same file has the
19 corners, which build_data.py already snapped to our centreline, so a similarity transform fitted
on those pairs maps the lights and sector starts into the local frame; each is then stored as arc
length on the centreline and the side of the track it is on.
"""
import json
import os

import numpy as np
from scipy.spatial import cKDTree

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DATA = os.path.join(ROOT, "data")


def similarity(src, dst):
    """Least-squares scale, rotation (no reflection) and translation src -> dst (Umeyama)."""
    ms, md = src.mean(0), dst.mean(0)
    a, b = src - ms, dst - md
    U, S, Vt = np.linalg.svd(b.T @ a)
    d = np.sign(np.linalg.det(U @ Vt))
    R = U @ np.diag([1, d]) @ Vt
    s = (S * [1, d]).sum() / (a ** 2).sum()
    return lambda p: s * (np.asarray(p) - ms) @ R.T + md


def main():
    circ = json.load(open(os.path.join(ROOT, "raw", "common", "circuit.json")))
    sessions = [s["id"] for s in json.load(open(os.path.join(DATA, "sessions.json")))]
    ref = json.load(open(os.path.join(DATA, sessions[0], "race.json")))
    tr = ref["track"]
    C = np.asarray(tr["center"], float)
    corners = {c["n"]: C[c["i"]] for c in tr["corners"]}
    src = np.array([[c["trackPosition"]["x"], c["trackPosition"]["y"]] for c in circ["corners"] if c["number"] in corners])
    dst = np.array([corners[c["number"]] for c in circ["corners"] if c["number"] in corners])
    xf = similarity(src, dst)
    print("corner fit RMS (m):", round(float(np.sqrt(((xf(src) - dst) ** 2).sum(1).mean())), 1))

    # arc length along the centreline (same polyline as data.js TrackCurve, 4 m bins)
    seg = np.linalg.norm(np.diff(np.vstack([C, C[:1]]), axis=0), axis=1)
    S = np.concatenate([[0], np.cumsum(seg)])[:-1]
    tree = cKDTree(C)

    def place(pts):
        out = []
        for p in xf(pts):
            d, i = tree.query(p)
            t = C[(i + 1) % len(C)] - C[i - 1]
            t /= np.linalg.norm(t)
            side = float(np.sign((p - C[i]) @ np.array([t[1], -t[0]])))   # + = right of travel
            out.append((round(float(S[i]), 1), int(side) or 1, round(float(d), 1)))
        return out

    lights = place([[m["trackPosition"]["x"], m["trackPosition"]["y"]] for m in circ["marshalLights"]])
    sectors = place([[m["trackPosition"]["x"], m["trackPosition"]["y"]] for m in circ["marshalSectors"]])
    marshal = {
        "lights": [{"n": m["number"], "s": s, "side": side, "off": off} for m, (s, side, off) in zip(circ["marshalLights"], lights)],
        "sectors": sorted([{"n": m["number"], "s": s} for m, (s, _, _) in zip(circ["marshalSectors"], sectors)], key=lambda x: x["s"]),
    }
    print("lights:", [(l["n"], l["s"], l["side"], l["off"]) for l in marshal["lights"]])
    print("sectors:", [(x["n"], x["s"]) for x in marshal["sectors"]])
    for sid in sessions:
        p = os.path.join(DATA, sid, "race.json")
        r = json.load(open(p))
        r["track"]["marshal"] = marshal
        json.dump(r, open(p, "w"), separators=(",", ":"))


if __name__ == "__main__":
    main()
