import type { DirectionalLight } from '../core/Lights';
import type { Renderer } from '../renderer/Renderer';
import type { DeviceProfile } from './Device';

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra' | 'photo';

export const QUALITY_LEVELS: QualityLevel[] = ['low', 'medium', 'high', 'ultra', 'photo'];

/**
 * One-call quality presets. Touches only quality-related knobs (anti-aliasing, shadows, screen-space
 * effects, render scale); artistic settings such as exposure, tone mapping or grading are left alone.
 *
 *  low     – no MSAA/TAA, SSAO off, 1K shadows, 75 % render scale
 *  medium  – MSAA 2×, SSAO, 2K shadows
 *  high    – TAA + SSAO + SSR + contact shadows + screen-space refraction + parallax (full quality)
 *  ultra   – high + SSGI + volumetric fog + motion blur, 4K shadows
 *  photo   – ultra + lens flare, 4 cascades, 2-ray SSGI, long ray marches (for stills, not for 60 fps)
 */
export function applyQuality(renderer: Renderer, level: QualityLevel, sun?: DirectionalLight | null): void {
  const p = renderer.post;
  const set = (o: {
    msaa: number;
    taa: boolean;
    ssao: boolean;
    ssr: boolean;
    ssgi: boolean;
    ssgiRays: number;
    ssgiSteps: number;
    refrSteps: number;
    pom: number;
    contact: boolean;
    fog: boolean;
    mb: boolean;
    flare: boolean;
    shadow: number;
    cascades: number;
    scale: number;
    sharpen: number;
    ssrSteps: number;
    fogSteps: number;
    dofTaps: number;
    local: number;
    cache: number;
  }) => {
    renderer.setSamples(o.msaa);
    p.taa.enabled = o.taa;
    p.ssao.enabled = o.ssao;
    p.ssr.enabled = o.ssr;
    p.ssr.steps = o.ssrSteps;
    p.ssgi.enabled = o.ssgi;
    p.ssgi.rays = o.ssgiRays;
    p.ssgi.steps = o.ssgiSteps;
    p.refraction.steps = o.refrSteps;
    renderer.parallax.quality = o.pom;
    p.contactShadows.enabled = o.contact;
    p.volumetricFog.enabled = o.fog;
    p.volumetricFog.steps = o.fogSteps;
    p.motionBlur.enabled = o.mb;
    p.lensFlare.enabled = o.flare;
    p.dof.taps = o.dofTaps;
    p.sharpen = o.sharpen;
    renderer.localShadows.enabled = o.local > 0;
    if (o.local > 0) renderer.localShadows.mapSize = o.local;
    p.volumetricFog.localLights = o.local > 0;
    p.ssgi.worldCache = o.cache > 0;
    if (o.cache > 0) p.ssgi.worldCacheResolution = o.cache;
    p.ssgi.multiBounce = o.cache > 0 || o.ssgi;
    renderer.dynamicResolution.enabled = false;
    renderer.renderScale = o.scale;
    if (sun) {
      sun.shadow.mapSize = o.shadow;
      sun.shadow.cascades = o.cascades;
    }
  };
  switch (level) {
    case 'low':
      return set({ msaa: 0, taa: false, ssao: false, ssr: false, ssgi: false, ssgiRays: 1, ssgiSteps: 10, refrSteps: 12, pom: 0.5, contact: false, fog: false, mb: false, flare: false, shadow: 1024, cascades: 2, scale: 0.75, sharpen: 0, ssrSteps: 32, fogSteps: 12, dofTaps: 16, local: 0, cache: 0 });
    case 'medium':
      return set({ msaa: 2, taa: false, ssao: true, ssr: false, ssgi: false, ssgiRays: 1, ssgiSteps: 12, refrSteps: 16, pom: 0.7, contact: false, fog: false, mb: false, flare: false, shadow: 2048, cascades: 3, scale: 1, sharpen: 0, ssrSteps: 48, fogSteps: 16, dofTaps: 24, local: 512, cache: 0 });
    case 'high':
      return set({ msaa: 0, taa: true, ssao: true, ssr: true, ssgi: false, ssgiRays: 1, ssgiSteps: 14, refrSteps: 24, pom: 1, contact: true, fog: false, mb: false, flare: false, shadow: 2048, cascades: 3, scale: 1, sharpen: 0.25, ssrSteps: 64, fogSteps: 24, dofTaps: 28, local: 1024, cache: 0 });
    case 'ultra':
      return set({ msaa: 0, taa: true, ssao: true, ssr: true, ssgi: true, ssgiRays: 1, ssgiSteps: 16, refrSteps: 28, pom: 1, contact: true, fog: true, mb: true, flare: false, shadow: 4096, cascades: 4, scale: 1, sharpen: 0.25, ssrSteps: 96, fogSteps: 32, dofTaps: 40, local: 1024, cache: 32 });
    case 'photo':
      return set({ msaa: 0, taa: true, ssao: true, ssr: true, ssgi: true, ssgiRays: 2, ssgiSteps: 24, refrSteps: 40, pom: 1, contact: true, fog: true, mb: false, flare: true, shadow: 4096, cascades: 4, scale: 1, sharpen: 0.3, ssrSteps: 128, fogSteps: 48, dofTaps: 56, local: 2048, cache: 48 });
  }
}

