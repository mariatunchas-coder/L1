/**
 * Lumina – a performance-first, physically based WebGL2 rendering engine.
 *
 * Lumina 4: world-space radiance cache + multi-bounce SSGI, PCSS soft shadows, spot / point light shadow atlas,
 * local-light volumetric god rays, histogram eye adaptation, detail maps, wet / dust layers, projected decals,
 * normal-map ⊕ parallax blending (RNM), arc-length UVs, automatic mobile optimisation.
 * Features: PBR + IBL (sheen, anisotropy, iridescence, subsurface, refraction/transmission with dispersion, water),
 * parallax occlusion mapping, screen-space global illumination (SSGI),
 * cascaded + contact shadows, SSAO, SSR, TAA, DoF, motion blur, volumetric fog, procedural clouds,
 * bloom + lens flare, AgX / ACES tone mapping, CDL grading, auto exposure, glTF 2.0 loader,
 * animation, LOD, GPU instancing, static batching, adaptive quality, GPU timing.
 *
 *   import { Renderer, Scene, PerspectiveCamera, Mesh, SphereGeometry, PBRMaterial } from './lumina';
 */
export * from './math/MathUtils';
export { Vector2, Vector3 } from './math/Vector3';
export { Matrix3, Matrix4 } from './math/Matrix4';
export { Quaternion, Euler } from './math/Quaternion';
export { Color, srgbToLinear, linearToSrgb } from './math/Color';
export { Box3, Sphere, Frustum, Ray } from './math/Bounds';

export { Object3D } from './core/Object3D';
export { Scene } from './core/Scene';
export { PerspectiveCamera } from './core/Camera';
export { Mesh, InstancedMesh } from './core/Mesh';
export { Geometry, BufferAttribute } from './core/Geometry';
export { Material, PBRMaterial, WaterMaterial, UnlitMaterial, FrontSide, BackSide, DoubleSide } from './core/Material';
export type { PBRMaterialParams } from './core/Material';
export { Texture } from './core/Texture';
export { Light, DirectionalLight, PointLight, SpotLight } from './core/Lights';
export { Decal, DECAL_KINDS } from './core/Decal';
export type { DecalKind } from './core/Decal';
export type { CascadedShadowSettings } from './core/Lights';
export { Sky, Fog } from './core/Sky';
export { Raycaster } from './core/Raycaster';
export type { Intersection } from './core/Raycaster';
export { Clock } from './core/Clock';
export { LOD } from './core/LOD';

export { AnimationClip, AnimationAction, AnimationMixer, KeyframeTrack } from './animation/Animation';
export type { Interpolation, TrackProperty, LoopMode } from './animation/Animation';
export { GLTFLoader } from './loaders/GLTFLoader';
export type { GLTFResult, GLTFLoaderOptions } from './loaders/GLTFLoader';

export { BoxGeometry, RoundedBoxGeometry, SphereGeometry, PlaneGeometry, CylinderGeometry, TorusGeometry, TorusKnotGeometry } from './geometry/Primitives';
export * from './textures/Procedural';

export { Renderer } from './renderer/Renderer';
export type { RendererOptions, RenderInfo } from './renderer/Renderer';
export { defaultPostSettings } from './renderer/PostProcessor';
export type { PostSettings, ToneMapping } from './renderer/PostProcessor';
export { OrbitControls } from './controls/OrbitControls';
export { applyQuality, applyDeviceQuality, AdaptiveQuality, QUALITY_LEVELS } from './quality/Quality';
export { detectDevice } from './quality/Device';
export type { DeviceProfile } from './quality/Device';
export { createDetailMap } from './textures/Detail';
export type { LocalShadowSettings } from './renderer/LocalShadows';
export type { QualityLevel } from './quality/Quality';
export { mergeGeometries } from './util/Merge';
export type { MergeItem } from './util/Merge';
