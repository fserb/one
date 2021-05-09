import * as one from "./one/one.js";
import {C, act, ease, mouse} from "./one/one.js";

one.description("game", `
how to play
`);

one.options({
  bgColor: 12,
  fgColor: 9,
  shColor: 11,
});

function init() {
}

function update(tick) {
}

function render(ctx) {
}

export default one.game(init, update, render);
