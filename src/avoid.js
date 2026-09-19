/*
 * avoid. Based on Aba Games' Satellite Catch.
 *
 * Every blob is a soft body in alma's solver, in free space: no field, no
 * gravity, and each body damps its own mean velocity, which is what avoid's
 * 0.95 a frame became. `size` is a getter over the body's scale, so the chase
 * and the graze are still written in sizes and distances; setScale() relaxes
 * the ring into the new size over the next substeps rather than moving a
 * point, and that lag is the squash.
 *
 * The solver owns the positions, so `pos` is copied off the centroid at the
 * top of update() and `vel` stays at zero, leaving Entity's integration a
 * no-op.
 *
 * There is no fixed step. Every number here is a rate a second, and update()
 * sizes the solver's substep off the frame instead of counting a fixed eight,
 * so the jelly is the same jelly at 60Hz and at 144.
 *
 * Size never comes back on its own. Under test right now: motes are off, and
 * the only way back up is wiping out a stain, which is worth a quarter of the
 * size of the blob that left it. Recovering is going back over board the player has
 * already been hit on, before the stain fades out from under it.
 *
 * A blob is painted the way blob.js paints one, against a cream board: a
 * short shadow, three flat tones scaled toward a lamp off the top left, one
 * broad specular, and a white rim stroked inside the clip so it lights the
 * near edge rather than ringing the whole shape. Nothing here is a gradient.
 */

import { SoftBodies } from "./alma/src/softbody.js";
import * as ent from "./lib/entity.js";
import { gameOver, op, ramp, score } from "./lib/one.js";
import { shake } from "./lib/camera.js";
import { theme } from "./lib/overlay.js";

// update() is avoid's own, since the solver runs on a fixed step.
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
};

// One ring point's radius at scale 1: how far outside the ring the edge
// reaches. A body's own pr is this times its scale, so the silhouette keeps
// its proportions as the player grows.
const R = 7;

// The player grows without bound and pr grows with it. Past this the point
// radius would outrun the broadphase cell and contacts would be missed.
const MAX_SIZE = 300;
const MIN_SIZE = 2;

// Three flat tones a blob, lit to dark. The rim over them is white for both,
// so a palette is the ramp and nothing else.
const GOLD_SKIN = ["#ffe27a", "#ffc21e", "#d18c00"];
const RED_SKIN = ["#ff96bd", "#ff3d7f", "#c40d4e"];

// What a blob leaves on the board when it breaks. Both blobs are light and
// saturated, so an enemy's mark is near-black instead of its own pink: a pink
// stain on a cream board is a small enemy. The player's stays gold, and it
// lands once, under the finish screen, with nothing left to confuse it with.
const ENEMY_SPLAT = "#4B3B2A";
const PLAYER_SPLAT = "#ffc21e";

const sim = new SoftBodies({
  width: 1024,
  height: 1024,
  radius: R * MAX_SIZE / 53, // the largest pr the player can reach
  field: null, // free space: no pool, no walls
  gravity: { x: 0, y: 0 },
  maxSpeed: 4000,
  drag: 0, // each body damps its own mean instead
  rigidDamp: 6, // blob's 25 is a stiffer jelly than this game wants
  maxPush: R * 0.6, // off R, not off sim.radius, which the player sets
  recoveryMargin: R * 2 / 3,
});

// One unit ring a point count, since sizes repeat across a round.
const rings = new Map();

function ringOf(n) {
  let base = rings.get(n);
  if (base === undefined) rings.set(n, base = SoftBodies.ring(n));
  return base;
}

const LIGHT_X = -220;
const LIGHT_Y = -260;

// Four fills at 0.055 compound to 1 - (1 - a)^4 = 0.20 at the core: the board
// is cream, and blob's eight would sit on it as a grey ring.
const SHADOW_STEPS = 4;

