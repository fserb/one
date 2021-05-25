import {stages, opts, mouse, act, op, ease} from "./internal.js";

const state = {
  t: 0.0
};

let msg;

export function init() {
  state.t = 0.0;
  act(state).attr("t", 1.0, 0.15, ease.fastInSlowOut);

  msg = opts.finishGood ? [ "WELL", "DONE" ] : [ "GAME", "OVER" ];
}

export function update(tick) {
  if (act(state).is()) return;

  if (!mouse.click) return;

  state.t = 1.0;
  act(state).attr("t", 0.0, 0.25, ease.fastInSlowOut)
    .then(() => op.startGame());

}

export function render(ctx) {
  ctx.save();
  stages["game"].render(ctx);
  ctx.restore();

  const h = Math.lerp(44, 512, state.t);

  ctx.fillStyle = opts.fgColor;
  ctx.fillRect(0, 0, 1024, h);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 44, 1024, h - 44);
  ctx.clip();

  ctx.fillStyle = opts.bgColor;
  const c = 44 + (h - 44) / 2;
  ctx.text(msg[0], 512, h - 330, 150);
  ctx.text(msg[1], 512, h - 150, 150);

  ctx.restore();
}