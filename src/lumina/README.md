# Lumina X

Lumina X is the "studio" release: the engine now ships a full **atmosphere + weather + city toolkit** and the demo is a
1.15 km procedural city that is drawn from **~1 000 unique triangles** (≈ 60 000 with every instance counted) – windows,
curbs, lane markings and lit rooms are textures + parallax relief, not geometry.

| Feature | What it does | Switch |
| --- | --- | --- |
| **Volumetric Fog X** | Half-res ray march with animated 3D fbm density (wind-driven wisps), separate ground-mist layer, sun god rays through the shadow cascades with an analytic sun-column transmittance, **multiple scattering** (Wrenninge octaves), sky **ambient in-scattering** (`Sky.getAmbient()`), point / spot light shafts with fog-attenuated phase, quadratic step distribution (dense near the camera), per-frame jitter + **temporal accumulation** (reprojection + 3×3 neighbourhood clamp) + depth-aware blur | `post.volumetricFog.{noise, noiseScale, windX/Z, multiScatter, mistDensity, mistFalloff, ambient, albedo, temporal, stepExponent}` |
| **Screen-space rain** | Three parallax layers of streaks that are lit by what is behind them (scene + bloom of lamps): glow in light cones, vanish in the dark | `post.rain` |
| **Global weather** | `renderer.weather.wetness` wets every material with `weatherResponse > 0` (cavities / puddles first, darker + glossier) | `renderer.weather.wetness`, `material.weatherResponse` |
| **TimeOfDay** | Real solar position from clock + latitude + day of year, drives Sky + sun/moon, exposes `night` / `lamps` factors; re-bakes the IBL only when the sun moved > `minRebakeDegrees` | `new TimeOfDay(sky, sun)` |
| **FlyControls / CameraPath** | WASD + mouse-look free flight (damped, ground clamp) and an arc-length Catmull-Rom cinematic rail with look-ahead and per-key fov | `FlyControls`, `CameraPath` |
| **Urban textures** | `createFacade('concrete' \| 'glass')` (recessed windows, frames, mullions, sills, blinds, curtains, per-window lighting as emissive map, roof-membrane patch), `createRoadTile()` (asphalt wear, wheel tracks, lane lines, zebra crossings, manholes, curbs as relief, paving), `createLeaves()` | `FACADE`, `ROAD` constants |
| **Lean architecture** | `createBuildingGeometry` (tiers, uvs in metres of the facade tile → windows keep their size on every face), `createCarGeometry` (~150 tris), `createLampGeometry`, `createTreeGeometry` | `makeRng(seed)` |

Removed: the automatic mobile / GPU detection (`quality/Device.ts`). Nothing is lowered behind your back; quality presets are plain `Settings` patches you can see and edit.

## Demo (`src/demo`)

* `city.ts` – 12 × 12 blocks, **one ground quad** (road tile with parallax curbs), 17 building variants instanced per 3 × 3-block chunk (frustum culling), parked cars, 576 street lamps, parks, 220 projected decals (puddles grow with the wetness), a pool of 20 spot lights that always sits on the lamps nearest to the camera (cones show up as god rays in the fog), cinematic rail computed from the street grid.
* `world.ts` – renderer, TimeOfDay, three camera modes (rail / fly / orbit), `apply(settings)` mapping every control to the engine.
* `settings.ts` – all settings, atmosphere presets (Golden Hour, Siang Cerah, Fajar Berkabut, Blue Hour, Malam Hujan Neon, Badai Sore), quality presets. A configuration can be shared with `?s={"hour":22,"rain":true}`; `?lite` builds a small 6 × 6 city with small textures.

```ts
import { Renderer, Scene, Sky, DirectionalLight, TimeOfDay, FlyControls } from './lumina';

const tod = new TimeOfDay(scene.sky!, sun);  tod.hour = 18.4;  tod.latitude = 35;
renderer.post.volumetricFog.enabled = true;
renderer.post.volumetricFog.noise = 0.5;          // drifting wisps
renderer.post.volumetricFog.mistDensity = 0.003;  // ground mist
renderer.post.rain.enabled = true;
renderer.weather.wetness = 0.8;                   // materials with weatherResponse > 0
loop: tod.update(dt); renderer.render(scene, camera);
```

Limits: fog history is reprojected at the surface / far point of each ray (fast camera cuts need `renderer.resetTemporal()`); rain is a screen-space layer (no 3D drops or splashes); the radiance cache and SSGI only know what the camera has seen; the city tile repeats every 96 m (variation comes from instances, decals and the world-space wet / dust noise).

---

# Lumina Uber

Uber is the "studio" release: more of the Unreal-Engine-5 toolbox, and a demo that no longer needs hundreds of thousands of triangles.

