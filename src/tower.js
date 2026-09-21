/*
 * tower.
 *
 * A 7x10 board cut into regions, each numbered 1..n along a path through its
 * own cells. So a number says where the next one is: the cell numbered 4
 * touches the 3 and the 5 of its region, and the board is read by following
 * chains out of its 1s.
 *
 * A region is legal when its numbers run 1..n and each one touches the one
 * before it; being connected comes with that. A board is only kept when one
 * set of regions covers it and no other, so it has a single answer and the
 * score is the seconds it took.
 *
 * The groups are the whole of the state: a drag puts the cells it crosses into
 * the group it started on, with whatever groups they were in. A cell comes out
 * of its group by being clicked, or by the drag that started on it coming back
 * into it. A group takes a colour once it is a legal region, and the round
 * ends with every cell in one.
 *
 * A region is drawn as one shape rather than a row of tiles: each cell fills
 * into the margin on the sides it has a neighbour on, and rounds off on the
 * sides it does not.
 */

import { register as registerSquircle } from "./alma/src/gfx/squircle.js";
import { gameOver, input, score, time } from "./lib/one.js";

export const meta = {
  title: "tower",
  bg: "#FFFFFF",
  fg: "#333333",
  scoreMax: false, // the score is seconds
  date: "2025-08-27",
};

const WIDTH = 7;
const HEIGHT = 10;
const MARGIN = 12;
const PAD = 36;

// Whatever fits once the padding is off, which on a square is the height: 7x10
// is the taller way up.
const CELL = Math.min(
  (1024 - 2 * PAD - (WIDTH - 1) * MARGIN) / WIDTH,
  (1024 - 2 * PAD - (HEIGHT - 1) * MARGIN) / HEIGHT,
);
const GRID_W = WIDTH * CELL + (WIDTH - 1) * MARGIN;
const GRID_H = HEIGHT * CELL + (HEIGHT - 1) * MARGIN;
const X0 = (1024 - GRID_W) / 2;
const Y0 = (1024 - GRID_H) / 2;

const CELL_BG = "#F5F5F5";
const CELL_LINE = "#CCCCCC";
const HOVER_BG = "#EEEEEE";
const HOVER_LINE = "#999999";
// A group that is not a legal region yet.
const PARTIAL = "#E6F3FF";
const INK = "#333333";

// A region's fill, one per group in the order they were made.
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

// How many cuts to look at for one that can be numbered to a single answer.
// Four cuts in five can be, so the budget is only there to end the loop, and
// running it out is the one way a board with more answers is played.
const BOARD_TRIES = 16;

// How far the answers are counted while the numbering is chosen. Following
// only 8 of them numbers half the cuts to one answer, 32 or more three
// quarters, and past that the count costs time and finds nothing.
const ANSWERS_MAX = 64;

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

let grid = [];

// The player's groups, each {cells, color}; a cell holds its own in .group.
let groups = [];
let nextColor = 0;

let hovered = null;
// The group the drag is editing, the cell it started on, and every cell it has
// crossed, so crossing one twice does not undo it.
let dragGroup = null;
let dragFrom = null;
let dragSeen = new Set();

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

// The numbers as the player sees them, off the cut and its numbering.
function board(numbered) {
  const num = Array.from({ length: HEIGHT }, () => new Array(WIDTH).fill(0));
  for (const path of numbered) path.forEach(([x, y], i) => num[y][x] = i + 1);
  return num;
}

// Every legal region on a board: a chain 1..n, each cell touching the one
// before. A cell can only follow the number below it, so a chain never
// crosses itself and no visited set is needed. Length one is left out, the
// way a group of one is.
function chains(num) {
  const out = [];
  const path = [];

  function walk(x, y) {
    path.push(x + y * WIDTH);
    if (path.length > 1) out.push([...path]);

    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (nx < 0 || nx >= WIDTH || ny < 0 || ny >= HEIGHT) continue;
      if (num[ny][nx] === path.length + 1) walk(nx, ny);
    }

    path.pop();
  }

  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      if (num[y][x] === 1) walk(x, y);
    }
  }

  return out;
}

// How many sets of regions cover the board, counted no further than `cap`.
// The cell the fewest regions still fit over is filled first, so a dead end
// comes up at once.
function answers(numbered, cap) {
  const list = chains(board(numbered));
  const over = Array.from({ length: WIDTH * HEIGHT }, () => []);
  list.forEach((cells, i) => {
    for (const c of cells) over[c].push(i);
  });

  const taken = new Uint8Array(WIDTH * HEIGHT);
  let found = 0;

  function fill(left) {
    if (left === 0) {
      found++;
      return;
    }

    let fewest = null;
    for (let c = 0; c < taken.length; c++) {
      if (taken[c]) continue;
      const fits = over[c].filter((i) => list[i].every((cell) => !taken[cell]));
      if (fits.length === 0) return;
      if (!fewest || fits.length < fewest.length) fewest = fits;
    }

    for (const i of fewest) {
      for (const c of list[i]) taken[c] = 1;
      fill(left - list[i].length);
      for (const c of list[i]) taken[c] = 0;
      if (found >= cap) return;
    }
  }

  fill(taken.length);
  return found;
}

