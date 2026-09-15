/*
 * wall.
 *
 * A lamp's worth of room is lit, the rest is a flat grey plan, and the orange
 * hunter is drawn only inside the light. It moves only while it is out of your
 * sight.
 *
 * `Sight` returns one polygon rather than a fan of triangles: as a clip a fan
 * shows a visible line down every shared edge.
 *
 * The light's range is the timer. A hunter stops exactly at the edge, since a
 * step inside freezes it, so only the edge moving in brings one closer. Without
 * the drain a bot following the flood fill to the nearest coin never died.
 *
 * The room is generated rather than hand-drawn: BLOCKS straight segments, each
 * needing a clear tile all round, so no segment closes off an area. Over 400
 * generated rooms every free tile was reachable from the start.
 */

import * as ent from "./lib/entity.js";
import { camera, shake } from "./lib/camera.js";
import { gameOver, msg, score } from "./lib/one.js";
import * as play from "./lib/sounds.js";

export const meta = {
  title: "wall",
  desc: `
coins feed the light, which is going out
the orange moves only while you cannot see it
`,
  bg: "#303030",
  fg: "#1EBED8",
  scoreMax: true,
  date: "2015-10-10",
  dpad: true,
};

// Two screens across and one down, so the camera only moves sideways. 23 rows
// is 966, so the room sits 29 off the top and bottom.
const TILE = 42;
const GW = 48;
const GH = 23;
const LY = (1024 - GH * TILE) / 2;
const RW = GW * TILE;
const RH = GH * TILE;

const WALL = 0x606060;
const FLOOR = 0xfafafa;
const CYAN = 0x1ebed8;
const ORANGE = 0xff6819;
// Outside the light, where the room is drawn as a flat plan.
const DIMFLOOR = 0x3c3c3c;
const DIMWALL = 0x252528;
const TINT = 0.12;
// A coin you cannot see yet, drawn through the dark so there is somewhere to go.
const MARK = 0.45;
const DOT = 13;
const ARROW = 19;

// A round ends when the coins stop: a hunter moves closer only when the edge of
// the light comes in or a wall covers it.
const LIGHT = 425;
const LIGHT_MAX = 470;
const LIGHT_MIN = 0;
const DRAIN = 11;
const FEED = 60;
const RAYS = 64;
// A ray continues this far past the wall it stops on, so the light falls on the
// wall's face rather than stopping at it.
const BLEED = 9;
// A nudge either side of a corner: one ray becomes the two edges of its shadow.
const NUDGE = 0.00001;
// Always lit, whatever the walls say, so the sprite never draws half clipped.
const NEAR = 23;

// Units a second.
const WALK = 360;
const HUNT = 435;
const CAM = 425;

// Well under the tile, and a clipped corner is slid off rather than stopped
// against, so a one-tile gap is a gap.
const HALF = 13;
const EDGE = 0.01;
const TAKE = 26;
const GRAB = 23;

// Straight segments dropped into the room, each 2 to 6 tiles long.
const BLOCKS = 26;
const SEGMIN = 2;
const SEGVARY = 5;

const COINS = 4;
const PER_HUNTER = 4;
const HUNTERS = 5;
const COIN_GAP = 190;
const HUNT_GAP = 770;
// Hunters hold this long at the start of a round.
const GRACE = 2.5;
// On top of the hitstop.
const DEATH = 0.7;

// The nearest hunter, seen or not: the only information the dark gives you.
const BEAT_NEAR = 640;
const BEAT_FAST = 0.22;
const BEAT_SLOW = 1;

// The vols are the original game's own volumes.

let range = LIGHT;

// The room: 1 is wall.
const map = new Uint8Array(GW * GH);
const open = [];
// Tile steps from the player, for a hunter that cannot see them.
const flow = new Int32Array(GW * GH);
let flowAt = -1;

let sight = null;
let poly = [];
let player = null;
let hold = 0;
let dying = 0;
let beat = 0;
let taken = 0;
let hunting = 0;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const tx = (x) => Math.floor(x / TILE);
const ty = (y) => Math.floor((y - LY) / TILE);
const cx = (i) => (i % GW + 0.5) * TILE;
const cy = (i) => (Math.floor(i / GW) + 0.5) * TILE + LY;

