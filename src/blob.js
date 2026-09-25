/*
 * blob - a merge game in a pool. After Sobosuba's bar mode.
 *
 * alma's SoftBodies holds the positions: `sim.bodies` is the list every loop
 * here iterates, and `body.ent` is its Blob. Everything is in the 1024 board,
 * and ent.update() runs inside the 60Hz fixed step.
 */

import "./alma/src/extend.js";
import color from "./alma/src/color.js";
import * as line from "./alma/src/geom/line.js";
import { Path2D } from "./alma/src/geom/path2d.js";
import * as sdf from "./alma/src/geom/sdf.js";
import * as spline from "./alma/src/geom/spline.js";
import { Layer } from "./alma/src/gfx/layer.js";
import * as random from "./alma/src/random.js";
import { hp, lp } from "./alma/src/sfx.js";
import { blow } from "./alma/src/sfxgen.js";
import { PointerSpeed } from "./alma/src/smooth.js";
import { SoftBodies } from "./alma/src/softbody.js";
import { camera } from "./lib/camera2d.js";
import * as ent from "./lib/entity.js";
import { fixed, gameOver, input, op, score } from "./lib/one.js";
import * as sound from "./lib/sound.js";

export { render } from "./lib/entity.js";

export const meta = {
  title: "blob",
  bg: "#14171c",
  fg: "#8a9ab4",
  scoreMax: true,
  date: "2026-09-01",
};

// A ring point's radius: how far outside the ring a blob's edge reaches.
const R = 7;

const TIER_COUNT = 16;
// Tier 0 takes the share of the pool below the danger line that Sobosuba's does.
const TIER_RADIUS = 45.2;
const TIER_GROWTH = Math.sqrt(1.26);

const GRAVITY = 1800;
const RAIL_GRAVITY = { x: 0, y: GRAVITY };
const MAX_SPEED = 4800;

const AIM_MAX = 260;
const BAR_SHRINK = 0.65;
const FEED_PERIOD = 0.5;
const FEED_COOL = 0.7;
// Merges needed before a tier joins the deal.
const DEAL_UNLOCK = [0, 1, 3, 6, 10, 15, 21];

const DANGER_PITCH = 2.5;
const DANGER_HOLD = 1.0;

const LIGHT_X = -180;
const LIGHT_Y = -180;

function light(x, y) {
  const dx = LIGHT_X - x;
  const dy = LIGHT_Y - y;
  const d = Math.hypot(dx, dy);
  return { x: dx / d, y: dy / d, d };
}

function shift(c, dl) {
  return c.withOKLCH(([l, ch, h]) => [l + dl, ch, h]).css;
}

const TIERS = Array.from({ length: TIER_COUNT }, (_, i) => {
  const outer = TIER_RADIUS * TIER_GROWTH ** i;
  const radius = outer - R;
  const area = Math.PI * outer * outer;
  const c = color.oklch(0.80 - 0.17 * i / (TIER_COUNT - 1), 0.16, 25 + 33 * i);
  const cool = (m, dl) => shift(c.mix(color("#3f63a8"), m, "oklab"), dl);
  // A minor pentatonic degree a tier, tier 0 at A5 down to tier 15 at A2.
  const k = TIER_COUNT - 1 - i;
  return {
    index: i,
    outer,
    radius,
    base: SoftBodies.ring(Math.max(12, Math.round(Math.TAU * radius / (4 * R / 3)))),
    mass: area / 500,
    cool: Math.log(100) * area / 85000,
    shock: area / 28000,
    pitch: 110 * 2 ** (Math.floor(k / 5) + [0, 3, 5, 7, 10][k % 5] / 12),
    value: 2 ** i,
    font: radius * Math.min(0.62, 2.1 / `${2 ** i}`.length),
    edge: Math.clamp(outer * 0.055, 5.5, 10.5),
    drop: Math.min(28, outer * 0.22),
    blur: Math.min(36, outer * 0.34),
    ramp: [cool(0.44, 0.05), cool(0.34, -0.19), c.css],
    line: cool(0.30, -0.45),
    label: cool(0.25, -0.40),
    emboss: shift(c.mix(color("#fff2cc"), 0.35, "oklab"), 0.12),
  };
});

function flatten(pts, step = 7) {
  const curve = spline.catmullRom(pts.map(([x, y]) => ({ x, y })), {
    alpha: 0,
    tension: 0,
  });
  return [...spline.pointsByDistance(spline.arcLength(curve), step)]
    .map(({ x, y }) => ({ x, y }));
}

