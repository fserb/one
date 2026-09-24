/*
 * async - swap blocks across two facing boards to grow them into rectangles.
 *
 * Two 4x6 boards side by side, gravity pulling each towards the other. A swap
 * is only allowed when it leaves some block able to grow.
 *
 * The boards are quads under a perspective divide rather than flat rects, each
 * with a rotation about its vertical axis, sprung towards a small resting
 * tilt. Every block position comes from interpolating the board's quad, so the
 * perspective is applied once, to the board, and the blocks inherit it.
 *
 * A block is raised out of the board, soft UI style: a light shadow up-left and
 * a dark one down-right, then its colour with a darker lip along the bottom.
 * The selected one sinks to half its size and bobs there.
 *
 * The meter in the spine is the swap budget. It starts at half, drains slowly
 * with time, a swap takes a unit off it, and clearing a merged block gives back
 * its area less two, which is also what the clear scores in area. Empty ends the
 * run. Full is a level: both boards are thrown off and refilled, the meter goes
 * back to half, and the level either adds a colour, from two up to five, or
 * once all five are in, drains faster.
 */

import { Collider } from "./alma/src/collider.js";
import { Mat4 } from "./alma/src/geom/mat4.js";
import { Quad } from "./alma/src/geom/Quad.js";
import * as ease from "./alma/src/ease.js";
import { act } from "./lib/act.js";
import { gameOver, input, score, time } from "./lib/one.js";

