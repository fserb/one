/*
 * tentacles - a chase on a grid you can rearrange.
 *
 * You move one cell a turn, and so does every tentacle, but a tentacle leaves
 * its body behind and its body is wall. Crates are the only thing you can move:
 * push one into a gap and a tentacle goes the long way round, or pulls back. A
 * cornered tentacle tears a crate apart to get through.
 *
 * Grown from an unfinished sketch: the grid, the rigid crates and the flood
 * fill are its, the tentacle movement and the losing are not.
 */

import { ease, extra } from "./alma/src/index.js";
import {
  act,
  DOWN,
  gameOver,
  LEFT,
  mouse,
  RIGHT,
  score,
  SIZE,
  UP,
} from "./lib/one.js";
import {
  ADSR,
  biquad,
  bitcrush,
  envelope,
  linear,
  oscillator,
  ringmod,
  VSAJ,
} from "./lib/fsfx/fsfx.js";
import * as sound from "./lib/sound.js";

const { arrayShuffle, TAU } = extra;

export const meta = {
  title: "tentacles",
  desc: `
swipe to move
they leave their bodies behind
`,
  bg: "#9AAAB2",
  fg: "#2F3E46",
  scoreMax: true,
  finishGood: false,
  date: "2022-01-02",
};

const FLOOR = "rgba(47,62,70,0.10)";
const CRATE = "#C89F6D";
const CRATE_EDGE = "#9C7647";
const PLAYER = "#D64550";
const TENT = "#3C6E71";
const TENT_HEAD = "#82CED5";

const BAR = 44;
const W = 13;
const H = 13;
const CELL = 72;
const OX = (SIZE - W * CELL) / 2;
const OY = BAR + (SIZE - BAR - H * CELL) / 2;

// Every tentacle gains a segment this often, and a new one arrives this often.
const GROW = 6;
const SPAWN = 40;
const START_LEN = 4;

const DIRS = {
  [UP]: { x: 0, y: -1 },
  [RIGHT]: { x: 1, y: 0 },
  [DOWN]: { x: 0, y: 1 },
  [LEFT]: { x: -1, y: 0 },
};

const CRATE_SHAPES = [
  [[0, 0]],
  [[0, 0]],
  [[0, 0], [1, 0]],
  [[0, 0], [0, 1]],
  [[0, 0], [1, 0], [0, 1], [1, 1]],
  [[0, 0], [0, 1], [0, 2]],
  [[0, 0], [1, 0], [2, 0]],
  [[0, 0], [1, 0], [2, 0], [2, 1]],
  [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]],
];

let grid;
let player;
let tentacles;
let turn;
let dead;

sound.make("step", 0.09, (track) => {
  track(oscillator, { type: "sine", freq: linear(320, -140) });
  track(envelope, {
    env: ADSR({ attack: 0.005, release: 0.07, sustainv: 1, type: "exp" }),
  });
});

sound.make("push", 0.18, (track) => {
  track(oscillator, { type: "brown", amp: 0.7 });
  track(biquad, { type: "lowpass", freq: 700 });
  track(envelope, {
    env: ADSR({ attack: 0.01, release: 0.15, sustainv: 1, type: "linear" }),
  });
});

sound.make("crunch", 0.3, (track) => {
  track(oscillator, { type: "brown", amp: 1 });
  track(bitcrush, { sample: 6, bits: 6 });
  track(biquad, { type: "lowpass", freq: 1600 });
  track(envelope, {
    env: ADSR({ attack: 0.005, release: 0.28, sustainv: 1, type: "exp" }),
  });
});

sound.make("caught", 0.6, (track) => {
  track(oscillator, { type: "saw", freq: VSAJ(220, -160) });
  track(ringmod, { wet: 0.6, freq: 60 });
  track(biquad, { type: "lowpass", freq: 900 });
  track(envelope, {
    env: ADSR({ attack: 0.02, release: 0.5, sustainv: 1, type: "linear" }),
  });
});

// GRID ///

function get(x, y) {
  if (x < 0 || y < 0 || x >= W || y >= H) return null;
  return grid[x + y * W];
}

function relative(c, dir) {
  const d = DIRS[dir];
  return d ? get(c.x + d.x, c.y + d.y) : null;
}

function* neighbors(c) {
  for (const dir of [UP, RIGHT, DOWN, LEFT]) {
    const n = relative(c, dir);
    if (n !== null) yield n;
  }
}

function cellOf(entity) {
  for (const c of grid) {
    if (c.entity === entity) return c;
  }
  return null;
}

function blocked(c) {
  return c.entity !== null || c.tent !== null;
}

