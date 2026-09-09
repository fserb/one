/*
 * wall - a port of ~/prj/vault/games/sketch/src/Wall.hx.
 *
 * You see only what you can see. A lamp's worth of room around you is lit and
 * the rest is a flat grey plan you can read but not see into, and the orange
 * thing that wants you is only ever drawn inside the light.
 *
 * The rule the game is built on: it moves only while it is out of your sight.
 * Inside the light it is a statue, however close it is standing. So the play is
 * to back away from something you are looking at, towards a coin you are not,
 * and every wall you put between the two of you is time it gets for free. Every
 * fourth coin sends another one, up to five, and five of them cannot all be
 * looked at at once.
 *
 * The Haxe is the sight engine and none of the game: a hand-drawn 48x24 room, a
 * player that walks and collides, and `vault.Sight` casting a visibility
 * polygon that it draws as cyan triangles at alpha 0.2 over a room that was
 * already fully visible. No score, no clock, no end, nothing to do. The camera
 * clamps the left edge of the room and has the matching right-edge clamp
 * commented out, so you can walk off the map into the background colour.
 *
 * What the port keeps: `Sight`, the rect merge in `Grid.getSight` that feeds
 * it, the 20-unit tile, the player's sprite, the camera that trails at 200
 * units a second, and the palette down to `C.p2`, the orange the Haxe declares
 * and never draws. That is the hunter now, and it is the only orange on the
 * screen; cyan is you and what you are here for.
 *
 * What changed:
 *
 * - `castLOS` returned a fan of `Tri2` and the port returns the polygon. It
 *   sorted the rays and then built one triangle per adjacent pair, which is
 *   the same shape drawn as N overlapping subpaths; as a clip that shows a
 *   seam down every shared edge. One closed path has no seams and is less code.
 * - Sight has a range, rays are clamped to it, and RAYS of them spread round
 *   the circle close the rim. The Haxe saw to the far wall in every direction.
 *   The range is also the clock: a hunter settles exactly at the edge of the
 *   light, because a step that would bring it inside is a step that freezes it,
 *   so the only thing that ever brings one closer is the edge coming in. It
 *   comes in at DRAIN units a second and a coin puts FEED back. Measured
 *   against a bot that walks the flood to the nearest coin and routes two tiles
 *   clear of any hunter it can see: hunters frozen 88% of the time, a round of
 *   54 seconds, 8 coins. Without the drain the same bot never died at all, and
 *   no hunter in 20 rounds came nearer than 109 units.
 * - The room is scattered rather than hand-drawn: BLOCKS straight segments,
 *   each needing a clear tile all the way around it, so no segment can seal a
 *   pocket off and the coins have somewhere new to be every round. Checked over
 *   400 rolls: every free tile reachable from the start, every time.
 * - A corner the box clips is slid off rather than stopped against. The Haxe's
 *   Grid had no such thing and its player was 14 wide in a 20 tile, which on a
 *   hand-drawn room with no one-tile gaps in it never showed. On a scattered
 *   one it is the difference between a gap and a five-unit window.
 * - Diagonals are normalised. The Haxe added a flat 10000 of acceleration per
 *   axis against a drag that cancelled the frame's velocity exactly, so a held
 *   direction was a flat speed and two of them was that speed times root two.
 * - `facingleft` swapped the sprite's top two rows for their mirror image. The
 *   entity mirrors the whole drawing with flipX, so there is one pattern.
 * - The camera's right-edge clamp is the one the Haxe left commented out.
 *   Vertically there is nothing to clamp: the room is one screen tall, which is
 *   what the Haxe's `if (l.y > 0)` and `if (l.y < 0)` both pinning the top edge
 *   to zero were really saying.
 */

import * as ent from "./lib/entity.js";
import { gameOver, hint, msg, score, SIZE } from "./lib/one.js";
import * as sfxr from "./lib/sfxr.js";
import * as sound from "./lib/sound.js";

