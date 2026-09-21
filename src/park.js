/*
 * park - a mock: park a vehicle with one pointer. The strip at the bottom
 * switches which vehicle, and a lot comes with it; pressing it restarts.
 *
 * Where a press lands is what it means. On the cab it is a handle: pull it and
 * the wheels work out what that does. On the board it is a spot to drive to,
 * held still for one committed arc, dragged for a car that follows a finger.
 *
 * The cab has two controls: ds, how far its rear axle goes, and a curvature k
 * with |k| <= kmax, which is all the wheels allow. Every link behind it just
 * follows its drawbar, and neither mode aims one: getting a trailer where you
 * want it is the driving, and pointing at where it should end up would have the
 * game plan the shuffle instead.
 */

import { Collider } from "./alma/src/collider.js";
import { clamp } from "./alma/src/utils/extra.js";
import { gameOver, input } from "./lib/one.js";

export const meta = {
  title: "park",
  bg: "#B6AE9C",
  fg: "#2F2C27",
  date: "2026-09-20",
};

const PAVE = "#CCC5B2";
const WALL = "#6E675B";
const PARKED = "#8B8374";
const PAINT = "#E3DBC6";
const HOME = "#E0AE3C"; // the spot, once the vehicle is in it
const BODY = "#C25A3C";
const BOX = "#D4C9AF"; // a trailer, which is towed and not driven
const ROOF = "#8E3A24";

const VMAX = 280; // board units a second
const MARKV = 170; // slower than VMAX: a committed arc is watched, not steered
const DEAD = 24; // how far off the spot the pointer goes before mark chases
const NEAR = 28; // closer than this to the rear axle there is no arc to ask for
const RACK = 4.4; // lock to lock a second, the pace the wheels turn at
const ALIGN = 0.5; // wheels this much of a lock off what was asked: no speed
const HOLD = 0.3; // how much the solve favours a curvature the wheels are near
const GAIN = 7; // pointer distance to speed
const JACK = 1.4; // the angle across a joint that counts as jackknifed
const BAR = 88; // the height of the strip of vehicle tabs
const DONE = 1; // seconds parked with nothing pressed before the round ends

// A body is measured from its own axle: `back` behind it, `front` ahead, and
// `wide` across. A link hangs off a hitch `hitch` behind the axle of whatever
// tows it, on a drawbar `bar` long.
const VEHICLES = [
  {
    name: "car",
    lot: "street",
    cab: { back: 24, front: 100, wide: 56 },
    wheel: 76,
    kmax: 1 / 150,
    links: [],
    start: { x: 830, y: 560, a: Math.PI },
  },
  {
    name: "truck",
    lot: "dock",
    cab: { back: 22, front: 118, wide: 56 },
    wheel: 94,
    kmax: 1 / 180,
    links: [
      { hitch: 18, bar: 168, body: { back: 30, front: 150, wide: 58 } },
    ],
    start: { x: 700, y: 720, a: Math.PI / 2 },
  },
  {
    name: "double",
    lot: "yard",
    cab: { back: 18, front: 96, wide: 54 },
    wheel: 78,
    kmax: 1 / 150,
    links: [
      { hitch: 14, bar: 118, body: { back: 24, front: 96, wide: 54 } },
      { hitch: 16, bar: 118, body: { back: 24, front: 96, wide: 54 } },
    ],
    start: { x: 650, y: 620, a: -Math.PI / 2 },
  },
];

// A block is solid; `kind` is only how it draws. The goal is where the last
// body's centre has to end up, and `either` lets it arrive facing the other
// way.
const ROW = 54;
const BAY = { x: 405, y: 785, a: 0, len: 124, wide: 56, either: true };

function row(y, ...xs) {
  return xs.map((x) => ({ x, y, w: 124, h: ROW, kind: "car" }));
}

