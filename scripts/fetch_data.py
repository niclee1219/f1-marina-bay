"""Download raw inputs: OpenF1 race data for the 2025 Singapore GP and OSM map tiles.

Usage: python3 scripts/fetch_data.py [raw_dir]   (default: ./raw, git-ignored)
"""
import json
import os
import sys
import time
import urllib.request

RAW = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "raw")
SESSION = 9896  # 2025 Singapore Grand Prix, Race
WINDOW = "date>2025-10-05T11:55:00&date<2025-10-05T13:55:00"
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
        except Exception as e:  # noqa: BLE001 - retry anything network related
            print("retry", url, e)
            time.sleep(2 ** (i + 1))
    raise SystemExit(f"failed: {url}")


def main():
    for d in ("", "loc", "car", "osm"):
        os.makedirs(os.path.join(RAW, d), exist_ok=True)
    for ep in ("drivers", "laps", "position", "race_control", "pit", "stints",
               "session_result", "intervals", "weather", "overtakes"):
        get(f"{API}/{ep}?session_key={SESSION}", f"{RAW}/{ep}.json")
    # Official corner numbering/positions (same coordinate frame as OpenF1 location data).
    get("https://api.multiviewer.app/api/v1/circuits/61/2025", f"{RAW}/circuit.json")
    drivers = json.load(open(f"{RAW}/drivers.json"))
    for d in drivers:
        n = d["driver_number"]
        get(f"{API}/location?session_key={SESSION}&driver_number={n}&{WINDOW}", f"{RAW}/loc/{n}.json")
        get(f"{API}/car_data?session_key={SESSION}&driver_number={n}&{WINDOW}", f"{RAW}/car/{n}.json")
    lon0, lat0, step = 103.842, 1.276, 0.005
    for i in range(6):
        for j in range(5):
            a, b = lon0 + i * step, lat0 + j * step
            get(f"https://api.openstreetmap.org/api/0.6/map?bbox={a:.4f},{b:.4f},{a + step:.4f},{b + step:.4f}",
                f"{RAW}/osm/t_{i}_{j}.xml")


if __name__ == "__main__":
    main()