// The body is built here and not in begin(), since core.js draws an entity
// from the frame it is constructed and begin() waits for the next fixed step.
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

  // The centroid is where the game reads its distances from.
  sync() {
    this.pos.x = this.body.cx;
    this.pos.y = this.body.cy;
  }

  // The rigid part of the motion only, so the wobble the ring carries rides
  // through it. A rate and not a fraction a frame, or the drag would be the
  // display's to set.
  damp(rate) {
    const b = this.body;
    const k = 1 - Math.exp(-rate * ent.game.time);
    sim.pushBody(b, -b.mvx * k, -b.mvy * k);
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

// Clear of the board on one of the four edges, by its own size and a margin,
// so nothing is ever born where the player can already see it. The margin
// stays well inside the 200 the out-of-bounds check allows, or an enemy would
// be removed on the frame it spawned.
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
    const size = 15 + Math.random() * 32;
    const at = offBoard(size);
    super(size, at.x, at.y);
    this.tv = 0;
    this.tads = 0;
  }

  get skin() {
    return RED_SKIN;
  }

  update() {
    this.sync();
    this.tv += ent.game.time;

    const player = ent.one(Player);
    if (player === null) return;

    // Towards the player, on ramp() and the size of the two of them.
    const dx = player.pos.x - this.pos.x;
    const dy = player.pos.y - this.pos.y;
    const d = Math.hypot(dx, dy);
    if (d > 0) {
      const k = CHASE * ramp() * this.size *
        Math.min(1, this.tv) * player.size / d;
      sim.pushBody(this.body, dx * k * ent.game.time, dy * k * ent.game.time);
    }
    this.damp(ENEMY_DRAG);

    // Points accrue while close without touching, so a near miss scores. The
    // trunc is the threshold it always was, a step's worth having to reach 1,
    // and what it gates is now spent as a rate rather than a lump a frame.
    const gap = d - this.size - player.size;
    const ads = Math.trunc((this.size + player.size) * 2 / (gap + 0.2));
    if (ads > 0) this.tads += ads * 60 * ent.game.time;
    else this.cash();

    // The pass is what the rings show: both dent where they face each other,
    // and neither body moves for it.
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
      // Read before remove(): chit() can end the round, and the body is gone
      // by the time the splat is made.
      const s = this.size;
      this.cash();
      player.chit(s);
      this.remove();
      new Splat(ENEMY_SPLAT, this.pos, 560 + this.speed / 4, 24, s * CLEAN_BACK);
      return;
    }

    // The bigger of two touching enemies absorbs the smaller and its points.
    for (const e of ent.get(Enemy)) {
      if (e === this || e.dead) continue;
      if (
        Math.hypot(this.pos.x - e.pos.x, this.pos.y - e.pos.y) > this.size + e.size
      ) continue;

      if (this.size > e.size) {
        new Splat(ENEMY_SPLAT, e.pos, 470 + e.speed / 3, 18, e.size * CLEAN_BACK);
        this.size -= e.size;
        this.tads += e.tads;
        e.remove();
      } else {
        new Splat(
          ENEMY_SPLAT,
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

// The pull towards the player at the start of a round, multiplied by ramp().
// It was sqrt(totalTime / 50000), a curve of the game's own that reached six
// times this by three minutes; ramp() reaches 2.04, so the climb is the one
// the rest of the gallery uses and the top of it is far gentler.
//
// Per second, as is everything below it. The numbers the original kept were
// per frame at 60, so each is that one times 60.
const CHASE = 1.2;

// 0.95 a frame at 60 is e^(-3.08 t): the same drag, written so the frame
// length cannot change it.
const ENEMY_DRAG = 3.08;

// How hard a pass pulls the two rings toward each other.
const DENT = 54000;

// Tight enough that the blob is under the pointer at a graze distance, loose
// enough that a turn is an acceleration the ring can show.
const FOLLOW = 26;

// How hard the player's ring pulls out of round while it moves. The deform
// this buys flattens off above about 4, so the useful range is all below it.
const STRETCH = 2.5;

// Size does not come back on its own. It comes back by taking in motes, which
// cross the board on one heading a round, slowly enough that reaching one is a
// place the player chose to be.
const MOTE_R = 9;
const MOTE_GAIN = 5;
const MOTE_SPEED = 40;
// const MOTE_EVERY = 2;

let drift = { x: 1, y: 0 };

class Mote extends ent.Entity {
  static layer = 1; // over the splats on the board, under the blobs

  constructor() {
    super();
    // On the edge it comes in by, just off the board. Which of the two upwind
    // edges is picked in proportion to how square-on the heading is to each,
    // so a diagonal heading feeds both evenly. Placing it a fixed distance
    // from the middle instead puts a diagonal spawn inside the board, since
    // the square reaches 724 from its centre at the corners and only 512 at
    // the sides.
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

  // Flat, with one highlight: a mote is the player's colour, not a creature.
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
    // The pointer reads wherever the cursor happens to be from the first
    // frame, which is often off the board entirely. This is the last place
    // over the board it was, and it opens in the middle.
    this.aim = { x: 512, y: 512 };
  }

  get skin() {
    return GOLD_SKIN;
  }

  update() {
    this.sync();
    const b = this.body;
    // Off the board is not a place to be led to, so the last point over it
    // stands and the blob stays where the game is.
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
    // shake() takes a duration and reads its size off it, so the biggest
    // enemy on the board hits about twice as hard as the smallest.
    shake(0.18 + 0.22 * Math.min(1, s / 47));
    const left = this.size - s;
    if (left > MIN_SIZE) {
      this.size = left;
      return;
    }
    // one.js runs the camera whether or not a round is playing, so this one
    // plays out under the finish screen rather than being cut off by it.
    shake(0.7);
    new Splat(PLAYER_SPLAT, this.pos, 980 + this.speed / 4, 60, 0, true);
    this.remove();
    gameOver({ score: true });
  }
}

// Out along the way it is going and in across it, which is the deform a body
// in motion shows. Scaled by speed over radius, so it is the same shape at any
// size, and the mean is taken back out, so it costs the body no momentum.
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
// everything there, and `screen` puts it over the board rather than in it.
// theme()'s colour is the one the finish screen and msg() use, measured
// against this board.
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

// The facing arc pulls toward the other blob and the mean is taken back out,
// so the ring dents and the body stays on the course it was on.
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

  // `blur` is what shadowBlur was given, in device pixels.
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

  // Inside the clip, so the rim is the lit half of a stroke and not a ring
  // around the blob.
  ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
  ctx.lineWidth = edge;
  ctx.stroke(path);
  ctx.restore();
}

// A burst that fades as it slows is confetti. What this is for is the mark
// left behind, so a drop keeps its colour where it stops and the whole splat
// fades together, well after the last one has landed.
//
// Its own class and not ent.Particle, whose alpha is the same number that
// slows a particle, so a particle there is gone exactly when it lands.
// A drop travels v0 / SPLAT_DRAG before it stops, so the speeds below read
// directly as how far the splat throws.
const SPLAT_DRAG = 6;
// A drop's radius. Cubed, so the draw sits near the small end and the big one
// is the exception rather than the size of a drop. The satellite disc carries
// the shape out past this.
const DROP_MIN = 3.5;
const DROP_MAX = 28;
// Under 1 so the drops compound where they overlap, which is what gives a
// stain a dark pile and a light edge. At 1 the whole splat is one flat tone
// and reads as a hole cut in the board rather than paint lying on it.
const SPLAT_ALPHA = 0.72;
// Bold for most of its life and then gone quickly, rather than a long pale
// tail: it fades the whole time it is there rather than holding and then
// dropping, and 1 - u^2 is still near full for the first third.
const SPLAT_LIFE = 14;
// What a stain gives back if the player wipes the whole of it, as a share of
// the size the blob that left it had.
const CLEAN_BACK = 0.2;
// A drop that stays under the player clears in 1 / CLEAN_RATE seconds.
const CLEAN_RATE = 3.6;
// A drop turns the player's gold while it is being wiped and falls back over
// this long once the blob is off it. A drop wiped away holds its alpha up
// until the gold is gone, so what the player took in comes out from behind the
// blob rather than disappearing under it.
const CLEAN_FLASH = 0.35;
// Steps from the stain's colour to gold, held as strings so a drop being
// cleaned costs no colour arithmetic a frame.
const HOT_STEPS = 8;

// t of the way from a to b, both #rrggbb.
function mix(a, b, t) {
  const x = parseInt(a.slice(1), 16);
  const y = parseInt(b.slice(1), 16);
  const c = (sh) => {
    const u = x >> sh & 255;
    return Math.round(u + ((y >> sh & 255) - u) * t);
  };
  return `rgb(${c(16)}, ${c(8)}, ${c(0)})`;
}

class Splat extends ent.Entity {
  static layer = 0; // under the blobs: it is on the board, not in the air

  constructor(color, pos, speed, count, worth = 0, settled = false) {
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
        // One satellite disc, which is what makes a stain lumpy rather than a
        // dot: two circles that overlap read as one torn edge.
        sr: r * (0.45 + Math.random() * 0.3),
        sx: Math.cos(sa) * r * 0.75,
        sy: Math.sin(sa) * r * 0.75,
      });
    }
    // Each drop keeps how much of itself is left and what that much is worth.
    // The share is by area, so the pile where the blob broke is worth more
    // than the far drops, and a stain is worth the same whatever the draw.
    let area = 0;
    for (const d of this.drops) area += d.r * d.r;
    for (const d of this.drops) {
      d.left = 1;
      d.hot = 0;
      d.worth = worth * d.r * d.r / area;
      // How far the drawn drop goes from its centre, which is the satellite's
      // far edge and not the main disc.
      d.reach = Math.max(d.r, Math.hypot(d.sx, d.sy) + d.sr);
    }

    this.hotRamp = [];
    for (let i = 0; i <= HOT_STEPS; i++) {
      this.hotRamp.push(mix(color, GOLD_SKIN[1], i / HOT_STEPS));
    }

    // gameOver() stops update(), so a splat thrown by the killing hit would
    // stand where it was thrown. v0 / SPLAT_DRAG is exactly where a drop ends
    // up, so the round's last splat is laid down already landed.
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
    // Backwards: a drop with no ink and no gold left is done with. The cooling
    // runs before clean(), so a drop wiped this frame is hot going into the
    // next one.
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

  // A drop the player is over clears, and what clears of it comes back as
  // size. The two overlapping is the test, rather than the drop's centre
  // being under the blob: a blob worn down to MIN_SIZE fits inside a big drop
  // without ever reaching its middle, and cleaning is what a small blob is
  // there to do.
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

  // The drops carry board positions and `pos` stays at the origin, so there
  // is nothing to undo here.
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

// The solver's area and skin constraints are projections, so how stiff they
// are over a second is the substep count times the steps in it. Sizing the
// substep rather than counting it holds that still at any frame length, which
// is the one thing the fixed step was carrying.
const SUBSTEP = 1 / 480;

// A frame longer than this is solved short rather than whole: the alternative
// is one step that carries a blob further than its own radius, through
// everything it should have hit.
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
  // Under test: no motes, so cleaning a stain is the only way size comes back.
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
