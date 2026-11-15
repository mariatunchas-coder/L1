export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const EPSILON = 1e-6;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
export function isPowerOfTwo(v: number): boolean {
  return (v & (v - 1)) === 0 && v !== 0;
}
export function ceilPowerOfTwo(v: number): number {
  return Math.pow(2, Math.ceil(Math.log2(v)));
}
export function floorPowerOfTwo(v: number): number {
  return Math.pow(2, Math.floor(Math.log2(v)));
}
export function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** Deterministic PRNG (mulberry32) – reproducible procedural content. */
export function createRandom(seed = 1): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
