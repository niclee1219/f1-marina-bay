"""Local dev server: the static site with caching turned off.

Usage:
  python3 scripts/serve.py [port]        # default 8000, serves the repo root

`python3 -m http.server` sends Last-Modified but no Cache-Control, so browsers cache ES modules
heuristically and can mix a fresh module with a stale one after an edit (e.g. a new config.js
under an old pit.js), which fails at load. Every response here is no-store.
"""
import functools
import http.server
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")


class NoStore(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
print(f"serving {os.path.normpath(ROOT)} on http://localhost:{port}")
http.server.ThreadingHTTPServer(("", port), functools.partial(NoStore, directory=ROOT)).serve_forever()
