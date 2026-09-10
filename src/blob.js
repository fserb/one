/*
 * blob - a merge game in a pool, ported from Sobosuba's bar mode.
 *
 * A blob is a pressurised ring of circles solved by alma's SoftBodies. Two
 * touching blobs of a tier become one of the next tier up, and the run ends
 * when the pile seals the pool. The rail across the mouth deals what there is
 * to throw and the drag aims it.
 *
 * The world is a W x H box and not the 1024 board, so every number here is
 * still the one it was tuned at; VIEW maps the one into the other.
 */

import * as alma from "./alma/src/index.js";
import { fixed, gameOver, hint, key, mouse, op, score, SIZE } from "./lib/one.js";

export const meta = {
  title: "blob",
  desc: `
drag a blob off the rail to throw it
two of a kind make the next one up
`,
  bg: "#14171c",
  fg: "#8a9ab4",
  scoreMax: true,
  date: "2026-09-10",
  draft: true,
};

const W = 760;
const H = 860;
const R = 6;

// The world box scaled to fit the board and centred across it.
const VIEW = Math.min(SIZE / W, SIZE / H);
const VIEW_X = (SIZE - W * VIEW) / 2;

// ---- Tiers ----------------------------------------------------------------

const TIER_COUNT = 16;
const TIER_RADIUS = 35;
const TIER_GROWTH = Math.sqrt(1.26);

const shift = (c, dl) => c.withOKLCH(([l, ch, h]) => [l + dl, ch, h]).css;

function buildTiers() {
  const tiers = [];
  for (let i = 0; i < TIER_COUNT; i++) {
    const outer = TIER_RADIUS * TIER_GROWTH ** i;
    const radius = outer - R;
    const n = Math.max(
      12,
      Math.round(Math.TAU * radius / (2 * R * (1 - 1 / 3))),
    );
    const color = alma.color.oklch(
      0.80 - 0.17 * i / (TIER_COUNT - 1),
      0.16,
      25 + 33 * i,
    );
    const cool = (m, dl) => shift(color.mix(alma.color("#3f63a8"), m, "oklab"), dl);
    const warm = (m, dl) => shift(color.mix(alma.color("#fff2cc"), m, "oklab"), dl);
    tiers.push({
      index: i,
      outer,
      radius,
      count: n,
      base: alma.SoftBodies.ring(n),
      mass: Math.PI * outer * outer / 350,
      cool: Math.log(100) * Math.PI * outer * outer / 60000,
      value: 2 ** i,
      font: radius * Math.min(0.62, 2.1 / `${2 ** i}`.length),
      edge: Math.clamp(outer * 0.055, 4.5, 9),
      drop: Math.min(24, outer * 0.22),
      blur: Math.min(30, outer * 0.34),
      ramp: [cool(0.44, 0.05), cool(0.34, -0.19), color.css],
      line: cool(0.30, -0.45),
      label: cool(0.25, -0.40),
      emboss: warm(0.35, 0.12),
    });
  }
  return tiers;
}

const TIERS = buildTiers();

// ---- Container ------------------------------------------------------------

function flatten(pts, stepPx = 6) {
  const curve = alma.spline.catmullRom(pts.map(([x, y]) => ({ x, y })), {
    alpha: 0,
    tension: 0,
  });
  const arc = alma.spline.arcLength(curve);
  return [...alma.spline.pointsByDistance(arc, stepPx)].map((p) => [p.x, p.y]);
}

function chainPath(pts, close) {
  const path = new Path2D();
  path.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) path.lineTo(pts[i][0], pts[i][1]);
  if (close) path.closePath();
  return path;
}

function buildPool(shape) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const [x, y] of shape.chain) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  const ox = (W - (x1 - x0)) / 2 - x0;
  const oy = (H - (y1 - y0)) / 2 - y0;
  const chain = shape.chain.map(([x, y]) => [x + ox, y + oy]);
  const bounds = { x0: x0 + ox, x1: x1 + ox, y1: y1 + oy };

  // Collision closes the chain with a lid above everything.
  const head = chain[0];
  const tail = chain[chain.length - 1];
  const poly = [[head[0], -400], ...chain, [tail[0], -400]];

  let twice = 0;
  for (let i = 0; i < poly.length; i++) {
    const q = poly[(i + 1) % poly.length];
    twice += poly[i][0] * q[1] - q[0] * poly[i][1];
  }

  const field = alma.sdf.bake(
    alma.sdf.polygon(poly.map(([x, y]) => ({ x, y }))),
    {
      bounds: { x0: -60, y0: -260, x1: W + 60, y1: H + 60 },
      cell: 3,
      band: TIER_RADIUS * TIER_GROWTH ** (TIER_COUNT - 1) + 2 * R,
    },
  );

  // The width the pile must cover to seal: the chain crossings at that height.
  const dline = shape.danger + oy;
  let dl = Infinity;
  let dr = -Infinity;
  for (let i = 1; i < chain.length; i++) {
    const [ax, ay] = chain[i - 1];
    const [bx, by] = chain[i];
    if ((ay > dline) === (by > dline)) continue;
    const x = ax + (dline - ay) * (bx - ax) / (by - ay);
    dl = Math.min(dl, x);
    dr = Math.max(dr, x);
  }

  const mouth = {
    l: Math.min(head[0], tail[0]),
    r: Math.max(head[0], tail[0]),
  };

  // Path2D is the browser's and tools/build.js imports this module under Deno
  // to read `meta`, so the two paths are built the first time one is drawn.
  let fill = null;
  let line = null;

  return {
    field,
    get fill() {
      return fill ??= chainPath(chain, true);
    },
    get line() {
      return line ??= chainPath(chain, false);
    },
    chain,
    side: twice < 0 ? -1 : 1,
    mouth,
    mid: (mouth.l + mouth.r) / 2,
    bounds,
    bar: Math.min(head[1], tail[1]),
    danger: dline,
    dangerSpan: { l: dl, r: dr },
  };
}

const pool = buildPool({
  danger: 244,
  chain: flatten([
    [136, 88],
    [94, 244],
    [60, 419],
    [70, 594],
    [175, 742],
    [370, 764],
    [565, 742],
    [670, 594],
    [680, 419],
    [646, 244],
    [604, 88],
  ]),
});

// ---- World ----------------------------------------------------------------

let ctx;

// Device pixels a world unit, which is what a blur and an offset are in.
function devScale() {
  return op.screen.scale * VIEW;
}

const GRAVITY = 1500;
const MAX_SPEED = 4000;

const sim = new alma.SoftBodies({
  width: W,
  height: H,
  radius: R,
  field: pool.field,
  gravity: { x: 0, y: GRAVITY },
  maxSpeed: MAX_SPEED,
  drag: 0.15,
  rigidDamp: 25,
});

const cam = new alma.Camera2D({
  width: W,
  height: H,
  x: W / 2,
  y: H / 2,
});

cam.shakeBase = 2.5;
cam.shakeRate = 13;

// The sim mutates this array in place, so the alias cannot go stale.
const blobs = sim.bodies;

