/*
ASYNC Arcade

- request belt

- requests:
  - number of individual blocks, generic or color
  - certain shape, generic or color
  - blocks per second
  - sync creation
  - request OR request

- milestones:
  - add color 3, 4
  - add speed

*/

import * as one from "./one/one.js";
import {act, ease, mouse, vec} from "./one/one.js";

one.description("async", `
Swap blocks on each side
to create mega blocks.
Clear the request train
`);

const C = {
  bg: "#FFFFFF",
  fg: "#424B54",
  // pink, blue, yellow
  piece: [ "#F02299", "#26ABF6", "#FCFF00", '#16DB93' ],
  shadowR: [ "#B6187E", "#1D7ACA", "#BFB702", '#109E79' ],
  shadowB: [ "#650B57", "#0F378C", "#6C5300", '#094754' ],
};

one.options({
  bgColor: C.bg,
  fgColor: C.fg,
});

const BOARD = [];
const WIDTH = 4;
const HEIGHT = 6;
const SIZE = 120;
const BOARDPOS = [ {x: 10, y: 290}, {x: 1024 - SIZE * 4 - 10, y: 290} ];
const SELECTED = [null, null];
const GRAVITY = {x: 1, y: 0};
let NEEDS_MERGE = false;
const BELT = [];
let BELT_SPEED = 1;
let COLORS = 2;

function init() {
  BELT.length = 0;
  BOARD.length = 0;
  SELECTED[0] = SELECTED[1] = null;

  fillEmpty();
}

function createBlock(p) {
  const o = Object.assign({
    b: -1, x: -1, y: -1,
    v: Math.floor(COLORS * Math.random()),
    w: 1, h: 1,
    d: {x: 0, y: 0},
    scale: 1,
    selected: false,
    removed: false,
  }, p);
  BOARD.push(o);
  return o;
}

function fillEmpty(step = 0) {
  let added = false;
  for (let b = 0; b < 2; ++b) {
    GRAVITY.x = Math.abs(GRAVITY.x) * (b == 0 ? 1 : -1);

    const start = {
      b: b,
      x: Math.abs(GRAVITY.x * (1 - GRAVITY.x)) * (WIDTH - 1) / 2,
      y: Math.abs(GRAVITY.y * (1 - GRAVITY.y)) * (HEIGHT - 1) / 2
    };
    const dir = {x: Math.abs(GRAVITY.y), y: Math.abs(GRAVITY.x)};

    // technically Math.max(WIDTH, HEIGHT)
    for (let s = 0; s < HEIGHT; ++s) {
      const p = add(start, vec.mul(dir, s));
      if (p.x < 0 || p.y < 0 || p.x >= WIDTH || p.y >= HEIGHT) continue;
      const n = get(p);
      if (n !== null) continue;
      const o = createBlock(p);
      o.x -= GRAVITY.x;
      o.y -= GRAVITY.y;
      o.d = vec.mul(GRAVITY, -step * SIZE);
      added = true;
    }
  }

  if (added) {
    fallBlocks(step + 1);
  }
}

function checkCanFall(p) {
  const b = get(p);
  let step = 0;
  let check = b;
  while (check === null || check === b) {
    const n = add(p, vec.mul(GRAVITY, ++step));
    if (n.x < 0 || n.y < 0 || n.x >= WIDTH || n.y >= HEIGHT) break;
    check = get(n);
  }
  return step - 1;
}

