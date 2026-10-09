"""Download raw inputs for one OpenF1 session, plus the shared OSM tiles and corner data.

Usage: python3 scripts/fetch_data.py --session 9896 [--raw raw]

  raw/<session_key>/  OpenF1 session data (location + car telemetry per driver)
  raw/common/         OSM map tiles and MultiViewer corner positions (fetched once)

OpenF1's free API serves a session's data shortly after it finishes. Re-run with
--refresh to pull a session again (e.g. if you fetched it while it was still running).
"""
import argparse
import json
import os
import shutil
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta

API = "https://api.openf1.org/v1"


def get(url, dest, tries=4):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "f1-marina-bay-builder"})
            with urllib.request.urlopen(req, timeout=300) as r:
                body = r.read()
            if dest.endswith(".json"):
                json.loads(body)
            with open(dest, "wb") as f:
                f.write(body)
            print("ok ", dest, len(body))
            return
        except urllib.error.HTTPError as e:
            if e.code == 404 and dest.endswith(".json"):
                # OpenF1 answers 404 when a session simply has no rows (e.g. intervals in practice)
                with open(dest, "w") as f:
                    f.write("[]")
                print("none", dest)
                return
            print("retry", url, e)
            time.sleep(2 ** (i + 1))
        except Exception as e:  # noqa: BLE001 - retry anything network related
            print("retry", url, e)
            time.sleep(2 ** (i + 1))
    raise SystemExit(f"failed: {url}")


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%S")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--session", required=True, type=int, help="OpenF1 session_key")
    ap.add_argument("--raw", default=os.path.join(os.path.dirname(__file__), "..", "raw"))
    ap.add_argument("--refresh", action="store_true", help="re-download this session's files")
    args = ap.parse_args()
    raw = os.path.join(args.raw, str(args.session))
    common = os.path.join(args.raw, "common")
    if args.refresh and os.path.isdir(raw):
        shutil.rmtree(raw)
    for d in (os.path.join(raw, "loc"), os.path.join(raw, "car"), os.path.join(common, "osm")):
        os.makedirs(d, exist_ok=True)

    get(f"{API}/sessions?session_key={args.session}", f"{raw}/sessions.json")
    session = json.load(open(f"{raw}/sessions.json"))[0]
    json.dump(session, open(f"{raw}/session.json", "w"), indent=1)
    start = datetime.fromisoformat(session["date_start"]) - timedelta(minutes=5)
    end = datetime.fromisoformat(session["date_end"]) + timedelta(minutes=25 if session["session_type"] == "Race" else 10)
    window = f"date>{iso(start)}&date<{iso(end)}"

    for ep in ("drivers", "laps", "position", "race_control", "pit", "stints",
               "session_result", "intervals", "weather", "overtakes"):
        get(f"{API}/{ep}?session_key={args.session}", f"{raw}/{ep}.json")
    for d in json.load(open(f"{raw}/drivers.json")):
        n = d["driver_number"]
        get(f"{API}/location?session_key={args.session}&driver_number={n}&{window}", f"{raw}/loc/{n}.json")
        get(f"{API}/car_data?session_key={args.session}&driver_number={n}&{window}", f"{raw}/car/{n}.json")

    # Official corner numbering/positions (same coordinate frame as OpenF1 location data).
    get("https://api.multiviewer.app/api/v1/circuits/61/2025", f"{common}/circuit.json")
    lon0, lat0, step = 103.842, 1.276, 0.005
    for i in range(6):
        for j in range(5):
            a, b = lon0 + i * step, lat0 + j * step
            get(f"https://api.openstreetmap.org/api/0.6/map?bbox={a:.4f},{b:.4f},{a + step:.4f},{b + step:.4f}",
                f"{common}/osm/t_{i}_{j}.xml")


if __name__ == "__main__":
    main()
