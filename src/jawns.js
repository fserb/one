// jawns - Cipher Prime's Jawns (2018), its Traditional mode against the computer.

import * as ent from "./lib/entity.js";
import * as ease from "./alma/src/ease.js";
import floodFill from "./alma/src/algo/floodFill.js";
import { AStar } from "./alma/src/game/AStar.js";
import { act } from "./lib/act.js";
import { gameOver, input } from "./lib/one.js";
import * as play from "./lib/sounds.js";

export const meta = {
  title: "jawns",
  bg: "#faf9ed",
  fg: "#F73752",
  overlay: "#29221f",
  date: "2018-07-24",
  about: "After [Jawns](https://cipherprime.com) by Cipher Prime Studios, " +
    "@willstall and @dainsaint.",
};

// The original's board is 49px cells and 39px tiles; everything here is that
// times 100/49.
const COLS = 5;
const ROWS = 9;
const S = 100;
const OX = 512 - COLS * S / 2;
const OY = 512 - ROWS * S / 2;
const TILE = 80;
const CORNER = 20;
const THICK = 6;
const RING = 92; // a marker's rounded box, and the check outline
const BAR_TOP = OY - 30;
const BAR_BOT = OY + ROWS * S + 30;

const BG = 0xfaf9ed;
const SLOT = "#e7e7e7";
const SHADOW = "rgba(41,34,31,0.2)";
const SHINE = "rgba(255,255,255,0.2)";
const BODY = ["#F73752", "#2CBFBB"];
const DARK = ["#DA0B2A", "#1AA7AC"];
const NAME = ["red", "blue"];

const ME = 0;
const AI = 1;

const ATTACK = 0;
const MOVE = 1;
const SWAP = 2;

const DECK = [
  "1",
  "0",
  "1",
  "0",
  "1",
  "2",
  "1",
  "2",
  "1",
  "2",
  "3",
  "2",
  "Q",
  "2",
  "3",
];
const PIPS = {
  "1": [[0, 0]],
  "2": [[-6, 6], [6, -6]],
  "3": [[0, 0], [-12, 12], [12, -12]],
};

const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

// board[y * COLS + x] is a Jawn or null. A trial swaps in a copy.
let board = [];
let jawns = [];
let turn = ME;
let over = false;
let check = [false, false];
// The one drawn over the rest: the one held or the one the computer moves.
let top = null;
let hover = null;
let held = null;
let path = null;
let think = null;
let shaking = 0;
const bars = { groove: 0, shown: [0, 0] };
const paint = { t: 0, to: BG };
const clock = {};

function cx(x) {
  return OX + (x + 0.5) * S;
}

function cy(y) {
  return OY + (y + 0.5) * S;
}

function inside(x, y) {
  return x >= 0 && y >= 0 && x < COLS && y < ROWS;
}

function at(x, y) {
  return inside(x, y) ? board[y * COLS + x] : null;
}

function where(j) {
  const i = board.indexOf(j);
  return i < 0 ? null : { x: i % COLS, y: Math.floor(i / COLS) };
}

function cellAt(px, py) {
  return { x: Math.floor((px - OX) / S), y: Math.floor((py - OY) / S) };
}

function worth(j) {
  return j.role === "Q" ? 500 : +j.role;
}

function owned(side) {
  return board.filter((j) => j !== null && j.side === side);
}

// A target takes only a target, a blank only a blank, and a number anything
// with as many pips or fewer, or a target.
function canTake(j, d) {
  if (d === null || d.side === j.side) return false;
  if (j.role === "Q") return d.role === "Q";
  if (j.role === "0") return d.role === "0";
  if (d.role === "Q") return true;
  if (d.role === "0") return false;
  return +j.role >= +d.role;
}

