/*
 * trap - break the hex floor out from under a wandering eye.
 *
 * Every click drops one hex, then the eye steps towards the nearest edge;
 * reaching one ends the run. Strand it with no route out and the next, denser
 * level starts. Based on Isola.
 */

import { ease, extra, HexGrid, vec } from "./alma/src/index.js";
import { camera } from "./lib/camera.js";
import { act, gameOver, input, msg, score } from "./lib/one.js";
import {
  ADSR,
  biquad,
  bitcrush,
  compressor,
  envelope,
  karplus_strong,
  linear,
  oscillator,
  ringmod,
  VSAJ,
} from "./lib/fsfx/fsfx.js";
import * as sound from "./lib/sound.js";

const { arrayRemove, lerp, promiseSleep, SQRT3, TAU } = extra;

export const meta = {
  title: "trap",
  desc: `
destroy blocks
don't let the eye escape
`,
  bg: "#68C2D3",
  fg: "#402F2E",
  scoreMax: true,
  date: "2021-05-09",
};

const GROUND = "#7E6352";
const SKIN = "#932C4B";
const WHITE = "#F2F0E5";
const IRIS = "#212123";
const RIM = "#B9A588";

sound.make("hit", 0.3, (track) => {
  track(karplus_strong, { b: 0.5, freq: 40, S: 0.1 });
  track(biquad, { type: "lowpass", freq: 1500 });
  track(bitcrush, { sample: 4, bits: 24 });
  track(compressor);
  track(envelope, {
    env: ADSR({ sustainv: 2, sustain: 0.1, release: 0.2, type: "linear" }),
  });
});

sound.make("drop", 0.3, (track) => {
  track(oscillator, { type: "saw", freq: linear(100, -300) });
  track(oscillator, { type: "brown", amp: 0.5 });
  track(ringmod, { wet: 1, freq: 120 });
  track(biquad, { type: "lowpass", freq: 1000 });
  track(envelope, {
    env: ADSR({ sustainv: 1, sustain: 0.05, release: 0.25, type: "linear" }),
  });
});

sound.make("move", 0.65, (track) => {
  track(oscillator, { type: "sine", freq: VSAJ(400, 400, -4000) });
  track(ringmod, { wet: 0.5, freq: 200 });
  track(envelope, {
    env: ADSR({
      attack: 0.3,
      sustain: 0.2,
      release: 0.25,
      sustainv: 1,
      type: "exp",
    }),
  });
});

sound.make("fall", 0.5, (track) => {
  track(oscillator, { type: "sine", freq: VSAJ(400, -200) });
  track(ringmod, { wet: 0.5, freq: 200 });
  track(envelope, {
    env: ADSR({ attack: 0.1, release: 0.4, sustainv: 1, type: "linear" }),
  });
});

const WIDTH = 10;
const HEIGHT = 17;
// Columns step 3/2 of it and rows half its height, so a cell only exists where
// (c + r) is even.
const HEX = 60;
const H2 = SQRT3 / 2;

// Hex culled a level, harder-to-reach hexes counting for more. Reaches its
// minimum of 5 at level 24.
const PROG = [
  0,
  50,
  45,
  40,
  35,
  30,
  25,
  25,
  20,
  20,
  20,
  15,
  15,
  15,
  15,
  10,
  10,
  10,
  10,
  10,
  9,
  8,
  7,
  6,
  5,
];

let grid;
let alien;
let level;
let time;
let headstart;
// Input stops once these pile up.
let pending;
let locked;

export function init() {
  locked = true;
  level = 0;
  pending = 0;
  headstart = 0;
  time = 0;

  grid = new HexGrid(true, HEX);
  for (let c = 0; c < WIDTH; ++c) {
    for (let r = c % 2; r < HEIGHT; r += 2) {
      const pos = grid.fromDoubled(c, r);
      grid.set(pos, { pos, v: true, s: 1, border: false, astar: -1, rstar: -1 });
    }
  }
  // A hex with fewer than six neighbours is on the edge: that is the way out.
  for (const v of all()) v.border = connections(v) !== 6;

  const start = grid.fromDoubled(4, 8);
  const p = grid.toPixel(start);
  alien = {
    pos: start,
    anim: { ...p },
    legs: [{ ...p }, { ...p }],
    s: 1,
    eye: { x: 0, y: 0 },
    blink: 0,
    blinking: 1,
    looking: 2,
    breath: 0,
    pupil: 0,
  };

  camera.moveTo({ scale: 1 / 50 });
  recenter();
  nextLevel();
}

// LEVEL ///

function nextLevel() {
  level++;
  build(PROG[level] ?? 5);
}

