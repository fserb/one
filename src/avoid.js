// avoid. Based on Aba Games' Satellite Catch.

import color from "./alma/src/color.js";
import { SoftBodies } from "./alma/src/softbody.js";
import * as ent from "./lib/entity.js";
import { gameOver, op, ramp, score } from "./lib/one.js";
import { shake } from "./lib/camera.js";
import { theme } from "./lib/overlay.js";

export { render } from "./lib/entity.js";

export const meta = {
  title: "avoid",
  bg: "#FFF6E8",
  fg: "#FFC21E",
  scoreMax: true,
  date: "2014-03-30",
  release: true,
};

// A ring point's radius at scale 1. A body's own pr is this times its scale.
const R = 7;

// Past this, pr outruns the broadphase cell and contacts are missed.
const MAX_SIZE = 300;
const MIN_SIZE = 2;

// Lit to dark.
const GOLD_TONES = ["#ffe27a", "#ffc21e", "#d18c00"];
const PINK_TONES = ["#ff96bd", "#ff3d7f", "#c40d4e"];
const RED_TONES = ["#ff8a72", "#ee2a18", "#9e0d06"];

const sim = new SoftBodies({
  width: 1024,
  height: 1024,
  radius: R * MAX_SIZE / 53, // the largest pr the player can reach
  field: null,
  gravity: { x: 0, y: 0 },
  maxSpeed: 4000,
  drag: 0, // each blob steers its own mean velocity
  rigidDamp: 6,
  maxPush: R * 0.6, // off R, not off sim.radius, which the player sets
  recoveryMargin: R * 2 / 3,
});

const rings = new Map();

function ringOf(n) {
  let base = rings.get(n);
  if (base === undefined) rings.set(n, base = SoftBodies.ring(n));
  return base;
}

const LIGHT_X = -220;
const LIGHT_Y = -260;

// Four fills at 0.055 compound to 0.20 at the core.
const SHADOW_STEPS = 4;

// Built here, not in begin(): entity.js draws from the frame a body is made.
class Blob extends ent.Entity {
  constructor(size, x, y) {
    super();
    this.base = size;
    const radius = size - R;
    const n = Math.max(12, Math.round(2 * Math.PI * radius / (2 * R * 2 / 3)));
    this.body = sim.add({
      base: ringOf(n),
      radius,
      mass: Math.PI * size * size / 500,
      x,
      y,
      pointRadius: R,
    });
    this.body.ent = this;
    this.pos.x = x;
    this.pos.y = y;
  }

  get size() {
    return this.base * this.body.scale;
  }

  set size(v) {
    const s = Math.max(MIN_SIZE, Math.min(MAX_SIZE, v));
    sim.setScale(this.body, s / this.base);
  }

  get speed() {
    return Math.hypot(this.body.mvx, this.body.mvy);
  }

  sync() {
    this.pos.x = this.body.cx;
    this.pos.y = this.body.cy;
  }

  remove() {
    sim.remove(this.body);
    super.remove();
  }

  render(ctx) {
    // _draw translated to pos, and the body draws in board units.
    ctx.translate(-this.pos.x, -this.pos.y);
    paint(ctx, this.body, this.tones, this.size);
  }
}

function offBoard(size) {
  const m = size + 24;
  const u = Math.random() * 1024;
  switch (Math.floor(Math.random() * 4)) {
    case 0:
      return { x: -m, y: u };
    case 1:
      return { x: 1024 + m, y: u };
    case 2:
      return { x: u, y: -m };
    default:
      return { x: u, y: 1024 + m };
  }
}

class Enemy extends Blob {
  constructor() {
    const size = 16 + Math.random() * 30;
    const at = offBoard(size);
    super(size, at.x, at.y);
    this.tads = 0;

    this.speedSize = SPEED_SIZE * ramp();
    const chase = Math.random();
    this.turn = TURN_WIDE + (TURN_TIGHT - TURN_WIDE) * chase;
    this.tones = PINK_TONES.map((c, i) =>
      color(c).mix(color(RED_TONES[i]), chase).hex
    );

    const top = this.speedSize / size;
    const dx = 512 - at.x;
    const dy = 512 - at.y;
    const d = Math.hypot(dx, dy) || 1;
    sim.pushBody(this.body, dx / d * top, dy / d * top);
  }

