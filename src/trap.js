/*
pig: 5x11 - 3 early placements
tiger: 7x11 - no placement
mouse: 11x11 - very few blocks

TODO:

- astar score on build()
- level progression
- sound
- screen shake / tilt - camera
*/

import * as one from "./one/one.js";
import {C, act, ease, mouse, vec, camera} from "./one/one.js";

one.description("trap", `
destroy blocks
don't let the eye escape
`);

const L = {
  bg: C[11],
  fg: C[19],
  ground: C[20],
  alien: C[18],
  eye: C[0],
  iris: C[4]
};

one.options({
  bgColor: L.bg,
  fgColor: L.fg,
});

const MAP = {};
const WIDTH = 10;
const HEIGHT = 17;
const SIZE = 60;

const H2 = Math.SQRT3 / 2;

const ALIEN = {c: 4, r: 8, blink: 0, blinking: 1, looking: 2, breath: 0,
  s: 1.0,
  pupil: 0,
  eye: {x : 0, y: 0},
  legs: [{c: 4, r: 8}, {c :4, r: 8}]};

let HEADSTART = 0;
let lock = false;

let LEVEL = 0;

function init() {
  LEVEL = 0;
  for (let c = 0; c < WIDTH; ++c) {
    if (!MAP[c]) MAP[c] = {};
    for (let r = 0; r < HEIGHT; ++r) {
      if ((c + r) % 2 == 1) continue;
      MAP[c][r] = {v: true, c: c, r: r, s: 1, border: false, rstar: -1, astar: -1};
    }
  }
  for (const v of all()) {
    v.border = (connections(v) != 6);
  }

  camera.reset();
  camera.z *= 50;

  nextLevel();
}

function build(number) {
  ALIEN.s = 1.0;
  ALIEN.blinking = 1;
  ALIEN.looking = 2;
  ALIEN.breath = 0;
  ALIEN.pupil = 0;
  ALIEN.eye.x = ALIEN.eye.y = 0.0;

  const avail = [];
  for (const v of all(true)) {
    v.v = true;
    v.s = 1;
    avail.push(v);
  }

  for (let i = 0; i < number; ++i) {
    const v = avail[Math.floor(Math.random() * avail.length)];
    v.v = false;
    avail.remove(v);
  }
  buildAStar();

  avail.length = 0;
  for (const v of all()) {
    if (v.astar == -1) v.v = false;
    if (v.astar == 0 && connections(v) == 0) v.v = false;
    if (v.astar < 4) continue;
    avail.push(v);
  }

  if (avail.length == 0) {
    console.log("CANT");
    return build(number - 1);
  }

  const v = avail[Math.floor(Math.random() * avail.length)];
  ALIEN.c = v.c;
  ALIEN.r = v.r;
  for (const l of ALIEN.legs) {
    l.c = v.c;
    l.r = v.r;
  }

  buildAStar();
  cleanupLoose();
  recenterCamera();

  setHeadstart(3);
  lock = false;
}

function nextLevel() {
  LEVEL++;
  build(20);
}

function setHeadstart(n) {
  HEADSTART = n;
  if (n == 0) {
    one.msg("LEVEL " + LEVEL);
    return;
  }
  const s = ['LEVEL', "" + LEVEL, '['];
  for (let i = 0; i < n; ++i) s.push('⬣');
  s.push(']');
  one.msg(s.join(' '));
}

function actAlien(target) {
  ALIEN.looking = 10;
  act(ALIEN.eye)
  .attr("x", 0, 0.5 + 0.3 * Math.random(), ease.quadIn)
  .attr("y", 0, 0.5 + 0.3 * Math.random(), ease.quadIn);

  const r = () => 0.3 * Math.random();
  return act(ALIEN)
    .attr("legs.0.c", target.c, 0.3 + r(), ease.quadIn)
    .attr("legs.0.r", target.r, 0.3 + r(), ease.quadIn)
    .then()
    .attr("c", target.c, 0.5 + r(), ease.backOut(2 + 5 * r()))
    .attr("r", target.r, 0.5 + r(), ease.backOut(2 + 5 * r()))
    .attr("legs.1.c", target.c, 0.3 + r(), ease.quadOut, 0.3)
    .attr("legs.1.r", target.r, 0.3 + r(), ease.quadOut, 0.3);
}

