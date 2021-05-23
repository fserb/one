import {op, mouse} from "./internal.js";

function onMouseMove(ev) {
  if (ev.touches && ev.touches.length == 0) return;
  if (!ev.touches && !ev.buttons) return;
  ev.stopPropagation();
  ev.preventDefault();

  const o = ev.touches ? ev.touches[0] : ev;

  const x = o.pageX - op.canvas.offsetLeft;
  const y = o.pageY - op.canvas.offsetTop;
  mouse.x = 1024 * x * window.devicePixelRatio / op.canvas.width;
  mouse.y = 1024 * y * window.devicePixelRatio / op.canvas.height;
}

let inclick = false;
let inrelease = false;

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

export function init() {
  op.canvas.addEventListener("mousedown", onMouseDown, { passive: false });
  op.canvas.addEventListener("touchstart", onMouseDown, { passive: false });
}

export function update() {
  mouse.click = inclick;
  mouse.release = inrelease;
  inclick = false;
  inrelease = false;
}