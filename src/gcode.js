// Minimal G-code interpreter: turns program text into a flat list of motion
// segments the simulator can play back. Supports the subset our sample
// programs use: G0/G1/G2/G3 (incl. helical), G17, G21, G40, G43, G49, G54,
// G80/G81/G83 canned cycles, G90/G91, M3/M5/M6/M8/M9/M30, F, S, T, comments.

const RAPID_FEED = 18000; // mm/min
const ARC_SEG_LEN = 0.8; // mm

function stripComment(line) {
  let comment = '';
  const code = line.replace(/\(([^)]*)\)/g, (_, c) => {
    comment += (comment ? ' ' : '') + c.trim();
    return ' ';
  }).replace(/;.*$/, '');
  return { code: code.trim().toUpperCase(), comment };
}

function parseWords(code) {
  const words = [];
  const re = /([A-Z])\s*([-+]?\d*\.?\d+)/g;
  let m;
  while ((m = re.exec(code))) words.push([m[1], parseFloat(m[2])]);
  return words;
}

export function parseProgram(text, toolTable) {
  const lines = text.split(/\r?\n/);
  const segments = [];
  const state = {
    pos: { x: 0, y: 0, z: 150 },
    motion: 0,
    abs: true,
    feed: 500,
    spindle: 0,
    spindleOn: false,
    coolant: false,
    tool: 0,
    pendingTool: 0,
    cycle: null, // { type, z, r, q, f }
    retractMode: 99,
  };
  const SAFE_Z = 150; // tool change height (work coords)

  const push = (seg) => {
    seg.tool = state.tool;
    seg.spindle = state.spindleOn ? state.spindle : 0;
    seg.coolant = state.coolant;
    segments.push(seg);
  };

  const linear = (to, type, line, feed) => {
    const from = { ...state.pos };
    const len = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    if (len < 1e-6) { state.pos = { ...to }; return; }
    const f = type === 'rapid' ? RAPID_FEED : Math.max(1, feed);
    push({ type, from, to: { ...to }, len, duration: (len / f) * 60, feed: f, line });
    state.pos = { ...to };
  };

  const arc = (to, cw, i, j, line) => {
    const from = { ...state.pos };
    const cx = from.x + i, cy = from.y + j;
    const r = Math.hypot(i, j);
    let a0 = Math.atan2(from.y - cy, from.x - cx);
    let a1 = Math.atan2(to.y - cy, to.x - cx);
    let sweep = a1 - a0;
    if (cw) { if (sweep >= -1e-9) sweep -= Math.PI * 2; }
    else { if (sweep <= 1e-9) sweep += Math.PI * 2; }
    // Non-full arcs that numerically land on start: treat properly
    const arcLen = Math.abs(sweep) * r;
    const n = Math.max(4, Math.ceil(Math.hypot(arcLen, to.z - from.z) / ARC_SEG_LEN));
    let prev = from;
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const a = a0 + sweep * t;
      const p = k === n ? { ...to } : { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, z: from.z + (to.z - from.z) * t };
      const len = Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z);
      if (len > 1e-7) push({ type: 'feed', from: prev, to: p, len, duration: (len / state.feed) * 60, feed: state.feed, line, arc: true });
      prev = p;
    }
    state.pos = { ...to };
  };

  const runCycle = (x, y, line) => {
    const c = state.cycle;
    const startZ = state.pos.z;
    const clearZ = c.retract === 98 ? Math.max(startZ, c.r) : c.r;
    linear({ x, y, z: state.pos.z }, 'rapid', line);
    linear({ x, y, z: c.r }, 'rapid', line);
    if (c.type === 81 || !c.q) {
      linear({ x, y, z: c.z }, 'feed', line, c.f);
    } else {
      // G83 peck: feed down a peck, retract to R, rapid back near last depth
      let depth = c.r;
      while (depth > c.z + 1e-6) {
        const next = Math.max(c.z, depth - c.q);
        if (depth < c.r) linear({ x, y, z: depth + 0.5 }, 'rapid', line);
        linear({ x, y, z: next }, 'feed', line, c.f);
        depth = next;
        if (depth > c.z + 1e-6) linear({ x, y, z: c.r }, 'rapid', line);
      }
    }
    linear({ x, y, z: clearZ }, 'rapid', line);
  };

  lines.forEach((raw, lineIdx) => {
    const { code, comment } = stripComment(raw);
    if (!code) return;
    const words = parseWords(code);
    const g = words.filter(w => w[0] === 'G').map(w => w[1]);
    const m = words.filter(w => w[0] === 'M').map(w => w[1]);
    const get = (L) => { const w = words.find(w => w[0] === L); return w ? w[1] : undefined; };

    const F = get('F'), S = get('S'), T = get('T');
    if (F !== undefined) state.feed = F;
    if (S !== undefined) state.spindle = S;
    if (T !== undefined) state.pendingTool = T;

    let cycleThisLine = false;
    for (const code of g) {
      if (code === 0 || code === 1 || code === 2 || code === 3) { state.motion = code; state.cycle = null; }
      else if (code === 90) state.abs = true;
      else if (code === 91) state.abs = false;
      else if (code === 80) state.cycle = null;
      else if (code === 98 || code === 99) state.retractMode = code;
      else if (code === 81 || code === 83) {
        state.cycle = {
          type: code,
          z: get('Z'), r: get('R') ?? 2, q: code === 83 ? get('Q') : 0,
          f: F ?? state.feed, retract: state.retractMode,
        };
        cycleThisLine = true;
      }
    }

    if (m.includes(6)) {
      // Tool change: retract, swap, event
      linear({ ...state.pos, z: SAFE_Z }, 'rapid', lineIdx);
      state.spindleOn = false;
      const prevTool = state.tool;
      state.tool = state.pendingTool;
      push({ type: 'toolchange', from: { ...state.pos }, to: { ...state.pos }, len: 0, duration: 2.2, line: lineIdx, fromTool: prevTool, comment });
    }
    if (m.includes(3)) state.spindleOn = true;
    if (m.includes(5)) state.spindleOn = false;
    if (m.includes(8)) state.coolant = true;
    if (m.includes(9)) state.coolant = false;
    if (m.includes(3) || m.includes(5)) {
      push({ type: 'dwell', from: { ...state.pos }, to: { ...state.pos }, len: 0, duration: m.includes(3) ? 0.8 : 0.4, line: lineIdx });
    }

    const X = get('X'), Y = get('Y'), Z = get('Z');
    const hasAxis = X !== undefined || Y !== undefined || Z !== undefined;
    if (!hasAxis) {
      if (m.includes(30) || m.includes(2)) {
        state.coolant = false; state.spindleOn = false;
        linear({ ...state.pos, z: SAFE_Z }, 'rapid', lineIdx);
        push({ type: 'end', from: { ...state.pos }, to: { ...state.pos }, len: 0, duration: 0, line: lineIdx });
      }
      return;
    }

    const target = state.abs
      ? { x: X ?? state.pos.x, y: Y ?? state.pos.y, z: Z ?? state.pos.z }
      : { x: state.pos.x + (X ?? 0), y: state.pos.y + (Y ?? 0), z: state.pos.z + (Z ?? 0) };

    if (state.cycle) {
      if (cycleThisLine || X !== undefined || Y !== undefined) runCycle(target.x, target.y, lineIdx);
      return;
    }

    if (state.motion === 0) linear(target, 'rapid', lineIdx);
    else if (state.motion === 1) linear(target, 'feed', lineIdx, state.feed);
    else arc(target, state.motion === 2, get('I') ?? 0, get('J') ?? 0, lineIdx);

    if (m.includes(30) || m.includes(2)) {
      push({ type: 'end', from: { ...state.pos }, to: { ...state.pos }, len: 0, duration: 0, line: lineIdx });
    }
  });

  let t = 0;
  for (const s of segments) { s.t0 = t; t += s.duration; }
  return { segments, lines, totalTime: t };
}
