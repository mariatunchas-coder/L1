import { Color } from '../math/Color';
import type { Texture } from './Texture';

export const FrontSide = 0;
export const BackSide = 1;
export const DoubleSide = 2;
export type Side = 0 | 1 | 2;

let _matId = 1;

export abstract class Material {
  readonly id = _matId++;
  abstract readonly kind: 'pbr' | 'unlit';
  name = '';
  side: Side = FrontSide;
  /** Enables premultiplied-alpha blending, sorted back-to-front, no depth write. */
  transparent = false;
  opacity = 1;
  /** Fragments with alpha below this value are discarded (cut-outs, foliage…). 0 = off. */
  alphaTest = 0;
  depthWrite = true;
  depthTest = true;
  visible = true;
  /** Additive blending (fire, glow sprites …) – requires transparent = true. */
  additive = false;
}

export interface PBRMaterialParams {
  color?: number | string | Color;
  metalness?: number;
  roughness?: number;
  emissive?: number | string | Color;
  emissiveIntensity?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  map?: Texture | null;
  normalMap?: Texture | null;
  ormMap?: Texture | null;
  emissiveMap?: Texture | null;
  normalScale?: number;
  opacity?: number;
  transparent?: boolean;
  side?: Side;
  alphaTest?: number;
  envMapIntensity?: number;
  uvRepeat?: [number, number];
  name?: string;
}

/**
 * Physically based metallic-roughness material (glTF 2.0 compatible parameters) with
 * an additional clear-coat lobe. Radiometric units: colours are linear.
 */
export class PBRMaterial extends Material {
  readonly kind = 'pbr' as const;
  color = new Color(1, 1, 1);
  metalness = 0;
  roughness = 0.5;
  emissive = new Color(0, 0, 0);
  emissiveIntensity = 1;
  /** Clear-coat layer strength 0..1 (car paint, lacquered wood, wet surfaces). */
  clearcoat = 0;
  clearcoatRoughness = 0.04;
  map: Texture | null = null;
  normalMap: Texture | null = null;
  /** glTF packed texture: R = ambient occlusion, G = roughness, B = metalness. */
  ormMap: Texture | null = null;
  emissiveMap: Texture | null = null;
  normalScale = 1;
  envMapIntensity = 1;
  aoMapIntensity = 1;
  /** [repeatU, repeatV, offsetU, offsetV] */
  uvTransform: [number, number, number, number] = [1, 1, 0, 0];

  constructor(p: PBRMaterialParams = {}) {
    super();
    if (p.color !== undefined) this.color.set(p.color as Color);
    if (p.emissive !== undefined) this.emissive.set(p.emissive as Color);
    if (p.metalness !== undefined) this.metalness = p.metalness;
    if (p.roughness !== undefined) this.roughness = p.roughness;
    if (p.emissiveIntensity !== undefined) this.emissiveIntensity = p.emissiveIntensity;
    if (p.clearcoat !== undefined) this.clearcoat = p.clearcoat;
    if (p.clearcoatRoughness !== undefined) this.clearcoatRoughness = p.clearcoatRoughness;
    if (p.map !== undefined) this.map = p.map;
    if (p.normalMap !== undefined) this.normalMap = p.normalMap;
    if (p.ormMap !== undefined) this.ormMap = p.ormMap;
    if (p.emissiveMap !== undefined) this.emissiveMap = p.emissiveMap;
    if (p.normalScale !== undefined) this.normalScale = p.normalScale;
    if (p.opacity !== undefined) this.opacity = p.opacity;
    if (p.transparent !== undefined) this.transparent = p.transparent;
    if (p.side !== undefined) this.side = p.side;
    if (p.alphaTest !== undefined) this.alphaTest = p.alphaTest;
    if (p.envMapIntensity !== undefined) this.envMapIntensity = p.envMapIntensity;
    if (p.uvRepeat) this.uvTransform = [p.uvRepeat[0], p.uvRepeat[1], 0, 0];
    if (p.name) this.name = p.name;
  }
}

/** Flat, unlit colour (gizmos, light bulbs…). Output is HDR so it can drive bloom. */
export class UnlitMaterial extends Material {
  readonly kind = 'unlit' as const;
  color = new Color(1, 1, 1);
  intensity = 1;
  map: Texture | null = null;
  constructor(p: { color?: number | string | Color; intensity?: number; opacity?: number; transparent?: boolean } = {}) {
    super();
    if (p.color !== undefined) this.color.set(p.color as Color);
    if (p.intensity !== undefined) this.intensity = p.intensity;
    if (p.opacity !== undefined) this.opacity = p.opacity;
    if (p.transparent !== undefined) this.transparent = p.transparent;
  }
}
