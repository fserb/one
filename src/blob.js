/*
 * blob - a merge game in a pool. After Sobosuba's bar mode.
 *
 * alma's SoftBodies owns the positions: `sim.bodies` is the list every loop
 * here iterates and `body.ent` is the reference back to the Blob. Everything
 * is in the 1024 board, and ent.update() runs inside the 60Hz fixed step.
 */

import {
  color,
  Layer,
  line,
  PointerSpeed,
  random,
  sdf,
  SoftBodies,
  spline,
} from "./alma/src/index.js";
import { camera } from "./lib/camera.js";
import * as ent from "./lib/entity.js";
import { fixed, FONT, gameOver, input, op, score, SIZE } from "./lib/one.js";
import * as sound from "./lib/sound.js";

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
};

// One ring point's radius: how far outside the ring a blob's edge reaches.
const R = 7;

const TIER_COUNT = 16;
const TIER_RADIUS = 42;
const TIER_GROWTH = Math.sqrt(1.26);

function shift(c, dl) {
  return c.withOKLCH(([l, ch, h]) => [l + dl, ch, h]).css;
}

function buildTiers() {
  const tiers = [];
  for (let i = 0; i < TIER_COUNT; i++) {
    const outer = TIER_RADIUS * TIER_GROWTH ** i;
    const radius = outer - R;
    const n = Math.max(
      12,
      Math.round(Math.TAU * radius / (2 * R * (1 - 1 / 3))),
    );
    const c = color.oklch(
      0.80 - 0.17 * i / (TIER_COUNT - 1),
      0.16,
      25 + 33 * i,
    );
    const cool = (m, dl) => shift(c.mix(color("#3f63a8"), m, "oklab"), dl);
    const warm = (m, dl) => shift(c.mix(color("#fff2cc"), m, "oklab"), dl);
    tiers.push({
      index: i,
      outer,
      radius,
      count: n,
      base: SoftBodies.ring(n),
      mass: Math.PI * outer * outer / 500,
      cool: Math.log(100) * Math.PI * outer * outer / 85000,
      value: 2 ** i,
      font: radius * Math.min(0.62, 2.1 / `${2 ** i}`.length),
      edge: Math.clamp(outer * 0.055, 5.5, 10.5),
      drop: Math.min(28, outer * 0.22),
      blur: Math.min(36, outer * 0.34),
      ramp: [cool(0.44, 0.05), cool(0.34, -0.19), c.css],
      line: cool(0.30, -0.45),
      label: cool(0.25, -0.40),
      emboss: warm(0.35, 0.12),
    });
  }
  return tiers;
}

const TIERS = buildTiers();