function spawn(tier, cx, cy) {
  const t = TIERS[Math.min(tier, TIER_COUNT - 1)];
  const b = sim.add({
    base: t.base,
    radius: t.radius,
    mass: t.mass,
    x: cx,
    y: cy,
  });
  b.t = t;
  b.bar = false;
  b.cool = 0;
  b.flash = 0;
  b.flashed = 0;
  return b;
}

// ---- Merge ----------------------------------------------------------------

function updateMerges(dt) {
  for (const b of blobs) {
    if (b.cool > 0) b.cool = Math.max(0, b.cool - dt);
    if (b.flash <= 0) continue;
    b.flashed += dt;
    const u = b.flashed / 0.3;
    b.flash = u >= 1 ? 0 : 1 - u * u;
  }
  detectMerges();
}

const ready = new Uint8Array(TIER_COUNT);

// The lowest same-tier contact in the world, one a frame: piles go bottom up.
function detectMerges() {
  ready.fill(0);
  let pairs = false;
  for (const b of blobs) {
    if (b.cool > 0 || b.t.index === TIER_COUNT - 1) continue;
    if (ready[b.t.index]) pairs = true;
    ready[b.t.index] = 1;
  }
  if (!pairs) return;

  sim.buildGrid();
  for (let i = 0; i < sim.count; i++) {
    const a = blobs[sim.pbody[i]];
    if (a.cool > 0 || a.t.index === TIER_COUNT - 1) continue;
    self = i;
    wantTier = a.t;
    sim.eachNeighbor(i, consider);
  }
  if (ka >= 0) {
    merge(
      blobs[sim.pbody[ka]],
      blobs[sim.pbody[kb]],
      sim.pidx[ka],
      sim.pidx[kb],
    );
  }
  ka = -1;
  kb = -1;
  lowest = -Infinity;
}

// One closure, hoisted, rather than one a particle a frame.
const D2 = (2 * R + 1) ** 2;
let self = -1;
let wantTier = null;
let lowest = -Infinity;
let ka = -1;
let kb = -1;

function consider(j) {
  const { px, py, pbody } = sim;
  if (j <= self || pbody[j] === pbody[self]) return;
  const b = blobs[pbody[j]];
  if (b.t !== wantTier || b.cool > 0) return;
  if ((px[j] - px[self]) ** 2 + (py[j] - py[self]) ** 2 > D2) return;
  const my = (py[self] + py[j]) / 2;
  if (my <= lowest) return;
  lowest = my;
  ka = self;
  kb = j;
}

// Everything but the touching point and the one before it, in ring order.
function arcFrom(path, b, hit) {
  const n = b.count;
  for (let k = 1; k <= n - 2; k++) {
    const i = b.start + (hit + k) % n;
    const { px, py, vx, vy } = sim;
    path.push({ x: px[i], y: py[i], vx: vx[i], vy: vy[i] });
  }
}

// The bigger ring spread along the two arcs: it starts as the pair's outline.
function resample(b, path) {
  const p = path.length;
  const seg = new Float64Array(p);
  let total = 0;
  for (let i = 0; i < p; i++) {
    const q = path[(i + 1) % p];
    total += seg[i] = Math.hypot(q.x - path[i].x, q.y - path[i].y);
  }
  if (total < 1e-6) return;

  const { px, py, ox, oy, vx, vy } = sim;
  const s = b.start;
  const stride = total / b.count;
  let j = 0;
  let walked = 0;
  for (let k = 0; k < b.count; k++) {
    const target = k * stride;
    while (j < p - 1 && walked + seg[j] <= target) walked += seg[j++];
    const t = seg[j] > 1e-9 ? (target - walked) / seg[j] : 0;
    const q0 = path[j];
    const q1 = path[(j + 1) % p];
    const i = s + k;
    px[i] = ox[i] = q0.x + (q1.x - q0.x) * t;
    py[i] = oy[i] = q0.y + (q1.y - q0.y) * t;
    vx[i] = q0.vx + (q1.vx - q0.vx) * t;
    vy[i] = q0.vy + (q1.vy - q0.vy) * t;
  }
}

// Take some of the peanut out. Positions only, with `ox` carried along, so
// this makes no velocity.
function round(b) {
  const { px, py, ox, oy } = sim;
  const s = b.start;
  const n = b.count;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    cx += px[s + i];
    cy += py[s + i];
  }
  cx /= n;
  cy /= n;
  const rest = b.restRadius * b.scale;
  for (let i = 0; i < n; i++) {
    const j = s + i;
    const dx = px[j] - cx;
    const dy = py[j] - cy;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) continue;
    const k = 1 + 0.4 * (rest / d - 1);
    px[j] = ox[j] = cx + dx * k;
    py[j] = oy[j] = cy + dy * k;
  }
}

function merge(a, b, hitA, hitB) {
  // Taken now because `compact()` moves every index.
  const hx = (sim.px[a.start + hitA] + sim.px[b.start + hitB]) / 2;
  const hy = (sim.py[a.start + hitA] + sim.py[b.start + hitB]) / 2;

  const path = [];
  arcFrom(path, a, hitA);
  arcFrom(path, b, hitB);

  sim.remove(a);
  sim.remove(b);

  const n = spawn(a.t.index + 1, (a.cx + b.cx) / 2, (a.cy + b.cy) / 2);
  resample(n, path);
  noteMerge(a, b, n);
  // Paid by what came out, so a rung up the ladder is worth all the work under
  // it and a cascade is worth more than the same merges spread over a minute.
  score.value += n.t.value;
  // After noteMerge, whose squeeze sets the rest radius this rounds toward.
  round(n);
  // Sized by the tier that merged, not the one that came out.
  fireShock(hx, hy, shockLife(a.t));
  const rung = n.t.index / (TIER_COUNT - 1);
  cam.shake(0.08 + (0.55 - 0.08) * rung);
  playMerge(n.t.index, hx);
  n.cool = n.t.cool;
  n.flash = 1;
  n.flashed = 0;
  n.grace = sim.refitCooldown;
  sim.compact();
  sim.measure();
}

// ---- Launcher -------------------------------------------------------------

const AIM_MAX = 220;
const BAR_SHRINK = 0.65;
const GROW_RATE = (1 - BAR_SHRINK) / 0.22;
const FEED_PERIOD = 0.5;
const FEED_COOL = 0.7;
// `spawn_pool.gd`: merges needed before a tier joins the deal, permanently.
const DEAL_UNLOCK = [0, 1, 3, 6, 10, 15, 21];

function half(o) {
  return o.t.outer * o.scale;
}

// Every point at this speed, so it leaves without spin.
function shove(o, vX, vY) {
  const { vx, vy } = sim;
  for (let i = o.start; i < o.start + o.count; i++) {
    vx[i] = vX;
    vy[i] = vY;
  }
}

// The rail's own gravity: the aim's lean is the free pool's alone.
const RAIL_GRAVITY = { x: 0, y: GRAVITY };

// The wall is off for a bar blob or the mouth shoves the queue out. Off, not
// gone: nothing else bounds a bar blob's x.
function clampMouth(b, s) {
  const { l, r } = pool.mouth;
  for (let i = b.start; i < b.start + b.count; i++) {
    s.px[i] = Math.clamp(s.px[i], l + s.pr[i], r - s.pr[i]);
  }
}

const rail = [];

