/*
 * amaze.
 *
 * A maze, a key, a locked square, and one jump every three seconds through one
 * wall, so the maze is two mazes at once and the game is choosing which wall.
 *
 * The maze is a randomised Prim's from the middle, where the four ways out of a
 * new cell are tried in an order set by which direction the cell is from the
 * centre. That is what makes the corridors run around the centre rather than
 * towards it.
 *
 * The level change is on a timer rather than a key press, because a modal
 * mid-round is a moment where input does nothing. The jump is the tap and
 * walking is the hold, since one pointer has to do both.
 */

import * as ent from "./lib/entity.js";
import { glyphs } from "./lib/art.js";
import { gameOver, hint, input, score } from "./lib/one.js";
import { coin, explosion, jump, powerup } from "./lib/fsfx/sfxr.js";
import * as sound from "./lib/sound.js";

export const meta = {
  title: "amaze",
  desc: `
take the key, then the square it opens
tap to jump one wall, hold to walk
`,
  bg: "#3DBF86",
  fg: "#444444",
  scoreMax: true,
  date: "2014-04-02",
};

// 15 cells of 64 is 960, leaving a margin either side.
const N = 15;
const CELL = 64;
const MAZE = N * CELL;
const MX = (1024 - MAZE) / 2;
const MY = MX;
// Where the maze grows from, and where you start.
const MID = (N - 1) / 2;

const N_W = 1;
const E_W = 2;
const S_W = 4;
const W_W = 8;
const SIDES = [
  { bit: N_W, off: -N, back: S_W },
  { bit: E_W, off: 1, back: W_W },
  { bit: S_W, off: N, back: N_W },
  { bit: W_W, off: -1, back: E_W },
];

const LINE = 6;

// Cells a second.
const WALK = 4;
const PATROL = 2.5;
const CHASE = 5;
// How near the middle of a cell a turn takes, in cells.
const ALIGN = 0.1;
// Seconds to recharge, and how far into a move a release still cancels it.
const COOL = 3;
const BAIL = 0.94;
// A press let go inside this is a jump; held past it, it walks.
const TAP = 0.15;

const YOU_R = 16;
const YOU_BOX = 32;
const BOT_R = 12;
const BOT_BOX = 28;
const KEY_BOX = 20;
const GATE_BOX = 40;

// Still, then aiming, then charging. STILL is there because a bot walking
// inward otherwise catches a player who has had no time to be anywhere else.
const STILL = 1.5;
const AIM_AT = 2;
const CHASE_AT = 5;

const WIPE = 0.35;
const SHOW = 0.5;
const DEATH = 0.5;

const WALL = 0xeeeeee;
const DARK = 0x444444;
const YOU = 0xffffff;
const BOT = 0xc24079;
const BG = 0x3dbf86;

sound.voice("jump", { ...jump(4), vol: 0.1 });
sound.voice("key", { ...coin(12), vol: 0.13 });
sound.voice("gate", { ...powerup(3), vol: 0.13 });
sound.voice("dead", { ...explosion(2), vol: 0.2 });

// Four wall bits a cell.
const map = new Uint8Array(N * N);
const walls = [];

let player = null;
let gate = null;
let level = 0;
let dying = 0;
let phase = 0;
let phaseT = 0;
let wipeX = 0;
let wipeY = 0;
let pressed = 0;
let tapped = false;

const PLAY = 0;
const WIPE_OUT = 1;
const SHOWING = 2;
const WIPE_IN = 3;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const cx = (i) => MX + (i + 0.5) * CELL;
const cy = (j) => MY + (j + 0.5) * CELL;
const ci = (x) => Math.round((x - MX) / CELL - 0.5);
const cj = (y) => Math.round((y - MY) / CELL - 0.5);

/*
 * A randomised Prim's from the middle cell out. A cell still at 15, every wall
 * up, has not been reached; the frontier is every unreached cell next to a
 * reached one.
 *
 * The order is the part that matters. It depends on which direction the cell is
 * from the centre: the two perpendicular directions first, then away, then back
 * toward the middle, which runs the corridors around the centre rather than
 * radiating out of it.
 */
