/*
 * fft.js - circular convolution, over alma's FFT. The one file here that is not
 * the original fsfx: Nayuki's transform took any length where alma's is
 * radix-2, so this pads to a power of two with room for the whole linear
 * convolution and folds the tail back by hand.
 */

// Straight from algo/, not through alma's index: `export * as fft` is a
// namespace object, and importing it drags in fft2d, fft3d and the rest.
import { fft1d, ifft1d } from "../../alma/src/algo/fft.js";

// Circular convolution of two equal-length real vectors, in place into `x`.
export function convolveReal(x, h) {
  const n = x.length;
  if (n !== h.length) throw new Error("Mismatched lengths");

  // Where the impulse stops: past that is the caller's zero padding, and it
  // decides how much room the transform needs.
  let m = n;
  while (m > 0 && h[m - 1] === 0) --m;
  if (m === 0) {
    x.fill(0);
    return;
  }

  let size = 1;
  while (size < n + m - 1) size *= 2;

  const xc = new Float64Array(2 * size);
  const hc = new Float64Array(2 * size);
  for (let i = 0; i < n; ++i) {
    xc[2 * i] = x[i];
    hc[2 * i] = h[i];
  }

  const a = fft1d(xc);
  const b = fft1d(hc);
  for (let i = 0; i < a.length; i += 2) {
    const re = a[i] * b[i] - a[i + 1] * b[i + 1];
    a[i + 1] = a[i] * b[i + 1] + a[i + 1] * b[i];
    a[i] = re;
  }
  const y = ifft1d(a);

  // alma's transforms are unitary, so the round trip comes back scaled by
  // sqrt(size). Everything past n folds onto the start.
  const k = Math.sqrt(size);
  for (let i = 0; i < n; ++i) {
    x[i] = k * (y[2 * i] + (i + n < size ? y[2 * (i + n)] : 0));
  }
}
