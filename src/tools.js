import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------
// Tool library. Lengths are gauge length (spindle nose -> tip) in mm.
// ---------------------------------------------------------------------------
export const TOOLS = {
  1: { id: 1, name: 'Face Mill', desc: 'Ø50 5-insert face mill', type: 'face', dia: 50, length: 62, fluteLen: 8, flutes: 5, coating: 'insert', rpm: 6000 },
  2: { id: 2, name: 'End Mill', desc: 'Ø10 3FL carbide, AlTiN', type: 'flat', dia: 10, length: 78, fluteLen: 26, flutes: 3, coating: 'altin', rpm: 9500 },
  3: { id: 3, name: 'End Mill', desc: 'Ø6 3FL carbide, uncoated', type: 'flat', dia: 6, length: 68, fluteLen: 18, flutes: 3, coating: 'none', rpm: 12000 },
  4: { id: 4, name: 'Drill', desc: 'Ø6.8 HSS-Co 118°, TiN', type: 'drill', dia: 6.8, length: 96, fluteLen: 48, flutes: 2, coating: 'tin', rpm: 3800 },
  5: { id: 5, name: 'Ball Mill', desc: 'Ø6 R3 2FL ball nose', type: 'ball', dia: 6, length: 74, fluteLen: 16, flutes: 2, coating: 'altin', rpm: 14000 },
  6: { id: 6, name: 'Chamfer', desc: 'Ø12 90° spot/chamfer', type: 'chamfer', dia: 12, length: 70, fluteLen: 6, flutes: 4, coating: 'none', rpm: 8000 },
};

// Height of the cutter surface above the tip at radial distance d (mm).
export function toolProfile(tool, d) {
  const r = tool.dia / 2;
  switch (tool.type) {
    case 'ball': return r - Math.sqrt(Math.max(0, r * r - d * d));
    case 'drill': return d * 0.6009; // 1/tan(59°)
    case 'chamfer': return d; // 90° included
    default: return 0;
  }
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------
const mats = {};
function mat(key, params) {
  if (!mats[key]) mats[key] = new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide, ...params });
  return mats[key];
}
const coatingMat = (c) => ({
  altin: () => mat('altin', { color: 0x3a3740, metalness: 0.9, roughness: 0.32, clearcoat: 0.4, clearcoatRoughness: 0.3, iridescence: 0.35, iridescenceIOR: 1.8 }),
  tin: () => mat('tin', { color: 0xd8a948, metalness: 1, roughness: 0.28 }),
  none: () => mat('carbide', { color: 0xb9bcc0, metalness: 1, roughness: 0.22 }),
  insert: () => mat('carbide', { color: 0xb9bcc0, metalness: 1, roughness: 0.22 }),
}[c] || (() => mat('carbide', { color: 0xb9bcc0, metalness: 1, roughness: 0.22 })))();
const shankMat = () => mat('shank', { color: 0xc4c7cb, metalness: 1, roughness: 0.18 });
const holderMat = () => mat('holder', { color: 0x9da1a6, metalness: 1, roughness: 0.3 });
const holderDarkMat = () => mat('holderDark', { color: 0x2c2e31, metalness: 0.8, roughness: 0.4 });

