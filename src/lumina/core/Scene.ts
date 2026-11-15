import type { Color } from '../math/Color';
import { Object3D } from './Object3D';
import type { Fog, Sky } from './Sky';

export class Scene extends Object3D {
  /** Physically based sky – provides background, image based lighting and fog colour. */
  sky: Sky | null = null;
  /** Solid clear colour (linear) used when there is no sky. */
  background: Color | null = null;
  fog: Fog | null = null;
  /** Scales both diffuse and specular image based lighting. */
  environmentIntensity = 1;

  constructor() {
    super();
    this.type = 'Scene';
    this.isScene = true;
  }
}
