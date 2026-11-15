import * as THREE from '../vendor/three.module.min.js';
import { LEVELS } from './levels.js';
import { Sfx } from './audio.js';
import { Pinball, PIN_BALLS } from './pinball.js';

// ---------------------------------------------------------------------------
// Utilities & storage
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const approach = (v, t, d) => (v < t ? Math.min(v + d, t) : Math.max(v - d, t));
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };

const store = {
  get(k, d) { try { const v = localStorage.getItem('rebound3d.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('rebound3d.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};

let unlocked = clamp(store.get('unlocked', 1), 1, LEVELS.length);
const bestTimes = store.get('best', {});
const secretsFound = store.get('secrets', {});
let hiScore = store.get('hiscore', 0);
const sfx = new Sfx(store.get('muted', false));

// ---------------------------------------------------------------------------
// Physics constants (units = tiles, seconds)
// ---------------------------------------------------------------------------
const P = {
  R: 0.4, G: 28, JUMP: 12, SPRING: 18, SUPER: 17, BCAP: 15,
  MAXV: 5.5, ACC_G: 34, ACC_A: 20, DEC: 16, STEP: 1 / 120, MAXFALL: 24,
  BOUNCE: 0.5,         // how much the ball rebounds off the floor
  BLOW: 2.2,           // blower lift (in units of gravity)
  SPIDER_R: 0.45,      // spider hit radius
};
// Ball sizes: pumps inflate to big, pins shrink to small.
const SIZES = {
  small: { r: 0.27, jump: 11.2, buoy: 0.45 },
  normal: { r: 0.4, jump: 12, buoy: 1.2 },
  big: { r: 0.62, jump: 13.6, buoy: 2.0 },
};
const SCORE = { ring: 100, life: 250, level: 1000 };

// ---------------------------------------------------------------------------
// Renderer / scene
// ---------------------------------------------------------------------------
const canvas = $('game');
const isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || navigator.maxTouchPoints > 0;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isTouch ? 1.75 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);

const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x20123a, 1.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(isTouch ? 1024 : 2048, isTouch ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 10, bottom: -10, near: 1, far: 40 });
sun.shadow.bias = -0.0008;
scene.add(sun, sun.target);

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

// Shared textures
const brickTex = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#6a6a74'; g.fillRect(0, 0, w, h);
  const rows = 4, bh = h / rows;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * (w / 4);
    for (let c = -1; c < 3; c++) {
      const x = c * (w / 2) + off;
      const l = 78 + Math.random() * 16;
      g.fillStyle = `hsl(0,0%,${l}%)`;
      g.fillRect(x + 3, r * bh + 3, w / 2 - 6, bh - 6);
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(x + 3, r * bh + 3, w / 2 - 6, 3);
    }
  }
});

const ballTex = canvasTex(512, 256, (g, w, h) => {
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, '#ff5a4f'); grd.addColorStop(0.5, '#e0202c'); grd.addColorStop(1, '#a3101e');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  g.fillStyle = '#fff4e6';
  for (let i = 0; i < 4; i++) g.fillRect(i * (w / 4) + w / 8 - 14, 0, 28, h);
  g.fillStyle = '#ffd34d';
  g.beginPath(); g.ellipse(w * 0.25, h / 2, 34, 34, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(w * 0.75, h / 2, 34, 34, 0, 0, Math.PI * 2); g.fill();
});

// Shared geometries
const GEO = {
  box: new THREE.BoxGeometry(1, 1, 2),
  edge: new THREE.BoxGeometry(1.0, 0.05, 2.02),
  trim: new THREE.BoxGeometry(1.0, 0.07, 0.07),
  bouncy: (() => { const g = new THREE.BoxGeometry(0.94, 0.94, 1.9, 2, 2, 2); return g; })(),
  spike: (() => { const g = new THREE.ConeGeometry(0.2, 0.62, 8); g.translate(0, -0.5 + 0.31, 0); return g; })(),
  ring: new THREE.TorusGeometry(0.42, 0.075, 12, 36),
  springBase: new THREE.CylinderGeometry(0.42, 0.46, 0.12, 20),
  springPad: new THREE.CylinderGeometry(0.4, 0.4, 0.1, 20),
  springCoil: new THREE.TorusGeometry(0.28, 0.035, 6, 20),
  pole: new THREE.CylinderGeometry(0.05, 0.06, 1.4, 8),
  crystal: new THREE.OctahedronGeometry(0.22),
  portal: new THREE.TorusGeometry(0.78, 0.11, 16, 48),
  disc: new THREE.CircleGeometry(0.7, 40),
  hazard: new THREE.IcosahedronGeometry(0.36, 0),
  heart: (() => {
    const s = new THREE.Shape();
    s.moveTo(0, -0.3);
    s.bezierCurveTo(-0.05, -0.2, -0.38, -0.05, -0.35, 0.12);
    s.bezierCurveTo(-0.32, 0.3, -0.08, 0.32, 0, 0.16);
    s.bezierCurveTo(0.08, 0.32, 0.32, 0.3, 0.35, 0.12);
    s.bezierCurveTo(0.38, -0.05, 0.05, -0.2, 0, -0.3);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 3 });
    g.center();
    return g;
  })(),
  backdrop: new THREE.BoxGeometry(1, 1, 1),
  // spider
  spiderBody: new THREE.SphereGeometry(0.44, 20, 14),
  spiderSpike: (() => { const g = new THREE.ConeGeometry(0.1, 0.42, 6); g.translate(0, 0.21, 0); return g; })(),
  eye: new THREE.SphereGeometry(0.13, 12, 8),
  pupil: new THREE.SphereGeometry(0.065, 8, 6),
  legSeg: (() => { const g = new THREE.CylinderGeometry(0.045, 0.035, 0.5, 6); g.translate(0, -0.25, 0); return g; })(),
  // world objects
  water: new THREE.BoxGeometry(1, 1, 2.2),
  waterTop: new THREE.BoxGeometry(1, 0.06, 2.22),
  slab: new THREE.BoxGeometry(1, 0.38, 2),
  pumpBody: new THREE.CylinderGeometry(0.3, 0.36, 0.55, 16),
  pumpRod: new THREE.CylinderGeometry(0.05, 0.05, 0.4, 8),
  pumpHandle: new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8),
  arrow: (() => { const g = new THREE.ConeGeometry(0.16, 0.26, 4); return g; })(),
  pinNeedle: (() => { const g = new THREE.ConeGeometry(0.055, 0.75, 10); g.translate(0, 0.375, 0); return g; })(),
  pinHead: new THREE.SphereGeometry(0.2, 14, 10),
  pinBase: new THREE.CylinderGeometry(0.22, 0.26, 0.1, 14),
  fanRing: new THREE.TorusGeometry(0.42, 0.07, 8, 24),
  fanBlade: new THREE.BoxGeometry(0.7, 0.05, 0.16),
  fanBase: new THREE.CylinderGeometry(0.48, 0.5, 0.14, 18),
  streak: new THREE.BoxGeometry(0.04, 0.5, 0.04),
  leverBase: new THREE.BoxGeometry(0.5, 0.14, 0.4),
  leverArm: (() => { const g = new THREE.CylinderGeometry(0.04, 0.04, 0.55, 8); g.translate(0, 0.27, 0); return g; })(),
  leverKnob: new THREE.SphereGeometry(0.1, 12, 8),
};