// In the original's order: attacks up, down, left, right, then every empty
// space reachable, then the four neighbours.
function options(j) {
  const o = where(j);
  const out = [];
  for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    let x = o.x + dx;
    let y = o.y + dy;
    while (inside(x, y) && at(x, y) === null) {
      x += dx;
      y += dy;
    }
    if (canTake(j, at(x, y))) out.push({ j, kind: ATTACK, x, y });
  }
  const open = (x, y) =>
    (x === o.x && y === o.y) || (inside(x, y) && at(x, y) === null);
  for (const [x, y] of floodFill(o.x, o.y, open)) {
    if (x !== o.x || y !== o.y) out.push({ j, kind: MOVE, x, y });
  }
  for (const [dx, dy] of DIRS) {
    const t = at(o.x + dx, o.y + dy);
    if (t !== null && t.side === j.side) {
      out.push({ j, kind: SWAP, x: o.x + dx, y: o.y + dy });
    }
  }
  return out;
}

// Changes the board only, and returns who left it. Equal numbers take each
// other; two targets do not.
function apply({ j, kind, x, y }) {
  const o = where(j);
  const from = o.y * COLS + o.x;
  const to = y * COLS + x;
  const t = board[to];
  board[from] = kind === SWAP ? t : null;
  board[to] = j;
  if (kind !== ATTACK) return [];
  if (t.role !== j.role || j.role === "Q") return [t];
  board[to] = null;
  return [t, j];
}

function trial(m, fn) {
  const saved = board;
  board = board.slice();
  apply(m);
  const r = fn();
  board = saved;
  return r;
}

function inCheck(side) {
  const q = owned(side).find((j) => j.role === "Q");
  if (!q) return true;
  const p = where(q);
  return owned(1 - side).some((j) =>
    options(j).some((m) => m.kind === ATTACK && m.x === p.x && m.y === p.y)
  );
}

function inMate(side) {
  if (!owned(side).some((j) => j.role === "Q")) return true;
  for (const j of owned(side)) {
    for (const m of options(j)) {
      if (!trial(m, () => inCheck(side))) return false;
    }
  }
  return true;
}

// The original's board value: pips, plus 1 per move and swap and ten times the
// pip difference per attack on a number. A move counts only if it leaves
// whoever's turn it is out of check, whichever side is being valued.
function value(side) {
  let v = 0;
  for (const j of owned(side)) v += worth(j);
  for (const j of owned(side)) {
    for (const m of options(j)) {
      if (trial(m, () => inCheck(turn))) continue;
      if (m.kind !== ATTACK) {
        v += 1;
        continue;
      }
      const d = at(m.x, m.y);
      if (d.role !== "Q") v += Math.abs(10 * (worth(j) - worth(d)));
    }
  }
  return v;
}

// The cells from a to b through empty ones, both ends included. AStar tells
// cells apart by their JSON, so both ends go in as bare {x, y}.
function route({ x: ax, y: ay }, { x: bx, y: by }) {
  const a = { x: ax, y: ay };
  const b = { x: bx, y: by };
  const grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
  const end = (x, y) => (x === a.x && y === a.y) || (x === b.x && y === b.y);
  const tileCost = (x, y) => at(x, y) === null || end(x, y) ? 1 : false;
  return AStar.fromGrid(grid, b, { start: a, tileCost }).getPath(a);
}

// Only where the path turns, and its end.
function corners(p) {
  const out = [];
  for (let i = 1; i < p.length; ++i) {
    const [a, b, c] = [p[i - 1], p[i], p[i + 1]];
    if (!c || c.x - b.x !== b.x - a.x || c.y - b.y !== b.y - a.y) out.push(b);
  }
  return out;
}

class Jawn {
  constructor(side, role, x, y) {
    this.side = side;
    this.role = role;
    this.pos = { x: cx(x), y: cy(y) };
    this.lift = { s: 1, y: 0 };
    // Seconds into the gleam, negative while it waits; null when it is off.
    this.shine = null;
    this.loop = false;
  }

  update(dt) {
    if (this.shine === null) return;
    this.shine += dt;
    if (!this.loop && this.shine > 1.2) this.shine = null;
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.pos.x, this.pos.y);
    const h = TILE / 2;