function escapeAlien() {
  const v = MAP[ALIEN.c][ALIEN.r];
  if (!v.border) return;

  // let target = {c: v.c, r: v.r};
  // if (v.c == 0) target.c -= 2;
  // else if (v.c == WIDTH - 1) target.c += 2;
  // else if (v.r == 0 || v.r == 1) target.r -= 4;
  // else if (v.r == 15 || v.r == 16) target.r += 4;
  const target = {
    x: SIZE * 3/2 * v.c,
    y: SIZE * H2 * v.r};
  const b = 1.1 * SIZE;
  const corner00 = camera.map({x: -b, y: -b});
  const corner11 = camera.map({x: 1024 + b, y: 1024 + b});
  if (v.c == 0) target.x = corner00.x;
  else if (v.c == WIDTH - 1) target.x = corner11.x;
  else if (v.r == 0 || v.r == 1) target.y = corner00.y;
  else if (v.r == 15 || v.r == 16) target.y = corner11.y;

  const q = 2/3 * target.x / SIZE;
  const r = (-1/3 * target.x + Math.SQRT3/3 * target.y) / SIZE;

  target.c = q;
  target.r = 2 * r + q;

  return actAlien(target).delay(0.5).then(() => {
    one.setScore(LEVEL - 1);
    one.gameOver();
  });
}

async function moveAlien() {
  const dec = decideAlien();

  if (dec == null) {
    finishGame();
    return;
  }

  return await actAlien(dec).then(escapeAlien);
}

function blinkAlien() {
  act(ALIEN).attr("blink", 1.0, 0.1, ease.quadIn).then()
    .attr("blink", 0.0, 0.1, ease.quadIn);
}

async function finishGame() {
  camera.act.stop();
  console.log("FINISH");
  lock = true;
  const wait = [];
  for (const v of all()) {
    wait.push(act(v).attr("s", 0.0, 0.5, ease.quadIn, 0.3 * Math.random())
      .set("v", false));
  }

  await Promise.all(wait);

  await Promise.sleep(0.1);

  await act(ALIEN).attr("s", 0.0, 0.5, ease.backIn(3));

  camera.reset();
  camera.z *= 100;

  await Promise.sleep(0.3);

  nextLevel();
}

async function cleanupLoose() {
  const wait = [];
  lock = true;
  for (const v of all()) {
    if (v.rstar != -1) continue;
    if (act(v).is()) continue;
    wait.push(act(v).attr("s", 0.0, 0.5, ease.quadIn, 0.3 * Math.random())
      .set("v", false));
  }
  await Promise.all(wait);
  lock = false;
}

function recenterCamera() {
  const rect = {minx: 1024, miny: 1024, maxx: 0, maxy: 0};

  for (const v of all()) {
    const x = SIZE * 3/2 * v.c;
    const y = SIZE * H2 * v.r;

    rect.minx = Math.min(rect.minx, x - SIZE);
    rect.maxx = Math.max(rect.maxx, x + SIZE);
    rect.miny = Math.min(rect.miny, y - Math.SQRT3 * SIZE / 2);
    rect.maxy = Math.max(rect.maxy, y + Math.SQRT3 * SIZE / 2);
  }

  const border = 30;
  rect.minx -= border;
  rect.miny -= border + 44;
  rect.maxx += border;
  rect.maxy += border;


  const dur = camera.z > 1024 ? 1 : 0.25;
  return camera.lerp(camera.lookRect(rect.minx, rect.miny,
    rect.maxx - rect.minx,
    rect.maxy - rect.miny), dur, ease.quadOut);
}

async function updateNext() {
  buildAStar();
  await cleanupLoose();

  if (HEADSTART > 0) {
    setHeadstart(HEADSTART - 1);
  }
  recenterCamera();
  if (HEADSTART == 0 || get(ALIEN).astar == -1) {
    lock = true;
    await moveAlien();
  }

  lock = false;
}

function update(tick) {
  ALIEN.breath = Math.sin(tick * 2 * Math.PI / 500);
  ALIEN.pupil = Math.cos(333 + tick * 2 * Math.PI / 1713);
  ALIEN.blinking -= 1/60;
  if (ALIEN.blinking <= 0) {
    blinkAlien();
    ALIEN.blinking = 2 + 8 * Math.random();
  }
  ALIEN.looking -= 1/60;
  if (ALIEN.looking <= 0) {
    ALIEN.looking = 2 + 10 * Math.random();
    const t = {x : -1 + 2 * Math.random(), y: -1 + 2 * Math.random()};
    act(ALIEN.eye)
      .attr("x", t.x, 0.5 + 0.3 * Math.random(), ease.quadIn)
      .attr("y", t.y, 0.5 + 0.3 * Math.random(), ease.quadIn);
  }

  updateSky();

  if (lock) return;
  if (!mouse.click) return;

  const p = mouseHex();

  const v = get(p);
  if (!v || !v.v) return;

  if (v.r == ALIEN.r && v.c == ALIEN.c) return;

  lock = true;
  act(v).attr("s", 0.0, 0.5, ease.quadIn).set("v", false).then(updateNext);
}

