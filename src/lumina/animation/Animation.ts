import type { Object3D } from '../core/Object3D';
import { Quaternion } from '../math/Quaternion';

export type Interpolation = 'linear' | 'step' | 'cubic';
export type TrackProperty = 'position' | 'quaternion' | 'scale';
export type LoopMode = 'repeat' | 'once' | 'pingpong';

const _qa = new Quaternion();
const _qb = new Quaternion();
const _out = new Float64Array(4);

/** Keyframes of one property of one node. For `cubic` (glTF CUBICSPLINE) values hold [inTangent, value, outTangent] per key. */
export class KeyframeTrack {
  readonly itemSize: number;
  constructor(
    public target: Object3D,
    public property: TrackProperty,
    public times: Float32Array,
    public values: Float32Array,
    public interpolation: Interpolation = 'linear'
  ) {
    this.itemSize = property === 'quaternion' ? 4 : 3;
  }

  get duration(): number {
    return this.times.length ? this.times[this.times.length - 1] : 0;
  }

  /** Evaluates the track at time `t` into a shared scratch array (valid until the next call). */
  sample(t: number): Float64Array {
    const { times, values, itemSize: n } = this;
    const count = times.length;
    const cubic = this.interpolation === 'cubic';
    const vOff = (i: number) => (cubic ? (i * 3 + 1) * n : i * n);
    if (count === 1 || t <= times[0]) {
      for (let k = 0; k < n; k++) _out[k] = values[vOff(0) + k];
      return _out;
    }
    if (t >= times[count - 1]) {
      for (let k = 0; k < n; k++) _out[k] = values[vOff(count - 1) + k];
      return _out;
    }
    // binary search: times[lo] <= t < times[lo + 1]
    let lo = 0,
      hi = count - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= t) lo = mid;
      else hi = mid;
    }
    const t0 = times[lo],
      t1 = times[lo + 1];
    const dt = t1 - t0;
    const s = dt > 0 ? (t - t0) / dt : 0;
    const a = vOff(lo),
      b = vOff(lo + 1);

    if (this.interpolation === 'step') {
      for (let k = 0; k < n; k++) _out[k] = values[a + k];
    } else if (cubic) {
      const s2 = s * s,
        s3 = s2 * s;
      const h00 = 2 * s3 - 3 * s2 + 1,
        h10 = s3 - 2 * s2 + s,
        h01 = -2 * s3 + 3 * s2,
        h11 = s3 - s2;
      for (let k = 0; k < n; k++) {
        const p0 = values[a + k],
          m0 = values[a + n + k] * dt, // out-tangent of key lo
          p1 = values[b + k],
          m1 = values[b - n + k] * dt; // in-tangent of key lo+1
        _out[k] = h00 * p0 + h10 * m0 + h01 * p1 + h11 * m1;
      }
      if (n === 4) this.normalizeQuat();
    } else if (n === 4) {
      _qa.set(values[a], values[a + 1], values[a + 2], values[a + 3]);
      _qb.set(values[b], values[b + 1], values[b + 2], values[b + 3]);
      _qa.slerp(_qb, s);
      _out[0] = _qa.x;
      _out[1] = _qa.y;
      _out[2] = _qa.z;
      _out[3] = _qa.w;
    } else {
      for (let k = 0; k < n; k++) _out[k] = values[a + k] + (values[b + k] - values[a + k]) * s;
    }
    return _out;
  }

  private normalizeQuat(): void {
    const l = Math.hypot(_out[0], _out[1], _out[2], _out[3]) || 1;
    for (let k = 0; k < 4; k++) _out[k] /= l;
  }
}

export class AnimationClip {
  duration: number;
  constructor(public name: string, public tracks: KeyframeTrack[], duration?: number) {
    this.duration = duration ?? tracks.reduce((m, t) => Math.max(m, t.duration), 0);
  }
}

export class AnimationAction {
  weight = 1;
  timeScale = 1;
  loop: LoopMode = 'repeat';
  time = 0;
  playing = false;
  /** When true a `once` action stays on its last frame instead of releasing the pose. */
  clampWhenFinished = true;
  private fade = { from: 1, to: 1, dur: 0, t: 0, stopAtEnd: false, active: false };
  private dir = 1;

  constructor(readonly clip: AnimationClip) {}

