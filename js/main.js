import * as THREE from '../vendor/three.module.min.js';
import { LEVELS } from './levels.js';
import { Sfx } from './audio.js';

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
const sfx = new Sfx(store.get('muted', false));

// ---------------------------------------------------------------------------
// Physics constants (units = tiles, seconds)
// ---------------------------------------------------------------------------
const P = {
  R: 0.4, G: 28, JUMP: 12, SPRING: 18, SUPER: 17, BCAP: 15,
  MAXV: 5.5, ACC_G: 34, ACC_A: 20, DEC: 16, STEP: 1 / 120, MAXFALL: 24,
};

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
};

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
};

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
let ringsGot = 0, startPos = { x: 2, y: 2 }, respawn = { x: 2, y: 2 }, elapsed = 0;
let lives = 3;
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
const isSolid = (c) => c === '#' || c === 'b';

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
  levelIdx = idx;
  L = LEVELS[idx];
  W = L.W; H = L.H;
  grid = L.grid.map((r) => r.slice());
  levelGroup = new THREE.Group();
  scene.add(levelGroup);
  rings = []; checkpoints = []; lifeItems = []; movers = []; springs = new Map(); exitE = null;
  ringsGot = 0; portalOpen = false;

  const hue = L.hue;
  makeSky(hue);
  MAT.edge.color.setHSL(hue / 360, 0.45, 0.42);
  MAT.trim.color.setHSL(((hue + 150) % 360) / 360, 1, 0.6);

  const solids = [], bouncy = [], spikeUp = [], spikeDown = [], edges = [];
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const c = grid[j][i];
      switch (c) {
        case '#': solids.push([i, j]); if (!isSolid(tileAt(i, j + 1))) edges.push([i, j]); break;
        case 'b': bouncy.push([i, j]); break;
        case '^': spikeUp.push([i, j]); break;
        case 'v': spikeDown.push([i, j]); break;
        case '*': addSpring(i, j); break;
        case 'o': addRing(i, j); grid[j][i] = ' '; break;
        case 'C': addCheckpoint(i, j); grid[j][i] = ' '; break;
        case '+': addLife(i, j); grid[j][i] = ' '; break;
        case 'E': addExit(i, j); grid[j][i] = ' '; break;
        case 'S': startPos = { x: i, y: j }; grid[j][i] = ' '; break;
        default: break;
      }
    }
  }

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3(), col = new THREE.Color();

  const blocks = new THREE.InstancedMesh(GEO.box, MAT.brick, solids.length);
  solids.forEach(([i, j], k) => {
    m.makeTranslation(i, j, 0);
    blocks.setMatrixAt(k, m);
    col.setHSL((((hue + j * 5 + hash(i, j) * 20) % 360) + 360) % 360 / 360, 0.38, 0.42 + hash(j, i) * 0.12);
    blocks.setColorAt(k, col);
  });
  blocks.castShadow = blocks.receiveShadow = true;
  levelGroup.add(blocks);

  if (edges.length) {
    const em = new THREE.InstancedMesh(GEO.edge, MAT.edge, edges.length);
    const tm = new THREE.InstancedMesh(GEO.trim, MAT.trim, edges.length);
    edges.forEach(([i, j], k) => {
      m.makeTranslation(i, j + 0.5, 0); em.setMatrixAt(k, m);
      m.makeTranslation(i, j + 0.5, 1.01); tm.setMatrixAt(k, m);
    });
    em.receiveShadow = true;
    levelGroup.add(em, tm);
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
    const g = new THREE.Group();
    const a = new THREE.Mesh(GEO.hazard, MAT.hazard);
    const b = new THREE.Mesh(GEO.hazard, MAT.hazard);
    b.rotation.set(0.6, 0.9, 0.3);
    a.castShadow = b.castShadow = true;
    g.add(a, b);
    levelGroup.add(g);
    movers.push({ ...mv, mesh: g, cx: mv.x, cy: mv.y });
  }

  ringsTotalEl.textContent = rings.length;
  updateHUD();
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
  if (k) { kb[k] = true; if (state === 'playing') e.preventDefault(); }
  if (e.code === 'Escape' || e.code === 'KeyP') { if (state === 'playing') pause(); else if (state === 'paused') resume(); }
  if (e.code === 'KeyR' && (state === 'playing' || state === 'paused')) restartLevel();
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

function step(dt) {
  clock += dt;
  updateMovers();
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

  ball.coyote = ball.grounded ? 0.1 : ball.coyote - dt;
  ball.buffer -= dt;
  if (ball.buffer > 0 && ball.coyote > 0) {
    ball.vy = P.JUMP;
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
  const R = P.R;
  ball.grounded = false;
  for (let iter = 0; iter < 2; iter++) {
    const i0 = Math.floor(ball.x - R + 0.5), i1 = Math.floor(ball.x + R + 0.5);
    const j0 = Math.floor(ball.y - R + 0.5), j1 = Math.floor(ball.y + R + 0.5);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const t = tileAt(i, j);
        if (!isSolid(t)) continue;
        const px = clamp(ball.x, i - 0.5, i + 0.5), py = clamp(ball.y, j - 0.5, j + 0.5);
        let dx = ball.x - px, dy = ball.y - py;
        let d2 = dx * dx + dy * dy;
        if (d2 >= R * R) continue;
        let nx, ny, pen;
        if (d2 < 1e-9) { nx = 0; ny = 1; pen = (j + 0.5 + R) - ball.y; } else {
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

        const e = -vn > 4 ? 0.3 : 0;
        ball.vx -= (1 + e) * vn * nx;
        ball.vy -= (1 + e) * vn * ny;
        if (ny > 0.6 && -vn > 5) { ball.squash = Math.min(0.3, -vn * 0.02); if (-vn > 8) sfx.land(); }
        if (ny < -0.6 && ball.vy > 0) { ball.vy = 0; ball.jumping = false; }
      }
    }
  }
}