| Feature | What it does | Switch |
| --- | --- | --- |
| **GTAO** | Ground-truth horizon-based AO (Jimenez 2016): 4 slices × 2×7 depth taps per half-res pixel, analytic cosine-weighted visibility, distance falloff, the existing depth-aware blur. Replaces hemisphere SSAO (still available) | `post.ssao.gtao`, `ssao.radius / intensity / power` |
| **Sphere area lights** | `PointLight.radius` / `SpotLight.radius` – diffuse from the centre, specular from the closest point of the sphere to the reflection ray (Karis 2013), widened lobe and (a/a')² energy normalisation, near-field clamp | `light.radius` (m) |
| **Auto-LOD (Nanite-style budget)** | `simplifyGeometry(geo, ratio)` / `simplifyGeometryEx` / `createLODFromMesh(mesh)`: quadric-error vertex clustering – QEM-placed vertices, UV seams and hard edges preserved, all float attributes averaged, triangle target found by bisection (e.g. 16 128 → 820 for ratio 0.05, bounding box intact). Distances scale with the bounding sphere | `createLODFromMesh(mesh, [{ ratio, distance }])` |
| **Snow layer** | Settles on up-facing surfaces and in relief cavities (uses the POM depth), patchy noise, white / matte / soft normal, removes the wet film under it | `material.snow` |
| **Night sky** | Footprint-aware procedural stars (3 layers), Milky Way band, full moon with maria; `DirectionalLight.syncWithSky()` hands the key light to a cool moonlight after sunset | `sky.stars`, `sky.moonLight` |
| **Film halation / lens dirt** | Warm bloom bleed around highlights; procedural smudges and dust specks that light up near bright sources (screen-fixed) | `post.halation`, `post.lensDirt` |

Removed: the automatic mobile / GPU-class detection (`detectDevice`, `renderer.device`, `applyDeviceQuality`). Defaults are fixed (MSAA 4×, pixel-ratio cap 2) and nothing is lowered behind your back. `AdaptiveQuality` and `renderer.dynamicResolution` remain as *opt-in* tools and are off by default.

Demo: the scene is now ~74 k authored triangles (it was several hundred thousand plus up to 200 000 instanced rounded boxes); surface detail comes from parallax relief, detail maps and decals, distant detail from automatic LODs.

```ts
import { createLODFromMesh, PointLight } from './lumina';

const lamp = new PointLight(0xffd9a0, 120, 20);
lamp.radius = 0.3;                              // soft, round highlights on glossy surfaces

const hero = createLODFromMesh(new Mesh(new SphereGeometry(1.5, 96, 48), mat));   // 3 simplified levels
scene.add(hero);

renderer.post.ssao.gtao = true;
material.snow = 0.8;
sky.setSun(-30, 140);  sun.syncWithSky(sky);    // moon + stars
```

Limits: vertex clustering is a distance-LOD tool (not topology-preserving edge collapse); the moon / stars are not baked into the IBL cube; sphere lights share the light shadow atlas with point / spot lights.

---

# Lumina 4

Lumina 4 pushes the engine toward Unreal-Engine-5-style rendering inside WebGL2. Every item below is implemented,
exercised by the demo (tab **L4**) and verified headless (shader compile, zero `gl.getError()`, runtime toggling, context restore).

| UE5 concept | Lumina 4 implementation | Switch |
| --- | --- | --- |
| **Lumen surface cache / world-space GI** | `VoxelGI`: an N³ RGBA16F volume that follows the camera (snapped to cells). Visible surfaces write their lit colour, visible free space fades, hidden / off-screen voxels keep history. SSGI rays that leave the screen continue through the volume (a red wall behind the camera still tints the floor in front) | `post.ssgi.worldCache`, `worldCacheExtent / Resolution / Strength` |
| **Infinite bounce** | The GI-lit frame is kept (ping-pong) and read back by the next frame's trace (velocity-reprojected). Gain is clamped to `0.9 / intensity` so the feedback always converges | `post.ssgi.multiBounce` |
| **Virtual shadow maps / PCSS** | Blocker search through a second, comparison-free sampler (sampler object) on the cascade array; penumbra ∝ blocker→receiver distance, contact-sharp shadows; early-out when nothing blocks | `sun.shadow.pcss`, `sun.shadow.penumbra` |
| **Local-light shadows** | `LocalShadows` atlas (8 depth layers): spot = 1 layer, point = 6 cube faces, closest casters win; PCF with normal-offset + slope bias | `light.castShadow`, `renderer.localShadows` |
| **Froxel-style local light volumetrics** | `volumetricFrag` integrates up to 12 point / spot lights (inverse square, cone, HG phase, atlas shadow) → god rays from lamps | `post.volumetricFog.localLights` |
| **Micro-shadowing + horizon occlusion** | AO-driven grazing-light shadowing; specular horizon occlusion for bumpy normals | `renderer.microShadowing` |
| **Detail maps** | Tiling micro normal + roughness (fingerprints, scratches) + grime, distance faded, RNM-blended | `material.detailMap`, `createDetailMap()` |
| **Substrate-like layers** | Dust on up-facing surfaces, water film that fills cavities first (darker, glossier, flattened normals) | `material.wetness`, `dust`, `layers` |
| **Decals** | `Decal` (dirt, crack, puddle, scorch, moss, scratches; procedural atlas) evaluated *inside* the material shader → lit / shadowed / reflected like the surface. Closest 8 are used | `new Decal('crack', 3)`, `decal.placeOnSurface()`, `renderer.decalsEnabled` |
| **Physical camera / eye adaptation** | 64-bin luminance histogram (additive point scatter), centre-weighted, percentile clipping (sparks / voids ignored), EV compensation, cos⁴ optical vignette, energy-conserving bloom | `post.autoExposureMode`, `autoExposureCenterWeight`, `exposureCompensation`, `opticalVignette`, `bloom.energyConserving` |

## Fixes

* **RoundedBox / Box UVs** – bevels use *arc length*; `worldUV` makes one uv unit = the longest edge on every face, so a
  thin wall no longer stretches the texture on its sides (`new RoundedBoxGeometry(24, 6, 0.9, 0.05, 2, true)` with `uvRepeat: [27, 27]`).
  Uniform density also keeps `dFdx / dFdy` calm for the POM ray march.
* **Normal map + POM** – the height-field normal is combined with the normal map via Reoriented Normal Mapping
  (`material.parallaxNormalBlend`, default 0.5; 0 = old "normal map only" behaviour).
* **Multi-bounce SSGI** – see above.
* **Parallax self-shadow** now also works toward the 3 brightest local lights (`material.parallaxLocalShadow`).
* Lights: stale `spot` data of point lights is cleared every frame; lights are ordered shadow-casters-first, then by distance.

```ts
import { Renderer, Decal, PBRMaterial, createBricks, createDetailMap } from './lumina';

const renderer = new Renderer({ canvas });                // MSAA 4×, pixel ratio ≤ 2 (no automatic downgrades)

spot.castShadow = true;                                   // shadow atlas + god rays
renderer.post.ssgi.enabled = true;                        // multi-bounce + world cache are on by default
renderer.post.volumetricFog.enabled = true;

const wall = new PBRMaterial({ ...createBricks(), detailMap: createDetailMap(), wetness: 0.3, dust: 0.1, layers: true });
const crack = new Decal('crack', 3.4);
crack.placeOnSurface(hitPoint, hitNormal);                // projects onto any PBR surface inside the box
scene.add(crack);
```

Limits: the radiance cache is coarse (≈1 m cells by default) and only knows what the camera has seen; decals are not written to the
G-buffer (SSR / SSGI albedo ignore them); a point light with a shadow uses 6 of the 8 atlas layers; large instanced fields do not cast local-light shadows.

---

# Lumina 3

Lumina 3 adds the three "next-gen" screen-space features of modern game engines on top of Lumina 2.

| Feature | What it does | Switch |
| --- | --- | --- |
| **Screen-Space Global Illumination (SSGI)** | Lumen-style diffuse colour bleeding between objects (red wall → white floor, neon → brick). Half-res cosine-weighted rays are marched through the depth buffer and gather the radiance of the lit frame; temporal accumulation (velocity reprojection, depth-based disocclusion rejection, variance clipping) + depth/normal-aware blur + bilateral upsample × G-buffer albedo | `renderer.post.ssgi` |
| **Parallax Occlusion Mapping (POM)** | True per-pixel relief on bricks, wood, concrete, tiles: height-field ray march with binary refinement, **sun self-shadowing**, cavity AO, normal derived from the height field when no normal map is given, `textureGrad` with the undisplaced gradients (no mip seams), distance fade | `material.heightMap` + `parallaxScale`, `renderer.parallax` |
| **Screen-Space Refraction + dispersion** | Glass / glTF transmission: the refracted ray leaves the volume and is marched through the **opaque** depth snapshot (parallax-correct), lens `bend`, per-channel RGB refraction (`dispersion`, `KHR_materials_dispersion`), auto-mip anti-aliasing, rejection of objects in front of the glass, environment fallback at screen edges | `material.dispersion`, `renderer.post.refraction` |

Also new: G-buffer albedo attachment (only allocated while SSGI is on), instance colour in the G-buffer, `applyQuality()` presets and the `AdaptiveQuality` ladder know the new effects (SSGI rays/steps, parallax quality, refraction steps, SSGI off), procedural texture sets (`createBricks()`, `createWoodPlanks()`, …) now return a `heightMap`.

```ts
import { PBRMaterial, createBricks, applyQuality } from './lumina';

renderer.post.ssgi.enabled = true;
renderer.post.ssgi.intensity = 1.5;            // artistic multiplier (1 = physically scaled)
renderer.post.refraction.bend = 0.4;           // 0 = flat slab (glTF reference) … 1 = full lens

const brick = new PBRMaterial({ ...createBricks(), uvRepeat: [4, 4], parallaxScale: 0.04 });  // metres of relief
const glass = new PBRMaterial({ transmission: 1, ior: 1.52, thickness: 0.7, dispersion: 4 });
renderer.parallax.quality = 0.7;               // scales the ray-march step count
applyQuality(renderer, 'ultra', sun);
```

Notes / limits: SSGI and SSR only know what is on screen (off-screen light does not bounce – the IBL still provides it);
POM does not change silhouettes or the depth buffer; refraction is single-layer (glass does not see other glass);
`parallaxSelfShadow` applies to the sun only.

---

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
