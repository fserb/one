import {canvas, mouse} from "./one.js";

function onMouseMove(ev) {
  if (ev.touches && ev.touches.length == 0) return;
  if (!ev.touches && !ev.buttons) return;
  ev.stopPropagation();
  ev.preventDefault();

  const o = ev.touches ? ev.touches[0] : ev;

  const x = o.pageX - canvas.offsetLeft;
  const y = o.pageY - canvas.offsetTop;
  mouse.x = 1024 * x * window.devicePixelRatio / canvas.width;
  mouse.y = 1024 * y * window.devicePixelRatio / canvas.height;
}

let inclick = false;

function onMouseUp(ev) {
  ev.stopPropagation();
  ev.preventDefault();
  canvas.removeEventListener("mousemove", onMouseMove, { passive: false});
  canvas.removeEventListener("mouseup", onMouseUp, { passive: false });
  canvas.removeEventListener("touchmove", onMouseMove, { passive: false});
  canvas.removeEventListener("touchend", onMouseUp, { passive: false });
  mouse.press = false;
  onMouseMove(ev);
}

function onMouseDown(ev) {
  ev.stopPropagation();
  ev.preventDefault();
  canvas.addEventListener("mousemove", onMouseMove, { passive: false});
  canvas.addEventListener("mouseup", onMouseUp, { passive: false });
  canvas.addEventListener("touchmove", onMouseMove, { passive: false});
  canvas.addEventListener("touchend", onMouseUp, { passive: false });
  inclick = true;
  mouse.press = true;
  onMouseMove(ev);
}

export function init() {
  canvas.addEventListener("mousedown", onMouseDown, { passive: false });
  canvas.addEventListener("touchstart", onMouseDown, { passive: false });
}

export function update() {
  mouse.click = inclick;
  inclick = false;
}