// Shared materials
const MAT = {
  brick: new THREE.MeshStandardMaterial({ map: brickTex, roughness: 0.85, metalness: 0.05 }),
  edge: new THREE.MeshStandardMaterial({ color: 0x8090c0, roughness: 0.6 }),
  trim: new THREE.MeshBasicMaterial({ color: 0x66e0ff }),
  bouncy: new THREE.MeshPhysicalMaterial({ color: 0xff4fb8, emissive: 0x6a0a48, roughness: 0.25, clearcoat: 1 }),
  spike: new THREE.MeshStandardMaterial({ color: 0xd9dde8, metalness: 0.9, roughness: 0.25, emissive: 0x3a0000 }),
  ring: new THREE.MeshStandardMaterial({ color: 0xffc928, emissive: 0xb07000, metalness: 0.7, roughness: 0.25 }),
  springBase: new THREE.MeshStandardMaterial({ color: 0x333a4a, metalness: 0.6, roughness: 0.4 }),
  springPad: new THREE.MeshStandardMaterial({ color: 0xffe14d, emissive: 0x806000, roughness: 0.4 }),
  coil: new THREE.MeshStandardMaterial({ color: 0xc0c6d4, metalness: 1, roughness: 0.2 }),
  pole: new THREE.MeshStandardMaterial({ color: 0x9aa3b5, metalness: 0.8, roughness: 0.3 }),
  hazard: new THREE.MeshStandardMaterial({ color: 0xff2a3d, emissive: 0x7a0010, metalness: 0.4, roughness: 0.3, flatShading: true }),
  heart: new THREE.MeshStandardMaterial({ color: 0xff3b6b, emissive: 0x80102a, roughness: 0.3 }),
  backdrop: new THREE.MeshStandardMaterial({ color: 0x1a1f3d, roughness: 1 }),
  ball: new THREE.MeshPhysicalMaterial({ map: ballTex, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.15 }),
  spider: new THREE.MeshStandardMaterial({ color: 0x2a0c18, emissive: 0x3a0010, roughness: 0.35, metalness: 0.3 }),
  spiderSpike: new THREE.MeshStandardMaterial({ color: 0xff2a3d, emissive: 0x7a0010, metalness: 0.4, roughness: 0.3, flatShading: true }),
  leg: new THREE.MeshStandardMaterial({ color: 0x1a0610, roughness: 0.5 }),
  eye: new THREE.MeshBasicMaterial({ color: 0xfff6d0 }),
  pupil: new THREE.MeshBasicMaterial({ color: 0x110000 }),
  water: new THREE.MeshStandardMaterial({ color: 0x2a9cff, emissive: 0x0a2a6a, transparent: true, opacity: 0.42, roughness: 0.1, metalness: 0.1, depthWrite: false }),
  waterTop: new THREE.MeshBasicMaterial({ color: 0x9fe4ff, transparent: true, opacity: 0.7, depthWrite: false }),
  pump: new THREE.MeshStandardMaterial({ color: 0x35d16a, emissive: 0x0b5a24, roughness: 0.35, metalness: 0.3 }),
  pumpArrow: new THREE.MeshBasicMaterial({ color: 0x9dffb8 }),
  pinNeedle: new THREE.MeshStandardMaterial({ color: 0xe8ecf6, metalness: 1, roughness: 0.15 }),
  pinHead: new THREE.MeshStandardMaterial({ color: 0x3a8bff, emissive: 0x0a2a80, roughness: 0.25 }),
  pinArrow: new THREE.MeshBasicMaterial({ color: 0x8cc4ff }),
  fan: new THREE.MeshStandardMaterial({ color: 0xb8c4d8, metalness: 0.8, roughness: 0.3 }),
  streak: new THREE.MeshBasicMaterial({ color: 0xcff4ff, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending }),
  lever: new THREE.MeshStandardMaterial({ color: 0x9aa3b5, metalness: 0.8, roughness: 0.3 }),
  leverKnob: new THREE.MeshStandardMaterial({ color: 0xff4fd8, emissive: 0xa0108a, roughness: 0.2 }),
};
// Fake bricks share the brick look but can fade out when the ball is inside them.
MAT.fake = MAT.brick.clone(); MAT.fake.transparent = true;
MAT.fakeEdge = MAT.edge.clone(); MAT.fakeEdge.transparent = true;
MAT.fakeTrim = MAT.trim.clone(); MAT.fakeTrim.transparent = true;
const FADE_MATS = [MAT.fake, MAT.fakeEdge, MAT.fakeTrim];

// Stars
{
  const n = 600, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = Math.random() * 220 - 40;
    pos[i * 3 + 1] = Math.random() * 60 - 10;
    pos[i * 3 + 2] = -40 - Math.random() * 30;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.25, fog: false })));
}

// ---------------------------------------------------------------------------
// Ball
// ---------------------------------------------------------------------------
const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(P.R, 40, 28), MAT.ball);
ballMesh.castShadow = true;
const ballPivot = new THREE.Group(); // pivot handles squash, mesh handles roll
ballPivot.add(ballMesh);
scene.add(ballPivot);

const ball = {
  x: 0, y: 0, vx: 0, vy: 0, grounded: false, coyote: 0, buffer: 0, jumping: false,
  squash: 0, roll: 0, bufferTouch: false,
  size: 'normal', r: P.R, vr: P.R, wet: 0,
};
function setSize(size) {
  ball.size = size;
  ball.r = SIZES[size].r;
}

// ---------------------------------------------------------------------------
// Particles
// ---------------------------------------------------------------------------
const PART_N = 400;
const partPos = new Float32Array(PART_N * 3).fill(-9999);
const partCol = new Float32Array(PART_N * 3);
const partVel = new Float32Array(PART_N * 3);
const partLife = new Float32Array(PART_N);
const partGeo = new THREE.BufferGeometry();
partGeo.setAttribute('position', new THREE.BufferAttribute(partPos, 3));
partGeo.setAttribute('color', new THREE.BufferAttribute(partCol, 3));
const partMat = new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
const particles = new THREE.Points(partGeo, partMat);
particles.frustumCulled = false;
scene.add(particles);
let partCursor = 0;
const tmpCol = new THREE.Color();

function burst(x, y, color, n = 24, speed = 4, z = 0) {
  tmpCol.set(color);
  for (let k = 0; k < n; k++) {
    const i = partCursor; partCursor = (partCursor + 1) % PART_N;
    const a = Math.random() * Math.PI * 2, b = Math.random() * Math.PI - Math.PI / 2;
    const s = speed * (0.4 + Math.random() * 0.8);
    partPos[i * 3] = x; partPos[i * 3 + 1] = y; partPos[i * 3 + 2] = z;
    partVel[i * 3] = Math.cos(a) * Math.cos(b) * s;
    partVel[i * 3 + 1] = Math.sin(a) * Math.cos(b) * s + 1.5;
    partVel[i * 3 + 2] = Math.sin(b) * s;
    partCol[i * 3] = tmpCol.r; partCol[i * 3 + 1] = tmpCol.g; partCol[i * 3 + 2] = tmpCol.b;
    partLife[i] = 0.6 + Math.random() * 0.6;
  }
}