function build(number) {
  alien.s = 1;
  alien.blinking = 1;
  alien.looking = 2;
  alien.eye.x = alien.eye.y = 0;

  const avail = [];
  for (const v of all(true)) {
    v.v = true;
    v.s = 1;
    avail.push(v);
  }
  buildAStar();

  let dif = 0;
  while (dif < number) {
    const v = avail[Math.floor(Math.random() * avail.length)];
    v.v = false;
    arrayRemove(avail, v);
    dif += 1 + v.astar;
  }
  buildAStar();

  // What the cull cut off is gone too. Four or more steps from an edge is
  // somewhere the eye can start.
  avail.length = 0;
  for (const v of all()) {
    if (v.astar === -1) v.v = false;
    if (v.astar === 0 && connections(v) === 0) v.v = false;
    if (v.astar < 4) continue;
    avail.push(v);
  }

  // Nowhere safe to stand. Generate the level again.
  if (avail.length === 0) return build(number);

  for (const v of all(true)) {
    if (!v.v) v.s = 0;
  }

  const v = avail[Math.floor(Math.random() * avail.length)];
  const p = grid.toPixel(v.pos);
  alien.pos = v.pos;
  alien.anim.x = p.x;
  alien.anim.y = p.y;
  for (const l of alien.legs) {
    l.x = p.x;
    l.y = p.y;
  }

  buildAStar();
  cleanupLoose(false);
  recenter().then(() => {
    camera.shake(0.2, 50);
    sound.play("hit");
    locked = false;
  });

  setHeadstart(3);
  pending = 0;
}

function setHeadstart(n) {
  headstart = n;
  if (n === 0) {
    msg(`LEVEL ${level}`);
    return;
  }
  msg(`LEVEL ${level} [ ${"⬣ ".repeat(n)}]`);
}

async function finishGame() {
  camera.stop();
  act(camera).reset();
  pending = 100;

  const wait = [];
  let delay = 0.5;
  for (const v of all()) {
    v.v = false;
    wait.push(
      act(v)
        .delay(delay)
        .then(() =>
          sound.play("drop", { detune: (2 * Math.random() - 1) * 1200, delay: 0.1 })
        )
        .attr("s", 0, 0.5, ease.quadIn),
    );
    delay += 0.15;
  }
  await Promise.all(wait);
  await promiseSleep(0.1);

  sound.play("fall");
  await act(alien).attr("s", 0, 0.5, ease.backIn(3));

  camera.moveTo({ x: 512, y: 512, angle: 0, scale: 1 / 100 });
  await promiseSleep(0.3);

  nextLevel();
}

// Hexes the eye cannot reach are not part of the puzzle.
async function cleanupLoose(audible = true) {
  const wait = [];
  let delay = 0.1;
  let snd = 0.085;
  for (const v of all()) {
    if (v.rstar !== -1) continue;
    if (act(v).is()) continue;
    v.v = false;
    wait.push(act(v).attr("s", 0, 0.5, ease.quadIn, delay));
    delay += 0.01;
    snd += 0.01;
    if (audible && snd >= 0.085) {
      snd -= 0.085;
      sound.play("drop", {
        detune: (2 * Math.random() - 1) * 1200,
        delay: delay + 0.1,
      });
    }
  }
  await Promise.all(wait);
}

// THE EYE ///

// Legs first, then the head catches up and overshoots, then the trailing leg.
// In pixels and not hex coordinates, so escapeAlien can aim off the board.
function actAlien(to) {
  alien.looking = 10;
  sound.play("move");

  act(alien.eye)
    .attr("x", 0, 0.5 + 0.3 * Math.random(), ease.quadIn)
    .attr("y", 0, 0.5 + 0.3 * Math.random(), ease.quadIn);

  const r = () => 0.3 * Math.random();
  return act(alien)
    .attr("legs.0.x", to.x, 0.3 + r(), ease.quadIn)
    .attr("legs.0.y", to.y, 0.3 + r(), ease.quadIn)
    .then()
    .attr("anim.x", to.x, 0.5 + r(), ease.backOut(2 + 5 * r()))
    .attr("anim.y", to.y, 0.5 + r(), ease.backOut(2 + 5 * r()))
    .attr("legs.1.x", to.x, 0.3 + r(), ease.quadOut, 0.3)
    .attr("legs.1.y", to.y, 0.3 + r(), ease.quadOut, 0.3);
}

function decideAlien() {
  const here = grid.get(alien.pos);
  if (here.astar === -1) return null;

  let best = [];
  for (const n of neighbors(here)) {
    if (best.length === 0 || best[0].astar > n.astar) {
      best = [n];
      continue;
    }
    if (best[0].astar === n.astar) best.push(n);
  }

  return best[Math.floor(Math.random() * best.length)];
}

function moveAlien() {
  const dec = decideAlien();
  if (dec === null) {
    finishGame();
    return;
  }
  alien.pos = dec.pos;
  return actAlien(grid.toPixel(dec.pos)).then(escapeAlien);
}

