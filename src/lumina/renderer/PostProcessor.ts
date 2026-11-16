import type { PerspectiveCamera } from '../core/Camera';
import { Vector3 } from '../math/Vector3';
import { GLState, TEX_2D, TEX_2D_ARRAY, TEX_3D } from './GLState';
import { VoxelGI } from './VoxelGI';
import { Program } from './Program';
import { ColorTarget, GBufferTarget, createColorTarget, deleteColorTarget } from './RenderTarget';
import { fullscreenVert } from './shaders/ibl';
import { adaptFrag, bloomDownFrag, bloomUpFrag, compositeFrag, histAdaptFrag, histFrag, histVert, lensFlareFrag, lumFrag, gtaoFrag, ssaoBlurFrag, ssaoFrag } from './shaders/post';
import { volumetricBlurFrag, volumetricFrag, volumetricTemporalFrag } from './shaders/volumetric';
import { dofFrag, motionBlurFrag, ssgiApplyFrag, ssgiBlurFrag, ssgiTemporalFrag, ssgiTraceFrag, ssrApplyFrag, ssrTraceFrag, taaFrag } from './shaders/effects';
import { TEX_CUBE } from './GLState';

export type ToneMapping = 'none' | 'reinhard' | 'aces' | 'neutral' | 'filmic' | 'agx';

export interface PostSettings {
  exposure: number;
  autoExposure: boolean;
  /** Target middle-grey (scene-referred) the auto exposure aims at. */
  autoExposureKey: number;
  autoExposureMin: number;
  autoExposureMax: number;
  /** 'histogram' = 64-bin luminance histogram with percentile clipping (ignores sparks and voids); 'average' = log-average. */
  autoExposureMode: 'histogram' | 'average';
  /** 0 … 1 – centre-weighted metering (0 = whole frame). */
  autoExposureCenterWeight: number;
  /** Histogram percentiles (0 … 1) between which the luminance is averaged. */
  autoExposureLowPercent: number;
  autoExposureHighPercent: number;
  /** Exposure compensation in stops (EV). */
  exposureCompensation: number;
  /** Natural cos⁴ light fall-off of a real lens (0 = off, 1 = full). */
  opticalVignette: number;
  adaptSpeedUp: number;
  adaptSpeedDown: number;
  toneMapping: ToneMapping;
  bloom: { enabled: boolean; intensity: number; threshold: number; knee: number; radius: number; /** physically plausible: bloom redistributes energy instead of adding it */ energyConserving: boolean };
  /** gtao: ground-truth horizon-based AO (default); false = legacy hemisphere SSAO. */
  ssao: { enabled: boolean; radius: number; intensity: number; power: number; bias: number; gtao: boolean };
  vignette: number;
  grain: number;
  saturation: number;
  contrast: number;
  chromaticAberration: number;
  /** Unsharp-mask strength applied in the final pass (0 = off) – counters TAA softness. */
  sharpen: number;
  /** White balance: -1 cool … +1 warm. */
  temperature: number;
  /** Barrel (+) / pincushion (−) lens distortion, typical ±0.15. */
  lensDistortion: number;
  /** Film halation: bright highlights bleed a warm red-orange glow (light scattering inside the film base). 0 = off. */
  halation: number;
  /** Dust / smudges on the lens light up around bright sources (modulates the bloom). 0 = off. */
  lensDirt: number;
  /** ASC CDL colour grade applied in display space (slope · offset · power per channel). */
  cdl: { enabled: boolean; slope: [number, number, number]; offset: [number, number, number]; power: [number, number, number] };
  /** Screen-space lens flare (ghosts + halo) driven by the bloom threshold. */
  lensFlare: { enabled: boolean; intensity: number; threshold: number; ghosts: number; dispersal: number; halo: number; chromatic: number };
  /** Short sun-direction depth ray march that grounds small objects (complements cascaded shadows). */
  contactShadows: { enabled: boolean; length: number; thickness: number; strength: number };
  /** Temporal anti-aliasing (sub-pixel jitter + motion-vector reprojection + variance clipping). */
  taa: {
    enabled: boolean;
    /** Weight of the accumulated history (0.8 – 0.97). Higher = smoother but more ghosting. */
    feedback: number;
    /** Jitter amplitude multiplier (1 = ±0.5 px). */
    jitter: number;
  };
  /** Screen-space reflections (needs G-buffer; replaces the environment specular where a ray hits). */
  ssr: {
    enabled: boolean;
    intensity: number;
    /** Maximum view-space ray length (m). */
    maxDistance: number;
    /** Depth thickness (m) behind a surface still counted as a hit. */
    thickness: number;
    /** Surfaces rougher than this fall back to the environment. */
    maxRoughness: number;
    /** Ray-march steps (8 – 128). */
    steps: number;
  };
  /**
   * Screen-space global illumination (Lumen-style diffuse colour bleeding). Half-resolution cosine-weighted ray march
   * through the depth buffer, gathering the radiance of the lit frame, then temporal accumulation + bilateral blur.
   * Needs the G-buffer (enables it automatically).
   */
  ssgi: {
    enabled: boolean;
    /** Strength of the bounce light (1 = physically scaled). */
    intensity: number;
    /** Maximum distance a bounce ray travels (m). */
    radius: number;
    /** Depth thickness (m) behind a surface still counted as a hit. */
    thickness: number;
    /** Rays per half-res pixel and frame (1 – 4). */
    rays: number;
    /** Ray-march steps per ray (6 – 32). */
    steps: number;
    /** Weight of the temporal history (0.8 – 0.97). */
    feedback: number;
    /** Spatial denoise radius in half-res pixels (0 = off). */
    blur: number;
    /** Firefly clamp: largest radiance a single hit may contribute. */
    maxRadiance: number;
    /** Show only the bounce light. */
    debug: boolean;
    /** Feeds the GI-lit frame back into the trace (light bounces many times: corners fill with indirect light). */
    multiBounce: boolean;
    /** World-space radiance cache: rays that leave the screen read it instead of the sky fallback. */
    worldCache: boolean;
    /** Edge length (m) of the cache volume that follows the camera. */
    worldCacheExtent: number;
    /** Voxels per axis (16 – 64, even). */
    worldCacheResolution: number;
    /** Strength of the off-screen bounce light. */
    worldCacheStrength: number;
  };
  /** Refraction of glass / liquids (`transmission > 0`). */
  refraction: {
    /** Ray-march the refracted ray through the opaque depth buffer (parallax-correct) instead of a thickness offset. */
    screenSpace: boolean;
    steps: number;
    /** Longest refracted ray (m). */
    maxDistance: number;
    /** Depth thickness (m) for a hit. */
    thickness: number;
    /** 0 = flat slab (glTF reference: the view ray only shifts) … 1 = the fully refracted ray (strong lens distortion). */
    bend: number;
  };
  /** Thin-lens depth of field. */
  dof: {
    enabled: boolean;
    /** Distance of the focal plane (m). */
    focusDistance: number;
    /** mm */
    focalLength: number;
    fStop: number;
    /** Largest circle-of-confusion radius (px, render resolution). */
    maxBlur: number;
    taps: number;
  };
  motionBlur: { enabled: boolean; intensity: number; samples: number };
  volumetricFog: {
    enabled: boolean;
    density: number;
    heightFalloff: number;
    baseHeight: number;
    /** Henyey-Greenstein anisotropy: >0 forward scattering (bright toward the sun), <0 back-scattering. */
    anisotropy: number;
    intensity: number;
    maxDistance: number;
    steps: number;
    /** Point / spot lights scatter in the fog too (god rays; shadowed when the light casts shadows). */
    localLights: boolean;
    localIntensity: number;
    /** Lumina X – amplitude of the animated 3D fbm density wisps (0 = smooth haze … 1 = strongly clumped). */
    noise: number;
    /** Lumina X – spatial frequency of the wisps (1/m). */
    noiseScale: number;
    /** Lumina X – wind drift of the wisps (m/s, x / z). */
    windX: number;
    windZ: number;
    /** Lumina X – multiple scattering 0 (single scattering) … 1 (three Wrenninge octaves). */
    multiScatter: number;
    /** Lumina X – extinction (1/m) of the ground mist layer and its exponential falloff with altitude (1/m). */
    mistDensity: number;
    mistFalloff: number;
    /** Lumina X – sky ambient in-scattering multiplier (the colour follows the sky automatically). */
    ambient: number;
    /** Lumina X – fog albedo (tints every in-scattered contribution). */
    albedo: [number, number, number];
    /** Lumina X – temporal accumulation weight 0 … 0.95 (reprojected, neighbourhood clamped). */
    temporal: number;
    /** Lumina X – ray-march step distribution: 1 = uniform, > 1 = denser near the camera. */
    stepExponent: number;
  };
  /** Lumina X – screen-space rain: three parallax layers of streaks that catch the scene's own light. */
  rain: {
    enabled: boolean;
    intensity: number;
    /** Horizontal drift of the streaks (−1 … 1). */
    wind: number;
    /** Streak length multiplier. */
    length: number;
    /** Fall speed multiplier. */
    speed: number;
  };
}