const LOTS = {
  street: {
    blocks: [
      { x: 0, y: 0, w: 1024, h: 300, kind: "wall" },
      { x: 0, y: 300, w: 1024, h: 44, kind: "pave" },
      ...row(344, 40, 184, 328, 472, 616, 760),
      ...row(758, 30, 170, 516, 656, 796),
      { x: 0, y: 818, w: 1024, h: 936 - 818, kind: "pave" },
    ],
    goal: BAY,
  },
  dock: {
    blocks: [
      { x: 0, y: 0, w: 452, h: 404, kind: "wall" },
      { x: 572, y: 0, w: 452, h: 404, kind: "wall" },
      { x: 452, y: 0, w: 120, h: 134, kind: "wall" },
    ],
    goal: { x: 512, y: 270, a: Math.PI / 2, len: 180, wide: 58 },
  },
  yard: {
    blocks: [
      { x: 0, y: 0, w: 1024, h: 144, kind: "wall" },
      { x: 0, y: 340, w: 420, h: 130, kind: "wall" },
      { x: 820, y: 144, w: 204, h: 326, kind: "wall" },
    ],
    goal: { x: 344, y: 242, a: Math.PI, len: 120, wide: 54 },
  },
};

let veh, lot, walls;
let rig; // { pose, angles }: the cab, then one heading per link
let steer; // the curvature the wheels are turned to, driven and drawn
let pick = 0;
let parked;
let home; // the vehicle is in the goal, which the spot's colour says
let settled; // seconds it has been there with nothing pressed
let grab; // drag and push: which link, where on it, and what it is aimed at
let mark; // mark: the spot on the board it is driving to
let loose; // mark: this press has left its spot, so it aims every frame now
let swallow; // a press that landed on a tab, ignored until it is let go

export function init() {
  veh = VEHICLES[pick];
  lot = LOTS[veh.lot];
  walls = lot.blocks.map((b) => Collider.rect(b.x, b.y, b.w, b.h));
  rig = { pose: { ...veh.start }, angles: veh.links.map(() => veh.start.a) };
  steer = 0;
  parked = false;
  home = false;
  settled = 0;
  grab = null;
  mark = null;
  rest();
}

/* Geometry. */

function toBody(p, x, y) {
  const c = Math.cos(p.a), s = Math.sin(p.a);
  const dx = x - p.x, dy = y - p.y;
  return { x: dx * c + dy * s, y: dy * c - dx * s };
}

function toWorld(p, x, y) {
  const c = Math.cos(p.a), s = Math.sin(p.a);
  return { x: p.x + x * c - y * s, y: p.y + x * s + y * c };
}

// Every link's pose, cab first, walked down the drawbars.
function chain(st) {
  const out = [st.pose];
  veh.links.forEach((link, i) => {
    const h = toWorld(out[i], -link.hitch, 0);
    const a = st.angles[i];
    out.push({
      x: h.x - link.bar * Math.cos(a),
      y: h.y - link.bar * Math.sin(a),
      a,
    });
  });
  return out;
}

function bodyOf(i) {
  return i === 0 ? veh.cab : veh.links[i - 1].body;
}

function corners(p, r) {
  const h = r.wide / 2;
  return [[-r.back, -h], [r.front, -h], [r.front, h], [-r.back, h]]
    .map(([x, y]) => toWorld(p, x, y));
}

function centre(p, r) {
  return toWorld(p, (r.front - r.back) / 2, 0);
}

// One step of the whole rig, in place: the cab along an arc, then each link
// turning by however much its drawbar was dragged across. A joint out of travel
// holds at the limit and the rig keeps going, which is a trailer skidded
// sideways rather than a move the game refuses.
function step(st, ds, k) {
  const p = chain(st);
  const dth = k * ds;
  st.pose.a += dth;
  st.pose.x += Math.cos(st.pose.a) * ds;
  st.pose.y += Math.sin(st.pose.a) * ds;

  let prev = { ds, dth };
  veh.links.forEach((link, i) => {
    const d = p[i].a - p[i + 1].a;
    const now = {
      ds: prev.ds * Math.cos(d) + prev.dth * link.hitch * Math.sin(d),
      dth: (prev.ds * Math.sin(d) - prev.dth * link.hitch * Math.cos(d)) /
        link.bar,
    };
    const lead = i === 0 ? st.pose.a : st.angles[i - 1];
    st.angles[i] = clamp(st.angles[i] + now.dth, lead - JACK, lead + JACK);
    prev = now;
  });
  return st;
}

