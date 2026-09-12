/*
 * rope - swing up an endless cave on two hands.
 *
 * Each rope is a chain of rigid bodies and the cave generates itself ahead
 * along a wandering path. The only game that needs a physics engine, so the
 * only one that includes alma's rigid.js and the Box2D behind it.
 */

import { ease, extra, vec } from "./alma/src/index.js";
import { World } from "./alma/src/rigid.js";
import { camera } from "./lib/camera.js";
import { act, fixed, gameOver, input, score, SIZE } from "./lib/one.js";
import { ADSR, biquad, envelope, karplus_strong } from "./lib/fsfx/fsfx.js";
import * as sound from "./lib/sound.js";

const { clamp, lerp, TAU } = extra;

export const meta = {
  title: "rope",
  desc: `
climb up
stay alive
`,
  bg: "#000000",
  fg: "#402F2E",
  scoreMax: true,
  date: "2021-05-23",
};

const CAVE = "#1D1515";
const ROPE = "#7E6352";
const ANCHOR = "#402F2E";
const WHITE = "#B8B5B9";
const IRIS = "#212123";
const SKIN = "#5F556A";
const BODY = "#352B42";
const SAW = "#C6424F";

// The world is in metres. This many of them fill the screen.
const VIEW = 13;
const ZOOM = 1.5;
// Ropes further than this from the player are generated ahead / culled behind.
const REACH = VIEW * 2;
const CULL = VIEW * 3;
sound.make("hold", 0.1, (track) => {
  track(karplus_strong, { b: 1, freq: 100, S: 0.5 });
  track(karplus_strong, { b: 0.5, freq: 50, S: 0.5 });
  track(biquad, { type: "lowpass", freq: 100 });
  track(envelope, {
    env: ADSR({ sustainv: 3, sustain: 0, release: 0.1, type: "linear" }),
  });
});

let world;
let ropes;
let player;
let shot;
let time;

let path;
let pathDir;
let pathVel;
// Free height left in each of eight columns across the path's width.
let pathHorizon;

let enemy;
let enemyPath;
let enemySpeed;
let enemyPhase;
let enemyStep;
let enemyReset;
// Rises by one every enemyReset steps, and enemyReset itself shortens.
let enemyNatural;

// A body's position as a point, which is what every vec call here wants.
const at = (b) => ({ x: b.x, y: b.y });

export function init() {
  // The engine holds 32 worlds for the life of the page, so the round that
  // just ended has to release its slot.
  world?.destroy();
  world = new World({ gravity: { x: 0, y: 9.8 } });
  world.presolve = presolve;

  ropes = new Set();
  shot = null;
  time = 0;

  path = [{ x: 0, y: -5 }];
  pathDir = { x: 0, y: -1 };
  pathVel = 0;
  pathHorizon = [0, 0, 0, 0, 0, 0, 0, 0];

  createPlayer();

  // The opening handholds, so the first swing is always the same.
  addRopeTwo({ x: -2, y: 0 }, { x: 2, y: 0 });
  addRopeTwo({ x: -4, y: 2 }, { x: 4, y: 2 });
  addRopeOne({ x: -3.5, y: -6 }, 5);
  addRopeOne({ x: 0, y: -6 }, 4);
  addRopeOne({ x: 3.5, y: -6 }, 5);

  createEnemy();

  camera.moveTo({ x: 0, y: 0, scale: SIZE / (VIEW * ZOOM) });
}

// BODIES ///

function createEnemy() {
  enemyPath = 0;
  enemyStep = 0;
  enemyReset = 1000;
  enemySpeed = 1;
  enemyNatural = 0;
  enemyPhase = 0;

  // Kinematic, since it is moved by hand every step, and never asleep.
  enemy = world.body({
    y: 5 * ZOOM,
    type: "kinematic",
    canSleep: false,
    data: "enemy",
  });
  // A wide, thin sensor bar. Only the head's category meets it, and the head
  // meets nothing else.
  const dim = 6.5 * 4;
  enemy.box({
    w: 2 * dim,
    h: dim / 4,
    y: dim / 8,
    sensor: true,
    filter: { category: 8, mask: 8 },
  });
}