export function defaultPostSettings(): PostSettings {
  return {
    exposure: 1,
    autoExposure: true,
    autoExposureKey: 0.18,
    autoExposureMin: 0.05,
    autoExposureMax: 20,
    autoExposureMode: 'histogram',
    autoExposureCenterWeight: 0.6,
    autoExposureLowPercent: 0.1,
    autoExposureHighPercent: 0.94,
    exposureCompensation: 0,
    opticalVignette: 0,
    adaptSpeedUp: 2.5,
    adaptSpeedDown: 1.2,
    toneMapping: 'aces',
    bloom: { enabled: true, intensity: 0.12, threshold: 1.2, knee: 0.6, radius: 0.72, energyConserving: false },
    ssao: { enabled: true, radius: 0.7, intensity: 1.0, power: 1.25, bias: 0.03, gtao: true },
    vignette: 0.28,
    grain: 0.08,
    saturation: 1.06,
    contrast: 1.04,
    chromaticAberration: 0,
    sharpen: 0,
    temperature: 0,
    lensDistortion: 0,
    halation: 0,
    lensDirt: 0,
    cdl: { enabled: false, slope: [1, 1, 1], offset: [0, 0, 0], power: [1, 1, 1] },
    lensFlare: { enabled: false, intensity: 0.2, threshold: 8, ghosts: 5, dispersal: 0.32, halo: 0.42, chromatic: 0.012 },
    contactShadows: { enabled: false, length: 0.7, thickness: 0.5, strength: 0.85 },
    taa: { enabled: false, feedback: 0.9, jitter: 1 },
    ssr: { enabled: false, intensity: 1, maxDistance: 40, thickness: 0.6, maxRoughness: 0.6, steps: 64 },
    ssgi: { enabled: false, intensity: 1, radius: 6, thickness: 0.6, rays: 2, steps: 16, feedback: 0.92, blur: 3, maxRadiance: 12, debug: false, multiBounce: true, worldCache: true, worldCacheExtent: 40, worldCacheResolution: 32, worldCacheStrength: 1 },
    refraction: { screenSpace: true, steps: 24, maxDistance: 14, thickness: 1.2, bend: 0.4 },
    dof: { enabled: false, focusDistance: 12, focalLength: 50, fStop: 2.8, maxBlur: 12, taps: 28 },
    motionBlur: { enabled: false, intensity: 0.5, samples: 12 },
    volumetricFog: {
      enabled: false,
      density: 0.02,
      heightFalloff: 0.05,
      baseHeight: 0,
      anisotropy: 0.6,
      intensity: 1,
      maxDistance: 120,
      steps: 24,
      localLights: true,
      localIntensity: 1,
      noise: 0.55,
      noiseScale: 0.045,
      windX: 1.2,
      windZ: 0.6,
      multiScatter: 0.7,
      mistDensity: 0,
      mistFalloff: 0.25,
      ambient: 1,
      albedo: [1, 1, 1],
      temporal: 0.8,
      stepExponent: 1.5,
    },
    rain: { enabled: false, intensity: 0.6, wind: 0.25, length: 1, speed: 1 },
  };
}