/**
 * Picks a preset from the detected hardware (`renderer.device`): phones and weak GPUs get a lower preset, MSAA off / 2×,
 * fewer parallax / refraction steps and the dynamic-resolution governor; desktop GPUs keep the full pipeline.
 * Call it once right after creating the renderer (and before building heavy geometry – see `device.geometryDetail`).
 */
export function applyDeviceQuality(renderer: Renderer, sun?: DirectionalLight | null): DeviceProfile {
  const d = renderer.device;
  applyQuality(renderer, d.preset, sun);
  if (d.tier !== 'high') {
    renderer.parallax.quality = d.tier === 'low' ? 0.35 : 0.6;
    renderer.post.refraction.steps = d.tier === 'low' ? 8 : 14;
    renderer.post.bloom.enabled = true;
    renderer.post.dof.taps = 14;
    renderer.post.volumetricFog.steps = 12;
    renderer.post.autoExposureMode = 'histogram';
    renderer.environmentUpdateInterval = 250;
    if (sun) sun.shadow.cascades = Math.min(sun.shadow.cascades, 2);
    renderer.dynamicResolution = { enabled: true, targetFps: d.tier === 'low' ? 40 : 50, minScale: d.tier === 'low' ? 0.45 : 0.6, maxScale: d.tier === 'low' ? 0.8 : 1 };
    renderer.renderScale = Math.min(renderer.renderScale, d.tier === 'low' ? 0.7 : 0.9);
  }
  return d;
}

interface Step {
  name: string;
  /** Applies the cheaper variant; returns an undo function. */
  degrade(r: Renderer): () => void;
}

/**
 * Frame-time governor. When the smoothed frame time stays above the budget it walks down a ladder of
 * progressively more drastic (but increasingly visible) savings – volumetric steps, flare, contact shadows,
 * motion blur, SSR, render scale … – and walks back up again once there is sustained headroom.
 *
 * Every change is reversible: `release()` restores exactly what the application had configured, so call
 * it before re-applying your own settings (the demo does this whenever a UI control changes).
 */
export class AdaptiveQuality {
  enabled = false;
  targetFps = 58;
  /** Seconds the budget must be missed before a step is taken. */
  degradeAfter = 1.2;
  /** Seconds of comfortable headroom before a step is undone. */
  upgradeAfter = 6;
  private undo: (() => void)[] = [];
  private steps: Step[];
  private over = 0;
  private under = 0;