// Head, two tail segments, two arms. Each arm is hand -> elbow -> head, held
// by a link() at each step of the chain.
function createPlayer() {
  player = {
    arms: [
      { hold: null, hand: null, joint: null, holder: null, holderTime: -1 },
      { hold: null, hand: null, joint: null, holder: null, holderTime: -1 },
    ],
    onair: 0,
    head: null,
    body: [],
    eye: { x: 0, y: 0 },
    eyelook: { x: 0, y: 0 },
    focuson: null,
    pupil: 0,
    blink: 0,
    blinking: 1,
    looking: 2,
    breath: 0,
  };

  const density = 1 / 10;

  player.head = world.body({ x: 0, y: 0, type: "dynamic", data: "head" });
  // A category of its own, which only the saw has and only the saw's mask
  // includes. box2d asks the broadphase for the sensor's mask against the
  // shape's category before it asks whether the two collide, and a category of
  // 0 fails every query, so the saw would pass straight over the head.
  player.head.circle({ r: 0.6, density, filter: { category: 8, mask: 8 } });

  let last = player.head;
  for (let i = 0; i < 2; ++i) {
    // box2d solves the length limit softly and returns the energy, so undamped
    // the tail keeps every jump and winds round the head at 5.2 turns a second.
    // Nothing on the joint constrains that, since a tail spinning round the
    // head is not changing its length; damping is what is left. At 3 it winds
    // 1.48 turns a second and stays 1.30 metres off the head.
    const o = world.body({ x: 0, y: i, type: "dynamic", damping: 3 });
    o.radius = 0.4 - i * 0.2;
    o.circle({
      r: o.radius,
      density,
      sensor: true,
      filter: { group: -1, category: 0 },
    });

    link(last, o, { max: 1 - i * 0.4 });
    last = o;
    player.body.push(o);
  }

  let first = true;
  for (const a of player.arms) {
    const side = first ? -1 : 1;
    first = false;

    a.hand = world.body({
      x: 1.5 * side,
      y: -1,
      type: "dynamic",
      bullet: true,
      damping: 0.1,
      data: "hand",
    });
    // A small solid one that meets rope, a wide sensor for a click near the
    // hand, and a tiny one for the pointer query. Only the solid one has
    // mass: a sensor weighs what its density says like any other shape, and the
    // 1.2 metre one at density 1 would make the hand 4.8 kg against 0.28. The
    // dense shape is built first, since box2d asserts on a massless body.
    a.hand.circle({
      r: 0.3,
      density: 1,
      preSolveEvents: true,
      filter: { category: 4, mask: 4 },
    });
    a.hand.circle({ r: 0.8 * ZOOM, sensor: true, density: 0 });
    a.hand.circle({ r: 0.1, density: 0, filter: { group: 3 } });

    a.joint = world.body({ x: side, y: -0.5, type: "dynamic" });
    a.joint.circle({ r: 0.1, density: 0.1 });

    for (const [x, y] of [[a.hand, a.joint], [a.joint, player.head]]) {
      link(x, y, { max: 0.9, length: 0.85, hertz: 10, damping: 0.5 });
    }
  }
}

// The hard limit and the give in one joint: below `max` a spring at `hertz`
// pulls toward `length`, and `max` is where it stops extending. At the default
// 0 hertz the spring is off and the joint is a rope, which is the tail.
function link(a, b, { max, length = max, hertz, damping, localB }) {
  return world.distance(a, b, {
    localA: [0, 0],
    localB: localB ?? [0, 0],
    length,
    min: 0,
    max,
    spring: true,
    hertz,
    damping,
    collide: false,
  });
}