export const meta = {
  title: "wall",
  desc: `
coins feed the light, which is going out
the orange moves only while you cannot see it
`,
  bg: "#303030",
  fg: "#1EBED8",
  scoreMax: true,
  finishGood: false,
  date: "2015-10-10",
};

// The box the game thinks in, and the strip of it the shell's 44px bar covers.
const W = 480;
const TOP = 21;

// The room, in the Haxe's 20-unit tiles: two screens across, one screen down
// from under the bar, so the camera only ever moves sideways. The top row of
// tiles is wall and the bar hides the first unit of it.
const TILE = 20;
const GW = 48;
const GH = 23;
const LY = TOP - 1;
const RW = GW * TILE;
const RH = GH * TILE;

// The Haxe's palette. C.black is the wall, C.white the floor, C.p1 you, and
// C.p2 the orange it declared and never drew.
const WALL = 0x606060;
const FLOOR = 0xfafafa;
const CYAN = 0x1ebed8;
const ORANGE = 0xff6819;
// Outside the light, where the room is a plan rather than a place. Wall darker
// than floor, the same way round as it is inside.
const DIMFLOOR = 0x3c3c3c;
const DIMWALL = 0x252528;
// The light's own colour, over the lit floor and under everything standing on
// it. The Haxe's triangles were this at 0.2 over a fully lit room.
const TINT = 0.12;
// A coin you cannot see yet, drawn through the dark so there is somewhere to
// go: this bright, this big on screen, and this big as an arrow at the edge.
const MARK = 0.45;
const DOT = 6;
const ARROW = 9;

// How far the light reaches to start with, the most and least it will ever
// reach, how fast it goes on its own, and what a coin puts back. The light is
// the clock: a hunter settles exactly at its edge and can only close when the
// edge comes in or a wall covers it, so a round ends when the coins stop.
const LIGHT = 200;
const LIGHT_MAX = 220;
const LIGHT_MIN = 0;
const DRAIN = 5;
const FEED = 28;
// Rays spread round the circle, closing the rim wherever the light runs out
// before a wall does.
const RAYS = 64;
// A ray carries this far past the wall it stops on, so the light lands on the
// face of the wall rather than ending exactly at it. Without it a wall inside
// the light is never drawn at all: the polygon's own edge is the wall, and
// there is nothing to tell one from the edge of a shadow.
const BLEED = 4;
// The Haxe's nudge either side of a corner, which is what turns one ray into
// the two edges of the shadow behind it.
const NUDGE = 0.00001;
// Always lit, whatever the walls say, so the sprite never draws half clipped.
const NEAR = 11;

// Units a second: you, the thing after you, and the camera that trails you.
const WALK = 170;
const HUNT = 205;
const CAM = 200;

// Half the collision box. Well under the tile, and a corner it clips is slid
// off rather than stopped against, so a gap one tile wide is a gap.
const HALF = 6;
const EDGE = 0.01;
// Near enough to take a coin, and near enough to be taken.
const TAKE = 12;
const GRAB = 11;
// A dead zone around the player, so a tap on top of them is not a direction.
const DEAD = 12;

// Straight segments dropped into the room, each 2 to 6 tiles long.
const BLOCKS = 26;
const SEGMIN = 2;
const SEGVARY = 5;

// Coins on the board at once, coins between one hunter and the next, and the
// most hunters a round will ever hold.
const COINS = 4;
const PER_HUNTER = 4;
const HUNTERS = 5;
// No coin lands nearer than this, and no hunter arrives nearer than this.
const COIN_GAP = 90;
const HUNT_GAP = 360;
// Hunters hold this long at the start of a round, or until the hint has gone.
const GRACE = 2.5;
// Caught, then this long before the shot the overlay takes.
const DEATH = 0.7;

// The nearest hunter beats at this rate from this far out, whether or not you
// can see it. It is the only thing the dark tells you.
const BEAT_NEAR = 300;
const BEAT_FAST = 0.22;
const BEAT_SLOW = 1;