function interact(dt) {
  const R = P.R, x = ball.x, y = ball.y;
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
    const dx = x - mv.cx, dy = y - mv.cy;
    if (dx * dx + dy * dy < (R + 0.3) * (R + 0.3)) return die();
  }

  for (const r of rings) {
    if (r.taken) continue;
    const dx = x - r.x, dy = y - r.y;
    if (dx * dx + dy * dy < 0.75 * 0.75) {
      r.taken = true; ringsGot++;
      sfx.ring(); burst(r.x, r.y, 0xffd84a, 22, 3.5);
      updateHUD();
      if (ringsGot === rings.length) setPortalOpen();
    }
  }

  for (const it of lifeItems) {
    if (it.taken) continue;
    const dx = x - it.x, dy = y - it.y;
    if (dx * dx + dy * dy < 0.7 * 0.7) {
      it.taken = true; it.mesh.visible = false; lives = Math.min(lives + 1, 9);
      sfx.life(); burst(it.x, it.y, 0xff3b6b, 30, 3); toast('+1 Life'); updateHUD();
    }
  }

  for (const cp of checkpoints) {
    if (cp.active) continue;
    if (Math.abs(x - cp.x) < 0.7 && y > cp.y - 0.6 && y < cp.y + 1.8) {
      for (const o of checkpoints) if (o.active) { o.active = false; o.mat.color.set(0x6b7285); o.mat.emissive.set(0x000000); }
      cp.active = true; cp.mat.color.set(0x5ff7ff); cp.mat.emissive.set(0x0a8aa0);
      respawn = { x: cp.x, y: cp.y };
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
  ball.x = p.x; ball.y = p.y - 0.5 + P.R + 0.01;
  ball.vx = ball.vy = 0; ball.grounded = true; ball.coyote = 0; ball.buffer = 0; ball.jumping = false;
  ball.squash = 0;
  ballPivot.visible = true;
}

function startLevel(idx, freshLives = false) {
  if (freshLives) lives = 3;
  buildLevel(idx);
  respawn = { ...startPos };
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
  sfx.win();
  burst(exitE.x, exitE.y + 0.5, 0x7dffd0, 60, 5);
  ballPivot.visible = false;
  const key = String(levelIdx);
  const isBest = !bestTimes[key] || elapsed < bestTimes[key];
  if (isBest) { bestTimes[key] = elapsed; store.set('best', bestTimes); }
  if (levelIdx + 2 > unlocked) { unlocked = Math.min(LEVELS.length, levelIdx + 2); store.set('unlocked', unlocked); }
  if (levelIdx === LEVELS.length - 1) {
    $('victory-time').textContent = fmtTime(elapsed);
    setTimeout(() => showScreen('victory'), 700);
  } else {
    $('complete-title').textContent = `${L.name} cleared!`;
    $('complete-time').textContent = fmtTime(elapsed) + (isBest ? '  ★ best' : `  (best ${fmtTime(bestTimes[key])})`);
    setTimeout(() => showScreen('complete'), 700);
  }
}

function nextLevel() {
  if (state !== 'complete') return;
  startLevel(Math.min(levelIdx + 1, LEVELS.length - 1));
}

function pause() { if (state !== 'playing') return; state = 'paused'; showScreen('pause'); }
function resume() { if (state !== 'paused') return; state = 'playing'; showScreen(null); last = performance.now(); }

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
    b.innerHTML = `<span class="n">${locked ? '🔒' : i + 1}</span><span class="t">${lv.name}</span><span class="b">${best ? '★ ' + fmtTime(best) : locked ? 'Locked' : 'Not cleared'}</span>`;
    b.addEventListener('click', () => { sfx.unlock(); sfx.click(); goFullscreen(); startLevel(i, true); });
    list.appendChild(b);
  });
  $('btn-sound').textContent = sfx.muted ? '🔇 Sound: Off' : '🔊 Sound: On';
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

document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'playing') pause(); });

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
function snapCamera() { const t = camTarget(); cam.x = t.x; cam.y = t.y; }

function updateCamera(dt, time) {
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
  // Ball visuals
  if (state === 'playing' || state === 'menu') {
    ball.roll -= (ball.vx * dt) / P.R;
  }
  ball.squash *= Math.exp(-dt * 10);
  const sq = clamp(ball.squash, -0.3, 0.4);
  ballPivot.position.set(ball.x, ball.y - sq * P.R * 0.5, 0);
  ballPivot.scale.set(1 + sq * 0.5, 1 - sq, 1 + sq * 0.5);
  ballMesh.rotation.z = ball.roll;

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
    mv.mesh.position.set(mv.cx, mv.cy, 0);
    mv.mesh.rotation.x = time * 2; mv.mesh.rotation.z = -time * 3;
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

  if (state === 'playing') {
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
