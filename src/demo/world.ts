import {
  CameraPath,
  Clock,
  Color,
  DirectionalLight,
  Fog,
  FlyControls,
  OrbitControls,
  PerspectiveCamera,
  Renderer,
  Scene,
  Sky,
  TimeOfDay,
  smoothstep,
} from '../lumina';
import { City, buildCity, type CityOptions } from './city';
import { LOOKS, type CameraMode, type Settings } from './settings';

export type WorldOptions = CityOptions;

const hexToColor = (hex: string): [number, number, number] => {
  const c = new Color().set(hex as unknown as Color);
  return [c.r, c.g, c.b];
};

/**
 * The Lumina X demo world: renderer, sky + sun driven by a `TimeOfDay`, the procedural city, three camera modes
 * (cinematic rail, free fly, orbit) and `apply(settings)`, which maps every UI control to the engine.
 */
export class CityWorld {
  readonly renderer: Renderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly sky = new Sky();
  readonly sun = new DirectionalLight(0xffffff, 3);
  readonly tod: TimeOfDay;
  readonly city: City;
  readonly fog = new Fog(0.0003, 0.012);
  readonly fly: FlyControls;
  readonly orbit: OrbitControls;
  readonly path: CameraPath;
  mode: CameraMode = 'path';
  onModeChange: ((m: CameraMode) => void) | null = null;

  private clock = new Clock();
  private raf = 0;
  private running = false;
  private disposed = false;
  private cloudX = 0;
  private cloudDrift = 0.01;
  private lastTime = '';
  private lastSky = { c: -1, d: -1, s: -1, st: -1, m: -1 };
  private lastMsaa = -1;
  private lastHour = NaN;
  private frames = 0;

  private constructor(canvas: HTMLCanvasElement, city: City) {
    this.city = city;
    this.renderer = new Renderer({ canvas, samples: 0 });
    this.camera = new PerspectiveCamera(58, 1, 0.3, 4500);
    this.camera.position.set(...city.start.pos);
    this.camera.lookAt(city.start.look[0], city.start.look[1], city.start.look[2]);

    this.scene.sky = this.sky;
    this.scene.fog = this.fog;
    this.scene.add(city.root);
    this.scene.add(this.sun);
    this.tod = new TimeOfDay(this.sky, this.sun);
    this.sun.shadow.cascades = 4;
    this.sun.shadow.distance = 420;
    this.sun.shadow.lambda = 0.9;
    for (const l of city.pool) this.scene.add(l);

    this.fly = new FlyControls(this.camera, canvas);
    this.fly.onInteract = () => {
      if (this.mode === 'path') this.setMode('fly');
    };
    this.orbit = new OrbitControls(this.camera, canvas);
    this.orbit.maxDistance = 3000;
    this.orbit.minDistance = 2;
    this.orbit.target.set(0, 20, 0);
    this.orbit.enabled = false;
    this.path = new CameraPath(city.pathKeys.map((k) => ({ p: k.p, fov: k.fov })));
    this.path.loop = true;
    this.path.play();
    this.fly.enabled = false;
  }

  static async create(canvas: HTMLCanvasElement, onProgress: (p: number, label: string) => void, opts: WorldOptions = {}): Promise<CityWorld> {
    const city = await buildCity(opts, (p, l) => onProgress(p * 0.9, l));
    onProgress(0.92, 'Menyiapkan renderer & shader…');
    await new Promise((r) => setTimeout(r, 0));
    const w = new CityWorld(canvas, city);
    return w;
  }

