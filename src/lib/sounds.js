/*
 * sounds.js - the named sound set: one design a name, and nothing else.
 *
 * A game does not write sound params. It calls a name out of this list and the
 * same rendered sound answers in every game, with a little detune a play so the
 * tenth in a row is not the first again. The set was chosen by ear, three
 * rounds of designs.
 *
 * Each entry is the name, a note saying what makes the sound, `vol`, the level
 * it plays at, and `params`, alma's sfx object.
 *
 * Every one is a wave -- sine, tri, saw, square -- doing one definite thing: a
 * slide, a run of notes, a gate, or two voices a few cents apart, 60 to 700ms
 * long. Only whoosh is noise, and there it is a band that sweeps. Struck modes,
 * plucked loops, FM, bitcrush, grains and a bowed string were all offered over
 * three rounds and none were kept, so the whole set costs alma's `lp`, `bp`,
 * `drive` and the `square` generator and nothing else out of sfx.js.
 *
 * The four names that came last are built out of the ones settled before them:
 * hit is land's fall at four times the speed, break is a fall under alarm's
 * gate, explode is lose's slide an octave down, step is bounce's arc made
 * small. Five more names were offered and dropped, each one a sound the set
 * already had: click and tick, hurt, charge and thrust.
 *
 * `vol` is measured and not chosen: it is set so that the loudest 50ms of every
 * sound reaches the same level, a third under it for the names that repeat and
 * a third over it for the ones that end a round. It is a starting point for the
 * ear, not a result.
 *
 * They render at 48000 with over 1, which is what sound.js does.
 */

import { bp, drive, lp } from "../alma/src/sfx.js";
import { square } from "../alma/src/sfxgen.js";
import { make, play } from "./sound.js";

// A flat body: the band that sweeps sits on a node under this, and the parent's
// envelope does the shaping.
const FLAT = (d) => [0, d, 1e-4];

// A sound is the call that plays it, and each one is its own export, so a game
// ships the sounds it names and not the set: `play.coin()` does not bring the
// other seventeen. Both /* @__PURE__ */ marks below are what let the bundler
// believe that. It cannot otherwise know one() has no side effect, and it
// cannot know lp(2000) has none either, and a stage it has to keep keeps the
// sound holding it, which keeps the set.
//
// It renders the first time it is played and not before, so a game pays for
// what it calls. `vol` is the level the set was measured at and a caller can
// still pass its own.
function one(name, vol, params) {
  let made = false;
  const f = (opts) => {
    if (!made) {
      made = true;
      make(name, params);
    }
    play(name, { volume: vol, ...opts });
  };
  return f;
}

// a sine sliding 700 to 1400 in 60ms, with nothing under it
export const select = /* @__PURE__ */ one("select", 0.43, {
  osc: "sine",
  freq: [700, "expIn", 1400],
  env: [0.004, "expOut", 0.055],
});

// a sine at 660 with a second voice 6 cents off, so it beats slowly
export const blip = /* @__PURE__ */ one("blip", 0.07, {
  osc: "sine",
  freq: 660,
  detune: 6,
  env: [0.006, 0.02, "expOut", 0.1],
});

// the bounce's arc made small, 200 out to 320 and back
export const step = /* @__PURE__ */ one("step", 0.31, {
  osc: "tri",
  freq: (_t, u) => 200 + 120 * Math.sin(Math.PI * u),
  env: [0.004, "expOut", 0.09],
});

// a triangle up a curve that flattens at the top, so it lands on a note
export const jump = /* @__PURE__ */ one("jump", 0.34, {
  osc: "tri",
  freq: (_t, u) => 260 + 900 * u - 500 * u * u,
  env: [0.006, "expOut", 0.16],
  fx: /* @__PURE__ */ lp(3000),
});

// a saw falling 300 to 60 while the filter closes, lose's shape in 250ms
export const land = /* @__PURE__ */ one("land", 0.39, {
  osc: "saw",
  freq: [300, "expOut", 60],
  env: [0.005, "expOut", 0.25],
  fx: [/* @__PURE__ */ lp([1800, "expOut", 300])],
});

// a triangle out to 900 and back to 500, the whole arc in 140ms
export const bounce = /* @__PURE__ */ one("bounce", 0.36, {
  osc: "tri",
  freq: (_t, u) => 400 + 900 * Math.sin(Math.PI * u) - 100 * u,
  env: [0.004, "expOut", 0.14],
  fx: /* @__PURE__ */ lp(4000),
});

// the drop's sine four times faster, 500 down to 90
export const hit = /* @__PURE__ */ one("hit", 0.32, {
  osc: "sine",
  freq: { wave: "sine", rate: 16, depth: [0, 20], of: [500, "expOut", 90] },
  env: [0.003, "expOut", 0.12],
});

