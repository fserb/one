import {op, mouse} from "./internal.js";

let inclick = false;
let inrelease = false;
let inswipe = 0;
const _gesture = {x: 0, y:0, t: 0};

const RANGE = Math.PI / 16;

function onMouseMove(ev) {
  if (inrelease) {
    const dt = performance.now() - _gesture.t;
    const dx = (mouse.x - _gesture.x);
    const dy = (mouse.y - _gesture.y);
    const vel = Math.hypot(dx, dy) / dt;
    const ang = Math.atan2(-dy, dx);
    if (dt < 500 && vel >= 0.3) {
      if (ang < RANGE && ang > -RANGE) {
        inswipe = 2;
      } else if (ang > Math.PI / 2 - RANGE && ang < Math.PI / 2 + RANGE) {
        inswipe = 1;
      } else if (ang > Math.PI - RANGE || ang < -Math.PI + RANGE) {
        inswipe = 4;
      } else if (ang < -Math.PI / 2 + RANGE && ang > -Math.PI / 2 - RANGE) {
        inswipe = 3;
      }
    }
  }

  if (ev.touches && ev.touches.length == 0) return;
  if (!ev.touches && !ev.buttons) return;
  ev.stopPropagation();
  ev.preventDefault();

  const o = ev.touches ? ev.touches[0] : ev;

  const x = o.pageX - op.canvas.offsetLeft;
  const y = o.pageY - op.canvas.offsetTop;
  mouse.x = 1024 * x * window.devicePixelRatio / op.canvas.width;
  mouse.y = 1024 * y * window.devicePixelRatio / op.canvas.height;

  if (inclick) {
    _gesture.t = performance.now();
    _gesture.x = mouse.x;
    _gesture.y = mouse.y;
  }
}

function onMouseUp(ev) {
  ev.stopPropagation();
  ev.preventDefault();
  op.canvas.removeEventListener("mousemove", onMouseMove, { passive: false});
  op.canvas.removeEventListener("mouseup", onMouseUp, { passive: false });
  op.canvas.removeEventListener("mouseout", onMouseUp, { passive: false });
  op.canvas.removeEventListener("touchmove", onMouseMove, { passive: false});
  op.canvas.removeEventListener("touchend", onMouseUp, { passive: false });
  op.canvas.removeEventListener("touchcancel", onMouseUp, { passive: false });
  mouse.press = false;
  inrelease = true;
  onMouseMove(ev);
}

function onMouseDown(ev) {
  ev.stopPropagation();
  ev.preventDefault();
  op.canvas.addEventListener("mousemove", onMouseMove, { passive: false});
  op.canvas.addEventListener("mouseup", onMouseUp, { passive: false });
  op.canvas.addEventListener("mouseout", onMouseUp, { passive: false });
  op.canvas.addEventListener("touchmove", onMouseMove, { passive: false});
  op.canvas.addEventListener("touchend", onMouseUp, { passive: false });
  op.canvas.addEventListener("touchcancel", onMouseUp, { passive: false });
  inclick = true;
  mouse.press = true;
  onMouseMove(ev);
}

function onKeyDown(ev) {
  const kc = ev.keyCode;
  if (kc == 38 || kc == 87) inswipe = 1;
  if (kc == 39 || kc == 68) inswipe = 2;
  if (kc == 40 || kc == 83) inswipe = 3;
  if (kc == 37 || kc == 65) inswipe = 4;
  if (kc == 32) inclick = true;
}

export function init() {
  op.canvas.addEventListener("mousedown", onMouseDown, { passive: false });
  op.canvas.addEventListener("touchstart", onMouseDown, { passive: false });
  window.addEventListener("keydown", onKeyDown, { passive: false });
}

export function update() {
  mouse.click = inclick;
  mouse.release = inrelease;
  mouse.swipe = inswipe;
  inclick = false;
  inrelease = false;
  inswipe = 0;
}
