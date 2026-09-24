/*
 * async - swap blocks across two facing boards to grow them into rectangles.
 *
 * Two 4x6 boards, gravity pulling each towards the spine. A swap is allowed
 * only when it leaves some block able to grow, and a click on a grown block
 * clears it.
 *
 * A Board is a rect rotated about its vertical axis under a perspective divide,
 * and a Block interpolates its board's quad. Back draws every block's shadows
 * before any block draws, then the block arcing behind in a swap; Front draws
 * the one arcing forward, then a cleared block on its way into the meter.
 *
 * The Meter in the spine is the swap budget: it drains with time, a swap costs
 * 1.5, a clear gives back its area less two, which the bar shows only once the
 * cleared block has flown into it. Empty drops both boards and the meter off
 * the page and ends the run; a run starts with the meter coming down and
 * filling, then the empty boards filling as they refill. Full is a level:
 * both boards refill and a colour is added, up to five, after which the drain
 * speeds up. A board with no swap and no clear left drops and refills after
 * STUCK_TIME, with no level.
 */

import * as ent from "./lib/entity.js";
import { Collider } from "./alma/src/collider.js";
import { Mat4 } from "./alma/src/geom/mat4.js";
import { Quad } from "./alma/src/geom/Quad.js";
import * as ease from "./alma/src/ease.js";
import { act } from "./lib/act.js";
import { shake } from "./lib/camera.js";
import { gameOver, score, time } from "./lib/one.js";

export { render } from "./lib/entity.js";

export const meta = {
  title: "async",
  bg: "#E0E5EC",
  fg: "#5B8DEF",
  scoreMax: true,
  release: true,
  date: "2026-09-23",
};

const BOARD_WIDTH = 4;
const BOARD_HEIGHT = 6;
const COLORS = ["#5B8DEF", "#F7B538", "#EF5B5B", "#A07BE0", "#FF8B3D"];
// Each channel of COLORS at 80%.
const LIPS = ["#4971BF", "#C6912D", "#BF4949", "#8062B3", "#CC6F31"];
const LIP = 10;
const SHADOW = 8;
const SHADOW_LIGHT = "rgba(255,255,255,0.95)";
const SHADOW_DARK = "rgba(163,177,198,0.8)";
const METER_COLOR = "#3DBB8A";
// METER_COLOR halfway to white.
const LOW_COLOR = "#9EDDC4";
const SINK = 0.5;
const SINK_BOB = 0.04;
const MARGIN_RATIO = 0.03;

// Tuned per 60Hz step.
const SPRING = 0.12;
const TILT = 0.1;

const SWAP_TIME = 0.25;
const FLY_TIME = 0.5;
const STUCK_TIME = 10;

const METER_MAX = 12;
const METER_START = METER_MAX / 2;
// A 2x2 clear gives back 2, one and a third swaps.
const SWAP_COST = 1.5;
// Two swaps left: the bar starts to pulse red and shake.
const METER_LOW = 3;
// An untouched meter empties from half in 90 seconds.
const DRAIN = 1 / 15;

const PERSPECTIVE = 1000;

// Margin, board, gap, spine, gap, board, margin across the width. The width
// binds, which is why 4x6 leaves board colour above and below.
const MARGIN = 1024 * 0.04;
const SPINE = 1024 * 0.025;
const BOARD_ASPECT = (BOARD_WIDTH + (BOARD_WIDTH - 1) * MARGIN_RATIO) /
  (BOARD_HEIGHT + (BOARD_HEIGHT - 1) * MARGIN_RATIO);
const BOARD_W = (1024 - 4 * MARGIN - SPINE) / 2;
const BOARD_H = BOARD_W / BOARD_ASPECT;
const BOARD_Y = (1024 - BOARD_H) / 2;

// What a depth of 3 moves a block by.
const BLOCK_SIZE = Math.min(
  BOARD_W / (BOARD_WIDTH + (BOARD_WIDTH - 1) * MARGIN_RATIO),
  BOARD_H / (BOARD_HEIGHT + (BOARD_HEIGHT - 1) * MARGIN_RATIO),
);

const blocks = [];
// Cleared blocks on their way into the meter, off the board.
const flying = [];
const boards = [];
let meter = null;
let selected = null;
let level = 0;
// Input and drain are off while a level, a stuck board or the end plays out.
let busy = false;
// Null until the board has settled and been checked.
let moves = null;
let stuck = 0;

