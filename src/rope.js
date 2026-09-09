/*
 * rope - swing up an endless cave on two hands.
 *
 * Drag a hand and let go to fling it. Whatever rope it touches, it grabs, and
 * the other hand comes along. The ropes are simulated, not scripted: each one
 * is a chain of planck bodies, and the cave generates itself ahead of you along
 * a wandering path. Below, a red saw follows that same path up. Let go of
 * everything for five seconds, or let the saw reach you, and the run ends.
 *
 * The only game here that needs a physics engine, so it is the only one that
 * pays for src/lib/planck.js.
 */

import { ease, extra, vec } from "./alma/src/index.js";
import { act, camera, fixed, gameOver, mouse, score, SIZE } from "./lib/one.js";
import pl from "./lib/planck.js";
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
  finishGood: false,
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
// Two plucked strings an octave apart, cut short: a rope going taut.
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

// The path the cave follows, and the state that extends it.
let path;
let pathDir;
let pathVel;
// Free height remaining in each of eight columns across the path's width.
let pathHorizon;

// The saw.
let enemy;
let enemyPath;
let enemySpeed;
let enemyPhase;
let enemyStep;
let enemyReset;
// Rises by one every enemyReset steps, and enemyReset itself shortens.
let enemyNatural;

// Bodies wait here for the step to end: planck will not let a joint be created
// from inside a contact callback.
const deferred = [];

export function init() {
  world = pl.World({});
  world.setGravity({ x: 0, y: 9.8 });
  world.on("begin-contact", beginContact);
  world.on("pre-solve", preSolve);
  world.on("post-solve", postSolve);

  ropes = new Set();
  shot = null;
  time = 0;
  deferred.length = 0;

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

  camera.reset();
  camera.z = VIEW * ZOOM;
  camera.set(camera.lookAt(0, 0));
}

// BODIES ///

function createEnemy() {
  enemyPath = 0;
  enemyStep = 0;
  enemyReset = 1000;
  enemySpeed = 1;
  enemyNatural = 0;
  enemyPhase = 0;

  enemy = world.createBody({ userData: "enemy" });
  enemy.setPosition({ x: 0, y: 5 * ZOOM });
  // A wide, thin sensor bar. Only the head's category collides with it.
  const dim = 6.5 * 4;
  enemy.createFixture(pl.Box(dim, dim / 8, { x: 0, y: dim / 8 }), {
    isSensor: true,
    filterGroupIndex: 5,
    filterCategoryBits: 4,
    filterMaskBits: 4,
  });
}

// Head, two trailing tail segments, and two arms. Each arm is hand -> elbow ->
// head, held by a rope joint for the hard limit and a spring for the give.
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

  player.head = world.createDynamicBody({ userData: "head" });
  player.head.createFixture(pl.Circle(pl.Vec2(0, 0), 0.6), {
    density,
    filterGroupIndex: 5,
    filterCategoryBits: 0,
  });
  player.head.setPosition({ x: 0, y: 0 });

  let last = player.head;
  for (let i = 0; i < 2; ++i) {
    const o = world.createDynamicBody({ gravityScale: 1 });
    o.radius = 0.4 - i * 0.2;
    o.createFixture(pl.Circle(pl.Vec2(0, 0), o.radius), {
      density,
      isSensor: true,
      filterGroupIndex: -1,
      filterCategoryBits: 0,
    });
    o.setPosition({ x: 0, y: i });

    world.createJoint(pl.RopeJoint(
      {
        maxLength: 1 - i * 0.4,
        localAnchorA: pl.Vec2(0, 0),
        localAnchorB: pl.Vec2(0, 0),
      },
      last,
      o,
    ));
    last = o;
    player.body.push(o);
  }

  let first = true;
  for (const a of player.arms) {
    a.hand = world.createDynamicBody({
      userData: "hand",
      bullet: true,
      linearDamping: 0.1,
    });
    // A wide sensor so a hand can be grabbed by a click near it, a tiny one
    // for the pointer query, and a small solid one that meets rope.
    a.hand.createFixture(pl.Circle(pl.Vec2(0, 0), 0.8 * ZOOM), {
      isSensor: true,
    });
    a.hand.createFixture(pl.Circle(pl.Vec2(0, 0), 0.1), {
      density: 0,
      filterGroupIndex: 3,
    });
    a.hand.createFixture(pl.Circle(pl.Vec2(0, 0), 0.3), {
      density: 1,
      filterCategoryBits: 4,
      filterMaskBits: 4,
    });

    a.joint = world.createDynamicBody({});
    a.joint.createFixture(pl.Circle(pl.Vec2(0, 0), 0.1), { density: 0.1 });

    const side = first ? -1 : 1;
    first = false;
    a.hand.setPosition({ x: 1.5 * side, y: -1 });
    a.joint.setPosition({ x: side, y: -0.5 });

    for (const [x, y] of [[a.hand, a.joint], [a.joint, player.head]]) {
      world.createJoint(pl.RopeJoint(
        {
          maxLength: 0.9,
          localAnchorA: pl.Vec2(0, 0),
          localAnchorB: pl.Vec2(0, 0),
        },
        x,
        y,
      ));
      world.createJoint(pl.DistanceJoint(
        {
          length: 0.85,
          localAnchorA: pl.Vec2(0, 0),
          localAnchorB: pl.Vec2(0, 0),
          collideConnected: false,
          frequencyHz: 10,
          dampingRatio: 0.5,
        },
        x,
        y,
      ));
    }
  }
}