  update() {
    this.sync();

    const player = ent.one(Player);
    if (player === null) return;

    // Exact over the frame, so the turn radius does not move with frame rate.
    const b = this.body;
    const top = this.speedSize / this.size;
    const dx = player.pos.x - this.pos.x;
    const dy = player.pos.y - this.pos.y;
    const d = Math.hypot(dx, dy);
    if (d > 0) {
      const k = 1 - Math.exp(-top / this.turn * ent.game.time);
      sim.pushBody(b, (dx / d * top - b.mvx) * k, (dy / d * top - b.mvy) * k);
    }

    // The trunc is the threshold: a step's worth has to reach 1.
    const gap = d - this.size - player.size;
    const ads = Math.trunc((this.size + player.size) * 2 / (gap + 0.2));
    if (ads > 0) this.tads += ads * 60 * ent.game.time;
    else this.cash();

    if (gap > 0 && gap < this.size + player.size) {
      const k = 54000 * this.size / (gap + this.size);
      dent(this.body, player.pos.x, player.pos.y, k);
      dent(player.body, this.pos.x, this.pos.y, k);
    }

    const s = 200;
    if (
      this.pos.x < -s || this.pos.y < -s ||
      this.pos.x > 1024 + s || this.pos.y > 1024 + s
    ) {
      this.cash();
      this.remove();
      return;
    }

    if (d < this.size + player.size) {
      // Read before remove(): the body is gone by the time the splat is made.
      const s = this.size;
      this.cash();
      player.chit(s);
      this.remove();
      new Splat(this.tones[1], this.pos, 560 + this.speed / 4, 24, s * CLEAN_BACK);
      return;
    }

    for (const e of ent.get(Enemy)) {
      if (e === this || e.dead) continue;
      if (
        Math.hypot(this.pos.x - e.pos.x, this.pos.y - e.pos.y) > this.size + e.size
      ) continue;

      if (this.size > e.size) {
        new Splat(e.tones[1], e.pos, 470 + e.speed / 3, 18, e.size * CLEAN_BACK);
        this.size -= e.size;
        this.tads += e.tads;
        e.remove();
      } else {
        new Splat(
          this.tones[1],
          this.pos,
          470 + this.speed / 3,
          18,
          this.size * CLEAN_BACK,
        );
        e.size -= this.size;
        e.tads += this.tads;
        this.remove();
        return;
      }
    }
  }

  cash() {
    const n = Math.round(this.tads);
    this.tads = 0;
    if (n > 0) ent.addScore(n, this.pos.x, this.pos.y);
  }
}

// Top speed times size: one 31 across runs 240 a second.
const SPEED_SIZE = 240 * 31;

// The radius an enemy turns on at its own top speed, not a rate.
const TURN_TIGHT = 40;
const TURN_WIDE = 300;

const FOLLOW = 26;

class Player extends Blob {
  constructor() {
    super(53, 512, 512);
    // The last place over the board the pointer was; it can start off it.
    this.aim = { x: 512, y: 512 };
  }

  get tones() {
    return GOLD_TONES;
  }

  update() {
    this.sync();
    const b = this.body;
    const { x, y } = ent.game.input;
    if (x >= 0 && x <= 1024 && y >= 0 && y <= 1024) {
      this.aim.x = x;
      this.aim.y = y;
    }
    sim.pushBody(
      b,
      (this.aim.x - b.cx) * FOLLOW - b.mvx,
      (this.aim.y - b.cy) * FOLLOW - b.mvy,
    );
    // How hard the ring pulls out of round; the deform flattens off above 4.
    stretch(b, 2.5);
  }

  chit(s) {
    // shake() reads its size off the duration.
    shake(0.18 + 0.22 * Math.min(1, s / 47));
    const left = this.size - s;
    if (left > MIN_SIZE) {
      this.size = left;
      return;
    }
    // one.js runs the camera whether or not a round is playing.
    shake(0.7);
    new Splat(GOLD_TONES[1], this.pos, 980 + this.speed / 4, 60, 0, true);
    this.remove();
    gameOver({ score: true });
  }
}

// `at` writes the impulse for ring point (rx, ry) into `imp`, and the mean is
// taken back out, so the ring changes shape and the body keeps its velocity.
const imp = { x: 0, y: 0 };