function buildPool({ chain, danger, lower }) {
  const xs = chain.map((p) => p.x);
  const ys = chain.map((p) => p.y);
  const ox = (1024 - Math.max(...xs) - Math.min(...xs)) / 2;
  const oy = (1024 - Math.max(...ys) - Math.min(...ys)) / 2 + lower;
  chain = chain.map(({ x, y }) => ({ x: x + ox, y: y + oy }));
  const head = chain[0];
  const tail = chain.at(-1);

  // Collision closes the chain along the top, above everything.
  const poly = [{ x: head.x, y: -480 }, ...chain, { x: tail.x, y: -480 }];
  let twice = 0;
  for (const [i, p] of poly.entries()) {
    const q = poly[(i + 1) % poly.length];
    twice += p.x * q.y - q.x * p.y;
  }

  // Where the chain crosses the danger line: the width the pile must cover.
  danger += oy;
  const cross = [];
  for (let i = 1; i < chain.length; i++) {
    const a = chain[i - 1];
    const b = chain[i];
    if ((a.y > danger) === (b.y > danger)) continue;
    cross.push(a.x + (danger - a.y) * (b.x - a.x) / (b.y - a.y));
  }

  const l = Math.min(head.x, tail.x);
  const r = Math.max(head.x, tail.x);
  return {
    chain,
    line: Path2D.fromPoints(chain, false),
    fill: Path2D.fromPoints(chain),
    field: sdf.bake(sdf.polygon(poly), {
      bounds: { x0: -70, y0: -310, x1: 1024 + 70, y1: 1024 + 70 },
      cell: 3.5,
      band: TIERS.at(-1).outer + 2 * R,
    }),
    side: Math.sign(twice),
    mouth: { l, r },
    mid: (l + r) / 2,
    x0: Math.min(...xs) + ox,
    x1: Math.max(...xs) + ox,
    y1: Math.max(...ys) + oy,
    bar: Math.min(head.y, tail.y),
    danger,
    dangerL: Math.min(...cross),
    dangerR: Math.max(...cross),
  };
}