// ---------------------------------------------------------------------------
// Fluted body: ring cross-sections twisted along a helix.
// ---------------------------------------------------------------------------
function flutedBody({ r, len, flutes, helixDeg, depth = 0.28, ball = false, drillTip = false, segs = 96, rows }) {
  rows = rows || Math.max(24, Math.round(len * 2.2));
  const positions = [];
  const twistPerMm = Math.tan(THREE.MathUtils.degToRad(helixDeg)) / r;
  const radiusAt = (theta) => {
    // groove profile: sharp cutting edge, curved gullet
    const u = ((theta * flutes) / (Math.PI * 2)) % 1;
    const uu = u < 0 ? u + 1 : u;
    const g = uu < 0.55 ? Math.pow(Math.sin((uu / 0.55) * Math.PI), 0.8) : 0;
    return r * (1 - depth * g);
  };
  const ringCount = rows + 1;
  const tipLen = ball ? r : drillTip ? r * 0.6009 : 0;
  for (let k = 0; k < ringCount; k++) {
    const y = (k / rows) * len; // from tip (0) upward
    let scale = 1;
    if (ball && y < r) scale = Math.sqrt(Math.max(0, 1 - Math.pow((r - y) / r, 2)));
    if (drillTip && y < tipLen) scale = y / tipLen;
    for (let s = 0; s <= segs; s++) {
      const th = (s / segs) * Math.PI * 2;
      const rad = radiusAt(th) * Math.max(scale, 0.0001);
      const a = th + y * twistPerMm;
      positions.push(Math.cos(a) * rad, y, Math.sin(a) * rad);
    }
  }
  const idx = [];
  for (let k = 0; k < rows; k++) for (let s = 0; s < segs; s++) {
    const a = k * (segs + 1) + s, b = a + segs + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function lathe(points, segs = 64) {
  if (points[0][1] > points[points.length - 1][1]) points = [...points].reverse();
  return new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), segs);
}

// ---------------------------------------------------------------------------
// Tool holder (BT/CAT style taper with flange, collet chuck)
// Origin = spindle gauge line, tool points down -Y.
// ---------------------------------------------------------------------------
function buildHolder(tool) {
  const g = new THREE.Group();
  // taper (inside spindle; partially visible) + flange with V-groove
  const flange = lathe([
    [0, 18], [22, 18], [31.75, 0], [31.75, -3], [36, -3], [36, -8], [31, -12], [36, -16], [36, -22], [27, -22], [0, -22],
  ], 72);
  const fl = new THREE.Mesh(flange, holderMat());
  g.add(fl);
  // drive key slots (dark notches)
  for (const s of [-1, 1]) {
    const key = new THREE.Mesh(new THREE.BoxGeometry(16.1, 14, 10), holderDarkMat());
    key.position.set(s * 31, -12, 0);
    g.add(key);
  }
  if (tool.type === 'face') {
    // shell mill arbor
    const arbor = lathe([[0, -22], [20, -22], [20, -40], [11, -40], [11, -44], [0, -44]], 48);
    g.add(new THREE.Mesh(arbor, holderMat()));
    return { group: g, noseY: -44 };
  }
  // collet chuck nose (ER style) + nut
  const nose = lathe([[0, -22], [25, -22], [21, -48], [17, -50], [0, -50]], 64);
  g.add(new THREE.Mesh(nose, holderMat()));
  const nut = lathe([[14, -46], [22, -46], [22, -60], [18, -64], [9, -64], [9, -60], [14, -58]], 6 * 8);
  const nutMesh = new THREE.Mesh(nut, holderDarkMat());
  g.add(nutMesh);
  // nut flats (slots)
  for (let i = 0; i < 6; i++) {
    const slot = new THREE.Mesh(new THREE.BoxGeometry(6, 6, 3), mat('slot', { color: 0x111214, metalness: 0.5, roughness: 0.6 }));
    const a = (i / 6) * Math.PI * 2;
    slot.position.set(Math.cos(a) * 21.2, -53, Math.sin(a) * 21.2);
    slot.rotation.y = -a + Math.PI / 2;
    g.add(slot);
  }
  return { group: g, noseY: -64 };
}

