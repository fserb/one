/*
 * async - two boards, one conveyor belt of orders.
 *
 * The two boards fall towards each other: gravity pulls right on the left one
 * and left on the right. A swap is only allowed when it leaves some block able
 * to grow. The belt never stops, and reaching the left edge ends the run.
 */

import * as ease from "./alma/src/ease.js";
import * as extra from "./alma/src/utils/extra.js";
import * as vec from "./alma/src/geom/vec.js";
import { camera } from "./lib/camera.js";
import { act } from "./lib/act.js";
import { gameOver, input, msg, score } from "./lib/one.js";

const { arrayRemove, promiseSleep, TAU } = extra;

export const meta = {
  title: "async",
  desc: `
swap blocks on each side
to build mega blocks
`,
  bg: "#FFFFFF",
  fg: "#424B54",
  scoreMax: true,
  date: "2021-05-28",
  draft: true,
};

const PIECE = ["#F02299", "#26ABF6", "#FCFF00", "#16DB93"];
const SIDE = ["#B6187E", "#1D7ACA", "#BFB702", "#109E79"];
const FOOT = ["#650B57", "#0F378C", "#6C5300", "#094754"];

const WIDTH = 4;
const HEIGHT = 6;
const TILE = 120;
const BOARDPOS = [
  { x: 10, y: 290 },
  { x: 1024 - TILE * WIDTH - 10, y: 290 },
];

// Belt units draw in a unit square, scaled up by this.
const SZ = 100;
const STRIDE = 1.2;
// The belt is in the strip above the boards, clear of the overlay's panels.
const BELT_Y = 117;

const board = [];
const selected = [null, null];
const belt = [];

// Reused, flipped per board by the reader. Board 0 falls right, board 1 left.
const gravity = { x: 1, y: 0 };

// Per board, since the last check. A "sync" order needs one of each.
const merges = [0, 0];

let needsMerge;
let colors;
let beltPos;
let beltSpeed;
let beltFlash;
let beltNext;
let milestone;

export function init() {
  msg(meta.desc, { at: "bottom", hold: 3, once: true });
  board.length = 0;
  belt.length = 0;
  selected[0] = selected[1] = null;
  merges[0] = merges[1] = 0;

  colors = 2;
  beltSpeed = 1;
  beltNext = 1;
  beltFlash = 0;
  needsMerge = false;
  milestone = 0;

  // A fixed opening hand, so the first thirty seconds are always the same.
  belt.unshift(createOrder(0, -1));
  belt.unshift(createOrder(0, 1));
  belt.unshift(createOrder(1, -1));
  belt.unshift(createOrder(1, 0));
  belt.unshift(createOrder(2, -1));
  beltPos = -belt.length + 1;

  fillEmpty();
}

// BOARD ///

function createBlock(p) {
  const o = Object.assign({
    b: -1,
    x: -1,
    y: -1,
    v: Math.floor(colors * Math.random()),
    w: 1,
    h: 1,
    // Render offset, animated to zero, so a block sits at its new grid
    // position while drawn at the old one.
    d: { x: 0, y: 0 },
    scale: 1,
    selected: false,
    removed: false,
  }, p);
  board.push(o);
  return o;
}

function toScreen(p) {
  const bp = BOARDPOS[p.b];
  return {
    x: p.d.x + bp.x + (p.w / 2 + p.x) * TILE,
    y: p.d.y + bp.y + (p.h / 2 + p.y) * TILE,
  };
}

function add(p, d) {
  return { b: p.b, x: p.x + d.x, y: p.y + d.y };
}

function inRect(r, p) {
  return r.b === p.b &&
    p.x >= r.x && p.x < r.x + r.w &&
    p.y >= r.y && p.y < r.y + r.h;
}

function get(p) {
  for (const o of board) {
    if (o.removed) continue;
    if (inRect(o, p)) return o;
  }
  return null;
}

