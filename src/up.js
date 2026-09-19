/*
 * up. Based on Aba Games' WASD THRUST.
 *
 * Four thrusters, one an arrow key, each pushing the ship away from itself: the
 * one on top drives you down.
 *
 * No camera: the world moves and the view does not, so the ship stays at a
 * fixed 512 across and never above 425. The field is a grid of world cells,
 * each filled once as the view nears it.
 */

import * as ent from "./lib/entity.js";
import { gameOver, ramp, score } from "./lib/one.js";
import { theme } from "./lib/overlay.js";
import * as play from "./lib/sounds.js";

export { render } from "./lib/entity.js";

export const meta = {
  title: "up",
  desc: `
arrows fire the thruster on that side
which pushes you off it
`,
  bg: "#EDE4D0",
  fg: "#33302B",
  scoreMax: true,
  date: "2014-03-30",
  release: true,
  dpad: true,
};

// Off the bottom: the ship dies here, an obstacle scores here.
const OUT = 1070;

const SHIP = 0x2f6b4f;
const ROCK = 0xc33c2a;
const GOLD = 0xf0a81e;
const FLAME = 0x3a4a52;

function cross(gfx, arm, half, color) {
  gfx.fill(color)
    .rect(-arm, -half, 2 * arm, 2 * half)
    .rect(-half, -arm, 2 * half, 2 * arm);
}

let player = null;
// The screen's top left in world space, and what the cells are counted off.
let camX = 0;
let camY = 0;
// The cells already filled, one "cx,cy" each.
const filled = new Set();
let passAt = 0;
let burnAt = 0;

// The exhaust is what moves the ship, so firing pushes along `offset` reversed.
class Engine extends ent.Entity {
  constructor(ship, offset, label) {
    super();
    this.ship = ship;
    this.offset = offset;
    this.label = label;
    this.firing = false;
    this.gfx.fill(FLAME).rect(-19.5, -19.5, 39, 39, 12);
  }

  update() {
    const a = this.offset + this.ship.angle;
    this.pos.x = this.ship.pos.x + Math.cos(a) * 64;
    this.pos.y = this.ship.pos.y + Math.sin(a) * 64;
    this.angle = this.ship.angle;
  }

  fire() {
    // Thrust over drag is the top speed: 530 against Player.update()'s drag
    // gives 265, over the 105 a second slide and under outrunning the view.
    this.ship.thrust(530, this.offset + Math.PI);
    new ent.Particle({
      x: this.pos.x,
      y: this.pos.y,
      color: FLAME,
      count: [1, 2],
      size: [11, 11],
      speed: [530, 210],
      direction: [this.angle + this.offset - Math.PI / 8, Math.PI / 4],
      delay: [0, 0.05],
      duration: [0.25, 0.1],
    });

    this.firing = true;
  }

  render(ctx) {
    this.gfx.render(ctx);
    ctx.fillStyle = ent.css(0xede4d0);
    ctx.text(this.label, 0, 0, 34);
  }
}

class Player extends ent.Entity {
  constructor() {
    super();
    cross(this.gfx, 84, 21, SHIP);
    // Two polygons and not two boxes: entity.js only turns a polygon.
    this.hitPoly([-84, -21, 84, -21, 84, 21, -84, 21]);
    this.hitPoly([-21, -84, 21, -84, 21, 84, -21, 84]);
    this.engines = ["D", "W", "A", "S"].map((label, i) =>
      new Engine(this, -i * Math.PI / 2, label)
    );
  }

  thrust(force, a) {
    this.accelerate(
      force * Math.cos(this.angle + a),
      force * Math.sin(this.angle + a),
    );
  }

  update() {
    const { input, time } = ent.game;
    if (input.press.right) this.engines[0].fire();
    if (input.press.up) this.engines[1].fire();
    if (input.press.left) this.engines[2].fire();
    if (input.press.down) this.engines[3].fire();

    this.accelerate(-2 * this.vel.x, -2 * this.vel.y);
    this.angle += time * this.vel.x / 425;

    if (this.pos.y > OUT) this.kill();
  }

  kill() {
    play.explode({ detune: -200 });
    new ent.Particle({
      x: this.pos.x,
      y: this.pos.y,
      color: SHIP,
      count: 100,
      size: [11, 53],
      speed: [425, 425],
      duration: [2, 0.5],
    });
    for (const e of this.engines) e.remove();
    this.remove();
    ent.after(0.5, () => gameOver({ score: true }));
  }
}

class Obstacle extends ent.Entity {
  constructor(x, y) {
    super();
    this.xy(x, y);
    cross(this.gfx, 30, 7.5, ROCK);
    this.angle = 2 * Math.PI * Math.random();
    this.hitBox(60);
  }

  update() {
    if (this.hit(player)) {
      play.hit({ volume: 0.4, detune: -100 });
      player.kill();
      this.remove();
      return;
    }

    if (this.pos.y < OUT) return;
    if (this.pos.x >= 0 && this.pos.x <= 1024) {
      const at = Math.min(Math.max(this.pos.x, 20), 1004);
      ent.addScore(5, at, 1024, { color: ROCK });
      if (ent.game.totalTime >= passAt) {
        passAt = ent.game.totalTime + 0.18;
        play.select({ volume: 0.12, detune: 80 * (2 * Math.random() - 1) });
      }
    }
    this.remove();
  }
}