// The Haxe's player, less the two rows it swapped to face right.
const BODY = `
00000..
000000.
.0.0.0.
.00000.
.00000.
..000..
.00000.
`;

const BEAST = `
00...00
0000000
0110110
0000000
0000000
.00000.
0.0.0.0
`;

const PIP = `
..0..
.000.
00000
.000.
..0..
`;

// ugl's Sound.vol(v) set masterVolume to 2v, and sfxr squares that.
voice("coin", sfxr.coin(4021), 0.14);
voice("die", sfxr.explosion(4057), 0.2);
voice("more", sfxr.powerup(4093), 0.14);
voice("beat", thud(), 0.16);

function voice(name, params, vol) {
  params.masterVolume = 2 * vol;
  sound.put(name, sfxr.render(params), sfxr.SAMPLE_RATE);
}

// A sine at about 70Hz with the attack taken off it: sfxr's period is
// 100/(f*f + 0.001) eighths of a sample, so f of 0.14 is 8*44100/5040 Hz.
function thud() {
  const p = sfxr.params();
  p.waveType = 2;
  p.startFrequency = 0.14;
  p.slide = -0.1;
  p.sustainTime = 0.02;
  p.sustainPunch = 0.5;
  p.decayTime = 0.16;
  return p;
}

// How far the light reaches now.
let range = LIGHT;

// The room: 1 is wall.
const map = new Uint8Array(GW * GH);
// Every free tile the player can reach, which is where coins and hunters go.
const open = [];
// Tile steps from the player, for a hunter that cannot see them, and the tile
// it was last built from.
const flow = new Int32Array(GW * GH);
let flowAt = -1;

let sight = null;
// This frame's visibility polygon, in world units.
let poly = [];
let player = null;
// Screen minus world: what render() translates by. y never moves.
const cam = { x: 0, y: 0 };
// Seconds the hunters are still held for, and seconds left of being caught.
let hold = 0;
let dying = 0;
let beat = 0;
let taken = 0;
let hunting = 0;

const css = (c) => `#${c.toString(16).padStart(6, "0")}`;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const tx = (x) => Math.floor(x / TILE);
const ty = (y) => Math.floor((y - LY) / TILE);
const cx = (i) => (i % GW + 0.5) * TILE;
const cy = (i) => (Math.floor(i / GW) + 0.5) * TILE + LY;

/*
 * vault.Sight. Walls are segments, corners are the points worth aiming a ray
 * at, and cast() answers the polygon you can see from a point.
 */
class Sight {
  constructor() {
    // Four numbers a wall: where it starts, and where it runs to from there.
    this.walls = [];
    this.pts = [];
    this.seen = new Set();
  }

  rect(x0, y0, x1, y1) {
    this.wall(x0, y0, x0, y1);
    this.wall(x0, y1, x1, y1);
    this.wall(x1, y1, x1, y0);
    this.wall(x1, y0, x0, y0);
  }

  wall(ax, ay, bx, by) {
    this.walls.push(ax, ay, bx - ax, by - ay);
    this.point(ax, ay);
    this.point(bx, by);
  }

  point(x, y) {
    const k = `${x},${y}`;
    if (this.seen.has(k)) return;
    this.seen.add(k);
    this.pts.push(x, y);
  }

  // Distance from (fx, fy) along the unit vector (dx, dy) to the nearest wall,
  // or Infinity. The Haxe's castMinRay, over a ray that carries its own length.
  reach(fx, fy, dx, dy) {
    let best = Infinity;
    const w = this.walls;
    for (let i = 0; i < w.length; i += 4) {
      const sx = w[i + 2];
      const sy = w[i + 3];
      const m = dx * sy - dy * sx;
      if (m === 0) continue;
      const ox = fx - w[i];
      const oy = fy - w[i + 1];
      const t = (sx * oy - sy * ox) / m;
      if (t < 0 || t >= best) continue;
      const s = (dx * oy - dy * ox) / m;
      if (s < 0 || s > 1) continue;
      best = t;
    }
    return best;
  }