export const meta = {
  title: "async",
  bg: "#E0E5EC",
  fg: "#5B8DEF",
  scoreMax: true,
  date: "2025-07-26",
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
// A selected block's scale, and how much further back its bob takes it.
const SINK = 0.5;
const SINK_BOB = 0.04;
const MARGIN_RATIO = 0.03;

const SPRING_CONSTANT = 0.12;
const TARGET_BOARD_ROTATION = 0.1;

const ANIM_SWAP_TIME = 0.25;

const METER_MAX = 12;
const METER_START = METER_MAX / 2;
const SWAP_COST = 1;
// Units a second: an untouched meter empties from half in 90 seconds.
const DRAIN = 1 / 15;

const PERSPECTIVE = 1000;

// Arithmetic rather than a layout solve: margin, board, gap, spine, gap, board,
// margin across the width, the pair centred in the height. The width binds,
// which is why 4x6 leaves board colour above and below.
const MARGIN = 1024 * 0.04;
const SPINE = 1024 * 0.025;
const BOARD_ASPECT = (BOARD_WIDTH + (BOARD_WIDTH - 1) * MARGIN_RATIO) /
  (BOARD_HEIGHT + (BOARD_HEIGHT - 1) * MARGIN_RATIO);
const BOARD_W = (1024 - 4 * MARGIN - SPINE) / 2;
const BOARD_H = BOARD_W / BOARD_ASPECT;
const BOARD_Y = (1024 - BOARD_H) / 2;

const LAYOUT = [
  { x: MARGIN, y: BOARD_Y, width: BOARD_W, height: BOARD_H },
  {
    x: 3 * MARGIN + BOARD_W + SPINE,
    y: BOARD_Y,
    width: BOARD_W,
    height: BOARD_H,
  },
];

// One block's worth of board, which is what a depth offset is measured in.
const BLOCK_SIZE = Math.min(
  BOARD_W / (BOARD_WIDTH + (BOARD_WIDTH - 1) * MARGIN_RATIO),
  BOARD_H / (BOARD_HEIGHT + (BOARD_HEIGHT - 1) * MARGIN_RATIO),
);

const blocks = [];
const boards = [
  { id: 0, layout: LAYOUT[0], rotation: 0, rotationVelocity: 0 },
  { id: 1, layout: LAYOUT[1], rotation: 0, rotationVelocity: 0 },
];

let selectedBlock = null;
let selectedBoard = null;
let level = 0;
let meter = METER_START;
let meterShown = METER_START;
const flash = { value: 0 };
let leveling = false;

function colorCount() {
  return Math.min(2 + level, COLORS.length);
}

function drainRate() {
  return DRAIN * (1 + 0.5 * Math.max(0, level - (COLORS.length - 2)));
}

// Waits out any clear still falling into place, throws every block off the
// board, inner column first, then feeds both boards from empty.
async function levelUp() {
  deselect();
  await act.wait();

  flash.value = 1;
  act(flash).attr("value", 0, 0.8, ease.quadOut);
  for (const board of boards) {
    board.rotationVelocity += board.id === 0 ? 0.3 : -0.3;
  }

  await Promise.all(blocks.map((block) => {
    const inner = block.board === 0 ? BOARD_WIDTH - block.x - block.width : block.x;
    block.drop = 0;
    return act(block).attr(
      "drop",
      1,
      0.6,
      ease.quadIn,
      inner * 0.06 + block.y * 0.03 + Math.random() * 0.05,
    );
  }));

  blocks.length = 0;
  level++;
  meter = METER_START;
  await applyGravityAndFill();
  mergeBlocks();
  leveling = false;
}

function createBlock(board, x, y, color, displacement = 0) {
  return {
    board,
    x,
    y,
    color,
    width: 1,
    height: 1,
    depth: 0,
    sink: 0,
    sinkVelocity: 0,
    targetSink: 0,
    selected: false,
    displacement,
  };
}

function getBlockAt(board, x, y) {
  return blocks.find((block) =>
    block.board === board &&
    x >= block.x && x < block.x + block.width &&
    y >= block.y && y < block.y + block.height
  );
}

function removeBlock(block) {
  const index = blocks.indexOf(block);
  if (index > -1) blocks.splice(index, 1);
}

function isValidPosition(board, x, y, width, height, excludeBlock) {
  if (x < 0 || y < 0 || x + width > BOARD_WIDTH || y + height > BOARD_HEIGHT) {
    return false;
  }

  for (let i = x; i < x + width; i++) {
    for (let j = y; j < y + height; j++) {
      const existing = getBlockAt(board, i, j);
      if (existing && existing !== excludeBlock) return false;
    }
  }
  return true;
}

// Every cell in the target box has to hold a block of the same colour that fits
// inside it: a bigger neighbour poking out leaves the union non-rectangular.
function isValidResize(block, boardIndex, dx, dy) {
  const maxX = block.x + block.width + dx;
  const maxY = block.y + block.height + dy;

  for (let x = block.x; x < maxX; x++) {
    for (let y = block.y; y < maxY; y++) {
      const n = getBlockAt(boardIndex, x, y);
      if (
        !n || n.color !== block.color ||
        n.x + n.width > maxX || n.y + n.height > maxY ||
        n.x < block.x || n.y < block.y
      ) return false;
    }
  }
  return true;
}

// The largest growth this block has, down and right, or zeroes for none. One
// cell wide or tall is not a merge, so the area has to be more than 4.
function getMaxSquare(block) {
  let expand = { x: 0, y: 0 };
  let bestArea = 4;

  for (let dx = 0; dx <= BOARD_WIDTH - (block.x + block.width); dx++) {
    for (let dy = 0; dy <= BOARD_HEIGHT - (block.y + block.height); dy++) {
      const area = (dx + block.width) * (dy + block.height);
      if (
        dx + block.width === 1 || dy + block.height === 1 ||
        bestArea > area || (bestArea === area && dy <= expand.y) ||
        !isValidResize(block, block.board, dx, dy)
      ) continue;

      expand = { x: dx, y: dy };
      bestArea = area;
    }
  }
  return expand;
}

// Try the swap, ask whether anything can grow, put it back. The rule that makes
// a swap a move rather than a shuffle.
function canSwapCreateBiggerBlocks(block1, block2) {
  [block1.color, block2.color] = [block2.color, block1.color];

  const canGrow = blocks.some((block) => {
    const exp = getMaxSquare(block);
    return exp.x > 0 || exp.y > 0;
  });

  [block1.color, block2.color] = [block2.color, block1.color];
  return canGrow;
}

// The outer edge a board feeds from: the left board fills from the left.
function feedOrder(boardIndex) {
  const xs = Array.from({ length: BOARD_WIDTH }, (_, i) => i);
  return boardIndex === 0 ? xs : xs.reverse();
}

function fillEmptySpacesInit() {
  for (let boardIndex = 0; boardIndex < 2; boardIndex++) {
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      for (const x of feedOrder(boardIndex)) {
        if (getBlockAt(boardIndex, x, y)) break;
        const color = Math.floor(Math.random() * colorCount());
        blocks.push(createBlock(boardIndex, x, y, color));
      }
    }
  }
}