class Gold extends ent.Entity {
  constructor(x, y) {
    super();
    this.xy(x, y);
    this.points = Math.round(1 + Math.random() * 8) * 10;
    this.gfx.fill(GOLD).line(6, 0xb3690f).rect(-21, -18, 42, 36, 10);
    this.hitBox(48, 42);
  }

  update() {
    if (this.hit(player)) {
      ent.addScore(this.points, this.pos.x, this.pos.y, { color: GOLD });
      play.coin({ detune: (this.points - 50) * 6 });
      this.remove();
      return;
    }

    if (this.pos.y >= OUT) this.remove();
  }

  render(ctx) {
    this.gfx.render(ctx);
    ctx.fillStyle = ent.css(0x3a2206);
    ctx.text(String(this.points), 0, 0, 19);
  }
}

const BANDS = [[0, 110], [300, 52], [620, 190], [980, 70], [1210, 128]];
const BAND_SPAN = 1500;

class Bands extends ent.Entity {
  render(ctx) {
    ctx.fillStyle = ent.css(0xdfd2b7);
    const off = -camY * 0.3 % BAND_SPAN;

    for (const [y, h] of BANDS) {
      const at = (y + off) % BAND_SPAN;
      ctx.fillRect(0, at, 1024, h);
      ctx.fillRect(0, at - BAND_SPAN, 1024, h);
    }
  }
}

class Readout extends ent.Text {
  update() {
    this.text = String(Math.floor(score.value));
  }
}

const CELL = 300;
const MARGIN = 600;

// Every cell within MARGIN of the screen, and a screen above it, filled once.
// The view wanders left and right, so this is a set of cells and not a line.
function fill() {
  const x0 = Math.floor((camX - MARGIN) / CELL);
  const x1 = Math.floor((camX + 1024 + MARGIN) / CELL);
  const y0 = Math.floor((camY - 1024 - MARGIN) / CELL);
  const y1 = Math.floor((camY + 1024) / CELL);
  // Pieces a cell: half of one at the start, two one ramp on. The fraction is
  // the share of cells that take one more.
  const n = 0.5 + (ramp() - 1) * 1.5;

  for (let cy = y0; cy <= y1; cy++) {
    for (let cx = x0; cx <= x1; cx++) {
      const key = `${cx},${cy}`;
      if (filled.has(key)) continue;
      filled.add(key);
      deal(cx, cy, Math.floor(n) + (Math.random() < n % 1 ? 1 : 0));
    }
  }
}

// `k` pieces into cell `cx, cy`, one to a box off an `m` by `m` split, so a cell
// holding two does not hold them in one spot. Drawn without replacement.
function deal(cx, cy, k) {
  const m = Math.ceil(Math.sqrt(k));
  // 75 off each edge, split m ways, so a piece never lands against an edge.
  const span = (CELL - 150) / m;
  const box = (c, i) => (c + i / m) * CELL + 75 / m + span * Math.random();
  let left = k;

  for (let s = 0; s < m * m; s++) {
    if (Math.random() * (m * m - s) >= left) continue;
    left -= 1;

    const x = box(cx, s % m) - camX;
    const y = box(cy, Math.floor(s / m)) - camY;
    // The opening fill covers the screen the ship starts on, so keep the 220
    // around it clear.
    if (Math.hypot(x - player.pos.x, y - player.pos.y) < 220) continue;

    if (Math.random() < 0.09) new Gold(x, y);
    else new Obstacle(x, y);
  }
}

// One whoosh every 0.07s however many engines fired. x pans and y pitches, so
// the left flame is heard on the left and the top engine has the highest pitch.
function burn() {
  let n = 0;
  let x = 0;
  let y = 0;
  for (const e of player.engines) {
    if (!e.firing) continue;
    e.firing = false;
    const a = e.offset + player.angle;
    n += 1;
    x += Math.cos(a);
    y += Math.sin(a);
  }
  if (n === 0 || ent.game.totalTime < burnAt) return;

  burnAt = ent.game.totalTime + 0.07;
  play.whoosh({
    volume: 0.055 + 0.028 * n,
    pan: 0.6 * x / n,
    detune: -900 - 150 * y / n + 60 * (2 * Math.random() - 1),
  });
}

export function init() {
  ent.reset([Bands, Obstacle, Gold, ent.Particle, Player, Engine, Readout]);

  new Bands();
  new Readout({
    x: 26,
    y: 26,
    size: 34,
    align: "left top",
    color: ent.hex(theme(meta)),
  });
  player = new Player();
  player.pos.x = player.pos.y = 512;
  camX = 0;
  camY = 0;
  passAt = 0;
  burnAt = 0;
  filled.clear();
  fill();
}

export function update(dt) {
  // The view stops climbing and nothing more is dealt; kill()'s timer ends the
  // round.
  if (player.dead) return ent.update(dt);

  // The slide is 105 a second; climbing faster only moves the ship up to 425.
  const dx = 512 - player.pos.x;
  const dy = Math.max(105 * dt, 425 - player.pos.y);
  player.pos.x += dx;
  player.pos.y += dy;
  camX -= dx;
  camY -= dy;

  let near = 0;
  for (const cls of [Obstacle, Gold]) {
    for (const e of ent.get(cls)) {
      e.pos.x += dx;
      e.pos.y += dy;
      if (e.pos.x < 0 || e.pos.x > 1024) continue;
      if (e.pos.y < 0 || e.pos.y > 1024) continue;
      near += 1;
    }
  }

  fill();

  // Shown floored, so score.value holds the fraction.
  score.value += near * dt / 12;

  ent.update(dt);
  burn();
}