function updateParticles(dt) {
  for (let i = 0; i < PART_N; i++) {
    if (partLife[i] <= 0) continue;
    partLife[i] -= dt;
    if (partLife[i] <= 0) { partPos[i * 3 + 1] = -9999; continue; }
    partVel[i * 3 + 1] -= 9 * dt;
    partPos[i * 3] += partVel[i * 3] * dt;
    partPos[i * 3 + 1] += partVel[i * 3 + 1] * dt;
    partPos[i * 3 + 2] += partVel[i * 3 + 2] * dt;
    const f = Math.min(1, partLife[i] * 2);
    partCol[i * 3] *= 0.995 + 0.005 * f; partCol[i * 3 + 1] *= 0.99; partCol[i * 3 + 2] *= 0.99;
  }
  partGeo.attributes.position.needsUpdate = true;
  partGeo.attributes.color.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Level runtime
// ---------------------------------------------------------------------------
let L = null, grid = null, W = 0, H = 0, levelIdx = 0;
let levelGroup = null, skyTex = null;
let rings = [], checkpoints = [], lifeItems = [], movers = [], springs = new Map(), exitE = null;
let pumps = [], pins = [], blowers = [], levers = [], waterMask = null, fakeOpacity = 1, fakeTiles = [];
let ringsGot = 0, startPos = { x: 2, y: 2 }, respawn = { x: 2, y: 2, size: 'normal' }, elapsed = 0;
let lives = 3;
let score = 0, levelScore = 0, secretThisLevel = false;
let pinball = null, pinReturn = null, pausedFrom = 'playing', warp = null;
let portalOpen = false;
let exitHintCooldown = 0;
let clock = 0; // game time; drives moving hazards so they freeze while paused

function updateMovers() {
  for (const mv of movers) {
    const o = Math.sin(clock * mv.speed + mv.phase) * mv.amp;
    mv.cx = mv.axis === 'x' ? mv.x + o : mv.x;
    mv.cy = mv.axis === 'y' ? mv.y + o : mv.y;
  }
}

const tileAt = (i, j) => (i < 0 || i >= W || j >= H ? '#' : j < 0 ? ' ' : grid[j][i]);
const isSolid = (c) => c === '#' || c === 'b' || c === 'h';
const looksSolid = (c) => isSolid(c) || c === 'H' || c === 'L';
const isWater = (i, j) => j >= 0 && j < H && i >= 0 && i < W && waterMask[j][i] && !isSolid(grid[j][i]);
// collision box of a solid tile: slabs only fill the top part
const SLAB_BOTTOM = 0.62;
function tileBox(t, i, j) {
  return t === 'h' ? [i - 0.5, j - 0.5 + SLAB_BOTTOM, i + 0.5, j + 0.5] : [i - 0.5, j - 0.5, i + 0.5, j + 0.5];
}

function disposeLevel() {
  if (!levelGroup) return;
  scene.remove(levelGroup);
  levelGroup.traverse((o) => {
    if (o.isInstancedMesh) o.dispose();
    if (o.userData.ownMat) o.material.dispose();
  });
  levelGroup = null;
}

function makeSky(hue) {
  if (skyTex) skyTex.dispose();
  skyTex = canvasTex(4, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, `hsl(${hue + 30},55%,6%)`);
    grd.addColorStop(0.6, `hsl(${hue},55%,16%)`);
    grd.addColorStop(1, `hsl(${hue - 20},60%,28%)`);
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
  scene.background = skyTex;
  scene.fog = new THREE.Fog(new THREE.Color(`hsl(${hue},45%,14%)`), 22, 75);
}

function buildLevel(idx) {
  disposeLevel();
  if (pinball) pinball.hide();
  levelIdx = idx;
  L = LEVELS[idx];
  W = L.W; H = L.H;
  grid = L.grid.map((r) => r.slice());
  waterMask = L.water;
  const orig = L.grid;
  levelGroup = new THREE.Group();
  scene.add(levelGroup);
  rings = []; checkpoints = []; lifeItems = []; movers = []; springs = new Map(); exitE = null;
  pumps = []; pins = []; blowers = []; levers = []; fakeTiles = []; fakeOpacity = 1;
  ringsGot = 0; portalOpen = false; levelScore = 0; secretThisLevel = false;

  const hue = L.hue;
  makeSky(hue);
  MAT.edge.color.setHSL(hue / 360, 0.45, 0.42);
  MAT.trim.color.setHSL(((hue + 150) % 360) / 360, 1, 0.6);
  MAT.fakeEdge.color.copy(MAT.edge.color);
  MAT.fakeTrim.color.copy(MAT.trim.color);
  for (const m of FADE_MATS) m.opacity = 1;

  const solids = [], bouncy = [], spikeUp = [], spikeDown = [], edges = [], fakes = [], fakeEdges = [], slabs = [], waters = [];
  const looksAbove = (i, j) => j + 1 < H && looksSolid(orig[j + 1][i]);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const c = grid[j][i];
      if (waterMask[j][i] && !isSolid(c)) waters.push([i, j]);
      switch (c) {
        case '#': solids.push([i, j]); if (!looksAbove(i, j)) edges.push([i, j]); break;
        case 'b': bouncy.push([i, j]); break;
        case 'h': slabs.push([i, j]); break;
        case 'H': fakes.push([i, j]); fakeTiles.push([i, j]); if (!looksAbove(i, j)) fakeEdges.push([i, j]); grid[j][i] = ' '; break;
        case 'L': fakes.push([i, j]); fakeTiles.push([i, j]); if (!looksAbove(i, j)) fakeEdges.push([i, j]); addLever(i, j); grid[j][i] = ' '; break;
        case '^': spikeUp.push([i, j]); break;
        case 'v': spikeDown.push([i, j]); break;
        case '*': addSpring(i, j); break;
        case 'o': addRing(i, j); grid[j][i] = ' '; break;
        case 'C': addCheckpoint(i, j); grid[j][i] = ' '; break;
        case '+': addLife(i, j); grid[j][i] = ' '; break;
        case 'E': addExit(i, j); grid[j][i] = ' '; break;
        case 'S': startPos = { x: i, y: j }; grid[j][i] = ' '; break;
        case 'P': addPump(i, j); grid[j][i] = ' '; break;
        case 'D': addPin(i, j); grid[j][i] = ' '; break;
        case 'F': grid[j][i] = ' '; break;
        default: break;
      }
    }
  }

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3(), col = new THREE.Color();
  const brickColor = (i, j) => col.setHSL((((hue + j * 5 + hash(i, j) * 20) % 360) + 360) % 360 / 360, 0.38, 0.42 + hash(j, i) * 0.12);

  const blockMesh = (list, mat) => {
    const im = new THREE.InstancedMesh(GEO.box, mat, list.length);
    list.forEach(([i, j], k) => { m.makeTranslation(i, j, 0); im.setMatrixAt(k, m); im.setColorAt(k, brickColor(i, j)); });
    im.castShadow = im.receiveShadow = true;
    levelGroup.add(im);
    return im;
  };
  blockMesh(solids, MAT.brick);
  if (fakes.length) blockMesh(fakes, MAT.fake).castShadow = false;

  const edgeMeshes = (list, emat, tmat) => {
    if (!list.length) return;
    const em = new THREE.InstancedMesh(GEO.edge, emat, list.length);
    const tm = new THREE.InstancedMesh(GEO.trim, tmat, list.length);
    list.forEach(([i, j], k) => {
      m.makeTranslation(i, j + 0.5, 0); em.setMatrixAt(k, m);
      m.makeTranslation(i, j + 0.5, 1.01); tm.setMatrixAt(k, m);
    });
    em.receiveShadow = true;
    levelGroup.add(em, tm);
  };
  edgeMeshes(edges, MAT.edge, MAT.trim);
  edgeMeshes(fakeEdges, MAT.fakeEdge, MAT.fakeTrim);

  if (slabs.length) {
    const sm = new THREE.InstancedMesh(GEO.slab, MAT.brick, slabs.length);
    const tm = new THREE.InstancedMesh(GEO.trim, MAT.trim, slabs.length * 2);
    slabs.forEach(([i, j], k) => {
      m.makeTranslation(i, j + 0.5 - 0.19, 0); sm.setMatrixAt(k, m); sm.setColorAt(k, brickColor(i, j));
      m.makeTranslation(i, j - 0.5 + SLAB_BOTTOM, 1.01); tm.setMatrixAt(k * 2, m);
      m.makeTranslation(i, j + 0.5, 1.01); tm.setMatrixAt(k * 2 + 1, m);
    });
    sm.castShadow = sm.receiveShadow = true;
    levelGroup.add(sm, tm);
  }

  if (bouncy.length) {
    const bm = new THREE.InstancedMesh(GEO.bouncy, MAT.bouncy, bouncy.length);
    bouncy.forEach(([i, j], k) => { m.makeTranslation(i, j, 0); bm.setMatrixAt(k, m); });
    bm.castShadow = bm.receiveShadow = true;
    levelGroup.add(bm);
  }

  const spikes = [...spikeUp.map((p) => [...p, 1]), ...spikeDown.map((p) => [...p, -1])];
  if (spikes.length) {
    const sm = new THREE.InstancedMesh(GEO.spike, MAT.spike, spikes.length * 3);
    let k = 0;
    const flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);
    for (const [i, j, d] of spikes) {
      for (const z of [-0.6, 0, 0.6]) {
        v.set(i, j, z);
        m.compose(v, d > 0 ? q.identity() : flip, s);
        sm.setMatrixAt(k++, m);
      }
    }
    sm.castShadow = true;
    levelGroup.add(sm);
  }

  if (waters.length) {
    const wm = new THREE.InstancedMesh(GEO.water, MAT.water, waters.length);
    const tops = waters.filter(([i, j]) => !isWater(i, j + 1) && !isSolid(tileAt(i, j + 1)));
    const tm = new THREE.InstancedMesh(GEO.waterTop, MAT.waterTop, Math.max(1, tops.length));
    waters.forEach(([i, j], k) => { m.makeTranslation(i, j, 0); wm.setMatrixAt(k, m); });
    tops.forEach(([i, j], k) => { m.makeTranslation(i, j + 0.47, 0); tm.setMatrixAt(k, m); });
    tm.count = tops.length;
    wm.renderOrder = 2; tm.renderOrder = 3;
    levelGroup.add(wm, tm);
  }

  for (const b of L.blowers) addBlower(b);

  // Distant backdrop towers for depth
  const towers = Math.ceil(W / 3);
  const bd = new THREE.InstancedMesh(GEO.backdrop, MAT.backdrop, towers);
  for (let k = 0; k < towers; k++) {
    const h = 4 + hash(k, 3) * 14;
    const w = 1.5 + hash(k, 7) * 3;
    v.set(k * 3 - 4 + hash(k, 1) * 2, h / 2 - 1, -10 - hash(k, 9) * 12);
    s.set(w, h, w);
    m.compose(v, q.identity(), s);
    bd.setMatrixAt(k, m);
    col.setHSL(((hue + 200) % 360) / 360, 0.35, 0.22 + hash(k, 5) * 0.14);
    bd.setColorAt(k, col);
  }
  s.set(1, 1, 1);
  levelGroup.add(bd);

  for (const mv of L.movers) {
    const sp = makeSpider();
    levelGroup.add(sp.group);
    movers.push({ ...mv, mesh: sp.group, legs: sp.legs, cx: mv.x, cy: mv.y, seed: Math.random() * 6 });
  }

  ringsTotalEl.textContent = rings.length;
  updateHUD();
}