  // Is there a clear line from (fx, fy) to (gx, gy)?
  clear(fx, fy, gx, gy) {
    const dx = gx - fx;
    const dy = gy - fy;
    const l = Math.hypot(dx, dy);
    if (l === 0) return true;
    return this.reach(fx, fy, dx / l, dy / l) >= l;
  }

  // The visibility polygon, as points in order round the player. A corner
  // inside the range gets a ray at it and one either side, and a ring of rays
  // closes the rim wherever the light runs out before a wall does.
  cast(fx, fy) {
    const dirs = [];
    for (let i = 0; i < this.pts.length; i += 2) {
      const dx = this.pts[i] - fx;
      const dy = this.pts[i + 1] - fy;
      if (dx * dx + dy * dy > range * range) continue;
      const a = Math.atan2(dy, dx);
      dirs.push(a - NUDGE, a, a + NUDGE);
    }
    for (let i = 0; i < RAYS; ++i) dirs.push(i * 2 * Math.PI / RAYS);

    const out = [];
    for (const a of dirs) {
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const t = Math.min(range, this.reach(fx, fy, dx, dy) + BLEED);
      out.push({
        a: (a + 2 * Math.PI) % (2 * Math.PI),
        x: fx + dx * t,
        y: fy + dy * t,
      });
    }
    out.sort((p, q) => p.a - q.a);
    return out;
  }
}

/*
 * The room. A one-tile border, then straight segments dropped at random, each
 * needing a clear tile all the way around it before it is laid: two segments
 * are then never adjacent, so nothing a segment does can close a way through.
 */
function buildMap() {
  map.fill(0);
  for (let x = 0; x < GW; ++x) {
    map[x] = 1;
    map[(GH - 1) * GW + x] = 1;
  }
  for (let y = 0; y < GH; ++y) {
    map[y * GW] = 1;
    map[y * GW + GW - 1] = 1;
  }

  for (let n = 0, tries = 0; n < BLOCKS && tries < 40 * BLOCKS; ++tries) {
    const len = SEGMIN + Math.floor(SEGVARY * Math.random());
    const flat = Math.random() < 0.5;
    const w = flat ? len : 1;
    const h = flat ? 1 : len;
    const x = 2 + Math.floor((GW - 4 - w) * Math.random());
    const y = 2 + Math.floor((GH - 4 - h) * Math.random());
    if (!vacant(x, y, w, h)) continue;
    for (let j = y; j < y + h; ++j) {
      for (let i = x; i < x + w; ++i) map[j * GW + i] = 1;
    }
    n += 1;
  }
}

// The box, and the ring of tiles around it, all still free.
function vacant(x, y, w, h) {
  for (let j = y - 1; j <= y + h; ++j) {
    for (let i = x - 1; i <= x + w; ++i) {
      if (map[j * GW + i]) return false;
    }
  }
  return true;
}

// Grid.getSight: blocked tiles merged into as few rects as they will go, so a
// wall 20 tiles long is four segments rather than eighty. Straight out of the
// Haxe, including the one-tile offset that keeps the two rects of a corner
// from overlapping.
function buildSight() {
  const s = new Sight();
  const free = new Uint8Array(GW * GH);
  for (let i = 0; i < map.length; ++i) free[i] = map[i] ? 0 : 1;

  for (let x = 0; x < GW; ++x) {
    for (let y = 0; y < GH; ++y) {
      if (free[y * GW + x]) continue;

      let xx = x;
      while (xx < GW && !free[y * GW + xx]) xx += 1;
      let yy = y;
      while (yy < GH && !free[yy * GW + x]) yy += 1;

      const doleft = xx - x > 1;
      const dotop = !(yy - y <= 1 && doleft);
      let by = y;
      if (doleft && dotop) by += 1;

      if (doleft) {
        for (let i = x; i < xx; ++i) free[y * GW + i] = 1;
        s.rect(x * TILE, LY + y * TILE, xx * TILE, LY + (y + 1) * TILE);
      }
      if (dotop) {
        for (let j = y; j < yy; ++j) free[j * GW + x] = 1;
        s.rect(x * TILE, LY + by * TILE, (x + 1) * TILE, LY + yy * TILE);
      }
    }
  }
  return s;
}