function colorCount() {
  return Math.min(2 + level, COLORS.length);
}

function drainRate() {
  return DRAIN * (1 + 0.5 * Math.max(0, level - (COLORS.length - 2)));
}

function bob() {
  return (1 + Math.sin(time * 5)) / 2;
}

function lerp(a, b, t) {
  return a.map((p, i) => ({
    x: p.x + (b[i].x - p.x) * t,
    y: p.y + (b[i].y - p.y) * t,
  }));
}

class Board extends ent.Entity {
  constructor(id) {
    super();
    // -1 for the left board, which leans and falls towards +x.
    this.side = id === 0 ? -1 : 1;
    this.x = id === 0 ? MARGIN : 3 * MARGIN + BOARD_W + SPINE;
    this.rotation = 0;
    this.spin = 0;
    this.project();
  }

  project() {
    const hw = BOARD_W / 2;
    const hh = BOARD_H / 2;
    const corners = new Quad([
      { x: -hw, y: -hh },
      { x: hw, y: -hh },
      { x: hw, y: hh },
      { x: -hw, y: hh },
    ]).applyMatrix(new Mat4().makeRotationY(this.rotation), true);
    this.quad = new Quad(corners.map((c) => {
      const p = PERSPECTIVE / (c.z + PERSPECTIVE);
      return { x: this.x + hw + c.x * p, y: BOARD_Y + hh + c.y * p };
    }));
  }

  // A point on the quad, pushed out along the board's normal by depth.
  at(u, v, depth) {
    const p = this.quad.interpolate(u, v);
    const offset = depth * BLOCK_SIZE / 3;
    p.x += offset * Math.sin(this.rotation);
    p.y += offset * Math.cos(this.rotation);
    return p;
  }

  update() {
    const restore = (this.side * TILT - this.rotation) * SPRING;
    this.spin = (this.spin + restore) * 0.85;
    this.rotation += this.spin * ent.game.time / 0.016;
    this.project();
  }
}

class Block extends ent.Entity {
  constructor(board, x, y, displacement = 0) {
    super();
    this.board = board;
    this.x = x;
    this.y = y;
    this.color = Math.floor(Math.random() * colorCount());
    this.width = 1;
    this.height = 1;
    this.depth = 0;
    this.sink = 0;
    this.sinkVel = 0;
    this.targetSink = 0;
    // In cells, drawn short of where it is, and tweened to 0.
    this.displacement = displacement;
    this.drop = 0;
    this.swap = null;
    this.fly = null;
    this.points = this.quad();
    blocks.push(this);
  }

  remove() {
    super.remove();
    const i = blocks.indexOf(this);
    if (i > -1) blocks.splice(i, 1);
  }

  quad(depth = this.depth, margin = true) {
    const { board } = this;
    const corner = (x, y) => board.at(x / BOARD_WIDTH, y / BOARD_HEIGHT, depth);
    const x2 = this.x + this.width;
    const y2 = this.y + this.height;
    // The parallax the normal offset misses.
    let q = new Quad([
      corner(this.x, this.y),
      corner(x2, this.y),
      corner(x2, y2),
      corner(this.x, y2),
    ]).scale(depth >= 0 ? 1 / (1 + depth) : 1 - depth);
    if (this.displacement !== 0 || this.drop !== 0) {
      q = q.translate(
        board.side *
          (this.displacement * BOARD_W / BOARD_WIDTH + 250 * this.drop),
        1100 * this.drop,
      );
    }
    if (margin) q = q.applyMargin(MARGIN_RATIO, this.width, this.height);
    return q.corners;
  }

  // Corners the size of a single block's, whatever this one's size.
  radius() {
    return {
      rx: 0.26 / (this.width + (this.width - 1) * MARGIN_RATIO),
      ry: 0.26 / (this.height + (this.height - 1) * MARGIN_RATIO),
    };
  }

  // Not an act(): merge() and the stuck check wait for every act to finish, and
  // the board has settled long before this lands.
  flyStep() {
    const { fly } = this;
    fly.age = Math.min(FLY_TIME, fly.age + ent.game.time);
    fly.t = ease.quadIn(fly.age / FLY_TIME);
    this.points = this.flight();
    if (fly.age < FLY_TIME) return;
    meter.land(fly.gain);
    flying.splice(flying.indexOf(this), 1);
    this.remove();
  }