// `displacement` is how many cells a block is drawn short of where it already
// is, tweened to zero, so the tween is only the picture catching up.
async function applyGravityAndFill() {
  const animated = [];
  const before = blocks.map((b) => ({ block: b, x: b.x }));

  for (let boardIndex = 0; boardIndex < 2; boardIndex++) {
    let moved = true;
    while (moved) {
      moved = false;
      for (const block of blocks) {
        if (block.board !== boardIndex) continue;
        const newX = boardIndex === 0
          ? Math.min(BOARD_WIDTH - block.width, block.x + 1)
          : Math.max(0, block.x - 1);

        if (newX === block.x) continue;
        if (
          !isValidPosition(
            boardIndex,
            newX,
            block.y,
            block.width,
            block.height,
            block,
          )
        ) continue;

        block.x = newX;
        moved = true;
      }
    }
  }

  for (const { block, x: originalX } of before) {
    if (block.x === originalX) continue;
    const movement = block.x - originalX;
    block.displacement = block.board === 0 ? movement : -movement;
    animated.push(block);
  }

  for (let boardIndex = 0; boardIndex < 2; boardIndex++) {
    const fresh = [];
    const outsideX = boardIndex === 0 ? -1 : BOARD_WIDTH;

    // One displacement for the whole board, off the furthest hole, so a row of
    // new blocks slides in as a row.
    let maxDisplacement = 1;
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      for (const x of feedOrder(boardIndex)) {
        if (getBlockAt(boardIndex, x, y)) break;
        maxDisplacement = Math.max(maxDisplacement, Math.abs(outsideX - x));
        fresh.push({ x, y });
      }
    }

    for (const { x, y } of fresh) {
      const color = Math.floor(Math.random() * colorCount());
      const block = createBlock(boardIndex, x, y, color, maxDisplacement);
      blocks.push(block);
      animated.push(block);
    }
  }

  if (animated.length === 0) return;
  await Promise.all(
    animated.map((block) => act(block).attr("displacement", 0, 0.25, ease.quadIn)),
  );
}

// Largest growth first per block, until a pass finds nothing. The merged block
// keeps the identity of its top-left corner.
function mergeBlocks() {
  if (act.is()) return;

  for (;;) {
    let merged = false;

    for (const block of blocks) {
      const exp = getMaxSquare(block);
      if (exp.x === 0 && exp.y === 0) continue;

      for (let x = block.x; x < block.x + block.width + exp.x; x++) {
        for (let y = block.y; y < block.y + block.height + exp.y; y++) {
          const n = getBlockAt(block.board, x, y);
          if (n && n !== block) removeBlock(n);
        }
      }
      block.width += exp.x;
      block.height += exp.y;
      merged = true;
      break;
    }

    if (!merged) return;
  }
}

// Rotate the rect about its vertical axis in 3D, then divide by depth.
// Everything else on the board interpolates this.
function getBoardQuadPoints(boardIndex) {
  const { layout, rotation } = boards[boardIndex];
  const { width, height, x, y } = layout;

  const halfWidth = width * 0.5;
  const halfHeight = height * 0.5;

  const corners = new Quad([
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight },
  ]).applyMatrix(new Mat4().makeRotationY(rotation), true);

  return corners.map((corner) => {
    const perspective = PERSPECTIVE / (corner.z + PERSPECTIVE);
    return {
      x: x + halfWidth + corner.x * perspective,
      y: y + halfHeight + corner.y * perspective,
    };
  });
}

// A point on the board's quad, pushed out along the board's normal by depth.
function interpolateQuad(quad, u, v, depth, boardIndex) {
  const point = new Quad(quad).interpolate(u, v);
  if (depth === 0) return point;

  const rotation = boards[boardIndex].rotation;
  const offset = depth * BLOCK_SIZE / 3;
  point.x += offset * Math.sin(rotation);
  point.y += offset * Math.cos(rotation);
  return point;
}

