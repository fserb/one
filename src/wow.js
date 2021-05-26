/*
based on ZOT
https://www.cs.brandeis.edu/~storer/JimPuzzles/ZPAGES/zzzBullsEye.html
*/

import * as one from "./one/one.js";
import {C, act, ease, mouse} from "./one/one.js";

one.description("wow", `
move the small circle
inside the bigger circle
`);

const L = {
  bg: C[1],
  fg: C[6],
  pp: C[13],
  gr: C[25],
  sh: C[5],
}

one.options({
  bgColor: L.bg,
fgColor: L.fg,
  scoreMax: false,
  finishGood: true,
});


let pieces;
let empty
let tiles;
let ox, oy;

function init() {
  empty = {x: 1, y: 2};
  pieces = [];

  let p = 0;
  for (let y = 0; y < 4; ++y) {
    for (let x = 0; x < 3; ++x) {
      if (y == 2 && x == 1) continue;
      const p = x + y * 3;
      const px = p % 3;
      const py = (p - px) / 3;

      const obj = {x: x, y: y, gx: x, gy: y, p: p, px: px, py: py, goal: true};

      // ZT
      if (y == 0 && x != 1) obj.goal = false;
      // target
      if (x == 1 && y == 0) obj.gy = 2;

      pieces.push(obj);
    }
  }

  pieces[1].y = 2;
  pieces[4].y = 0;
  empty.y = 1;
  check();

  let c;
  [tiles, c] = one.utils.newCanvas(1404, 1872);

  c.fillStyle = L.pp;
  c.fillRect(0, 0, 1404, 1872);

  const r = 50;
  c.fillStyle = L.fg;
  c.fillCircle(702, 1170, 600);
  c.fillStyle = L.gr;
  c.fillCircle(702, 1170, 600 - r);
  c.fillStyle = L.fg;
  c.fillCircle(702, 1170, 600 - r * 2);
  c.fillStyle = L.pp;
  c.fillCircle(702, 1170, 600 - r * 3);

  c.fillStyle = L.fg;
  c.fillCircle(702, 234, 150);
  c.fillStyle = L.gr;
  c.fillCircle(702, 234, 150 - r);
  c.fillStyle = L.fg;
  c.fillCircle(702, 234, 150 - r * 2);

  c.fillStyle = L.fg;
  c.text("W", 234, 265, 350);
  c.text("W", 468 * 2 + 234, 265, 350);

  ox = (1024 - (234*3)) / 2;
  oy = (1024 - (234*4) - 28);
}

function check() {
  for (const p of pieces) {
    if (!p.goal) continue;
    if (p.x != p.gx) return;
    if (p.y != p.gy) return;
  }

  one.gameOver();
}

function update(tick) {
  // if (act.is()) return;
  if (!mouse.click) return;

  const px = Math.floor((mouse.x - ox) / 234);
  const py = Math.floor((mouse.y - oy) / 234);

  if (px == empty.x && py == empty.y) return;

  const dx = empty.x - px;
  const dy = empty.y - py;

  if (Math.abs(dx) + Math.abs(dy) > 1) return;

  let target = null;
  for (const p of pieces) {
    if (p.x == px && p.y == py) {
      target = p;
      break;
    }
  }

  if (!target) return;

  let nex = target.x;
  let ney = target.y;

  one.addScore();

  act(target)
    .attr("x", empty.x, 0.3, ease.fastOutSlowIn)
    .attr("y", empty.y, 0.3, ease.fastOutSlowIn)
    .then(check);

  empty.x = nex;
  empty.y = ney;
}

function render(ctx) {
  ctx.fillStyle = L.sh;
  const s = 15;
  for (const p of pieces) {
    ctx.fillRect(ox + p.x * 234 + s, oy + p.y * 234 + s, 234, 234);
  }

  for (const p of pieces) {
    ctx.drawImage(tiles, p.px * 468, p.py * 468, 468, 468,
      ox + p.x * 234, oy + p.y * 234, 234, 234);
  }
}

export default one.game(init, update, render);
