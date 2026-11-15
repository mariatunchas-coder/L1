import { Color } from '../math/Color';
import { Vector3 } from '../math/Vector3';
import { Object3D } from './Object3D';
import type { Sky } from './Sky';

export class Light extends Object3D {
  color: Color;
  /** Directional: irradiance (lux-like). Point/Spot: radiant intensity (so illuminance = I / d²). */
  intensity: number;
  constructor(color: number | string | Color = 0xffffff, intensity = 1) {
    super();
    this.isLight = true;
    this.color = new Color().set(color as Color);
    this.intensity = intensity;
  }
}

export interface CascadedShadowSettings {
  /** Resolution of every cascade (px). */
  mapSize: number;
  /** 1 – 4 */
  cascades: number;
  /** Max distance (from the camera) covered by shadows. */
  distance: number;
  /** 0 = uniform splits, 1 = logarithmic splits. */
  lambda: number;
  /** Constant depth bias in world units. */
  bias: number;
  /** Normal offset in shadow texels. */
  normalBias: number;
  /** Penumbra radius in texels (PCF disk). */
  softness: number;
}

/** Sun-like light with cascaded shadow maps. */
export class DirectionalLight extends Light {
  target = new Vector3();
  shadow: CascadedShadowSettings = {
    mapSize: 2048,
    cascades: 3,
    distance: 120,
    lambda: 0.85,
    bias: 0.03,
    normalBias: 1.4,
    softness: 1.6,
  };
  constructor(color: number | string | Color = 0xffffff, intensity = 3) {
    super(color, intensity);
    this.type = 'DirectionalLight';
    this.castShadow = true;
    this.position.set(30, 60, 20);
  }
  /** Unit direction pointing toward the light (written into `out`). */
  getDirection(out: Vector3): Vector3 {
    this.getWorldPosition(out).sub(this.target);
    return out.lengthSq() < 1e-12 ? out.set(0, 1, 0) : out.normalize();
  }
  /** Aligns direction, colour and intensity with a Sky. */
  syncWithSky(sky: Sky): void {
    const l = sky.getSunLight();
    this.position.copy(this.target).addScaled(sky.sunDirection, 100);
    this.color.copy(l.color);
    this.intensity = l.intensity;
    this.visible = l.intensity > 1e-3;
  }
}

export class PointLight extends Light {
  /** Influence radius in metres (0 = unlimited, pure inverse-square). */
  range: number;
  constructor(color: number | string | Color = 0xffffff, intensity = 10, range = 0) {
    super(color, intensity);
    this.type = 'PointLight';
    this.range = range;
  }
}

export class SpotLight extends Light {
  target = new Vector3();
  /** Outer cone half angle (radians). */
  angle = Math.PI / 5;
  /** 0 = hard edge, 1 = fully soft. */
  penumbra = 0.3;
  range: number;
  constructor(color: number | string | Color = 0xffffff, intensity = 50, range = 0) {
    super(color, intensity);
    this.type = 'SpotLight';
    this.range = range;
  }
}