  // Its centre on a curve that dips down on its way into the top of the bar,
  // lifting towards the viewer on the way and shrinking evenly until its
  // longer side is the bar's width.
  flight() {
    const { age, t, from } = this.fly;
    const lift = 1 + 0.25 * Math.sin(Math.PI * age / FLY_TIME);
    const c = {
      x: (from[0].x + from[2].x) / 2,
      y: (from[0].y + from[2].y) / 2,
    };
    const to = meter.top();
    const mid = {
      x: (c.x + to.x) / 2,
      y: Math.max(c.y, to.y) + 150,
    };
    const u = 1 - t;
    const x = u * u * c.x + 2 * u * t * mid.x + t * t * to.x;
    const y = u * u * c.y + 2 * u * t * mid.y + t * t * to.y;
    const size = Math.max(from[2].x - from[0].x, from[2].y - from[0].y);
    const k = (u + meter.width() / size * t) * lift;
    return from.map((p) => ({ x: x + (p.x - c.x) * k, y: y + (p.y - c.y) * k }));
  }

  async swapWith(target, arc) {
    this.swap = { t: 0, target, arc };
    await act(this.swap).attr("t", 1, SWAP_TIME, ease.quadOut);
    this.swap = null;
    this.depth = 0;
  }

  // Out to depth `arc`, where the two meet halfway, then in to the target.
  arc() {
    const { t, target, arc } = this.swap;
    const mid = lerp(this.quad(arc, false), target.quad(arc, false), 0.5);
    if (t < 0.5) {
      this.depth = arc * t * 2;
      return lerp(this.quad(0, false), mid, t * 2);
    }
    this.depth = arc * (2 - t * 2);
    return lerp(mid, target.quad(0, false), t * 2 - 1);
  }

  update() {
    if (this.fly) return this.flyStep();
    const restore = (this.targetSink - this.sink) * SPRING;
    this.sinkVel = (this.sinkVel + restore) * 0.8;
    this.sink += this.sinkVel * ent.game.time / 0.016;

    let q = new Quad(this.swap ? this.arc() : this.quad());
    if (this.sink !== 0) {
      const b = bob();
      q = q.scale(1 - (1 - SINK) * this.sink - SINK_BOB * b * this.sink)
        .translate(0, (4 + 3 * b) * this.sink);
    }
    this.points = q.corners;
  }

  shadow(ctx, name, sign, px) {
    const d = SHADOW * (1 - this.sink * (0.65 + 0.2 * bob()));
    const shadow = blockShadows(this, px);
    drawBlockShadow(ctx, shadow[name], shadow, this.points, sign * d, px);
  }

  fill(ctx) {
    const { rx, ry } = this.radius();
    const { points } = this;
    ctx.fillStyle = COLORS[this.color];
    ctx.roundQuad(points, rx, ry);
    ctx.fill();
    const h = Math.min(
      LIP * (1 - 0.6 * this.sink),
      (points[3].y - points[0].y) * 0.1,
    );
    lip(ctx, points, rx, ry, h, LIPS[this.color]);
  }

  render(ctx) {
    if (this.depth === 0 && !this.fly) this.fill(ctx);
  }
}

// Every light shadow before any dark one, and both before any block, so no
// highlight covers a neighbour.
class Back extends ent.Entity {
  render(ctx) {
    const px = pixels(ctx);
    for (const [name, sign] of [["light", -1], ["dark", 1]]) {
      for (const block of blocks) block.shadow(ctx, name, sign, px);
    }
    for (const block of blocks) if (block.depth > 0) block.fill(ctx);
  }
}

class Front extends ent.Entity {
  render(ctx) {
    for (const block of blocks) if (block.depth < 0) block.fill(ctx);
    for (const block of flying) block.fill(ctx);
  }
}

class Meter extends ent.Entity {
  constructor() {
    super();
    this.value = METER_START;
    this.shown = METER_START;
    // Added to value but still flying in as sparks, so not yet shown.
    this.pending = 0;
    this.flash = 0;
    this.drop = 0;
  }

  groove() {
    return Math.round(SPINE * 1.7 * (1 + 1.5 * this.flash));
  }

