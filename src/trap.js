/*
 * trap - break the hex floor out from under a wandering eye.
 *
 * Every click drops one hex. The eye then steps one hex towards the nearest
 * edge; reaching one ends the run. Strand it on an island instead and the
 * board falls away and the next, denser level builds. Based on Isola.
 */

import { ease, extra, vec } from "./alma/src/index.js";
import { act, camera, gameOver, mouse, msg, score, SIZE } from "./lib/one.js";
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
  finishGood: false,
  date: "2021-05-09",
};

const GROUND = "#7E6352";
const SKIN = "#932C4B";
const WHITE = "#F2F0E5";
const IRIS = "#212123";
const RIM = "#B9A588";

// The shared score bar the board has to stay clear of.
const BAR = 44;

sound.make("hit", 0.3, (f, track) => {
  track(f.karplus_strong, { b: 0.5, freq: 40, S: 0.1 });
  track(f.biquad, { type: "lowpass", freq: 1500 });
  track(f.bitcrush, { sample: 4, bits: 24 });
  track(f.compressor);
  track(f.envelope, {
    env: f.ADSR({ sustainv: 2, sustain: 0.1, release: 0.2, type: "linear" }),
  });
});

sound.make("drop", 0.3, (f, track) => {
  track(f.oscillator, { type: "saw", freq: f.linear(100, -300) });
  track(f.oscillator, { type: "brown", amp: 0.5 });
  track(f.ringmod, { wet: 1, freq: 120 });
  track(f.biquad, { type: "lowpass", freq: 1000 });
  track(f.envelope, {
    env: f.ADSR({ sustainv: 1, sustain: 0.05, release: 0.25, type: "linear" }),
  });
});

sound.make("move", 0.65, (f, track) => {
  track(f.oscillator, { type: "sine", freq: f.VSAJ(400, 400, -4000) });
  track(f.ringmod, { wet: 0.5, freq: 200 });
  track(f.envelope, {
    env: f.ADSR({
      attack: 0.3,
      sustain: 0.2,
      release: 0.25,
      sustainv: 1,
      type: "exp",
    }),
  });
});

sound.make("fall", 0.5, (f, track) => {
  track(f.oscillator, { type: "sine", freq: f.VSAJ(400, -200) });
  track(f.ringmod, { wet: 0.5, freq: 200 });
  track(f.envelope, {
    env: f.ADSR({ attack: 0.1, release: 0.4, sustainv: 1, type: "linear" }),
  });
});

const WIDTH = 10;
const HEIGHT = 17;
// The hex radius. Columns step 3/2 of it and rows half its height, so a cell
// only exists where (c + r) is even.
const HEX = 60;
const H2 = SQRT3 / 2;

// How much hex to cull at each level, harder-to-reach hexes counting for more.
// Runs out at level 24 and stays at 5 after that.
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

let map;
let alien;
let level;
let time;
// Free moves the eye gets before it starts running for the edge.
let headstart;
// Clicks still resolving. Input stops once they pile up.
let pending;
// True while a level is building, or once the eye is away.
let locked;

export function init() {
  locked = true;
  level = 0;
  pending = 0;
  headstart = 0;
  time = 0;

  map = {};
  for (let c = 0; c < WIDTH; ++c) {
    map[c] = {};
    for (let r = 0; r < HEIGHT; ++r) {
      if ((c + r) % 2 === 1) continue;
      map[c][r] = { c, r, v: true, s: 1, border: false, astar: -1, rstar: -1 };
    }
  }
  // A hex with fewer than six neighbours is on the rim: that is the way out.
  for (const v of all()) v.border = connections(v) !== 6;

  alien = {
    c: 4,
    r: 8,
    anim: { c: 4, r: 8 },
    legs: [{ c: 4, r: 8 }, { c: 4, r: 8 }],
    s: 1,
    eye: { x: 0, y: 0 },
    blink: 0,
    blinking: 1,
    looking: 2,
    breath: 0,
    pupil: 0,
  };

  camera.reset();
  camera.z *= 50;
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

  // Whatever the cull cut off is gone too. What is left four or more steps
  // from an edge is somewhere the eye can start.
  avail.length = 0;
  for (const v of all()) {
    if (v.astar === -1) v.v = false;
    if (v.astar === 0 && connections(v) === 0) v.v = false;
    if (v.astar < 4) continue;
    avail.push(v);
  }

  // Nowhere safe to stand. Roll the level again.
  if (avail.length === 0) return build(number);

  for (const v of all(true)) {
    if (!v.v) v.s = 0;
  }

  const v = avail[Math.floor(Math.random() * avail.length)];
  alien.c = alien.anim.c = v.c;
  alien.r = alien.anim.r = v.r;
  for (const l of alien.legs) {
    l.c = v.c;
    l.r = v.r;
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
  act(camera).reset();
  pending = 100;

  const wait = [];
  let delay = 0.5;
  for (const v of all()) {
    v.v = false;
    wait.push(
      act(v)
        .delay(delay)
        .then(() => sound.play("drop", (2 * Math.random() - 1) * 1200, 0.1))
        .attr("s", 0, 0.5, ease.quadIn),
    );
    delay += 0.15;
  }
  await Promise.all(wait);
  await promiseSleep(0.1);

  sound.play("fall");
  await act(alien).attr("s", 0, 0.5, ease.backIn(3));

  camera.reset();
  camera.z *= 100;
  await promiseSleep(0.3);

  nextLevel();
}

// Hexes the eye can no longer reach are not part of the puzzle. Drop them.
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
      sound.play("drop", (2 * Math.random() - 1) * 1200, delay + 0.1);
    }
  }
  await Promise.all(wait);
}

