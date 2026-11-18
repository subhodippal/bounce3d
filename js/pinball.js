// Bonus pinball table, entered through a hidden lever in each level.
// Left / right input flips the flippers, JUMP launches the ball. 3 balls, then you exit with the points.
import * as THREE from '../vendor/three.module.min.js';

// Every level has its own, nastier table: stronger gravity and kicks, shorter flippers, more bumpers,
// moving bumpers and a score multiplier. Index = level index (clamped to the last entry).
const TABLES = [
  { name: 'WARM-UP',   g: 15,   bump: 7,  sling: 7,  fl: 1.55, vmax: 24, extra: [],                 movers: 0, mult: 1,   tint: 0xffffff },
  { name: 'SPRINGY',   g: 15.5, bump: 7.5, sling: 7, fl: 1.5,  vmax: 24, extra: ['A', 'B'],         movers: 0, mult: 1,   tint: 0xbfffd8 },
  { name: 'POP ALLEY', g: 16,   bump: 8,  sling: 8,  fl: 1.5,  vmax: 25, extra: ['A', 'B', 'D', 'E'], movers: 1, mult: 1.5, tint: 0xffe0a8 },
  { name: 'SWEEPER',   g: 16.5, bump: 8.5, sling: 8.5, fl: 1.45, vmax: 25, extra: ['A', 'B', 'D', 'E'], movers: 1, mult: 2,   tint: 0xffb8c8, speed: 1.2 },
  { name: 'TWIN SWEEP', g: 17,  bump: 9,  sling: 9,  fl: 1.4,  vmax: 26, extra: ['A', 'B', 'D', 'E'], movers: 2, mult: 2.5, tint: 0xd2b8ff, speed: 1.3 },
  { name: 'THE PIT',   g: 17.5, bump: 9.5, sling: 9.5, fl: 1.35, vmax: 26, extra: ['A', 'B', 'C', 'D', 'E'], movers: 2, mult: 3, tint: 0xa8e8ff, speed: 1.4 },
  { name: 'PANIC',     g: 18.5, bump: 10, sling: 10, fl: 1.3,  vmax: 27, extra: ['A', 'B', 'C', 'D', 'E'], movers: 2, mult: 4, tint: 0xff9a9a, speed: 1.7 },
  { name: 'MELTDOWN',  g: 19,   bump: 11, sling: 11, fl: 1.25, vmax: 28, extra: ['A', 'B', 'C', 'D', 'E'], movers: 2, mult: 5, tint: 0xff7ad0, speed: 2.1 },
];
// optional bumpers (switched on per table) and the two sweeping ones
const EXTRA = { A: { x: -3.4, y: 8.5, r: 0.5, score: 120 }, B: { x: 3.4, y: 8.5, r: 0.5, score: 120 }, C: { x: 0, y: 3.7, r: 0.34, score: 300 },
  D: { x: -1.1, y: 13.7, r: 0.4, score: 200 }, E: { x: 1.1, y: 13.7, r: 0.4, score: 200 } };
const MOVERS = [{ x0: 0, y: 5.9, amp: 2.3, speed: 1.3, phase: 0, r: 0.4, score: 200 }, { x0: 0, y: 12.7, amp: 2.0, speed: 1.7, phase: 2, r: 0.38, score: 250 }];
const BASE_G = 15;
const BR = 0.28;       // ball radius
const SUB = 1 / 240;   // physics sub-step
const FL_LEN = 1.55, FL_R = 0.14, FL_REST = -0.5, FL_UP = 0.5;
export const PIN_BALLS = 3;

