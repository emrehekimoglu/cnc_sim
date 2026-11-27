import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';

import { buildMachine, makeMaterials, fitVise, VISE } from './machine.js';
import { Stock } from './stock.js';
import { TOOLS, buildToolAssembly } from './tools.js';
import { parseProgram } from './gcode.js';
import { PROGRAMS } from './programs.js';
import { Chips, Coolant } from './effects.js';
import { MachineAudio } from './audio.js';

const $ = (id) => document.getElementById(id);

// ===========================================================================
// Renderer / scene
// ===========================================================================
const container = $('viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b1d20);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

const camera = new THREE.PerspectiveCamera(34, window.innerWidth / window.innerHeight, 5, 30000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 120;
controls.maxDistance = 3200;
controls.maxPolarAngle = Math.PI * 0.53;

// lights
RectAreaLightUniformsLib.init();
scene.add(new THREE.HemisphereLight(0xf2f5ff, 0x30343a, 0.45));
const key = new THREE.DirectionalLight(0xfff8f0, 2.4);
key.position.set(260, 1500, 520);
key.castShadow = true;
key.shadow.mapSize.set(4096, 4096);
key.shadow.camera.left = -520; key.shadow.camera.right = 520;
key.shadow.camera.top = 520; key.shadow.camera.bottom = -520;
key.shadow.camera.near = 600; key.shadow.camera.far = 2600;
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.6;
key.shadow.radius = 3;
scene.add(key);
scene.add(key.target);
for (const x of [-420, 420]) {
  const ra = new THREE.RectAreaLight(0xf4f7ff, 5, 50, 880);
  ra.position.set(x, 1610, -150);
  ra.lookAt(x, 0, -150);
  scene.add(ra);
}
const fill = new THREE.DirectionalLight(0xdbe6ff, 0.5);
fill.position.set(-900, 500, 900);
scene.add(fill);
const workLamp = new THREE.SpotLight(0xfff1dc, 120000, 1400, 0.65, 0.6, 2);
scene.add(workLamp); scene.add(workLamp.target);

// post-processing
const rt = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const gtao = new GTAOPass(scene, camera, window.innerWidth, window.innerHeight);
gtao.updateGtaoMaterial({ radius: 22, distanceExponent: 1.5, thickness: 8, scale: 1.1, samples: 16, distanceFallOff: 1 });
gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
gtao.blendIntensity = 0.85;
composer.addPass(gtao);
composer.addPass(new OutputPass());

// ===========================================================================
// Machine
// ===========================================================================
const M = makeMaterials();
const machine = buildMachine(scene, M);
machine.zBellow.visible = false;
const stockHolder = new THREE.Group();
machine.table.add(stockHolder);
const chips = new Chips(machine.table);
const coolant = new Coolant(scene);
const audio = new MachineAudio();

// work offsets for MACHINE coordinate display
const G54 = { x: -412.553, y: -203.117, z: -478.22 };

// ===========================================================================
// State
// ===========================================================================
const S = {
  progIdx: 0,
  built: {},
  parsed: null,
  stock: null,
  yZ0: 0,
  i: 0, frac: 0,
  pos: { x: 0, y: 0, z: 150 },
  running: false, hold: false, single: false, done: false, blockStop: false,
  speed: 5, feedOvr: 1, rapidOvr: 1,
  simTime: 0,
  mounted: 0, toolMesh: null,
  rpm: 0, load: 0, feedNow: 0,
  coolantOn: true, chipsOn: true, pathOn: false, aoOn: true, soundOn: false,
  coordMode: 'work',
  spin: 0,
  lastLine: -1,
  toolChangeAnim: null,
  usedTools: new Set(),
};

// ===========================================================================
// Program loading
// ===========================================================================
let pathLines = null, pathSegMap = [], pathColored = 0;

function buildProgram(idx) {
  if (!S.built[idx]) {
    const p = PROGRAMS[idx];
    const r = p.build();
    const parsed = parseProgram(r.text, TOOLS);
    const ops = [];
    let op = 'SETUP';
    parsed.lines.forEach((ln, k) => {
      const m = ln.match(/\((OP\d+[^)]*)\)/);
      if (m) op = m[1].replace(/\s+-\s+.*$/, '');
      ops[k] = op;
    });
    S.built[idx] = { ...r, parsed, ops };
  }
  return S.built[idx];
}

function loadProgram(idx) {
  S.progIdx = idx;
  const prog = PROGRAMS[idx];
  const b = buildProgram(idx);
  S.parsed = b.parsed;
  if (S.stock) { stockHolder.remove(S.stock.group); S.stock.dispose(); }
  S.stock = new Stock(b.stock);
  stockHolder.add(S.stock.group);
  S.yZ0 = fitVise(machine, S.stock);
  stockHolder.position.set(0, S.yZ0, 0);
  chips.clear(); coolant.clear();
  chips.floorFn = chipFloor;
  buildPath();
  resetSim();
  // UI
  $('ocode').textContent = prog.code;
  $('progName').textContent = prog.name;
  $('matLabel').textContent = prog.material;
  $('stockLabel').textContent = `${b.stock.width} × ${b.stock.depth} × ${b.stock.height} mm`;
  $('blockLabel').textContent = S.parsed.lines.length.toLocaleString();
  $('estLabel').textContent = fmtTime(S.parsed.totalTime);
  document.querySelectorAll('.prog-card').forEach((c, k) => c.classList.toggle('on', k === idx));
  renderToolTable();
  code.setLines(S.parsed.lines);
  setView(currentView, true);
}

function resetSim() {
  S.i = 0; S.frac = 0; S.simTime = 0;
  S.running = false; S.hold = false; S.done = false; S.blockStop = false;
  S.rpm = 0; S.load = 0; S.feedNow = 0; S.lastLine = -1;
  S.toolChangeAnim = null;
  S.usedTools = new Set();
  const first = S.parsed.segments.find(s => s.type === 'toolchange');
  mountTool(first ? first.tool : 2);
  S.pos = { ...S.parsed.segments[0].from };
  S.pos.x = S.stock.W / 2; S.pos.y = S.stock.D / 2;
  if (pathLines) recolorPath(0, true);
}

function mountTool(t) {
  if (S.toolMesh) { machine.spindle.remove(S.toolMesh); }
  S.mounted = t;
  if (!t || !TOOLS[t]) { S.toolMesh = null; return; }
  S.toolMesh = buildToolAssembly(TOOLS[t]);
  machine.spindle.add(S.toolMesh);
  renderToolTable();
}

// table-local floor height for chips (and coolant via conversion)
function chipFloor(lx, lz) {
  const st = S.stock;
  const X = lx + st.W / 2, Y = -lz + st.D / 2;
  if (X >= 0 && X <= st.W && Y >= 0 && Y <= st.D) return S.yZ0 + st.heightAt(X, Y);
  if (Math.abs(lx) < 85) {
    if (lz < -st.D / 2 && lz > -st.D / 2 - 72) return VISE.jawTop;
    if (lz > st.D / 2 && lz < st.D / 2 + 82) return VISE.jawTop - 5;
    if (lz > -150 && lz < 210) return VISE.bedY;
  }
  if (Math.abs(lx) < 500 && Math.abs(lz) < 220) return 0;
  return -330;
}

// ===========================================================================
// Toolpath preview
// ===========================================================================
function buildPath() {
  if (pathLines) { stockHolder.remove(pathLines); pathLines.geometry.dispose(); }
  const st = S.stock;
  const pts = [], cols = [];
  pathSegMap = [];
  const L = (p) => [p.x - st.W / 2, p.z, -(p.y - st.D / 2)];
  S.parsed.segments.forEach((s, k) => {
    if (s.type !== 'rapid' && s.type !== 'feed') { pathSegMap[k] = -1; return; }
    pathSegMap[k] = pts.length / 3;
    pts.push(...L(s.from), ...L(s.to));
    const c = s.type === 'rapid' ? [1.0, 0.45, 0.2] : [0.3, 0.8, 1.0];
    cols.push(...c, ...c);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  pathLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false }));
  pathLines.visible = S.pathOn;
  pathLines.renderOrder = 2;
  stockHolder.add(pathLines);
  pathColored = 0;
}

