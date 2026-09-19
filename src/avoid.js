/*
 * avoid. Based on Aba Games' Satellite Catch.
 *
 * Every blob is a soft body in alma's solver, in free space: no field, no
 * gravity, no solver drag. The solver owns the positions, so `pos` is copied
 * off the centroid and `vel` stays at zero; `size` is a getter over the body's
 * scale, and setScale() relaxes the ring into a new size over the next
 * substeps, which is the squash. Every number here is a rate a second, and
 * update() sizes the substep off the frame rather than counting a fixed eight,
 * so the jelly is the same at 60Hz and at 144.
 *
 * An enemy is two flat draws. `chase` sets the radius it turns on and its
 * colour together: red turns inside the player's own size, pink on near a
 * third of the board. Size is the other, and speed times size is one constant
 * times ramp(), so the small ones are the fast ones. Its velocity relaxes
 * toward top speed straight at the player, and nothing else steers it.
 *
 * Size never comes back on its own: motes are off, and the way back up is
 * wiping a stain off the board before it fades.
 *
 * A blob is painted the way blob.js paints one: a short shadow, three flat
 * tones scaled toward a lamp off the top left, one broad specular, and a white
 * rim stroked inside the clip. Nothing here is a gradient.
 */

import color from "./alma/src/color.js";
import { SoftBodies } from "./alma/src/softbody.js";
import * as ent from "./lib/entity.js";
import { gameOver, op, ramp, score } from "./lib/one.js";
import { shake } from "./lib/camera.js";
import { theme } from "./lib/overlay.js";

export { render } from "./lib/entity.js";

export const meta = {
  title: "avoid",
  desc: `
graze the red to score
touching it costs you size
`,
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

// Three flat tones a blob, lit to dark. The two ends an enemy is drawn
// between: red turns, pink runs.
const GOLD_SKIN = ["#ffe27a", "#ffc21e", "#d18c00"];
const PINK_SKIN = ["#ff96bd", "#ff3d7f", "#c40d4e"];
const RED_SKIN = ["#ff8a72", "#ee2a18", "#9e0d06"];

const PLAYER_SPLAT = "#ffc21e";

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

// Four fills at 0.055 compound to 0.20 at the core; blob's eight sit on cream
// as a grey ring.
const SHADOW_STEPS = 4;

// The body is built here and not in begin(): core.js draws an entity from the
// frame it is constructed.
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
    paint(ctx, this.body, this.skin, this.size);
  }
}