// New blocks enter along the edge gravity pulls away from, offset `step` tiles
// so they slide in rather than appear.
function fillEmpty(step = 0) {
  let added = false;
  for (let b = 0; b < 2; ++b) {
    gravity.x = Math.abs(gravity.x) * (b === 0 ? 1 : -1);

    const start = {
      b,
      x: Math.abs(gravity.x * (1 - gravity.x)) * (WIDTH - 1) / 2,
      y: Math.abs(gravity.y * (1 - gravity.y)) * (HEIGHT - 1) / 2,
    };
    const dir = { x: Math.abs(gravity.y), y: Math.abs(gravity.x) };

    for (let s = 0; s < Math.max(WIDTH, HEIGHT); ++s) {
      const p = add(start, vec.mul(dir, s));
      if (p.x < 0 || p.y < 0 || p.x >= WIDTH || p.y >= HEIGHT) continue;
      if (get(p) !== null) continue;
      const o = createBlock(p);
      o.x -= gravity.x;
      o.y -= gravity.y;
      o.d = vec.mul(gravity, -step * TILE);
      added = true;
    }
  }

  if (added) fallBlocks(step + 1);
}

// How many tiles the block at p can drop before it hits something.
function checkCanFall(p) {
  const b = get(p);
  let step = 0;
  let check = b;
  while (check === null || check === b) {
    const n = add(p, vec.mul(gravity, ++step));
    if (n.x < 0 || n.y < 0 || n.x >= WIDTH || n.y >= HEIGHT) break;
    check = get(n);
  }
  return step - 1;
}

async function fallBlocks(fillstep = 0) {
  let changed = false;

  for (const b of board) {
    gravity.x = Math.abs(gravity.x) * (b.b === 0 ? 1 : -1);

    // A wide block falls only as far as its most blocked cell allows.
    let step = Infinity;
    for (let x = b.x; x < b.x + b.w; ++x) {
      for (let y = b.y; y < b.y + b.h; ++y) {
        step = Math.min(step, checkCanFall({ b: b.b, x, y }));
      }
    }
    if (step === 0) continue;

    b.x += gravity.x * step;
    b.y += gravity.y * step;
    b.d.x -= TILE * gravity.x * step;
    b.d.y -= TILE * gravity.y * step;
    act(b.d)
      .attr("x", 0, 0.4, ease.quadIn)
      .attr("y", 0, 0.4, ease.quadIn);
    changed = true;
  }

  if (changed) return await fallBlocks(fillstep);

  fillEmpty(fillstep);
  await promiseSleep(0.4);
  camera.shake(0.05 + 0.05 * fillstep, 100);
  needsMerge = true;
}

// MERGING ///

// True when growing b by (dx, dy) covers only same-coloured blocks, none
// sticking out of the rectangle that results.
function isValidResize(b, dx, dy) {
  const maxx = b.x + b.w + dx;
  const maxy = b.y + b.h + dy;
  for (let x = b.x; x < maxx; ++x) {
    for (let y = b.y; y < maxy; ++y) {
      const n = get({ b: b.b, x, y });
      if (!n || n.v !== b.v) return false;
      if (n.x + n.w > maxx || n.y + n.h > maxy) return false;
      if (n.x < b.x || n.y < b.y) return false;
    }
  }
  return true;
}

// The largest rectangle b can grow into, as (dx, dy). At least 2x2, ties to
// the taller.
function getMaxSquare(b) {
  const expand = { x: 0, y: 0 };
  let bestArea = 4;

  for (let dx = 0; dx <= WIDTH - (b.x + b.w); dx++) {
    for (let dy = 0; dy <= HEIGHT - (b.y + b.h); dy++) {
      const area = (dx + b.w) * (dy + b.h);
      if (dx + b.w === 1 || dy + b.h === 1) continue;
      if (bestArea > area) continue;
      if (bestArea === area && dy <= expand.y) continue;
      if (!isValidResize(b, dx, dy)) continue;
      expand.x = dx;
      expand.y = dy;
      bestArea = area;
    }
  }
  return expand;
}