const HIST_MIN_EV = -10;
const HIST_MAX_EV = 14;
const TONE_ID: Record<ToneMapping, number> = { none: 0, reinhard: 1, aces: 2, neutral: 3, filmic: 4, agx: 5 };

/** Screen-space effects: SSAO, bloom, auto-exposure, tone mapping & grading. */
export class PostProcessor {
  private ssaoProg: Program;
  private gtaoProg: Program;
  private ssaoBlurProg: Program;
  private bloomFirstProg: Program;
  private bloomDownProg: Program;
  private bloomUpProg: Program;
  private lumProg: Program;
  private adaptProg: Program;
  private compositeProg: Program;
  private volumetricProg: Program;
  private volumetricBlurProg: Program;
  private volumetricTemporalProg: Program;
  private fogHist: ColorTarget[] = [];
  private fogHistIdx = 0;
  private fogHistValid = false;
  private taaProg: Program;
  private ssrTraceProg: Program;
  private ssrApplyProg: Program;
  private dofProg: Program;
  private motionBlurProg: Program;
  private flareProg: Program;
  private flareRT: ColorTarget | null = null;
  private giTraceProg: Program;
  private giTemporalProg: Program;
  private giBlurProg: Program;
  private giApplyProg: Program;
  private giTrace: ColorTarget | null = null;
  private giOut: ColorTarget | null = null;
  private giHist: ColorTarget[] = [];
  private giIdx = 0;
  private giValid = false;
  /** full-resolution GI-lit frames (ping-pong): the previous one is read back by the trace → multi-bounce */
  private giFull: ColorTarget[] = [];
  private giFullIdx = 0;
  private giFullValid = false;
  private voxel: VoxelGI | null = null;
  private histProg: Program;
  private histAdaptProg: Program;
  private hist: ColorTarget;

  // lazily created full-frame targets for the G-buffer driven effects
  private fx: ColorTarget[] = [];
  private ssrA: ColorTarget | null = null;
  private ssrB: ColorTarget | null = null;
  private taaHist: ColorTarget[] = [];
  private taaIdx = 0;
  private taaValid = false;
  private aoA: ColorTarget | null = null;
  private aoB: ColorTarget | null = null;
  private fogA: ColorTarget | null = null;
  private fogB: ColorTarget | null = null;
  private down: ColorTarget[] = [];
  private up: ColorTarget[] = [];
  private lum: ColorTarget;
  private adapt: ColorTarget[];
  private adaptIndex = 0;
  private adaptFirst = true;
  private width = 0;
  private height = 0;
  private readonly lumSize = 256;

  constructor(private gl: WebGL2RenderingContext, private state: GLState) {
    const mk = (frag: string, name: string, defs: string[] = []) => new Program(gl, state, fullscreenVert, frag, defs, name).finalize();
    this.ssaoProg = mk(ssaoFrag, 'ssao');
    this.gtaoProg = mk(gtaoFrag, 'gtao');
    this.ssaoBlurProg = mk(ssaoBlurFrag, 'ssaoBlur');
    this.bloomFirstProg = mk(bloomDownFrag, 'bloomFirst', ['FIRST_PASS']);
    this.bloomDownProg = mk(bloomDownFrag, 'bloomDown');
    this.bloomUpProg = mk(bloomUpFrag, 'bloomUp');
    this.lumProg = mk(lumFrag, 'luminance');
    this.adaptProg = mk(adaptFrag, 'adapt');
    this.compositeProg = mk(compositeFrag, 'composite');
    this.volumetricProg = mk(volumetricFrag, 'volumetric');
    this.volumetricBlurProg = mk(volumetricBlurFrag, 'volumetricBlur');
    this.volumetricTemporalProg = mk(volumetricTemporalFrag, 'volumetricTemporal');
    this.taaProg = mk(taaFrag, 'taa');
    this.ssrTraceProg = mk(ssrTraceFrag, 'ssrTrace');
    this.ssrApplyProg = mk(ssrApplyFrag, 'ssrApply');
    this.dofProg = mk(dofFrag, 'dof');
    this.motionBlurProg = mk(motionBlurFrag, 'motionBlur');
    this.flareProg = mk(lensFlareFrag, 'lensFlare');
    this.giTraceProg = mk(ssgiTraceFrag, 'ssgiTrace');
    this.giTemporalProg = mk(ssgiTemporalFrag, 'ssgiTemporal');
    this.giBlurProg = mk(ssgiBlurFrag, 'ssgiBlur');
    this.giApplyProg = mk(ssgiApplyFrag, 'ssgiApply');
    this.histProg = new Program(gl, state, histVert, histFrag, [], 'histogram').finalize();
    this.histAdaptProg = mk(histAdaptFrag, 'histogramAdapt');
    this.hist = createColorTarget(gl, state, 64, 1, gl.RGBA16F, { filter: 'nearest' });
    this.lum = createColorTarget(gl, state, this.lumSize, this.lumSize, gl.RGBA16F, { mipmaps: true });
    this.adapt = [createColorTarget(gl, state, 1, 1, gl.R16F), createColorTarget(gl, state, 1, 1, gl.R16F)];
  }

