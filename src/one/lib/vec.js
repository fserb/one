// vec.js

export function vec(x, y) {
  return {x, y};
}

export function add(a, b) {
  return {x: a.x + b.x, y: a.y + b.y};
}

export function sub(a, b) {
  return {x: a.x - b.x, y: a.y - b.y};
}

export function mul(a, s) {
  return {x: a.x * s, y: a.y * s};
}

export function mulv(a, b) {
  return {x: a.x * b.x, y: a.y * b.y};
}

export function div(a, s) {
  return {x: a.x / s, y: a.y / s};
}

export function divv(a, b) {
  return {x: a.x / b.x, y: a.y / b.y};
}

export function len(a) {
  return Math.sqrt(a.x * a.x + a.y * a.y);
}

export function lsq(a) {
  return a.x * a.x + a.y * a.y;
}

export function normalize(a) {
  return div(a, len(a));
}

export function rotate(a, rad) {
  const c = Math.cos(rad);
  const s = Math.sin(rad);

  return {
    x: a.x * c - a.y * s,
    y: a.x * s + a.y * c };
}

// right hand 90deg rotation
export function perp(a) {
  return { x: -a.y, y: a.x};
}

export function angle(a) {
  return Math.atan2(a.y, a.x);
}

export function clamp(a, minv, maxv) {
  const l = len(a);
  const nl = l <= minv ? minv : (l >= maxv ? maxv : l);
  return l != 0 ? mul(a, nl / l) : a;
}

// from polar to cartesian
export function polar(radius, ang) {
  return {
    x: radius * Math.cos(ang),
    y: radius * Math.sin(ang)
  };
}

export function floor(v) {
  return {
    x: Math.floor(v.x),
    y: Math.floor(v.y)
  };
}

export function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

// cross product to "3d"
export function cross(a, b) {
  return b.y * a.x - b.x * a.y;
}

// project b into a
export function project(a, v) {
  const _lsq = a.x * a.x + a.y * a.y;
  if (_lsq == 0) return {x: 0, y: 0};
  const dp = dot(a, v) / _lsq;
  return { x: dp * a.x, y: dp * a.y};
}

export function partial(a, v) {
  const _lsq = a.x * a.x + a.y * a.y;
  if (_lsq == 0) return {x: 0, y: 0};
  return dot(a, v) / _lsq;
}