// `sim.preSolve`, before the integrate, so `b.cx` and `b.mvx` are what the
// last substep left. The pull is per blob and the damping per point.
function solveRail(h) {
  rail.length = 0;
  for (const b of blobs) if (b.bar) rail.push(b);
  if (rail.length === 0) return;

  const { vx, vy } = sim;
  for (const b of rail) {
    const dv = 140 * (pool.bar - b.cy) * h;
    // Off a ramp a blob wide, which is what the per-point version averaged to.
    const off = (b.cx - pool.mid) / (b.t.outer * b.scale);
    const inward = -300 * Math.clamp(off, -1, 1) * h;
    for (let i = b.start; i < b.start + b.count; i++) {
      vy[i] += dv - 12.0 * vy[i] * h;
      vx[i] += inward - 1.2 * vx[i] * h;
    }
  }

  // Daylight between neighbours, ours and not the original's.
  for (let a = 0; a < rail.length; a++) {
    const ba = rail[a];
    for (let c = a + 1; c < rail.length; c++) {
      const bc = rail[c];
      // Two of a tier merge where they sit, and this gap would hold them apart.
      if (ba.t === bc.t) continue;
      const dx = bc.cx - ba.cx;
      const d = Math.abs(dx);
      const want = ba.t.outer * ba.scale + bc.t.outer * bc.scale + 10;
      if (d >= want) continue;
      // On the pair's approach, so a queue sliding inward as one is not fought.
      const s = dx < 0 ? -1 : 1;
      const rate = (bc.mvx - ba.mvx) * s;
      const push = (600 * (want - d) - 18 * rate) * h * s;
      sim.pushBody(ba, -push, 0);
      sim.pushBody(bc, push, 0);
    }
  }
}

// The ends of the rail, above it. A narrower pool keeps them off its walls.
function buildFeeds() {
  const { l, r } = pool.mouth;
  const edge = TIER_RADIUS * TIER_GROWTH ** (DEAL_UNLOCK.length - 1) *
      BAR_SHRINK + 10;
  const span = Math.min(380, r - l - 2 * edge) / 2;
  return [
    { x: pool.mid - span, y: pool.bar - 30 },
    { x: pool.mid + span, y: pool.bar - 30 },
  ];
}

const feeds = buildFeeds();

let hover = null; // the bar blob under the cursor
let aim = null; // the bar blob being drawn back
let aimX = 0; // the draw, in world units
let aimY = 0;
let aimMax = AIM_MAX; // how far the draw may run in the direction it goes
let pressX = 0; // where the press landed, on screen
let pressY = 0;
let side = 0; // which feed point goes next
let feedWait = 0;
let gapWait = 0; // how long since the rail last lost a blob
let starve = 0; // how far the room test has relaxed while the bar is empty

function resetLauncher() {
  made.fill(0);
  for (let t = 0; t < open.length; t++) open[t] = DEAL_UNLOCK[t] === 0;
  cancelAim();
  side = 0;
  feedWait = 0;
  gapWait = FEED_COOL;
  starve = 0;
}

// A tier unlocks once DEAL_UNLOCK[t] merges have produced one.
const made = new Int32Array(DEAL_UNLOCK.length);
const open = DEAL_UNLOCK.map((n) => n === 0);

// The rail carries a queued blob, so it takes over the wall and keeps plain
// gravity. `setScale` takes the point radius with it, or the skin bunches up.
function setBar(b, on) {
  b.bar = on;
  b.wall = on ? clampMouth : null;
  b.gravity = on ? RAIL_GRAVITY : null;
  sim.setScale(b, on ? BAR_SHRINK : b.scale);
}

// A blob left: the gap stands for FEED_COOL, the next comes from the far end.
function noteLeft(b) {
  gapWait = 0;
  feedWait = FEED_PERIOD;
  side = (b.cx < pool.mid ? 1 : 0) ^ 1; // updateLauncher flips before it feeds
}

function pickTier(f, room) {
  let pile = -1;
  let near = -1; // the tier at this end of the queue
  let queue = 0; // how many blobs are on the rail at all
  let pileY = Infinity;
  let nearD = Infinity;
  for (const b of blobs) {
    // Along the rail, not straight down: a new blob is thrown at the middle.
    if (b.bar) {
      queue++;
      const d = Math.abs(b.cx - f.x);
      if (d < nearD) {
        nearD = d;
        near = b.t.index;
      }
      continue;
    }
    // The original's ray down from the feed point, crossing a ring.
    if (b.cy <= f.y || b.cy - f.y >= 160) continue;
    if (Math.abs(b.cx - f.x) > b.t.outer) continue;
    if (b.cy < pileY) {
      pileY = b.cy;
      pile = b.t.index;
    }
  }

  const deal = [];
  const same = []; // what only the neighbour rule refuses
  for (let t = 0; t < DEAL_UNLOCK.length; t++) {
    if (!open[t] || t === pile || TIERS[t].outer > room) continue;
    if (t === near) same.push(t);
    else deal.push(t);
  }
  if (deal.length > 0) return alma.random.choice(deal);
  // Only the neighbour's tier fits: refuse, unless the rail is down to one.
  if (queue <= 1 && same.length > 0) return alma.random.choice(same);
  return -1;
}

function feed(f) {
  // At both ends of the drop; `starve` relaxes it while the rail is empty.
  const room = Math.min(sim.clearance(f.x, f.y), sim.clearance(f.x, pool.bar)) +
    starve;
  const tier = pickTier(f, room);
  if (tier < 0) return;
  const o = spawn(tier, f.x, f.y);
  setBar(o, true);
  starve = 0;
  playFeed(f.x);

  const dx = pool.mid - f.x;
  const dy = pool.bar - f.y;
  const l = Math.hypot(dx, dy) || 1;
  shove(o, dx / l * 160, dy / l * 160);
}

function updateLauncher(dt) {
  // Anything off the rail and still squeezed grows back.
  for (const b of blobs) {
    if (b.bar || b.scale >= 1) continue;
    sim.setScale(b, Math.min(1, b.scale + GROW_RATE * dt));
  }

  let queued = 0;
  for (const b of blobs) if (b.bar) queued++;
  starve = queued === 0 ? starve + 32 * dt : 0;
  if (queued >= 4) return;

  // No gap to read while the rail is empty.
  gapWait += dt;
  if (queued > 0 && gapWait < FEED_COOL) return;

  feedWait += dt;
  if (feedWait < FEED_PERIOD) return;
  feedWait = 0;
  side ^= 1;
  feed(feeds[side]);
}

// Nearest bar blob centre within 128px.
function hoverBar(wx, wy) {
  if (aim) return;
  hover = null;
  // The hand owns the pointer while dragging.
  if (sim.grabbed) return;
  let best = 128 * 128;
  for (const b of blobs) {
    if (!b.bar) continue;
    const d = (b.cx - wx) ** 2 + (b.cy - wy) ** 2;
    if (d < best) {
      best = d;
      hover = b;
    }
  }
}

// False means the press was not the launcher's, and the hand drags the pile.
function startAim(sx, sy) {
  if (!hover) return false;
  aim = hover;
  pressX = sx;
  pressY = sy;
  aimX = 0;
  aimY = 0;
  aimMax = AIM_MAX;
  return true;
}