  resize(w: number, h: number): void {
    if (w === this.width && h === this.height) return;
    const gl = this.gl;
    this.width = w;
    this.height = h;
    for (const t of [this.aoA, this.aoB, this.fogA, this.fogB, ...this.fogHist, this.ssrA, this.ssrB, this.flareRT, this.giTrace, this.giOut, ...this.giHist, ...this.giFull, ...this.fx, ...this.taaHist, ...this.down, ...this.up])
      deleteColorTarget(gl, this.state, t);
    this.giTrace = this.giOut = null;
    this.giHist = [];
    this.giFull = [];
    this.giFullValid = false;
    this.giValid = false;
    this.flareRT = null;
    this.fx = [];
    this.taaHist = [];
    this.ssrA = this.ssrB = null;
    this.taaValid = false;
    this.down = [];
    this.up = [];
    const aw = Math.max(1, Math.ceil(w / 2)),
      ah = Math.max(1, Math.ceil(h / 2));
    this.aoA = createColorTarget(gl, this.state, aw, ah, gl.R8);
    this.aoB = createColorTarget(gl, this.state, aw, ah, gl.R8);
    this.fogA = createColorTarget(gl, this.state, aw, ah, gl.RGBA16F);
    this.fogB = createColorTarget(gl, this.state, aw, ah, gl.RGBA16F);
    this.fogHist = [createColorTarget(gl, this.state, aw, ah, gl.RGBA16F), createColorTarget(gl, this.state, aw, ah, gl.RGBA16F)];
    this.fogHistValid = false;
    let bw = Math.max(1, w >> 1),
      bh = Math.max(1, h >> 1);
    for (let i = 0; i < 7 && bw >= 4 && bh >= 4; i++) {
      this.down.push(createColorTarget(gl, this.state, bw, bh, gl.R11F_G11F_B10F));
      bw = Math.max(1, bw >> 1);
      bh = Math.max(1, bh >> 1);
    }
    // up[i] has the same size as down[i] (the smallest level has nothing to upsample from)
    for (let i = 0; i < this.down.length - 1; i++) {
      const d = this.down[i];
      this.up.push(createColorTarget(gl, this.state, d.width, d.height, gl.R11F_G11F_B10F));
    }
    if (this.down.length > 1) this.flareRT = createColorTarget(gl, this.state, this.down[1].width, this.down[1].height, gl.R11F_G11F_B10F);
  }

  private pass(target: { fbo: WebGLFramebuffer; width: number; height: number } | null, w: number, h: number): void {
    this.state.bindFramebuffer(target ? target.fbo : null);
    this.state.setViewport(0, 0, target ? target.width : w, target ? target.height : h);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
  }

  private begin(): void {
    this.state.setDepth(false, false);
    this.state.setSide(2);
    this.state.setBlend(0);
    this.state.bindVAO(null);
  }

  /** Hemisphere SSAO at half resolution + depth-aware separable blur. Returns the AO texture. */
  renderSSAO(depthTex: WebGLTexture, camera: PerspectiveCamera, s: PostSettings['ssao'], fullW: number, fullH: number): WebGLTexture {
    const gl = this.gl;
    const a = this.aoA!,
      b = this.aoB!;
    this.begin();
    const P = camera.projectionMatrix.elements;

    const aoProg = s.gtao ? this.gtaoProg : this.ssaoProg;
    aoProg.use();
    const L = aoProg.loc;
    this.state.bindTexture(0, TEX_2D, depthTex);
    gl.uniformMatrix4fv(L.uProj, false, P);
    gl.uniform4f(L.uProjInfo, 2 / P[0], 2 / P[5], -1 / P[0], -1 / P[5]);
    gl.uniform2f(L.uNearFar, camera.near, camera.far);
    gl.uniform2f(L.uInvSize, 1 / fullW, 1 / fullH);
    gl.uniform2f(L.uInvOutSize, 1 / a.width, 1 / a.height);
    gl.uniform1f(L.uRadius, s.radius);
    gl.uniform1f(L.uBias, s.bias);
    gl.uniform1f(L.uIntensity, s.intensity);
    gl.uniform1f(L.uPower, s.power);
    this.pass(a, fullW, fullH);

    this.ssaoBlurProg.use();
    const BL = this.ssaoBlurProg.loc;
    gl.uniform2f(BL.uNearFar, camera.near, camera.far);
    this.state.bindTexture(0, TEX_2D, depthTex);
    this.state.bindTexture(1, TEX_2D, a.texture);
    gl.uniform2f(BL.uDir, 1 / a.width, 0);
    this.pass(b, fullW, fullH);
    this.state.bindTexture(1, TEX_2D, b.texture);
    gl.uniform2f(BL.uDir, 0, 1 / a.height);
    this.pass(a, fullW, fullH);
    return a.texture;
  }