  setMode(m: CameraMode): void {
    if (m === this.mode) return;
    this.mode = m;
    this.fly.enabled = m === 'fly';
    this.orbit.enabled = m === 'orbit';
    if (m === 'path') this.path.play();
    else this.path.pause();
    if (m === 'fly') this.fly.syncFromCamera();
    if (m === 'orbit') {
      const d = this.camera.getWorldDirection();
      const p = this.camera.position;
      this.orbit.target.set(p.x + d.x * 120, Math.max(5, p.y + d.y * 120), p.z + d.z * 120);
      this.orbit.syncFromCamera();
    }
    this.renderer.resetTemporal();
    this.onModeChange?.(m);
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  /** Teleports the camera (resets all temporal history, avoids a ghost frame). */
  teleport(pos: [number, number, number], look: [number, number, number]): void {
    this.camera.position.set(pos[0], pos[1], pos[2]);
    this.camera.lookAt(look[0], look[1], look[2]);
    this.fly.syncFromCamera();
    this.renderer.resetTemporal();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.clock.getDelta();
    const loop = () => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      this.frame(this.clock.getDelta());
    };
    loop();
  }
  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** One simulation + render step (also used by the headless tests). */
  frame(dt: number): void {
    if (this.disposed) return;
    dt = Math.min(dt, 0.1);
    this.tod.update(dt);
    const city = this.city;
    city.lampsOn = this.tod.lamps;
    city.windowsOn = smoothstep(0.12, 0.8, this.tod.night);

    // wind: clouds + fog wisps drift together
    this.cloudX += dt * this.cloudDrift;
    this.sky.cloudOffset.x = this.cloudX;

    if (this.mode === 'path') this.path.update(this.camera, dt);
    else if (this.mode === 'fly') this.fly.update(dt);
    else this.orbit.update(dt);

    city.update(this.camera);
    this.renderer.render(this.scene, this.camera);
    this.frames++;
  }

