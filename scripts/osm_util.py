"""Minimal OpenStreetMap XML loader + local metric projection."""
import glob
import math
import xml.etree.ElementTree as ET

# Projection origin: roughly the centre of the Marina Bay Street Circuit.
LON0, LAT0 = 103.8590, 1.2900
M_PER_DEG_LAT = 110_574.0
M_PER_DEG_LON = 111_320.0 * math.cos(math.radians(LAT0))


def project(lon, lat):
    """lon/lat -> local metres (x = east, y = north)."""
    return ((lon - LON0) * M_PER_DEG_LON, (lat - LAT0) * M_PER_DEG_LAT)


class OSM:
    def __init__(self, folder):
        self.nodes, self.ways, self.rels = {}, {}, {}
        for f in sorted(glob.glob(f"{folder}/t_*.xml")):
            for e in ET.parse(f).getroot():
                tags = {t.get("k"): t.get("v") for t in e.findall("tag")}
                if e.tag == "node":
                    self.nodes[e.get("id")] = project(float(e.get("lon")), float(e.get("lat")))
                elif e.tag == "way":
                    self.ways[e.get("id")] = ([n.get("ref") for n in e.findall("nd")], tags)
                elif e.tag == "relation":
                    members = [(m.get("type"), m.get("ref"), m.get("role")) for m in e.findall("member")]
                    self.rels[e.get("id")] = (members, tags)

    def way_coords(self, wid):
        refs, _ = self.ways[wid]
        return [self.nodes[r] for r in refs if r in self.nodes]

    def multipolygon_rings(self, rid, role="outer"):
        """Stitch the member ways of a multipolygon into closed rings (best effort)."""
        members, _ = self.rels[rid]
        segs = [self.ways[ref][0][:] for t, ref, rl in members
                if t == "way" and rl == role and ref in self.ways]
        rings = []
        while segs:
            ring = segs.pop(0)
            changed = True
            while ring[0] != ring[-1] and changed:
                changed = False
                for i, s in enumerate(segs):
                    if s[0] == ring[-1]:
                        ring += s[1:]
                    elif s[-1] == ring[-1]:
                        ring += s[::-1][1:]
                    elif s[-1] == ring[0]:
                        ring = s + ring[1:]
                    elif s[0] == ring[0]:
                        ring = s[::-1] + ring[1:]
                    else:
                        continue
                    segs.pop(i)
                    changed = True
                    break
            pts = [self.nodes[r] for r in ring if r in self.nodes]
            rings.append((pts, ring[0] == ring[-1]))
        return rings
