/*
 * cable - a port of ~/prj/vault/games/sketch/src/LD30.hx, "Tin Can Internet".
 * Ludum Dare 30, August 2014; the theme was Connected Worlds.
 *
 * You trail a cable out of the earth and the cable stays where you put it.
 * Fly past a planet and the cable catches on it and wraps; fly back the way
 * you came and it unwraps, and the planet is unlinked again. Every planet
 * inside the dashed quadrant has to be wrapped, and then you have to leave the
 * quadrant, before the bar at the bottom fills.
 *
 * The cable is also the cost. Drag on you grows with the square of the length
 * of the last free stretch of it, so the far side of an empty gap is the
 * slowest place in the level, and wrapping a planet is what cuts that stretch
 * back down and gives you your speed back. Planets are solid: running into one
 * throws you off it.
 *
 * The wrap is two tangent points on a rim. The free stretch hangs off the
 * silhouette edge of the planet it last caught on, recomputed from where you
 * are every frame, so the anchor slides around the rim as you circle. A signed
 * angle accumulates as it slides, starting a quarter turn in the black, and
 * the wrap pops the moment that total goes negative. Unwinding is the only way
 * to lose a link, and it costs a point.
 *
 * What changed from the Haxe:
 *
 * - The eight-second cyan title crawl is gone. The shell opens on the running
 *   game, so `Intro` and its `Fader(true, 8)` have nothing to sit on. Four of
 *   its five lines are the two of `meta.desc`; the fifth, "now get out of the
 *   area", stays as a prompt on the first level, which is where it teaches.
 * - Level one's clock was 600 seconds because the crawl ate ten of them and
 *   the level after it is 12. It is FIRST seconds now: long enough to work the
 *   cable out, short enough that the bar visibly moves while you do.
 * - The shell owns the score and game over, so `final()`'s four lines of text
 *   and the `Score` posts are gone. `score.value` carries the wraps.
 * - The link bar moves from y=10 to y=PIECES_Y, clear of the shell's 21-unit
 *   bar, and `Pieces`, `TimerBar`, `PlanetShow`, `Fader` and `Flasher` are
 *   drawn by hand rather than as entities. They are screen furniture, and
 *   everything that is an entity here is in the world instead: ugl added the
 *   camera delta to every entity's `pos` once a frame, and this keeps world
 *   coordinates absolute and translates in render().
 * - A hit shape does not turn with `angle` here, and ugl ran the cable's
 *   3-wide rect through the sprite matrix. The cable tests as a segment
 *   against the planet's circle, which is what that rect stood for.
 * - `effect.glow` was a three-pass box blur of a recoloured copy of the
 *   sprite, drawn under it. That is what a canvas shadow is, so the glow is
 *   `shadowBlur`. ugl's radius is a Gaussian sigma and `shadowBlur` is about
 *   twice one, hence GLOW. ugl also clipped the blur to the sprite's own box;
 *   canvas does not, so the halo reaches a little further than it did.
 * - The quadrant's four dashed `ZoneBar`s are one dashed stroke on the zone
 *   itself, at ZONE_ALPHA rather than 0.1. The crawl used to say where the
 *   quadrant was and 0.1 was a reminder; now the dashes are the only thing
 *   that says it, so they have to be legible.
 * - The pointer flies you as well as the arrows do, towards wherever it is
 *   held. The Haxe was written for a keyboard, and nothing about eight-way
 *   thrust needs one.
 */

import * as ent from "./lib/entity.js";
import { gameOver, msg, score, SIZE } from "./lib/one.js";
import * as sfxr from "./lib/sfxr.js";
import * as sound from "./lib/sound.js";

export const meta = {
  title: "cable",
  desc: `
fly with the arrows or the pointer
loop every planet, then leave the quadrant
`,
  bg: "#83CBC8",
  fg: "#323431",
  scoreMax: true,
  finishGood: false,
  date: "2014-08-24",
};

// The Haxe's palette, less the two it defined and never used.
const WHITE = 0xf8e6c2;
const BLACK = 0x323431;
const CYAN = 0x83cbc8;
const YELLOW = 0xffe0a5;
const DARKYELLOW = 0xe4b455;
const DARKRED = 0xe25458;

