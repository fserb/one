/*
 * cable - "Tin Can Internet". Ludum Dare 30, August 2014.
 *
 * The cable is also the cost: drag grows with the square of the last free
 * stretch, so the far side of an empty gap is the slowest place in the level.
 *
 * The wrap is two tangent points on a circle. The free stretch starts at the
 * silhouette edge of the planet it last caught on, recomputed every frame, so
 * the anchor slides around the edge as you circle. A signed angle accumulates
 * as it slides, starting a quarter turn positive, and the wrap releases the
 * moment that total goes negative.
 *
 * The fixed parts are drawn by hand rather than as entities: everything that is
 * an entity here is in the world, in absolute coordinates the camera never
 * writes back. The cable tests as a segment against a planet's circle, since a
 * hit shape does not turn with `angle`.
 */

import * as ent from "./lib/entity.js";
import { delay, flash } from "./lib/effects.js";
import { shake } from "./lib/camera.js";
import { gameOver, msg, score } from "./lib/one.js";
import * as play from "./lib/sounds.js";

export const meta = {
  title: "cable",
  desc: `
fly with the arrows or the pointer
loop every planet, then leave the quadrant
`,
  bg: "#83CBC8",
  fg: "#323431",
  scoreMax: true,
  date: "2014-08-24",
  draft: true,
  dpad: true,
};

const WHITE = 0xf8e6c2;
const BLACK = 0x323431;
const CYAN = 0x83cbc8;
const YELLOW = 0xffe0a5;
const DARKYELLOW = 0xe4b455;
const DARKRED = 0xe25458;

// A sigma of 10, and a canvas shadow's sigma is half its blur.
const GLOW = 20;

const LEVELS = [2, 3, 5, 8, 10, 15, 20, 30, 50];

const PGAP = 128;

const PUSH = 2100;
const BUMP = 15000;
// The earth sits far enough below the start that only a badly aimed opening
// reaches it.
const EARTH = 640;

// The planets gauge sits just under the overlay's msg() label, which takes the
// top of the board down to 54.
const PIECES_X = 128;
const PIECES_Y = 117;
const CLOCK_X = 128;
const CLOCK_Y = 970;

let level = 0;
let planets = [];
let linked = 0;
let transition = false;
let player = null;
let tip = null; // the free stretch: the one end still moving
let clock = null;
const cam = { x: 0, y: 0 }; // screen minus world, holding the player centred
let wipe = 0;
let fade = null;
let scale = 1; // world units to device pixels, which is what shadowBlur wants

class Player extends ent.Entity {
  constructor() {
    super();
    this.pos.x = this.pos.y = 512;
    this.gfx.fill(BLACK)
      .circle(0, -9, 17)
      .circle(0, 9, 17)
      .circle(-17, 17, 9)
      .circle(17, 17, 9)
      .circle(0, 0, 17);
    this.hitBox(34, 51);
  }

  update() {
    const { input } = ent.game;

    let mx = 0;
    let my = 0;
    if (input.press.left) mx -= 1;
    if (input.press.right) mx += 1;
    if (input.press.up) my -= 1;
    if (input.press.down) my += 1;
    const l = Math.hypot(mx, my);
    if (l > 0) this.accelerate(mx * PUSH / l, my * PUSH / l);

    this.accelerate(-this.vel.x, -this.vel.y);

    // Quadratic in speed and in how much cable is out.
    // Quadratic in the free stretch over a screen and a half.
    const f = Math.hypot(tip.tp.x, tip.tp.y) / (1024 + 512);
    const k = (-0.00047 - 0.0047 * f * f) * Math.hypot(this.vel.x, this.vel.y);
    this.accelerate(this.vel.x * k, this.vel.y * k);

    this.angle = angleOf(this.vel) + Math.PI / 2;
  }

  bumpOut(c, r) {
    const d = Math.hypot(this.pos.x - c.x, this.pos.y - c.y);
    // Exactly at the centre there is no direction, so it leaves along +x.
    const ux = d === 0 ? 1 : (this.pos.x - c.x) / d;
    const uy = d === 0 ? 0 : (this.pos.y - c.y) / d;
    if (d < r) {
      this.pos.x += ux * (r - d);
      this.pos.y += uy * (r - d);
    }

    this.accelerate(ux * BUMP, uy * BUMP);
    shake(0.2);
    flash(ent.css(WHITE), 0.05);
    play.hit();
  }

