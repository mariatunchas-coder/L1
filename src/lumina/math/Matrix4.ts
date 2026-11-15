import type { Quaternion } from './Quaternion';
import type { Vector3 } from './Vector3';

/** 4x4 column-major matrix backed by a Float32Array (uploaded to the GPU without copies). */
export class Matrix4 {
  elements = new Float32Array(16);

  constructor() {
    this.identity();
  }

  identity(): this {
    const e = this.elements;
    e.fill(0);
    e[0] = e[5] = e[10] = e[15] = 1;
    return this;
  }
  copy(m: Matrix4): this {
    this.elements.set(m.elements);
    return this;
  }
  clone(): Matrix4 {
    return new Matrix4().copy(this);
  }
  fromArray(a: ArrayLike<number>, offset = 0): this {
    for (let i = 0; i < 16; i++) this.elements[i] = a[offset + i];
    return this;
  }

  multiply(m: Matrix4): this {
    return this.multiplyMatrices(this, m);
  }
  premultiply(m: Matrix4): this {
    return this.multiplyMatrices(m, this);
  }
  multiplyMatrices(a: Matrix4, b: Matrix4): this {
    const ae = a.elements,
      be = b.elements,
      te = this.elements;
    const a11 = ae[0],
      a12 = ae[4],
      a13 = ae[8],
      a14 = ae[12];
    const a21 = ae[1],
      a22 = ae[5],
      a23 = ae[9],
      a24 = ae[13];
    const a31 = ae[2],
      a32 = ae[6],
      a33 = ae[10],
      a34 = ae[14];
    const a41 = ae[3],
      a42 = ae[7],
      a43 = ae[11],
      a44 = ae[15];
    const b11 = be[0],
      b12 = be[4],
      b13 = be[8],
      b14 = be[12];
    const b21 = be[1],
      b22 = be[5],
      b23 = be[9],
      b24 = be[13];
    const b31 = be[2],
      b32 = be[6],
      b33 = be[10],
      b34 = be[14];
    const b41 = be[3],
      b42 = be[7],
      b43 = be[11],
      b44 = be[15];
    te[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
    te[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
    te[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43;
    te[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;
    te[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
    te[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
    te[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43;
    te[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;
    te[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
    te[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
    te[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43;
    te[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;
    te[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
    te[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
    te[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43;
    te[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;
    return this;
  }

  compose(p: Vector3, q: Quaternion, s: Vector3): this {
    const te = this.elements;
    const x = q._x,
      y = q._y,
      z = q._z,
      w = q._w;
    const x2 = x + x,
      y2 = y + y,
      z2 = z + z;
    const xx = x * x2,
      xy = x * y2,
      xz = x * z2;
    const yy = y * y2,
      yz = y * z2,
      zz = z * z2;
    const wx = w * x2,
      wy = w * y2,
      wz = w * z2;
    const sx = s.x,
      sy = s.y,
      sz = s.z;
    te[0] = (1 - (yy + zz)) * sx;
    te[1] = (xy + wz) * sx;
    te[2] = (xz - wy) * sx;
    te[3] = 0;
    te[4] = (xy - wz) * sy;
    te[5] = (1 - (xx + zz)) * sy;
    te[6] = (yz + wx) * sy;
    te[7] = 0;
    te[8] = (xz + wy) * sz;
    te[9] = (yz - wx) * sz;
    te[10] = (1 - (xx + yy)) * sz;
    te[11] = 0;
    te[12] = p.x;
    te[13] = p.y;
    te[14] = p.z;
    te[15] = 1;
    return this;
  }

  makeTranslation(x: number, y: number, z: number): this {
    this.identity();
    const e = this.elements;
    e[12] = x;
    e[13] = y;
    e[14] = z;
    return this;
  }
  makeScale(x: number, y: number, z: number): this {
    this.identity();
    const e = this.elements;
    e[0] = x;
    e[5] = y;
    e[10] = z;
    return this;
  }
  setPosition(x: number, y: number, z: number): this {
    const e = this.elements;
    e[12] = x;
    e[13] = y;
    e[14] = z;
    return this;
  }

  /** Builds an object-to-world rotation looking from `eye` toward `target` (-Z forward). */
  lookAt(eye: Vector3, target: Vector3, up: Vector3): this {
    const te = this.elements;
    let zx = eye.x - target.x,
      zy = eye.y - target.y,
      zz = eye.z - target.z;
    let l = Math.hypot(zx, zy, zz);
    if (l === 0) zz = 1;
    else {
      zx /= l;
      zy /= l;
      zz /= l;
    }
    let xx = up.y * zz - up.z * zy,
      xy = up.z * zx - up.x * zz,
      xz = up.x * zy - up.y * zx;
    l = Math.hypot(xx, xy, xz);
    if (l === 0) {
      // up parallel to z: nudge
      if (Math.abs(up.z) === 1) zx += 0.0001;
      else zz += 0.0001;
      l = Math.hypot(zx, zy, zz);
      zx /= l;
      zy /= l;
      zz /= l;
      xx = up.y * zz - up.z * zy;
      xy = up.z * zx - up.x * zz;
      xz = up.x * zy - up.y * zx;
      l = Math.hypot(xx, xy, xz);
    }
    xx /= l;
    xy /= l;
    xz /= l;
    const yx = zy * xz - zz * xy,
      yy = zz * xx - zx * xz,
      yz = zx * xy - zy * xx;
    te[0] = xx;
    te[1] = xy;
    te[2] = xz;
    te[4] = yx;
    te[5] = yy;
    te[6] = yz;
    te[8] = zx;
    te[9] = zy;
    te[10] = zz;
    return this;
  }

  perspective(fovY: number, aspect: number, near: number, far: number): this {
    const e = this.elements;
    const f = 1 / Math.tan(fovY / 2);
    const nf = 1 / (near - far);
    e.fill(0);
    e[0] = f / aspect;
    e[5] = f;
    e[10] = (far + near) * nf;
    e[11] = -1;
    e[14] = 2 * far * near * nf;
    return this;
  }
  orthographic(l: number, r: number, b: number, t: number, n: number, f: number): this {
    const e = this.elements;
    e.fill(0);
    e[0] = 2 / (r - l);
    e[5] = 2 / (t - b);
    e[10] = -2 / (f - n);
    e[12] = -(r + l) / (r - l);
    e[13] = -(t + b) / (t - b);
    e[14] = -(f + n) / (f - n);
    e[15] = 1;
    return this;
  }

  invert(): this {
    const a = this.elements;
    const a00 = a[0],
      a01 = a[1],
      a02 = a[2],
      a03 = a[3];
    const a10 = a[4],
      a11 = a[5],
      a12 = a[6],
      a13 = a[7];
    const a20 = a[8],
      a21 = a[9],
      a22 = a[10],
      a23 = a[11];
    const a30 = a[12],
      a31 = a[13],
      a32 = a[14],
      a33 = a[15];
    const b00 = a00 * a11 - a01 * a10;
    const b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11;
    const b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30;
    const b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31;
    const b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return this;
    det = 1 / det;
    a[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    a[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    a[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    a[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    a[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    a[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    a[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    a[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    a[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    a[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    a[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    a[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    a[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    a[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    a[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    a[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return this;
  }

  getMaxScaleOnAxis(): number {
    const e = this.elements;
    const x = e[0] * e[0] + e[1] * e[1] + e[2] * e[2];
    const y = e[4] * e[4] + e[5] * e[5] + e[6] * e[6];
    const z = e[8] * e[8] + e[9] * e[9] + e[10] * e[10];
    return Math.sqrt(Math.max(x, y, z));
  }

  decompose(position: Vector3, quaternion: Quaternion, scale: Vector3): this {
    const e = this.elements;
    let sx = Math.hypot(e[0], e[1], e[2]);
    const sy = Math.hypot(e[4], e[5], e[6]);
    const sz = Math.hypot(e[8], e[9], e[10]);
    const det =
      e[0] * (e[5] * e[10] - e[9] * e[6]) - e[4] * (e[1] * e[10] - e[9] * e[2]) + e[8] * (e[1] * e[6] - e[5] * e[2]);
    if (det < 0) sx = -sx;
    position.set(e[12], e[13], e[14]);
    const m = new Matrix4().copy(this);
    const me = m.elements;
    const isx = 1 / sx,
      isy = 1 / sy,
      isz = 1 / sz;
    me[0] *= isx;
    me[1] *= isx;
    me[2] *= isx;
    me[4] *= isy;
    me[5] *= isy;
    me[6] *= isy;
    me[8] *= isz;
    me[9] *= isz;
    me[10] *= isz;
    quaternion.setFromRotationMatrix(m);
    scale.set(sx, sy, sz);
    return this;
  }
}

/** 3x3 column-major matrix – used for the normal matrix. */
export class Matrix3 {
  elements = new Float32Array(9);
  constructor() {
    this.elements[0] = this.elements[4] = this.elements[8] = 1;
  }
  /** inverse-transpose of the upper-left 3x3 of `m`. */
  setNormalMatrix(m: Matrix4): this {
    const a = m.elements;
    const a00 = a[0],
      a01 = a[1],
      a02 = a[2];
    const a10 = a[4],
      a11 = a[5],
      a12 = a[6];
    const a20 = a[8],
      a21 = a[9],
      a22 = a[10];
    const b01 = a22 * a11 - a12 * a21;
    const b11 = -a22 * a10 + a12 * a20;
    const b21 = a21 * a10 - a11 * a20;
    let det = a00 * b01 + a01 * b11 + a02 * b21;
    const o = this.elements;
    if (!det) {
      o.fill(0);
      o[0] = o[4] = o[8] = 1;
      return this;
    }
    det = 1 / det;
    // inverse (column-major)
    const i0 = b01 * det;
    const i1 = (-a22 * a01 + a02 * a21) * det;
    const i2 = (a12 * a01 - a02 * a11) * det;
    const i3 = b11 * det;
    const i4 = (a22 * a00 - a02 * a20) * det;
    const i5 = (-a12 * a00 + a02 * a10) * det;
    const i6 = b21 * det;
    const i7 = (-a21 * a00 + a01 * a20) * det;
    const i8 = (a11 * a00 - a01 * a10) * det;
    // transpose
    o[0] = i0;
    o[1] = i3;
    o[2] = i6;
    o[3] = i1;
    o[4] = i4;
    o[5] = i7;
    o[6] = i2;
    o[7] = i5;
    o[8] = i8;
    return this;
  }
}
