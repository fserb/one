/*
 * sfxr.js - Tomas Pettersson's sfxr, the synth behind the entity games.
 *
 * Down the line sfxr (2007) -> Mike Wiering (2009) -> as3fxr (2010). Seven
 * generators roll a parameter set, and render() turns one into samples.
 *
 * Not a second general-purpose synth beside fsfx: one fixed voice, an
 * oscillator, an envelope, a slide, two filters and a phaser, with randomisers
 * tuned to land on arcade noises. What makes it sound like itself is what fsfx
 * has no module for: the noise is a 32-entry buffer refilled once a period, so
 * it is pitched rather than white; the period is a whole number of samples, so
 * the pitch crunches as it climbs; and eight sub-samples average into every
 * output sample.
 *
 * A generator returns a whole options set off its seed, and spreading it leaves
 * every field open to override, so a rolled sound and a hand-built one are the
 * same kind of thing. `vol` sets masterVolume to 2v, and render() squares that.
 * A key sfxr does not have throws. The game names the generators it wants, so
 * the rest stay out of its bundle.
 *
 * ```js
 * sound.voice("boom", { ...explosion(1238), vol: 0.2 });
 * sound.voice("thud", { waveType: 2, startFrequency: 0.14, slide: -0.1 });
 *
 * sound.make("boom", 0.6, (track) => {
 *   track(sfxr, { ...explosion(1238), vol: 0.2 });
 *   track(multidelay, { delay: 0.03, M: 4, wet: 0.3 });
 * }, SAMPLE_RATE);
 * ```
 *
 * `sfxr` is an fsfx stage as well, so a voice can go on through fsfx's filters
 * and delays. It does not resample, so the Track has to run at SAMPLE_RATE and
 * it throws when the Track does not. The generator runs before the track rather
 * than riding in as a parameter, since fsfx's State reads any function among
 * its parameters as a signal of time.
 *
 * Two things differ from as3fxr: it writes 16-bit shorts where this keeps the
 * floats Web Audio wants, and it filled the noise buffer from an unseeded
 * Math.random(), so a seeded explosion came out different every render. Here
 * `seed` starts a second stream for the noise and fixes the whole sound.
 */

// The constants below are tuned for this rate. alma's Audio.put() takes it, so
// the samples resample into whatever the AudioContext is running at.
export const SAMPLE_RATE = 44100;

// Anything this long is a runaway parameter set, not a sound effect.
const MAX_SAMPLES = SAMPLE_RATE * 30;

const MAX_INT = 2147483647;

// The original recurrence, including its loss of precision above 2^53.
function rng(seed) {
  let state = seed ?? Math.floor(Math.random() * MAX_INT);
  return () => {
    state = (1103515245 * state + 12345) % MAX_INT;
    return state / MAX_INT;
  };
}

// Every field sfxr has, at its rest value, and the whole set of keys an options
// object is allowed to override.
const DEFAULTS = {
  waveType: 0, // 0 square, 1 saw, 2 sine, 3 noise
  masterVolume: 0.5,

  attackTime: 0,
  sustainTime: 0.3,
  sustainPunch: 0,
  decayTime: 0.4,

  startFrequency: 0.3,
  minFrequency: 0,

  slide: 0,
  deltaSlide: 0,

  vibratoDepth: 0,
  vibratoSpeed: 0,

  changeAmount: 0,
  changeSpeed: 0,

  squareDuty: 0,
  dutySweep: 0,

  repeatSpeed: 0,

  phaserOffset: 0,
  phaserSweep: 0,

  lpFilterCutoff: 1,
  lpFilterCutoffSweep: 0,
  lpFilterResonance: 0,

  hpFilterCutoff: 0,
  hpFilterCutoffSweep: 0,
};

// `seed` rides along for render() to start the noise from.
export function coin(seed) {
  const p = { ...DEFAULTS, seed };
  const r = rng(seed);
  p.startFrequency = 0.4 + r() * 0.5;
  p.sustainTime = r() * 0.1;
  p.decayTime = 0.1 + r() * 0.4;
  p.sustainPunch = 0.3 + r() * 0.3;
  if (r() < 0.5) {
    p.changeSpeed = 0.5 + r() * 0.2;
    p.changeAmount = 0.2 + r() * 0.4;
  }
  return p;
}

