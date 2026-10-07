// zuma. After PopCap's Zuma (2003): the frog turns to fire into chains of
// balls that roll along tracks around it toward skulls. Three of a colour
// touching go; a gap whose two ends match pulls the front back to close it, and
// the join can match again. A chain reaching its skull ends the round. The
// frog rides a ring of radius LOOP around the middle, and each shot kicks it
// back along the ring, so where it shoots from moves with what it shoots.
// The board hangs on a pin through its middle, and the balls and the frog on
// it are its weight. Each level it also carries a ballast that balances the
// frog and the chains the opening rush leaves, so it opens level and turns only
// as that weight moves: clearing balls on one side tips it to the other, the
// frog kicked along its ring tips it its way, and friction at the pin stops it
// where the weight is under the pin. A shot in flight goes straight on the
// screen, so across a turning board it bends.
//
// A chain reaction puts an item on one of the level's free item places, where it
// turns with the board and goes after LIFE s. A shot that reaches it takes it
// and goes no further. Freeze stops the chains and the board while the frog
// still moves and shoots; laser draws the path a shot takes, bend included, and
// the ball it ends on; reverse rolls every chain back, gaps and all. Bomb, wild and
// strike load the frog's next shot: a bomb takes every ball within BLAST of
// where it lands, a wild ball takes the colour of the ball it hits, and a
// strike takes every ball of that colour on every chain.
//
// Each level's tracks are built by build(), backwards: a walk starts at its
// skull and goes in bends of BEND, never tighter than MINR or more than half a
// circle a bend, circling the middle and drifting outward with a wobble and noise
// of its own. A bend is taken only if it and PROBE steps more stay on the board,
// out of CORE, and SEP from every earlier pass, from the other tracks and from
// its own images; once the walk is `min` long it heads for the nearest edge and
// leaves the board, and it is then turned around so it ends at the skull. A
// walk that gets stuck is walked again. A level is one track, two, two into one
// skull, or one walk and its images under a move that maps the board onto
// itself (SYMS).

import * as ent from "./lib/entity.js";
import * as ease from "./alma/src/ease.js";
import { camera, shake } from "./lib/camera.js";
import { gameOver, ramp } from "./lib/one.js";
import * as play from "./lib/sounds.js";

export { render } from "./lib/entity.js";

export const meta = {
  title: "zuma",
  bg: "#2E4B3C",
  fg: "#F4E6C4",
  scoreMax: true,
  date: "2026-10-06",
  dpad: true,
};

const TAU = 2 * Math.PI;

const INK = 0x14201a;
const RIM = 0x3f6650;
const GROOVE = 0x1f3529;
const STONE = 0xd9b77a;
const HOLE = 0x0b120e;
const DANGER = 0xe8433a;

// Zuma's six: red, yellow, blue, green, purple, white.
const COLORS = [0xe8433a, 0xf4c430, 0x3a8ee8, 0x4fbf52, 0x9b5de0, 0xf2efe6];

const R = 26;
const D = 2 * R;
const CUT = 1.16;

const CX = 512;
const CY = 512;
const FROG_R = 44;
const TURN = 3.2;
const MOUTH = 36; // how far ahead of the frog's middle a shot leaves

const ZOOM = 0.85; // the camera's scale: less of a turned board is off screen
const SHOT = 1500;
const RELOAD = 0.18;
// The balls already in place over the board when a level opens, as a share of
// the track, and how fast they come in.
const INTRO = 0.3;
const RUSH = 420;
const CREEP = 34;
const PULL = 520;
const GROW = 0.12;
const GAP = 0.5;
const MATCH = 3;
const WARN = 0.8;
// A shot off the screen runs every chain at SURGE times its speed for MISS s.
const MISS = 0.8;
const SURGE = 5;

const STEP = R / 2;
const SEP = D + 32; // the rim is D + 22 wide, so two passes' rims keep 10 apart
const MINR = SEP / 2; // a U-turn this tight puts its two sides SEP apart
const KMAX = STEP / MINR;
const SKIP = Math.ceil(Math.PI * MINR / STEP) + 1; // the same pass, behind the head
const PROBE = Math.ceil(96 / STEP);
const BEND = 300;
const EDGE = R + 30;
const LOOP = 110;
const CORE = LOOP + 120; // no track comes this close to the middle
// The speed along the ring a shot fired along it gives, and how fast that dies.
const KICK = 450;
const DRAG = 1.6;
// Gravity on a ball, the board's own inertia as that of 30 balls 350 from the
// middle, and the friction at the pin. With 60 balls on the board and their
// middle, ballast counted, about 50 off the pin, it settles over about 10 s and barely swings back past where it stops.
const GRAV = 750;
const BOARD = 30 * 350 ** 2;
const FRICTION = 0.8;
const HEAVY = 10; // the frog's weight, in balls
// How long a walk is before it heads for the edge: alone, or one of two. One
// not off the board by twice that is walked again.
const MIN = 3000;
const MIN2 = 1800;
const ITEM = 22;
const SPREAD = 200; // between two spawns
const ITEMS = ["freeze", "laser", "reverse", "bomb", "wild", "strike"];
const LIFE = 8;
const BLINK = 2; // of LIFE, the last seconds it blinks
// How long each timed item runs.
const LAST = { freeze: 5, laser: 25, reverse: 3 };
const BACK = 160; // how fast a reversed chain rolls back
const BLAST = 2.4 * D;
const ICE = 0xbfe6f2;
const FUSE = 0xff9a3c;

const V = ([x, y]) => [1024 - x, y];
const H = ([x, y]) => [x, 1024 - y];
const DG = ([x, y]) => [y, x];
const AD = ([x, y]) => [1024 - y, 1024 - x];
const T180 = ([x, y]) => [1024 - x, 1024 - y];
const S = Math.SQRT1_2;

// Each a list of choices: the images besides the walk itself, and the line
// through the middle that an extra item place can sit on, if any.
const SYMS = {
  mirror: [[[V], [0, 1]], [[H], [1, 0]], [[DG], [S, S]], [[AD], [S, -S]]],
  turn2: [[[T180], null]],
};
const MODES = [1, 2, "join", "mirror", "turn2"];

