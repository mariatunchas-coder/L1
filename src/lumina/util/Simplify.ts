import { BufferAttribute, Geometry } from '../core/Geometry';
import { LOD } from '../core/LOD';
import { Mesh } from '../core/Mesh';

export interface SimplifyOptions {
  /** Fraction of triangles to keep (0 < ratio ≤ 1). Ignored when `targetTriangles` is set. */
  ratio?: number;
  /** Desired triangle count (the result is as close as the clustering grid allows, never below ~half of it). */
  targetTriangles?: number;
  /** UV cells per unit used to keep texture seams apart (default 6). */
  uvCells?: number;
  /** Normals deviating more than this cosine from the cluster mean are kept as hard edges (default 0.8 ≈ 37°). */
  hardEdgeCos?: number;
}

export interface SimplifyResult {
  geometry: Geometry;
  inputTriangles: number;
  outputTriangles: number;
  /** Edge length of the clustering grid cell that was chosen (object space). */
  cellSize: number;
}

/**
 * Mesh simplification for automatic LODs: **quadric-error vertex clustering** (Lindstrom / Garland–Heckbert).
 *
 *  1. Vertices are welded by position and assigned to the cells of a uniform grid; the cell size is searched so
 *     that the resulting triangle count hits the target.
 *  2. Every cluster collapses to the point that minimises the sum of squared distances to the planes of its
 *     triangles (area-weighted quadric, regularised toward the centroid, clamped to the cell) – flat regions stay
 *     flat, silhouettes and creases keep their shape far better than centroid clustering.
 *  3. Output vertices are split by texture-seam (uv cell) and hard edge (normal class), so UVs and shading survive.
 *     All float attributes (normal, uv, tangent, colour …) are averaged per output vertex.
 *
 * It is deterministic, O(n log n), allocation-light and works on indexed or non-indexed triangle geometry.
 * Not a topology-preserving edge-collapse: use it for distance LODs, not for the closest level.
 */