export class Pinball {
  constructor(scene, { ballMat, sfx, burst, origin = { x: -60, y: 0 } }) {
    this.sfx = sfx; this.burst = burst; this.origin = origin;
    this.group = new THREE.Group();
    this.group.position.set(origin.x, origin.y, 0);
    this.group.visible = false;
    scene.add(this.group);
    this.center = { x: origin.x + 0.5, y: origin.y + 9.1 };

    // --- geometry definition (table-local coordinates) ---
    const segs = [];
    const wall = (x1, y1, x2, y2, opt = {}) => segs.push({ x1, y1, x2, y2, e: 0.45, ...opt });
    wall(-5, 2.8, -5, 13);
    const arcN = 16;
    for (let k = 0; k < arcN; k++) {
      const a1 = Math.PI - (k / arcN) * Math.PI, a2 = Math.PI - ((k + 1) / arcN) * Math.PI;
      wall(0.5 + Math.cos(a1) * 5.5, 13 + Math.sin(a1) * 5.5, 0.5 + Math.cos(a2) * 5.5, 13 + Math.sin(a2) * 5.5);
    }
    wall(6, 13, 6, 0.6);          // outer right wall
    wall(5, 0.6, 6, 0.6);         // plunger floor
    wall(5, 0.6, 5, 10.2);        // lane inner wall
    wall(-5, 2.8, -2.0, 1.45);    // left inlane
    wall(5, 2.8, 2.0, 1.45);      // right inlane
    wall(-3.9, 5.4, -2.8, 3.1, { kick: 7, score: 25, sling: true });
    wall(3.9, 5.4, 2.8, 3.1, { kick: 7, score: 25, sling: true });
    wall(-3.9, 5.4, -3.9, 4.2);
    wall(3.9, 5.4, 3.9, 4.2);
    wall(-3.9, 4.2, -2.8, 3.1);
    wall(3.9, 4.2, 2.8, 3.1);
    // small upper guides
    wall(-3.2, 11.2, -2.6, 12.1);
    wall(3.2, 11.2, 2.6, 12.1);
    this.segs = segs;

    this.bumpers = [
      { x: -2.0, y: 9.6, r: 0.62, score: 100 },
      { x: 2.0, y: 9.6, r: 0.62, score: 100 },
      { x: 0, y: 7.4, r: 0.62, score: 150 },
      { x: 0, y: 11.6, r: 0.45, score: 250 },
    ];
    for (const k of Object.keys(EXTRA)) this.bumpers.push({ ...EXTRA[k], key: k, extra: true });
    MOVERS.forEach((m, i) => this.bumpers.push({ ...m, mover: i, extra: true }));
    this.lights = [
      { x: -3.6, y: 7.6 }, { x: -1.2, y: 12.9 }, { x: 1.2, y: 12.9 }, { x: 3.6, y: 7.6 },
    ];
    this.flippers = [
      { px: -2.0, py: 1.45, side: 1, a: FL_REST, w: 0 },
      { px: 2.0, py: 1.45, side: -1, a: FL_REST, w: 0 },
    ];

    this.t = 0;
    this.cfg = TABLES[0];
    this.flLen = FL_LEN;
    this.buildMeshes(ballMat);
    this.setLevel(0);
    this.reset();
  }