// Tile steps from `at` over free tiles, -1 for anything the flood never gets
// to. Filling `open` from the player's own tile is also what says which tiles
// a coin may be put on.
function flood(at, into, list = null) {
  into.fill(-1);
  into[at] = 0;
  const q = [at];
  for (let h = 0; h < q.length; ++h) {
    const c = q[h];
    const x = c % GW;
    const y = (c - x) / GW;
    const d = into[c] + 1;
    if (list !== null) list.push(c);
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const i = x + ox;
      const j = y + oy;
      if (i < 0 || j < 0 || i >= GW || j >= GH) continue;
      const n = j * GW + i;
      if (map[n] || into[n] >= 0) continue;
      into[n] = d;
      q.push(n);
    }
  }
}

/*
 * Moving a box of half-width HALF through the room. Each axis is resolved on
 * its own, so a diagonal into a wall still slides along it, and in steps no
 * longer than a tile, so nothing crosses a wall at speed. A step that lands in
 * a wall puts the box against the face of the tile it entered instead.
 */
function slide(p, dx, dy) {
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / TILE));
  for (let i = 0; i < n; ++i) {
    step(p, dx / n, 0);
    step(p, 0, dy / n);
  }
}

function step(p, dx, dy) {
  const x = p.x + dx;
  const y = p.y + dy;
  if (!solid(x, y)) {
    p.x = x;
    p.y = y;
    return;
  }
  if (assist(p, x, y, dx, dy)) return;

  if (dx > 0) p.x = tx(x + HALF) * TILE - HALF - EDGE;
  else if (dx < 0) p.x = (tx(x - HALF) + 1) * TILE + HALF + EDGE;
  if (dy > 0) p.y = LY + ty(y + HALF) * TILE - HALF - EDGE;
  else if (dy < 0) p.y = LY + (ty(y - HALF) + 1) * TILE + HALF + EDGE;
}

/*
 * A corner rather than a wall: the box straddles two tiles across the way it
 * is going and only one of the two is blocked, so this step is a clipped
 * corner. Move off the blocked one instead of stopping. Without it the box has
 * to be lined up inside a few units to walk through a gap one tile wide, and a
 * flat wall is untouched because both tiles ahead of it are blocked.
 */
function assist(p, x, y, dx, dy) {
  const d = Math.abs(dx) + Math.abs(dy);
  if (dx !== 0) {
    const i = tx(dx > 0 ? x + HALF : x - HALF);
    const j0 = ty(p.y - HALF);
    const j1 = ty(p.y + HALF);
    if (j0 === j1 || wall(i, j0) === wall(i, j1)) return false;
    const s = wall(i, j0) ? d : -d;
    if (solid(p.x, p.y + s)) return false;
    p.y += s;
    return true;
  }

  const j = ty(dy > 0 ? y + HALF : y - HALF);
  const i0 = tx(p.x - HALF);
  const i1 = tx(p.x + HALF);
  if (i0 === i1 || wall(i0, j) === wall(i1, j)) return false;
  const s = wall(i0, j) ? d : -d;
  if (solid(p.x + s, p.y)) return false;
  p.x += s;
  return true;
}

function wall(i, j) {
  if (i < 0 || j < 0 || i >= GW || j >= GH) return true;
  return map[j * GW + i] !== 0;
}