export function simplifyGeometryEx(src: Geometry, opts: SimplifyOptions = {}): SimplifyResult {
  const posAttr = src.attributes.position;
  if (!posAttr || posAttr.itemSize !== 3) throw new Error('simplifyGeometry: geometry needs a 3-component position attribute');
  const pos = posAttr.array as ArrayLike<number>;
  const vCount = posAttr.count;
  const idx: ArrayLike<number> = src.index ? (src.index.array as ArrayLike<number>) : (null as unknown as ArrayLike<number>);
  const available = idx ? idx.length : vCount;
  const start = Math.min(available - (available % 3), Math.max(0, Math.floor(src.drawRange.start / 3) * 3));
  const drawCount = Number.isFinite(src.drawRange.count) ? src.drawRange.count : available;
  const end = Math.min(available - (available % 3), start + Math.max(0, drawCount - (drawCount % 3)));
  const triCount = Math.max(0, (end - start) / 3);
  const tris = new Uint32Array(triCount * 3);
  for (let i = 0; i < tris.length; i++) {
    const v = idx ? idx[start + i] : start + i;
    tris[i] = v < vCount ? v : 0;
  }
  const target = Math.max(1, Math.round(opts.targetTriangles ?? triCount * Math.min(1, Math.max(0.001, opts.ratio ?? 0.5))));
  if (triCount === 0 || target >= triCount) return { geometry: cloneGeometry(src, tris), inputTriangles: triCount, outputTriangles: triCount, cellSize: 0 };

  // ── bounds ──
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < vCount; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-9);

  // ── weld by position (seams share a spatial cluster) ──
  const weldQ = extent * 1e-6;
  const weldMap = new Map<string, number>();
  const weld = new Int32Array(vCount);
  const wx: number[] = [], wy: number[] = [], wz: number[] = [];
  for (let i = 0; i < vCount; i++) {
    const key = Math.round((pos[i * 3] - minX) / weldQ) + '_' + Math.round((pos[i * 3 + 1] - minY) / weldQ) + '_' + Math.round((pos[i * 3 + 2] - minZ) / weldQ);
    let w = weldMap.get(key);
    if (w === undefined) {
      w = wx.length;
      weldMap.set(key, w);
      wx.push(pos[i * 3]);
      wy.push(pos[i * 3 + 1]);
      wz.push(pos[i * 3 + 2]);
    }
    weld[i] = w;
  }
  const wn = wx.length;

  // ── grid clustering ──
  const cellOf = new Float64Array(wn);
  const assign = (cell: number): number => {
    const dim = Math.max(1, Math.ceil(extent / cell) + 1);
    for (let i = 0; i < wn; i++) {
      const ix = Math.floor((wx[i] - minX) / cell);
      const iy = Math.floor((wy[i] - minY) / cell);
      const iz = Math.floor((wz[i] - minZ) / cell);
      cellOf[i] = ix + dim * (iy + dim * iz);
    }
    return dim;
  };
  const countTris = (cell: number): number => {
    assign(cell);
    let n = 0;
    for (let t = 0; t < triCount; t++) {
      const a = cellOf[weld[tris[t * 3]]], b = cellOf[weld[tris[t * 3 + 1]]], c = cellOf[weld[tris[t * 3 + 2]]];
      if (a !== b && b !== c && a !== c) n++;
    }
    return n;
  };
  // the largest cell that still yields ≥ target triangles (count is monotonic enough for a bisection)
  let lo = extent / 4096, hi = extent;
  if (countTris(lo) < target) hi = lo;
  else {
    for (let it = 0; it < 18; it++) {
      const mid = Math.sqrt(lo * hi);
      if (countTris(mid) >= target) lo = mid;
      else hi = mid;
    }
  }
  const cell = lo;
  const dim = assign(cell);
  void dim;

  // compact cluster ids
  const clusterMap = new Map<number, number>();
  const wCluster = new Int32Array(wn);
  for (let i = 0; i < wn; i++) {
    let c = clusterMap.get(cellOf[i]);
    if (c === undefined) {
      c = clusterMap.size;
      clusterMap.set(cellOf[i], c);
    }
    wCluster[i] = c;
  }
  const cn = clusterMap.size;

  // ── quadrics: Σ w·(n nᵀ), Σ w·n·d … solved per cluster ──
  const A = new Float64Array(cn * 6); // xx xy xz yy yz zz
  const B = new Float64Array(cn * 3); // Σ w n d
  const sumW = new Float64Array(cn);
  const cen = new Float64Array(cn * 3);
  const cenW = new Float64Array(cn);
  for (let t = 0; t < triCount; t++) {
    const i0 = tris[t * 3], i1 = tris[t * 3 + 1], i2 = tris[t * 3 + 2];
    const ax = pos[i0 * 3], ay = pos[i0 * 3 + 1], az = pos[i0 * 3 + 2];
    const e1x = pos[i1 * 3] - ax, e1y = pos[i1 * 3 + 1] - ay, e1z = pos[i1 * 3 + 2] - az;
    const e2x = pos[i2 * 3] - ax, e2y = pos[i2 * 3 + 1] - ay, e2z = pos[i2 * 3 + 2] - az;
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz);
    if (!(len > 1e-20)) continue;
    const area = len * 0.5;
    nx /= len;
    ny /= len;
    nz /= len;
    const d = -(nx * ax + ny * ay + nz * az);
    for (let k = 0; k < 3; k++) {
      const vi = tris[t * 3 + k];
      const c = wCluster[weld[vi]];
      A[c * 6] += area * nx * nx;
      A[c * 6 + 1] += area * nx * ny;
      A[c * 6 + 2] += area * nx * nz;
      A[c * 6 + 3] += area * ny * ny;
      A[c * 6 + 4] += area * ny * nz;
      A[c * 6 + 5] += area * nz * nz;
      B[c * 3] += area * nx * d;
      B[c * 3 + 1] += area * ny * d;
      B[c * 3 + 2] += area * nz * d;
      sumW[c] += area;
      cen[c * 3] += area * pos[vi * 3];
      cen[c * 3 + 1] += area * pos[vi * 3 + 1];
      cen[c * 3 + 2] += area * pos[vi * 3 + 2];
      cenW[c] += area;
    }
  }
  const cx = new Float32Array(cn), cy = new Float32Array(cn), cz = new Float32Array(cn);
  const plain = new Float64Array(cn * 4);
  for (let i = 0; i < wn; i++) {
    const c = wCluster[i];
    plain[c * 4] += wx[i];
    plain[c * 4 + 1] += wy[i];
    plain[c * 4 + 2] += wz[i];
    plain[c * 4 + 3] += 1;
  }
  const cminX = new Float64Array(cn), cminY = new Float64Array(cn), cminZ = new Float64Array(cn);
  for (let i = 0; i < wn; i++) {
    const c = wCluster[i];
    cminX[c] = Math.floor((wx[i] - minX) / cell) * cell + minX;
    cminY[c] = Math.floor((wy[i] - minY) / cell) * cell + minY;
    cminZ[c] = Math.floor((wz[i] - minZ) / cell) * cell + minZ;
  }
  for (let c = 0; c < cn; c++) {
    const mx = cenW[c] > 0 ? cen[c * 3] / cenW[c] : plain[c * 4] / Math.max(1, plain[c * 4 + 3]);
    const my = cenW[c] > 0 ? cen[c * 3 + 1] / cenW[c] : plain[c * 4 + 1] / Math.max(1, plain[c * 4 + 3]);
    const mz = cenW[c] > 0 ? cen[c * 3 + 2] / cenW[c] : plain[c * 4 + 2] / Math.max(1, plain[c * 4 + 3]);
    let px = mx, py = my, pz = mz;
    if (sumW[c] > 0) {
      // (A + εI) x = −b + ε·mean  — regularised toward the centroid so near-planar clusters don't blow up
      const tr = (A[c * 6] + A[c * 6 + 3] + A[c * 6 + 5]) / 3;
      const eps = tr * 0.02 + 1e-12;
      const a00 = A[c * 6] + eps, a01 = A[c * 6 + 1], a02 = A[c * 6 + 2];
      const a11 = A[c * 6 + 3] + eps, a12 = A[c * 6 + 4], a22 = A[c * 6 + 5] + eps;
      const r0 = -B[c * 3] + eps * mx, r1 = -B[c * 3 + 1] + eps * my, r2 = -B[c * 3 + 2] + eps * mz;
      const det = a00 * (a11 * a22 - a12 * a12) - a01 * (a01 * a22 - a12 * a02) + a02 * (a01 * a12 - a11 * a02);
      if (Math.abs(det) > 1e-30) {
        const i00 = a11 * a22 - a12 * a12, i01 = a02 * a12 - a01 * a22, i02 = a01 * a12 - a02 * a11;
        const i11 = a00 * a22 - a02 * a02, i12 = a01 * a02 - a00 * a12, i22 = a00 * a11 - a01 * a01;
        const sx = (i00 * r0 + i01 * r1 + i02 * r2) / det;
        const sy = (i01 * r0 + i11 * r1 + i12 * r2) / det;
        const sz = (i02 * r0 + i12 * r1 + i22 * r2) / det;
        // keep the solution inside the (slightly grown) cell
        const m = cell * 0.25;
        if (
          sx >= cminX[c] - m && sx <= cminX[c] + cell + m &&
          sy >= cminY[c] - m && sy <= cminY[c] + cell + m &&
          sz >= cminZ[c] - m && sz <= cminZ[c] + cell + m
        ) {
          px = sx;
          py = sy;
          pz = sz;
        }
      }
    }
    cx[c] = px;
    cy[c] = py;
    cz[c] = pz;
  }

  // ── output vertices: split by texture seam + hard edge, average every float attribute ──
  const normalAttr = src.attributes.normal && src.attributes.normal.itemSize === 3 ? src.attributes.normal : null;
  const uvAttr = src.attributes.uv && src.attributes.uv.itemSize === 2 ? src.attributes.uv : null;
  const uvCells = opts.uvCells ?? 6;
  const hardCos = opts.hardEdgeCos ?? 0.8;
  const cMeanN = new Float64Array(cn * 3);
  if (normalAttr) {
    const na = normalAttr.array as ArrayLike<number>;
    for (let v = 0; v < vCount; v++) {
      const c = wCluster[weld[v]];
      cMeanN[c * 3] += na[v * 3];
      cMeanN[c * 3 + 1] += na[v * 3 + 1];
      cMeanN[c * 3 + 2] += na[v * 3 + 2];
    }
    for (let c = 0; c < cn; c++) {
      const l = Math.hypot(cMeanN[c * 3], cMeanN[c * 3 + 1], cMeanN[c * 3 + 2]) || 1;
      cMeanN[c * 3] /= l;
      cMeanN[c * 3 + 1] /= l;
      cMeanN[c * 3 + 2] /= l;
    }
  }
  const outOf = new Int32Array(vCount).fill(-1);
  const outKey = new Map<string, number>();
  const outCluster: number[] = [];
  const outSrc: number[][] = [];
  const used = new Uint8Array(vCount);
  for (let i = 0; i < tris.length; i++) used[tris[i]] = 1;
  for (let v = 0; v < vCount; v++) {
    if (!used[v]) continue;
    const c = wCluster[weld[v]];
    let key = String(c);
    if (uvAttr) {
      const ua = uvAttr.array as ArrayLike<number>;
      key += '|' + Math.floor(ua[v * 2] * uvCells) + '_' + Math.floor(ua[v * 2 + 1] * uvCells);
    }
    if (normalAttr) {
      const na = normalAttr.array as ArrayLike<number>;
      const nx = na[v * 3], ny = na[v * 3 + 1], nz = na[v * 3 + 2];
      const dotM = nx * cMeanN[c * 3] + ny * cMeanN[c * 3 + 1] + nz * cMeanN[c * 3 + 2];
      let cls = 0;
      if (dotM < hardCos) {
        const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
        cls = ax >= ay && ax >= az ? (nx > 0 ? 1 : 2) : ay >= az ? (ny > 0 ? 3 : 4) : nz > 0 ? 5 : 6;
      }
      key += '|' + cls;
    }
    let o = outKey.get(key);
    if (o === undefined) {
      o = outCluster.length;
      outKey.set(key, o);
      outCluster.push(c);
      outSrc.push([]);
    }
    outSrc[o].push(v);
    outOf[v] = o;
  }

  // triangles (drop collapsed + duplicate ones)
  const outIdx: number[] = [];
  const seen = new Set<string>();
  for (let t = 0; t < triCount; t++) {
    const a = outOf[tris[t * 3]], b = outOf[tris[t * 3 + 1]], c = outOf[tris[t * 3 + 2]];
    const ca = outCluster[a], cb = outCluster[b], cc = outCluster[c];
    if (ca === cb || cb === cc || ca === cc) continue;
    // identical vertex-cluster triples (opposite sides of a thin shell keep their own key through the winding)
    const sorted = [ca, cb, cc].sort((p, q) => p - q);
    const rot = ca === sorted[0] ? 0 : cb === sorted[0] ? 1 : 2;
    const winding = (rot === 0 ? [ca, cb, cc] : rot === 1 ? [cb, cc, ca] : [cc, ca, cb]).join(',');
    if (seen.has(winding)) continue;
    seen.add(winding);
    outIdx.push(a, b, c);
  }

  // build attributes
  const g = new Geometry();
  g.type = src.type;
  const on = outCluster.length;
  const used2 = new Uint8Array(on);
  for (const i of outIdx) used2[i] = 1;
  const remap = new Int32Array(on).fill(-1);
  let nv = 0;
  for (let i = 0; i < on; i++) if (used2[i]) remap[i] = nv++;
  for (const [name, attr] of Object.entries(src.attributes)) {
    if (attr.divisor !== 0) continue;
    const is = attr.itemSize;
    if (name === 'position') {
      const arr = new Float32Array(nv * 3);
      for (let i = 0; i < on; i++) {
        const r = remap[i];
        if (r < 0) continue;
        arr[r * 3] = cx[outCluster[i]];
        arr[r * 3 + 1] = cy[outCluster[i]];
        arr[r * 3 + 2] = cz[outCluster[i]];
      }
      g.setAttribute('position', new BufferAttribute(arr, 3));
      continue;
    }
    const sa = attr.array as ArrayLike<number>;
    const arr = new Float32Array(nv * is);
    for (let i = 0; i < on; i++) {
      const r = remap[i];
      if (r < 0) continue;
      const list = outSrc[i];
      for (let k = 0; k < is; k++) {
        let s = 0;
        for (const v of list) s += sa[v * is + k];
        arr[r * is + k] = s / list.length;
      }
      if (name === 'normal' || (name === 'tangent' && is === 4)) {
        const o = r * is;
        const l = Math.hypot(arr[o], arr[o + 1], arr[o + 2]);
        if (l > 1e-8) {
          arr[o] /= l;
          arr[o + 1] /= l;
          arr[o + 2] /= l;
        } else {
          arr[o] = 0;
          arr[o + 1] = 1;
          arr[o + 2] = 0;
        }
        if (name === 'tangent') arr[o + 3] = sa[list[0] * is + 3] < 0 ? -1 : 1;
      }
    }
    g.setAttribute(name, new BufferAttribute(arr, is, attr.normalized));
  }
  const finalIdx = outIdx.map((i) => remap[i]);
  g.setIndex(finalIdx);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return { geometry: g, inputTriangles: triCount, outputTriangles: finalIdx.length / 3, cellSize: cell };
}