function canGrow(b) {
  const exp = getMaxSquare(b);
  return exp.x > 0 || exp.y > 0;
}

// Grows one block, absorbing what it covers, then starts over: a merge opens
// up the next.
function tryMergeBlocks() {
  for (const b of board) {
    const exp = getMaxSquare(b);
    if (exp.x === 0 && exp.y === 0) continue;

    for (let x = b.x; x < b.x + b.w + exp.x; x++) {
      for (let y = b.y; y < b.y + b.h + exp.y; y++) {
        const n = get({ b: b.b, x, y });
        if (n === null || n === b) continue;
        arrayRemove(board, n);
      }
    }
    b.w += exp.x;
    b.h += exp.y;
    merges[b.b]++;

    return tryMergeBlocks();
  }
}

// A swap is allowed only if it leaves some block able to merge, which is what
// stops the board deadlocking. A useless swap silently does nothing.
function isValidSwitch() {
  return board.some(canGrow);
}

// THE BELT ///

// type: 0 blocks, 1 shape, 2 bps, 3 sync, 4 or. color -1 means any.
function createOrder(type, color = null) {
  color ??= Math.random() < 0.5 ? -1 : Math.floor(colors * Math.random());

  if (type === 0) {
    return {
      type: "blocks",
      color,
      total: Math.floor(4 + 12 * Math.random()),
      count: 0,
      t: 0,
    };
  }

  if (type === 1) {
    return {
      type: "shape",
      color,
      width: Math.random() < 0.75 ? 2 : 3,
      height: Math.random() < 0.75 ? 2 : 3,
      t: 1,
    };
  }

  // Keep a meter full: it drains on its own and every shipment tops it up.
  if (type === 2) {
    return {
      type: "bps",
      color,
      max: 10 + beltSpeed * 0.1,
      value: 0,
      speed: beltSpeed * 0.05 + 0.4 * Math.random(),
      t: 1,
    };
  }

  // Merge on both boards between checks.
  if (type === 3) return { type: "sync", t: 1 };

  // Either half satisfies it, and neither half can itself be an "or".
  if (type === 4) {
    const a = makeOrder(false);
    const b = makeOrder(false);
    const x = { type: "or", t: 1, a, b };
    a.parent = b.parent = x;
    return x;
  }

  return null;
}

function makeOrder(canBeOr = true) {
  return createOrder(Math.floor((canBeOr ? 5 : 4) * Math.random()));
}

// Every fifth order speeds the belt up. The eighth adds a fourth colour.
function makeMilestone() {
  const n = milestone++;
  const o = { type: "milestone", color: -1, t: 1 };
  if (n === 7) return Object.assign(o, { color: 2, action: () => colors++ });
  return Object.assign(o, { action: () => beltSpeed++ });
}

function popOrder(b) {
  // Half of an "or": clearing it clears the whole thing.
  if (b.parent !== undefined) {
    act(b.parent)
      .attr("t", 0, 0.3, ease.linear)
      .then(() => popOrder(b.parent));
    return;
  }
  score.value += 1;
  arrayRemove(belt, b);
}

