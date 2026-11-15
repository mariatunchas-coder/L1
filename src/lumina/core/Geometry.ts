import { Box3, Sphere } from '../math/Bounds';

export type TypedArray = Float32Array | Uint16Array | Uint32Array | Uint8Array | Int8Array | Int16Array;

export class BufferAttribute {
  version = 0;
  /** 'static' (STATIC_DRAW) or 'dynamic' (DYNAMIC_DRAW – frequently updated). */
  usage: 'static' | 'dynamic' = 'static';
  /** 0 = per vertex, 1 = per instance */
  divisor = 0;
  constructor(public array: TypedArray, public itemSize: number, public normalized = false) {}
  get count(): number {
    return this.array.length / this.itemSize;
  }
  set needsUpdate(v: boolean) {
    if (v) this.version++;
  }
  readonly disposeListeners = new Set<() => void>();
  /** Frees the GPU buffer backing this attribute. */
  dispose(): void {
    this.disposeListeners.forEach((l) => l());
  }
}

let _geoId = 1;

/**
 * Vertex data container. GPU buffers/VAOs are created lazily by the renderer and
 * released through `dispose()`.
 *
 * Attribute names understood by the renderer: position, normal, uv, tangent
 * (instanceMatrix / instanceColor are added by InstancedMesh).
 */
export class Geometry {
  readonly id = _geoId++;
  type = 'Geometry';
  attributes: Record<string, BufferAttribute> = {};
  index: BufferAttribute | null = null;
  boundingBox: Box3 | null = null;
  boundingSphere: Sphere | null = null;
  drawRange = { start: 0, count: Infinity };
  /** When false, dispose() only releases the VAO, not the (shared) vertex buffers. */
  ownsBuffers = true;
  readonly disposeListeners = new Set<() => void>();

  setAttribute(name: string, attr: BufferAttribute): this {
    this.attributes[name] = attr;
    return this;
  }
  setIndex(array: Uint16Array | Uint32Array | number[]): this {
    if (Array.isArray(array)) {
      let max = 0;
      for (const v of array) if (v > max) max = v;
      array = max > 65535 ? new Uint32Array(array) : new Uint16Array(array);
    }
    this.index = new BufferAttribute(array, 1);
    return this;
  }
  get vertexCount(): number {
    return this.attributes.position ? this.attributes.position.count : 0;
  }
  get triangleCount(): number {
    const n = this.index ? this.index.count : this.vertexCount;
    return Math.floor(Math.min(n, this.drawRange.count) / 3);
  }

  computeBoundingBox(): Box3 {
    this.boundingBox = new Box3().setFromArray(this.attributes.position.array, this.attributes.position.itemSize);
    return this.boundingBox;
  }
  computeBoundingSphere(): Sphere {
    const p = this.attributes.position;
    this.boundingSphere = new Sphere().setFromArray(p.array, p.itemSize);
    return this.boundingSphere;
  }

  computeVertexNormals(): this {
    const pos = this.attributes.position.array;
    const n = new Float32Array(pos.length);
    const idx = this.index ? this.index.array : null;
    const triCount = idx ? idx.length / 3 : pos.length / 9;
    for (let t = 0; t < triCount; t++) {
      const a = (idx ? idx[t * 3] : t * 3) * 3;
      const b = (idx ? idx[t * 3 + 1] : t * 3 + 1) * 3;
      const c = (idx ? idx[t * 3 + 2] : t * 3 + 2) * 3;
      const e1x = pos[b] - pos[a],
        e1y = pos[b + 1] - pos[a + 1],
        e1z = pos[b + 2] - pos[a + 2];
      const e2x = pos[c] - pos[a],
        e2y = pos[c + 1] - pos[a + 1],
        e2z = pos[c + 2] - pos[a + 2];
      // area-weighted face normal (un-normalised cross product)
      const nx = e1y * e2z - e1z * e2y,
        ny = e1z * e2x - e1x * e2z,
        nz = e1x * e2y - e1y * e2x;
      for (const v of [a, b, c]) {
        n[v] += nx;
        n[v + 1] += ny;
        n[v + 2] += nz;
      }
    }
    for (let i = 0; i < n.length; i += 3) {
      const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
      n[i] /= l;
      n[i + 1] /= l;
      n[i + 2] /= l;
    }
    this.setAttribute('normal', new BufferAttribute(n, 3));
    return this;
  }

