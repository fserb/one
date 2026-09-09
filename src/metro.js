/*
 * metro - a port of ~/prj/vault/games/sketch/src/LD29.hx, "You are a metro
 * car". Ludum Dare 29, April 2014; the theme was Beneath the Surface, and the
 * whole thing was written in about ten hours.
 *
 * You drive one car. Up runs it forward, down backs it up, and left and right
 * pick which tunnel it leaves by when it reaches the station ahead - the
 * purple stub is the one it will take. A red marker names a station and a pie
 * drains; reach it and the next marker comes with a shorter pie and a longer
 * combo. The other cars on the map are driving too, and touching one ends the
 * round.
 *
 * The map is a Voronoi diagram of a few hundred stations, and every tunnel is
 * an edge between two cells. Those pairs are the Delaunay dual of the diagram,
 * so `tunnels()` below computes the dual directly and never builds the
 * diagram it came from: Bowyer-Watson, a couple of milliseconds for the whole
 * map, against a Fortune sweep for a picture nothing draws.
 *
 * What changed from the Haxe:
 *
 * - The car started standing on its own target: `pos` was set to the station
 *   it was driving to. A zero heading vector reads as an angle of zero, so the
 *   round opened by pivoting east for no reason and then "arriving" at the
 *   station it had never left, which ate the first tunnel of the route. It
 *   starts at `from` now, pointed at `to`.
 * - The route was a queue of `Selection` entities pushed and popped one deep,
 *   which is one station of lookahead written as a list. It is `from`, `to`
 *   and `next` here, and the two coloured stubs are drawn by the map.
 * - Stations are data rather than one entity each. 380 entities are 380 draws
 *   whether they are on screen or not; one entity that culls to the screen
 *   draws the twenty that are.
 * - Tunnels longer than LONG are dropped, and only the largest connected piece
 *   of what is left is kept. Delaunay joins two points whenever some empty
 *   circle passes through both, and out past the edge of the cloud that circle
 *   can be enormous, so two stations a thousand units apart along the border
 *   come out joined by one straight tunnel with nothing on it. The Haxe was
 *   spared them by the diagram it read its pairs off: the wall between two
 *   cells like that sits at the centre of that enormous circle, far outside
 *   the box the diagram was clipped to, so clipping dropped the wall and the
 *   pair with it.
 * - The car opens on the station nearest the middle of the map. `Game.one` gave
 *   it the first station generated, which is a uniform random point, so a third
 *   of rounds began against the edge of the map. The map has an edge either
 *   way: the tunnels stop, and the last stations connect only back inwards.
 * - b1 drives as well as up, so the game plays from a held finger. Backing up
 *   and switching still want a keyboard.
 * - The `Scorer` box and the `Message` that slid "you are a metro car" across
 *   the bottom are the shell's score bar and `meta.desc`.
 * - A car collides as the 34x16 box it is drawn as. A car spends most of its
 *   time diagonal, and hitPoly() is the shape that turns with `angle`.
 */

import * as ent from "./lib/entity.js";
import "./lib/gfx.js";
import { gameOver, score } from "./lib/one.js";
import * as sfxr from "./lib/sfxr.js";
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
  finishGood: false,
  date: "2014-04-27",
};

const BLACK = 0x1c140d;
const WHITE = 0xffffff;
const GREEN = 0xcbe86b;
const LIGHTGREEN = 0xe2e9af;
const PURPLE = 0x936be8;
const RED = 0xd7364e;
const CLEAR = 0xf2e9e1;

// The map paints onto the context rather than through Gfx, so it wants the
// same colours as CSS.
const cssOf = (c) => `#${c.toString(16).padStart(6, "0")}`;
const TUNNEL = cssOf(CLEAR);
const DOT = cssOf(BLACK);
const HOLE = cssOf(WHITE);
const HERE = cssOf(LIGHTGREEN);
const AHEAD = cssOf(PURPLE);
// A station is a black ring around a white ring around a black dot.
const RINGS = [[8, DOT], [6, HOLE], [4, DOT]];