let tracks = [];
// Where the frog is: `u` is its angle on the ring, `w` its speed in radians.
let frog = { x: CX, y: CY + LOOP, u: Math.PI / 2, w: 0 };
// Where items can go: 2 or 3 places clear of the tracks, the skulls and the
// frog, each in the middle of its open space.
let spawns = [];
// The seconds left of each timed item, and what the next shot is loaded with.
let timers = { freeze: 0, laser: 0, reverse: 0 };
let charge = null;
let gun = [];
let level = 0;
let spin = 0; // how fast the camera's angle changes
// The board's own weight: the sum of the offsets from the pin of a set of balls.
let ballast = [0, 0];
let state = "play";
let reload = 0;
let react = 0;
let surge = 0; // the seconds left of a miss's punishment
let warned = 0;

const wrap = (a) => a - TAU * Math.round(a / TAU);
const inside = (x, y) => x > EDGE && x < 1024 - EDGE && y > EDGE && y < 1024 - EDGE;
const key = (cx, cy) => cx * 1000 + cy;

// Whether a point of `pts`, through `grid`, a map of cells SEP wide to indices,
// is within SEP of (px, py), counting only indices from `lo` up to `hi`.
function near(grid, pts, px, py, hi = Infinity, lo = 0) {
  const gx = Math.floor(px / SEP);
  const gy = Math.floor(py / SEP);
  for (let a = -1; a <= 1; ++a) {
    for (let b = -1; b <= 1; ++b) {
      for (const j of grid.get(key(gx + a, gy + b)) ?? []) {
        if (j >= hi || j < lo) continue;
        const [qx, qy] = pts[j];
        if (Math.hypot(px - qx, py - qy) < SEP) return true;
      }
    }
  }
  return false;
}

function gridOf(pts) {
  const grid = new Map();
  pts.forEach(([px, py], i) => {
    if (!inside(px, py)) return;
    const k = key(Math.floor(px / SEP), Math.floor(py / SEP));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });
  return grid;
}

// `block` is other tracks' points, kept SEP from but for their first `free`,
// and this walk's own first `free` are not held to them. `from` is
// [x, y, heading]. Step points from the board's edge to the skull, or null.
function walk({ min, from, block = [], free = 0, images = [] }) {
  const blockGrid = gridOf(block);
  const n = Math.round(BEND / STEP);
  const kcap = Math.min(KMAX, Math.PI / n);
  const dir = Math.random() < 0.5 ? 1 : -1;
  const swirl = 0.05 + 0.25 * Math.random();
  const outward = -0.2 + 0.7 * Math.random();
  const wob = Math.random() * 0.6 * KMAX;
  const wobF = 0.04 + 0.12 * Math.random();
  const noise = (0.1 + 0.5 * Math.random()) * KMAX;
  let drift = 0;

  let [x, y, h] = from;
  const pts = [[x, y]];
  const grid = new Map();
  const put = () => {
    const k = key(Math.floor(x / SEP), Math.floor(y / SEP));
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(pts.length - 1);
  };
  put();
  const leaving = (i) => STEP * i >= min;

  function ok(px, py, i) {
    if (!inside(px, py)) return leaving(i);
    if (Math.hypot(px - CX, py - CY) < CORE) return false;
    for (const g of images) {
      const [mx, my] = g([px, py]);
      if (Math.hypot(px - mx, py - my) < SEP) return false;
      if (near(grid, pts, mx, my)) return false;
    }
    if (i >= free && near(blockGrid, block, px, py, Infinity, free)) return false;
    return !near(grid, pts, px, py, i - SKIP);
  }

  let k = 0;
  while (STEP * pts.length < 2 * min) {
    let head = Math.atan2(y - CY, x - CX) + dir * (Math.PI / 2 - outward);
    if (leaving(pts.length)) {
      const d = [x, y, 1024 - x, 1024 - y];
      head = [Math.PI, -Math.PI / 2, 0, Math.PI / 2][d.indexOf(Math.min(...d))];
    }
    drift = 0.7 * drift + 0.3 * (Math.random() - 0.5);
    let want = (leaving(pts.length) ? 0.5 : swirl) * wrap(head - h) +
      wob * Math.sin(pts.length * STEP / 24 * wobF * TAU / 4) + noise * 2 * drift;
    want = Math.max(-kcap, Math.min(kcap, 0.4 * k + 0.6 * want));

    const cands = [want];
    for (let c = 0; c <= 16; ++c) cands.push(-kcap + 2 * kcap * c / 16);
    cands.sort((a, b) => Math.abs(a - want) - Math.abs(b - want));

    const pick = cands.find((c) => {
      let [px, py, ph] = [x, y, h];
      for (let p = 0; p < n + PROBE; ++p) {
        ph += c;
        px += STEP * Math.cos(ph);
        py += STEP * Math.sin(ph);
        if (!ok(px, py, pts.length + p)) return false;
      }
      return true;
    });
    if (pick === undefined) return null;
    for (let p = 0; p < n; ++p) {
      h += pick;
      x += STEP * Math.cos(h);
      y += STEP * Math.sin(h);
      pts.push([x, y]);
      if (!inside(x, y)) {
        // On until the rim is past the screen's corners, so a track's end
        // never shows however the board turns around the middle.
        while (Math.hypot(x - CX, y - CY) < 512 * Math.SQRT2 / ZOOM + (D + 22) / 2) {
          x += STEP * Math.cos(h);
          y += STEP * Math.sin(h);
          pts.push([x, y]);
        }
        return pts.reverse();
      }
      put();
    }
    k = pick;
  }
  return null;
}

function skullAt() {
  const a = TAU * Math.random();
  const r = CORE + 20 + 160 * Math.random();
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
}