function recolorPath(upTo, reset = false) {
  const col = pathLines.geometry.attributes.color;
  const segs = S.parsed.segments;
  if (reset) {
    segs.forEach((s, k) => {
      const v = pathSegMap[k]; if (v < 0 || v === undefined) return;
      const c = s.type === 'rapid' ? [1.0, 0.45, 0.2] : [0.3, 0.8, 1.0];
      col.setXYZ(v, ...c); col.setXYZ(v + 1, ...c);
    });
    pathColored = 0;
  }
  for (let k = pathColored; k < upTo && k < segs.length; k++) {
    const v = pathSegMap[k]; if (v < 0 || v === undefined) continue;
    col.setXYZ(v, 0.22, 0.24, 0.27); col.setXYZ(v + 1, 0.22, 0.24, 0.27);
  }
  pathColored = Math.max(pathColored, upTo);
  col.needsUpdate = true;
}

// ===========================================================================
// Simulation
// ===========================================================================
const segEff = (s) => s.type === 'rapid' ? s.duration / S.rapidOvr : s.type === 'feed' ? s.duration / S.feedOvr : s.duration;

let removedFrame = 0, chipBudget = 0, lastCarvePos = null;

function carveTo(from, to, seg) {
  const tool = TOOLS[S.mounted];
  if (!tool) return;
  const v = S.stock.carve(from, to, tool);
  removedFrame += v;
}