  /** Per-vertex tangents (xyz + handedness w) from UVs – needed for normal mapping. */
  computeTangents(): this {
    const P = this.attributes.position?.array;
    const N = this.attributes.normal?.array;
    const UV = this.attributes.uv?.array;
    if (!P || !N || !UV) return this;
    const vc = P.length / 3;
    const tan1 = new Float32Array(vc * 3);
    const tan2 = new Float32Array(vc * 3);
    const idx = this.index ? this.index.array : null;
    const triCount = idx ? idx.length / 3 : vc / 3;
    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx[t * 3] : t * 3,
        i1 = idx ? idx[t * 3 + 1] : t * 3 + 1,
        i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
      const x1 = P[i1 * 3] - P[i0 * 3],
        y1 = P[i1 * 3 + 1] - P[i0 * 3 + 1],
        z1 = P[i1 * 3 + 2] - P[i0 * 3 + 2];
      const x2 = P[i2 * 3] - P[i0 * 3],
        y2 = P[i2 * 3 + 1] - P[i0 * 3 + 1],
        z2 = P[i2 * 3 + 2] - P[i0 * 3 + 2];
      const s1 = UV[i1 * 2] - UV[i0 * 2],
        t1 = UV[i1 * 2 + 1] - UV[i0 * 2 + 1];
      const s2 = UV[i2 * 2] - UV[i0 * 2],
        t2 = UV[i2 * 2 + 1] - UV[i0 * 2 + 1];
      const d = s1 * t2 - s2 * t1;
      if (Math.abs(d) < 1e-20) continue;
      const r = 1 / d;
      const sx = (t2 * x1 - t1 * x2) * r,
        sy = (t2 * y1 - t1 * y2) * r,
        sz = (t2 * z1 - t1 * z2) * r;
      const tx = (s1 * x2 - s2 * x1) * r,
        ty = (s1 * y2 - s2 * y1) * r,
        tz = (s1 * z2 - s2 * z1) * r;
      for (const i of [i0, i1, i2]) {
        tan1[i * 3] += sx;
        tan1[i * 3 + 1] += sy;
        tan1[i * 3 + 2] += sz;
        tan2[i * 3] += tx;
        tan2[i * 3 + 1] += ty;
        tan2[i * 3 + 2] += tz;
      }
    }
    const out = new Float32Array(vc * 4);
    for (let i = 0; i < vc; i++) {
      const nx = N[i * 3],
        ny = N[i * 3 + 1],
        nz = N[i * 3 + 2];
      let tx = tan1[i * 3],
        ty = tan1[i * 3 + 1],
        tz = tan1[i * 3 + 2];
      const nd = nx * tx + ny * ty + nz * tz;
      tx -= nx * nd;
      ty -= ny * nd;
      tz -= nz * nd;
      let l = Math.hypot(tx, ty, tz);
      if (l < 1e-12) {
        // degenerate – pick any perpendicular vector
        if (Math.abs(nx) < 0.9) {
          tx = 0;
          ty = nz;
          tz = -ny;
        } else {
          tx = -nz;
          ty = 0;
          tz = nx;
        }
        l = Math.hypot(tx, ty, tz) || 1;
      }
      tx /= l;
      ty /= l;
      tz /= l;
      // handedness
      const cx = ny * tz - nz * ty,
        cy = nz * tx - nx * tz,
        cz = nx * ty - ny * tx;
      const w = cx * tan2[i * 3] + cy * tan2[i * 3 + 1] + cz * tan2[i * 3 + 2] < 0 ? -1 : 1;
      out[i * 4] = tx;
      out[i * 4 + 1] = ty;
      out[i * 4 + 2] = tz;
      out[i * 4 + 3] = w;
    }
    this.setAttribute('tangent', new BufferAttribute(out, 4));
    return this;
  }

  dispose(): void {
    this.disposeListeners.forEach((l) => l());
  }
}