// A chain of one-metre links from a to b. `close` pins the far end; an open
// rope hangs. Links are heaviest-first so a rope does not whip.
function addRopeTwo(a, b, close = true) {
  const r = vec.sub(b, a);
  const v = vec.normalize(r);
  const n = vec.perp(v);
  const len = vec.len(r);
  const size = 1;
  const parts = Math.round(len);

  // Links plus slack have to fit the span; if not, pull the ends in and retry.
  let diff = len - (parts * (size + 0.1) + 0.1);
  if (diff > -0.05) {
    diff = Math.max(diff, 0.05);
    return addRopeTwo(
      vec.add(a, vec.mul(v, diff / 2)),
      vec.add(b, vec.mul(v, -diff / 2)),
      close,
    );
  }

  const ang = vec.angle(v) - Math.PI / 2;
  const obj = [];

  const ha = world.body(a);
  obj.push(ha);

  // A hanging rope starts pushed to one side, so it does not balance upright.
  const dir = close ? 1 : Math.sign(2 * Math.random() - 1);
  for (let i = 0; i < parts; ++i) {
    const p = world.body({
      x: a.x + v.x * size * (i + 1) + dir * n.x * 0.5,
      y: a.y + v.y * size * (i + 1) + dir * n.y * 0.5,
      angle: ang,
      type: "dynamic",
      damping: 0.25,
      data: "rope",
    });
    p.parent = obj;
    p.box({
      w: 0.05,
      h: size,
      y: -size / 2,
      density: 9.5 - i * 0.2,
      filter: { group: -3, category: 4, mask: 4 },
    });
    obj.push(p);
  }

  if (close) obj.push(world.body(b));

  for (let i = 0; i < obj.length - 1; ++i) {
    // The last link meets the far anchor at its centre, not at its tip.
    const tip = close && i === obj.length - 2 ? [0, 0] : [0, -size];
    link(obj[i], obj[i + 1], {
      max: 0.1,
      hertz: 10,
      damping: size / 2,
      localB: tip,
    });
  }

  ropes.add(obj);
  return obj;
}

function addRopeOne(a, length = 5) {
  return addRopeTwo(a, { x: a.x, y: a.y + length }, false);
}

// THE CAVE ///