// Big spiky spider: round body bristling with red spikes, eyes, and eight wiggling legs.
function makeSpider() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(GEO.spiderBody, MAT.spider);
  body.castShadow = true;
  g.add(body);
  const up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3();
  const n = 14;
  for (let k = 0; k < n; k++) {
    // spikes spread over the sphere (golden spiral), skipping the face
    const yv = 1 - (k + 0.5) / n * 2, rr = Math.sqrt(1 - yv * yv), th = k * 2.39996;
    dir.set(Math.cos(th) * rr, yv, Math.sin(th) * rr);
    if (dir.z > 0.75) continue;
    const sp = new THREE.Mesh(GEO.spiderSpike, MAT.spiderSpike);
    sp.position.copy(dir).multiplyScalar(0.38);
    sp.quaternion.setFromUnitVectors(up, dir);
    g.add(sp);
  }
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(GEO.eye, MAT.eye);
    eye.position.set(sx * 0.16, 0.1, 0.36);
    const pupil = new THREE.Mesh(GEO.pupil, MAT.pupil);
    pupil.position.set(sx * 0.15, 0.08, 0.47);
    g.add(eye, pupil);
  }
  const legs = [];
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 4; k++) {
      const hip = new THREE.Group();
      hip.position.set(sx * 0.3, -0.12, -0.3 + k * 0.2);
      const upper = new THREE.Mesh(GEO.legSeg, MAT.leg);
      upper.rotation.z = sx * 2.0;
      const knee = new THREE.Group();
      knee.position.set(0, -0.5, 0);
      const lower = new THREE.Mesh(GEO.legSeg, MAT.leg);
      lower.rotation.z = -sx * 1.4;
      knee.add(lower);
      upper.add(knee);
      hip.add(upper);
      g.add(hip);
      legs.push({ hip, sx, k });
    }
  }
  return { group: g, legs };
}

function addPump(i, j) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(GEO.pumpBody, MAT.pump); body.position.y = -0.22;
  const rod = new THREE.Mesh(GEO.pumpRod, MAT.lever); rod.position.y = 0.2;
  const handle = new THREE.Mesh(GEO.pumpHandle, MAT.lever); handle.rotation.z = Math.PI / 2; handle.position.y = 0.4;
  const arrow = new THREE.Mesh(GEO.arrow, MAT.pumpArrow); arrow.position.y = 0.75;
  body.castShadow = rod.castShadow = true;
  g.add(body, rod, handle, arrow);
  g.position.set(i, j, 0);
  levelGroup.add(g);
  pumps.push({ x: i, y: j, g, arrow, handle, rod, t: 0 });
}

function addPin(i, j) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(GEO.pinBase, MAT.springBase); base.position.y = -0.45;
  const needle = new THREE.Mesh(GEO.pinNeedle, MAT.pinNeedle); needle.position.y = -0.38;
  const head = new THREE.Mesh(GEO.pinHead, MAT.pinHead); head.position.y = -0.33; head.scale.set(1, 0.55, 1);
  const arrow = new THREE.Mesh(GEO.arrow, MAT.pinArrow); arrow.rotation.x = Math.PI; arrow.position.y = 0.62;
  needle.castShadow = head.castShadow = true;
  g.add(base, needle, head, arrow);
  g.position.set(i, j, 0);
  levelGroup.add(g);
  pins.push({ x: i, y: j, g, arrow, t: 0 });
}

function addBlower({ x, y, h }) {
  // column stops at the first solid tile
  let top = y - 0.5;
  for (let k = 0; k < h; k++) { if (isSolid(tileAt(x, y + k))) break; top = y + k + 0.5; }
  const g = new THREE.Group();
  const base = new THREE.Mesh(GEO.fanBase, MAT.springBase); base.position.y = -0.43;
  const ring = new THREE.Mesh(GEO.fanRing, MAT.fan); ring.rotation.x = Math.PI / 2; ring.position.y = -0.34;
  const rotor = new THREE.Group(); rotor.position.y = -0.34;
  for (let k = 0; k < 3; k++) { const b = new THREE.Mesh(GEO.fanBlade, MAT.fan); b.rotation.y = (k * Math.PI * 2) / 3; b.rotation.x = 0.35; rotor.add(b); }
  base.receiveShadow = true;
  g.add(base, ring, rotor);
  const streaks = [];
  for (let k = 0; k < 7; k++) {
    const st = new THREE.Mesh(GEO.streak, MAT.streak);
    st.position.set((hash(k, x) - 0.5) * 0.7, 0, (hash(x, k) - 0.5) * 1.2);
    st.userData.off = hash(k * 3, y);
    g.add(st);
    streaks.push(st);
  }
  g.position.set(x, y, 0);
  levelGroup.add(g);
  blowers.push({ x, y, top, rotor, streaks, g });
}

function addLever(i, j) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(GEO.leverBase, MAT.lever); base.position.y = -0.4;
  const pivot = new THREE.Group(); pivot.position.y = -0.33; pivot.rotation.z = 0.6;
  const arm = new THREE.Mesh(GEO.leverArm, MAT.lever);
  const knob = new THREE.Mesh(GEO.leverKnob, MAT.leverKnob); knob.position.y = 0.58;
  pivot.add(arm, knob);
  g.add(base, pivot);
  g.position.set(i, j, 0);
  levelGroup.add(g);
  levers.push({ x: i, y: j, g, pivot, used: false });
}

function addRing(i, j) {
  const mesh = new THREE.Mesh(GEO.ring, MAT.ring);
  mesh.position.set(i, j, 0);
  mesh.castShadow = true;
  levelGroup.add(mesh);
  rings.push({ x: i, y: j, mesh, taken: false, phase: Math.random() * 6, t: 0 });
}

function addSpring(i, j) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(GEO.springBase, MAT.springBase);
  base.position.y = -0.44;
  const coil1 = new THREE.Mesh(GEO.springCoil, MAT.coil); coil1.rotation.x = Math.PI / 2; coil1.position.y = -0.34;
  const coil2 = coil1.clone(); coil2.position.y = -0.26;
  const pad = new THREE.Mesh(GEO.springPad, MAT.springPad);
  pad.position.y = -0.18;
  [base, pad].forEach((o) => { o.castShadow = true; o.receiveShadow = true; });
  g.add(base, coil1, coil2, pad);
  g.position.set(i, j, 0);
  levelGroup.add(g);
  springs.set(i + ',' + j, { pad, coils: [coil1, coil2], t: 0 });
}

function addCheckpoint(i, j) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(GEO.pole, MAT.pole);
  pole.position.y = 0.2;
  const mat = new THREE.MeshStandardMaterial({ color: 0x6b7285, emissive: 0x000000, roughness: 0.2, metalness: 0.3 });
  const crystal = new THREE.Mesh(GEO.crystal, mat);
  crystal.userData.ownMat = true;
  crystal.position.y = 1.05;
  pole.castShadow = crystal.castShadow = true;
  g.add(pole, crystal);
  g.position.set(i, j, -0.7);
  levelGroup.add(g);
  checkpoints.push({ x: i, y: j, crystal, mat, active: false });
}

function addLife(i, j) {
  const mesh = new THREE.Mesh(GEO.heart, MAT.heart);
  mesh.position.set(i, j, 0);
  mesh.rotation.z = Math.PI;
  mesh.castShadow = true;
  levelGroup.add(mesh);
  lifeItems.push({ x: i, y: j, mesh, taken: false });
}

function addExit(i, j) {
  const g = new THREE.Group();
  const ringMat = new THREE.MeshStandardMaterial({ color: 0xff3344, emissive: 0x880011, metalness: 0.6, roughness: 0.3 });
  const discMat = new THREE.MeshBasicMaterial({ color: 0x330008, transparent: true, opacity: 0.75, side: THREE.DoubleSide });
  const torus = new THREE.Mesh(GEO.portal, ringMat); torus.userData.ownMat = true;
  const disc = new THREE.Mesh(GEO.disc, discMat); disc.userData.ownMat = true;
  torus.castShadow = true;
  g.add(torus, disc);
  g.position.set(i, j + 0.5, 0);
  levelGroup.add(g);
  exitE = { x: i, y: j, g, torus, disc, ringMat, discMat };
}

function setPortalOpen() {
  portalOpen = true;
  exitE.ringMat.color.set(0x37ff8b); exitE.ringMat.emissive.set(0x0a7a3a);
  exitE.discMat.color.set(0x7dffd0); exitE.discMat.opacity = 0.55;
  sfx.open();
  toast('Portal open! Head to the exit ➜');
  burst(exitE.x, exitE.y + 0.5, 0x7dffd0, 40, 3);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const kb = { left: false, right: false, jump: false };
const tc = { left: false, right: false, jump: false };
const input = { left: false, right: false, jump: false, jumpPrev: false };

const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'jump', KeyW: 'jump', Space: 'jump', KeyZ: 'jump', KeyK: 'jump',
};

