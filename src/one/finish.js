import {stages, C, opts, mouse, act, op, ease} from "./internal.js";

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

function rendermsg(ctx, i) {
  if (opts.shColor) {
    const b = 10;
    ctx.fillStyle = C[opts.shColor];
    ctx.text(msg[i], 512 + b, 341 * (i + 1) + b, 300);
  }
  ctx.fillStyle = C[opts.fgColor];
  ctx.text(msg[i], 512, 341 * (i + 1), 300);
}

export function render(ctx) {
  stages["game"].render(ctx);

  const h = Math.lerp(44, 512, state.t);

  ctx.fillStyle = C[opts.fgColor];
  ctx.fillRect(0, 0, 1024, h);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 44, 1024, h - 44);
  ctx.clip();

  ctx.fillStyle = C[opts.bgColor];
  const c = 44 + (h - 44) / 2;
  ctx.text(msg[0], 512, h - 330, 150);
  ctx.text(msg[1], 512, h - 150, 150);





  ctx.restore();
  // ctx.fillStyle = C[opts.bgColor];
  // ctx.globalAlpha = state.alpha;
  // ctx.fillRect(0, 0, 1024, 1024);
  // ctx.globalAlpha = 1.0;

  // if (state.t > 0.1) {
  //   rendermsg(ctx, 0);
  // }
  // if (state.t > 0.55) {
  //   rendermsg(ctx, 1);
  // }

}