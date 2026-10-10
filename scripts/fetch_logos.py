"""Find and download sponsor logo SVGs from Wikimedia Commons into assets/logos/<key>.svg.

Usage:
  python3 scripts/fetch_logos.py list "<brand> logo"            # candidate SVG files
  python3 scripts/fetch_logos.py get <key> "File:Name.svg"       # download + record source

Logos are trademarks of their owners; Commons hosts most as public-domain text logos or under
non-free / trademark notices. Every download is recorded in assets/logos/SOURCES.md.
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://commons.wikimedia.org/w/api.php"
OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "logos")
UA = {"User-Agent": "f1-marina-bay/1.0 (github.com/niclee1219/f1-marina-bay; sponsor boards)"}


def fetch(url, tries=6):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code != 429 or k == tries - 1:
                raise
            time.sleep(20 * (k + 1))


def api(**params):
    params.update(format="json", formatversion="2")
    return json.loads(fetch(API + "?" + urllib.parse.urlencode(params)))


def main():
    cmd = sys.argv[1]
    if cmd == "list":
        r = api(action="query", generator="search", gsrsearch=f"{sys.argv[2]} filemime:image/svg+xml", gsrnamespace=6,
                gsrlimit=12, prop="imageinfo", iiprop="url|size|extmetadata")
        for p in r.get("query", {}).get("pages", []):
            ii = (p.get("imageinfo") or [{}])[0]
            lic = re.sub(r"<[^>]+>", "", ii.get("extmetadata", {}).get("LicenseShortName", {}).get("value", ""))
            print(f"{ii.get('width')}x{ii.get('height')} {lic[:22]:22} {p['title']}")
        return
    key, title = sys.argv[2], sys.argv[3]
    r = api(action="query", titles=title, prop="imageinfo", iiprop="url|extmetadata|mime")
    p = r["query"]["pages"][0]
    if "imageinfo" not in p:
        print("not found:", title)
        sys.exit(1)
    ii = p["imageinfo"][0]
    if ii.get("mime") != "image/svg+xml":
        print("not an SVG:", title, ii.get("mime"))
        sys.exit(1)
    os.makedirs(OUT, exist_ok=True)
    data = fetch(ii["url"])
    if b"<script" in data.lower():
        print("refusing SVG with script:", title)
        sys.exit(1)
    open(os.path.join(OUT, f"{key}.svg"), "wb").write(data)
    lic = re.sub(r"<[^>]+>", "", ii.get("extmetadata", {}).get("LicenseShortName", {}).get("value", "")) or "see source"
    with open(os.path.join(OUT, "SOURCES.md"), "a") as f:
        f.write(f"- `{key}.svg`: [{title}]({ii['descriptionurl']}), {lic}\n")
    print("saved", key, len(data), "bytes")


if __name__ == "__main__":
    main()