  render(ctx) {
    // Glow in one pass and the drawing in another, or a halo lands on top.
    ctx.save();
    ctx.shadowColor = ent.css(WHITE);
    ctx.shadowBlur = GLOW * scale;
    this.gfx.render(ctx);
    ctx.restore();
    this.gfx.render(ctx);
  }
}

// One straight stretch of cable, from `pos` to `pos + tp`. Every one starts as
// the free stretch, from wherever the cable last caught to the player; a wrap
// fixes it and gives the player a new one. They chain back to the earth
// through `prev`, and only the free stretch updates.
class Rope extends ent.Entity {
  constructor(x, y) {
    super();
    this.pos.x = x;
    this.pos.y = y;
    this.live = true;
    this.tp = { x: 0, y: 0 };
    this.root = null;
    this.rootdir = false;
    this.rootpos = null;
    this.roll = Math.PI / 4;
    this.prev = null;
    this.stretch(player.pos);
    tip = this;
  }

  stretch(t) {
    this.tp.x = t.x - this.pos.x;
    this.tp.y = t.y - this.pos.y;
  }

  update() {
    if (!this.live) return;

    if (this.root !== null && !this.slide()) return;
    this.stretch(player.pos);

    for (const p of planets) {
      if (p === this.root) continue;
      if (!crosses(this, p)) continue;
      this.wrap(p);
      return;
    }
  }

  // Move the anchor to the silhouette edge the player sees now, accumulating
  // the angle it moved through. False once it has unwound.
  slide() {
    const [t1, t2] = tangents(this.root, player.pos);
    const was = this.rootpos;
    this.pos = this.rootdir ? t1 : t2;
    this.rootpos = this.pos;

    const a0 = angleOf(sub(was, this.root.pos));
    const a1 = angleOf(sub(this.pos, this.root.pos));
    let step = (a1 - a0 + 2 * Math.PI) % (2 * Math.PI);
    if (!this.rootdir) step = 2 * Math.PI - step;
    if (step > Math.PI) step -= 2 * Math.PI;

    this.roll += step;
    if (this.roll >= 0) return true;
    this.unwrap();
    return false;
  }

  // This stretch stops at the edge and a new one continues to the player.
  wrap(p) {
    const tg = nearTangent(p, this.pos, player.pos);

    const r = new Rope(tg.x, tg.y);
    r.prev = this;
    r.root = p;
    r.rootdir = cross(sub(tg, p.pos), sub(this.pos, p.pos)) <= 0;
    r.rootpos = tg;

    this.live = false;
    this.stretch(tg);

    if (p.link <= 0) p.linktimer = 0;
    p.link += 1;
    p.draw();
    score.value += 1;
    play.power();
    delay(0.01);
  }

  // This stretch and the one that laid it go; the one before is restored.
  unwrap() {
    const q = this.prev;
    const r = new Rope(q.pos.x, q.pos.y);
    r.prev = q.prev;
    r.root = q.root;
    r.rootdir = q.rootdir;
    r.rootpos = q.rootpos;
    r.roll = q.roll;

    this.root.link -= 1;
    this.root.draw();
    score.value -= 1;
    play.deny();

    q.remove();
    this.remove();
  }

  render(ctx) {
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 6;
    ctx.strokeStyle = ent.css(this.live ? BLACK : WHITE);
    if (this.live) {
      ctx.shadowColor = ent.css(WHITE);
      ctx.shadowBlur = GLOW * scale;
    }
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(this.tp.x, this.tp.y);
    ctx.stroke();
  }
}

class Planet extends ent.Entity {
  constructor(x, y, size) {
    super();
    this.pos.x = x;
    this.pos.y = y;
    this.size = size;
    this.link = 0;
    this.linktimer = 0;
    this.hitCircle(size);
    this.draw();
  }

  draw() {
    this.gfx.clear().fill(this.link > 0 ? WHITE : BLACK).circle(0, 0, this.size);
  }

  update() {
    if (this.hit(player)) player.bumpOut(this.pos, this.size);
  }

  render(ctx) {
    ctx.shadowColor = ent.css(this.link > 0 ? WHITE : BLACK);
    ctx.shadowBlur = GLOW * scale;
    this.gfx.render(ctx);
  }
}

class Earth extends ent.Entity {
  constructor() {
    super();
    this.pos.x = 512;
    this.pos.y = 1515;
    this.gfx.fill(WHITE).circle(0, 0, EARTH);
    this.hitCircle(EARTH);
  }