// A level's tracks as step points; null if 400 tries failed.
function build(mode) {
  const sym = SYMS[mode];
  const min = mode === 1 ? MIN : MIN2;
  for (let t = 0; t < 400; ++t) {
    const choice = sym?.[Math.floor(sym.length * Math.random())];

    let set = null;
    if (mode === 1) {
      set = [walk({ min, from: [...skullAt(), TAU * Math.random()] })];
    } else if (mode === 2) {
      const one = walk({ min, from: [...skullAt(), TAU * Math.random()] });
      if (!one) continue;
      // The first takes most of the room, so the second gets 20 tries at it.
      for (let u = 0; u < 20 && !set?.[1]; ++u) {
        const [x, y] = skullAt();
        if (one.some(([px, py]) => Math.hypot(px - x, py - y) < 2 * SEP)) continue;
        set = [one, walk({ min, from: [x, y, TAU * Math.random()], block: one })];
      }
      if (!set) continue;
    } else if (mode === "join") {
      // Two walks out of one skull, leaving it in near opposite directions.
      const [x, y] = skullAt();
      const h = TAU * Math.random();
      const one = walk({ min, from: [x, y, h] });
      if (!one) continue;
      set = [
        one,
        walk({
          min,
          from: [x, y, h + Math.PI + (Math.random() - 0.5)],
          block: one.toReversed(),
          free: Math.ceil(SEP / STEP),
        }),
      ];
    } else {
      const [images] = choice;
      const skull = skullAt();
      const close = images.some((g) => {
        const [mx, my] = g(skull);
        return Math.hypot(skull[0] - mx, skull[1] - my) < 2 * SEP;
      });
      if (close) continue;
      const one = walk({ min, from: [...skull, TAU * Math.random()], images });
      if (!one) continue;
      set = [one, ...images.map((g) => one.map(g))];
    }
    if (!set.every(Boolean)) continue;
    spawns = places(set, choice);
    return set;
  }
  return null;
}

// 2 or 3 item places, or with a symmetry one place and its images, plus maybe
// one on the line of a single reflection. Each is then moved to where the gap
// to the nearest thing is widest.
function places(paths, sym) {
  const pts = paths.flat();
  const skulls = paths.map((path) => path.at(-1));
  const ok = ([x, y]) =>
    x > ITEM + 40 && x < 1024 - ITEM - 40 && y > ITEM + 40 && y < 1024 - ITEM - 40 &&
    Math.hypot(x - CX, y - CY) > LOOP + FROG_R + 90 &&
    pts.every(([px, py]) => Math.hypot(x - px, y - py) > (D + 22) / 2 + ITEM + 8) &&
    skulls.every(([sx, sy]) => Math.hypot(x - sx, y - sy) > R + 26 + ITEM + 8);
  const far = (p, out) =>
    out.every((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) >= SPREAD);
  const count = Math.random() < 0.5 ? 2 : 3;
  const out = [];

  // The gap around p to the edge, the frog's ring, a rim, a skull, and half the way to
  // another place or to p's own images.
  function room([x, y], others, images) {
    let m = Math.min(x, y, 1024 - x, 1024 - y);
    m = Math.min(m, Math.hypot(x - CX, y - CY) - LOOP - FROG_R);
    for (const [px, py] of pts) {
      m = Math.min(m, Math.hypot(x - px, y - py) - (D + 22) / 2);
    }
    for (const [sx, sy] of skulls) {
      m = Math.min(m, Math.hypot(x - sx, y - sy) - (R + 26));
    }
    for (const [qx, qy] of others) m = Math.min(m, Math.hypot(x - qx, y - qy) / 2);
    for (const g of images) {
      const [qx, qy] = g([x, y]);
      m = Math.min(m, Math.hypot(x - qx, y - qy) / 2);
    }
    return m;
  }

  function settle(p, others, images = [], line = null) {
    const dirs = line ? [line, [-line[0], -line[1]]] : Array.from(
      { length: 8 },
      (_, i) => [Math.cos(i * TAU / 8), Math.sin(i * TAU / 8)],
    );
    let best = room(p, others, images);
    for (let step = 48; step > 1;) {
      let next = null;
      for (const [dx, dy] of dirs) {
        const q = [p[0] + step * dx, p[1] + step * dy];
        const m = room(q, others, images);
        if (m > best) [next, best] = [q, m];
      }
      if (next) p = next;
      else step /= 2;
    }
    return p;
  }

  if (sym) {
    const [images, line] = sym;
    for (let t = 0; t < 300 && !out.length; ++t) {
      const orbit = [[1024 * Math.random(), 1024 * Math.random()]];
      for (const g of images) {
        const m = g(orbit[0]);
        if (!ok(m) || !far(m, orbit)) break;
        orbit.push(m);
      }
      if (orbit.length !== images.length + 1 || !ok(orbit[0])) continue;
      const p = settle(orbit[0], [], images);
      out.push(p, ...images.map((g) => g(p)));
    }
    if (!line) return out;
    const [dx, dy] = line;
    for (let t = 0; t < 300 && out.length === 2 && count === 3; ++t) {
      const d = (Math.random() < 0.5 ? -1 : 1) *
        (LOOP + FROG_R + 90 + 300 * Math.random());
      const p = [CX + d * dx, CY + d * dy];
      if (ok(p) && far(p, out)) out.push(settle(p, out, [], line));
    }
    return out;
  }

  // Of 40 places that fit, the one farthest from those already picked.
  while (out.length < count) {
    let best = null;
    let bestD = -1;
    for (let t = 0, n = 0; t < 400 && n < 40; ++t) {
      const p = [1024 * Math.random(), 1024 * Math.random()];
      if (!ok(p)) continue;
      ++n;
      const d = Math.min(
        Infinity,
        ...out.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1])),
      );
      if (d > bestD) [best, bestD] = [p, d];
    }
    if (!best || bestD < SPREAD) break;
    out.push(best);
  }
  // Twice, since moving one changes the room of the rest.
  for (let round = 0; round < 2; ++round) {
    for (let i = 0; i < out.length; ++i) {
      out[i] = settle(out[i], out.filter((_, j) => j !== i));
    }
  }
  return out;
}