function clone(st) {
  return { pose: { ...st.pose }, angles: [...st.angles] };
}

/* Driving. */

// Turn the wheels towards k, as far as a rack turns in dt, and say whether they
// are there yet. The car never drives a curvature its wheels are not at.
function rack(k, dt) {
  const r = veh.kmax * RACK * dt;
  steer = clamp(k, steer - r, steer + r);
  return steer === k;
}

// How much of its speed the car has while the wheels are still coming round to
// k: none while they are half a lock off it, all once they are there. Waiting
// outright is right for one committed arc and wrong for anything that aims
// every frame, where the target moves as the car does and waiting for it stalls
// all but a few frames in every hundred.
function aligned(k) {
  return clamp(1 - Math.abs(steer - k) / (veh.kmax * ALIGN), 0, 1);
}

function blocked() {
  const p = chain(rig);
  for (let i = 0; i < p.length; ++i) {
    const part = corners(p[i], bodyOf(i));
    for (const c of part) {
      if (c.x < 4 || c.x > 1020) return true;
      if (c.y < 4 || c.y > 1020 - BAR) return true;
    }
    const shape = Collider.polygon(part);
    for (const w of walls) {
      if (Collider.hit(shape, w)) return true;
    }
  }
  return false;
}

// ds board units along a curve of curvature k, in steps small enough that
// nothing is stepped through. A step that hits something is taken back and
// what is left of the move is dropped.
function advance(ds, k) {
  if (ds === 0) return true;

  const n = Math.ceil(Math.abs(ds) / 4);
  const h = ds / n;
  for (let i = 0; i < n; ++i) {
    const was = clone(rig);
    step(rig, h, k);
    if (blocked()) {
      rig = was;
      return false;
    }
  }
  return true;
}

// The held point sits at g on the cab, so it travels ds * (1 - k*g.y, k*g.x):
// one direction per curvature, and that fan is everything the wheels can do
// with it. This is the least squares fit of that fan to d, both in the cab's
// own frame. The exact solve goes singular when d is square onto g, so the two
// limits are candidates too and the best of the three wins.
function solve(g, d) {
  const den = g.x * d.x + g.y * d.y;
  const ks = [veh.kmax, -veh.kmax, 0];
  if (Math.abs(den) > 1e-6) ks.push(clamp(d.y / den, -veh.kmax, veh.kmax));

  let best = { ds: 0, k: 0, score: -1 };
  for (const k of ks) {
    const ux = 1 - k * g.y, uy = k * g.x;
    const dot = ux * d.x + uy * d.y;
    const ds = dot / (ux * ux + uy * uy);
    // The fit, less a little for how far the wheels would have to come. Where
    // no curvature helps much, full lock either way fits about as well, and on
    // the raw fit the answer flips between them frame to frame.
    const score = ds * dot * (1 - HOLD * Math.abs(k - steer) / (2 * veh.kmax));
    if (score > best.score) best = { ds, k, score };
  }
  return best;
}

// `d` is in the cab's frame, so both modes hand it over already turned.
function pull(d, dt) {
  if (Math.hypot(d.x, d.y) < 6) return;
  const { ds, k } = solve(grab, d);
  rack(k, dt);
  advance(clamp(ds * GAIN, -VMAX, VMAX) * aligned(k) * dt, steer);
}