// A chain of one-metre links from a to b. `close` pins the far end too; an open
// rope hangs. Links are numbered heaviest-first so a rope does not whip.
function addRopeTwo(a, b, close = true) {
  const r = vec.sub(b, a);
  const v = vec.normalize(r);
  const n = vec.perp(v);
  const len = vec.len(r);
  const size = 1;
  const parts = Math.round(len);

  // The links plus their slack have to fit inside the span. If they do not,
  // pull the ends towards each other and try again.
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

  const ha = world.createBody();
  ha.setPosition(a);
  obj.push(ha);

  // A hanging rope starts kicked to one side, so it does not balance upright.
  const dir = close ? 1 : Math.sign(2 * Math.random() - 1);
  for (let i = 0; i < parts; ++i) {
    const p = world.createDynamicBody({
      userData: "rope",
      linearDamping: 0.25,
    });
    p.parent = obj;
    p.createFixture(pl.Box(0.025, size / 2, { x: 0, y: -size / 2 }), {
      density: 9.5 - i * 0.2,
      filterGroupIndex: -3,
      filterCategoryBits: 4,
      filterMaskBits: 4,
    });
    p.setPosition({
      x: a.x + v.x * size * (i + 1) + dir * n.x * 0.5,
      y: a.y + v.y * size * (i + 1) + dir * n.y * 0.5,
    });
    p.setAngle(ang);
    obj.push(p);
  }

  if (close) {
    const hb = world.createBody();
    hb.setPosition(b);
    obj.push(hb);
  }

  const aa = pl.Vec2(0, 0);
  for (let i = 0; i < obj.length - 1; ++i) {
    // The last link meets the far anchor at its centre, not at its tip.
    const ab = close && i === obj.length - 2 ? aa : pl.Vec2(0, -size);
    world.createJoint(pl.RopeJoint(
      {
        maxLength: 0.1,
        collideConnected: false,
        localAnchorA: aa,
        localAnchorB: ab,
      },
      obj[i],
      obj[i + 1],
    ));
    world.createJoint(pl.DistanceJoint(
      {
        length: 0.1,
        frequencyHz: 10,
        dampingRatio: size / 2,
        collideConnected: false,
        localAnchorA: aa,
        localAnchorB: ab,
      },
      obj[i],
      obj[i + 1],
    ));
  }

  ropes.add(obj);
  return obj;
}

function addRopeOne(a, length = 5) {
  return addRopeTwo(a, { x: a.x, y: a.y + length }, false);
}

// THE CAVE ///

