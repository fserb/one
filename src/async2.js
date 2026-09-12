/*
 * async2 - the earlier async, with the 3D boards.
 *
 * Two 4x6 boards side by side, gravity pulling each towards the other. A swap
 * is only allowed when it leaves some block able to grow.
 *
 * The boards are quads under a perspective divide rather than flat rects, each
 * with a rotation about its vertical axis, sprung towards a small resting
 * tilt. Every block position comes from interpolating the board's quad, so the
 * perspective is applied once, to the board, and the blocks inherit it.
 *
 * The run has no end: gameOver() is never called, so this is a board to play
 * with rather than a game. score.value counts merged blocks destroyed.
 */

import { Collider } from "./alma/src/collider.js";
import { Mat4 } from "./alma/src/geom/mat4.js";
import { Quad } from "./alma/src/geom/Quad.js";
import * as ease from "./alma/src/ease.js";
import { act, mouse, score, SIZE } from "./lib/one.js";

export const meta = {
  title: "async2",
  desc: `
click a block on each board to swap
click a merged block to destroy it
`,
  bg: "#519B9D",
  fg: "#386B99",
  scoreMax: true,
  date: "2025-07-26",
};

const BOARD_WIDTH = 4;
const BOARD_HEIGHT = 6;
const USE_COLORS = 3;
const COLORS = ["#386B99", "#F3C62C", "#E74C3C", "#AB7390"];
const MARGIN_RATIO = 0.03;

const SPRING_CONSTANT = 0.12;
const DEPTH_DAMPING = 0.8;
const ROTATION_DAMPING = 0.85;
// The springs are tuned per 60Hz step, so dt is measured against one.
const TIME_SCALE_FACTOR = 0.016;
const TARGET_BOARD_ROTATION = 0.1;
const ROTATION_STRENGTH = 0.15;

const ANIM_SWAP_TIME = 0.25;
const ANIM_DESTROY_TIME = 0.3;
const ANIM_DROP_TIME = 0.25;

const PERSPECTIVE = 1000;

// Arithmetic rather than a layout solve: outer margin, board, gap, spine, gap,
// board, outer margin across the width, the pair centred in what is left of the
// height. The width binds, which is why 4x6 leaves board colour above and below.
const MARGIN = SIZE * 0.04;
const SPINE = SIZE * 0.025;
const BOARD_ASPECT = (BOARD_WIDTH + (BOARD_WIDTH - 1) * MARGIN_RATIO) /
  (BOARD_HEIGHT + (BOARD_HEIGHT - 1) * MARGIN_RATIO);
const BOARD_W = (SIZE - 4 * MARGIN - SPINE) / 2;
const BOARD_H = BOARD_W / BOARD_ASPECT;
const BOARD_Y = (SIZE - BOARD_H) / 2;

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

function createBlock(board, x, y, color, displacement = 0) {
  return {
    board,
    x,
    y,
    color,
    width: 1,
    height: 1,
    depth: 0,
    depthVelocity: 0,
    targetDepth: 0,
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
// inside the box: a bigger neighbour poking out makes the union non-rectangular.
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
        const color = Math.floor(Math.random() * USE_COLORS);
        blocks.push(createBlock(boardIndex, x, y, color));
      }
    }
  }
}

// `displacement` is how many cells a block is drawn short of where it already
// is, tweened to zero, so the model settles first and the tween is only the
// picture catching up.
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

    // One displacement for the whole board, taken off the furthest hole, so a
    // row of new blocks slides in as a row rather than each on its own.
    let maxDisplacement = 1;
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      for (const x of feedOrder(boardIndex)) {
        if (getBlockAt(boardIndex, x, y)) break;
        maxDisplacement = Math.max(maxDisplacement, Math.abs(outsideX - x));
        fresh.push({ x, y });
      }
    }

    for (const { x, y } of fresh) {
      const color = Math.floor(Math.random() * USE_COLORS);
      const block = createBlock(boardIndex, x, y, color, maxDisplacement);
      blocks.push(block);
      animated.push(block);
    }
  }

  if (animated.length === 0) return;
  await Promise.all(
    animated.map((block) =>
      act(block).attr("displacement", 0, ANIM_DROP_TIME, ease.quadIn)
    ),
  );
}