// It walks to a point outside the camera; alien.pos stays on the hex it left,
// since there is no hex to land on.
function escapeAlien() {
  const v = grid.get(alien.pos);
  if (!v.border) return;
  pending = 100;

  const target = grid.toPixel(v.pos);
  const { x: c, y: r } = grid.toDoubled(v.pos);
  const b = 1.1 * HEX;
  const near = camera.toWorld(-b, -b);
  const far = camera.toWorld(1024 + b, 1024 + b);
  if (c === 0) target.x = near.x;
  else if (c === WIDTH - 1) target.x = far.x;
  else if (r <= 1) target.y = near.y;
  else if (r >= HEIGHT - 2) target.y = far.y;

  return actAlien(target).delay(0.5).then(() => {
    if (locked) return;
    score.value = level - 1;
    locked = true;
    gameOver({ score: true });
  });
}

function blinkAlien() {
  if (alien.blink !== 0) return;
  act(alien)
    .attr("blink", 1, 0.1, ease.quadIn).then()
    .attr("blink", 0, 0.1, ease.quadIn);
}

function recenter() {
  const rect = { minx: 1024, miny: 1024, maxx: 0, maxy: 0 };
  for (const v of all()) {
    const { x, y } = grid.toPixel(v.pos);
    rect.minx = Math.min(rect.minx, x - HEX);
    rect.maxx = Math.max(rect.maxx, x + HEX);
    rect.miny = Math.min(rect.miny, y - SQRT3 * HEX / 2);
    rect.maxy = Math.max(rect.maxy, y + SQRT3 * HEX / 2);
  }

  const border = 30;
  rect.minx -= border;
  rect.miny -= border;
  rect.maxx += border;
  rect.maxy += border;

  const dur = camera.scale < 1 ? 1 : 0.25;
  camera.glide(
    camera.fit({
      x: rect.minx,
      y: rect.miny,
      width: rect.maxx - rect.minx,
      height: rect.maxy - rect.miny,
    }),
    { duration: dur, ease: ease.quadOut },
  );
  // The glide is the camera's, so return a timer of the same length.
  return act(camera).delay(dur);
}

// UPDATE ///

function updateNext() {
  buildAStar();
  cleanupLoose();

  if (headstart > 0) setHeadstart(headstart - 1);

  // Once for the hex taken, once after the loose ones have fallen.
  recenter();
  act(camera).delay(1).then(() => recenter());

  if (headstart === 0 || grid.get(alien.pos).astar === -1) moveAlien();
  pending--;
}

export function update(dt) {
  time += dt;
  alien.breath = Math.sin(TAU * time * 0.12);
  alien.pupil = Math.cos(333 + TAU * time * 0.035);

  alien.blinking -= dt;
  if (alien.blinking <= 0) {
    blinkAlien();
    alien.blinking = 2 + 8 * Math.random();
  }

  alien.looking -= dt;
  if (alien.looking <= 0) {
    alien.looking = 2 + 10 * Math.random();
    act(alien.eye).reset()
      .attr("x", -1 + 2 * Math.random(), 0.5 + 0.3 * Math.random(), ease.quadIn)
      .attr("y", -1 + 2 * Math.random(), 0.5 + 0.3 * Math.random(), ease.quadIn);
  }

  if (locked) return;
  if (pending > 2) return;
  if (!input.just.act) return;

  const v = grid.get(grid.fromPixel(camera.toWorld(input.x, input.y)));
  if (!v?.v) return;
  if (v === grid.get(alien.pos)) return;

  v.v = false;
  sound.play("drop");
  updateNext();
  pending++;
  act(v).attr("s", 0, 0.5, ease.quadIn);
}

// RENDER ///

export function render(ctx) {
  ctx.save();
  camera.apply(ctx);

  for (const v of all(true)) {
    if (v.s === 0) continue;
    ctx.lineWidth = 1;
    ctx.strokeStyle = ctx.fillStyle = meta.fg;
    renderHex(ctx, v, HEX * v.s, 10 * v.s);
  }

  for (const v of all(true)) {
    if (v.s === 0) continue;
    ctx.lineWidth = 5 * v.s;
    ctx.strokeStyle = meta.fg;
    ctx.fillStyle = v.border ? RIM : GROUND;
    renderHex(ctx, v, HEX * v.s);
  }

  renderAlien(ctx, alien.anim, alien.legs);
  ctx.restore();
}

