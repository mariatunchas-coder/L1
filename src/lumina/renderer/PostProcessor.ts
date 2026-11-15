import type { PerspectiveCamera } from '../core/Camera';
import { GLState, TEX_2D, TEX_2D_ARRAY } from './GLState';
import { Program } from './Program';
import { ColorTarget, GBufferTarget, createColorTarget, deleteColorTarget } from './RenderTarget';
import { fullscreenVert } from './shaders/ibl';
import { adaptFrag, bloomDownFrag, bloomUpFrag, compositeFrag, lensFlareFrag, lumFrag, ssaoBlurFrag, ssaoFrag } from './shaders/post';
import { volumetricBlurFrag, volumetricFrag } from './shaders/volumetric';
import { dofFrag, motionBlurFrag, ssrApplyFrag, ssrTraceFrag, taaFrag } from './shaders/effects';
import { TEX_CUBE } from './GLState';

export type ToneMapping = 'none' | 'reinhard' | 'aces' | 'neutral' | 'filmic' | 'agx';

export interface PostSettings {
  exposure: number;
  autoExposure: boolean;
  /** Target middle-grey (scene-referred) the auto exposure aims at. */
  autoExposureKey: number;
  autoExposureMin: number;
  autoExposureMax: number;
  adaptSpeedUp: number;
  adaptSpeedDown: number;
  toneMapping: ToneMapping;
  bloom: { enabled: boolean; intensity: number; threshold: number; knee: number; radius: number };
  ssao: { enabled: boolean; radius: number; intensity: number; power: number; bias: number };
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
  };
}

export function defaultPostSettings(): PostSettings {
  return {
    exposure: 1,
    autoExposure: true,
    autoExposureKey: 0.18,
    autoExposureMin: 0.05,
    autoExposureMax: 20,
    adaptSpeedUp: 2.5,
    adaptSpeedDown: 1.2,
    toneMapping: 'aces',
    bloom: { enabled: true, intensity: 0.12, threshold: 1.2, knee: 0.6, radius: 0.72 },
    ssao: { enabled: true, radius: 0.7, intensity: 1.25, power: 1.35, bias: 0.03 },
    vignette: 0.28,
    grain: 0.08,
    saturation: 1.06,
    contrast: 1.04,
    chromaticAberration: 0,
    sharpen: 0,
    temperature: 0,
    lensDistortion: 0,
    cdl: { enabled: false, slope: [1, 1, 1], offset: [0, 0, 0], power: [1, 1, 1] },
    lensFlare: { enabled: false, intensity: 0.2, threshold: 8, ghosts: 5, dispersal: 0.32, halo: 0.42, chromatic: 0.012 },
    contactShadows: { enabled: false, length: 0.7, thickness: 0.5, strength: 0.85 },
    taa: { enabled: false, feedback: 0.9, jitter: 1 },
    ssr: { enabled: false, intensity: 1, maxDistance: 40, thickness: 0.6, maxRoughness: 0.6, steps: 64 },
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
    },
  };
}

const TONE_ID: Record<ToneMapping, number> = { none: 0, reinhard: 1, aces: 2, neutral: 3, filmic: 4, agx: 5 };

