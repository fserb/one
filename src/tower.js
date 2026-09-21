/*
 * tower.
 *
 * A 7x10 board cut into regions, each numbered 1..n along a path through its
 * own cells. So a number says where the next one is: the cell numbered 4
 * touches the 3 and the 5 of its region, and the board is read by following
 * chains out of its 1s.
 *
 * A region is legal when its numbers run consecutively and each one touches the
 * one before it; being connected comes with that. The score is how many
 * committed regions are ones the generator cut, which is not the same as
 * filling the board: a board admits dozens of whole partitions it never cut.
 *
 * A region is drawn as one shape rather than a row of tiles: each cell fills
 * into the margin on the sides it has a neighbour on, and rounds off on the
 * sides it does not.
 */

import { register as registerSquircle } from "./alma/src/gfx/squircle.js";
import { gameOver, input, score } from "./lib/one.js";

export const meta = {
  title: "tower",
  bg: "#FFFFFF",
  fg: "#333333",
  scoreMax: true,
  date: "2025-08-27",
};

const WIDTH = 7;
const HEIGHT = 10;
const MARGIN = 12;

// The strip under the board, with the two buttons and the working set.
const STATUS_H = 120;
const PAD = 36;

// Whatever fits once the strip and the padding are off, which on a square is
// the height: 7x10 is the taller way up.
const CELL = Math.min(
  (1024 - 2 * PAD - (WIDTH - 1) * MARGIN) / WIDTH,
  (1024 - 2 * PAD - STATUS_H - (HEIGHT - 1) * MARGIN) / HEIGHT,
);
const GRID_W = WIDTH * CELL + (WIDTH - 1) * MARGIN;
const GRID_H = HEIGHT * CELL + (HEIGHT - 1) * MARGIN;
const X0 = (1024 - GRID_W) / 2;
const Y0 = PAD;

const STATUS_Y = Y0 + GRID_H + STATUS_H / 2;
const BTN_W = 170;
const BTN_H = 56;

const CELL_BG = "#F5F5F5";
const CELL_LINE = "#CCCCCC";
const HOVER_BG = "#EEEEEE";
const HOVER_LINE = "#999999";
const WORKING_BG = "#E6F3FF";
const INK = "#333333";
const GOOD = "#2ECC71";
const BAD = "#E74C3C";
const BUTTON = "#4A90E2";

// A region's fill, one per committed region in order.
const REGION = [
  "#FF6B6B",
  "#4ECDC4",
  "#45B7D1",
  "#96CEB4",
  "#FECA57",
  "#FF9FF3",
  "#54A0FF",
  "#5F27CD",
  "#00D2D3",
  "#FF9F43",
  "#74B9FF",
  "#A29BFE",
  "#FD79A8",
  "#FDCB6E",
  "#6C5CE7",
];

const MIN_REGION = 4;
const MAX_REGION = 9;

// How many ambiguous steps a board needs before it is worth playing, and how
// many cuts to look at for one.
const FORKS_MIN = 22;
const BOARD_TRIES = 8;

// A nine-cell blob has hundreds of numberings and the search does not need them
// all, only enough to choose between.
const PATHS_MAX = 200;

// Flattened here rather than drawn as an alpha: the shape is filled in
// overlapping passes, one a rounded corner, and a translucent fill would stack
// up darker wherever two of them cross.
function wash(hex, amount) {
  const c = parseInt(hex.slice(1), 16);
  const b = parseInt(meta.bg.slice(1), 16);
  let out = "#";
  for (let s = 16; s >= 0; s -= 8) {
    const v = (c >> s) & 255;
    const w = (b >> s) & 255;
    out += Math.round(w + (v - w) * amount).toString(16).padStart(2, "0");
  }
  return out;
}

const REGION_FILL = REGION.map((c) => wash(c, 0.25));

// The generator's cut: group id -> its cells, in the order they are numbered.
let solution = new Map();
let grid = [];

// The cells being dragged into shape, and the regions already committed.
let working = [];
let committed = [];
let nextId = 0;

let hovered = null;
// Fixed by the cell the drag started on, so one stroke does one thing and
// crossing a cell twice does not undo it.
let dragMode = null;
let dragLast = null;

function cellAt(x, y) {
  const col = Math.floor((x - X0) / (CELL + MARGIN));
  const row = Math.floor((y - Y0) / (CELL + MARGIN));
  if (row < 0 || row >= HEIGHT || col < 0 || col >= WIDTH) return null;
  return grid[row][col];
}

function cellX(x) {
  return X0 + x * (CELL + MARGIN);
}