  play(): this {
    this.playing = true;
    return this;
  }
  pause(): this {
    this.playing = false;
    return this;
  }
  stop(): this {
    this.playing = false;
    this.time = 0;
    this.dir = 1;
    this.fade.active = false;
    return this;
  }
  fadeIn(seconds: number): this {
    this.fade = { from: 0, to: 1, dur: Math.max(1e-4, seconds), t: 0, stopAtEnd: false, active: true };
    this.weight = 0;
    this.playing = true;
    return this;
  }
  fadeOut(seconds: number): this {
    this.fade = { from: this.weight, to: 0, dur: Math.max(1e-4, seconds), t: 0, stopAtEnd: true, active: true };
    return this;
  }
  crossFadeTo(other: AnimationAction, seconds: number): this {
    this.fadeOut(seconds);
    other.time = 0;
    other.fadeIn(seconds);
    return this;
  }

  /** @internal */
  advance(dt: number): void {
    if (this.fade.active) {
      const f = this.fade;
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      this.weight = f.from + (f.to - f.from) * k;
      if (k >= 1) {
        f.active = false;
        if (f.stopAtEnd) this.playing = false;
      }
    }
    if (!this.playing) return;
    const d = this.clip.duration;
    this.time += dt * this.timeScale * this.dir;
    if (d <= 0) return;
    if (this.loop === 'repeat') {
      this.time = ((this.time % d) + d) % d;
    } else if (this.loop === 'pingpong') {
      if (this.time > d) {
        this.time = d - (this.time - d);
        this.dir = -1;
      } else if (this.time < 0) {
        this.time = -this.time;
        this.dir = 1;
      }
    } else if (this.time >= d || this.time <= 0) {
      this.time = this.time >= d ? d : 0;
      this.playing = false;
    }
  }
}

interface Accum {
  pw: number;
  qw: number;
  sw: number;
}

/**
 * Plays any number of clips on a node hierarchy and blends them by weight
 * (translation / scale: weighted lerp · rotation: incremental slerp).
 */
export class AnimationMixer {
  timeScale = 1;
  readonly actions: AnimationAction[] = [];
  private acc = new Map<Object3D, Accum>();

  clipAction(clip: AnimationClip): AnimationAction {
    let a = this.actions.find((x) => x.clip === clip);
    if (!a) {
      a = new AnimationAction(clip);
      this.actions.push(a);
    }
    return a;
  }

  stopAll(): void {
    for (const a of this.actions) a.stop();
  }

  update(dt: number): void {
    dt *= this.timeScale;
    const acc = this.acc;
    acc.clear();
    for (const action of this.actions) {
      action.advance(dt);
      const apply = action.playing || action.clampWhenFinished;
      if (!apply || action.weight <= 1e-5) continue;
      const w = action.weight;
      for (const tr of action.clip.tracks) {
        const v = tr.sample(action.time);
        let ac = acc.get(tr.target);
        if (!ac) acc.set(tr.target, (ac = { pw: 0, qw: 0, sw: 0 }));
        const o = tr.target;
        if (tr.property === 'position') {
          ac.pw += w;
          const k = w / ac.pw;
          o.position.set(ac.pw === w ? v[0] : o.position.x + (v[0] - o.position.x) * k, ac.pw === w ? v[1] : o.position.y + (v[1] - o.position.y) * k, ac.pw === w ? v[2] : o.position.z + (v[2] - o.position.z) * k);
        } else if (tr.property === 'scale') {
          ac.sw += w;
          const k = w / ac.sw;
          o.scale.set(ac.sw === w ? v[0] : o.scale.x + (v[0] - o.scale.x) * k, ac.sw === w ? v[1] : o.scale.y + (v[1] - o.scale.y) * k, ac.sw === w ? v[2] : o.scale.z + (v[2] - o.scale.z) * k);
        } else {
          ac.qw += w;
          if (ac.qw === w) o.quaternion.set(v[0], v[1], v[2], v[3]);
          else {
            _qb.set(v[0], v[1], v[2], v[3]);
            // shortest path
            const q = o.quaternion;
            if (q.x * _qb.x + q.y * _qb.y + q.z * _qb.z + q.w * _qb.w < 0) _qb.set(-_qb.x, -_qb.y, -_qb.z, -_qb.w);
            q.slerp(_qb, w / ac.qw);
          }
        }
      }
    }
  }
}
