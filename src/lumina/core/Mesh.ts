import { Sphere } from '../math/Bounds';
import type { Color } from '../math/Color';
import { Matrix3, Matrix4 } from '../math/Matrix4';
import { Vector3 } from '../math/Vector3';
import { BufferAttribute, Geometry } from './Geometry';
import type { Material } from './Material';
import { Object3D } from './Object3D';

export class Mesh extends Object3D {
  geometry: Geometry;
  material: Material;
  /** cached normal matrix (inverse transpose of the world matrix) */
  readonly normalMatrix = new Matrix3();
  normalMatrixVersion = -1;
  /** cached world-space bounding sphere (x, y, z, radius) */
  readonly worldSphere = new Float64Array(4);
  private _wsWorld = -1;
  private _wsBounds = -1;
  /** bumped whenever local bounds change (InstancedMesh.update) */
  boundsVersion = 0;

  /** World-space bounding sphere, recomputed only when the transform or bounds changed. */
  getWorldSphere(): Float64Array {
    if (this._wsWorld !== this.worldVersion || this._wsBounds !== this.boundsVersion) {
      const b = this.getLocalBounds();
      const e = this.matrixWorld.elements;
      const x = b.center.x,
        y = b.center.y,
        z = b.center.z;
      const w = this.worldSphere;
      w[0] = e[0] * x + e[4] * y + e[8] * z + e[12];
      w[1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      w[2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      w[3] = b.radius * this.matrixWorld.getMaxScaleOnAxis();
      this._wsWorld = this.worldVersion;
      this._wsBounds = this.boundsVersion;
    }
    return this.worldSphere;
  }

  constructor(geometry: Geometry, material: Material) {
    super();
    this.type = 'Mesh';
    this.isMesh = true;
    this.geometry = geometry;
    this.material = material;
    this.castShadow = true;
    this.receiveShadow = true;
  }

  /** Local-space bounding sphere used for frustum culling. */
  getLocalBounds(): Sphere {
    return this.geometry.boundingSphere ?? this.geometry.computeBoundingSphere();
  }
}

const _tmpM = new Matrix4();
const _c = new Vector3();

/**
 * Draws `count` copies of the geometry in a single draw call (GPU instancing).
 * Per-instance data lives in tightly packed Float32Arrays that are streamed to the GPU
 * only when `update()` is called.
 */
export class InstancedMesh extends Mesh {
  count: number;
  readonly maxCount: number;
  instanceMatrix: BufferAttribute;
  instanceColor: BufferAttribute | null = null;
  private _bounds = new Sphere();
  private _boundsDirty = true;
  private _renderGeometry: Geometry | null = null;

  constructor(geometry: Geometry, material: Material, count: number, withColors = false) {
    super(geometry, material);
    this.type = 'InstancedMesh';
    this.count = count;
    this.maxCount = count;
    const arr = new Float32Array(count * 16);
    for (let i = 0; i < count; i++) {
      arr[i * 16] = arr[i * 16 + 5] = arr[i * 16 + 10] = arr[i * 16 + 15] = 1;
    }
    this.instanceMatrix = new BufferAttribute(arr, 16);
    this.instanceMatrix.divisor = 1;
    this.instanceMatrix.usage = 'dynamic';
    if (withColors) this.allocColors();
  }

  private allocColors(): void {
    const arr = new Float32Array(this.maxCount * 3).fill(1);
    this.instanceColor = new BufferAttribute(arr, 3);
    this.instanceColor.divisor = 1;
    this.instanceColor.usage = 'dynamic';
    this._renderGeometry?.dispose();
    this._renderGeometry = null;
  }

  setMatrixAt(i: number, m: Matrix4): void {
    this.instanceMatrix.array.set(m.elements, i * 16);
  }
  getMatrixAt(i: number, m: Matrix4): Matrix4 {
    return m.fromArray(this.instanceMatrix.array, i * 16);
  }
  setColorAt(i: number, c: Color): void {
    if (!this.instanceColor) this.allocColors();
    const a = this.instanceColor!.array;
    a[i * 3] = c.r;
    a[i * 3 + 1] = c.g;
    a[i * 3 + 2] = c.b;
  }

  /** Call after modifying instance matrices/colours. */
  update(): void {
    this.instanceMatrix.needsUpdate = true;
    if (this.instanceColor) this.instanceColor.needsUpdate = true;
    this._boundsDirty = true;
    this.boundsVersion++;
  }

  override getLocalBounds(): Sphere {
    if (!this._boundsDirty) return this._bounds;
    const gs = this.geometry.boundingSphere ?? this.geometry.computeBoundingSphere();
    const a = this.instanceMatrix.array;
    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity,
      maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;
    let maxR = 0;
    for (let i = 0; i < this.count; i++) {
      _tmpM.fromArray(a, i * 16);
      _c.copy(gs.center).applyMatrix4(_tmpM);
      const r = gs.radius * _tmpM.getMaxScaleOnAxis();
      if (r > maxR) maxR = r;
      if (_c.x < minX) minX = _c.x;
      if (_c.y < minY) minY = _c.y;
      if (_c.z < minZ) minZ = _c.z;
      if (_c.x > maxX) maxX = _c.x;
      if (_c.y > maxY) maxY = _c.y;
      if (_c.z > maxZ) maxZ = _c.z;
    }
    if (this.count === 0) {
      this._bounds.center.set(0, 0, 0);
      this._bounds.radius = 0;
    } else {
      this._bounds.center.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
      this._bounds.radius = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2 + maxR;
    }
    this._boundsDirty = false;
    return this._bounds;
  }

  /** Geometry that shares the vertex buffers but adds per-instance attributes. */
  getRenderGeometry(): Geometry {
    if (this._renderGeometry) return this._renderGeometry;
    const g = new Geometry();
    g.type = 'InstancedGeometry';
    g.ownsBuffers = false;
    g.attributes = { ...this.geometry.attributes };
    g.index = this.geometry.index;
    g.attributes.instanceMatrix = this.instanceMatrix;
    if (this.instanceColor) g.attributes.instanceColor = this.instanceColor;
    g.drawRange = this.geometry.drawRange;
    this._renderGeometry = g;
    return g;
  }

  dispose(): void {
    this._renderGeometry?.dispose();
    this.instanceMatrix.dispose();
    this.instanceColor?.dispose();
  }
}