const SKY = [];
const SKYR = [];
let SKYANGLE = 0;
function updateSky() {
  if (SKY.length == 0) {
    let y = 0;
    let dir = 1;

    while (y < 1280) {
      SKYR.push(0.15 + 1.35 * Math.random());
      const h = 50;
      let x = 0;
      while (x < 1280) {
        const w = h;
        SKY.push({ x: x, y: y, w: w, h: h, idx: SKYR.length - 1 });
        x += 80;
      }
      y += 80;
    }
  }

  for (let i = 0; i < SKYR.length; ++i) {
    SKYR[i] = Math.clamp(SKYR[i] + 0.01 * (Math.random() - 0.5), 0.15, 1.5);
  }

  for (const c of SKY) {
    const v = SKYR[c.idx];
    c.x = (1280 + c.x + v) % 1280;
  }

  SKYANGLE += 0.001;
}

function renderSky(ctx) {
  ctx.save();
  ctx.translate(512, 512);
  ctx.rotate(Math.PI / 2);
  ctx.translate(-640, -640);
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = C.white;
  for (const c of SKY) {
    ctx.fillRoundRect(c.x, c.y, c.w, c.h, 10);
  }
  ctx.restore();
}

function render(ctx) {
  renderSky(ctx);
  ctx.save();
  camera.transform(ctx);

  for (const v of all()) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = C[19];
    ctx.fillStyle = C[19];
    renderHex(ctx, v.c, v.r, SIZE * v.s, true, true, 10 * v.s);
  }

  for (const v of all()) {
    ctx.lineWidth = 5 * v.s;
    ctx.strokeStyle = C[19];
    ctx.fillStyle = v.border ? C[21] : L.ground;
    renderHex(ctx, v.c, v.r, SIZE * v.s, true, true);
  }

  // for (const v of all(true)) {
  //   const pos = posHex(v);
  //   ctx.fillStyle = "white";
  //   ctx.text(v.astar + ":" + v.rstar, pos.x, pos.y, 20);
  // }

  renderAlien(ctx, posHex(ALIEN), ALIEN.legs.map(l => posHex(l)));

  // ctx.strokeStyle = "red";
  // ctx.lineWidth = 5;
  // ctx.beginPath();
  // ctx.rect(RECT.minx, RECT.miny,
  //   RECT.maxx - RECT.minx,
  //   RECT.maxy - RECT.miny);
  // ctx.stroke();


  ctx.restore();
}

function renderAlien(ctx, head, legs) {
  ctx.save();
  ctx.translate(head.x, head.y);
  ctx.scale(ALIEN.s, ALIEN.s);

  const br = 0.65;
  const major = 48 + 1 * ALIEN.breath;

  for (const l of legs) {
    const body = vec.sub(l, head);
    const norm = vec.normalize(vec.rotate(body, Math.PI / 2));

    ctx.beginPath();
    ctx.moveTo(-norm.x * major,  -norm.y * major);
    ctx.bezierCurveTo(
      body.x * br, body.y * br,
      body.x * br, body.y * br,
      l.x - head.x - norm.x * 25, l.y - head.y - norm.y * 25);
    ctx.lineTo(l.x - head.x + norm.x * 25, l.y - head.y + norm.y * 25);
    ctx.bezierCurveTo(
     body.x * br, body.y * br,
     body.x * br, body.y * br,
     norm.x * major, norm.y * major);
    ctx.closePath();
    ctx.fillStyle = L.alien;
    ctx.fill();

    ctx.fillStyle = L.alien;
    ctx.fillCircle(l.x - head.x, l.y - head.y, 25);
  }

  ctx.fillStyle = L.alien;
  ctx.fillCircle(0, 0, major);
  ctx.fillStyle = L.eye;
  ctx.fillCircle(0, 0, 38);

  const ER = 16;
  ctx.fillStyle = L.iris;
  const rb = 20.5 - 1 * ALIEN.pupil;
  const rx = rb - 5 * vec.len(ALIEN.eye);
  const ry = rb;
  const ang = vec.angle(ALIEN.eye);
  ctx.beginPath();
  ctx.ellipse(ALIEN.eye.x * ER, ALIEN.eye.y * ER, rx, ry, ang, 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = L.eye;
  const f = Math.sin((vec.len(ALIEN.eye) / Math.SQRT2) * Math.PI / 2) ** 2;
  const ff = 4 + 2 * f;
  const d = (rb / 4) + (rb / 10) * f;
  ctx.beginPath();
  ctx.ellipse(ALIEN.eye.x * ER - d, ALIEN.eye.y * ER - d, rx / ff, ry / ff, ang, 0, 2 * Math.PI);
  ctx.fill();

  if (ALIEN.blink > 0) {
    ctx.fillStyle = L.alien;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, 0, 39, Math.PI, 2 * Math.PI);
    if (ALIEN.blink < 0.5) {
      ctx.ellipse(0, 0, 39, Math.lerp(39, 0, ALIEN.blink * 2), 0, 0, Math.PI, true);
    } else {
      ctx.ellipse(0, 0, 39, Math.lerp(0, 39, (ALIEN.blink - 0.5) * 2), 0, 0, Math.PI);
    }
    ctx.fill();
  }

  ctx.restore();
}

