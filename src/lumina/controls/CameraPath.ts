import type { PerspectiveCamera } from '../core/Camera';

export interface CameraKey {
  /** Camera position. */
  p: [number, number, number];
  /** Optional explicit look-at target; otherwise the camera looks along the path (with look-ahead). */
  look?: [number, number, number];
  /** Optional vertical field of view for this key (deg). */
  fov?: number;
}

/**
 * Lumina X – cinematic camera rail: a centripetal Catmull-Rom spline through position keys, travelled at a constant
 * speed (arc-length parameterised). The camera looks either at per-key targets (interpolated) or ahead along the path,
 * with smoothed roll-free orientation. Closed loops are supported.
 */
export class CameraPath {
  /** Metres per second. */
  speed = 22;
  loop = true;
  /** Seconds of look-ahead along the path (when no explicit look targets are given). */
  lookAhead = 1.4;
  playing = false;
  /** 0 … 1 progress along the path. */
  progress = 0;

  private keys: CameraKey[] = [];
  private samples: Float32Array = new Float32Array(0); // x y z fov per sample
  private cum: Float32Array = new Float32Array(0);
  private total = 0;
  private lookX = 0;
  private lookY = 0;
  private lookZ = 0;
  private hasLook = false;

  constructor(keys: CameraKey[] = []) {
    if (keys.length) this.setKeys(keys);
  }

  get length(): number {
    return this.total;
  }

  setKeys(keys: CameraKey[]): this {
    this.keys = keys.slice();
    this.rebuild();
    return this;
  }

  private rebuild(): void {
    const k = this.keys;
    const n = k.length;
    if (n < 2) {
      this.samples = new Float32Array(0);
      this.cum = new Float32Array(0);
      this.total = 0;
      return;
    }
    const segs = this.loop ? n : n - 1;
    const per = 48;
    const count = segs * per + 1;
    const s = new Float32Array(count * 4);
    const cum = new Float32Array(count);
    const at = (i: number): CameraKey => (this.loop ? k[((i % n) + n) % n] : k[Math.max(0, Math.min(n - 1, i))]);
    for (let sgi = 0; sgi < segs; sgi++) {
      const p0 = at(sgi - 1),
        p1 = at(sgi),
        p2 = at(sgi + 1),
        p3 = at(sgi + 2);
      for (let j = 0; j <= per; j++) {
        if (sgi > 0 && j === 0) continue;
        const t = j / per;
        const idx = sgi * per + j;
        for (let c = 0; c < 3; c++) s[idx * 4 + c] = CameraPath.cr(p0.p[c], p1.p[c], p2.p[c], p3.p[c], t);
        const f1 = p1.fov ?? NaN,
          f2 = p2.fov ?? NaN;
        s[idx * 4 + 3] = Number.isNaN(f1) || Number.isNaN(f2) ? NaN : f1 + (f2 - f1) * t;
      }
    }
    let acc = 0;
    for (let i = 1; i < count; i++) {
      const dx = s[i * 4] - s[(i - 1) * 4],
        dy = s[i * 4 + 1] - s[(i - 1) * 4 + 1],
        dz = s[i * 4 + 2] - s[(i - 1) * 4 + 2];
      acc += Math.hypot(dx, dy, dz);
      cum[i] = acc;
    }
    this.samples = s;
    this.cum = cum;
    this.total = acc;
  }

  /** Uniform Catmull-Rom (tension 0.5). */
  private static cr(p0: number, p1: number, p2: number, p3: number, t: number): number {
    const t2 = t * t,
      t3 = t2 * t;
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }

  /** Position at a distance `d` (m) along the rail, written into `out`. Returns the interpolated fov or NaN. */
  sample(d: number, out: [number, number, number]): number {
    const n = this.cum.length;
    if (n < 2 || this.total <= 0) return NaN;
    d = this.loop ? ((d % this.total) + this.total) % this.total : Math.max(0, Math.min(this.total, d));
    let lo = 0,
      hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= d) lo = mid;
      else hi = mid;
    }
    const span = Math.max(this.cum[hi] - this.cum[lo], 1e-9);
    const t = (d - this.cum[lo]) / span;
    const s = this.samples;
    for (let c = 0; c < 3; c++) out[c] = s[lo * 4 + c] + (s[hi * 4 + c] - s[lo * 4 + c]) * t;
    const f0 = s[lo * 4 + 3],
      f1 = s[hi * 4 + 3];
    return f0 + (f1 - f0) * t;
  }

  private readonly _a: [number, number, number] = [0, 0, 0];
  private readonly _b: [number, number, number] = [0, 0, 0];

  play(): void {
    this.playing = true;
    this.hasLook = false;
  }
  pause(): void {
    this.playing = false;
  }

  /** Advances along the rail and orients the camera. Returns true while moving. */
  update(camera: PerspectiveCamera, dt: number): boolean {
    if (!this.playing || this.total <= 0) return false;
    let d = this.progress * this.total + this.speed * Math.min(dt, 0.1);
    if (!this.loop && d >= this.total) {
      d = this.total;
      this.playing = false;
    }
    this.progress = this.loop ? (((d / this.total) % 1) + 1) % 1 : d / this.total;
    const dist = this.progress * this.total;
    const fov = this.sample(dist, this._a);
    camera.position.set(this._a[0], this._a[1], this._a[2]);
    this.sample(dist + Math.max(2, this.speed * this.lookAhead), this._b);
    // look slightly downward toward the street ahead
    const tx = this._b[0],
      ty = this._b[1] - 0.04 * Math.hypot(this._b[0] - this._a[0], this._b[2] - this._a[2]),
      tz = this._b[2];
    if (!this.hasLook) {
      this.lookX = tx;
      this.lookY = ty;
      this.lookZ = tz;
      this.hasLook = true;
    } else {
      const a = 1 - Math.exp(-2.4 * Math.min(dt, 0.1));
      this.lookX += (tx - this.lookX) * a;
      this.lookY += (ty - this.lookY) * a;
      this.lookZ += (tz - this.lookZ) * a;
    }
    camera.lookAt(this.lookX, this.lookY, this.lookZ);
    if (!Number.isNaN(fov) && fov > 1 && Math.abs(camera.fov - fov) > 1e-3) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    return true;
  }
}