// Steps k -> k+1 where the k also touches a k+1 from another region, so the
// player has to choose. A board with few of them traces itself out of its 1s.
function forks(numbered) {
  const num = board(numbered);

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

/*
 * The numbering is chosen, not rolled: it decides both how many answers the
 * board has and how much work each step is. A random numbering of a cut leaves
 * one answer 2% of the time.
 *
 * So a region at a time takes the numbering that leaves the fewest answers,
 * and the count is followed down rather than jumped to: a numbering that
 * halves it is the way to one even when no single region reaches one on its
 * own, which is the difference between numbering a sixth of the cuts and four
 * fifths of them. A cut none of it gets to one is dropped.
 *
 * Then, without losing the single answer, a region takes the numbering that
 * puts the most of its numbers beside the same number in another region, so
 * the steps a player has to look past are as many as one answer allows.
 */
function number(shapes) {
  const options = shapes.map((cells) => paths(cells, WIDTH));
  const choice = options.map((ps) => ps[Math.floor(Math.random() * ps.length)]);

  let count = answers(choice, ANSWERS_MAX);
  for (let pass = 0; pass < shapes.length && count > 1; pass++) {
    let moved = false;
    for (let i = 0; i < choice.length && count > 1; i++) {
      let best = choice[i];
      for (const p of options[i]) {
        choice[i] = p;
        const n = answers(choice, ANSWERS_MAX);
        if (n >= count) continue;
        count = n;
        best = p;
        moved = true;
      }
      choice[i] = best;
    }
    if (!moved) break;
  }
  if (count > 1) return null;

  for (let i = 0; i < choice.length; i++) {
    let best = choice[i];
    let most = forks(choice);
    for (const p of options[i]) {
      choice[i] = p;
      if (answers(choice, 2) > 1) continue;
      const n = forks(choice);
      if (n <= most) continue;
      most = n;
      best = p;
    }
    choice[i] = best;
  }

  return choice;
}

function build() {
  let numbered = null;
  let last = null;
  for (let i = 0; i < BOARD_TRIES || !last; i++) {
    const shapes = cut();
    if (!shapes) continue;

    last = shapes;
    numbered = number(shapes);
    if (numbered) break;
  }
  // Past the budget: a board with more than one answer beats no board.
  numbered ??= last.map((cells) => paths(cells, WIDTH)[0]);

  grid = Array.from({ length: HEIGHT }, () => new Array(WIDTH).fill(null));
  for (const path of numbered) {
    path.forEach(([x, y], i) => grid[y][x] = { x, y, number: i + 1, group: null });
  }
}

// 1..n, each touching the one before, which leaves the region connected
// without asking. Starting at 1 is what makes the board have one answer:
// without it a region of four splits into its 1-2 and its 3-4 and both halves
// are legal.
function isValid(group) {
  if (group.length === 0) return false;

  const order = [...group].sort((a, b) => a.number - b.number);
  if (order[0].number !== 1) return false;
  for (let i = 1; i < order.length; i++) {
    if (order[i].number !== i + 1) return false;
    const step = Math.abs(order[i].x - order[i - 1].x) +
      Math.abs(order[i].y - order[i - 1].y);
    if (step !== 1) return false;
  }

  return true;
}

function create(cell) {
  const group = { cells: [cell], color: nextColor++ % REGION.length };
  cell.group = group;
  groups.push(group);
  return group;
}

function take(group, cell) {
  cell.group = group;
  group.cells.push(cell);
}

function merge(group, other) {
  for (const c of other.cells) take(group, c);
  other.cells.length = 0;
  groups.splice(groups.indexOf(other), 1);
}

function drop(cell) {
  const group = cell.group;
  cell.group = null;
  group.cells.splice(group.cells.indexOf(cell), 1);
  if (group.cells.length > 1) return;

  // One cell is no region to play with, so the group goes with it.
  for (const c of group.cells) c.group = null;
  group.cells.length = 0;
  groups.splice(groups.indexOf(group), 1);
}

function done() {
  for (const row of grid) {
    for (const cell of row) {
      if (!cell.group) return false;
    }
  }
  return groups.every((g) => isValid(g.cells));
}

function edit(cell) {
  dragGroup ??= create(dragFrom);

  // Back into the group the drag started in takes the cell it started on out
  // of it. There is one of those, so the stroke ends here.
  if (cell.group === dragGroup) {
    const from = dragFrom;
    dragFrom = null;
    dragGroup = null;
    drop(from);
    return;
  }

  if (cell.group) merge(dragGroup, cell.group);
  else take(dragGroup, cell);

  if (!done()) return;
  score.value = Math.round(time);
  gameOver({ win: true, score: true });
}

export function init() {
  registerSquircle();

  groups = [];
  nextColor = 0;
  hovered = null;
  dragGroup = null;
  dragFrom = null;
  dragSeen = new Set();
  score.value = 0;

  build();
}

export function update() {
  hovered = cellAt(input.x, input.y);

  if (input.just.act) {
    dragFrom = hovered;
    dragGroup = hovered?.group ?? null;
    dragSeen = new Set(hovered ? [hovered] : []);
  }

  if (!input.press.act) {
    // A click: the press cell is the only one the stroke touched, so it is the
    // one that comes out.
    if (dragFrom && dragSeen.size === 1 && dragFrom.group) drop(dragFrom);
    dragFrom = null;
    dragGroup = null;
    return;
  }

  if (!dragFrom || !hovered || dragSeen.has(hovered)) return;
  dragSeen.add(hovered);
  edit(hovered);
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

export function render(ctx) {
  for (const g of groups) {
    const fill = isValid(g.cells) ? REGION_FILL[g.color] : PARTIAL;
    regionArea(ctx, g.cells, fill);
  }

  for (const row of grid) {
    for (const cell of row) {
      const x = cellX(cell.x);
      const y = cellY(cell.y);

      // A cell in a group already has its background from regionArea().
      if (!cell.group) {
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
}
