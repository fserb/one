import plus2d from "./plus2d.js";

// Returns a function, that, as long as it continues to be invoked, will not
// be triggered. The function will be called after it stops being called for
// N milliseconds. If `immediate` is passed, trigger the function on the
// leading edge, instead of the trailing.
function debounce(func, wait, immediate = false) {
  let timeout;
  return function(...args) {
    // eslint-disable-next-line no-invalid-this
    const context = this;
    const later = function() {
      timeout = null;
      if (!immediate) func.apply(context, args);
    };
    const callNow = immediate && !timeout;
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
    if (callNow) func.apply(context, args);
  };
}

function newCanvas(width, height, forceElement = false) {
  let canvas, ctx;
  if (!forceElement) {
    try {
      canvas = new OffscreenCanvas(width, height);
      // @ts-ignore
      ctx = canvas.getContext("2d");
    } catch (ex) {
      canvas = null;
    }
  }

  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    ctx = canvas.getContext("2d");
  }
  plus2d(ctx);
  // @ts-ignore
  canvas.ctx = ctx;
  return [canvas, ctx];
}

function rectHit(obj, x, y) {
  return (x >= obj.x && x < (obj.x + obj.width) &&
    y >= obj.y && y < (obj.y + obj.height));
}

function mousepos(obj, x, y) {
  if (!Array.isArray(obj)) obj = [obj];
  for (const o of obj) {
    const r = o.r ?? 1.0;
    x = (x - o.x) / r;
    y = (y - o.y) / r;
  }
  return [x, y];
}

function unmaps(objs, s) {
  for (let i = objs.length - 1; i >= 0; --i) {
    const r = objs[i].r ?? 1.0;
    s *= r;
  }
  return s;
}

function unmap(objs, target) {
  const out = {x: target.x, y: target.y,
    width: target.width, height: target.height};
  for (let i = objs.length - 1; i >= 0; --i) {
    const r = objs[i].r ?? 1.0;
    const ox = objs[i].x ?? 0.0;
    const oy = objs[i].y ?? 0.0;
    out.x = (out.x * r) + ox;
    out.y = (out.y * r) + oy;
    out.width *= r;
    out.height *= r;
  }
  return out;
}

function uuid() {
  const time = +Date.now();
  const timeLow = time % 4294967296;
  const timeHigh = (time - timeLow) / 4294967296;
  const tim = [
    (timeHigh >>> 8) & 0b11111111,
    (timeHigh >>> 0) & 0b11111111,
    (timeLow >>> 24) & 0b11111111,
    (timeLow >>> 16) & 0b11111111,
    (timeLow >>> 8) & 0b11111111,
    (timeLow >>> 0) & 0b11111111];

  const cry = new Uint8Array(10);
  window.crypto.getRandomValues(cry);

  const t = i => (tim[i] + 0x100).toString(16).substr(1);
  const c = i => (cry[i] + 0x100).toString(16).substr(1);

  return [
    c(0), c(1), c(2), c(3), '-',
    c(4), c(5), c(6), c(7), '-', c(8), c(9), '-',
    t(0), t(1), t(2), t(3), '-', t(4), t(5),
  ].join('').toLowerCase();
}

function loadImage(name) {
  return fetch(name).then(x => x.blob()).then(createImageBitmap);
}

function dayOfYear(y, m, d) {
  const now = new Date(y, m, d, 0, 0, 0, 0);
  const start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
  const diff = now.getTime() - start.getTime() +
    ((start.getTimezoneOffset() - now.getTimezoneOffset()) * 60 * 1000);
  const day = Math.floor(diff / (1000 * 60 * 60 * 24));
  return day;
}

function dayOfEpoch(y, m, d) {
  const now = new Date(y, m, d, 0, 0, 0, 0);
  const start = new Date(2021, 0, 1, 0, 0, 0, 0);
  const diff = now.getTime() - start.getTime() +
    ((start.getTimezoneOffset() - now.getTimezoneOffset()) * 60 * 1000);
  const day = Math.floor(diff / (1000 * 60 * 60 * 24));
  return day;
}

export {newCanvas, loadImage, debounce, mousepos, rectHit, uuid,
  unmap, unmaps, dayOfYear, dayOfEpoch};