  buildMeshes(ballMat) {
    const g = this.group;
    // back panel
    const tex = (() => {
      const c = document.createElement('canvas'); c.width = 256; c.height = 360;
      const x = c.getContext('2d');
      const grd = x.createLinearGradient(0, 0, 0, 360);
      grd.addColorStop(0, '#1a0b3a'); grd.addColorStop(0.5, '#0d1a4a'); grd.addColorStop(1, '#2a0b30');
      x.fillStyle = grd; x.fillRect(0, 0, 256, 360);
      x.strokeStyle = 'rgba(120,200,255,0.12)'; x.lineWidth = 2;
      for (let i = 0; i < 360; i += 18) { x.beginPath(); x.moveTo(0, i); x.lineTo(256, i + 40); x.stroke(); }
      x.fillStyle = 'rgba(255,220,90,0.85)'; x.font = 'bold 30px system-ui, sans-serif'; x.textAlign = 'center';
      x.fillText('BONUS', 128, 252);
      x.fillStyle = 'rgba(120,220,255,0.6)'; x.font = 'bold 16px system-ui, sans-serif';
      x.fillText('◀ ▶ FLIPPERS', 128, 274);
      const t = new THREE.CanvasTexture(x.canvas); t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    this.backMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(11.4, 19), this.backMat);
    back.position.set(0.5, 9, -0.45);
    back.receiveShadow = true;
    g.add(back);

    const wallMat = new THREE.MeshStandardMaterial({ color: 0x8fd8ff, emissive: 0x1a5a8a, metalness: 0.5, roughness: 0.3 });
    const slingMat = new THREE.MeshStandardMaterial({ color: 0xff5fd2, emissive: 0x8a1060, roughness: 0.3 });
    for (const s of this.segs) {
      const dx = s.x2 - s.x1, dy = s.y2 - s.y1, len = Math.hypot(dx, dy);
      const m = new THREE.Mesh(new THREE.BoxGeometry(len + 0.12, s.sling ? 0.22 : 0.14, 0.7), s.sling ? slingMat : wallMat);
      m.position.set((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2, 0);
      m.rotation.z = Math.atan2(dy, dx);
      m.castShadow = true;
      g.add(m);
      if (s.sling) s.mesh = m;
    }
    for (const b of this.bumpers) {
      const mat = new THREE.MeshStandardMaterial({ color: 0xffd84a, emissive: 0x9a5a00, metalness: 0.3, roughness: 0.25 });
      const m = new THREE.Mesh(new THREE.CylinderGeometry(b.r, b.r, 0.7, 28), mat);
      m.rotation.x = Math.PI / 2;
      m.position.set(b.x, b.y, 0);
      m.castShadow = true;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(b.r * 0.6, b.r * 0.6, 0.72, 20), new THREE.MeshBasicMaterial({ color: 0xff3b6b }));
      cap.rotation.x = Math.PI / 2; cap.position.set(b.x, b.y, 0.02);
      g.add(m, cap);
      b.mesh = m; b.mat = mat; b.cap = cap; b.flash = 0;
    }
    for (const l of this.lights) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x334466 });
      const m = new THREE.Mesh(new THREE.CircleGeometry(0.3, 20), mat);
      m.position.set(l.x, l.y, -0.4);
      g.add(m);
      l.mat = mat;
    }
    const flMat = new THREE.MeshStandardMaterial({ color: 0xff3344, emissive: 0x700010, roughness: 0.3, metalness: 0.2 });
    for (const f of this.flippers) {
      const geo = new THREE.BoxGeometry(FL_LEN, FL_R * 2, 0.6);
      geo.translate(FL_LEN / 2, 0, 0);
      const m = new THREE.Mesh(geo, flMat);
      m.position.set(f.px, f.py, 0);
      m.castShadow = true;
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.65, 16), wallMat);
      hub.rotation.x = Math.PI / 2; hub.position.set(f.px, f.py, 0);
      g.add(m, hub);
      f.mesh = m;
    }
    this.plunger = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.9, 12), new THREE.MeshStandardMaterial({ color: 0xc0c6d4, metalness: 1, roughness: 0.2 }));
    this.plunger.position.set(5.5, 0.15, 0);
    g.add(this.plunger);
    this.ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BR, 24, 16), ballMat);
    this.ballMesh.castShadow = true;
    g.add(this.ballMesh);
    const glow = new THREE.PointLight(0x88ccff, 6, 14, 1.5);
    glow.position.set(0.5, 9, 4);
    g.add(glow);
  }

  // Pick this level's table (harder every level).
  setLevel(idx) {
    const cfg = TABLES[Math.max(0, Math.min(TABLES.length - 1, idx | 0))];
    this.cfg = cfg; this.level = Math.max(0, Math.min(TABLES.length - 1, idx | 0));
    this.flLen = cfg.fl;
    for (const f of this.flippers) f.mesh.scale.x = cfg.fl / FL_LEN;
    for (const sg of this.segs) if (sg.sling) sg.kick = cfg.sling;
    for (const b of this.bumpers) {
      if (!b.extra) continue;
      b.on = b.mover !== undefined ? b.mover < cfg.movers : cfg.extra.includes(b.key);
      b.mesh.visible = b.on; b.cap.visible = b.on;
    }
    this.backMat.color.setHex(cfg.tint);
  }

  reset() {
    this.points = 0;
    this.ballsLeft = PIN_BALLS;
    this.done = false;
    this.endTimer = 0;
    for (const l of this.lights) { l.on = false; l.mat.color.set(0x334466); }
    this.newBall();
  }

  newBall() {
    this.b = { x: 5.5, y: 0.6 + BR + 0.01, vx: 0, vy: 0 };
    this.inLane = true;
    this.laneWait = 0;
    this.still = 0;
  }

  show() { this.group.visible = true; }
  hide() { this.group.visible = false; }

  add(pts, x, y, color) {
    this.points += Math.round(pts * this.cfg.mult);
    if (x !== undefined) this.burst(this.origin.x + x, this.origin.y + y, color, 10, 3);
  }

  // input: { left, right, launch }
  update(dt, input) {
    if (this.done) return;
    if (this.endTimer > 0) {
      this.endTimer -= dt;
      if (this.endTimer <= 0) {
        if (this.ballsLeft > 0) this.newBall(); else this.done = true;
      }
      this.render(dt);
      return;
    }
    const b = this.b;
    // plunger lane
    if (this.inLane) {
      this.laneWait += dt;
      if (b.x > 5 && b.y < 1.5 && Math.abs(b.vy) < 0.5 && (input.launch || this.laneWait > 1.6)) {
        b.vy = 22 * Math.sqrt(this.cfg.g / BASE_G) + Math.random() * 2.5;
        this.inLane = false;
        this.sfx.spring();
      }
    }
    for (let t = 0; t < dt - 1e-6; t += SUB) this.step(Math.min(SUB, dt - t), input);
    // stuck guard: nudge a ball that has stopped away from the flippers / plunger
    const sp = Math.hypot(b.vx, b.vy);
    if (sp < 0.4 && !(b.x > 5 && b.y < 1.5) && b.y > 2.2) this.still += dt; else this.still = 0;
    if (this.still > 2) { b.vx += (Math.random() - 0.5) * 6; b.vy += 5; this.still = 0; }
    if (b.x > 5 && b.y < 1.5 && !this.inLane && sp < 0.5) { this.inLane = true; this.laneWait = 0; }

    if (b.y < -0.8 || Math.abs(b.x - 0.5) > 7 || b.y > 20) {
      this.ballsLeft--;
      this.sfx.land();
      this.endTimer = 0.9;
    }
    this.render(dt);
  }

  step(dt, input) {
    const b = this.b;
    // flippers
    for (const f of this.flippers) {
      const pressed = f.side > 0 ? input.left : input.right;
      const target = pressed ? FL_UP : FL_REST;
      const prev = f.a;
      const sp = pressed ? 22 : 13;
      f.a = f.a < target ? Math.min(target, f.a + sp * dt) : Math.max(target, f.a - sp * dt);
      // direction angle of the flipper in table space
      const dirPrev = f.side > 0 ? prev : Math.PI - prev;
      f.dir = f.side > 0 ? f.a : Math.PI - f.a;
      f.w = (f.dir - dirPrev) / dt;
      if (pressed && !f.was) this.sfx.click();
      f.was = pressed;
    }

    this.t += dt;
    for (const bm of this.bumpers) if (bm.mover !== undefined && bm.on) {
      bm.x = bm.x0 + bm.amp * Math.sin(this.t * bm.speed * (this.cfg.speed || 1) + bm.phase);
      bm.mesh.position.x = bm.x; bm.cap.position.x = bm.x;
    }
    b.vy -= this.cfg.g * dt;
    const s = Math.hypot(b.vx, b.vy);
    if (s > this.cfg.vmax) { b.vx *= this.cfg.vmax / s; b.vy *= this.cfg.vmax / s; }
    b.x += b.vx * dt; b.y += b.vy * dt;

    for (const sg of this.segs) this.hitSeg(sg.x1, sg.y1, sg.x2, sg.y2, BR, sg, 0, 0, 0);
    for (const f of this.flippers) {
      const tx = f.px + Math.cos(f.dir) * this.flLen, ty = f.py + Math.sin(f.dir) * this.flLen;
      this.hitSeg(f.px, f.py, tx, ty, BR + FL_R, { e: 0.25 }, f.w, f.px, f.py);
    }
    for (const bm of this.bumpers) {
      if (bm.extra && !bm.on) continue;
      const dx = b.x - bm.x, dy = b.y - bm.y, d = Math.hypot(dx, dy), min = BR + bm.r;
      if (d < min && d > 1e-6) {
        const nx = dx / d, ny = dy / d;
        b.x = bm.x + nx * min; b.y = bm.y + ny * min;
        const vn = b.vx * nx + b.vy * ny;
        if (vn < 0) { b.vx -= 1.6 * vn * nx; b.vy -= 1.6 * vn * ny; }
        b.vx += nx * this.cfg.bump; b.vy += ny * this.cfg.bump;
        bm.flash = 0.15;
        this.add(bm.score, bm.x + nx * bm.r, bm.y + ny * bm.r, 0xffd84a);
        this.sfx.bumper();
      }
    }
    for (const l of this.lights) {
      if (l.on) continue;
      if ((b.x - l.x) ** 2 + (b.y - l.y) ** 2 < 0.5 * 0.5) {
        l.on = true; l.mat.color.set(0x5ff7ff);
        this.add(200, l.x, l.y, 0x5ff7ff);
        this.sfx.ring();
        if (this.lights.every((o) => o.on)) {
          this.add(1000, 0.5, 9, 0xff6fd0);
          this.sfx.life();
          this.bonusFlash = 1.2;
          for (const o of this.lights) { o.on = false; o.mat.color.set(0x334466); }
        }
      }
    }
  }

  // ball vs capsule segment (optionally rotating about px,py with angular velocity w)
  hitSeg(x1, y1, x2, y2, rad, opt, w, px, py) {
    const b = this.b;
    const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    let t = ((b.x - x1) * dx + (b.y - y1) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    const cx = x1 + dx * t, cy = y1 + dy * t;
    const ex = b.x - cx, ey = b.y - cy, d2 = ex * ex + ey * ey;
    if (d2 >= rad * rad || d2 < 1e-12) return;
    const d = Math.sqrt(d2), nx = ex / d, ny = ey / d;
    b.x = cx + nx * rad; b.y = cy + ny * rad;
    const ux = -w * (cy - py), uy = w * (cx - px);   // surface velocity at contact
    const rvx = b.vx - ux, rvy = b.vy - uy;
    const vn = rvx * nx + rvy * ny;
    if (vn < 0) {
      b.vx -= (1 + opt.e) * vn * nx; b.vy -= (1 + opt.e) * vn * ny;
      if (opt.kick && -vn > 1.5) {
        b.vx += nx * opt.kick; b.vy += ny * opt.kick;
        this.add(opt.score, cx, cy, 0xff6fd0);
        this.sfx.bounce();
        if (opt.mesh) opt.flash = 0.12;
      }
    }
  }

  render(dt) {
    const b = this.b;
    this.ballMesh.position.set(b.x, b.y, 0);
    this.ballMesh.rotation.z -= (b.vx * dt) / BR;
    this.ballMesh.visible = this.endTimer <= 0;
    for (const f of this.flippers) f.mesh.rotation.z = f.dir ?? (f.side > 0 ? FL_REST : Math.PI - FL_REST);
    for (const bm of this.bumpers) {
      if (bm.extra && !bm.on) continue;
      bm.flash = Math.max(0, bm.flash - dt);
      const k = bm.flash > 0 ? 1.18 : 1;
      bm.mesh.scale.set(k, 1, k);
      bm.mat.emissive.setHex(bm.flash > 0 ? 0xffee88 : 0x9a5a00);
    }
    for (const s of this.segs) if (s.sling) { s.flash = Math.max(0, (s.flash || 0) - dt); s.mesh.scale.y = s.flash > 0 ? 1.8 : 1; }
    this.plunger.position.y = this.inLane && b.y < 1.5 ? 0.15 - Math.min(0.3, this.laneWait * 0.25) : 0.15;
  }
}
