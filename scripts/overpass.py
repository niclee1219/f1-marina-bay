"""Small Overpass API client with retries and mirror fallback (used by the fetch_* scripts)."""
import json
import time
import urllib.parse
import urllib.request

MIRRORS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
)
# lat/lon box around the circuit (south, west, north, east)
BBOX = (1.268, 103.838, 1.305, 103.882)


def query(ql, tries=3):
    body = urllib.parse.urlencode({"data": ql}).encode()
    last = None
    for attempt in range(tries):
        for url in MIRRORS:
            try:
                req = urllib.request.Request(url, body, {"User-Agent": "f1-marina-bay/1.0 (github.com/niclee1219/f1-marina-bay)"})
                with urllib.request.urlopen(req, timeout=180) as r:
                    return json.loads(r.read())
            except Exception as e:  # rate limits, 5xx, HTML error pages
                last = e
                print(f"  overpass {url}: {e}")
        time.sleep(15 * (attempt + 1))
    raise RuntimeError(f"Overpass unavailable: {last}")