    if (this.role === "Q" && check[this.side] && !over) {
      ctx.strokeStyle = BODY[1 - this.side];
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(-RING / 2, -RING / 2, RING, RING, CORNER + 4);
      ctx.stroke();
    }

    ctx.fillStyle = SHADOW;
    ctx.beginPath();
    ctx.roundRect(-h, -h, TILE, TILE, CORNER);
    ctx.fill();

    ctx.translate(0, this.lift.y);
    ctx.scale(this.lift.s, this.lift.s);
    ctx.fillStyle = DARK[this.side];
    ctx.beginPath();
    ctx.roundRect(-h, -h + THICK, TILE, TILE - THICK, CORNER);
    ctx.fill();
    ctx.fillStyle = BODY[this.side];
    ctx.beginPath();
    ctx.roundRect(-h, -h, TILE, TILE - THICK, CORNER);
    ctx.fill();

    // Engraved: the dark copy 6 above, then the white.
    this.mark(ctx, DARK[this.side], -8);
    this.mark(ctx, "#fff", -2);

    // 1.2s across, then 1.5s off.
    const g = this.shine === null ? -1 : this.shine % 2.7;
    if (g >= 0 && g < 1.2) {
      ctx.beginPath();
      ctx.roundRect(-h, -h, TILE, TILE - THICK, CORNER);
      ctx.clip();
      ctx.translate(-400 + 800 * g / 1.2, 0);
      ctx.rotate(-Math.PI / 4);
      ctx.fillStyle = SHINE;
      ctx.fillRect(-400, -60, 800, 10);
      ctx.fillRect(-400, -40, 800, 60);
    }
    ctx.restore();
  }

  mark(ctx, color, dy) {
    ctx.fillStyle = color;
    if (this.role === "Q") {
      ctx.strokeStyle = color;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(0, dy + 2, 17, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, dy + 2, 8, 0, 2 * Math.PI);
      ctx.fill();
      return;
    }
    const pips = PIPS[this.role];
    if (pips) {
      for (const [x, y] of pips) {
        ctx.beginPath();
        ctx.arc(x, y + dy + 2, 4, 0, 2 * Math.PI);
        ctx.fill();
      }
      return;
    }
    if (this.role === "0") return;
    ctx.text(this.role, 0, dy + 2, 29, {
      weight: "normal",
      align: "center",
      valign: "middle",
    });
  }
}

// 40 white balls with a grey shadow, each turned by noise, slowed by 10% a
// frame and pulled up, shrinking from 1.5 to nothing.
class Burst extends ent.Entity {
  constructor(x, y) {
    super();
    this.parts = [];
    for (let i = 0; i < 40; ++i) {
      const a = 2 * Math.PI * Math.random();
      const v = 400 + 400 * Math.random();
      const life = 1 + Math.random();
      this.parts.push({
        x,
        y,
        vx: v * Math.cos(a),
        vy: v * Math.sin(a),
        life,
        age: 0,
      });
    }
  }

  update() {
    const dt = ent.game.time;
    const f = dt * 60;
    const damp = 0.9 ** f;
    for (const p of this.parts) {
      p.vx = (p.vx + 20 * f * (2 * Math.random() - 1)) * damp;
      p.vy = (p.vy + 20 * f * (2 * Math.random() - 1)) * damp - 400 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.age += dt;
    }
    this.parts = this.parts.filter((p) => p.age < p.life);
    if (this.parts.length === 0) this.remove();
  }

