import { clamp } from './MathUtils';
import type { Matrix4 } from './Matrix4';
import type { Vector3 } from './Vector3';

/** Euler angles (XYZ order). Kept in sync with a Quaternion through callbacks. */
export class Euler {
  _x: number;
  _y: number;
  _z: number;
  _onChange: () => void = () => {};

  constructor(x = 0, y = 0, z = 0) {
    this._x = x;
    this._y = y;
    this._z = z;
  }
  get x() {
    return this._x;
  }
  set x(v: number) {
    this._x = v;
    this._onChange();
  }
  get y() {
    return this._y;
  }
  set y(v: number) {
    this._y = v;
    this._onChange();
  }
  get z() {
    return this._z;
  }
  set z(v: number) {
    this._z = v;
    this._onChange();
  }
  set(x: number, y: number, z: number): this {
    this._x = x;
    this._y = y;
    this._z = z;
    this._onChange();
    return this;
  }
  copy(e: Euler): this {
    return this.set(e._x, e._y, e._z);
  }
  setFromQuaternion(q: Quaternion, update = true): this {
    const x = q._x,
      y = q._y,
      z = q._z,
      w = q._w;
    // rotation matrix elements
    const m11 = 1 - 2 * (y * y + z * z);
    const m12 = 2 * (x * y - z * w);
    const m13 = 2 * (x * z + y * w);
    const m23 = 2 * (y * z - x * w);
    const m33 = 1 - 2 * (x * x + y * y);
    const m22 = 1 - 2 * (x * x + z * z);
    const m32 = 2 * (y * z + x * w);
    this._y = Math.asin(clamp(m13, -1, 1));
    if (Math.abs(m13) < 0.9999999) {
      this._x = Math.atan2(-m23, m33);
      this._z = Math.atan2(-m12, m11);
    } else {
      this._x = Math.atan2(m32, m22);
      this._z = 0;
    }
    if (update) this._onChange();
    return this;
  }
}

export class Quaternion {
  _x: number;
  _y: number;
  _z: number;
  _w: number;
  _onChange: () => void = () => {};

