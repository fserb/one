/*
FSFX

Track - a block of memory that has a sampleRate and duration. It's also able to
deal with integer oversampling. And knows how to call modules to process itself.
Internally, it builds a State for each module, containing its parameters and
signals.

Signal - (time, phase) => float
Represents a value that changes over time.
It can be a linear/pow function, a VSAJ (value, speed, acceleration, jerk), a
ADSR or a wave / random.
It can also be modulated with the fm() and phase() functions.

Modules - process a Track in place.

Low level:
- oscillator: generates a wave in a free-phase frequency
- synthetize: reproduces a wave
- mix: mixes another track
- envelope: envelope amplitude
- combi: feed-forward comb filter
- combf: feedback comb filter
- multidelay: multi-tap delay
- convolve: convolve an impulse wave
- sinc: sinc filter with blackman and hamming window
- biquad: biquad filter (lowpass, highpass, bandpass, notch, peak, allpass,
  lowshelf, highshelf)

High level:
- phaser
- compressor
- eq5
- eq3
- tremolo
- ringmod
- flanger
- chorus
- vibrato
- wah-wah

*/

import Player from "./player.js";
export {Player};

export * from "./synth.js";
export * from "./signal.js";
export * from "./basic.js";
export * from "./modules.js";
export * from "./karplus.strong.js";
export * from "./fm.js";
export * from "./music.js";