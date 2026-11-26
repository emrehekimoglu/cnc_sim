// Generates G-code for the three demo parts.
import { TOOLS, toolProfile } from './tools.js';

const fmt = (v) => {
  let s = (Math.round(v * 1000) / 1000).toFixed(3).replace(/0+$/, '');
  if (s === '-0.') s = '0.';
  return s;
};

class Emitter {
  constructor() { this.lines = []; this.n = 10; this.cur = { x: 0, y: 0, z: 150 }; }
  raw(s) { this.lines.push(s); }
  blk(s) { this.lines.push(`N${this.n} ${s}`); this.n += 10; }
  comment(s) { this.lines.push(`(${s})`); }
  axes(p) {
    let s = '';
    if (p.x !== undefined) { s += ` X${fmt(p.x)}`; this.cur.x = p.x; }
    if (p.y !== undefined) { s += ` Y${fmt(p.y)}`; this.cur.y = p.y; }
    if (p.z !== undefined) { s += ` Z${fmt(p.z)}`; this.cur.z = p.z; }
    return s;
  }
  g0(p) { this.raw(`G0${this.axes(p)}`); }
  g1(p, f) { this.raw(`G1${this.axes(p)}${f ? ` F${Math.round(f)}` : ''}`); }
  arc(p, cx, cy, cw, f) {
    const i = cx - this.cur.x, j = cy - this.cur.y;
    this.raw(`${cw ? 'G2' : 'G3'}${this.axes(p)} I${fmt(i)} J${fmt(j)}${f ? ` F${Math.round(f)}` : ''}`);
  }
  circle(cx, cy, r, cw, f) {
    // from current (assumed at cx+r, cy)
    this.arc({ x: cx + r, y: cy }, cx, cy, cw, f);
  }
  toolChange(t, rpm, comment) {
    const tool = TOOLS[t];
    this.raw('');
    this.comment(`${comment || tool.name.toUpperCase()} - ${tool.desc.toUpperCase()}`);
    this.blk(`T${t} M6`);
    this.blk(`S${rpm || tool.rpm} M3`);
  }
  approach(x, y, safe = 25) {
    this.g0({ x, y });
    this.raw(`G43 H${this._tool || ''} Z${fmt(safe)} M8`.replace('H ', 'H'));
  }
  path(prims, f) {
    for (const p of prims) {
      if (p.type === 'line') this.g1({ x: p.x, y: p.y }, f);
      else this.arc({ x: p.x, y: p.y }, p.cx, p.cy, p.cw, f);
      f = undefined;
    }
  }
}

// --- geometry helpers ------------------------------------------------------
function roundedRect(cx, cy, hx, hy, r, cw) {
  r = Math.max(0, Math.min(r, hx, hy));
  const start = { x: cx, y: cy - hy };
  const P = [];
  const L = (x, y) => P.push({ type: 'line', x, y });
  const A = (x, y, ax, ay) => { if (r > 0.01) P.push({ type: 'arc', x, y, cx: ax, cy: ay, cw: true }); };
  L(cx - hx + r, cy - hy); A(cx - hx, cy - hy + r, cx - hx + r, cy - hy + r);
  L(cx - hx, cy + hy - r); A(cx - hx + r, cy + hy, cx - hx + r, cy + hy - r);
  L(cx + hx - r, cy + hy); A(cx + hx, cy + hy - r, cx + hx - r, cy + hy - r);
  L(cx + hx, cy - hy + r); A(cx + hx - r, cy - hy, cx + hx - r, cy - hy + r);
  L(start.x, start.y);
  return { start, prims: cw ? P : reversePath(start, P) };
}

function reversePath(start, prims) {
  const pts = [start, ...prims.map(p => ({ x: p.x, y: p.y }))];
  const out = [];
  for (let i = prims.length - 1; i >= 0; i--) {
    const p = prims[i], to = pts[i];
    if (p.type === 'line') out.push({ type: 'line', x: to.x, y: to.y });
    else out.push({ type: 'arc', x: to.x, y: to.y, cx: p.cx, cy: p.cy, cw: !p.cw });
  }
  return out;
}

function hexPath(cx, cy, apothem) {
  const R = apothem / Math.cos(Math.PI / 6);
  const pts = [];
  for (let k = 0; k <= 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    pts.push({ type: 'line', x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R });
  }
  return { start: pts[0], prims: pts.slice(1) };
}

function helixDown(e, cx, cy, r, fromZ, toZ, pitch, f) {
  e.g1({ x: cx + r, y: cy }, f);
  let z = fromZ;
  while (z > toZ + 1e-6) {
    z = Math.max(toZ, z - pitch);
    e.arc({ x: cx + r, y: cy, z }, cx, cy, false, f);
  }
  e.arc({ x: cx + r, y: cy }, cx, cy, false); // clean-up turn at depth
}

