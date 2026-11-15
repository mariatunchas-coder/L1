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

  // ── photoreal extensions ──
  sheen?: number;
  sheenColor?: number | string | Color;
  sheenRoughness?: number;
  anisotropy?: number;
  anisotropyRotation?: number;
  ior?: number;
  specularIntensity?: number;
  iridescence?: number;
  iridescenceIOR?: number;
  iridescenceThickness?: number;
  transmission?: number;
  thickness?: number;
  attenuationColor?: number | string | Color;
  attenuationDistance?: number;
  subsurface?: number;
  subsurfaceColor?: number | string | Color;
  waves?: number;
  waveScale?: number;
  waveSpeed?: number;
}

/**
 * Physically based metallic-roughness material (glTF 2.0 compatible parameters) with
 * additional lobes / layers for photographic realism:
 *
 *  - **clear-coat**   – lacquer / car paint
 *  - **sheen**        – Charlie-distribution cloth / velvet rim light
 *  - **anisotropy**   – brushed metal, hair, CDs (stretched GGX highlights, bent IBL reflection)
 *  - **iridescence**  – thin-film interference (soap bubbles, oil slicks, anodised titanium) *(analytic approximation)*
 *  - **transmission** – real refraction of the scene behind the surface (glass, liquids), roughness-blurred,
 *                       Beer–Lambert volume absorption through `thickness` / `attenuation*`
 *  - **subsurface**   – wrap-lighting approximation of translucent skin / wax / leaves
 *  - **waves**        – animated procedural water normals with depth-based absorption + shore foam
 *                       (assumes a horizontal surface; use together with `transmission = 1`)
 *
 * Radiometric units: colours are linear.
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

  /** Cloth sheen strength 0..1 (multiplies `sheenColor`). */
  sheen = 0;
  sheenColor = new Color(1, 1, 1);
  sheenRoughness = 0.5;
  /** −1 … 1. 0 = isotropic. Positive stretches highlights along the bitangent, negative along the tangent. */
  anisotropy = 0;
  /** Rotation of the anisotropy direction in the tangent plane (radians). */
  anisotropyRotation = 0;
  /** Index of refraction. Sets dielectric F0 = ((ior−1)/(ior+1))² and the refraction angle of `transmission`. */
  ior = 1.5;
  /** Scales dielectric specular reflectance (KHR_materials_specular). */
  specularIntensity = 1;
  /** Thin-film strength 0..1. */
  iridescence = 0;
  iridescenceIOR = 1.3;
  /** Film thickness in nanometres (≈100 – 800 produces the visible colour bands). */
  iridescenceThickness = 400;
  /** 0..1 – fraction of light refracted through the surface instead of diffused. */
  transmission = 0;
  /** Volume thickness in local units (scaled by the mesh's world scale). 0 = infinitely thin surface. */
  thickness = 0;
  /** Colour the light has after travelling `attenuationDistance` through the volume. */
  attenuationColor = new Color(1, 1, 1);
  /** Metres. `Infinity` = no absorption. */
  attenuationDistance = Infinity;
  /** 0..1 – wrap lighting for translucent organic materials. */
  subsurface = 0;
  subsurfaceColor = new Color(1, 0.35, 0.25);
  /** Water: amplitude of the procedural wave normals. 0 = off. Typical 0.01 – 0.08. */
  waves = 0;
  /** Water: spatial frequency multiplier. */
  waveScale = 1;
  /** Water: animation speed multiplier. */
  waveSpeed = 1;

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
    if (p.sheen !== undefined) this.sheen = p.sheen;
    if (p.sheenColor !== undefined) this.sheenColor.set(p.sheenColor as Color);
    if (p.sheenRoughness !== undefined) this.sheenRoughness = p.sheenRoughness;
    if (p.anisotropy !== undefined) this.anisotropy = p.anisotropy;
    if (p.anisotropyRotation !== undefined) this.anisotropyRotation = p.anisotropyRotation;
    if (p.ior !== undefined) this.ior = p.ior;
    if (p.specularIntensity !== undefined) this.specularIntensity = p.specularIntensity;
    if (p.iridescence !== undefined) this.iridescence = p.iridescence;
    if (p.iridescenceIOR !== undefined) this.iridescenceIOR = p.iridescenceIOR;
    if (p.iridescenceThickness !== undefined) this.iridescenceThickness = p.iridescenceThickness;
    if (p.transmission !== undefined) this.transmission = p.transmission;
    if (p.thickness !== undefined) this.thickness = p.thickness;
    if (p.attenuationColor !== undefined) this.attenuationColor.set(p.attenuationColor as Color);
    if (p.attenuationDistance !== undefined) this.attenuationDistance = p.attenuationDistance;
    if (p.subsurface !== undefined) this.subsurface = p.subsurface;
    if (p.subsurfaceColor !== undefined) this.subsurfaceColor.set(p.subsurfaceColor as Color);
    if (p.waves !== undefined) this.waves = p.waves;
    if (p.waveScale !== undefined) this.waveScale = p.waveScale;
    if (p.waveSpeed !== undefined) this.waveSpeed = p.waveSpeed;
  }

  /** True when the material refracts the scene behind it (drawn after the opaque pass). */
  get isTransmissive(): boolean {
    return !this.transparent && (this.transmission > 0 || this.waves > 0);
  }
}

/**
 * Ready-made water surface: refractive (IOR 1.333), animated wave normals, depth-based
 * colour absorption and shore foam. Put it on a horizontal plane slightly above the pool floor.
 */
export class WaterMaterial extends PBRMaterial {
  constructor(p: PBRMaterialParams = {}) {
    super({
      color: 0xffffff,
      roughness: 0.03,
      metalness: 0,
      ior: 1.333,
      transmission: 1,
      waves: 0.035,
      waveScale: 1,
      waveSpeed: 1,
      attenuationColor: new Color(0.12, 0.45, 0.5),
      attenuationDistance: 2.2,
      envMapIntensity: 1,
      name: 'Water',
      ...p,
    });
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
