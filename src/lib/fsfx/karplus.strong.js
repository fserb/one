const TAU = Math.PI * 2;

// http://www.music.mcgill.ca/~gary/courses/papers/Karplus-Strong-CMJ-1983.pdf
// http://musicweb.ucsd.edu/~trsmyth/papers/KSExtensions.pdf

/*

              +---+ a   +---+
x / 0 ------->| B +-+-->| D +--> y
        ^     +---+ |   +---+
        |b          v
        |  +---+  +---+
        +--+ C |<-+ A |
           +---+  +---+

where

B = Z^-p
D = (1 - R) / (1 - RZ^-1)
A = (1 - S) + SZ^-1
C = (C + Z^-1) / (1 + CZ^-1)

A <- low pass filter of Karplus-Strong (the original one)
B <- wavetable
C <- pitch correction due to quantization on Math.floor(N)
D <- dynamics

(notice that the "block C" contains the constant C)

A and C are merged for code simplicity.
We end up with 3 signals: a, b, y.

b is the recorded signal on the wavetable.
a is the time delayed value
y is the final result

where:
a = z^-p
b = (AC) * a
y = D * b

we shortcircuit x with 0, as god intended.

There's also a multiplier F that represents energy loss and used for drums.

*/
export function karplus_strong(block, state) {
  state.param("freq", 55);
  state.param("rho", 0.996);
  state.param("amp", 1);
  state.param("delay", 0);
  state.param("b", 1);
  state.param("S", 0.5);
  state.param("L", state.SR); // dynamic level (Hertz)

  const delay = Math.round(state.SR * state.delay);
  let p = 0;
  let wavetable = new Float32Array(0);
  let C = 0;
  let R = 0;

  state.update(s => {
    const Ts = 1 / s.SR;
    const w1Ts = TAU * s.freq * Ts;
    const P1 = s.SR / s.freq;
    const e = 0; // offset shifts Pc into [e, 1 + e]
    // Pa could be very well approximated to sS
    const Pa = s.S * Math.sin(w1Ts) / (w1Ts * (1 - s.S) + s.S*w1Ts*Math.cos(w1Ts));
    const N = Math.floor(P1 - Pa - e);
    const Pc = P1 - N - Pa;
    C = Math.sin((w1Ts - w1Ts * Pc) / 2) / Math.sin((w1Ts + w1Ts * Pc) / 2);

    if (s.L > 0) {
      const fm = Math.sqrt(s.freq * (s.SR / 2));
      const Rl = Math.exp(-Math.PI * s.L * Ts);

      const Gl = (1 - Rl) / Math.sqrt(
        Rl * Rl * (Math.sin(TAU * fm * Ts) ** 2) +
        (1 - Rl * Math.cos(TAU * fm * Ts)) ** 2);

      const Ra = (1 - Gl * Gl * Math.cos(TAU * s.freq * Ts)) / (1 - Gl * Gl);
      const Rb = 2 * Gl * Math.sin(Math.PI * s.freq * Ts) *
        Math.sqrt(1 - Gl * Gl * (Math.cos(Math.PI * s.freq * Ts) ** 2)) /
        (1 - Gl * Gl);
      const R1 = Ra + Rb;
      const R2 = Ra - Rb;

      R = R1 < 1 ? R1 : R2;
    }
    p = N;
    wavetable = new Float32Array(p);
    for (let i = 0; i < p; ++i) {
      wavetable[i] = (Math.random() * 2 - 1) * s.amp;
    }
  });

  let cur = 0;
  let yn1 = 0;
  let bn1 = 0;
  let an2 = 0;
  let an1 = 0;
  for (let n = delay; n < block.length; ++n) {
    const s = state(n);
    const sign = Math.random() < s.b ? 1 : -1;
    const F = s.rho * sign;

    const an = wavetable[cur];

    const bn = -bn1 * C +
      F * s.S * an2 +
      F * (1 - s.S + s.S * C) * an1 +
      F * (C - s.S * C) * an;

    const yn = (1 - R) * an + R * yn1;

    yn1 = yn;
    bn1 = bn;
    an2 = an1;
    an1 = wavetable[cur];
    wavetable[cur] = bn;
    block[n] += yn;
    cur = (cur + 1) % p;
  }
}
// (Z^(-n)(1 - R)/(1 - R*Z^-1))/(1 - ((1-S) + SZ^-1)*((C+Z^-1)/(1 + C*Z^-1)*Z^-n))
