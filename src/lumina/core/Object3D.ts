import { Euler, Quaternion } from '../math/Quaternion';
import { Matrix4 } from '../math/Matrix4';
import { Vector3 } from '../math/Vector3';

let _nextId = 1;
const _m = new Matrix4();
const _up = new Vector3(0, 1, 0);

/**
 * Base scene-graph node.
 *
 * Performance notes
 *  - Local matrices are only recomposed when position/rotation/scale actually changed
 *    (10-float comparison against a cache), and world matrices only when the local
 *    matrix or an ancestor changed → static scenes cost almost nothing per frame.
 *  - `isStatic` lets a whole sub-tree be skipped until `markDirty()` is called.
 *  - `worldVersion` increments whenever the world matrix changes, so GPU-side caches
 *    (normal matrices, bounds) can be invalidated cheaply.
 */
export class Object3D {
  readonly id = _nextId++;
  name = '';
  type = 'Object3D';
  isMesh = false;
  isLight = false;
  isCamera = false;
  isScene = false;

  parent: Object3D | null = null;
  children: Object3D[] = [];

  position = new Vector3();
  rotation = new Euler();
  quaternion = new Quaternion();
  scale = new Vector3(1, 1, 1);

  matrix = new Matrix4();
  matrixWorld = new Matrix4();
  matrixAutoUpdate = true;
  matrixWorldNeedsUpdate = true;
  worldVersion = 0;
  /** Skip this node and its descendants during matrix updates until markDirty(). */
  isStatic = false;

  visible = true;
  castShadow = false;
  receiveShadow = true;
  frustumCulled = true;
  renderOrder = 0;
  userData: Record<string, unknown> = {};

  private _cache = new Float64Array(10);
  private _cacheValid = false;

  constructor() {
    this.rotation._onChange = () => this.quaternion.setFromEuler(this.rotation, false);
    this.quaternion._onChange = () => this.rotation.setFromQuaternion(this.quaternion, false);
  }

  add(...objects: Object3D[]): this {
    for (const o of objects) {
      if (o === this) continue;
      o.parent?.remove(o);
      o.parent = this;
      o.matrixWorldNeedsUpdate = true;
      this.children.push(o);
    }
    return this;
  }
  remove(...objects: Object3D[]): this {
    for (const o of objects) {
      const i = this.children.indexOf(o);
      if (i !== -1) {
        o.parent = null;
        this.children.splice(i, 1);
      }
    }
    return this;
  }
  traverse(cb: (o: Object3D) => void): void {
    cb(this);
    for (let i = 0; i < this.children.length; i++) this.children[i].traverse(cb);
  }
  getObjectByName(name: string): Object3D | undefined {
    let found: Object3D | undefined;
    this.traverse((o) => {
      if (!found && o.name === name) found = o;
    });
    return found;
  }

  markDirty(): void {
    this.matrixWorldNeedsUpdate = true;
    this._cacheValid = false;
  }

  /** @returns true when the local matrix was recomposed. */
  updateMatrix(): boolean {
    const p = this.position,
      q = this.quaternion,
      s = this.scale,
      c = this._cache;
    if (
      this._cacheValid &&
      c[0] === p.x &&
      c[1] === p.y &&
      c[2] === p.z &&
      c[3] === q._x &&
      c[4] === q._y &&
      c[5] === q._z &&
      c[6] === q._w &&
      c[7] === s.x &&
      c[8] === s.y &&
      c[9] === s.z
    )
      return false;
    c[0] = p.x;
    c[1] = p.y;
    c[2] = p.z;
    c[3] = q._x;
    c[4] = q._y;
    c[5] = q._z;
    c[6] = q._w;
    c[7] = s.x;
    c[8] = s.y;
    c[9] = s.z;
    this._cacheValid = true;
    this.matrix.compose(p, q, s);
    this.matrixWorldNeedsUpdate = true;
    return true;
  }

  updateMatrixWorld(force = false): void {
    if (this.isStatic && !force && !this.matrixWorldNeedsUpdate && this._cacheValid) return;
    if (this.matrixAutoUpdate) this.updateMatrix();
    if (this.matrixWorldNeedsUpdate || force) {
      if (this.parent) this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
      else this.matrixWorld.copy(this.matrix);
      this.matrixWorldNeedsUpdate = false;
      this.worldVersion++;
      force = true;
    }
    const ch = this.children;
    for (let i = 0; i < ch.length; i++) ch[i].updateMatrixWorld(force);
  }

  getWorldPosition(target = new Vector3()): Vector3 {
    return target.setFromMatrixPosition(this.matrixWorld);
  }

  /** Orients the object so that its -Z axis points to the target (world space, assumes no rotated parent). */
  lookAt(x: number | Vector3, y?: number, z?: number): this {
    const t = typeof x === 'number' ? new Vector3(x, y!, z!) : x;
    _m.lookAt(this.position, t, _up);
    this.quaternion.setFromRotationMatrix(_m);
    return this;
  }
}