// The box the game thinks in, and the strip of it the shell's 44px bar covers.
const W = 480;
const TOP = 21;

// ugl's glow(5) blurred with a sigma of 5; a canvas shadow's sigma is half its
// shadowBlur.
const GLOW = 10;

// How many planets each level asks for, and what it asks for past the end.
const LEVELS = [2, 3, 5, 8, 10, 15, 20, 30, 50];
const EXTRA = 17;

// Seconds on the clock: this much, plus this much per planet.
const BASE = 7;
const PER = 1.7;
// What the first level gets instead. The Haxe's 600 was a tutorial with a
// story crawl over the top of it; a bar that does not move teaches nothing,
// and the level after this one is 12.1 seconds.
const FIRST = 40;
// The last fifth of the clock alternates the bar between two colours, this
// often.
const FLIP = 0.1;

// A planet is this across, plus up to this much again, and no two of them come
// nearer than this to each other.
const PSIZE = 30;
const PVARY = 20;
const PGAP = 60;

// Thrust, and what a planet answers a collision with.
const PUSH = 1000;
const BUMP = 7000;
// The player's box, and the earth's radius. The earth sits far enough below
// the start that only a badly aimed opening reaches it.
const PW = 16;
const PH = 24;
const EARTH = 300;
const EARTHY = 710;

// Where the cable comes out of the earth: inside it, so it emerges from under
// the surface.
const ROOTX = 240;
const ROOTY = 480;
// The cable is 3 across, so it catches a planet one and a half out from its rim.
const HALF = 1.5;
// How far a fresh wrap is from unwinding, in radians of slide.
const SLACK = Math.PI / 4;
// Drag is quadratic in the free stretch over this length.
const REACH = W + W / 2;

// The level wipe: a second of cyan closing, then the next level under a second
// of cyan opening, each fader clearing half a second after it has finished.
const WIPE = 1;
const FADE = 1.5;
// A planet you hit flashes the screen for this long.
const FLASH = 0.05;

// The link bar, the clock, and the quadrant's dashes.
const PIECES_X = 60;
const PIECES_Y = 27;
const CLOCK_X = 60;
const CLOCK_Y = 455;
const ZONE_ALPHA = 0.25;

// ugl's Sound.vol(v) set masterVolume to 2v, and sfxr squares that.
voice("hit", sfxr.explosion(1238), 0.1);
voice("connect", sfxr.powerup(1246), 0.1);
voice("leave", sfxr.hit(1259), 0.1);
voice("done", sfxr.powerup(1274), 0.1);

function voice(name, params, vol) {
  params.masterVolume = 2 * vol;
  sound.put(name, sfxr.render(params), sfxr.SAMPLE_RATE);
}

// The scene, as the Haxe kept it on its Scene.
let level = 0;
let planets = [];
let linked = 0;
let transition = false;
let player = null;
// The free stretch of cable, the one end of it that is still moving.
let tip = null;
let clock = null;
// Screen minus world: what render() translates by to hold the player still.
const cam = { x: 0, y: 0 };
// Seconds until the next level is built, or 0.
let wipe = 0;
let fade = null;
let flash = 0;
// The first level says the one rule two lines of hint cannot carry.
let nudge = false;
// World units to device pixels, which is what shadowBlur is measured in.
let scale = 1;

class Player extends ent.Entity {
  constructor() {
    super();
    this.pos.x = this.pos.y = W / 2;
    this.gfx.fill(BLACK)
      .circle(0, -4, 8)
      .circle(0, 4, 8)
      .circle(-8, 8, 4)
      .circle(8, 8, 4)
      .circle(0, 0, 8);
    this.hitBox(PW, PH);
  }