// THE EYE ///

// Legs first, then the head catches up and overshoots, then the trailing leg.
function actAlien(target) {
  alien.looking = 10;
  sound.play("move");

  act(alien.eye)
    .attr("x", 0, 0.5 + 0.3 * Math.random(), ease.quadIn)
    .attr("y", 0, 0.5 + 0.3 * Math.random(), ease.quadIn);

  // A step off the board is only ever animated: it has no hex to land on.
  if (!target.final) {
    alien.c = target.c;
    alien.r = target.r;
  }

  const r = () => 0.3 * Math.random();
  return act(alien)
    .attr("legs.0.c", target.c, 0.3 + r(), ease.quadIn)
    .attr("legs.0.r", target.r, 0.3 + r(), ease.quadIn)
    .then()
    .attr("anim.c", target.c, 0.5 + r(), ease.backOut(2 + 5 * r()))
    .attr("anim.r", target.r, 0.5 + r(), ease.backOut(2 + 5 * r()))
    .attr("legs.1.c", target.c, 0.3 + r(), ease.quadOut, 0.3)
    .attr("legs.1.r", target.r, 0.3 + r(), ease.quadOut, 0.3);
}

// One step towards the nearest edge, or null when every route is cut.
function decideAlien() {
  if (get(alien).astar === -1) return null;

  let best = [];
  for (const n of neighbors(get(alien))) {
    if (best.length === 0 || best[0].astar > n.astar) {
      best = [n];
      continue;
    }
    if (best[0].astar === n.astar) best.push(n);
  }

  const pick = best[Math.floor(Math.random() * best.length)];
  return { c: pick.c, r: pick.r };
}

function moveAlien() {
  const dec = decideAlien();
  if (dec === null) {
    finishGame();
    return;
  }
  return actAlien(dec).then(escapeAlien);
}

// Standing on the rim, the eye walks off the screen and the run ends.
function escapeAlien() {
  const v = get(alien);
  if (!v.border) return;
  pending = 100;

  const target = posHex(v);
  const b = 1.1 * HEX;
  const near = camera.map({ x: -b, y: -b });
  const far = camera.map({ x: SIZE + b, y: SIZE + b });
  if (v.c === 0) target.x = near.x;
  else if (v.c === WIDTH - 1) target.x = far.x;
  else if (v.r <= 1) target.y = near.y;
  else if (v.r >= HEIGHT - 2) target.y = far.y;

  // Back from pixels into fractional hex coordinates, so it can be tweened to.
  const q = 2 / 3 * target.x / HEX;
  const r = (-1 / 3 * target.x + SQRT3 / 3 * target.y) / HEX;
  target.c = q;
  target.r = 2 * r + q;
  target.final = true;

  return actAlien(target).delay(0.5).then(() => {
    if (locked) return;
    score.value = level - 1;
    locked = true;
    gameOver();
  });
}

function blinkAlien() {
  if (alien.blink !== 0) return;
  act(alien)
    .attr("blink", 1, 0.1, ease.quadIn).then()
    .attr("blink", 0, 0.1, ease.quadIn);
}