// Where on the cab the pointer is, or null when it is not on it.
function take() {
  const r = veh.cab;
  const b = toBody(rig.pose, input.x, input.y);
  const on = b.x > -r.back - 14 && b.x < r.front + 14 &&
    Math.abs(b.y) < r.wide / 2 + 14;
  return on ? b : null;
}

// The circle tangent to the cab's heading at its rear axle that passes through
// the body-space point (x, y), as a curvature the wheels can hold.
function curveTo(x, y) {
  const d2 = x * x + y * y;
  if (d2 < 1) return 0;
  return clamp(2 * y / d2, -veh.kmax, veh.kmax);
}

// How far along that circle the point lies: forward when it is ahead of the
// axle, backward when it is behind.
function reach(x, y, k) {
  let turn = 2 * Math.atan2(y, x);
  if (x < 0) turn -= Math.sign(turn) * 2 * Math.PI;
  return Math.abs(k) < 1e-6 ? x : turn / k;
}

/* A press on the cab: a handle, pulled to where that part should be. */

function dragPull(dt) {
  const p = toBody(rig.pose, input.x, input.y);
  pull({ x: p.x - grab.x, y: p.y - grab.y }, dt);
}

function dragDraw(ctx) {
  const at = grab ?? take();
  if (at === null) return;
  const w = toWorld(rig.pose, at.x, at.y);

  ctx.globalAlpha = grab ? 1 : 0.35;
  if (grab) {
    ctx.strokeStyle = PAINT;
    ctx.lineWidth = 3;
    ctx.setLineDash([9, 8]);
    ctx.strokeLine(w.x, w.y, input.x, input.y);
    ctx.setLineDash([]);
  }
  ctx.fillStyle = PAINT;
  ctx.fillCircle(w.x, w.y, 10);
  ctx.globalAlpha = 1;
}

/*
 * A press on the board: a spot. One arc, decided when it is pressed and then
 * not decided again - the curvature is fixed and `left` counts the distance
 * down, so holding still lands the cab in the outline exactly. Aiming at the
 * spot every frame instead made it wander, worst in reverse.
 *
 * It only moves while the pointer is down, and letting go keeps the spot and
 * what is left of the arc: press again inside DEAD of that spot and it carries
 * on. Carry the pointer DEAD off the spot and the rest of that press aims every
 * frame instead, so a press that stays put is a move with an end you can see
 * and a press that is dragged is steering.
 */
// A spot on top of the rear axle asks for nothing, and the arc through it is
// where the gear flips and the answer swings from a short move forward to most
// of a circle backwards. Inside NEAR the mark stands as it is.
function aim() {
  const p = toBody(rig.pose, input.x, input.y);
  if (Math.hypot(p.x, p.y) < NEAR) return;
  const k = curveTo(p.x, p.y);
  mark = { x: input.x, y: input.y, k, left: reach(p.x, p.y, k) };
}

// Whether the pointer is still on the arc the cab is driving.
function onMark() {
  return mark !== null &&
    Math.hypot(input.x - mark.x, input.y - mark.y) <= DEAD;
}

function rest() {
  loose = false;
}

function markDrive(dt) {
  if (input.just.act) {
    // A press off the arc it was on starts a new one, with its dead zone whole
    // again; a press back onto it carries that arc on.
    if (!onMark()) aim();
  } else if (!loose && !onMark()) {
    loose = true;
  }
  if (loose || mark === null) aim();
  if (mark === null) return;

  // A committed arc waits outright, so the arc driven is the arc promised; a
  // chase aims every frame and only gives up speed.
  const there = rack(mark.k, dt);
  if (!loose && !there) return;

  // Easing out over the last stretch, so it settles into the outline. A step
  // the lot refuses leaves `left` alone, so the cab holds against whatever it
  // met with the outline still ahead of it.
  const v = MARKV * clamp(Math.abs(mark.left) / 70, 0.3, 1);
  const ds = clamp(mark.left, -v * dt, v * dt) * aligned(mark.k);
  if (advance(ds, steer)) mark.left -= ds;
}

