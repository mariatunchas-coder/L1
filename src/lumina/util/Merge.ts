import { BufferAttribute, Geometry } from '../core/Geometry';
import { Matrix3, Matrix4 } from '../math/Matrix4';

export interface MergeItem {
  geometry: Geometry;
  /** Transform baked into the merged vertices (default identity). */
  matrix?: Matrix4;
}

/**
 * Static batching: bakes many (geometry, transform) pairs into ONE geometry → one draw call.
 * Positions, normals and tangents are transformed; uv / tangent are optional but must be present on
 * either every item or none (otherwise the attribute is dropped). Indices are rebased and promoted to
 * Uint32 automatically when the merged mesh exceeds 65 535 vertices.
 */
export function mergeGeometries(items: MergeItem[]): Geometry {
  if (!items.length) throw new Error('mergeGeometries: nothing to merge');
  const has = (n: string) => items.every((it) => !!it.geometry.attributes[n]);
  const useNormal = has('normal');
  const useUv = has('uv');
  const useTan = has('tangent');
  let vCount = 0;
  let iCount = 0;
  for (const { geometry: g } of items) {
    if (!g.attributes.position) throw new Error('mergeGeometries: geometry without positions');
    vCount += g.attributes.position.count;
    iCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = useNormal ? new Float32Array(vCount * 3) : null;
  const uv = useUv ? new Float32Array(vCount * 2) : null;
  const tan = useTan ? new Float32Array(vCount * 4) : null;
  const idx = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
  const nm = new Matrix3();
  let vo = 0;
  let io = 0;
  for (const it of items) {
    const g = it.geometry;
    const m = it.matrix ?? new Matrix4();
    const e = m.elements;
    const P = g.attributes.position;
    const n = P.count;
    // a mirroring transform flips the winding order – compensate so faces stay front-facing
    const det = e[0] * (e[5] * e[10] - e[6] * e[9]) - e[4] * (e[1] * e[10] - e[2] * e[9]) + e[8] * (e[1] * e[6] - e[2] * e[5]);
    const flip = det < 0;
    nm.setNormalMatrix(m);
    const ne = nm.elements;
    for (let i = 0; i < n; i++) {
      const x = P.array[i * P.itemSize],
        y = P.array[i * P.itemSize + 1],
        z = P.array[i * P.itemSize + 2];
      const o = (vo + i) * 3;
      pos[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
      pos[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      pos[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      if (nor) {
        const N = g.attributes.normal;
        const a = N.array[i * 3],
          b = N.array[i * 3 + 1],
          c = N.array[i * 3 + 2];
        let nx = ne[0] * a + ne[3] * b + ne[6] * c,
          ny = ne[1] * a + ne[4] * b + ne[7] * c,
          nz = ne[2] * a + ne[5] * b + ne[8] * c;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l;
        ny /= l;
        nz /= l;
        nor[o] = nx;
        nor[o + 1] = ny;
        nor[o + 2] = nz;
      }
      if (uv) {
        const U = g.attributes.uv;
        uv[(vo + i) * 2] = U.array[i * 2];
        uv[(vo + i) * 2 + 1] = U.array[i * 2 + 1];
      }
      if (tan) {
        const T = g.attributes.tangent;
        const a = T.array[i * 4],
          b = T.array[i * 4 + 1],
          c = T.array[i * 4 + 2];
        let tx = e[0] * a + e[4] * b + e[8] * c,
          ty = e[1] * a + e[5] * b + e[9] * c,
          tz = e[2] * a + e[6] * b + e[10] * c;
        const l = Math.hypot(tx, ty, tz) || 1;
        tx /= l;
        ty /= l;
        tz /= l;
        tan[(vo + i) * 4] = tx;
        tan[(vo + i) * 4 + 1] = ty;
        tan[(vo + i) * 4 + 2] = tz;
        tan[(vo + i) * 4 + 3] = T.array[i * 4 + 3] * (flip ? -1 : 1);
      }
    }
    const count = g.index ? g.index.count : n;
    for (let k = 0; k < count; k += 3) {
      const a = g.index ? g.index.array[k] : k;
      const b = g.index ? g.index.array[k + 1] : k + 1;
      const c = g.index ? g.index.array[k + 2] : k + 2;
      idx[io++] = vo + a;
      idx[io++] = vo + (flip ? c : b);
      idx[io++] = vo + (flip ? b : c);
    }
    vo += n;
  }
  const out = new Geometry();
  out.type = 'MergedGeometry';
  out.setAttribute('position', new BufferAttribute(pos, 3));
  if (nor) out.setAttribute('normal', new BufferAttribute(nor, 3));
  if (uv) out.setAttribute('uv', new BufferAttribute(uv, 2));
  if (tan) out.setAttribute('tangent', new BufferAttribute(tan, 4));
  out.index = new BufferAttribute(idx, 1);
  out.computeBoundingSphere();
  return out;
}
