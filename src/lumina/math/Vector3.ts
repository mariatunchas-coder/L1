import type { Matrix4 } from './Matrix4';
import type { Quaternion } from './Quaternion';

export class Vector2 {
  constructor(public x = 0, public y = 0) {}
  set(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }
  copy(v: Vector2): this {
    this.x = v.x;
    this.y = v.y;
    return this;
  }
  clone(): Vector2 {
    return new Vector2(this.x, this.y);
  }
  sub(v: Vector2): this {
    this.x -= v.x;
    this.y -= v.y;
    return this;
  }
  length(): number {
    return Math.hypot(this.x, this.y);
  }
}

export class Vector3 {
  constructor(public x = 0, public y = 0, public z = 0) {}

  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
  setScalar(s: number): this {
    this.x = this.y = this.z = s;
    return this;
  }
  copy(v: Vector3): this {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }
  clone(): Vector3 {
    return new Vector3(this.x, this.y, this.z);
  }
  equals(v: Vector3): boolean {
    return this.x === v.x && this.y === v.y && this.z === v.z;
  }
  add(v: Vector3): this {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }
  addScaled(v: Vector3, s: number): this {
    this.x += v.x * s;
    this.y += v.y * s;
    this.z += v.z * s;
    return this;
  }
  addVectors(a: Vector3, b: Vector3): this {
    this.x = a.x + b.x;
    this.y = a.y + b.y;
    this.z = a.z + b.z;
    return this;
  }
  sub(v: Vector3): this {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }
  subVectors(a: Vector3, b: Vector3): this {
    this.x = a.x - b.x;
    this.y = a.y - b.y;
    this.z = a.z - b.z;
    return this;
  }
  multiply(v: Vector3): this {
    this.x *= v.x;
    this.y *= v.y;
    this.z *= v.z;
    return this;
  }
  multiplyScalar(s: number): this {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }
  negate(): this {
    this.x = -this.x;
    this.y = -this.y;
    this.z = -this.z;
    return this;
  }
  dot(v: Vector3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }
  cross(v: Vector3): this {
    return this.crossVectors(this, v);
  }
  crossVectors(a: Vector3, b: Vector3): this {
    const ax = a.x,
      ay = a.y,
      az = a.z;
    const bx = b.x,
      by = b.y,
      bz = b.z;
    this.x = ay * bz - az * by;
    this.y = az * bx - ax * bz;
    this.z = ax * by - ay * bx;
    return this;
  }
  lengthSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }
  length(): number {
    return Math.sqrt(this.lengthSq());
  }
  distanceTo(v: Vector3): number {
    return Math.sqrt(this.distanceToSquared(v));
  }
  distanceToSquared(v: Vector3): number {
    const dx = this.x - v.x,
      dy = this.y - v.y,
      dz = this.z - v.z;
    return dx * dx + dy * dy + dz * dz;
  }
  normalize(): this {
    const l = this.length();
    return l > 0 ? this.multiplyScalar(1 / l) : this;
  }
  setLength(l: number): this {
    return this.normalize().multiplyScalar(l);
  }
  lerp(v: Vector3, t: number): this {
    this.x += (v.x - this.x) * t;
    this.y += (v.y - this.y) * t;
    this.z += (v.z - this.z) * t;
    return this;
  }
  min(v: Vector3): this {
    this.x = Math.min(this.x, v.x);
    this.y = Math.min(this.y, v.y);
    this.z = Math.min(this.z, v.z);
    return this;
  }
  max(v: Vector3): this {
    this.x = Math.max(this.x, v.x);
    this.y = Math.max(this.y, v.y);
    this.z = Math.max(this.z, v.z);
    return this;
  }
  applyMatrix4(m: Matrix4): this {
    const e = m.elements;
    const x = this.x,
      y = this.y,
      z = this.z;
    const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
    this.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
    this.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
    this.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
    return this;
  }
  transformDirection(m: Matrix4): this {
    const e = m.elements;
    const x = this.x,
      y = this.y,
      z = this.z;
    this.x = e[0] * x + e[4] * y + e[8] * z;
    this.y = e[1] * x + e[5] * y + e[9] * z;
    this.z = e[2] * x + e[6] * y + e[10] * z;
    return this.normalize();
  }
  applyQuaternion(q: Quaternion): this {
    const x = this.x,
      y = this.y,
      z = this.z;
    const qx = q.x,
      qy = q.y,
      qz = q.z,
      qw = q.w;
    const tx = 2 * (qy * z - qz * y);
    const ty = 2 * (qz * x - qx * z);
    const tz = 2 * (qx * y - qy * x);
    this.x = x + qw * tx + qy * tz - qz * ty;
    this.y = y + qw * ty + qz * tx - qx * tz;
    this.z = z + qw * tz + qx * ty - qy * tx;
    return this;
  }
  setFromMatrixPosition(m: Matrix4): this {
    const e = m.elements;
    this.x = e[12];
    this.y = e[13];
    this.z = e[14];
    return this;
  }
  setFromMatrixColumn(m: Matrix4, i: number): this {
    const e = m.elements;
    this.x = e[i * 4];
    this.y = e[i * 4 + 1];
    this.z = e[i * 4 + 2];
    return this;
  }
  setFromSpherical(radius: number, phi: number, theta: number): this {
    const s = Math.sin(phi) * radius;
    this.x = s * Math.sin(theta);
    this.y = Math.cos(phi) * radius;
    this.z = s * Math.cos(theta);
    return this;
  }
  fromArray(a: ArrayLike<number>, o = 0): this {
    this.x = a[o];
    this.y = a[o + 1];
    this.z = a[o + 2];
    return this;
  }
  toArray(a: number[] | Float32Array = [], o = 0): number[] | Float32Array {
    a[o] = this.x;
    a[o + 1] = this.y;
    a[o + 2] = this.z;
    return a;
  }
}
