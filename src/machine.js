import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// World layout (mm, Y up). Table top at y = 0. Spindle axis at x = 0, z = 0.
// Machine X -> world +x (table moves), machine Y -> world -z (saddle moves),
// machine Z -> world +y (head moves).

export const VISE = { bedY: 95, jawTop: 145, grip: 8 };

function canvasTex(w, h, draw, { repeat = [1, 1], srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function noiseTex(size, base, amp, streak = 0) {
  return canvasTex(size, size, (g, w, h) => {
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const n = (Math.random() - 0.5) * amp + (streak ? Math.sin(y * streak + Math.random() * 0.4) * amp * 0.4 : 0);
      const v = Math.max(0, Math.min(255, base + n));
      const i = (x + y * w) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, { srgb: false });
}

export function makeMaterials() {
  const brushed = noiseTex(256, 180, 50, 0.9);
  brushed.repeat.set(4, 1);
  const ground = noiseTex(256, 150, 40, 2.5);
  ground.repeat.set(6, 2);
  const paintRough = noiseTex(128, 150, 22);
  paintRough.repeat.set(8, 8);
  const coverStripes = canvasTex(64, 512, (g, w, h) => {
    for (let y = 0; y < h; y++) {
      const seg = (y % 128);
      const v = seg < 3 ? 60 : seg < 6 ? 235 : 170 + Math.sin(y * 0.6) * 10 + Math.random() * 18;
      g.fillStyle = `rgb(${v},${v},${v + 3})`;
      g.fillRect(0, y, w, 1);
    }
  });
  return {
    paintLight: new THREE.MeshPhysicalMaterial({ color: 0xdfe1e2, roughness: 0.48, roughnessMap: paintRough, metalness: 0.0, clearcoat: 0.35, clearcoatRoughness: 0.35 }),
    paintDark: new THREE.MeshPhysicalMaterial({ color: 0x2b2e33, roughness: 0.55, roughnessMap: paintRough, metalness: 0.1, clearcoat: 0.25, clearcoatRoughness: 0.4 }),
    paintAccent: new THREE.MeshPhysicalMaterial({ color: 0xc8461f, roughness: 0.45, metalness: 0.0, clearcoat: 0.5, clearcoatRoughness: 0.25 }),
    castIron: new THREE.MeshStandardMaterial({ color: 0x3d4146, roughness: 0.7, roughnessMap: paintRough, metalness: 0.35 }),
    groundSteel: new THREE.MeshStandardMaterial({ color: 0x8f9398, roughness: 0.32, roughnessMap: ground, metalness: 1.0 }),
    steelDark: new THREE.MeshStandardMaterial({ color: 0x55595e, roughness: 0.38, roughnessMap: ground, metalness: 1.0 }),
    slot: new THREE.MeshStandardMaterial({ color: 0x24272a, roughness: 0.55, metalness: 0.8 }),
    stainless: new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.3, roughnessMap: brushed, metalness: 1.0 }),
    cover: new THREE.MeshStandardMaterial({ color: 0xc4c8cc, map: coverStripes, roughness: 0.28, metalness: 1.0 }),
    sheet: new THREE.MeshPhysicalMaterial({ color: 0x8e9398, roughness: 0.5, roughnessMap: paintRough, metalness: 0.0, clearcoat: 0.15 }),
    sheetGrey: new THREE.MeshStandardMaterial({ color: 0x9da2a7, roughness: 0.55, metalness: 0.2 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x141516, roughness: 0.85, metalness: 0.0 }),
    blackOxide: new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.4, metalness: 0.85 }),
    viseBody: new THREE.MeshPhysicalMaterial({ color: 0x45505c, roughness: 0.5, roughnessMap: paintRough, metalness: 0.15, clearcoat: 0.3, clearcoatRoughness: 0.4 }),
    hoseBlue: new THREE.MeshPhysicalMaterial({ color: 0x2d6fb5, roughness: 0.35, metalness: 0.0, clearcoat: 0.6 }),
    hoseOrange: new THREE.MeshPhysicalMaterial({ color: 0xe0782a, roughness: 0.35, metalness: 0.0, clearcoat: 0.6 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0, transmission: 0.92, thickness: 8, ior: 1.5, transparent: true, opacity: 0.35 }),
    ledPanel: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf4f7ff, emissiveIntensity: 2.2 }),
    floor: new THREE.MeshStandardMaterial({ color: 0x3e4247, roughness: 0.7, roughnessMap: paintRough, metalness: 0.0 }),
  };
}

