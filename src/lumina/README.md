# Lumina 2

Performance-first, physically based **WebGL2** rendering engine (TypeScript, zero runtime dependencies) – now with
photographic material layers, real refraction, water, procedural clouds and a cinematic post stack.

## What's new in Lumina 2

| Area | Feature |
| --- | --- |
| Materials | **Sheen** (Charlie, velvet) · **anisotropy** (stretched GGX + bent IBL, brushed metal) · **iridescence** (thin-film, analytic approximation) · **subsurface** wrap lighting (wax / skin) · **IOR → F0** + `specularIntensity` |
| Refraction | **Transmission pass**: the opaque scene is resolved into a mip-chained texture, refracted by IOR, blurred by roughness, absorbed with Beer–Lambert (`thickness`, `attenuationColor/Distance`). Glass, liquids, frosted panels, bubbles |
| Water | `WaterMaterial`: dispersive wave normals, refraction, **depth-aware absorption from the real opaque depth**, shore foam, no leaking of objects in front of the water |
| Sky | Procedural **clouds** (`sky.cloudCoverage/Density/Scale/cloudOffset`): baked into the IBL, drawn analytically (razor sharp) in the background, filter the sun when overcast |
| Shadows | **Contact shadows** (`post.contactShadows`) – depth ray march toward the sun |
| Post | **AgX** tone mapper · ASC **CDL** grade · **lens flare** (thresholded ghosts + halo) · lens distortion |
| glTF | Real `KHR_materials_transmission / volume / ior / sheen / specular / iridescence / anisotropy` (factors) |
| Performance | `renderer.compile()` / `compileAsync()` shader pre-warm · `applyQuality()` presets · `AdaptiveQuality` governor (reversible ladder of savings) · `mergeGeometries()` static batching |
| Robustness | Fixed: texture counter drift after resize, dispose listeners touching dead handles after a context restore, `info.programs` ignoring G-buffer variants |

```ts
import { PBRMaterial, WaterMaterial, applyQuality, AdaptiveQuality } from './lumina';

const glass = new PBRMaterial({ roughness: 0.02, transmission: 1, ior: 1.5, thickness: 1.2, attenuationColor: 0x99ddcc, attenuationDistance: 6 });
const velvet = new PBRMaterial({ color: 0x440008, roughness: 0.9, sheen: 1, sheenColor: 0xff6a80, sheenRoughness: 0.3 });
const steel = new PBRMaterial({ color: 0xe6e6ea, metalness: 1, roughness: 0.34, anisotropy: 0.9 }); // geometry.computeTangents() for stable direction
const water = new WaterMaterial({ waves: 0.04 });                                                  // on a horizontal plane

scene.sky.cloudCoverage = 0.45; scene.sky.touch(); sun.syncWithSky(scene.sky);
renderer.post.toneMapping = 'agx';
renderer.post.contactShadows.enabled = true;
renderer.post.lensFlare.enabled = true;

applyQuality(renderer, 'high', sun);
await renderer.compileAsync(scene);               // no hitches on first frames
const governor = new AdaptiveQuality(renderer);   // governor.enabled = true; call governor.update(dt) each frame
```

Notes: iridescence and sheen IBL are analytic approximations; water assumes a horizontal surface; refractive surfaces
do not see each other (single-layer refraction); transmissive meshes are not reflected by SSR except water.

## Lumina 1 feature overview

## Feature overview

| Area | What you get |
| --- | --- |
| Shading | Cook-Torrance GGX, height-correlated Smith, multi-scatter energy compensation, clear-coat, specular anti-aliasing |
| Lighting | Physical sky → HDR cubemap IBL, directional sun with **cascaded shadow maps**, point & spot lights (32 closest), height fog, **volumetric fog** |
| Screen space | **SSAO**, **SSR**, **TAA**, **depth of field**, **motion blur**, bloom, GPU auto exposure, ACES / Neutral / Filmic / Reinhard, grading, sharpen |
| Assets | **glTF 2.0 / GLB loader**, procedural PBR textures, instancing (200 K+ instances / draw call) |
| Animation | `AnimationMixer` (weighted blending, fades, loop modes), LINEAR / STEP / CUBICSPLINE tracks |
| Scene | Scene graph with dirty-flag matrices, frustum culling, `LOD` with hysteresis, raycasting |
| Robustness | WebGL **context-loss recovery**, async shader compilation, asynchronous **GPU timer**, `renderer.screenshot()` |