const header = (e, o, name, stock) => {
  e.raw('%');
  e.raw(`O${o} (${name})`);
  e.comment(`STOCK ${stock} - AL 6061-T6`);
  e.comment('WCS G54: X0 Y0 = FRONT LEFT CORNER, Z0 = FINISHED TOP');
  e.blk('G21 G17 G40 G49 G80 G90');
  e.blk('G54');
};
const footer = (e, W, D) => {
  e.raw('');
  e.blk('M5 M9');
  e.blk('G0 Z150.');
  e.blk(`G0 X${fmt(W / 2)} Y${fmt(D / 2)} (PRESENT PART)`);
  e.blk('M30');
  e.raw('%');
};
const startTool = (e, t, x, y, comment) => {
  e.toolChange(t, null, comment);
  e._tool = t;
  e.g0({ x, y });
  e.blk(`G43 H${t} Z25. M8`); e.cur.z = 25;
};
const endTool = (e) => { e.g0({ z: 25 }); e.blk('M9'); };

function facing(e, W, D, overhang = 30) {
  startTool(e, 1, -overhang, 0, 'OP10 FACE TOP');
  const r = TOOLS[1].dia / 2;
  const step = TOOLS[1].dia * 0.7;
  e.g0({ z: 2 });
  let y = r * 0.3;
  let dir = 1;
  e.g1({ y }, 2400);
  e.g1({ z: 0 }, 800);
  e.raw('F2400');
  while (true) {
    e.g1({ x: dir > 0 ? W + overhang : -overhang });
    if (y >= D - r * 0.3 - 1e-6) break;
    y = Math.min(D - r * 0.3, y + step);
    e.g1({ y });
    dir = -dir;
  }
  endTool(e);
}

// ---------------------------------------------------------------------------
// Part 1 : Bracket plate
// ---------------------------------------------------------------------------
function bracketPlate() {
  const W = 120, D = 80, e = new Emitter();
  header(e, 1001, 'BRACKET PLATE', '120 X 80 X 31');
  facing(e, W, D);

  // OP20 outer shoulder
  startTool(e, 2, 60, -12, 'OP20 ROUGH SHOULDER');
  e.g0({ z: 2 });
  for (const z of [-2, -4, -6, -8]) {
    e.g1({ z }, 600);
    for (const off of [13, 5]) {
      const rr = roundedRect(60, 40, 50 + off, 30 + off, 8 + off, true);
      e.g1({ x: rr.start.x, y: rr.start.y }, 1400);
      e.path(rr.prims, 1600);
    }
    e.g1({ x: 60, y: -12 });
  }
  endTool(e);

  // OP30 center pocket
  e.raw(''); e.comment('OP30 POCKET 50 X 30 X 10 DEEP');
  e.g0({ x: 60, y: 40 }); e.g0({ z: 2 });
  let prevZ = 0.5;
  for (const z of [-2.5, -5, -7.5, -10]) {
    helixDown(e, 60, 40, 2.5, prevZ, z, 1.0, 900);
    e.g1({ x: 50, y: 40 }, 1500);
    e.g1({ x: 70, y: 40 });
    for (const k of [2, 1, 0]) {
      const rr = roundedRect(60, 40, 20 - 4 * k, 10 - 4 * k, 1, false);
      e.g1({ x: rr.start.x, y: rr.start.y });
      e.path(rr.prims);
    }
    e.g1({ x: 60, y: 40 });
    prevZ = z + 0.5;
  }
  endTool(e);

  // OP40 circular pockets with 6mm
  startTool(e, 3, 22, 40, 'OP40 BORE POCKETS D14');
  for (const cx of [22, 98]) {
    e.g0({ x: cx, y: 40 }); e.g0({ z: 2 });
    let pz = 0.5;
    for (const z of [-3, -6]) {
      helixDown(e, cx, 40, 1.5, pz, z, 0.8, 700);
      e.g1({ x: cx + 4, y: 40 }, 1300);
      e.circle(cx, 40, 4, false);
      e.g1({ x: cx, y: 40 });
      pz = z + 0.5;
    }
    e.g0({ z: 5 });
  }
  endTool(e);

  // OP50 drilling
  startTool(e, 4, 20, 20, 'OP50 DRILL 4X D6.8');
  e.g0({ z: 5 });
  e.blk('G99 G83 X20. Y20. Z-22. R2. Q4. F180');
  e.raw('X100.'); e.raw('Y60.'); e.raw('X20.');
  e.blk('G80');
  endTool(e);

  // OP60 chamfer
  startTool(e, 6, 60, 2, 'OP60 CHAMFER EDGES 1X45');
  e.g0({ z: -1.5 + 3 });
  e.g1({ z: -1.5 }, 800);
  let rr = roundedRect(60, 40, 50.5, 30.5, 8.5, true);
  e.g1({ x: rr.start.x, y: rr.start.y }, 1200);
  e.path(rr.prims);
  e.g1({ x: 60, y: 2 });
  e.g0({ z: 5 });
  e.g0({ x: 60, y: 40 });
  e.g1({ z: -1.5 }, 800);
  rr = roundedRect(60, 40, 24.5, 14.5, 6.5, false);
  e.g1({ x: rr.start.x, y: rr.start.y }, 1200);
  e.path(rr.prims);
  e.g1({ x: 60, y: 40 });
  e.g0({ z: 5 });
  for (const cx of [22, 98]) {
    e.g0({ x: cx, y: 40 }); e.g1({ z: -1.5 }, 800);
    e.g1({ x: cx + 7.5 }, 1200); e.circle(cx, 40, 7.5, false); e.g1({ x: cx });
    e.g0({ z: 5 });
  }
  endTool(e);
  footer(e, W, D);
  return { text: e.lines.join('\n'), stock: { width: W, depth: D, height: 31, topZ: 1 } };
}