// Extends the path one band at a time until it is REACH ahead of the player.
// Each band is a slice across the path's width, cut into `divs` columns; a
// column either gets a horizontal rope to swing from, a vertical one hanging
// down, or nothing. pathHorizon tracks how much clear air each column has left,
// so bands never stack on top of each other.
function stepPath() {
  const here = player.head.getPosition();
  const last = path[path.length - 1];
  if (vec.len(vec.sub(last, here)) > REACH) return;

  const step = VIEW / (4 + 2 * Math.random());
  const next = vec.add(last, vec.mul(pathDir, step));

  const length = VIEW + 7 * Math.random();
  const yv = vec.mul(vec.normalize(pathDir), step);
  const xv = vec.mul(vec.normalize(vec.perp(yv)), length);

  // Advance the horizon by however far each column actually travelled. A turn
  // makes the outside of the bend move further than the inside.
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

  // true: a horizontal rope. false: a hanging one. null: leave it empty.
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

  // Never three horizontal columns in a row, then punch extra holes so the
  // band stays climbable rather than solid.
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

  // Heading sideways, horizontal ropes hang free; heading straight up, the
  // vertical ones do. Whichever runs along the path gets pinned at both ends.
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

  // The path wanders: steer a little, bounded, and keep going.
  const MAXV = 0.1;
  pathVel = clamp(pathVel + MAXV * (2 * Math.random() - 1) * 0.5, -MAXV, MAXV);
  const n = vec.mul(vec.normalize(vec.perp(pathDir)), pathVel);
  pathDir = vec.normalize(vec.add(pathDir, n));

  stepPath();
}

function updateMap() {
  const pos = player.head.getPosition();
  stepPath();

  for (const r of ropes) {
    if (vec.len(vec.sub(r[0].getPosition(), pos)) < CULL) continue;
    for (const x of r) {
      for (let j = x.getJointList(); j; j = j.next) world.destroyJoint(j.joint);
      world.destroyBody(x);
    }
    ropes.delete(r);
  }
}

// CONTACTS ///

function pair(contact, a, b) {
  const ba = contact.getFixtureA().getBody();
  const bb = contact.getFixtureB().getBody();
  const first = ba.getUserData() === a ? ba : bb.getUserData() === a ? bb : null;
  const second = ba.getUserData() === b ? ba : bb.getUserData() === b ? bb : null;
  return first && second ? [first, second] : null;
}

function armOf(hand) {
  return player.arms[0].hand === hand ? player.arms[0] : player.arms[1];
}

function beginContact(contact) {
  if (pair(contact, "head", "enemy")) gameOver();
}

// A hand that already holds something passes through rope. So does one that
// just let go, briefly, so releasing does not immediately re-grab: 300ms for
// the rope it left, 50ms for any other.
function preSolve(contact) {
  const hit = pair(contact, "hand", "rope");
  if (!hit) return;
  const [hand, rope] = hit;

  const arm = armOf(hand);
  if (arm.hold !== null) {
    contact.setEnabled(false);
    return;
  }
  if (arm.holderTime === -1) return;

  const delta = performance.now() - arm.holderTime;
  const grace = arm.holder === rope.parent ? 300 : 50;
  if (delta > grace) return;
  contact.setEnabled(false);
}