const box = (w, h, d, m, x = 0, y = 0, z = 0, r = 0) => {
  const g = r > 0 ? new RoundedBoxGeometry(w, h, d, 3, r) : new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
};
const cyl = (rt, rb, h, m, segs = 48) => {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, segs), m);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
};

function labelTexture(text, sub) {
  return canvasTex(1024, 256, (g, w, h) => {
    g.fillStyle = '#2b2e33'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e8e9ea';
    g.font = '700 120px "Inter", "Helvetica Neue", Arial, sans-serif';
    g.textBaseline = 'middle';
    g.fillText(text, 40, h / 2 - 10);
    g.fillStyle = '#c8461f'; g.fillRect(40, h - 46, 160, 10);
    g.fillStyle = '#9aa0a6';
    g.font = '500 36px "Inter", Arial, sans-serif';
    g.fillText(sub, 230, h - 40);
  });
}

// Segmented coolant hose (articulated ball-joint style) along a curve.
function buildHose(points, mat, tipMat) {
  const curve = new THREE.CatmullRomCurve3(points);
  const g = new THREE.Group();
  const len = curve.getLength();
  const n = Math.floor(len / 9);
  const seg = new THREE.SphereGeometry(5.2, 16, 12);
  const neck = new THREE.CylinderGeometry(3.6, 3.6, 6, 12);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = curve.getPointAt(t);
    const s = new THREE.Mesh(seg, mat);
    s.position.copy(p); s.scale.set(1, 0.85, 1);
    const tan = curve.getTangentAt(t);
    s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan);
    s.castShadow = true;
    g.add(s);
    if (i < n) {
      const nk = new THREE.Mesh(neck, mat);
      nk.position.copy(curve.getPointAt((i + 0.5) / n));
      nk.quaternion.copy(s.quaternion);
      g.add(nk);
    }
  }
  const end = curve.getPointAt(1), dir = curve.getTangentAt(1);
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 4.5, 16, 16), tipMat);
  nozzle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  nozzle.position.copy(end).addScaledVector(dir, 8);
  g.add(nozzle);
  return { group: g, tip: end.clone().addScaledVector(dir, 16), dir };
}