function generate() {
  map.fill(15);
  const border = [];

  const add = (p) => {
    const x = p % N;
    const y = (p - x) / N;
    if (x > 0 && map[p - 1] === 15) border.push(p - 1);
    if (x < N - 1 && map[p + 1] === 15) border.push(p + 1);
    if (y > 0 && map[p - N] === 15) border.push(p - N);
    if (y < N - 1 && map[p + N] === 15) border.push(p + N);
  };

  const home = MID + N * MID;
  map[home] = 0;
  add(home);

  while (border.length > 0) {
    const at = Math.floor(border.length * Math.random());
    const sel = border[at];
    border.splice(at, 1);
    if (map[sel] !== 15) continue;
    add(sel);

    const x = sel % N;
    const y = (sel - x) / N;
    const a = (Math.atan2(y - N / 2, x - N / 2) + 2 * Math.PI) % (2 * Math.PI);
    for (const o of order(a)) {
      if (!joined(sel, x, y, o)) continue;
      carve(sel, o);
      break;
    }
  }

  // Make the starting cell a crossroads.
  for (let o = 0; o < 4; ++o) {
    const x = home % N;
    const y = (home - x) / N;
    if (joined(home, x, y, o)) carve(home, o);
  }
  buildWalls();
}

// Perpendicular pair first, toward the middle last.
function order(a) {
  if (a < Math.PI / 4 || a >= 7 * Math.PI / 4) return [2, 0, 1, 3];
  if (a < 3 * Math.PI / 4) return [3, 1, 2, 0];
  if (a < 5 * Math.PI / 4) return [0, 2, 3, 1];
  return [1, 3, 0, 2];
}

function joined(p, x, y, o) {
  if (o === 0 && y === 0) return false;
  if (o === 1 && x === N - 1) return false;
  if (o === 2 && y === N - 1) return false;
  if (o === 3 && x === 0) return false;
  return map[p + SIDES[o].off] !== 15;
}

function carve(p, o) {
  const s = SIDES[o];
  map[p] &= ~s.bit & 15;
  map[p + s.off] &= ~s.back & 15;
}

function wall(i, j, bit) {
  if (i < 0 || j < 0 || i >= N || j >= N) return true;
  return (map[j * N + i] & bit) !== 0;
}

// Once a level, from both sides: a second copy of each, and no need to work out
// which side owns it.
function buildWalls() {
  walls.length = 0;
  for (let j = 0; j < N; ++j) {
    for (let i = 0; i < N; ++i) {
      const m = map[j * N + i];
      const x0 = MX + i * CELL;
      const y0 = MY + j * CELL;
      if (m & N_W) walls.push(x0, y0, x0 + CELL, y0);
      if (m & E_W) walls.push(x0 + CELL, y0, x0 + CELL, y0 + CELL);
      if (m & S_W) walls.push(x0, y0 + CELL, x0 + CELL, y0 + CELL);
      if (m & W_W) walls.push(x0, y0, x0, y0 + CELL);
    }
  }
}

class Player extends ent.Entity {
  constructor() {
    super();
    this.mx = MID;
    this.my = MID;
    this.tx = MID;
    this.ty = MID;
    this.pos.x = cx(MID);
    this.pos.y = cy(MID);
    this.facing = N_W;
    this.cool = 0;
    this.leaving = -1; // counts down from 1 while folding into the gate
    this.hitBox(YOU_BOX);
  }

  door() {
    if (this.leaving < 0) this.leaving = 1;
  }

  // Facing happens even when the step does not, which is how a jump is aimed.
  moveTo(d) {
    this.facing = d;
    this.angle = d === N_W
      ? 0
      : d === E_W
      ? Math.PI / 2
      : d === S_W
      ? Math.PI
      : 3 * Math.PI / 2;
    if (wall(this.mx, this.my, d)) return;
    this.stepTo(d);
  }

  stepTo(d) {
    const off = Math.abs(this.pos.x - cx(this.tx)) / CELL;
    const offy = Math.abs(this.pos.y - cy(this.ty)) / CELL;
    if (d === N_W && this.my > 0 && off < ALIGN) this.ty = this.my - 1;
    else if (d === E_W && this.mx < N - 1 && offy < ALIGN) this.tx = this.mx + 1;
    else if (d === S_W && this.my < N - 1 && off < ALIGN) this.ty = this.my + 1;
    else if (d === W_W && this.mx > 0 && offy < ALIGN) this.tx = this.mx - 1;
    else return false;
    return true;
  }

  // There has to be a wall: an open side is a walk, not a jump.
  jump() {
    if (this.cool > 0) return;
    if (!wall(this.mx, this.my, this.facing)) return;
    if (!this.stepTo(this.facing)) return;
    this.cool = 1;
    sound.play("jump");
  }