  /**
   * Raymarches the sun's cascaded shadow against camera-ray depth to produce light
   * shafts, at half resolution with a depth-aware bilateral blur/upsample. Returns
   * a texture whose rgb is in-scattered light to add, and whose alpha is the
   * transmittance to multiply the scene color by (so fog can also darken distant
   * geometry, not just add haze on top of it).
   */
  renderVolumetricFog(
    depthTex: WebGLTexture,
    shadowTex: WebGLTexture,
    localShadowTex: WebGLTexture,
    camera: PerspectiveCamera,
    s: PostSettings['volumetricFog'],
    localLights: number,
    fullW: number,
    fullH: number,
    time: number,
    frame: number,
    ambient: [number, number, number],
    reset: boolean
  ): WebGLTexture {
    const gl = this.gl;
    const a = this.fogA!,
      b = this.fogB!;
    this.begin();
    const maxDist = Math.min(s.maxDistance, camera.far);

    this.volumetricProg.use();
    const L = this.volumetricProg.loc;
    this.state.bindTexture(0, TEX_2D, depthTex);
    this.state.bindTexture(3, TEX_2D_ARRAY, shadowTex);
    this.state.bindTexture(14, TEX_2D_ARRAY, localShadowTex);
    gl.uniform4f(L.uFogLocal, localLights, Math.max(0, s.localIntensity), 0, 0);
    gl.uniform2f(L.uInvOutSize, 1 / a.width, 1 / a.height);
    gl.uniform1f(L.uDensity, Math.max(0, s.density));
    gl.uniform1f(L.uHeightFalloff, Math.max(0, s.heightFalloff));
    gl.uniform1f(L.uBaseHeight, s.baseHeight);
    gl.uniform1f(L.uAnisotropy, Math.max(-0.95, Math.min(0.95, s.anisotropy)));
    gl.uniform1f(L.uIntensity, Math.max(0, s.intensity));
    gl.uniform1f(L.uMaxDistance, maxDist);
    gl.uniform1i(L.uSteps, Math.max(1, Math.min(96, Math.round(s.steps))));
    gl.uniform4f(L.uVolA, Math.max(0, Math.min(1, s.noise)), Math.max(0.001, s.noiseScale), s.windX, s.windZ);
    gl.uniform4f(L.uVolB, time % 3600, Math.max(0, Math.min(1, s.multiScatter)), Math.max(0, s.mistDensity), Math.max(0.001, s.mistFalloff));
    const am = Math.max(0, s.ambient);
    gl.uniform4f(L.uVolC, ambient[0] * am, ambient[1] * am, ambient[2] * am, frame % 64);
    gl.uniform4f(L.uVolD, s.albedo[0], s.albedo[1], s.albedo[2], Math.max(1, Math.min(3, s.stepExponent)));
    this.pass(a, fullW, fullH);

    // temporal accumulation (reprojected history, neighbourhood clamped) – result also becomes the next history
    let src: ColorTarget = a;
    if (s.temporal > 0.001 && this.fogHist.length === 2) {
      const prev = this.fogHist[this.fogHistIdx];
      const out = this.fogHist[1 - this.fogHistIdx];
      this.volumetricTemporalProg.use();
      const TL = this.volumetricTemporalProg.loc;
      this.state.bindTexture(0, TEX_2D, depthTex);
      this.state.bindTexture(1, TEX_2D, a.texture);
      this.state.bindTexture(2, TEX_2D, prev.texture);
      gl.uniform2f(TL.uInvOutSize, 1 / a.width, 1 / a.height);
      gl.uniform4f(TL.uTemporal, Math.min(0.95, s.temporal), maxDist, this.fogHistValid && !reset ? 1 : 0, 0);
      this.pass(out, fullW, fullH);
      this.fogHistIdx = 1 - this.fogHistIdx;
      this.fogHistValid = true;
      src = out;
    } else {
      this.fogHistValid = false;
    }

    this.volumetricBlurProg.use();
    const BL = this.volumetricBlurProg.loc;
    gl.uniform2f(BL.uNearFar, camera.near, camera.far);
    this.state.bindTexture(0, TEX_2D, depthTex);
    this.state.bindTexture(1, TEX_2D, src.texture);
    gl.uniform2f(BL.uDir, 1 / a.width, 0);
    this.pass(b, fullW, fullH);
    this.state.bindTexture(1, TEX_2D, b.texture);
    gl.uniform2f(BL.uDir, 0, 1 / a.height);
    this.pass(a, fullW, fullH);
    return a.texture;
  }

  /** Progressive down/up-sampling bloom (Call of Duty: Advanced Warfare style). */
  renderBloom(sceneTex: WebGLTexture, s: PostSettings['bloom'], w: number, h: number): WebGLTexture | null {
    const gl = this.gl;
    const n = this.down.length;
    if (n === 0) return null;
    this.begin();

    this.bloomFirstProg.use();
    this.state.bindTexture(0, TEX_2D, sceneTex);
    gl.uniform2f(this.bloomFirstProg.loc.uTexel, 1 / w, 1 / h);
    gl.uniform3f(this.bloomFirstProg.loc.uThreshold, s.threshold, s.knee, 0);
    this.pass(this.down[0], w, h);

    this.bloomDownProg.use();
    for (let i = 1; i < n; i++) {
      const src = this.down[i - 1];
      this.state.bindTexture(0, TEX_2D, src.texture);
      gl.uniform2f(this.bloomDownProg.loc.uTexel, 1 / src.width, 1 / src.height);
      this.pass(this.down[i], w, h);
    }

    if (n === 1) return this.down[0].texture;
    this.bloomUpProg.use();
    gl.uniform1f(this.bloomUpProg.loc.uRadius, s.radius);
    let low = this.down[n - 1];
    for (let i = n - 2; i >= 0; i--) {
      const dst = this.up[i];
      this.state.bindTexture(0, TEX_2D, low.texture);
      this.state.bindTexture(1, TEX_2D, this.down[i].texture);
      gl.uniform2f(this.bloomUpProg.loc.uTexel, 1 / low.width, 1 / low.height);
      this.pass(dst, w, h);
      low = dst;
    }
    return low.texture;
  }

  /** Lens flare from the (already built) bloom pyramid. Must run after renderBloom(). */
  renderLensFlare(s: PostSettings['lensFlare'], w: number, h: number): WebGLTexture | null {
    const gl = this.gl;
    if (!this.flareRT || this.down.length < 2) return null;
    this.begin();
    this.flareProg.use();
    this.state.bindTexture(0, TEX_2D, this.down[1].texture);
    gl.uniform4f(this.flareProg.loc.uFlare, Math.max(1, Math.min(8, Math.round(s.ghosts))), s.dispersal, s.halo, s.chromatic);
    gl.uniform1f(this.flareProg.loc.uFlareThreshold, Math.max(0.1, s.threshold));
    this.pass(this.flareRT, w, h);
    return this.flareRT.texture;
  }

