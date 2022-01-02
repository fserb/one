/*

- water
- tentacles

- undo
*/
import * as one from "./one/one.js";
import {act, ease, mouse, vec} from "./one/one.js";

one.description("name", `
instructions
`);

const L = {
  bg: "#888",
  fg: "#82CED5",
  // bg: C[0],
  // fg: C.black,
};

one.options({
  bgColor: L.bg,
  fgColor: L.fg,
});

const PLAYER = 1;
const BOX = 2;
const TENTACLE = 3;

const UP = 1;
const RIGHT = 2;
const DOWN = 3;
const LEFT = 4;

const width = 16;
const height = 16;
const grid = [];
let player = null;

function find(type) {
  for (const c of grid) {
    if (c.entity && c.entity.e == type) return c;
  }
  return null;
}

function get(x, y) {
  if (x < 0 || y < 0 || x >= width || y >= height) return null;
  return grid[x + y * width];
}

function getRelative(cell, dir) {
  if (dir == UP) return get(cell.x, cell.y - 1);
  if (dir == RIGHT) return get(cell.x + 1, cell.y);
  if (dir == DOWN) return get(cell.x, cell.y + 1);
  if (dir == LEFT) return get(cell.x - 1, cell.y);
  return null;
}

function *neighbors(c) {
  for (let i = 1; i <= 4;++i) {
    const e = getRelative(c, i);
    if (e !== null) yield e;
  }
}

function init() {
  grid.length = 0;
  for (let y = 0; y < height; ++y) {
    for (let x = 0; x < width; ++x) {
      grid.push({x, y, p: x + y * width, floor: 0, entity: null});
    }
  }
  player = get(5, 5).entity = {e: PLAYER, req: 0};
  get(10, 5).entity = {e: BOX, req: 0};

  get(12, 6).entity = get(12,7).entity = get(11, 7).entity =
  get(10, 7).entity = get(10, 6).entity =
    {e: BOX, req: 0};

  get(9, 12).entity = {e: TENTACLE, max: 4, head: get(9, 12)};

  buildAStar();
  tick();
}

function doMove() {
  const places = new Map();
  let repeat = true;
  while (repeat) {
    repeat = false;
    for (const c of grid) {
      if (c.entity === null) continue;
      if (c.entity.req == 0) {
        places.set(c.p, c.entity);
        continue;
      }
      const next = getRelative(c, c.entity.req);
      if (next == null || (next.entity != null && next.entity.req == 0)) {
        c.entity.req = 0;
        repeat = true;
        places.clear();
        break;
      }
      places.set(next.p, c.entity);
    }
  }
  for (const c of grid) {
    c.entity = places.get(c.p) ?? null;
    if (c.entity) c.entity.req = 0;
  }
}

function doPush() {
  for (const c of grid) {
    if (c.entity === null) continue;
    if (c.entity.e !== PLAYER) continue;
    if (c.entity.req == 0) continue;
    const next = getRelative(c, c.entity.req);
    if (next == null || !next.entity || next.entity.req != 0) continue;
    if (next.entity.e == BOX) {
      next.entity.req = c.entity.req;
    }
  }
}

function getTentTarget(t) {
  let c = t.entity.head;
  let step = -1;
  while (++step < t.entity.max) {
    let best = null;
    for (const o of neighbors(c)) {
      if (o.astar < 0) continue;
      if (best == null) {
        best = o;
        continue;
      }
      if (best.astar > o.astar) {
        best = o;
        continue;
      }
      if (best.astar > o.astar) {
        best = o;
      }
    }
    c = best;
    if (best.astar == 0) break;
  }

  return c;
}

function doTentacle() {
  const tents = new Set();
   for (const c of grid) {
    if (c.entity === null || c.entity.e !== TENTACLE) continue;
    tents.add(c);
  }

  buildAStar();

  for (const t of tents) {
    const target = getTentTarget(t);
    console.log(target);
  }
}

function tick() {
  doPush();
  doTentacle();
  doMove();
  buildAStar();
}

function update(dt) {
  if (mouse.swipe == 0) return;

  player.req = mouse.swipe;

  tick();
}

function render(ctx) {
  for (const c of grid) {
    if (c.entity === null) continue;
    if (c.entity.e == PLAYER) {
      ctx.fillStyle = "#BB0044";
      ctx.fillCircle(130 + c.x * 48 + 24, 150 + c.y * 48 + 24, 17);
    } else if (c.entity.e == BOX) {
      ctx.fillStyle = "#440000";
      ctx.fillRect(130 + c.x * 48, 150 + c.y * 48, 48, 48);
    } else if (c.entity.e == TENTACLE) {
      ctx.fillStyle = "#222";
      ctx.fillRoundRect(134 + c.x * 48, 154 + c.y * 48, 40, 40, 16);
    }
  }

  ctx.fillStyle = ctx.strokeStyle = "rgba(255,255,255,0.2)";
  for (const c of grid) {
    ctx.strokeRect(130 + c.x * 48, 150 + c.y * 48, 48, 48);
    ctx.text(c.astar ?? -1, 130 + c.x * 48 + 10, 150 + c.y * 48 + 10, 14);
  }
}

function buildAStar() {
  let beach = [];
  for (const c of grid) {
    c.astar = -1;
    if (c.entity && c.entity.e == PLAYER) beach.push(c);
  }

  const visited = new Set();
  let step = 0;
  while (beach.length > 0) {
    let next = [];
    for (const v of beach) {
      if (visited.has(v)) continue;
      if (v.entity !== null && v.entity.e !== PLAYER) continue;
      v.astar = step;
      visited.add(v);
      for (const n of neighbors(v)) {
        if (n.entity !== null || visited.has(n)) continue;
        next.push(n);
      }
    }
    beach = next;
    step++;
  }
}

export default one.game(init, update, render);
