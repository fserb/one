/*
pig: 5x11 - 3 early placements
tiger: 7x11 - no placement
mouse: 11x11 - very few blocks

TODO:

- sound
- double play on first click?
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

one.sound.make("hit", 0.3, (f, track) => {
  track(f.karplus_strong, {b: 0.5, freq: 40, S: 0.1});
  track(f.biquad, {type: "lowpass", freq: 1500});
  track(f.bitcrush, {sample: 4, bits: 24});
  track(f.compressor);
  track(f.envelope,
    {env: f.ADSR({sustainv: 2, sustain: 0.1, release: 0.2, type: "linear"})});
});

one.sound.make("drop", 0.3, (f, track) => {
  track(f.oscillator, {type: "saw", freq: f.linear(100, -300)});
  track(f.oscillator, {type: "brown", amp: 0.5});
  track(f.ringmod, {wet: 1, freq: 120});
  track(f.biquad, {type: "lowpass", freq: 1000});
  track(f.envelope,
    {env: f.ADSR({sustainv: 1, sustain: 0.05, release: 0.25, type: "linear"})});
});

one.sound.make("move", 0.65, (f, track) => {
  track(f.oscillator, {type: "sine", freq: f.VSAJ(400, 400, -4000)});
  track(f.ringmod, {wet: 0.5, freq: 200});
  track(f.envelope,
    {env: f.ADSR({attack: 0.3, sustain: 0.2, release: 0.25, sustainv: 1, type: "exp"})});
});

one.sound.make("fall", 0.5, (f, track) => {
  track(f.oscillator, {type: "sine", freq: f.VSAJ(400, -200)});
  track(f.ringmod, {wet: 0.5, freq: 200});
  track(f.envelope,
    {env: f.ADSR({attack: 0.1, release: 0.4, sustainv: 1, type: "linear"})});
});

const MAP = {};
const WIDTH = 10;
const HEIGHT = 17;
const SIZE = 60;

const H2 = Math.SQRT3 / 2;

const ALIEN = {
  c: 4, r: 8,
  anim: {c:4, r:8},
  blink: 0, blinking: 1, looking: 2, breath: 0,
  s: 1.0,
  pupil: 0,
  eye: {x : 0, y: 0},
  legs: [{c: 4, r: 8}, {c :4, r: 8}]};

let HEADSTART = 0;
let pending = 0;
let locked = true;

let LEVEL = 0;
const PROG = [0, 50, 45, 40, 35, 30,
  25, 25,
  20, 20, 20,
  15, 15, 15, 15,
  10, 10, 10, 10, 10,
  9, 8, 7, 6, 5 ];

function init() {
  locked = true;
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
  buildAStar();

  let dif = 0;
  while (dif < number) {
    const v = avail[Math.floor(Math.random() * avail.length)];
    v.v = false;
    avail.remove(v);
    const sc = 1 + v.astar;
    dif += sc;
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
    return build(number);
  }

  for (const v of all(true)) {
    if (v.v) continue;
    v.s = 0;
  }

  const v = avail[Math.floor(Math.random() * avail.length)];
  ALIEN.c = ALIEN.anim.c = v.c;
  ALIEN.r = ALIEN.anim.r = v.r;
  for (const l of ALIEN.legs) {
    l.c = v.c;
    l.r = v.r;
  }

  buildAStar();
  cleanupLoose(false);
  recenterCamera().then(() => {
    camera.shake(0.2, 50);
    one.sound.play("hit");
    locked = false;
  });

  setHeadstart(3);
  pending = 0;
}

function nextLevel() {
  LEVEL++;
  const pr = PROG[LEVEL] ?? 5;
  build(pr);
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

  one.sound.play("move");
  act(ALIEN.eye)
  .attr("x", 0, 0.5 + 0.3 * Math.random(), ease.quadIn)
  .attr("y", 0, 0.5 + 0.3 * Math.random(), ease.quadIn);

  if (!target.final) {
    ALIEN.c = target.c;
    ALIEN.r = target.r;
  }
  const r = () => 0.3 * Math.random();
  return act(ALIEN)
    .attr("legs.0.c", target.c, 0.3 + r(), ease.quadIn)
    .attr("legs.0.r", target.r, 0.3 + r(), ease.quadIn)
    .then()
    .attr("anim.c", target.c, 0.5 + r(), ease.backOut(2 + 5 * r()))
    .attr("anim.r", target.r, 0.5 + r(), ease.backOut(2 + 5 * r()))
    .attr("legs.1.c", target.c, 0.3 + r(), ease.quadOut, 0.3)
    .attr("legs.1.r", target.r, 0.3 + r(), ease.quadOut, 0.3);
}

function escapeAlien() {
  const v = get(ALIEN);
  if (!v.border) return;
  pending = 100;

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
  target.final = true;

  return actAlien(target).delay(0.5).then(() => {
    one.setScore(LEVEL - 1);
    one.gameOver();
  });
}

function moveAlien() {
  const dec = decideAlien();

  if (dec == null) {
    finishGame();
    return;
  }
  return actAlien(dec).then(escapeAlien);
}

function blinkAlien() {
  if (ALIEN.blink != 0) return;
  act(ALIEN).attr("blink", 1.0, 0.1, ease.quadIn).then()
    .attr("blink", 0.0, 0.1, ease.quadIn);
}

async function finishGame() {
  camera.act.stop();
  pending = 100;
  const wait = [];
  let delay = 0.5;
  for (const v of all()) {
    if (v.v === false) continue;
    v.v = false;
    const d = 1.5 + 0.3 * Math.random();
    wait.push(act(v)
      .delay(delay)
      .then(() => one.sound.play("drop", (2 * Math.random() - 1) * 1200, 0.1))
      .attr("s", 0.0, 0.5, ease.quadIn));
    delay += 0.15;
  }

  await Promise.all(wait);

  await Promise.sleep(0.1);

  one.sound.play("fall");
  await act(ALIEN).attr("s", 0.0, 0.5, ease.backIn(3));

  camera.reset();
  camera.z *= 100;

  await Promise.sleep(0.3);

  nextLevel();
}

async function cleanupLoose(action=true) {
  const wait = [];
  let delay = 0.1;
  let snd = 0.085;
  for (const v of all()) {
    if (v.rstar != -1) continue;
    if (act(v).is()) continue;
    v.v = false;
    wait.push(act(v).attr("s", 0.0, 0.5, ease.quadIn, delay));
    delay += 0.01;
    snd += 0.01;
    if (action && snd >= 0.085) {
      snd -= 0.085;
      one.sound.play("drop", (2 * Math.random() - 1) * 1200, delay + 0.1);
    }
  }
  await Promise.all(wait);
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
    rect.maxy - rect.miny, camera.angle), dur, ease.quadOut);
}

function updateNext() {
  buildAStar();
  cleanupLoose();

  if (HEADSTART > 0) {
    setHeadstart(HEADSTART - 1);
  }
  camera.act.delay(1).then(() => recenterCamera());
  recenterCamera();
  if (HEADSTART == 0 || get(ALIEN).astar == -1) {
    moveAlien();
  }
  pending--;
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
    act(ALIEN.eye).stop()
      .attr("x", t.x, 0.5 + 0.3 * Math.random(), ease.quadIn)
      .attr("y", t.y, 0.5 + 0.3 * Math.random(), ease.quadIn);
  }

  updateSky();

  if (locked) return;
  if (pending > 2) return;
  if (!mouse.click) return;
  const p = mouseHex();

  const v = get(p);
  if (!v || !v.v) return;

  if (v.r == ALIEN.r && v.c == ALIEN.c) return;

  v.v = false;
  one.sound.play("drop", 0.1);
  updateNext();
  pending++;
  act(v).attr("s", 0.0, 0.5, ease.quadIn);
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

  for (const v of all(true)) {
    if (v.s == 0.0) continue;
    ctx.lineWidth = 1;
    ctx.strokeStyle = C[19];
    ctx.fillStyle = C[19];
    renderHex(ctx, v.c, v.r, SIZE * v.s, true, true, 10 * v.s);
  }

  for (const v of all(true)) {
    if (v.s == 0.0) continue;
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

  renderAlien(ctx, posHex(ALIEN.anim), ALIEN.legs.map(l => posHex(l)));

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