window.addEventListener('keydown', (e) => {
  sfx.unlock();
  const k = KEYMAP[e.code];
  if (k) { kb[k] = true; if (state === 'playing' || state === 'pinball') e.preventDefault(); }
  if (e.code === 'Escape' || e.code === 'KeyP') { if (state === 'playing' || state === 'pinball') pause(); else if (state === 'paused') resume(); }
  if (e.code === 'KeyR' && (state === 'playing' || state === 'paused' || state === 'pinball')) restartLevel();
  if ((e.code === 'Enter' || e.code === 'Space') && state === 'complete') nextLevel();
});
window.addEventListener('keyup', (e) => { const k = KEYMAP[e.code]; if (k) kb[k] = false; });
window.addEventListener('blur', () => { kb.left = kb.right = kb.jump = false; resetTouches(); });

// Touch controls: hold the left half of the screen to roll left, the right half to roll right,
// swipe up (anywhere) to jump. Swipe down a little and up again to jump again without lifting.
const touchEl = $('touch');
const zoneL = touchEl.querySelector('.zone.left');
const zoneR = touchEl.querySelector('.zone.right');
const touchPointers = new Map(); // pointerId -> { side, anchorY, jumping }
let touchJumpQueued = false;     // swipe seen; consumed by the game loop (so very fast flicks still count)
let touchHintTimer = 0;
const swipeDist = () => Math.max(24, window.innerHeight * 0.06);
const sideOf = (x) => (x < window.innerWidth / 2 ? 'left' : 'right');

function syncTouchState() {
  tc.left = tc.right = tc.jump = false;
  for (const p of touchPointers.values()) {
    tc[p.side] = true;
    if (p.jumping) tc.jump = true;
  }
  zoneL.classList.toggle('on', tc.left);
  zoneR.classList.toggle('on', tc.right);
}

function resetTouches() {
  touchPointers.clear();
  touchJumpQueued = false;
  syncTouchState();
}

function showTouchHints(ms = 3500) {
  touchEl.classList.add('hints');
  clearTimeout(touchHintTimer);
  touchHintTimer = setTimeout(() => touchEl.classList.remove('hints'), ms);
}

touchEl.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  sfx.unlock();
  try { touchEl.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  touchPointers.set(e.pointerId, { side: sideOf(e.clientX), anchorY: e.clientY, jumping: false });
  syncTouchState();
});

touchEl.addEventListener('pointermove', (e) => {
  const p = touchPointers.get(e.pointerId);
  if (!p) return;
  e.preventDefault();
  p.side = sideOf(e.clientX); // sliding across the middle switches direction
  const y = e.clientY;
  if (!p.jumping) {
    if (y > p.anchorY) p.anchorY = y;                       // track lowest point
    else if (p.anchorY - y > swipeDist()) { p.jumping = true; p.anchorY = y; touchJumpQueued = true; }
  } else {
    if (y < p.anchorY) p.anchorY = y;                       // track highest point
    else if (y - p.anchorY > swipeDist()) { p.jumping = false; p.anchorY = y; } // re-arm
  }
  syncTouchState();
});

for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  touchEl.addEventListener(ev, (e) => {
    if (!touchPointers.delete(e.pointerId)) return;
    syncTouchState();
  });
}
touchEl.addEventListener('contextmenu', (e) => e.preventDefault());

function readInput() {
  let gl = false, gr = false, gj = false;
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) {
    if (!p) continue;
    const ax = p.axes[0] || 0;
    gl = gl || ax < -0.35 || !!p.buttons[14]?.pressed;
    gr = gr || ax > 0.35 || !!p.buttons[15]?.pressed;
    gj = gj || !!p.buttons[0]?.pressed || !!p.buttons[12]?.pressed;
  }
  input.jumpPrev = input.jump;
  input.left = kb.left || tc.left || gl;
  input.right = kb.right || tc.right || gr;
  input.jump = kb.jump || tc.jump || gj;
}

// ---------------------------------------------------------------------------
// Physics step
// ---------------------------------------------------------------------------
function circleBox(cx, cy, r, x1, y1, x2, y2) {
  const px = clamp(cx, x1, x2), py = clamp(cy, y1, y2);
  const dx = cx - px, dy = cy - py;
  return dx * dx + dy * dy < r * r;
}

function waterFrac() {
  // fraction of the ball below the water surface (0..1)
  const r = ball.r, i = Math.floor(ball.x + 0.5);
  const jb = Math.floor(ball.y - r + 0.5), jt = Math.floor(ball.y + r + 0.5);
  let k = -1;
  for (let j = jb; j <= jt; j++) if (isWater(i, j)) { k = j; break; }
  if (k < 0) return 0;
  while (isWater(i, k + 1)) k++;
  return clamp((k + 0.5 - (ball.y - r)) / (2 * r), 0, 1);
}

function step(dt) {
  clock += dt;
  updateMovers();
  const SZ = SIZES[ball.size];
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (dir !== 0) {
    const acc = ball.grounded ? P.ACC_G : P.ACC_A;
    // turning around is snappier
    const boost = Math.sign(ball.vx) !== dir && ball.vx !== 0 ? 1.6 : 1;
    ball.vx += dir * acc * boost * dt;
    if (Math.abs(ball.vx) > P.MAXV) ball.vx = approach(ball.vx, Math.sign(ball.vx) * P.MAXV, 30 * dt);
  } else {
    ball.vx = approach(ball.vx, 0, (ball.grounded ? P.DEC : 3) * dt);
  }

  ball.vy = Math.max(ball.vy - P.G * dt, -P.MAXFALL);

  // water: buoyancy depends on ball size (big floats high, small sinks)
  const f = waterFrac();
  if (f > 0) {
    if (ball.wet === 0 && Math.abs(ball.vy) > 3) {
      sfx.splash();
      burst(ball.x, ball.y - ball.r * 0.5, 0x9fe4ff, 18, 3);
    }
    ball.vy += SZ.buoy * P.G * f * dt;
    ball.vy *= Math.exp(-3 * f * dt);
    ball.vx *= Math.exp(-0.8 * f * dt);
    if (ball.size !== 'small' && f > 0.25) ball.grounded = true; // can jump out of the water
    if (Math.random() < dt * 3 * f) burst(ball.x, ball.y, 0xcff4ff, 1, 0.6);
  }
  ball.wet = f;

  // blowers push the ball up their column
  for (const b of blowers) {
    if (Math.abs(ball.x - b.x) < 0.5 + ball.r * 0.5 && ball.y > b.y - 0.5 && ball.y < b.top) {
      const s = clamp((b.top - ball.y) / 1.5, 0, 1);
      ball.vy += P.G * P.BLOW * s * dt;
      ball.vy *= Math.exp(-1.5 * dt);
      if (ball.vy > 9) ball.vy = approach(ball.vy, 9, 40 * dt);
      if (dir === 0) ball.vx = approach(ball.vx, 0, 22 * dt); // the air stream catches the ball
    }
  }

  ball.coyote = ball.grounded ? 0.1 : ball.coyote - dt;
  ball.buffer -= dt;
  if (ball.buffer > 0 && ball.coyote > 0) {
    ball.vy = SZ.jump;
    ball.buffer = 0; ball.coyote = 0; ball.grounded = false;
    ball.jumping = !ball.bufferTouch; // swipe jumps are always full height
    ball.squash = -0.25;
    sfx.jump();
  }
  if (ball.jumping && !input.jump && ball.vy > 0) { ball.vy *= 0.5; ball.jumping = false; }
  if (ball.vy <= 0) ball.jumping = false;

  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  collide();
  interact(dt);
}

