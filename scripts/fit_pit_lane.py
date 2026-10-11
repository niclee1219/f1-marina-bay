"""Fit the pit lane from telemetry and write it into every session's race.json (track.pitlane).

Usage:
  python3 scripts/fit_pit_lane.py                 # all sessions in data/sessions.json

The OSM pit-lane way is a rough hand-drawn line. Every pit stop in the built sessions holds the
real path at 4 Hz, so:

1. For each pit stop, take the car's path from where it leaves the racing line to where it rejoins
   (the stretch around the stop that is off the track centreline, extended back and forward while
   the car is still diverging from / converging on it).
2. Average those paths into one centre line (a principal curve: project the moving samples onto
   the current line, average them per 2 m bin, smooth, repeat), pooled over all sessions.
3. Where it peels off and rejoins: arc length on the circuit where the fitted line is closest
   to it at each end (entry / exit), plus where it crosses the track edge.
4. Pit boxes: where each team's cars stood still during their stops, per session (team order
   changes by season), as distance along the lane and lateral offset (garage side positive).

The fitted lane uses the pooled stops of every session; boxes come from each session's own stops.
"""
import json
import os
import sys

import numpy as np
from scipy.spatial import cKDTree

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DATA = os.path.join(ROOT, "data")
STEP = 2.0