  update() {
    if (dying > 0) return;
    const t = ent.game.time;
    const { input } = ent.game;

    this.mx = clamp(ci(this.pos.x), 0, N - 1);
    this.my = clamp(cj(this.pos.y), 0, N - 1);

    if (this.leaving < 0) {
      if (tapped) this.jump();
      let d = 0;
      if (input.press.left) d = W_W;
      else if (input.press.right) d = E_W;
      else if (input.press.up) d = N_W;
      else if (input.press.down) d = S_W;
      // A side, not a place: the bigger of the two offsets wins.
      if (d === 0 && pressed > TAP) {
        const dx = input.x - this.pos.x;
        const dy = input.y - this.pos.y;
        if (Math.max(Math.abs(dx), Math.abs(dy)) > YOU_R) {
          d = Math.abs(dx) > Math.abs(dy)
            ? (dx > 0 ? E_W : W_W)
            : (dy > 0 ? S_W : N_W);
        }
      }
      if (d !== 0) this.moveTo(d);

      // Per axis, in two separate tests: without that, turning into a wall
      // mid-step leaves the old target moving you sideways indefinitely.
      const across = d === E_W || d === W_W;
      const along = d === N_W || d === S_W;
      if (
        !across && Math.abs(this.pos.x - cx(this.tx)) > BAIL * CELL
      ) this.tx = this.mx;
      if (
        !along && Math.abs(this.pos.y - cy(this.ty)) > BAIL * CELL
      ) this.ty = this.my;
    }

    const dx = cx(this.tx) - this.pos.x;
    const dy = cy(this.ty) - this.pos.y;
    const l = Math.hypot(dx, dy);
    const step = WALK * CELL * t;
    if (l <= step) {
      this.pos.x = cx(this.tx);
      this.pos.y = cy(this.ty);
    } else {
      this.pos.x += dx / l * step;
      this.pos.y += dy / l * step;
    }

    if (this.leaving >= 0) {
      this.leaving = Math.max(0, this.leaving - 2 * t);
      if (this.leaving === 0) leave();
      return;
    }
    this.cool = Math.max(0, this.cool - t / COOL);
  }

  // A circle with a rect of background over it. The flat rises as the jump
  // comes back, and is the only gauge there is.
  render(ctx) {
    const r = this.leaving >= 0 ? YOU_R * this.leaving : YOU_R;
    if (r <= 0) return;
    ctx.fillStyle = ent.css(YOU);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, 2 * Math.PI);
    ctx.fill();
    // 5 of 17 ready, 8 of 17 not.
    const cut = this.leaving >= 0 ? 0.29 : 0.29 + 0.18 * this.cool;
    if (cut <= 0) return;
    ctx.fillStyle = ent.css(BG);
    ctx.fillRect(-r, r - 2 * r * cut, 2 * r, 2 * r * cut);
  }
}

class Bot extends ent.Entity {
  constructor() {
    super();
    // Round the outside, as far from the middle as they go.
    const d = Math.floor(5 * Math.random());
    if (Math.random() < 0.5) {
      this.mx = Math.random() < 0.5 ? d : N - 1 - d;
      this.my = Math.floor(N * Math.random());
    } else {
      this.mx = Math.floor(N * Math.random());
      this.my = Math.random() < 0.5 ? d : N - 1 - d;
    }
    this.tx = this.mx;
    this.ty = this.my;
    this.evil = false;
    this.pos.x = cx(this.mx);
    this.pos.y = cy(this.my);
    this.hitBox(BOT_BOX);
  }

  update() {
    if (dying > 0 || phase !== PLAY) return;
    if (ent.game.totalTime < STILL) return;
    const t = ent.game.time;

    const dx = cx(this.mx) - this.pos.x;
    const dy = cy(this.my) - this.pos.y;
    const l = Math.hypot(dx, dy);
    const step = (this.evil ? CHASE : PATROL) * CELL * t;
    if (l >= step) {
      this.pos.x += dx / l * step;
      this.pos.y += dy / l * step;
    } else {
      this.pos.x = cx(this.mx);
      this.pos.y = cy(this.my);
      if (ent.game.totalTime >= CHASE_AT) this.chase();
      for (let n = 0; n < 40 && this.mx === this.tx && this.my === this.ty; ++n) {
        this.retarget();
      }
      if (this.tx > this.mx) this.mx += 1;
      else if (this.tx < this.mx) this.mx -= 1;
      else if (this.ty > this.my) this.my += 1;
      else if (this.ty < this.my) this.my -= 1;
    }

    if (player === null || player.leaving >= 0) return;
    if (this.hit(player)) die();
  }