// Walls are segments, corners the points worth aiming a ray at, and cast()
// returns the polygon visible from a point.
class Sight {
  constructor() {
    // Four numbers a wall: origin, then extent.
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

  // The nearest wall along a ray that carries its own length.
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

  clear(fx, fy, gx, gy) {
    const dx = gx - fx;
    const dy = gy - fy;
    const l = Math.hypot(dx, dy);
    if (l === 0) return true;
    return this.reach(fx, fy, dx / l, dy / l) >= l;
  }

  // A corner inside the range gets a ray at it and one either side; RAYS close
  // the outer circle.
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

// A one-tile border, then straight segments dropped at random, each needing a
// clear tile all round before it is laid: two segments are then never adjacent,
// so nothing a segment does can close a way through.
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

function vacant(x, y, w, h) {
  for (let j = y - 1; j <= y + h; ++j) {
    for (let i = x - 1; i <= x + w; ++i) {
      if (map[j * GW + i]) return false;
    }
  }
  return true;
}

// Blocked tiles merged into as few rects as they go, with a one-tile offset
// that keeps the two rects of a corner from overlapping.
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

// Tile steps from `at` over free tiles, -1 for anything unreached. Filling
// `open` from the player's tile is what says where a coin may go.
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

// Each axis on its own, so a diagonal into a wall still slides along it, and in
// steps no longer than a tile, so nothing crosses a wall at speed.
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

// The box straddles two tiles across the way it is going and only one is
// blocked, so this step is a clipped corner: move off the blocked one instead
// of stopping. A flat wall is untouched, both tiles ahead of it being blocked.
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

// The same two tests the clip in render() draws from, so what freezes is what
// you can see.
function lit(p) {
  if (Math.hypot(p.x - player.pos.x, p.y - player.pos.y) > range) return false;
  return sight.clear(player.pos.x, player.pos.y, p.x, p.y);
}

// It never turns, so there is one facing and flipX is the other.
class Player extends ent.Entity {
  constructor(x, y) {
    super();
    this.pos.x = x;
    this.pos.y = y;
    this.gfx.size(28, 28).fill(CYAN)
      .circle(-2, -7, 6.5)
      .rect(-8.5, -4, 17, 12, 13)
      .rect(-7.5, 6, 5, 8)
      .rect(2.5, 6, 5, 8);
  }

  update() {
    if (dying > 0) return;
    const { input } = ent.game;

    let mx = 0;
    let my = 0;
    if (input.press.left) mx -= 1;
    if (input.press.right) mx += 1;
    if (input.press.up) my -= 1;
    if (input.press.down) my += 1;

    const l = Math.hypot(mx, my);
    if (l === 0) return;
    if (mx !== 0) this.flipX = mx > 0;
    const s = WALK * ent.game.time / l;
    slide(this.pos, mx * s, my * s);
  }
}

// Which one moved has to read as a shape and not only as a colour.
class Hunter extends ent.Entity {
  constructor(i) {
    super();
    this.pos.x = cx(i);
    this.pos.y = cy(i);
    this.gfx.size(28, 28).fill(ORANGE)
      .mt(-13, -14).lt(-3, -5).lt(-13, -5)
      .mt(13, -14).lt(13, -5).lt(3, -5)
      .rect(-14, -8, 28, 16, 8)
      .rects([[-13, 6, 5, 8], [-6, 6, 5, 8], [1, 6, 5, 8], [8, 6, 5, 8]])
      .fill(DIMWALL).rect(-9, -4, 6, 4, 4).rect(3, -4, 6, 4, 4);
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
    this.gfx.fill(CYAN).mt(0, -10).lt(10, 0).lt(0, 10).lt(-10, 0);
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
    play.coin();
    new ent.Particle({
      x: this.pos.x,
      y: this.pos.y,
      color: CYAN,
      count: 18,
      size: 4,
      speed: [190, 107],
      duration: [0.35, 0.2],
    });
    this.remove();
    addCoin();
    if (taken % PER_HUNTER === 0) addHunter();
  }
}

// The best of a sample rather than the first to clear `gap`, so a tight room
// still gets its coin, just a nearer one.
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
  play.power();
  msg(`${hunting} HUNTING`);
}

function die() {
  if (dying > 0) return;
  dying = DEATH;
  shake(0.5);
  play.lose();
  new ent.Particle({
    x: player.pos.x,
    y: player.pos.y,
    color: ORANGE,
    count: 50,
    size: 6,
    speed: [360, 190],
    duration: [0.6, 0.3],
  });
}

export function init() {
  ent.reset([Coin, Hunter, Player]);
  // The bounds run the width of the room and fix y at the middle.
  camera.bounds = { x: 0, y: 0, width: RW, height: 1024 };

  buildMap();
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

  camera.moveTo({ x: player.pos.x });
  poly = sight.cast(player.pos.x, player.pos.y);
}

export function update(dt) {
  // Rebuilt only when the player changes tile.
  const at = ty(player.pos.y) * GW + tx(player.pos.x);
  if (at !== flowAt) {
    flowAt = at;
    flood(at, flow);
  }

  ent.update(dt);

  // The entities' own timer, so a hitstop pauses it too.
  const t = ent.game.time;
  hold = Math.max(0, hold - t);
  if (hold <= 0 && dying <= 0) range = Math.max(LIGHT_MIN, range - DRAIN * t);

  // A constant-speed follow rather than approach(): it catches the player
  // exactly, and standing still is the one thing that centres them.
  const d = player.pos.x - camera.x;
  const m = CAM * t;
  camera.moveTo({ x: camera.x + (Math.abs(d) <= m ? d : Math.sign(d) * m) });

  poly = sight.cast(player.pos.x, player.pos.y);
  pulse(t);

  if (dying > 0 && (dying -= t) <= 0) gameOver({ score: true });
}

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
  play.hit({ detune: -6 * (1 - f) });
}