function flatten(pts, step = 7) {
  const curve = spline.catmullRom(pts.map(([x, y]) => ({ x, y })), {
    alpha: 0,
    tension: 0,
  });
  const arc = spline.arcLength(curve);
  return [...spline.pointsByDistance(arc, step)].map((p) => [p.x, p.y]);
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
  const ox = (SIZE - (x1 - x0)) / 2 - x0;
  const oy = (SIZE - (y1 - y0)) / 2 - y0;
  const chain = shape.chain.map(([x, y]) => [x + ox, y + oy]);
  const bounds = { x0: x0 + ox, x1: x1 + ox, y1: y1 + oy };

  // Collision closes the chain along the top, above everything.
  const head = chain[0];
  const tail = chain[chain.length - 1];
  const poly = [[head[0], -480], ...chain, [tail[0], -480]];

  let twice = 0;
  for (let i = 0; i < poly.length; i++) {
    const q = poly[(i + 1) % poly.length];
    twice += poly[i][0] * q[1] - q[0] * poly[i][1];
  }

  const field = sdf.bake(
    sdf.polygon(poly.map(([x, y]) => ({ x, y }))),
    {
      bounds: { x0: -70, y0: -310, x1: SIZE + 70, y1: SIZE + 70 },
      cell: 3.5,
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
  let fillPath = null;
  let linePath = null;

  return {
    field,
    get fill() {
      return fillPath ??= chainPath(chain, true);
    },
    get line() {
      return linePath ??= chainPath(chain, false);
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
  danger: 291,
  chain: flatten([
    [162, 105],
    [112, 291],
    [71, 499],
    [83, 707],
    [208, 884],
    [441, 910],
    [674, 884],
    [799, 707],
    [811, 499],
    [770, 291],
    [720, 105],
  ]),
});

const GRAVITY = 1800;
const MAX_SPEED = 4800;

const sim = new SoftBodies({
  width: SIZE,
  height: SIZE,
  radius: R,
  field: pool.field,
  gravity: { x: 0, y: GRAVITY },
  maxSpeed: MAX_SPEED,
  drag: 0.15,
  rigidDamp: 25,
});

// The sim mutates this array in place, so the alias cannot go stale.
const blobs = sim.bodies;

const LIGHT_X = -180;
const LIGHT_Y = -180;

// Eight fills at 0.0724 compound to 1 - (1 - a)^8 = 0.45 at the core.
const SHADOW_STEPS = 8;

const FLASH = 0.3;

// Both cooldowns are read off `age` rather than counted down, so a merge sets
// them once and nothing decrements them. `body.scale` is the rail's squeeze,
// the solver's own number, not Entity's `scale`, which stays at 1 here.
class Blob extends ent.Entity {
  constructor(index, cx, cy) {
    super();
    this.tier = TIERS[Math.min(index, TIER_COUNT - 1)];
    this.body = sim.add({
      base: this.tier.base,
      radius: this.tier.radius,
      mass: this.tier.mass,
      x: cx,
      y: cy,
    });
    this.body.ent = this;
    this.bar = false;
    this.coolFor = 0;
    this.flashes = false;
  }

  get radius() {
    return this.tier.outer * this.body.scale;
  }

  // Too young to merge, which keeps a cascade to one tier a step.
  get cooling() {
    return this.age < this.coolFor;
  }

  get flash() {
    if (!this.flashes) return 0;
    const u = this.age / FLASH;
    return u >= 1 ? 0 : 1 - u * u;
  }

  // The body goes with it: one left in the arrays keeps falling.
  remove() {
    sim.remove(this.body);
    super.remove();
  }

  // `setScale` takes the point radius with it, or the ring's points crowd and
  // its edge thickens.
  setBar(on) {
    this.bar = on;
    this.body.wall = on ? clampMouth : null;
    this.body.gravity = on ? RAIL_GRAVITY : null;
    sim.setScale(this.body, on ? BAR_SHRINK : this.body.scale);
  }

  // Every point at this speed, so it leaves without spin.
  shove(sx, sy) {
    const { vx, vy } = sim;
    const { start, count } = this.body;
    for (let i = start; i < start + count; i++) {
      vx[i] = sx;
      vy[i] = sy;
    }
  }

  update() {
    const b = this.body;
    if (this.bar || b.scale >= 1) return;
    sim.setScale(b, Math.min(1, b.scale + GROW_RATE * ent.game.time));
  }

  // The body path scaled about the centroid, offset onto the lit face.
  spec(ctx, path, L, along, across, sl, sa, alpha) {
    const { cx, cy } = this.body;
    ctx.save();
    ctx.translate(cx + L.x * along - L.y * across, cy + L.y * along + L.x * across);
    ctx.rotate(L.a);
    ctx.scale(sl, sa);
    ctx.rotate(-L.a);
    ctx.translate(-cx, -cy);
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.fill(path);
    ctx.restore();
  }

  render(ctx) {
    const t = this.tier;
    const b = this.body;
    const path = sim.outline(b);

    const ldx = LIGHT_X - b.cx;
    const ldy = LIGHT_Y - b.cy;
    const llen = Math.hypot(ldx, ldy) || 1;
    const L = { x: ldx / llen, y: ldy / llen, a: Math.atan2(ldy, ldx) };

    // Extent along the light axis and across it.
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

    // `t.blur` is what `shadowBlur` was given, in device pixels.
    const spread = t.blur / op.screen.scale;
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
    if (this === aim || this === hover) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = t.edge + 2 * (this === aim ? 9.5 : 5);
      ctx.stroke(path);
    }

    // First, so the clipped bands land on its inner half.
    ctx.strokeStyle = t.line;
    ctx.lineWidth = t.edge;
    ctx.stroke(path);

    ctx.save();
    ctx.clip(path);

    // Darkest first, scaled toward the lamp, so the sides narrow with distance.
    const far = llen - lo + rad; // lamp to the blob's far edge, along the axis
    const steps = [0, Math.max(3.5, 0.020 * span), 0.28 * span];
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

    // The outline squashed along the light axis.
    this.spec(ctx, path, L, reach * 0.62, across * 0.20, 0.23, 0.32, 0.78);
    this.spec(ctx, path, L, reach * 0.78, across * -0.28, 0.095, 0.13, 0.52);

    const flash = this.flash;
    if (flash > 0) {
      ctx.fillStyle = `rgba(255, 255, 255, ${0.85 * flash})`;
      ctx.fill(path);
    }
    ctx.restore();

    ctx.save();
    ctx.translate(b.cx, b.cy);
    const font = t.font * b.scale;
    ctx.font = `bold ${Math.round(font)}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const lift = Math.max(1.8, font * 0.065);
    ctx.fillStyle = t.emboss;
    ctx.fillText(t.value, L.x * lift, L.y * lift);
    ctx.fillStyle = t.label;
    ctx.fillText(t.value, 0, 0);
    ctx.restore();
  }
}

const ready = new Uint8Array(TIER_COUNT);

// Hoisted rather than one closure a particle a frame.
const D2 = (2 * R + 1) ** 2;
let probe = -1;
let wantTier = null;
let lowest = -Infinity;
let ka = -1;
let kb = -1;

function consider(j) {
  const { px, py, pbody } = sim;
  if (j <= probe || pbody[j] === pbody[probe]) return;
  const b = blobs[pbody[j]].ent;
  if (b.tier !== wantTier || b.cooling) return;
  if ((px[j] - px[probe]) ** 2 + (py[j] - py[probe]) ** 2 > D2) return;
  const my = (py[probe] + py[j]) / 2;
  if (my <= lowest) return;
  lowest = my;
  ka = probe;
  kb = j;
}

// The lowest same-tier contact in the world, one a frame: piles go bottom up.
function detectMerges() {
  ready.fill(0);
  let pairs = false;
  for (const body of blobs) {
    const b = body.ent;
    if (b.cooling || b.tier.index === TIER_COUNT - 1) continue;
    if (ready[b.tier.index]) pairs = true;
    ready[b.tier.index] = 1;
  }
  if (!pairs) return;

  sim.buildGrid();
  for (let i = 0; i < sim.count; i++) {
    const a = blobs[sim.pbody[i]].ent;
    if (a.cooling || a.tier.index === TIER_COUNT - 1) continue;
    probe = i;
    wantTier = a.tier;
    sim.eachNeighbor(i, consider);
  }
  if (ka >= 0) {
    merge(
      blobs[sim.pbody[ka]].ent,
      blobs[sim.pbody[kb]].ent,
      sim.pidx[ka],
      sim.pidx[kb],
    );
  }
  ka = -1;
  kb = -1;
  lowest = -Infinity;
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

// Two arcs joined at their ends start narrow in the middle, and this takes some
// of that out. Positions only, with `ox` carried along, so it makes no
// velocity.
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
  const ab = a.body;
  const bb = b.body;
  // Taken now because `remove()` moves every index.
  const hx = (sim.px[ab.start + hitA] + sim.px[bb.start + hitB]) / 2;
  const hy = (sim.py[ab.start + hitA] + sim.py[bb.start + hitB]) / 2;
  const cx = (ab.cx + bb.cx) / 2;
  const cy = (ab.cy + bb.cy) / 2;

  const path = [];
  arcFrom(path, ab, hitA);
  arcFrom(path, bb, hitB);

  a.remove();
  b.remove();

  const n = new Blob(a.tier.index + 1, cx, cy);
  resample(n.body, path);
  noteMerge(a, b, n);
  // Scored by what came out, so a cascade is worth more than the same merges
  // spread over a minute.
  score.value += n.tier.value;
  // After noteMerge, whose squeeze sets the rest radius this rounds toward.
  round(n.body);
  shocks.fire(hx, hy, shockLife(a.tier)); // the tier that merged, not the new
  const up = n.tier.index / (TIER_COUNT - 1);
  camera.shake(0.08 + (0.55 - 0.08) * up);
  playMerge(n.tier.index, hx);
  n.coolFor = n.tier.cool;
  n.flashes = true;
  n.body.grace = sim.refitCooldown;
  sim.compact();
  sim.measure();
}

const AIM_MAX = 260;
const BAR_SHRINK = 0.65;
const GROW_RATE = (1 - BAR_SHRINK) / 0.22;
const FEED_PERIOD = 0.5;
const FEED_COOL = 0.7;
// Merges needed before a tier joins the deal, permanently.
const DEAL_UNLOCK = [0, 1, 3, 6, 10, 15, 21];

// The rail's own gravity: the tilt from aiming applies to the free pool only.
const RAIL_GRAVITY = { x: 0, y: GRAVITY };

// Stands in for the wall, which is off for a bar blob or the mouth pushes the
// queue out. Nothing else bounds a bar blob's x.
function clampMouth(b, s) {
  const { l, r } = pool.mouth;
  for (let i = b.start; i < b.start + b.count; i++) {
    s.px[i] = Math.clamp(s.px[i], l + s.pr[i], r - s.pr[i]);
  }
}

const rail = [];

// `sim.preSolve`, before the integrate, so `b.cx` and `b.mvx` are what the last
// substep left.
function solveRail(h) {
  rail.length = 0;
  for (const b of blobs) if (b.ent.bar) rail.push(b);
  if (rail.length === 0) return;

  const { vx, vy } = sim;
  for (const b of rail) {
    const dv = 140 * (pool.bar - b.cy) * h;
    // Off a ramp a blob wide, which is what a per-point pull averaged to.
    const off = (b.cx - pool.mid) / b.ent.radius;
    const inward = -360 * Math.clamp(off, -1, 1) * h;
    for (let i = b.start; i < b.start + b.count; i++) {
      vy[i] += dv - 12.0 * vy[i] * h;
      vx[i] += inward - 1.2 * vx[i] * h;
    }
  }

  // A gap between neighbours, so two queued blobs stay separate to look at.
  for (let a = 0; a < rail.length; a++) {
    const ba = rail[a];
    for (let c = a + 1; c < rail.length; c++) {
      const bc = rail[c];
      // Two of a tier merge where they are, and this gap would hold them apart.
      if (ba.ent.tier === bc.ent.tier) continue;
      const dx = bc.cx - ba.cx;
      const d = Math.abs(dx);
      const want = ba.ent.radius + bc.ent.radius + 12;
      if (d >= want) continue;
      // On the pair's approach, so a queue sliding inward as one is not
      // resisted.
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
      BAR_SHRINK + 12;
  const span = Math.min(450, r - l - 2 * edge) / 2;
  return [
    { x: pool.mid - span, y: pool.bar - 36 },
    { x: pool.mid + span, y: pool.bar - 36 },
  ];
}

const feeds = buildFeeds();

let hover = null; // the bar blob under the cursor
let aim = null; // the bar blob being drawn back
let aimX = 0; // the draw, in board units
let aimY = 0;
let aimMax = AIM_MAX; // how far the draw may run in the direction it goes
let pressX = 0; // where the press landed, on the board
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

// A blob left: the gap stands for FEED_COOL, the next comes from the far end.
function noteLeft(b) {
  gapWait = 0;
  feedWait = FEED_PERIOD;
  // updateLauncher flips before it feeds.
  side = (b.body.cx < pool.mid ? 1 : 0) ^ 1;
}

function pickTier(f, room) {
  let pile = -1;
  let near = -1; // the tier at this end of the queue
  let queue = 0; // how many blobs are on the rail at all
  let pileY = Infinity;
  let nearD = Infinity;
  for (const b of blobs) {
    const tier = b.ent.tier;
    // Along the rail, not straight down: a new blob is thrown at the middle.
    if (b.ent.bar) {
      queue++;
      const d = Math.abs(b.cx - f.x);
      if (d < nearD) {
        nearD = d;
        near = tier.index;
      }
      continue;
    }
    // A ray straight down from the feed point, crossing a ring.
    if (b.cy <= f.y || b.cy - f.y >= 190) continue;
    if (Math.abs(b.cx - f.x) > tier.outer) continue;
    if (b.cy < pileY) {
      pileY = b.cy;
      pile = tier.index;
    }
  }

  const deal = [];
  const same = []; // what only the neighbour rule refuses
  for (let t = 0; t < DEAL_UNLOCK.length; t++) {
    if (!open[t] || t === pile || TIERS[t].outer > room) continue;
    if (t === near) same.push(t);
    else deal.push(t);
  }
  if (deal.length > 0) return random.choice(deal);
  // Only the neighbour's tier fits: refuse, unless the rail is down to one.
  if (queue <= 1 && same.length > 0) return random.choice(same);
  return -1;
}

function feed(f) {
  // At both ends of the drop; `starve` relaxes it while the rail is empty.
  const room = Math.min(sim.clearance(f.x, f.y), sim.clearance(f.x, pool.bar)) +
    starve;
  const tier = pickTier(f, room);
  if (tier < 0) return;
  const b = new Blob(tier, f.x, f.y);
  b.setBar(true);
  starve = 0;
  playFeed(f.x);

  const dx = pool.mid - f.x;
  const dy = pool.bar - f.y;
  const l = Math.hypot(dx, dy) || 1;
  b.shove(dx / l * 190, dy / l * 190);
}

function updateLauncher(dt) {
  let queued = 0;
  for (const b of blobs) if (b.ent.bar) queued++;
  starve = queued === 0 ? starve + 38 * dt : 0;
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

function hoverBar(wx, wy) {
  if (aim) return;
  hover = null;
  // The drag owns the pointer while it holds one.
  if (sim.grabbed) return;
  let best = 150 * 150;
  for (const b of blobs) {
    if (!b.ent.bar) continue;
    const d = (b.cx - wx) ** 2 + (b.cy - wy) ** 2;
    if (d < best) {
      best = d;
      hover = b.ent;
    }
  }
}

// False means the press was not the launcher's, and the drag takes the pile.
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

// AIM_MAX, or the board edge if that comes first, never under twice the width.
function aimReach(b, dx, dy) {
  const l = Math.hypot(dx, dy);
  if (l < 1e-6) return AIM_MAX;
  const { cx, cy } = b.body;
  const [, out] = line.rayBox(cx, cy, dx / l, dy / l, 0, 0, SIZE, SIZE);
  return Math.max(Math.min(AIM_MAX, out), 2 * b.radius);
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
  return -sx * 180 / AIM_MAX;
}

// Both ends through toWorld in one frame.
function aimAt(sx, sy, dt) {
  if (!aim) return;
  const a = camera.toWorld(pressX, pressY);
  const b = camera.toWorld(sx, sy);
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

  const [fx, fy] = shot();
  const k = aim.body.mass * 215 * dt / AIM_MAX;
  camera.push(-fx * k, -fy * k, aim.body.cx, aim.body.cy);
}

function launch() {
  const b = aim;
  const drawn = Math.hypot(aimX, aimY);
  const [dx, dy] = shot();
  cancelAim();
  if (!b) return;

  // A draw still inside the silhouette is not a shot, which is how an aim is
  // called off: drag back over the blob and let go.
  if (drawn < b.radius) return;

  noteLeft(b);
  b.setBar(false);
  b.shove(dx * 1000 / AIM_MAX, dy * 1000 / AIM_MAX);

  const k = b.body.mass * 9.5 / AIM_MAX;
  camera.push(dx * k, dy * k, b.body.cx, b.body.cy);
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
  const t = n.tier.index;
  if (t < open.length && !open[t] && ++made[t] >= DEAL_UNLOCK[t]) {
    open[t] = true;
  }
  n.setBar(a.bar || b.bar);
  // Two becoming one shortens the queue, so it waits as a launch does.
  if (a.bar && b.bar) noteLeft(n);
  if (aim === a || aim === b) aim = n;
  if (hover === a || hover === b) hover = n;
}

class Rail extends ent.Entity {
  render(ctx) {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.10)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(feeds[0].x, pool.bar);
    ctx.lineTo(feeds[1].x, pool.bar);
    ctx.stroke();
  }
}

class Arrow extends ent.Entity {
  render(ctx) {
    if (!aim) return;
    const { cx, cy } = aim.body;
    ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
    ctx.lineCap = "round";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(cx, cy, 7, 0, Math.TAU);
    ctx.fill();

    // Nothing until the draw clears the blob: until then letting go cancels.
    const len = Math.hypot(aimX, aimY);
    if (len < aim.radius) return;
    const tx = cx + aimX;
    const ty = cy + aimY;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(tx, ty);
    ctx.stroke();

    const [sx, sy] = shot(); // the shot, not the draw: a lob is a short arrow
    const p = Math.min(1, Math.hypot(sx, sy) / AIM_MAX);
    const ang = (40 - (40 - 22) * p) * Math.PI / 180;
    // Fixed length back down the shaft, limited to half of it so it cannot
    // exceed it.
    const h = -Math.min(31, len / 2) / len;
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
}

// What a merge of this blob is worth, in seconds of wave.
function shockLife(tier) {
  return Math.PI * tier.outer * tier.outer / 28000;
}

// One copy of the frame, so the bands read it and not the canvas they draw
// into: a blit that samples its own target breaks the render pass on a
// tile-based GPU.
const scratch = new Layer({ attr: { alpha: false } });
const SHOCK_BANDS = 8;

// Every shock front there is, in one entity rather than one each: a front
// displaces what is on the canvas rather than drawing anything of its own, and
// all of them read the single copy taken before any had moved it.
class Shocks extends ent.Entity {
  constructor() {
    super();
    this.waves = [];
  }

  fire(x, y, life) {
    this.waves.push({ x, y, life, life0: life, r: 0 });
    // Away from the blast. No position, so no lever arm.
    const dx = SIZE / 2 - x;
    const dy = SIZE / 2 - y;
    const d = Math.hypot(dx, dy) || 1;
    camera.push(dx / d * life * 120, dy / d * life * 120);
  }

  update() {
    const dt = ent.game.time;
    const { px, py, vx, vy, count } = sim;
    for (let k = this.waves.length - 1; k >= 0; k--) {
      const w = this.waves[k];
      w.life -= dt;
      if (w.life <= 0) {
        this.waves.splice(k, 1);
        continue;
      }
      // A point between the two is one the front passed this step.
      const r0 = w.r;
      w.r += 2400 * dt;
      const dv = 120 * w.life;
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

  // Displacing a thin ring outward by one amount is a uniform scale about the
  // centre, so a front is a blit clipped to the ring, the clip in board units
  // and the blit in device ones.
  render(ctx) {
    if (this.waves.length === 0) return;
    const m = ctx.getTransform();
    const canvas = ctx.canvas;
    let src = null; // taken on the first band that draws
    for (const w of this.waves) {
      const p = m.transformPoint(new DOMPoint(w.x, w.y));
      const wide = w.r * 0.1;
      const amp = 7 * (w.life / w.life0);
      if (amp < 0.2) continue;
      // A clipped blit costs its clip's bounding box, which for a ring is the
      // whole disc, so a wave past the furthest corner is a full copy for
      // nothing.
      const far = 1.4 * Math.max(
        Math.hypot(w.x, w.y),
        Math.hypot(SIZE - w.x, w.y),
        Math.hypot(w.x, SIZE - w.y),
        Math.hypot(SIZE - w.x, SIZE - w.y),
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
}

const DANGER_PITCH = 2.5;
const DANGER_HOLD = 1.0;

const cover = new Uint8Array(Math.ceil(SIZE / DANGER_PITCH) + 2);

// measure() is a call from step() and not update(): it reads the pile where the
// solve left it, and ent.update() runs before sim.step().
class Danger extends ent.Entity {
  constructor() {
    super();
    this.spans = [];
    this.fill = 0;
    this.held = 0;
    this.over = false;
  }

  measure(dt) {
    if (this.over) return;
    const { px, py } = sim;
    const y = pool.danger;
    const { l, r } = pool.dangerSpan;
    const n = Math.min(cover.length, Math.floor((r - l) / DANGER_PITCH) + 1);
    cover.fill(0, 0, n);

    for (const b of blobs) {
      if (b.ent.bar) continue; // the queue is not the pile
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

    const spans = this.spans;
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
    this.fill = covered / n;

    // Drains rather than resetting, or a small fluctuation delays the loss
    // indefinitely.
    this.held = gap * DANGER_PITCH < 2 * TIER_RADIUS
      ? Math.min(DANGER_HOLD, this.held + dt)
      : Math.max(0, this.held - dt * 2);
    if (this.held < DANGER_HOLD) return;
    this.over = true;
    camera.shake(0.7);
    gameOver({ score: true });
  }

  render(ctx) {
    const { fill, spans } = this;
    const held = this.held / DANGER_HOLD;
    if (fill <= 0) return;
    const y = pool.danger;
    ctx.save();
    ctx.clip(pool.fill);
    ctx.lineCap = "round";
    ctx.lineWidth = 3.5;
    ctx.globalAlpha = 0.45 + 0.55 * fill;
    ctx.strokeStyle = DANGER_TONES[Math.round(fill * (LIT_TONES - 1))];
    ctx.beginPath();
    for (let i = 0; i < spans.length; i += 2) {
      ctx.moveTo(spans[i], y);
      ctx.lineTo(spans[i + 1], y);
    }
    ctx.stroke();

    // Sealed: the blink runs faster the nearer the loss is.
    if (held > 0) {
      const hz = 2.5 + (10 - 2.5) * held;
      const t = performance.now() / 1000;
      ctx.globalAlpha = 0.3 + 0.7 * (0.5 + 0.5 * Math.cos(Math.TAU * hz * t));
      ctx.strokeStyle = DANGER_TONES[LIT_TONES - 1];
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(pool.dangerSpan.l, y);
      ctx.lineTo(pool.dangerSpan.r, y);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// `peak` is what each was normalised by, so it comes back at its own level.
const MERGE_PCM =
  "dHSCiaCnrq23ydLl6caPXjgkGwUCAgIEHUNmiavF2OLg1L+igV4+IQwCAgwhQGaQttz5/v7+//HTr4hmSDYpKjZKaImtzub4/fnozauFXzwgDgYMHjldgqjI4O/v5M2qg1s0GwsIEidGaI+00+r29OXGnnBCGAIDAQ0wW4asydre18SqiGQ8IgoCDiRQgK/X6u7cv5p0VDspHyEsRWmWxOX27s6jckgtJSs7T2iDo8bi8unKll4wGh41WX6Yqr3P19S9jE8bAwQhWIivxs7R0seqfkYTARI+frfW39fHtZ5+USYPGEWIx+vt1bCNcFI0HBUtZqzm/eu/jGRINiotRHW37v7tuX1POTI3Smyd0O/nunxGKSc6WYCu2e7erGkxFxw7ZJXB3+HBhkojIDxrnsrk48GFRRkSLmSez+nkv4FBGRg7da7X4s6ZViAMJFyd0+rfr20wEBxPldHx5rZxMBAdUp3f+uiuYiMJIWKx6vfSiz4MCz2M2P7ytmQhBiBjs+rxyIE8FyJYn9jozI5OJCJKh7/YyZhfNi9Og7TNw5plPjdUhLPLwJlnRD9aiLDCtY5hRkdjjK23poJgTFNvk62xnn5hVF55mKyqlXddVGB7l6ejj3RgXGqBlZ6VgmtdYXKJmZqNeWdibH+Tm5WEcWRkcoWUmI9+bmdtfY2Wk4Z3bW54hpGSi31zb3aBjJCKgHVwdH6Jj4yEeXN1fIWLioR8dnZ7g4iJhH14eX2FiomDfnp6foSHh4J9eXl+g4eHhH97e3+DhYSCf3t8f4OEhIJ+fX6BgoSDgX99fX+BgoKBfn5+gIKDgoB/fn+AgICAf39/f4CBgYGAgIB/gICAf35+fn9/gYGAf4B/f4CAgH9+fn5/gICBgH9/f3+AgIB/fn5+";
const FEED_PCM =
  "f3+AgICAgICAgICAgICAgIGBgYCAgYGBgYB/gICBgH9+fn+AgYCAf39/f39/f3+BgoKBgYCBgYKBf4CAgoKAfXx9f4GBf319f4KCgn57fH6CgYCBgoWGhoWAgoKCgoF/fX9/e3FqaG5/jZKWjIl/d25qbHWLpcDJ0L6helszGAEKGDZYgqrT7P/87NKtjmlPOSslLTlPYXiHmKSwtbe3sKqdkYFyZFlQSkhLUlxtfo+dq7O5t7KnmIh4aV1TT09SW2VzgpCep66xrqmflIZ4bGBYU1JUW2VxfouXoaeqqKOckoZ7cGdhXV1hZm52f4iQl5ydnpuXkYqCeXJsZ2VlZ2tweH+HjpSYm5qXkoqCeXFrZ2Vmam93foaMkZWWlpSQi4aBfHh2dHR0dXZ4eXt9gIOFh4iKioqJh4WBfnt4dnV1dXd5fYCDhomKioqJh4WCf316eHd2d3h5fH+ChYiJioqIhoSBfnt5d3d3eXt+gYOGh4iIiIaFg4KAf317enh3dnZ3enx/g4aJiouLioeEgX57eXd2dnd5fH+ChYeJi4uKiIaDf3x5d3Z2dnh6fYCChIaHiIeHhYSCgH58e3p5enp7fH1/goSGh4iJiYiGhIF+e3h2dXV2eHt+goWJi4yNi4mGgn15dnRzdHZ5fYGFiIqLiomGg398eXh3eHl7foCDhYaHh4aFg4F/fXt6eXl6e31/gYOFh4eIh4WDgX98enl4eHl7fYCDhYiJiomIhYJ+e3h2dXV3eX2AhIeKi4uKiIWBfnp4dnZ2eHt+goWHiYmJh4SBfnt5d3d4en2Ag4aHiIiGhIF/fHp5eXp7fX+ChIWGh4aFg4F/fXt6eXl6fH6Bg4aHiIeGhIF+e3l4eHl7foCDhYeIh4aDgH57eXl5enx+gYSGh4iHhYKAfXp5eHl6fYCDhYeIiIaEgX58enh4eXp9gIKFh4iIh4aDgH16eHd3eHp9gIOGiYqKiIaDgHx5d3d3eHt+gYSGh4iHhYOBf318e3t8fn+BgYKCgYB/f35+fn+AgoOEhISEg4F/fXt6eXp7fX+BhIaIiIeGg4B+e3l4eHl7foGEhoiIh4aDgX57eXh5enx/goWHiIeGhIF+e3h3eHl8f4OGiIqKiIWCfnp3dnZ3en6ChomKiomGgn56d3Z2eHt+goaIiomIhYF9end2dnh7foKGiYqLiYaCfnp3dXV2eX2BhYiLi4qIhYB8eHZ1dnh7gISHiouKh4R/e3h2dXd6foOHioyLiYWAe3d0dHV4fYKHi46OjIiDfXh0cXJ0eX6EiY2OjYuGgXt3dHN0d3yBhoqMjIqGgXx4dXR1eH2Ch4uNjIqFgHt2c3J0eH2DiY2PjouGgHp1cnFzeH2EiY2OjIiDfXh0c3R4fYOIjI6MiIN9d3NxcnZ8gomOkI+MhoB5dHFxdHh/hYqNjoyIgnx3dHN1eX6EiYyNi4eCfHdzcnR4foSJjY6MiIN9eHRzdXh9g4iLjIqGgXx3dXV3e4GGioyMiYR+eXV0dXh9goeKjIqHgn15dnZ4e4CFiIqJh4N+end2d3p/g4eJiYiFgXx5eHh6fYGEhoeGhIF9e3l6fH+ChYeHhYJ/e3l4eXt/g4aIiIaDf3t5eHp8gISGh4eEgX16eHl7foKFh4eGg4B9e3p7fYCChIWEg4B+fHt8fYCChIWEg4F/fXx8fn+BgoODgoB+fX1+f4GCg4SDgX99fHx9f4GChISDgX99fX1+gIKDhIOCgH58fHx+gIKEhIOCgH58fH1/gYOEhIOBf359fX5/gYKCgoGAf35+f4CBgoKCgH9+fX1+gIGCg4OCgH99fX5/gYKDg4KBf35+fn+AgYGCgYB/f39/gIGCgoKAf35+fn6AgYGCgYGAf39/gIGBgYGAf35+f3+AgYKCgYB/f35/gICBgoKBgIB/f39/gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgYGBgYCAf39/f4CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBgYE=";

sound.putPCM8("merge", MERGE_PCM, { rate: 8000, peak: 0.4641 });
sound.putPCM8("feed", FEED_PCM, { rate: 8000, peak: 0.9327 });
sound.setVolume(0.72);
// A cascade plays one knock a merge, and four at once reach the limiter.
sound.setLimit(4);

// A minor pentatonic degree a tier, tier 0 at A5 down to tier 15 at A2.
function tone(index) {
  const k = TIER_COUNT - 1 - Math.clamp(index, 0, TIER_COUNT - 1);
  return 110 * 2 ** (Math.floor(k / 5) + [0, 3, 5, 7, 10][k % 5] / 12);
}

// Across the pool and not the board.
function panAt(x) {
  const { x0, x1 } = pool.bounds;
  return Math.clamp((2 * (x - x0) / (x1 - x0) - 1) * 0.7, -1, 1);
}

// 840Hz is the band the knock is heard in; volume rises 3 dB an octave
// downward.
function playMerge(index, x) {
  const f = tone(index);
  sound.play("merge", {
    rate: f / 840,
    volume: 0.42 * Math.min(2, Math.sqrt(tone(0) / f)),
    pan: panAt(x),
  });
}

function playFeed(x) {
  sound.play("feed", { rate: 0.6, volume: 0.22, pan: panAt(x) });
}

const LIT_TONES = 33;

function ramp(dark, lit) {
  return color(dark).steps(LIT_TONES, lit).map((c) => c.css);
}

// The wall chain pushed out by `d`, positive away from the pool, lit per piece.
function litChain(ctx, d, width, tones) {
  const pts = pool.chain;
  const s = pool.side * Math.sign(d);
  ctx.lineWidth = width;
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0];
    const dy = pts[i + 1][1] - pts[i][1];
    const len = Math.hypot(dx, dy) || 1;
    const ax = pts[i][0] + pool.side * dy / len * d;
    const ay = pts[i][1] - pool.side * dx / len * d;
    const bx = pts[i + 1][0] + pool.side * dy / len * d;
    const by = pts[i + 1][1] - pool.side * dx / len * d;
    const lx = LIGHT_X - (ax + bx) / 2;
    const ly = LIGHT_Y - (ay + by) / 2;
    const ll = Math.hypot(lx, ly) || 1;
    const k = Math.max(0, s * (dy * lx - dx * ly) / (len * ll));
    ctx.strokeStyle = tones[Math.round(k * (LIT_TONES - 1))];
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }
}

// `scale` is the bake's own: a blur and an offset are in device pixels.
function paintPool(ctx, scale) {
  const { x0, x1, y1 } = pool.bounds;
  const mx = (x0 + x1) / 2;
  const my = y1 / 2;
  const lx = LIGHT_X - mx;
  const ly = LIGHT_Y - my;
  const ll = Math.hypot(lx, ly);
  const L = ll > 0 ? { x: lx / ll, y: ly / ll } : { x: 0, y: -1 };

  const reach = Math.hypot(x1 - x0, y1) / 2;
  const back = ctx.createLinearGradient(
    mx + L.x * reach,
    my + L.y * reach,
    mx - L.x * reach,
    my - L.y * reach,
  );
  back.addColorStop(0, "#1e2531");
  back.addColorStop(1, "#0f1218");
  ctx.fillStyle = back;
  ctx.fill(pool.fill);

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Laid on the background rather than cut out of it.
  ctx.save();
  const outside = new Path2D();
  outside.rect(0, 0, SIZE, SIZE);
  outside.addPath(pool.fill);
  ctx.clip(outside, "evenodd");
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 12;
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = 19 * scale;
  ctx.shadowOffsetX = -L.x * 11 * scale;
  ctx.shadowOffsetY = -L.y * 11 * scale;
  ctx.stroke(pool.line);
  ctx.restore();

  // Blurred inward and clipped inside, so the pool is a box the blobs are in.
  ctx.save();
  ctx.clip(pool.fill);
  ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
  ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
  ctx.lineWidth = 9.5;
  for (const blur of [26, 9.5]) {
    ctx.shadowBlur = blur * scale;
    ctx.stroke(pool.line);
  }

  // The near wall's cast shadow; on the far side the clip takes it.
  ctx.shadowBlur = 36 * scale;
  ctx.shadowOffsetX = -L.x * 29 * scale;
  ctx.shadowOffsetY = -L.y * 29 * scale;
  ctx.stroke(pool.line);
  ctx.restore();

  // The flat face has no curvature, so one tone; the light is in the edges.
  ctx.strokeStyle = "#39414f";
  ctx.lineWidth = 12;
  ctx.stroke(pool.line);
  litChain(ctx, -12.5, 13, ramp("#1c222c", "#41506a"));
  litChain(ctx, 4.4, 3, ramp("#2a303b", "#8a9ab4"));
  litChain(ctx, -4.4, 3.5, ramp("#242a34", "#77869f"));

  // Baked dashes; what lights up on them is Danger, over the pile.
  ctx.save();
  ctx.clip(pool.fill);
  ctx.strokeStyle = "#2b323d";
  ctx.lineWidth = 2.5;
  ctx.setLineDash([12, 12]);
  ctx.beginPath();
  ctx.moveTo(pool.bounds.x0, pool.danger);
  ctx.lineTo(pool.bounds.x1, pool.danger);
  ctx.stroke();
  ctx.restore();
}

const DANGER_TONES = ramp("#46536a", "#e0472c");

// Baked at half resolution, which is all a gradient this wide needs.
function paintVignette(ctx) {
  const cx = SIZE / 2;
  const cy = SIZE * 0.52;
  const v = ctx.createRadialGradient(cx, cy, SIZE * 0.36, cx, cy, SIZE * 0.92);
  v.addColorStop(0, "rgba(0, 0, 0, 0)");
  v.addColorStop(1, "rgba(0, 0, 0, 0.34)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, SIZE, SIZE);
}

// Under the camera the lean and the recoil would move the dark corners off the
// corners they darken.
class Vignette extends ent.Entity {
  static screen = true;

  render(ctx) {
    const scale = op.screen.scale;
    ctx.drawImage(
      vigLayer.bake(scale, SIZE, SIZE, paintVignette, scale * 0.5),
      0,
      0,
      SIZE,
      SIZE,
    );
  }
}

// Keyed on the screen scale alone: the shape, the lamp and the gradients are
// all fixed in board units.
const poolLayer = new Layer();
const vigLayer = new Layer();

class Pool extends ent.Entity {
  render(ctx) {
    const scale = op.screen.scale;
    ctx.drawImage(
      poolLayer.bake(scale, SIZE, SIZE, paintPool, scale),
      0,
      0,
      SIZE,
      SIZE,
    );
  }
}

export function render(ctx) {
  ent.render(ctx);
}

function step(dt) {
  if (danger.over) return; // a finished run is a still picture
  updateLauncher(dt); // first, so an arrival is solved from its first substep
  detectMerges();
  sim.measure();
  sim.repair(dt);

  // Last before the substeps, so a point a shock moved is solved this step.
  ent.update(dt);

  // A bar blob keeps its own RAIL_GRAVITY and is not affected by this.
  sim.gravity.x = aimTilt();
  sim.step(dt);

  danger.measure(dt);
  if (!danger.over) return;
  cancelAim();
  sim.release();
}

function tryGrab(x, y) {
  let hit = null;
  let hitD = 36;
  for (const b of blobs) {
    if (b.ent.bar) continue; // the rail aims, it does not drag
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
  if (hit) sim.grab(hit, x, y);
}

// Measured on the board: the camera moving the world is not the pointer moving.
const pointerSpeed = new PointerSpeed({ rate: 30, cap: MAX_SPEED });

function handleInput(dt) {
  pointerSpeed.sample(input.x, input.y, dt);

  const p = camera.toWorld(input.x, input.y);
  sim.grabTo(p.x, p.y, pointerSpeed.x, pointerSpeed.y);

  hoverBar(p.x, p.y); // before the press: a touch's first frame picks nothing
  if (input.just.act) {
    // A touch lands where it lands; no motion before it to carry.
    pointerSpeed.reset(input.x, input.y);
    sim.grabTo(p.x, p.y, 0, 0);
    // The launcher gets first refusal: the rail aims, elsewhere drags.
    if (!startAim(input.x, input.y)) tryGrab(p.x, p.y);
  }
  if (aim) {
    aimAt(input.x, input.y, dt);
    if (!input.press.act) launch();
  }
  if (!input.press.act) sim.release();
}

let danger = null;
let shocks = null;

export function init() {
  sim.preSolve = solveRail;
  sim.clear();
  ent.reset([Pool, Rail, Blob, Danger, Shocks, Arrow, Vignette]);
  // After reset(), which sets a shakeBase of its own.
  camera.shakeBase = 3;
  camera.shakeRate = 15.5;
  camera.spin(Math.random() < 0.5 ? -1 : 1);

  new Pool();
  new Rail();
  danger = new Danger();
  shocks = new Shocks();
  new Arrow();
  new Vignette();

  resetLauncher();
  random.seed(Date.now() | 0);
}

export function update(dt) {
  // one.js has already run the camera this frame, so a press lands on what was
  // shown, and the earned steps run after the input.
  handleInput(dt);
  fixed(60, step);
}