  // How far a straight run goes before a wall stops it. On patrol it also gives
  // up early at any way out, more readily the further it has come, which turns
  // a corridor sweep into a wander.
  runX(x0, y, dx, wander) {
    // Zero is not a direction, and it is what `retarget` asks for whenever the
    // bot is already in the player's column.
    if (dx === 0) return x0;
    let x = x0;
    while (x >= 0 && x < N) {
      const m = map[y * N + x];
      if (dx === 1 && (m & E_W)) break;
      if (dx === -1 && (m & W_W)) break;
      if (
        wander && Math.random() >= 1 / (1 + Math.abs(x - x0)) &&
        (!(m & N_W) || !(m & S_W))
      ) break;
      x += dx;
    }
    return x;
  }

  runY(x, y0, dy, wander) {
    if (dy === 0) return y0;
    let y = y0;
    while (y >= 0 && y < N) {
      const m = map[y * N + x];
      if (dy === 1 && (m & S_W)) break;
      if (dy === -1 && (m & N_W)) break;
      if (
        wander && Math.random() >= 1 / (1 + Math.abs(y - y0)) &&
        (!(m & E_W) || !(m & W_W))
      ) break;
      y += dy;
    }
    return y;
  }

  retarget() {
    if (player !== null && ent.game.totalTime >= AIM_AT) {
      if (Math.random() < 0.5) {
        const k = this.runX(this.mx, this.my, Math.sign(player.mx - this.mx), true);
        if (k !== this.mx) {
          this.tx = k;
          return;
        }
      } else {
        const k = this.runY(this.mx, this.my, Math.sign(player.my - this.my), true);
        if (k !== this.my) {
          this.ty = k;
          return;
        }
      }
    }
    switch (Math.floor(4 * Math.random())) {
      case 0:
        this.ty = this.runY(this.mx, this.my, -1, true);
        break;
      case 1:
        this.ty = this.runY(this.mx, this.my, 1, true);
        break;
      case 2:
        this.tx = this.runX(this.mx, this.my, -1, true);
        break;
      default:
        this.tx = this.runX(this.mx, this.my, 1, true);
    }
  }

  chase() {
    if (player === null) return;
    this.evil = false;
    if (player.mx === this.mx) {
      const y = this.runY(this.mx, this.my, player.my > this.my ? 1 : -1, false);
      if (Math.abs(player.my - this.my) <= Math.abs(y - this.my)) {
        this.evil = true;
        this.tx = this.mx;
        this.ty = player.my;
      }
    }
    if (player.my === this.my) {
      const x = this.runX(this.mx, this.my, player.mx > this.mx ? 1 : -1, false);
      if (Math.abs(player.mx - this.mx) <= Math.abs(x - this.mx)) {
        this.evil = true;
        this.ty = this.my;
        this.tx = player.mx;
      }
    }
  }

  render(ctx) {
    ctx.beginPath();
    ctx.arc(0, 0, BOT_R, 0, 2 * Math.PI);
    if (this.evil) {
      ctx.fillStyle = ent.css(BOT);
      ctx.fill();
      return;
    }
    ctx.strokeStyle = ent.css(BOT);
    ctx.lineWidth = 4;
    ctx.stroke();
  }
}

class Key extends ent.Entity {
  constructor(i, j) {
    super();
    this.pos.x = cx(i);
    this.pos.y = cy(j);
    this.hitBox(KEY_BOX);
  }

  update() {
    if (dying > 0 || player === null) return;
    if (!this.hit(player)) return;
    gate.open();
    sound.play("key");
    this.remove();
  }

  render(ctx) {
    ctx.fillStyle = ent.css(DARK);
    ctx.fillRect(-KEY_BOX / 2, -KEY_BOX / 2, KEY_BOX, KEY_BOX);
  }
}

class Gate extends ent.Entity {
  constructor(i, j) {
    super();
    this.pos.x = cx(i);
    this.pos.y = cy(j);
    this.unlocked = false;
    this.shut = 1;
    this.hitBox(GATE_BOX);
  }

  open() {
    this.unlocked = true;
  }

  update() {
    if (dying > 0) return;
    if (this.unlocked && this.shut > 0) {
      this.shut = Math.max(0, this.shut - 4 * ent.game.time);
    }
    if (!this.unlocked || player === null || player.leaving >= 0) return;
    if (!this.hit(player)) return;
    sound.play("gate");
    player.door();
  }