class Curve:
    """Closed Catmull-Rom centreline by arc length (same curve as src/data.js TrackCurve)."""

    def __init__(self, center):
        P = np.asarray(center, float)
        self.P, self.n = P, len(P)
        self.S = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(np.vstack([P, P[:1]]), axis=0), axis=1))])
        self.L = self.S[-1]
        ss = np.arange(0, self.L, 0.5)
        self.dense_s = ss
        self.dense, self.dense_t = self.at(ss)
        self.tree = cKDTree(self.dense)

    def at(self, s):
        s = np.mod(np.asarray(s, float), self.L)
        i = np.clip(np.searchsorted(self.S, s, side="right") - 1, 0, self.n - 1)
        u = ((s - self.S[i]) / (self.S[i + 1] - self.S[i]))[:, None]
        P, n = self.P, self.n
        p0, p1, p2, p3 = P[(i - 1) % n], P[i], P[(i + 1) % n], P[(i + 2) % n]
        v = 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u ** 2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3)
        dv = 0.5 * ((-p0 + p2) + 2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * u + 3 * (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 2)
        return v, dv / np.linalg.norm(dv, axis=1)[:, None]

    def project(self, xy):
        """-> arc length, signed offset (+ = right of travel, the app's +N side), distance."""
        dist, i = self.tree.query(xy)
        t = self.dense_t[i]
        d = ((xy - self.dense[i]) * np.stack([t[:, 1], -t[:, 0]], 1)).sum(1)
        return self.dense_s[i], d, dist


def load_session(sid):
    D = os.path.join(DATA, sid)
    r = json.load(open(os.path.join(D, "race.json")))
    n = len(r["drivers"])
    fr = np.fromfile(os.path.join(D, "race.bin"), np.int16).reshape(n, -1, 4)
    return r, fr


def car_xy(fr, k, cur):
    on = ((fr[k, :, 3] >> 13) & 1).astype(bool)
    s = fr[k, :, 0].view(np.uint16) / 10.0
    d = fr[k, :, 1] / 100.0
    c, t = cur.at(s)
    x = np.where(on, c[:, 0] + t[:, 1] * d, fr[k, :, 0] / 10.0)
    y = np.where(on, c[:, 1] - t[:, 0] * d, fr[k, :, 1] / 10.0)
    return np.stack([x, y], 1), fr[k, :, 2].astype(float)


def pit_paths(r, fr, cur):
    """One path per pit stop: [(xy, speed, team, stop_t_index_range)]."""
    hz = r["hz"]
    by_num = {d["num"]: (k, d) for k, d in enumerate(r["drivers"])}
    out = []
    cache = {}
    for t, num, lap, stop, lane in r["pits"]:
        if num not in by_num:
            continue
        k, d = by_num[num]
        if k not in cache:
            cache[k] = car_xy(fr, k, cur)
        xy, sp = cache[k]
        a = max(0, int((t - 60) * hz)); b = min(len(sp), int((t + (lane or 30) + 60) * hz))
        if b - a < 20:
            continue
        _, _, dist = cur.project(xy[a:b])
        off = dist > 9.0
        # the off-track run that overlaps the pit window
        i0 = int(t * hz) - a
        runs, i = [], 0
        while i < len(off):
            if off[i]:
                j = i
                while j < len(off) and off[j]:
                    j += 1
                runs.append((i, j))
                i = j
            else:
                i += 1
        if not runs:
            continue
        w0, w1 = i0, i0 + int((lane or 25) * hz)
        runs = [ru for ru in runs if ru[1] > w0 - 8 and ru[0] < w1 + 8]
        if not runs:
            continue
        i, j = max(runs, key=lambda ru: ru[1] - ru[0])
        if (j - i) / hz < 8:
            continue
        # extend while still diverging from / converging on the racing line
        while i > 0 and dist[i - 1] < dist[i] and dist[i - 1] > 0.8:
            i -= 1
        while j < len(dist) - 1 and dist[j] < dist[j - 1] and dist[j] > 0.8:
            j += 1
        out.append((xy[a + i:a + j], sp[a + i:a + j], d["team"]))
    return out


def resample(line, step=STEP):
    seg = np.linalg.norm(np.diff(line, axis=0), axis=1)
    cum = np.concatenate([[0], np.cumsum(seg)])
    u = np.arange(0, cum[-1], step)
    return np.stack([np.interp(u, cum, line[:, 0]), np.interp(u, cum, line[:, 1])], 1)


def smooth(v, sig):
    k = np.exp(-0.5 * (np.arange(-3 * sig, 3 * sig + 1) / sig) ** 2); k /= k.sum()
    pad = np.pad(v, ((3 * sig, 3 * sig), (0, 0)), mode="edge")
    return np.stack([np.convolve(pad[:, c], k, mode="valid") for c in range(v.shape[1])], 1)


def fit_center(paths, cur):
    # start from a complete drive-through (leaves and rejoins the racing line; garage runs in
    # practice and qualifying only cover half the lane), the median one by length
    full = [p for p in paths if cur.project(p[0][[0, -1]])[2].max() < 4]
    full.sort(key=lambda p: np.linalg.norm(np.diff(p[0], axis=0), axis=1).sum())
    line = resample(full[len(full) // 2][0])
    pts = np.vstack([p[0][p[1] > 25] for p in paths])
    for _ in range(6):
        tree = cKDTree(line)
        dist, idx = tree.query(pts)
        ok = dist < 8
        acc = np.zeros_like(line); cnt = np.zeros(len(line))
        np.add.at(acc, idx[ok], pts[ok]); np.add.at(cnt, idx[ok], 1)
        good = cnt >= 3
        new = line.copy()
        new[good] = acc[good] / cnt[good][:, None]
        line = resample(smooth(new, 3))
    # trim ends that only a handful of paths reach
    tree = cKDTree(line)
    _, idx = tree.query(pts)
    cnt = np.bincount(idx, minlength=len(line))
    keep = np.where(cnt >= max(3, np.percentile(cnt, 20) * 0.25))[0]
    return line[keep[0]:keep[-1] + 1]


def lane_frame(line):
    seg = np.linalg.norm(np.diff(line, axis=0), axis=1)
    u = np.concatenate([[0], np.cumsum(seg)])
    t = np.gradient(line, axis=0); t /= np.linalg.norm(t, axis=1)[:, None]
    return u, t, cKDTree(line)


def main():
    sessions = [s["id"] for s in json.load(open(os.path.join(DATA, "sessions.json")))]
    loaded = {sid: load_session(sid) for sid in sessions}
    cur = Curve(loaded[sessions[0]][0]["track"]["center"])
    per = {sid: pit_paths(r, fr, cur) for sid, (r, fr) in loaded.items()}
    allp = [p for v in per.values() for p in v]
    print("pit paths:", {k: len(v) for k, v in per.items()})
    line = fit_center(allp, cur)
    u, t, tree = lane_frame(line)
    # garage side: the side of the lane away from the circuit
    s_mid, d_mid, _ = cur.project(line[len(line) // 2][None])
    c, ct = cur.at(s_mid)
    away = line[len(line) // 2] - c[0]
    nrm = np.stack([t[:, 1], -t[:, 0]], 1)            # right of travel
    side = 1 if (nrm[len(line) // 2] * away).sum() > 0 else -1
    # lateral spread of moving cars = lane usage
    pts = np.vstack([p[0][p[1] > 25] for p in allp])
    _, idx = tree.query(pts)
    lat = ((pts - line[idx]) * nrm[idx]).sum(1) * side
    # entry / exit on the circuit
    s_line, d_line, dist_line = cur.project(line)
    edge = 7.0
    first_off = int(np.argmax(dist_line > edge)); last_off = len(line) - 1 - int(np.argmax(dist_line[::-1] > edge))
    # pit speed limit: the fastest cars sit exactly on the limiter, so the 90th-percentile speed
    # per 4 m bin is flat across the speed-limited stretch; the lines are where it leaves the plateau
    allu, allv = [], []
    for xy, sp, team in allp:
        dd, ii = tree.query(xy)
        m = (dd < 10) & (sp > 20)
        allu.append(u[ii[m]]); allv.append(sp[m])
    allu = np.concatenate(allu); allv = np.concatenate(allv)
    bins = (allu // 4).astype(int)
    nbin = int(u[-1] // 4) + 1
    p90 = np.array([np.percentile(allv[bins == i], 90) if (bins == i).sum() >= 20 else np.nan for i in range(nbin)])
    limit = float(np.nanmedian(p90[nbin // 4:3 * nbin // 4]))
    on = np.nan_to_num(p90, nan=999) <= limit + 3
    a = b = nbin // 2
    while a > 0 and on[a - 1]:
        a -= 1
    while b < nbin - 1 and on[b + 1]:
        b += 1
    slow = np.arange(a, b + 1)
    lane = {
        "center": [[round(float(x), 2), round(float(y), 2)] for x, y in line],
        "side": side,
        "entryS": round(float(s_line[0]), 1), "exitS": round(float(s_line[-1]), 1),
        "entryEdge": round(float(u[first_off]), 1), "exitEdge": round(float(u[last_off]), 1),
        "limitFrom": float(slow[0] * 4), "limitTo": float(slow[-1] * 4 + 4), "limitKph": round(limit),
        "length": round(float(u[-1]), 1),
        "spread": [round(float(np.percentile(lat, q)), 2) for q in (5, 50, 95)],
        "samples": int(sum(len(p[0]) for p in allp)), "stops": len(allp),
    }
    print({k: v for k, v in lane.items() if k != "center"})

    # boxes per season (the pit order follows the previous year's championship): where each
    # team's cars stood still, pooled over the season's sessions
    season = {sid: str(r["session"].get("date", sid))[:4] for sid, (r, fr) in loaded.items()}
    stops = {}
    for sid, paths in per.items():
        for xy, sp, team in paths:
            st = xy[sp < 1]
            if not len(st):
                continue
            dd, ii = tree.query(st)
            ok = dd < 12
            if not ok.any():
                continue
            ll = ((st[ok] - line[ii[ok]]) * nrm[ii[ok]]).sum(1) * side
            stops.setdefault((season[sid], team), []).append((float(np.median(u[ii[ok]])), float(np.median(ll))))
    boxes = {}
    for (yr, team), v in stops.items():
        a = np.array(v)
        # the densest cluster (the team's own box; queued or aborted stops fall outside it)
        nb = [(np.abs(a[:, 0] - x) < 6).sum() for x in a[:, 0]]
        c = a[np.abs(a[:, 0] - a[int(np.argmax(nb)), 0]) < 6]
        boxes.setdefault(yr, []).append({"team": team, "u": round(float(np.median(c[:, 0])), 1),
                                         "lat": round(float(np.median(c[:, 1])), 2), "n": int(len(c))})
    for yr in boxes:
        boxes[yr].sort(key=lambda b: b["u"])
        print(yr, [(b["team"], b["u"], b["n"]) for b in boxes[yr]])
    for sid, (r, fr) in loaded.items():
        r["track"]["pitlane"] = dict(lane, boxes=boxes.get(season[sid], []))
        json.dump(r, open(os.path.join(DATA, sid, "race.json"), "w"), separators=(",", ":"))


if __name__ == "__main__":
    main()
