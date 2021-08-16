
export const TAU = Math.PI * 2;
export const DC_OFFSET = 1e-25;

export function dblin(db) {
  return Math.pow(10, 0.05 * db);
}

export function lindb(lin) {
  return 20 * Math.log10(lin + DC_OFFSET);
}

export function clamp(x, lower, upper) {
  return x <= lower ? lower : (x >= upper ? upper : x);
}