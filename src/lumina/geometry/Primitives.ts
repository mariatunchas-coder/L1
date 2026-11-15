import { BufferAttribute, Geometry } from '../core/Geometry';

interface Builder {
  p: number[];
  n: number[];
  uv: number[];
  i: number[];
}

function finish(g: Geometry, b: Builder, type: string): Geometry {
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

const newBuilder = (): Builder => ({ p: [], n: [], uv: [], i: [] });

/**
 * UV layout of a (rounded) box. `arc(h, r, c)` is the distance (m) travelled over the surface from the face centre to the
 * grid coordinate `c` – on the bevels it follows the quarter-circle (arc length), so the texel density stays constant
 * and screen-space derivatives (mip selection, parallax ray march) don't blow up. `unit` = 0 → every face spans 0…1
 * (per-face repeat); otherwise one uv unit = `unit` metres on every face (uniform density on thin walls).
 */
function arcLength(h: number, r: number, c: number): number {
  if (r <= 0) return c;
  const a = Math.abs(c);
  const flat = h - r;
  const s = a <= flat ? a : flat + r * (((a - flat) / r) * (Math.PI / 2));
  return c < 0 ? -s : s;
}
const developed = (h: number, r: number): number => (r > 0 ? 2 * (h - r) + Math.PI * r : 2 * h);

/** Shared by Box and RoundedBox: builds 6 grid faces from per-axis coordinate lists. */
function buildBox(cx: number[], cy: number[], cz: number[], hx: number, hy: number, hz: number, radius: number, uvUnit = 0): Builder {
  const b = newBuilder();
  const coords: Record<string, number[]> = { x: cx, y: cy, z: cz };
  const half: Record<string, number> = { x: hx, y: hy, z: hz };
  const faces: [string, string, string, number, number, number][] = [
    ['z', 'y', 'x', -1, -1, 1],
    ['z', 'y', 'x', 1, -1, -1],
    ['x', 'z', 'y', 1, 1, 1],
    ['x', 'z', 'y', 1, -1, -1],
    ['x', 'y', 'z', 1, -1, 1],
    ['x', 'y', 'z', -1, -1, -1],
  ];
  const v: Record<string, number> = { x: 0, y: 0, z: 0 };
  for (const [u, vv, w, udir, vdir, wsign] of faces) {
    const cu = coords[u],
      cv = coords[vv];
    const offset = b.p.length / 3;
    const gX1 = cu.length,
      gY1 = cv.length;
    for (let iy = 0; iy < gY1; iy++) {
      for (let ix = 0; ix < gX1; ix++) {
        v[u] = cu[ix] * udir;
        v[vv] = cv[iy] * vdir;
        v[w] = half[w] * wsign;
        let nx = 0,
          ny = 0,
          nz = 0;
        let px = v.x,
          py = v.y,
          pz = v.z;
        if (radius > 0) {
          const ix_ = Math.min(Math.max(px, -(hx - radius)), hx - radius);
          const iy_ = Math.min(Math.max(py, -(hy - radius)), hy - radius);
          const iz_ = Math.min(Math.max(pz, -(hz - radius)), hz - radius);
          nx = px - ix_;
          ny = py - iy_;
          nz = pz - iz_;
          const l = Math.hypot(nx, ny, nz) || 1;
          nx /= l;
          ny /= l;
          nz /= l;
          px = ix_ + nx * radius;
          py = iy_ + ny * radius;
          pz = iz_ + nz * radius;
        } else {
          const nn: Record<string, number> = { x: 0, y: 0, z: 0 };
          nn[w] = wsign;
          nx = nn.x;
          ny = nn.y;
          nz = nn.z;
        }
        b.p.push(px, py, pz);
        b.n.push(nx, ny, nz);
        const Su = developed(half[u], radius),
          Sv = developed(half[vv], radius);
        const su = (arcLength(half[u], radius, cu[ix]) + Su / 2) / (uvUnit > 0 ? uvUnit : Su);
        const sv = (arcLength(half[vv], radius, cv[iy]) + Sv / 2) / (uvUnit > 0 ? uvUnit : Sv);
        b.uv.push(su, 1 - sv);
      }
    }
    for (let iy = 0; iy < gY1 - 1; iy++) {
      for (let ix = 0; ix < gX1 - 1; ix++) {
        const a = offset + ix + gX1 * iy;
        const bb = offset + ix + gX1 * (iy + 1);
        const c = offset + ix + 1 + gX1 * (iy + 1);
        const d = offset + ix + 1 + gX1 * iy;
        b.i.push(a, bb, d, bb, c, d);
      }
    }
  }
  return b;
}

const linspace = (half: number, seg: number) => Array.from({ length: seg + 1 }, (_, i) => (i / seg) * 2 * half - half);

export class BoxGeometry extends Geometry {
  /** @param worldUV when true one uv unit = the longest box edge on *every* face (uniform texel density, see RoundedBoxGeometry) */
  constructor(width = 1, height = 1, depth = 1, wSeg = 1, hSeg = 1, dSeg = 1, worldUV = false) {
    super();
    const hx = width / 2,
      hy = height / 2,
      hz = depth / 2;
    finish(this, buildBox(linspace(hx, wSeg), linspace(hy, hSeg), linspace(hz, dSeg), hx, hy, hz, 0, worldUV ? Math.max(width, height, depth) : 0), 'BoxGeometry');
  }
}

/** Box with real geometric bevels – catches highlights on edges like real-world objects do. */
export class RoundedBoxGeometry extends Geometry {
  /**
   * UVs follow the *arc length* of the bevels (no stretching on the rounded edges). With `worldUV` one uv unit equals
   * the longest box edge on every face, so a texture keeps the same scale on thin walls and big faces alike
   * (e.g. a 24 × 6 × 0.9 m wall with `uvRepeat: [27, 27]` → 27 bricks per 24 m on the front, ~1 on the 0.9 m side).
   */
  constructor(width = 1, height = 1, depth = 1, radius = 0.08, segments = 5, worldUV = false) {
    super();
    const hx = width / 2,
      hy = height / 2,
      hz = depth / 2;
    const r = Math.min(radius, hx, hy, hz);
    const axis = (h: number) => {
      const left: number[] = [],
        right: number[] = [];
      for (let j = segments; j >= 0; j--) left.push(-(h - r) - r * (j / segments));
      for (let j = 0; j <= segments; j++) right.push(h - r + r * (j / segments));
      return [...left, ...right];
    };
    finish(this, buildBox(axis(hx), axis(hy), axis(hz), hx, hy, hz, r, worldUV ? Math.max(width, height, depth) : 0), 'RoundedBoxGeometry');
  }
}

export class PlaneGeometry extends Geometry {
  constructor(width = 1, height = 1, wSeg = 1, hSeg = 1) {
    super();
    const b = newBuilder();
    const gx1 = wSeg + 1;
    for (let iy = 0; iy <= hSeg; iy++) {
      const y = (iy / hSeg) * height - height / 2;
      for (let ix = 0; ix <= wSeg; ix++) {
        const x = (ix / wSeg) * width - width / 2;
        b.p.push(x, -y, 0);
        b.n.push(0, 0, 1);
        b.uv.push(ix / wSeg, 1 - iy / hSeg);
      }
    }
    for (let iy = 0; iy < hSeg; iy++)
      for (let ix = 0; ix < wSeg; ix++) {
        const a = ix + gx1 * iy,
          bb = ix + gx1 * (iy + 1),
          c = ix + 1 + gx1 * (iy + 1),
          d = ix + 1 + gx1 * iy;
        b.i.push(a, bb, d, bb, c, d);
      }
    finish(this, b, 'PlaneGeometry');
  }
}

export class SphereGeometry extends Geometry {
  constructor(radius = 1, wSeg = 64, hSeg = 32) {
    super();
    const b = newBuilder();
    const grid: number[][] = [];
    let idx = 0;
    for (let iy = 0; iy <= hSeg; iy++) {
      const row: number[] = [];
      const v = iy / hSeg;
      const theta = v * Math.PI;
      for (let ix = 0; ix <= wSeg; ix++) {
        const u = ix / wSeg;
        const phi = u * Math.PI * 2;
        const x = -Math.cos(phi) * Math.sin(theta);
        const y = Math.cos(theta);
        const z = Math.sin(phi) * Math.sin(theta);
        b.p.push(radius * x, radius * y, radius * z);
        b.n.push(x, y, z);
        b.uv.push(u, 1 - v);
        row.push(idx++);
      }
      grid.push(row);
    }
    for (let iy = 0; iy < hSeg; iy++)
      for (let ix = 0; ix < wSeg; ix++) {
        const a = grid[iy][ix + 1],
          bb = grid[iy][ix],
          c = grid[iy + 1][ix],
          d = grid[iy + 1][ix + 1];
        if (iy !== 0) b.i.push(a, bb, d);
        if (iy !== hSeg - 1) b.i.push(bb, c, d);
      }
    finish(this, b, 'SphereGeometry');
  }
}

export class CylinderGeometry extends Geometry {
  constructor(radiusTop = 1, radiusBottom = 1, height = 1, radial = 48, hSeg = 1, openEnded = false) {
    super();
    const b = newBuilder();
    const grid: number[][] = [];
    let idx = 0;
    const slope = (radiusBottom - radiusTop) / height;
    for (let y = 0; y <= hSeg; y++) {
      const row: number[] = [];
      const v = y / hSeg;
      const r = v * (radiusBottom - radiusTop) + radiusTop;
      for (let x = 0; x <= radial; x++) {
        const u = x / radial;
        const theta = u * Math.PI * 2;
        const s = Math.sin(theta),
          c = Math.cos(theta);
        b.p.push(r * s, -v * height + height / 2, r * c);
        const l = Math.hypot(s, slope, c);
        b.n.push(s / l, slope / l, c / l);
        b.uv.push(u, 1 - v);
        row.push(idx++);
      }
      grid.push(row);
    }
    for (let x = 0; x < radial; x++)
      for (let y = 0; y < hSeg; y++) {
        const a = grid[y][x],
          bb = grid[y + 1][x],
          c = grid[y + 1][x + 1],
          d = grid[y][x + 1];
        if (radiusTop > 0 || y !== 0) b.i.push(a, bb, d);
        if (radiusBottom > 0 || y !== hSeg - 1) b.i.push(bb, c, d);
      }
    const cap = (top: boolean) => {
      const r = top ? radiusTop : radiusBottom;
      if (r <= 0) return;
      const sign = top ? 1 : -1;
      const centerStart = b.p.length / 3;
      for (let x = 1; x <= radial; x++) {
        b.p.push(0, (height / 2) * sign, 0);
        b.n.push(0, sign, 0);
        b.uv.push(0.5, 0.5);
      }
      const ringStart = b.p.length / 3;
      for (let x = 0; x <= radial; x++) {
        const theta = (x / radial) * Math.PI * 2;
        const c = Math.cos(theta),
          s = Math.sin(theta);
        b.p.push(r * s, (height / 2) * sign, r * c);
        b.n.push(0, sign, 0);
        b.uv.push(c * 0.5 + 0.5, s * 0.5 * sign + 0.5);
      }
      for (let x = 0; x < radial; x++) {
        const c = centerStart + x,
          i = ringStart + x;
        if (top) b.i.push(i, i + 1, c);
        else b.i.push(i + 1, i, c);
      }
    };
    if (!openEnded) {
      cap(true);
      cap(false);
    }
    finish(this, b, 'CylinderGeometry');
  }
}

export class TorusGeometry extends Geometry {
  constructor(radius = 1, tube = 0.35, radialSeg = 32, tubularSeg = 96) {
    super();
    const b = newBuilder();
    for (let j = 0; j <= radialSeg; j++)
      for (let i = 0; i <= tubularSeg; i++) {
        const u = (i / tubularSeg) * Math.PI * 2;
        const v = (j / radialSeg) * Math.PI * 2;
        const x = (radius + tube * Math.cos(v)) * Math.cos(u);
        const y = (radius + tube * Math.cos(v)) * Math.sin(u);
        const z = tube * Math.sin(v);
        b.p.push(x, y, z);
        const cx = radius * Math.cos(u),
          cy = radius * Math.sin(u);
        const nx = x - cx,
          ny = y - cy,
          nz = z;
        const l = Math.hypot(nx, ny, nz);
        b.n.push(nx / l, ny / l, nz / l);
        b.uv.push(i / tubularSeg, j / radialSeg);
      }
    for (let j = 1; j <= radialSeg; j++)
      for (let i = 1; i <= tubularSeg; i++) {
        const a = (tubularSeg + 1) * j + i - 1;
        const bb = (tubularSeg + 1) * (j - 1) + i - 1;
        const c = (tubularSeg + 1) * (j - 1) + i;
        const d = (tubularSeg + 1) * j + i;
        b.i.push(a, bb, d, bb, c, d);
      }
    finish(this, b, 'TorusGeometry');
  }
}

export class TorusKnotGeometry extends Geometry {
  constructor(radius = 1, tube = 0.3, tubularSeg = 256, radialSeg = 32, p = 2, q = 3) {
    super();
    const b = newBuilder();
    const pos = (u: number, out: number[]) => {
      const cu = Math.cos(u),
        su = Math.sin(u),
        qp = (q / p) * u,
        cs = Math.cos(qp);
      out[0] = radius * (2 + cs) * 0.5 * cu;
      out[1] = radius * (2 + cs) * su * 0.5;
      out[2] = radius * Math.sin(qp) * 0.5;
    };
    const P1 = [0, 0, 0],
      P2 = [0, 0, 0];
    for (let i = 0; i <= tubularSeg; i++) {
      const u = (i / tubularSeg) * p * Math.PI * 2;
      pos(u, P1);
      pos(u + 0.01, P2);
      const T = [P2[0] - P1[0], P2[1] - P1[1], P2[2] - P1[2]];
      let N = [P2[0] + P1[0], P2[1] + P1[1], P2[2] + P1[2]];
      let B = [T[1] * N[2] - T[2] * N[1], T[2] * N[0] - T[0] * N[2], T[0] * N[1] - T[1] * N[0]];
      N = [B[1] * T[2] - B[2] * T[1], B[2] * T[0] - B[0] * T[2], B[0] * T[1] - B[1] * T[0]];
      const lb = Math.hypot(B[0], B[1], B[2]),
        ln = Math.hypot(N[0], N[1], N[2]);
      B = B.map((x) => x / lb);
      N = N.map((x) => x / ln);
      for (let j = 0; j <= radialSeg; j++) {
        const v = (j / radialSeg) * Math.PI * 2;
        const cx = -tube * Math.cos(v),
          cy = tube * Math.sin(v);
        const x = P1[0] + (cx * N[0] + cy * B[0]);
        const y = P1[1] + (cx * N[1] + cy * B[1]);
        const z = P1[2] + (cx * N[2] + cy * B[2]);
        b.p.push(x, y, z);
        const nx = x - P1[0],
          ny = y - P1[1],
          nz = z - P1[2];
        const l = Math.hypot(nx, ny, nz);
        b.n.push(nx / l, ny / l, nz / l);
        b.uv.push(i / tubularSeg, j / radialSeg);
      }
    }
    for (let j = 1; j <= tubularSeg; j++)
      for (let i = 1; i <= radialSeg; i++) {
        const a = (radialSeg + 1) * (j - 1) + (i - 1);
        const bb = (radialSeg + 1) * j + (i - 1);
        const c = (radialSeg + 1) * j + i;
        const d = (radialSeg + 1) * (j - 1) + i;
        b.i.push(a, bb, d, bb, c, d);
      }
    finish(this, b, 'TorusKnotGeometry');
  }
}
