import { DEG2RAD } from '../math/MathUtils';
import { Matrix4 } from '../math/Matrix4';
import { Vector3 } from '../math/Vector3';
import { Object3D } from './Object3D';

export class PerspectiveCamera extends Object3D {
  fov: number;
  aspect: number;
  near: number;
  far: number;
  projectionMatrix = new Matrix4();
  projectionMatrixInverse = new Matrix4();
  matrixWorldInverse = new Matrix4();
  private _viewVersion = -1;

  constructor(fov = 50, aspect = 1, near = 0.1, far = 1000) {
    super();
    this.type = 'PerspectiveCamera';
    this.isCamera = true;
    this.fov = fov;
    this.aspect = aspect;
    this.near = near;
    this.far = far;
    this.updateProjectionMatrix();
  }

  updateProjectionMatrix(): void {
    this.projectionMatrix.perspective(this.fov * DEG2RAD, this.aspect, this.near, this.far);
    this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
  }

  override updateMatrixWorld(force = false): void {
    super.updateMatrixWorld(force);
    if (this._viewVersion !== this.worldVersion) {
      this.matrixWorldInverse.copy(this.matrixWorld).invert();
      this._viewVersion = this.worldVersion;
    }
  }

  getWorldDirection(target = new Vector3()): Vector3 {
    const e = this.matrixWorld.elements;
    return target.set(-e[8], -e[9], -e[10]).normalize();
  }
}
