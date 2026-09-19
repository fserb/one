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
 * The board is a place in every game: a finger on it is the pointer the way a
 * mouse is, writing x/y and holding act. The four directions come from the
 * keys, and on a touch screen from the pad the page draws below the board, in
 * HTML and outside the canvas: `.dirs`, a cross, and `.act`, a button.
 * `meta.dpad` is what asks for one, ten games do, and bindPad() is the whole
 * connection to the page. It finds `.pad`, puts the `dpad` class on <body> for
 * the page's CSS to lay the board and the pad out with, and reads the two
 * elements; that CSS shows them only where `(pointer: coarse) and (hover:
 * none)`, a screen with no mouse on it. A page with none of that markup in it,
 * like the recorder's, leaves a dpad game on the keys.
 *
 * The cross is read as a stick and not as four buttons: the offset from its
 * centre picks one of eight sectors, and a direction owns the three facing it,
 * so a thumb holds two at once and slides from one direction to the next
 * without lifting.
 *
 * It declares `input` rather than one.js, so nothing here imports the rest of
 * src/lib and the one.js <-> input.js cycle never exists.
 */

const BUTTONS = ["up", "right", "down", "left", "act"];
const DIRS = BUTTONS.slice(0, 4);

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

// The middle of the cross, as a fraction of its width: a thumb there holds no
// direction, and one that lands there steers as soon as it leaves it.
const DEAD = 0.18;

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
let abort = null;
// The page's two elements once bindPad() has found them, and null on a game
// that asked for no pad or a page that draws none.
let pad = null;

// Client coordinates: the pointer, and the thumb on the cross.
const ptr = { x: 0, y: 0 };
let stick = null;
// Every pointer holding act down, a finger on the board and a thumb on the
// pad's button alike. A set and not a flag: a second finger landing and lifting
// during a drag would otherwise take act with it.
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
  const dx = stick.x - stick.cx;
  const dy = stick.y - stick.cy;
  if (Math.hypot(dx, dy) < stick.dead) return null;

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

// A pointer dragged off the element it came down on stops delivering move and
// up there, leaving what it holds stuck down; capture reroutes it back.
function capture(el, e) {
  try {
    el.setPointerCapture(e.pointerId);
  } catch { /* nothing to capture */ }
}

// The board and the pad's button are one act between them: act goes down on the
// first of them and up when the last lifts.
function actDown(e) {
  if (acting.size === 0) down("act");
  acting.add(e.pointerId);
}

function actUp(e) {
  if (!acting.delete(e.pointerId) || acting.size > 0) return;
  up("act");
}

// The pad below the board, and the only place this file touches the document.
function bindPad(on) {
  const el = document.querySelector(".pad");
  if (el === null) return;
  document.body.classList.add("dpad");
  pad = { dirs: el.querySelector(".dirs"), act: el.querySelector(".act") };

  on(pad.dirs, "pointerdown", (e) => {
    capture(pad.dirs, e);
    if (stick !== null) return;
    // The centre is taken here and not every frame, since the pad does not
    // move under a thumb that is already on it.
    const r = pad.dirs.getBoundingClientRect();
    stick = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      cx: r.left + r.width / 2,
      cy: r.top + r.height / 2,
      dead: r.width * DEAD,
    };
  });
  on(pad.dirs, "pointermove", (e) => {
    if (stick?.id !== e.pointerId) return;
    stick.x = e.clientX;
    stick.y = e.clientY;
  });
  const lift = (e) => {
    if (stick?.id === e.pointerId) stick = null;
  };
  on(pad.dirs, "pointerup", lift);
  on(pad.dirs, "pointercancel", lift);

  on(pad.act, "pointerdown", (e) => {
    capture(pad.act, e);
    actDown(e);
  });
  on(pad.act, "pointerup", actUp);
  on(pad.act, "pointercancel", actUp);
}

export function init(scr, { dpad = false } = {}) {
  screen = scr;
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
    capture(el, e);
    if (e.button !== 0) return;
    ptr.x = e.clientX;
    ptr.y = e.clientY;
    actDown(e);
  });
  on(el, "pointermove", (e) => {
    // With no button down too, for a mouse hovering a board.
    ptr.x = e.clientX;
    ptr.y = e.clientY;
  });
  on(el, "pointerup", actUp);
  on(el, "pointercancel", actUp);

  if (dpad) bindPad(on);
}

/*
 * Let go of act, as if it had been released: the press that ended the finish
 * screen is still down on the new round's first frame, and a game reading
 * press.act acts on it. The real release finds nothing held and reports
 * nothing; the next press is a press again.
 *
 * Only act. A direction held when a round starts is the player's hand on the
 * key, and on the pad it never goes through `held` anyway.
 */
export function dropAct() {
  held.delete("act");
  prev.act = false;
  input.press.act = false;
  input.just.act = false;
  input.release.act = false;
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

  // The pad lights what it published rather than what a thumb is over, so a
  // player on the keys sees the same thing the game is reading. Written only
  // when it changes, since this runs every frame and a hidden pad still has
  // one of these on a page recording a card.
  if (pad !== null) {
    const lit = DIRS.filter((b) => input.press[b]).join(" ");
    if (lit !== pad.dirs.dataset.held) pad.dirs.dataset.held = lit;
    pad.act.classList.toggle("on", input.press.act);
  }
}

export function destroy() {
  abort?.abort();
  abort = null;
  screen = null;
  if (pad !== null) document.body.classList.remove("dpad");
  pad = null;
  releaseAll();
  lifted.clear();
}
