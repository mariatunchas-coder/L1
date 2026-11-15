import { Color } from '../math/Color';
import { Quaternion } from '../math/Quaternion';
import { Vector3 } from '../math/Vector3';
import { Object3D } from './Object3D';

/** Procedural decal images (layers of the built-in atlas). */
export type DecalKind = 'dirt' | 'crack' | 'puddle' | 'scorch' | 'moss' | 'scratches';
export const DECAL_KINDS: DecalKind[] = ['dirt', 'crack', 'puddle', 'scorch', 'moss', 'scratches'];

const _a = new Vector3();
const _b = new Vector3();
const _q = new Quaternion();

/**
 * Projected decal (dirt, cracks, puddles, soot, moss, scratches). The decal is a box of size `scale` centred on the
 * object; its image lies on local X/Y and is projected along local Z onto every PBR surface inside the box
 * (`PBRMaterial.receiveDecals`). Because it is evaluated *inside* the material shader it is lit by every light,
 * shadowed, reflected and fogged exactly like the surface underneath – it changes albedo, roughness and normals.
 * The renderer uses the 8 decals closest to the camera.
 */
export class Decal extends Object3D {
  readonly isDecal = true;
  kind: DecalKind = 'dirt';
  color = new Color(1, 1, 1);
  opacity = 1;
  /** Roughness of the covered surface (−1 = keep the underlying roughness). */
  roughness = -1;
  /** Strength of the relief (cracks, scratches) added to the normal. */
  normalStrength = 1;
  /** 0 … 1 – flattens the normal under the decal (water in a puddle). */
  flatten = 0;
  /** 0 … 1 – wet look: darker albedo and glossier surface. */
  wetness = 0;

  constructor(kind: DecalKind = 'dirt', size = 2, depth = 1) {
    super();
    this.type = 'Decal';
    this.kind = kind;
    this.scale.set(size, size, depth);
    this.castShadow = false;
    switch (kind) {
      case 'dirt':
        this.color.setRGB(0.05, 0.035, 0.025);
        this.opacity = 0.85;
        this.roughness = 0.95;
        break;
      case 'crack':
        this.color.setRGB(0.012, 0.01, 0.009);
        this.opacity = 0.95;
        this.normalStrength = 2.2;
        break;
      case 'puddle':
        this.color.setRGB(0.05, 0.06, 0.07);
        this.opacity = 1;
        this.roughness = 0.03;
        this.flatten = 1;
        this.wetness = 1;
        break;
      case 'scorch':
        this.color.setRGB(0.008, 0.007, 0.006);
        this.opacity = 0.95;
        this.roughness = 0.9;
        break;
      case 'moss':
        this.color.setRGB(0.04, 0.12, 0.02);
        this.opacity = 0.9;
        this.roughness = 0.95;
        this.normalStrength = 0.6;
        break;
      case 'scratches':
        this.color.setRGB(0.6, 0.6, 0.62);
        this.opacity = 0.6;
        this.roughness = 0.35;
        this.normalStrength = 1.5;
        break;
    }
  }

  /** Places the decal on a surface point: local +Z = surface normal, `rotation` spins the image around the normal. */
  placeOnSurface(point: Vector3, normal: Vector3, size = this.scale.x, depth = this.scale.z, rotation = 0): this {
    _a.copy(normal).normalize();
    // shortest rotation from +Z to the normal
    _b.set(0, 0, 1);
    const d = _b.x * _a.x + _b.y * _a.y + _b.z * _a.z;
    if (d < -0.99999) _q.setFromAxisAngle(_b.set(1, 0, 0), Math.PI);
    else {
      const ax = _b.set(-_a.y, _a.x, 0); // z × n
      const len = Math.hypot(ax.x, ax.y, ax.z);
      if (len < 1e-8) _q.setFromAxisAngle(ax.set(1, 0, 0), 0);
      else _q.setFromAxisAngle(ax.multiplyScalar(1 / len), Math.acos(Math.max(-1, Math.min(1, d))));
    }
    this.position.copy(point);
    this.quaternion.copy(_q);
    if (rotation !== 0) {
      const spin = new Quaternion().setFromAxisAngle(_b.set(0, 0, 1), rotation);
      this.quaternion.multiply(spin);
    }
    this.scale.set(size, size, depth);
    return this;
  }
}
