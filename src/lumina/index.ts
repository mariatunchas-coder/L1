/**
 * Lumina – a performance-first, physically based WebGL2 rendering engine.
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
export { Material, PBRMaterial, UnlitMaterial, FrontSide, BackSide, DoubleSide } from './core/Material';
export type { PBRMaterialParams } from './core/Material';
export { Texture } from './core/Texture';
export { Light, DirectionalLight, PointLight, SpotLight } from './core/Lights';
export type { CascadedShadowSettings } from './core/Lights';
export { Sky, Fog } from './core/Sky';
export { Raycaster } from './core/Raycaster';
export type { Intersection } from './core/Raycaster';
export { Clock } from './core/Clock';

export { BoxGeometry, RoundedBoxGeometry, SphereGeometry, PlaneGeometry, CylinderGeometry, TorusGeometry, TorusKnotGeometry } from './geometry/Primitives';
export * from './textures/Procedural';

export { Renderer } from './renderer/Renderer';
export type { RendererOptions, RenderInfo } from './renderer/Renderer';
export type { PostSettings, ToneMapping } from './renderer/PostProcessor';
export { OrbitControls } from './controls/OrbitControls';