// Touching rope with a free hand grabs it, at the contact point.
function postSolve(contact) {
  const hit = pair(contact, "hand", "rope");
  if (!hit) return;
  const [hand, rope] = hit;

  const arm = armOf(hand);
  const delta = performance.now() - arm.holderTime;
  if (arm.holder === rope.parent && (arm.holderTime === -1 || delta < 300)) {
    return;
  }

  const p = contact.getWorldManifold().points[0];
  deferred.push(() => {
    if (arm.hold) world.destroyJoint(arm.hold);
    sound.play("hold", 800 * (2 * Math.random() - 1));
    arm.hold = pl.DistanceJoint(
      {
        length: 0,
        collideConnected: false,
        frequencyHz: 10,
        dampingRatio: 0.5,
      },
      hand,
      rope,
      hand.getPosition(),
      p,
    );
    world.createJoint(arm.hold);
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

  // Holding nothing: stare straight ahead and start the fall clock.
  if (player.arms[0].hold === null && player.arms[1].hold === null) {
    player.eyelook.x = player.eyelook.y = 0;
    player.looking = 5 + Math.random();
    player.onair += dt;
    if (player.onair > 5) gameOver();
    return;
  }
  player.onair = 0;

  // Watch the free hand, or whichever one is being aimed.
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
    const d = vec.normalize(
      vec.sub(player.focuson.getPosition(), player.head.getPosition()),
    );
    player.eyelook.x = d.x;
    player.eyelook.y = d.y;
  }
}

// Follows the head, and leans into whichever way it is drifting.
function updateCamera() {
  const p = player.head.getPosition();
  const target = camera.lookAt(p.x, p.y);

  const ang = TAU * -(target.cx - camera.cx) / 40;
  target.angle = Math.abs(ang) < TAU / 40 ? 0 : ang;

  // The pan is approach()'s 0.05 default in both axes.
  camera.approach(target, { angle: 0.04 });
}

// Press near a hand to take it, drag to aim, release to fling. The pull is
// backwards: the hand flies away from where you dragged it, like a slingshot.
function updateShot() {
  if (mouse.click) {
    const p = camera.map(mouse);
    const aabb = pl.AABB(
      { x: p.x - 0.001, y: p.y - 0.001 },
      { x: p.x + 0.001, y: p.y + 0.001 },
    );

    let hand = null;
    let dist = Infinity;
    world.queryAABB(aabb, (x) => {
      const b = x.getBody();
      if (b.getUserData() !== "hand") return;
      // A free hand already flying fast is not catchable.
      if (!armOf(b).hold && vec.len(b.getLinearVelocity()) > 5) return;

      const d = vec.len(vec.sub(p, b.getPosition()));
      if (d < dist) {
        hand = b;
        dist = d;
      }
    });

    if (hand !== null) {
      shot = { hand, offset: 0, target: { x: mouse.x, y: mouse.y } };
    }
  }

  if (!shot) return;
  shot.offset += 1;

  if (mouse.press) {
    const p = camera.map(mouse);
    const o = shot.hand.getPosition();
    shot.target = vec.add(o, vec.clamp(vec.sub(p, o), 0, 3));
    return;
  }

  if (!mouse.release) return;

  const p = shot.hand.getPosition();
  const v = vec.sub(p, shot.target);
  const l = vec.len(v);
  // Too short a drag is a tap, not a throw.
  if (l < 1) {
    shot = null;
    return;
  }

  const arm = armOf(shot.hand);
  if (arm.hold) {
    world.destroyJoint(arm.hold);
    arm.holderTime = performance.now();
    arm.hold = null;
  }
  shot.hand.applyForceToCenter(vec.mul(v, 50 * l));
  shot = null;
}

// Crawls up the path towards the player, turning to face along it. It speeds
// up on its own over time, and sprints if the player gets too far ahead.
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

  const p = enemy.getPosition();
  const mv = 0.001 * enemySpeed;
  const full = vec.sub(target, p);
  enemy.setPosition(vec.add(p, vec.clamp(full, -mv, mv)));

  const a = enemy.getAngle();
  let da = (target.angle - a + Math.PI) % TAU - Math.PI;
  if (da < -Math.PI) da += TAU;
  enemy.setAngle(a + clamp(da, -0.0035, 0.0035));

  if (vec.len(full) < 0.001) enemyPath++;

  if (++enemyStep > enemyReset) {
    enemyStep -= enemyReset;
    enemyReset = Math.max(300, enemyReset * 0.9);
    enemyNatural++;
  }

  const away = vec.len(vec.sub(player.head.getPosition(), p));
  enemySpeed = away > 20 ? 100 : enemyNatural;
}

export function update(dt) {
  time += dt;

  // The saw shares the physics clock: its speeds are per-step, not per-second.
  fixed(60, (h) => {
    world.step(h);
    updateEnemy();
  });
  for (const w of deferred) w();
  deferred.length = 0;

  // Scored in seconds survived, once the cave proper has started.
  if (path.length > 12) score.value += dt;

  updatePlayer(dt);
  updateCamera();
  updateShot();
  updateMap();
}

// RENDER ///