function deform(b, at) {
  const { px, py, vx, vy } = sim;
  const s = b.start;
  const n = b.count;
  let mx = 0;
  let my = 0;
  for (let i = s; i < s + n; i++) {
    at(px[i] - b.cx, py[i] - b.cy);
    vx[i] += imp.x;
    vy[i] += imp.y;
    mx += imp.x;
    my += imp.y;
  }
  mx /= n;
  my /= n;
  for (let i = s; i < s + n; i++) {
    vx[i] -= mx;
    vy[i] -= my;
  }
}

function stretch(b, rate) {
  const sp = Math.hypot(b.mvx, b.mvy);
  const rad = b.restRadius * b.scale;
  if (sp < 1 || rad < 1) return;
  const ux = b.mvx / sp;
  const uy = b.mvy / sp;
  const k = rate * sp / rad * ent.game.time;
  deform(b, (rx, ry) => {
    const along = rx * ux + ry * uy;
    imp.x = (along * ux - 0.5 * (rx - along * ux)) * k;
    imp.y = (along * uy - 0.5 * (ry - along * uy)) * k;
  });
}

// Falls off as 1/d², so only the near arc moves; the d³ is that over (dx, dy).
function dent(b, ox, oy, rate) {
  const k = rate * ent.game.time;
  deform(b, (rx, ry) => {
    const dx = ox - b.cx - rx;
    const dy = oy - b.cy - ry;
    const d = Math.hypot(dx, dy) || 1;
    const w = k / (d * d * d);
    imp.x = dx * w;
    imp.y = dy * w;
  });
}

// `screen` keeps the score out of the shake.
class Score extends ent.Text {
  static screen = true;

  update() {
    this.text = String(Math.floor(score.value));
  }
}