function stepSim(dt) {
  if (!S.running || S.hold || S.done) return;
  const segs = S.parsed.segments;
  let budget = dt * S.speed;
  let guard = 0;
  while (budget > 1e-9 && S.i < segs.length && guard++ < 20000) {
    const seg = segs[S.i];
    if (S.frac === 0) onSegStart(seg);
    const eff = segEff(seg);
    const rem = eff * (1 - S.frac);
    let f1;
    if (budget >= rem || eff <= 0) { f1 = 1; budget -= Math.max(rem, 0); S.simTime += seg.duration * (1 - S.frac); }
    else { const df = budget / eff; f1 = S.frac + df; S.simTime += seg.duration * df; budget = 0; }
    const p = {
      x: seg.from.x + (seg.to.x - seg.from.x) * f1,
      y: seg.from.y + (seg.to.y - seg.from.y) * f1,
      z: seg.from.z + (seg.to.z - seg.from.z) * f1,
    };
    if (seg.type === 'feed') carveTo(S.pos, p, seg);
    S.pos = p;
    if (seg.type === 'toolchange') {
      S.toolChangeAnim = { seg, f: f1 };
      if (f1 >= 0.5 && S.mounted !== seg.tool) { S.usedTools.add(S.mounted); mountTool(seg.tool); }
    }
    if (f1 >= 1) {
      S.frac = 0; S.i++;
      onSegEnd(seg);
      if (S.done) break;
      if (S.single && S.i < segs.length && segs[S.i].line !== seg.line) { S.hold = true; S.blockStop = true; break; }
    } else S.frac = f1;
  }
  if (S.i >= segs.length) finish();
}

function onSegStart(seg) {
  if (seg.type === 'toolchange') {
    const t = TOOLS[seg.tool];
    toast(`Tool change <b>T${seg.tool}</b> ${t.name} · ${t.desc}`);
  }
}
function onSegEnd(seg) {
  if (seg.type === 'toolchange') { S.toolChangeAnim = null; }
  if (seg.type === 'end') finish();
}
function finish() {
  S.done = true; S.running = false;
  toast('Program complete · <b>M30</b>');
  recolorPath(S.parsed.segments.length);
}

function currentSeg() { return S.parsed.segments[Math.min(S.i, S.parsed.segments.length - 1)]; }