export function render(ctx) {
  ctx.fillStyle = CAVE;
  ctx.fillRect(0, 0, SIZE, SIZE);

  camera.transform(ctx);

  // The camera rotates, so clip to the square it actually covers: outside it
  // is cave wall, not background.
  const d = camera.z;
  const x = camera.cx - d / 2;
  const y = camera.cy - d / 2;
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

// A sparse field of bricks, parallaxed back by BGZOOM. The pattern comes from
// a hash of the cell, so it is stable without being stored.
const BGZOOM = 4;
const BGSEED = 1 + Math.random();

function renderBG(ctx) {
  ctx.fillStyle = CAVE;

  const half = 7.5 * ZOOM * BGZOOM;
  const x0 = Math.round(camera.cx - half);
  const y0 = Math.round(camera.cy - half);
  const x1 = Math.round(camera.cx + half);
  const y1 = Math.round(camera.cy + half);

  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      const v = Math.floor(BGSEED * (x + y * x + y + x * x * y));
      if (v % 346 !== 0) continue;

      ctx.beginPath();
      ctx.roundRect(
        (x - camera.cx) / BGZOOM + camera.cx,
        (y - camera.cy) / BGZOOM + camera.cy,
        2,
        1.24,
        0.2,
      );
      ctx.fill();
    }
  }
}

// The chain drawn as one curve through the link centres, with a dot on each
// pinned end.
function renderRope(ctx, r) {
  let prev = r[0].getPosition();

  ctx.strokeStyle = ROPE;
  ctx.lineWidth = 0.1;
  ctx.beginPath();
  for (const p of r) {
    const c = p.getWorldCenter();
    ctx.quadraticCurveTo(prev.x, prev.y, c.x, c.y);
    prev = p.getPosition();
  }
  ctx.lineTo(prev.x, prev.y);
  ctx.stroke();

  ctx.fillStyle = ANCHOR;
  const a = r[0].getPosition();
  ctx.fillCircle(a.x, a.y, 0.2);

  const end = r[r.length - 1];
  if (end.getUserData() !== "rope") {
    const b = end.getPosition();
    ctx.fillCircle(b.x, b.y, 0.2);
  }
}

const BIGARM = 0.6;
const SMALLARM = 0.15;

function renderPlayer(ctx) {
  const h = player.head.getPosition();

  // Each arm is a tapered band: wide at the shoulder, narrow at the hand,
  // bending through the elbow body.
  ctx.fillStyle = BODY;
  for (const arm of player.arms) {
    const p = arm.hand.getPosition();
    const j = arm.joint.getPosition();
    const n = vec.normalize(vec.perp(vec.sub(h, p)));

    ctx.beginPath();
    ctx.moveTo(p.x + n.x * SMALLARM, p.y + n.y * SMALLARM);
    ctx.quadraticCurveTo(j.x, j.y, h.x + n.x * BIGARM, h.y + n.y * BIGARM);
    ctx.lineTo(h.x - n.x * BIGARM, h.y - n.y * BIGARM);
    ctx.quadraticCurveTo(j.x, j.y, p.x - n.x * SMALLARM, p.y - n.y * SMALLARM);
    ctx.fill();
  }

  // A closed hand is drawn smaller than an open one.
  ctx.fillStyle = SKIN;
  for (const arm of player.arms) {
    const p = arm.hand.getPosition();
    ctx.fillCircle(p.x, p.y, arm.hold ? 0.22 : 0.3);
  }

  // The tail: from the second segment up to the head, capped by a round end.
  // The first segment is pulled back towards the midpoint so it cannot fold
  // through the head when the body doubles over.
  const b = player.body[1];
  const p = b.getPosition();
  const mid = vec.mul(vec.add(h, p), 0.5);
  const m = vec.add(
    mid,
    vec.clamp(vec.sub(player.body[0].getPosition(), mid), 0, 0.3),
  );

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

// A dashed slingshot band from the hand out to where you are dragging.
function renderShot(ctx) {
  if (!shot) return;

  const p = shot.hand.getPosition();
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

// The saw is an infinite line, so draw only the span crossing the view: a row
// of sliding triangles along it, filled solid on the far side.
function renderEnemy(ctx) {
  const pos = enemy.getPosition();
  const dir = vec.rotate({ x: 1, y: 0 }, enemy.getAngle());
  const centre = { x: camera.cx, y: camera.cy };

  const half = camera.z / 2;
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
  // Slide the teeth along the line, and keep them anchored to the world rather
  // than to the view, so they do not swim as the camera moves.
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
