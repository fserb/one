/*
ASYNC Arcade

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
let BELT_POS;
let BELT_SPEED;
let COLORS;
let BELT_DONE;
let BELT_NEXT;
const MERGE_COUNT = [0, 0];
let BELT_MILESTONE = 0;

function init() {
  BELT.length = 0;
  BOARD.length = 0;
  COLORS = 2;
  BELT_POS = 1;
  BELT_SPEED = 1;
  BELT_DONE = 0;
  BELT_NEXT = 1;
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

function toScreen(p) {
  const bp = BOARDPOS[p.b];
  return {
    x: p.d.x + bp.x + (p.w / 2 + p.x) * SIZE,
    y: p.d.y + bp.y + (p.h / 2 + p.y) * SIZE };
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
    MERGE_COUNT[b.b]++;

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
    actBelt(ONE);
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

function updatePieces(dt) {
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
}

function actBeltMerge() {
  if (BELT.length == 0) return;
  if (MERGE_COUNT[0] == 0 || MERGE_COUNT[1] == 0) return;

  const b = BELT[BELT.length - 1];

  let vs = [];
  if (b.type == "sync") vs.push(b);
  if (b.type == "or" && b.a.type == "sync") vs.push(b.a);
  if (b.type == "or" && b.b.type == "sync") vs.push(b.b);

  if (vs.length == 0) return;

  for (const v of vs) {
    act(v)
      .attr("t", 0, 0.3, ease.linear)
      .then(() => popBelt(v));
  }
}

function popBelt(b) {
  if (b.parent === undefined) {
    BELT_DONE++;
    BELT.pop();
  } else {
    act(b.parent)
      .attr("t", 0, 0.3, ease.linear)
      .then(() => popBelt(b.parent));
    }
}

function actBelt(piece, b = null) {
  if (BELT.length == 0) return;

  const area = piece.w * piece.h;
  b = b ?? BELT[BELT.length - 1];

  if (b.type == "blocks") {
    if (b.color == -1 || b.color == piece.v) {
      act(b)
        .then(() => { b.t = 1; b.count = area; })
        .attr("t", 0, 0.3, ease.linear)
        .then(() => {
          b.total -= area;
          b.count = 0;
          if (b.count >= b.total) {
            popBelt(b);
          }
        });
    }
    return;
  }

  if (b.type == "shape") {
    if (b.color == -1 || b.color == piece.v) {
      if (b.width == piece.w && b.height == piece.h) {
        act(b)
          .attr("t", 0, 0.3, ease.linear)
          .then(() => popBelt(b));
        }
    }
    return;
  }

  if (b.type == "bps") {
    if (b.color == -1 || b.color == piece.v) {
      b.value = Math.min(b.max, b.value + area);
      if (b.value >= b.max) {
        act(b)
          .attr("t", 0, 0.3, ease.linear)
          .then(() => popBelt(b));
        }
    }
  }

  if (b.type == "or") {
    actBelt(piece, b.a);
    actBelt(piece, b.b);
  }
}

function makeBeltRequest(canBeOr = true) {
  const maxtype = canBeOr ? 4 : 3;
  const type = Math.floor(maxtype * Math.random());

  if (type == 0) {
    return {
      type: "blocks",
      color: Math.random() < 0.5 ? -1 : Math.floor(COLORS * Math.random()),
      total: Math.floor(4 + 12 * Math.random()),
      count: 0,
      t: 0.0,
    };
  }

  if (type == 1) {
    let w = Math.random() < 0.75 ? 2 : Math.random() < 0.75 ? 3 : 4;
    let h = Math.random() < 0.75 ? 2 : Math.random() < 0.75 ? 3 : 4;
    if (w * h > 12) {
      if (w == 4) w = 3;
      if (h == 4) h = 3;
    }

    return {
      type: "shape",
      color: Math.random() < 0.5 ? -1 : Math.floor(COLORS * Math.random()),
      width: w,
      height: h,
      t: 1.0,
    };
  }

  if (type == 2) {
    return {
      type: "bps",
      color: Math.random() < 0.5 ? -1 : Math.floor(COLORS * Math.random()),
      max: 10 + BELT_SPEED * 0.1,
      value: 0,
      speed: 0.1 + 0.4 * Math.random(),
      t: 1.0,
    };
  }

  if (type == 3) {
    return {
      type: "sync",
      t: 1.0,
    }
  }

  if (type == 4) {
    const a = makeBeltRequest(false);
    const b = makeBeltRequest(false);
    const x = {
      type: "or",
      t: 1.0,
      a: a,
      b: b,
    }
    a.parent = b.parent = x;
    return x;
  }

  return null;
}

function makeBeltMilestone() {
  const act = BELT_MILESTONE++;

  const o = {type: "milestone", color: -1, t: 1};

  if (act == 0) return Object.assign(o, { action: () => BELT_SPEED++ });
  if (act == 1) return Object.assign(o, { color: 2, action: () => COLORS++ });
  if (act == 2) return Object.assign(o, { action: () => BELT_SPEED++ });
  if (act == 3) return Object.assign(o, { color: 3, action: () => COLORS++ });
  return Object.assign(o, { action: () => BELT_SPEED++ });
}

function updateBelt(dt) {
  BELT_POS += (BELT.length <= 1 || (BELT.length == 2 && BELT_POS < 0.1) ?
    dt * BELT_SPEED : (dt * BELT_SPEED / 100));

  if (BELT_POS >= 1) {
    BELT_POS -= 1;
    if (BELT_NEXT <= 0) {
      BELT.unshift(makeBeltMilestone());
      BELT_NEXT += 5;
    } else {
      BELT.unshift(makeBeltRequest());
      BELT_NEXT--;
    }
  }

  if (BELT.length == 0) return;

  if (act.is()) return;

  const b = BELT[BELT.length - 1];

  if (b.type == "milestone") {
    b.action();
    act(b)
      .attr("t", 0, 0.3, ease.quadIn)
      .then(() => popBelt(b));
    return;
  }

  let vs = [];
  if (b.type == "bps") vs.push(b);
  if (b.type == "or" && b.a.type == "bps") vs.push(b.a);
  if (b.type == "or" && b.b.type == "bps") vs.push(b.b);

  for (const v of vs) {
    v.value = Math.max(0, v.value - dt * v.speed);
  }
}

function update(dt) {
  updatePieces(dt);
  updateBelt(dt);
  updateClick();

  if (act.is()) return;
  if (NEEDS_MERGE) {
    MERGE_COUNT[0] = MERGE_COUNT[1] = 0;
    tryMergeBlocks();
    actBeltMerge();
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

  renderBelt(ctx);
}

const SZ = 100;
function renderBelt(ctx) {
  ctx.save();
  ctx.fillStyle = "red";
  ctx.translate(0, (290 + 44 - SZ) / 2);
  ctx.scale(SZ, SZ);


  let p = (BELT_POS - 1) * 1.2;
  for (const b of BELT) {
    if (b === null) continue;
    ctx.save();
    ctx.translate(p, 0);
    renderBeltUnit(ctx, b);
    ctx.restore();
    p+= 1.2;
  }

  ctx.restore();
}

function renderBeltUnit(ctx, b) {
  if (b.type == "blocks") renderBeltBlocks(ctx, b);
  else if (b.type == "shape") renderBeltShape(ctx, b);
  else if (b.type == "bps") renderBeltBPS(ctx, b);
  else if (b.type == "sync") renderBeltSync(ctx, b);
  else if (b.type == "or") renderBeltOR(ctx, b);
  else if (b.type == "milestone") renderMilestone(ctx, b);
}

function renderMilestone(ctx, b) {
  ctx.globalAlpha = b.t;
  ctx.fillStyle = b.color == -1 ? C.fg : C.piece[b.color];

  ctx.beginPath();
  for (let i = 0; i < 10; ++i) {
    const r = (i % 2 == 0) ? 0.35 : 0.15;
    const f = i / 10 - 0.05;
    ctx.lineTo(0.5 + r * Math.cos(Math.TAU * f),
    0.5 + r * Math.sin(Math.TAU * f));
  }
  ctx.fill();
}

function renderBeltOR(ctx, b) {
  ctx.globalAlpha = b.t;

  ctx.save();
  ctx.translate(0, -0.5);
  ctx.scale(0.9, 0.9);
  ctx.translate(0.05, 0.05);
  // ctx.fillStyle = "#DDD";
  // ctx.fillRect(0, 0, 1, 1);
  renderBeltUnit(ctx, b.a);
  ctx.restore();

  ctx.save();
  ctx.translate(0, 0.5);
  ctx.scale(0.9, 0.9);
  ctx.translate(0.05, 0.05);
  // ctx.fillStyle = "#DDD";
  // ctx.fillRect(0, 0, 1, 1);
  renderBeltUnit(ctx, b.b);
  ctx.restore();
}

function renderBeltSync(ctx, b) {
  ctx.globalAlpha *= b.t;
  ctx.fillStyle = C.fg;

  ctx.fillRect(11.21/51, 14.68/51, 13/51, 17/51);
  ctx.fillRect(26.79/51, 19.93/51, 13/51, 17/51);
  ctx.fillRect(23.32/51, 14.68/51, 9.97/51, 3/51);
  ctx.fillRect(17.71/51, 33.93/51, 9.97/51, 3/51);
}

function renderBeltBPS(ctx, b) {
  ctx.globalAlpha *= b.t;
  ctx.fillStyle = ctx.strokeStyle = b.color == -1 ? C.fg : C.piece[b.color];

  const v = b.value / b.max;

  ctx.fillRect(0.39, 0.96 - v * 0.92, 0.22, v * 0.92);


  ctx.lineWidth = 0.02;
  ctx.strokeRect(0.35, 0, 0.3, 1);
}

function renderBeltShape(ctx, b) {
  ctx.globalAlpha *= b.t;

  const dx = (1 - b.width * 0.25) / 2;
  const dy = (1 - b.height * 0.25) / 2;

  ctx.fillStyle = ctx.strokeStyle = b.color == -1 ? C.fg : C.piece[b.color];
  for (let x = 0; x < b.width; ++x) {
    for (let y = 0; y < b.height; ++y) {
      ctx.fillRect(dx + x * 0.25 + 0.025, dy + y * 0.25 + 0.025, 0.20, 0.20);
    }
  }
}

function renderBeltBlocks(ctx, b) {
  const base = ctx.globalAlpha;
  ctx.fillStyle = ctx.strokeStyle = b.color == -1 ? C.fg : C.piece[b.color];

  const dx = (1 - 0.25 * Math.ceil(b.total / 4)) / 2;

  for (let i = 0; i < b.total; ++i) {
    const y = i % 4;
    const x = (i - y) / 4;

    ctx.globalAlpha = base * ((i >= b.total - b.count) ? b.t : 1);
    ctx.lineWidth = 0.02;
    ctx.strokeRect(dx + x * 0.25 + 0.025, y * 0.25 + 0.025, 0.20, 0.20);
    ctx.fillRect(dx + x * 0.25 + 0.07 + 0.025, y * 0.25 + 0.07 + 0.025, 0.06, 0.06);
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

export default one.game(init, update, render);
