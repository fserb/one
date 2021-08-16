import {TAU, clamp} from "./utils.js";

export function linear(v0, slope) {
  return t => v0 + slope * t;
}

export function pow(a, exp) {
  return t => a * Math.exp(exp * t);
}

export function VSAJ(value, speed = 0, acceleration = 0 , jerk = 0) {
  return t => value + speed * t + acceleration * t ** 2 / 2 +
    jerk * t ** 3 / 6;
}

export function DAHDSR({
  delay = 0, attack = 0, hold = 0, decay = 0, sustain = 0, release = 0,
  initv = 0.0, peakv = 1.0, sustainv = 0.5, finalv = 0} = {}) {
  const ret = t => {
    let s = 0;
    if (t < s + delay) return initv;
    s += delay;
    if (t < s + attack) return initv + (peakv - initv) * (t - s) / attack;
    s += attack;
    if (t < s + hold) return peakv;
    s += hold;
    if (t < s + decay) return peakv + (sustainv - peakv) * (t - s) / decay;
    s += decay;
    if (t < s + sustain) return sustainv;
    s += sustain;
    if (t < s + release) {
      return sustainv + (finalv - sustainv) * (t - s) / release;
    }
    return finalv;
  }
  ret.total = delay + attack + hold + decay + sustain + release;
  return ret;
}

export function DAHDSRexp({
  delay = 0, attack = 0, hold = 0, decay = 0, sustain = 0, release = 0,
  initv = 0.0, peakv = 1.0, sustainv = 0.5, finalv = 0} = {}) {
  initv = Math.max(0.001, initv);
  peakv = Math.max(0.001, peakv);
  sustainv = Math.max(0.001, sustainv);
  finalv = Math.max(0.001, finalv);

  const ret = t => {
    let s = 0;
    if (t < s + delay) return initv;
    s += delay;
    if (t < s + attack) return initv * (peakv / initv) ** ((t - s) / attack);
    s += attack;
    if (t < s + hold) return peakv;
    s += hold;
    if (t < s + decay) return peakv * (sustainv / peakv) ** ((t - s) / decay);
    s += decay;
    if (t < s + sustain) return sustainv;
    s += sustain;
    if (t < s + release) {
      return sustainv * (finalv / sustainv) ** ((t - s) / release);
    }
    return finalv;
  }
  ret.total = delay + attack + hold + decay + sustain + release;
  return ret;
}

export function ADSR(args) {
  if (args.type == "exp") return DAHDSRexp(args);
  return DAHDSR(args);
}

export function lfo(type, freq, minv, maxv) {
  const w = wave(type, freq);
  const delta = (maxv - minv) * 0.5;
  return t => minv + w(t) * delta + delta;
}

export function wave(type, freq = 0) {
  switch(type) {
    case "sine": return (t, i=0) => Math.sin(TAU * t * freq + i);
    case "square": return (t, i=0) => Math.sign(Math.sin(TAU * t * freq + i));
    case "saw": return (t, i=0) => {
      const v = t * freq + i;
      return 2 * (v - Math.floor(0.5 + v));
    };
    case "triangle": return (t, i=0) => {
      const v = t * freq + i;
      return 2 * Math.abs(2 * (v - Math.floor(0.5 + v))) - 1
    };
    case "tangent": return (t, i=0) =>
      clamp(0.2 * Math.tan(TAU * t * freq + i), -1, 1);
    case "white": return _t => 2 * Math.random() - 1;
    case "pink":
      const s = [0, 0, 0, 0, 0, 0, 0];
      return _t => {
        const w = 2 * Math.random() - 1;
        s[0] = 0.99886 * s[0] + w * 0.0555179;
        s[1] = 0.99332 * s[1] + w * 0.0750759;
        s[2] = 0.96900 * s[2] + w * 0.1538520;
        s[3] = 0.86650 * s[3] + w * 0.3104856;
        s[4] = 0.55000 * s[4] + w * 0.5329522;
        s[5] = -0.7616 * s[5] - w * 0.0168980;
        const o = s[0] + s[1] + s[2] + s[3] + s[4] + s[5] + s[6] + w * 0.5362;
        s[6] = w * 0.115926
        return o * 0.11;
    }
    case "brown":
      let last = 0;
      return _t => {
        const w = 2 * Math.random() - 1;
        // SmoothData = SmoothData - (LPF_Beta * (SmoothData - RawData));
        const o = (last + (0.02 * w)) / 1.02;
        last = o;
        return o * 3.5;
      }
  }
}