/** Screen-space effects: SSAO, bloom, auto-exposure, tone mapping & grading. */
export class PostProcessor {
  private ssaoProg: Program;
  private ssaoBlurProg: Program;
  private bloomFirstProg: Program;
  private bloomDownProg: Program;
  private bloomUpProg: Program;
  private lumProg: Program;
  private adaptProg: Program;
  private compositeProg: Program;
  private volumetricProg: Program;
  private volumetricBlurProg: Program;
  private taaProg: Program;
  private ssrTraceProg: Program;
  private ssrApplyProg: Program;
  private dofProg: Program;
  private motionBlurProg: Program;
  private flareProg: Program;
  private flareRT: ColorTarget | null = null;

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
    this.ssaoBlurProg = mk(ssaoBlurFrag, 'ssaoBlur');
    this.bloomFirstProg = mk(bloomDownFrag, 'bloomFirst', ['FIRST_PASS']);
    this.bloomDownProg = mk(bloomDownFrag, 'bloomDown');
    this.bloomUpProg = mk(bloomUpFrag, 'bloomUp');
    this.lumProg = mk(lumFrag, 'luminance');
    this.adaptProg = mk(adaptFrag, 'adapt');
    this.compositeProg = mk(compositeFrag, 'composite');
    this.volumetricProg = mk(volumetricFrag, 'volumetric');
    this.volumetricBlurProg = mk(volumetricBlurFrag, 'volumetricBlur');
    this.taaProg = mk(taaFrag, 'taa');
    this.ssrTraceProg = mk(ssrTraceFrag, 'ssrTrace');
    this.ssrApplyProg = mk(ssrApplyFrag, 'ssrApply');
    this.dofProg = mk(dofFrag, 'dof');
    this.motionBlurProg = mk(motionBlurFrag, 'motionBlur');
    this.flareProg = mk(lensFlareFrag, 'lensFlare');
    this.lum = createColorTarget(gl, state, this.lumSize, this.lumSize, gl.RGBA16F, { mipmaps: true });
    this.adapt = [createColorTarget(gl, state, 1, 1, gl.R16F), createColorTarget(gl, state, 1, 1, gl.R16F)];
  }

  resize(w: number, h: number): void {
    if (w === this.width && h === this.height) return;
    const gl = this.gl;
    this.width = w;
    this.height = h;
    for (const t of [this.aoA, this.aoB, this.fogA, this.fogB, this.ssrA, this.ssrB, this.flareRT, ...this.fx, ...this.taaHist, ...this.down, ...this.up])
      deleteColorTarget(gl, this.state, t);
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

    this.ssaoProg.use();
    const L = this.ssaoProg.loc;
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
    camera: PerspectiveCamera,
    s: PostSettings['volumetricFog'],
    fullW: number,
    fullH: number
  ): WebGLTexture {
    const gl = this.gl;
    const a = this.fogA!,
      b = this.fogB!;
    this.begin();

    this.volumetricProg.use();
    const L = this.volumetricProg.loc;
    this.state.bindTexture(0, TEX_2D, depthTex);
    this.state.bindTexture(3, TEX_2D_ARRAY, shadowTex);
    gl.uniform2f(L.uInvOutSize, 1 / a.width, 1 / a.height);
    gl.uniform1f(L.uDensity, s.density);
    gl.uniform1f(L.uHeightFalloff, s.heightFalloff);
    gl.uniform1f(L.uBaseHeight, s.baseHeight);
    gl.uniform1f(L.uAnisotropy, s.anisotropy);
    gl.uniform1f(L.uIntensity, s.intensity);
    gl.uniform1f(L.uMaxDistance, Math.min(s.maxDistance, camera.far));
    gl.uniform1i(L.uSteps, Math.max(1, Math.min(64, Math.round(s.steps))));
    this.pass(a, fullW, fullH);

    this.volumetricBlurProg.use();
    const BL = this.volumetricBlurProg.loc;
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
    this.begin();
    this.lumProg.use();
    this.state.bindTexture(0, TEX_2D, sceneTex);
    gl.uniform2f(this.lumProg.loc.uTexel, 1 / w, 1 / h);
    gl.uniform2f(this.lumProg.loc.uStep, w / (this.lumSize * 3), h / (this.lumSize * 3));
    this.pass(this.lum, w, h);
    this.state.bindScratch(TEX_2D, this.lum.texture);
    gl.generateMipmap(gl.TEXTURE_2D);

    const prev = this.adapt[this.adaptIndex];
    const next = this.adapt[1 - this.adaptIndex];
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
    gl.uniform4f(L.uParams5, flareTex && s.lensFlare.enabled ? Math.max(0, s.lensFlare.intensity) : 0, s.lensDistortion, s.cdl.enabled ? 1 : 0, 0);
    gl.uniform3f(L.uSlope, s.cdl.slope[0], s.cdl.slope[1], s.cdl.slope[2]);
    gl.uniform3f(L.uOffset, s.cdl.offset[0], s.cdl.offset[1], s.cdl.offset[2]);
    gl.uniform3f(L.uPower, Math.max(0.05, s.cdl.power[0]), Math.max(0.05, s.cdl.power[1]), Math.max(0.05, s.cdl.power[2]));
    this.pass(null, w, h);
  }

  dispose(): void {
    const gl = this.gl;
    for (const t of [this.aoA, this.aoB, this.fogA, this.fogB, this.ssrA, this.ssrB, this.flareRT, this.lum, ...this.fx, ...this.taaHist, ...this.adapt, ...this.down, ...this.up])
      deleteColorTarget(gl, this.state, t);
    for (const p of [
      this.ssaoProg,
      this.ssaoBlurProg,
      this.bloomFirstProg,
      this.bloomDownProg,
      this.bloomUpProg,
      this.lumProg,
      this.adaptProg,
      this.compositeProg,
      this.volumetricProg,
      this.volumetricBlurProg,
      this.taaProg,
      this.ssrTraceProg,
      this.ssrApplyProg,
      this.dofProg,
      this.motionBlurProg,
      this.flareProg,
    ])
      p.dispose();
  }
}