function solid(x, y) {
  const x0 = tx(x - HALF);
  const x1 = tx(x + HALF);
  const y0 = ty(y - HALF);
  const y1 = ty(y + HALF);
  for (let j = y0; j <= y1; ++j) {
    for (let i = x0; i <= x1; ++i) {
      if (wall(i, j)) return true;
    }
  }
  return false;
}

// Inside the light: near enough, with nothing in the way. The same two tests
// the clip in render() is drawn from, so what freezes is what you can see.
function lit(p) {
  if (Math.hypot(p.x - player.pos.x, p.y - player.pos.y) > range) return false;
  return sight.clear(player.pos.x, player.pos.y, p.x, p.y);
}

class Player extends ent.Entity {
  constructor(x, y) {
    super();
    this.pos.x = x;
    this.pos.y = y;
    this.art.size(2, 7, 7).obj([CYAN], BODY);
  }

  update() {
    if (dying > 0) return;
    const { key, mouse } = ent.game;

    let mx = 0;
    let my = 0;
    if (key.left) mx -= 1;
    if (key.right) mx += 1;
    if (key.up) my -= 1;
    if (key.down) my += 1;
    // The camera trails rather than centring, so the pointer is a heading off
    // wherever on the screen the player actually is.
    if (mx === 0 && my === 0 && mouse.press) {
      mx = mouse.x - this.pos.x - cam.x;
      my = mouse.y - this.pos.y - cam.y;
      if (Math.hypot(mx, my) < DEAD) return;
    }

    const l = Math.hypot(mx, my);
    if (l === 0) return;
    if (mx !== 0) this.flipX = mx > 0;
    const s = WALK * ent.game.time / l;
    slide(this.pos, mx * s, my * s);
  }
}

class Hunter extends ent.Entity {
  constructor(i) {
    super();
    this.pos.x = cx(i);
    this.pos.y = cy(i);
    this.art.size(2, 7, 7).obj([ORANGE, DIMWALL], BEAST);
  }

  update() {
    if (dying > 0) return;

    const d = Math.hypot(
      player.pos.x - this.pos.x,
      player.pos.y - this.pos.y,
    );
    if (d < GRAB) {
      die();
      return;
    }
    if (hold > 0 || lit(this.pos)) return;

    // Straight at the player when the way is open, and downhill through the
    // flood when it is not.
    let ax = player.pos.x - this.pos.x;
    let ay = player.pos.y - this.pos.y;
    if (!sight.clear(this.pos.x, this.pos.y, player.pos.x, player.pos.y)) {
      const n = downhill(this.pos);
      if (n < 0) return;
      ax = cx(n) - this.pos.x;
      ay = cy(n) - this.pos.y;
    }

    const l = Math.hypot(ax, ay);
    if (l === 0) return;
    this.flipX = ax > 0;
    const s = HUNT * ent.game.time / l;
    slide(this.pos, ax * s, ay * s);
  }
}

// The neighbouring tile nearest the player, or -1 if the flood never reached
// this one.
function downhill(p) {
  const x = tx(p.x);
  const y = ty(p.y);
  let best = flow[y * GW + x];
  if (best < 0) return -1;
  let at = -1;
  for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const i = x + ox;
    const j = y + oy;
    if (i < 0 || j < 0 || i >= GW || j >= GH) continue;
    const n = j * GW + i;
    if (flow[n] < 0 || flow[n] >= best) continue;
    best = flow[n];
    at = n;
  }
  return at;
}

class Coin extends ent.Entity {
  constructor(i) {
    super();
    this.pos.x = cx(i);
    this.pos.y = cy(i);
    this.phase = 2 * Math.PI * Math.random();
    this.art.size(2, 5, 5).obj([CYAN], PIP);
  }