// Extends the path a band at a time until it is REACH ahead. Each band is a
// slice across the path's width in `divs` columns; a column gets a horizontal
// rope, a hanging one, or nothing. pathHorizon is the clear air left in each
// column, so bands never stack.
function stepPath() {
  const here = at(player.head);
  const last = path[path.length - 1];
  if (vec.len(vec.sub(last, here)) > REACH) return;

  const step = VIEW / (4 + 2 * Math.random());
  const next = vec.add(last, vec.mul(pathDir, step));

  const length = VIEW + 7 * Math.random();
  const yv = vec.mul(vec.normalize(pathDir), step);
  const xv = vec.mul(vec.normalize(vec.perp(yv)), length);

  // A turn moves the outside of the bend further than the inside.
  let lastDir = vec.sub(last, path[path.length - 2] ?? last);
  if (lastDir.x === 0 && lastDir.y === 0) lastDir = { x: 0, y: -1 };
  const lastNorm = vec.mul(vec.normalize(vec.perp(lastDir)), length);

  for (let i = 0; i < pathHorizon.length; ++i) {
    const p = (2 * (i / pathHorizon.length) - 1) / 2;
    const a = vec.add(yv, vec.mul(xv, p));
    const b = vec.mul(lastNorm, p);
    pathHorizon[i] -= vec.len(vec.sub(a, b)) / step;
  }

  // Resample the horizon down to this band's columns, keeping the worst case.
  const divs = Math.floor(length / (2 + Math.random()));
  const horiz = [];
  for (let i = 0; i < divs; ++i) {
    const h0 = Math.floor(pathHorizon.length * i / divs);
    const h1 = Math.ceil(pathHorizon.length * (i + 1) / divs);
    let max = -1;
    for (let x = h0; x < h1; x++) max = Math.max(max, pathHorizon[x] ?? -1);
    horiz.push(max);
  }

  // true: horizontal rope. false: hanging. null: empty.
  const space = [];
  for (let i = 0; i < divs; ++i) {
    if (horiz[i] > -0.4) {
      space.push(null);
      continue;
    }
    const opts = [true];
    if (horiz[i] < 0.25) opts.push(false);
    space[i] = opts[Math.floor(opts.length * Math.random())];
  }

  // Never three horizontal in a row, then remove some so the band is climbable.
  let cut = Math.max(1, divs - 4);
  for (let i = 0; i < divs - 2; ++i) {
    if (space[i] === true && space[i + 1] === true && space[i + 2] === true) {
      space[i + 2] = null;
      cut--;
    }
  }
  for (let i = 0; i < cut; i++) {
    space[Math.floor(divs * Math.random())] = null;
  }

  const line = [];
  const norm = [];
  for (let idx = 0; idx < divs; ++idx) {
    if (space[idx] === null) continue;

    if (space[idx] === false) {
      const height = 0.75 + 1.5 * Math.random();
      const end = horiz[idx] + 0.5;
      norm.push([idx, end + height, end]);
      horiz[idx] = end + height;
      continue;
    }

    // Two adjacent columns make one long rope instead of two short ones.
    if (space[idx + 1] === true) {
      horiz[idx] = horiz[idx + 1] = 0;
      line.push([idx, idx + 1]);
      idx++;
    } else {
      horiz[idx] = 0;
      line.push([idx, idx]);
    }
  }

  // Whichever kind runs along the path is pinned at both ends.
  const direc = Math.abs(vec.dot(vec.normalize(pathDir), { x: 0, y: -1 }));
  const lineclose = direc >= 0.25;
  const normclose = direc <= 0.75;

  for (const [idx, y0, y1] of norm) {
    const x = (idx + 0.5) / divs - 0.5;
    const at = (y) => vec.add(next, vec.add(vec.mul(xv, x), vec.mul(yv, y)));
    addRopeTwo(at(y0), at(y1), normclose);
  }

  for (const [a, b] of line) {
    const at = (x) => vec.add(next, vec.mul(xv, x / divs - 0.5));
    addRopeTwo(at(a), at(b + 1), lineclose);
  }

  for (let i = 0; i < divs; ++i) {
    const h0 = Math.floor(pathHorizon.length * i / divs);
    const h1 = Math.ceil(pathHorizon.length * (i + 1) / divs);
    for (let x = h0; x <= h1; x++) {
      pathHorizon[x] = Math.max(pathHorizon[x] ?? 0, horiz[i]);
    }
  }

  path.push(next);

  const MAXV = 0.1;
  pathVel = clamp(pathVel + MAXV * (2 * Math.random() - 1) * 0.5, -MAXV, MAXV);
  const n = vec.mul(vec.normalize(vec.perp(pathDir)), pathVel);
  pathDir = vec.normalize(vec.add(pathDir, n));

  stepPath();
}

function updateMap() {
  const pos = at(player.head);
  stepPath();

  for (const r of ropes) {
    if (vec.len(vec.sub(at(r[0]), pos)) < CULL) continue;
    // A rope a hand still holds stays: destroying it takes the hold joint with
    // it and leaves the arm pointing at a dead one.
    if (player.arms.some((a) => a.hold && r.includes(a.hold.b))) continue;
    for (const x of r) x.destroy();
    ropes.delete(r);
  }
}

// CONTACTS ///

function pair(a, b, first, second) {
  const x = a.data === first ? a : b.data === first ? b : null;
  const y = a.data === second ? a : b.data === second ? b : null;
  return x && y ? [x, y] : null;
}

function armOf(hand) {
  return player.arms[0].hand === hand ? player.arms[0] : player.arms[1];
}

// A hand holding something passes through rope, and so does one that just let
// go: 300ms for the rope it left, 50ms for any other. Dropping the contact here
// is also what prevents the grab, since it never reaches begin().
function presolve(fa, fb) {
  const hit = pair(fa.body, fb.body, "hand", "rope");
  if (!hit) return true;
  const [hand, rope] = hit;

  const arm = armOf(hand);
  if (arm.hold !== null) return false;
  if (arm.holderTime === -1) return true;

  const delta = performance.now() - arm.holderTime;
  const grace = arm.holder === rope.parent ? 300 : 50;
  return delta > grace;
}