const TAU = 2 * Math.PI;

// The box the game thinks in, and the strip of it the shell's 44px bar covers.
const W = 480;
const TOP = 21;

// The map is four screens on a side. Stations land no closer to each other
// than GAP; TRIES throws are enough to fill it, and land about 375.
const DIM = W * 4;
const GAP = 75;
const TRIES = 3000;
// No tunnel is longer than this, which is also how far off screen a station
// has to be before none of its tunnels can cross it.
const LONG = 200;

// Half-turns a second, and units a second. Reverse is half of forward.
const TURN = 2;
const ACC = 200;
const ETURN = 1.5;
const EACC = 80;

// The car, as the four corners of the 34x16 box it is drawn as.
const CAR = [-17, -8, 17, -8, 17, 8, -17, 8];

// Seconds from the crash to the freeze-frame, on top of the hitstop.
const DEATH = 0.5;

// The mission bar: its width, and where it sits parked and shown.
const BAR = 270;
const OFF = 500;
const ON = 440;

// ugl's Sound.vol(v) set masterVolume to 2v, and sfxr squares that. The two
// that play on every station and every switch are turned down from there.
voice("reach", sfxr.coin(82), 0.25);
voice("timeup", sfxr.explosion(4073), 0.1);
voice("crash", sfxr.explosion(4005), 0.25);
voice("station", sfxr.coin(112), 0.15);
voice("switch", sfxr.hit(764), 0.25);

function voice(name, params, vol) {
  params.masterVolume = 2 * vol;
  sound.put(name, sfxr.render(params), sfxr.SAMPLE_RATE);
}

// The map, in the shell's own 480 coordinates: follow() slides every station
// once a frame so the car sits in the middle of the screen, which is what the
// Haxe did and is why nothing here needs a camera.
let stations = [];
let edges = [];
let train = null;
let mission = null;
let enemies = 0;

/*
 * The map.
 *
 * Stations are thrown down at random and kept when nothing else is within GAP,
 * which is the Haxe's sampler; tunnels() joins the pairs whose Voronoi cells
 * share a wall.
 */
function build() {
  // A cell is GAP across the diagonal, so it holds one station at the most and
  // nothing more than two cells away can be too close. The Haxe measured every
  // throw against every station it had, and took a square root doing it.
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

  // Centred on the origin, so follow() has the same distance to travel in
  // every direction whichever station the round opens on.
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
    // Sorted by heading, so left and right walk the exits of a station round
    // it rather than in the order Delaunay happened to find them.
    s.conn.sort((a, b) =>
      Math.atan2(a.y - s.y, a.x - s.x) - Math.atan2(b.y - s.y, b.x - s.x)
    );
    for (const o of s.conn) {
      if (o.x < s.x || (o.x === s.x && o.y < s.y)) edges.push([s, o]);
    }
  }
}

// Every point joined to every other whose Voronoi cell it shares a wall with,
// by Bowyer-Watson: hold a triangulation, and for each new point throw away
// the triangles whose circumcircle swallows it and fill the hole from its
// edges. The three corners of the enclosing triangle come off at the end.
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

    // An edge two dropped triangles shared is inside the hole. The ones left
    // over once every pair has cancelled are its outline.
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

// A triangle and its circumcircle, or null when the three are in a line.
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

// Delaunay is one connected graph, but dropping the long tunnels can leave a
// station stranded, and a mission that picks one no car can reach never ends.
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

// A station off screen, each equally likely. Missions and enemies both want
// one: a marker you can already see is no mission, and a car that appears in
// front of you is no fun.
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

// Slide the world so the car sits in the middle of the screen. Runs before the
// frame rather than after it, so that everything reading a station's position
// this frame reads the one it is about to be drawn at.
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

/*
 * The map, drawn. One entity, parked at the origin and never moved, so its own
 * coordinates are the screen's.
 */
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

    // The tunnel the car is on, and the one it will leave the next station by.
    // Under the stations, as ugl layered them.
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