function collide() {
  const R = ball.r;
  ball.grounded = false;
  for (let iter = 0; iter < 2; iter++) {
    const i0 = Math.floor(ball.x - R + 0.5), i1 = Math.floor(ball.x + R + 0.5);
    const j0 = Math.floor(ball.y - R + 0.5), j1 = Math.floor(ball.y + R + 0.5);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const t = tileAt(i, j);
        if (!isSolid(t)) continue;
        const [x1, y1, x2, y2] = tileBox(t, i, j);
        const px = clamp(ball.x, x1, x2), py = clamp(ball.y, y1, y2);
        let dx = ball.x - px, dy = ball.y - py;
        let d2 = dx * dx + dy * dy;
        if (d2 >= R * R) continue;
        let nx, ny, pen;
        if (d2 < 1e-9) { nx = 0; ny = 1; pen = (y2 + R) - ball.y; } else {
          const d = Math.sqrt(d2); nx = dx / d; ny = dy / d; pen = R - d;
        }
        ball.x += nx * pen; ball.y += ny * pen;
        const vn = ball.vx * nx + ball.vy * ny;
        if (ny > 0.6) ball.grounded = true;
        if (vn >= 0) continue;

        if (t === 'b') {
          if (ny > 0.6) {
            if (input.jump) { ball.vy = P.SUPER; ball.jumping = false; sfx.bounce(); burst(ball.x, ball.y - R, 0xff6fd0, 14, 3); }
            else if (-vn > 3) { ball.vy = Math.min(-vn, P.BCAP); sfx.bounce(); }
            else { ball.vy = 0; }
            ball.squash = 0.35;
            ball.grounded = false;
            ball.coyote = 0;
            continue;
          }
          const e = 0.9;
          ball.vx -= (1 + e) * vn * nx; ball.vy -= (1 + e) * vn * ny;
          continue;
        }

        // the ball is bouncy: it rebounds off floors and walls after a hard hit
        const e = -vn > 3.5 ? (ny > 0.6 ? P.BOUNCE : 0.35) : 0;
        ball.vx -= (1 + e) * vn * nx;
        ball.vy -= (1 + e) * vn * ny;
        if (ny > 0.6 && -vn > 5) { ball.squash = Math.min(0.3, -vn * 0.02); if (-vn > 8) sfx.land(); }
        if (ny < -0.6 && ball.vy > 0) { ball.vy = 0; ball.jumping = false; }
      }
    }
  }
}

function interact(dt) {
  const R = ball.r, x = ball.x, y = ball.y;
  const i0 = Math.floor(x - R + 0.5), i1 = Math.floor(x + R + 0.5);
  const j0 = Math.floor(y - R + 0.5), j1 = Math.floor(y + R + 0.5);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const t = tileAt(i, j);
      if (t === '^' && circleBox(x, y, R * 0.85, i - 0.3, j - 0.5, i + 0.3, j + 0.12)) return die();
      if (t === 'v' && circleBox(x, y, R * 0.85, i - 0.3, j - 0.12, i + 0.3, j + 0.5)) return die();
      if (t === '*' && Math.abs(x - i) < 0.6 && y - R < j - 0.5 + 0.38 && y > j - 0.7 && ball.vy <= 1) {
        ball.vy = P.SPRING; ball.grounded = false; ball.coyote = 0; ball.jumping = false; ball.squash = -0.3;
        const sp = springs.get(i + ',' + j); if (sp) sp.t = 0.35;
        sfx.spring();
      }
    }
  }

  for (const mv of movers) {
    const dx = x - mv.cx, dy = y - mv.cy, rr = R + P.SPIDER_R;
    if (dx * dx + dy * dy < rr * rr) return die();
  }

  if (ball.size !== 'big') {
    for (const p of pumps) {
      if (circleBox(x, y, R, p.x - 0.35, p.y - 0.5, p.x + 0.35, p.y + 0.25)) {
        setSize('big'); p.t = 0.5;
        ball.y += 0.25;
        sfx.inflate(); burst(x, y, 0x9dffb8, 26, 3.5); toast('Pumped up! Big balls float and jump higher');
        break;
      }
    }
  }
  if (ball.size !== 'small') {
    for (const p of pins) {
      if (circleBox(x, y, R, p.x - 0.2, p.y - 0.5, p.x + 0.2, p.y + 0.2)) {
        setSize('small'); p.t = 0.5;
        sfx.deflate(); burst(x, y, 0x8cc4ff, 26, 3); toast('Shrunk! Small balls sink and fit under slabs');
        break;
      }
    }
  }

  for (const lv of levers) {
    if (lv.used) continue;
    if (circleBox(x, y, R, lv.x - 0.5, lv.y - 0.5, lv.x + 0.5, lv.y + 0.5)) {
      lv.used = true;
      return enterPinball(lv);
    }
  }

  for (const r of rings) {
    if (r.taken) continue;
    const dx = x - r.x, dy = y - r.y, rr = R + 0.35;
    if (dx * dx + dy * dy < rr * rr) {
      r.taken = true; ringsGot++;
      addScore(SCORE.ring);
      sfx.ring(); burst(r.x, r.y, 0xffd84a, 22, 3.5);
      updateHUD();
      if (ringsGot === rings.length) setPortalOpen();
    }
  }

  for (const it of lifeItems) {
    if (it.taken) continue;
    const dx = x - it.x, dy = y - it.y, rr = R + 0.3;
    if (dx * dx + dy * dy < rr * rr) {
      it.taken = true; it.mesh.visible = false; lives = Math.min(lives + 1, 9);
      addScore(SCORE.life);
      sfx.life(); burst(it.x, it.y, 0xff3b6b, 30, 3); toast('+1 Life'); updateHUD();
    }
  }

  for (const cp of checkpoints) {
    if (cp.active) continue;
    if (Math.abs(x - cp.x) < 0.7 && y > cp.y - 0.6 && y < cp.y + 1.8) {
      for (const o of checkpoints) if (o.active) { o.active = false; o.mat.color.set(0x6b7285); o.mat.emissive.set(0x000000); }
      cp.active = true; cp.mat.color.set(0x5ff7ff); cp.mat.emissive.set(0x0a8aa0);
      respawn = { x: cp.x, y: cp.y, size: ball.size };
      sfx.checkpoint(); burst(cp.x, cp.y + 1, 0x5ff7ff, 26, 3, -0.7);
      toast('Checkpoint');
    }
  }

  if (exitE && Math.abs(x - exitE.x) < 0.6 && y > exitE.y - 0.6 && y < exitE.y + 1.4) {
    if (portalOpen) return completeLevel();
    if (exitHintCooldown <= 0) {
      toast(`Collect all rings first (${ringsGot}/${rings.length})`);
      exitHintCooldown = 2.5;
    }
  }
  exitHintCooldown -= dt;

  if (y < -3) return die();
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
let state = 'menu';
let deathTimer = 0;

function placeBall(p) {
  setSize(p.size || 'normal');
  ball.vr = ball.r;
  ball.wet = 0;
  ball.x = p.x; ball.y = p.y - 0.5 + ball.r + 0.01;
  ball.vx = ball.vy = 0; ball.grounded = true; ball.coyote = 0; ball.buffer = 0; ball.jumping = false;
  ball.squash = 0;
  ballPivot.visible = true;
}

function startLevel(idx, freshLives = false) {
  if (freshLives) { lives = 3; score = 0; levelScore = 0; }
  score -= levelScore; // restarting a level takes back what it earned
  buildLevel(idx);
  respawn = { ...startPos, size: 'normal' };
  warp = null; fadeEl.classList.remove('on'); pinHudEl.classList.remove('show');
  placeBall(startPos);
  elapsed = 0;
  state = 'playing';
  showScreen(null);
  updateHUD();
  snapCamera();
  toast(isTouch && L.touchHint ? L.touchHint : L.hint, 4200);
  if (isTouch) showTouchHints();
}

function restartLevel() { startLevel(levelIdx); }

function die() {
  if (state !== 'playing') return;
  state = 'dying';
  deathTimer = 1.2;
  ballPivot.visible = false;
  burst(ball.x, ball.y, 0xff3030, 50, 5);
  burst(ball.x, ball.y, 0xfff4e6, 20, 3);
  sfx.die();
  lives--;
  updateHUD();
  if (navigator.vibrate) { try { navigator.vibrate(80); } catch { /* ignore */ } }
}

function afterDeath() {
  if (lives <= 0) {
    state = 'gameover';
    showScreen('gameover');
    return;
  }
  placeBall(respawn);
  state = 'playing';
}

function completeLevel() {
  state = 'complete';
  addScore(SCORE.level);
  levelScore = 0;
  if (score > hiScore) { hiScore = score; store.set('hiscore', hiScore); }
  sfx.win();
  burst(exitE.x, exitE.y + 0.5, 0x7dffd0, 60, 5);
  ballPivot.visible = false;
  const key = String(levelIdx);
  const isBest = !bestTimes[key] || elapsed < bestTimes[key];
  if (isBest) { bestTimes[key] = elapsed; store.set('best', bestTimes); }
  if (levelIdx + 2 > unlocked) { unlocked = Math.min(LEVELS.length, levelIdx + 2); store.set('unlocked', unlocked); }
  if (levelIdx === LEVELS.length - 1) {
    $('victory-time').textContent = fmtTime(elapsed);
    $('victory-score').textContent = `Final score ${score}  ·  Best ${hiScore}`;
    setTimeout(() => showScreen('victory'), 700);
  } else {
    $('complete-title').textContent = `${L.name} cleared!`;
    $('complete-time').textContent = fmtTime(elapsed) + (isBest ? '  ★ best' : `  (best ${fmtTime(bestTimes[key])})`);
    $('complete-score').textContent = `Score ${score}`;
    $('complete-secret').textContent = secretThisLevel ? '✦ Secret bonus table found!' : secretsFound[key] ? '✦ Secret found before' : 'A secret bonus table is hidden here somewhere…';
    setTimeout(() => showScreen('complete'), 700);
  }
}