  width() {
    return Math.round(this.groove() * 0.62);
  }

  // Where a cleared block lands: the top of the bar.
  top() {
    const pad = this.groove() * 0.19;
    const h = Math.max(0, this.shown) / METER_MAX * (BOARD_H - 2 * pad);
    return { x: 512, y: BOARD_Y + BOARD_H - pad - h + this.width() / 2 };
  }

  land(n) {
    this.pending -= n;
  }

  // True when this fills it.
  add(n) {
    this.value = Math.min(METER_MAX, this.value + n);
    return this.value === METER_MAX;
  }

  update() {
    const dt = ent.game.time;
    const target = this.value - this.pending;
    this.shown += (target - this.shown) * Math.min(1, dt * 12);
    if (busy) return;
    this.value -= drainRate() * dt;
    if (this.value <= 0) end();
  }

  render(ctx) {
    ctx.save();
    ctx.translate(0, 1100 * this.drop);
    this.draw(ctx);
    ctx.restore();
  }

  // The bar's shadow is cut in three: the two caps copied as they are and the
  // straight middle stretched to the height.
  draw(ctx) {
    const px = pixels(ctx);
    const w = this.groove();
    const groove = bake(`groove ${w}`, px, () => bakeGroove(px, w));
    ctx.drawImage(
      groove,
      512 - w / 2,
      BOARD_Y,
      groove.width / px,
      groove.height / px,
    );

    const pad = w * 0.19;
    const bw = this.width();
    let h = Math.max(0, this.shown) / METER_MAX * (BOARD_H - 2 * pad);
    if (h <= 0) return;
    const bottom = BOARD_Y + BOARD_H - pad;
    ctx.save();
    // Shorter than it is wide, it is a dot shrinking into the bottom.
    if (h < bw) {
      ctx.translate(512, bottom);
      ctx.scale(h / bw, h / bw);
      ctx.translate(-512, -bottom);
      h = bw;
    }
    const low = Math.max(0, 1 - this.shown / METER_LOW);
    const x = 512 - bw / 2 + 3 * low * Math.sin(time * 50);
    const y = bottom - h;

    const d = 3;
    const shadow = bake(
      `bar ${bw}`,
      px,
      () =>
        bakeShadows(px, bw, bw + 2, 2 * d, (c) => {
          c.beginPath();
          c.roundRect(0, 0, bw, bw + 2, bw / 2);
        }),
    );
    const cap = shadow.pad + bw / 2;
    for (const [name, s] of [["light", -d], ["dark", d]]) {
      const image = shadow[name];
      const iw = image.width / px;
      const tail = image.height / px - cap - 2;
      const left = x - shadow.pad + s;
      ctx.drawImage(
        image,
        0,
        0,
        image.width,
        cap * px,
        left,
        y - shadow.pad + s,
        iw,
        cap,
      );
      ctx.drawImage(
        image,
        0,
        cap * px,
        image.width,
        2 * px,
        left,
        y + bw / 2 + s,
        iw,
        h - bw,
      );
      ctx.drawImage(
        image,
        0,
        (cap + 2) * px,
        image.width,
        tail * px,
        left,
        y + h - bw / 2 + s,
        iw,
        tail,
      );
    }

    ctx.fillStyle = METER_COLOR;
    ctx.beginPath();
    ctx.roundRect(x, y, bw, h, bw / 2);
    ctx.fill();
    if (low > 0) {
      ctx.globalAlpha = Math.min(1, 2 * low) * (1 + Math.sin(time * 12)) / 2;
      ctx.fillStyle = LOW_COLOR;
      ctx.fill();
    }
    ctx.restore();
  }
}

function blockAt(board, x, y) {
  return blocks.find((b) =>
    b.board === board &&
    x >= b.x && x < b.x + b.width &&
    y >= b.y && y < b.y + b.height
  );
}

function fits(board, x, y, width, height, self) {
  if (x < 0 || y < 0 || x + width > BOARD_WIDTH || y + height > BOARD_HEIGHT) {
    return false;
  }
  for (let i = x; i < x + width; i++) {
    for (let j = y; j < y + height; j++) {
      const b = blockAt(board, i, j);
      if (b && b !== self) return false;
    }
  }
  return true;
}