function markDraw(ctx) {
  const live = mark !== null && (input.press.act || onMark());
  const p = toBody(rig.pose, input.x, input.y);
  if (!live && Math.hypot(p.x, p.y) < NEAR) return;
  const k = live ? mark.k : curveTo(p.x, p.y);
  const s = live ? mark.left : reach(p.x, p.y, k);
  const at = live ? mark : input;
  const alpha = live ? (input.press.act ? 1 : 0.6) : 0.35;

  drawArc(ctx, k, s, alpha);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = PAINT;
  ctx.lineWidth = 3;
  ctx.strokeCircle(at.x, at.y, 11);

  // The cab where that arc leaves it. It is a promise: nothing re-aims while
  // it drives, so the outline is where it stops.
  const box = corners(arcAt(k, s), veh.cab);
  ctx.beginPath();
  box.forEach((c, i) => i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y));
  ctx.closePath();
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// What this press is, or what a press here would be.
function holding() {
  return input.press.act ? grab : take();
}

/* The round. */

// A press on a tab is that press used up: a mode that reads press rather than
// just the press going down would otherwise drive at the strip until let go.
function tabs() {
  if (!input.press.act) {
    swallow = false;
    return false;
  }
  // The x test is the board's edge: the pointer is off the board when the mouse
  // is in the page around it, and a tab index taken from there is not one.
  if (input.just.act && input.y > 1024 - BAR && input.x >= 0 && input.x < 1024) {
    pick = Math.floor(input.x / (1024 / VEHICLES.length));
    init();
    swallow = true;
  }
  return swallow;
}

// Where the last body has to be. A condition and not an event: it can be
// driven back out of.
function inGoal() {
  const p = chain(rig).at(-1);
  const c = centre(p, bodyOf(veh.links.length));
  const g = lot.goal;
  const b = toBody(g, c.x, c.y);
  if (Math.abs(b.x) > 30 || Math.abs(b.y) > 14) return false;

  const off = Math.abs(Math.atan2(Math.sin(p.a - g.a), Math.cos(p.a - g.a)));
  return off <= 0.2 || (g.either && Math.abs(off - Math.PI) < 0.2);
}

export function update(dt) {
  if (tabs()) return;

  if (!input.press.act) {
    grab = null;
    rest();
  } else {
    if (input.just.act) grab = take();
    if (grab !== null) dragPull(dt);
    else markDrive(dt);
  }

  // The spot says so the moment it is parked; the finish screen waits DONE
  // seconds after the pointer is let go, so arriving mid-move and driving
  // straight back out costs nothing and no message lands over a move.
  if (parked) return;
  home = inGoal();
  settled = home && !input.press.act ? settled + dt : 0;
  if (settled >= DONE) {
    parked = true;
    gameOver({ win: true });
  }
}

/* Drawing. */

// Where the cab ends up after driving `s` along curvature `k`.
function arcAt(k, s) {
  const p = rig.pose;
  const th = p.a + k * s;
  if (Math.abs(k) < 1e-6) {
    return { x: p.x + Math.cos(p.a) * s, y: p.y + Math.sin(p.a) * s, a: th };
  }
  return {
    x: p.x + (Math.sin(th) - Math.sin(p.a)) / k,
    y: p.y - (Math.cos(th) - Math.cos(p.a)) / k,
    a: th,
  };
}

