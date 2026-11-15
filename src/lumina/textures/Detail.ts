import { Texture } from '../core/Texture';
import { clamp } from '../math/MathUtils';
import { fbm, vnoise } from './Procedural';

/**
 * Seamlessly tiling detail map for `PBRMaterial.detailMap` (repeat it dozens of times over the base texture):
 *   R,G = tangent-space micro normal (pores, grain, fine scratches)
 *   B   = roughness modulation (0.5 = neutral) – fingerprints / smudges / micro scratches
 *   A   = grime mask (reserved, 1 = clean)
 */
export function createDetailMap(size = 256, strength = 1): Texture {
  const n = size * size;
  const h = new Float32Array(n);
  const rough = new Float32Array(n);
  const grime = new Float32Array(n);
  const wrap = (i: number) => ((i % size) + size) % size;
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const u = i / size,
        v = j / size;
      const base = fbm(u * 24, v * 24, 24, 24, 4, 3);
      const pores = vnoise(u * 96, v * 96, 96, 96, 9);
      // fine micro scratches: stretched noise along two directions
      const sc = fbm(u * 8 + v * 2, v * 120, 8, 120, 2, 21) * 0.5 + fbm(u * 120, v * 6, 120, 6, 2, 27) * 0.5;
      h[j * size + i] = base * 0.55 + pores * 0.25 + sc * 0.2;
      rough[j * size + i] = fbm(u * 6, v * 6, 6, 6, 5, 33) * 0.7 + fbm(u * 40, v * 40, 40, 40, 2, 35) * 0.3;
      grime[j * size + i] = clamp(1 - Math.pow(fbm(u * 5, v * 5, 5, 5, 4, 51), 2.2) * 1.4, 0, 1);
    }
  const data = new Uint8Array(n * 4);
  const s = strength * size * 0.16;
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const l = h[j * size + wrap(i - 1)],
        r = h[j * size + wrap(i + 1)],
        d = h[wrap(j - 1) * size + i],
        u = h[wrap(j + 1) * size + i];
      let nx = -(r - l) * s,
        ny = -(u - d) * s;
      const len = Math.hypot(nx, ny, 1);
      nx /= len;
      ny /= len;
      const k = (j * size + i) * 4;
      data[k] = Math.round((nx * 0.5 + 0.5) * 255);
      data[k + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[k + 2] = Math.round(clamp(rough[j * size + i], 0, 1) * 255);
      data[k + 3] = Math.round(grime[j * size + i] * 255);
    }
  return new Texture({ data, width: size, height: size, colorSpace: 'linear', anisotropy: 8 });
}
