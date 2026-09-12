/*
 * metro - "You are a metro car". Ludum Dare 29, April 2014, written in about
 * ten hours.
 *
 * The map is a Voronoi diagram of a few hundred stations and every tunnel an
 * edge between two cells. Those pairs are the Delaunay dual, so `tunnels()`
 * computes the dual directly and never builds the diagram: Bowyer-Watson, a
 * couple of milliseconds, against a Fortune sweep for a picture nothing draws.
 *
 * Tunnels longer than LONG are dropped and only the largest connected piece is
 * kept: Delaunay joins two points whenever some empty circle passes through
 * both, and out past the edge of the cloud that circle can be enormous.
 *
 * Stations are data and not one entity each: 380 entities are 380 draws whether
 * on screen or not.
 */

import * as ent from "./lib/entity.js";
import { gameOver, score } from "./lib/one.js";
import { coin, explosion, hit } from "./lib/fsfx/sfxr.js";
import * as sound from "./lib/sound.js";

export const meta = {
  title: "metro",
  desc: `
you are a metro car
up drives, left and right switch
`,
  bg: "#FFFFFF",
  fg: "#1C140D",
  scoreMax: true,
  date: "2014-04-27",
};

const BLACK = 0x1c140d;
const WHITE = 0xffffff;
const GREEN = 0xcbe86b;
const LIGHTGREEN = 0xe2e9af;
const PURPLE = 0x936be8;
const RED = 0xd7364e;
const CLEAR = 0xf2e9e1;

const cssOf = (c) => `#${c.toString(16).padStart(6, "0")}`;
const TUNNEL = cssOf(CLEAR);
const DOT = cssOf(BLACK);
const HOLE = cssOf(WHITE);
const HERE = cssOf(LIGHTGREEN);
const AHEAD = cssOf(PURPLE);
const RINGS = [[8, DOT], [6, HOLE], [4, DOT]];

const TAU = 2 * Math.PI;

// The 480 box the game thinks in.
const W = 480;

// Four screens a side. Stations land no closer than GAP, and TRIES throws fill
// it with about 375.
const DIM = W * 4;
const GAP = 75;
const TRIES = 3000;
// Also how far off screen a station must be before none of its tunnels reach.
const LONG = 200;

// Half-turns a second, then units a second.
const TURN = 2;
const ACC = 200;
const ETURN = 1.5;
const EACC = 80;

const CAR = [-17, -8, 17, -8, 17, 8, -17, 8];

const DEATH = 0.5; // on top of the hitstop

const BAR = 270;
const OFF = 500;
const ON = 440;

sound.voice("reach", { ...coin(82), vol: 0.25 });
sound.voice("timeup", { ...explosion(4073), vol: 0.1 });
sound.voice("crash", { ...explosion(4005), vol: 0.25 });
sound.voice("station", { ...coin(112), vol: 0.15 });
sound.voice("switch", { ...hit(764), vol: 0.25 });

// In entity.js's 480 coordinates: follow() slides every station once a frame so
// the car stays in the middle, which is why nothing here needs a camera.
let stations = [];
let edges = [];
let train = null;
let mission = null;
let enemies = 0;