export function init() {
  grid = [];
  for (let y = 0; y < H; ++y) {
    for (let x = 0; x < W; ++x) {
      grid.push({ x, y, p: x + y * W, entity: null, tent: null, astar: -1 });
    }
  }

  // The player starts in the middle, with a clear ring around them.
  player = { crate: false, req: 0, dx: 0, dy: 0 };
  const mid = get((W - 1) / 2, (H - 1) / 2);
  mid.entity = player;

  const free = grid.filter((c) =>
    c !== mid && Math.abs(c.x - mid.x) + Math.abs(c.y - mid.y) > 2
  );
  arrayShuffle(free);
  for (let i = 0; i < 12; ++i) placeCrate(free);

  tentacles = [];
  turn = 0;
  dead = false;
  spawn();
  buildAStar();
}

// Laid over the first shuffled cell whose whole shape fits.
function placeCrate(free) {
  const shape = CRATE_SHAPES[Math.floor(CRATE_SHAPES.length * Math.random())];
  for (const c of free) {
    const cells = shape.map(([dx, dy]) => get(c.x + dx, c.y + dy));
    if (cells.some((v) => v === null || v.entity !== null)) continue;
    // One object shared by every cell, so the shape moves as one: they read the
    // same `req`, and each cell's move is legal because the one in front of it
    // is the same object, moving too.
    const crate = { crate: true, req: 0, dx: 0, dy: 0 };
    for (const v of cells) v.entity = crate;
    return;
  }
}

// A tentacle is a list of cells, head first, and the base is the last one.
function spawn() {
  const edge = grid.filter((c) =>
    (c.x === 0 || c.y === 0 || c.x === W - 1 || c.y === H - 1) && !blocked(c)
  );
  if (edge.length === 0) return;

  const base = edge[Math.floor(edge.length * Math.random())];
  const t = { cells: [base], len: START_LEN, grow: 1 };
  base.tent = t;
  tentacles.push(t);
}

// MOVEMENT ///

// The player shoves whatever crate is directly in front of them. A crate
// cannot shove another crate: doMove cancels the whole chain if it tries.
function doPush() {
  const c = cellOf(player);
  if (player.req === 0) return;
  const next = relative(c, player.req);
  if (next === null || next.entity === null || next.tent !== null) return;
  if (next.entity.crate) next.entity.req = player.req;
}

// Resolves every requested move at once. One that cannot happen clears its
// request and restarts the pass, so whatever relied on it gives up too.
function doMove() {
  const places = new Map();
  let repeat = true;
  while (repeat) {
    repeat = false;
    for (const c of grid) {
      if (c.entity === null) continue;
      if (c.entity.req === 0) {
        places.set(c.p, c.entity);
        continue;
      }
      const next = relative(c, c.entity.req);
      const stuck = next === null || next.tent !== null ||
        (next.entity !== null && next.entity.req === 0);
      if (stuck) {
        c.entity.req = 0;
        repeat = true;
        places.clear();
        break;
      }
      places.set(next.p, c.entity);
    }
  }

  const moved = new Map();
  for (const c of grid) {
    if (c.entity !== null && c.entity.req !== 0) moved.set(c.entity, c.entity.req);
  }

  for (const c of grid) c.entity = places.get(c.p) ?? null;

  for (const [e, dir] of moved) {
    e.req = 0;
    e.dx = -DIRS[dir].x * CELL;
    e.dy = -DIRS[dir].y * CELL;
    act(e)
      .attr("dx", 0, 0.12, ease.quadOut)
      .attr("dy", 0, 0.12, ease.quadOut);
  }
  return moved;
}

// One cell down the flood. True if the step lands on the player.
function stepTentacle(t) {
  const head = t.cells[0];

  let best = null;
  for (const n of neighbors(head)) {
    if (n.astar < 0) continue;
    if (best === null || n.astar < best.astar) best = n;
  }

  if (best === null) return breakThrough(t);
  if (best.astar === 0) return true;

  best.tent = t;
  t.cells.unshift(best);
  while (t.cells.length > t.len) t.cells.pop().tent = null;

  t.grow = 0;
  act(t).attr("grow", 1, 0.12, ease.quadOut);
  return false;
}

// Nowhere to go: tear open a neighbouring crate, or pull back a segment.
function breakThrough(t) {
  const head = t.cells[0];
  for (const n of neighbors(head)) {
    if (n.entity === null || !n.entity.crate) continue;
    n.entity = null;
    sound.play("crunch", (2 * Math.random() - 1) * 400);
    return false;
  }

  if (t.cells.length > 1) t.cells.pop().tent = null;
  return false;
}

