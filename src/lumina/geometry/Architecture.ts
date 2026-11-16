import { BufferAttribute, Geometry } from '../core/Geometry';
import { FACADE } from '../textures/Urban';

/**
 * Lumina X – ultra-lean architectural primitives. Detail is carried by the textures (windows are parallax relief,
 * not polygons), so a whole skyscraper is a handful of quads:
 *
 *   createBuildingGeometry   stacked tiers, uvs in *metres* of the facade tile → windows keep their real size on every
 *                            face and every footprint; the roof maps to the flat membrane patch of the tile
 *   createCarGeometry        smooth-profile body + glass/wheel mesh (≈ 150 triangles)
 *   createLampGeometry       street lamp pole + emissive head
 *   createTreeGeometry       trunk + lumpy canopy
 */

interface Builder {
  p: number[];
  n: number[];
  uv: number[];
  i: number[];
}
const nb = (): Builder => ({ p: [], n: [], uv: [], i: [] });

function quad(b: Builder, a: number[], bb: number[], c: number[], d: number[], n: number[], uva: number[], uvb: number[], uvc: number[], uvd: number[]): void {
  const base = b.p.length / 3;
  for (const [pt, uv] of [
    [a, uva],
    [bb, uvb],
    [c, uvc],
    [d, uvd],
  ] as [number[], number[]][]) {
    b.p.push(pt[0], pt[1], pt[2]);
    b.n.push(n[0], n[1], n[2]);
    b.uv.push(uv[0], uv[1]);
  }
  b.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function finish(b: Builder, type: string): Geometry {
  const g = new Geometry();
  g.type = type;
  g.setAttribute('position', new BufferAttribute(new Float32Array(b.p), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(b.n), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(b.uv), 2));
  g.setIndex(b.i);
  g.computeTangents();
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** Deterministic PRNG (mulberry32). */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface BuildingTier {
  /** footprint in facade bays (3.2 m each): [x, z] */
  bays: [number, number];
  floors: number;
}
export interface BuildingSpec {
  tiers: BuildingTier[];
  /** which part of the (6 × 6 bay) facade tile the building starts on – changes the pattern of lit windows */
  uvPhase?: [number, number];
  seed?: number;
  /** AC units, penthouse and antenna on the roof */
  roofDetail?: boolean;
}

export function buildingSize(spec: BuildingSpec): { width: number; depth: number; height: number } {
  const t0 = spec.tiers[0];
  let h = 0;
  for (const t of spec.tiers) h += t.floors * FACADE.floorHeight;
  return { width: t0.bays[0] * FACADE.bayWidth, depth: t0.bays[1] * FACADE.bayWidth, height: h };
}

const ROOF = FACADE.roofUV;

/** Roof-material box: every face maps to the flat roof patch (no window texture on AC units). */
function roofBox(b: Builder, cx: number, y0: number, cz: number, w: number, h: number, d: number): void {
  const hx = w / 2,
    hz = d / 2,
    y1 = y0 + h;
  const uv = (x: number, z: number) => [ROOF[0] + x * 2e-5, ROOF[1] + z * 2e-5];
  const P = (x: number, y: number, z: number) => [cx + x, y, cz + z];
  // +z, -z, +x, -x, +y
  quad(b, P(-hx, y0, hz), P(hx, y0, hz), P(hx, y1, hz), P(-hx, y1, hz), [0, 0, 1], uv(0, 0), uv(w, 0), uv(w, h), uv(0, h));
  quad(b, P(hx, y0, -hz), P(-hx, y0, -hz), P(-hx, y1, -hz), P(hx, y1, -hz), [0, 0, -1], uv(0, 0), uv(w, 0), uv(w, h), uv(0, h));
  quad(b, P(hx, y0, hz), P(hx, y0, -hz), P(hx, y1, -hz), P(hx, y1, hz), [1, 0, 0], uv(0, 0), uv(d, 0), uv(d, h), uv(0, h));
  quad(b, P(-hx, y0, -hz), P(-hx, y0, hz), P(-hx, y1, hz), P(-hx, y1, -hz), [-1, 0, 0], uv(0, 0), uv(d, 0), uv(d, h), uv(0, h));
  quad(b, P(-hx, y1, hz), P(hx, y1, hz), P(hx, y1, -hz), P(-hx, y1, -hz), [0, 1, 0], uv(0, 0), uv(w, 0), uv(w, d), uv(0, d));
}

export function createBuildingGeometry(spec: BuildingSpec): Geometry {
  const b = nb();
  const rng = makeRng(spec.seed ?? 1);
  const { cols, rows, tileW, tileH } = FACADE;
  const phaseU = Math.round((spec.uvPhase?.[0] ?? 0) * cols) / cols;
  const phaseV = Math.round((spec.uvPhase?.[1] ?? 0) * rows) / rows;
  let y0 = 0;
  for (let ti = 0; ti < spec.tiers.length; ti++) {
    const t = spec.tiers[ti];
    const w = t.bays[0] * FACADE.bayWidth,
      d = t.bays[1] * FACADE.bayWidth;
    const h = t.floors * FACADE.floorHeight;
    const y1 = y0 + h;
    const hx = w / 2,
      hz = d / 2;
    const v0 = phaseV + y0 / tileH,
      v1 = phaseV + y1 / tileH;
    // four sides (t × up = outward normal)
    const faces: { o: number[]; t: number[]; n: number[]; len: number }[] = [
      { o: [-hx, 0, hz], t: [1, 0, 0], n: [0, 0, 1], len: w },
      { o: [hx, 0, hz], t: [0, 0, -1], n: [1, 0, 0], len: d },
      { o: [hx, 0, -hz], t: [-1, 0, 0], n: [0, 0, -1], len: w },
      { o: [-hx, 0, -hz], t: [0, 0, 1], n: [-1, 0, 0], len: d },
    ];
    faces.forEach((f, fi) => {
      const u0 = phaseU + fi * (2 / cols) + ti * (1 / cols);
      const u1 = u0 + f.len / tileW;
      const a = [f.o[0], y0, f.o[2]];
      const bb = [f.o[0] + f.t[0] * f.len, y0, f.o[2] + f.t[2] * f.len];
      const c = [bb[0], y1, bb[2]];
      const dd = [a[0], y1, a[2]];
      quad(b, a, bb, c, dd, f.n, [u0, v0], [u1, v0], [u1, v1], [u0, v1]);
    });
    // roof of this tier
    const uv = (x: number, z: number) => [ROOF[0] + x * 2e-5, ROOF[1] + z * 2e-5];
    quad(b, [-hx, y1, hz], [hx, y1, hz], [hx, y1, -hz], [-hx, y1, -hz], [0, 1, 0], uv(-hx, hz), uv(hx, hz), uv(hx, -hz), uv(-hx, -hz));
    y0 = y1;
  }
  if (spec.roofDetail !== false) {
    const top = spec.tiers[spec.tiers.length - 1];
    const w = top.bays[0] * FACADE.bayWidth,
      d = top.bays[1] * FACADE.bayWidth;
    const n = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const bw = 1.8 + rng() * 2.6,
        bd = 1.8 + rng() * 2.6,
        bh = 0.9 + rng() * 1.6;
      const cx = (rng() - 0.5) * Math.max(w - bw - 3, 0.1),
        cz = (rng() - 0.5) * Math.max(d - bd - 3, 0.1);
      roofBox(b, cx, y0, cz, bw, bh, bd);
    }
    if (rng() < 0.7 && w > 12 && d > 12) roofBox(b, (rng() - 0.5) * 0.3 * w, y0, (rng() - 0.5) * 0.3 * d, Math.min(w * 0.3, 9), 3.2, Math.min(d * 0.3, 9));
    if (y0 > 70) roofBox(b, 0, y0, 0, 0.5, 12 + rng() * 14, 0.5);
  }
  return finish(b, 'BuildingGeometry');
}

// ───────────────────────────── cars ─────────────────────────────

function chaikin(pts: number[][], rounds: number): number[][] {
  let p = pts;
  for (let r = 0; r < rounds; r++) {
    const q: number[][] = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i],
        c = p[(i + 1) % p.length];
      q.push([a[0] * 0.75 + c[0] * 0.25, a[1] * 0.75 + c[1] * 0.25], [a[0] * 0.25 + c[0] * 0.75, a[1] * 0.25 + c[1] * 0.75]);
    }
    p = q;
  }
  return p;
}