function getBlockQuadPoints(block, withMargin = true) {
  const boardQuad = getBoardQuadPoints(block.board);

  const u1 = block.x / BOARD_WIDTH;
  const v1 = block.y / BOARD_HEIGHT;
  const u2 = (block.x + block.width) / BOARD_WIDTH;
  const v2 = (block.y + block.height) / BOARD_HEIGHT;

  const quad = new Quad([
    interpolateQuad(boardQuad, u1, v1, block.depth, block.board),
    interpolateQuad(boardQuad, u2, v1, block.depth, block.board),
    interpolateQuad(boardQuad, u2, v2, block.depth, block.board),
    interpolateQuad(boardQuad, u1, v2, block.depth, block.board),
  ]);

  // Forward blocks grow and back ones shrink: the parallax the offset misses.
  const depthScale = block.depth >= 0 ? 1 / (1 + block.depth) : (1 - block.depth);
  let out = quad.scale(depthScale);

  // In cells, drawn outward: the left board's blocks are held back left.
  if (block.displacement !== 0) {
    const pixels = block.displacement *
      (boards[block.board].layout.width / BOARD_WIDTH);
    out = out.translate(block.board === 0 ? -pixels : pixels, 0);
  }

  // Thrown outward and down, off the bottom of the screen by the end.
  if (block.drop) {
    out = out.translate(
      (block.board === 0 ? -250 : 250) * block.drop,
      1100 * block.drop,
    );
  }

  if (!withMargin) return out.corners;
  return out.applyMargin(MARGIN_RATIO, block.width, block.height).corners;
}

function updatePhysics(dt) {
  // The springs are tuned per 60Hz step, so dt is measured against one.
  const timeScale = dt / 0.016;

  for (const block of blocks) {
    const restore = (block.targetSink - block.sink) * SPRING_CONSTANT;
    block.sinkVelocity = (block.sinkVelocity + restore) * 0.8;
    block.sink += block.sinkVelocity * timeScale;
  }

  for (const board of boards) {
    const target = board.id === 0 ? -TARGET_BOARD_ROTATION : TARGET_BOARD_ROTATION;
    const restore = (target - board.rotation) * SPRING_CONSTANT;
    board.rotationVelocity = (board.rotationVelocity + restore) *
      0.85;
    board.rotation += board.rotationVelocity * timeScale;
  }
}

function deselect() {
  if (!selectedBlock) return;
  selectedBlock.selected = false;
  selectedBlock.targetSink = 0;
  selectedBlock = null;
  selectedBoard = null;
}

async function handleClick(x, y) {
  const point = Collider.point(x, y);
  let clicked = null;

  // Hit-test the drawn quad and not the grid: the board is under a perspective
  // divide and a rocking rotation.
  for (const block of blocks) {
    const quad = getBlockQuadPoints(block, false);
    if (Collider.hit(point, Collider.polygon(quad))) {
      clicked = block;
      break;
    }
  }
  if (!clicked) return;

  // The square root makes the edge twice the push of a quarter out, not four.
  const { layout } = boards[clicked.board];
  const dist = (x - (layout.x + layout.width * 0.5)) / layout.width;
  boards[clicked.board].rotationVelocity += -0.15 *
    (Math.abs(dist) ** 0.5) * Math.sign(dist);

  const crossBoard = selectedBlock && selectedBoard !== null &&
    selectedBoard !== clicked.board;
  const previous = selectedBlock;
  deselect();

  if (clicked.width >= 2 || clicked.height >= 2) {
    const area = clicked.width * clicked.height;
    score.value += area;
    meter = Math.min(METER_MAX, meter + area - 2);
    // Only the clear that fills it throws the boards; the input stops here.
    const full = meter === METER_MAX;
    if (full) leveling = true;
    clicked.destroyScale = 1.0;
    await act(clicked).attr(
      "destroyScale",
      0.0,
      0.3,
      ease.quadIn,
    );

    removeBlock(clicked);
    await applyGravityAndFill();
    mergeBlocks();
    if (full) await levelUp();
    return;
  }

  if (crossBoard && canSwapCreateBiggerBlocks(previous, clicked)) {
    meter -= SWAP_COST;
    // One progress object per block, so the two arcs are separate tracks.
    const anim1 = { progress: 0 };
    const anim2 = { progress: 0 };
    previous.swapAnim = { progress: anim1, target: clicked, high: true };
    clicked.swapAnim = { progress: anim2, target: previous, high: false };

    await Promise.all([
      act(anim1).attr("progress", 1.0, ANIM_SWAP_TIME, ease.quadOut),
      act(anim2).attr("progress", 1.0, ANIM_SWAP_TIME, ease.quadOut),
    ]);

    [previous.color, clicked.color] = [clicked.color, previous.color];
    for (const block of [previous, clicked]) {
      delete block.swapAnim;
      block.depth = 0;
    }

    mergeBlocks();
    return;
  }

  // One block per board, so a second click on the same board reselects.
  selectedBlock = clicked;
  selectedBoard = clicked.board;
  selectedBlock.targetSink = 1;
  clicked.selected = true;
}