function cellY(y) {
  return Y0 + y * (CELL + MARGIN);
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Every way to number a region: an order where each cell touches the one
// before, from each cell it could start at. A shape with none, a T or a plus,
// cannot be numbered and so is never cut. With one, the first found is enough.
function paths(cells, width, one = false) {
  const key = ([x, y]) => x + y * width;
  const shape = new Set(cells.map(key));
  const out = [];

  function walk(path, seen) {
    if (path.length === cells.length) {
      out.push([...path]);
      return;
    }

    const [x, y] = path[path.length - 1];
    // x is bounds-checked: x - 1 off the left edge keys the previous row's
    // right edge, which is not a neighbour. An out-of-range y keys nothing.
    for (const next of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (next[0] < 0 || next[0] >= width) continue;
      const k = key(next);
      if (!shape.has(k) || seen.has(k)) continue;

      seen.add(k);
      path.push(next);
      walk(path, seen);
      path.pop();
      seen.delete(k);
      if (out.length >= (one ? 1 : PATHS_MAX)) return;
    }
  }

  for (const cell of shuffle([...cells])) {
    walk([cell], new Set([key(cell)]));
    if (out.length >= (one ? 1 : PATHS_MAX)) break;
  }
  return out;
}

/*
 * The cut: a rectangle into orthogonally-connected regions under a per-size
 * quota. solve() always fills from the emptiest cell, since a cell with one
 * free neighbour has to be taken now or never. growSmartRegion() prefers the
 * candidate with the most neighbours, so a region encloses a gap rather than
 * going around it.
 *
 * Two shapes are rejected: one with no Hamiltonian path, a T or a plus, cannot
 * be numbered, and one a single row or column has no shape to play by.
 */
class GridFiller {
  constructor(width, height, constraints) {
    this.width = width;
    this.height = height;
    this.constraints = constraints;
    this.grid = Array.from({ length: height }, () => new Array(width).fill(0));
    this.groupId = 1;
    this.groups = new Map();
  }

  isInBounds(x, y, validValue = 0) {
    return x >= 0 && x < this.width && y >= 0 && y < this.height &&
      this.grid[y][x] === validValue;
  }

  getNeighbors(x, y, validValue = 0) {
    return [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]
      .filter(([nx, ny]) => this.isInBounds(nx, ny, validValue));
  }

  forEachCell(callback) {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        callback(x, y, this.grid[y][x]);
      }
    }
  }

  // -1 marks the region being grown, so a candidate can separate the cells it
  // has already taken from the cells still free.
  growSmartRegion(startX, startY, targetSize) {
    if (!this.isInBounds(startX, startY)) return null;

    const region = [[startX, startY]];
    this.grid[startY][startX] = -1;

    for (let i = 1; i < targetSize; i++) {
      const candidates = [];

      for (const [x, y] of region) {
        for (const [nx, ny] of this.getNeighbors(x, y)) {
          const emptyNeighbors = this.getNeighbors(nx, ny).length;
          const filledNeighbors = this.getNeighbors(nx, ny, -1).length;
          const neighborCount = emptyNeighbors + filledNeighbors;

          candidates.push({
            x: nx,
            y: ny,
            score: neighborCount + Math.random() * 0.5,
          });
        }
      }

      if (candidates.length === 0) {
        this.setRegion(region, 0);
        return null;
      }

      const chosen = candidates.sort((a, b) =>
        b.score - a.score
      )[Math.floor(Math.random() * Math.min(3, candidates.length))];
      region.push([chosen.x, chosen.y]);
      this.grid[chosen.y][chosen.x] = -1;
    }

    this.setRegion(region, 0);

    if (
      new Set(region.map(([x]) => x)).size === 1 ||
      new Set(region.map(([, y]) => y)).size === 1
    ) {
      return null;
    }

    return paths(region, this.width, true).length > 0 ? region : null;
  }

  // A list of cells, or the id that every cell to set already holds.
  setRegion(region, value) {
    if (Array.isArray(region)) {
      for (const [x, y] of region) {
        this.grid[y][x] = value;
      }
      return;
    }

    this.forEachCell((x, y, cellValue) => {
      if (cellValue === region) this.grid[y][x] = value;
    });
  }

  findEmptyRegions() {
    const visited = Array.from(
      { length: this.height },
      () => new Array(this.width).fill(false),
    );
    const regions = [];

    this.forEachCell((x, y, value) => {
      if (value !== 0 || visited[y][x]) return;

      const region = [];
      const queue = [[x, y]];
      visited[y][x] = true;

      while (queue.length > 0) {
        const [cx, cy] = queue.shift();
        region.push([cx, cy]);

        for (const [nx, ny] of this.getNeighbors(cx, cy)) {
          if (visited[ny][nx]) continue;
          visited[ny][nx] = true;
          queue.push([nx, ny]);
        }
      }

      regions.push(region);
    });

    return regions;
  }

  getCountForSize(size) {
    return Array.from(this.groups.values()).filter((r) => r.length === size)
      .length;
  }

  findBestEmptyCell() {
    let bestCell = null;
    let minNeighbors = Infinity;
    this.forEachCell((x, y, value) => {
      if (value !== 0) return;
      const emptyNeighbors = this.getNeighbors(x, y).length;
      if (emptyNeighbors >= minNeighbors) return;
      minNeighbors = emptyNeighbors;
      bestCell = [x, y];
    });
    return bestCell;
  }

  satisfiesMinConstraints() {
    const { minCountPerSize } = this.constraints;
    if (!minCountPerSize) return true;

    return Object.entries(minCountPerSize)
      .every(([size, minCount]) => this.getCountForSize(+size) >= minCount);
  }

  getAvailableSizes() {
    const sizes = [];
    const { minSize, maxSize, maxCountPerSize = {}, minCountPerSize = {} } =
      this.constraints;

    for (let size = minSize; size <= maxSize; size++) {
      const currentCount = this.getCountForSize(size);
      if (currentCount >= (maxCountPerSize[size] ?? Infinity)) continue;

      const minRequired = minCountPerSize[size] ?? 0;
      sizes.push({ size, priority: currentCount < minRequired });
    }

    return sizes
      .sort((a, b) => b.priority - a.priority)
      .map((s) => s.size)
      .sort(() => Math.random() - 0.5);
  }

  solve() {
    const nextEmpty = this.findBestEmptyCell();
    if (!nextEmpty) return this.satisfiesMinConstraints();

    const [x, y] = nextEmpty;

    for (const size of this.getAvailableSizes()) {
      const region = this.growSmartRegion(x, y, size);
      if (!region) continue;

      this.setRegion(region, this.groupId);
      this.groups.set(this.groupId, region);
      this.groupId++;

      if (this.solve()) return true;

      this.groupId--;
      this.setRegion(this.groupId, 0);
      this.groups.delete(this.groupId);
    }

    return false;
  }
}