async function fallBlocks(fillstep = 0) {
  let changed = false;

  for (const b of BOARD) {
    GRAVITY.x = Math.abs(GRAVITY.x) * (b.b == 0 ? 1 : -1);

    let step = 100;
    for (let x = b.x; x < b.x + b.w; ++x) {
      for (let y = b.y; y < b.y + b.h; ++y) {
        step = Math.min(step, checkCanFall({b: b.b, x, y}));
      }
    }
    if (step == 0) continue;

    b.x += GRAVITY.x * step;
    b.y += GRAVITY.y * step;
    b.d.x -= SIZE * GRAVITY.x * step;
    b.d.y -= SIZE * GRAVITY.y * step;
    act(b.d)
      .attr("x", 0, 0.4, ease.quadIn)
      .attr("y", 0, 0.4, ease.quadIn);
    changed = true;
  }

  if (changed) {
    return await fallBlocks(fillstep);
  }
  // await Promise.sleep(0.0);
  fillEmpty(fillstep);
  await Promise.sleep(0.4);
  one.camera.shake(0.05 + 0.05 * fillstep, 100);
  NEEDS_MERGE = true;
}

function inRect(r, p) {
  if (r.b !== p.b) return false;
  if (p.x < r.x) return false;
  if (p.y < r.y) return false;
  if (p.x >= r.x + r.w) return false;
  if (p.y >= r.y + r.h) return false;
  return true;
}

function add(p, d) {
  return {b: p.b, x: p.x + d.x, y: p.y + d.y};
}

function get(p) {
  // argh. Even if there's only 2 * 4 * 6 = 48 pieces... maybe not O(n) would
  // be nice?
  for (const o of BOARD) {
    if (o.removed) continue;
    if (inRect(o, p)) return o;
  }
return null;
}

function isValidResize(b, dx, dy) {
  const maxx = b.x + b.w + dx;
  const maxy = b.y + b.h + dy;
  for (let x = b.x; x < maxx; ++x) {
    for (let y = b.y; y < maxy; ++y) {
      const n = get({b:b.b, x, y});
      if (!n || n.v != b.v) return false;

      if (n.x + n.w > maxx) return false;
      if (n.y + n.h > maxy) return false;

      if (n.x < b.x) return false;
      if (n.y < b.y) return false;
    }
  }
  return true;
}