// ===========================================================================
// Per-frame visual update
// ===========================================================================
const _v = new THREE.Vector3();
function updateMachineVisual(dt) {
  const st = S.stock;
  const seg = currentSeg();
  const tool = TOOLS[S.mounted];
  const len = tool ? tool.length : 100;
  // axis positions
  const lx = S.pos.x - st.W / 2;
  const lz = -(S.pos.y - st.D / 2);
  machine.table.position.x = -lx;
  machine.saddle.position.z = -lz;
  const tipY = S.yZ0 + S.pos.z;
  machine.head.position.y = tipY + len;
  // way covers
  const sz = machine.saddle.position.z;
  const fStart = sz + 310, fEnd = 640;
  machine.yCoverFront.scale.z = Math.max(0.05, (fEnd - fStart) / 100);
  machine.yCoverFront.position.z = (fStart + fEnd) / 2;
  const bStart = -540, bEnd = sz - 310;
  machine.yCoverBack.scale.z = Math.max(0.05, (bEnd - bStart) / 100);
  machine.yCoverBack.position.z = (bStart + bEnd) / 2;

  // spindle speed (ramped)
  const target = S.running && !S.hold && seg && seg.type !== 'toolchange' ? seg.spindle : (S.hold ? S.rpm * 0 : 0);
  const holdTarget = S.hold && seg ? seg.spindle : target; // feed hold keeps spindle running
  const tgt = S.done ? 0 : (S.hold ? holdTarget : target);
  const acc = 7000 * dt;
  S.rpm += Math.max(-acc, Math.min(acc, tgt - S.rpm));
  const omega = Math.min(S.rpm * Math.PI * 2 / 60, 38 + S.rpm * 0.0012);
  S.spin += omega * dt;

  // tool change animation
  if (S.toolMesh) {
    let dy = 0, dx = 0;
    const tc = S.toolChangeAnim;
    if (tc && S.running) {
      const f = tc.f;
      const ease = (t) => t * t * (3 - 2 * t);
      if (f < 0.3) dy = -ease(f / 0.3) * 110;
      else if (f < 0.5) { dy = -110; dx = ease((f - 0.3) / 0.2) * 520; }
      else if (f < 0.7) { dy = -110; dx = (1 - ease((f - 0.5) / 0.2)) * 520; }
      else dy = -(1 - ease((f - 0.7) / 0.3)) * 110;
    }
    S.toolMesh.position.set(dx, dy, 0);
    S.toolMesh.rotation.y = -S.spin;
  }

  // feed now
  const moving = S.running && !S.hold && seg && (seg.type === 'feed' || seg.type === 'rapid');
  const fTarget = moving ? (seg.type === 'rapid' ? seg.feed * S.rapidOvr : seg.feed * S.feedOvr) : 0;
  S.feedNow += (fTarget - S.feedNow) * Math.min(1, dt * 12);

  // load from removal rate
  const simDt = Math.max(1e-4, dt * S.speed);
  const mrr = removedFrame / simDt; // mm^3/s
  const cap = tool ? { face: 2600, flat: tool.dia * 60, drill: 140, ball: 90, chamfer: 45 }[tool.type] : 1;
  const loadT = Math.min(1.3, mrr / cap);
  S.load += (loadT - S.load) * Math.min(1, dt * 6);

  // chips
  if (S.chipsOn && removedFrame > 0 && tool) {
    chipBudget += removedFrame * (tool.type === 'face' ? 0.05 : tool.type === 'drill' ? 0.3 : 0.25);
    const n = Math.min(Math.floor(chipBudget), Math.max(1, Math.round(25 * dt * 60)));
    if (n > 0) {
      chipBudget -= n; chipBudget = Math.min(chipBudget, 50);
      _v.set(lx, tipY + 1, lz);
      const sc = tool.type === 'face' ? 1.0 : tool.type === 'drill' ? 0.75 : Math.max(0.45, tool.dia / 12);
      chips.spawn(_v, tool.dia / 2, 1, n, sc, tool.type === 'drill' ? 1.4 : 1);
    }
  }
  removedFrame = 0;
  chips.mesh.visible = S.chipsOn;
  chips.update(dt, coolant.flow, S.stock ? { hw: S.stock.W / 2, hd: S.stock.D / 2 } : null);

  // coolant
  const coolOn = S.coolantOn && S.running && !S.done && seg && seg.coolant && !S.toolChangeAnim;
  coolant.on = coolOn || (S.coolantOn && S.hold && seg && seg.coolant);
  machine.head.updateMatrixWorld(true);
  const aimY = tipY + (tool ? Math.min(14, tool.fluteLen * 0.5) : 10);
  const nozzles = machine.hoses.map(h => {
    const tip = machine.head.localToWorld(h.tip.clone());
    const to = new THREE.Vector3(0, aimY, 0).sub(tip);
    const dist = Math.max(0, to.length() - (tool ? tool.dia / 2 : 3));
    return { tip, dir: to.normalize(), dist };
  });
  const tx = machine.table.position.x, tz = machine.saddle.position.z;
  coolant.update(dt, nozzles, { x: 0, z: 0, y: tipY, top: tipY + (tool ? tool.fluteLen + 10 : 30), r: tool ? tool.dia / 2 + 1 : 4 },
    (x, z) => chipFloor(x - tx, z - tz));

  // work lamp follows head
  workLamp.position.set(-150, machine.head.position.y + 10, 140);
  workLamp.target.position.set(0, S.yZ0, 0);

  S.stock.flush();
  if (pathLines && S.pathOn) recolorPath(S.i);

  audio.update({ rpm: S.rpm, load: S.load, coolant: coolant.flow, rapid: moving && seg.type === 'rapid', flutes: tool ? tool.flutes : 3 });
}