  update() {
    this.scale = 1 + 0.15 * Math.sin(5 * ent.game.totalTime + this.phase);
    if (dying > 0) return;
    const d = Math.hypot(
      player.pos.x - this.pos.x,
      player.pos.y - this.pos.y,
    );
    if (d > TAKE) return;

    score.value += 1;
    taken += 1;
    range = Math.min(LIGHT_MAX, range + FEED);
    sound.play("coin");
    new ent.Particle()
      .xy(this.pos.x, this.pos.y)
      .color(CYAN)
      .count(18)
      .size(2)
      .speed(90, 50)
      .duration(0.35, 0.2);
    this.remove();
    addCoin();
    if (taken % PER_HUNTER === 0) addHunter();
  }
}

// A tile from `open`, as far from the player and from everything in `avoid` as
// a handful of tries can find. Taking the best of a sample rather than the
// first that clears `gap` means a room the scatter left tight still gets its
// coin, just a nearer one, instead of the placement failing into whatever tile
// happened to be last.
function pick(gap, avoid) {
  let at = open[0];
  let best = -1;
  for (let n = 0; n < 24; ++n) {
    const i = open[Math.floor(open.length * Math.random())];
    let d = Math.hypot(cx(i) - player.pos.x, cy(i) - player.pos.y);
    for (const e of avoid) {
      d = Math.min(d, Math.hypot(cx(i) - e.pos.x, cy(i) - e.pos.y));
    }
    if (d > best) {
      best = d;
      at = i;
    }
    if (d >= gap) break;
  }
  return at;
}

function addCoin() {
  new Coin(pick(COIN_GAP, ent.get(Coin)));
}

function addHunter() {
  if (hunting >= HUNTERS) return;
  hunting += 1;
  new Hunter(pick(HUNT_GAP, ent.get(Hunter)));
  sound.play("more");
  msg(`${hunting} HUNTING`);
}

function die() {
  if (dying > 0) return;
  dying = DEATH;
  ent.shake(0.5);
  sound.play("die");
  new ent.Particle()
    .xy(player.pos.x, player.pos.y)
    .color(ORANGE)
    .count(50)
    .size(3)
    .speed(170, 90)
    .duration(0.6, 0.3);
}

export function init() {
  ent.reset();
  ent.world(W);
  ent.order([Coin, Hunter, Player]);

  buildMap();
  // Room for the player to stand in wherever the scatter left them.
  const sx = Math.floor(GW / 4);
  const sy = Math.floor(GH / 2);
  for (let j = sy - 1; j <= sy + 1; ++j) {
    for (let i = sx - 1; i <= sx + 1; ++i) map[j * GW + i] = 0;
  }
  sight = buildSight();

  open.length = 0;
  flood(sy * GW + sx, flow, open);
  flowAt = sy * GW + sx;

  player = new Player(cx(flowAt), cy(flowAt));
  range = LIGHT;
  hold = GRACE;
  dying = 0;
  beat = 0;
  taken = 0;
  hunting = 0;

  for (let i = 0; i < COINS; ++i) addCoin();
  addHunter();

  cam.x = clamp(W / 2 - player.pos.x, W - RW, 0);
  poly = sight.cast(player.pos.x, player.pos.y);
}

export function update(dt) {
  // The flood is only rebuilt when the player has changed tile, which on a
  // 48x23 room is a few hundred steps a second at most.
  const at = ty(player.pos.y) * GW + tx(player.pos.x);
  if (at !== flowAt) {
    flowAt = at;
    flood(at, flow);
  }

  ent.update(dt);

  // Then the rest, on the entities' own clock, so a hitstop holds it too.
  const t = ent.game.time;
  hold = Math.max(hold - t, hint());
  // The light holds while the hint is up, for the same reason the hunters do.
  if (hold <= 0 && dying <= 0) range = Math.max(LIGHT_MIN, range - DRAIN * t);

  const want = clamp(W / 2 - player.pos.x, W - RW, 0);
  const d = want - cam.x;
  const m = CAM * t;
  cam.x += Math.abs(d) <= m ? d : Math.sign(d) * m;

  poly = sight.cast(player.pos.x, player.pos.y);
  pulse(t);

  if (dying > 0 && (dying -= t) <= 0) gameOver();
}

