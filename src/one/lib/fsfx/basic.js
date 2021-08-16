const TAU = Math.PI * 2;

import {wave} from "./signal.js";
import {convolveReal as FFTConvolve} from "./fft.js";

function _template(block, state) {
  for (let n = 0; n < block.length; ++n) {
		state(n);

    block[n] = 0;
  }
}

export function mix(block, state) {
  state.param('channel', null);
  state.param('amp', 1);

	for (let n = 0; n < state.channel.block.length; ++n) {
    state(n);
    block[n] += state.amp * state.channel.block[n];
  }
}

// this is like an oscillator, but it has inherit frequency
// and receives the value from a parameter.
// it's the equivalent of a oscillator constant @amp enveloped by @wave.
export function synthetize(block, state) {
  state.param('wave', 1);
	state.param('amp', 1);

	for (let n = 0; n < block.length; ++n) {
		state(n);
		block[n] += state.amp * state.wave;
	}
}

export function oscillator(block, state) {
  state.param('type', 'sine');
	state.param('freq', 1);
	state.param('amp', 1);

  let phase = 0;
  const phaseStep = 1 / state.SR;
  const signal = wave(state.type, 1);

	for (let n = 0; n < block.length; ++n) {
		const p = state(n);
    phase += phaseStep;
		block[n] += p.amp * signal(p.freq * phase);
	}
}

export function envelope(block, state) {
  state.param('env', 1);

	for (let n = 0; n < block.length; ++n) {
		const p = state(n);
    block[n] *= p.env;
  }
}

export function interpolate(block, x, a = 3) {
  const mf = Math.floor(x);
  let acc = 0;
  const L = v => v == 0 ? 1 :
    a * Math.sin(Math.PI * v) * Math.sin(Math.PI * v / a) /
    (Math.PI * Math.PI * v * v);

  for (let i = mf - a + 1; i <= mf + a; ++i) {
    acc += (block[i] ?? 0) * L(x - i);
  }
  return acc;
}

export function combf(block, state) {
  state.param("delay", 0);
  state.param("gain", 1);

	for (let n = block.length - 1; n >= 0; --n) {
		const p = state(n);
    block[n] += p.gain * interpolate(block, n - p.delay * p.SR);
  }
}

export function combi(block, state) {
  state.param("delay", 0);
  state.param("gain", 1);
  state.param("norm", 1);

	for (let n = 0; n < block.length; ++n) {
		const p = state(n);
    block[n] = (block[n] + p.gain * interpolate(block, n - p.delay * p.SR)) * p.norm;
  }
}

export function multidelay(block, state) {
  state.param('delay', 0.0015);
  state.param('M', 8);
  state.param('wet', 1.0);

  for (let n = block.length - 1; n >= 0; --n) {
		const p = state(n);

    const D = p.delay * p.SR;
    const g = p.wet / p.M;
    let acc = (1 - p.wet) * block[n];
    for (let i = 0; i < p.M; ++i) {
      acc += g * interpolate(block, n - (i + 1) * D, 3);
    }
    block[n] = acc;
  }
}

export function convolveFFT(block, state) {
  state.param("impulse", []);

  let work = block;
  let impulse = state.impulse;

  if (state.impulse.length > block.length) {
    work = new Float32Array(state.impulse.length);
    for (let i = 0; i < block.length; ++i) {
      work[i] = block[i];
    }
  } else if (state.impulse.length < block.length) {
    impulse = new Float32Array(block.length);
    for (let i = 0; i < state.impulse.length; ++i) {
      impulse[i] = state.impulse[i];
    }
  }

  FFTConvolve(work, impulse);

  if (work !== block) {
    for (let i = 0; i < block.length; ++i) {
      block[i] = work[i];
    }
  }
}

export function convolveStraight(block, state) {
  state.param("impulse", []);
  for (let n = block.length - 1; n >= 0; --n) {
    let out = 0;
    for (let i = 0; i < state.impulse.length && i <= n; ++i) {
      out += block[n - i] * state.impulse[i];
    }

    block[n] = out;
  }
}

export function convolve(block, state) {
  state.param("impulse", []);

  const N = Math.max(block.length, state.impulse.length);
  const costFFT = N * Math.log(N) * 4;
  const costStraight = block.length * state.impulse.length;

  if (costStraight < costFFT) {
    convolveStraight(block, state);
  } else {
    convolveFFT(block, state);
  }
}

export function sinc(block, state) {
  state.param("window", "blackman");
  state.param("M", 10);
  state.param("freq", 440);

  let h = null, w = null;
  state.update(p => {
    h = new Float32Array(p.M);
    const fc = p.freq / p.SR;
    for (let n = 0; n < p.M; ++n) {
      const sn = n - (p.M - 1) / 2;
      h[n] = Math.sin(TAU * fc * sn) / (Math.PI * sn);
    }

    if (p.window == "hamming") {
      for (let n = 0; n < p.M; ++n) {
        h[n] *= 0.54 - 0.46 * Math.cos(TAU * n / p.M);
      }
    } else if (p.window == "blackman") {
      const fr = TAU / p.M;
      for (let n = 0; n < p.M; ++n) {
        h[n] *= 0.42 - 0.5 * Math.cos(fr * n) + 0.08 * Math.cos(2 * fr * n);
      }
    }
  });

  state.call(convolve, {impulse: h});
}