function cloneGeometry(src: Geometry, tris: Uint32Array): Geometry {
  const g = new Geometry();
  g.type = src.type;
  for (const [name, attr] of Object.entries(src.attributes)) {
    if (attr.divisor !== 0) continue;
    g.setAttribute(name, new BufferAttribute(attr.array.slice() as typeof attr.array, attr.itemSize, attr.normalized));
  }
  g.setIndex(Array.from(tris));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Convenience wrapper around `simplifyGeometryEx` that returns only the geometry. */
export function simplifyGeometry(src: Geometry, ratioOrOptions: number | SimplifyOptions = 0.5): Geometry {
  return simplifyGeometryEx(src, typeof ratioOrOptions === 'number' ? { ratio: ratioOrOptions } : ratioOrOptions).geometry;
}

export interface LODChainLevel {
  /** Fraction of the triangles kept at this level. */
  ratio: number;
  /** Distance, in multiples of the object's bounding-sphere radius, at which the level becomes active. */
  distance: number;
}

export const DEFAULT_LOD_CHAIN: LODChainLevel[] = [
  { ratio: 0.35, distance: 10 },
  { ratio: 0.12, distance: 24 },
  { ratio: 0.04, distance: 55 },
];

/**
 * Builds a ready-to-use `LOD` from a detailed mesh: level 0 is the mesh itself, the following levels are
 * automatically simplified copies that share the material. Distances scale with the object's size.
 */
export function createLODFromMesh(mesh: Mesh, levels: LODChainLevel[] = DEFAULT_LOD_CHAIN): LOD {
  const lod = new LOD();
  lod.name = mesh.name;
  lod.position.copy(mesh.position);
  lod.quaternion.copy(mesh.quaternion);
  lod.scale.copy(mesh.scale);
  lod.castShadow = mesh.castShadow;
  lod.receiveShadow = mesh.receiveShadow;
  mesh.position.set(0, 0, 0);
  mesh.quaternion.set(0, 0, 0, 1);
  mesh.scale.set(1, 1, 1);
  const radius = Math.max(1e-3, mesh.geometry.boundingSphere?.radius ?? mesh.geometry.computeBoundingSphere().radius);
  lod.addLevel(mesh, 0);
  let prev = mesh.geometry.triangleCount;
  for (const lv of levels) {
    const g = simplifyGeometry(mesh.geometry, { ratio: lv.ratio });
    if (g.triangleCount >= prev || g.triangleCount < 1) continue; // nothing gained
    prev = g.triangleCount;
    const m = new Mesh(g, mesh.material);
    m.name = mesh.name + ' (LOD)';
    m.castShadow = mesh.castShadow;
    m.receiveShadow = mesh.receiveShadow;
    lod.addLevel(m, lv.distance * radius);
  }
  return lod;
}