// AIM_MAX, or the canvas edge if that comes first, never under twice the width.
function aimReach(b, dx, dy) {
  const l = Math.hypot(dx, dy);
  if (l < 1e-6) return AIM_MAX;
  // A queued blob's centroid is inside the box, so the ray always leaves it.
  const [, out] = alma.line.rayBox(b.cx, b.cy, dx / l, dy / l, 0, 0, W, H);
  return Math.max(Math.min(AIM_MAX, out), 2 * half(b));
}

// The draw normalised by the room it had, then by the angle above horizontal.
function shot() {
  const l = Math.hypot(aimX, aimY);
  if (l < 1e-6) return [0, 0];
  const g = (AIM_MAX / aimMax) * (1 - (1 - 0.8) * Math.max(0, -aimY) / l);
  return [aimX * g, aimY * g];
}

// A live read, so letting go reads 0 on the next physics frame.
function aimTilt() {
  if (!aim) return 0;
  const [sx] = shot();
  return -sx * 150 / AIM_MAX;
}

// Both ends through toWorld in one frame. The vector is where the blob goes.
function aimAt(sx, sy, dt) {
  if (!aim) return;
  const a = cam.toWorld(pressX, pressY);
  const b = cam.toWorld(sx, sy);
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  const l = Math.hypot(dx, dy);
  aimMax = aimReach(aim, dx, dy);
  if (l > aimMax) {
    dx *= aimMax / l;
    dy *= aimMax / l;
  }
  aimX = dx;
  aimY = dy;

  // Leans back by mass and by the shot, about the blob's own position.
  const [fx, fy] = shot();
  const k = aim.mass * 180 * dt / AIM_MAX;
  cam.push(-fx * k, -fy * k, aim.cx, aim.cy);
}

function launch() {
  const b = aim;
  const drawn = Math.hypot(aimX, aimY);
  const [dx, dy] = shot();
  cancelAim();
  if (!b) return;

  // A draw still inside the silhouette is not a shot; right click gives up.
  if (drawn < half(b)) return;

  noteLeft(b);
  setBar(b, false);
  shove(b, dx * 850 / AIM_MAX, dy * 850 / AIM_MAX);

  const k = b.mass * 8 / AIM_MAX;
  cam.push(dx * k, dy * k, b.cx, b.cy);
}

function cancelAim() {
  aim = null;
  hover = null;
  aimX = 0;
  aimY = 0;
  aimMax = AIM_MAX;
}

// A merge involving the rail leaves its result on the rail.
function noteMerge(a, b, n) {
  const t = n.t.index;
  if (t < open.length && !open[t] && ++made[t] >= DEAL_UNLOCK[t]) {
    open[t] = true;
  }
  setBar(n, a.bar || b.bar);
  // Two becoming one shortens the queue, so it waits as a launch does.
  if (a.bar && b.bar) noteLeft(n);
  if (aim === a || aim === b) aim = n;
  if (hover === a || hover === b) hover = n;
}

// Between the feed points, the stretch the queue occupies.
function drawRail() {
  ctx.strokeStyle = "rgba(255, 255, 255, 0.10)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(feeds[0].x, pool.bar);
  ctx.lineTo(feeds[1].x, pool.bar);
  ctx.stroke();
}

// A line along the draw, a knob on the centre, a head at the far end.
function drawArrow(b) {
  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
  ctx.lineCap = "round";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(b.cx, b.cy, 6, 0, Math.TAU);
  ctx.fill();

  // Nothing until the draw clears the blob: until then letting go cancels.
  const len = Math.hypot(aimX, aimY);
  if (len < half(b)) return;
  const tx = b.cx + aimX;
  const ty = b.cy + aimY;
  ctx.beginPath();
  ctx.moveTo(b.cx, b.cy);
  ctx.lineTo(tx, ty);
  ctx.stroke();

  // Off the shot, not the draw: a full lob is a short arrow.
  const [sx, sy] = shot();
  const p = Math.min(1, Math.hypot(sx, sy) / AIM_MAX);
  const ang = (40 - (40 - 22) * p) * Math.PI / 180;
  // Fixed length back down the shaft, held to half of it so it cannot eat it.
  const h = -Math.min(26, len / 2) / len;
  const hx = aimX * h;
  const hy = aimY * h;
  ctx.beginPath();
  for (const s of [1, -1]) {
    const c = Math.cos(s * ang);
    const n = Math.sin(s * ang);
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx + hx * c - hy * n, ty + hx * n + hy * c);
  }
  ctx.stroke();
}

// ---- Shock ----------------------------------------------------------------

const waves = [];

// What a merge of this blob is worth, in seconds of wave.
function shockLife(tier) {
  return Math.PI * tier.outer * tier.outer / 20000;
}

// The camera takes its kick here and not over the wave's life.
function fireShock(x, y, life) {
  waves.push({ x, y, life, life0: life, r: 0 });
  // Away from the blast, so the frame recoils. No position, so no lever arm.
  const dx = W / 2 - x;
  const dy = H / 2 - y;
  const d = Math.hypot(dx, dy) || 1;
  cam.push(dx / d * life * 100, dy / d * life * 100);
  // 0.3 is the original's; the zoom spring is underdamped, so it rebounds past 1.
  cam.pushZoom(-life * 0);
}

// Advance the fronts and kick what each reached.
function updateShocks(dt) {
  const { px, py, vx, vy, count } = sim;
  for (let k = waves.length - 1; k >= 0; k--) {
    const w = waves[k];
    w.life -= dt;
    if (w.life <= 0) {
      waves.splice(k, 1);
      continue;
    }
    // A point between the two is one the front passed this frame.
    const r0 = w.r;
    w.r += 2000 * dt;
    // Decayed while the front travelled, so the kick falls off with distance.
    const dv = 100 * w.life;
    for (let i = 0; i < count; i++) {
      const dx = px[i] - w.x;
      const dy = py[i] - w.y;
      const d = Math.hypot(dx, dy);
      if (d < r0 || d >= w.r || d === 0) continue;
      vx[i] += dx / d * dv;
      vy[i] += dy / d * dv;
    }
  }
}

// One copy of the frame, so the bands read it and not the canvas they draw
// into: a blit that samples its own target breaks the render pass on a
// tile-based GPU, eight times a frame per wave.
const scratch = new alma.Layer({ attr: { alpha: false } });
const SHOCK_BANDS = 8;

