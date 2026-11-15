import { Matrix4 } from './Matrix4';
import { Vector3 } from './Vector3';

export class Box3 {
  min = new Vector3(Infinity, Infinity, Infinity);
  max = new Vector3(-Infinity, -Infinity, -Infinity);

  makeEmpty(): this {
    this.min.set(Infinity, Infinity, Infinity);
    this.max.set(-Infinity, -Infinity, -Infinity);
    return this;
  }
  isEmpty(): boolean {
    return this.max.x < this.min.x || this.max.y < this.min.y || this.max.z < this.min.z;
  }
  expandByPoint(p: Vector3): this {
    this.min.min(p);
    this.max.max(p);
    return this;
  }
  setFromArray(a: ArrayLike<number>, itemSize = 3): this {
    this.makeEmpty();
    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity,
      maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;
    for (let i = 0; i < a.length; i += itemSize) {
      const x = a[i],
        y = a[i + 1],
        z = a[i + 2];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
    this.min.set(minX, minY, minZ);
    this.max.set(maxX, maxY, maxZ);
    return this;
  }
  getCenter(t = new Vector3()): Vector3 {
    return t.addVectors(this.min, this.max).multiplyScalar(0.5);
  }
  getSize(t = new Vector3()): Vector3 {
    return t.subVectors(this.max, this.min);
  }
  clone(): Box3 {
    const b = new Box3();
    b.min.copy(this.min);
    b.max.copy(this.max);
    return b;
  }
  applyMatrix4(m: Matrix4): this {
    if (this.isEmpty()) return this;
    const { min, max } = this;
    const pts = [
      new Vector3(min.x, min.y, min.z),
      new Vector3(min.x, min.y, max.z),
      new Vector3(min.x, max.y, min.z),
      new Vector3(min.x, max.y, max.z),
      new Vector3(max.x, min.y, min.z),
      new Vector3(max.x, min.y, max.z),
      new Vector3(max.x, max.y, min.z),
      new Vector3(max.x, max.y, max.z),
    ];
    this.makeEmpty();
    for (const p of pts) this.expandByPoint(p.applyMatrix4(m));
    return this;
  }
}

export class Sphere {
  center = new Vector3();
  radius = -1;
  setFromBox(box: Box3): this {
    box.getCenter(this.center);
    this.radius = box.getSize(new Vector3()).length() * 0.5;
    return this;
  }
  /** Tight-ish bounding sphere from a point array (centre = bbox centre). */
  setFromArray(a: ArrayLike<number>, itemSize = 3): this {
    const box = new Box3().setFromArray(a, itemSize);
    box.getCenter(this.center);
    let r2 = 0;
    const cx = this.center.x,
      cy = this.center.y,
      cz = this.center.z;
    for (let i = 0; i < a.length; i += itemSize) {
      const dx = a[i] - cx,
        dy = a[i + 1] - cy,
        dz = a[i + 2] - cz;
      const d = dx * dx + dy * dy + dz * dz;
      if (d > r2) r2 = d;
    }
    this.radius = Math.sqrt(r2);
    return this;
  }
}

/** View frustum – six normalised planes stored in a flat Float64Array (no per-frame allocation). */
export class Frustum {
  planes = new Float64Array(24);

  setFromProjectionMatrix(m: Matrix4): this {
    const e = m.elements;
    const p = this.planes;
    const set = (i: number, a: number, b: number, c: number, d: number) => {
      const l = Math.hypot(a, b, c);
      p[i * 4] = a / l;
      p[i * 4 + 1] = b / l;
      p[i * 4 + 2] = c / l;
      p[i * 4 + 3] = d / l;
    };
    set(0, e[3] - e[0], e[7] - e[4], e[11] - e[8], e[15] - e[12]);
    set(1, e[3] + e[0], e[7] + e[4], e[11] + e[8], e[15] + e[12]);
    set(2, e[3] + e[1], e[7] + e[5], e[11] + e[9], e[15] + e[13]);
    set(3, e[3] - e[1], e[7] - e[5], e[11] - e[9], e[15] - e[13]);
    set(4, e[3] - e[2], e[7] - e[6], e[11] - e[10], e[15] - e[14]);
    set(5, e[3] + e[2], e[7] + e[6], e[11] + e[10], e[15] + e[14]);
    return this;
  }
  intersectsSphere(cx: number, cy: number, cz: number, radius: number): boolean {
    const p = this.planes;
    for (let i = 0; i < 24; i += 4) {
      if (p[i] * cx + p[i + 1] * cy + p[i + 2] * cz + p[i + 3] < -radius) return false;
    }
    return true;
  }
}

export class Ray {
  origin = new Vector3();
  direction = new Vector3(0, 0, -1);

  at(t: number, target = new Vector3()): Vector3 {
    return target.copy(this.direction).multiplyScalar(t).add(this.origin);
  }
  /** Returns distance to the nearest hit or -1. */
  intersectSphere(center: Vector3, radius: number): number {
    const ox = center.x - this.origin.x,
      oy = center.y - this.origin.y,
      oz = center.z - this.origin.z;
    const tca = ox * this.direction.x + oy * this.direction.y + oz * this.direction.z;
    const d2 = ox * ox + oy * oy + oz * oz - tca * tca;
    const r2 = radius * radius;
    if (d2 > r2) return -1;
    const thc = Math.sqrt(r2 - d2);
    const t0 = tca - thc,
      t1 = tca + thc;
    if (t1 < 0) return -1;
    return t0 >= 0 ? t0 : t1;
  }
  /** Möller–Trumbore. Returns distance or -1. */
  intersectTriangle(a: Vector3, b: Vector3, c: Vector3, cullBack: boolean): number {
    const e1x = b.x - a.x,
      e1y = b.y - a.y,
      e1z = b.z - a.z;
    const e2x = c.x - a.x,
      e2y = c.y - a.y,
      e2z = c.z - a.z;
    const d = this.direction;
    const px = d.y * e2z - d.z * e2y,
      py = d.z * e2x - d.x * e2z,
      pz = d.x * e2y - d.y * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (cullBack ? det < 1e-12 : Math.abs(det) < 1e-12) return -1;
    const inv = 1 / det;
    const tx = this.origin.x - a.x,
      ty = this.origin.y - a.y,
      tz = this.origin.z - a.z;
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) return -1;
    const qx = ty * e1z - tz * e1y,
      qy = tz * e1x - tx * e1z,
      qz = tx * e1y - ty * e1x;
    const v = (d.x * qx + d.y * qy + d.z * qz) * inv;
    if (v < 0 || u + v > 1) return -1;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    return t > 0 ? t : -1;
  }
}