// ---------------------------------------------------------------------------
// Cutters (tip at y = 0, extending +Y)
// ---------------------------------------------------------------------------
function buildCutter(tool, exposedLen) {
  const g = new THREE.Group();
  const r = tool.dia / 2;
  const cm = coatingMat(tool.coating);
  switch (tool.type) {
    case 'face': {
      const bodyH = Math.min(exposedLen, 40);
      const body = lathe([[0, 0.5], [r - 4, 0.5], [r - 3, 4], [r - 3, bodyH * 0.55], [r * 0.78, bodyH], [0, bodyH]], 72);
      g.add(new THREE.Mesh(body, mat('faceBody', { color: 0x1d1f22, metalness: 0.7, roughness: 0.45 })));
      for (let i = 0; i < tool.flutes; i++) {
        const a = (i / tool.flutes) * Math.PI * 2;
        const pocket = new THREE.Group();
        const insert = new THREE.Mesh(new THREE.BoxGeometry(9.5, 3.4, 9.5), mat('insertGold', { color: 0xc8a24a, metalness: 1, roughness: 0.3 }));
        insert.position.set(r - 4.6, 2.2, 0);
        insert.rotation.set(0.0, 0.25, 0.12);
        pocket.add(insert);
        const chipPocket = new THREE.Mesh(new THREE.BoxGeometry(8, 9, 7), mat('pocketDark', { color: 0x0b0c0d, metalness: 0.3, roughness: 0.8 }));
        chipPocket.position.set(r - 6, 6, 6.5);
        pocket.add(chipPocket);
        const screw = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.6, 12), mat('screw', { color: 0x333333, metalness: 0.9, roughness: 0.4 }));
        screw.position.set(r - 4.6, 2.2, 0); screw.rotation.z = Math.PI / 2; screw.position.x += 0.1;
        pocket.add(screw);
        pocket.rotation.y = a;
        g.add(pocket);
      }
      const bolt = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 2, 6), holderDarkMat());
      bolt.position.y = 1.2;
      g.add(bolt);
      break;
    }
    case 'flat':
    case 'ball': {
      const flute = flutedBody({ r, len: tool.fluteLen, flutes: tool.flutes, helixDeg: tool.type === 'ball' ? 30 : 38, ball: tool.type === 'ball', depth: 0.3 });
      g.add(new THREE.Mesh(flute, cm));
      if (tool.type === 'flat') {
        // end face
        const face = new THREE.Mesh(new THREE.CircleGeometry(r * 0.72, 32), cm);
        face.rotation.x = Math.PI / 2; face.position.y = 0.02;
        g.add(face);
      }
      const shankR = tool.dia >= 8 ? r : Math.max(r, 3);
      const neck = lathe([[r * 0.7, tool.fluteLen], [shankR, tool.fluteLen + 3], [shankR, exposedLen + 30], [0, exposedLen + 30]], 48);
      g.add(new THREE.Mesh(neck, shankMat()));
      break;
    }
    case 'drill': {
      const flute = flutedBody({ r, len: tool.fluteLen, flutes: 2, helixDeg: 30, drillTip: true, depth: 0.42 });
      g.add(new THREE.Mesh(flute, cm));
      const shank = lathe([[r, tool.fluteLen], [r, exposedLen + 30], [0, exposedLen + 30]], 40);
      g.add(new THREE.Mesh(shank, cm));
      break;
    }
    case 'chamfer': {
      const tipFlat = 0.4;
      const coneH = r - tipFlat;
      const cone = lathe([[0, 0], [tipFlat, 0], [r, coneH], [r, coneH + 2], [4, coneH + 6], [4, exposedLen + 30], [0, exposedLen + 30]], 64);
      g.add(new THREE.Mesh(cone, mat('chamferBody', { color: 0xc0c3c7, metalness: 1, roughness: 0.25 })));
      // flute gashes
      for (let i = 0; i < tool.flutes; i++) {
        const gash = new THREE.Mesh(new THREE.BoxGeometry(0.8, coneH + 1, r * 0.9), mat('pocketDark', { color: 0x0b0c0d, metalness: 0.3, roughness: 0.8 }));
        gash.position.set(0, coneH / 2 + 0.5, r * 0.45);
        const piv = new THREE.Group(); piv.add(gash); piv.rotation.y = (i / tool.flutes) * Math.PI * 2;
        gash.rotation.x = -Math.PI / 4;
        g.add(piv);
      }
      break;
    }
  }
  return g;
}

export function buildToolAssembly(tool) {
  const root = new THREE.Group();
  const { group: holder, noseY } = buildHolder(tool);
  root.add(holder);
  const exposed = tool.length + noseY; // tip at -tool.length
  const cutter = buildCutter(tool, Math.max(exposed, 4));
  cutter.position.y = -tool.length;
  root.add(cutter);
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return root;
}

// Merge helper exported for other modules
export { mergeGeometries };