// ===========================================================================
// Camera views
// ===========================================================================
let currentView = 'iso';
let camAnim = null;
function viewDef(v) {
  const y = S.yZ0 || 160;
  switch (v) {
    case 'front': return { pos: [0, y + 140, 640], tgt: [0, y - 10, 0] };
    case 'top': return { pos: [0, y + 360, 330], tgt: [0, y - 15, 0] };
    case 'close': return { pos: [215, y + 120, 275], tgt: [0, y - 10, 0] };
    case 'wide': return { pos: [1050, y + 650, 1650], tgt: [0, y + 120, -250] };
    default: return { pos: [430, y + 300, 560], tgt: [0, y - 10, 0] };
  }
}
function setView(v, instant = false) {
  currentView = v;
  const d = viewDef(v);
  const to = { pos: new THREE.Vector3(...d.pos), tgt: new THREE.Vector3(...d.tgt) };
  if (instant) { camera.position.copy(to.pos); controls.target.copy(to.tgt); controls.update(); return; }
  camAnim = { from: { pos: camera.position.clone(), tgt: controls.target.clone() }, to, t: 0 };
  document.querySelectorAll('#views button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
}
function updateCamera(dt) {
  if (!camAnim) return;
  camAnim.t = Math.min(1, camAnim.t + dt / 0.9);
  const e = 1 - Math.pow(1 - camAnim.t, 3);
  camera.position.lerpVectors(camAnim.from.pos, camAnim.to.pos, e);
  controls.target.lerpVectors(camAnim.from.tgt, camAnim.to.tgt, e);
  if (camAnim.t >= 1) camAnim = null;
}
controls.addEventListener('start', () => { camAnim = null; });

// ===========================================================================
// UI
// ===========================================================================
function fmtTime(s) {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
const fmtN = (v) => (v < 0 ? '-' : ' ') + Math.abs(v).toFixed(3).padStart(7, ' ');

let toastTimer = 0;
function toast(html) {
  const t = $('toast');
  t.innerHTML = html; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

const ICONS = {
  bracket: `<svg viewBox="0 0 40 40" fill="none" stroke="#cfd4da" stroke-width="1.4"><rect x="4" y="9" width="32" height="22" rx="3"/><rect x="13.5" y="15" width="13" height="10" rx="1.5" stroke="#ff9e6b"/><circle cx="9" cy="20" r="2.4"/><circle cx="31" cy="20" r="2.4"/><circle cx="7.5" cy="12.5" r="1"/><circle cx="32.5" cy="12.5" r="1"/><circle cx="7.5" cy="27.5" r="1"/><circle cx="32.5" cy="27.5" r="1"/></svg>`,
  flange: `<svg viewBox="0 0 40 40" fill="none" stroke="#cfd4da" stroke-width="1.4"><circle cx="20" cy="20" r="16"/><circle cx="20" cy="20" r="8.5"/><path d="M24 20l-2 3.46h-4L16 20l2-3.46h4z" stroke="#ff9e6b"/><g fill="#cfd4da" stroke="none"><circle cx="32" cy="20" r="1.3"/><circle cx="8" cy="20" r="1.3"/><circle cx="26" cy="30.4" r="1.3"/><circle cx="14" cy="30.4" r="1.3"/><circle cx="26" cy="9.6" r="1.3"/><circle cx="14" cy="9.6" r="1.3"/></g></svg>`,
  mold: `<svg viewBox="0 0 40 40" fill="none" stroke="#cfd4da" stroke-width="1.3"><rect x="4" y="4" width="32" height="32" rx="2"/><rect x="8" y="8" width="24" height="24" rx="4"/><path d="M10 26c3-1 4-9 7-9s3 5 6 3 4-7 7-6" stroke="#ff9e6b"/><path d="M10 30c4-1 6-4 10-4s6 2 10 1" stroke="#8a929b"/></svg>`,
};

function renderPrograms() {
  const el = $('programList');
  el.innerHTML = '';
  PROGRAMS.forEach((p, k) => {
    const b = document.createElement('button');
    b.className = 'prog-card';
    b.innerHTML = `<div class="thumb">${ICONS[p.id]}</div><div><div class="t">${p.name}<code>${p.code}</code></div><div class="s">${p.subtitle}</div></div>`;
    b.onclick = () => { if (S.running && !S.hold) return toast('Feed hold or reset before changing program'); loadProgram(k); };
    el.appendChild(b);
  });
}

function renderToolTable() {
  const el = $('toolTable');
  const prog = PROGRAMS[S.progIdx];
  el.innerHTML = prog.tools.map(t => {
    const tl = TOOLS[t];
    const cls = t === S.mounted ? 'active' : (S.usedTools.has(t) ? 'used' : '');
    return `<div class="tool-row ${cls}"><span class="tn">T${String(t).padStart(2, '0')}</span><div class="td"><b>${tl.name} Ø${tl.dia}</b><span>${tl.desc.replace(/^Ø[\d.]+\s*/, '')}</span></div><div class="tl">L ${tl.length.toFixed(1)}<br>${tl.rpm} rpm</div></div>`;
  }).join('');
  $('toolHint').textContent = `${prog.tools.length} tools`;
  $('activeTool').textContent = S.mounted ? `T${S.mounted} · Ø${TOOLS[S.mounted].dia}` : '—';
}

// ---- virtualised code listing ---------------------------------------------
const code = (() => {
  const box = $('code'), inner = $('codeInner');
  const LH = 19;
  let lines = [], cur = -1, userScroll = 0, rendered = '';
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const hl = (s) => {
    if (!s) return '&nbsp;';
    const m = s.match(/^([^(]*)(\(.*)?$/);
    let codePart = esc(m[1] || ''), comment = m[2] ? `<span class="tok-c">${esc(m[2])}</span>` : '';
    codePart = codePart
      .replace(/\b(N\d+)/g, '<span class="tok-n">$1</span>')
      .replace(/\b(G\d+(?:\.\d+)?)/g, '<span class="tok-g">$1</span>')
      .replace(/\b(M\d+)/g, '<span class="tok-m">$1</span>')
      .replace(/\b(T\d+|H\d+)/g, '<span class="tok-t">$1</span>')
      .replace(/\b([FS][\d.]+)/g, '<span class="tok-f">$1</span>');
    return codePart + comment;
  };
  function render() {
    const top = box.scrollTop, h = box.clientHeight;
    const a = Math.max(0, Math.floor(top / LH) - 10), b = Math.min(lines.length, Math.ceil((top + h) / LH) + 10);
    const key = `${a}:${b}:${cur}`;
    if (key === rendered) return;
    rendered = key;
    let html = '';
    for (let k = a; k < b; k++) {
      const cls = k === cur ? 'ln cur' : k < cur ? 'ln done' : 'ln';
      html += `<div class="${cls}" style="top:${k * LH}px"><span class="no">${k + 1}</span><span>${hl(lines[k])}</span></div>`;
    }
    inner.innerHTML = html;
  }
  box.addEventListener('scroll', () => { render(); }, { passive: true });
  box.addEventListener('wheel', () => { userScroll = performance.now(); }, { passive: true });
  return {
    setLines(l) { lines = l; inner.style.height = `${l.length * LH}px`; cur = -1; box.scrollTop = 0; rendered = ''; render(); },
    setCurrent(k) {
      if (k === cur) return;
      cur = k;
      if (performance.now() - userScroll > 2500) {
        const want = k * LH - box.clientHeight * 0.4;
        box.scrollTop = Math.max(0, want);
      }
      rendered = ''; render();
    },
  };
})();

function setStatus() {
  const el = $('status');
  let cls = '', txt = 'READY';
  if (S.done) { cls = 'done'; txt = 'COMPLETE'; }
  else if (S.running && S.blockStop) { cls = 'hold'; txt = 'BLOCK STOP'; }
  else if (S.running && S.hold) { cls = 'hold'; txt = 'FEED HOLD'; }
  else if (S.running && S.toolChangeAnim) { cls = 'run'; txt = 'TOOL CHANGE'; }
  else if (S.running) { cls = 'run'; txt = 'RUNNING'; }
  el.className = 'status ' + cls;
  el.querySelector('span').textContent = txt;
  $('btnStart').classList.toggle('active', S.running && !S.hold);
  $('btnHold').classList.toggle('active', S.running && S.hold);
  $('btnSingle').classList.toggle('active', S.single);
}

let uiTick = 0;
function updateUI(dt) {
  uiTick += dt;
  if (uiTick < 1 / 30) return;
  uiTick = 0;
  const seg = currentSeg();
  const tool = TOOLS[S.mounted];
  const len = tool ? tool.length : 0;
  const work = S.pos;
  const mach = { x: work.x + G54.x, y: work.y + G54.y, z: work.z + G54.z + len };
  const dtg = seg && (seg.type === 'feed' || seg.type === 'rapid') ? { x: seg.to.x - work.x, y: seg.to.y - work.y, z: seg.to.z - work.z } : { x: 0, y: 0, z: 0 };
  const primary = S.coordMode === 'mach' ? mach : S.coordMode === 'dtg' ? dtg : work;
  const secondary = S.coordMode === 'work' ? mach : work;
  for (const a of ['x', 'y', 'z']) {
    $('dro' + a.toUpperCase()).textContent = fmtN(primary[a]);
    $('dro' + a.toUpperCase() + '2').textContent = (S.coordMode === 'work' ? 'M ' : 'W ') + secondary[a].toFixed(3);
  }
  $('rpm').textContent = Math.round(S.rpm).toLocaleString();
  $('feed').textContent = Math.round(S.feedNow).toLocaleString();
  $('loadBar').style.width = `${Math.min(100, S.load * 100)}%`;
  $('loadBar').style.backgroundPosition = `${-Math.min(1, S.load) * 0}px 0`;
  $('loadPct').textContent = `${Math.round(S.load * 100)}%`;
  $('feedBar').style.width = `${Math.min(100, S.feedNow / 40)}%`;

  const total = S.parsed.totalTime;
  const t = Math.min(total, S.simTime);
  $('cycleTime').textContent = fmtTime(t);
  $('remainTime').textContent = fmtTime(total - t);
  $('removed').textContent = `${(S.stock.removed / 1000).toFixed(1)} cm³`;
  const pct = total > 0 ? (t / total) * 100 : 0;
  $('progBar').style.width = `${pct}%`;
  $('progPct').textContent = `${pct.toFixed(1)}%`;

  const b = S.built[S.progIdx];
  const line = seg ? seg.line : 0;
  const op = S.done ? 'PROGRAM END' : (S.running || S.i > 0) ? b.ops[line] : 'READY';
  $('opLabel').textContent = op;
  $('progOp').textContent = S.done ? 'Program complete' : (S.running || S.i > 0) ? `${b.ops[line]}  ·  ${S.parsed.lines[line].trim()}` : 'Press Cycle Start to run';
  if (S.running || S.done || S.i > 0) code.setCurrent(line);
  $('lineHint').textContent = `L${line + 1} / ${S.parsed.lines.length}`;

  // modal codes
  const txt = (S.parsed.lines[line] || '').toUpperCase();
  const motion = seg && seg.type === 'rapid' ? 'G0' : seg && seg.arc ? (/G2\b|G02/.test(txt) ? 'G2' : 'G3') : seg && seg.type === 'feed' ? (/G8[13]/.test(txt) ? 'G83' : 'G1') : 'G0';
  const spin = S.rpm > 10 ? 'M3' : 'M5';
  const cool = coolant.on ? 'M8' : 'M9';
  const codes = [[motion, true], ['G17'], ['G21'], ['G40'], ['G54'], ['G90'], [S.mounted ? `G43 H${S.mounted}` : 'G49'], [`T${S.mounted}`], [spin, S.rpm > 10], [cool, coolant.on], [`F${Math.round(seg?.feed && seg.type === 'feed' ? seg.feed : 0)}`], [`S${seg ? seg.spindle : 0}`]];
  $('modal').innerHTML = codes.map(([c, hot]) => `<span class="${hot ? 'hot' : ''}">${c}</span>`).join('');

  if (S.mounted !== uiMounted) { uiMounted = S.mounted; renderToolTable(); }
  setStatus();
}
let uiMounted = -1;

// ---- controls ---------------------------------------------------------------
function cycleStart() {
  if (S.done) { loadProgram(S.progIdx); }
  if (!S.running) { S.running = true; S.hold = false; }
  else if (S.hold) { S.hold = false; S.blockStop = false; }
  if (S.soundOn) audio.setEnabled(true);
  setStatus();
}
function feedHold() { if (S.running) { S.hold = !S.hold; S.blockStop = false; setStatus(); } }
function reset() { loadProgram(S.progIdx); toast('Reset · stock restored'); }

$('btnStart').onclick = cycleStart;
$('btnHold').onclick = feedHold;
$('btnReset').onclick = reset;
$('btnSingle').onclick = () => { S.single = !S.single; setStatus(); };

function segToggle(id, fn) {
  const el = $(id);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    el.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    fn(b.dataset);
  });
}
segToggle('simSpeed', d => { S.speed = parseFloat(d.v); });
segToggle('rapidOvr', d => { S.rapidOvr = parseFloat(d.v); });
segToggle('views', d => setView(d.v));
segToggle('coordToggle', d => { S.coordMode = d.c; });
$('feedOvr').addEventListener('input', (e) => { S.feedOvr = e.target.value / 100; $('feedOvrVal').textContent = `${e.target.value}%`; });

function setToggle(name, on) {
  const b = document.querySelector(`#toggles [data-t="${name}"]`);
  b.classList.toggle('on', on);
  switch (name) {
    case 'coolant': S.coolantOn = on; break;
    case 'chips': S.chipsOn = on; break;
    case 'path': S.pathOn = on; if (pathLines) { pathLines.visible = on; recolorPath(S.i, true); } break;
    case 'ao': S.aoOn = on; break;
    case 'sound': S.soundOn = on; audio.setEnabled(on); break;
  }
}
$('toggles').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  setToggle(b.dataset.t, !b.classList.contains('on'));
});

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if (k === ' ') { e.preventDefault(); if (!S.running || S.hold) cycleStart(); else feedHold(); }
  else if (k === 'r') reset();
  else if (k === 'b') { S.single = !S.single; setStatus(); }
  else if (k === 'c') setToggle('coolant', !S.coolantOn);
  else if (k === 'p') setToggle('path', !S.pathOn);
  else if (k === 'm') setToggle('sound', !S.soundOn);
  else if (['1', '2', '3'].includes(k) && !(S.running && !S.hold)) loadProgram(+k - 1);
});

window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  gtao.setSize(w, h);
});

// ===========================================================================
// Main loop
// ===========================================================================
const timer = new THREE.Timer();
const MANUAL = new URLSearchParams(location.search).has('manual');
function tick(dt) {
  stepSim(dt);
  updateMachineVisual(dt);
  updateCamera(dt);
  controls.update();
  if (S.aoOn) composer.render(); else renderer.render(scene, camera);
  updateUI(1);
}
function frame(t) {
  timer.update(t);
  const dt = Math.min(timer.getDelta(), 1 / 20);
  stepSim(dt);
  updateMachineVisual(dt);
  updateCamera(dt);
  controls.update();
  if (S.aoOn) composer.render(); else renderer.render(scene, camera);
  updateUI(dt);
  requestAnimationFrame(frame);
}

renderPrograms();
loadProgram(0);
setView('iso', true);
// debug / automation hook
window.__sim = { S, setView, loadProgram, cycleStart, feedHold, setToggle, TOOLS, PROGRAMS, stepSim, updateMachineVisual, tick, camera, controls };
$('loader').classList.add('hide');
if (!MANUAL) requestAnimationFrame(frame);