// https://webaudio.github.io/Audio-EQ-Cookbook/Audio-EQ-Cookbook.txt
/*
          b0 + b1*z^-1 + b2*z^-2
  H(z) = ------------------------
          a0 + a1*z^-1 + a2*z^-2
*/
export function computeBiquadParameters(type, freq, SR,
  {Q = undefined, dbgain = 1, BW = undefined}) {
  const w0 = TAU * freq / SR;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const alpha = (Q !== undefined) ? sinw0 / (2 * Q) :
    sinw0 * Math.sinh(Math.LN2 / 2 * BW * w0 / sinw0);
  const A = 10 ** (dbgain / 40);

  let _a0, _a1, _a2, _b0, _b1, _b2, _SQA;
  switch(type) {
  case "lowpass":
    _b0 = (1 - cosw0) / 2;
    _b1 = 1 - cosw0;
    _b2 = (1 - cosw0) / 2;
    _a0 = 1 + alpha;
    _a1 = -2 * cosw0;
    _a2 = 1 - alpha;
    break;
  case "highpass":
    _b0 = (1 + cosw0) / 2;
    _b1 = -(1 + cosw0);
    _b2 = (1 + cosw0) / 2;
    _a0 = 1 + alpha;
    _a1 = -2 * cosw0;
    _a2 = 1 - alpha;
    break;
  case "bandpass":
    _b0 = alpha;
    _b1 = 0;
    _b2 = -alpha;
    _a0 = 1 + alpha;
    _a1 = -2 * cosw0;
    _a2 = 1 - alpha;
    break;
  case "notch":
    _b0 = 1;
    _b1 = -2 * cosw0;
    _b2 = 1;
    _a0 = 1 + alpha;
    _a1 = -2 * cosw0;
    _a2 = 1 - alpha;
    break;
  case "peak":
    _b0 = 1 + alpha * A;
    _b1 = -2 * cosw0;
    _b2 = 1 - alpha * A;
    _a0 = 1 + alpha / A;
    _a1 = -2 * cosw0;
    _a2 = 1 - alpha / A;
    break;
  case "allpass":
    _b0 =  1 - alpha;
    _b1 = -2 * cosw0;
    _b2 =  1 + alpha;
    _a0 =  1 + alpha;
    _a1 = -2 * cosw0;
    _a2 =  1 - alpha;
    break;
  case "lowshelf":
    _SQA = Math.sqrt(A);
    _b0 = A * ((A + 1) - (A - 1) * cosw0 + 2 * _SQA * alpha);
    _b1 = 2 * A * ((A - 1) - (A + 1) * cosw0)
    _b2 = A * ((A + 1) - (A - 1) * cosw0 - 2 * _SQA * alpha);
    _a0 = (A + 1) + (A - 1) * cosw0 + 2 * _SQA * alpha;
    _a1 = -2 * ((A - 1) + (A + 1) * cosw0);
    _a2 = (A + 1) + (A - 1) * cosw0 - 2 * _SQA * alpha;
    break;
  case "highshelf":
    _SQA = Math.sqrt(A);
    _b0 = A * ((A + 1) + (A - 1) * cosw0 + 2 * _SQA * alpha);
    _b1 = -2 * A * ((A - 1) + (A + 1) * cosw0);
    _b2 = A * ((A + 1) + (A - 1) * cosw0 - 2 * _SQA * alpha);
    _a0 = (A + 1) - (A - 1) * cosw0 + 2 * _SQA * alpha;
    _a1 = 2 * ((A - 1) - (A + 1) * cosw0);
    _a2 = (A + 1) - (A - 1) * cosw0 - 2 * _SQA * alpha;
    break;
  default:
    console.error("invalid type:", type);
  }
  return [
     _a1 / _a0,
     _a2 / _a0,
     _b0 / _a0,
     _b1 / _a0,
     _b2 / _a0,
  ];1
}

export function biquad(block, state) {
  state.param('type', 'lowpass');
  state.param('freq', 1);
  state.param('Q', Math.SQRT1_2); // Q-factor 0.0001-1000
  state.param('dbgain', 1); // dB gain

  let a1 = 0, a2 = 0, b0 = 0, b1 = 0, b2 = 0;
  state.update(p => {
    [a1, a2, b0, b1, b2] =
      computeBiquadParameters(state.type, p.freq, p.SR,
        {Q: p.Q, dbgain: p.dbgain});
  });

  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;

  for (let n = 0; n < block.length; ++n) {
		state(n);

    const x0 = block[n];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;

    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    block[n] = y0;
  }
}

const complexMul = (x, y) => { return {
  a: x.a * y.a - x.b * y.b, b: x.a * y.b + y.a * x.b }};

const complexDiv = (x, y) => { return {
  a: (x.a * y.a + x.b * y.b) / (y.a * y.a + y.b * y.b),
  b: (x.b * y.a - x.a * y.b) / (y.a * y.a + y.b * y.b)
}};

export function biquadResponse(freqs, type, freq, SR, opts) {
  const [a1, a2, b0, b1, b2] = computeBiquadParameters(type, freq, SR, opts);

  const out = [];

  for (const f of freqs) {
    const omega = -TAU * f / SR;
    const z = {a: Math.cos(omega), b: Math.sin(omega)};

    const numerator = complexMul({a: b1 + b2 * z.a, b: b2 * z.b }, z);
    numerator.a += b0;

    const denominator = complexMul({a: a1 + a2 * z.a, b: a2 * z.b}, z);
    denominator.a += 1;

    const res = complexDiv(numerator, denominator);

    out.push({
      mag: Math.hypot(res.a, res.b),
      phase: Math.atan2(res.b, res.a) });
  }
  return out;
}