function nextLevel() {
  if (state !== 'complete') return;
  startLevel(Math.min(levelIdx + 1, LEVELS.length - 1));
}

function pause() {
  if (state !== 'playing' && state !== 'pinball') return;
  pausedFrom = state; state = 'paused'; showScreen('pause');
}
function resume() { if (state !== 'paused') return; state = pausedFrom; showScreen(null); last = performance.now(); }

function addScore(n) {
  score += n; levelScore += n;
  updateHUD();
}

// --- Secret pinball bonus table ---
function enterPinball(lv) {
  if (!pinball) pinball = new Pinball(scene, { ballMat: MAT.ball, sfx, burst });
  pinReturn = { x: ball.x, y: ball.y };
  lv.pivot.rotation.z = -0.6;
  secretThisLevel = true;
  secretsFound[String(levelIdx)] = true; store.set('secrets', secretsFound);
  sfx.secret();
  burst(ball.x, ball.y, 0xff4fd8, 40, 4);
  toast('✦ Secret found! Bonus pinball table', 2200);
  state = 'warp';
  warp = { t: 0, to: 'pinball' };
  fadeEl.classList.add('on');
}

function exitPinball() {
  const pts = pinball.points;
  addScore(pts);
  state = 'warp';
  warp = { t: 0, to: 'level', pts };
  fadeEl.classList.add('on');
}

function updateWarp(dt) {
  warp.t += dt;
  if (!warp.swapped && warp.t > 0.35) {
    warp.swapped = true;
    if (warp.to === 'pinball') {
      levelGroup.visible = false; ballPivot.visible = false;
      pinball.reset(); pinball.show();
      fogSave = { near: scene.fog.near, far: scene.fog.far };
      scene.fog.near = 60; scene.fog.far = 140;
      pinHudEl.classList.add('show');
    } else {
      pinball.hide();
      levelGroup.visible = true; ballPivot.visible = true;
      if (fogSave) { scene.fog.near = fogSave.near; scene.fog.far = fogSave.far; }
      ball.x = pinReturn.x; ball.y = pinReturn.y; ball.vx = ball.vy = 0;
      pinHudEl.classList.remove('show');
    }
    snapCamera();
    fadeEl.classList.remove('on');
  }
  if (warp.t > 0.7) {
    const to = warp.to, pts = warp.pts;
    warp = null;
    state = to === 'pinball' ? 'pinball' : 'playing';
    if (to === 'pinball') toast(isTouch ? 'Hold left / right side for the flippers. Swipe up to launch.' : '← → flippers, ↑ / Space to launch', 3000);
    else toast(`Bonus +${pts} points!`, 2400);
  }
}
let fogSave = null;

function toMenu() {
  state = 'menu';
  buildLevel(clamp(unlocked - 1, 0, LEVELS.length - 1));
  placeBall(startPos);
  showScreen('menu');
  refreshMenu();
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
const hudEl = $('hud');
const ringsEl = $('hud-rings');
const ringsTotalEl = $('hud-rings-total');
const livesEl = $('hud-lives');
const levelEl = $('hud-level');
const timeEl = $('hud-time');
const toastEl = $('toast');
const scoreEl = $('hud-score');
const pinHudEl = $('pin-hud');
const fadeEl = $('fade');
let toastTimer = 0;

function fmtTime(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

function updateHUD() {
  if (!L) return;
  ringsEl.textContent = ringsGot;
  ringsTotalEl.textContent = rings.length;
  livesEl.textContent = Math.max(0, lives);
  scoreEl.textContent = score;
  levelEl.textContent = `${levelIdx + 1}. ${L.name}`;
}

function toast(msg, ms = 1800) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}

const screens = ['menu', 'levels', 'help', 'pause', 'complete', 'gameover', 'victory'];
function showScreen(id) {
  for (const s of screens) $(s).classList.toggle('show', s === id);
  const inGame = id === null || id === 'pause';
  hudEl.classList.toggle('show', inGame);
  touchEl.classList.toggle('show', isTouch && id === null);
  if (id !== null && id !== 'pause') pinHudEl.classList.remove('show');
  if (id !== null) resetTouches();
}

function refreshMenu() {
  $('btn-play').textContent = unlocked > 1 ? `▶ Continue (Level ${unlocked})` : '▶ Play';
  const list = $('level-list');
  list.innerHTML = '';
  LEVELS.forEach((lv, i) => {
    const b = document.createElement('button');
    b.className = 'lvl';
    const locked = i + 1 > unlocked;
    b.disabled = locked;
    const best = bestTimes[String(i)];
    const sec = secretsFound[String(i)] ? ' <span class="sec" title="Secret found">✦</span>' : '';
    b.innerHTML = `<span class="n">${locked ? '🔒' : i + 1}</span><span class="t">${lv.name}${sec}</span><span class="b">${best ? '★ ' + fmtTime(best) : locked ? 'Locked' : 'Not cleared'}</span>`;
    b.addEventListener('click', () => { sfx.unlock(); sfx.click(); goFullscreen(); startLevel(i, true); });
    list.appendChild(b);
  });
  $('btn-sound').textContent = sfx.muted ? '🔇 Sound: Off' : '🔊 Sound: On';
  $('menu-hiscore').textContent = hiScore > 0 ? `Best score ${hiScore}` : '';
}

function goFullscreen() {
  if (!isTouch) return;
  const el = document.documentElement;
  if (!document.fullscreenElement && el.requestFullscreen) {
    el.requestFullscreen({ navigationUI: 'hide' }).then(() => {
      if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
    }).catch(() => {});
  }
}

function on(id, fn) { $(id).addEventListener('click', () => { sfx.unlock(); sfx.click(); fn(); }); }
on('btn-play', () => { goFullscreen(); startLevel(unlocked - 1, true); });
on('btn-levels', () => { refreshMenu(); showScreen('levels'); });
on('btn-help', () => showScreen('help'));
on('btn-sound', () => { sfx.setMuted(!sfx.muted); store.set('muted', sfx.muted); refreshMenu(); });
on('levels-back', () => showScreen('menu'));
on('help-back', () => showScreen('menu'));
on('hud-pause', () => pause());
on('btn-resume', () => resume());
on('btn-restart', () => restartLevel());
on('btn-quit', () => toMenu());
on('btn-next', () => nextLevel());
on('btn-complete-menu', () => toMenu());
on('btn-retry', () => startLevel(levelIdx, true));
on('btn-over-menu', () => toMenu());
on('btn-victory-menu', () => toMenu());

// PWA install
let deferredPrompt = null;
const installBtn = $('btn-install');
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.hidden = false;
});
installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice.catch(() => {});
  deferredPrompt = null;
  installBtn.hidden = true;
});
window.addEventListener('appinstalled', () => { installBtn.hidden = true; });

document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

// ---------------------------------------------------------------------------
// Camera & animation
// ---------------------------------------------------------------------------
const cam = { x: 0, y: 0 };
function camDistance() { return camera.aspect < 1 ? 12 + (1 - camera.aspect) * 12 : 12.5; }
function camTarget() {
  return {
    x: ball.x + clamp(ball.vx * 0.3, -1.5, 1.5),
    y: clamp(ball.y + 1, 4, Math.max(4, H - 4)),
  };
}
const inPinView = () => !!pinball && pinball.group.visible;
function pinCamDistance() {
  const halfV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  return Math.max(10.6 / halfV, 6.4 / (halfV * camera.aspect));
}
function snapCamera() {
  if (inPinView()) { cam.x = pinball.center.x; cam.y = pinball.center.y; return; }
  const t = camTarget(); cam.x = t.x; cam.y = t.y;
}