  constructor(x = 0, y = 0, z = 0, w = 1) {
    this._x = x;
    this._y = y;
    this._z = z;
    this._w = w;
  }
  get x() {
    return this._x;
  }
  set x(v: number) {
    this._x = v;
    this._onChange();
  }
  get y() {
    return this._y;
  }
  set y(v: number) {
    this._y = v;
    this._onChange();
  }
  get z() {
    return this._z;
  }
  set z(v: number) {
    this._z = v;
    this._onChange();
  }
  get w() {
    return this._w;
  }
  set w(v: number) {
    this._w = v;
    this._onChange();
  }
  set(x: number, y: number, z: number, w: number): this {
    this._x = x;
    this._y = y;
    this._z = z;
    this._w = w;
    this._onChange();
    return this;
  }
  clone(): Quaternion {
    return new Quaternion(this._x, this._y, this._z, this._w);
  }
  copy(q: Quaternion): this {
    return this.set(q._x, q._y, q._z, q._w);
  }
  identity(): this {
    return this.set(0, 0, 0, 1);
  }
  setFromEuler(e: Euler, update = true): this {
    const c1 = Math.cos(e._x / 2),
      c2 = Math.cos(e._y / 2),
      c3 = Math.cos(e._z / 2);
    const s1 = Math.sin(e._x / 2),
      s2 = Math.sin(e._y / 2),
      s3 = Math.sin(e._z / 2);
    this._x = s1 * c2 * c3 + c1 * s2 * s3;
    this._y = c1 * s2 * c3 - s1 * c2 * s3;
    this._z = c1 * c2 * s3 + s1 * s2 * c3;
    this._w = c1 * c2 * c3 - s1 * s2 * s3;
    if (update) this._onChange();
    return this;
  }
  setFromAxisAngle(axis: Vector3, angle: number): this {
    const h = angle / 2,
      s = Math.sin(h);
    return this.set(axis.x * s, axis.y * s, axis.z * s, Math.cos(h));
  }
  setFromRotationMatrix(m: Matrix4): this {
    const te = m.elements;
    const m11 = te[0],
      m12 = te[4],
      m13 = te[8];
    const m21 = te[1],
      m22 = te[5],
      m23 = te[9];
    const m31 = te[2],
      m32 = te[6],
      m33 = te[10];
    const tr = m11 + m22 + m33;
    if (tr > 0) {
      const s = 0.5 / Math.sqrt(tr + 1);
      this._w = 0.25 / s;
      this._x = (m32 - m23) * s;
      this._y = (m13 - m31) * s;
      this._z = (m21 - m12) * s;
    } else if (m11 > m22 && m11 > m33) {
      const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
      this._w = (m32 - m23) / s;
      this._x = 0.25 * s;
      this._y = (m12 + m21) / s;
      this._z = (m13 + m31) / s;
    } else if (m22 > m33) {
      const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
      this._w = (m13 - m31) / s;
      this._x = (m12 + m21) / s;
      this._y = 0.25 * s;
      this._z = (m23 + m32) / s;
    } else {
      const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
      this._w = (m21 - m12) / s;
      this._x = (m13 + m31) / s;
      this._y = (m23 + m32) / s;
      this._z = 0.25 * s;
    }
    this._onChange();
    return this;
  }
  invert(): this {
    return this.set(-this._x, -this._y, -this._z, this._w);
  }
  normalize(): this {
    let l = Math.hypot(this._x, this._y, this._z, this._w);
    if (l === 0) return this.set(0, 0, 0, 1);
    l = 1 / l;
    return this.set(this._x * l, this._y * l, this._z * l, this._w * l);
  }
  multiply(q: Quaternion): this {
    return this.multiplyQuaternions(this, q);
  }
  premultiply(q: Quaternion): this {
    return this.multiplyQuaternions(q, this);
  }
  multiplyQuaternions(a: Quaternion, b: Quaternion): this {
    const qax = a._x,
      qay = a._y,
      qaz = a._z,
      qaw = a._w;
    const qbx = b._x,
      qby = b._y,
      qbz = b._z,
      qbw = b._w;
    return this.set(
      qax * qbw + qaw * qbx + qay * qbz - qaz * qby,
      qay * qbw + qaw * qby + qaz * qbx - qax * qbz,
      qaz * qbw + qaw * qbz + qax * qby - qay * qbx,
      qaw * qbw - qax * qbx - qay * qby - qaz * qbz
    );
  }
  slerp(qb: Quaternion, t: number): this {
    if (t === 0) return this;
    if (t === 1) return this.copy(qb);
    const x = this._x,
      y = this._y,
      z = this._z,
      w = this._w;
    let cosHalf = w * qb._w + x * qb._x + y * qb._y + z * qb._z;
    let bx = qb._x,
      by = qb._y,
      bz = qb._z,
      bw = qb._w;
    if (cosHalf < 0) {
      bx = -bx;
      by = -by;
      bz = -bz;
      bw = -bw;
      cosHalf = -cosHalf;
    }
    if (cosHalf >= 1) return this;
    const sqrSin = 1 - cosHalf * cosHalf;
    if (sqrSin <= 1e-6) {
      const s = 1 - t;
      this.set(s * x + t * bx, s * y + t * by, s * z + t * bz, s * w + t * bw);
      return this.normalize();
    }
    const sinHalf = Math.sqrt(sqrSin);
    const half = Math.atan2(sinHalf, cosHalf);
    const ra = Math.sin((1 - t) * half) / sinHalf;
    const rb = Math.sin(t * half) / sinHalf;
    return this.set(x * ra + bx * rb, y * ra + by * rb, z * ra + bz * rb, w * ra + bw * rb);
  }
}