// Catmull-Rom through a control point every 52 of a walk.
function spline(walked) {
  const ctrl = walked.filter((_, i) => i % Math.round(52 / STEP) === 0);
  if (ctrl.at(-1) !== walked.at(-1)) ctrl.push(walked.at(-1));
  const raw = [];
  const p = (i) => ctrl[Math.max(0, Math.min(ctrl.length - 1, i))];
  for (let i = 0; i < ctrl.length - 1; ++i) {
    const [a, b, c, d] = [p(i - 1), p(i), p(i + 1), p(i + 2)];
    for (let k = 0; k < 40; ++k) {
      const t = k / 40;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (j) =>
        0.5 * (2 * b[j] + (c[j] - a[j]) * t +
          (2 * a[j] - 5 * b[j] + 4 * c[j] - d[j]) * t2 +
          (3 * b[j] - a[j] - 3 * c[j] + d[j]) * t3);
      raw.push({ x: f(0), y: f(1) });
    }
  }
  raw.push({ x: ctrl.at(-1)[0], y: ctrl.at(-1)[1] });

  // Even steps of 2 along the curve, so a ball's s is a distance.
  const pts = [raw[0]];
  let left = 2;
  for (let i = 1; i < raw.length; ++i) {
    let { x, y } = raw[i - 1];
    const { x: bx, y: by } = raw[i];
    let seg = Math.hypot(bx - x, by - y);
    while (seg >= left) {
      const t = left / seg;
      x += (bx - x) * t;
      y += (by - y) * t;
      pts.push({ x, y });
      seg -= left;
      left = 2;
    }
    left -= seg;
  }
  // The arc length up to where the track comes onto the board.
  const off = 2 *
    pts.findIndex(({ x, y }) => x >= 0 && x <= 1024 && y >= 0 && y <= 1024);
  const path = new Path2D();
  path.moveTo(pts[0].x, pts[0].y);
  for (const q of pts) path.lineTo(q.x, q.y);
  return {
    pts,
    L: 2 * (pts.length - 1),
    off,
    path,
    chain: [],
    remaining: 0,
    intro: true,
  };
}

function at(track, s) {
  const { pts } = track;
  const f = Math.max(0, Math.min(pts.length - 1.001, s / 2));
  const i = Math.floor(f);
  const t = f - i;
  const a = pts[i];
  const b = pts[i + 1];
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    a: Math.atan2(b.y - a.y, b.x - a.x),
  };
}

const space = (a, b) => R * (a.w + b.w);
const gap = (chain, i) =>
  chain[i].s - chain[i - 1].s - space(chain[i - 1], chain[i]);

const LA = Math.atan2(-0.764, -0.645);

function outline(ctx, x, y, r) {
  ctx.fillStyle = ent.css(INK);
  ctx.beginPath();
  ctx.arc(x, y, r * CUT, 0, TAU);
  ctx.fill();
}

// `roll` is how far the ball has rolled; the band across it moves with that.
function ball(ctx, color, r, roll = 0, a = 0) {
  ctx.fillStyle = ent.css(COLORS[color]);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();

  const o = r * Math.sin(roll / r);
  const h = Math.sqrt(r * r - o * o);
  ctx.save();
  ctx.rotate(a);
  ctx.strokeStyle = "rgba(0, 0, 0, 0.18)";
  ctx.lineWidth = r * 0.22;
  ctx.beginPath();
  ctx.moveTo(o, -h);
  ctx.lineTo(o, h);
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
  ctx.lineWidth = r * 0.17;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.62, LA - 0.7, LA + 0.7);
  ctx.stroke();
}

const TINT = {
  freeze: ICE,
  laser: DANGER,
  reverse: STONE,
  bomb: INK,
  wild: INK,
  strike: COLORS[1],
};

// An item at the origin: on the board, at the frog's mouth and in flight.
function icon(ctx, kind, r) {
  outline(ctx, 0, 0, r);
  ctx.fillStyle = ent.css(TINT[kind]);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = ctx.fillStyle = ent.css(INK);
  ctx.lineWidth = r * 0.16;
  ctx.lineCap = ctx.lineJoin = "round";
  ctx.beginPath();
  if (kind === "freeze") {
    for (let i = 0; i < 3; ++i) {
      const x = 0.65 * r * Math.cos(i * Math.PI / 3);
      const y = 0.65 * r * Math.sin(i * Math.PI / 3);
      ctx.moveTo(-x, -y);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  } else if (kind === "laser") {
    ctx.strokeStyle = ctx.fillStyle = "#fff";
    ctx.arc(0, 0, r * 0.5, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.16, 0, TAU);
    ctx.fill();
  } else if (kind === "reverse") {
    const e = 1.6 * Math.PI;
    ctx.arc(0, 0, r * 0.5, 0.2 * Math.PI, e);
    ctx.stroke();
    const [x, y] = [0.5 * r * Math.cos(e), 0.5 * r * Math.sin(e)];
    const [tx, ty] = [-Math.sin(e), Math.cos(e)];
    ctx.beginPath();
    ctx.moveTo(x + 0.35 * r * tx, y + 0.35 * r * ty);
    ctx.lineTo(x - 0.28 * r * ty, y + 0.28 * r * tx);
    ctx.lineTo(x + 0.28 * r * ty, y - 0.28 * r * tx);
    ctx.fill();
  } else if (kind === "bomb") {
    ctx.strokeStyle = ent.css(STONE);
    ctx.moveTo(0.3 * r, -0.5 * r);
    ctx.quadraticCurveTo(0.4 * r, -0.95 * r, 0.75 * r, -0.85 * r);
    ctx.stroke();
    ctx.fillStyle = ent.css(FUSE);
    ctx.beginPath();
    ctx.arc(0.75 * r, -0.85 * r, 0.2 * r, 0, TAU);
    ctx.fill();
  } else if (kind === "wild") {
    COLORS.forEach((c, i) => {
      ctx.fillStyle = ent.css(c);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r * 0.8, i * TAU / 6, (i + 1) * TAU / 6);
      ctx.fill();
    });
  } else if (kind === "strike") {
    const bolt = [[0.15, -0.7], [-0.35, 0.1], [0, 0.1], [-0.15, 0.7], [0.35, -0.1], [
      0,
      -0.1,
    ]];
    for (const [x, y] of bolt) ctx.lineTo(x * r, y * r);
    ctx.fill();
  }
}