function begin(contact) {
  const hit = pair(contact.a.body, contact.b.body, "hand", "rope");
  if (!hit) return;
  const [hand, rope] = hit;

  const arm = armOf(hand);
  if (arm.hold !== null) return;

  const p = contact.points[0];
  sound.play("hold", { detune: 800 * (2 * Math.random() - 1) });
  arm.hold = world.distance(hand, rope, {
    localA: [0, 0],
    localB: rope.toLocal(p.x, p.y),
    length: 0,
    spring: true,
    hertz: 10,
    damping: 0.5,
    collide: false,
  });
  arm.holder = rope.parent;
  arm.holderTime = -1;
}

// UPDATE ///

function updatePlayer(dt) {
  player.breath = Math.sin(TAU * time * 0.12);
  player.pupil = Math.cos(333 + TAU * time * 0.035);

  player.blinking -= dt;
  if (player.blinking <= 0 && player.blink === 0) {
    act(player)
      .attr("blink", 1, 0.15, ease.quadIn).then()
      .attr("blink", 0, 0.15, ease.quadIn);
    player.blinking = 2 + 8 * Math.random();
  }

  player.eye.x = lerp(player.eye.x, player.eyelook.x, 0.15);
  player.eye.y = lerp(player.eye.y, player.eyelook.y, 0.15);

  // Holding nothing: look straight ahead and start the fall timer.
  if (player.arms[0].hold === null && player.arms[1].hold === null) {
    player.eyelook.x = player.eyelook.y = 0;
    player.looking = 5 + Math.random();
    player.onair += dt;
    if (player.onair > 5) gameOver({ score: true });
    return;
  }
  player.onair = 0;

  const free = player.arms[0].hold ? player.arms[1] : player.arms[0];
  if (free.hold === null) {
    player.focuson = free.hand;
    player.looking = 5 + Math.random();
  }
  if (shot !== null) {
    player.focuson = shot.hand;
    player.looking = 5 + Math.random();
  }

  player.looking -= dt;
  if (player.looking <= 0) {
    player.looking = 5 + 3 * Math.random();
    player.eyelook.x = -1 + 2 * Math.random();
    player.eyelook.y = -1 + 2 * Math.random();
  } else if (player.focuson) {
    const d = vec.normalize(vec.sub(at(player.focuson), at(player.head)));
    player.eyelook.x = d.x;
    player.eyelook.y = d.y;
  }
}

function updateCamera(dt) {
  const p = at(player.head);

  const ang = TAU * -(p.x - camera.x) / 40;
  const angle = Math.abs(ang) < TAU / 40 ? 0 : ang;

  // approach()'s rates are per second: 3 is its default for the pan, and the
  // lean follows slower. Slowing the pan loses the player, who is moving over a
  // metre a second late in a run on a 19.5 metre screen.
  camera.approach({ x: p.x, y: p.y, angle }, dt, { angle: 2.45 });
}

// The pull is backwards: dragging one way throws the hand the other.
function updateShot() {
  if (input.just.act) {
    const p = camera.toWorld(input.x, input.y);

    let hand = null;
    let dist = Infinity;
    for (const f of world.pick(p.x, p.y)) {
      const b = f.body;
      if (b.data !== "hand") continue;
      if (!armOf(b).hold && vec.len({ x: b.vx, y: b.vy }) > 5) continue;

      const d = vec.len(vec.sub(p, at(b)));
      if (d < dist) {
        hand = b;
        dist = d;
      }
    }

    // Metres, like every other point here: a click and a release inside one
    // frame skips the press branch below, and a target in 1024-space would be
    // a 600 metre drag.
    if (hand !== null) shot = { hand, offset: 0, target: at(hand) };
  }

  if (!shot) return;
  shot.offset += 1;

  if (input.press.act) {
    const p = camera.toWorld(input.x, input.y);
    const o = at(shot.hand);
    shot.target = vec.add(o, vec.clamp(vec.sub(p, o), 0, 3));
    return;
  }

  if (!input.release.act) return;

  const p = at(shot.hand);
  const v = vec.sub(p, shot.target);
  const l = vec.len(v);
  // Too short a drag is a tap, not a throw.
  if (l < 1) {
    shot = null;
    return;
  }

  const arm = armOf(shot.hand);
  if (arm.hold) {
    arm.hold.destroy();
    arm.holderTime = performance.now();
    arm.hold = null;
  }
  const f = vec.mul(v, 50 * l);
  shot.hand.push(f.x, f.y);
  shot = null;
}