function astarPropagate(beach, name) {
  const visited = new Set();

  let step = 0;
  while (beach.length > 0) {
    let next = [];
    for (const v of beach) {
      if (!v.v || visited.has(v)) continue;
      v[name] = step;
      visited.add(v);
      for (const n of neighbors(v)) {
        if (!v.v || visited.has(n)) continue;
        next.push(n);
      }
    }
    beach = next;
    step++;
  }
}

function buildAStar() {
  let beach = [];
  for (const v of all(true)) {
    v.astar = -1;
    v.rstar = -1;
    if (!v.v) continue;
    if (v.border) beach.push(v);
  }
  astarPropagate(beach, 'astar');

  beach = [ get(ALIEN) ];
  if (beach[0]) {
    astarPropagate(beach, 'rstar');
  }
}

function decideAlien() {
  if (get(ALIEN).astar == -1) {
    return null;
  }

  let best = [];
  for (const n of neighbors(get(ALIEN))) {
    if (best.length == 0 || best[0].astar > n.astar) {
      best.length = 0;
      best.push(n);
      continue;
    }
    if (best[0].astar == n.astar) {
      best.push(n);
      continue;
    }
  }

  const pick = best[Math.floor(Math.random() * best.length)];

  return {c: pick.c, r: pick. r};
}

export default one.game(init, update, render);

///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////

function *all(invalid = false) {
  for (let c = 0; c < WIDTH; ++c) {
    for (let r = 0; r < HEIGHT; ++r) {
      const v = get({c: c, r: r});
      if (!v) continue;
      if (invalid || v.v) yield v;
    }
  }
}

function get(p) {
  if (!MAP[p.c]) return null;
  if (!MAP[p.c][p.r]) return null;
  return MAP[p.c][p.r];
}

function connections(p) {
  let n = 0;
  for (const v of neighbors(p)) n++;
  return n;
}

function *neighbors(p, invalid = false) {
  for (const n of NEIGHT) {
    const v = get({c: p.c + n[0], r: p.r + n[1]});
    if (!v) continue;
    if (invalid || v.v) yield v;
  }
}

var NEIGHT = [
  [+1, +1], [+1, -1], [ 0, -2],
  [-1, -1], [-1, +1], [ 0, +2],
]

function distanceHex(a, b) {
  const dx = Math.abs(a.c - b.c);
  const dy = Math.abs(a.r - b.r);
  return dx + Math.max(0, (dy - dx) / 2);
}

function posHex(p) {
  return { x: SIZE * 3/2 * p.c, y: SIZE * H2 * p.r };
}

const hexPath = new Path2D();
hexPath.moveTo(-1, 0);
hexPath.lineTo(-0.5, -H2);
hexPath.lineTo(0.5, -H2);
hexPath.lineTo(1, 0);
hexPath.lineTo(0.5, H2);
hexPath.lineTo(-0.5, H2);
hexPath.closePath();

function renderHex(ctx, c, r, size, fill = false, stroke = false, delta = 0) {
  ctx.save();
  const x = SIZE * 3/2 * c + delta;
  const y = SIZE * H2 * r + delta;
  ctx.translate(x, y);
  ctx.scale(size, size);
  if (fill) {
    ctx.fill(hexPath);
  }
  if (stroke) {
    const o = ctx.lineWidth;
    ctx.lineWidth = o / size;
    ctx.stroke(hexPath);
    ctx.lineWidth = o;
  }
  ctx.restore();
}

function mouseHex() {
  const m = camera.map(mouse);

  const q = 2/3 * m.x / SIZE;
  const r = (-1/3 * m.x + Math.SQRT3/3 * m.y) / SIZE;

  let rx = Math.round(q);
  let ry = Math.round(-q-r);
  let rz = Math.round(r);

  const x_diff = Math.abs(rx - q);
  const y_diff = Math.abs(ry + q + r);
  const z_diff = Math.abs(rz - r);

  if (x_diff > y_diff && x_diff > z_diff) {
      rx = -ry-rz;
  } else if (y_diff > z_diff) {
      ry = -rx-rz;
  } else {
      rz = -rx-ry;
  }

  return {c: rx, r: 2 * rz + rx};
}