// Largest growth first per block, until a pass finds nothing. The merged block
// keeps the identity of its top-left corner and the rest are dropped.
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

  // Forward blocks grow and back ones shrink, which is the parallax the depth
  // offset alone does not give.
  const depthScale = block.depth >= 0 ? 1 / (1 + block.depth) : (1 - block.depth);
  let out = quad.scale(depthScale);

  // In cells, drawn outward: the left board's blocks are held back to the left
  // of where the model already has them.
  if (block.displacement !== 0) {
    const pixels = block.displacement *
      (boards[block.board].layout.width / BOARD_WIDTH);
    out = out.translate(block.board === 0 ? -pixels : pixels, 0);
  }

  if (!withMargin) return out.corners;
  return out.applyMargin(MARGIN_RATIO, block.width, block.height).corners;
}

function updatePhysics(dt) {
  const timeScale = dt / TIME_SCALE_FACTOR;

  for (const block of blocks) {
    const restore = (block.targetDepth - block.depth) * SPRING_CONSTANT;
    block.depthVelocity = (block.depthVelocity + restore) * DEPTH_DAMPING;
    block.depth += block.depthVelocity * timeScale;
  }

  for (const board of boards) {
    const target = board.id === 0 ? -TARGET_BOARD_ROTATION : TARGET_BOARD_ROTATION;
    const restore = (target - board.rotation) * SPRING_CONSTANT;
    board.rotationVelocity = (board.rotationVelocity + restore) *
      ROTATION_DAMPING;
    board.rotation += board.rotationVelocity * timeScale;
  }
}

function deselect() {
  if (!selectedBlock) return;
  selectedBlock.selected = false;
  selectedBlock.targetDepth = 0;
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

  // The square root makes the edge only twice the push of a quarter out rather
  // than four times.
  const { layout } = boards[clicked.board];
  const dist = (x - (layout.x + layout.width * 0.5)) / layout.width;
  boards[clicked.board].rotationVelocity += -ROTATION_STRENGTH *
    (Math.abs(dist) ** 0.5) * Math.sign(dist);

  const crossBoard = selectedBlock && selectedBoard !== null &&
    selectedBoard !== clicked.board;
  const previous = selectedBlock;
  deselect();

  if (clicked.width >= 2 || clicked.height >= 2) {
    clicked.destroyScale = 1.0;
    await act(clicked).attr(
      "destroyScale",
      0.0,
      ANIM_DESTROY_TIME,
      ease.quadIn,
    );

    score.value += 1;
    removeBlock(clicked);
    await applyGravityAndFill();
    mergeBlocks();
    return;
  }

  if (crossBoard && canSwapCreateBiggerBlocks(previous, clicked)) {
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
      block.depth = block.targetDepth = block.depthVelocity = 0;
    }

    mergeBlocks();
    return;
  }

  // One block per board, so a second click on the same board moves the
  // selection rather than trying to swap.
  selectedBlock = clicked;
  selectedBoard = clicked.board;
  selectedBlock.targetDepth = -0.25;
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

// 0.2 of a cell, so a merged block's corners are the same size as a single
// block's rather than scaling with it.
function getBlockCornerRadius(block) {
  return {
    rx: 0.2 / (block.width + (block.width - 1) * MARGIN_RATIO),
    ry: 0.2 / (block.height + (block.height - 1) * MARGIN_RATIO),
  };
}

export function init() {
  blocks.length = 0;
  selectedBlock = null;
  selectedBoard = null;
  score.value = 0;
  for (const board of boards) {
    board.rotation = 0;
    board.rotationVelocity = 0;
  }

  fillEmptySpacesInit();
  mergeBlocks();
}

export function update(dt) {
  // Not awaited: a click lands while an earlier one is still animating.
  if (mouse.click) handleClick(mouse.x, mouse.y);
  updatePhysics(dt);
}

export function render(ctx) {
  // Back to front, so a block arcing forward covers the ones behind it.
  const ordered = [...blocks].sort((a, b) => b.depth - a.depth);

  for (const block of ordered) {
    const scale = block.destroyScale ?? 1;
    if (scale <= 0) continue;

    const points = block.swapAnim
      ? calculateSwapPosition(block)
      : getBlockQuadPoints(block);

    ctx.fillStyle = COLORS[block.color];
    const { rx, ry } = getBlockCornerRadius(block);
    ctx.roundQuad(
      scale === 1 ? points : new Quad(points).scale(scale).corners,
      rx,
      ry,
    );
    ctx.fill();

    if (!block.selected) continue;
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.lineWidth = 16;
    ctx.stroke();
  }
}