// Speeds up over time, and sprints if the player gets too far ahead.
function updateEnemy() {
  enemyPhase = (enemyPhase + 1) % TEETH_PHASE;
  if (enemyPath >= path.length || path.length <= 12) return;

  const here = path[enemyPath];
  const last = path[enemyPath - 1] ?? { x: 0, y: 0 };
  const target = {
    x: here.x,
    y: here.y,
    angle: vec.angle(vec.sub(here, last)) + TAU / 4,
  };

  const p = at(enemy);
  const mv = 0.001 * enemySpeed;
  const full = vec.sub(target, p);
  const next = vec.add(p, vec.clamp(full, -mv, mv));

  const a = enemy.angle;
  let da = (target.angle - a + Math.PI) % TAU - Math.PI;
  if (da < -Math.PI) da += TAU;
  enemy.moveTo(next.x, next.y, a + clamp(da, -0.0035, 0.0035));

  if (vec.len(full) < 0.001) enemyPath++;

  if (++enemyStep > enemyReset) {
    enemyStep -= enemyReset;
    enemyReset = Math.max(300, enemyReset * 0.9);
    enemyNatural++;
  }

  const away = vec.len(vec.sub(at(player.head), p));
  enemySpeed = away > 20 ? 100 : enemyNatural;
}

export function update(dt) {
  time += dt;

  // The saw shares the physics clock: its speeds are per-step, not per-second.
  // Events are read inside the loop, since a step clears the one before it.
  fixed(60, (h) => {
    world.step(h);
    for (const c of world.began) begin(c);
    for (const s of world.sensorBegan) {
      if (s.visitor.body.data === "head") gameOver({ score: true });
    }
    updateEnemy();
  });

  if (path.length > 12) score.value += dt;

  updatePlayer(dt);
  updateCamera(dt);
  updateShot();
  updateMap();
}

// RENDER ///

export function render(ctx) {
  ctx.fillStyle = CAVE;
  ctx.fillRect(0, 0, SIZE, SIZE);

  camera.apply(ctx);

  // The camera rotates, so clip to the square it covers: outside is cave wall.
  const d = SIZE / camera.scale;
  const x = camera.x - d / 2;
  const y = camera.y - d / 2;
  ctx.fillStyle = meta.bg;
  ctx.fillRect(x, y, d, d);
  ctx.beginPath();
  ctx.rect(x, y, d, d);
  ctx.clip();

  renderBG(ctx);
  for (const r of ropes) renderRope(ctx, r);
  renderPlayer(ctx);
  renderShot(ctx);
  renderEnemy(ctx);
}

// Bricks parallaxed back by BGZOOM, on a hash of the cell so nothing is stored.
const BGZOOM = 4;
const BGSEED = 1 + Math.random();

function renderBG(ctx) {
  ctx.fillStyle = CAVE;

  const half = 7.5 * ZOOM * BGZOOM;
  const x0 = Math.round(camera.x - half);
  const y0 = Math.round(camera.y - half);
  const x1 = Math.round(camera.x + half);
  const y1 = Math.round(camera.y + half);

  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const v = Math.floor(BGSEED * (x + y * x + y + x * x * y));
      if (v % 346 !== 0) continue;

      ctx.beginPath();
      ctx.roundRect(
        (x - camera.x) / BGZOOM + camera.x,
        (y - camera.y) / BGZOOM + camera.y,
        2,
        1.24,
        0.2,
      );
      ctx.fill();
    }
  }
}