// The heartbeat, quicker the nearer the closest hunter is. Seen or not: it is
// the only thing the dark says.
function pulse(t) {
  if (dying > 0) return;
  let near = Infinity;
  for (const h of ent.get(Hunter)) {
    near = Math.min(
      near,
      Math.hypot(h.pos.x - player.pos.x, h.pos.y - player.pos.y),
    );
  }
  if (near > BEAT_NEAR || hold > 0) {
    beat = 0;
    return;
  }

  beat -= t;
  if (beat > 0) return;
  const f = near / BEAT_NEAR;
  beat = BEAT_FAST + (BEAT_SLOW - BEAT_FAST) * f;
  sound.play("beat", -6 * (1 - f));
}

export function render(ctx) {
  const k = SIZE / W;
  const base = ctx.getTransform();

  ctx.save();
  ctx.scale(k, k);
  ctx.translate(cam.x, cam.y);

  drawRoom(ctx, DIMFLOOR, DIMWALL);
  drawMarks(ctx);

  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; ++i) ctx.lineTo(poly[i].x, poly[i].y);
  ctx.closePath();
  // The polygon is exact and the sprite is inside the collision box, so this
  // only matters where two rays either side of a corner cut it: without it a
  // sliver of the player can fall outside their own light.
  ctx.moveTo(player.pos.x + NEAR, player.pos.y);
  ctx.arc(player.pos.x, player.pos.y, NEAR, 0, 2 * Math.PI);
  ctx.clip();

  drawRoom(ctx, FLOOR, WALL);
  ctx.globalAlpha = TINT;
  ctx.fillStyle = css(CYAN);
  ctx.fillRect(0, LY, RW, RH);
  ctx.globalAlpha = 1;

  // Everything standing in the room, inside the same clip: a hunter out of the
  // light is not drawn at all, which is the whole game.
  ctx.setTransform(base);
  ctx.translate(cam.x * k, cam.y * k);
  ent.render(ctx);

  ctx.restore();
}

function drawRoom(ctx, floor, wall) {
  ctx.fillStyle = css(floor);
  ctx.fillRect(0, LY, RW, RH);
  ctx.fillStyle = css(wall);

  const x0 = Math.max(0, tx(-cam.x));
  const x1 = Math.min(GW - 1, tx(-cam.x + W));
  for (let y = 0; y < GH; ++y) {
    for (let x = x0; x <= x1; ++x) {
      if (!map[y * GW + x]) continue;
      // Runs, so a wall 20 tiles long is one fill.
      let n = 1;
      while (x + n <= x1 && map[y * GW + x + n]) n += 1;
      ctx.fillRect(x * TILE, LY + y * TILE, n * TILE, TILE);
      x += n - 1;
    }
  }
}

// A coin you have not reached yet: a dot through the dark where it is, and an
// arrow at the edge of the screen where it is not. The room is two screens
// across and the light is a fraction of one, so without this the only way to
// find the next coin is to walk the room until it turns up.
function drawMarks(ctx) {
  ctx.globalAlpha = MARK;
  ctx.fillStyle = css(CYAN);
  for (const c of ent.get(Coin)) {
    const sx = c.pos.x + cam.x;
    const sy = c.pos.y + cam.y;
    if (sx >= 0 && sy >= TOP && sx < W && sy < W) {
      ctx.fillRect(c.pos.x - DOT / 2, c.pos.y - DOT / 2, DOT, DOT);
      continue;
    }

    ctx.save();
    ctx.translate(
      clamp(sx, ARROW, W - ARROW) - cam.x,
      clamp(sy, TOP + ARROW, W - ARROW) - cam.y,
    );
    ctx.rotate(Math.atan2(sy - W / 2, sx - W / 2));
    ctx.beginPath();
    ctx.moveTo(-ARROW / 2, -ARROW / 2);
    ctx.lineTo(ARROW / 2, 0);
    ctx.lineTo(-ARROW / 2, ARROW / 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}