// A block just shipped. Offer it to the order at the front of the belt.
function actBelt(piece, b = null) {
  if (belt.length === 0) return;

  const area = piece.w * piece.h;
  b ??= belt[belt.length - 1];

  if (b.type === "blocks") {
    if (b.color !== -1 && b.color !== piece.v) return;
    act(b)
      .then(() => {
        b.t = 1;
        b.count = area;
      })
      .attr("t", 0, 0.3, ease.linear)
      .then(() => {
        b.total -= area;
        b.count = 0;
        if (b.total <= 0) popOrder(b);
      });
    return;
  }

  if (b.type === "shape") {
    if (b.color !== -1 && b.color !== piece.v) return;
    if (b.width !== piece.w || b.height !== piece.h) return;
    act(b).attr("t", 0, 0.3, ease.linear).then(() => popOrder(b));
    return;
  }

  if (b.type === "bps") {
    if (b.color !== -1 && b.color !== piece.v) return;
    b.value = Math.min(b.max, b.value + area);
    if (b.value >= b.max) {
      act(b).attr("t", 0, 0.3, ease.linear).then(() => popOrder(b));
    }
    return;
  }

  if (b.type === "or") {
    actBelt(piece, b.a);
    actBelt(piece, b.b);
  }
}

// A "sync" clears once both boards have merged since the last check.
function actBeltMerge() {
  if (belt.length === 0) return;
  if (merges[0] === 0 || merges[1] === 0) return;

  const b = belt[belt.length - 1];
  const vs = [];
  if (b.type === "sync") vs.push(b);
  if (b.type === "or") {
    if (b.a.type === "sync") vs.push(b.a);
    if (b.b.type === "sync") vs.push(b.b);
  }

  for (const v of vs) {
    act(v).attr("t", 0, 0.3, ease.linear).then(() => popOrder(v));
  }
}

// Where the front of the belt is, in screen x. Zero is the left edge.
function beltFront() {
  return 1024 - STRIDE * SZ * (belt.length + beltPos - 1 - 0.3);
}

function updateBelt(dt) {
  const lp = beltFront();
  // While the belt is short it runs in fast, then settles to its real speed.
  beltPos += lp > 1024 - SZ * 0.9 ? dt : dt * beltSpeed / 100;

  if (beltPos >= 1) {
    beltPos -= 1;
    if (beltNext <= 0) {
      belt.unshift(makeMilestone());
      beltNext += 5;
    } else {
      belt.unshift(makeOrder());
      beltNext--;
    }
  }

  if (belt.length === 0) return;
  if (act.is()) return;

  if (lp <= 0) return gameOver({ score: true });

  // The last two units of room: the front order blinks, faster as it closes.
  if (lp <= 2 * SZ) {
    beltFlash = (beltFlash + dt * (1 + 19 * (1 - lp / (2 * SZ)))) % 2;
  } else {
    beltFlash = 0;
  }

  const b = belt[belt.length - 1];

  if (b.type === "milestone") {
    b.action();
    act(b)
      .delay(0.5)
      .attr("t", 0, 0.3, ease.quadIn)
      .then(() => popOrder(b));
    return;
  }

  const vs = [];
  if (b.type === "bps") vs.push(b);
  if (b.type === "or") {
    if (b.a.type === "bps") vs.push(b.a);
    if (b.b.type === "bps") vs.push(b.b);
  }
  for (const v of vs) v.value = Math.max(0, v.value - dt * v.speed);
}

// UPDATE ///

