/*

Examples:
http://www.javelinart.com/FM_Synthesis_of_Real_Instruments.pdf


*/
import {wave} from "./signal.js";

export function fmmod(block, state) {
  state.param('freq', 440);
	state.param('amp', 1);
  state.param('fm', 1);

  let func;
  if (typeof state._params['fm'] !== "function") {
    func = () => state._params['fm'];
  } else {
    func = state._params['fm'];
  }

	for (let n = 0; n < block.length; ++n) {
		state(n);
		block[n] += state.amp * func(n / state.SR, state.freq);
	}
}

export function fm(freq, opts = {}, mod = []) {
  opts = Object.assign({
    fixed: false,
    wave: "sine",
    env: 1,
  }, opts);

  const w = wave(opts.wave, 1);

  let env;
  if (typeof opts.env !== "function") {
    env = () => opts.env;
  } else {
    env = opts.env;
  }

  return (t, f) => {
    let input = 0;
    for (const m of mod) {
      input += m(t, f);
    }
    if (freq == 0) {
      return env(t) * input;
    } else {
      const fr = opts.fixed ? freq : f * freq;
      return env(t) * w(t * fr, input);
    }
  };
}