  /** Maps every UI control onto the engine. Cheap enough to call on each change. */
  apply(s: Settings): void {
    const r = this.renderer;
    const p = r.post;
    const sky = this.sky;

    if (s.msaa !== this.lastMsaa) {
      r.setSamples(s.msaa);
      this.lastMsaa = s.msaa;
    }

    // time of day
    const t = this.tod;
    if (s.hour !== this.lastHour) {
      t.hour = s.hour;
      this.lastHour = s.hour;
    }
    t.timeScale = s.timeScale;
    t.latitude = s.latitude;
    t.dayOfYear = s.dayOfYear;
    t.azimuthOffset = s.azimuthOffset;
    let skyDirty = false;
    const timeKey = `${s.hour}|${s.latitude}|${s.dayOfYear}|${s.azimuthOffset}`;
    if (timeKey !== this.lastTime) {
      this.lastTime = timeKey;
      skyDirty = true;
    }
    // sky parameters (each one re-bakes the environment, so only on change)
    const L = this.lastSky;
    if (L.c !== s.clouds || L.d !== s.cloudDensity || L.s !== s.cloudScale || L.st !== s.stars || L.m !== s.moon) {
      sky.cloudCoverage = s.clouds;
      sky.cloudDensity = s.cloudDensity;
      sky.cloudScale = s.cloudScale;
      sky.stars = s.stars;
      sky.moonLight = s.moon;
      sky.touch();
      Object.assign(L, { c: s.clouds, d: s.cloudDensity, s: s.cloudScale, st: s.stars, m: s.moon });
      skyDirty = true;
    }
    if (skyDirty) t.apply(true);
    this.cloudDrift = s.cloudDrift;

    // weather
    r.weather.wetness = s.wetness;
    this.city.wetness = s.wetness;
    p.rain.enabled = s.rain;
    p.rain.intensity = s.rainIntensity;
    p.rain.wind = s.rainWind;

    // analytic atmosphere
    this.fog.density = s.fog / 1e4;
    this.fog.heightFalloff = s.fogHeight;

    // volumetric fog X
    const vf = p.volumetricFog;
    vf.enabled = s.volFog;
    vf.density = s.volDensity / 1e3;
    vf.heightFalloff = s.volHeightFalloff;
    vf.baseHeight = s.volBase;
    vf.anisotropy = s.volAnisotropy;
    vf.intensity = s.volIntensity;
    vf.maxDistance = s.volMax;
    vf.steps = s.volSteps;
    vf.stepExponent = s.volStepExp;
    vf.noise = s.volNoise;
    vf.noiseScale = s.volNoiseScale;
    const wd = (s.volWindDir * Math.PI) / 180;
    vf.windX = Math.cos(wd) * s.volWind;
    vf.windZ = Math.sin(wd) * s.volWind;
    vf.multiScatter = s.volMulti;
    vf.mistDensity = s.volMist / 1e3;
    vf.mistFalloff = s.volMistFalloff;
    vf.ambient = s.volAmbient;
    vf.temporal = s.volTemporal;
    vf.localLights = s.volLocal;
    vf.localIntensity = s.volLocalIntensity;
    vf.albedo = hexToColor(s.volAlbedo);

    // shadows & GI
    const sh = this.sun.shadow;
    sh.pcss = s.pcss;
    sh.penumbra = s.penumbra;
    sh.distance = s.shadowDistance;
    sh.cascades = s.cascades;
    sh.mapSize = s.shadowSize;
    r.localShadows.enabled = s.localShadows;
    r.microShadowing = s.microShadow;
    p.ssgi.enabled = s.ssgi;
    p.ssgi.intensity = s.ssgiIntensity;
    p.ssgi.rays = s.ssgiRays;
    p.ssgi.multiBounce = s.ssgiBounce;
    p.ssgi.worldCache = s.ssgiCache;
    p.ssao.enabled = s.ssao;
    p.ssao.gtao = true;
    p.ssao.intensity = s.gtaoIntensity;
    p.ssao.radius = s.gtaoRadius;
    p.ssr.enabled = s.ssr;
    p.ssr.intensity = s.ssrIntensity;
    p.ssr.steps = s.ssrSteps;
    p.contactShadows.enabled = s.contact;

    // surfaces & city
    r.parallax.enabled = s.pom;
    r.parallax.quality = s.pomQuality;
    r.decalsEnabled = s.decals;
    this.city.lampIntensity = s.lampIntensity;
    this.city.windowGlow = s.windowGlow;

    // camera & lens
    if (Math.abs(this.camera.fov - s.fov) > 1e-3 && this.mode !== 'path') {
      this.camera.fov = s.fov;
      this.camera.updateProjectionMatrix();
    }
    p.autoExposure = s.autoExposure;
    p.exposure = s.exposure;
    p.exposureCompensation = s.ev;
    p.autoExposureCenterWeight = s.centerWeight;
    p.toneMapping = s.tone;
    p.bloom.enabled = s.bloom;
    p.bloom.intensity = s.bloomIntensity;
    p.bloom.energyConserving = s.bloomEnergy;
    p.halation = s.halation;
    p.lensDirt = s.lensDirt;
    p.lensFlare.enabled = s.flare;
    p.lensFlare.intensity = s.flareIntensity;
    p.vignette = s.vignette;
    p.opticalVignette = s.opticalVignette;
    p.chromaticAberration = s.chroma;
    p.grain = s.grain;
    p.dof.enabled = s.dof;
    p.dof.focusDistance = s.dofFocus;
    p.dof.fStop = s.dofFStop;
    p.motionBlur.enabled = s.mb;
    p.motionBlur.intensity = s.mbIntensity;
    p.taa.enabled = s.taa;
    p.sharpen = s.sharpen;
    p.saturation = s.saturation;
    p.contrast = s.contrast;
    p.temperature = s.temperature;
    const lk = LOOKS[s.look] ?? null;
    p.cdl.enabled = !!lk;
    if (lk) {
      p.cdl.slope = lk.slope;
      p.cdl.offset = lk.offset;
      p.cdl.power = lk.power;
    }

    // engine
    r.renderScale = s.renderScale;
    this.fly.speed = s.flySpeed;
    this.path.speed = s.pathSpeed;
    this.setMode(s.mode);
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.fly.dispose();
    this.orbit.dispose();
    this.renderer.dispose();
  }
}