// The wave draws nothing of its own. Displacing a thin ring outward by one
// amount is a uniform scale about the centre, so it is a blit clipped to the
// ring, the clip in world units and the blit in device ones.
function drawShocks() {
  if (waves.length === 0) return;
  const m = ctx.getTransform();
  const canvas = ctx.canvas;
  // Taken on the first band that draws: most of a big wave's life is culled.
  let src = null;
  for (const w of waves) {
    const p = m.transformPoint(new DOMPoint(w.x, w.y));
    const wide = w.r * 0.1;
    // Fades over the wave's life, so it thins away instead of stopping.
    const amp = 6 * (w.life / w.life0);
    if (amp < 0.2) continue;
    // A clipped blit costs its clip's bounding box, which for a ring is the
    // whole disc, so a wave past the furthest corner is a full copy for none.
    const far = 1.4 * Math.max(
      Math.hypot(w.x, w.y),
      Math.hypot(W - w.x, w.y),
      Math.hypot(w.x, H - w.y),
      Math.hypot(W - w.x, H - w.y),
    );
    if (w.r - wide > far) continue;
    for (let i = 0; i < SHOCK_BANDS; i++) {
      const r0 = w.r - wide + wide * i / SHOCK_BANDS;
      const r1 = r0 + wide / SHOCK_BANDS;
      if (r0 > far) break;
      // A hump across the ring, not a step, so the front has a shape.
      const off = amp * Math.sin(Math.PI * (i + 0.5) / SHOCK_BANDS);
      src ??= scratch.copy(canvas);
      ctx.save();
      ctx.beginPath();
      ctx.arc(w.x, w.y, r1, 0, Math.TAU);
      ctx.arc(w.x, w.y, Math.max(0, r0), 0, Math.TAU, true);
      ctx.clip();
      const k = r1 / (r1 + off);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.translate(p.x, p.y);
      ctx.scale(k, k);
      ctx.translate(-p.x, -p.y);
      ctx.drawImage(src, 0, 0);
      ctx.restore();
    }
  }
}

// ---- Danger ---------------------------------------------------------------

const DANGER_PITCH = 2;
const DANGER_HOLD = 1.0;

const cover = new Uint8Array(Math.ceil(W / DANGER_PITCH) + 2);

// What the frame and the drawing read, written here and nowhere else.
const danger = { spans: [], fill: 0, held: 0, over: false };

function updateDanger(dt) {
  if (danger.over) return;
  const { px, py } = sim;
  const y = pool.danger;
  const { l, r } = pool.dangerSpan;
  const n = Math.min(cover.length, Math.floor((r - l) / DANGER_PITCH) + 1);
  cover.fill(0, 0, n);

  for (const b of blobs) {
    // The queue is not the pile.
    if (b.bar) continue;
    if (b.y0 > y) continue;
    let x0 = Infinity;
    let x1 = -Infinity;
    for (let i = b.start; i < b.start + b.count; i++) {
      // How much of a point's circle is over the line.
      const d = py[i] - y;
      if (d >= R) continue;
      const w = d <= 0 ? R : Math.sqrt(R * R - d * d);
      if (px[i] - w < x0) x0 = px[i] - w;
      if (px[i] + w > x1) x1 = px[i] + w;
    }
    // One interval a blob: the part of a ring above a line is one piece.
    if (x0 >= x1) continue;
    const a = Math.max(0, Math.ceil((x0 - l) / DANGER_PITCH));
    const z = Math.min(n - 1, Math.floor((x1 - l) / DANGER_PITCH));
    for (let i = a; i <= z; i++) cover[i] = 1;
  }

  const spans = danger.spans;
  spans.length = 0;
  let covered = 0;
  let run = 0; // cells of open line since the last covered one
  let start = -1;
  let gap = 0; // the widest run still open
  for (let i = 0; i < n; i++) {
    if (cover[i]) {
      covered++;
      if (run > gap) gap = run;
      run = 0;
      if (start < 0) start = i;
    } else {
      run++;
      if (start >= 0) {
        spans.push(l + start * DANGER_PITCH, l + i * DANGER_PITCH);
        start = -1;
      }
    }
  }
  if (run > gap) gap = run;
  if (start >= 0) spans.push(l + start * DANGER_PITCH, r);
  danger.fill = covered / n;

  // Drains rather than resetting, or a jitter holds the loss off for ever.
  danger.held = gap * DANGER_PITCH < 2 * TIER_RADIUS
    ? Math.min(DANGER_HOLD, danger.held + dt)
    : Math.max(0, danger.held - dt * 2);
  if (danger.held < DANGER_HOLD) return;
  danger.over = true;
  cam.shake(0.7);
  // The board freezes where the pile died and one click starts the next run.
  gameOver({ score: true });
}

function resetDanger() {
  danger.spans.length = 0;
  danger.fill = 0;
  danger.held = 0;
  danger.over = false;
}

// ---- Sound ----------------------------------------------------------------

// 8-bit unsigned PCM at 8 kHz, base64: the game fetches no audio and
// decodes no codec.
const MERGE_PCM =
  "dHSCiaCnrq23ydLl6caPXjgkGwUCAgIEHUNmiavF2OLg1L+igV4+IQwCAgwhQGaQttz5/v7+//HTr4hmSDYpKjZKaImtzub4/fnozauFXzwgDgYMHjldgqjI4O/v5M2qg1s0GwsIEidGaI+00+r29OXGnnBCGAIDAQ0wW4asydre18SqiGQ8IgoCDiRQgK/X6u7cv5p0VDspHyEsRWmWxOX27s6jckgtJSs7T2iDo8bi8unKll4wGh41WX6Yqr3P19S9jE8bAwQhWIivxs7R0seqfkYTARI+frfW39fHtZ5+USYPGEWIx+vt1bCNcFI0HBUtZqzm/eu/jGRINiotRHW37v7tuX1POTI3Smyd0O/nunxGKSc6WYCu2e7erGkxFxw7ZJXB3+HBhkojIDxrnsrk48GFRRkSLmSez+nkv4FBGRg7da7X4s6ZViAMJFyd0+rfr20wEBxPldHx5rZxMBAdUp3f+uiuYiMJIWKx6vfSiz4MCz2M2P7ytmQhBiBjs+rxyIE8FyJYn9jozI5OJCJKh7/YyZhfNi9Og7TNw5plPjdUhLPLwJlnRD9aiLDCtY5hRkdjjK23poJgTFNvk62xnn5hVF55mKyqlXddVGB7l6ejj3RgXGqBlZ6VgmtdYXKJmZqNeWdibH+Tm5WEcWRkcoWUmI9+bmdtfY2Wk4Z3bW54hpGSi31zb3aBjJCKgHVwdH6Jj4yEeXN1fIWLioR8dnZ7g4iJhH14eX2FiomDfnp6foSHh4J9eXl+g4eHhH97e3+DhYSCf3t8f4OEhIJ+fX6BgoSDgX99fX+BgoKBfn5+gIKDgoB/fn+AgICAf39/f4CBgYGAgIB/gICAf35+fn9/gYGAf4B/f4CAgH9+fn5/gICBgH9/f3+AgIB/fn5+";
