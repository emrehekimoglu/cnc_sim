import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Chips: instanced curled aluminium swarf, simulated in table-local space so
// they ride along with the table once they land.
// ---------------------------------------------------------------------------
export class Chips {
  constructor(parent, max = 4000) {
    this.max = max;
    const geo = new THREE.TorusGeometry(1.1, 0.16, 3, 12, Math.PI * 1.5);
    geo.scale(1, 1, 0.5);
    const mat = new THREE.MeshStandardMaterial({ color: 0xe3e6ea, metalness: 1, roughness: 0.22, envMapIntensity: 1.2 });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    parent.add(this.mesh);
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.r = new Float32Array(max * 3);
    this.w = new Float32Array(max * 3);
    this.s = new Float32Array(max);
    this.alive = new Uint8Array(max); // 1 flying, 2 resting
    this.rest = new Float32Array(max);
    this.next = 0;
    this.count = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._v = new THREE.Vector3();
    this._sc = new THREE.Vector3();
    this.floorFn = () => -330;
  }

  clear() { this.alive.fill(0); this.count = 0; this.next = 0; this.mesh.count = 0; }

  spawn(pos, toolR, rpmSign, n, scale = 1, upBias = 1) {
    for (let k = 0; k < n; k++) {
      const i = this.next; this.next = (this.next + 1) % this.max;
      if (this.next > this.count) this.count = this.next;
      const a = Math.random() * Math.PI * 2;
      const ox = Math.cos(a) * toolR, oz = Math.sin(a) * toolR;
      this.p[i * 3] = pos.x + ox; this.p[i * 3 + 1] = pos.y + 0.5 + Math.random() * 1.5; this.p[i * 3 + 2] = pos.z + oz;
      // tangential ejection (CW spindle seen from above) + upward kick
      const sp = 350 + Math.random() * 900;
      const tx = -Math.sin(a) * rpmSign, tz = Math.cos(a) * rpmSign;
      this.v[i * 3] = (tx * 0.9 + Math.cos(a) * 0.35) * sp;
      this.v[i * 3 + 1] = (200 + Math.random() * 700) * upBias;
      this.v[i * 3 + 2] = (tz * 0.9 + Math.sin(a) * 0.35) * sp;
      this.r[i * 3] = Math.random() * 6; this.r[i * 3 + 1] = Math.random() * 6; this.r[i * 3 + 2] = Math.random() * 6;
      this.w[i * 3] = (Math.random() - 0.5) * 60; this.w[i * 3 + 1] = (Math.random() - 0.5) * 60; this.w[i * 3 + 2] = (Math.random() - 0.5) * 60;
      this.s[i] = scale * (0.6 + Math.random() * 0.9);
      this.alive[i] = 1;
    }
  }