  render(ctx) {
    const h = GATE_BOX / 2;
    ctx.fillStyle = ent.css(DARK);
    ctx.fillRect(-h, -h, GATE_BOX, GATE_BOX);
    if (this.shut <= 0) return;
    const s = GATE_BOX / 2 * this.shut;
    ctx.fillStyle = ent.css(BG);
    ctx.fillRect(-s, -s, 2 * s, 2 * s);
  }
}

function die() {
  if (dying > 0) return;
  dying = DEATH;
  ent.shake(0.4);
  sound.play("dead");
  new ent.Particle({
    x: player.pos.x,
    y: player.pos.y,
    color: YOU,
    count: 60,
    size: 6,
    speed: [256, 170],
    duration: [0.5, 0.3],
  });
}

function leave() {
  wipeX = gate.pos.x;
  wipeY = gate.pos.y;
  phase = WIPE_OUT;
  phaseT = 0;
  player.remove();
  player = null;
}

function buildLevel() {
  ent.reset([Gate, Key, Bot, Player]);

  level += 1;
  score.value = level;
  generate();

  player = new Player();
  // Point symmetric about the middle, `p1 = 15*15 - 1 - p0`, so a level is
  // always a there and a back. Not the middle itself: p1 is its own mirror
  // there, and both would land underfoot.
  const home = MID + N * MID;
  let p0 = home;
  while (p0 === home) p0 = Math.floor(N * N * Math.random());
  const p1 = N * N - 1 - p0;
  gate = new Gate(p0 % N, Math.floor(p0 / N));
  new Key(p1 % N, Math.floor(p1 / N));
  for (let i = 0; i < level; ++i) new Bot();
}

export function init() {
  hint(meta.desc);
  level = 0;
  dying = 0;
  phase = PLAY;
  phaseT = 0;
  pressed = 0;
  tapped = false;
  buildLevel();
}

export function update(dt) {
  // Off input.js directly, not entity.js's copy, which the player would read a
  // frame behind during ent.update().
  tapped = input.release.act && pressed > 0 && pressed <= TAP;
  pressed = input.press.act ? pressed + dt : 0;

  ent.update(phase === PLAY && hint() <= 0 ? dt : 0);

  if (dying > 0) {
    if ((dying -= dt) <= 0) gameOver({ score: true });
    return;
  }
  if (phase === PLAY) return;

  phaseT += dt;
  if (phase === WIPE_OUT && phaseT >= WIPE) {
    phaseT = 0;
    phase = SHOWING;
    buildLevel();
  } else if (phase === SHOWING && phaseT >= SHOW) {
    phaseT = 0;
    phase = WIPE_IN;
  } else if (phase === WIPE_IN && phaseT >= WIPE) {
    phaseT = 0;
    phase = PLAY;
  }
}

export function render(ctx) {
  ctx.strokeStyle = ent.css(WALL);
  ctx.lineWidth = LINE;
  ctx.lineCap = "square";
  ctx.beginPath();
  for (let i = 0; i < walls.length; i += 4) {
    ctx.moveTo(walls[i], walls[i + 1]);
    ctx.lineTo(walls[i + 2], walls[i + 3]);
  }
  ctx.stroke();

  ent.render(ctx);
  drawWipe(ctx);
}

function drawWipe(ctx) {
  if (phase === PLAY) return;
  ctx.fillStyle = ent.css(DARK);

  if (phase === WIPE_OUT) {
    const s = 2048 * (phaseT / WIPE);
    ctx.fillRect(wipeX - s / 2, wipeY - s / 2, s, s);
    return;
  }

  ctx.fillRect(0, 0, 1024, 1024);
  if (phase === WIPE_IN) {
    const s = 1024 * (phaseT / WIPE);
    ctx.fillStyle = ent.css(BG);
    ctx.fillRect(512 - s / 2, 512 - s / 2, s, s);
    return;
  }
  label(ctx, `LEVEL ${level}`, 512, 512, 9, YOU);
}

function label(ctx, s, x, y, size, color) {
  const g = glyphs(s);
  ctx.fillStyle = ent.css(color);
  const x0 = x - g.width * size / 2;
  const y0 = y - g.height * size / 2;
  for (let i = 0; i < g.dots.length; i += 2) {
    ctx.fillRect(x0 + g.dots[i] * size, y0 + g.dots[i + 1] * size, size, size);
  }
}