// Steps out from the player through open cells. The player is 0; a tentacle
// body or a crate stays -1 and is not a route.
function buildAStar() {
  for (const c of grid) c.astar = -1;

  const seen = new Set();
  let beach = [cellOf(player)];
  let step = 0;
  while (beach.length > 0) {
    const next = [];
    for (const c of beach) {
      if (seen.has(c)) continue;
      seen.add(c);
      c.astar = step;
      for (const n of neighbors(c)) {
        if (seen.has(n) || blocked(n)) continue;
        next.push(n);
      }
    }
    beach = next;
    step++;
  }
}

// A swipe into a wall still costs a turn: without a way to wait, a boxed-in
// player freezes the game.
function tick(dir) {
  player.req = dir;
  doPush();
  const moved = doMove();
  sound.play(moved.size > 1 ? "push" : "step");

  turn++;
  score.value = turn;

  buildAStar();
  for (const t of tentacles) {
    if (!stepTentacle(t)) continue;
    dead = true;
    sound.play("caught");
    gameOver();
    return;
  }

  if (turn % GROW === 0) {
    for (const t of tentacles) t.len++;
  }
  if (turn % SPAWN === 0) spawn();

  buildAStar();
}

export function update() {
  if (dead) return;
  if (mouse.swipe === 0) return;
  tick(mouse.swipe);
}

// RENDER ///

function px(c) {
  return { x: OX + c.x * CELL, y: OY + c.y * CELL };
}

export function render(ctx) {
  ctx.strokeStyle = FLOOR;
  ctx.lineWidth = 2;
  for (const c of grid) {
    const { x, y } = px(c);
    ctx.strokeRect(x + 1, y + 1, CELL - 2, CELL - 2);
  }

  renderCrates(ctx);
  for (const t of tentacles) renderTentacle(ctx, t);
  renderPlayer(ctx);
}

// Cell by cell with no gap, so a crate reads as one slab, then a seam over
// every inner edge to show its parts.
function renderCrates(ctx) {
  ctx.fillStyle = CRATE;
  for (const c of grid) {
    if (c.entity === null || !c.entity.crate) continue;
    const { x, y } = px(c);
    ctx.fillRect(x + c.entity.dx, y + c.entity.dy, CELL, CELL);
  }

  ctx.strokeStyle = CRATE_EDGE;
  ctx.lineWidth = 4;
  for (const c of grid) {
    if (c.entity === null || !c.entity.crate) continue;
    const { x, y } = px(c);
    ctx.strokeRect(
      x + c.entity.dx + 2,
      y + c.entity.dy + 2,
      CELL - 4,
      CELL - 4,
    );
  }
}

function renderPlayer(ctx) {
  const c = cellOf(player);
  if (c === null) return;
  const { x, y } = px(c);

  ctx.fillStyle = PLAYER;
  ctx.fillCircle(
    x + player.dx + CELL / 2,
    y + player.dy + CELL / 2,
    CELL * 0.3,
  );
}

// One round-capped line down the body, tapering, head sliding out of the
// segment behind it.
function renderTentacle(ctx, t) {
  const pts = t.cells.map((c) => {
    const { x, y } = px(c);
    return { x: x + CELL / 2, y: y + CELL / 2 };
  });

  // The head is partway between where it was and where it just arrived.
  if (pts.length > 1) {
    const [a, b] = pts;
    pts[0] = {
      x: b.x + (a.x - b.x) * t.grow,
      y: b.y + (a.y - b.y) * t.grow,
    };
  }

  ctx.strokeStyle = TENT;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Wide pass for the body, narrow for the tail, so it thins towards the base.
  for (const [from, width] of [[0, CELL * 0.62], [pts.length >> 1, CELL * 0.4]]) {
    if (pts.length - from < 1) continue;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(pts[from].x, pts[from].y);
    for (let i = from + 1; i < pts.length; ++i) ctx.lineTo(pts[i].x, pts[i].y);
    if (pts.length - from === 1) ctx.lineTo(pts[from].x, pts[from].y);
    ctx.stroke();
  }

  ctx.fillStyle = TENT_HEAD;
  ctx.fillCircle(pts[0].x, pts[0].y, CELL * 0.17);

  ctx.fillStyle = TENT_HEAD;
  for (let i = 1; i < pts.length - 1; i += 2) {
    const a = pts[i - 1];
    const b = pts[i + 1];
    const nx = -(b.y - a.y);
    const ny = b.x - a.x;
    const l = Math.hypot(nx, ny) || 1;
    const s = (i % 4 === 1 ? 1 : -1) * CELL * 0.16;
    ctx.beginPath();
    ctx.ellipse(
      pts[i].x + nx / l * s,
      pts[i].y + ny / l * s,
      CELL * 0.07,
      CELL * 0.07,
      0,
      0,
      TAU,
    );
    ctx.fill();
  }

  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
}