function updateCamera(dt, time) {
  if (inPinView()) {
    cam.x = pinball.center.x; cam.y = pinball.center.y;
    camera.position.set(cam.x, cam.y + 0.3, pinCamDistance());
    camera.lookAt(cam.x, cam.y, 0);
    sun.position.set(cam.x + 5, cam.y + 12, 12);
    sun.target.position.set(cam.x, cam.y - 2, 0);
    return;
  }
  let tx, ty;
  if (state === 'menu' || state === 'levels') {
    tx = W / 2 + Math.sin(time * 0.08) * (W / 2 - 8);
    ty = 5;
  } else {
    const t = camTarget(); tx = t.x; ty = t.y;
  }
  const k = 1 - Math.exp(-dt * 4.5);
  cam.x += (tx - cam.x) * k;
  cam.y += (ty - cam.y) * (1 - Math.exp(-dt * 3));
  const dist = camDistance();
  camera.position.set(cam.x, cam.y + 2.4, dist);
  camera.lookAt(cam.x, cam.y, 0);
  sun.position.set(cam.x + 6, cam.y + 12, 10);
  sun.target.position.set(cam.x, cam.y - 2, 0);
}

function animate(dt, time) {
  // Ball visuals (visual radius eases toward the physics radius when inflating / deflating)
  ball.vr += (ball.r - ball.vr) * (1 - Math.exp(-dt * 12));
  if (state === 'playing' || state === 'menu') {
    ball.roll -= (ball.vx * dt) / ball.r;
  }
  ball.squash *= Math.exp(-dt * 10);
  const sq = clamp(ball.squash, -0.3, 0.4);
  const k = ball.vr / P.R;
  ballPivot.position.set(ball.x, ball.y - sq * ball.vr * 0.5, 0);
  ballPivot.scale.set(k * (1 + sq * 0.5), k * (1 - sq), k * (1 + sq * 0.5));
  ballMesh.rotation.z = ball.roll;

  // fake bricks turn see-through while the ball is inside or touching them
  let near = false;
  for (const [i, j] of fakeTiles) {
    if (Math.abs(ball.x - i) < 0.5 + ball.r + 0.15 && Math.abs(ball.y - j) < 0.5 + ball.r + 0.15) { near = true; break; }
  }
  fakeOpacity += ((near && state !== 'menu' ? 0.28 : 1) - fakeOpacity) * (1 - Math.exp(-dt * 8));
  for (const m of FADE_MATS) { m.opacity = fakeOpacity; m.depthWrite = fakeOpacity > 0.95; }

  for (const lv of levers) {
    if (!lv.used) lv.pivot.rotation.z = 0.6 + Math.sin(time * 3) * 0.08;
  }
  for (const p of pumps) {
    p.t = Math.max(0, p.t - dt);
    const c = p.t > 0 ? Math.sin((p.t / 0.5) * Math.PI) : 0;
    p.handle.position.y = 0.4 - c * 0.25; p.rod.position.y = 0.2 - c * 0.12;
    p.arrow.position.y = 0.75 + Math.sin(time * 4) * 0.06;
    p.arrow.rotation.y = time * 2;
  }
  for (const p of pins) {
    p.arrow.position.y = 0.62 + Math.sin(time * 4 + 1) * 0.06;
    p.arrow.rotation.y = -time * 2;
  }
  for (const b of blowers) {
    b.rotor.rotation.y = time * 18;
    const hgt = b.top - (b.y - 0.5);
    for (const st of b.streaks) {
      const u = (time * 0.7 + st.userData.off) % 1;
      st.position.y = -0.4 + u * hgt;
      st.scale.y = 0.6 + (1 - u) * 0.8;
      st.visible = u < 0.95;
    }
  }

  for (const r of rings) {
    if (r.taken) {
      if (r.mesh.visible) {
        r.t += dt;
        const s = Math.max(0, 1 - r.t * 4);
        r.mesh.scale.setScalar(1 + r.t * 3);
        r.mesh.position.y = r.y + r.t * 2;
        r.mesh.visible = s > 0;
      }
      continue;
    }
    r.mesh.rotation.y = time * 1.6 + r.phase;
    r.mesh.position.y = r.y + Math.sin(time * 2 + r.phase) * 0.06;
  }
  for (const it of lifeItems) {
    if (it.taken) continue;
    it.mesh.rotation.y = time * 2;
    it.mesh.position.y = it.y + Math.sin(time * 3) * 0.08;
  }
  for (const cp of checkpoints) {
    cp.crystal.rotation.y = time * (cp.active ? 3 : 0.8);
    cp.crystal.position.y = 1.05 + (cp.active ? Math.sin(time * 4) * 0.06 : 0);
  }
  if (state === 'menu') { clock += dt; updateMovers(); }
  for (const mv of movers) {
    mv.mesh.position.set(mv.cx, mv.cy + Math.sin(time * 6 + mv.seed) * 0.04, 0);
    // face the direction of travel a little, wiggle legs
    const vx = Math.cos(clock * mv.speed + mv.phase) * (mv.axis === 'x' ? 1 : 0);
    mv.mesh.rotation.y = vx * 0.35;
    mv.mesh.rotation.z = Math.sin(time * 2 + mv.seed) * 0.08;
    for (const lg of mv.legs) {
      lg.hip.rotation.x = Math.sin(time * 9 + lg.k * 1.3 + (lg.sx > 0 ? 0 : 1.6)) * 0.35;
      lg.hip.rotation.z = lg.sx * Math.sin(time * 9 + lg.k) * 0.12;
    }
  }
  for (const sp of springs.values()) {
    sp.t = Math.max(0, sp.t - dt);
    const c = sp.t > 0 ? Math.sin((sp.t / 0.35) * Math.PI) : 0;
    sp.pad.position.y = -0.18 + c * 0.25;
    sp.coils[0].position.y = -0.34 + c * 0.08;
    sp.coils[1].position.y = -0.26 + c * 0.17;
  }
  if (exitE) {
    exitE.torus.rotation.z = time * (portalOpen ? 2.5 : 0.5);
    exitE.disc.scale.setScalar(portalOpen ? 1 + Math.sin(time * 5) * 0.05 : 1);
    if (portalOpen && Math.random() < dt * 20) {
      const a = Math.random() * Math.PI * 2;
      burst(exitE.x + Math.cos(a) * 0.75, exitE.y + 0.5 + Math.sin(a) * 0.75, 0x7dffd0, 1, 0.6);
    }
  }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = camera.aspect < 1 ? 55 : 45;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));
resize();

let last = performance.now();
let acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const time = now / 1000;

  if (state === 'pinball') {
    readInput();
    const launch = touchJumpQueued || (input.jump && !input.jumpPrev);
    touchJumpQueued = false;
    pinball.update(dt, { left: input.left, right: input.right, launch });
    pinHudEl.textContent = `BONUS ${pinball.points}  ·  BALL ${Math.min(PIN_BALLS, PIN_BALLS - pinball.ballsLeft + 1)}/${PIN_BALLS}`;
    if (pinball.done) exitPinball();
  } else if (state === 'warp') {
    updateWarp(dt);
  } else if (state === 'playing') {
    readInput();
    if (touchJumpQueued) { touchJumpQueued = false; ball.buffer = 0.13; ball.bufferTouch = true; }
    else if (input.jump && !input.jumpPrev) { ball.buffer = 0.13; ball.bufferTouch = false; }
    acc += dt;
    while (acc >= P.STEP) {
      step(P.STEP);
      acc -= P.STEP;
      if (state !== 'playing') { acc = 0; break; }
    }
    elapsed += dt;
    timeEl.textContent = fmtTime(elapsed);
  } else if (state === 'dying') {
    deathTimer -= dt;
    if (deathTimer <= 0) afterDeath();
  }

  animate(dt, time);
  updateParticles(dt);
  updateCamera(dt, time);
  renderer.render(scene, camera);
}

toMenu();
snapCamera();
requestAnimationFrame(frame);

// Debug hook for automated testing: open the game with ?debug in the URL.
if (new URLSearchParams(location.search).has('debug')) {
  window.__rebound = {
    get state() { return state; }, ball, get lives() { return lives; }, get rings() { return ringsGot + '/' + rings.length; },
    get score() { return score; }, get pinball() { return pinball; }, levers: () => levers, setSize, kb,
    startLevel, setClock(t) { clock = t; }, teleport(x, y) { ball.x = x; ball.y = y; ball.vx = ball.vy = 0; },
    // Step physics directly (no rendering): returns max x reached and final state.
    simulate(sec, keys, stopAtX = Infinity) {
      Object.assign(kb, { left: false, right: false, jump: false }, keys);
      let maxX = ball.x, maxY = ball.y;
      for (let n = 0; n < sec / P.STEP && state === 'playing' && ball.x < stopAtX; n++) {
        if (keys.auto) kb.jump = ball.grounded ? !input.jump : true;
        readInput();
        if (input.jump && !input.jumpPrev) ball.buffer = 0.13;
        step(P.STEP);
        maxX = Math.max(maxX, ball.x); maxY = Math.max(maxY, ball.y);
      }
      Object.assign(kb, { left: false, right: false, jump: false });
      return { maxX, maxY, x: ball.x, y: ball.y, state };
    },
  };
}