async function updateClick() {
  if (!input.just.act) return;

  const m = camera.toWorld(input.x, input.y);
  let hit = null;
  for (const b of [0, 1]) {
    const v = vec.floor(vec.div(vec.sub(m, BOARDPOS[b]), TILE));
    if (v.x < 0 || v.y < 0 || v.x >= WIDTH || v.y >= HEIGHT) continue;
    v.b = b;
    hit = v;
    break;
  }
  if (hit === null) return;

  const one = get(hit);
  if (one === null) return;
  selected[one.b] = one;

  if (one.w > 1 && one.h > 1) {
    one.removed = true;
    act(one)
      .attr("scale", 0, 0.3, ease.quadIn)
      .then(() => arrayRemove(board, one));
    actBelt(one);
    await promiseSleep(0.1);
    fallBlocks();
    selected[0] = selected[1] = null;
  }

  if (selected[0] !== null && selected[1] !== null) {
    const s0 = selected[0] === one ? selected[1] : selected[0];
    const s1 = one;

    [s0.v, s1.v] = [s1.v, s0.v];

    if (!isValidSwitch()) {
      [s0.v, s1.v] = [s1.v, s0.v];
    } else {
      // Only the colours moved, so animate each from where the other is back
      // to zero and the swap looks like two things crossing.
      const p0 = toScreen(s0);
      const p1 = toScreen(s1);
      s0.d = vec.sub(p1, p0);
      s1.d = vec.sub(p0, p1);

      const T = 0.35;
      act(s0.d)
        .attr("x", 0, T, ease.fastOutSlowIn)
        .attr("y", 0, T, ease.backOut(1.5));
      act(s1.d)
        .attr("x", 0, T, ease.fastOutSlowIn)
        .attr("y", 0, T, ease.backOut(1.5));

      // One dips under the other on the way past.
      act(s0)
        .attr("scale", 0.2, 0.35 * T, ease.linear).then()
        .attr("scale", 1, 0.65 * T, ease.linear);
      act(s1)
        .attr("scale", 1.8, 0.35 * T, ease.linear).then()
        .attr("scale", 1, 0.65 * T, ease.linear);

      await promiseSleep(T);
      needsMerge = true;
    }

    selected[0] = selected[1] = null;
  }

  for (const p of board) p.selected = selected[p.b] === p;
}

function updatePieces(dt) {
  for (const p of board) {
    if (p.selected) {
      p.scale = Math.max(0.7, p.scale - 2 * dt);
    } else if (p.scale < 1) {
      p.scale = Math.min(1, p.scale + 2 * dt);
    }
  }
}

export function update(dt) {
  updatePieces(dt);
  updateBelt(dt);
  updateClick();

  // Merge only once everything has settled, so a chain resolves in one go.
  if (act.is()) return;
  if (needsMerge) {
    merges[0] = merges[1] = 0;
    tryMergeBlocks();
    actBeltMerge();
    needsMerge = false;
  }
}

// RENDER ///

export function render(ctx) {
  camera.apply(ctx);

  // Shrinking blocks go under, growing ones on top, so a swap is drawn right.
  for (const p of board) {
    if (p.scale < 1) renderPiece(ctx, p);
  }
  for (const p of board) {
    if (p.scale === 1) renderPiece(ctx, p);
  }
  for (const p of board) {
    if (p.scale > 1) renderPiece(ctx, p);
  }

  renderBelt(ctx);
}

const B = 0.04347826 * 1.5;
const S = 0.04347826 * 1.3;

function renderPiece(ctx, p) {
  ctx.save();
  const vp = toScreen(p);
  ctx.translate(vp.x, vp.y);
  ctx.scale(TILE * p.scale, TILE * p.scale);
  ctx.translate(-p.w / 2, -p.h / 2);

  ctx.fillStyle = SIDE[p.v];
  ctx.beginPath();
  ctx.moveTo(p.w - B, B);
  ctx.lineTo(p.w - B + S, S + B);
  ctx.lineTo(p.w - B + S, p.h - B + S);
  ctx.lineTo(p.w - B, p.h - B);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = FOOT[p.v];
  ctx.beginPath();
  ctx.moveTo(p.w - B, p.h - B);
  ctx.lineTo(p.w - B + S, p.h - B + S);
  ctx.lineTo(S + B, p.h - B + S);
  ctx.lineTo(B, p.h - B);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = PIECE[p.v];
  ctx.fillRect(B, B, p.w - B * 2, p.h - B * 2);

  ctx.restore();
}

function renderBelt(ctx) {
  ctx.save();
  ctx.translate(0, BELT_Y);
  ctx.scale(SZ, SZ);

  let p = (beltPos - 1) * STRIDE;
  for (let i = 0; i < belt.length; ++i) {
    const b = belt[i];
    if (i === belt.length - 1 && Math.floor(beltFlash) === 1) break;
    ctx.save();
    ctx.translate(p, 0);
    renderOrder(ctx, b);
    ctx.restore();
    p += STRIDE;
  }

  ctx.restore();
}