const FEED_PCM =
  "f3+AgICAgICAgICAgICAgIGBgYCAgYGBgYB/gICBgH9+fn+AgYCAf39/f39/f3+BgoKBgYCBgYKBf4CAgoKAfXx9f4GBf319f4KCgn57fH6CgYCBgoWGhoWAgoKCgoF/fX9/e3FqaG5/jZKWjIl/d25qbHWLpcDJ0L6helszGAEKGDZYgqrT7P/87NKtjmlPOSslLTlPYXiHmKSwtbe3sKqdkYFyZFlQSkhLUlxtfo+dq7O5t7KnmIh4aV1TT09SW2VzgpCep66xrqmflIZ4bGBYU1JUW2VxfouXoaeqqKOckoZ7cGdhXV1hZm52f4iQl5ydnpuXkYqCeXJsZ2VlZ2tweH+HjpSYm5qXkoqCeXFrZ2Vmam93foaMkZWWlpSQi4aBfHh2dHR0dXZ4eXt9gIOFh4iKioqJh4WBfnt4dnV1dXd5fYCDhomKioqJh4WCf316eHd2d3h5fH+ChYiJioqIhoSBfnt5d3d3eXt+gYOGh4iIiIaFg4KAf317enh3dnZ3enx/g4aJiouLioeEgX57eXd2dnd5fH+ChYeJi4uKiIaDf3x5d3Z2dnh6fYCChIaHiIeHhYSCgH58e3p5enp7fH1/goSGh4iJiYiGhIF+e3h2dXV2eHt+goWJi4yNi4mGgn15dnRzdHZ5fYGFiIqLiomGg398eXh3eHl7foCDhYaHh4aFg4F/fXt6eXl6e31/gYOFh4eIh4WDgX98enl4eHl7fYCDhYiJiomIhYJ+e3h2dXV3eX2AhIeKi4uKiIWBfnp4dnZ2eHt+goWHiYmJh4SBfnt5d3d4en2Ag4aHiIiGhIF/fHp5eXp7fX+ChIWGh4aFg4F/fXt6eXl6fH6Bg4aHiIeGhIF+e3l4eHl7foCDhYeIh4aDgH57eXl5enx+gYSGh4iHhYKAfXp5eHl6fYCDhYeIiIaEgX58enh4eXp9gIKFh4iIh4aDgH16eHd3eHp9gIOGiYqKiIaDgHx5d3d3eHt+gYSGh4iHhYOBf318e3t8fn+BgYKCgYB/f35+fn+AgoOEhISEg4F/fXt6eXp7fX+BhIaIiIeGg4B+e3l4eHl7foGEhoiIh4aDgX57eXh5enx/goWHiIeGhIF+e3h3eHl8f4OGiIqKiIWCfnp3dnZ3en6ChomKiomGgn56d3Z2eHt+goaIiomIhYF9end2dnh7foKGiYqLiYaCfnp3dXV2eX2BhYiLi4qIhYB8eHZ1dnh7gISHiouKh4R/e3h2dXd6foOHioyLiYWAe3d0dHV4fYKHi46OjIiDfXh0cXJ0eX6EiY2OjYuGgXt3dHN0d3yBhoqMjIqGgXx4dXR1eH2Ch4uNjIqFgHt2c3J0eH2DiY2PjouGgHp1cnFzeH2EiY2OjIiDfXh0c3R4fYOIjI6MiIN9d3NxcnZ8gomOkI+MhoB5dHFxdHh/hYqNjoyIgnx3dHN1eX6EiYyNi4eCfHdzcnR4foSJjY6MiIN9eHRzdXh9g4iLjIqGgXx3dXV3e4GGioyMiYR+eXV0dXh9goeKjIqHgn15dnZ4e4CFiIqJh4N+end2d3p/g4eJiYiFgXx5eHh6fYGEhoeGhIF9e3l6fH+ChYeHhYJ/e3l4eXt/g4aIiIaDf3t5eHp8gISGh4eEgX16eHl7foKFh4eGg4B9e3p7fYCChIWEg4B+fHt8fYCChIWEg4F/fXx8fn+BgoODgoB+fX1+f4GCg4SDgX99fHx9f4GChISDgX99fX1+gIKDhIOCgH58fHx+gIKEhIOCgH58fH1/gYOEhIOBf359fX5/gYKCgoGAf35+f4CBgoKCgH9+fX1+gIGCg4OCgH99fX5/gYKDg4KBf35+fn+AgYGCgYB/f39/gIGCgoKAf35+fn6AgYGCgYGAf39/gIGBgYGAf35+f3+AgYKCgYB/f35/gICBgoKBgIB/f39/gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYGBgYCAf39/f4CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBgYE=";

let audio = null; // null until initSound, silent until the first gesture

// The ladder read downward, so tier 0 is the top of it: a minor pentatonic
// degree a tier, tier 0 at A5 and tier 15 at A2.
function tone(tier) {
  const k = TIER_COUNT - 1 - Math.clamp(tier, 0, TIER_COUNT - 1);
  return 110 * 2 ** (Math.floor(k / 5) + [0, 3, 5, 7, 10][k % 5] / 12);
}

// Not the full width: a merge hard left is a merge in one ear.
function panAt(x) {
  return Math.clamp((2 * x / W - 1) * 0.7, -1, 1);
}

// Arms the gesture the autoplay policy wants; with the samples inline there is
// nothing to fetch. A context can be handed in, which is how levels were taken.
// `peak` is what the bake normalised by, so each comes back at the file's level.
function initSound(context) {
  audio = new alma.Audio(context);
  audio.volume = 0.72;
  audio.limit = 4;
  audio.putPCM8("merge", MERGE_PCM, { rate: 8000, peak: 0.4641 });
  audio.putPCM8("feed", FEED_PCM, { rate: 8000, peak: 0.9327 });
  audio.unlock();
}

// `ready` and not merely built: a suspended context has a stopped clock, and a
// frame of events scheduled into one all land together when it starts.
function audible() {
  return audio !== null && audio.ready;
}

// 840Hz is the band the knock reads at; volume rises 3 dB an octave downward.
function playMerge(tier, x) {
  if (!audible()) return;
  const f = tone(tier);
  audio.play("merge", {
    rate: f / 840,
    volume: 0.42 * Math.min(2, Math.sqrt(tone(0) / f)),
    pan: panAt(x),
  });
}

// The quietest thing here, because it happens on its own.
function playFeed(x) {
  if (!audible()) return;
  audio.play("feed", { rate: 0.6, volume: 0.22, pan: panAt(x) });
}

// ---- Lighting -------------------------------------------------------------

const LIGHT_X = -150;
const LIGHT_Y = -150;
const LIT_TONES = 33;
const ramp = (dark, lit) => alma.color(dark).steps(LIT_TONES, lit).map((c) => c.css);

// The wall chain pushed out by `d`, positive away from the pool, lit per piece.
function litChain(g, d, width, tones) {
  const pts = pool.chain;
  const s = pool.side * Math.sign(d);
  g.lineWidth = width;
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0];
    const dy = pts[i + 1][1] - pts[i][1];
    const len = Math.hypot(dx, dy) || 1;
    // Out of the pool is (dy, -dx) normalised, turned by which way `side` is.
    const ax = pts[i][0] + pool.side * dy / len * d;
    const ay = pts[i][1] - pool.side * dx / len * d;
    const bx = pts[i + 1][0] + pool.side * dy / len * d;
    const by = pts[i + 1][1] - pool.side * dx / len * d;
    const lx = LIGHT_X - (ax + bx) / 2;
    const ly = LIGHT_Y - (ay + by) / 2;
    const ll = Math.hypot(lx, ly) || 1;
    const k = Math.max(0, s * (dy * lx - dx * ly) / (len * ll));
    g.strokeStyle = tones[Math.round(k * (LIT_TONES - 1))];
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(bx, by);
    g.stroke();
  }
}