// Stations are thrown down at random and kept when nothing else is within GAP;
// tunnels() joins the pairs whose Voronoi cells share a wall.
function build() {
  // A cell is GAP across the diagonal, so it holds one station at most and
  // nothing two cells away can be too close.
  const cell = GAP / Math.SQRT2;
  const n = Math.ceil(DIM / cell);
  const grid = new Array(n * n).fill(null);
  const pts = [];

  for (let t = 0; t < TRIES; ++t) {
    const x = Math.floor(DIM * Math.random());
    const y = Math.floor(DIM * Math.random());
    const gx = Math.floor(x / cell);
    const gy = Math.floor(y / cell);
    let ok = true;
    for (let j = Math.max(0, gy - 2); ok && j <= Math.min(n - 1, gy + 2); ++j) {
      for (let i = Math.max(0, gx - 2); i <= Math.min(n - 1, gx + 2); ++i) {
        const p = grid[j * n + i];
        if (p === null) continue;
        if ((p.x - x) ** 2 + (p.y - y) ** 2 >= GAP * GAP) continue;
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const p = { x, y, conn: [] };
    grid[gy * n + gx] = p;
    pts.push(p);
  }

  // Centred on the origin, so follow() travels the same in any direction.
  for (const p of pts) {
    p.x -= DIM / 2;
    p.y -= DIM / 2;
  }

  for (const [a, b] of tunnels(pts)) {
    if (Math.hypot(a.x - b.x, a.y - b.y) > LONG) continue;
    a.conn.push(b);
    b.conn.push(a);
  }

  stations = largest(pts);
  edges = [];
  for (const s of stations) {
    // By heading, so left and right walk the exits round the station rather
    // than in the order Delaunay found them.
    s.conn.sort((a, b) =>
      Math.atan2(a.y - s.y, a.x - s.x) - Math.atan2(b.y - s.y, b.x - s.x)
    );
    for (const o of s.conn) {
      if (o.x < s.x || (o.x === s.x && o.y < s.y)) edges.push([s, o]);
    }
  }
}

// Bowyer-Watson: hold a triangulation, and for each new point drop the
// triangles whose circumcircle swallows it and fill the hole from its edges.
function tunnels(pts) {
  const n = pts.length;
  const far = DIM * 10;
  const p = pts.concat([
    { x: -far, y: -far },
    { x: far, y: -far },
    { x: 0, y: far },
  ]);

  let tris = [circum(p, n, n + 1, n + 2)];
  const hole = [];
  for (let i = 0; i < n; ++i) {
    hole.length = 0;
    const keep = [];
    for (const t of tris) {
      const dx = p[i].x - t.x;
      const dy = p[i].y - t.y;
      if (dx * dx + dy * dy > t.r2) {
        keep.push(t);
        continue;
      }
      hole.push(t.a, t.b, t.b, t.c, t.c, t.a);
    }
    tris = keep;

    // An edge two dropped triangles shared is inside the hole; what is left
    // once every pair cancels is its outline.
    for (let j = 0; j < hole.length; j += 2) {
      if (hole[j] < 0) continue;
      let solo = true;
      for (let k = j + 2; k < hole.length; k += 2) {
        if (hole[k] < 0) continue;
        const same = hole[j] === hole[k] && hole[j + 1] === hole[k + 1];
        const flip = hole[j] === hole[k + 1] && hole[j + 1] === hole[k];
        if (!same && !flip) continue;
        hole[k] = -1;
        solo = false;
      }
      if (!solo) {
        hole[j] = -1;
        continue;
      }
      const t = circum(p, hole[j], hole[j + 1], i);
      if (t !== null) tris.push(t);
    }
  }

  const out = [];
  const seen = new Set();
  for (const t of tris) {
    for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) {
      if (u >= n || v >= n) continue;
      const key = u < v ? u * n + v : v * n + u;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([pts[u], pts[v]]);
    }
  }
  return out;
}

function circum(p, a, b, c) {
  const ax = p[a].x;
  const ay = p[a].y;
  const bx = p[b].x - ax;
  const by = p[b].y - ay;
  const cx = p[c].x - ax;
  const cy = p[c].y - ay;
  const d = 2 * (bx * cy - by * cx);
  if (d === 0) return null;
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  const ux = (cy * b2 - by * c2) / d;
  const uy = (bx * c2 - cx * b2) / d;
  return { a, b, c, x: ax + ux, y: ay + uy, r2: ux * ux + uy * uy };
}

// Dropping the long tunnels can strand a station, and a mission that picks one
// never ends.
function largest(pts) {
  const seen = new Set();
  let best = [];
  for (const start of pts) {
    if (seen.has(start)) continue;
    seen.add(start);
    const part = [start];
    for (let i = 0; i < part.length; ++i) {
      for (const o of part[i].conn) {
        if (seen.has(o)) continue;
        seen.add(o);
        part.push(o);
      }
    }
    if (part.length > best.length) best = part;
  }
  return best;
}

// A marker you can already see is no mission, and a car appearing in front of
// you is no fun.
function offscreen() {
  let pick = null;
  let n = 1;
  for (const s of stations) {
    if (s.x >= 0 && s.x < W && s.y >= 0 && s.y < W) continue;
    if (pick === null || Math.random() < 1 / n) pick = s;
    n += 1;
  }
  return pick ?? stations[Math.floor(Math.random() * stations.length)];
}

// Before the frame and not after, so everything reading a station's position
// reads the one it is about to be drawn at.
function follow() {
  const dx = train.pos.x - W / 2;
  const dy = train.pos.y - W / 2;
  if (dx === 0 && dy === 0) return;
  for (const s of stations) {
    s.x -= dx;
    s.y -= dy;
  }
  train.pos.x -= dx;
  train.pos.y -= dy;
  for (const e of ent.get(Enemy)) {
    e.pos.x -= dx;
    e.pos.y -= dy;
  }
}

// One entity, parked at the origin and never moved, so its own coordinates are
// the screen's.
class Grid extends ent.Entity {
  render(ctx) {
    ctx.lineCap = "round";
    ctx.lineWidth = 6;
    ctx.strokeStyle = TUNNEL;
    ctx.beginPath();
    for (const [a, b] of edges) {
      if (Math.max(a.x, b.x) < 0 || Math.min(a.x, b.x) > W) continue;
      if (Math.max(a.y, b.y) < 0 || Math.min(a.y, b.y) > W) continue;
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();

    ctx.lineWidth = 8;
    stub(ctx, HERE, train.from, train.to);
    stub(ctx, AHEAD, train.to, train.next);

    const near = stations.filter((s) =>
      s.x > -8 && s.x < W + 8 && s.y > -8 && s.y < W + 8
    );
    for (const [r, c] of RINGS) {
      ctx.fillStyle = c;
      ctx.beginPath();
      for (const s of near) {
        ctx.moveTo(s.x + r, s.y);
        ctx.arc(s.x, s.y, r, 0, TAU);
      }
      ctx.fill();
    }
  }
}

function stub(ctx, color, a, b) {
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

// It turns towards the station ahead and only drives once it is pointing
// there, which is what makes a junction cost time.
class Train extends ent.Entity {
  constructor(at) {
    super();
    this.from = at;
    this.to = at.conn[Math.floor(Math.random() * at.conn.length)];
    this.pos.x = at.x;
    this.pos.y = at.y;
    this.angle = Math.atan2(this.to.y - at.y, this.to.x - at.x);
    this.selection = 0;
    this.next = null;
    this.dying = 0;
    this.gfx.fill(GREEN).rect(0, 0, 34, 16);
    this.hitPoly(CAR);
    this.aim();
  }

  update() {
    const { key, time } = ent.game;

    if (this.dying > 0) {
      this.dying -= time;
      if (this.dying <= 0) gameOver({ score: true });
      return;
    }

    const dx = this.to.x - this.pos.x;
    const dy = this.to.y - this.pos.y;
    const full = Math.hypot(dx, dy);
    const aligned = turn(this, dx, dy, TURN);

    if (key.just.left) {
      sound.play("switch");
      this.select(this.selection - 1);
    }
    if (key.just.right) {
      sound.play("switch");
      this.select(this.selection + 1);
    }

    if (!aligned) return;

    if (key.up || key.b1) {
      const step = Math.min(full, ACC * time);
      if (step >= full) return this.arrive();
      this.pos.x += dx / full * step;
      this.pos.y += dy / full * step;
      return;
    }

    if (!key.down || full === 0) return;
    // No further back than the station behind.
    const ux = dx / full;
    const uy = dy / full;
    const back = ux * (this.pos.x - this.from.x) + uy * (this.pos.y - this.from.y);
    const step = Math.min(Math.max(0, back), ACC / 2 * time);
    this.pos.x -= ux * step;
    this.pos.y -= uy * step;
  }

  postUpdate() {
    if (this.dying > 0) return;
    if (this.hitGroup(Enemy) !== null) this.die();
  }

  arrive() {
    this.pos.x = this.to.x;
    this.pos.y = this.to.y;
    sound.play("station");
    mission?.reach(this.to);
    this.from = this.to;
    this.to = this.next;
    this.aim();
  }

  // The tunnel out of the next station closest in heading to the one in.
  aim() {
    const cur = Math.atan2(this.to.y - this.from.y, this.to.x - this.from.x);
    let best = 0;
    let close = Infinity;
    this.to.conn.forEach((s, i) => {
      const d = Math.abs(wrap(Math.atan2(s.y - this.to.y, s.x - this.to.x) - cur));
      if (d >= close) return;
      close = d;
      best = i;
    });
    this.select(best);
  }

  select(i) {
    const n = this.to.conn.length;
    this.selection = (i % n + n) % n;
    this.next = this.to.conn[this.selection];
  }

  die() {
    sound.play("crash");
    this.clearHits();
    this.gfx.clear();
    this.dying = DEATH;
    ent.shake(1);
    ent.delay(0.15);
    new ent.Particle({
      x: this.pos.x,
      y: this.pos.y,
      color: GREEN,
      count: 200,
      size: 6,
      speed: [30, 70],
      spread: 10,
      duration: 1,
    });
  }
}

/*
 * Another car, driving the same map with nobody in it. At a station it takes
 * any tunnel but the one it came in by, and it never stops.
 */
class Enemy extends ent.Entity {
  constructor(at) {
    super();
    this.from = at;
    this.to = at.conn[Math.floor(Math.random() * at.conn.length)];
    this.pos.x = at.x;
    this.pos.y = at.y;
    this.angle = Math.atan2(this.to.y - at.y, this.to.x - at.x);
    this.gfx.fill(BLACK).line(2, BLACK).rect(0, 0, 34, 16);
    this.hitPoly(CAR);
  }

  update() {
    const dx = this.to.x - this.pos.x;
    const dy = this.to.y - this.pos.y;
    const full = Math.hypot(dx, dy);
    const aligned = turn(this, dx, dy, ETURN);
    if (!aligned) return;

    const step = Math.min(full, EACC * ent.game.time);
    if (step >= full) return this.pick();
    this.pos.x += dx / full * step;
    this.pos.y += dy / full * step;
  }

  pick() {
    this.pos.x = this.to.x;
    this.pos.y = this.to.y;
    const old = this.from;
    this.from = this.to;

    let go = null;
    let n = 1;
    for (const s of this.from.conn) {
      if (go === null || go === old || Math.random() < 1 / n) go = s;
      n += 1;
    }
    this.to = go;
  }
}

/*
 * The red bar along the bottom: a station to reach, a pie counting down, and
 * the running commentary. Reaching one adds to the same clock and raises the
 * combo, and the next one is worth more and allowed a good deal less time, so
 * a chain ends by itself.
 */
class Mission extends ent.Entity {
  constructor() {
    super();
    this.pos.x = W / 2;
    this.pos.y = OFF;
    this.marker = null;
    this.station = null;
    this.combo = 0;
    this.msg = "Get to the station!";
    // Counts the outro down from 3, below zero while the mission is live.
    this.end = -1;
    this.time = this.point() / 20;
  }

  point() {
    this.marker?.remove();
    this.station = offscreen();
    this.marker = new Target(this.station);
    return Math.hypot(
      this.station.x - train.pos.x,
      this.station.y - train.pos.y,
    );
  }

  reach(s) {
    if (s !== this.station) return;
    sound.play("reach");
    ent.shake(0.1);
    this.combo += 1;
    score.value += 10 * this.combo * Math.sqrt(enemies) / 5;
    this.msg = this.combo === 1
      ? "Go to the next one!"
      : `Combo x${this.combo}! Next!`;
    this.time += this.point() / (20 + 30 * this.combo);
  }

  finish() {
    this.marker?.remove();
    if (this.end >= 0) return;
    sound.play("timeup");
    this.end = 3;
    mission = null;
    this.msg = this.combo <= 1 ? "nope" : `Final combo x${this.combo}!`;
  }

  update() {
    const dt = ent.game.time;
    this.gfx.clear().fill(RED).rect(0, 0, BAR, 30)
      .text(120, 15, this.msg, WHITE, 2);

    if (this.end >= 0) {
      this.end -= dt / 0.5;
      this.pos.y = ON + (OFF - ON) * cubicOut(1 - Math.min(1, this.end));
      if (this.end <= 0) {
        this.remove();
        newMission(10);
        return;
      }
      this.age -= dt;
    }
    if (this.age < 0.5) {
      this.pos.y = OFF - (OFF - ON) * cubicIn(this.age / 0.5);
    }

    const swept = TAU * this.age / this.time;
    if (swept >= TAU) return this.finish();
    this.gfx.fill(WHITE).arc(BAR - 15, 15, 10, 0, swept, TAU);
  }
}

/*
 * What marks the station a mission wants: a bullseye while it is on screen, an
 * arrow pinned to the edge pointing at it while it is not.
 */
class Target extends ent.Entity {
  constructor(station) {
    super();
    this.station = station;
  }

  update() {
    const { x, y } = this.station;
    this.pos.x = x;
    this.pos.y = y;

    if (x >= 0 && x < W && y >= 0 && y < W) {
      this.angle = 0;
      this.gfx.cache(0).fill(RED).circle(0, 0, 8)
        .fill(WHITE).circle(0, 0, 6)
        .fill(RED).circle(0, 0, 4);
      return;
    }

    this.gfx.cache(1).fill(RED).mt(0, 0).lt(15, 7.5).lt(0, 15).lt(0, 0);
    this.angle = Math.atan2(y - W / 2, x - W / 2);
    this.pos.x = Math.max(10, Math.min(W - 10, x));
    this.pos.y = Math.max(10, Math.min(W - 10, y));
  }
}

// Turn `e` towards (dx, dy) at most `rate` half-turns a second, answering
// whether it now points there. A car drives on the frames where the turn came
// to nothing, which is how it pivots at a junction first.
function turn(e, dx, dy, rate) {
  const d = wrap(Math.atan2(dy, dx) - e.angle);
  const step = Math.PI * rate * ent.game.time;
  const da = Math.max(-step, Math.min(step, d));
  e.angle += da;
  return Math.abs(da) < Math.PI / 64 * ent.game.time;
}

function wrap(a) {
  const d = a % TAU;
  if (d > Math.PI) return d - TAU;
  if (d < -Math.PI) return d + TAU;
  return d;
}

const cubicIn = (t) => t ** 3;
const cubicOut = (t) => 1 - (1 - t) ** 3;

function newMission(delay) {
  ent.after(delay, () => {
    mission = new Mission();
  });
}

export function init() {
  ent.reset([Grid, Enemy, Train, ent.Particle, Target, Mission]);

  build();
  new Grid();

  let start = stations[0];
  for (const s of stations) {
    if (Math.hypot(s.x, s.y) < Math.hypot(start.x, start.y)) start = s;
  }
  train = new Train(start);
  follow();

  mission = null;
  enemies = 0;
  newMission(5);
}

export function update(dt) {
  follow();
  ent.update(dt);
  if (train.dying > 0) return;

  // Steep at the start, flat later, and none of them ever leaves. Everything
  // else about the round is flat, so this is the whole difficulty.
  const want = 5 * Math.sqrt(ent.game.totalTime);
  while (enemies < want) {
    new Enemy(offscreen());
    enemies += 1;
  }

  score.value += dt * Math.sqrt(enemies) / 50;
}

export { render } from "./lib/entity.js";
