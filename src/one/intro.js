
import {C, desc, opts, mouse, startGame} from "./one.js";

let lines;
let starty = 0;
let size = 0;

export function init() {
  lines =  desc.strip().split('\n');

  size = Math.min(800 / (lines.length * 1.5),
    800 / (Math.max(...lines.map(x => x.length)) * 0.5));

  const height = lines.length * size * 1.5;
  starty = (1024 - height + size * 1.5) / 2;
}

export function update(tick) {
  if (mouse.click) {
    startGame();
  }
}

export function render(ctx) {
  let y = starty;

  if (opts.shColor >= 0) {
    ctx.fillStyle = C[opts.shColor];
    for (const l of lines) {
      ctx.text(l, 512 + 4, y + 4, size);
      y += size * 1.5;
    }
    y = starty;
  }

  ctx.fillStyle = C[opts.fgColor];
  for (const l of lines) {
    ctx.text(l, 512, y, size);
    y += size * 1.5;
  }
}