// Every cell in the grown box holds a block of the same colour that fits
// inside it: a bigger neighbour poking out leaves the union non-rectangular.
function canGrow(block, dx, dy) {
  const maxX = block.x + block.width + dx;
  const maxY = block.y + block.height + dy;
  for (let x = block.x; x < maxX; x++) {
    for (let y = block.y; y < maxY; y++) {
      const n = blockAt(block.board, x, y);
      if (
        !n || n.color !== block.color ||
        n.x + n.width > maxX || n.y + n.height > maxY ||
        n.x < block.x || n.y < block.y
      ) return false;
    }
  }
  return true;
}

// The largest growth down and right, or null. One cell wide or tall is not a
// merge, so the area has to be more than 4.
function growth(block) {
  let best = null;
  let bestArea = 4;
  for (let dx = 0; dx <= BOARD_WIDTH - (block.x + block.width); dx++) {
    for (let dy = 0; dy <= BOARD_HEIGHT - (block.y + block.height); dy++) {
      const w = dx + block.width;
      const h = dy + block.height;
      if ((dx === 0 && dy === 0) || w === 1 || h === 1) continue;
      if (w * h < bestArea || (w * h === bestArea && dy <= (best?.y ?? 0))) {
        continue;
      }
      if (!canGrow(block, dx, dy)) continue;
      best = { x: dx, y: dy };
      bestArea = w * h;
    }
  }
  return best;
}

// Only a block above and left of a or b, on its board, can grow into it.
function canSwap(a, b) {
  const reaches = (block, c) =>
    block.board === c.board && block.x <= c.x && block.y <= c.y;
  [a.color, b.color] = [b.color, a.color];
  const ok = blocks.some((block) =>
    (reaches(block, a) || reaches(block, b)) && growth(block) !== null
  );
  [a.color, b.color] = [b.color, a.color];
  return ok;
}

function hasMove() {
  if (blocks.some((b) => b.width > 1 || b.height > 1)) return true;
  const [left, right] = boards.map((board) =>
    blocks.filter((b) => b.board === board)
  );
  return left.some((a) => right.some((b) => a.color !== b.color && canSwap(a, b)));
}

// The merged block is the one at the top-left corner.
function merge() {
  if (act.is()) return;
  moves = null;
  for (;;) {
    const block = blocks.find((b) => growth(b) !== null);
    if (!block) return;
    const g = growth(block);
    for (let x = block.x; x < block.x + block.width + g.x; x++) {
      for (let y = block.y; y < block.y + block.height + g.y; y++) {
        const n = blockAt(block.board, x, y);
        if (n && n !== block) n.remove();
      }
    }
    block.width += g.x;
    block.height += g.y;
  }
}

// From the outer edge in.
function feedOrder(board) {
  const xs = Array.from({ length: BOARD_WIDTH }, (_, i) => i);
  return board.side < 0 ? xs : xs.reverse();
}

// Every block falls towards the spine, then each board refills from its outer
// edge, all new blocks sliding in from the furthest hole's distance.
async function settle() {
  const before = new Map(blocks.map((b) => [b, b.x]));
  for (const board of boards) {
    for (let moved = true; moved;) {
      moved = false;
      for (const b of blocks) {
        if (b.board !== board) continue;
        if (!fits(board, b.x - board.side, b.y, b.width, b.height, b)) continue;
        b.x -= board.side;
        moved = true;
      }
    }
  }

  const moving = [];
  for (const [b, x] of before) {
    if (b.x === x) continue;
    b.displacement = -b.board.side * (b.x - x);
    moving.push(b);
  }

  for (const board of boards) {
    const outside = board.side < 0 ? -1 : BOARD_WIDTH;
    const holes = [];
    let far = 1;
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      for (const x of feedOrder(board)) {
        if (blockAt(board, x, y)) break;
        far = Math.max(far, Math.abs(outside - x));
        holes.push([x, y]);
      }
    }
    for (const [x, y] of holes) moving.push(new Block(board, x, y, far));
  }

  await Promise.all(
    moving.map((b) => act(b).attr("displacement", 0, 0.25, ease.quadIn)),
  );
}

// Throws every block off, inner column first.
async function drop() {
  for (const board of boards) board.spin -= board.side * 0.3;

  await Promise.all(blocks.map((b) => {
    const inner = b.board.side < 0 ? BOARD_WIDTH - b.x - b.width : b.x;
    const delay = inner * 0.06 + b.y * 0.03 + Math.random() * 0.05;
    return act(b).attr("drop", 1, 0.6, ease.quadIn, delay);
  }));

  for (const b of [...blocks]) b.remove();
}