  render(ctx) {
    for (const [color, ox, oy] of [["#eee", -4, 4], ["#fff", 0, 0]]) {
      ctx.fillStyle = color;
      for (const p of this.parts) {
        const r = 30 * (1 - ease.circOut(p.age / p.life));
        ctx.beginPath();
        ctx.arc(p.x + ox, p.y + oy, r, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
  }
}

function raise(j, s, y, t, e = ease.linear) {
  act(j.lift).reset().attr("s", s, t, e).attr("y", y, t, e);
}

function lift(j) {
  play.select();
  raise(j, 1.5, -40, 0.03);
}

function drop(j) {
  play.drop();
  raise(j, 1, 0, 0.5, ease.bounceOut);
}

function highlight(j, on) {
  raise(j, on ? 1.115 : 1, on ? -12 : 0, 0.05);
}

function slide(j, x, y, t, e = ease.linear) {
  return act(j.pos).reset().attr("x", cx(x), t, e).attr("y", cy(y), t, e);
}

function placeAll() {
  for (const j of jawns) {
    const p = where(j);
    act(j.pos).reset();
    j.pos.x = cx(p.x);
    j.pos.y = cy(p.y);
  }
}

function kill(j) {
  jawns = jawns.filter((k) => k !== j);
  new Burst(j.pos.x, j.pos.y);
  play.explode();
  ent.after(0.05, () => shaking = 0.8);
}

function commit(m) {
  for (const j of apply(m)) kill(j);
  placeAll();
  check = [inCheck(ME), inCheck(AI)];
  const dead = check.map((c, side) => c && inMate(side));
  if (dead[ME] || dead[AI]) return finish(dead[ME] ? AI : ME);
  turn = 1 - turn;
  onTurn();
}

function onTurn() {
  for (const j of jawns) {
    j.shine = turn === ME && j.side === ME ? -2 * Math.random() : null;
    j.loop = true;
  }
  for (const side of [ME, AI]) {
    act(bars.shown).attr(String(side), turn === side ? 1 : 0, 0.5, ease.circOut);
  }
  if (hover) highlight(hover, false);
  hover = null;

  for (const side of [ME, AI]) {
    if (!check[side]) continue;
    play.alarm();
    for (const q of owned(side).filter((j) => j.role === "Q")) {
      act(q.lift).reset().attr("s", 1.115, 0.05).attr("y", -12, 0.05)
        .delay(0.1).attr("s", 1, 0.05).attr("y", 0, 0.05);
    }
  }

  if (turn === AI) act(clock).reset().delay(1.1).then(startThinking);
}

function startThinking() {
  think = { list: owned(AI), moves: [], kill: null };
}

// One of its jawns a frame, so a search never stalls a frame.
function thinkStep() {
  const j = think.list.shift();
  if (j && !think.kill) {
    for (const m of options(j)) {
      if (trial(m, () => inMate(ME))) {
        think.kill = m;
        break;
      }
      m.value = trial(m, () => inCheck(AI))
        ? -Infinity
        : trial(m, () => value(AI) - value(ME));
      think.moves.push(m);
    }
    return;
  }

  const { moves, kill } = think;
  think = null;
  if (!kill && moves.length === 0) return finish(ME);
  perform(kill ?? pick(moves));
}

function pick(moves) {
  const best = Math.max(...moves.map((m) => m.value));
  const all = moves.filter((m) => m.value === best);
  return all[Math.floor(Math.random() * all.length)];
}

// The original's animations: half a second's pause, then each straight run at
// 0.25s; an attack stops short, rises and lunges the last cell.
function perform(m) {
  const { j, kind, x, y } = m;
  const o = where(j);
  top = j;
  const tr = act(j.pos).reset().delay(0.5);
  if (kind === SWAP) {
    tr.then(play.whoosh).attr("x", cx(x), 0.2).attr("y", cy(y), 0.2);
    act(at(x, y).pos).reset().delay(0.5).attr("x", cx(o.x), 0.2).attr(
      "y",
      cy(o.y),
      0.2,
    );
  } else {
    const p = route(o, { x, y });
    if (kind === ATTACK) p.pop();
    for (const c of corners(p)) {
      tr.then(play.step)
        .attr("x", cx(c.x), 0.25, ease.quadOut)
        .attr("y", cy(c.y), 0.25, ease.quadOut)
        .delay(0.05);
    }
    if (kind === ATTACK) {
      const back = ease.backIn(1.70158);
      tr.delay(0.1).then(() => lift(j))
        .attr("x", cx(x), 0.2, back).attr("y", cy(y), 0.2, back)
        .delay(0.1).then(() => drop(j)).delay(0.1);
    }
  }
  tr.then(() => commit(m));
}

function finish(winner) {
  over = true;
  held = null;
  path = null;
  if (hover) highlight(hover, false);
  hover = null;
  (winner === ME ? play.win : play.lose)();
  paint.to = ent.hex(BODY[winner]);
  act(paint).attr("t", 1, 0.3);
  act(bars).attr("groove", 0, 0.5, ease.circOut);
  for (const j of jawns) j.shine = null;
  ent.after(1.2, () => spell(winner));
  ent.after(2.8, () => gameOver({ win: winner === ME }));
}

// The original's win screen: the board cleared, and "red wins" in jawns.
function spell(side) {
  board = new Array(COLS * ROWS).fill(null);
  jawns = [];
  const words = [[NAME[side], 0, 2], ["wins", 1, 3]];
  for (const [word, x0, y] of words) {
    [...word].forEach((ch, i) => {
      const j = new Jawn(side, ch, x0 + i, y);
      board[y * COLS + x0 + i] = j;
      jawns.push(j);
    });
  }
  jawns.forEach((j, i) => {
    j.shine = -0.1 * i;
    j.loop = false;
  });
}

function under(px, py) {
  const c = cellAt(px, py);
  const j = at(c.x, c.y);
  if (j === null) return null;
  return Math.abs(px - j.pos.x) <= TILE / 2 && Math.abs(py - j.pos.y) <= TILE / 2
    ? j
    : null;
}

function grab(j) {
  const o = where(j);
  top = j;
  lift(j);
  const table = new Map();
  for (const m of options(j)) table.set(`${m.x},${m.y}`, m);
  held = { j, o, dx: j.pos.x - input.x, dy: j.pos.y - input.y, table, on: null };
}

function engage(m) {
  if (held.on === m) return;
  disengage();
  held.on = m;
  if (m.kind === MOVE) path = route(held.o, m);
  if (m.kind === SWAP) slide(at(m.x, m.y), held.o.x, held.o.y, 0.15);
}

function disengage() {
  const m = held.on;
  held.on = null;
  path = null;
  if (m?.kind === SWAP) slide(at(m.x, m.y), m.x, m.y, 0.15);
}

function control() {
  if (held) {
    const { j } = held;
    j.pos.x = input.x + held.dx;
    j.pos.y = input.y + held.dy;
    const c = cellAt(j.pos.x, j.pos.y);
    const m = held.table.get(`${c.x},${c.y}`);
    if (m) engage(m);
    else disengage();
    if (input.press.act) return;

    path = null;
    held = null;
    drop(j);
    if (!m) {
      const o = where(j);
      j.pos.x = cx(o.x);
      j.pos.y = cy(o.y);
      return;
    }
    j.pos.x = cx(m.x);
    j.pos.y = cy(m.y);
    commit(m);
    return;
  }

  const h = under(input.x, input.y);
  const mine = h?.side === ME ? h : null;
  if (mine !== hover) {
    if (hover) highlight(hover, false);
    if (mine) {
      highlight(mine, true);
      play.blip({ detune: [0, 200, 400, 700][Math.floor(4 * Math.random())] });
    }
    hover = mine;
  }
  if (input.just.act && mine) grab(mine);
}

function deal() {
  const deck = [...DECK];
  for (let i = deck.length - 1; i > 0; --i) {
    const k = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[k]] = [deck[k], deck[i]];
  }
  // The target never starts on the front row.
  const q = deck.indexOf("Q");
  if (q < COLS) {
    let k = q;
    while (deck[k] === "Q") {
      k = COLS + Math.floor(Math.random() * (deck.length - COLS));
    }
    [deck[q], deck[k]] = [deck[k], deck[q]];
  }
  return deck;
}

export function init() {
  ent.reset([Burst]);
  board = new Array(COLS * ROWS).fill(null);
  jawns = [];
  turn = ME;
  over = false;
  check = [false, false];
  top =
    hover =
    held =
    path =
    think =
      null;
  shaking = 0;
  paint.t = 0;
  bars.groove = 0;
  bars.shown = [0, 0];

  // Red from the middle down, left to right; blue from the middle up, right
  // to left, so both front rows face each other and both back rows stay empty.
  const mine = deal();
  const theirs = deal();
  for (let y = 5; y < ROWS; ++y) {
    for (let x = 0; x < COLS; ++x) {
      const r = mine.shift();
      if (r === undefined) continue;
      jawns.push(board[y * COLS + x] = new Jawn(ME, r, x, y));
    }
  }
  for (let y = 3; y >= 0; --y) {
    for (let x = COLS - 1; x >= 0; --x) {
      const r = theirs.shift();
      if (r === undefined) continue;
      jawns.push(board[y * COLS + x] = new Jawn(AI, r, x, y));
    }
  }

  act(bars).attr("groove", 1, 0.5, ease.circOut);
  onTurn();
}

export function update(dt) {
  shaking = Math.max(0, shaking - dt);
  for (const j of jawns) j.update(dt);
  if (think) thinkStep();
  else if (turn === ME && !over) control();
  ent.update(dt);
}

function drawBar(ctx, y, side) {
  const half = COLS * S / 2;
  const g = bars.groove * half;
  const d = bars.shown[side] * g;
  ctx.lineCap = "round";
  ctx.lineWidth = 10;
  for (const [w, color] of [[g, SLOT], [d, BODY[side]]]) {
    if (w <= 0) continue;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(512 - half, y);
    ctx.lineTo(512 - half + w, y);
    ctx.moveTo(512 + half, y);
    ctx.lineTo(512 + half - w, y);
    ctx.stroke();
  }
}

export function render(ctx) {
  ctx.fillStyle = ent.css(ent.mix(BG, paint.to, paint.t));
  ctx.fillRect(0, 0, 1024, 1024);

  ctx.save();
  if (shaking > 0) {
    const a = 2 * Math.PI * Math.random();
    const r = 10 * shaking / 0.8;
    ctx.translate(r * Math.cos(a), r * Math.sin(a));
  }

  ctx.fillStyle = SLOT;
  for (let y = 0; y < ROWS; ++y) {
    for (let x = 0; x < COLS; ++x) {
      ctx.beginPath();
      ctx.arc(cx(x), cy(y), 8, 0, 2 * Math.PI);
      ctx.fill();
    }
  }
  drawBar(ctx, BAR_TOP, AI);
  drawBar(ctx, BAR_BOT, ME);

  if (held) {
    const color = BODY[held.j.side];
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx(held.o.x), cy(held.o.y), 16, 0, 2 * Math.PI);
    ctx.fill();

    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    for (const m of held.table.values()) {
      ctx.beginPath();
      ctx.roundRect(cx(m.x) - RING / 2, cy(m.y) - RING / 2, RING, RING, CORNER + 4);
      ctx.stroke();
    }

    if (path) {
      for (const p of path.slice(1)) {
        ctx.beginPath();
        ctx.arc(cx(p.x), cy(p.y), 8, 0, 2 * Math.PI);
        ctx.fill();
      }
      ctx.lineWidth = 4;
      ctx.beginPath();
      path.forEach((p, i) =>
        i === 0 ? ctx.moveTo(cx(p.x), cy(p.y)) : ctx.lineTo(cx(p.x), cy(p.y))
      );
      ctx.stroke();
    }
  }

  for (const j of jawns) if (j !== top) j.draw(ctx);
  if (top && jawns.includes(top)) top.draw(ctx);

  ent.render(ctx);
  ctx.restore();
}
