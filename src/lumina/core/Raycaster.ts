import { Ray } from '../math/Bounds';
import { Matrix4 } from '../math/Matrix4';
import { Vector3 } from '../math/Vector3';
import type { PerspectiveCamera } from './Camera';
import { FrontSide } from './Material';
import type { InstancedMesh, Mesh } from './Mesh';
import type { Object3D } from './Object3D';

export interface Intersection {
  distance: number;
  point: Vector3;
  object: Mesh;
  instanceId?: number;
}

const _inv = new Matrix4();
const _vp = new Matrix4();
const _local = new Ray();
const _a = new Vector3(),
  _b = new Vector3(),
  _c = new Vector3(),
  _ctr = new Vector3(),
  _im = new Matrix4(),
  _world = new Matrix4();

export class Raycaster {
  ray = new Ray();

  /** `ndcX/ndcY` in [-1, 1] (y up). */
  setFromCamera(ndcX: number, ndcY: number, camera: PerspectiveCamera): this {
    _vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert();
    this.ray.origin.setFromMatrixPosition(camera.matrixWorld);
    const p = new Vector3(ndcX, ndcY, 0.5).applyMatrix4(_vp);
    this.ray.direction.copy(p).sub(this.ray.origin).normalize();
    return this;
  }

  intersectObjects(objects: Object3D[], recursive = true): Intersection[] {
    const hits: Intersection[] = [];
    const visit = (o: Object3D) => {
      if (!o.visible) return;
      if (o.isMesh) this.intersectMesh(o as Mesh, hits);
      if (recursive) for (const c of o.children) visit(c);
    };
    objects.forEach(visit);
    return hits.sort((x, y) => x.distance - y.distance);
  }

  private intersectMesh(mesh: Mesh, hits: Intersection[]): void {
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    if (!pos) return;
    const inst = (mesh as InstancedMesh).instanceMatrix ? (mesh as InstancedMesh) : null;
    const gs = geo.boundingSphere ?? geo.computeBoundingSphere();
    const count = inst ? inst.count : 1;
    for (let i = 0; i < count; i++) {
      if (inst) {
        inst.getMatrixAt(i, _im);
        _world.multiplyMatrices(mesh.matrixWorld, _im);
      } else _world.copy(mesh.matrixWorld);
      _ctr.copy(gs.center).applyMatrix4(_world);
      if (this.ray.intersectSphere(_ctr, gs.radius * _world.getMaxScaleOnAxis() * 1.0001) < 0) continue;
      _inv.copy(_world).invert();
      _local.origin.copy(this.ray.origin).applyMatrix4(_inv);
      // left unnormalised: Möller–Trumbore only needs a consistent direction,
      // and normalising here would need an extra sqrt with no benefit, since
      // the resulting t is local-space anyway (see below).
      const e = _inv.elements,
        d = this.ray.direction;
      _local.direction.set(
        e[0] * d.x + e[4] * d.y + e[8] * d.z,
        e[1] * d.x + e[5] * d.y + e[9] * d.z,
        e[2] * d.x + e[6] * d.y + e[10] * d.z
      );
      const idx = geo.index?.array;
      const P = pos.array;
      const tris = geo.triangleCount;
      const cull = (mesh.material.side ?? FrontSide) === FrontSide;
      // t is in local space, so it is only comparable to world distance when the
      // transform is uniformly scaled. With non-uniform scale (e.g. stretched
      // instances) it is not, so we keep the local t only to pick the nearest
      // triangle, then convert the actual hit point to world space below.
      let best = -1;
      for (let t = 0; t < tris; t++) {
        const i0 = idx ? idx[t * 3] : t * 3,
          i1 = idx ? idx[t * 3 + 1] : t * 3 + 1,
          i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
        _a.set(P[i0 * 3], P[i0 * 3 + 1], P[i0 * 3 + 2]);
        _b.set(P[i1 * 3], P[i1 * 3 + 1], P[i1 * 3 + 2]);
        _c.set(P[i2 * 3], P[i2 * 3 + 1], P[i2 * 3 + 2]);
        const dist = _local.intersectTriangle(_a, _b, _c, cull);
        if (dist >= 0 && (best < 0 || dist < best)) best = dist;
      }
      if (best >= 0) {
        // local hit point → world space (correct for non-uniform scale too)
        const worldPoint = _local.at(best).applyMatrix4(_world);
        const distance = worldPoint.distanceTo(this.ray.origin);
        hits.push({
          distance,
          point: worldPoint,
          object: mesh,
          instanceId: inst ? i : undefined,
        });
      }
    }
  }
}
