import { DECAL_KINDS } from '../core/Decal';
import { clamp, smoothstep } from '../math/MathUtils';
import { fbm } from '../textures/Procedural';
import { GLState, TEX_2D_ARRAY } from './GLState';

export const DECAL_SIZE = 256;

const fract = (x: number) => x - Math.floor(x);
function hash(x: number, y: number, s: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s + 7, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Distance to the nearest (F1) and second nearest (F2) jittered feature point – Worley noise. */
function worley(x: number, y: number, seed: number): [number, number] {
  const xi = Math.floor(x),
    yi = Math.floor(y);
  let f1 = 9,
    f2 = 9;
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i,
        cy = yi + j;
      const px = cx + hash(cx, cy, seed),
        py = cy + hash(cx, cy, seed + 31);
      const d = Math.hypot(px - x, py - y);
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) f2 = d;
    }
  return [f1, f2];
}

/**
 * Procedural decal atlas, RGBA8 per layer (order = `DECAL_KINDS`):
 *   R = coverage mask · G = height (relief for the normal) · B = high-frequency grain (modulates the tint) · A = 1
 */
export function generateDecalPixels(size = DECAL_SIZE): Uint8Array {
  const layers = DECAL_KINDS.length;
  const data = new Uint8Array(size * size * 4 * layers);
  const P = 4096; // huge period → the noise never wraps inside the image
  // scratches: fixed random polylines
  const lines: number[][] = [];
  for (let i = 0; i < 38; i++) {
    const a = hash(i, 3, 91) * Math.PI * 0.35 - 0.2 + (hash(i, 9, 5) > 0.8 ? 1.2 : 0);
    const cx = hash(i, 1, 17) * 1.7 - 0.85,
      cy = hash(i, 2, 17) * 1.7 - 0.85;
    const len = 0.25 + hash(i, 4, 33) * 0.7;
    lines.push([cx - Math.cos(a) * len, cy - Math.sin(a) * len, cx + Math.cos(a) * len, cy + Math.sin(a) * len, 0.004 + hash(i, 5, 2) * 0.007]);
  }
  for (let layer = 0; layer < layers; layer++) {
    const kind = DECAL_KINDS[layer];
    for (let j = 0; j < size; j++) {
      const v = (j + 0.5) / size;
      for (let i = 0; i < size; i++) {
        const u = (i + 0.5) / size;
        const cx = u * 2 - 1,
          cy = v * 2 - 1;
        const r = Math.hypot(cx, cy);
        const edge = 1 - smoothstep(0.78, 1.0, r);
        let mask = 0,
          h = 0.5;
        switch (kind) {
          case 'dirt': {
            const n = fbm(u * 5, v * 5, P, P, 5, 1);
            const n2 = fbm(u * 13 + 4, v * 13, P, P, 3, 2);
            mask = smoothstep(0.3, 0.62, n * 0.95 + (1 - r) * 0.5 - 0.22) * edge * (0.75 + 0.25 * n2);
            h = n;
            break;
          }
          case 'crack': {
            const w = fbm(u * 6, v * 6, P, P, 3, 5);
            const [f1, f2] = worley(u * 4.5 + w * 0.9, v * 4.5 + w * 0.9, 11);
            const [g1, g2] = worley(u * 9 + 3 + w * 0.6, v * 9 + w * 0.6, 23);
            const e1 = f2 - f1,
              e2 = g2 - g1;
            const c1 = 1 - smoothstep(0.0, 0.035 + 0.03 * w, e1);
            const c2 = (1 - smoothstep(0.0, 0.02, e2)) * 0.6 * smoothstep(0.2, 0.9, w);
            const c = clamp(Math.max(c1, c2), 0, 1);
            mask = c * (1 - smoothstep(0.5, 0.98, r + (w - 0.5) * 0.35));
            h = 1 - c * 0.95;
            break;
          }
          case 'puddle': {
            const w = fbm(u * 4, v * 4, P, P, 4, 8);
            const rw = r + (w - 0.5) * 0.7;
            mask = 1 - smoothstep(0.5, 0.74, rw);
            h = 0.5;
            break;
          }
          case 'scorch': {
            const n = fbm(u * 7, v * 7, P, P, 5, 12);
            const rr = r + (n - 0.5) * 0.8;
            mask = Math.pow(1 - smoothstep(0.08, 0.95, rr), 1.4) * edge;
            h = n;
            break;
          }
          case 'moss': {
            const n = fbm(u * 8, v * 8, P, P, 6, 14);
            const n2 = fbm(u * 24, v * 24, P, P, 3, 15);
            mask = smoothstep(0.42, 0.68, n * 0.85 + (1 - r) * 0.32) * edge;
            h = 0.35 + n2 * 0.65;
            break;
          }
          case 'scratches': {
            let dmin = 9;
            for (const l of lines) {
              const px = cx - l[0],
                py = cy - l[1];
              const dx = l[2] - l[0],
                dy = l[3] - l[1];
              const t = clamp((px * dx + py * dy) / (dx * dx + dy * dy), 0, 1);
              const d = Math.hypot(px - dx * t, py - dy * t) / l[4];
              if (d < dmin) dmin = d;
            }
            mask = (1 - smoothstep(0.35, 1.0, dmin)) * edge * (0.55 + 0.45 * fbm(u * 20, v * 20, P, P, 2, 3));
            h = 1 - mask * 0.85;
            break;
          }
        }
        const grain = fbm(u * 48 + layer * 3, v * 48, P, P, 3, 40 + layer);
        const k = ((layer * size + j) * size + i) * 4;
        data[k] = Math.round(clamp(mask, 0, 1) * 255);
        data[k + 1] = Math.round(clamp(h, 0, 1) * 255);
        data[k + 2] = Math.round(clamp(fract(grain * 1.0), 0, 1) * 255);
        data[k + 3] = 255;
      }
    }
  }
  return data;
}

/** GPU texture array holding the procedural decal images (generated once, on first use). */
export class DecalAtlas {
  readonly texture: WebGLTexture;
  constructor(private gl: WebGL2RenderingContext, private state: GLState) {
    const layers = DECAL_KINDS.length;
    const tex = gl.createTexture()!;
    this.texture = tex;
    const levels = Math.floor(Math.log2(DECAL_SIZE)) + 1;
    state.bindScratch(TEX_2D_ARRAY, tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, gl.RGBA8, DECAL_SIZE, DECAL_SIZE, layers);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, DECAL_SIZE, DECAL_SIZE, layers, gl.RGBA, gl.UNSIGNED_BYTE, generateDecalPixels());
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) gl.texParameterf(gl.TEXTURE_2D_ARRAY, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number));
  }
  dispose(): void {
    this.state.forgetTexture(this.texture);
    this.gl.deleteTexture(this.texture);
  }
}