async function refill() {
  await settle();
  merge();
  busy = false;
}

// Waits out any swap or clear still falling, then every cleared block's flight
// and the bar's rise to full, which shakes and holds before the drop.
async function levelUp() {
  deselect();
  await act.wait();
  await act(meter).until(() =>
    flying.length === 0 && meter.value - meter.shown < 0.02
  );
  meter.shown = meter.value;
  shake(0.3);
  meter.flash = 1;
  act(meter).attr("flash", 0, 0.8, ease.quadOut);
  // await act({}).delay(0.5);
  await drop();
  level++;
  meter.value = METER_START;
  await refill();
}

// The meter comes down and its bar fills, then the empty boards fill the way
// they refill.
async function intro() {
  busy = true;
  meter.drop = -1;
  meter.shown = 0;
  meter.pending = meter.value;
  await act(meter).attr("drop", 0, 0.5, ease.quadOut);
  meter.pending = 0;
  await act(meter).until(() => meter.value - meter.shown < 0.02);
  await refill();
}

// The meter goes with the boards, leaving the finish screen on an empty page.
async function end() {
  busy = true;
  deselect();
  await act.wait();
  await act(meter).until(() => flying.length === 0);
  await Promise.all([drop(), act(meter).attr("drop", 1, 0.6, ease.quadIn)]);
  gameOver({ score: true });
}

function unstick() {
  busy = true;
  stuck = 0;
  deselect();
  drop().then(refill);
}

function select(block) {
  selected = block;
  block.targetSink = 1;
}

function deselect() {
  if (!selected) return;
  selected.targetSink = 0;
  selected = null;
}

async function clear(block) {
  const area = block.width * block.height;
  score.value += area;
  const before = meter.value;
  const full = meter.add(area - 2);
  const gain = meter.value - before;
  meter.pending += gain;
  if (full) busy = true;
  blocks.splice(blocks.indexOf(block), 1);
  flying.push(block);
  block.fly = { age: 0, t: 0, from: block.points, gain };
  await settle();
  merge();
  if (full) await levelUp();
}

async function swap(a, b) {
  meter.value -= SWAP_COST;
  await Promise.all([a.swapWith(b, -2), b.swapWith(a, 3)]);
  [a.color, b.color] = [b.color, a.color];
  merge();
}

// Not awaited: a click lands while an earlier one is still animating.
function click(x, y) {
  const point = Collider.point(x, y);
  const block = blocks.find((b) =>
    Collider.hit(point, Collider.polygon(b.quad(b.depth, false)))
  );
  if (!block) return;

  // The square root makes the edge twice the push of a quarter out, not four.
  const dist = (x - (block.board.x + BOARD_W / 2)) / BOARD_W;
  block.board.spin -= 0.15 * Math.abs(dist) ** 0.5 * Math.sign(dist);

  const previous = selected;
  deselect();
  if (block.width > 1 || block.height > 1) return clear(block);
  if (previous && previous.board !== block.board && canSwap(previous, block)) {
    return swap(previous, block);
  }
  select(block);
}

export function init() {
  ent.reset([Board, Meter, Back, Block, Front]);
  blocks.length = 0;
  flying.length = 0;
  boards.length = 0;
  selected = null;
  score.value = 0;
  level = 0;
  busy = false;
  moves = null;
  stuck = 0;

  boards.push(new Board(0), new Board(1));
  meter = new Meter();
  new Back();
  new Front();
  intro();
}

export function update(dt) {
  ent.update(dt);
  const { input } = ent.game;
  if (busy) return;
  if (input.just.act) click(input.x, input.y);
  if (act.is()) return (stuck = 0);
  moves ??= hasMove();
  stuck = moves ? 0 : stuck + dt;
  if (stuck > STUCK_TIME) unstick();
}

// Device pixels per board unit, the scale the shadows are baked at.
function pixels(ctx) {
  const m = ctx.getTransform();
  return Math.hypot(m.a, m.b);
}

