"""Bake the real streets' road paint onto the circuit's surface (data/trackpaint.png).

The Marina Bay circuit is laid over the city's streets, so what is painted on its tarmac is what is
painted on those streets: their yellow edge lines, lane dividers (dashed, on the street's own dash
phase), double centre lines on two-way streets, bus lanes, and wherever a street splits, ends or
meets another. Nothing here follows the racing line or the track's own curve: for every point of the
track surface (arc length s along the centreline, lateral offset d across it) the script finds the
street (data/city.json roads, from OpenStreetMap) that actually covers that spot and evaluates that
street's markings there, the same rules roads.js draws on the streets themselves.

Outputs, loaded by track.js:
  data/trackpaint.png   RGB: R white paint, G yellow, B red   (width = lateral, d = -7..7 m; height = s, 0.5 m / row)
  data/trackwear.png    grey: worn wheel paths in each lane of the street under the surface
  data/trackpaint.json  rows, cols, half, length, and where the street under the track is (per crossing,
                        stop line, BUS LANE stencil): s and the lateral extent of the street there

Usage: python3 scripts/build_trackpaint.py   (needs data/roadpaint.json from scripts/build_roadpaint.py)
"""
import json
import math
import os

import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), "..")
RACE = os.path.join(ROOT, "data", "2026-race", "race.json")
CITY = os.path.join(ROOT, "data", "city.json")
RP = os.path.join(ROOT, "data", "roadpaint.json")
HALF = 7.0            # track half width, as TRACK_HALF_WIDTH in config.js
COLS = 256
STEP = 0.5            # metres of track per texture row
PX = 2 * HALF / COLS  # metres per column
RANK = {"motorway": 0, "trunk": 1, "primary": 2, "secondary": 3, "tertiary": 4, "link": 5, "residential": 6, "service": 8}
MAJOR = {"motorway", "trunk", "primary", "secondary"}


def catmull(P, sub):
    """Closed Catmull-Rom through P, `sub` points per span: positions and unit tangents."""
    n = len(P)
    out, tan = [], []
    for i in range(n):
        p0, p1, p2, p3 = P[(i - 1) % n], P[i], P[(i + 1) % n], P[(i + 2) % n]
        for k in range(sub):
            t = k / sub
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
            d = 0.5 * ((-p0 + p2) + 2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * t + 3 * (-p0 + 3 * p1 - 3 * p2 + p3) * t2)
            tan.append(d / (np.linalg.norm(d) or 1))
    return np.array(out), np.array(tan)


def cov(d, w):
    """Antialiased coverage of a line of half-width w at distance d, for pixels PX wide."""
    return np.clip((w - np.abs(d)) / PX + 0.5, 0, 1)


