// Debug view for the lateral placement of cars (toggle with D): the centreline (white), the track
// edges (red), the limit cars are kept inside, half a car width in from the edge (amber), and for
// every car a blue dot where the telemetry puts it, a green dot where it is drawn after the
// separation pass (lateral.js), and a line between them. Pairs the pass is currently pushing apart
// get a yellow line between the two cars.
import * as THREE from 'three';
import { LATERAL, TRACK_HALF_WIDTH } from './config.js';

export class LateralView {
  constructor(scene, track, cars) {
    this.cars = cars;
    this.root = new THREE.Group();
    this.root.visible = false;
    this.root.renderOrder = 50;
    scene.add(this.root);
    const line = (offset, color) => {
      const pts = [];
      for (let i = 0; i <= track.n; i++) pts.push(track.at(i, offset, 0.45));
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }));
      l.renderOrder = 50;
      this.root.add(l);
    };
    line(0, 0xffffff);
    for (const s of [-1, 1]) {
      line(s * TRACK_HALF_WIDTH, 0xff3030);
      line(s * (TRACK_HALF_WIDTH - LATERAL.carWidth / 2), 0xffb020);
    }
    const n = cars.cars.length;
    this.pos = new Float32Array(n * 6);          // per car: data point, drawn point
    this.link = new Float32Array(n * 6);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    pg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 6).map((_, i) => [0.2, 0.55, 1, 0.1, 1, 0.3][i % 6]), 3));
    this.points = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.9, vertexColors: true, depthTest: false, sizeAttenuation: true }));
    this.points.frustumCulled = false; this.points.renderOrder = 51;
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(this.link, 3));
    this.links = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false }));
    this.links.frustumCulled = false; this.links.renderOrder = 51;
    this.pairs = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffe030, depthTest: false }));
    this.pairs.frustumCulled = false; this.pairs.renderOrder = 52;
    this.pairBuf = new Float32Array(32 * 6);
    this.pairs.geometry.setAttribute('position', new THREE.BufferAttribute(this.pairBuf, 3));
    this.root.add(this.points, this.links, this.pairs);
    this.tc = {};
  }

  toggle() { this.root.visible = !this.root.visible; return this.root.visible; }

  update(race) {
    if (!this.root.visible) return;
    const P = this.pos, K = this.link;
    this.cars.cars.forEach((c, i) => {
      const drawn = c.world;
      let dx = 0, dz = 0;
      if (c.xy[3] && c.off) {                      // the push is along the track normal (+ = right of travel)
        race.curve.at(c.xy[4], this.tc);
        dx = this.tc.ty * c.off; dz = this.tc.tx * c.off;
      }
      P.set([drawn.x - dx, drawn.y + 0.5, drawn.z - dz, drawn.x, drawn.y + 0.55, drawn.z], i * 6);
      K.set([drawn.x - dx, drawn.y + 0.5, drawn.z - dz, drawn.x, drawn.y + 0.55, drawn.z], i * 6);
    });
    this.points.geometry.attributes.position.needsUpdate = true;
    this.links.geometry.attributes.position.needsUpdate = true;
    const pr = this.cars.sep.pairs.slice(0, 32);
    pr.forEach(({ a, b }, i) => this.pairBuf.set([a.world.x, a.world.y + 0.8, a.world.z, b.world.x, b.world.y + 0.8, b.world.z], i * 6));
    this.pairs.geometry.setDrawRange(0, pr.length * 2);
    this.pairs.geometry.attributes.position.needsUpdate = true;
  }
}