// The shape moved up by h, cut out of itself: a band along its bottom. Call it
// right after the shape, whose path it clips to.
function lip(ctx, points, rx, ry, h, color) {
  ctx.save();
  ctx.clip();
  ctx.fillStyle = color;
  ctx.roundQuad(points.map(({ x, y }) => ({ x, y: y - h })), rx, ry);
  ctx.rect(0, 0, 1024, 1024);
  ctx.fill("evenodd");
  ctx.restore();
}

// A shadowBlur fill blurs again every frame, so shadows are drawn once at the
// screen's scale and copied. A change of scale throws them all away.
const baked = new Map();
let bakedPx = 0;

function bake(key, px, make) {
  if (px !== bakedPx) {
    baked.clear();
    bakedPx = px;
  }
  if (!baked.has(key)) baked.set(key, make());
  return baked.get(key);
}

// A shape's two shadows, each alone on a canvas: the shape is drawn a canvas
// width to the left, off it, and its shadow offset back on.
function bakeShadows(px, width, height, blur, draw) {
  const pad = blur * 1.5;
  const out = { pad, width, height };
  for (const [name, color] of [["light", SHADOW_LIGHT], ["dark", SHADOW_DARK]]) {
    const canvas = new OffscreenCanvas(
      Math.ceil((width + 2 * pad) * px),
      Math.ceil((height + 2 * pad) * px),
    );
    const c = canvas.getContext("2d");
    c.shadowColor = color;
    c.shadowBlur = blur * px;
    c.shadowOffsetX = canvas.width;
    c.scale(px, px);
    c.translate(pad - canvas.width / px, pad);
    draw(c);
    c.fill();
    out[name] = canvas;
  }
  return out;
}

function blockShadows(block, px) {
  const width = BOARD_W / BOARD_WIDTH * (block.width - 2 * MARGIN_RATIO);
  const height = BOARD_H / BOARD_HEIGHT * (block.height - 2 * MARGIN_RATIO);
  const { rx, ry } = block.radius();
  return bake(
    `block ${block.width}x${block.height}`,
    px,
    () =>
      bakeShadows(px, width, height, 2 * SHADOW, (c) =>
        c.roundQuad(
          [
            { x: 0, y: 0 },
            { x: width, y: 0 },
            { x: width, y: height },
            { x: 0, y: height },
          ],
          rx,
          ry,
        )),
  );
}

// The rest shape mapped onto the quad by the affine transform that averages
// its opposite edges; a block's perspective is too slight to show in a blur.
function drawBlockShadow(ctx, image, shadow, points, s, px) {
  const [a, b, c, e] = points;
  const { pad, width, height } = shadow;
  const ux = (b.x - a.x + c.x - e.x) / 2 / width;
  const uy = (b.y - a.y + c.y - e.y) / 2 / width;
  const vx = (e.x - a.x + c.x - b.x) / 2 / height;
  const vy = (e.y - a.y + c.y - b.y) / 2 / height;
  const cx = (a.x + b.x + c.x + e.x) / 4 - (ux * width + vx * height) / 2;
  const cy = (a.y + b.y + c.y + e.y) / 4 - (uy * width + vy * height) / 2;
  ctx.save();
  ctx.transform(ux, uy, vx, vy, cx + s, cy + s);
  ctx.drawImage(image, -pad, -pad, image.width / px, image.height / px);
  ctx.restore();
}

// The groove the meter sits in: two shadows cast inward from a frame around it.
function bakeGroove(px, w) {
  const canvas = new OffscreenCanvas(
    Math.ceil(w * px),
    Math.ceil(BOARD_H * px),
  );
  const c = canvas.getContext("2d");
  c.scale(px, px);
  const groove = () => {
    c.beginPath();
    c.roundRect(0, 0, w, BOARD_H, w / 2);
  };
  groove();
  c.fillStyle = meta.bg;
  c.fill();
  for (const [color, s] of [[SHADOW_DARK, 6], [SHADOW_LIGHT, -6]]) {
    c.save();
    groove();
    c.clip();
    c.shadowColor = color;
    c.shadowBlur = 12 * px;
    c.shadowOffsetX = c.shadowOffsetY = s * px;
    c.beginPath();
    c.rect(-40, -40, w + 80, BOARD_H + 80);
    c.roundRect(0, 0, w, BOARD_H, w / 2);
    c.fill("evenodd");
    c.restore();
  }
  return canvas;
}
