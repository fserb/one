
import {C, opts, act, mouse, ease, op} from "./internal.js";


let lines;
let starty = 0;
let size = 0;

let state = {
  t: 0.0
};

export function init() {
  lines =  opts.desc.strip().split('\n');

  size = Math.min(800 / (lines.length * 1.5),
    800 / (Math.max(...lines.map(x => x.length)) * 0.6));

  const height = lines.length * size * 1.5;
  starty = (1024 - height + size * 1.5) / 2;
}

export function update(tick) {
  if (act(state).is()) return;
  if (!mouse.click) return;

  state.t = 0;
  act(state).attr("t", 1.0, 0.3, ease.fastOutSlowIn).then(() => op.startGame());
}

export function render(ctx) {
  let y = starty;

  ctx.fillStyle = C[opts.fgColor];
  ctx.fillRect(0, Math.lerp(y - size * 1.5, 0, state.t),
    1024, Math.lerp(lines.length * size * 1.5 + size * 1.5, 44, state.t));

  if (state.t != 0.0) return;

  ctx.fillStyle = C[opts.bgColor];

  for (const l of lines) {
    ctx.text(l, 512, y, size);
    y += size * 1.5;
  }
}