// ---------------------------------------------------------------------------
// Part 2 : Freeform mould insert (drop-cutter raster toolpaths)
// ---------------------------------------------------------------------------
function moldSurface(x, y) {
  // rim frame at Z0, drafted cavity walls, floor with two organic bosses
  const hx = 42, hy = 42, cr = 12; // cavity half-size + corner radius
  const qx = Math.abs(x - 50) - (hx - cr), qy = Math.abs(y - 50) - (hy - cr);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - cr;
  const e = -outside; // distance inside the cavity outline
  if (e <= 0) return 0;
  let z = -16;
  z += 13 * Math.exp(-((x - 38) ** 2 + (y - 59) ** 2) / 240);
  z += 9.5 * Math.exp(-((x - 64) ** 2 + (y - 37) ** 2) / 170);
  z += 1.1 * Math.sin(x * 0.2) * Math.cos(y * 0.16);
  // drafted wall (about 68 deg) blending into a floor fillet
  const wall = -e * 2.5;
  const k = 3;
  const m = Math.max(z, wall);
  const blend = Math.max(0, k - Math.abs(z - wall)) ** 2 / (4 * k);
  return Math.min(m + blend, -0.4);
}

function dropCutter(tool, x, y, surf) {
  const r = tool.dia / 2;
  const step = Math.max(0.5, r / 6);
  let z = -1e9;
  for (let dy = -r; dy <= r + 1e-6; dy += step) for (let dx = -r; dx <= r + 1e-6; dx += step) {
    const d = Math.hypot(dx, dy);
    if (d > r) continue;
    const v = surf(x + dx, y + dy) - toolProfile(tool, d);
    if (v > z) z = v;
  }
  return z;
}

function moldInsert() {
  const W = 100, D = 100, e = new Emitter();
  header(e, 1002, 'MOULD INSERT - FREEFORM', '100 X 100 X 41');
  facing(e, W, D);

  // OP20 Z-level raster roughing, 0.6 stock to leave
  const t2 = TOOLS[2];
  startTool(e, 2, 3, 3, 'OP20 RASTER ROUGH - 0.6 STOCK');
  e.g0({ z: 2 });
  for (const level of [-3, -6, -9, -12, -15]) {
    e.comment(`Z LEVEL ${level}`);
    let dir = 1;
    let first = true;
    for (let y = 4; y <= 96.01; y += 6) {
      const xs = [];
      for (let x = 4; x <= 96.01; x += 1.2) xs.push(x);
      if (dir < 0) xs.reverse();
      for (const x of xs) {
        const z = Math.max(level, dropCutter(t2, x, y, moldSurface) + 0.6);
        if (first) { e.g0({ x, y }); e.g1({ z }, 500); e.raw('F2200'); first = false; }
        else e.g1({ x, y, z });
      }
      dir = -dir;
    }
    e.g0({ z: 3 });
  }
  endTool(e);

  // OP30 ball-nose finishing
  const t5 = TOOLS[5];
  startTool(e, 5, 5, 5, 'OP30 FINISH RASTER 0.7 STEPOVER');
  e.g0({ z: 2 });
  let dir = 1, first = true;
  for (let y = 5; y <= 95.01; y += 0.7) {
    const xs = [];
    for (let x = 5; x <= 95.01; x += 0.9) xs.push(x);
    if (dir < 0) xs.reverse();
    let last = null;
    for (const x of xs) {
      const z = dropCutter(t5, x, y, moldSurface);
      if (first) { e.g0({ x, y }); e.g1({ z }, 600); e.raw('F3200'); first = false; continue; }
      // skip redundant collinear points on flat rim
      if (last && Math.abs(z - last.z) < 1e-4 && Math.abs(z) < 1e-4 && x !== xs[xs.length - 1]) { last = { x, z }; continue; }
      e.g1({ x, y, z });
      last = { x, z };
    }
    dir = -dir;
  }
  endTool(e);
  footer(e, W, D);
  return { text: e.lines.join('\n'), stock: { width: W, depth: D, height: 41, topZ: 1 } };
}