  update() {
    if (this.hit(player)) player.bumpOut(this.pos, EARTH);
  }
}

// The scatter box plus half a screen. Leaving it with every planet linked ends
// the level.
class Zone extends ent.Entity {
  constructor(dimx, dimy) {
    super();
    this.w = dimx * 1024 + 512;
    this.h = dimy * 1024 + 512;
    this.pos.x = 512;
    this.pos.y = 256 - this.h / 2;
    this.hitBox(this.w, this.h);
  }

  update() {
    if (transition) return;
    if (this.hit(player)) return;
    if (linked < planets.length) return;
    play.win();
    nextLevel();
  }

  render(ctx) {
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = ent.css(BLACK);
    ctx.lineWidth = 8;
    ctx.setLineDash([21, 21]);
    ctx.strokeRect(-this.w / 2, -this.h / 2, this.w, this.h);
  }
}

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// The negative of the usual convention, which is what the wrap angle is signed
// against.
const cross = (a, b) => b.y * a.x - b.x * a.y;

// [0, 2pi), and zero for the zero vector.
function angleOf(v) {
  if (v.x === 0 && v.y === 0) return 0;
  return (2 * Math.PI + Math.atan2(v.y, v.x)) % (2 * Math.PI);
}

// Not true tangents: two units inside the edge, on the diameter square to the
// line of sight, where a wrapped cable leaves the circle.
function tangents(p, from) {
  const d = sub(p.pos, from);
  const a = angleOf(d);
  const l = Math.hypot(d.x, d.y);
  const s = p.size - 2;
  const cx = from.x + l * Math.cos(a);
  const cy = from.y + l * Math.sin(a);
  const nx = s * Math.sin(a);
  const ny = s * Math.cos(a);
  return [{ x: cx - nx, y: cy + ny }, { x: cx + nx, y: cy - ny }];
}

// Of the two seen from `from`, the one nearer `to`.
function nearTangent(p, from, to) {
  const [t1, t2] = tangents(p, from);
  const d1 = Math.hypot(t1.x - to.x, t1.y - to.y);
  const d2 = Math.hypot(t2.x - to.x, t2.y - to.y);
  return d1 <= d2 ? t1 : t2;
}

// The segment's nearest point to the centre, just inside the edge.
function crosses(rope, p) {
  const dx = rope.tp.x;
  const dy = rope.tp.y;
  const l2 = dx * dx + dy * dy;
  const ox = p.pos.x - rope.pos.x;
  const oy = p.pos.y - rope.pos.y;
  const t = l2 === 0 ? 0 : clamp((ox * dx + oy * dy) / l2, 0, 1);
  const nx = ox - t * dx;
  const ny = oy - t * dy;
  const r = p.size + 3; // the cable is 6 across, so it catches 3 out
  return nx * nx + ny * ny <= r * r;
}

const cubicIn = (t) => t * t * t;
const cubicOut = (t) => (t - 1) * (t - 1) * (t - 1) + 1;
// It overshoots, which is the pop the link bar makes.
const elasticOut = (t) => Math.sin(-13 * (t + 1) * Math.PI / 2) * 2 ** (-10 * t) + 1;

// Five to a screen, PGAP apart. It gives up after ten tries a planet, so a
// level can come out with fewer than it asked for.
function buildPlanets(total) {
  const dim = Math.ceil(total / 5);
  const dimx = Math.ceil(Math.sqrt(dim));
  const dimy = Math.ceil(dim / dimx);

  let n = 0;
  let skipped = 0;
  while (n < total && skipped < 10 * total) {
    const x = 512 - dimx * 512 + dimx * 1024 * Math.random();
    const y = -1024 * dimy + 1024 * dimy * Math.random();
    const s = 64 + 43 * Math.random();

    const near = planets.some((p) =>
      Math.hypot(x - p.pos.x, y - p.pos.y) < s + p.size + PGAP
    );
    if (near) {
      skipped += 1;
      continue;
    }

    planets.push(new Planet(x, y, s));
    n += 1;
  }

  new Zone(dimx, dimy);
}

function buildLevel() {
  ent.reset([Zone, Rope, Planet, Earth, Player]);

  planets = [];
  linked = 0;
  transition = false;

  player = new Player();
  new Earth();
  new Rope(512, 1024); // inside the earth, so the cable emerges from under it
  buildPlanets(level < LEVELS.length ? LEVELS[level] : (level - 5) * 17);

  clock = {
    spent: 0,
    // 40s to read the first board; the level after it is 12.1 seconds.
    total: level === 0 ? 40 : 7 + planets.length * 1.7,
    flip: 0,
    warn: false,
  };
  msg(`LEVEL ${level + 1}`);
}