export function laser(seed) {
  const p = { ...DEFAULTS, seed };
  const r = rng(seed);
  p.waveType = Math.trunc(r() * 3);
  if (p.waveType === 2 && r() < 0.5) p.waveType = Math.trunc(r() * 2);
  p.startFrequency = 0.5 + r() * 0.5;
  p.minFrequency = p.startFrequency - 0.2 - r() * 0.6;
  if (p.minFrequency < 0.2) p.minFrequency = 0.2;
  p.slide = -0.15 - r() * 0.2;
  if (r() < 0.33) {
    p.startFrequency = 0.3 + r() * 0.6;
    p.minFrequency = r() * 0.1;
    p.slide = -0.35 - r() * 0.3;
  }
  if (r() < 0.5) {
    p.squareDuty = r() * 0.5;
    p.dutySweep = r() * 0.2;
  } else {
    p.squareDuty = 0.4 + r() * 0.5;
    p.dutySweep = -r() * 0.7;
  }
  p.sustainTime = 0.1 + r() * 0.2;
  p.decayTime = r() * 0.4;
  if (r() < 0.5) p.sustainPunch = r() * 0.3;
  if (r() < 0.33) {
    p.phaserOffset = r() * 0.2;
    p.phaserSweep = -r() * 0.2;
  }
  if (r() < 0.5) p.hpFilterCutoff = r() * 0.3;
  return p;
}

export function explosion(seed) {
  const p = { ...DEFAULTS, seed };
  const r = rng(seed);
  p.waveType = 3;
  if (r() < 0.5) {
    p.startFrequency = 0.1 + r() * 0.4;
    p.slide = -0.1 + r() * 0.4;
  } else {
    p.startFrequency = 0.2 + r() * 0.7;
    p.slide = -0.2 - r() * 0.2;
  }
  p.startFrequency *= p.startFrequency;

  if (r() < 0.2) p.slide = 0;
  if (r() < 0.33) p.repeatSpeed = 0.3 + r() * 0.5;

  p.sustainTime = 0.1 + r() * 0.3;
  p.decayTime = r() * 0.5;
  p.sustainPunch = 0.2 + r() * 0.6;

  if (r() < 0.5) {
    p.phaserOffset = -0.3 + r() * 0.9;
    p.phaserSweep = -r() * 0.3;
  }
  if (r() < 0.33) {
    p.changeSpeed = 0.6 + r() * 0.3;
    p.changeAmount = 0.8 - r() * 1.6;
  }
  return p;
}

export function powerup(seed) {
  const p = { ...DEFAULTS, seed };
  const r = rng(seed);
  if (r() < 0.5) p.waveType = 1;
  else p.squareDuty = r() * 0.6;
  if (r() < 0.5) {
    p.startFrequency = 0.2 + r() * 0.3;
    p.slide = 0.1 + r() * 0.4;
    p.repeatSpeed = 0.4 + r() * 0.4;
  } else {
    p.startFrequency = 0.2 + r() * 0.3;
    p.slide = 0.05 + r() * 0.2;
    if (r() < 0.5) {
      p.vibratoDepth = r() * 0.7;
      p.vibratoSpeed = r() * 0.6;
    }
  }
  p.sustainTime = r() * 0.4;
  p.decayTime = 0.1 + r() * 0.4;
  return p;
}

export function hit(seed) {
  const p = { ...DEFAULTS, seed };
  const r = rng(seed);
  p.waveType = Math.trunc(r() * 3);
  if (p.waveType === 2) p.waveType = 3;
  else if (p.waveType === 0) p.squareDuty = r() * 0.6;
  p.startFrequency = 0.2 + r() * 0.6;
  p.slide = -0.3 - r() * 0.4;
  p.sustainTime = r() * 0.1;
  p.decayTime = 0.1 + r() * 0.2;
  if (r() < 0.5) p.hpFilterCutoff = r() * 0.3;
  return p;
}

export function jump(seed) {
  const p = { ...DEFAULTS, seed };
  const r = rng(seed);
  p.waveType = 0;
  p.squareDuty = r() * 0.6;
  p.startFrequency = 0.3 + r() * 0.3;
  p.slide = 0.1 + r() * 0.2;
  p.sustainTime = 0.1 + r() * 0.3;
  p.decayTime = 0.1 + r() * 0.2;
  if (r() < 0.5) p.hpFilterCutoff = r() * 0.3;
  if (r() < 0.5) p.lpFilterCutoff = 1 - r() * 0.6;
  return p;
}