def main():
    race = json.load(open(RACE))
    C = np.array(race["track"]["center"], dtype=float)
    length = float(race["track"]["length"])
    dense, tdense = catmull(C, 16)
    seg = np.linalg.norm(np.diff(np.vstack([dense, dense[:1]]), axis=0), axis=1)
    cum = np.concatenate([[0], np.cumsum(seg)])
    scale = length / cum[-1]
    cum *= scale
    rows = int(round(length / STEP))
    s_rows = np.arange(rows) * STEP
    # position and heading at each row (linear interpolation along the dense polyline)
    idx = np.searchsorted(cum, s_rows, side="right") - 1
    f = (s_rows - cum[idx]) / np.maximum(cum[idx + 1] - cum[idx], 1e-9)
    nxt = (idx + 1) % len(dense)
    pos = dense[idx] * (1 - f[:, None]) + dense[nxt] * f[:, None]
    head = tdense[idx] * (1 - f[:, None]) + tdense[nxt] * f[:, None]
    head /= np.linalg.norm(head, axis=1)[:, None]
    right = np.stack([head[:, 1], -head[:, 0]], axis=1)          # track's +offset side (right of travel), east/north
    d_cols = -HALF + (np.arange(COLS) + 0.5) * PX

    # street segments near the circuit
    city = json.load(open(CITY))
    rp = json.load(open(RP))
    A, B, W, K, LN, ONE, ALONG0, SEGL = [], [], [], [], [], [], [], []
    for r in city["roads"]:
        p = np.array(r["p"], dtype=float).reshape(-1, 2)
        if len(p) < 2:
            continue
        k = r.get("k", "residential")
        w = float(r["w"])
        lanes = max(1 if r.get("o") else 2, min(int(r.get("l") or 2), int(w // 2.8)))
        c = 0.0
        for a, b in zip(p, p[1:]):
            L = float(np.hypot(*(b - a)))
            if L < 1e-6:
                continue
            A.append(a); B.append(b); W.append(w); K.append(RANK.get(k, 8) + (0 if k in MAJOR else 0.0)); LN.append(lanes)
            ONE.append(1 if r.get("o") else 0); ALONG0.append(c); SEGL.append(L)
            c += L
    A, B = np.array(A), np.array(B)
    W, K, LN, ONE, ALONG0, SEGL = map(np.array, (W, K, LN, ONE, ALONG0, SEGL))
    isMajor = np.array([0.0] * len(A))
    for r in city["roads"]:
        pass
    mid = (A + B) / 2
    print(len(A), "street segments")

    paint = np.zeros((rows, COLS, 3), dtype=np.float32)
    wear = np.zeros((rows, COLS), dtype=np.float32)
    dmin = np.full(rows, np.nan); dmax = np.full(rows, np.nan); lwrow = np.zeros(rows); oneRow = np.zeros(rows)
    major_by_rank = lambda rank: rank <= 3
    bus_rows = np.array([rp["bus"][min(len(rp["bus"]) - 1, int(s // rp["bin"]))] for s in s_rows])
    BLOCK = 64
    for b0 in range(0, rows, BLOCK):
        b1 = min(rows, b0 + BLOCK)
        c0 = pos[(b0 + b1) // 2]
        near = np.where(np.hypot(mid[:, 0] - c0[0], mid[:, 1] - c0[1]) < 60 + SEGL / 2 + W / 2)[0]
        if not len(near):
            continue
        # world points of the block's pixels
        P = pos[b0:b1, None, :] + right[b0:b1, None, :] * d_cols[None, :, None]            # (rows, cols, 2)
        Pf = P.reshape(-1, 2)
        a, bb = A[near], B[near]
        ab = bb - a
        L2 = (ab ** 2).sum(1)
        rel = Pf[:, None, :] - a[None, :, :]
        t = np.clip((rel * ab[None]).sum(2) / L2[None], 0, 1)
        proj = a[None] + t[..., None] * ab[None]
        dv = Pf[:, None, :] - proj
        dist = np.hypot(dv[..., 0], dv[..., 1])
        hwv = W[near] / 2
        u = ab / np.sqrt(L2)[:, None]
        hrow = np.repeat(head[b0:b1], COLS, axis=0)                                          # heading per pixel
        align = (hrow[:, None, 0] * u[None, :, 0] + hrow[:, None, 1] * u[None, :, 1])        # (px, seg)
        valid = (dist <= hwv[None]) & (np.abs(align) > 0.8)
        score = np.where(valid, K[near][None] * 50 + dist, np.inf)
        best = score.argmin(1)
        ok = np.isfinite(score[np.arange(len(Pf)), best])
        sel = near[best]
        ar = np.arange(len(Pf))
        tt = t[ar, best]
        # signed lateral of the pixel relative to the street's own direction (left positive), then relative to travel
        lat_u = u[best, 0] * dv[ar, best, 1] - u[best, 1] * dv[ar, best, 0]
        sgn = np.sign(align[ar, best])
        lat_h = lat_u * sgn
        hw = W[sel] / 2
        xL = hw - lat_h
        xR = hw + lat_h
        Wd = W[sel]
        lanes = LN[sel].astype(float)
        one = ONE[sel]
        major = (K[sel] <= 3).astype(float)
        along = ALONG0[sel] + tt * SEGL[sel]
        lw = Wd / lanes
        # yellow edge lines (a second line on the main roads), as roads.js
        yel = cov(xL - 0.35, 0.07) + cov(xR - 0.35, 0.07) + major * (cov(xL - 0.6, 0.07) + cov(xR - 0.6, 0.07))
        # lane dividers: dashed; a double solid centre line on two-way streets
        kk = np.clip(np.floor(xL / lw + 0.5), 1, np.maximum(1, lanes - 1))
        dl = xL - kk * lw
        centre = (one < 0.5) & (np.abs(kk - lanes * 0.5) < 0.01)
        dash = ((along / 9.0) % 1.0) < 0.34
        white = np.where(centre, cov(dl - 0.12, 0.06) + cov(dl + 0.12, 0.06), cov(dl, 0.075) * dash) * (lanes >= 2)
        # bus lane on the left or right kerb: a red line with a yellow line outside it, like the street's real marking
        busr = np.repeat(bus_rows[b0:b1], COLS)
        red = np.zeros(len(Pf))
        isbus_l = busr < 0
        isbus_r = busr > 0
        kerb = np.where(isbus_l, xL, xR)
        onbus = isbus_l | isbus_r
        yel_bus = cov(kerb - (lw + 0.16), 0.15)
        red_bus = cov(kerb - (lw - 0.2), 0.11)
        # no white dash on the bus lane's own boundary
        bound = onbus & (np.where(isbus_l, kk == 1, kk == np.maximum(1, lanes - 1)))
        white = np.where(bound, 0, white)
        yel = yel + np.where(onbus, yel_bus, 0)
        red = np.where(onbus, red_bus, 0)
        # wheel wear in each lane of the street
        lc = (xL % lw) - lw / 2
        wr = np.exp(-((np.abs(lc) - 0.82) ** 2) / 0.12)
        okf = ok.astype(np.float32)
        pr = np.stack([np.clip(white, 0, 1), np.clip(yel, 0, 1), np.clip(red, 0, 1)], axis=1) * okf[:, None]
        paint[b0:b1] = pr.reshape(b1 - b0, COLS, 3)
        wear[b0:b1] = (wr * okf).reshape(b1 - b0, COLS)
        okm = ok.reshape(b1 - b0, COLS)
        d2 = np.broadcast_to(d_cols[None, :], okm.shape)
        for r in range(b1 - b0):
            if okm[r].any():
                cols = np.where(okm[r])[0]
                dmin[b0 + r] = d_cols[cols[0]]; dmax[b0 + r] = d_cols[cols[-1]]
                lwrow[b0 + r] = lw.reshape(b1 - b0, COLS)[r, cols[0]]
                oneRow[b0 + r] = one.reshape(b1 - b0, COLS)[r, cols[0]]
        if (b0 // BLOCK) % 20 == 0:
            print(f"  rows {b0}/{rows}", flush=True)

    Image.fromarray((paint * 255).astype(np.uint8), "RGB").save(os.path.join(ROOT, "data", "trackpaint.png"), optimize=True)
    Image.fromarray((wear * 255).astype(np.uint8), "L").save(os.path.join(ROOT, "data", "trackwear.png"), optimize=True)

    def extent(s):
        r = min(rows - 1, max(0, int(round(s / STEP))))
        # nearest row that has a street under it
        for dr in range(0, 40):
            for rr in (r - dr, r + dr):
                if 0 <= rr < rows and not math.isnan(dmin[rr]):
                    return rr
        return None

    zebra, stop, text = [], [], []
    for s in rp["zebra"]:
        r = extent(s)
        if r is not None:
            zebra.append([round(s, 1), round(float(dmin[r]) - 0.2, 2), round(float(dmax[r]) + 0.2, 2)])
    for s in rp["stop"]:
        r = extent(s)
        if r is not None:
            lo, hi = float(dmin[r]), float(dmax[r])
            stop.append([round(s, 1), round(lo, 2), round(hi if oneRow[r] else (lo + hi) / 2, 2)])
    for s in rp["text"]:
        r = extent(s)
        k = min(len(rp["bus"]) - 1, int(s // rp["bin"]))
        side = rp["bus"][k]
        if r is not None and side:
            lw = float(lwrow[r])
            dc = float(dmin[r]) + lw / 2 if side < 0 else float(dmax[r]) - lw / 2
            text.append([round(s, 1), round(dc, 2), round(min(2.4, lw * 0.62), 2), side])
    out = dict(rows=rows, cols=COLS, half=HALF, length=length, step=STEP, zebra=zebra, stop=stop, text=text)
    json.dump(out, open(os.path.join(ROOT, "data", "trackpaint.json"), "w"), separators=(",", ":"))
    cover = float(np.isfinite(dmin).mean())
    print("rows", rows, "street under the track on", round(cover * 100), "% of rows; zebra", len(zebra), "stop", len(stop), "text", len(text))
    print("paint px: white", int((paint[..., 0] > 0.5).sum()), "yellow", int((paint[..., 1] > 0.5).sum()), "red", int((paint[..., 2] > 0.5).sum()))


if __name__ == "__main__":
    main()
