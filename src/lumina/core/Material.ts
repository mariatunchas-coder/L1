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

  // ── Lumina 3: dispersion + parallax occlusion mapping ──
  dispersion?: number;
  heightMap?: Texture | null;
  parallaxScale?: number;
  parallaxMinSteps?: number;
  parallaxMaxSteps?: number;
  parallaxSelfShadow?: number;
  parallaxAO?: number;
  /** 0 … 1 – how much of the height-field normal is blended (RNM) into the normal map (0 = normal map only). */
  parallaxNormalBlend?: number;
  /** Local-light (point / spot) parallax self-shadowing. */
  parallaxLocalShadow?: boolean;

  // ── Lumina 4: detail maps, surface layers, decals ──
  detailMap?: Texture | null;
  detailScale?: number;
  detailNormalScale?: number;
  detailRoughness?: number;
  detailDistance?: number;
  wetness?: number;
  dust?: number;
  dustColor?: number | string | Color;
  layerScale?: number;
  receiveDecals?: boolean;
  layers?: boolean;
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
 *  - **dispersion**   – chromatic splitting of the refracted image (KHR_materials_dispersion, prisms, crystal, diamond)
 *  - **heightMap**    – Parallax Occlusion Mapping: true per-pixel relief with self-shadowing and cavity occlusion
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

  /**
   * Chromatic dispersion of refraction (KHR_materials_dispersion: 20 / Abbe number).
   * Crown glass ≈ 0.3, flint ≈ 0.7, diamond ≈ 0.4 – larger values are an artistic exaggeration. Needs `transmission > 0`.
   */
  dispersion = 0;
  /**
   * Height field (R channel, 1 = top of the relief, 0 = deepest) that enables Parallax Occlusion Mapping.
   * Without a `normalMap` the shading normal is derived from the height field as well.
   */
  heightMap: Texture | null = null;
  /** Relief depth in metres (distance between the top surface and the deepest point). */
  parallaxScale = 0.05;
  /** Ray-march layer count at perpendicular / grazing view (clamped to 4 … 64, scaled by the renderer's parallax quality). */
  parallaxMinSteps = 10;
  parallaxMaxSteps = 40;
  /** 0 … 1 – self shadowing of the relief toward the sun (soft, height-field ray march). */
  parallaxSelfShadow = 1;
  /** 0 … 1 – darkens the bottoms of grooves / mortar joints (cavity occlusion from the ray depth). */
  parallaxAO = 0.5;
  /**
   * Height-field normal ⊕ normal map (Reoriented Normal Mapping). Procedural sets derive their normal map from the same
   * height field, so the default 0.5 keeps the combined slope close to the authored one; 0 restores "normal map only".
   */
  parallaxNormalBlend = 0.5;
  /** Parallax self-shadowing toward the nearest point / spot lights (not only the sun). */
  parallaxLocalShadow = true;

  /**
   * Detail map (tiling micro texture, see `createDetailMap()`): R,G = tangent normal, B = roughness variation, A = grime mask.
   * It is repeated `detailScale` times over the base uv and fades out with distance (`detailDistance`, metres).
   */
  detailMap: Texture | null = null;
  detailScale = 14;
  detailNormalScale = 0.7;
  /** ± roughness modulation (fingerprints, micro scratches). */
  detailRoughness = 0.3;
  detailDistance = 24;
  /** 0 … 1 – water film: darkens the albedo, lowers roughness, fills cavities first. */
  wetness = 0;
  /** 0 … 1 – dust settled on up-facing surfaces (rougher, lighter, matte). */
  dust = 0;
  dustColor = new Color(0.55, 0.47, 0.37);
  /** Spatial frequency (1/m) of the wetness / dust patch noise. */
  layerScale = 0.8;
  /** Whether scene decals are projected onto this material. */
  receiveDecals = true;
  /** Always compile the wet / dust layer code (so `wetness` / `dust` can be animated from 0 without a shader switch). */
  layers = false;

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
    if (p.dispersion !== undefined) this.dispersion = p.dispersion;
    if (p.heightMap !== undefined) this.heightMap = p.heightMap;
    if (p.parallaxScale !== undefined) this.parallaxScale = p.parallaxScale;
    if (p.parallaxMinSteps !== undefined) this.parallaxMinSteps = p.parallaxMinSteps;
    if (p.parallaxMaxSteps !== undefined) this.parallaxMaxSteps = p.parallaxMaxSteps;
    if (p.parallaxSelfShadow !== undefined) this.parallaxSelfShadow = p.parallaxSelfShadow;
    if (p.parallaxAO !== undefined) this.parallaxAO = p.parallaxAO;
    if (p.parallaxNormalBlend !== undefined) this.parallaxNormalBlend = p.parallaxNormalBlend;
    if (p.parallaxLocalShadow !== undefined) this.parallaxLocalShadow = p.parallaxLocalShadow;
    if (p.detailMap !== undefined) this.detailMap = p.detailMap;
    if (p.detailScale !== undefined) this.detailScale = p.detailScale;
    if (p.detailNormalScale !== undefined) this.detailNormalScale = p.detailNormalScale;
    if (p.detailRoughness !== undefined) this.detailRoughness = p.detailRoughness;
    if (p.detailDistance !== undefined) this.detailDistance = p.detailDistance;
    if (p.wetness !== undefined) this.wetness = p.wetness;
    if (p.dust !== undefined) this.dust = p.dust;
    if (p.dustColor !== undefined) this.dustColor.set(p.dustColor as Color);
    if (p.layerScale !== undefined) this.layerScale = p.layerScale;
    if (p.receiveDecals !== undefined) this.receiveDecals = p.receiveDecals;
    if (p.layers !== undefined) this.layers = p.layers;
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
