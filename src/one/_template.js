/*


*/
import * as one from "./one/one.js";
import {C, act, ease, mouse, vec, camera} from "./one/one.js";

one.description("name", `
instructions
`);

const L = {
  bg: C[11],
  fg: C[19],
};

one.options({
  bgColor: L.bg,
  fgColor: L.fg,
});

function init() {
}

function update(tick) {
}

function render(ctx) {
}

export default one.game(init, update, render);
