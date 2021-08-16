import {TAU, dblin, lindb} from "./utils.js";
import {lfo, wave} from "./signal.js";
import {computeBiquadParameters, interpolate, biquad, multidelay,
  combi, convolve, sinc} from "./basic.js";

export function reverse(block, state) {
  let i = 0;
  let j = block.length - 1;
  while(i < j) {
    [block[i], block[j]] = [block[j], block[i]];
    i++;
    j--;
  }
}

export function echo(block, state) {
  state.param("delay", 0.15);
  state.param("g", 0.5);

  const g = state.g;
  const g2 = g * g;
  const D = state.delay * state.SR;
  const inter = new Float32Array(block.length);
  for (let n = 0; n < block.length; ++n) {
    const past = interpolate(inter, n - D);
    inter[n] = block[n] + g * past;
    block[n] = (-g * inter[n] + past);
  }
}

export function reverb(block, state) {
  state.param("delay", 0.100);
  state.param("fall", 1/3);
  state.param("g", 0.7);
  state.param("steps", 5);

  let D = state.delay;
  let G = state.g;
  const F = state.fall;
  const H = 0.25;

  for (let i = 0; i < state.steps; ++i) {
    state.call(echo, {delay: D, g: G});
    D *= F;
    G *= H;
  }
}

export function bitcrush(block, state) {
  state.param("bits", 64);
  state.param("sample", 1);


  if (state.sample > 1) {
    const cutoff = state.SR / (state.sample * 2);
    state.call(sinc, {freq: cutoff, M: 100});
  }

  let value = 0;
  for (let n = 0; n < block.length; ++n) {
		state(n);

    if (n % state.sample == 0) {
      value = Math.round(block[n] * state.bits) / state.bits;
    }
    block[n] = value;
  }
}

export function phaser(block, state) {
  state.param("freq", 0.3);
  state.param("Q", Math.SQRT1_2);
  state.param("depth", 1);
  state.param("feedback", 0.5);

  const MF = Math.min(26000, state.SR / 2);

  const wlfo = lfo("triangle", state.freq, 0, 1);

  const filters = [
    1600, 3300, 4800, 9800, 16000, MF
  ].map(x => { return {maxf: x, x1: 0, x2:0, y1:0, y2: 0}});

  let last = 0;
  for (let n = 0; n < block.length; ++n) {
		state(n);
    const lfofreq = wlfo(n / state.SR);
    let x = block[n] * (1 - state.feedback) + state.feedback * last;

    for (const f of filters) {
      const maxf = f.maxf;
      const minf = maxf / 100;
      const freq = lfofreq * (maxf - minf) + minf;
      const [a1, a2, b0, b1, b2] =
        computeBiquadParameters("allpass", freq, state.SR, {Q: state.Q});

      const x0 = x;
      const y0 = b0 * x0 + b1 * f.x1 + b2 * f.x2 - a1 * f.y1 - a2 * f.y2;
      f.x2 = f.x1;
      f.x1 = x0;
      f.y2 = f.y1;
      f.y1 = y0;
      x = y0;
    }

    last = x;
    const w = state.depth * 0.5;
    block[n] = block[n] * (1 - w) + x * w;
  }
}

export function compressor(block, state) {
  state.param("delay", 0.00006); // delay of signal samples
  state.param("gain", 2); // final gain
  state.param("LT", -10); // limiter
  state.param("CT", -25); // compress
  state.param("ET", -50); // expand
  state.param("NT", -70); // noise
  state.param("R", 2);    // how aggressive the slope for compress/expand is
  state.param("downsample", 1); // downsample f calculation
  state.param("attack", 0.003); // attack for f -> g
  state.param("release", 0.250);  // release for f -> g
  state.param("avg", 0.1);  // window smooth for xpeak/xrms

  const AT = 1 - Math.exp(-2.2 * 1000 / (state.attack * state.SR));
  const RT = 1 - Math.exp(-2.2 * 1000 / (state.release * state.SR));
  const TAV = 1 - Math.exp(-2.2 * 1000 / (state.avg * state.SR));

  const LV = state.CT + (state.LT - state.CT) / state.R;

  const DELAY = Math.round(state.delay * state.SR);
  const buffer = new Array(DELAY);
  for (let i = 0; i < DELAY; ++i) buffer[i] = 0;

  let xpeak = 0;
  let xrms2 = 0;
  let g = 1;
  let f = 1;
  for (let n = 0; n < block.length; ++n) {
		state(n);

    if (n % state.downsample == 0) {
      const abs = Math.abs(block[n]);
      xpeak = abs <= xpeak ? (1 - RT) * xpeak : (1 - AT) * xpeak + AT * abs;
      xrms2 = (1 - TAV) * xrms2 + TAV * (block[n] ** 2);

      let F = 0;
      const XP = lindb(xpeak);
      const XR = lindb((xrms2**0.5) / 2);

      if (XP >= state.LT) {
        // limiter
        F = LV - XP;
      } else if (XR > state.CT) {
        F = (state.CT - XR) * (1 - 1 / state.R);
      } else if (XR > state.ET) {
        F = 0;
      } else if (XR > state.NT) {
        F = (state.ET - XR) * (1 - state.R);
      } else {
        F = -1000;
      }

      f = dblin(F);
    }

    const k = f < g ? RT : AT;
    g = (1 - k) * g + k * f;

    buffer.push(block[n]);
    const delayed = buffer.splice(0, 1);
    block[n] = state.gain * g * delayed[0];
  }
}