export function buildMachine(scene, M) {
  const root = new THREE.Group();
  scene.add(root);

  // ---------------- static structure ----------------
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000), M.floor);
  floor.rotation.x = -Math.PI / 2; floor.position.y = -960; floor.receiveShadow = true;
  root.add(floor);

  // enclosure interior
  const enc = new THREE.Group(); root.add(enc);
  const EW = 1180, EB = -1120, EF = 720, EY0 = -340, EY1 = 1650;
  enc.add(box(2 * EW, 20, EF - EB, M.stainless, 0, EY0 - 10, (EF + EB) / 2)); // chip pan
  // sloped chip pan sides
  for (const s of [-1, 1]) {
    const slope = box(420, 12, EF - EB, M.stainless, s * (EW - 190), EY0 + 70, (EF + EB) / 2);
    slope.rotation.z = s * 0.38; enc.add(slope);
  }
  enc.add(box(2 * EW, EY1 - EY0, 20, M.sheet, 0, (EY0 + EY1) / 2, EB - 10)); // back
  for (const s of [-1, 1]) {
    enc.add(box(20, EY1 - EY0, EF - EB, M.sheet, s * (EW + 10), (EY0 + EY1) / 2, (EF + EB) / 2));
    // lower stainless splash guard
    enc.add(box(4, 360, EF - EB, M.stainless, s * (EW - 2), EY0 + 180, (EF + EB) / 2));
  }
  enc.add(box(2 * EW + 40, 20, EF - EB, M.sheet, 0, EY1 + 10, (EF + EB) / 2)); // roof
  // LED light bars
  const leds = [];
  for (const x of [-420, 420]) {
    const housing = box(70, 30, 900, M.sheetGrey, x, EY1 - 15, -150);
    enc.add(housing);
    const led = new THREE.Mesh(new THREE.PlaneGeometry(50, 880), M.ledPanel);
    led.rotation.x = Math.PI / 2; led.position.set(x, EY1 - 31, -150);
    enc.add(led); leds.push(led);
  }
  // front frame with sliding doors (open)
  const frame = new THREE.Group(); enc.add(frame);
  frame.add(box(2 * EW + 200, 260, 60, M.paintLight, 0, EY1 + 110, EF + 30, 6));
  frame.add(box(2 * EW + 200, 500, 60, M.paintLight, 0, EY0 - 250 + 80, EF + 30, 6));
  for (const s of [-1, 1]) {
    frame.add(box(160, EY1 - EY0 + 500, 60, M.paintLight, s * (EW + 80), (EY0 + EY1) / 2, EF + 30, 6));
    // door panel (slid open, mostly behind frame)
    const door = new THREE.Group();
    door.add(box(820, 1500, 18, M.paintLight, 0, 0, 0, 4));
    const win = new THREE.Mesh(new THREE.PlaneGeometry(560, 900), M.glass);
    win.position.set(0, 120, 10);
    door.add(win);
    door.add(box(600, 30, 24, M.rubber, 0, 585, 0));
    door.add(box(600, 30, 24, M.rubber, 0, -345, 0));
    door.add(box(30, 960, 24, M.rubber, -295, 120, 0));
    door.add(box(30, 960, 24, M.rubber, 295, 120, 0));
    const handle = box(30, 380, 40, M.stainless, -s * 360, 50, 22, 8);
    door.add(handle);
    door.position.set(s * (EW + 260), 520, EF + 80);
    frame.add(door);
  }
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(520, 130), new THREE.MeshStandardMaterial({ map: labelTexture('VMC-640', 'VERTICAL MACHINING CENTER'), roughness: 0.5 }));
  plate.position.set(-640, EY1 + 110, EF + 61);
  frame.add(plate);

  // base + Y guideway bed
  root.add(box(1500, 600, 1500, M.paintDark, 0, -660, -300));
  root.add(box(760, 200, 1180, M.castIron, 0, -240, -260));
  for (const s of [-1, 1]) {
    const rail = box(34, 26, 1150, M.groundSteel, s * 270, -127, -260);
    root.add(rail);
  }

  // column + Z rails
  const column = new THREE.Group(); root.add(column);
  column.add(box(860, 2050, 520, M.paintLight, 0, 650, -800, 10));
  column.add(box(860, 60, 540, M.paintDark, 0, -330, -800));
  for (const s of [-1, 1]) column.add(box(40, 1700, 30, M.groundSteel, s * 250, 700, -525));
  // ribs on column side
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) column.add(box(12, 200, 380, M.paintLight, s * 436, 0 + i * 420, -800, 3));

  // way covers (telescopic) - updated in update()
  const yCoverFront = box(700, 60, 100, M.cover, 0, -110, 0); root.add(yCoverFront);
  const yCoverBack = box(700, 60, 100, M.cover, 0, -110, 0); root.add(yCoverBack);
  // Z bellow above head
  const zBellow = box(420, 100, 40, M.rubber, 0, 0, -520); root.add(zBellow);

  // ---------------- saddle / table ----------------
  const saddle = new THREE.Group(); root.add(saddle);
  saddle.add(box(700, 100, 620, M.castIron, 0, -95, 0, 6));
  for (const s of [-1, 1]) {
    saddle.add(box(80, 40, 620, M.steelDark, s * 270, -125, 0)); // bearing blocks
    saddle.add(box(1100, 22, 30, M.groundSteel, 0, -38, s * 150)); // X rails
  }
  const table = new THREE.Group(); saddle.add(table);
  // table body
  table.add(box(1000, 56, 440, M.castIron, 0, -42, 0, 4));
  // slotted top: 4 lands + 3 T-slots running along X
  const slotW = 18, lands = [];
  // explicit lands (z ranges) leaving slots at z=-63, 0, 63
  const landRanges = [[-220, -63 - slotW / 2], [-63 + slotW / 2, -slotW / 2], [slotW / 2, 63 - slotW / 2], [63 + slotW / 2, 220]];
  for (const [a, b] of landRanges) {
    const land = box(1000, 16, b - a, M.groundSteel, 0, -8, (a + b) / 2);
    table.add(land); lands.push(land);
  }
  for (const z of [-63, 0, 63]) table.add(box(1000, 4, slotW, M.slot, 0, -15, z));
  // chip channel lips
  for (const s of [-1, 1]) table.add(box(1000, 26, 12, M.castIron, 0, -5, s * 226));
  for (const s of [-1, 1]) table.add(box(14, 30, 452, M.castIron, s * 507, -5, 0));

  // ---------------- vise ----------------
  const vise = new THREE.Group(); table.add(vise);
  const viseParts = { vise };
  vise.add(box(170, VISE.bedY - 20, 360, M.viseBody, 0, (VISE.bedY - 20) / 2, 30, 6));
  vise.add(box(150, 20, 330, M.groundSteel, 0, VISE.bedY - 10, 30)); // ways
  for (const s of [-1, 1]) {
    // clamp toes on T-slots
    vise.add(box(40, 22, 60, M.blackOxide, s * 110, 11, -63));
    vise.add(box(40, 22, 60, M.blackOxide, s * 110, 11, 120));
    const bolt = cyl(8, 8, 40, M.blackOxide, 6); bolt.position.set(s * 110, 30, -63); vise.add(bolt);
    const bolt2 = cyl(8, 8, 40, M.blackOxide, 6); bolt2.position.set(s * 110, 30, 120); vise.add(bolt2);
  }
  // fixed jaw body + plate (positions set when stock size known)
  const fixedJaw = new THREE.Group(); vise.add(fixedJaw);
  fixedJaw.add(box(170, VISE.jawTop - VISE.bedY + 10, 60, M.viseBody, 0, (VISE.jawTop + VISE.bedY - 10) / 2, -30 - 12, 4));
  fixedJaw.add(box(160, VISE.jawTop - VISE.bedY, 12, M.groundSteel, 0, (VISE.jawTop + VISE.bedY) / 2, -6));
  const moveJaw = new THREE.Group(); vise.add(moveJaw);
  moveJaw.add(box(170, VISE.jawTop - VISE.bedY + 5, 70, M.viseBody, 0, (VISE.jawTop + VISE.bedY - 5) / 2, 35 + 12, 4));
  moveJaw.add(box(160, VISE.jawTop - VISE.bedY, 12, M.groundSteel, 0, (VISE.jawTop + VISE.bedY) / 2, 6));
  // screw housing + handle
  const screwHousing = box(110, 70, 50, M.viseBody, 0, 50, 0, 6); vise.add(screwHousing);
  const screw = cyl(11, 11, 90, M.groundSteel, 20); screw.rotation.x = Math.PI / 2; vise.add(screw);
  const handleHub = cyl(16, 16, 40, M.blackOxide, 6); handleHub.rotation.x = Math.PI / 2; vise.add(handleHub);
  const crank = box(14, 14, 110, M.groundSteel, 0, 0, 0, 3); vise.add(crank);
  // parallels
  const parallels = [box(10, 10, 10, M.groundSteel), box(10, 10, 10, M.groundSteel)];
  parallels.forEach(p => vise.add(p));
  Object.assign(viseParts, { fixedJaw, moveJaw, screwHousing, screw, handleHub, crank, parallels });

  // ---------------- spindle head ----------------
  const head = new THREE.Group(); root.add(head);
  head.add(box(520, 640, 160, M.paintDark, 0, 380, -470, 8)); // Z carriage
  head.add(box(400, 560, 560, M.paintLight, 0, 380, -150, 14)); // head body
  head.add(box(404, 70, 564, M.paintDark, 0, 70, -150, 10)); // lower band
  for (const sx of [-1, 1]) {
    head.add(box(6, 12, 470, M.paintAccent, sx * 202, 560, -150, 2)); // accent pinstripe
    head.add(box(6, 260, 360, M.paintDark, sx * 201, 330, -170, 4)); // side service cover
    for (let i = 0; i < 4; i++) { const sc = cyl(5, 5, 4, M.stainless, 12); sc.rotation.z = Math.PI / 2; sc.position.set(sx * 205, 215 + (i >> 1) * 230, -335 + (i & 1) * 330); head.add(sc); }
  }
  // front cover with badge + vent slots
  head.add(box(330, 420, 8, M.paintDark, 0, 390, 132, 4));
  const badge = new THREE.Mesh(new THREE.PlaneGeometry(240, 60), new THREE.MeshStandardMaterial({ map: labelTexture('VMC-640', '15K SPINDLE · BT40'), roughness: 0.45 }));
  badge.position.set(0, 540, 136.5); head.add(badge);
  for (let i = 0; i < 7; i++) head.add(box(220, 7, 3, M.rubber, 0, 250 + i * 22, 137));
  // motor on top
  const motor = cyl(120, 120, 260, M.paintDark, 48); motor.position.set(0, 790, -150); head.add(motor);
  for (let i = 0; i < 18; i++) {
    const fin = box(6, 240, 30, M.castIron, 0, 790, 0);
    const a = (i / 18) * Math.PI * 2;
    fin.position.set(Math.cos(a) * 122, 790, -150 + Math.sin(a) * 122); fin.rotation.y = -a;
    head.add(fin);
  }
  // spindle cartridge and nose
  const cart = cyl(98, 104, 70, M.paintDark, 64); cart.position.y = 35 + 40; head.add(cart);
  const nose = cyl(78, 84, 40, M.steelDark, 64); nose.position.y = 20; head.add(nose);
  const noseRing = cyl(86, 86, 6, M.groundSteel, 64); noseRing.position.y = 37; head.add(noseRing);
  // coolant ring / manifold
  const manifold = new THREE.Mesh(new THREE.TorusGeometry(118, 9, 12, 64), M.stainless);
  manifold.rotation.x = Math.PI / 2; manifold.position.y = 58; manifold.castShadow = true; head.add(manifold);
  // work lamp
  const lamp = box(60, 40, 120, M.paintDark, -150, 30, 140, 8); head.add(lamp);
  const lampLens = new THREE.Mesh(new THREE.PlaneGeometry(46, 100), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6e8, emissiveIntensity: 3 }));
  lampLens.rotation.x = Math.PI / 2; lampLens.position.set(-150, 9.5, 140); head.add(lampLens);

  // coolant hoses (aim at a point ~70 mm below gauge line)
  const aim = new THREE.Vector3(0, -72, 0);
  const hoses = [];
  for (const [ang, m] of [[-0.35, M.hoseBlue], [-1.75, M.hoseOrange], [-2.95, M.hoseBlue]]) {
    const sx = Math.cos(ang) * 118, sz = Math.sin(ang) * 118;
    const p0 = new THREE.Vector3(sx, 50, sz);
    const p1 = new THREE.Vector3(sx * 1.05, 0, sz * 1.05);
    const p2 = new THREE.Vector3(sx * 0.82, -40, sz * 0.82);
    const dir = aim.clone().sub(p2).normalize();
    const p3 = p2.clone().addScaledVector(dir, 30);
    const h = buildHose([p0, p1, p2, p3], m, M.stainless);
    head.add(h.group);
    hoses.push({ tip: h.tip, dir: aim.clone().sub(h.tip).normalize() });
  }
  const spindle = new THREE.Group(); head.add(spindle); // tool mounts here (gauge line y=0)

  return { root, saddle, table, head, spindle, vise: viseParts, hoses, yCoverFront, yCoverBack, zBellow, leds, lands };
}

// Fit the vise jaws/parallels to the stock size.
export function fitVise(machine, stock) {
  const V = machine.vise;
  const D = stock.D, W = stock.W, H = stock.H;
  V.fixedJaw.position.z = -D / 2;
  V.moveJaw.position.z = D / 2;
  V.screwHousing.position.set(0, 50, D / 2 + 150);
  V.screw.position.set(0, 110, D / 2 + 120);
  V.handleHub.position.set(0, 110, D / 2 + 175);
  V.crank.position.set(45, 110, D / 2 + 190); V.crank.rotation.set(0, Math.PI / 2, 0);
  const bottom = VISE.jawTop - VISE.grip;
  const ph = bottom - VISE.bedY;
  V.parallels.forEach((p, i) => {
    p.geometry.dispose();
    p.geometry = new THREE.BoxGeometry(W + 30, ph, 6);
    p.position.set(0, VISE.bedY + ph / 2, (i ? 1 : -1) * (D / 2 - 6));
  });
  return bottom + H - (stock.topZ); // world y of work Z0 (table-local)
}