// The two cross over each other, one arcing forward and one back, meeting at
// the midpoint of their two lifted positions.
function calculateSwapPosition(block) {
  const progress = block.swapAnim.progress.progress;
  const target = block.swapAnim.target;

  const start = getBlockQuadPoints(block, false);
  const end = getBlockQuadPoints({ ...target, depth: 0 }, false);

  const arcHeight = block.swapAnim.high ? -2 : 3;
  const lifted = getBlockQuadPoints({ ...block, depth: arcHeight }, false);
  const liftedTarget = getBlockQuadPoints(
    { ...target, depth: arcHeight },
    false,
  );
  const mid = lifted.map((p, i) => ({
    x: (p.x + liftedTarget[i].x) * 0.5,
    y: (p.y + liftedTarget[i].y) * 0.5,
  }));

  if (progress < 0.5) {
    const t = progress * 2;
    block.depth = arcHeight * t;
    return start.map((p, i) => ({
      x: p.x + (mid[i].x - p.x) * t,
      y: p.y + (mid[i].y - p.y) * t,
    }));
  }

  const t = (progress - 0.5) * 2;
  block.depth = arcHeight * (1 - t);
  return mid.map((p, i) => ({
    x: p.x + (end[i].x - p.x) * t,
    y: p.y + (end[i].y - p.y) * t,
  }));
}

// 0.26 of a cell, so a merged block's corners are the same size as a single
// block's rather than scaling with it.
function getBlockCornerRadius(block) {
  return {
    rx: 0.26 / (block.width + (block.width - 1) * MARGIN_RATIO),
    ry: 0.26 / (block.height + (block.height - 1) * MARGIN_RATIO),
  };
}

export function init() {
  blocks.length = 0;
  selectedBlock = null;
  selectedBoard = null;
  score.value = 0;
  level = 0;
  meter = meterShown = METER_START;
  flash.value = 0;
  leveling = false;
  for (const board of boards) {
    board.rotation = 0;
    board.rotationVelocity = 0;
  }

  fillEmptySpacesInit();
  mergeBlocks();
}

export function update(dt) {
  // Not awaited: a click lands while an earlier one is still animating.
  updatePhysics(dt);
  meterShown += (meter - meterShown) * Math.min(1, dt * 8);
  if (leveling) return;

  if (input.just.act) handleClick(input.x, input.y);
  meter -= drainRate() * dt;
  if (meter <= 0) gameOver({ score: true });
}

// A sinking block shrinks about its centre and drops a little. The bob is in
// and out around the sunk size, and only as far as the block has sunk.
function sunk(block, points, bob) {
  if (block.sink === 0) return points;
  const scale = 1 - (1 - SINK) * block.sink - SINK_BOB * bob * block.sink;
  return new Quad(points).scale(scale)
    .translate(0, (4 + 3 * bob) * block.sink).corners;
}

// The part of a shape not covered by itself moved up by h: a band along its
// bottom. The path is left as the clip's, so call it right after the shape.
function lip(ctx, points, rx, ry, h, color) {
  ctx.save();
  ctx.clip();
  ctx.fillStyle = color;
  ctx.roundQuad(points.map(({ x, y }) => ({ x, y: y - h })), rx, ry);
  ctx.rect(0, 0, 1024, 1024);
  ctx.fill("evenodd");
  ctx.restore();
}

// Shadows are drawn once into canvases at the screen's scale and copied from
// there, since a shadowBlur fill blurs again on every frame. A resize that
// changes the scale throws them all away.
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