function renderAlien(ctx, head, legs) {
  ctx.save();
  ctx.translate(head.x, head.y);
  ctx.scale(alien.s, alien.s);

  const br = 0.65;
  const major = 48 + alien.breath;

  for (const l of legs) {
    const body = vec.sub(l, head);
    const norm = vec.normalize(vec.rotate(body, Math.PI / 2));
    const cx = body.x * br;
    const cy = body.y * br;

    ctx.fillStyle = SKIN;
    ctx.beginPath();
    ctx.moveTo(-norm.x * major, -norm.y * major);
    ctx.bezierCurveTo(
      cx,
      cy,
      cx,
      cy,
      body.x - norm.x * 25,
      body.y - norm.y * 25,
    );
    ctx.lineTo(body.x + norm.x * 25, body.y + norm.y * 25);
    ctx.bezierCurveTo(cx, cy, cx, cy, norm.x * major, norm.y * major);
    ctx.closePath();
    ctx.fill();
    ctx.fillCircle(body.x, body.y, 25);
  }

  ctx.fillStyle = SKIN;
  ctx.fillCircle(0, 0, major);
  ctx.fillStyle = WHITE;
  ctx.fillCircle(0, 0, 38);

  const ER = 16;
  const rb = 20.5 - alien.pupil;
  const rx = rb - 5 * vec.len(alien.eye);
  const ang = vec.angle(alien.eye);
  ctx.fillStyle = IRIS;
  ctx.beginPath();
  ctx.ellipse(alien.eye.x * ER, alien.eye.y * ER, rx, rb, ang, 0, TAU);
  ctx.fill();

  const f = Math.sin((vec.len(alien.eye) / Math.SQRT2) * Math.PI / 2) ** 2;
  const ff = 4 + 2 * f;
  const d = rb / 4 + (rb / 10) * f;
  ctx.fillStyle = WHITE;
  ctx.beginPath();
  ctx.ellipse(
    alien.eye.x * ER - d,
    alien.eye.y * ER - d,
    rx / ff,
    rb / ff,
    ang,
    0,
    TAU,
  );
  ctx.fill();

  if (alien.blink > 0) {
    ctx.fillStyle = SKIN;
    ctx.beginPath();
    ctx.arc(0, 0, 39, Math.PI, TAU);
    if (alien.blink < 0.5) {
      ctx.ellipse(0, 0, 39, lerp(39, 0, alien.blink * 2), 0, 0, Math.PI, true);
    } else {
      ctx.ellipse(0, 0, 39, lerp(0, 39, (alien.blink - 0.5) * 2), 0, 0, Math.PI);
    }
    ctx.fill();
  }

  ctx.restore();
}

// HEX GRID ///

function* all(invalid = false) {
  for (const v of grid.values()) {
    if (invalid || v.v) yield v;
  }
}

function* neighbors(p) {
  for (const n of grid.neighbors(p.pos)) {
    const v = grid.get(n);
    if (v?.v) yield v;
  }
}

function connections(p) {
  let n = 0;
  for (const _ of neighbors(p)) n++;
  return n;
}

// A unit hexagon, scaled at draw time. Built on first use, not at module
// scope: the build imports this under Deno, where there is no Path2D.
let hexPath = null;

function unitHex() {
  const p = new Path2D();
  p.moveTo(-1, 0);
  p.lineTo(-0.5, -H2);
  p.lineTo(0.5, -H2);
  p.lineTo(1, 0);
  p.lineTo(0.5, H2);
  p.lineTo(-0.5, H2);
  p.closePath();
  return p;
}

function renderHex(ctx, p, size, delta = 0) {
  hexPath ??= unitHex();
  const { x, y } = grid.toPixel(p.pos);
  ctx.save();
  ctx.translate(x + delta, y + delta);
  ctx.scale(size, size);
  ctx.fill(hexPath);
  // The scale applies to the stroke too, so undo it to keep the width as it was.
  const w = ctx.lineWidth;
  ctx.lineWidth = w / size;
  ctx.stroke(hexPath);
  ctx.lineWidth = w;
  ctx.restore();
}

// Breadth-first from `beach`, writing the step count into v[name].
function astarPropagate(beach, name) {
  const visited = new Set();
  let step = 0;
  while (beach.length > 0) {
    const next = [];
    for (const v of beach) {
      if (!v.v || visited.has(v)) continue;
      v[name] = step;
      visited.add(v);
      for (const n of neighbors(v)) {
        if (visited.has(n)) continue;
        next.push(n);
      }
    }
    beach = next;
    step++;
  }
}

// astar: steps to the nearest edge, -1 where there is no way out at all.
// rstar: steps from where the eye stands, -1 for a hex that has come loose.
function buildAStar() {
  const beach = [];
  for (const v of all(true)) {
    v.astar = -1;
    v.rstar = -1;
    if (v.v && v.border) beach.push(v);
  }
  astarPropagate(beach, "astar");

  const here = grid.get(alien.pos);
  if (here) astarPropagate([here], "rstar");
}