// Off one of the four edges by its own size and a margin, which stays well
// inside the 200 the out-of-bounds check allows.
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
    const size = SIZE_MIN + Math.random() * (SIZE_MAX - SIZE_MIN);
    const at = offBoard(size);
    super(size, at.x, at.y);
    this.tads = 0;

    // Fixed at birth, so one born later is faster than one the same size born
    // at the start, and one that loses size in a collision runs faster for it.
    this.speedSize = SPEED_SIZE * ramp();
    const chase = Math.random();
    this.turn = TURN_WIDE + (TURN_TIGHT - TURN_WIDE) * chase;
    this.skin = PINK_SKIN.map((c, i) => color(c).mix(color(RED_SKIN[i]), chase).hex);

    // Already up to speed: a wide turner would spend its first seconds
    // gathering it off the board, where nobody can see it happen.
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

    // The whole of the motion. Exact over the frame, so the speed it holds and
    // the radius it turns on do not move with the frame rate, and the mean
    // only, so the wobble the ring carries rides through it.
    const b = this.body;
    const top = this.speedSize / this.size;
    const dx = player.pos.x - this.pos.x;
    const dy = player.pos.y - this.pos.y;
    const d = Math.hypot(dx, dy);
    if (d > 0) {
      const k = 1 - Math.exp(-top / this.turn * ent.game.time);
      sim.pushBody(b, (dx / d * top - b.mvx) * k, (dy / d * top - b.mvy) * k);
    }

    // Points accrue while close without touching, so a near miss scores. The
    // trunc is the threshold: a step's worth has to reach 1.
    const gap = d - this.size - player.size;
    const ads = Math.trunc((this.size + player.size) * 2 / (gap + 0.2));
    if (ads > 0) this.tads += ads * 60 * ent.game.time;
    else this.cash();

    // Both rings dent where they face each other, and neither body moves.
    if (gap > 0 && gap < this.size + player.size) {
      const k = DENT * this.size / (gap + this.size);
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
      new Splat(this.skin[1], this.pos, 560 + this.speed / 4, 24, s * CLEAN_BACK);
      return;
    }

    // The bigger of two that touch takes the smaller's points and its size.
    for (const e of ent.get(Enemy)) {
      if (e === this || e.dead) continue;
      if (
        Math.hypot(this.pos.x - e.pos.x, this.pos.y - e.pos.y) > this.size + e.size
      ) continue;

      if (this.size > e.size) {
        new Splat(e.skin[1], e.pos, 470 + e.speed / 3, 18, e.size * CLEAN_BACK);
        this.size -= e.size;
        this.tads += e.tads;
        e.remove();
      } else {
        new Splat(
          this.skin[1],
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

// What it costs to touch one, and through SPEED_SIZE how fast it comes at you.
const SIZE_MIN = 16;
const SIZE_MAX = 46;

// Top speed times size, at ramp() 1: a 31 across runs 240 a second, so the
// range is 162 to 465 at the start of a round and 330 to 949 three minutes in.
const SPEED_SIZE = 240 * 31;

// The radius an enemy turns on at its own top speed. Radii and not rates: a
// fast enemy is given whatever rate holds the radius.
const TURN_TIGHT = 40;
const TURN_WIDE = 300;

// How hard a pass pulls the two rings toward each other.
const DENT = 54000;

// Tight enough that the blob is under the pointer at a graze distance.
const FOLLOW = 26;

// How hard the player's ring pulls out of round while it moves. The deform
// flattens off above about 4.
const STRETCH = 2.5;

// Motes cross the board on one heading a round, slowly enough that reaching
// one is a place the player chose to be.
const MOTE_R = 9;
const MOTE_GAIN = 5;
const MOTE_SPEED = 40;
// const MOTE_EVERY = 2;

let drift = { x: 1, y: 0 };

class Mote extends ent.Entity {
  static layer = 1; // over the splats on the board, under the blobs

  constructor() {
    super();
    // Which of the two upwind edges is picked in proportion to how square-on
    // the heading is to each, so a diagonal feeds both evenly. A fixed
    // distance from the middle instead spawns a diagonal inside the board.
    const m = MOTE_R * 2 + 6;
    const ax = Math.abs(drift.x);
    const ay = Math.abs(drift.y);
    if (Math.random() * (ax + ay) < ax) {
      this.pos.x = drift.x > 0 ? -m : 1024 + m;
      this.pos.y = Math.random() * 1024;
    } else {
      this.pos.x = Math.random() * 1024;
      this.pos.y = drift.y > 0 ? -m : 1024 + m;
    }
    this.vel.x = drift.x * MOTE_SPEED;
    this.vel.y = drift.y * MOTE_SPEED;
    this.r = MOTE_R * (0.75 + Math.random() * 0.5);
  }

  update() {
    const player = ent.one(Player);
    if (player !== null) {
      const d = Math.hypot(
        player.pos.x - this.pos.x,
        player.pos.y - this.pos.y,
      );
      if (d < player.size + this.r) {
        player.size += MOTE_GAIN;
        this.remove();
        return;
      }
    }
    const s = 220;
    if (
      this.pos.x < -s || this.pos.y < -s ||
      this.pos.x > 1024 + s || this.pos.y > 1024 + s
    ) this.remove();
  }

  render(ctx) {
    ctx.fillStyle = GOLD_SKIN[1];
    ctx.beginPath();
    ctx.arc(0, 0, this.r, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx.beginPath();
    ctx.arc(-this.r * 0.3, -this.r * 0.34, this.r * 0.32, 0, 2 * Math.PI);
    ctx.fill();
  }
}

class Player extends Blob {
  constructor() {
    super(53, 512, 512);
    // The last place over the board the pointer was, since it starts wherever
    // the cursor happens to be and that is often off the board entirely.
    this.aim = { x: 512, y: 512 };
  }

  get skin() {
    return GOLD_SKIN;
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
    stretch(b, STRETCH);
  }

  chit(s) {
    // shake() reads its size off the duration, so the biggest enemy on the
    // board hits about twice as hard as the smallest.
    shake(0.18 + 0.22 * Math.min(1, s / 47));
    const left = this.size - s;
    if (left > MIN_SIZE) {
      this.size = left;
      return;
    }
    // one.js runs the camera whether or not a round is playing, so this plays
    // out under the finish screen rather than being cut off by it.
    shake(0.7);
    new Splat(PLAYER_SPLAT, this.pos, 980 + this.speed / 4, 60, 0, true);
    this.remove();
    gameOver({ score: true });
  }
}

// Out along the way it is going and in across it. Scaled by speed over radius,
// so it is the same shape at any size, and the mean is taken back out, so it
// costs the body no momentum.
function stretch(b, rate) {
  const sp = Math.hypot(b.mvx, b.mvy);
  const rad = b.restRadius * b.scale;
  if (sp < 1 || rad < 1) return;
  const ux = b.mvx / sp;
  const uy = b.mvy / sp;
  const k = rate * sp / rad * ent.game.time;
  const { px, py, vx, vy } = sim;
  const s = b.start;
  const n = b.count;
  let mx = 0;
  let my = 0;
  for (let i = s; i < s + n; i++) {
    const rx = px[i] - b.cx;
    const ry = py[i] - b.cy;
    const along = rx * ux + ry * uy;
    const ax = (along * ux - 0.5 * (rx - along * ux)) * k;
    const ay = (along * uy - 0.5 * (ry - along * uy)) * k;
    vx[i] += ax;
    vy[i] += ay;
    mx += ax;
    my += ay;
  }
  mx /= n;
  my /= n;
  for (let i = s; i < s + n; i++) {
    vx[i] -= mx;
    vy[i] -= my;
  }
}

// ent.Text cannot be retexted, so the running number is its own entity. Left
// out of reset()'s list, so it keeps the default layer of 10 and draws over
// everything there.
const SCORE_SIZE = 54;
const SCORE_INSET = 40;

class Score extends ent.Entity {
  static screen = true;

  render(ctx) {
    ctx.fillStyle = theme(meta);
    ctx.text(`${Math.floor(score.value)}`, SCORE_INSET, SCORE_INSET, SCORE_SIZE, {
      align: "left",
      valign: "top",
    });
  }
}

// The facing arc pulls in and the mean is taken back out, so the ring dents
// and the body stays on the course it was on.
function dent(b, ox, oy, rate) {
  const k = rate * ent.game.time;
  const { px, py, vx, vy } = sim;
  const s = b.start;
  const n = b.count;
  let mx = 0;
  let my = 0;
  for (let i = s; i < s + n; i++) {
    const dx = ox - px[i];
    const dy = oy - py[i];
    const d = Math.hypot(dx, dy) || 1;
    const w = k / (d * d); // falls off fast, so only the near arc moves
    const ax = dx * w / d;
    const ay = dy * w / d;
    vx[i] += ax;
    vy[i] += ay;
    mx += ax;
    my += ay;
  }
  mx /= n;
  my /= n;
  for (let i = s; i < s + n; i++) {
    vx[i] -= mx;
    vy[i] -= my;
  }
}

// The body path scaled about the centroid, offset onto the lit face.
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

function paint(ctx, b, skin, outer) {
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

  // Darkest first, scaled toward the lamp, so the sides narrow with distance.
  const far = llen - lo + rad; // lamp to the blob's far edge, along the axis
  const steps = [0, Math.max(3.5, 0.020 * span), 0.28 * span];
  for (let i = 0; i < steps.length; i++) {
    const k = Math.max(0, 1 - steps[i] / far);
    ctx.save();
    ctx.translate(LIGHT_X, LIGHT_Y);
    ctx.scale(k, k);
    ctx.translate(-LIGHT_X, -LIGHT_Y);
    ctx.fillStyle = skin[i];
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

// The mark left behind and not confetti: a drop keeps its colour where it
// stops and the whole splat fades together, well after the last one has
// landed. Its own class and not ent.Particle, whose alpha is the same number
// that slows a particle. A drop travels v0 / SPLAT_DRAG before it stops, so
// the speeds a splat is given read as how far it throws.
const SPLAT_DRAG = 6;
// Cubed, so the draw sits near the small end and a big drop is the exception.
const DROP_MIN = 3.5;
const DROP_MAX = 28;
// Under 1 so drops compound where they overlap: a dark pile, a light edge.
const SPLAT_ALPHA = 0.72;
// 1 - u^2, near full for the first third: bold, then gone quickly.
const SPLAT_LIFE = 14;
// What a whole stain gives back, as a share of the blob that left it.
const CLEAN_BACK = 0.2;
// A drop that stays under the player clears in 1 / CLEAN_RATE seconds.
const CLEAN_RATE = 3.6;
// A wiped drop goes gold and falls back over this, holding its alpha up while
// it does, so what the player took in comes out from behind the blob.
const CLEAN_FLASH = 0.35;
// Held as strings, so a drop costs no colour arithmetic a frame.
const HOT_STEPS = 8;

class Splat extends ent.Entity {
  static layer = 0; // under the blobs: it is on the board, not in the air

  constructor(tone, pos, speed, count, worth = 0, settled = false) {
    super();
    this.worth = worth;
    this.drops = [];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * 2 * Math.PI;
      // Squared, so most drops stay near the break and a few carry.
      const v = speed * (0.12 + Math.random() ** 2 * 1.5);
      const r = DROP_MIN + Math.random() ** 3 * (DROP_MAX - DROP_MIN);
      const sa = Math.random() * 2 * Math.PI;
      this.drops.push({
        x: pos.x,
        y: pos.y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        r,
        // Two overlapping circles read as one torn edge, a dot does not.
        sr: r * (0.45 + Math.random() * 0.3),
        sx: Math.cos(sa) * r * 0.75,
        sy: Math.sin(sa) * r * 0.75,
      });
    }
    // The share is by area, so a stain is worth the same whatever the draw
    // gave it.
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
        color(tone).mix(color(GOLD_SKIN[1]), i / HOT_STEPS).hex,
      );
    }

    // gameOver() stops update(), so the round's last splat is laid down
    // already landed.
    if (!settled) return;
    for (const d of this.drops) {
      d.x += d.vx / SPLAT_DRAG;
      d.y += d.vy / SPLAT_DRAG;
      d.vx = d.vy = 0;
    }
  }

  update() {
    const k = Math.exp(-SPLAT_DRAG * ent.game.time);
    const cool = ent.game.time / CLEAN_FLASH;
    // Cooling before clean(), so a drop wiped this frame is hot going into the
    // next.
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

  // Overlap and not the drop's centre under the blob: a blob worn to MIN_SIZE
  // fits inside a big drop without reaching its middle.
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
    const alpha = SPLAT_ALPHA * (1 - u * u);
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

// The solver's constraints are projections, so their stiffness over a second
// is the substep count times the steps in it. Sizing the substep rather than
// counting it holds that still at any frame length.
const SUBSTEP = 1 / 480;

// A longer frame is solved short rather than whole, or one step carries a blob
// further than its own radius, through everything it should have hit.
const MAX_DT = 1 / 30;

function step(dt) {
  sim.measure();
  sim.repair(dt);
  // Last before the substeps, so a dent this frame is solved this step.
  ent.update(dt);
  sim.step(dt);
}

export function init() {
  sim.clear();
  const a = Math.random() * 2 * Math.PI;
  drift = { x: Math.cos(a), y: Math.sin(a) };
  ent.reset([Splat, Mote, Enemy, Player]);

  new Player();
  new Score();
  ent.every(1.5, () => {
    new Enemy();
  });
  // Motes are off: cleaning a stain is the only way size comes back.
  // ent.every(MOTE_EVERY, () => {
  //   new Mote();
  // });
  sim.measure();
}

export function update(dt) {
  dt = Math.min(dt, MAX_DT);
  sim.substeps = Math.max(2, Math.min(24, Math.round(dt / SUBSTEP)));
  step(dt);
}