function getMaxSquare(b) {
  const expand = {x: 0, y: 0};
  let bestArea = 4;

  for (let dx = 0; dx <= (WIDTH - (b.x + b.w)); dx++) {
    for (let dy = 0; dy <= (HEIGHT - (b.y + b.h)); dy++) {
      const area = (dx + b.w) * (dy + b.h);
      if (dx + b.w == 1 || dy + b.h == 1) continue;
      if (bestArea > area) continue;
      if (bestArea == area && dy <= expand.y) continue;
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

function tryMergeBlocks() {
  for (const b of BOARD) {
    const exp = getMaxSquare(b);
    if (exp.x == 0 && exp.y == 0) continue;

    for (let x = b.x; x < b.x + b.w + exp.x; x++) {
      for (let y = b.y; y < b.y + b.h + exp.y; y++) {
        const n = get({b: b.b, x, y});
        if (n === null || n === b) continue;
        BOARD.remove(n);
      }
    }
    b.w += exp.x;
    b.h += exp.y;

    return tryMergeBlocks();
  }
}

function isValidSwitch() {
  return BOARD.some(canGrow);
}

async function updateClick() {
  if (!mouse.click) return;

  const m = one.camera.map(mouse);
  let clickBoard = null;
  let mb = null;
  for (const b of [0, 1]) {
    const bp = BOARDPOS[b];
    const v = vec.floor(vec.div(vec.sub(m, bp), SIZE));
    if (v.x < 0 || v.y < 0 || v.x >= WIDTH || v.y >= HEIGHT) continue;
    clickBoard = b;
    mb = v;
    mb.b = b;
    break;
  }

  if (clickBoard == null) return;

  let ONE = null;
  for (const p of BOARD) {
    if (p.b != clickBoard) continue;
    if (inRect(p, mb)) {
      SELECTED[p.b] = ONE = p;
      break;
    }
  }

  if (ONE.w > 1 && ONE.h > 1) {
    ONE.removed = true;
    act(ONE).attr("scale", 0, 0.3, ease.quadIn)
      .then(() => {
        BOARD.remove(ONE);
      });
    await Promise.sleep(0.1);
    fallBlocks();
    SELECTED[0] = SELECTED[1] = null;
  }

  if (SELECTED[0] !== null && SELECTED[1] !== null) {
    const s0 = SELECTED[0] == ONE ? SELECTED[1] : SELECTED[0];
    const s1 = ONE;

    [s0.v, s1.v] = [s1.v, s0.v];

    if (!isValidSwitch()) {
      [s0.v, s1.v] = [s1.v, s0.v];
    } else {
      const p0 = toScreen(s0);
      const p1 = toScreen(s1);

      s0.d = vec.sub(p1, p0);
      s1.d = vec.sub(p0, p1);


      const T = 0.35;
      act(s0.d)
        .attr("x", 0, T, ease.fastOutSlowIn)
        .attr("y", 0, T, ease.backOut(1.5));

      act(s0)
        .attr("scale", 0.2, 0.35 * T, ease.linear).then()
        .attr("scale", 1, 0.65 * T, ease.linear);

      act(s1.d)
      .attr("x", 0, 1 * T, ease.fastOutSlowIn)
      .attr("y", 0, 1 * T, ease.backOut(1.5));

      act(s1)
      .attr("scale", 1.8, 0.35 * T, ease.linear).then()
      .attr("scale", 1, 0.65 * T, ease.linear);

      await Promise.sleep(T);
      NEEDS_MERGE = true;
    }

    SELECTED[0] = SELECTED[1] = null;
  }

  for (const p of BOARD) {
    p.selected = SELECTED[p.b] === p;
  }
}

function update(dt) {
  for (const p of BOARD) {
    if (!p.selected) {
      if (p.scale < 1) {
        p.scale = Math.min(1, p.scale + 2 * dt);
      }
    } else {
      if (p.scale > 0.7) {
        p.scale = Math.max(0.7, p.scale - 2 * dt);
      }
    }
  }

  updateClick();

  if (act.is()) return;

  if (NEEDS_MERGE) {
    tryMergeBlocks();
    NEEDS_MERGE = false;
  }
}

function render(ctx) {
  one.camera.transform(ctx);
  const pre = [], mid = [], post = [];
  for (const p of BOARD) {
    if (p.scale < 1) pre.push(p);
    else if (p.scale > 1) post.push(p);
    else mid.push(p);
  }

  for (const p of pre) {
    renderPiece(ctx, p);
  }
  for (const p of mid) {
    renderPiece(ctx, p);
  }
  for (const p of post) {
    renderPiece(ctx, p);
  }
}

const B = 0.04347826 * 1.5;
const S = 0.04347826 * 1.3;
function renderPiece(ctx, p) {
  ctx.save();
  const vp = toScreen(p);
  ctx.translate(vp.x, vp.y);
  ctx.scale(SIZE * p.scale, SIZE * p.scale);
  ctx.translate(-p.w / 2, -p.h / 2);

  ctx.fillStyle = C.shadowR[p.v];
  ctx.beginPath();
  ctx.moveTo(p.w - B, B);
  ctx.lineTo(p.w - B + S, S + B);
  ctx.lineTo(p.w - B + S, p.h - B + S);
  ctx.lineTo(p.w - B, p.h - B);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = C.shadowB[p.v];
  ctx.beginPath();
  ctx.lineTo(p.w - B, p.h - B);
  ctx.lineTo(p.w - B + S, p.h - B + S);
  ctx.lineTo(S + B, p.h - B + S);
  ctx.lineTo(B, p.h - B);
  ctx.lineTo(p.w - B, p.h - B);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = C.piece[p.v];
  ctx.fillRect(B , B, p.w - B * 2, p.h - B * 2);

  ctx.restore();
}

function toScreen(p) {
  const bp = BOARDPOS[p.b];
  return {
    x: p.d.x + bp.x + (p.w / 2 + p.x) * SIZE,
    y: p.d.y + bp.y + (p.h / 2 + p.y) * SIZE };
}

export default one.game(init, update, render);