function renderOrder(ctx, b) {
  if (b.type === "blocks") return renderBlocks(ctx, b);
  if (b.type === "shape") return renderShape(ctx, b);
  if (b.type === "bps") return renderBPS(ctx, b);
  if (b.type === "sync") return renderSync(ctx, b);
  if (b.type === "or") return renderOr(ctx, b);
  if (b.type === "milestone") return renderMilestone(ctx, b);
}

function renderMilestone(ctx, b) {
  ctx.globalAlpha = b.t;
  ctx.fillStyle = b.color === -1 ? meta.fg : SIDE[b.color];
  ctx.beginPath();
  for (let i = 0; i < 10; ++i) {
    const r = i % 2 === 0 ? 0.35 : 0.15;
    const f = i / 10 - 0.05;
    ctx.lineTo(0.5 + r * Math.cos(TAU * f), 0.5 + r * Math.sin(TAU * f));
  }
  ctx.fill();
}

function renderOr(ctx, b) {
  ctx.globalAlpha = b.t;
  for (const [half, dy] of [[b.a, -0.5], [b.b, 0.5]]) {
    ctx.save();
    ctx.translate(0.05, dy + 0.05);
    ctx.scale(0.9, 0.9);
    renderOrder(ctx, half);
    ctx.restore();
  }
}

// Two offset rectangles joined by a bar: the "both boards" mark.
function renderSync(ctx, b) {
  ctx.globalAlpha *= b.t;
  ctx.fillStyle = meta.fg;
  ctx.fillRect(8.35 / 51, 14.24 / 51, 13 / 51, 17 / 51);
  ctx.fillRect(29.65 / 51, 19.76 / 51, 13 / 51, 17 / 51);
  ctx.fillRect(22.49 / 51, 23.74 / 51, 6.03 / 51, 3.53 / 51);
}

function renderBPS(ctx, b) {
  ctx.globalAlpha *= b.t;
  ctx.fillStyle = ctx.strokeStyle = b.color === -1 ? meta.fg : SIDE[b.color];

  const v = b.value / b.max;
  ctx.fillRect(0.39, 0.96 - v * 0.92, 0.22, v * 0.92);
  ctx.lineWidth = 0.02;
  ctx.strokeRect(0.35, 0, 0.3, 1);
}

function renderShape(ctx, b) {
  ctx.globalAlpha *= b.t;
  ctx.fillStyle = b.color === -1 ? meta.fg : PIECE[b.color];

  const dx = (1 - b.width * 0.25) / 2;
  const dy = (1 - b.height * 0.25) / 2;
  for (let x = 0; x < b.width; ++x) {
    for (let y = 0; y < b.height; ++y) {
      ctx.fillRect(dx + x * 0.25 + 0.025, dy + y * 0.25 + 0.025, 0.2, 0.2);
    }
  }
}

// One outlined cell per tile owed. What a shipment covered fades out.
function renderBlocks(ctx, b) {
  const base = ctx.globalAlpha;
  ctx.fillStyle = ctx.strokeStyle = b.color === -1 ? meta.fg : SIDE[b.color];

  const dx = (1 - 0.25 * Math.ceil(b.total / 4)) / 2;
  for (let i = 0; i < b.total; ++i) {
    const y = i % 4;
    const x = (i - y) / 4;

    ctx.globalAlpha = base * (i >= b.total - b.count ? b.t : 1);
    ctx.lineWidth = 0.02;
    ctx.strokeRect(dx + x * 0.25 + 0.025, y * 0.25 + 0.025, 0.2, 0.2);
    ctx.fillRect(dx + x * 0.25 + 0.095, y * 0.25 + 0.095, 0.06, 0.06);
  }
  ctx.globalAlpha = base;
}