const pool = buildPool({
  danger: 291,
  lower: 56, // room above the rail for an aim drawn upward
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

// The two ends of the rail, kept off the walls of a narrower pool.
const FEEDS = [-1, 1].map((s) => {
  const edge = TIERS[DEAL_UNLOCK.length - 1].outer * BAR_SHRINK + 12;
  const span = Math.min(450, pool.mouth.r - pool.mouth.l - 2 * edge) / 2;
  return { x: pool.mid + s * span, y: pool.bar - 36 };
});

const sim = new SoftBodies({
  width: 1024,
  height: 1024,
  radius: R,
  field: pool.field,
  gravity: { x: 0, y: GRAVITY },
  maxSpeed: MAX_SPEED,
  drag: 0.15,
  rigidDamp: 25,
});

// The sim mutates this array in place.
const blobs = sim.bodies;

let rail = null;
let arrow = null;
let shocks = null;

// A bar blob has no wall, or the mouth pushes the queue out; this bounds its x.
function clampMouth(b, s) {
  const { l, r } = pool.mouth;
  for (let i = b.start; i < b.start + b.count; i++) {
    s.px[i] = Math.clamp(s.px[i], l + s.pr[i], r - s.pr[i]);
  }
}

// `body.scale` is the solver's size, not Entity's `scale`.
class Blob extends ent.Entity {
  constructor(index, x, y, merged = false) {
    super();
    this.tier = TIERS[index];
    this.merged = merged;
    this.bar = false;
    this.body = sim.add({
      base: this.tier.base,
      radius: this.tier.radius,
      mass: this.tier.mass,
      x,
      y,
    });
    this.body.ent = this;
    if (merged) this.body.grace = sim.refitCooldown;
  }

  get radius() {
    return this.tier.outer * this.body.scale;
  }

  // A merge's result waits before it merges again, so a cascade goes one tier
  // a step.
  get merges() {
    if (this.tier.index === TIER_COUNT - 1) return false;
    return !this.merged || this.age >= this.tier.cool;
  }

  get flash() {
    const u = this.age / 0.3;
    return this.merged && u < 1 ? 1 - u * u : 0;
  }

  remove() {
    sim.remove(this.body);
    super.remove();
  }

  setBar(on) {
    this.bar = on;
    this.body.wall = on ? clampMouth : null;
    this.body.gravity = on ? RAIL_GRAVITY : null;
    sim.setScale(this.body, on ? BAR_SHRINK : this.body.scale);
  }

  // Every point at one speed, so it leaves without spin.
  shove(sx, sy) {
    const { start, count } = this.body;
    sim.vx.fill(sx, start, start + count);
    sim.vy.fill(sy, start, start + count);
  }

  update() {
    const b = this.body;
    if (this.bar || b.scale >= 1) return;
    // A third as fast while rising, so a shot up does not swell against the rail.
    const rate = (1 - BAR_SHRINK) / 0.22 * (b.mvy < 0 ? 1 / 3 : 1);
    sim.setScale(b, Math.min(1, b.scale + rate * ent.game.time));
  }

  // The body scaled about its centre and moved onto the lit side.
  spec(ctx, path, L, along, across, sl, sa, alpha) {
    const { cx, cy } = this.body;
    const a = Math.atan2(L.y, L.x);
    ctx.save();
    ctx.translate(cx + L.x * along - L.y * across, cy + L.y * along + L.x * across);
    ctx.rotate(a);
    ctx.scale(sl, sa);
    ctx.rotate(-a);
    ctx.translate(-cx, -cy);
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.fill(path);
    ctx.restore();
  }

  render(ctx) {
    const t = this.tier;
    const b = this.body;
    const path = sim.outline(b);
    const L = light(b.cx, b.cy);

    // Extent along the light and across it.
    const { px, py } = sim;
    let lo = Infinity;
    let hi = -Infinity;
    let across = 0;
    for (let i = b.start; i < b.start + b.count; i++) {
      const dx = px[i] - b.cx;
      const dy = py[i] - b.cy;
      const d = dx * L.x + dy * L.y;
      lo = Math.min(lo, d);
      hi = Math.max(hi, d);
      across = Math.max(across, Math.abs(dy * L.x - dx * L.y));
    }
    const rad = b.pointRadius * b.scale;
    const span = hi - lo + 2 * rad;
    const reach = hi + rad;
    across += rad;

    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // Eight fills at 0.0724 compound to 0.45 at the core. `t.blur` was a
    // shadowBlur, in device pixels.
    const spread = t.blur / op.screen.scale;
    ctx.fillStyle = "rgba(0, 0, 0, 0.0724)";
    for (let i = 7; i >= 0; i--) {
      const grow = 1.04 + spread * i / 7 / t.outer;
      ctx.save();
      ctx.translate(b.cx - L.x * t.drop, b.cy - L.y * t.drop);
      ctx.scale(grow, grow);
      ctx.translate(-b.cx, -b.cy);
      ctx.fill(path);
      ctx.restore();
    }

    const ring = this === arrow.blob ? 9.5 : this === arrow.hover ? 5 : 0;
    if (ring > 0) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = t.edge + 2 * ring;
      ctx.stroke(path);
    }

    // Before the fills, so they cover its inner half.
    ctx.strokeStyle = t.line;
    ctx.lineWidth = t.edge;
    ctx.stroke(path);

    ctx.save();
    ctx.clip(path);

    // Darkest first, each scaled toward the lamp.
    const far = L.d - lo + rad;
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

    this.spec(ctx, path, L, reach * 0.62, across * 0.20, 0.23, 0.32, 0.78);
    this.spec(ctx, path, L, reach * 0.78, across * -0.28, 0.095, 0.13, 0.52);

    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255, 255, 255, ${0.85 * this.flash})`;
      ctx.fill(path);
    }
    ctx.restore();

    const size = Math.round(t.font * b.scale);
    const lift = Math.max(1.8, size * 0.065);
    ctx.fillStyle = t.emboss;
    ctx.text(`${t.value}`, b.cx + L.x * lift, b.cy + L.y * lift, size);
    ctx.fillStyle = t.label;
    ctx.text(`${t.value}`, b.cx, b.cy, size);
  }
}

// Every point but the one touching and the one before it, in ring order.
function* arc(b, hit) {
  const { px, py, vx, vy } = sim;
  for (let k = 1; k <= b.count - 2; k++) {
    const i = b.start + (hit + k) % b.count;
    yield { x: px[i], y: py[i], vx: vx[i], vy: vy[i] };
  }
}

// The new ring spread evenly along the pair's joined outline.
function resample(b, path) {
  const p = path.length;
  const seg = path.map((q, i) => {
    const n = path[(i + 1) % p];
    return Math.hypot(n.x - q.x, n.y - q.y);
  });
  const stride = seg.reduce((a, s) => a + s, 0) / b.count;
  const { px, py, ox, oy, vx, vy } = sim;
  let j = 0;
  let walked = 0;
  for (let k = 0; k < b.count; k++) {
    while (j < p - 1 && walked + seg[j] <= k * stride) walked += seg[j++];
    const t = seg[j] > 1e-9 ? (k * stride - walked) / seg[j] : 0;
    const q0 = path[j];
    const q1 = path[(j + 1) % p];
    const i = b.start + k;
    px[i] = ox[i] = q0.x + (q1.x - q0.x) * t;
    py[i] = oy[i] = q0.y + (q1.y - q0.y) * t;
    vx[i] = q0.vx + (q1.vx - q0.vx) * t;
    vy[i] = q0.vy + (q1.vy - q0.vy) * t;
  }
}

// Two arcs joined at their ends are narrow in the middle. 40% of the way to
// the rest radius, in positions only, so it adds no velocity.
function round(b) {
  const { px, py, ox, oy } = sim;
  const rest = b.restRadius * b.scale;
  for (let i = b.start; i < b.start + b.count; i++) {
    const dx = px[i] - b.cx;
    const dy = py[i] - b.cy;
    const d = Math.hypot(dx, dy);
    if (d < 1e-6) continue;
    const k = 1 + 0.4 * (rest / d - 1);
    px[i] = ox[i] = b.cx + dx * k;
    py[i] = oy[i] = b.cy + dy * k;
  }
}

// The lowest same-tier contact, one a step, so a pile merges bottom up.
function detectMerges() {
  const { px, py } = sim;
  const near = (2 * R + 1) ** 2;
  let lowest = -Infinity;
  let pair = null;
  for (const a of blobs) {
    if (!a.ent.merges) continue;
    for (const b of blobs) {
      if (b.start <= a.start || b.ent.tier !== a.ent.tier || !b.ent.merges) {
        continue;
      }
      if (a.x1 < b.x0 || b.x1 < a.x0 || a.y1 < b.y0 || b.y1 < a.y0) continue;
      for (let i = a.start; i < a.start + a.count; i++) {
        for (let j = b.start; j < b.start + b.count; j++) {
          if ((px[i] - px[j]) ** 2 + (py[i] - py[j]) ** 2 > near) continue;
          const y = (py[i] + py[j]) / 2;
          if (y <= lowest) continue;
          lowest = y;
          pair = [a.ent, b.ent, i, j];
        }
      }
    }
  }
  if (pair) merge(...pair);
}

function merge(a, b, i, j) {
  const hx = (sim.px[i] + sim.px[j]) / 2;
  const hy = (sim.py[i] + sim.py[j]) / 2;
  const path = [
    ...arc(a.body, i - a.body.start),
    ...arc(b.body, j - b.body.start),
  ];
  const cx = (a.body.cx + b.body.cx) / 2;
  const cy = (a.body.cy + b.body.cy) / 2;
  a.remove();
  b.remove();

  const n = new Blob(a.tier.index + 1, cx, cy, true);
  resample(n.body, path);
  // Before round(), which reads the scale setBar() leaves.
  rail.merged(a, b, n);
  arrow.merged(a, b, n);
  sim.measure();
  round(n.body);
  sim.measure();

  // Scored by what came out, so a cascade beats the same merges spread out.
  score.value += n.tier.value;
  shocks.fire(hx, hy, a.tier.shock);
  camera.shake(0.08 + 0.47 * n.tier.index / (TIER_COUNT - 1));
  // The knock is heard at 840Hz; 3 dB louder an octave down.
  sound.play("merge", {
    rate: n.tier.pitch / 840,
    volume: 0.42 * Math.min(2, Math.sqrt(TIERS[0].pitch / n.tier.pitch)),
    pan: pan(hx),
  });
}

// Runs before each substep's integrate, off what the last substep left.
function solveRail(h) {
  const { vx, vy } = sim;
  const queue = blobs.filter((b) => b.ent.bar);
  for (const b of queue) {
    const dv = 140 * (pool.bar - b.cy) * h;
    const inward = -360 * Math.clamp((b.cx - pool.mid) / b.ent.radius, -1, 1) * h;
    for (let i = b.start; i < b.start + b.count; i++) {
      vy[i] += dv - 12.0 * vy[i] * h;
      vx[i] += inward - 1.2 * vx[i] * h;
    }
  }

  // A gap between queued blobs of different tiers; two of a tier merge.
  for (let i = 0; i < queue.length; i++) {
    for (let j = i + 1; j < queue.length; j++) {
      const a = queue[i];
      const b = queue[j];
      if (a.ent.tier === b.ent.tier) continue;
      const dx = b.cx - a.cx;
      const want = a.ent.radius + b.ent.radius + 12;
      if (Math.abs(dx) >= want) continue;
      // Damped on approach only, so a queue sliding inward is not held back.
      const s = Math.sign(dx) || 1;
      const push = (600 * (want - Math.abs(dx)) - 18 * (b.mvx - a.mvx) * s) *
        h * s;
      sim.pushBody(a, -push, 0);
      sim.pushBody(b, push, 0);
    }
  }
}

class Rail extends ent.Entity {
  constructor() {
    super();
    this.made = TIERS.map(() => 0);
    this.side = 0; // the feed that went last
    this.wait = 0;
    this.since = FEED_COOL; // since the rail last lost a blob
    this.starve = 0; // room the feed test gives up while the rail is empty
  }

  update() {
    const dt = ent.game.time;
    const queued = blobs.filter((b) => b.ent.bar).length;
    this.starve = queued === 0 ? this.starve + 38 * dt : 0;
    if (queued >= 4) return;
    this.since += dt;
    if (queued > 0 && this.since < FEED_COOL) return;
    this.wait += dt;
    if (this.wait < FEED_PERIOD) return;
    this.wait = 0;
    this.side ^= 1;
    this.feed(FEEDS[this.side]);
  }

  feed(f) {
    const room = this.starve +
      Math.min(sim.clearance(f.x, f.y), sim.clearance(f.x, pool.bar));
    const tier = this.pick(f, room);
    if (tier < 0) return;
    const b = new Blob(tier, f.x, f.y);
    b.setBar(true);
    const dx = pool.mid - f.x;
    const dy = pool.bar - f.y;
    const l = Math.hypot(dx, dy);
    b.shove(dx / l * 190, dy / l * 190);
    sound.play("feed", { rate: 0.6, volume: 0.22, pan: pan(f.x) });
  }

  // Not the tier on top of the pile below, nor the one queued nearest, unless
  // that one is all that fits and the rail is down to one.
  pick(f, room) {
    let pile = -1;
    let pileY = Infinity;
    let near = -1;
    let nearD = Infinity;
    let queued = 0;
    for (const b of blobs) {
      const { tier, bar } = b.ent;
      if (bar) {
        queued++;
        const d = Math.abs(b.cx - f.x);
        if (d < nearD) [near, nearD] = [tier.index, d];
        continue;
      }
      if (b.cy <= f.y || b.cy - f.y >= 190) continue;
      if (Math.abs(b.cx - f.x) > tier.outer) continue;
      if (b.cy < pileY) [pile, pileY] = [tier.index, b.cy];
    }

    const fits = [...DEAL_UNLOCK.keys()].filter((t) =>
      this.made[t] >= DEAL_UNLOCK[t] && t !== pile && TIERS[t].outer <= room
    );
    const deal = fits.filter((t) => t !== near);
    if (deal.length > 0) return random.choice(deal);
    if (queued <= 1 && fits.length > 0) return near;
    return -1;
  }

  // The next feed comes from the far end, after FEED_COOL.
  left(b) {
    this.since = 0;
    this.wait = FEED_PERIOD;
    this.side = b.body.cx < pool.mid ? 0 : 1;
  }

  merged(a, b, n) {
    this.made[n.tier.index]++;
    n.setBar(a.bar || b.bar);
    if (a.bar && b.bar) this.left(n);
  }

  render(ctx) {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.10)";
    ctx.lineWidth = 2.5;
    ctx.strokeLine(FEEDS[0].x, pool.bar, FEEDS[1].x, pool.bar);
  }
}

class Arrow extends ent.Entity {
  constructor() {
    super();
    this.cancel();
  }

  cancel() {
    this.blob = null;
    this.hover = null;
    this.dx = 0;
    this.dy = 0;
    this.max = AIM_MAX;
  }

  // The draw scaled up by how much room it had.
  get shot() {
    const g = AIM_MAX / this.max;
    return [this.dx * g, this.dy * g];
  }

  get tilt() {
    return this.blob ? -this.shot[0] * 180 / AIM_MAX : 0;
  }

  hoverAt(x, y) {
    if (this.blob) return;
    this.hover = null;
    if (sim.grabbed) return;
    let best = 150 * 150;
    for (const b of blobs) {
      const d = (b.cx - x) ** 2 + (b.cy - y) ** 2;
      if (!b.ent.bar || d >= best) continue;
      best = d;
      this.hover = b.ent;
    }
  }

  start(sx, sy) {
    if (!this.hover) return false;
    this.blob = this.hover;
    this.press = { x: sx, y: sy };
    return true;
  }

  // AIM_MAX, or less if the board edge is nearer, but never under twice the
  // blob's radius.
  drag(sx, sy, dt) {
    const a = camera.toWorld(this.press.x, this.press.y);
    const p = camera.toWorld(sx, sy);
    const dx = p.x - a.x;
    const dy = p.y - a.y;
    const l = Math.hypot(dx, dy);
    if (l < 1e-6) {
      this.max = AIM_MAX;
    } else {
      const { cx, cy } = this.blob.body;
      const [, out] = line.rayBox(cx, cy, dx / l, dy / l, 0, 0, 1024, 1024);
      this.max = Math.max(Math.min(AIM_MAX, out), 2 * this.blob.radius);
    }
    const k = Math.min(1, this.max / l);
    this.dx = dx * k;
    this.dy = dy * k;

    const [fx, fy] = this.shot;
    const { cx, cy, mass } = this.blob.body;
    const f = mass * 215 * dt / AIM_MAX;
    camera.push(-fx * f, -fy * f, cx, cy);
  }

  // Let go inside the blob and the aim is called off.
  launch() {
    const b = this.blob;
    const drawn = Math.hypot(this.dx, this.dy);
    const [dx, dy] = this.shot;
    this.cancel();
    if (drawn < b.radius) return;

    rail.left(b);
    b.setBar(false);
    b.shove(dx * 1000 / AIM_MAX, dy * 1000 / AIM_MAX);
    const k = b.body.mass * 9.5 / AIM_MAX;
    camera.push(dx * k, dy * k, b.body.cx, b.body.cy);
  }

  merged(a, b, n) {
    if (this.blob === a || this.blob === b) this.blob = n;
    if (this.hover === a || this.hover === b) this.hover = n;
  }

  render(ctx) {
    if (!this.blob) return;
    const { cx, cy } = this.blob.body;
    ctx.fillStyle = ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
    ctx.lineCap = "round";
    ctx.lineWidth = 7;
    ctx.fillCircle(cx, cy, 7);

    const len = Math.hypot(this.dx, this.dy);
    if (len < this.blob.radius) return;
    const tx = cx + this.dx;
    const ty = cy + this.dy;
    ctx.strokeLine(cx, cy, tx, ty);

    // The head opens as the shot weakens.
    const p = Math.min(1, Math.hypot(...this.shot) / AIM_MAX);
    const ang = (40 - 18 * p) * Math.PI / 180;
    const h = -Math.min(31, len / 2) / len;
    const hx = this.dx * h;
    const hy = this.dy * h;
    ctx.beginPath();
    for (const a of [ang, -ang]) {
      ctx.moveTo(tx, ty);
      ctx.lineTo(
        tx + hx * Math.cos(a) - hy * Math.sin(a),
        ty + hx * Math.sin(a) + hy * Math.cos(a),
      );
    }
    ctx.stroke();
  }
}

// A front pushes the points it passes, and draws as the frame under it scaled
// up inside a thin ring.
class Shocks extends ent.Entity {
  constructor() {
    super();
    this.waves = [];
    // A copy of the frame: a blit that samples its own target breaks the
    // render pass on a tile-based GPU.
    this.frame = new Layer({ attr: { alpha: false } });
  }

  fire(x, y, life) {
    this.waves.push({ x, y, life, life0: life, r: 0 });
    const dx = 512 - x;
    const dy = 512 - y;
    const d = Math.hypot(dx, dy) || 1;
    camera.push(dx / d * life * 120, dy / d * life * 120);
  }

  update() {
    const dt = ent.game.time;
    const { px, py, vx, vy, count } = sim;
    for (const w of this.waves) w.life -= dt;
    this.waves = this.waves.filter((w) => w.life > 0);
    for (const w of this.waves) {
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

  render(ctx) {
    const m = ctx.getTransform();
    let src = null;
    for (const w of this.waves) {
      const p = m.transformPoint(new DOMPoint(w.x, w.y));
      const wide = w.r * 0.1;
      const amp = 7 * w.life / w.life0;
      // A clipped blit costs the whole disc, so none past the far corner.
      const far = 1.4 *
        Math.hypot(Math.max(w.x, 1024 - w.x), Math.max(w.y, 1024 - w.y));
      if (amp < 0.2 || w.r - wide > far) continue;
      for (let i = 0; i < 8; i++) {
        const r0 = w.r - wide + wide * i / 8;
        const r1 = r0 + wide / 8;
        if (r0 > far) break;
        const off = amp * Math.sin(Math.PI * (i + 0.5) / 8);
        const k = r1 / (r1 + off);
        src ??= this.frame.copy(ctx.canvas);
        ctx.save();
        ctx.beginPath();
        ctx.arc(w.x, w.y, r1, 0, Math.TAU);
        ctx.arc(w.x, w.y, Math.max(0, r0), 0, Math.TAU, true);
        ctx.clip();
        ctx.setTransform(k, 0, 0, k, p.x * (1 - k), p.y * (1 - k));
        ctx.drawImage(src, 0, 0);
        ctx.restore();
      }
    }
  }
}

const LIT_TONES = 33;

function tones(dark, lit) {
  return color(dark).steps(LIT_TONES, lit).map((c) => c.css);
}

const DANGER_TONES = tones("#46536a", "#e0472c");

// The round ends once the pile has covered the danger line, all but a gap
// narrower than tier 0, for DANGER_HOLD.
class Danger extends ent.Entity {
  constructor() {
    super();
    this.cover = new Uint8Array(
      Math.floor((pool.dangerR - pool.dangerL) / DANGER_PITCH) + 1,
    );
    this.fill = 0;
    this.held = 0;
  }

  update() {
    const { px, py } = sim;
    const { cover } = this;
    const y = pool.danger;
    cover.fill(0);
    for (const b of blobs) {
      if (b.ent.bar || b.y0 > y) continue;
      let x0 = Infinity;
      let x1 = -Infinity;
      for (let i = b.start; i < b.start + b.count; i++) {
        const d = py[i] - y;
        if (d >= R) continue;
        const w = d <= 0 ? R : Math.sqrt(R * R - d * d);
        x0 = Math.min(x0, px[i] - w);
        x1 = Math.max(x1, px[i] + w);
      }
      if (x0 >= x1) continue;
      cover.fill(
        1,
        Math.max(0, Math.ceil((x0 - pool.dangerL) / DANGER_PITCH)),
        Math.floor((x1 - pool.dangerL) / DANGER_PITCH) + 1,
      );
    }

    let gap = 0;
    let run = 0;
    for (const c of cover) {
      run = c ? 0 : run + 1;
      gap = Math.max(gap, run);
    }
    this.fill = cover.reduce((a, c) => a + c, 0) / cover.length;

    // Drains rather than resetting, or a gap that flickers open holds off the
    // end for good.
    this.held = gap * DANGER_PITCH < 2 * TIER_RADIUS
      ? Math.min(DANGER_HOLD, this.held + ent.game.time)
      : Math.max(0, this.held - 2 * ent.game.time);
    if (this.held < DANGER_HOLD) return;
    arrow.cancel();
    camera.shake(0.7);
    gameOver({ score: true });
  }

  render(ctx) {
    if (this.fill <= 0) return;
    const y = pool.danger;
    ctx.save();
    ctx.clip(pool.fill.toPath2D());
    ctx.lineCap = "round";
    ctx.lineWidth = 3.5;
    ctx.globalAlpha = 0.45 + 0.55 * this.fill;
    ctx.strokeStyle = DANGER_TONES[Math.round(this.fill * (LIT_TONES - 1))];
    ctx.beginPath();
    this.cover.forEach((c, i) => {
      if (!c) return;
      const x = pool.dangerL + i * DANGER_PITCH;
      if (!this.cover[i - 1]) ctx.moveTo(x, y);
      ctx.lineTo(Math.min(pool.dangerR, x + DANGER_PITCH), y);
    });
    ctx.stroke();

    // Blinks faster the nearer the end is.
    const held = this.held / DANGER_HOLD;
    if (held > 0) {
      const hz = 2.5 + 7.5 * held;
      const t = performance.now() / 1000;
      ctx.globalAlpha = 0.65 + 0.35 * Math.cos(Math.TAU * hz * t);
      ctx.strokeStyle = DANGER_TONES[LIT_TONES - 1];
      ctx.lineWidth = 5;
      ctx.strokeLine(pool.dangerL, y, pool.dangerR, y);
    }
    ctx.restore();
  }
}

// The wall chain moved out by `d`, positive away from the pool, each piece
// lit by how much it faces the lamp.
function litChain(ctx, d, width, ramp) {
  const pts = pool.chain;
  const s = pool.side;
  ctx.lineWidth = width;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = s * dy / len * d;
    const ny = -s * dx / len * d;
    const L = light((a.x + b.x) / 2 + nx, (a.y + b.y) / 2 + ny);
    const k = Math.max(0, s * Math.sign(d) * (dy * L.x - dx * L.y) / len);
    ctx.strokeStyle = ramp[Math.round(k * (LIT_TONES - 1))];
    ctx.strokeLine(a.x + nx, a.y + ny, b.x + nx, b.y + ny);
  }
}

// `scale` is the bake's: a blur and an offset are in device pixels.
function paintPool(ctx, scale) {
  const { x0, x1, y1 } = pool;
  const fill = pool.fill.toPath2D();
  const edge = pool.line.toPath2D();
  const mx = (x0 + x1) / 2;
  const my = y1 / 2;
  const L = light(mx, my);

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
  ctx.fill(fill);

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // The wall's shadow on the board outside the pool.
  ctx.save();
  ctx.clip(
    new Path2D().rect(0, 0, 1024, 1024).addPath(pool.fill).toPath2D(),
    "evenodd",
  );
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 12;
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = 19 * scale;
  ctx.shadowOffsetX = -L.x * 11 * scale;
  ctx.shadowOffsetY = -L.y * 11 * scale;
  ctx.stroke(edge);
  ctx.restore();

  // And inside it: two blurs along the wall, then the near wall's cast shadow,
  // which the clip removes on the far side.
  ctx.save();
  ctx.clip(fill);
  ctx.strokeStyle = ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
  ctx.lineWidth = 9.5;
  for (const blur of [26, 9.5]) {
    ctx.shadowBlur = blur * scale;
    ctx.stroke(edge);
  }
  ctx.shadowBlur = 36 * scale;
  ctx.shadowOffsetX = -L.x * 29 * scale;
  ctx.shadowOffsetY = -L.y * 29 * scale;
  ctx.stroke(edge);
  ctx.restore();

  ctx.strokeStyle = "#39414f";
  ctx.lineWidth = 12;
  ctx.stroke(edge);
  litChain(ctx, -12.5, 13, tones("#1c222c", "#41506a"));
  litChain(ctx, 4.4, 3, tones("#2a303b", "#8a9ab4"));
  litChain(ctx, -4.4, 3.5, tones("#242a34", "#77869f"));

  // The dashes Danger lights up.
  ctx.save();
  ctx.clip(fill);
  ctx.strokeStyle = "#2b323d";
  ctx.lineWidth = 2.5;
  ctx.setLineDash([12, 12]);
  ctx.strokeLine(x0, pool.danger, x1, pool.danger);
  ctx.restore();
}

function paintVignette(ctx) {
  const cy = 1024 * 0.52;
  const v = ctx.createRadialGradient(512, cy, 1024 * 0.36, 512, cy, 1024 * 0.92);
  v.addColorStop(0, "rgba(0, 0, 0, 0)");
  v.addColorStop(1, "rgba(0, 0, 0, 0.34)");
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, 1024, 1024);
}

// Painted once per screen scale; `res` is the resolution against the screen's.
class Backdrop extends ent.Entity {
  constructor(paint, res = 1) {
    super();
    this.paint = paint;
    this.res = res;
    this.layer = new Layer();
  }

  render(ctx) {
    const s = op.screen.scale;
    const img = this.layer.bake(s, 1024, 1024, this.paint, s * this.res);
    ctx.drawImage(img, 0, 0, 1024, 1024);
  }
}

// On the screen, so the camera's lean does not move it off the corners.
class Vignette extends Backdrop {
  static screen = true;
}

// A jet into a bore, the fit to a mallet on metal, swept 466 to 1062Hz over
// 83ms. `gain` is the level the fit normalised away.
sound.make("merge", {
  osc: { type: blow, feed: 0.546 },
  freq: [466, 1062],
  env: [0.001, 0.013, 0.069],
  gain: 4.5,
  fx: [lp(375)],
});

// A sine climbing 197 to 907Hz between two filters, over a triangle for its
// first 96ms.
sound.make("feed", {
  osc: [
    {
      osc: "sine",
      freq: [197, 907],
      env: [0.009, "expOut", 0.216],
      fx: [lp(2719, 4.968), hp(680, 4.968)],
    },
    {
      osc: "tri",
      freq: [117, "expOut", 550],
      env: [0.018, "expOut", 0.078],
      fx: [lp(598)],
    },
  ],
});

sound.setVolume(0.72);
// A cascade plays a knock a merge, and four at once reach the limiter.
sound.setLimit(4);

function pan(x) {
  return Math.clamp((2 * (x - pool.x0) / (pool.x1 - pool.x0) - 1) * 0.7, -1, 1);
}

function grab(x, y) {
  let hit = null;
  let hitD = 36;
  for (const b of blobs) {
    if (b.ent.bar) continue;
    if (sim.contains(b, x, y)) {
      hit = b;
      break;
    }
    const d = sim.nearest(b, x, y);
    if (d < hitD) [hit, hitD] = [b, d];
  }
  if (hit) sim.grab(hit, x, y);
}

// On the screen: the camera moving is not the pointer moving.
const pointer = new PointerSpeed({ rate: 30, cap: MAX_SPEED });

export function init() {
  sim.clear();
  sim.preSolve = solveRail;
  ent.reset([Backdrop, Rail, Blob, Danger, Shocks, Arrow, Vignette]);
  // After reset(), which sets its own.
  camera.shakeBase = 3;
  camera.shakeRate = 15.5;
  camera.spin(Math.random() < 0.5 ? -1 : 1);
  random.seed(Date.now() | 0);

  new Backdrop(paintPool);
  rail = new Rail();
  new Danger();
  shocks = new Shocks();
  arrow = new Arrow();
  new Vignette(paintVignette, 0.5);
}

function step(dt) {
  if (!op.playing) return;
  sim.measure();
  detectMerges();
  sim.repair(dt);
  ent.update(dt);
  // Rail blobs have their own gravity and do not tilt.
  sim.gravity.x = arrow.tilt;
  sim.step(dt);
}

// Before the fixed step, and the camera has already moved, so a press lands on
// what was shown.
export function update(dt) {
  pointer.sample(input.x, input.y, dt);
  const p = camera.toWorld(input.x, input.y);
  sim.grabTo(p.x, p.y, pointer.x, pointer.y);
  // Before the press, so a touch's first frame has a hover to start from.
  arrow.hoverAt(p.x, p.y);
  if (input.just.act) {
    pointer.reset(input.x, input.y);
    sim.grabTo(p.x, p.y, 0, 0);
    if (!arrow.start(input.x, input.y)) grab(p.x, p.y);
  }
  if (arrow.blob) {
    arrow.drag(input.x, input.y, dt);
    if (!input.press.act) arrow.launch();
  }
  if (!input.press.act) sim.release();
  fixed(60, step);
}