  update() {
    const { key, mouse } = ent.game;

    let mx = 0;
    let my = 0;
    if (key.left) mx -= 1;
    if (key.right) mx += 1;
    if (key.up) my -= 1;
    if (key.down) my += 1;
    // The camera holds the player at the middle of the screen, so the pointer
    // is a heading without any need to convert it back into the world.
    if (mx === 0 && my === 0 && mouse.press) {
      mx = mouse.x - W / 2;
      my = mouse.y - W / 2;
    }
    const l = Math.hypot(mx, my);
    if (l > 0) this.accelerate(mx * PUSH / l, my * PUSH / l);

    this.accelerate(-this.vel.x, -this.vel.y);

    // The cable's own drag, quadratic in speed and in how much of it is out.
    const f = Math.hypot(tip.tp.x, tip.tp.y) / REACH;
    const k = (-0.001 - 0.01 * f * f) * Math.hypot(this.vel.x, this.vel.y);
    this.accelerate(this.vel.x * k, this.vel.y * k);

    this.angle = angleOf(this.vel) + Math.PI / 2;
  }

  // Put back on the surface of what it ran into, and thrown off it.
  bumpOut(c, r) {
    const d = Math.hypot(this.pos.x - c.x, this.pos.y - c.y);
    // Dead centre has no way out of a circle. ugl's length setter answered
    // that with +x, and so does this.
    const ux = d === 0 ? 1 : (this.pos.x - c.x) / d;
    const uy = d === 0 ? 0 : (this.pos.y - c.y) / d;
    if (d < r) {
      this.pos.x += ux * (r - d);
      this.pos.y += uy * (r - d);
    }

    this.accelerate(ux * BUMP, uy * BUMP);
    ent.shake(0.2);
    flash = FLASH;
    sound.play("hit");
  }

  render(ctx) {
    // Five overlapping circles, so the glow goes down in one pass and the
    // drawing itself in another: otherwise the last circle's halo lands on top
    // of the ones before it.
    ctx.save();
    ctx.shadowColor = css(WHITE);
    ctx.shadowBlur = GLOW * scale;
    this.gfx.render(ctx);
    ctx.restore();
    this.gfx.render(ctx);
  }
}

/*
 * One straight stretch of cable, from `pos` to `pos + tp`. Every one of them is
 * born as the free stretch, running from wherever the cable last caught to the
 * player; a wrap freezes it where it is and hands the player a new one.
 *
 * They form a chain back to the earth through `prev`, and only the free
 * stretch updates.
 */
class Rope extends ent.Entity {
  constructor(x, y) {
    super();
    this.pos.x = x;
    this.pos.y = y;
    this.live = true;
    this.tp = { x: 0, y: 0 };
    // The planet this stretch hangs off, where on its rim, and the slide
    // banked up since it caught there.
    this.root = null;
    this.rootdir = false;
    this.rootpos = null;
    this.roll = SLACK;
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

  // Walk the anchor round the rim to the silhouette edge the player sees now,
  // and bank the angle it moved through. False once it has unwound.
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

  // Caught on `p`: this stretch stops at the rim and a new one carries on from
  // there to the player.
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
    sound.play("connect");
    ent.delay(0.01);
  }

  // Unwound: this stretch and the one that laid it go, and the one before that
  // is handed back to the player exactly as it was left.
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
    sound.play("leave");

    q.remove();
    this.remove();
  }

  render(ctx) {
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 3;
    ctx.strokeStyle = css(this.live ? BLACK : WHITE);
    if (this.live) {
      ctx.shadowColor = css(WHITE);
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
    // Seconds of the pop the link bar makes, once this planet is on it.
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
    ctx.shadowColor = css(this.link > 0 ? WHITE : BLACK);
    ctx.shadowBlur = GLOW * scale;
    this.gfx.render(ctx);
  }
}

class Earth extends ent.Entity {
  constructor() {
    super();
    this.pos.x = W / 2;
    this.pos.y = EARTHY;
    this.gfx.fill(WHITE).circle(0, 0, EARTH);
    this.hitCircle(EARTH);
  }

  update() {
    if (this.hit(player)) player.bumpOut(this.pos, EARTH);
  }
}

/*
 * The quadrant: the box the planets were scattered in, with half a screen of
 * margin on every side. Leaving it with every planet linked ends the level.
 */
class Zone extends ent.Entity {
  constructor(dimx, dimy) {
    super();
    this.w = dimx * W + W / 2;
    this.h = dimy * W + W / 2;
    this.pos.x = W / 2;
    this.pos.y = W / 4 - this.h / 2;
    this.hitBox(this.w, this.h);
  }