// `scale` is the bake's own: a blur and an offset are in device pixels.
function paintPool(g, scale) {
  // The lamp as a direction from the middle of the pool.
  const { x0, x1, y1 } = pool.bounds;
  const mx = (x0 + x1) / 2;
  const my = y1 / 2;
  const lx = LIGHT_X - mx;
  const ly = LIGHT_Y - my;
  const ll = Math.hypot(lx, ly);
  // Straight up if the lamp is on the middle, which has no direction.
  const L = ll > 0 ? { x: lx / ll, y: ly / ll } : { x: 0, y: -1 };

  // The interior, brightest where it faces the lamp.
  const reach = Math.hypot(x1 - x0, y1) / 2;
  const back = g.createLinearGradient(
    mx + L.x * reach,
    my + L.y * reach,
    mx - L.x * reach,
    my - L.y * reach,
  );
  back.addColorStop(0, "#1e2531");
  back.addColorStop(1, "#0f1218");
  g.fillStyle = back;
  g.fill(pool.fill);

  g.lineCap = "round";
  g.lineJoin = "round";

  // Laid on the background rather than cut out of it.
  g.save();
  const outside = new Path2D();
  outside.rect(0, 0, W, H);
  outside.addPath(pool.fill);
  g.clip(outside, "evenodd");
  g.strokeStyle = "#000";
  g.lineWidth = 10;
  g.shadowColor = "rgba(0, 0, 0, 0.55)";
  g.shadowBlur = 16 * scale;
  g.shadowOffsetX = -L.x * 9 * scale;
  g.shadowOffsetY = -L.y * 9 * scale;
  g.stroke(pool.line);
  g.restore();

  // Blurred inward and clipped inside, so the pool is a box the blobs are in.
  g.save();
  g.clip(pool.fill);
  g.strokeStyle = "rgba(0, 0, 0, 0.5)";
  g.shadowColor = "rgba(0, 0, 0, 0.5)";
  g.lineWidth = 8;
  for (const blur of [22, 8]) {
    g.shadowBlur = blur * scale;
    g.stroke(pool.line);
  }

  // The near wall's cast shadow; on the far side the clip takes it.
  g.shadowBlur = 30 * scale;
  g.shadowOffsetX = -L.x * 24 * scale;
  g.shadowOffsetY = -L.y * 24 * scale;
  g.stroke(pool.line);
  g.restore();

  // The flat face turns nowhere, so one tone; the light is in the two lips.
  g.strokeStyle = "#39414f";
  g.lineWidth = 10;
  g.stroke(pool.line);
  litChain(g, -10.5, 11, ramp("#1c222c", "#41506a"));
  litChain(g, 3.7, 2.5, ramp("#2a303b", "#8a9ab4"));
  litChain(g, -3.7, 3, ramp("#242a34", "#77869f"));

  // Baked dashes; what lights up on them is `drawDanger`, over the pile.
  g.save();
  g.clip(pool.fill);
  g.strokeStyle = "#2b323d";
  g.lineWidth = 2;
  g.setLineDash([10, 10]);
  g.beginPath();
  g.moveTo(pool.bounds.x0, pool.danger);
  g.lineTo(pool.bounds.x1, pool.danger);
  g.stroke();
  g.restore();
}

const DANGER_TONES = ramp("#46536a", "#e0472c");

// Over the pile, off the same coverage the loss is decided on.
function drawDanger(g) {
  const { fill, spans } = danger;
  const held = danger.held / DANGER_HOLD;
  if (fill <= 0) return;
  const y = pool.danger;
  g.save();
  g.clip(pool.fill);
  g.lineCap = "round";
  g.lineWidth = 3;
  g.globalAlpha = 0.45 + 0.55 * fill;
  g.strokeStyle = DANGER_TONES[Math.round(fill * (LIT_TONES - 1))];
  g.beginPath();
  for (let i = 0; i < spans.length; i += 2) {
    g.moveTo(spans[i], y);
    g.lineTo(spans[i + 1], y);
  }
  g.stroke();

  // Sealed: the whole line blinks faster the nearer the loss is.
  if (held > 0) {
    const hz = 2.5 + (10 - 2.5) * held;
    const t = performance.now() / 1000;
    g.globalAlpha = 0.3 + 0.7 * (0.5 + 0.5 * Math.cos(Math.TAU * hz * t));
    g.strokeStyle = DANGER_TONES[LIT_TONES - 1];
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(pool.dangerSpan.l, y);
    g.lineTo(pool.dangerSpan.r, y);
    g.stroke();
  }
  g.restore();
}

// A hole in the screen, over the canvas and not the box; baked at half res.
function paintVignette(g, w, h, s) {
  const cx = (w - W * s) / 2 + W / 2 * s;
  const cy = (h - H * s) / 2 + H * 0.52 * s;
  const v = g.createRadialGradient(cx, cy, H * 0.36 * s, cx, cy, H * 0.92 * s);
  v.addColorStop(0, "rgba(0, 0, 0, 0)");
  v.addColorStop(1, "rgba(0, 0, 0, 0.34)");
  g.fillStyle = v;
  g.fillRect(0, 0, w, h);
}

// Painted once and blitted after that: alma's `Layer` holds the pixels and the
// key they were painted from. The pool's is the screen scale, the shape and the
// lamp both being fixed; the vignette's is the canvas, being a hole in it.
const poolLayer = new alma.Layer();
const vigLayer = new alma.Layer();

// The silhouette grown, dropped away from the light, stepped and not blurred.
// Eight fills at 0.0724 compound to 1 - (1 - a)^8 = 0.45 at the core.
const SHADOW_STEPS = 8;

// The body path scaled about the centroid, then set out onto the lit face.
function spec(b, path, L, along, across, sl, sa, alpha) {
  ctx.save();
  ctx.translate(
    b.cx + L.x * along - L.y * across,
    b.cy + L.y * along + L.x * across,
  );
  ctx.rotate(L.a);
  ctx.scale(sl, sa);
  ctx.rotate(-L.a);
  ctx.translate(-b.cx, -b.cy);
  ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
  ctx.fill(path);
  ctx.restore();
}