  /** Measures scene luminance on the GPU and adapts exposure smoothly – no CPU read-back. */
  updateAutoExposure(sceneTex: WebGLTexture, w: number, h: number, dt: number, s: PostSettings): void {
    const gl = this.gl;
    const st = this.state;
    this.begin();
    const prev = this.adapt[this.adaptIndex];
    const next = this.adapt[1 - this.adaptIndex];
    if (s.autoExposureMode === 'histogram') {
      // 1. scatter a centre-weighted 48×48 sample grid into 64 EV bins (additive points)
      const N = 48;
      st.bindFramebuffer(this.hist.fbo);
      st.setViewport(0, 0, 64, 1);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      st.setBlend(2);
      this.histProg.use();
      st.bindTexture(0, TEX_2D, sceneTex);
      gl.uniform4f(this.histProg.loc.uHist, N, HIST_MIN_EV, HIST_MAX_EV, Math.max(0, Math.min(1, s.autoExposureCenterWeight)));
      gl.uniform2f(this.histProg.loc.uStepUv, 1 / N, 1 / N);
      gl.drawArrays(gl.POINTS, 0, N * N);
      st.setBlend(0);
      // 2. percentile-clipped average + temporal adaptation
      this.histAdaptProg.use();
      const HL = this.histAdaptProg.loc;
      st.bindTexture(0, TEX_2D, this.hist.texture);
      st.bindTexture(1, TEX_2D, prev.texture);
      gl.uniform1f(HL.uDt, dt);
      gl.uniform1f(HL.uSpeedUp, s.adaptSpeedUp);
      gl.uniform1f(HL.uSpeedDown, s.adaptSpeedDown);
      gl.uniform1f(HL.uFirst, this.adaptFirst ? 1 : 0);
      const lo = Math.max(0, Math.min(0.95, s.autoExposureLowPercent));
      gl.uniform4f(HL.uHistP, HIST_MIN_EV, HIST_MAX_EV, lo, Math.max(lo + 0.02, Math.min(1, s.autoExposureHighPercent)));
      this.pass(next, w, h);
      this.adaptIndex = 1 - this.adaptIndex;
      this.adaptFirst = false;
      return;
    }
    this.lumProg.use();
    this.state.bindTexture(0, TEX_2D, sceneTex);
    gl.uniform2f(this.lumProg.loc.uTexel, 1 / w, 1 / h);
    gl.uniform2f(this.lumProg.loc.uStep, w / (this.lumSize * 3), h / (this.lumSize * 3));
    this.pass(this.lum, w, h);
    this.state.bindScratch(TEX_2D, this.lum.texture);
    gl.generateMipmap(gl.TEXTURE_2D);

    this.adaptProg.use();
    const L = this.adaptProg.loc;
    this.state.bindTexture(0, TEX_2D, this.lum.texture);
    this.state.bindTexture(1, TEX_2D, prev.texture);
    gl.uniform1f(L.uDt, dt);
    gl.uniform1f(L.uSpeedUp, s.adaptSpeedUp);
    gl.uniform1f(L.uSpeedDown, s.adaptSpeedDown);
    gl.uniform1f(L.uFirst, this.adaptFirst ? 1 : 0);
    gl.uniform1f(L.uMaxLod, Math.log2(this.lumSize));
    this.pass(next, w, h);
    this.adaptIndex = 1 - this.adaptIndex;
    this.adaptFirst = false;
  }

  /** Drops the SSGI history (call when the effect was not rendered, or after a camera cut). */
  /** Drops the volumetric-fog history (camera cut, fog switched off). */
  resetFog(): void {
    this.fogHistValid = false;
  }

  resetGI(): void {
    this.giValid = false;
    this.giFullValid = false;
    this.voxel?.reset();
  }

  private ensureGI(): void {
    if (this.giTrace) return;
    const gl = this.gl;
    const aw = Math.max(1, Math.ceil(this.width / 2)),
      ah = Math.max(1, Math.ceil(this.height / 2));
    this.giTrace = createColorTarget(gl, this.state, aw, ah, gl.RGBA16F, { filter: 'nearest' });
    this.giOut = createColorTarget(gl, this.state, aw, ah, gl.RGBA16F, { filter: 'nearest' });
    this.giHist = [0, 1].map(() => createColorTarget(gl, this.state, aw, ah, gl.RGBA16F));
    this.giFull = [0, 1].map(() => createColorTarget(gl, this.state, this.width, this.height, gl.RGBA16F));
    this.giFullIdx = 0;
    this.giFullValid = false;
    this.giValid = false;
    if (!this.voxel) this.voxel = new VoxelGI(gl, this.state);
  }

  /**
   * Screen-space global illumination. Returns the scene colour with the diffuse bounce light added.
   * Pipeline: half-res trace → temporal accumulation (history is reprojected with the velocity buffer) →
   * depth/normal-aware blur → full-res bilateral upsample multiplied by the G-buffer albedo.
   */
  renderSSGI(sceneTex: WebGLTexture, gb: GBufferTarget, s: PostSettings['ssgi'], w: number, h: number, frame: number, forceReset: boolean, camPos: Vector3): WebGLTexture {
    const gl = this.gl;
    this.ensureGI();
    const voxel = this.voxel!;
    const useCache = s.worldCache;
    voxel.ensure(useCache ? Math.round(s.worldCacheResolution) : 4);
    // world-space radiance cache: remembers lit surfaces the camera saw (also those that are now off-screen)
    if (useCache) voxel.update(gb.texture, sceneTex, camPos, Math.max(4, s.worldCacheExtent), 0.2, Math.max(0.5, s.maxRadiance), forceReset);
    const feedback = s.multiBounce && this.giFullValid && !forceReset ? Math.min(0.9, 0.9 / Math.max(1, s.intensity)) : 0;
    const prevFull = this.giFull[1 - this.giFullIdx];
    const trace = this.giTrace!;
    const out = this.giOut!;
    const write = this.giHist[this.giIdx];
    const read = this.giHist[1 - this.giIdx];
    this.begin();

    this.giTraceProg.use();
    let L = this.giTraceProg.loc;
    this.state.bindTexture(0, TEX_2D, gb.texture);
    this.state.bindTexture(1, TEX_2D, gb.velNormal);
    this.state.bindTexture(2, TEX_2D, sceneTex);
    this.state.bindTexture(3, TEX_2D, feedback > 0 ? prevFull.texture : sceneTex);
    this.state.bindTexture(6, TEX_3D, voxel.texture);
    gl.uniform4f(L.uVoxO, voxel.origin[0], voxel.origin[1], voxel.origin[2], useCache ? voxel.origin[3] : 1);
    gl.uniform4f(L.uVoxS, voxel.size, useCache ? Math.max(0, s.worldCacheStrength) : 0, 0, 0);
    gl.uniform4f(L.uGI, Math.max(0.2, s.radius), Math.max(0.02, s.thickness), Math.max(1, Math.min(4, Math.round(s.rays))), Math.max(6, Math.min(32, Math.round(s.steps))));
    gl.uniform4f(L.uGI2, frame % 4096, Math.max(0.5, s.maxRadiance), feedback, 0);
    this.pass(trace, w, h);

    this.giTemporalProg.use();
    L = this.giTemporalProg.loc;
    this.state.bindTexture(0, TEX_2D, trace.texture);
    this.state.bindTexture(1, TEX_2D, read.texture);
    this.state.bindTexture(2, TEX_2D, gb.velNormal);
    this.state.bindTexture(3, TEX_2D, gb.texture);
    gl.uniform4f(L.uGIT, Math.min(0.98, Math.max(0, s.feedback)), this.giValid && !forceReset ? 0 : 1, 0, 0);
    this.pass(write, w, h);
    this.giIdx = 1 - this.giIdx;
    this.giValid = true;

    let giTex = write.texture;
    if (s.blur >= 0.5) {
      this.giBlurProg.use();
      this.state.bindTexture(0, TEX_2D, write.texture);
      this.state.bindTexture(1, TEX_2D, gb.velNormal);
      this.state.bindTexture(2, TEX_2D, gb.texture);
      gl.uniform1f(this.giBlurProg.loc.uRadius, Math.min(12, s.blur));
      this.pass(out, w, h);
      giTex = out.texture;
    }

    const dst = this.giFull[this.giFullIdx];
    this.giApplyProg.use();
    this.state.bindTexture(0, TEX_2D, sceneTex);
    this.state.bindTexture(1, TEX_2D, giTex);
    this.state.bindTexture(2, TEX_2D, gb.albedo);
    this.state.bindTexture(3, TEX_2D, gb.texture);
    gl.uniform4f(this.giApplyProg.loc.uGIA, Math.max(0, s.intensity), s.debug ? 1 : 0, 0, 0);
    this.pass(dst, w, h);
    this.giFullIdx = 1 - this.giFullIdx;
    this.giFullValid = true;
    return dst.texture;
  }