export function blip(seed) {
  const p = { ...DEFAULTS, seed };
  const r = rng(seed);
  p.waveType = Math.trunc(r() * 2);
  if (p.waveType === 0) p.squareDuty = r() * 0.6;
  p.startFrequency = 0.2 + r() * 0.4;
  p.sustainTime = 0.1 + r() * 0.1;
  p.decayTime = r() * 0.2;
  p.hpFilterCutoff = 0.1;
  return p;
}

// An options set filled out into every field render() reads.
export function params({ seed: _seed, vol, ...over } = {}) {
  for (const k of Object.keys(over)) {
    if (!(k in DEFAULTS)) throw new Error(`sfxr: no parameter named ${k}`);
  }

  const p = { ...DEFAULTS, ...over };
  if (vol !== undefined) p.masterVolume = 2 * vol;
  return p;
}

const FIELDS = [
  "waveType",
  "attackTime",
  "sustainTime",
  "sustainPunch",
  "decayTime",
  "startFrequency",
  "minFrequency",
  "slide",
  "deltaSlide",
  "vibratoDepth",
  "vibratoSpeed",
  "changeAmount",
  "changeSpeed",
  "squareDuty",
  "dutySweep",
  "repeatSpeed",
  "phaserOffset",
  "phaserSweep",
  "lpFilterCutoff",
  "lpFilterCutoffSweep",
  "lpFilterResonance",
  "hpFilterCutoff",
  "hpFilterCutoffSweep",
  "masterVolume",
];

// The 24-field string the sfxr tools copy out. Returns null if it is not one.
export function fromString(s) {
  const values = s.split(",");
  if (values.length !== FIELDS.length) return null;

  const p = params();
  FIELDS.forEach((name, i) => {
    const f = Number.parseFloat(values[i]);
    p[name] = Number.isNaN(f) ? 0 : f;
  });
  p.waveType = Math.trunc(p.waveType);
  return p;
}