class Item extends ent.Entity {
  constructor(kind, at) {
    super();
    this.kind = kind;
    this.at = at;
    [this.pos.x, this.pos.y] = at;
  }

  update() {
    if (this.age > LIFE) this.remove();
    // Upright on the screen however the board has turned.
    this.angle = camera.angle;
  }

  render(ctx) {
    const left = LIFE - this.age;
    if (left < BLINK && left * 6 % 1 < 0.4) return;
    icon(ctx, this.kind, ITEM * ease.backOut(1.7)(Math.min(1, this.age / 0.3)));
  }
}

class Track extends ent.Entity {
  render(ctx) {
    // Frozen, the board goes icy, and fades back over the last 0.25 s.
    if (timers.freeze > 0) {
      ctx.fillStyle = ent.css(ICE);
      ctx.globalAlpha = 0.25 * Math.min(1, 4 * timers.freeze);
      ctx.fillRect(-1024, -1024, 3072, 3072);
      ctx.globalAlpha = 1;
    }

    ctx.strokeStyle = ent.css(GROOVE);
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.arc(CX, CY, LOOP, 0, TAU);
    ctx.stroke();

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const track of tracks) {
      ctx.strokeStyle = ent.css(RIM);
      ctx.lineWidth = D + 22;
      ctx.stroke(track.path);
      ctx.strokeStyle = ent.css(GROOVE);
      ctx.lineWidth = D + 6;
      ctx.stroke(track.path);
    }

    for (const track of tracks) {
      const end = track.pts.at(-1);
      ctx.fillStyle = ent.css(STONE);
      ctx.beginPath();
      ctx.arc(end.x, end.y, R + 26, 0, TAU);
      ctx.fill();
      ctx.fillStyle = ent.css(HOLE);
      ctx.beginPath();
      ctx.arc(end.x, end.y, R + 12, 0, TAU);
      ctx.fill();
    }