// A shape's two shadows, each alone on a canvas: the shape itself is drawn a
// canvas width to the left, off it, and its shadow is offset back on.
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

// A block at rest, unrotated, with its full shadow depth.
function blockShadows(block, px) {
  const width = BOARD_W / BOARD_WIDTH * (block.width - 2 * MARGIN_RATIO);
  const height = BOARD_H / BOARD_HEIGHT * (block.height - 2 * MARGIN_RATIO);
  const { rx, ry } = getBlockCornerRadius(block);
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
// its opposite edges; the perspective in a block is too slight to show in a
// blur. Only the offset follows d: the blur stays at the rest depth's.
function drawBlockShadow(ctx, image, shadow, points, s) {
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
  ctx.drawImage(
    image,
    -pad,
    -pad,
    image.width / bakedPx,
    image.height / bakedPx,
  );
  ctx.restore();
}

// The groove pressed into the board, the two shadows cast inward from a frame
// around it. Its width only changes during a level's flash.
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

// The meter a raised bar inside the groove. Its shadow is cut in three: the
// two caps copied as they are and the straight middle stretched to the height.
function drawMeter(ctx, px) {
  const w = Math.round(SPINE * 1.7 * (1 + 1.5 * flash.value));
  const groove = bake(`groove ${w}`, px, () => bakeGroove(px, w));
  ctx.drawImage(
    groove,
    512 - w / 2,
    BOARD_Y,
    groove.width / px,
    groove.height / px,
  );

  const pad = w * 0.19;
  const bw = Math.round(w - 2 * pad);
  const h = Math.max(0, meterShown) / METER_MAX * (BOARD_H - 2 * pad);
  if (h < bw) return;
  const x = 512 - bw / 2;
  const y = BOARD_Y + BOARD_H - pad - h;

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
    const bottom = image.height / px - cap - 2;
    ctx.drawImage(
      image,
      0,
      0,
      image.width,
      cap * px,
      x - shadow.pad + s,
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
      x - shadow.pad + s,
      y + bw / 2 + s,
      iw,
      h - bw,
    );
    ctx.drawImage(
      image,
      0,
      (cap + 2) * px,
      image.width,
      bottom * px,
      x - shadow.pad + s,
      y + h - bw / 2 + s,
      iw,
      bottom,
    );
  }

  ctx.fillStyle = METER_COLOR;
  ctx.beginPath();
  ctx.roundRect(x, y, bw, h, bw / 2);
  ctx.fill();
}

export function render(ctx) {
  // Device pixels per board unit, the scale the shadows are baked at.
  const m = ctx.getTransform();
  const px = Math.hypot(m.a, m.b);
  const bob = (1 + Math.sin(time * 5)) / 2;

  drawMeter(ctx, px);

  // Back to front, so a block arcing forward covers the ones behind it.
  const drawn = [];
  for (const block of [...blocks].sort((a, b) => b.depth - a.depth)) {
    const scale = block.destroyScale ?? 1;
    if (scale <= 0) continue;
    let points = block.swapAnim
      ? calculateSwapPosition(block)
      : getBlockQuadPoints(block);
    if (scale !== 1) points = new Quad(points).scale(scale).corners;
    const { rx, ry } = getBlockCornerRadius(block);
    drawn.push({ block, points: sunk(block, points, bob), rx, ry });
  }

  // Every shadow before any block, so no highlight lands on a neighbour, and
  // every light one before any dark, so a highlight never covers a neighbour's
  // dark shadow. A sunk block's shadow is a third as deep, and shallower as it
  // bobs back.
  for (const [name, sign] of [["light", -1], ["dark", 1]]) {
    for (const { block, points } of drawn) {
      const d = SHADOW * (1 - block.sink * (0.65 + 0.2 * bob));
      const shadow = blockShadows(block, px);
      drawBlockShadow(ctx, shadow[name], shadow, points, sign * d);
    }
  }

  for (const { block, points, rx, ry } of drawn) {
    ctx.fillStyle = COLORS[block.color];
    ctx.roundQuad(points, rx, ry);
    ctx.fill();
    const h = Math.min(
      LIP * (1 - 0.6 * block.sink),
      (points[3].y - points[0].y) * 0.1,
    );
    lip(ctx, points, rx, ry, h, LIPS[block.color]);
  }
}
