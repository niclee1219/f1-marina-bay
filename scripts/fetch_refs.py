"""Find and download landmark reference photos from Wikimedia Commons into reference/<landmark>/.

Usage:
  python3 scripts/fetch_refs.py list <landmark> "<search terms>"     # print candidates
  python3 scripts/fetch_refs.py get <landmark> "File:Name.jpg" [...]  # download (1280 px) + attribution

Only freely licensed files are kept; every download is recorded in reference/<landmark>/SOURCES.md.
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
ROOT = os.path.join(os.path.dirname(__file__), "..", "reference")
UA = {"User-Agent": "f1-marina-bay/1.0 (github.com/niclee1219/f1-marina-bay; reference photos)"}
FREE = re.compile(r"^(CC BY|CC BY-SA|CC0|Public domain|PD)", re.I)


def fetch(url, tries=6):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code != 429 or k == tries - 1:
                raise
            time.sleep(20 * (k + 1))   # Commons rate limit: back off


def api(**params):
    params.update(format="json", formatversion="2")
    return json.loads(fetch(API + "?" + urllib.parse.urlencode(params)))


def info(titles=None, search=None, width=1280):
    kw = dict(action="query", prop="imageinfo", iiprop="url|size|extmetadata", iiurlwidth=width)
    if search:
        kw.update(generator="search", gsrsearch=f"{search} filetype:bitmap", gsrnamespace=6, gsrlimit=25)
    else:
        kw.update(titles="|".join(titles))
    return api(**kw).get("query", {}).get("pages", [])


def meta(p):
    ii = p["imageinfo"][0]
    em = ii.get("extmetadata", {})
    strip = lambda s: re.sub(r"<[^>]+>", "", s or "").strip()
    return {
        "title": p["title"], "w": ii["width"], "h": ii["height"], "thumb": ii.get("thumburl") or ii["url"],
        "page": ii["descriptionurl"], "license": strip(em.get("LicenseShortName", {}).get("value")),
        "artist": strip(em.get("Artist", {}).get("value"))[:80], "date": strip(em.get("DateTimeOriginal", {}).get("value"))[:20],
    }


def main():
    cmd, landmark = sys.argv[1], sys.argv[2]
    if cmd == "list":
        for p in info(search=sys.argv[3]):
            if "imageinfo" not in p:
                continue
            m = meta(p)
            ok = "ok " if FREE.match(m["license"]) else "-- "
            print(f"{ok}{m['w']}x{m['h']} {m['license']:12} {m['date']:12} {m['title']}")
        return
    out = os.path.join(ROOT, landmark)
    os.makedirs(out, exist_ok=True)
    rows = []
    for p in info(titles=sys.argv[3:]):
        if "imageinfo" not in p:
            print("not found:", p.get("title"))
            continue
        m = meta(p)
        if not FREE.match(m["license"]):
            print("skip (licence):", m["title"], m["license"])
            continue
        name = re.sub(r"[^A-Za-z0-9._-]+", "_", m["title"].split(":", 1)[1])
        open(os.path.join(out, name), "wb").write(fetch(m["thumb"]))
        time.sleep(3)
        rows.append(f"- `{name}`: [{m['title']}]({m['page']}), {m['artist'] or 'unknown author'}, {m['license']}")
        print("saved", name)
    with open(os.path.join(out, "SOURCES.md"), "a") as f:
        for r in rows:
            f.write(r + "\n")


if __name__ == "__main__":
    main()
