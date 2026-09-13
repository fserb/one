/*
 * input.js - every device onto five buttons and a pointer.
 *
 * `press`, `just` and `release` each hold `up`, `right`, `down`, `left` and
 * `act`, and `x`/`y` is the pointer in 1024-space. That is the whole
 * vocabulary: a tap is `just.act`, a drag is `press.act` with x/y, a charge is
 * `release.act` after counting frames of `press.act`. `act` carries the pointer
 * button as well as the keys, so a pointer press and an action press are the
 * same event and a game that only acts is playable with a finger alone.
 *
 * Touch has two mappings and `meta.dpad` picks between them, because the two
 * cannot be one:
 *
 *   dpad off  the finger is the pointer. It writes x/y and holds act, which is
 *             what tapping a cell, dragging a rope or charging a shot needs.
 *   dpad on   the first finger is a stick, holding whichever directions its
 *             offset from the centre points at, and the second finger is the
 *             pointer and act.
 *
 * Each breaks the other's games. With the finger on act, berzerk fires the
 * whole time it walks and gather undoes its chain on every step; with the
 * finger on the stick, amaze's own pointer aim loses to a direction it never
 * asked for. Nor can it be derived: set and grab read the same four fields, and
 * set wants the finger on the board where grab wants it on a stick. Mouse and
 * pen are the pointer either way, so a desktop player on a dpad game steers
 * with the keys and fires with the button.
 *
 * It declares `input` rather than one.js, so nothing here imports the rest of
 * src/lib and the one.js <-> input.js cycle never exists.
 */

const BUTTONS = ["up", "right", "down", "left", "act"];

const KEYS = {
  "arrowup": "up",
  "w": "up",
  "arrowright": "right",
  "d": "right",
  "arrowdown": "down",
  "s": "down",
  "arrowleft": "left",
  "a": "left",
  " ": "act",
  "enter": "act",
  "x": "act",
  ".": "act",
};

// The keys that scroll a document. Enter and the rest are left alone, so the
// header's link still works from the keyboard.
const SCROLLS = new Set([" ", "arrowup", "arrowright", "arrowdown", "arrowleft"]);

// The board's centre in 1024-space, and the stick's dead circle around it.
const CENTRE = 512;
const DEAD = 70;

function blank() {
  return { up: false, right: false, down: false, left: false, act: false };
}

export const input = {
  x: 0,
  y: 0,
  press: blank(), // held now
  just: blank(), // went down this frame
  release: blank(), // went up this frame
};

// What the events say is down, and what poll() last published. The stick has no
// events, so its edges come from comparing against `prev`.
const held = new Set();
const prev = blank();
// Down and up since the last poll, so a press and release inside one frame is
// still reported from both.
const fired = new Set();
const lifted = new Set();

// alma's Screen, for toLogical(). Held here rather than read off op, so
// input.js imports nothing from the rest of src/lib.
let screen = null;
let dpad = false;
let abort = null;

// Client coordinates: the pointer, and the finger driving the stick.
const ptr = { x: 0, y: 0 };
let stick = null;
// Every pointer holding act down. A set and not a flag: a second finger landing
// and lifting during a drag would otherwise take act with it.
const acting = new Set();

function down(button) {
  held.add(button);
  fired.add(button);
}

function up(button) {
  if (!held.delete(button)) return;
  lifted.add(button);
}

// Eight sectors of 45 degrees, and a direction owns the three facing it, so a
// diagonal holds two at once and asteroid can turn while it thrusts.
function stickDirs() {
  if (stick === null) return null;
  const p = screen.toLogical(stick.x, stick.y);
  const dx = p.x - CENTRE;
  const dy = p.y - CENTRE;
  if (Math.hypot(dx, dy) < DEAD) return null;

  const o = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8;
  return {
    right: o === 7 || o === 0 || o === 1,
    down: o === 1 || o === 2 || o === 3,
    left: o === 3 || o === 4 || o === 5,
    up: o === 5 || o === 6 || o === 7,
  };
}

function releaseAll() {
  for (const button of held) lifted.add(button);
  held.clear();
  stick = null;
  acting.clear();
}

// Off between rounds, whatever the game asked for: a tap on the finish screen
// has to be the act that restarts rather than a stick nothing is reading.
export function setDpad(on) {
  dpad = on;
  stick = null;
}

export function init(scr, { dpad: wantsDpad = false } = {}) {
  screen = scr;
  dpad = wantsDpad;
  abort = new AbortController();
  const { signal } = abort;
  const on = (target, event, handler, opts) =>
    target.addEventListener(event, handler, { ...opts, signal });

  // On the window, so the board needs no focus and Chrome draws no focus ring
  // around a canvas nobody clicked.
  on(globalThis, "keydown", (e) => {
    const k = e.key.toLowerCase();
    if (SCROLLS.has(k)) e.preventDefault();
    const button = KEYS[k];
    // Auto-repeat is not a fresh press.
    if (button !== undefined && !e.repeat) down(button);
  });
  on(globalThis, "keyup", (e) => {
    const button = KEYS[e.key.toLowerCase()];
    if (button !== undefined) up(button);
  });
  // Alt-tabbing away with a key down would leave it held forever.
  on(globalThis, "blur", releaseAll);

  const el = screen.canvas;
  on(el, "contextmenu", (e) => e.preventDefault());

  on(el, "pointerdown", (e) => {
    // A pointer dragged off the canvas stops delivering move and up there,
    // leaving act stuck down; capture reroutes it back.
    try {
      el.setPointerCapture(e.pointerId);
    } catch { /* nothing to capture */ }

    // The first finger of a dpad game is the stick and never the board: it is
    // not a place, and it does not act.
    if (dpad && e.pointerType === "touch" && stick === null) {
      stick = { id: e.pointerId, x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button !== 0) return;
    ptr.x = e.clientX;
    ptr.y = e.clientY;
    if (acting.size === 0) down("act");
    acting.add(e.pointerId);
  });

  on(el, "pointermove", (e) => {
    if (stick?.id === e.pointerId) {
      stick.x = e.clientX;
      stick.y = e.clientY;
      return;
    }
    // With no button down too, for a mouse hovering a board.
    ptr.x = e.clientX;
    ptr.y = e.clientY;
  });

  const end = (e) => {
    if (stick?.id === e.pointerId) {
      stick = null;
      return;
    }
    if (!acting.delete(e.pointerId) || acting.size > 0) return;
    up("act");
  };
  on(el, "pointerup", end);
  on(el, "pointercancel", end);
}

export function poll() {
  const p = screen.toLogical(ptr.x, ptr.y);
  input.x = p.x;
  input.y = p.y;

  const dirs = stickDirs();
  for (const b of BUTTONS) {
    const on = held.has(b) || (dirs?.[b] ?? false);
    input.press[b] = on || fired.has(b);
    input.just[b] = fired.has(b) || (on && !prev[b]);
    input.release[b] = !on && (lifted.has(b) || prev[b]);
    prev[b] = on;
  }
  fired.clear();
  lifted.clear();
}

export function destroy() {
  abort?.abort();
  abort = null;
  screen = null;
  releaseAll();
  lifted.clear();
}
