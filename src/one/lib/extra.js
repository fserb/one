
export function clamp(x, lower, upper) {
  return x <= lower ? lower : (x >= upper ? upper : x);
};

export function frac(x) {
  return x - Math.floor(x);
}

export const TAU = 2 * Math.PI;
export const SQRT3 = Math.sqrt(3);

export function bitfield(value, start, length = 1) {
  return (value >> start) & ((1 << length) - 1);
}

export function sum(arr) {
  let acc = 0;
  for (let i = 0; i < arr.length; ++i) acc += arr[i];
  return acc;
}

export function lerp(a, b, t) {
  return (a * (1.0 - t)) + (b * t);
}

export function log2int(v) {
  let r = 0xFFFF - v >> 31 & 0x10;
  v >>= r;
  let shift = 0xFF - v >> 31 & 0x8;
  v >>= shift;
  r |= shift;
  shift = 0xF - v >> 31 & 0x4;
  v >>= shift;
  r |= shift;
  shift = 0x3 - v >> 31 & 0x2;
  v >>= shift;
  r |= shift;
  r |= (v >> 1);
  return r;
}

export function arrayShuffle(arr) {
  let counter = arr.length;
  // While there are elements in the array
  while (counter-- > 0) {
    // Pick a random index
    const index = Math.floor((Math.random() * counter));
    // And swap the last element with it
    const temp = arr[counter];
    arr[counter] = arr[index];
    arr[index] = temp;
  }
  return arr;
}

export function arrayFilter(arr, cond) {
  let next = 0;

  for (const v of arr) {
    if (cond(v)) arr[next++] = v;
  }

  arr.splice(next);
}

export function arrayRemove(arr, element) {
  const idx = arr.indexOf(element);
  if (idx == -1) return arr;
  arr.splice(idx, 1);
  return arr;
}

export function arrayBufferToStr(ab) {
  return String.fromCharCode.apply(null, new Uint8Array(ab));
}

export function promiseSleep(time) {
  return new Promise(res => setTimeout(res, time * 1000));
}

export function promiseEvent(obj, event) {
  return new Promise(res => {
    obj.addEventListener(event, ev => {
      res(ev);
    });
  });
}