// One cut of the board into shapes, or null when the search did not cover it.
function cut() {
  const filler = new GridFiller(WIDTH, HEIGHT, {
    minSize: MIN_REGION,
    maxSize: MAX_REGION,
    maxCountPerSize: { 4: 5, 5: 4, 6: 3, 7: 3, 8: 2, 9: 2 },
    minCountPerSize: { 4: 2, 6: 2 },
  });
  if (!filler.solve()) return null;

  return [...filler.groups.values()];
}

// Steps k -> k+1 where the k also touches a k+1 from another region, so the
// player has to choose. A board with few of them traces itself out of its 1s.
function forks(numbered) {
  const num = Array.from({ length: HEIGHT }, () => new Array(WIDTH).fill(0));
  for (const path of numbered) path.forEach(([x, y], i) => num[y][x] = i + 1);

  let count = 0;
  for (const path of numbered) {
    for (let i = 0; i + 1 < path.length; i++) {
      const [x, y] = path[i];
      const next = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]
        .filter(([nx, ny]) =>
          nx >= 0 && nx < WIDTH && ny >= 0 && ny < HEIGHT &&
          num[ny][nx] === i + 2
        );
      if (next.length > 1) count++;
    }
  }
  return count;
}

// The numbering is chosen, not rolled: a region takes the numbering that puts
// the most of its numbers beside the same number in another region, one region
// at a time, until a pass moves nothing. That is twice the forks of a random
// numbering, and what a solver that only takes forced cells can cover drops
// from half the board to an eighth.
function number(shapes) {
  const options = shapes.map((cells) => paths(cells, WIDTH));
  const choice = options.map((ps) => ps[Math.floor(Math.random() * ps.length)]);

  for (let pass = 0; pass < shapes.length; pass++) {
    let moved = false;
    for (let i = 0; i < choice.length; i++) {
      let best = choice[i];
      let most = forks(choice);
      for (const p of options[i]) {
        choice[i] = p;
        const count = forks(choice);
        if (count <= most) continue;
        most = count;
        best = p;
        moved = true;
      }
      choice[i] = best;
    }
    if (!moved) break;
  }

  return choice;
}

