import * as THREE from 'three';
import { toolProfile } from './tools.js';

// Height-field (Z-map) stock. Work coords: X 0..W, Y 0..D, Z top = +topZ.
// Rendered in a local frame where three.x = X - W/2, three.z = -(Y - D/2),
// three.y = Z (the parent group places Z0 at the right height).

export class Stock {
  constructor({ width, depth, height, topZ = 1, cell = 0.25 }) {
    this.W = width; this.D = depth; this.H = height;
    this.topZ = topZ; this.bottomZ = topZ - height;
    this.cell = cell;
    this.nx = Math.round(width / cell) + 1;
    this.ny = Math.round(depth / cell) + 1;
    const n = this.nx * this.ny;
    this.h = new Float32Array(n).fill(topZ);
    this.shade = new Float32Array(n);
    this.cut = new Uint8Array(n);
    this.removed = 0;
    this.group = new THREE.Group();
    this._buildTop();
    this._buildSides();
    this.dirty = null;
  }

  _material() {
    const m = new THREE.MeshStandardMaterial({
      color: 0xffffff, metalness: 1.0, roughness: 0.5, vertexColors: true, envMapIntensity: 1.0,
    });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aRough;\nvarying float vRough;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRough = aRough;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vRough;')
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vRough;');
    };
    return m;
  }

  _buildTop() {
    const { nx, ny, cell, W, D } = this;
    const n = nx * ny;
    const pos = new Float32Array(n * 3);
    const nor = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const rough = new Float32Array(n);
    // raw stock: saw-cut / extruded finish with slight mottling
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = i + j * nx;
      pos[k * 3] = i * cell - W / 2;
      pos[k * 3 + 1] = this.h[k];
      pos[k * 3 + 2] = -(j * cell - D / 2);
      nor[k * 3 + 1] = 1;
      const x = i * cell, y = j * cell;
      const mottle = 0.5 + 0.5 * Math.sin(x * 0.21 + Math.sin(y * 0.13) * 2.0) * Math.cos(y * 0.17 + x * 0.05);
      const streak = 0.5 + 0.5 * Math.sin(y * 3.1 + Math.sin(x * 0.4) * 0.6);
      this.shade[k] = 0.62 + mottle * 0.06 + streak * 0.03;
      rough[k] = 0.55 + mottle * 0.08;
    }
    const idx = new Uint32Array((nx - 1) * (ny - 1) * 6);
    let p = 0;
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = i + j * nx, b = a + 1, c = a + nx, d = c + 1;
      idx[p++] = a; idx[p++] = b; idx[p++] = c;
      idx[p++] = b; idx[p++] = d; idx[p++] = c;
    }
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.norAttr = new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage);
    this.roughAttr = new THREE.BufferAttribute(rough, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('normal', this.norAttr);
    g.setAttribute('color', this.colAttr);
    g.setAttribute('aRough', this.roughAttr);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingBox = new THREE.Box3(new THREE.Vector3(-W / 2, this.bottomZ, -D / 2), new THREE.Vector3(W / 2, this.topZ, D / 2));
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    this.topMesh = new THREE.Mesh(g, this._material());
    this.topMesh.castShadow = true; this.topMesh.receiveShadow = true;
    this.group.add(this.topMesh);
    this._refreshColors(0, 0, nx - 1, ny - 1);
  }

  _buildSides() {
    // Four skirts following the edge heights down to the bottom.
    const { nx, ny } = this;
    const edges = [
      { count: nx, idx: (t) => t, normal: [0, 0, 1] },                    // Y=0 (front)
      { count: nx, idx: (t) => t + (ny - 1) * nx, normal: [0, 0, -1] },   // Y=D (back)
      { count: ny, idx: (t) => t * nx, normal: [-1, 0, 0] },              // X=0
      { count: ny, idx: (t) => (nx - 1) + t * nx, normal: [1, 0, 0] },    // X=W
    ];
    this.sides = edges.map((e, ei) => {
      const pos = new Float32Array(e.count * 2 * 3);
      const nor = new Float32Array(e.count * 2 * 3);
      const col = new Float32Array(e.count * 2 * 3);
      const rough = new Float32Array(e.count * 2);
      const ind = [];
      for (let t = 0; t < e.count; t++) {
        for (let v = 0; v < 2; v++) {
          const q = (t * 2 + v) * 3;
          nor[q] = e.normal[0]; nor[q + 1] = e.normal[1]; nor[q + 2] = e.normal[2];
          const sh = 0.6 + 0.02 * Math.sin(t * 0.031) + 0.015 * Math.sin(t * 0.0137 + ei);
          col[q] = 0.82 * sh; col[q + 1] = 0.83 * sh; col[q + 2] = 0.85 * sh;
          rough[t * 2 + v] = 0.6;
        }
        if (t < e.count - 1) {
          const a = t * 2, b = a + 1, c = a + 2, d = a + 3;
          const flip = ei === 0 || ei === 3;
          if (!flip) ind.push(a, c, b, b, c, d); else ind.push(a, b, c, b, d, c);
        }
      }
      const g = new THREE.BufferGeometry();
      const pa = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('position', pa);
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('aRough', new THREE.BufferAttribute(rough, 1));
      g.setIndex(ind);
      const mesh = new THREE.Mesh(g, this.topMesh.material);
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.group.add(mesh);
      const side = { e, pa, mesh };
      this._updateSide(side);
      return side;
    });
    // bottom
    const bot = new THREE.Mesh(new THREE.PlaneGeometry(this.W, this.D), new THREE.MeshStandardMaterial({ color: 0x8a8d90, metalness: 1, roughness: 0.6 }));
    bot.rotation.x = Math.PI / 2; bot.position.y = this.bottomZ;
    this.group.add(bot);
  }

  _updateSide(side) {
    const { e, pa } = side;
    const arr = pa.array;
    for (let t = 0; t < e.count; t++) {
      const k = e.idx(t);
      const x = this.posAttr.array[k * 3], z = this.posAttr.array[k * 3 + 2];
      const q = t * 6;
      arr[q] = x; arr[q + 1] = this.h[k]; arr[q + 2] = z;
      arr[q + 3] = x; arr[q + 4] = this.bottomZ; arr[q + 5] = z;
    }
    pa.needsUpdate = true;
  }

  heightAt(X, Y) {
    const i = Math.round(X / this.cell), j = Math.round(Y / this.cell);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return null;
    return this.h[i + j * this.nx];
  }

  // Sweep the tool along a straight segment (work coords) and lower the field.
  // Returns removed volume (mm^3).
  carve(a, b, tool, spinPhase = 0) {
    const r = tool.dia / 2;
    const { cell, nx, ny, h } = this;
    const minX = Math.min(a.x, b.x) - r, maxX = Math.max(a.x, b.x) + r;
    const minY = Math.min(a.y, b.y) - r, maxY = Math.max(a.y, b.y) + r;
    const lowZ = Math.min(a.z, b.z);
    if (lowZ >= this.topZ + 0.001 && tool.type !== 'ball') return 0;
    const i0 = Math.max(0, Math.floor(minX / cell)), i1 = Math.min(nx - 1, Math.ceil(maxX / cell));
    const j0 = Math.max(0, Math.floor(minY / cell)), j1 = Math.min(ny - 1, Math.ceil(maxY / cell));
    if (i0 > i1 || j0 > j1) return 0;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const L2 = dx * dx + dy * dy;
    const r2 = r * r;
    const area = cell * cell;
    let vol = 0;
    let ti0 = 1e9, ti1 = -1, tj0 = 1e9, tj1 = -1;
    const face = tool.type === 'face';
    for (let j = j0; j <= j1; j++) {
      const py = j * cell;
      for (let i = i0; i <= i1; i++) {
        const px = i * cell;
        let t = 0;
        if (L2 > 1e-12) { t = ((px - a.x) * dx + (py - a.y) * dy) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t; }
        const cx = a.x + dx * t, cy = a.y + dy * t;
        const ddx = px - cx, ddy = py - cy;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 > r2) continue;
        const d = Math.sqrt(d2);
        const surf = a.z + dz * t + toolProfile(tool, d);
        const k = i + j * nx;
        if (surf < h[k] - 1e-4) {
          vol += (h[k] - surf) * area;
          h[k] = surf;
          // surface-finish signature (tool marks)
          let s;
          if (face) s = 0.9 + 0.07 * Math.sin(d * 1.1 + spinPhase * 0.0) * Math.sin(Math.atan2(ddy, ddx) * 2 + d * 0.15);
          else if (tool.type === 'ball') s = 0.93 + 0.03 * Math.sin(d * 4.0);
          else if (tool.type === 'drill' || tool.type === 'chamfer') s = 0.86 + 0.05 * Math.sin(d * 6);
          else s = 0.92 + 0.045 * Math.sin(d * 2.6 + (px + py) * 0.0);
          this.shade[k] = s;
          this.cut[k] = tool.type === 'face' ? 2 : 1;
          if (i < ti0) ti0 = i; if (i > ti1) ti1 = i;
          if (j < tj0) tj0 = j; if (j > tj1) tj1 = j;
        }
      }
    }
    if (ti1 >= 0) this._markDirty(ti0, tj0, ti1, tj1);
    this.removed += vol;
    return vol;
  }

  _markDirty(i0, j0, i1, j1) {
    if (!this.dirty) this.dirty = [i0, j0, i1, j1];
    else {
      const d = this.dirty;
      d[0] = Math.min(d[0], i0); d[1] = Math.min(d[1], j0);
      d[2] = Math.max(d[2], i1); d[3] = Math.max(d[3], j1);
    }
  }

  _refreshColors(i0, j0, i1, j1) {
    const { nx, h, shade, cut } = this;
    const col = this.colAttr.array, rough = this.roughAttr.array;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = i + j * nx;
      const s = shade[k];
      // aluminium 6061: neutral, faintly cool
      col[k * 3] = 0.86 * s; col[k * 3 + 1] = 0.875 * s; col[k * 3 + 2] = 0.9 * s;
      if (cut[k]) rough[k] = cut[k] === 2 ? 0.2 + (1 - s) * 0.9 : 0.24 + (1 - s) * 0.8;
    }
  }

  // Push dirty region to the GPU (positions, normals, colors).
  flush() {
    if (!this.dirty) return;
    let [i0, j0, i1, j1] = this.dirty;
    this.dirty = null;
    i0 = Math.max(0, i0 - 1); j0 = Math.max(0, j0 - 1);
    i1 = Math.min(this.nx - 1, i1 + 1); j1 = Math.min(this.ny - 1, j1 + 1);
    const { nx, ny, h, cell } = this;
    const pos = this.posAttr.array, nor = this.norAttr.array;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = i + j * nx;
      pos[k * 3 + 1] = h[k];
      const hl = h[i > 0 ? k - 1 : k], hr = h[i < nx - 1 ? k + 1 : k];
      const hd = h[j > 0 ? k - nx : k], hu = h[j < ny - 1 ? k + nx : k];
      // world: x = X, z = -Y
      const gx = (hr - hl) / (2 * cell), gy = (hu - hd) / (2 * cell);
      const nxv = -gx, nyv = 1, nzv = gy;
      const inv = 1 / Math.hypot(nxv, nyv, nzv);
      nor[k * 3] = nxv * inv; nor[k * 3 + 1] = nyv * inv; nor[k * 3 + 2] = nzv * inv;
    }
    this._refreshColors(i0, j0, i1, j1);
    const start = j0 * nx, count = (j1 - j0 + 1) * nx;
    for (const attr of [this.posAttr, this.norAttr, this.colAttr]) {
      attr.clearUpdateRanges(); attr.addUpdateRange(start * 3, count * 3); attr.needsUpdate = true;
    }
    this.roughAttr.clearUpdateRanges(); this.roughAttr.addUpdateRange(start, count); this.roughAttr.needsUpdate = true;
    if (i0 === 0 || j0 === 0 || i1 === nx - 1 || j1 === ny - 1) for (const s of this.sides) this._updateSide(s);
  }

  dispose() {
    this.group.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
  }
}