  /** Forces the next TAA resolve to start from the current frame only (camera cuts, teleports). */
  resetHistory(): void {
    this.taaValid = false;
  }

  private ensureFx(): void {
    if (this.fx.length) return;
    const gl = this.gl;
    this.fx = [0, 1].map(() => createColorTarget(gl, this.state, this.width, this.height, gl.RGBA16F));
  }
  private pickFx(avoid: WebGLTexture): ColorTarget {
    this.ensureFx();
    return this.fx[0].texture !== avoid ? this.fx[0] : this.fx[1];
  }

  /** Half-resolution screen-space ray march. Returns premultiplied hit radiance (rgb) + confidence (a). */
  renderSSR(sceneTex: WebGLTexture, gb: GBufferTarget, camera: PerspectiveCamera, s: PostSettings['ssr'], w: number, h: number, frame: number): WebGLTexture {
    const gl = this.gl;
    if (!this.ssrA || !this.ssrB) {
      const aw = Math.max(1, Math.ceil(w / 2)),
        ah = Math.max(1, Math.ceil(h / 2));
      this.ssrA = createColorTarget(gl, this.state, aw, ah, gl.RGBA16F);
      this.ssrB = createColorTarget(gl, this.state, aw, ah, gl.RGBA16F);
    }
    const a = this.ssrA,
      b = this.ssrB;
    this.begin();
    this.ssrTraceProg.use();
    const L = this.ssrTraceProg.loc;
    this.state.bindTexture(0, TEX_2D, gb.texture);
    this.state.bindTexture(1, TEX_2D, gb.velNormal);
    this.state.bindTexture(2, TEX_2D, gb.material);
    this.state.bindTexture(3, TEX_2D, sceneTex);
    gl.uniform2f(L.uInvOutSize, 1 / a.width, 1 / a.height);
    gl.uniform4f(L.uSSR, Math.max(0.5, s.maxDistance), Math.max(0.01, s.thickness), Math.max(0.05, s.maxRoughness), Math.max(8, Math.min(128, Math.round(s.steps))));
    gl.uniform1f(L.uFrame, frame % 64);
    this.pass(a, w, h);

    // depth-aware separable blur (shared with volumetric fog) – smooths the stochastic roughness jitter
    this.volumetricBlurProg.use();
    const BL = this.volumetricBlurProg.loc;
    gl.uniform2f(BL.uNearFar, camera.near, camera.far);
    this.state.bindTexture(0, TEX_2D, gb.texture);
    this.state.bindTexture(1, TEX_2D, a.texture);
    gl.uniform2f(BL.uDir, 1 / a.width, 0);
    this.pass(b, w, h);
    this.state.bindTexture(1, TEX_2D, b.texture);
    gl.uniform2f(BL.uDir, 0, 1 / a.height);
    this.pass(a, w, h);
    return a.texture;
  }

  applySSR(sceneTex: WebGLTexture, ssrTex: WebGLTexture, gb: GBufferTarget, envCube: WebGLTexture, intensity: number, w: number, h: number): WebGLTexture {
    const gl = this.gl;
    const out = this.pickFx(sceneTex);
    this.begin();
    this.ssrApplyProg.use();
    this.state.bindTexture(0, TEX_2D, sceneTex);
    this.state.bindTexture(1, TEX_2D, ssrTex);
    this.state.bindTexture(2, TEX_2D, gb.velNormal);
    this.state.bindTexture(3, TEX_2D, gb.material);
    this.state.bindTexture(4, TEX_2D, gb.texture);
    this.state.bindTexture(10, TEX_CUBE, envCube);
    gl.uniform1f(this.ssrApplyProg.loc.uIntensity, intensity);
    this.pass(out, w, h);
    return out.texture;
  }

  /** Temporal anti-aliasing resolve. Returns the accumulated frame (also the next frame's history). */
  resolveTAA(sceneTex: WebGLTexture, gb: GBufferTarget, s: PostSettings['taa'], w: number, h: number, forceReset = false): WebGLTexture {
    const gl = this.gl;
    if (!this.taaHist.length) this.taaHist = [0, 1].map(() => createColorTarget(gl, this.state, this.width, this.height, gl.RGBA16F));
    const write = this.taaHist[this.taaIdx];
    const read = this.taaHist[1 - this.taaIdx];
    this.begin();
    this.taaProg.use();
    this.state.bindTexture(0, TEX_2D, sceneTex);
    this.state.bindTexture(1, TEX_2D, read.texture);
    this.state.bindTexture(2, TEX_2D, gb.velNormal);
    this.state.bindTexture(3, TEX_2D, gb.texture);
    gl.uniform4f(this.taaProg.loc.uTaa, Math.min(0.98, Math.max(0, s.feedback)), this.taaValid && !forceReset ? 0 : 1, 0, 0);
    this.pass(write, w, h);
    this.taaIdx = 1 - this.taaIdx;
    this.taaValid = true;
    return write.texture;
  }

