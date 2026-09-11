/*
 * grow, September 2015.
 *
 * A bead runs round a closed loop. Hold the button and it climbs off the
 * surface along the outward normal, dragging a new stretch with it; let go and
 * it falls back, and what it drew replaces the stretch it left. The loop keeps
 * every pull, and the view backs off as it grows.
 *
 * The gold sits off the loop and comes past once a lap. What happens then is
 * settled by how high the bead is standing: level takes it, over it closes the
 * loop round it and it is gone, under leaves it for the next lap. So a pull has
 * to be started about a second early and let go of at the right height.
 *
 * The size of the loop sets the scale for everything else: thrust, travel, the
 * gap two nodes are kept apart. So the picture holds its size and pace as the
 * loop grows, rather than the bead crawling round a longer loop.
 *
 * Every cut smooths a little. The curve the bead draws is the loop offset
 * outwards, and an outward offset inside a dip folds over itself, so a dip left
 * alone grows spikes that grow their own.
 *
 * A pull that has covered SPAN of the loop stops pushing, or it carries the
 * bead round to its own takeoff and the splice has nothing left to cut.
 *
 * No gfx.js: the loop is one stroked path and the rest is discs.
 */

import * as ent from "./lib/entity.js";
import { camera } from "./lib/camera.js";
import { gameOver, score, SIZE } from "./lib/one.js";

export const meta = {
  title: "grow",
  desc: `
hold to pull the loop out to the gold
go too far and the loop swallows it
`,
  bg: "#bf1b25",
  fg: "#f7f0e8",
  scoreMax: true,
  date: "2015-09-08",
};

// The 480 box, and one world unit in one.js's 1024.
const W = 480;
const K = SIZE / W;

const WHITE = 0xf7f0e8;
const DARK = 0x3d0a0e;
const GOLD = 0xffcf5c;

const R0 = 100;
const NODES = 28;
const MINGAP = 10;

// Three numbers for the climb: a push out along the normal, drag on the square
// of the speed, and a spring back. They settle at REACH.
const SPEED = 80;
const THRUST = 500;
const DRAG = 0.1;
const SPRING = 10;
const REACH = THRUST / SPRING;

// A pull is nowhere near this long. It is here so holding the button cannot
// carry the bead round to its own takeoff, leaving the splice nothing to cut.
const SPAN = 0.35;

const SMOOTH = 0.2;

// The two summed are the tolerance on a crossing, so gold is taken exactly
// when the discs meet.
const BEAD = 8;
const GOLDR = 7;

const GOLDS = 3;
const NEAR = 24;
const FAR = REACH - 14;
const RAMP = 12;

// PULL_COST is on top of the second a second already costs, so holding the
// button the whole round spends 1.75 seconds a second.
const START = 12;
const BONUS = 2;
const HOLDCOST = 0.75;

const PAD = 24;

const TAU = 2 * Math.PI;
const css = (c) => `#${c.toString(16).padStart(6, "0")}`;
const mod = (a, b) => ((a % b) + b) % b;

// A multiple of the opening ring. Every length in the game is in these units.
let scale = 1;

let path = null;
let cursor = null;
let golds = [];
let clock = 0;
let version = -1;

/*
 * The loop: a cycle of nodes, each carrying the outward normal at it and the
 * arc length up to it. `t` runs along it in world units and wraps at `len`.
 *
 * The geometry is built in the constructor rather than begin(), because init()
 * places the gold off the loop before the first frame has run.
 */
class Path extends ent.Entity {
  constructor() {
    super();
    this.pts = [];
    for (let i = 0; i < NODES; ++i) {
      const a = TAU * i / NODES;
      this.pts.push({ x: 240 + R0 * Math.cos(a), y: 240 + R0 * Math.sin(a) });
    }
    // `head` is the bead itself; the arc takes a point every few frames.
    this.arc = null;
    this.arcAt = 0;
    this.head = null;
    this.box = [0, 0, 0, 0];
    // A cut re-parameterises the loop, so anything holding a `t` remeasures.
    this.version = 0;
    this.rebuild();
    this.measure();
  }