function nextLevel() {
  transition = true;
  fade = { cover: true, t: 0 };
  wipe = 1;
}

export function init() {
  level = 0;
  wipe = 0;
  fade = null;
  buildLevel();
}

export function update(dt) {
  if (wipe > 0) {
    wipe -= dt;
    if (wipe <= 0) {
      level += 1;
      buildLevel();
      fade = { cover: false, t: 0 };
    }
  }

  // The camera moves before the entities do, or it lags them by a frame.
  cam.x = 512 - player.pos.x;
  cam.y = 512 - player.pos.y;

  ent.update(dt);

  // The entities' own timer, so a hitstop pauses the hand-drawn parts too.
  const t = ent.game.time;
  if (fade !== null && (fade.t += t) >= 1.5) fade = null;

  let done = 0;
  for (const p of planets) {
    if (p.link <= 0) continue;
    p.linktimer = Math.min(1, p.linktimer + t);
    if (p.linktimer >= 1) done += 1;
  }
  linked = done;
  // Replaces the level label: the last thing to do is the only thing to say.
  if (level === 0 && linked >= planets.length) {
    msg("now leave the quadrant", { at: "bottom" });
  }

  clock.spent += t;
  clock.warn = false;
  if (clock.spent / clock.total > 0.8) {
    if (clock.flip > 1) {
      clock.warn = true;
      if (clock.flip >= 2) clock.flip -= 2;
    }
    clock.flip += t / 0.1; // the bar flips colour ten times a second
  }
  if (clock.spent >= clock.total && !transition) gameOver({ score: true });
}

export function render(ctx) {
  const m = ctx.getTransform();
  scale = Math.hypot(m.a, m.b);

  ctx.save();
  ctx.translate(cam.x, cam.y);
  ent.render(ctx);
  ctx.restore();

  drawArrows(ctx);
  drawPieces(ctx);
  drawClock(ctx);
  if (fade !== null) {
    const t = Math.min(1, fade.t);
    ctx.globalAlpha = fade.cover ? cubicOut(t) : 1 - cubicIn(t);
    ctx.fillStyle = ent.css(CYAN);
    ctx.fillRect(0, 0, 1024, 1024);
    ctx.globalAlpha = 1;
  }
}

// One per planet still to link and off screen, fading with distance.
function drawArrows(ctx) {
  ctx.fillStyle = ent.css(BLACK);
  for (const p of planets) {
    if (p.link > 0) continue;
    const sx = p.pos.x + cam.x;
    const sy = p.pos.y + cam.y;
    if (sx >= 0 && sy >= 0 && sx < 1024 && sy < 1024) continue;

    const d = Math.hypot(sx - 512, sy - 512) - 512;
    const x = clamp(sx, 21, 1003);
    const y = clamp(sy, 21, 1003);

    ctx.globalAlpha = 1 - clamp(d / 2048, 0, 0.9);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(y - 512, x - 512));
    ctx.beginPath();
    ctx.moveTo(-8, -11);
    ctx.lineTo(8, 0);
    ctx.lineTo(-8, 11);
    ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

// One cell per planet, in scatter order, popping as each is wrapped.
function drawPieces(ctx) {
  const w = 764 / planets.length;
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = ent.css(YELLOW);
  planets.forEach((p, i) => {
    if (p.link <= 0) return;
    const s = Math.trunc(21 * elasticOut(p.linktimer));
    ctx.fillRect(PIECES_X + 4 + i * w, PIECES_Y + 11 - s / 2, w, s);
  });
  ctx.fillRect(PIECES_X, PIECES_Y, 4, 21);
  ctx.fillRect(PIECES_X + 764, PIECES_Y, 4, 21);
  ctx.fillRect(PIECES_X, PIECES_Y + 9, 768, 4);
  ctx.globalAlpha = 1;
}

function drawClock(ctx) {
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = ent.css(BLACK);
  ctx.fillRect(CLOCK_X, CLOCK_Y, 768, 21);
  ctx.globalAlpha = 1;
  ctx.fillStyle = ent.css(clock.warn ? DARKYELLOW : DARKRED);
  ctx.fillRect(CLOCK_X, CLOCK_Y, 768 * Math.min(1, clock.spent / clock.total), 21);
}