function renderRope(ctx, r) {
  let prev = at(r[0]);

  ctx.strokeStyle = ROPE;
  ctx.lineWidth = 0.1;
  ctx.beginPath();
  for (const p of r) {
    ctx.quadraticCurveTo(prev.x, prev.y, p.cx, p.cy);
    prev = at(p);
  }
  ctx.lineTo(prev.x, prev.y);
  ctx.stroke();

  ctx.fillStyle = ANCHOR;
  ctx.fillCircle(r[0].x, r[0].y, 0.2);

  const end = r[r.length - 1];
  if (end.data !== "rope") ctx.fillCircle(end.x, end.y, 0.2);
}

const BIGARM = 0.6;
const SMALLARM = 0.15;

function renderPlayer(ctx) {
  const h = at(player.head);

  // Tapered, wide at the shoulder and narrow at the hand, bent at the elbow.
  ctx.fillStyle = BODY;
  for (const arm of player.arms) {
    const p = at(arm.hand);
    const j = at(arm.joint);
    const n = vec.normalize(vec.perp(vec.sub(h, p)));

    ctx.beginPath();
    ctx.moveTo(p.x + n.x * SMALLARM, p.y + n.y * SMALLARM);
    ctx.quadraticCurveTo(j.x, j.y, h.x + n.x * BIGARM, h.y + n.y * BIGARM);
    ctx.lineTo(h.x - n.x * BIGARM, h.y - n.y * BIGARM);
    ctx.quadraticCurveTo(j.x, j.y, p.x - n.x * SMALLARM, p.y - n.y * SMALLARM);
    ctx.fill();
  }

  ctx.fillStyle = SKIN;
  for (const arm of player.arms) {
    ctx.fillCircle(arm.hand.x, arm.hand.y, arm.hold ? 0.22 : 0.3);
  }

  // The first segment is pulled back toward the midpoint so it cannot fold
  // through the head.
  const b = player.body[1];
  const p = at(b);
  const mid = vec.mul(vec.add(h, p), 0.5);
  const m = vec.add(mid, vec.clamp(vec.sub(at(player.body[0]), mid), 0, 0.3));

  const nm = vec.normalize(vec.perp(vec.sub(h, m)));
  const v = vec.sub(m, p);
  const vn = vec.normalize(v);
  const n = vec.normalize(vec.perp(v));
  const j1 = vec.add(m, vec.mul(n, 0.3));
  const j2 = vec.add(m, vec.mul(n, -0.3));

  ctx.fillStyle = BODY;
  ctx.beginPath();
  ctx.moveTo(p.x - n.x * b.radius, p.y - n.y * b.radius);
  ctx.quadraticCurveTo(j2.x, j2.y, h.x - nm.x * 0.6, h.y - nm.y * 0.6);
  ctx.lineTo(h.x + nm.x * 0.6, h.y + nm.y * 0.6);
  ctx.quadraticCurveTo(j1.x, j1.y, p.x + n.x * b.radius, p.y + n.y * b.radius);
  ctx.arcTo(
    p.x - vn.x * b.radius * 5,
    p.y - vn.y * b.radius * 5,
    p.x - n.x * b.radius,
    p.y - n.y * b.radius,
    b.radius,
  );
  ctx.closePath();
  ctx.fill();

  renderHead(ctx, h);
}

// Drawn in the same 38-unit space trap uses, then scaled down to metres.
function renderHead(ctx, h) {
  ctx.save();
  ctx.translate(h.x, h.y);
  ctx.scale(0.45 / 38, 0.45 / 38);

  ctx.fillStyle = BODY;
  ctx.fillCircle(0, 0, 51 + player.breath);
  ctx.fillStyle = WHITE;
  ctx.fillCircle(0, 0, 38);

  const ER = 16;
  const rb = 20.5 - player.pupil;
  const rx = rb - 5 * vec.len(player.eye);
  const ang = vec.angle(player.eye);

  ctx.fillStyle = IRIS;
  ctx.beginPath();
  ctx.ellipse(player.eye.x * ER, player.eye.y * ER, rx, rb, ang, 0, TAU);
  ctx.fill();

  const f = Math.sin((vec.len(player.eye) / Math.SQRT2) * Math.PI / 2) ** 2;
  const ff = 4 + 2 * f;
  const d = rb / 4 + (rb / 10) * f;
  ctx.fillStyle = WHITE;
  ctx.beginPath();
  ctx.ellipse(
    player.eye.x * ER - d,
    player.eye.y * ER - d,
    rx / ff,
    rb / ff,
    ang,
    0,
    TAU,
  );
  ctx.fill();

  if (player.blink > 0) {
    ctx.fillStyle = BODY;
    ctx.beginPath();
    ctx.arc(0, 0, 39, Math.PI, TAU);
    if (player.blink < 0.5) {
      ctx.ellipse(0, 0, 39, lerp(39, 0, player.blink * 2), 0, 0, Math.PI, true);
    } else {
      ctx.ellipse(0, 0, 39, lerp(0, 39, (player.blink - 0.5) * 2), 0, 0, Math.PI);
    }
    ctx.fill();
  }

  ctx.restore();
}