function build() {
  let best = null;
  for (let i = 0; i < BOARD_TRIES || !best; i++) {
    const shapes = cut();
    if (!shapes) continue;

    const numbered = number(shapes);
    const count = forks(numbered);
    if (!best || count > best.forks) best = { numbered, forks: count };
    if (count >= FORKS_MIN) break;
  }

  solution = new Map(
    best.numbered.map((path, id) => [id + 1, {
      cells: path.map(([x, y]) => ({ x, y })),
      size: path.length,
    }]),
  );

  grid = Array.from({ length: HEIGHT }, () => new Array(WIDTH).fill(null));
  for (const [id, group] of solution) {
    group.cells.forEach(({ x, y }, i) => {
      grid[y][x] = {
        x,
        y,
        number: i + 1,
        groupId: id,
        isSelected: false,
        isCommitted: false,
        committedId: -1,
      };
    });
  }
}

// A run of consecutive numbers, each touching the one before, which leaves the
// region connected without asking. It need not start at 1: a leftover 3-4-5
// commits and scores nothing, and without that a board gone wrong strands cells
// nothing legal can take.
function isValid(group) {
  if (group.length === 0) return false;

  const order = [...group].sort((a, b) => a.number - b.number);
  for (let i = 1; i < order.length; i++) {
    if (order[i].number !== order[0].number + i) return false;
    const step = Math.abs(order[i].x - order[i - 1].x) +
      Math.abs(order[i].y - order[i - 1].y);
    if (step !== 1) return false;
  }

  return true;
}

// The generator's group id this region reproduces, or 0 for none.
function originalOf(group) {
  for (const [id, s] of solution) {
    if (s.size !== group.length) continue;
    const same = s.cells.every((sc) =>
      group.some((c) => c.x === sc.x && c.y === sc.y)
    );
    if (same) return id;
  }
  return 0;
}

function clearWorking() {
  for (const c of working) c.isSelected = false;
  working = [];
}

function commit() {
  if (!isValid(working)) return false;

  const region = {
    cells: [...working],
    original: originalOf(working),
    color: committed.length % REGION.length,
    id: nextId++,
  };

  for (const c of working) {
    c.isSelected = false;
    c.isCommitted = true;
    c.committedId = region.id;
  }
  committed.push(region);
  working = [];

  let full = 0;
  for (const row of grid) {
    for (const c of row) {
      if (c?.isCommitted) full++;
    }
  }
  if (full === WIDTH * HEIGHT) {
    score.value = committed.filter((r) => r.original !== 0).length;
    gameOver({ win: true, score: true });
  }

  return true;
}

// Back into the working set, so a wrong partition is taken apart in place.
function decommit(region) {
  committed.splice(committed.indexOf(region), 1);
  clearWorking();

  for (const rc of region.cells) {
    const c = grid[rc.y][rc.x];
    c.isSelected = true;
    c.isCommitted = false;
    c.committedId = -1;
    working.push(c);
  }
}

function toggle(cell) {
  if (cell.isCommitted) {
    const region = committed.find((r) => r.id === cell.committedId);
    if (!region) return;
    // Committed first when it is legal and dropped when it is not: two half-built
    // regions at once has no meaning.
    if (working.length > 0 && !commit()) clearWorking();
    decommit(region);
    return;
  }

  const i = working.indexOf(cell);
  if (i !== -1) {
    working.splice(i, 1);
    cell.isSelected = false;
    return;
  }

  working.push(cell);
  cell.isSelected = true;
}

function inBox(x, y, bx, by, bw, bh) {
  return x >= bx && x <= bx + bw && y >= by && y <= by + bh;
}

function clearBtn() {
  return { x: X0, y: STATUS_Y - BTN_H / 2, w: BTN_W, h: BTN_H };
}

function commitBtn() {
  return {
    x: X0 + GRID_W - BTN_W,
    y: STATUS_Y - BTN_H / 2,
    w: BTN_W,
    h: BTN_H,
  };
}

function click(x, y) {
  if (working.length > 0) {
    const b = clearBtn();
    if (inBox(x, y, b.x, b.y, b.w, b.h)) {
      clearWorking();
      return;
    }
  }

  if (working.length > 0 && isValid(working)) {
    const b = commitBtn();
    if (inBox(x, y, b.x, b.y, b.w, b.h)) {
      commit();
      return;
    }
  }

  const cell = cellAt(x, y);
  if (cell) toggle(cell);
}

export function init() {
  registerSquircle();

  working = [];
  committed = [];
  nextId = 0;
  hovered = null;
  dragMode = null;
  dragLast = null;
  score.value = 0;

  build();
}