export function render(ctx) {
  const base = ctx.getTransform();

  ctx.save();
  camera.apply(ctx);

  drawRoom(ctx, DIMFLOOR, DIMWALL);
  drawMarks(ctx);

  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; ++i) ctx.lineTo(poly[i].x, poly[i].y);
  ctx.closePath();
  // Without it, the two rays either side of a corner can cut a sliver of the
  // player out of their own light.
  ctx.moveTo(player.pos.x + NEAR, player.pos.y);
  ctx.arc(player.pos.x, player.pos.y, NEAR, 0, 2 * Math.PI);
  ctx.clip();

  drawRoom(ctx, FLOOR, WALL);
  ctx.globalAlpha = TINT;
  ctx.fillStyle = ent.css(CYAN);
  ctx.fillRect(0, LY, RW, RH);
  ctx.globalAlpha = 1;

  // A clip is in device space once set, so dropping back to `base` keeps it
  // while ent.render() puts the camera on again itself.
  ctx.setTransform(base);
  ent.render(ctx);

  ctx.restore();
}

function drawRoom(ctx, floor, wall) {
  ctx.fillStyle = ent.css(floor);
  ctx.fillRect(0, LY, RW, RH);
  ctx.fillStyle = ent.css(wall);

  const v = camera.view;
  const x0 = Math.max(0, tx(v.x));
  const x1 = Math.min(GW - 1, tx(v.x + v.width));
  for (let y = 0; y < GH; ++y) {
    for (let x = x0; x <= x1; ++x) {
      if (!map[y * GW + x]) continue;
      let n = 1;
      while (x + n <= x1 && map[y * GW + x + n]) n += 1;
      ctx.fillRect(x * TILE, LY + y * TILE, n * TILE, TILE);
      x += n - 1;
    }
  }
}

function drawMarks(ctx) {
  ctx.globalAlpha = MARK;
  ctx.fillStyle = ent.css(CYAN);
  for (const c of ent.get(Coin)) {
    const s = camera.toScreen(c.pos.x, c.pos.y);
    if (s.x >= 0 && s.y >= 0 && s.x < 1024 && s.y < 1024) {
      ctx.fillRect(c.pos.x - DOT / 2, c.pos.y - DOT / 2, DOT, DOT);
      continue;
    }

    // Held ARROW off the edge and read back into the world, since this draws
    // under the camera.
    const m = camera.pixels(ARROW);
    const p = camera.toWorld(clamp(s.x, m, 1024 - m), clamp(s.y, m, 1024 - m));
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.atan2(s.y - 512, s.x - 512));
    ctx.beginPath();
    ctx.moveTo(-ARROW / 2, -ARROW / 2);
    ctx.lineTo(ARROW / 2, 0);
    ctx.lineTo(-ARROW / 2, ARROW / 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}
