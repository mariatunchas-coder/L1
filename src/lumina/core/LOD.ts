import type { PerspectiveCamera } from './Camera';
import { Object3D } from './Object3D';
import { Vector3 } from '../math/Vector3';

const _a = new Vector3();
const _b = new Vector3();

/**
 * Level-of-detail switch. Add levels from most to least detailed; the renderer calls
 * `update(camera)` once per frame and only the level matching the camera distance stays visible.
 * `hysteresis` (fraction of the threshold) avoids popping when hovering around a boundary.
 */
export class LOD extends Object3D {
  readonly isLOD = true;
  levels: { object: Object3D; distance: number }[] = [];
  hysteresis = 0.05;
  /** Index of the currently visible level. */
  current = 0;

  constructor() {
    super();
    this.type = 'LOD';
  }

  addLevel(object: Object3D, distance = 0): this {
    const d = Math.abs(distance);
    let i = 0;
    while (i < this.levels.length && d >= this.levels[i].distance) i++;
    this.levels.splice(i, 0, { object, distance: d });
    object.visible = i === 0;
    this.add(object);
    return this;
  }

  update(camera: PerspectiveCamera): void {
    const n = this.levels.length;
    if (n < 2) return;
    _a.setFromMatrixPosition(camera.matrixWorld);
    _b.setFromMatrixPosition(this.matrixWorld);
    const dist = _a.distanceTo(_b);
    let idx = 0;
    for (let i = 1; i < n; i++) {
      const t = this.levels[i].distance;
      // widen the band of the level we are already in
      const h = t * this.hysteresis * (this.current >= i ? -1 : 1);
      if (dist >= t + h) idx = i;
      else break;
    }
    if (idx !== this.current || !this.levels[idx].object.visible) {
      for (let i = 0; i < n; i++) this.levels[i].object.visible = i === idx;
      this.current = idx;
    }
  }
}