/** Extrudes a (x, y) profile along z, smooth normals on the rim, flat caps. */
function extrudeProfile(b: Builder, input: number[][], z0: number, z1: number): void {
  // the rim normals / winding assume a counter-clockwise profile: flip when the signed area is negative
  let area = 0;
  for (let i = 0; i < input.length; i++) {
    const a = input[i],
      c = input[(i + 1) % input.length];
    area += a[0] * c[1] - c[0] * a[1];
  }
  const prof = area < 0 ? input.slice().reverse() : input;
  const n = prof.length;
  // outward 2D normals per vertex (average of the adjacent edge normals; profile is CCW)
  const nrm: number[][] = [];
  for (let i = 0; i < n; i++) {
    const a = prof[(i + n - 1) % n],
      c = prof[(i + 1) % n];
    let nx = c[1] - a[1],
      ny = -(c[0] - a[0]);
    const l = Math.hypot(nx, ny) || 1;
    nx /= l;
    ny /= l;
    nrm.push([nx, ny]);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const base = b.p.length / 3;
    const A = prof[i],
      B = prof[j];
    b.p.push(A[0], A[1], z0, B[0], B[1], z0, B[0], B[1], z1, A[0], A[1], z1);
    b.n.push(nrm[i][0], nrm[i][1], 0, nrm[j][0], nrm[j][1], 0, nrm[j][0], nrm[j][1], 0, nrm[i][0], nrm[i][1], 0);
    b.uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    b.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  // caps (fan)
  for (const [z, nz] of [
    [z0, -1],
    [z1, 1],
  ] as [number, number][]) {
    const base = b.p.length / 3;
    for (let i = 0; i < n; i++) {
      b.p.push(prof[i][0], prof[i][1], z);
      b.n.push(0, 0, nz);
      b.uv.push(0.5, 0.5);
    }
    for (let i = 1; i < n - 1; i++) {
      if (nz > 0) b.i.push(base, base + i, base + i + 1);
      else b.i.push(base, base + i + 1, base + i);
    }
  }
}

function boxInto(b: Builder, cx: number, cy: number, cz: number, w: number, h: number, d: number): void {
  roofBox(b, cx, cy - h / 2, cz, w, h, d);
}

/**
 * A compact sedan (length along +x, ≈ 4.4 m): `body` (paint – give it instance colours) and `dark` (glass + wheels).
 * About 150 triangles for the pair.
 */
export function createCarGeometry(): { body: Geometry; dark: Geometry } {
  const hull: number[][] = [
    [-2.2, 0.3],
    [-2.2, 0.66],
    [-1.8, 0.93],
    [-1.3, 0.97],
    [-0.95, 0.97],
    [0.95, 0.97],
    [1.7, 0.86],
    [2.2, 0.62],
    [2.2, 0.3],
    [1.4, 0.26],
    [-1.4, 0.26],
  ];
  const body = nb();
  extrudeProfile(body, chaikin(hull, 1), -0.9, 0.9);
  // roof slab
  boxInto(body, -0.15, 1.38, 0, 1.45, 0.05, 1.5);
  const dark = nb();
  // cabin glass (slightly narrower than the body so the paint frames it)
  const cabin: number[][] = [
    [-1.3, 0.95],
    [-0.88, 1.36],
    [0.52, 1.36],
    [1.02, 0.95],
  ];
  extrudeProfile(dark, cabin, -0.77, 0.77);
  for (const sx of [-1.35, 1.38]) for (const sz of [-0.82, 0.82]) boxInto(dark, sx, 0.34, sz, 0.68, 0.68, 0.24);
  return { body: finish(body, 'CarBody'), dark: finish(dark, 'CarDark') };
}

// ───────────────────────────── street furniture ─────────────────────────────

function prism(b: Builder, cx: number, y0: number, cz: number, r: number, h: number, seg: number, r1 = r): void {
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2,
      a1 = ((i + 1) / seg) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    const base = b.p.length / 3;
    const x0 = Math.cos(a0),
      z0 = Math.sin(a0),
      x1 = Math.cos(a1),
      z1 = Math.sin(a1);
    b.p.push(cx + x0 * r, y0, cz + z0 * r, cx + x1 * r, y0, cz + z1 * r, cx + x1 * r1, y0 + h, cz + z1 * r1, cx + x0 * r1, y0 + h, cz + z0 * r1);
    const nxm = Math.cos(am),
      nzm = Math.sin(am);
    b.n.push(x0, 0, z0, x1, 0, z1, x1, 0, z1, x0, 0, z0);
    void nxm;
    void nzm;
    b.uv.push(i / seg, 0, (i + 1) / seg, 0, (i + 1) / seg, 1, i / seg, 1);
    b.i.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
}

/** Street lamp: `pole` (pole + arm, dark metal) and `head` (the emissive luminaire), both with the pole at the origin, arm toward +x. */
export function createLampGeometry(height = 9, arm = 2.4): { pole: Geometry; head: Geometry } {
  const pole = nb();
  prism(pole, 0, 0, 0, 0.13, height, 6, 0.08);
  boxInto(pole, arm / 2, height + 0.05, 0, arm, 0.1, 0.1);
  const head = nb();
  boxInto(head, arm, height - 0.04, 0, 1.0, 0.14, 0.42);
  return { pole: finish(pole, 'LampPole'), head: finish(head, 'LampHead') };
}

/** Tree: `trunk` + `canopy` (vertex-jittered icosphere-ish sphere). */
export function createTreeGeometry(seed = 3): { trunk: Geometry; canopy: Geometry } {
  const rng = makeRng(seed);
  const trunk = nb();
  prism(trunk, 0, 0, 0, 0.22, 3.4, 6, 0.14);
  const canopy = nb();
  const seg = 8,
    rings = 5,
    R = 2.6;
  const grid: number[][] = [];
  for (let j = 0; j <= rings; j++) {
    const phi = (j / rings) * Math.PI;
    for (let i = 0; i <= seg; i++) {
      const th = (i / seg) * Math.PI * 2;
      const wrapI = i % seg;
      const jit = 0.8 + 0.4 * (j === 0 || j === rings ? 0.5 : hash(wrapI, j, seed, rng));
      const r = R * jit;
      grid.push([Math.sin(phi) * Math.cos(th) * r * 1.1, Math.cos(phi) * r * 0.85, Math.sin(phi) * Math.sin(th) * r * 1.1]);
    }
  }
  const base0 = canopy.p.length / 3;
  for (const g of grid) {
    const l = Math.hypot(g[0], g[1], g[2]) || 1;
    canopy.p.push(g[0], g[1] + 5.2, g[2]);
    canopy.n.push(g[0] / l, g[1] / l, g[2] / l);
    canopy.uv.push((Math.atan2(g[2], g[0]) / Math.PI) * 1.5 + 1.5, g[1] / R + 1);
  }
  for (let j = 0; j < rings; j++)
    for (let i = 0; i < seg; i++) {
      const a = base0 + j * (seg + 1) + i,
        c = a + seg + 1;
      canopy.i.push(a, a + 1, c, a + 1, c + 1, c);
    }
  return { trunk: finish(trunk, 'TreeTrunk'), canopy: finish(canopy, 'TreeCanopy') };
}

function hash(i: number, j: number, seed: number, rng: () => number): number {
  void rng;
  let h = Math.imul(i + 1, 374761393) ^ Math.imul(j + 1, 668265263) ^ Math.imul(seed + 7, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