  // Remeasure the loop, dropping nodes that landed on top of each other.
  rebuild() {
    this.version += 1;
    const gap = MINGAP * scale;
    const kept = [this.pts[0]];
    for (let i = 1; i < this.pts.length; ++i) {
      const p = this.pts[i];
      const q = kept[kept.length - 1];
      if (Math.hypot(p.x - q.x, p.y - q.y) < gap) continue;
      kept.push(p);
    }
    while (kept.length > 4) {
      const p = kept[kept.length - 1];
      if (Math.hypot(p.x - kept[0].x, p.y - kept[0].y) >= gap) break;
      kept.pop();
    }
    this.pts = kept;
    this.smooth();

    const p = this.pts;
    const n = p.length;
    this.len = 0;
    for (let i = 0; i < n; ++i) {
      const a = p[i];
      const b = p[(i + 1) % n];
      const c = p[(i + n - 1) % n];
      a.at = this.len;
      a.seg = Math.hypot(b.x - a.x, b.y - a.y);
      this.len += a.seg;
      // Square to the chord either side, which for the opening ring's winding
      // points away from the middle.
      const fx = b.x - c.x;
      const fy = b.y - c.y;
      const d = Math.hypot(fx, fy) || 1;
      a.nx = fy / d;
      a.ny = -fx / d;
    }
  }

  // Laplacian, every cut. A node on a fifty-node circle moves three hundredths
  // of a unit, and a spike loses a real bite: an outward offset inside a dip
  // folds over itself, so a dip left alone digs itself in.
  smooth() {
    const p = this.pts;
    const n = p.length;
    const out = [];
    for (let i = 0; i < n; ++i) {
      const a = p[(i + n - 1) % n];
      const b = p[(i + 1) % n];
      out.push({
        x: p[i].x + SMOOTH * ((a.x + b.x) / 2 - p[i].x),
        y: p[i].y + SMOOTH * ((a.y + b.y) / 2 - p[i].y),
      });
    }
    this.pts = out;
  }

