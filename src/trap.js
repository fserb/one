/*
pig: 5x11 - 3 early placements
tiger: 7x11 - no placement
mouse: 11x11 - very few blocks

TODO:

- alien exit -> game over
- clean up function that drop all -1.
- kill alien
- full game loop

- astar score to build!
- level progression

*/

import * as one from "./one/one.js";
import {C, act, ease, mouse, vec} from "./one/one.js";

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

const SEL = {c: -2, r: -2};

const ALIEN = {c: 4, r: 8, blink: 0, blinking: 1, looking: 10,
  eye: {x : 0, y: 0}, tail: {c: 4, r: 8}};

let HEADSTART = 0;

let x0, y0;

function build(number) {
  const avail = [];
  for (const v of all(true)) {
    v.v = true;
    v.s = 1;
    // if (v.border) continue;
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
  ALIEN.c = ALIEN.tail.c = v.c;
  ALIEN.r = ALIEN.tail.r = v.r;

  setHeadstart(0);
}

function setHeadstart(n) {
  HEADSTART = n;
  if (n == 0) {
    one.msg("LEVEL 3");
    return;
  }
  const s = ['LEVEL', '3', '['];
  for (let i = 0; i < n; ++i) s.push('⬣');
  s.push(']');
  one.msg(s.join(' '));
}

function init() {
  for (let c = 0; c < WIDTH; ++c) {
    if (!MAP[c]) MAP[c] = {};
    for (let r = 0; r < HEIGHT; ++r) {
      if ((c + r) % 2 == 1) continue;
      MAP[c][r] = {v: true, c: c, r: r, s: 1, border: false, astar: -1};
    }
  }
  for (const v of all()) {
    v.border = (connections(v) != 6);
  }

  const FW = SIZE * (1.5 * WIDTH + 0.5);
  const FH = Math.SQRT3 * SIZE * (HEIGHT / 2 + 0.5);
  x0 = (1024 - FW) / 2 + SIZE;
  y0 = 44 + (980 - FH) / 2 + SIZE * H2;

  build(7);
}

function moveAlien() {
  const dec = decideAlien();

  if (dec == null) {
    console.log("WIN");
    return;
  }

  return act(ALIEN)
    .attr("tail.c", dec.c, 0.5, ease.quadIn)
    .attr("tail.r", dec.r, 0.5, ease.quadIn)
    .then()
    .attr("c", dec.c, 0.6, ease.backOut(2))
    .attr("r", dec.r, 0.6, ease.backOut(2));
}

function blinkAlien() {
  act(ALIEN).attr("blink", 1.0, 0.1, ease.quadIn).then()
    .attr("blink", 0.0, 0.1, ease.quadIn);
}

let lock = false;
function update(tick) {
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

  if (lock) return;
  if (!mouse.click) return;
  blinkAlien();

  const p = mouseHex();

  const v = get(p);
  if (!v || !v.v) return;

  lock = true;
  act(v).attr("s", 0.0, 0.5, ease.quadIn).set("v", false).then(() => {
    buildAStar();

    if (HEADSTART > 0) {
      setHeadstart(HEADSTART - 1);
    }
    if (HEADSTART == 0) {
      const x = moveAlien();
      if (x) return x.then(() => { lock = false; });
    }
    lock = false;
  });
}

function render(ctx) {
  for (const v of all()) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = C[19];
    ctx.fillStyle = C[19];
    renderHex(ctx, v.c, v.r, SIZE * v.s, true, true, 10 * v.s);
  }

  for (const v of all()) {
    ctx.lineWidth = 1 * v.s;
    ctx.strokeStyle = C[19];
    ctx.fillStyle = v.border ? C[21] : L.ground;
    renderHex(ctx, v.c, v.r, SIZE * v.s, true, true);
  }

  // for (const v of all(true)) {
  //   const pos = posHex(v);
  //   ctx.fillStyle = "white";
  //   ctx.text(v.astar, pos.x, pos.y, 20);
  // }

  ctx.strokeStyle = "red";
  ctx.lineWidth = 10;
  renderHex(ctx, SEL.c, SEL.r, SIZE, false, true);

  renderAlien(ctx, posHex(ALIEN), posHex(ALIEN.tail));
}