// To mono Float32 at SAMPLE_RATE. One outer step is one output sample, built
// from eight sub-samples of the oscillator.
export function render(opts = {}) {
  // Normalising the envelope times below writes to the set, and params() hands
  // back one nobody else holds.
  const p = params(opts);
  const seed = opts.seed;

  let period, maxPeriod, slide, deltaSlide;
  let squareDuty = 0, dutySweep = 0;
  let changeAmount, changeTime, changeLimit;

  // Everything reset(false) touches, which a repeat re-rolls.
  const partial = () => {
    period = 100 / (p.startFrequency * p.startFrequency + 0.001);
    maxPeriod = 100 / (p.minFrequency * p.minFrequency + 0.001);

    slide = 1 - p.slide * p.slide * p.slide * 0.01;
    deltaSlide = -p.deltaSlide * p.deltaSlide * p.deltaSlide * 0.000001;

    if (p.waveType === 0) {
      squareDuty = 0.5 - p.squareDuty * 0.5;
      dutySweep = -p.dutySweep * 0.00005;
    }

    changeAmount = p.changeAmount > 0
      ? 1 - p.changeAmount * p.changeAmount * 0.9
      : 1 + p.changeAmount * p.changeAmount * 10;
    changeTime = 0;
    changeLimit = p.changeSpeed === 1
      ? 0
      : Math.trunc((1 - p.changeSpeed) ** 2 * 20000 + 32);
  };

  partial();

  const masterVolume = p.masterVolume * p.masterVolume;
  const waveType = p.waveType;

  if (p.sustainTime < 0.01) p.sustainTime = 0.01;
  const total = p.attackTime + p.sustainTime + p.decayTime;
  if (total < 0.18) {
    const k = 0.18 / total;
    p.attackTime *= k;
    p.sustainTime *= k;
    p.decayTime *= k;
  }

  const sustainPunch = p.sustainPunch;
  let phase = 0;
  const minFrequency = p.minFrequency;

  const filters = p.lpFilterCutoff !== 1 || p.hpFilterCutoff !== 0;
  let lpFilterPos = 0;
  let lpFilterDeltaPos = 0;
  let lpFilterCutoff = p.lpFilterCutoff ** 3 * 0.1;
  const lpFilterDeltaCutoff = 1 + p.lpFilterCutoffSweep * 0.0001;
  let lpFilterDamping = 5 /
    (1 + p.lpFilterResonance * p.lpFilterResonance * 20) * (0.01 + lpFilterCutoff);
  if (lpFilterDamping > 0.8) lpFilterDamping = 0.8;
  lpFilterDamping = 1 - lpFilterDamping;
  const lpFilterOn = p.lpFilterCutoff !== 1;

  let hpFilterPos = 0;
  let hpFilterCutoff = p.hpFilterCutoff * p.hpFilterCutoff * 0.1;
  const hpFilterDeltaCutoff = 1 + p.hpFilterCutoffSweep * 0.0003;

  let vibratoPhase = 0;
  const vibratoSpeed = p.vibratoSpeed * p.vibratoSpeed * 0.01;
  const vibratoAmplitude = p.vibratoDepth * 0.5;

  let envelopeVolume = 0;
  let envelopeStage = 0;
  let envelopeTime = 0;
  const envelopeLength0 = p.attackTime * p.attackTime * 100000;
  const envelopeLength1 = p.sustainTime * p.sustainTime * 100000;
  const envelopeLength2 = p.decayTime * p.decayTime * 100000 + 10;
  let envelopeLength = envelopeLength0;

  const phaser = p.phaserOffset !== 0 || p.phaserSweep !== 0;
  let phaserOffset = p.phaserOffset * p.phaserOffset * 1020;
  if (p.phaserOffset < 0) phaserOffset = -phaserOffset;
  const phaserDeltaOffset = p.phaserSweep ** 3 * 0.2;
  let phaserPos = 0;
  let phaserInt = 0;
  const phaserBuffer = new Float32Array(1024);

  // A second stream off the same seed. The generator above drew from the first.
  const noise = rng(seed);
  const noiseBuffer = new Float32Array(32);
  for (let i = 0; i < 32; ++i) noiseBuffer[i] = noise() * 2 - 1;

  let repeatTime = 0;
  const repeatLimit = p.repeatSpeed === 0
    ? 0
    : Math.trunc((1 - p.repeatSpeed) ** 2 * 20000) + 32;

  const out = [];
  let finished = false;

  while (!finished && out.length < MAX_SAMPLES) {
    if (repeatLimit !== 0 && ++repeatTime >= repeatLimit) {
      repeatTime = 0;
      partial();
    }

    if (changeLimit !== 0 && ++changeTime >= changeLimit) {
      changeLimit = 0;
      period *= changeAmount;
    }

    slide += deltaSlide;
    period *= slide;

    if (period > maxPeriod) {
      period = maxPeriod;
      // Only a set minFrequency ends the sound here; otherwise it just clamps.
      if (minFrequency > 0) finished = true;
    }

    let periodTemp = period;
    if (vibratoAmplitude > 0) {
      vibratoPhase += vibratoSpeed;
      periodTemp = period * (1 + Math.sin(vibratoPhase) * vibratoAmplitude);
    }
    periodTemp = Math.trunc(periodTemp);
    if (periodTemp < 8) periodTemp = 8;

    if (waveType === 0) {
      squareDuty += dutySweep;
      if (squareDuty < 0) squareDuty = 0;
      else if (squareDuty > 0.5) squareDuty = 0.5;
    }

    if (++envelopeTime > envelopeLength) {
      envelopeTime = 0;
      switch (++envelopeStage) {
        case 1:
          envelopeLength = envelopeLength1;
          break;
        case 2:
          envelopeLength = envelopeLength2;
          break;
      }
    }

    switch (envelopeStage) {
      case 0:
        envelopeVolume = envelopeTime / envelopeLength0;
        break;
      case 1:
        envelopeVolume = 1 +
          (1 - envelopeTime / envelopeLength1) * 2 * sustainPunch;
        break;
      case 2:
        envelopeVolume = 1 - envelopeTime / envelopeLength2;
        break;
      default:
        envelopeVolume = 0;
        finished = true;
    }

    if (phaser) {
      phaserOffset += phaserDeltaOffset;
      phaserInt = Math.trunc(phaserOffset);
      if (phaserInt < 0) phaserInt = -phaserInt;
      else if (phaserInt > 1023) phaserInt = 1023;
    }

    if (filters && hpFilterDeltaCutoff !== 0) {
      hpFilterCutoff *= hpFilterDeltaCutoff;
      if (hpFilterCutoff < 0.00001) hpFilterCutoff = 0.00001;
      else if (hpFilterCutoff > 0.1) hpFilterCutoff = 0.1;
    }

    let superSample = 0;
    for (let j = 0; j < 8; ++j) {
      let sample = 0;
      phase++;
      if (phase >= periodTemp) {
        phase -= periodTemp;
        if (waveType === 3) {
          for (let n = 0; n < 32; ++n) noiseBuffer[n] = noise() * 2 - 1;
        }
      }

      switch (waveType) {
        case 0:
          sample = phase / periodTemp < squareDuty ? 0.5 : -0.5;
          break;
        case 1:
          sample = 1 - (phase / periodTemp) * 2;
          break;
        case 2: {
          // A cheap sine: parabola, then one correction pass.
          let pos = phase / periodTemp;
          pos = pos > 0.5 ? (pos - 1) * 6.28318531 : pos * 6.28318531;
          sample = pos < 0
            ? 1.27323954 * pos + 0.405284735 * pos * pos
            : 1.27323954 * pos - 0.405284735 * pos * pos;
          sample = sample < 0
            ? 0.225 * (sample * -sample - sample) + sample
            : 0.225 * (sample * sample - sample) + sample;
          break;
        }
        case 3:
          // A repeat cuts the period short without touching the phase, so the
          // index runs past the buffer for one period. The original read
          // whatever sat after the array; this holds the last entry.
          sample = noiseBuffer[Math.min(31, Math.trunc(phase * 32 / periodTemp))];
          break;
      }

      if (filters) {
        const lpFilterOldPos = lpFilterPos;
        lpFilterCutoff *= lpFilterDeltaCutoff;
        if (lpFilterCutoff < 0) lpFilterCutoff = 0;
        else if (lpFilterCutoff > 0.1) lpFilterCutoff = 0.1;

        if (lpFilterOn) {
          lpFilterDeltaPos += (sample - lpFilterPos) * lpFilterCutoff;
          lpFilterDeltaPos *= lpFilterDamping;
        } else {
          lpFilterPos = sample;
          lpFilterDeltaPos = 0;
        }
        lpFilterPos += lpFilterDeltaPos;

        hpFilterPos += lpFilterPos - lpFilterOldPos;
        hpFilterPos *= 1 - hpFilterCutoff;
        sample = hpFilterPos;
      }

      if (phaser) {
        phaserBuffer[phaserPos & 1023] = sample;
        sample += phaserBuffer[(phaserPos - phaserInt + 1024) & 1023];
        phaserPos = (phaserPos + 1) & 1023;
      }

      superSample += sample;
    }

    superSample = masterVolume * envelopeVolume * superSample / 8;
    if (superSample > 1) superSample = 1;
    else if (superSample < -1) superSample = -1;
    out.push(superSample);
  }

  return Float32Array.from(out);
}

/*
 * The fsfx stage: render()'s options, plus `amp`, added into the track.
 *
 * sfxr counts a period in whole samples rather than in Hz, so the same
 * parameters at another rate are another pitch and another length. Rather than
 * resample, which would put the stage and voice() on different sounds, it asks
 * the Track to run at 44100.
 */
export function sfxr(block, state) {
  state.param("amp", 1);
  if (state.SR !== SAMPLE_RATE) {
    throw new Error(`sfxr: track runs at ${state.SR}, not ${SAMPLE_RATE}`);
  }

  // What to pick out of the State, which carries the Track's own keys as well.
  // Built here rather than at module scope: an Object.keys() call up there is
  // one esbuild will not drop, and it holds DEFAULTS in every fsfx bundle.
  const opts = {};
  for (const k of [...Object.keys(DEFAULTS), "seed", "vol"]) {
    if (state.out[k] !== undefined) opts[k] = state.out[k];
  }

  const wave = render(opts);
  const n = Math.min(block.length, wave.length);
  for (let i = 0; i < n; ++i) block[i] += state(i).amp * wave[i];
}