function drawArc(ctx, k, s, alpha) {
  ctx.strokeStyle = PAINT;
  ctx.lineWidth = 4;
  ctx.globalAlpha = alpha;
  ctx.setLineDash([10, 9]);
  ctx.beginPath();
  for (let i = 0; i <= 24; ++i) {
    const p = arcAt(k, s * i / 24);
    i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

// The cab carries a cabin block, a trailer the line of its back doors.
function drawBody(ctx, p, r, cab) {
  const len = r.back + r.front;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.a);
  ctx.fillStyle = cab ? BODY : BOX;
  ctx.fillRect(-r.back, -r.wide / 2, len, r.wide);
  ctx.fillStyle = cab ? ROOF : PARKED;
  if (cab) {
    ctx.fillRect(-r.back + len * 0.3, -r.wide / 2 + 7, len * 0.34, r.wide - 14);
  } else ctx.fillRect(-r.back + 8, -r.wide / 2 + 6, 5, r.wide - 12);
  ctx.restore();
}

function drawWheels(ctx, p, r, turn) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.a);
  ctx.fillStyle = meta.fg;
  for (const side of [-1, 1]) {
    const y = side * (r.wide / 2 - 3);
    ctx.fillRect(-13, y - 5, 26, 10);
    if (turn === null) continue;
    ctx.save();
    ctx.translate(veh.wheel, y);
    ctx.rotate(turn);
    ctx.fillRect(-13, -5, 26, 10);
    ctx.restore();
  }
  ctx.restore();
}

function drawVehicle(ctx) {
  const p = chain(rig);
  for (let i = p.length - 1; i >= 0; --i) {
    const turn = i === 0 ? Math.atan(steer * veh.wheel) : null;
    drawWheels(ctx, p[i], bodyOf(i), turn);
    drawBody(ctx, p[i], bodyOf(i), i === 0);
    if (i === 0) continue;
    const h = toWorld(p[i - 1], -veh.links[i - 1].hitch, 0);
    ctx.fillStyle = meta.fg;
    ctx.fillCircle(h.x, h.y, 7);
  }
}

function drawGoal(ctx) {
  const g = lot.goal;
  ctx.save();
  ctx.translate(g.x, g.y);
  ctx.rotate(g.a);

  // The halo, once it is parked: four rounded slabs of the same faint gold,
  // stacked biggest first, so the bay itself carries all four and each step
  // out carries one less. Flat and hard edged, and no gradient anywhere.
  if (home) {
    ctx.fillStyle = HOME;
    ctx.globalAlpha = 0.11;
    for (const out of [44, 30, 17, 4]) {
      ctx.beginPath();
      ctx.roundRect(
        -g.len / 2 - out,
        -g.wide / 2 - out,
        g.len + out * 2,
        g.wide + out * 2,
        out + 8,
      );
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  ctx.strokeStyle = home ? HOME : PAINT;
  ctx.lineWidth = 5;
  ctx.setLineDash([16, 12]);
  ctx.strokeRect(-g.len / 2, -g.wide / 2, g.len, g.wide);
  ctx.setLineDash([]);
  ctx.restore();
}

function drawTabs(ctx) {
  ctx.fillStyle = meta.bg;
  ctx.fillRect(0, 1024 - BAR, 1024, BAR);
  ctx.fillStyle = meta.fg;
  ctx.globalAlpha = 0.2;
  ctx.fillRect(0, 1024 - BAR, 1024, 2);

  const v = 1024 / VEHICLES.length;
  VEHICLES.forEach((x, i) => {
    ctx.globalAlpha = i === pick ? 1 : 0.32;
    ctx.text(x.name, v * (i + 0.5), 996, 30);
  });
  ctx.globalAlpha = 1;
}

export function render(ctx) {
  for (const b of lot.blocks) {
    if (b.kind === "car") continue;
    ctx.fillStyle = b.kind === "pave" ? PAVE : WALL;
    ctx.fillRect(b.x, b.y, b.w, b.h);
  }

  drawGoal(ctx);

  for (const b of lot.blocks) {
    if (b.kind !== "car") continue;
    ctx.fillStyle = PARKED;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = meta.bg;
    ctx.fillRect(b.x + b.w * 0.3, b.y + 7, b.w * 0.34, b.h - 14);
  }

  if (!parked && holding() === null) markDraw(ctx);
  drawVehicle(ctx);
  if (!parked && holding() !== null) dragDraw(ctx);
  drawTabs(ctx);
}