function renderShot(ctx) {
  if (!shot) return;

  const p = at(shot.hand);
  const t = vec.sub(shot.target, p);
  const v = vec.normalize(t);
  const n = vec.perp(v);

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.strokeStyle = SAW;
  ctx.lineWidth = 0.075;
  ctx.setLineDash([0.2, 0.2]);
  ctx.lineDashOffset = shot.offset / 150;

  const BR = 0.4;
  const SR = 0.05;
  ctx.beginPath();
  ctx.moveTo(t.x - n.x * SR, t.y - n.y * SR);
  ctx.arcTo(t.x + 10 * v.x, t.y + 10 * v.y, t.x + n.x * SR, t.y + n.y * SR, SR);
  ctx.lineTo(BR * n.x, BR * n.y);
  ctx.arcTo(-10 * v.x, -10 * v.y, -BR * n.x, -BR * n.y, BR);
  ctx.closePath();
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.restore();
}

const TEETH = 20;
const TEETH_PHASE = 50;

// An infinite line, so draw only the span crossing the view.
function renderEnemy(ctx) {
  const pos = at(enemy);
  const dir = vec.rotate({ x: 1, y: 0 }, enemy.angle);
  const centre = { x: camera.x, y: camera.y };

  const half = SIZE / camera.scale / 2;
  const b = half * Math.SQRT2;
  if (distanceLinePoint(pos, dir, centre) > b) return;

  const adv = projectPointLine(pos, dir, centre);
  const best = vec.add(pos, vec.mul(dir, adv));
  const p0 = vec.add(best, vec.mul(dir, -b));
  const p1 = vec.add(best, vec.mul(dir, b));
  const other = vec.perp(dir);
  const p2 = vec.add(p1, vec.mul(other, half * 2));
  const p3 = vec.add(p0, vec.mul(other, half * 2));

  const size = b * 2 / (TEETH - 1);
  const h = 1;
  // Anchored to the world, so the teeth do not drift as the view moves.
  const dd = size * (-enemyPhase / TEETH_PHASE) - (adv % size);
  const a0 = vec.add(vec.add(p0, vec.mul(other, h / 3)), vec.mul(dir, dd));
  const b0 = vec.add(p1, vec.mul(other, h / 3));

  ctx.fillStyle = SAW;
  ctx.beginPath();
  ctx.moveTo(a0.x, a0.y);
  for (let i = 0; i < TEETH; ++i) {
    const a = vec.add(a0, vec.mul(dir, size * i));
    const m = vec.add(a0, vec.mul(dir, size * (i + 0.5)));
    const u = vec.add(m, vec.mul(other, -h));
    const c = vec.add(a0, vec.mul(dir, size * (i + 1)));
    ctx.lineTo(a.x, a.y);
    ctx.lineTo(u.x, u.y);
    ctx.lineTo(c.x, c.y);
  }
  ctx.lineTo(b0.x, b0.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.lineTo(p3.x, p3.y);
  ctx.fill();
}

function distanceLinePoint(a, ab, p) {
  const u = ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / vec.lsq(ab);
  return vec.len({ x: a.x + u * ab.x - p.x, y: a.y + u * ab.y - p.y });
}

function projectPointLine(a, ab, p) {
  return ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / vec.lsq(ab);
}