    for (const track of tracks) {
      const head = track.chain.at(-1);
      if (!head || head.s < WARN * track.L) continue;
      const end = track.pts.at(-1);
      const k = (head.s - WARN * track.L) / ((1 - WARN) * track.L);
      ctx.strokeStyle = ent.css(DANGER);
      ctx.globalAlpha = Math.min(1, k + 0.2) *
        (0.6 + 0.4 * Math.sin(ent.game.totalTime * 12));
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(end.x, end.y, R + 26, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}

class Chain extends ent.Entity {
  render(ctx) {
    const live = [];
    for (const track of tracks) {
      for (const b of track.chain) {
        const p = at(track, b.s);
        const t = ease.cubicOut(b.w);
        b.x = b.fx === undefined ? p.x : b.fx + (p.x - b.fx) * t;
        b.y = b.fy === undefined ? p.y : b.fy + (p.y - b.fy) * t;
        b.a = p.a;
        if (b.s > -R && b.s <= track.L) live.push(b);
      }
    }
    for (const b of live) outline(ctx, b.x, b.y, R);
    for (const b of live) {
      ctx.save();
      ctx.translate(b.x, b.y);
      ball(ctx, b.color, R, b.s, b.a);
      ctx.restore();
    }
  }
}

class Shot extends ent.Entity {
  constructor(color, x, y, a, kind = null) {
    super();
    this.color = color;
    this.kind = kind;
    this.pos.x = x;
    this.pos.y = y;
    this.dir = { x: Math.cos(a), y: Math.sin(a) };
  }

  update() {
    // A point still on the screen turns with the camera across the board.
    const t = turning() * ent.game.time;
    const [c, sn] = [Math.cos(t), Math.sin(t)];
    const [x, y] = [this.pos.x - CX, this.pos.y - CY];
    this.pos.x = CX + c * x - sn * y;
    this.pos.y = CY + sn * x + c * y;
    this.dir = {
      x: c * this.dir.x - sn * this.dir.y,
      y: sn * this.dir.x + c * this.dir.y,
    };
    this.angle = camera.angle;
    const d = SHOT * ent.game.time;
    const n = Math.ceil(d / R);
    for (let i = 0; i < n && !this.dead; ++i) this.step(d / n);
  }

  step(d) {
    this.pos.x += this.dir.x * d;
    this.pos.y += this.dir.y * d;
    const { x, y } = this.pos;
    if (!onScreen(this.pos, -R)) {
      this.remove();
      if (state === "play") {
        surge = MISS;
        play.whoosh();
      }
      return;
    }
    if (state !== "play") return;
    const it = touched(x, y);
    if (it) {
      this.remove();
      return take(it);
    }
    const hit = struck(x, y);
    if (!hit) return;
    const [track, b] = hit;
    this.remove();
    if (this.kind === "bomb") return bomb(x, y);
    if (this.kind === "strike") return strike(b.color);
    if (this.kind === "wild") this.color = b.color;
    insert(track.chain, this, b);
  }

  render(ctx) {
    if (this.kind) return icon(ctx, this.kind, R);
    outline(ctx, 0, 0, R);
    ball(ctx, this.color, R);
  }
}

class Frog extends ent.Entity {
  constructor() {
    super();
    this.aimA = -Math.PI / 2;
    // The first frame only records where the pointer is, so a round does not
    // open by turning the frog to wherever it was left.
    this.ptr = null;
    this.swap = 0;
  }

  update() {
    const { input, time } = ent.game;
    frog.u += frog.w * time;
    frog.w *= Math.exp(-DRAG * time);
    frog.x = CX + LOOP * Math.cos(frog.u);
    frog.y = CY + LOOP * Math.sin(frog.u);
    this.pos.x = frog.x;
    this.pos.y = frog.y;
    const last = this.ptr;
    this.ptr = { x: input.x, y: input.y };

    if (input.press.left) this.aimA -= TURN * time;
    else if (input.press.right) this.aimA += TURN * time;
    else if (last && (input.x !== last.x || input.y !== last.y)) {
      this.aimA = Math.atan2(input.y - frog.y, input.x - frog.x);
    }
    this.angle = this.aimA + Math.PI / 2;

    this.swap = Math.max(0, this.swap - time);
    if (input.just.up || input.just.down) {
      gun = [gun[1], gun[0]];
      this.swap = 0.12;
      play.blip();
    }

    reload = Math.max(0, reload - time);
    if (!input.just.act || state !== "play") return;
    if (reload > 0) return play.deny();
    const dx = Math.cos(this.aimA);
    const dy = Math.sin(this.aimA);
    const [x, y] = [frog.x + dx * MOUTH, frog.y + dy * MOUTH];
    if (charge) new Shot(0, x, y, this.aimA, charge);
    else {
      new Shot(gun.shift(), x, y, this.aimA);
      gun.push(pick());
    }
    charge = null;
    frog.w -= KICK * (dy * Math.cos(frog.u) - dx * Math.sin(frog.u)) / LOOP;
    reload = RELOAD;
    play.shoot();
  }

  // How far the aim runs: to the first ball the shot would reach.
  aim() {
    const dx = Math.cos(this.aimA);
    const dy = Math.sin(this.aimA);
    const hit = D * 0.92;
    let near = 1500;
    for (const track of tracks) {
      for (const b of track.chain) {
        if (b.x === undefined) continue;
        const along = (b.x - frog.x) * dx + (b.y - frog.y) * dy;
        const side = (b.x - frog.x) * dy - (b.y - frog.y) * dx;
        if (along <= 0 || Math.abs(side) > hit) continue;
        near = Math.min(near, along - Math.sqrt(hit * hit - side * side));
      }
    }
    return near;
  }

  render(ctx) {
    ctx.strokeStyle = ent.css(charge ? STONE : COLORS[gun[0]]);
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 4;
    ctx.setLineDash([6, 14]);
    ctx.beginPath();
    if (timers.laser > 0) this.laser(ctx);
    else {
      ctx.moveTo(0, -MOUTH - R);
      ctx.lineTo(0, -this.aim());
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.rotate(camera.angle - this.angle);
    ["freeze", "laser", "reverse"].forEach((k, i) => {
      if (timers[k] <= 0) return;
      ctx.strokeStyle = ent.css(TINT[k]);
      ctx.lineWidth = 6;
      ctx.beginPath();
      const r = FROG_R + 14 + 10 * i;
      ctx.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + TAU * timers[k] / LAST[k]);
      ctx.stroke();
    });
    ctx.restore();

    ctx.fillStyle = ent.css(INK);
    ctx.beginPath();
    ctx.ellipse(0, 4, FROG_R + 6, FROG_R - 2, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = ent.css(STONE);
    ctx.beginPath();
    ctx.ellipse(0, 4, FROG_R, FROG_R - 8, 0, 0, TAU);
    ctx.fill();

    for (const s of [-1, 1]) {
      ctx.fillStyle = ent.css(INK);
      ctx.beginPath();
      ctx.arc(s * 30, -26, 15, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(s * 30, -26, 11, 0, TAU);
      ctx.fill();
      ctx.fillStyle = ent.css(INK);
      ctx.beginPath();
      ctx.arc(s * 30, -28, 5, 0, TAU);
      ctx.fill();
    }

    const t = 1 - this.swap / 0.12;
    const back = 18 + 14 * (1 - t);
    outline(ctx, 0, back, 12);
    ctx.save();
    ctx.translate(0, back);
    ball(ctx, gun[1], 12);
    ctx.restore();

    const r = R * (reload > 0 ? 1 - 0.5 * reload / RELOAD : 1);
    ctx.save();
    ctx.translate(0, -MOUTH + 10);
    if (charge) {
      ctx.rotate(camera.angle - this.angle);
      icon(ctx, charge, r);
    } else {
      outline(ctx, 0, 0, r);
      ball(ctx, gun[0], r);
    }
    ctx.restore();
  }

  // The path a shot fired now takes, in board units, and a ghost of it where
  // it stops.
  laser(ctx) {
    const dx = Math.cos(this.aimA);
    const dy = Math.sin(this.aimA);
    const { pts, end } = flight(frog.x + dx * MOUTH, frog.y + dy * MOUTH, this.aimA);
    ctx.save();
    ctx.rotate(-this.angle);
    ctx.translate(-this.pos.x, -this.pos.y);
    for (const [x, y] of pts) ctx.lineTo(x, y);
    ctx.stroke();
    if (end) {
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.5;
      ctx.translate(...end);
      ctx.rotate(camera.angle);
      if (charge) icon(ctx, charge, R);
      else ball(ctx, gun[0], R);
    }
    ctx.restore();
  }
}

// One step of the board swinging on its pin under the weight of the balls on
// it. A ball's pull turns the board by how far right of the pin it is on the
// screen; the camera's angle going down turns the board clockwise.
function swing(dt) {
  if (timers.freeze > 0) return;
  const c = Math.cos(camera.angle);
  const sn = Math.sin(camera.angle);
  const [fx, fy] = [frog.x - CX, frog.y - CY];
  let pull = c * (ballast[0] + HEAVY * fx) + sn * (ballast[1] + HEAVY * fy);
  let inertia = BOARD + HEAVY * LOOP * LOOP;
  for (const track of tracks) {
    for (const b of track.chain) {
      if (b.s < 0) continue;
      const { x, y } = at(track, b.s);
      const [dx, dy] = [x - CX, y - CY];
      pull += b.w * (c * dx + sn * dy);
      inertia += b.w * (dx * dx + dy * dy);
    }
  }
  spin += (-GRAV * pull / inertia - FRICTION * spin) * dt;
  camera.angle += spin * dt;
}

// The camera's turn as a shot sees it: none while frozen.
function turning() {
  return timers.freeze > 0 ? 0 : spin;
}

function touched(x, y) {
  return ent.get(Item).find((it) =>
    Math.hypot(it.pos.x - x, it.pos.y - y) < R + ITEM
  );
}

// The ball a shot at (x, y) hits, as [track, ball].
function struck(x, y) {
  for (const track of tracks) {
    for (const b of track.chain) {
      if (b.x === undefined || b.w < 0.5 || b.s > track.L) continue;
      if ((b.x - x) ** 2 + (b.y - y) ** 2 > (D * 0.92) ** 2) continue;
      return [track, b];
    }
  }
  return null;
}

// Where a shot fired from (x, y) at angle a goes, stepped as Shot steps it,
// with the board turning at the speed it turns now and the chains where they
// are: the points it passes through, and where it stops on a ball or an item.
// It goes straight on the screen, so it leaves the screen where the straight
// line does.
function flight(x, y, a) {
  const w = turning() / 60;
  const [c, sn] = [Math.cos(w), Math.sin(w)];
  let [dx, dy] = [Math.cos(a), Math.sin(a)];
  const s0 = camera.toScreen(x, y);
  const s1 = camera.toScreen(x + dx, y + dy);
  const pts = [[x, y]];
  let went = 0;
  for (let f = 0; f < 120; ++f) {
    [x, y] = [CX + c * (x - CX) - sn * (y - CY), CY + sn * (x - CX) + c * (y - CY)];
    [dx, dy] = [c * dx - sn * dy, sn * dx + c * dy];
    const d = SHOT / 60;
    const n = Math.ceil(d / R);
    for (let i = 0; i < n; ++i) {
      x += dx * d / n;
      y += dy * d / n;
      went += d / n;
      const sx = s0.x + (s1.x - s0.x) * went;
      const sy = s0.y + (s1.y - s0.y) * went;
      if (sx < -R || sy < -R || sx > 1024 + R || sy > 1024 + R) {
        return { pts: [...pts, [x, y]], end: null };
      }
      if (touched(x, y) || struck(x, y)) {
        return { pts: [...pts, [x, y]], end: [x, y] };
      }
    }
    pts.push([x, y]);
  }
  return { pts, end: null };
}

function pop(b, color) {
  new ent.Particle({
    x: b.x,
    y: b.y,
    color,
    count: 8,
    size: [3, 5],
    speed: [60, 220],
    duration: [0.4, 0.2],
    circle: true,
  });
}

// An item on one of the places no item holds.
function drop() {
  const held = ent.get(Item).map((it) => it.at);
  const free = spawns.filter((p) => !held.includes(p));
  if (free.length === 0) return;
  new Item(
    ITEMS[Math.floor(ITEMS.length * Math.random())],
    free[Math.floor(free.length * Math.random())],
  );
  play.coin();
}

function take(it) {
  it.remove();
  pop(it.pos, TINT[it.kind]);
  play.power();
  if (it.kind in LAST) timers[it.kind] = LAST[it.kind];
  else charge = it.kind;
}

// Every ball on the board that `gone` says goes, as one match, so a gap it
// leaves can close into a chain reaction.
function burst(gone, x, y) {
  let n = 0;
  for (const track of tracks) {
    track.chain = track.chain.filter((b) => {
      if (b.x === undefined || b.s < 0 || b.s > track.L || !gone(b)) return true;
      pop(b, COLORS[b.color]);
      ++n;
      return false;
    });
  }
  react = 1;
  if (n > 0) ent.addScore(10 * n, x, y);
  play.explode();
  shake(0.3);
  restock();
}

function bomb(x, y) {
  burst((b) => Math.hypot(b.x - x, b.y - y) < BLAST, x, y);
}

function strike(color) {
  burst((b) => b.color === color, frog.x, frog.y - 92);
}

function insert(chain, shot, b) {
  const i = chain.indexOf(b);
  const ahead = (shot.pos.x - b.x) * Math.cos(b.a) +
      (shot.pos.y - b.y) * Math.sin(b.a) > 0;
  const n = {
    s: b.s + (ahead ? R : -R),
    color: shot.color,
    w: 0,
    fx: shot.pos.x,
    fy: shot.pos.y,
  };
  chain.splice(ahead ? i + 1 : i, 0, n);
  react = 0;
  play.step();
}

// The run of n's colour that touches it, as [first, last] indices.
function run(chain, n) {
  const i = chain.indexOf(n);
  let lo = i;
  let hi = i;
  while (lo > 0 && chain[lo - 1].color === n.color && gap(chain, lo) <= GAP) --lo;
  while (
    hi < chain.length - 1 && chain[hi + 1].color === n.color &&
    gap(chain, hi + 1) <= GAP
  ) ++hi;
  return [lo, hi];
}

function check(chain, n) {
  if (!chain.includes(n)) return false;
  const [lo, hi] = run(chain, n);
  if (hi - lo + 1 < MATCH) return false;
  if (chain.slice(lo, hi + 1).some((b) => b.w < 1)) return false;

  react += 1;
  if (react === 2) drop();
  const gone = chain.splice(lo, hi - lo + 1);
  const c = COLORS[n.color];
  let x = 0;
  let y = 0;
  for (const b of gone) {
    x += b.x / gone.length;
    y += b.y / gone.length;
    pop(b, c);
  }
  ent.addScore(10 * gone.length * react, x, y, { color: c });
  play.break({ detune: 200 * (react - 1) });
  shake(0.08 + 0.04 * react);
  restock();
  return true;
}

// The colours of the balls showing on the screen, or with none showing, of
// all the chains.
function live() {
  const all = tracks.flatMap((t) =>
    t.chain.filter((b) => b.s <= t.L).map((b) => [t, b])
  );
  const seen = all.filter(([t, b]) => onScreen(at(t, b.s), -R));
  return [...new Set((seen.length ? seen : all).map(([, b]) => b.color))];
}

function pick() {
  const on = live();
  if (on.length === 0) return Math.floor(colors() * Math.random());
  return on[Math.floor(on.length * Math.random())];
}

function restock() {
  const on = live();
  if (on.length === 0) return;
  gun = gun.map((c) => on.includes(c) ? c : pick());
}

function colors() {
  return Math.min(COLORS.length, 4 + Math.floor((ramp() - 1) / 0.45));
}

// Runs of a colour, as Zuma's chains have, so a shot often has two to join.
function spawn(track) {
  const tail = track.chain[0];
  const same = tail && Math.random() < 0.45;
  track.chain.unshift({
    s: tail ? tail.s - D : 0,
    color: same ? tail.color : Math.floor(colors() * Math.random()),
    w: 1,
  });
  --track.remaining;
}

// Level 1 is one track around the middle; after that any mode.
function nextLevel() {
  level += 1;
  const mode = level === 1 ? 1 : MODES[Math.floor(MODES.length * Math.random())];
  const walks = build(mode) ?? build(1);
  tracks = walks.map(spline);
  // The level's balls, shared by length.
  const all = tracks.reduce((n, t) => n + t.L, 0);
  for (const t of tracks) t.remaining = Math.ceil((40 + 15 * level) * t.L / all);
  state = "play";
  react = 0;
  surge = 0;
  timers = { freeze: 0, laser: 0, reverse: 0 };
  for (const it of ent.get(Item)) it.remove();
  hang();
}

// The ballast for the frog and the chains the opening rush leaves: as heavy,
// and on the other side of the pin. Without it a single track's chain hangs below the
// frog, and every shot goes down.
function hang() {
  let [sx, sy] = [HEAVY * (frog.x - CX), HEAVY * (frog.y - CY)];
  for (const track of tracks) {
    const head = track.off + INTRO * (track.L - track.off);
    for (let s = head, n = 0; s >= 0 && n < track.remaining; s -= D, ++n) {
      const { x, y } = at(track, s);
      sx += x - CX;
      sy += y - CY;
    }
  }
  ballast = [-sx, -sy];
  camera.angle = 0;
  spin = 0;
}

function cleared() {
  state = "clear";
  ent.addScore(250 * level, frog.x, frog.y - 92);
  play.power();
  shake(0.3);
  ent.after(1.5, () => {
    nextLevel();
    restock();
  });
}

function lose() {
  state = "lost";
  play.lose();
  shake(0.6);
}

function move(track, dt) {
  const { chain } = track;
  while (track.remaining > 0 && (chain.length === 0 || chain[0].s >= 0)) {
    spawn(track);
  }
  if (chain.length === 0) return;

  const grown = [];
  for (const b of chain) {
    if (b.w >= 1) continue;
    b.w = Math.min(1, b.w + dt / GROW);
    if (b.w === 1) grown.push(b);
  }

  const open = chain.map((_, i) => i > 0 && gap(chain, i) > GAP);

  // A front piece whose end matches the ball behind the gap is pulled back.
  let back = false;
  for (let i = 1; i < chain.length && timers.freeze <= 0; ++i) {
    if (open[i]) back = chain[i].color === chain[i - 1].color;
    if (back) chain[i].s -= PULL * dt;
  }

  const head = chain.at(-1).s;
  if (track.intro && head >= track.off + INTRO * (track.L - track.off)) {
    track.intro = false;
  }
  let v = track.intro ? RUSH : CREEP * ramp() * (surge > 0 ? SURGE : 1);
  // Nothing of the chain on the screen yet: bring it on. Where the track
  // comes onto the screen moves as the board turns.
  if (head < 2 * track.pts.findIndex((p) => onScreen(p))) v = RUSH;
  if (head > WARN * track.L) v *= 0.6;
  if (timers.freeze > 0) v = 0;
  if (timers.reverse > 0 && v > 0) {
    for (const b of chain) b.s -= BACK * dt;
  } else chain[0].s += v * dt;

  const joined = [];
  for (let i = 1; i < chain.length; ++i) {
    const min = chain[i - 1].s + space(chain[i - 1], chain[i]);
    // Within GAP is touching, and snapped to it: a gap left at 0.3 would be
    // closed to run() but never join, so the match across it would never go.
    if (chain[i].s > min + GAP) continue;
    chain[i].s = min;

    if (open[i] && chain[i].color === chain[i - 1].color) joined.push(chain[i]);
  }
  if (joined.length > 0) play.land();

  for (const b of [...grown, ...joined]) check(chain, b);
}

// Whether a point is at least `m` inside the screen.
function onScreen({ x, y }, m = R) {
  const p = camera.toScreen(x, y);
  return p.x > m && p.y > m && p.x < 1024 - m && p.y < 1024 - m;
}

// Whether the chain is about to move back: a ball still growing in may match,
// and a gap whose ends match is pulling its front back. Until neither is so, a
// chain into its skull has not lost.
function pending(chain) {
  return chain.some((b, i) =>
    b.w < 1 || (i > 0 && gap(chain, i) > GAP && b.color === chain[i - 1].color)
  );
}

function step(dt) {
  if (state === "clear") return;

  if (state === "lost") {
    for (const track of tracks) {
      for (const b of track.chain) b.s += 900 * dt;
      track.chain = track.chain.filter((b) => b.s < track.L);
    }
    if (tracks.every((t) => t.chain.length === 0)) {
      state = "over";
      gameOver({ score: true });
    }
    return;
  }
  if (state !== "play") return;

  surge = Math.max(0, surge - dt);
  for (const k in timers) timers[k] = Math.max(0, timers[k] - dt);
  for (const track of tracks) move(track, dt);
  if (tracks.every((t) => t.remaining === 0 && t.chain.length === 0)) {
    return cleared();
  }

  for (const track of tracks) {
    const lead = track.chain.at(-1)?.s ?? 0;
    if (lead >= track.L && !pending(track.chain)) return lose();
    if (lead > WARN * track.L && ent.game.totalTime - warned > 1) {
      warned = ent.game.totalTime;
      play.alarm();
    }
  }
}

export function init() {
  ent.reset([Track, Chain, Item, Shot, Frog]);
  charge = null;
  camera.scale = ZOOM;
  spin = 0;
  frog = { x: CX, y: CY + LOOP, u: Math.PI / 2, w: 0 };
  level = 0;
  warned = 0;
  reload = 0;
  nextLevel();
  // The opening chain is on the board at frame one, not still rolling in.
  for (let t = 0; t < 6 && tracks.some((k) => k.intro); t += 1 / 60) step(1 / 60);
  gun = [pick(), pick()];
  new Track();
  new Chain();
  new Frog();
}

export function update(dt) {
  swing(dt);
  step(dt);
  ent.update(dt);
}