// Frames whatever is left of the board, leaving room for the score bar.
function recenter() {
  const rect = { minx: SIZE, miny: SIZE, maxx: 0, maxy: 0 };
  for (const v of all()) {
    const { x, y } = posHex(v);
    rect.minx = Math.min(rect.minx, x - HEX);
    rect.maxx = Math.max(rect.maxx, x + HEX);
    rect.miny = Math.min(rect.miny, y - SQRT3 * HEX / 2);
    rect.maxy = Math.max(rect.maxy, y + SQRT3 * HEX / 2);
  }

  const border = 30;
  rect.minx -= border;
  rect.miny -= border + BAR;
  rect.maxx += border;
  rect.maxy += border;

  // The first framing of a level flies in from far out, so give it longer.
  const dur = camera.z > SIZE ? 1 : 0.25;
  return camera.lerp(
    camera.lookRect(
      rect.minx,
      rect.miny,
      rect.maxx - rect.minx,
      rect.maxy - rect.miny,
      camera.angle,
    ),
    dur,
    ease.quadOut,
  );
}

// UPDATE ///

function updateNext() {
  buildAStar();
  cleanupLoose();

  if (headstart > 0) setHeadstart(headstart - 1);

  // Twice: once for the hex just taken, once after the loose ones have fallen.
  recenter();
  act(camera).delay(1).then(() => recenter());

  if (headstart === 0 || get(alien).astar === -1) moveAlien();
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
  if (!mouse.click) return;

  const v = get(mouseHex());
  if (!v || !v.v) return;
  if (v.c === alien.c && v.r === alien.r) return;

  v.v = false;
  sound.play("drop");
  updateNext();
  pending++;
  act(v).attr("s", 0, 0.5, ease.quadIn);
}

// RENDER ///

export function render(ctx) {
  ctx.save();
  camera.transform(ctx);

  // Pass one is the drop shadow, offset down-right and shrinking with the hex.
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

  renderAlien(ctx, posHex(alien.anim), alien.legs.map(posHex));
  ctx.restore();
}

function renderAlien(ctx, head, legs) {
  ctx.save();
  ctx.translate(head.x, head.y);
  ctx.scale(alien.s, alien.s);

  const br = 0.65;
  const major = 48 + alien.breath;

  // Each leg is one closed shape: a wide curve out to the foot, and back.
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

  // The iris squashes along the direction it looks, and carries a highlight
  // that slides further off-centre the further the eye turns.
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
    // Two lids meeting in the middle: the top is a fixed arc, the bottom an
    // ellipse whose height closes to nothing and opens again.
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
  for (let c = 0; c < WIDTH; ++c) {
    for (let r = 0; r < HEIGHT; ++r) {
      const v = get({ c, r });
      if (!v) continue;
      if (invalid || v.v) yield v;
    }
  }
}

function get(p) {
  return map[p.c]?.[p.r] ?? null;
}

const NEIGHBOURS = [
  [+1, +1],
  [+1, -1],
  [0, -2],
  [-1, -1],
  [-1, +1],
  [0, +2],
];

function* neighbors(p) {
  for (const [dc, dr] of NEIGHBOURS) {
    const v = get({ c: p.c + dc, r: p.r + dr });
    if (v?.v) yield v;
  }
}

function connections(p) {
  let n = 0;
  for (const _ of neighbors(p)) n++;
  return n;
}

function posHex(p) {
  return { x: HEX * 3 / 2 * p.c, y: HEX * H2 * p.r };
}

// A unit hexagon, scaled to size at draw time. Built on first use, not at
// module scope: the build imports this module under Deno, where there is no
// Path2D.
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
  const { x, y } = posHex(p);
  ctx.save();
  ctx.translate(x + delta, y + delta);
  ctx.scale(size, size);
  ctx.fill(hexPath);
  // The scale hits the stroke too, so undo it to keep the width where it was.
  const w = ctx.lineWidth;
  ctx.lineWidth = w / size;
  ctx.stroke(hexPath);
  ctx.lineWidth = w;
  ctx.restore();
}

// Pointer to hex: into cube coordinates, round all three, then fix up whichever
// moved furthest so they still sum to zero.
function mouseHex() {
  const m = camera.map(mouse);
  const q = 2 / 3 * m.x / HEX;
  const r = (-1 / 3 * m.x + SQRT3 / 3 * m.y) / HEX;

  let rx = Math.round(q);
  let ry = Math.round(-q - r);
  let rz = Math.round(r);

  const dx = Math.abs(rx - q);
  const dy = Math.abs(ry + q + r);
  const dz = Math.abs(rz - r);

  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;

  return { c: rx, r: 2 * rz + rx };
}

// Breadth-first flood out from `beach`, writing the step count into v[name].
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

  const here = get(alien);
  if (here) astarPropagate([here], "rstar");
}