function renderAlien(ctx, head, tail) {
  const body = vec.sub(tail, head);
  const norm = vec.normalize(vec.rotate(body, Math.PI / 2));

  const br = 0.65;

  ctx.beginPath();
  ctx.moveTo(head.x - norm.x * 48, head.y - norm.y * 48);
  ctx.bezierCurveTo(
    head.x + body.x * br, head.y + body.y * br,
    head.x + body.x * br, head.y + body.y * br,
    tail.x - norm.x * 25, tail.y - norm.y * 25);
  ctx.lineTo(tail.x + norm.x * 25, tail.y + norm.y * 25);
  ctx.bezierCurveTo(
    head.x + body.x * br, head.y + body.y * br,
    head.x + body.x * br, head.y + body.y * br,
    head.x + norm.x * 48, head.y + norm.y * 48);
  ctx.closePath();
  ctx.fillStyle = L.alien;
  ctx.fill();

  ctx.fillStyle = L.alien;
  ctx.fillCircle(tail.x, tail.y, 25);

  ctx.fillStyle = L.alien;
  ctx.fillCircle(head.x, head.y, 48);
  ctx.fillStyle = L.eye;
  ctx.fillCircle(head.x, head.y, 38);

  const ER = 16;
  ctx.fillStyle = L.iris;
  const rx = 20 - 5 * vec.len(ALIEN.eye);
  const ry = 20;
  const ang = vec.angle(ALIEN.eye);
  ctx.beginPath();
  ctx.ellipse(head.x + ALIEN.eye.x * ER, head.y + ALIEN.eye.y * ER, rx, ry, ang, 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = L.eye;
  const f = Math.sin((vec.len(ALIEN.eye) / Math.SQRT2) * Math.PI / 2) ** 2;
  const ff = 4 + 2 * f;
  ctx.beginPath();
  ctx.ellipse(head.x + ALIEN.eye.x * ER - 5 - 2 * f, head.y + ALIEN.eye.y * ER - 5 - 2 * f, rx / ff, ry / ff, ang, 0, 2 * Math.PI);
  ctx.fill();

  if (ALIEN.blink > 0) {
    ctx.fillStyle = L.alien;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(head.x, head.y, 39, Math.PI, 2 * Math.PI);
    if (ALIEN.blink < 0.5) {
      ctx.ellipse(head.x, head.y, 39, Math.lerp(39, 0, ALIEN.blink * 2), 0, 0, Math.PI, true);
    } else {
      ctx.ellipse(head.x, head.y, 39, Math.lerp(0, 39, (ALIEN.blink - 0.5) * 2), 0, 0, Math.PI);
    }
    ctx.fill();
  }
}

function buildAStar() {
  const visited = new Set();
  let beach = [];
  for (const v of all(true)) {
    v.astar = -1;
    if (!v.v) continue;
    if (v.border) beach.push(v);
  }

  let step = 0;
  while (beach.length > 0) {
    let next = [];
    for (const v of beach) {
      if (!v.v || visited.has(v)) continue;
      v.astar = step;
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

function decideAlien() {
  if (get(ALIEN).astar == -1) {
    console.log("WIN");
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
  return { x: x0 + SIZE * 3/2 * p.c, y: y0 + SIZE * H2 * p.r };
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
  const x = x0 + SIZE * 3/2 * c + delta;
  const y = y0 + SIZE * H2 * r + delta;
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
  const mx = mouse.x - x0;
  const my = mouse.y - y0;

  const q = 2/3 * mx / SIZE;
  const r = (-1/3 * mx + Math.SQRT3/3 * my) / SIZE;

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