## Quick start

```ts
import { Renderer, Scene, PerspectiveCamera, Sky, DirectionalLight, GLTFLoader, AnimationMixer, OrbitControls, Clock } from './lumina';

const renderer = new Renderer({ canvas, samples: 0 });
renderer.setSize(innerWidth, innerHeight);
renderer.post.taa.enabled = true;   // temporal AA (turn MSAA off to save bandwidth)
renderer.post.ssr.enabled = true;   // screen-space reflections

const scene = new Scene();
scene.sky = new Sky();
const sun = new DirectionalLight();
sun.syncWithSky(scene.sky);
scene.add(sun);

const camera = new PerspectiveCamera(45, 1, 0.1, 500);
const controls = new OrbitControls(camera, canvas);

const gltf = await new GLTFLoader().load('model.glb');
scene.add(gltf.scene);
controls.frameBounds(gltf.bounds.center, gltf.bounds.radius);

const mixer = new AnimationMixer();
if (gltf.animations[0]) mixer.clipAction(gltf.animations[0]).play();

const clock = new Clock();
(function loop() {
  requestAnimationFrame(loop);
  const dt = clock.getDelta();
  mixer.update(dt);
  controls.update(dt);
  renderer.render(scene, camera);
})();
```

## Render pipeline

```
shadow cascades → G-buffer pre-pass (depth · velocity · normal · F0/roughness)
  → SSAO → main HDR pass (MSAA) → resolve
  → SSR → TAA → DoF → motion blur → bloom → composite (fog, tone map, grade, sharpen)
```

The G-buffer pre-pass is only drawn when TAA, SSR or motion blur is enabled; a plain depth pre-pass is used
for SSAO / DoF / volumetric fog alone, and nothing extra is drawn when none of them is on.

## TAA notes

* The projection matrix is jittered with a 16-point Halton sequence; the `camera` object is never modified, so
  raycasting and controls are unaffected.
* Per-object motion vectors come from each mesh's previous world matrix (`Mesh.prevMatrixWorld`). Instanced meshes
  are assumed static relative to their own transform.
* Call `renderer.resetTemporal()` after teleporting / cutting the camera to avoid a ghost frame.

## SSR notes

* Rays are marched in screen space at half resolution (adaptive steps + 6-step binary refinement), then blurred
  depth-aware. Where a ray hits, the traced radiance **replaces** the environment specular (it is not added on
  top), so reflections stay energy-conserving.
* Only opaque geometry is reflected. Surfaces rougher than `ssr.maxRoughness` fall back to IBL.

## glTF support

Supported: `.gltf` + external/embedded buffers, `.glb`, sparse / interleaved / normalized accessors, triangle
lists / strips / fans, metallic-roughness PBR (occlusion + metal/rough textures are repacked into one ORM map),
`KHR_materials_unlit`, `_clearcoat`, `_emissive_strength`, `_transmission` (approximated as transparency), `_ior`,
`KHR_texture_transform` (offset + scale), `KHR_lights_punctual`, cameras, node hierarchy, TRS animation.

Not supported (reported in `result.warnings`): skinning and morph targets (drawn in bind pose), Draco / Meshopt /
KTX2 compression (throws a descriptive error), vertex colours, second UV set, texture-transform rotation.

`loader.loadFiles(fileList)` loads a `.gltf` together with its `.bin` and textures from a file picker or drag & drop.

## Testing checklist used for this release

* Typecheck (`tsc --noEmit`, strict + noUnused*) and production build.
* Headless Chromium (SwiftShader WebGL2): all shaders compile & link, zero `gl.getError()` after rendering with every
  effect enabled, glTF round-trip with an in-memory GLB (embedded PNG, extensions, animation), context loss/restore.