/*
 * The car. It turns towards the station ahead and only drives once it is
 * pointing there, which is what makes a junction cost time.
 */
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
      if (this.dying <= 0) gameOver();
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

    // b1 carries the click, so a held finger drives.
    if (key.up || key.b1) {
      const step = Math.min(full, ACC * time);
      if (step >= full) return this.arrive();
      this.pos.x += dx / full * step;
      this.pos.y += dy / full * step;
      return;
    }

    if (!key.down || full === 0) return;
    // Back up, but no further than the station behind: how far there is to go
    // back is what has already been travelled, along the way the car is facing.
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

  // The straightest way on: of the tunnels out of the station ahead, the one
  // closest in heading to the one the car is arriving by.
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
    new ent.Particle()
      .color(GREEN)
      .xy(this.pos.x, this.pos.y)
      .spread(10)
      .count(200)
      .size(6)
      .speed(30, 70)
      .duration(1);
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
    // Counts the outro down from 3 once the clock has run out. Below zero
    // while the mission is live.
    this.end = -1;
    this.time = this.point() / 20;
  }

  // Aim the marker at a fresh station, and say how far off it is.
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
      // A second of the closing line, then half a second sliding out.
      this.end -= dt / 0.5;
      this.pos.y = ON + (OFF - ON) * cubicOut(1 - Math.min(1, this.end));
      if (this.end <= 0) {
        this.remove();
        newMission(10);
        return;
      }
      // Hold the clock where it stopped, so the pie stays put underneath.
      this.ticks -= dt;
    }
    if (this.ticks < 0.5) {
      this.pos.y = OFF - (OFF - ON) * cubicIn(this.ticks / 0.5);
    }

    const swept = TAU * this.ticks / this.time;
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
    // Aimed from where the station is, then pinned to where it can be seen.
    this.angle = Math.atan2(y - W / 2, x - W / 2);
    this.pos.x = Math.max(10, Math.min(W - 10, x));
    this.pos.y = Math.max(TOP + 10, Math.min(W - 10, y));
  }
}

// Turn `e` towards (dx, dy), at most `rate` half-turns a second, and say
// whether it is now pointing there. A car drives on the frames where the turn
// it just made came to nothing, which is how it pivots at a junction first.
function turn(e, dx, dy, rate) {
  const d = wrap(Math.atan2(dy, dx) - e.angle);
  const step = Math.PI * rate * ent.game.time;
  const da = Math.max(-step, Math.min(step, d));
  e.angle += da;
  return Math.abs(da) < Math.PI / 64 * ent.game.time;
}

// An angle folded into (-PI, PI].
function wrap(a) {
  const d = a % TAU;
  if (d > Math.PI) return d - TAU;
  if (d < -Math.PI) return d + TAU;
  return d;
}

const cubicIn = (t) => t ** 3;
const cubicOut = (t) => 1 - (1 - t) ** 3;

function newMission(delay) {
  new ent.Timer().delay(delay).run(() => {
    mission = new Mission();
    return true;
  });
}

export function init() {
  ent.reset();
  ent.world(W);
  ent.order([Grid, Enemy, Train, ent.Particle, Target, Mission]);

  build();
  new Grid();

  // The middle of the map, so a round does not open against its edge.
  let start = stations[0];
  for (const s of stations) {
    if (Math.hypot(s.x, s.y) < Math.hypot(start.x, start.y)) start = s;
  }
  train = new Train(start);
  follow();

  mission = null;
  enemies = 0;
  // Long enough to read the hint and find out what the controls do.
  newMission(5);
}

export function update(dt) {
  follow();
  ent.update(dt);
  if (train.dying > 0) return;

  // Cars arrive on a curve that is steep at the start and flat later, and none
  // of them ever leaves. Everything else about the round is flat, so this is
  // the whole of the difficulty.
  const want = 5 * Math.sqrt(ent.game.totalTime);
  while (enemies < want) {
    new Enemy(offscreen());
    enemies += 1;
  }

  // Staying alive pays, and pays more the busier the map has become.
  score.value += dt * Math.sqrt(enemies) / 50;
}

export function render(ctx) {
  ent.render(ctx);
}