  update() {
    if (transition) return;
    if (this.hit(player)) return;
    if (linked < planets.length) return;
    sound.play("done");
    nextLevel();
  }

  render(ctx) {
    ctx.globalAlpha = ZONE_ALPHA;
    ctx.strokeStyle = css(BLACK);
    ctx.lineWidth = 4;
    ctx.setLineDash([10, 10]);
    ctx.strokeRect(-this.w / 2, -this.h / 2, this.w, this.h);
  }
}

const css = (c) => `#${c.toString(16).padStart(6, "0")}`;
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ugl's Vec2.cross, which is the negative of the usual convention.
const cross = (a, b) => b.y * a.x - b.x * a.y;

// ugl's Vec2.angle: [0, 2pi), and zero for the zero vector.
function angleOf(v) {
  if (v.x === 0 && v.y === 0) return 0;
  return (2 * Math.PI + Math.atan2(v.y, v.x)) % (2 * Math.PI);
}

// The two points on `p`'s rim that are its silhouette edges seen from `from`.
// The Haxe called these tangents; they are one unit inside the rim, on the
// diameter square to the line of sight, which is where a cable would leave a
// circle it is wrapped around.
function tangents(p, from) {
  const d = sub(p.pos, from);
  const a = angleOf(d);
  const l = Math.hypot(d.x, d.y);
  const s = p.size - 1;
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

// A stretch of cable against a planet: the segment's nearest point to the
// centre, inside the rim plus half the cable's width.
function crosses(rope, p) {
  const dx = rope.tp.x;
  const dy = rope.tp.y;
  const l2 = dx * dx + dy * dy;
  const ox = p.pos.x - rope.pos.x;
  const oy = p.pos.y - rope.pos.y;
  const t = l2 === 0 ? 0 : clamp((ox * dx + oy * dy) / l2, 0, 1);
  const nx = ox - t * dx;
  const ny = oy - t * dy;
  const r = p.size + HALF;
  return nx * nx + ny * ny <= r * r;
}

const cubicIn = (t) => t * t * t;
const cubicOut = (t) => (t - 1) * (t - 1) * (t - 1) + 1;
// ugl's Ease.elasticOut. It overshoots, which is the pop the link bar makes.
const elasticOut = (t) => Math.sin(-13 * (t + 1) * Math.PI / 2) * 2 ** (-10 * t) + 1;

/*
 * Scatter `total` planets over a grid of screens, five to a screen, keeping
 * them PGAP apart. It gives up on a placement after ten tries per planet, so a
 * level can come out with fewer planets than it asked for and the level is
 * counted on what it got.
 */
function buildPlanets(total) {
  const dim = Math.ceil(total / 5);
  const dimx = Math.ceil(Math.sqrt(dim));
  const dimy = Math.ceil(dim / dimx);

  let n = 0;
  let skipped = 0;
  while (n < total && skipped < 10 * total) {
    const x = W / 2 - dimx * W / 2 + dimx * W * Math.random();
    const y = -W * dimy + W * dimy * Math.random();
    const s = PSIZE + PVARY * Math.random();

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
  ent.reset();
  ent.world(W);
  ent.order([Zone, Rope, Planet, Earth, Player]);

  planets = [];
  linked = 0;
  transition = false;
  nudge = false;

  player = new Player();
  new Earth();
  new Rope(ROOTX, ROOTY);
  buildPlanets(level < LEVELS.length ? LEVELS[level] : (level - 5) * EXTRA);

  clock = {
    spent: 0,
    total: level === 0 ? FIRST : BASE + planets.length * PER,
    flip: 0,
    warn: false,
  };
  msg(`LEVEL ${level + 1}`);
}

function nextLevel() {
  transition = true;
  fade = { cover: true, t: 0 };
  wipe = WIPE;
}

export function init() {
  level = 0;
  wipe = 0;
  fade = null;
  flash = 0;
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

  // ugl ran the scene before the entities, and the camera is the one thing
  // here that has to keep that order: everything else reads it through render.
  cam.x = W / 2 - player.pos.x;
  cam.y = W / 2 - player.pos.y;

  ent.update(dt);

  // Then the furniture, on the entities' own clock, so a hitstop holds it too.
  const t = ent.game.time;
  flash = Math.max(0, flash - t);
  if (fade !== null && (fade.t += t) >= FADE) fade = null;

  let done = 0;
  for (const p of planets) {
    if (p.link <= 0) continue;
    p.linktimer = Math.min(1, p.linktimer + t);
    if (p.linktimer >= 1) done += 1;
  }
  linked = done;
  if (level === 0 && linked >= planets.length) nudge = true;

  clock.spent += t;
  clock.warn = false;
  if (clock.spent / clock.total > 0.8) {
    if (clock.flip > 1) {
      clock.warn = true;
      if (clock.flip >= 2) clock.flip -= 2;
    }
    clock.flip += t / FLIP;
  }
  if (clock.spent >= clock.total && !transition) gameOver();
}

export function render(ctx) {
  const m = ctx.getTransform();
  scale = Math.hypot(m.a, m.b) * SIZE / W;

  ctx.save();
  ctx.translate(cam.x * SIZE / W, cam.y * SIZE / W);
  ent.render(ctx);
  ctx.restore();

  ctx.save();
  ctx.scale(SIZE / W, SIZE / W);
  drawArrows(ctx);
  drawPieces(ctx);
  drawClock(ctx);
  if (fade !== null) {
    const t = Math.min(1, fade.t);
    ctx.globalAlpha = fade.cover ? cubicOut(t) : 1 - cubicIn(t);
    ctx.fillStyle = css(CYAN);
    ctx.fillRect(0, 0, W, W);
    ctx.globalAlpha = 1;
  }
  if (nudge) {
    ctx.fillStyle = css(BLACK);
    ctx.text("now leave the quadrant", W / 2, 430, 16);
  }
  if (flash > 0) {
    ctx.fillStyle = css(WHITE);
    ctx.fillRect(0, 0, W, W);
  }
  ctx.restore();
}

// An arrow at the edge of the screen for every planet still to link that is
// off it, fading with how far off it is.
function drawArrows(ctx) {
  ctx.fillStyle = css(BLACK);
  for (const p of planets) {
    if (p.link > 0) continue;
    const sx = p.pos.x + cam.x;
    const sy = p.pos.y + cam.y;
    if (sx >= 0 && sy >= 0 && sx < W && sy < W) continue;

    const d = Math.hypot(sx - W / 2, sy - W / 2) - W / 2;
    const x = clamp(sx, 10, W - 10);
    const y = clamp(sy, TOP + 10, W - 10);

    ctx.globalAlpha = 1 - clamp(d / (2 * W), 0, 0.9);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(y - W / 2, x - W / 2));
    ctx.beginPath();
    ctx.moveTo(-3.75, -5);
    ctx.lineTo(3.75, 0);
    ctx.lineTo(-3.75, 5);
    ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

// One cell per planet, in the order they were scattered, popping up as each
// one is wrapped.
function drawPieces(ctx) {
  const w = 358 / planets.length;
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = css(YELLOW);
  planets.forEach((p, i) => {
    if (p.link <= 0) return;
    const s = Math.trunc(10 * elasticOut(p.linktimer));
    ctx.fillRect(PIECES_X + 2 + i * w, PIECES_Y + 5 - s / 2, w, s);
  });
  ctx.fillRect(PIECES_X, PIECES_Y, 2, 10);
  ctx.fillRect(PIECES_X + 358, PIECES_Y, 2, 10);
  ctx.fillRect(PIECES_X, PIECES_Y + 4, 360, 2);
  ctx.globalAlpha = 1;
}

function drawClock(ctx) {
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = css(BLACK);
  ctx.fillRect(CLOCK_X, CLOCK_Y, 360, 10);
  ctx.globalAlpha = 1;
  ctx.fillStyle = css(clock.warn ? DARKYELLOW : DARKRED);
  ctx.fillRect(CLOCK_X, CLOCK_Y, 360 * Math.min(1, clock.spent / clock.total), 10);
}
