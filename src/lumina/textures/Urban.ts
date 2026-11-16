import { Texture } from '../core/Texture';
import { clamp, smoothstep } from '../math/MathUtils';
import { PBRTextureSet, Texel, buildPBRSet, fbm, vnoise } from './Procedural';

/**
 * Lumina X – urban texture sets. A whole city is drawn with a handful of tiling textures + parallax relief instead of
 * geometry: recessed windows, mullions, sills, curbs, lane markings, paving joints and lit windows are all texels.
 */

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul((seed | 0) + 1, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const fract = (x: number) => x - Math.floor(x);
const toByte = (v: number) => Math.round(clamp(v, 0, 1) * 255);

/** Metres covered by one facade tile, and the grid it contains. */
export const FACADE = {
  bayWidth: 3.2,
  floorHeight: 3.6,
  cols: 6,
  rows: 6,
  /** tile size in metres */
  tileW: 3.2 * 6,
  tileH: 3.6 * 6,
  /** uv of the flat roof-membrane patch reserved in every facade tile (building roofs map here) */
  roofUV: [0.977, 0.977] as [number, number],
};

export interface FacadeSet extends PBRTextureSet {
  emissiveMap: Texture;
}

/** Layout shared by the colour and the emissive pass so the light in a window matches its curtains / blinds. */
interface Cell {
  type: number; // 0 dark glass · 1 blinds · 2 curtains · 3 sky-reflective · 4 blank wall
  lit: number; // 0 … 1.4 brightness (0 = dark)
  tint: [number, number, number];
  curtain: [number, number, number];
  blind: number; // fraction of the window height covered by blinds (from the top)
}

function buildCells(cols: number, rows: number, seed: number, litProb: number): Cell[] {
  const cells: Cell[] = [];
  for (let r = 0; r < rows; r++) {
    const rowBias = hash2(r, 99, seed);
    for (let c = 0; c < cols; c++) {
      const h = hash2(c, r, seed);
      const h2 = hash2(c, r, seed + 31);
      const h3 = hash2(c, r, seed + 57);
      let type = h < 0.5 ? 0 : h < 0.68 ? 1 : h < 0.8 ? 2 : 3;
      if (c === cols - 1 && r === rows - 1) type = 4;
      const p = litProb * (rowBias > 0.82 ? 1.9 : rowBias < 0.25 ? 0.4 : 1);
      const lit = h2 < p ? 0.55 + 0.9 * hash2(c, r, seed + 77) : 0;
      const k = h3;
      // warm tungsten / LED, cool office white, rare coloured screens
      const tint: [number, number, number] = k < 0.62 ? [1.0, 0.7 + 0.1 * h, 0.4 + 0.12 * h2] : k < 0.9 ? [0.72, 0.86, 1.0] : [0.95, 0.45, 0.7];
      const cu = hash2(c, r, seed + 5);
      const curtain: [number, number, number] = cu < 0.4 ? [0.62, 0.55, 0.45] : cu < 0.7 ? [0.5, 0.15, 0.12] : [0.35, 0.42, 0.5];
      cells.push({ type, lit, tint, curtain, blind: type === 1 ? 0.3 + 0.55 * hash2(c, r, seed + 9) : type === 2 ? 0.75 : 0 });
    }
  }
  return cells;
}

/**
 * Concrete / stone facade with recessed windows (frame, mullion, transom, sill, blinds, curtains, per-window lighting).
 * Height field: wall 1, sill .8, frame .42, glass 0 → use `parallaxScale ≈ 0.22`.
 */
export function createFacade(size = 1024, style: 'concrete' | 'glass' = 'concrete', seed = 7): FacadeSet {
  const cols = style === 'glass' ? 12 : FACADE.cols;
  const rows = FACADE.rows;
  const cells = buildCells(style === 'glass' ? 4 : cols, rows, seed, style === 'glass' ? 0.3 : 0.4);
  const glassCells = style === 'glass' ? buildCells(cols, rows, seed + 3, 0.34) : cells;
  const roofU0 = 0.955;

  const set = buildPBRSet(size, style === 'glass' ? 1.4 : 2.4, (u, v) => {
    // reserved flat roof-membrane patch
    if (u >= roofU0 && v >= roofU0) {
      const g = vnoise(u * 700, v * 700, 700, 700, 3);
      const k = 0.2 * (0.8 + 0.4 * g);
      return { r: k, g: k, b: k * 1.04, h: 1, roughness: 0.9, metalness: 0, ao: 1 };
    }
    const cx = u * cols,
      cy = v * rows;
    const c = Math.floor(cx),
      r = Math.floor(cy);
    const fx = cx - c,
      fy = cy - r;
    const grain = vnoise(u * 110, v * 110, 110, 110, 3) * 0.55 + vnoise(u * 420, v * 420, 420, 420, 9) * 0.45;
    const stain = fbm(u * 6, v * 6, 6, 6, 3, 21);

    if (style === 'glass') {
      // curtain wall: opaque spandrel (lower 30 %) + vision glass, thin metal mullions
      const cell = glassCells[r * cols + c];
      const mx = Math.min(fx, 1 - fx);
      const mullion = mx < 0.028 || fy < 0.018;
      if (mullion) return { r: 0.34, g: 0.35, b: 0.37, h: 1, roughness: 0.32, metalness: 0.85, ao: 0.9 };
      if (fy < 0.3) {
        const k = 0.1 + 0.03 * grain;
        return { r: k * 0.9, g: k, b: k * 1.25, h: 0.62, roughness: 0.28, metalness: 0.5, ao: 0.8 };
      }
      const ly = (fy - 0.3) / 0.7;
      const tintv = 0.7 + 0.6 * hash2(c, r, seed + 11);
      const sky = 0.035 + 0.05 * ly;
      let rr = sky * 0.55 * tintv,
        gg = sky * 0.9 * tintv,
        bb = sky * 1.25 * tintv;
      if (cell.lit > 0 && cell.type === 1 && ly > 1 - cell.blind) {
        rr = 0.5;
        gg = 0.48;
        bb = 0.44;
      }
      return { r: rr, g: gg, b: bb, h: 0.55, roughness: 0.04, metalness: 0.4, ao: 0.7 + 0.3 * ly };
    }

    // ── concrete facade ──
    const cell = cells[r * cols + c];
    const wx0 = 0.13,
      wx1 = 0.87,
      wy0 = 0.2,
      wy1 = 0.84;
    const tone = 0.62 + 0.14 * (hash2(r, 3, seed) - 0.5);
    let R = tone * (0.86 + 0.26 * grain) * (1 - 0.18 * stain);
    let G = (tone - 0.02) * (0.86 + 0.26 * grain) * (1 - 0.18 * stain);
    let B = (tone - 0.05) * (0.86 + 0.26 * grain) * (1 - 0.18 * stain);
    let h = 1;
    let rough = 0.86 + 0.1 * grain;
    let metal = 0;
    let ao = 1;
    // panel joints
    if (fx < 0.006 || fx > 0.994 || fy < 0.006 || fy > 0.994) {
      R *= 0.62;
      G *= 0.62;
      B *= 0.62;
      h = 0.88;
      ao = 0.7;
    }
    // vertical streaks below the sills (rain stains)
    const streak = vnoise(u * 160, v * 6, 160, 6, 41);
    if (fy < 0.2 && fx > 0.1 && fx < 0.9) {
      const sdark = smoothstep(0.55, 0.85, streak) * (1 - fy / 0.2) * 0.35;
      R *= 1 - sdark;
      G *= 1 - sdark;
      B *= 1 - sdark;
    }
    if (cell.type === 4) return { r: R, g: G, b: B, h, roughness: rough, metalness: metal, ao };
    // sill
    if (fy > wy0 - 0.055 && fy <= wy0 && fx > wx0 - 0.025 && fx < wx1 + 0.025) {
      return { r: R * 1.18, g: G * 1.18, b: B * 1.18, h: 0.8, roughness: 0.78, metalness: 0, ao: 0.85 };
    }
    // reveal (the wall surrounding the window drops toward the frame)
    const dx = Math.min(fx - wx0, wx1 - fx),
      dy = Math.min(fy - wy0, wy1 - fy);
    if (dx > -0.02 && dy > -0.02 && (dx < 0 || dy < 0)) {
      return { r: R * 0.7, g: G * 0.7, b: B * 0.7, h: 0.72, roughness: 0.9, metalness: 0, ao: 0.6 };
    }
    if (dx >= 0 && dy >= 0) {
      const lx = (fx - wx0) / (wx1 - wx0),
        ly = (fy - wy0) / (wy1 - wy0);
      const ft = 0.03,
        fty = 0.027;
      const frame = dx < ft || dy < fty || Math.abs(fx - 0.5) < 0.012 || Math.abs(ly - 0.68) * (wy1 - wy0) < 0.011;
      if (frame) return { r: 0.1, g: 0.1, b: 0.11, h: 0.42, roughness: 0.38, metalness: 0.8, ao: 0.85 };
      // glass + interior
      let rr = 0.025 + 0.02 * ly,
        gg = 0.034 + 0.026 * ly,
        bb = 0.046 + 0.034 * ly;
      let rg = 0.05;
      let hh = 0;
      let mt = 0;
      if (cell.type === 3) {
        rr *= 2.2;
        gg *= 2.4;
        bb *= 2.8;
      }
      const top = 1 - cell.blind;
      if (cell.type === 1 && ly > top) {
        // venetian blinds: slats
        const slat = fract(ly * 15);
        const sh = 0.55 + 0.45 * smoothstep(0, 0.4, slat) * (1 - smoothstep(0.7, 1, slat));
        rr = 0.62 * sh;
        gg = 0.58 * sh;
        bb = 0.5 * sh;
        rg = 0.72;
        hh = 0.06;
      } else if (cell.type === 2) {
        // curtains drawn at both sides + a valance on top
        const side = Math.min(lx, 1 - lx);
        if (side < 0.3 || ly > top) {
          const fold = 0.75 + 0.25 * Math.sin(lx * 60);
          rr = cell.curtain[0] * fold;
          gg = cell.curtain[1] * fold;
          bb = cell.curtain[2] * fold;
          rg = 0.92;
          hh = 0.1;
        }
      }
      mt = 0;
      return { r: rr, g: gg, b: bb, h: hh, roughness: rg, metalness: mt, ao: 0.55 + 0.4 * ly };
    }
    return { r: R, g: G, b: B, h, roughness: rough, metalness: metal, ao };
  });

  // ── emissive pass: lit windows ──
  const n = size * size;
  const em = new Uint8Array(n * 4);
  for (let j = 0; j < size; j++) {
    const v = j / size;
    const r = Math.floor(v * rows);
    const fy = v * rows - r;
    for (let i = 0; i < size; i++) {
      const u = i / size;
      const k = (j * size + i) * 4;
      em[k + 3] = 255;
      if (u >= roofU0 && v >= roofU0) continue;
      const cx = u * cols;
      const c = Math.floor(cx);
      const fx = cx - c;
      let lit = 0;
      let tint: [number, number, number] = [1, 1, 1];
      let m = 1;
      if (style === 'glass') {
        const cell = glassCells[r * cols + c];
        const mx = Math.min(fx, 1 - fx);
        if (mx < 0.028 || fy < 0.3) continue;
        const ly = (fy - 0.3) / 0.7;
        // office floors: a light strip fades toward the floor
        lit = cell.lit;
        tint = cell.tint;
        m = 0.5 + 0.5 * ly;
        if (cell.type === 1 && ly > 1 - cell.blind) m *= 0.25;
      } else {
        const cell = cells[r * cols + c];
        if (cell.type === 4 || cell.lit <= 0) continue;
        const wx0 = 0.13,
          wx1 = 0.87,
          wy0 = 0.2,
          wy1 = 0.84;
        const dx = Math.min(fx - wx0, wx1 - fx),
          dy = Math.min(fy - wy0, wy1 - fy);
        if (dx < 0.03 || dy < 0.027 || Math.abs(fx - 0.5) < 0.012) continue;
        const ly = (fy - wy0) / (wy1 - wy0);
        if (Math.abs(ly - 0.68) * (wy1 - wy0) < 0.011) continue;
        const lx = (fx - wx0) / (wx1 - wx0);
        lit = cell.lit;
        tint = cell.tint;
        m = 0.45 + 0.55 * ly;
        if (cell.type === 1 && ly > 1 - cell.blind) m *= 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(ly * 15 * 6.283));
        if (cell.type === 2) {
          const side = Math.min(lx, 1 - lx);
          if (side < 0.3 || ly > 1 - cell.blind) {
            m *= 0.55;
            tint = [mix(tint[0], cell.curtain[0], 0.6), mix(tint[1], cell.curtain[1], 0.6), mix(tint[2], cell.curtain[2], 0.6)];
          }
        }
      }
      const e = lit * m;
      em[k] = toByte(tint[0] * e);
      em[k + 1] = toByte(tint[1] * e);
      em[k + 2] = toByte(tint[2] * e);
    }
  }
  const emissiveMap = new Texture({ data: em, width: size, height: size, colorSpace: 'srgb', anisotropy: 16 });
  return { ...set, emissiveMap };
}