function drawBlob(b) {
  const t = b.t;
  // alma's own: the ring pushed out by its point radius, splined and closed.
  const path = sim.outline(b);

  // Centroid toward the lamp, and that as an angle for the highlight transform.
  const ldx = LIGHT_X - b.cx;
  const ldy = LIGHT_Y - b.cy;
  const llen = Math.hypot(ldx, ldy) || 1;
  const L = { x: ldx / llen, y: ldy / llen, a: Math.atan2(ldy, ldx) };

  // Extent along the light axis and across it; the bands lay out on that span.
  const { px, py } = sim;
  let lo = Infinity;
  let hi = -Infinity;
  let across = 0;
  for (let i = b.start; i < b.start + b.count; i++) {
    const dx = px[i] - b.cx;
    const dy = py[i] - b.cy;
    const d = dx * L.x + dy * L.y;
    if (d < lo) lo = d;
    if (d > hi) hi = d;
    const a = Math.abs(dy * L.x - dx * L.y);
    if (a > across) across = a;
  }
  const rad = b.pointRadius * b.scale;
  const span = hi - lo + 2 * rad;
  const reach = hi + rad;
  across += rad;

  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // `t.blur` is what `shadowBlur` was given, in device pixels, so scale it out.
  const spread = t.blur / devScale();
  const dropX = b.cx - L.x * t.drop;
  const dropY = b.cy - L.y * t.drop;
  ctx.fillStyle = "rgba(0, 0, 0, 0.0724)";
  for (let i = SHADOW_STEPS - 1; i >= 0; i--) {
    const grow = 1.04 + spread * i / (SHADOW_STEPS - 1) / t.outer;
    ctx.save();
    ctx.translate(dropX, dropY);
    ctx.scale(grow, grow);
    ctx.translate(-b.cx, -b.cy);
    ctx.fill(path);
    ctx.restore();
  }

  // Under the contour and wider, so what shows is a ring outside the blob.
  if (b === aim || b === hover) {
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = t.edge + 2 * (b === aim ? 8 : 4);
    ctx.stroke(path);
  }

  // First, so the clipped bands land on its inner half.
  ctx.strokeStyle = t.line;
  ctx.lineWidth = t.edge;
  ctx.stroke(path);

  ctx.save();
  ctx.clip(path);

  // Darkest first, scaled toward the lamp, so the flanks pinch in with range.
  const far = llen - lo + rad; // lamp to the blob's far edge, along the axis
  const steps = [0, Math.max(3, 0.020 * span), 0.28 * span];
  for (let i = 0; i < steps.length; i++) {
    const k = Math.max(0, 1 - steps[i] / far);
    ctx.save();
    ctx.translate(LIGHT_X, LIGHT_Y);
    ctx.scale(k, k);
    ctx.translate(-LIGHT_X, -LIGHT_Y);
    ctx.fillStyle = t.ramp[i];
    ctx.fill(path);
    ctx.restore();
  }

  // The outline squashed along the light axis; the satellite sits inside it.
  spec(b, path, L, reach * 0.62, across * 0.20, 0.23, 0.32, 0.78);
  spec(b, path, L, reach * 0.78, across * -0.28, 0.095, 0.13, 0.52);

  if (b.flash > 0) {
    ctx.fillStyle = `rgba(255, 255, 255, ${0.85 * b.flash})`;
    ctx.fill(path);
  }
  ctx.restore();

  ctx.save();
  ctx.translate(b.cx, b.cy);
  // Upright like everything else, and sized off the tier, so the squeeze shows.
  const font = t.font * b.scale;
  ctx.font = `800 ${Math.round(font)}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const lift = Math.max(1.5, font * 0.065);
  ctx.fillStyle = t.emboss;
  ctx.fillText(t.value, L.x * lift, L.y * lift);
  ctx.fillStyle = t.label;
  ctx.fillText(t.value, 0, 0);
  ctx.restore();
}

// one.js hands over the 1024 board with `meta.bg` already filled to it.
export function render(g) {
  ctx = g;
  const s = devScale();

  g.save();
  g.translate(VIEW_X, 0);
  g.scale(VIEW, VIEW);

  // The camera moves the world and nothing else.
  g.save();
  cam.apply(g);
  g.drawImage(poolLayer.bake(s, W, H, paintPool, s), 0, 0, W, H);

  // Under the queue, which sags below it.
  drawRail();

  for (const b of blobs) drawBlob(b);
  // Over the pile; both under the arrow, which is on the screen and not in it.
  drawDanger(g);
  drawShocks();
  if (aim) drawArrow(aim);
  g.restore();
  g.restore();

  // After the camera and over the whole board: a hole in the screen does not
  // move. Baked at half resolution, keyed on the scale it is shown at.
  const scale = op.screen.scale;
  const paint = (c) => paintVignette(c, SIZE, SIZE, VIEW);
  g.drawImage(
    vigLayer.bake(scale, SIZE, SIZE, paint, scale * 0.5),
    0,
    0,
    SIZE,
    SIZE,
  );
}

// ---- Frame ----------------------------------------------------------------

// One physics frame: the repairs first, then the substeps.
function step(dt) {
  if (danger.over) return; // a finished run is a still picture
  // The feed first, so an arrival this frame is solved from its first substep.
  updateLauncher(dt);
  updateMerges(dt);
  sim.measure();
  sim.repair(dt);

  // Last before the substeps, so a kicked point is solved this frame.
  updateShocks(dt);

  // Read fresh off the aim, not carried as state. A bar blob keeps its own
  // RAIL_GRAVITY and does not feel it.
  sim.gravity.x = aimTilt();
  sim.step(dt);

  // On the pile as it now stands; a loss gives up the hand and the aim with it.
  updateDanger(dt);
  if (!danger.over) return;
  cancelAim();
  sim.release();
}

function tryGrab(x, y) {
  let hit = null;
  let hitD = 30;
  for (const b of blobs) {
    if (b.bar) continue; // the rail aims, it does not drag
    if (sim.contains(b, x, y)) {
      hit = b;
      break;
    }
    const d = sim.nearest(b, x, y);
    if (d < hitD) {
      hitD = d;
      hit = b;
    }
  }
  // `grab` freezes the offset, so the blob is carried from where it was clicked.
  if (hit) sim.grab(hit, x, y);
}

// An empty pool, as the original ships: the whole climb is the player's.
function reset() {
  sim.clear();
  resetLauncher();
  waves.length = 0;
  resetDanger();
  // The view leaning into the level, with the springs to stop it.
  cam.settle();
  cam.spin(Math.random() < 0.5 ? -1 : 1);
  alma.random.seed(Date.now() | 0);
}

// The speed a held blob travels at and leaves with, measured on the board: the
// camera moving the world is not the hand. Smoothed and capped by alma's, one
// jittery sample not being a flick and a pointer that jumps not being a speed.
const handSpeed = new alma.PointerSpeed({ rate: 30, cap: MAX_SPEED });

function handleInput(dt) {
  // The board's 1024 back into world units, which is where the aim measures.
  const lx = (mouse.x - VIEW_X) / VIEW;
  const ly = mouse.y / VIEW;
  handSpeed.sample(lx, ly, dt);

  // Not where the cursor is, while the camera is off the origin.
  const p = cam.toWorld(lx, ly);
  sim.grabTo(p.x, p.y, handSpeed.x, handSpeed.y);

  // Before the press, or the first frame of a touch has nothing to pick.
  hoverBar(p.x, p.y);
  // Right click is the original's give-up; on the board that button is b2.
  if (key.just.b2) cancelAim();
  if (mouse.click) {
    // A touch lands where it lands; no motion before it to carry. Reset to the
    // press, not to wherever the tracker last looked, so this does not depend
    // on the sample above having run first.
    handSpeed.reset(lx, ly);
    sim.grabTo(p.x, p.y, 0, 0);
    // The launcher gets first refusal: the rail aims, elsewhere drags.
    if (!startAim(lx, ly)) tryGrab(p.x, p.y);
  }
  if (aim) {
    aimAt(lx, ly, dt);
    if (!mouse.press) launch();
  }
  if (!mouse.press) sim.release();
}

export function init() {
  // The rail's forces, run once per substep before the integrate.
  sim.preSolve = solveRail;
  // Only arms a gesture; nothing is heard until the page is clicked.
  if (!audio) initSound();
  reset();
  hint(meta.desc);
}

export function update(dt) {
  // Display's clock. Before the pointer, so a press lands on what was shown.
  cam.update(dt);
  handleInput(dt);
  // Where it is called is where the earned steps run: after the input.
  fixed(60, (h) => step(h));
}