  measure() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const see = (p) => {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    };
    for (const p of this.pts) see(p);
    for (const p of this.arc ?? []) see(p);
    if (this.head !== null) see(this.head);
    this.box = [x0, y0, x1, y1];
  }

  // By halving: `at` climbs along the cycle, so the answer is the last node
  // that has not passed t.
  seg(t) {
    let lo = 0;
    let hi = this.pts.length - 1;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (this.pts[m].at <= t) lo = m;
      else hi = m - 1;
    }
    return lo;
  }

  at(t) {
    t = mod(t, this.len);
    const i = this.seg(t);
    const a = this.pts[i];
    const b = this.pts[(i + 1) % this.pts.length];
    const f = a.seg === 0 ? 0 : (t - a.at) / a.seg;
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  }

  normalAt(t) {
    t = mod(t, this.len);
    const i = this.seg(t);
    const a = this.pts[i];
    const b = this.pts[(i + 1) % this.pts.length];
    const f = a.seg === 0 ? 0 : (t - a.at) / a.seg;
    const x = a.nx + (b.nx - a.nx) * f;
    const y = a.ny + (b.ny - a.ny) * f;
    const d = Math.hypot(x, y) || 1;
    return { x: x / d, y: y / d };
  }

  project(x, y) {
    const p = this.pts;
    let best = Infinity;
    let t = 0;
    for (let i = 0; i < p.length; ++i) {
      const a = p[i];
      const b = p[(i + 1) % p.length];
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const l = ex * ex + ey * ey;
      const f = l === 0
        ? 0
        : Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / l));
      const dx = x - (a.x + ex * f);
      const dy = y - (a.y + ey * f);
      const d = dx * dx + dy * dy;
      if (d >= best) continue;
      best = d;
      t = a.at + a.seg * f;
    }
    return { t, h: Math.sqrt(best) };
  }

  // A ray to the right cuts the loop an odd number of times.
  inside(x, y) {
    const p = this.pts;
    let odd = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      if ((p[i].y > y) === (p[j].y > y)) continue;
      if (x < p[i].x + (p[j].x - p[i].x) * (y - p[i].y) / (p[j].y - p[i].y)) {
        odd = !odd;
      }
    }
    return odd;
  }

  open(t) {
    this.arc = [];
    this.arcAt = mod(t, this.len);
    this.head = null;
  }

  span(t) {
    return mod(t - this.arcAt, this.len);
  }

  add(x, y) {
    if (this.arc === null) return;
    this.head = { x, y };
    const last = this.arc[this.arc.length - 1];
    if (last !== undefined) {
      if (Math.hypot(x - last.x, y - last.y) < MINGAP * scale / 2) return;
    }
    this.arc.push({ x, y });
  }

  // The stretch from takeoff to landing is thrown away and the arc drawn
  // stands in for it. The loop re-cuts to start under the bead, so this returns
  // zero.
  close(t) {
    const arc = this.arc;
    this.arc = null;
    this.head = null;
    t = mod(t, this.len);
    if (arc === null || arc.length < 2) return t;

    const p = this.pts;
    const n = p.length;
    const i0 = this.seg(this.arcAt);
    const i1 = this.seg(t);
    const a = this.at(this.arcAt);
    const b = this.at(t);

    // Everything the pull did not cover, forward from the landing to takeoff.
    const kept = [];
    for (let i = (i1 + 1) % n;; i = (i + 1) % n) {
      kept.push(p[i]);
      if (i === i0) break;
    }

    this.pts = [b, ...kept, a, ...arc];
    this.rebuild();
    return 0;
  }

  update() {
    this.measure();
  }

  render(ctx) {
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    if (this.arc !== null && this.arc.length > 0) {
      const a = this.at(this.arcAt);
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = css(WHITE);
      ctx.lineWidth = 2 * scale;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      for (const p of this.arc) ctx.lineTo(p.x, p.y);
      if (this.head !== null) ctx.lineTo(this.head.x, this.head.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    const p = this.pts;
    ctx.strokeStyle = css(WHITE);
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    ctx.moveTo(p[0].x, p[0].y);
    for (let i = 1; i < p.length; ++i) ctx.lineTo(p[i].x, p[i].y);
    ctx.closePath();
    ctx.stroke();

    ctx.fillStyle = css(WHITE);
    for (const q of p) {
      ctx.beginPath();
      ctx.arc(q.x, q.y, 2 * scale, 0, TAU);
      ctx.fill();
    }
  }
}

/*
 * The bead. It rides the loop at a fixed speed whatever else it is doing:
 * `h` is how far it has climbed off the surface, and the button is the only
 * thing that pushes it up there.
 */
class Cursor extends ent.Entity {
  constructor() {
    super();
    this.t = 0;
    this.h = 0;
    this.hv = 0;
    this.up = false;
    this.pushing = false;
    this.n = { x: 1, y: 0 };
    const p = path.at(0);
    this.pos.x = p.x;
    this.pos.y = p.y;
  }

  update() {
    const dt = ent.game.time;
    const hold = ent.game.key.b1;
    const push = hold && (!this.up || path.span(this.t) < SPAN * path.len);

    this.pushing = push;

    if (push && !this.up) {
      this.up = true;
      path.open(this.t);
    }

    let ha = push ? THRUST * scale : 0;
    // DRAG carries a length, so the scale divides it rather than multiplies.
    ha -= Math.sign(this.hv) * this.hv * this.hv * DRAG / scale;
    ha -= this.h * SPRING;
    ha *= dt;
    this.h += dt * (this.hv + ha / 2);
    this.hv += ha;
    if (this.h <= 0) {
      this.h = 0;
      this.hv = 0;
    }

    const step = dt * SPEED * scale;
    const was = this.t;
    this.t += step;
    const foot = path.at(this.t);
    this.n = path.normalAt(this.t);
    this.pos.x = foot.x + this.n.x * this.h;
    this.pos.y = foot.y + this.n.y * this.h;

    // Before the cut below: a cut re-parameterises the loop, and both ends of
    // this test are in the parameters the frame started with.
    const r = (BEAD + GOLDR) * scale;
    for (const g of [...golds]) {
      if (mod(g.t - was, path.len) > step) continue;
      if (Math.abs(this.h - g.h) <= r) take(g);
      else if (this.h > g.h) lose(g);
    }

    if (this.up) {
      if (this.h > 0) path.add(this.pos.x, this.pos.y);
      else {
        this.t = path.close(this.t);
        this.up = false;
      }
    }
  }

  render(ctx) {
    const r = BEAD * scale;

    if (this.h > 0) {
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = css(WHITE);
      ctx.lineWidth = 2 * scale;
      ctx.beginPath();
      ctx.moveTo(-this.n.x * this.h, -this.n.y * this.h);
      ctx.lineTo(0, 0);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = css(WHITE);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = css(DARK);
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(this.n.x * r, this.n.y * r);
    ctx.stroke();
  }
}

class Gold extends ent.Entity {
  constructor(x, y) {
    super();
    this.pos.x = x;
    this.pos.y = y;
    this.measure();
  }

  // Both move under it every time the loop is cut.
  measure() {
    const q = path.project(this.pos.x, this.pos.y);
    this.t = q.t;
    this.h = q.h;
  }

  render(ctx) {
    const r = GOLDR * scale * (1 + 0.1 * Math.sin(this.age * 6));
    ctx.fillStyle = css(GOLD);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
  }
}

function drop(g) {
  golds = golds.filter((o) => o !== g);
  g.remove();
  place();
}

function take(g) {
  drop(g);
  score.value += 1;
  clock = Math.min(START, clock + BONUS);
  new ent.Particle({
    x: g.pos.x,
    y: g.pos.y,
    color: GOLD,
    count: 12,
    size: 3 * scale,
    speed: [70 * scale, 40 * scale],
    spread: GOLDR * scale,
    duration: [0.4, 0.2],
    circle: true,
  });
}

// Closed over by the loop. Nothing can reach it in there.
function lose(g) {
  drop(g);
  new ent.Particle({
    x: g.pos.x,
    y: g.pos.y,
    color: DARK,
    count: 8,
    size: 2.5 * scale,
    speed: [26 * scale, 20 * scale],
    spread: GOLDR * scale,
    duration: [0.5, 0.2],
    circle: true,
  });
}

// Beyond the loop and ahead of the bead, further out the more has been taken.
// Not somewhere the loop already covers, and not on top of other gold.
function place() {
  const far = NEAR + Math.min(1, score.value / RAMP) * (FAR - NEAR);
  let last = null;
  for (let i = 0; i < 12; ++i) {
    const t = cursor.t + (0.15 + 0.75 * Math.random()) * path.len;
    const p = path.at(t);
    const n = path.normalAt(t);
    const d = far * scale * (0.85 + 0.3 * Math.random());
    last = { x: p.x + n.x * d, y: p.y + n.y * d };
    if (path.inside(last.x, last.y)) continue;
    const near = golds.some((g) =>
      Math.hypot(g.pos.x - last.x, g.pos.y - last.y) < 5 * GOLDR * scale
    );
    if (!near) break;
  }
  golds.push(new Gold(last.x, last.y));
}

// A camera framing that holds the loop, the gold, and PAD of air round the
// lot. The box is square, so the diameter is one number and the scale one
// division.
function frame() {
  let [x0, y0, x1, y1] = path.box;
  for (const g of golds) {
    const r = 2 * GOLDR * scale;
    x0 = Math.min(x0, g.pos.x - r);
    y0 = Math.min(y0, g.pos.y - r);
    x1 = Math.max(x1, g.pos.x + r);
    y1 = Math.max(y1, g.pos.y + r);
  }
  const d = Math.max(x1 - x0, y1 - y0) + 2 * PAD * scale;
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, scale: SIZE / d };
}

export function init() {
  ent.reset([Path, Gold, Cursor]);

  scale = 1;
  clock = START;
  version = -1;
  golds = [];
  path = new Path();
  cursor = new Cursor();
  for (let i = 0; i < GOLDS; ++i) place();
  camera.moveTo(frame());
}

export function update(dt) {
  ent.update(dt);

  const [x0, y0, x1, y1] = path.box;
  const size = Math.max(x1 - x0, y1 - y0) / 2;
  scale += (Math.max(1, size / R0) - scale) * 0.05;

  if (path.version !== version) {
    version = path.version;
    for (const g of golds) g.measure();
    // A cut can close the loop round gold sideways on, with no crossing.
    for (const g of [...golds]) {
      if (path.inside(g.pos.x, g.pos.y)) lose(g);
    }
  }

  // A 6%-a-frame lerp, 4% for the zoom, is a different chase at 120Hz.
  // approach() is the same closing speed written as a rate: 0.06 a frame at
  // 60Hz is -60 * ln(0.94) a second.
  camera.approach(frame(), dt, { x: 3.71, y: 3.71, scale: 2.45 });

  clock -= dt * (1 + (cursor.pushing ? HOLDCOST : 0));
  if (clock <= 0) {
    clock = 0;
    gameOver({ score: true });
  }
}

export function render(ctx) {
  ent.render(ctx);

  ctx.save();
  ctx.scale(K, K);
  drawClock(ctx);
  ctx.restore();
}

function drawClock(ctx) {
  const w = 320;
  const x = (W - w) / 2;
  const y = W - 20;
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = css(DARK);
  ctx.fillRect(x, y, w, 8);
  ctx.globalAlpha = 1;
  ctx.fillStyle = css(clock < 3 ? WHITE : GOLD);
  ctx.fillRect(x, y, w * Math.min(1, clock / START), 8);
}