// ---------------------------------------------------------------------------
// Part 3 : Hub flange
// ---------------------------------------------------------------------------
function hubFlange() {
  const W = 100, D = 100, C = 50, e = new Emitter();
  header(e, 1003, 'HUB FLANGE D90', '100 X 100 X 31');
  facing(e, W, D);

  startTool(e, 2, 125, C, 'OP20 TURN-OFF OD90 PROFILE');
  e.g0({ z: 2 });
  for (const z of [-2.5, -5, -7.5, -10]) {
    e.g1({ z }, 600);
    for (const R of [66, 58, 50]) {
      e.g1({ x: C + R, y: C }, 1500);
      e.circle(C, C, R, true, 1700);
    }
    e.g1({ x: 125 });
  }
  e.g0({ z: 2 });
  e.comment('OP25 HUB SHOULDER');
  e.g0({ x: 100, y: C });
  for (const z of [-2.5, -5]) {
    e.g1({ z }, 600);
    for (const R of [41, 34, 27]) {
      e.g1({ x: C + R }, 1500);
      e.circle(C, C, R, true, 1700);
    }
    e.g1({ x: 100 });
  }
  endTool(e);

  startTool(e, 3, C, C, 'OP30 HEX SOCKET AF20');
  e.g0({ z: 2 });
  let pz = 0.5;
  for (const z of [-2, -4, -6, -8]) {
    helixDown(e, C, C, 1.5, pz, z, 0.8, 700);
    for (const a of [2.5, 4.5, 7]) {
      const hp = hexPath(C, C, a);
      e.g1({ x: hp.start.x, y: hp.start.y }, 1200);
      e.path(hp.prims);
    }
    e.g1({ x: C, y: C });
    pz = z + 0.5;
  }
  endTool(e);

  startTool(e, 4, C + 34, C, 'OP40 DRILL 6X D6.8 ON PCD68');
  e.g0({ z: 5 });
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const x = C + Math.cos(a) * 34, y = C + Math.sin(a) * 34;
    if (k === 0) e.blk(`G99 G83 X${fmt(x)} Y${fmt(y)} Z-21. R-3. Q4. F180`);
    else e.raw(`X${fmt(x)} Y${fmt(y)}`);
  }
  e.blk('G80');
  endTool(e);

  startTool(e, 6, C + 30, C, 'OP50 CHAMFER HUB + OD');
  e.g0({ z: 2 });
  e.g1({ z: -1.5 }, 800);
  e.g1({ x: C + 22.5 }, 1200); e.circle(C, C, 22.5, true); e.g1({ x: C + 30 });
  e.g0({ z: 2 });
  e.g0({ x: 100, y: C });
  e.g1({ z: -6.5 }, 800);
  e.g1({ x: C + 45.5 }, 1200); e.circle(C, C, 45.5, true); e.g1({ x: 100 });
  // bolt-hole spot chamfers
  e.g0({ z: -3 });
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    e.g0({ x: C + Math.cos(a) * 34, y: C + Math.sin(a) * 34 });
    e.g1({ z: -9.2 }, 500); e.g0({ z: -3 });
  }
  endTool(e);
  footer(e, W, D);
  return { text: e.lines.join('\n'), stock: { width: W, depth: D, height: 31, topZ: 1 } };
}

export const PROGRAMS = [
  { id: 'bracket', code: 'O1001', name: 'Bracket Plate', subtitle: 'Prismatic · shoulder, pocket, bores, drilling', material: 'AL 6061-T6', build: bracketPlate, tools: [1, 2, 3, 4, 6] },
  { id: 'flange', code: 'O1003', name: 'Hub Flange', subtitle: 'Circular interpolation · hex socket · PCD holes', material: 'AL 6061-T6', build: hubFlange, tools: [1, 2, 3, 4, 6] },
  { id: 'mold', code: 'O1002', name: 'Mould Insert', subtitle: '3D freeform · Z-level rough · ball-nose finish', material: 'AL 7075-T6', build: moldInsert, tools: [1, 2, 5] },
];