/** Geometry constants of the street tile (metres). One tile = one block + the half streets around it. */
export const ROAD = {
  tile: 96,
  /** half extent of the buildable lot (inside the sidewalk) */
  lotHalf: 32,
  /** distance from the tile centre to the curb */
  curb: 38,
  /** centre line of the streets in tile space */
  streetCenter: 48,
  streetWidth: 20,
};

/**
 * Seamless tile of a city block with its streets: asphalt with wheel tracks and cracks, double yellow centre line,
 * dashed lane lines, parking bays, zebra crossings, manholes, curbs (relief), paving slabs with joints, lot concrete.
 * Height field: sidewalk 1, asphalt ≈ .2 → `parallaxScale ≈ 0.16` makes the curbs real.
 */
export function createRoadTile(size = 2048): PBRTextureSet {
  const T = ROAD.tile;
  const manholes: [number, number][] = [
    [45.5, 13],
    [50.5, -21],
    [-13, 45.5],
    [22, 50.5],
    [-27, 41.5],
    [41.5, 30],
  ];
  const fn = (u: number, v: number): Texel => {
    const x = (u - 0.5) * T,
      z = (v - 0.5) * T;
    const ax = Math.abs(x),
      az = Math.abs(z);
    const gA = vnoise(u * 520, v * 520, 520, 520, 5);
    const gB = vnoise(u * 90, v * 90, 90, 90, 7);
    const patch = fbm(u * 14, v * 14, 14, 14, 3, 11);
    const sx = ax > ROAD.curb,
      sz = az > ROAD.curb;

    if (sx || sz) {
      // ── asphalt ──
      let k = 0.2 + 0.05 * gA + 0.035 * gB - 0.03 * patch;
      let rough = 0.9 + 0.06 * gA;
      let h = 0.16 + 0.07 * gA + 0.03 * gB;
      let ao = 1;
      let R = k,
        G = k,
        B = k * 1.04;
      const vertical = sx && !sz; // street running along z
      const horizontal = sz && !sx; // street running along x
      const dC = vertical ? Math.abs(ax - ROAD.streetCenter) : horizontal ? Math.abs(az - ROAD.streetCenter) : 99;
      const along = vertical ? az : ax;
      const inter = sx && sz;
      // gutter beside the curb (darker, wetter, deeper)
      const curbD = vertical ? ax - ROAD.curb : horizontal ? az - ROAD.curb : Math.min(ax, az) - ROAD.curb;
      if (curbD < 0.7) {
        const t = 1 - curbD / 0.7;
        R *= 1 - 0.3 * t;
        G *= 1 - 0.3 * t;
        B *= 1 - 0.3 * t;
        rough = 0.8;
        ao = 1 - 0.35 * t;
        h -= 0.08 * t;
      }
      if (!inter) {
        // wheel tracks: polished, slightly darker
        const tr = Math.min(Math.abs(dC - 1.9 + 0.85), Math.abs(dC - 1.9 - 0.85), Math.abs(dC - 5.4 + 0.85), Math.abs(dC - 5.4 - 0.85));
        if (tr < 0.38 && dC < 7.2) {
          const t = 1 - tr / 0.38;
          R *= 1 - 0.28 * t;
          G *= 1 - 0.28 * t;
          B *= 1 - 0.28 * t;
          rough = mix(rough, 0.68, t);
        }
        const wear = 1 - 0.65 * smoothstep(0.55, 0.9, vnoise(u * 160, v * 160, 160, 160, 13));
        const paint = (rr: number, gg: number, bb: number, a: number) => {
          R = mix(R, rr, a * wear);
          G = mix(G, gg, a * wear);
          B = mix(B, bb, a * wear);
          rough = mix(rough, 0.52, a * wear);
          h += 0.015 * a;
        };
        // double yellow centre line
        if (dC > 0.12 && dC < 0.28) paint(0.8, 0.62, 0.06, 1);
        // dashed lane line (3 m on / 6 m off)
        if (dC > 3.55 && dC < 3.7 && fract(along / 9) < 1 / 3) paint(0.86, 0.86, 0.84, 1);
        // solid parking line + parking bay ticks
        if (dC > 7.15 && dC < 7.3) paint(0.86, 0.86, 0.84, 1);
        if (dC > 7.3 && dC < 10 && fract(along / 6) < 0.017) paint(0.86, 0.86, 0.84, 1);
        // zebra crossing + stop line at both mouths
        const mouth = (vertical ? az : ax) - 0;
        if (mouth > 34.2 && mouth < 37.6 && dC < 9.6 && fract(dC / 1.0) < 0.52) paint(0.9, 0.9, 0.88, 1);
        if (mouth > 31.9 && mouth < 32.6 && dC > 0.4 && dC < 7.2) paint(0.9, 0.9, 0.88, 1);
      }
      // manholes
      for (let i = 0; i < manholes.length; i++) {
        const dx = x - manholes[i][0],
          dz = z - manholes[i][1];
        const dd = Math.sqrt(dx * dx + dz * dz);
        if (dd < 0.46) {
          const ring = dd > 0.4;
          const grid = fract(dx * 9) < 0.15 || fract(dz * 9) < 0.15 ? 0.7 : 1;
          const m = ring ? 0.2 : 0.16 * grid;
          return { r: m * 1.1, g: m, b: m * 0.95, h: ring ? 0.2 : 0.1, roughness: 0.5, metalness: 0.85, ao: ring ? 0.7 : 0.9 };
        }
      }
      // cracks (ridged noise) and tar seams
      const cr = Math.abs(vnoise(u * 38, v * 38, 38, 38, 19) - 0.5) + 0.35 * Math.abs(vnoise(u * 90, v * 90, 90, 90, 23) - 0.5);
      if (cr < 0.011) {
        R *= 0.45;
        G *= 0.45;
        B *= 0.45;
        h -= 0.1;
        rough = 0.95;
        ao *= 0.7;
      }
      // oil / tyre stains
      const oil = smoothstep(0.7, 0.9, fbm(u * 30, v * 30, 30, 30, 3, 29));
      if (oil > 0) {
        R *= 1 - 0.3 * oil;
        G *= 1 - 0.3 * oil;
        B *= 1 - 0.3 * oil;
        rough = mix(rough, 0.45, oil);
      }
      return { r: R, g: G, b: B, h, roughness: rough, metalness: 0, ao };
    }

    // ── sidewalk / lot ──
    const onWalk = ax > ROAD.lotHalf || az > ROAD.lotHalf;
    const slab = onWalk ? 1.2 : 4.8;
    const gx = fract(x / slab),
      gz = fract(z / slab);
    const sid = hash2(Math.floor(x / slab), Math.floor(z / slab), 3);
    const joint = Math.min(gx, 1 - gx, gz, 1 - gz) * slab;
    const jw = onWalk ? 0.014 : 0.03;
    let base = onWalk ? 0.5 : 0.4;
    base *= 0.88 + 0.22 * sid;
    base *= 0.9 + 0.2 * gA;
    base *= 1 - 0.25 * smoothstep(0.55, 0.85, patch);
    let R = base,
      G = base * 0.99,
      B = base * 0.96;
    let h = 1 - 0.04 * gA;
    let rough = 0.84 + 0.1 * gB;
    let ao = 1;
    if (joint < jw) {
      R *= 0.5;
      G *= 0.5;
      B *= 0.5;
      h = 0.82;
      ao = 0.6;
      rough = 0.95;
    }
    // curb: top strip + vertical face ramps toward the street
    const cd = Math.min(ROAD.curb - ax, ROAD.curb - az);
    if (cd < 0.5 && cd >= 0) {
      const t = 1 - cd / 0.5;
      // cd in [0,0.2] is the curb face going down to the asphalt
      if (cd < 0.2) {
        const f = cd / 0.2;
        h = mix(0.18, 1, smoothstep(0, 1, f));
        R *= 0.9;
        G *= 0.9;
        B *= 0.9;
      }
      R *= 1 + 0.12 * t;
      G *= 1 + 0.12 * t;
      B *= 1 + 0.12 * t;
    }
    // gum, moss in joints, stains
    const gum = hash2(Math.floor(u * 900), Math.floor(v * 900), 17);
    if (onWalk && gum > 0.9985) {
      R *= 0.4;
      G *= 0.4;
      B *= 0.4;
    }
    return { r: R, g: G, b: B, h, roughness: rough, metalness: 0, ao };
  };
  return buildPBRSet(size, 1.6, fn);
}

/** Leaf-cluster texture for tree canopies (albedo + normal + ORM + height). */
export function createLeaves(size = 256): PBRTextureSet {
  return buildPBRSet(size, 2.0, (u, v) => {
    const a = fbm(u * 18, v * 18, 18, 18, 4, 2);
    const b = vnoise(u * 60, v * 60, 60, 60, 4);
    const leaf = smoothstep(0.35, 0.7, a);
    const lum = 0.55 + 0.45 * b;
    return {
      r: mix(0.05, 0.16, leaf) * lum,
      g: mix(0.14, 0.34, leaf) * lum,
      b: mix(0.03, 0.07, leaf) * lum,
      h: leaf * 0.7 + b * 0.3,
      roughness: 0.7 + 0.2 * b,
      metalness: 0,
      ao: mix(0.35, 1, leaf),
    };
  });
}