// a saw falling 1500 to 240, driven and then filtered
export const shoot = /* @__PURE__ */ one("shoot", 0.35, {
  osc: "saw",
  freq: [1500, "expOut", 240],
  env: [0.002, "expOut", 0.15],
  fx: [/* @__PURE__ */ drive(0.3), /* @__PURE__ */ lp(2600)],
});

// a saw falling 500 to 100 gated twenty-eight times a second
// `break` is a reserved word, so it cannot be the name of a binding. It can be
// the name of an export and of a property, which is all a caller touches.
const brk = /* @__PURE__ */ one("break", 0.48, {
  osc: "saw",
  freq: [500, "expOut", 100],
  gain: { wave: "square", rate: 28, depth: 0.5, of: 0.5 },
  env: [0.003, "expOut", 0.25],
  fx: [/* @__PURE__ */ lp([2600, "expOut", 500])],
});
export { brk as break };

// a saw falling 150 to 30 gated eighteen times a second, a rumble
export const explode = /* @__PURE__ */ one("explode", 0.3, {
  osc: "saw",
  freq: [150, "expOut", 30],
  gain: { wave: "square", rate: 18, depth: 0.5, of: 0.5 },
  env: [0.005, 0.05, "expOut", 0.5],
  fx: [/* @__PURE__ */ lp([1400, "expOut", 220]), /* @__PURE__ */ drive(0.25)],
});

// three 40ms notes up 1319, 1760 and 2637, a small run
export const coin = /* @__PURE__ */ one("coin", 0.17, {
  osc: "tri",
  freq: [
    [0, 1319],
    [0.04, 1319],
    [0.04, 1760],
    [0.08, 1760],
    [0.08, 2637],
  ],
  env: [0.002, 0.08, "expOut", 0.06],
});

// four square steps up a major chord, 523 to 1047
export const power = /* @__PURE__ */ one("power", 0.1, {
  osc: { type: square, duty: 0.4 },
  freq: [
    [0, 523],
    [0.06, 523],
    [0.06, 659],
    [0.12, 659],
    [0.12, 784],
    [0.18, 784],
    [0.18, 1047],
  ],
  env: [0.003, 0.2, "expOut", 0.08],
  fx: /* @__PURE__ */ lp(5000),
});

// the power arp, then its octave held and beating six cents wide
export const win = /* @__PURE__ */ one("win", 0.07, {
  osc: { type: square, duty: 0.4 },
  detune: 6,
  freq: [
    [0, 523],
    [0.06, 523],
    [0.06, 659],
    [0.12, 659],
    [0.12, 784],
    [0.18, 784],
    [0.18, 1047],
  ],
  env: [0.003, 0.28, "expOut", 0.3],
  fx: /* @__PURE__ */ lp(5000),
});

// a saw sliding 330 to 55 while the filter closes on it
export const lose = /* @__PURE__ */ one("lose", 0.22, {
  osc: "saw",
  freq: [330, "expOut", 55],
  env: [0.01, 0.1, "expOut", 0.6],
  fx: [/* @__PURE__ */ lp([2200, "expOut", 300]), /* @__PURE__ */ drive(0.25)],
});

// a 1200 square gated eight times a second, three beeps of it
export const alarm = /* @__PURE__ */ one("alarm", 0.11, {
  osc: { type: square, duty: 0.5 },
  freq: 1200,
  gain: { wave: "square", rate: 8, depth: 0.5, of: 0.5 },
  env: [0.002, 0.36, 0.02],
  fx: /* @__PURE__ */ lp(5000),
});

// a sine falling 600 to 80 with the wobble opening as it goes
export const drop = /* @__PURE__ */ one("drop", 0.2, {
  osc: "sine",
  freq: { wave: "sine", rate: 5, depth: [0, 30], of: [600, "expOut", 80] },
  env: [0.006, "expOut", 0.4],
});

// two squares, 330 then 220, the answer that is no
export const deny = /* @__PURE__ */ one("deny", 0.1, {
  osc: { type: square, duty: 0.3 },
  freq: [[0, 330], [0.1, 330], [0.1, 220]],
  env: [0.004, 0.18, "expOut", 0.06],
  fx: /* @__PURE__ */ lp(2000),
});

// a band sweeping 300 to 3000 over noise, something coming in
export const whoosh = /* @__PURE__ */ one("whoosh", 0.36, {
  osc: {
    osc: "white",
    env: FLAT(0.28),
    fx: [/* @__PURE__ */ bp([300, "expIn", 3000], 2.5)],
  },
  gain: 2,
  env: [0.14, "expOut", 0.12],
});