  dof(sceneTex: WebGLTexture, gb: GBufferTarget, s: PostSettings['dof'], w: number, h: number): WebGLTexture {
    const gl = this.gl;
    const out = this.pickFx(sceneTex);
    this.begin();
    this.dofProg.use();
    const L = this.dofProg.loc;
    this.state.bindTexture(0, TEX_2D, sceneTex);
    this.state.bindTexture(1, TEX_2D, gb.texture);
    gl.uniform4f(L.uDofA, Math.max(0.1, s.focusDistance), Math.max(1, s.focalLength) / 1000, Math.max(0.7, s.fStop), Math.max(1, s.maxBlur));
    gl.uniform4f(L.uDofB, Math.max(8, Math.min(64, Math.round(s.taps))), 0.024, 0, 0);
    this.pass(out, w, h);
    return out.texture;
  }

  motionBlur(sceneTex: WebGLTexture, gb: GBufferTarget, s: PostSettings['motionBlur'], w: number, h: number): WebGLTexture {
    const gl = this.gl;
    const out = this.pickFx(sceneTex);
    this.begin();
    this.motionBlurProg.use();
    this.state.bindTexture(0, TEX_2D, sceneTex);
    this.state.bindTexture(1, TEX_2D, gb.velNormal);
    this.state.bindTexture(2, TEX_2D, gb.texture);
    gl.uniform4f(this.motionBlurProg.loc.uMB, Math.max(0, s.intensity), 0.06, Math.max(4, Math.min(32, Math.round(s.samples))), 0);
    this.pass(out, w, h);
    return out.texture;
  }

  composite(
    sceneTex: WebGLTexture,
    bloomTex: WebGLTexture | null,
    fogTex: WebGLTexture | null,
    flareTex: WebGLTexture | null,
    s: PostSettings,
    time: number,
    w: number,
    h: number
  ): void {
    const gl = this.gl;
    this.begin();
    this.compositeProg.use();
    const L = this.compositeProg.loc;
    this.state.bindTexture(0, TEX_2D, sceneTex);
    this.state.bindTexture(1, TEX_2D, bloomTex ?? sceneTex);
    this.state.bindTexture(2, TEX_2D, this.adapt[this.adaptIndex].texture);
    this.state.bindTexture(3, TEX_2D, fogTex ?? sceneTex);
    this.state.bindTexture(4, TEX_2D, flareTex ?? sceneTex);
    gl.uniform4f(L.uParams0, s.exposure, bloomTex && s.bloom.enabled ? s.bloom.intensity : 0, s.vignette, s.grain);
    gl.uniform4f(L.uParams1, s.saturation, s.contrast, s.chromaticAberration, TONE_ID[s.toneMapping]);
    gl.uniform4f(L.uParams2, s.autoExposure ? 1 : 0, s.autoExposureKey, s.autoExposureMin, s.autoExposureMax);
    gl.uniform2f(L.uParams3, time % 100, w / h);
    gl.uniform2f(L.uParams4, Math.max(0, s.sharpen), Math.max(-1, Math.min(1, s.temperature)));
    gl.uniform1f(L.uFogEnabled, fogTex && s.volumetricFog.enabled ? 1 : 0);
    gl.uniform4f(L.uParams5, flareTex && s.lensFlare.enabled ? Math.max(0, s.lensFlare.intensity) : 0, s.lensDistortion, s.cdl.enabled ? 1 : 0, bloomTex ? Math.max(0, s.halation) : 0);
    gl.uniform4f(L.uParams6, Math.max(0, Math.min(1, s.opticalVignette)), s.bloom.energyConserving ? 1 : 0, s.exposureCompensation, bloomTex ? Math.max(0, s.lensDirt) : 0);
    gl.uniform4f(L.uRain, s.rain.enabled ? Math.max(0, Math.min(1, s.rain.intensity)) : 0, s.rain.wind, Math.max(0.1, s.rain.length), Math.max(0, s.rain.speed));
    gl.uniform3f(L.uSlope, s.cdl.slope[0], s.cdl.slope[1], s.cdl.slope[2]);
    gl.uniform3f(L.uOffset, s.cdl.offset[0], s.cdl.offset[1], s.cdl.offset[2]);
    gl.uniform3f(L.uPower, Math.max(0.05, s.cdl.power[0]), Math.max(0.05, s.cdl.power[1]), Math.max(0.05, s.cdl.power[2]));
    this.pass(null, w, h);
  }

  dispose(): void {
    const gl = this.gl;
    for (const t of [this.aoA, this.aoB, this.fogA, this.fogB, ...this.fogHist, this.ssrA, this.ssrB, this.flareRT, this.lum, this.giTrace, this.giOut, ...this.giHist, ...this.giFull, this.hist, ...this.fx, ...this.taaHist, ...this.adapt, ...this.down, ...this.up])
      deleteColorTarget(gl, this.state, t);
    this.voxel?.dispose();
    for (const p of [
      this.ssaoProg,
      this.gtaoProg,
      this.ssaoBlurProg,
      this.bloomFirstProg,
      this.bloomDownProg,
      this.bloomUpProg,
      this.lumProg,
      this.adaptProg,
      this.compositeProg,
      this.volumetricProg,
      this.volumetricBlurProg,
      this.volumetricTemporalProg,
      this.taaProg,
      this.ssrTraceProg,
      this.ssrApplyProg,
      this.dofProg,
      this.motionBlurProg,
      this.flareProg,
      this.giTraceProg,
      this.giTemporalProg,
      this.giBlurProg,
      this.giApplyProg,
      this.histProg,
      this.histAdaptProg,
    ])
      p.dispose();
  }
}
