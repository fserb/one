import {C, desc, act, opts, mouse, ease, stages, startGame} from "./one.js";

const state = {
  alpha: 0.0,
  t: 0.0
};

let msg;

export function init() {
  act(state).attr("alpha", 0.75, 0.35).then()
    .attr("t", 1.0, 0.5);

  msg = opts.finishGood ? [ "WELL", "DONE" ] : [ "GAME", "OVER" ];
}

export function update(tick) {
  if (act(state).is()) return;

  if (mouse.click) {
    startGame();
  }
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

  ctx.fillStyle = C[opts.bgColor];
  ctx.globalAlpha = state.alpha;
  ctx.fillRect(0, 0, 1024, 1024);
  ctx.globalAlpha = 1.0;

  if (state.t > 0.1) {
    rendermsg(ctx, 0);
  }
  if (state.t > 0.55) {
    rendermsg(ctx, 1);
  }

}