  update(dt, wash = 0, stockBox = null) {
    const G = -9810;
    const { p, v, r, w, s, alive } = this;
    const m = this._m, q = this._q, e = this._e, pv = this._v, sc = this._sc;
    const step = Math.min(dt, 1 / 30);
    for (let i = 0; i < this.count; i++) {
      if (alive[i] === 1) {
        v[i * 3 + 1] += G * step;
        const drag = Math.exp(-1.8 * step);
        v[i * 3] *= drag; v[i * 3 + 2] *= drag;
        p[i * 3] += v[i * 3] * step; p[i * 3 + 1] += v[i * 3 + 1] * step; p[i * 3 + 2] += v[i * 3 + 2] * step;
        r[i * 3] += w[i * 3] * step; r[i * 3 + 1] += w[i * 3 + 1] * step; r[i * 3 + 2] += w[i * 3 + 2] * step;
        const fl = this.floorFn(p[i * 3], p[i * 3 + 2]);
        if (p[i * 3 + 1] < fl + 0.4) {
          p[i * 3 + 1] = fl + 0.4;
          if (Math.abs(v[i * 3 + 1]) < 250) { alive[i] = 2; this.rest[i] = 0; r[i * 3] = Math.PI / 2 + (Math.random() - 0.5) * 0.6; }
          else { v[i * 3 + 1] *= -0.25; v[i * 3] *= 0.45; v[i * 3 + 2] *= 0.45; w[i * 3] *= 0.5; }
        }
      }
      else if (alive[i] === 2 && wash > 0.3 && stockBox) {
        // coolant flood washes chips off the part
        const x = p[i * 3], z = p[i * 3 + 2];
        if (Math.abs(x) < stockBox.hw + 1 && Math.abs(z) < stockBox.hd + 1) {
          this.rest[i] += step * wash;
          if (this.rest[i] > 0.15 + Math.random() * 0.6) {
            const inv = 1 / (Math.hypot(x, z) + 1e-3);
            const sp = 120 + Math.random() * 260;
            v[i * 3] = (x * inv + (Math.random() - 0.5) * 0.8) * sp;
            v[i * 3 + 2] = (z * inv + (Math.random() - 0.5) * 0.8) * sp;
            v[i * 3 + 1] = 60 + Math.random() * 120;
            alive[i] = 1;
          }
        }
      }
      if (alive[i]) {
        e.set(r[i * 3], r[i * 3 + 1], r[i * 3 + 2]);
        q.setFromEuler(e);
        pv.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
        sc.setScalar(s[i]);
        m.compose(pv, q, sc);
      } else {
        m.makeScale(0, 0, 0);
      }
      this.mesh.setMatrixAt(i, m);
    }
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Coolant: flood streams from articulated nozzles + splash droplets.
// Simulated in world space.
// ---------------------------------------------------------------------------
function dropletTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(235,245,255,0.75)');
  grd.addColorStop(1, 'rgba(220,235,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Coolant {
  constructor(scene, max = 5000) {
    this.max = max;
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.kind = new Uint8Array(max);
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage);
    this.alpha = new Float32Array(max);
    this.alphaAttr = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('alpha', this.alphaAttr);
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: dropletTexture() }, size: { value: 2600 }, color: { value: new THREE.Color(0xdfeeff) } },
      vertexShader: `attribute float alpha; varying float vA; uniform float size;
        void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; gl_PointSize = size * (0.6 + alpha*0.4) / -mv.z; }`,
      fragmentShader: `uniform sampler2D map; uniform vec3 color; varying float vA;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); if (vA <= 0.0) discard; gl_FragColor = vec4(color, t.a * vA * 0.55); }`,
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.next = 0;
    this.on = false;
    this.flow = 0;
    // continuous laminar streams (one per nozzle)
    const c = document.createElement('canvas'); c.width = 16; c.height = 256;
    const g2 = c.getContext('2d');
    for (let y = 0; y < 256; y++) {
      const v = 150 + Math.random() * 105 * (Math.random() < 0.3 ? 1 : 0.4);
      g2.fillStyle = `rgb(${v},${v},${v})`; g2.fillRect(0, y, 16, 1);
    }
    this.streamTex = new THREE.CanvasTexture(c);
    this.streamTex.wrapS = this.streamTex.wrapT = THREE.RepeatWrapping;
    this.streamTex.repeat.set(1, 3);
    this.streamMat = new THREE.MeshStandardMaterial({ color: 0xeaf4ff, roughness: 0.05, metalness: 0.0, transparent: true, opacity: 0.0, alphaMap: this.streamTex, depthWrite: false, envMapIntensity: 2.2 });
    const sg = new THREE.CylinderGeometry(1.2, 2.1, 1, 10, 1, true);
    sg.translate(0, 0.5, 0);
    this.streams = [];
    this.scene = scene;
    this.streamGeo = sg;
    this._up = new THREE.Vector3(0, 1, 0);
  }

  _updateStreams(dt, nozzles, target) {
    while (this.streams.length < nozzles.length) {
      const m = new THREE.Mesh(this.streamGeo, this.streamMat);
      m.renderOrder = 3; m.frustumCulled = false;
      this.scene.add(m); this.streams.push(m);
    }
    this.streamTex.offset.y -= dt * 9;
    this.streamMat.opacity = 0.55 * this.flow;
    nozzles.forEach((nz, k) => {
      const m = this.streams[k];
      m.visible = this.flow > 0.02;
      // stream travels until it hits the tool (cylinder) or floor
      const len = Math.max(5, nz.dist ?? 120) * Math.min(1, this.flow * 1.4);
      m.position.copy(nz.tip);
      m.quaternion.setFromUnitVectors(this._up, nz.dir);
      m.scale.set(1, len, 1);
    });
  }

  clear() { this.life.fill(0); this.alpha.fill(0); this.alphaAttr.needsUpdate = true; }

  update(dt, nozzles, target, floorY) {
    this.flow += ((this.on ? 1 : 0) - this.flow) * Math.min(1, dt * 5);
    this._updateStreams(dt, nozzles, target);
    const emit = Math.floor(this.flow * dt * 1600);
    for (const nz of nozzles) {
      for (let k = 0; k < emit / nozzles.length; k++) {
        const i = this.next; this.next = (this.next + 1) % this.max;
        const dir = nz.dir;
        const sp = 1800 + Math.random() * 300;
        const spread = 0.035;
        this.p[i * 3] = nz.tip.x; this.p[i * 3 + 1] = nz.tip.y; this.p[i * 3 + 2] = nz.tip.z;
        const t = Math.random() * dt;
        this.v[i * 3] = (dir.x + (Math.random() - 0.5) * spread) * sp;
        this.v[i * 3 + 1] = (dir.y + (Math.random() - 0.5) * spread) * sp;
        this.v[i * 3 + 2] = (dir.z + (Math.random() - 0.5) * spread) * sp;
        this.p[i * 3] += this.v[i * 3] * t; this.p[i * 3 + 1] += this.v[i * 3 + 1] * t; this.p[i * 3 + 2] += this.v[i * 3 + 2] * t;
        this.life[i] = 0.6; this.kind[i] = 0;
      }
    }
    const G = -9810;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      this.v[i * 3 + 1] += G * dt * (this.kind[i] ? 1 : 0.3);
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      const fy = floorY(this.p[i * 3], this.p[i * 3 + 2]);
      if (this.kind[i] === 0 && this.p[i * 3 + 1] <= fy) {
        // splash: turn into a spray droplet bouncing outward
        this.kind[i] = 1;
        this.p[i * 3 + 1] = fy + 0.5;
        const a = Math.random() * Math.PI * 2, s = 300 + Math.random() * 900;
        this.v[i * 3] = Math.cos(a) * s; this.v[i * 3 + 2] = Math.sin(a) * s;
        this.v[i * 3 + 1] = 150 + Math.random() * 600;
        this.life[i] = Math.min(this.life[i], 0.18 + Math.random() * 0.22);
      } else if (this.kind[i] === 1 && this.p[i * 3 + 1] < fy) {
        this.life[i] = 0;
      }
      // the tool body deflects the stream a little
      const dx = this.p[i * 3] - target.x, dz = this.p[i * 3 + 2] - target.z;
      const rr = dx * dx + dz * dz;
      if (this.kind[i] === 0 && rr < target.r * target.r && this.p[i * 3 + 1] > target.y && this.p[i * 3 + 1] < target.top) {
        this.kind[i] = 1;
        const inv = 1 / Math.sqrt(rr + 1e-6);
        this.v[i * 3] = dx * inv * 600 + (Math.random() - 0.5) * 500;
        this.v[i * 3 + 2] = dz * inv * 600 + (Math.random() - 0.5) * 500;
        this.v[i * 3 + 1] = -200 - Math.random() * 400;
        this.life[i] = Math.min(this.life[i], 0.25);
      }
      this.alpha[i] = Math.min(1, this.life[i] * 6) * (this.kind[i] ? 0.6 : 1);
    }
    this.posAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
  }
}