export function update() {
  hovered = cellAt(input.x, input.y);

  if (input.just.act) {
    if (hovered && !hovered.isCommitted) {
      dragMode = hovered.isSelected ? "remove" : "add";
    }
    click(input.x, input.y);
    dragLast = hovered;
  }

  if (input.press.act && dragMode && hovered && hovered !== dragLast) {
    dragLast = hovered;
    if (!hovered.isCommitted) {
      if (dragMode === "add" && !hovered.isSelected) {
        working.push(hovered);
        hovered.isSelected = true;
      } else if (dragMode === "remove" && hovered.isSelected) {
        working.splice(working.indexOf(hovered), 1);
        hovered.isSelected = false;
      }
    }
  }

  if (!input.press.act) {
    dragMode = null;
    dragLast = null;
  }
}

// It fills into half the margin on every side it has a neighbour on, and rounds
// the corners where neither of the two sides meeting there is connected. A
// corner is cut and not covered: board colour goes over the corner square first
// and a full-cell squircle is filled through it, so the fill has to be opaque.
function regionCell(ctx, cell, set, fill) {
  const half = MARGIN / 2;
  const r = CELL * 0.5;

  const hasLeft = cell.x > 0 && set.has(cell.x - 1 + cell.y * WIDTH);
  const hasRight = cell.x < WIDTH - 1 && set.has(cell.x + 1 + cell.y * WIDTH);
  const hasUp = cell.y > 0 && set.has(cell.x + (cell.y - 1) * WIDTH);
  const hasDown = cell.y < HEIGHT - 1 &&
    set.has(cell.x + (cell.y + 1) * WIDTH);

  const x = cellX(cell.x) - (hasLeft ? half : 0);
  const y = cellY(cell.y) - (hasUp ? half : 0);
  const w = CELL + (hasLeft ? half : 0) + (hasRight ? half : 0);
  const h = CELL + (hasUp ? half : 0) + (hasDown ? half : 0);

  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);

  const corners = [
    [!hasLeft && !hasUp, x, y],
    [!hasRight && !hasUp, x + w - r, y],
    [!hasRight && !hasDown, x + w - r, y + h - r],
    [!hasLeft && !hasDown, x, y + h - r],
  ];

  for (const [cut, cx, cy] of corners) {
    if (!cut) continue;
    ctx.fillStyle = meta.bg;
    ctx.fillRect(cx, cy, r, r);
    ctx.fillStyle = fill;
    // A whole cell, placed so the corner it rounds is the one just painted
    // over.
    ctx.squircle(
      cx === x ? x : cx - r,
      cy === y ? y : cy - r,
      r * 2,
      r * 2,
      r,
      2,
    );
    ctx.fill();
  }
}

function regionArea(ctx, cells, fill) {
  if (cells.length === 0) return;
  const set = new Set(cells.map((c) => c.x + c.y * WIDTH));
  for (const c of cells) regionCell(ctx, c, set, fill);
}

function button(ctx, text, b) {
  ctx.fillStyle = BUTTON;
  ctx.squircle(b.x, b.y, b.w, b.h, 14, 2);
  ctx.fill();
  ctx.fillStyle = "#FFFFFF";
  ctx.text(text, b.x + b.w / 2, b.y + b.h / 2, 22);
}

export function render(ctx) {
  regionArea(ctx, working, WORKING_BG);
  for (const r of committed) regionArea(ctx, r.cells, REGION_FILL[r.color]);

  for (const row of grid) {
    for (const cell of row) {
      if (!cell) continue;
      const x = cellX(cell.x);
      const y = cellY(cell.y);

      // A cell in a region already has its background from regionArea().
      if (!cell.isSelected && !cell.isCommitted) {
        const on = cell === hovered;
        ctx.fillStyle = on ? HOVER_BG : CELL_BG;
        ctx.squircle(x, y, CELL, CELL, CELL * 0.5, 2);
        ctx.fill();
        ctx.strokeStyle = on ? HOVER_LINE : CELL_LINE;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      ctx.fillStyle = INK;
      ctx.text(`${cell.number}`, x + CELL / 2, y + CELL / 2, CELL * 0.4);
    }
  }

  if (working.length === 0) return;

  const valid = isValid(working);
  button(ctx, "clear", clearBtn());
  if (valid) button(ctx, "commit", commitBtn());

  const numbers = working.map((c) => c.number).sort((a, b) => a - b);
  ctx.fillStyle = valid ? GOOD : BAD;
  ctx.text(`[${numbers.join(", ")}]`, 512, STATUS_Y - 12, 24);
  if (valid) {
    ctx.fillStyle = GOOD;
    ctx.text("a region", 512, STATUS_Y + 18, 18);
  }
}