export function eq5(block, state) {
  state.param("low", 1);
  state.param("lowmid", 1);
  state.param("mid", 1);
  state.param("midhigh", 1);
  state.param("high", 1);

  state.call(biquad, {type: "lowshelf", freq: 200, Q: 1, dbgain: state.low});
  state.call(biquad, {type: "peak", freq: 350, Q: 1, dbgain: state.lowmid});
  state.call(biquad, {type: "peak", freq: 1000, Q: 1, dbgain: state.mid});
  state.call(biquad, {type: "peak", freq: 3000, Q: 1, dbgain: state.midhigh});
  state.call(biquad, {type: "highshelf", freq: 5000, Q: 1, dbgain: state.high});
}

export function eq3(block, state) {
  state.param("low", 1);
  state.param("mid", 1);
  state.param("high", 1);

  state.call(biquad, {type: "lowshelf", freq: 200, Q: 1, dbgain: state.low});
  state.call(biquad, {type: "peak", freq: 1000, Q: 0.4, dbgain: state.mid});
  state.call(biquad, {type: "highshelf", freq: 5000, Q: 1, dbgain: state.high});
}

export function tremolo(block, state) {
  state.param("depth", 1);
  state.param("freq", 5);
  state.param("type", "sine");

  const signal = lfo(state.type, state.freq, 0, state.depth);
  for (let n = 0; n < block.length; ++n) {
    // const p = state(n);
    block[n] = signal(n / state.SR) * block[n];
  }
}

export function ringmod(block, state) {
  state.param("type", "sine");
  state.param("freq", 1620);
  state.param("wet", 0.5);

  let phase = 0;
  const phaseStep = 1 / state.SR;
  const signal = wave(state.type, 1);

  for (let n = 0; n < block.length; ++n) {
		const p = state(n);
    phase += phaseStep;
    block[n] = (1 - p.wet) * block[n] +
      p.wet * block[n] * signal(p.freq * phase);
  }
}

export function flanger(block, state) {
  state.param("strength", 0.5);
  state.param("freq", 1);

  const w = lfo("sine", state.freq, 0, state.strength * 0.03);
  state.call(combi, {delay: w, gain: 1, norm: 0.5});
}

export function chorus(block, state) {
  state.param('strength', 1);
  state.param('M', 8);
  state.param('wet', 0.5);

  const delay = [];
  for (let i = 0; i < state.M; ++i) {
    delay[i] = 0.01 + Math.random() * 0.015;
  }

	for (let n = block.length - 1; n >= 0; --n) {
		const p = state(n);

    const g = p.wet / p.M;
    let acc = (1 - p.wet) * block[n];
    for (let i = 0; i < p.M; ++i) {
      const D = p.strength * delay[i] * p.SR;
      acc += g * interpolate(block, n - (i + 1) * D, 3);
    }
    block[n] = acc;
  }
}

export function vibrato(block, state) {
  state.param("freq", 5.8);  // 5-14 Hz
  state.param("type", "sine");
  state.param("delay", 0.0003);  // 5-10ms
  state.param("wet", 1.0);
  state.param("M", 8);

  const w = lfo(state.type, state.freq, 0, state.delay);

  state.call(multidelay, {
    delay: w,
    wet: state.wet,
    M: state.M
  });
}

export function wahwah(block, state) {
  state.param('type', 'triangle');
  state.param('freq', 1);
  state.param('Q', 1.2);
  state.param('mix', 1.0);

  let phase = 0;
  const phaseStep = 1 / state.SR;
  const signal = lfo(state.type, 1, 1500, 2500);

  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let n = 0; n < block.length; ++n) {
		const p = state(n);

    phase += phaseStep;
    const freq = signal(p.freq * phase);

    const w0 = TAU * freq / p.SR;
    const alpha = Math.sin(w0) / (2 * p.Q);
    const a1 = (-2 * Math.cos(w0)) / (1 + alpha);
    const a2 = (1 - alpha) / (1 + alpha);
    const b0 = alpha / (1 + alpha);
    const b2 = -alpha / (1 + alpha);

    const x0 = block[n];
    const y0 = b0 * x0 + b2 * x2 - a1 * y1 - a2 * y2;

    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;

    block[n] = (1 - p.mix) * x0 + p.mix * y0;
  }
}