function spec(ctx, b, path, L, along, across, sl, sa, alpha) {
  const { cx, cy } = b;
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

function paint(ctx, b, tones, outer) {
  const path = sim.outline(b);

  const ldx = LIGHT_X - b.cx;
  const ldy = LIGHT_Y - b.cy;
  const llen = Math.hypot(ldx, ldy) || 1;
  const L = { x: ldx / llen, y: ldy / llen, a: Math.atan2(ldy, ldx) };

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

  const edge = Math.max(5, outer * 0.07);
  const drop = outer * 0.12;
  const blur = outer * 0.16;

  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // `blur` is in device pixels, and the steps below are board units.
  const spread = blur / op.screen.scale;
  const dropX = b.cx - L.x * drop;
  const dropY = b.cy - L.y * drop;
  ctx.fillStyle = "rgba(120, 80, 40, 0.055)";
  for (let i = SHADOW_STEPS - 1; i >= 0; i--) {
    const grow = 1.04 + spread * i / (SHADOW_STEPS - 1) / outer;
    ctx.save();
    ctx.translate(dropX, dropY);
    ctx.scale(grow, grow);
    ctx.translate(-b.cx, -b.cy);
    ctx.fill(path);
    ctx.restore();
  }

  ctx.save();
  ctx.clip(path);

  const far = llen - lo + rad; // lamp to the blob's far edge, along the axis
  const steps = [0, Math.max(3.5, 0.020 * span), 0.28 * span];
  for (let i = 0; i < steps.length; i++) {
    const k = Math.max(0, 1 - steps[i] / far);
    ctx.save();
    ctx.translate(LIGHT_X, LIGHT_Y);
    ctx.scale(k, k);
    ctx.translate(-LIGHT_X, -LIGHT_Y);
    ctx.fillStyle = tones[i];
    ctx.fill(path);
    ctx.restore();
  }

  spec(ctx, b, path, L, reach * 0.52, across * 0.22, 0.34, 0.40, 0.85);

  // Inside the clip, so the rim is the lit half of a stroke, not a ring.
  ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
  ctx.lineWidth = edge;
  ctx.stroke(path);
  ctx.restore();
}

// A drop travels v0 / SPLAT_DRAG before it stops.
const SPLAT_DRAG = 6;
const SPLAT_LIFE = 14;
// What a whole stain gives back, as a share of the blob that left it.
const CLEAN_BACK = 0.2;
// A drop that stays under the player clears in 1 / CLEAN_RATE seconds.
const CLEAN_RATE = 3.6;
const HOT_STEPS = 8;

class Splat extends ent.Entity {
  static layer = 0;

  constructor(tone, pos, speed, count, worth = 0, settled = false) {
    super();
    this.worth = worth;
    this.drops = [];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * 2 * Math.PI;
      const v = speed * (0.12 + Math.random() ** 2 * 1.5);
      const r = 3.5 + Math.random() ** 3 * 24.5;
      const sa = Math.random() * 2 * Math.PI;
      this.drops.push({
        x: pos.x,
        y: pos.y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        r,
        sr: r * (0.45 + Math.random() * 0.3),
        sx: Math.cos(sa) * r * 0.75,
        sy: Math.sin(sa) * r * 0.75,
      });
    }
    let area = 0;
    for (const d of this.drops) area += d.r * d.r;
    for (const d of this.drops) {
      d.left = 1;
      d.hot = 0;
      d.worth = worth * d.r * d.r / area;
      // The satellite's far edge, not the disc's.
      d.reach = Math.max(d.r, Math.hypot(d.sx, d.sy) + d.sr);
    }

    this.hotRamp = [];
    for (let i = 0; i <= HOT_STEPS; i++) {
      this.hotRamp.push(
        color(tone).mix(color(GOLD_TONES[1]), i / HOT_STEPS).hex,
      );
    }

    // gameOver() stops update(), so the last splat is laid down landed.
    if (!settled) return;
    for (const d of this.drops) {
      d.x += d.vx / SPLAT_DRAG;
      d.y += d.vy / SPLAT_DRAG;
      d.vx = d.vy = 0;
    }
  }

  update() {
    const k = Math.exp(-SPLAT_DRAG * ent.game.time);
    const cool = ent.game.time / 0.35;
    // Cooling before clean(), so a drop wiped this frame is hot next frame.
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.x += d.vx * ent.game.time;
      d.y += d.vy * ent.game.time;
      d.vx *= k;
      d.vy *= k;
      d.hot = Math.max(0, d.hot - cool);
      if (d.left <= 0 && d.hot <= 0) this.drops.splice(i, 1);
    }
    this.clean();
    if (this.drops.length === 0 || this.age > SPLAT_LIFE) this.remove();
  }

  // Overlap and not the centre: a blob at MIN_SIZE fits inside a big drop.
  clean() {
    if (this.worth === 0) return;
    const player = ent.one(Player);
    if (player === null) return;

    const wipe = CLEAN_RATE * ent.game.time;
    let gain = 0;
    for (const d of this.drops) {
      if (d.left <= 0) continue;
      const dist = Math.hypot(d.x - player.pos.x, d.y - player.pos.y);
      if (dist > player.size + d.reach) continue;
      const off = Math.min(d.left, wipe);
      d.left -= off;
      gain += d.worth * off;
      d.hot = 1;
    }
    if (gain > 0) player.size += gain;
  }

  // The drops carry board positions, so there is nothing to undo here.
  render(ctx) {
    const u = Math.min(1, this.age / SPLAT_LIFE);
    const alpha = 0.72 * (1 - u * u);
    for (const d of this.drops) {
      ctx.globalAlpha = alpha * Math.max(d.left, d.hot);
      ctx.fillStyle = this.hotRamp[Math.round(d.hot * HOT_STEPS)];
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, 2 * Math.PI);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(d.x + d.sx, d.y + d.sy, d.sr, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

function step(dt) {
  sim.measure();
  sim.repair(dt);
  // Last before the substeps, so a dent this frame is solved this step.
  ent.update(dt);
  sim.step(dt);
}

export function init() {
  sim.clear();
  ent.reset([Splat, Enemy, Player]);

  new Player();
  new Score({
    x: 40,
    y: 40,
    size: 54,
    align: "left top",
    color: ent.hex(theme(meta)),
  });
  ent.every(1.5, () => {
    new Enemy();
  });
  sim.measure();
}

export function update(dt) {
  // A longer frame is solved short, or a step carries a blob past its radius.
  dt = Math.min(dt, 1 / 30);
  // The constraints are projections, so stiffness over a second is the substep
  // count times the steps in it; 480 a second holds it at any frame length.
  sim.substeps = Math.max(2, Math.min(24, Math.round(dt * 480)));
  step(dt);
}