  constructor(private renderer: Renderer) {
    const clampScale = (r: Renderer, v: number) => {
      const old = r.renderScale;
      r.renderScale = v;
      return () => (r.renderScale = old);
    };
    this.steps = [
      { name: 'GI world cache', degrade: (r) => { const o = r.post.ssgi.worldCache; r.post.ssgi.worldCache = false; return () => (r.post.ssgi.worldCache = o); } },
      { name: 'local light shadows', degrade: (r) => { const o = r.localShadows.enabled; r.localShadows.enabled = false; return () => (r.localShadows.enabled = o); } },
      { name: 'SSGI rays', degrade: (r) => { const o = r.post.ssgi.rays; const st = r.post.ssgi.steps; r.post.ssgi.rays = 1; r.post.ssgi.steps = Math.min(st, 10); return () => { r.post.ssgi.rays = o; r.post.ssgi.steps = st; }; } },
      { name: 'parallax quality', degrade: (r) => { const o = r.parallax.quality; r.parallax.quality = Math.min(o, 0.55); return () => (r.parallax.quality = o); } },
      { name: 'refraction steps', degrade: (r) => { const o = r.post.refraction.steps; r.post.refraction.steps = Math.min(o, 12); return () => (r.post.refraction.steps = o); } },
      { name: 'lens flare', degrade: (r) => { const o = r.post.lensFlare.enabled; r.post.lensFlare.enabled = false; return () => (r.post.lensFlare.enabled = o); } },
      { name: 'volumetric steps', degrade: (r) => { const o = r.post.volumetricFog.steps; r.post.volumetricFog.steps = Math.min(o, 12); return () => (r.post.volumetricFog.steps = o); } },
      { name: 'contact shadows', degrade: (r) => { const o = r.post.contactShadows.enabled; r.post.contactShadows.enabled = false; return () => (r.post.contactShadows.enabled = o); } },
      { name: 'motion blur', degrade: (r) => { const o = r.post.motionBlur.enabled; r.post.motionBlur.enabled = false; return () => (r.post.motionBlur.enabled = o); } },
      { name: 'SSR steps', degrade: (r) => { const o = r.post.ssr.steps; r.post.ssr.steps = Math.min(o, 32); return () => (r.post.ssr.steps = o); } },
      { name: 'render scale 85%', degrade: (r) => clampScale(r, Math.min(r.renderScale, 0.85)) },
      { name: 'depth of field taps', degrade: (r) => { const o = r.post.dof.taps; r.post.dof.taps = Math.min(o, 16); return () => (r.post.dof.taps = o); } },
      { name: 'volumetric fog', degrade: (r) => { const o = r.post.volumetricFog.enabled; r.post.volumetricFog.enabled = false; return () => (r.post.volumetricFog.enabled = o); } },
      { name: 'SSR', degrade: (r) => { const o = r.post.ssr.enabled; r.post.ssr.enabled = false; return () => (r.post.ssr.enabled = o); } },
      { name: 'render scale 70%', degrade: (r) => clampScale(r, Math.min(r.renderScale, 0.7)) },
      { name: 'SSGI', degrade: (r) => { const o = r.post.ssgi.enabled; r.post.ssgi.enabled = false; return () => (r.post.ssgi.enabled = o); } },
      { name: 'SSAO', degrade: (r) => { const o = r.post.ssao.enabled; r.post.ssao.enabled = false; return () => (r.post.ssao.enabled = o); } },
      { name: 'render scale 55%', degrade: (r) => clampScale(r, Math.min(r.renderScale, 0.55)) },
    ];
  }

  /** Number of savings currently applied. */
  get level(): number {
    return this.undo.length;
  }
  get maxLevel(): number {
    return this.steps.length;
  }
  /** Name of the last saving that was applied (or null). */
  get lastStep(): string | null {
    return this.undo.length ? this.steps[this.undo.length - 1].name : null;
  }

  /** Restores every setting the governor changed. */
  release(): void {
    while (this.undo.length) this.undo.pop()!();
    this.over = this.under = 0;
  }

  /** Call once per frame with the frame delta in seconds (or let it use the renderer's smoothed frame time). */
  update(dt?: number): void {
    if (!this.enabled) {
      if (this.undo.length) this.release();
      return;
    }
    const step = Math.min(dt ?? this.renderer.info.frameMs / 1000, 0.25);
    const budget = 1000 / this.targetFps;
    const ms = this.renderer.info.frameMs;
    if (ms > budget * 1.12) {
      this.over += step;
      this.under = 0;
    } else if (ms < budget * 0.72) {
      this.under += step;
      this.over = 0;
    } else {
      this.over = Math.max(0, this.over - step);
      this.under = Math.max(0, this.under - step);
    }
    if (this.over > this.degradeAfter && this.undo.length < this.steps.length) {
      this.undo.push(this.steps[this.undo.length].degrade(this.renderer));
      this.over = 0;
    } else if (this.under > this.upgradeAfter && this.undo.length) {
      this.undo.pop()!();
      this.under = 0;
    }
  }
}
