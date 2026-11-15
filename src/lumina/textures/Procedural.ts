import { Texture } from '../core/Texture';
import { clamp, mod, smoothstep } from '../math/MathUtils';

/**
 * Procedural, seamlessly tiling PBR texture sets (albedo + normal + ORM) generated on the CPU.
 * They make the engine self-contained – no external assets are needed for realistic surfaces.
 */

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed + 1, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Tileable value noise. (x, y) in lattice units, (px, py) = tiling period in lattice cells. */
export function vnoise(x: number, y: number, px: number, py: number, seed = 0): number {
  const xi = Math.floor(x),
    yi = Math.floor(y);
  const xf = x - xi,
    yf = y - yi;
  const u = xf * xf * (3 - 2 * xf),
    v = yf * yf * (3 - 2 * yf);
  const x0 = mod(xi, px),
    x1 = mod(xi + 1, px),
    y0 = mod(yi, py),
    y1 = mod(yi + 1, py);
  const a = hash2(x0, y0, seed),
    b = hash2(x1, y0, seed),
    c = hash2(x0, y1, seed),
    d = hash2(x1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x: number, y: number, px: number, py: number, octaves = 4, seed = 0): number {
  let sum = 0,
    amp = 0.5,
    norm = 0,
    f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * vnoise(x * f, y * f, px * f, py * f, seed + i * 17);
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

export interface Texel {
  /** sRGB colour 0..1 */
  r: number;
  g: number;
  b: number;
  /** height 0..1 (drives the normal map) */
  h: number;
  roughness: number;
  metalness: number;
  ao: number;
}

export interface PBRTextureSet {
  map: Texture;
  normalMap: Texture;
  ormMap: Texture;
}

const toByte = (v: number) => Math.round(clamp(v, 0, 1) * 255);

/**
 * Evaluates `fn(u, v)` on a size×size grid (u, v in [0,1)) and derives a tangent-space normal map
 * from the height channel (central differences with wrap-around → seamless).
 */
export function buildPBRSet(size: number, normalStrength: number, fn: (u: number, v: number) => Texel): PBRTextureSet {
  const n = size * size;
  const albedo = new Uint8Array(n * 4);
  const orm = new Uint8Array(n * 4);
  const height = new Float32Array(n);
  for (let j = 0; j < size; j++) {
    const v = j / size;
    for (let i = 0; i < size; i++) {
      const t = fn(i / size, v);
      const k = j * size + i;
      albedo[k * 4] = toByte(t.r);
      albedo[k * 4 + 1] = toByte(t.g);
      albedo[k * 4 + 2] = toByte(t.b);
      albedo[k * 4 + 3] = 255;
      orm[k * 4] = toByte(t.ao);
      orm[k * 4 + 1] = toByte(t.roughness);
      orm[k * 4 + 2] = toByte(t.metalness);
      orm[k * 4 + 3] = 255;
      height[k] = t.h;
    }
  }
  const normal = new Uint8Array(n * 4);
  const s = normalStrength * size * 0.25;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const l = height[j * size + mod(i - 1, size)],
        r = height[j * size + mod(i + 1, size)];
      const d = height[mod(j - 1, size) * size + i],
        u = height[mod(j + 1, size) * size + i];
      let nx = -(r - l) * s,
        ny = -(u - d) * s,
        nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const k = (j * size + i) * 4;
      normal[k] = toByte(nx * 0.5 + 0.5);
      normal[k + 1] = toByte(ny * 0.5 + 0.5);
      normal[k + 2] = toByte(nz * 0.5 + 0.5);
      normal[k + 3] = 255;
    }
  }
  const mk = (data: Uint8Array, cs: 'srgb' | 'linear') => new Texture({ data, width: size, height: size, colorSpace: cs, anisotropy: 16 });
  return { map: mk(albedo, 'srgb'), normalMap: mk(normal, 'linear'), ormMap: mk(orm, 'linear') };
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const fract = (x: number) => x - Math.floor(x);

export function createBricks(size = 512): PBRTextureSet {
  const cols = 4,
    rows = 8;
  return buildPBRSet(size, 2.2, (u, v) => {
    const row = Math.floor(v * rows);
    const fu = u * cols + (row & 1 ? 0.5 : 0);
    const fv = v * rows;
    const id = hash2(mod(Math.floor(fu), cols), row, 5);
    const bx = fract(fu),
      by = fract(fv);
    const d = Math.min(Math.min(bx, 1 - bx) / 0.06, Math.min(by, 1 - by) / 0.12);
    const mask = smoothstep(0.45, 1.2, d);
    const grain = fbm(u * 16, v * 16, 16, 16, 4, 3);
    const fine = fbm(u * 64, v * 64, 64, 64, 3, 9);
    const tint = 0.75 + id * 0.5;
    const br = (0.55 + grain * 0.35) * tint;
    // brick colour (rust red) vs mortar (warm grey)
    const r = mix(0.62 + fine * 0.1, 0.45 * br + 0.18, mask) * (0.9 + 0.2 * (1 - grain));
    const g = mix(0.6 + fine * 0.1, 0.17 * br + 0.07, mask);
    const b = mix(0.55 + fine * 0.1, 0.12 * br + 0.05, mask);
    const h = mix(0.0, 0.55 + grain * 0.35 + fine * 0.1, mask);
    return { r, g, b, h, roughness: mix(0.95, 0.78 + fine * 0.18, mask), metalness: 0, ao: mix(0.55, 1, mask) };
  });
}

export function createWoodPlanks(size = 512): PBRTextureSet {
  const planks = 6;
  return buildPBRSet(size, 0.5, (u, v) => {
    const p = Math.floor(v * planks);
    const pv = fract(v * planks);
    const id = hash2(p, 1, 11);
    const uu = u + id * 3; // each plank shifted → no visible repetition
    const warp = fbm(uu * 2, pv * 3 + p * 7, 2 * 4, 3 * 8, 3, 21);
    const ring = fract((fbm(mod(uu, 1) * 3, pv * 24 + id * 9, 3, 24, 4, 31) * 5 + warp * 2.5) * 1.0);
    const rings = smoothstep(0.0, 0.45, ring) * smoothstep(1.0, 0.55, ring);
    const pores = fbm(u * 128, v * 128, 128, 128, 2, 41);
    const gap = Math.min(pv, 1 - pv) / 0.025;
    const gm = smoothstep(0.4, 1.0, gap);
    const tone = 0.7 + id * 0.45;
    const base = mix(0.5, 0.72, rings) * tone * (0.95 + pores * 0.1);
    const r = mix(0.02, base * 0.95, gm),
      g = mix(0.012, base * 0.6, gm),
      b = mix(0.008, base * 0.34, gm);
    return { r, g, b, h: mix(0, 0.75 + rings * 0.1 - pores * 0.04, gm), roughness: mix(1, 0.5 + pores * 0.15, gm), metalness: 0, ao: mix(0.3, 1, gm) };
  });
}

export function createConcrete(size = 512): PBRTextureSet {
  return buildPBRSet(size, 0.7, (u, v) => {
    const big = fbm(u * 4, v * 4, 4, 4, 5, 51);
    const fine = fbm(u * 96, v * 96, 96, 96, 3, 61);
    const pores = Math.pow(fbm(u * 48, v * 48, 48, 48, 2, 71), 6) * 6;
    const seamX = Math.min(fract(u * 2), 1 - fract(u * 2)) / 0.006;
    const seamY = Math.min(fract(v * 2), 1 - fract(v * 2)) / 0.006;
    const seam = smoothstep(0.2, 1.0, Math.min(seamX, seamY));
    const c = (0.5 + big * 0.2 + fine * 0.05 - clamp(pores, 0, 0.08)) * mix(0.55, 1, seam);
    return { r: c * 1.0, g: c * 0.99, b: c * 0.96, h: (0.5 + fine * 0.2 + big * 0.3) * mix(0.3, 1, seam), roughness: 0.8 + fine * 0.12, metalness: 0, ao: mix(0.6, 1, seam) * (1 - clamp(pores, 0, 0.12)) };
  });
}

/** Polished marble tiles – low roughness so the floor shows crisp reflections. */
export function createMarbleTiles(size = 512): PBRTextureSet {
  const n = 2;
  return buildPBRSet(size, 0.35, (u, v) => {
    const tu = fract(u * n),
      tv = fract(v * n);
    const id = hash2(Math.floor(u * n), Math.floor(v * n), 77);
    const warp = fbm(u * 3 + id * 9, v * 3 + id * 5, 3, 3, 5, 81) * 6.0;
    const vein = Math.abs(Math.sin((u * 2.0 + v * 1.3) * Math.PI * 2 * 1.0 + warp * 1.7 + id * 20));
    const vv = Math.pow(1 - vein, 7) * 0.5;
    const cloud = fbm(u * 8, v * 8, 8, 8, 4, 91);
    const base = 0.8 + cloud * 0.16 - vv * 0.28;
    const edge = Math.min(Math.min(tu, 1 - tu), Math.min(tv, 1 - tv)) / (0.5 / size * 5);
    const grout = smoothstep(0.5, 1.5, edge);
    const r = mix(0.22, base * 0.96, grout),
      g = mix(0.21, base * 0.94, grout),
      b = mix(0.2, base * 0.9, grout);
    return { r, g, b, h: mix(0, 1, grout), roughness: mix(0.9, 0.12 + cloud * 0.12 + vv * 0.1, grout), metalness: 0, ao: mix(0.4, 1, grout) };
  });
}

/** Brushed metal plate with fine anisotropic scratches (tint is applied by the material colour). */
export function createBrushedMetal(size = 512): PBRTextureSet {
  return buildPBRSet(size, 0.6, (u, v) => {
    const streak = fbm(u * 2, v * 256, 2, 256, 4, 101);
    const streak2 = fbm(u * 6, v * 512, 6, 512, 2, 111);
    const wear = fbm(u * 5, v * 5, 5, 5, 4, 121);
    const c = 0.82 + streak * 0.14 - wear * 0.08;
    return { r: c, g: c, b: c, h: streak * 0.6 + streak2 * 0.4, roughness: 0.28 + streak * 0.22 + wear * 0.18, metalness: 1, ao: 1 };
  });
}

export function createGrass(size = 512): PBRTextureSet {
  return buildPBRSet(size, 0.7, (u, v) => {
    const patches = fbm(u * 6, v * 6, 6, 6, 4, 131);
    const blade = fbm(u * 128, v * 128, 128, 128, 3, 141);
    const blade2 = fbm(u * 256, v * 256, 256, 256, 2, 151);
    const dirt = smoothstep(0.62, 0.78, fbm(u * 5, v * 5, 5, 5, 4, 161));
    const gr = mix(0.55, 1.0, blade) * mix(0.6, 1.0, patches);
    const r = mix(0.3 * gr + blade2 * 0.05, 0.42 + blade * 0.06, dirt);
    const g = mix(0.5 * gr + 0.03, 0.34 + blade * 0.05, dirt);
    const b = mix(0.12 * gr, 0.18, dirt);
    return { r, g, b, h: blade * 0.8 + blade2 * 0.2, roughness: 0.95, metalness: 0, ao: mix(0.8, 1, blade) };
  });
}
