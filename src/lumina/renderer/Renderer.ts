import type { PerspectiveCamera } from '../core/Camera';
import type { DirectionalLight, Light, PointLight, SpotLight } from '../core/Lights';
import { DoubleSide, Material, PBRMaterial, UnlitMaterial } from '../core/Material';
import { InstancedMesh, Mesh } from '../core/Mesh';
import type { LOD } from '../core/LOD';
import type { Object3D } from '../core/Object3D';
import type { Scene } from '../core/Scene';
import { DECAL_KINDS, type Decal } from '../core/Decal';
import { Sky } from '../core/Sky';
import { Frustum } from '../math/Bounds';
import { clamp } from '../math/MathUtils';
import { Matrix4 } from '../math/Matrix4';
import { Vector3 } from '../math/Vector3';
import { CascadedShadows } from './CascadedShadows';
import { EnvironmentMaps, createBackgroundProgram } from './Environment';
import { GLState, TEX_2D, TEX_2D_ARRAY, TEX_CUBE } from './GLState';
import { PostProcessor, PostSettings, defaultPostSettings } from './PostProcessor';
import { Program, UBO_CAMERA, UBO_LIGHTS } from './Program';
import { GpuTimer } from './GpuTimer';
import { ColorTarget, DepthTarget, GBufferTarget, createColorTarget, createDepthTarget, createGBuffer, deleteColorTarget, deleteGBuffer } from './RenderTarget';
import { Resources } from './Resources';
import { DecalAtlas } from './DecalAtlas';
import { LocalShadows, LocalShadowSettings, defaultLocalShadowSettings } from './LocalShadows';
import { depthFrag, depthVert, gbufFrag, gbufVert, pbrFrag, pbrVert } from './shaders/pbr';

export interface RendererOptions {
  canvas?: HTMLCanvasElement;
  /** MSAA sample count for the HDR scene buffer (0 = off, max = hardware limit). */
  samples?: number;
  pixelRatio?: number;
  /** Edge length of the baked sky cubemap. */
  environmentResolution?: number;
  preserveDrawingBuffer?: boolean;
}

export interface RenderInfo {
  calls: number;
  triangles: number;
  objects: number;
  visible: number;
  culled: number;
  shadowCalls: number;
  lights: number;
  programs: number;
  geometries: number;
  textures: number;
  /** CPU time spent in render() (ms) */
  cpuMs: number;
  /** smoothed frames per second (wall clock) */
  fps: number;
  frameMs: number;
  width: number;
  height: number;
  renderScale: number;
  /** GPU time of the last completed frames (ms, smoothed). 0 when EXT_disjoint_timer_query is unavailable. */
  gpuMs: number;
  /** Number of times the WebGL context was lost and successfully restored. */
  contextRestores: number;
}

interface RenderItem {
  mesh: Mesh;
  material: Material;
  flags: number;
  z: number;
  order: number;
  matId: number;
}

// program feature bits
const F_MAP = 1,
  F_NORMALMAP = 2,
  F_ORM = 4,
  F_EMISSIVEMAP = 8,
  F_TANGENT = 16,
  F_INSTANCED = 32,
  F_INSTANCED_COLOR = 64,
  F_DOUBLE = 128,
  F_ALPHATEST = 256,
  F_TRANSPARENT = 512,
  F_CLEARCOAT = 1024,
  F_UNLIT = 2048,
  F_SHADOWS = 4096,
  F_SSAO = 8192,
  F_FOG = 16384,
  F_SHEEN = 32768,
  F_ANISO = 65536,
  F_IRID = 131072,
  F_TRANSMISSION = 262144,
  F_WATER = 524288,
  F_SSS = 1048576,
  F_CONTACT = 2097152,
  F_HEIGHT = 4194304,
  F_DISPERSION = 8388608,
  /** frame-level: transmissive materials ray-march their refracted ray through the opaque depth */
  F_SSREFRACT = 16777216,
  /** G-buffer program key only: the albedo attachment exists */
  F_GBUF_ALBEDO = 33554432,
  /** Lumina 4 – material: tiling detail map / wet+dust layers; frame-level: decals, local-light shadows, PCSS */
  F_DECALS = 67108864,
  F_DETAIL = 134217728,
  F_LAYERS = 268435456,
  F_LOCALSHADOW = 536870912,
  F_PCSS = 1073741824;

const isWater = (m: Material): boolean => m.kind === 'pbr' && (m as PBRMaterial).waves > 0;

const CAM_FLOATS = 108;
// std140 layout of the `Lights` block (floats): header 0‥103, lights 104‥615, local-shadow info 616‥627,
// local-shadow matrices 628‥755, per-layer params 756‥787, decals 788‥1011 (28 floats each)
const LIGHT_FLOATS = 788 + 8 * 28;
const OFF_LOCAL = 32 * 16 + 104;
const OFF_LMAT = OFF_LOCAL + 12;
const OFF_LPAR = OFF_LMAT + 128;
const OFF_DECAL = OFF_LPAR + 32;
const MAX_DECALS = 8;
const MAX_LIGHTS = 32;

const _vp = new Matrix4();
const _vpU = new Matrix4();
const _proj = new Matrix4();
const _invVP = new Matrix4();
const ZERO4 = new Float32Array(4);

/** Halton(2,3) low-discrepancy sequence – sub-pixel jitter offsets in [0,1) for TAA. */
const HALTON: [number, number][] = (() => {
  const h = (i: number, b: number) => {
    let f = 1,
      r = 0;
    while (i > 0) {
      f /= b;
      r += f * (i % b);
      i = Math.floor(i / b);
    }
    return r;
  };
  return Array.from({ length: 16 }, (_, i) => [h(i + 1, 2), h(i + 1, 3)] as [number, number]);
})();
const _tmp = new Vector3();
const _sunDir = new Vector3();
const _frustum = new Frustum();
const _dm = new Matrix4();

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  state!: GLState;
  resources!: Resources;
  /** Called when the browser drops the GPU context / when it has been fully rebuilt. */
  onContextLost: (() => void) | null = null;
  onContextRestored: (() => void) | null = null;

  /** Tone mapping, bloom, SSAO, exposure, grading … */
  post: PostSettings = defaultPostSettings();
  shadowsEnabled = true;
  /** Resolution multiplier of the internal render buffer (0.25 – 1). */
  renderScale = 1;
  /** Automatically trades resolution for frame rate. */
  dynamicResolution = { enabled: false, targetFps: 58, minScale: 0.55, maxScale: 1 };
  /** Keep the camera aspect in sync with the canvas automatically. */
  autoAspect = true;
  /** Minimum time (ms) between two environment re-bakes while the sky is being animated. */
  environmentUpdateInterval = 90;
  /** When true, unfinished shader variants are skipped instead of stalling (no hitches when toggling features). */
  asyncCompile = true;
  /** Parallax occlusion mapping (materials with a `heightMap`). `quality` scales the ray-march step counts (0.25 – 1). */
  parallax = { enabled: true, quality: 1 };
  /** Distance (m) beyond which the parallax relief fades out to flat shading (saves the ray march on far surfaces). */
  parallaxFade = 45;
  /** Shadow atlas of spot / point lights (set `light.castShadow = true`; max 8 layers: a point light needs 6, a spot light 1). */
  localShadows: LocalShadowSettings = defaultLocalShadowSettings();
  /** Projected decals (see `Decal`): the closest 8 are used. */
  decalsEnabled = true;
  /** 0 … 1 – micro-shadowing of direct light by material cavities (ambient-occlusion maps, parallax cavities). */
  microShadowing = 0.6;

  readonly info: RenderInfo = {
    calls: 0,
    triangles: 0,
    objects: 0,
    visible: 0,
    culled: 0,
    shadowCalls: 0,
    lights: 0,
    programs: 0,
    geometries: 0,
    textures: 0,
    cpuMs: 0,
    fps: 60,
    frameMs: 16.7,
    width: 0,
    height: 0,
    renderScale: 1,
    gpuMs: 0,
    contextRestores: 0,
  };
  readonly capabilities: { maxSamples: number; gpu: string };

  private samples: number;
  private pixelRatio: number;
  private cssW = 0;
  private cssH = 0;
  private canvasW = 1;
  private canvasH = 1;
  private rw = 0;
  private rh = 0;

  private camBuf!: WebGLBuffer;
  private lightBuf!: WebGLBuffer;
  private camData = new Float32Array(CAM_FLOATS);
  private lightData = new Float32Array(LIGHT_FLOATS);

  private hdr: ColorTarget | null = null;
  private msaaFbo: WebGLFramebuffer | null = null;
  private msaaColor: WebGLRenderbuffer | null = null;
  private msaaDepth: WebGLRenderbuffer | null = null;
  private depthPre: GBufferTarget | null = null;

  private env!: EnvironmentMaps;
  private defaultSky = new Sky();
  private lastEnvUpdate = -1e9;
  private bgProgram!: Program;
  private post_!: PostProcessor;
  private csm!: CascadedShadows;
  private timer!: GpuTimer;
  private parallelExt: { COMPLETION_STATUS_KHR: number } | null = null;

  private programs = new Map<number, Program>();
  private depthPrograms = new Map<number, Program>();
  private gbufPrograms = new Map<number, Program>();
  private frameMeshes: Mesh[] = [];
  private prevVP = new Matrix4();
  private havePrev = false;
  private temporalReset = false;
  private listeners: [string, EventListener][] = [];
  private opaque: RenderItem[] = [];
  /** refractive materials: drawn after the opaque pass + background, sampling a mip-chained copy of it */
  private transmissive: RenderItem[] = [];
  private hasWater = false;
  private hasGlass = false;
  private needDepthCopy = false;
  private trans: ColorTarget | null = null;
  private depthCopy: DepthTarget | null = null;
  private transparent: RenderItem[] = [];
  private pool: RenderItem[] = [];
  private poolIndex = 0;
  private casters: Mesh[] = [];
  private ls!: LocalShadows;
  private decalAtlas: DecalAtlas | null = null;
  private decalList: Decal[] = [];
  private sortedLights: Light[] = [];
  private rawSampler: WebGLSampler | null = null;
  private dummyDepth: WebGLTexture | null = null;
  private casterSpheres = new Float64Array(256 * 4);
  private lights: Light[] = [];
  private sun: DirectionalLight | null = null;
  private textureMaterial: Material | null = null;

  private frameCount = 0;
  private lastTime = 0;
  private avgFrameMs = 16.7;
  private scaleCooldown = 0;
  private contextLost = false;

  constructor(opts: RendererOptions = {}) {
    this.canvas = opts.canvas ?? document.createElement('canvas');
    const gl = this.canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: opts.preserveDrawingBuffer ?? false,
    });
    if (!gl) throw new Error('Lumina: WebGL2 is not supported by this browser.');
    this.gl = gl;
    this.envResolution = opts.environmentResolution ?? 256;
    this.initGL();

    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.capabilities = {
      maxSamples: gl.getParameter(gl.MAX_SAMPLES) as number,
      gpu: dbg ? (gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string) : 'unknown',
    };
    this.samples = Math.min(opts.samples ?? 4, this.capabilities.maxSamples);
    this.pixelRatio = opts.pixelRatio ?? Math.min(window.devicePixelRatio || 1, 2);

    const on = (type: string, fn: EventListener) => {
      this.canvas.addEventListener(type, fn);
      this.listeners.push([type, fn]);
    };
    on('webglcontextlost', (e) => {
      e.preventDefault(); // required, otherwise the browser never restores the context
      this.contextLost = true;
      console.warn('Lumina: WebGL context lost – waiting for restore');
      this.onContextLost?.();
    });
    on('webglcontextrestored', () => {
      try {
        this.initGL();
        this.contextLost = false;
        this.info.contextRestores++;
        console.info('Lumina: WebGL context restored');
        this.onContextRestored?.();
      } catch (err) {
        console.error('Lumina: failed to restore the WebGL context', err);
      }
    });
  }

  private envResolution: number;

  /** (Re)creates every GPU object. Runs once at start-up and again after a context restore. */
  private initGL(): void {
    const gl = this.gl;
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('Lumina: EXT_color_buffer_float (HDR rendering) is required.');
    gl.getExtension('EXT_color_buffer_half_float');
    gl.getExtension('OES_texture_float_linear');
    this.parallelExt = gl.getExtension('KHR_parallel_shader_compile');

    this.resources?.invalidate(); // GPU handles of the previous context are dead – never touch them again
    this.state = new GLState(gl);
    this.resources = new Resources(gl, this.state);

    this.camBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.camBuf);
    gl.bufferData(gl.UNIFORM_BUFFER, this.camData.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, UBO_CAMERA, this.camBuf);
    this.lightBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.lightBuf);
    gl.bufferData(gl.UNIFORM_BUFFER, this.lightData.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, UBO_LIGHTS, this.lightBuf);

    this.env = new EnvironmentMaps(gl, this.state, this.envResolution);
    this.bgProgram = createBackgroundProgram(gl, this.state);
    this.post_ = new PostProcessor(gl, this.state);
    this.csm = new CascadedShadows(gl, this.state);
    this.ls = new LocalShadows(gl, this.state);
    this.decalAtlas = null;
    // sampler object that reads the cascade depth array *without* comparison (PCSS blocker search) on unit 15
    const rs = gl.createSampler()!;
    gl.samplerParameteri(rs, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.samplerParameteri(rs, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.samplerParameteri(rs, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.samplerParameteri(rs, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.samplerParameteri(rs, gl.TEXTURE_COMPARE_MODE, gl.NONE);
    gl.bindSampler(15, rs);
    this.rawSampler = rs;
    // 1×1 depth array: keeps unused shadow samplers of the fog pass valid
    const dd = gl.createTexture()!;
    this.state.bindScratch(TEX_2D_ARRAY, dd);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.DEPTH_COMPONENT24, 1, 1, 1);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    this.dummyDepth = dd;
    this.timer = new GpuTimer(gl);

    // forget every handle of the previous context (they are invalid after a restore)
    this.programs.clear();
    this.depthPrograms.clear();
    this.gbufPrograms.clear();
    this.hdr = this.depthPre = null;
    this.trans = null;
    this.depthCopy = null;
    this.msaaFbo = this.msaaColor = this.msaaDepth = null;
    this.rw = this.rh = 0;
    this.lastEnvUpdate = -1e9;
    this.frameCount = 0;
    this.havePrev = false;
    this.textureMaterial = null;
  }

  // ═════════════════════════════════ public API ═════════════════════════════════

  setPixelRatio(r: number): void {
    this.pixelRatio = r;
    if (this.cssW) this.setSize(this.cssW, this.cssH);
  }
  setSize(width: number, height: number, updateStyle = true): void {
    this.cssW = width;
    this.cssH = height;
    this.canvasW = Math.max(1, Math.floor(width * this.pixelRatio));
    this.canvasH = Math.max(1, Math.floor(height * this.pixelRatio));
    this.canvas.width = this.canvasW;
    this.canvas.height = this.canvasH;
    if (updateStyle) {
      this.canvas.style.width = width + 'px';
      this.canvas.style.height = height + 'px';
    }
  }
  /** Changes MSAA sample count at runtime (0, 2, 4, 8 – clamped to hardware). */
  setSamples(n: number): void {
    const s = Math.min(n, this.capabilities.maxSamples);
    if (s === this.samples) return;
    this.samples = s;
    this.releaseTargets();
  }
  getSamples(): number {
    return this.samples;
  }
  getDrawingBufferSize(): { width: number; height: number } {
    return { width: this.canvasW, height: this.canvasH };
  }

  /** Discards temporal history (call after teleporting / cutting the camera to avoid ghosting). */
  resetTemporal(): void {
    this.temporalReset = true;
  }

  /** Renders one frame and returns it as an image (the canvas is read in the same task, so no preserveDrawingBuffer needed). */
  screenshot(scene: Scene, camera: PerspectiveCamera, type = 'image/png', quality = 0.92): Promise<Blob> {
    this.render(scene, camera);
    return new Promise((resolve, reject) => this.canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Lumina: screenshot failed'))), type, quality));
  }

  get gpuTimerSupported(): boolean {
    return this.timer.supported;
  }

  /**
   * Pre-builds every shader variant `scene` needs with the *current* render settings, so the first frames
   * after loading (or after toggling an effect) don't hitch. Blocks until linked; throws with an annotated
   * log if a shader fails to compile. Prefer `compileAsync` for large scenes.
   */
  compile(scene: Scene): void {
    if (this.contextLost) return;
    for (const p of this.warmPrograms(scene)) p.finalize();
  }

  /** Non-blocking variant of `compile` (uses KHR_parallel_shader_compile where available). */
  compileAsync(scene: Scene): Promise<void> {
    if (this.contextLost) return Promise.resolve();
    const progs = this.warmPrograms(scene);
    return new Promise<void>((resolve, reject) => {
      const poll = () => {
        try {
          let done = true;
          for (const p of progs) if (!p.isReady()) done = false;
          if (done) resolve();
          else setTimeout(poll, 12);
        } catch (e) {
          reject(e);
        }
      };
      poll();
    });
  }

  private warmPrograms(scene: Scene): Program[] {
    const P = this.post;
    let sunPcss = false,
      hasDecals = false,
      localCasters = 0;
    const scan = (o: Object3D): void => {
      if (o.isLight) {
        const l = o as Light;
        if (l.type === 'DirectionalLight') sunPcss = sunPcss || (l as DirectionalLight).shadow.pcss;
        else if (l.castShadow) localCasters++;
      } else if ((o as Decal).isDecal) hasDecals = true;
      for (const c of o.children) scan(c);
    };
    scan(scene);
    const frame =
      (this.shadowsEnabled ? F_SHADOWS | (sunPcss ? F_PCSS : 0) | (this.localShadows.enabled && localCasters > 0 ? F_LOCALSHADOW : 0) : 0) |
      (P.ssao.enabled ? F_SSAO : 0) |
      (scene.fog ? F_FOG : 0) |
      (P.contactShadows.enabled ? F_CONTACT : 0) |
      (P.refraction.screenSpace ? F_SSREFRACT : 0) |
      (this.decalsEnabled && hasDecals ? F_DECALS : 0);
    const gbuf = P.taa.enabled || P.ssr.enabled || P.motionBlur.enabled || P.ssgi.enabled;
    const out = new Set<Program>();
    const visit = (o: Object3D): void => {
      if (o.isMesh) {
        const mesh = o as Mesh;
        const mat = mesh.material;
        if (mat.visible) {
          const flags = this.resolveFlags(this.featureFlags(mesh, mat), mesh, mat, frame);
          out.add(this.getProgram(flags));
          if (!mat.transparent) out.add(gbuf ? this.getGBufProgram(flags, P.ssgi.enabled) : this.getDepthProgram(flags));
          if (mesh.castShadow && !mat.transparent) out.add(this.getDepthProgram(this.featureFlags(mesh, mat)));
        }
      }
      for (const c of o.children) visit(c);
    };
    visit(scene);
    return [...out];
  }

  /** Renders `scene` as seen from `camera` to the canvas. */
  render(scene: Scene, camera: PerspectiveCamera): void {
    if (this.contextLost) return;
    this.timer.poll();
    this.timer.begin();
    try {
      this.renderFrame(scene, camera);
    } finally {
      this.timer.end();
    }
    this.info.gpuMs = this.timer.ms;
  }

  private renderFrame(scene: Scene, camera: PerspectiveCamera): void {
    const t0 = performance.now();
    const gl = this.gl;
    const st = this.state;
    const info = this.info;
    const nowS = t0 / 1000;
    const dt = this.lastTime ? clamp(nowS - this.lastTime, 0.0001, 0.1) : 1 / 60;
    this.lastTime = nowS;
    this.updateDynamicResolution(dt);

    info.calls = info.triangles = info.objects = info.visible = info.culled = info.shadowCalls = 0;

    if (this.autoAspect && Math.abs(camera.aspect - this.canvasW / this.canvasH) > 1e-4) {
      camera.aspect = this.canvasW / this.canvasH;
      camera.updateProjectionMatrix();
    }
    scene.updateMatrixWorld();
    camera.updateMatrixWorld();

    const rw = Math.max(1, Math.floor(this.canvasW * this.renderScale));
    const rh = Math.max(1, Math.floor(this.canvasH * this.renderScale));
    const P = this.post;
    const taaOn = P.taa.enabled;
    const needColor = taaOn || P.ssr.enabled || P.motionBlur.enabled || P.ssgi.enabled;
    const needDepthBase = needColor || P.dof.enabled || P.ssao.enabled || P.volumetricFog.enabled;

    // ── image based lighting (re-baked lazily when the sky changes) ──
    const sky = scene.sky ?? this.defaultSky;
    if (this.env.version !== sky.version && t0 - this.lastEnvUpdate > (this.env.version < 0 ? 0 : this.environmentUpdateInterval)) {
      this.env.update(sky);
      this.lastEnvUpdate = t0;
    }

    // ── per-frame camera data ──
    _vpU.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    // TAA: shift the projection by a sub-pixel Halton offset (the camera object itself is never modified)
    let jx = 0,
      jy = 0;
    if (taaOn) {
      const hj = HALTON[this.frameCount & 15];
      jx = ((hj[0] - 0.5) * P.taa.jitter * 2) / rw;
      jy = ((hj[1] - 0.5) * P.taa.jitter * 2) / rh;
    }
    _proj.copy(camera.projectionMatrix);
    _proj.elements[8] -= jx;
    _proj.elements[9] -= jy;
    _vp.multiplyMatrices(_proj, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_vpU);
    if (!this.havePrev) {
      this.prevVP.copy(_vpU);
      this.havePrev = true;
    }
    const cd = this.camData;
    cd.set(camera.matrixWorldInverse.elements, 0);
    cd.set(_proj.elements, 16);
    cd.set(_vp.elements, 32);
    cd.set(_invVP.copy(_vp).invert().elements, 48);
    camera.getWorldPosition(_tmp);
    cd[64] = _tmp.x;
    cd[65] = _tmp.y;
    cd[66] = _tmp.z;
    cd[67] = nowS % 3600;
    cd[68] = rw;
    cd[69] = rh;
    cd[70] = 1 / rw;
    cd[71] = 1 / rh;
    cd[72] = camera.near;
    cd[73] = camera.far;
    cd[74] = jx;
    cd[75] = jy;
    cd.set(this.prevVP.elements, 76);
    cd.set(_vpU.elements, 92);
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.camBuf);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, cd);

    // ── gather ──
    this.collect(scene, camera);

    const sun = this.sun;
    // water needs the opaque depth behind it, contact shadows need the scene depth: both force a depth pre-pass
    const needContact = P.contactShadows.enabled && !!sun && sun.intensity > 0;
    const refractSS = P.refraction.screenSpace && this.hasGlass;
    // refractive surfaces ray-march the *opaque* depth: it is snapshotted before they are written
    this.needDepthCopy = this.hasWater || refractSS;
    const needDepth = needDepthBase || this.needDepthCopy || needContact;
    this.ensureTargets(rw, rh, needDepth, needColor, P.ssgi.enabled);
    const useShadows = this.shadowsEnabled && !!sun && sun.castShadow && this.casters.length > 0;
    const useSSAO = this.post.ssao.enabled;
    const useGBuf = needColor && !!this.depthPre && this.depthPre.hasColor;
    // volumetric fog needs its own shadow-mapped sun, and a depth buffer to raymarch against
    // spot / point lights: priority order (shadow casters first, then nearest), shadow atlas planning
    this.sortLights(camera);
    this.ls.plan(this.shadowsEnabled && this.casters.length > 0 ? this.sortedLights : [], this.localShadows);
    const useLocalShadows = this.ls.active;
    const usePCSS = useShadows && sun!.shadow.pcss;
    const decalCount = this.decalsEnabled ? Math.min(this.decalList.length, MAX_DECALS) : 0;
    // volumetric fog is driven by the sun's cascades and by local lights (god rays), so either is enough
    const useVolumetricFog = this.post.volumetricFog.enabled && (useShadows || this.lights.length > 0);
    const useDepthPre = useSSAO || useVolumetricFog || needDepth;
    const useContact = needContact && !!this.depthPre;
    const fog = scene.fog;

    if (useShadows) this.renderShadows(sun!, camera);
    if (useLocalShadows) this.renderLocalShadows();
    if (useDepthPre) this.renderDepthPrepass(_vp, useGBuf);
    const aoTex = useSSAO ? this.post_.renderSSAO(this.depthPre!.texture, camera, this.post.ssao, rw, rh) : null;

    this.fillLights(scene, camera, sun, useShadows, decalCount);

    // ── main HDR pass ──
    const sceneFbo = this.samples > 0 ? this.msaaFbo! : this.hdr!.fbo;
    st.bindFramebuffer(sceneFbo);
    st.setViewport(0, 0, rw, rh);
    st.setDepth(true, true);
    st.setColorMask(true);
    st.setBlend(0);
    st.setSide(0);
    const bg = scene.background;
    gl.clearColor(bg ? bg.r : 0, bg ? bg.g : 0, bg ? bg.b : 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    st.bindTexture(0, TEX_CUBE, this.env.irradiance);
    st.bindTexture(1, TEX_CUBE, this.env.prefilter);
    st.bindTexture(2, TEX_2D, this.env.brdfLut);
    if (useShadows && this.csm.texture) st.bindTexture(3, TEX_2D_ARRAY, this.csm.texture);
    if (usePCSS && this.csm.texture) st.bindTexture(15, TEX_2D_ARRAY, this.csm.texture);
    if (useLocalShadows && this.ls.texture) st.bindTexture(14, TEX_2D_ARRAY, this.ls.texture);
    if (decalCount > 0) {
      if (!this.decalAtlas) this.decalAtlas = new DecalAtlas(gl, st);
      st.bindTexture(10, TEX_2D_ARRAY, this.decalAtlas.texture);
    }
    if (aoTex) st.bindTexture(4, TEX_2D, aoTex);
    st.bindTexture(9, TEX_CUBE, this.env.backgroundCube);
    const sceneDepthTex = this.needDepthCopy && this.depthCopy ? this.depthCopy.texture : this.depthPre ? this.depthPre.texture : null;
    if (sceneDepthTex && (useContact || this.needDepthCopy)) st.bindTexture(12, TEX_2D, sceneDepthTex);

    for (const p of this.programs.values()) p.lastMaterial = null;
    this.textureMaterial = null;
    const frameFlags =
      (useShadows ? F_SHADOWS | (usePCSS ? F_PCSS : 0) : 0) |
      (useLocalShadows ? F_LOCALSHADOW : 0) |
      (decalCount > 0 ? F_DECALS : 0) |
      (useSSAO ? F_SSAO : 0) |
      (fog ? F_FOG : 0) |
      (useContact ? F_CONTACT : 0) |
      (refractSS && this.depthCopy ? F_SSREFRACT : 0);
    if (useContact) this.contact = P.contactShadows;

    this.opaque.sort((a, b) => a.order - b.order || a.flags - b.flags || a.matId - b.matId || a.z - b.z);
    for (let i = 0; i < this.opaque.length; i++) this.drawItem(this.opaque[i], frameFlags);

    if (scene.sky) this.drawBackground(sky);

    // ── refractive materials (glass, liquids, water) ──
    if (this.transmissive.length) {
      this.captureTransmission(sceneFbo, rw, rh);
      this.transmissive.sort((a, b) => a.order - b.order || a.z - b.z);
      for (let i = 0; i < this.transmissive.length; i++) this.drawItem(this.transmissive[i], frameFlags);
    }

    this.transparent.sort((a, b) => a.order - b.order || b.z - a.z);
    for (let i = 0; i < this.transparent.length; i++) this.drawItem(this.transparent[i], frameFlags);

    // ── resolve MSAA ──
    if (this.samples > 0) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msaaFbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.hdr!.fbo);
      gl.blitFramebuffer(0, 0, rw, rh, 0, 0, rw, rh, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      st.invalidateFramebuffer();
    }

    // ── post processing ──
    const p = this.post;
    const hdrTex = this.hdr!.texture;
    const fogTex = useVolumetricFog
      ? this.post_.renderVolumetricFog(
          this.depthPre!.texture,
          useShadows && this.csm.texture ? this.csm.texture : this.dummyDepth!,
          useLocalShadows && this.ls.texture ? this.ls.texture : this.dummyDepth!,
          camera,
          p.volumetricFog,
          p.volumetricFog.localLights ? Math.min(this.sortedLights.length, Math.min(12, this.localShadows.maxFogLights)) : 0,
          rw,
          rh
        )
      : null;

    // ── G-buffer driven effects: SSR → TAA → DoF → motion blur (each reads the previous result) ──
    let cur = hdrTex;
    const gb = this.depthPre;
    if (gb && useGBuf) {
      if (p.ssgi.enabled && gb.hasAlbedo) cur = this.post_.renderSSGI(cur, gb, p.ssgi, rw, rh, this.frameCount, this.temporalReset, camera.getWorldPosition(_tmp));
      else this.post_.resetGI();
      if (p.ssr.enabled) {
        const ssrTex = this.post_.renderSSR(cur, gb, camera, p.ssr, rw, rh, this.frameCount);
        cur = this.post_.applySSR(cur, ssrTex, gb, this.env.prefilter, p.ssr.intensity, rw, rh);
      }
      if (taaOn) cur = this.post_.resolveTAA(cur, gb, p.taa, rw, rh, this.temporalReset);
    }
    if (!taaOn) this.post_.resetHistory();
    if (gb && p.dof.enabled) cur = this.post_.dof(cur, gb, p.dof, rw, rh);
    if (gb && useGBuf && p.motionBlur.enabled) cur = this.post_.motionBlur(cur, gb, p.motionBlur, rw, rh);

    const bloomTex = p.bloom.enabled || p.lensFlare.enabled || p.halation > 0 || p.lensDirt > 0 ? this.post_.renderBloom(cur, p.bloom, rw, rh) : null;
    const flareTex = p.lensFlare.enabled && bloomTex ? this.post_.renderLensFlare(p.lensFlare, rw, rh) : null;
    if (p.autoExposure) this.post_.updateAutoExposure(hdrTex, rw, rh, dt, p);
    this.post_.composite(cur, bloomTex, fogTex, flareTex, p, nowS, this.canvasW, this.canvasH);

    // ── remember this frame for the next frame's motion vectors ──
    this.prevVP.copy(_vpU);
    for (let i = 0; i < this.frameMeshes.length; i++) {
      const m = this.frameMeshes[i];
      if (m.prevWorldVersion !== m.worldVersion) {
        m.prevMatrixWorld.copy(m.matrixWorld);
        m.prevWorldVersion = m.worldVersion;
      }
    }
    this.temporalReset = false;

    // ── stats ──
    info.lights = this.lights.length;
    info.programs = this.programs.size + this.depthPrograms.size + this.gbufPrograms.size;
    info.geometries = this.resources.geometryCount;
    info.textures = this.resources.textureCount;
    info.width = rw;
    info.height = rh;
    info.renderScale = this.renderScale;
    info.cpuMs = performance.now() - t0;
    this.frameCount++;
  }

  dispose(): void {
    for (const [t, fn] of this.listeners) this.canvas.removeEventListener(t, fn);
    this.listeners = [];
    this.timer.dispose();
    this.releaseTargets();
    this.env.dispose();
    this.post_.dispose();
    this.csm.dispose();
    this.ls.dispose();
    this.decalAtlas?.dispose();
    if (this.rawSampler) this.gl.deleteSampler(this.rawSampler);
    if (this.dummyDepth) this.gl.deleteTexture(this.dummyDepth);
    for (const p of this.programs.values()) p.dispose();
    for (const p of this.depthPrograms.values()) p.dispose();
    for (const p of this.gbufPrograms.values()) p.dispose();
    this.bgProgram.dispose();
    this.gl.deleteBuffer(this.camBuf);
    this.gl.deleteBuffer(this.lightBuf);
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  // ═════════════════════════════════ internals ═════════════════════════════════

  private updateDynamicResolution(dt: number): void {
    const ms = dt * 1000;
    this.avgFrameMs += (ms - this.avgFrameMs) * 0.08;
    this.info.frameMs = this.avgFrameMs;
    this.info.fps = 1000 / this.avgFrameMs;
    const d = this.dynamicResolution;
    if (!d.enabled) return;
    if (this.scaleCooldown > 0) {
      this.scaleCooldown--;
      return;
    }
    const target = 1000 / d.targetFps;
    if (this.avgFrameMs > target * 1.22 && this.renderScale > d.minScale) {
      this.renderScale = Math.max(d.minScale, this.renderScale - 0.08);
      this.scaleCooldown = 40;
    } else if (this.avgFrameMs < target * 1.06 && this.renderScale < d.maxScale) {
      this.renderScale = Math.min(d.maxScale, this.renderScale + 0.04);
      this.scaleCooldown = 150;
    }
  }

  private releaseTargets(): void {
    const gl = this.gl;
    deleteColorTarget(gl, this.state, this.hdr);
    deleteGBuffer(gl, this.state, this.depthPre);
    deleteColorTarget(gl, this.state, this.trans);
    deleteColorTarget(gl, this.state, this.depthCopy);
    this.trans = null;
    this.depthCopy = null;
    if (this.msaaFbo) gl.deleteFramebuffer(this.msaaFbo);
    if (this.msaaColor) gl.deleteRenderbuffer(this.msaaColor);
    if (this.msaaDepth) gl.deleteRenderbuffer(this.msaaDepth);
    this.hdr = this.depthPre = null;
    this.msaaFbo = this.msaaColor = this.msaaDepth = null;
    this.rw = this.rh = 0;
  }

  private ensureTargets(w: number, h: number, needDepth: boolean, needColor: boolean, needAlbedo: boolean): void {
    const gl = this.gl;
    if (w !== this.rw || h !== this.rh || !this.hdr) {
      this.releaseTargets();
      this.rw = w;
      this.rh = h;
      this.hdr = createColorTarget(gl, this.state, w, h, gl.RGBA16F, { depthBuffer: this.samples === 0 });
      if (this.samples > 0) {
        this.msaaFbo = gl.createFramebuffer()!;
        this.msaaColor = gl.createRenderbuffer()!;
        this.msaaDepth = gl.createRenderbuffer()!;
        gl.bindRenderbuffer(gl.RENDERBUFFER, this.msaaColor);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.RGBA16F, w, h);
        gl.bindRenderbuffer(gl.RENDERBUFFER, this.msaaDepth);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.DEPTH_COMPONENT24, w, h);
        this.state.bindFramebuffer(this.msaaFbo);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.msaaColor);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.msaaDepth);
        const s = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (s !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Lumina: MSAA framebuffer incomplete 0x' + s.toString(16));
      }
      this.post_.resize(w, h);
    }
    if (needDepth) {
      if (this.depthPre && needColor && (!this.depthPre.hasColor || this.depthPre.hasAlbedo !== needAlbedo)) {
        deleteGBuffer(gl, this.state, this.depthPre);
        this.depthPre = null;
      }
      if (!this.depthPre) this.depthPre = createGBuffer(gl, this.state, w, h, needColor, needAlbedo);
    }
  }

  // ───────────────────────── scene traversal & culling ─────────────────────────

  private newItem(): RenderItem {
    if (this.poolIndex >= this.pool.length) this.pool.push({ mesh: null as unknown as Mesh, material: null as unknown as Material, flags: 0, z: 0, order: 0, matId: 0 });
    return this.pool[this.poolIndex++];
  }

  private collect(scene: Scene, camera: PerspectiveCamera): void {
    this.opaque.length = 0;
    this.transparent.length = 0;
    this.casters.length = 0;
    this.transmissive.length = 0;
    this.hasWater = false;
    this.hasGlass = false;
    this.frameMeshes.length = 0;
    this.lights.length = 0;
    this.decalList.length = 0;
    this.sun = null;
    this.poolIndex = 0;
    this.visit(scene, camera);
  }

  private visit(o: Object3D, camera: PerspectiveCamera): void {
    if (!o.visible) return;
    if ((o as LOD).isLOD) (o as LOD).update(camera);
    if (o.isLight) {
      const l = o as Light;
      if (l.type === 'DirectionalLight') {
        if (!this.sun && l.intensity > 0) this.sun = l as DirectionalLight;
      } else this.lights.push(l);
    } else if ((o as Decal).isDecal) {
      this.decalList.push(o as Decal);
    } else if (o.isMesh) {
      const mesh = o as Mesh;
      const mat = mesh.material;
      this.info.objects++;
      this.frameMeshes.push(mesh);
      if (mesh.prevWorldVersion < 0) {
        mesh.prevMatrixWorld.copy(mesh.matrixWorld);
        mesh.prevWorldVersion = mesh.worldVersion;
      }
      if (mat.visible && (!(mesh as InstancedMesh).instanceMatrix || (mesh as InstancedMesh).count > 0)) {
        const s = mesh.getWorldSphere();
        if (mesh.castShadow && !mat.transparent && !isWater(mat)) {
          const i = this.casters.length;
          if ((i + 1) * 4 > this.casterSpheres.length) {
            const n = new Float64Array(this.casterSpheres.length * 2);
            n.set(this.casterSpheres);
            this.casterSpheres = n;
          }
          this.casterSpheres.set(s, i * 4);
          this.casters.push(mesh);
        }
        if (!mesh.frustumCulled || _frustum.intersectsSphere(s[0], s[1], s[2], s[3])) {
          const v = camera.matrixWorldInverse.elements;
          const z = -(v[2] * s[0] + v[6] * s[1] + v[10] * s[2] + v[14]);
          const it = this.newItem();
          it.mesh = mesh;
          it.material = mat;
          it.z = z;
          it.order = mesh.renderOrder;
          it.matId = mat.id;
          it.flags = this.featureFlags(mesh, mat);
          if (it.flags & F_TRANSMISSION) {
            this.transmissive.push(it);
            if (it.flags & F_WATER) this.hasWater = true;
            else this.hasGlass = true;
          } else (mat.transparent ? this.transparent : this.opaque).push(it);
          this.info.visible++;
        } else this.info.culled++;
      }
    }
    const ch = o.children;
    for (let i = 0; i < ch.length; i++) this.visit(ch[i], camera);
  }

  /** Adds the frame-level feature bits (shadows, fog, decals …) that apply to this mesh / material. */
  private resolveFlags(base: number, mesh: Mesh, mat: Material, frame: number): number {
    let flags = base;
    if (!(flags & F_UNLIT)) {
      flags |= frame & (F_SSAO | F_FOG);
      if (mesh.receiveShadow) flags |= frame & (F_SHADOWS | F_PCSS | F_LOCALSHADOW | (flags & F_WATER ? 0 : F_CONTACT));
      if (flags & F_TRANSMISSION) {
        if (!(flags & F_WATER)) flags |= frame & F_SSREFRACT;
      } else if (frame & F_DECALS && (mat as PBRMaterial).receiveDecals) flags |= F_DECALS;
    }
    return flags;
  }

  private featureFlags(mesh: Mesh, m: Material): number {
    let f = 0;
    const inst = mesh as InstancedMesh;
    if (inst.instanceMatrix) {
      f |= F_INSTANCED;
      if (inst.instanceColor) f |= F_INSTANCED_COLOR;
    }
    if (m.side === DoubleSide) f |= F_DOUBLE;
    if (m.alphaTest > 0) f |= F_ALPHATEST;
    if (m.transparent) f |= F_TRANSPARENT;
    if (m.kind === 'unlit') {
      f |= F_UNLIT;
      if ((m as UnlitMaterial).map) f |= F_MAP;
    } else {
      const p = m as PBRMaterial;
      if (p.map) f |= F_MAP;
      if (p.normalMap) f |= F_NORMALMAP;
      if (p.anisotropy !== 0) f |= F_ANISO;
      const heightOn = !!p.heightMap && this.parallax.enabled;
      if (heightOn) f |= F_HEIGHT;
      if (p.detailMap) f |= F_DETAIL;
      if (p.layers || p.wetness > 0.001 || p.dust > 0.001 || p.snow > 0.001) f |= F_LAYERS;
      if ((p.normalMap || p.anisotropy !== 0 || heightOn || p.detailMap) && mesh.geometry.attributes.tangent) f |= F_TANGENT;
      if (p.ormMap) f |= F_ORM;
      if (p.emissiveMap) f |= F_EMISSIVEMAP;
      if (p.clearcoat > 0) f |= F_CLEARCOAT;
      if (p.sheen > 0) f |= F_SHEEN;
      if (p.iridescence > 0) f |= F_IRID;
      if (p.subsurface > 0) f |= F_SSS;
      if (p.isTransmissive) {
        f |= F_TRANSMISSION;
        if (p.waves > 0) f |= F_WATER;
        else if (p.dispersion > 0) f |= F_DISPERSION;
      }
    }
    return f;
  }

  // ───────────────────────────────── programs ─────────────────────────────────

  private getProgram(flags: number): Program {
    let p = this.programs.get(flags);
    if (!p) {
      const d: string[] = [];
      if (flags & F_MAP) d.push('USE_MAP');
      if (flags & F_NORMALMAP) d.push('USE_NORMALMAP');
      if (flags & F_ORM) d.push('USE_ORM');
      if (flags & F_EMISSIVEMAP) d.push('USE_EMISSIVEMAP');
      if (flags & F_TANGENT) d.push('USE_TANGENT');
      if (flags & F_INSTANCED) d.push('INSTANCED');
      if (flags & F_INSTANCED_COLOR) d.push('INSTANCED_COLOR');
      if (flags & F_DOUBLE) d.push('DOUBLE_SIDED');
      if (flags & F_ALPHATEST) d.push('ALPHA_TEST');
      if (flags & F_TRANSPARENT) d.push('TRANSPARENT');
      if (flags & F_CLEARCOAT) d.push('USE_CLEARCOAT');
      if (flags & F_UNLIT) d.push('UNLIT');
      if (flags & F_SHADOWS) d.push('USE_SHADOWS');
      if (flags & F_SSAO) d.push('USE_SSAO');
      if (flags & F_FOG) d.push('USE_FOG');
      if (flags & F_SHEEN) d.push('USE_SHEEN');
      if (flags & F_ANISO) d.push('USE_ANISO');
      if (flags & F_IRID) d.push('USE_IRIDESCENCE');
      if (flags & F_TRANSMISSION) d.push('USE_TRANSMISSION');
      if (flags & F_WATER) d.push('USE_WATER');
      if (flags & F_SSS) d.push('USE_SSS');
      if (flags & F_CONTACT) d.push('USE_CONTACT');
      if (flags & F_HEIGHT) d.push('USE_HEIGHT');
      if (flags & F_DISPERSION) d.push('USE_DISPERSION');
      if (flags & F_SSREFRACT) d.push('USE_SSREFRACT');
      if (flags & F_DECALS) d.push('USE_DECALS');
      if (flags & F_DETAIL) d.push('USE_DETAIL');
      if (flags & F_LAYERS) d.push('USE_LAYERS');
      if (flags & F_LOCALSHADOW) d.push('USE_LOCAL_SHADOWS');
      if (flags & F_PCSS) d.push('USE_PCSS');
      p = new Program(this.gl, this.state, pbrVert, pbrFrag, d, 'pbr[' + d.join(',') + ']', this.parallelExt);
      this.programs.set(flags, p);
    }
    return p;
  }

  private getDepthProgram(flags: number): Program {
    const key = flags & (F_INSTANCED | F_ALPHATEST | F_MAP);
    let p = this.depthPrograms.get(key);
    if (!p) {
      const d: string[] = [];
      if (key & F_INSTANCED) d.push('INSTANCED');
      if (key & F_ALPHATEST) d.push('ALPHA_TEST');
      if (key & F_MAP) d.push('USE_MAP');
      p = new Program(this.gl, this.state, depthVert, depthFrag, d, 'depth[' + d.join(',') + ']', this.parallelExt);
      this.depthPrograms.set(key, p);
    }
    return p;
  }

  private getGBufProgram(flags: number, albedo: boolean): Program {
    const key = (flags & (F_INSTANCED | F_INSTANCED_COLOR | F_ALPHATEST | F_MAP | F_ORM | F_DOUBLE | F_UNLIT)) | (albedo ? F_GBUF_ALBEDO : 0);
    let p = this.gbufPrograms.get(key);
    if (!p) {
      const d: string[] = [];
      if (key & F_INSTANCED) d.push('INSTANCED');
      if (key & F_INSTANCED_COLOR) d.push('INSTANCED_COLOR');
      if (key & F_GBUF_ALBEDO) d.push('GBUF_ALBEDO');
      if (key & F_ALPHATEST) d.push('ALPHA_TEST');
      if (key & F_MAP) d.push('USE_MAP');
      if (key & F_ORM) d.push('USE_ORM');
      if (key & F_DOUBLE) d.push('DOUBLE_SIDED');
      if (key & F_UNLIT) d.push('UNLIT');
      p = new Program(this.gl, this.state, gbufVert, gbufFrag, d, 'gbuf[' + d.join(',') + ']', this.parallelExt);
      this.gbufPrograms.set(key, p);
    }
    return p;
  }

  private ready(p: Program): boolean {
    if (p.isReady()) return true;
    if (!this.asyncCompile || this.frameCount < 2) {
      p.finalize();
      return true;
    }
    return false;
  }

  // ───────────────────────────────── drawing ─────────────────────────────────

  private drawGeometry(mesh: Mesh): void {
    const gl = this.gl;
    const inst = mesh as InstancedMesh;
    const geo = inst.instanceMatrix ? inst.getRenderGeometry() : mesh.geometry;
    const rec = this.resources.getVAO(geo);
    this.state.bindVAO(rec.vao);
    const range = geo.drawRange;
    let tris: number;
    if (geo.index) {
      const total = geo.index.count;
      const start = Math.min(range.start, total);
      const count = Math.min(total - start, range.count);
      if (inst.instanceMatrix) gl.drawElementsInstanced(gl.TRIANGLES, count, rec.indexType, start * rec.indexBytes, inst.count);
      else gl.drawElements(gl.TRIANGLES, count, rec.indexType, start * rec.indexBytes);
      tris = count / 3;
    } else {
      const total = geo.vertexCount;
      const start = Math.min(range.start, total);
      const count = Math.min(total - start, range.count);
      if (inst.instanceMatrix) gl.drawArraysInstanced(gl.TRIANGLES, start, count, inst.count);
      else gl.drawArrays(gl.TRIANGLES, start, count);
      tris = count / 3;
    }
    this.info.calls++;
    this.info.triangles += tris * (inst.instanceMatrix ? inst.count : 1);
  }

  private drawItem(item: RenderItem, frameFlags: number): void {
    const gl = this.gl;
    const st = this.state;
    const mesh = item.mesh;
    const mat = item.material;
    const flags = this.resolveFlags(item.flags, mesh, mat, frameFlags);
    const program = this.getProgram(flags);
    if (!this.ready(program)) return;
    program.use();
    const L = program.loc;

    if (this.textureMaterial !== mat) {
      if (mat.kind === 'pbr') {
        const m = mat as PBRMaterial;
        if (m.map) st.bindTexture(5, TEX_2D, this.resources.getTexture(m.map));
        if (m.normalMap) st.bindTexture(6, TEX_2D, this.resources.getTexture(m.normalMap));
        if (m.ormMap) st.bindTexture(7, TEX_2D, this.resources.getTexture(m.ormMap));
        if (m.emissiveMap) st.bindTexture(8, TEX_2D, this.resources.getTexture(m.emissiveMap));
        if (m.heightMap && flags & F_HEIGHT) st.bindTexture(13, TEX_2D, this.resources.getTexture(m.heightMap));
        if (m.detailMap && flags & F_DETAIL) st.bindTexture(9, TEX_2D, this.resources.getTexture(m.detailMap));
      } else {
        const m = mat as UnlitMaterial;
        if (m.map) st.bindTexture(5, TEX_2D, this.resources.getTexture(m.map));
      }
      this.textureMaterial = mat;
    }
    if (program.lastMaterial !== mat) {
      program.lastMaterial = mat;
      if (mat.kind === 'pbr') {
        const m = mat as PBRMaterial;
        gl.uniform4f(L.uBaseColor, m.color.r, m.color.g, m.color.b, m.opacity);
        gl.uniform3f(L.uEmissive, m.emissive.r * m.emissiveIntensity, m.emissive.g * m.emissiveIntensity, m.emissive.b * m.emissiveIntensity);
        gl.uniform2f(L.uRoughMetal, m.roughness, m.metalness);
        gl.uniform2f(L.uClearcoat, m.clearcoat, m.clearcoatRoughness);
        gl.uniform1f(L.uNormalScale, m.normalScale);
        gl.uniform1f(L.uEnvIntensity, m.envMapIntensity);
        gl.uniform1f(L.uAoStrength, m.aoMapIntensity);
        gl.uniform4f(L.uUvTransform, m.uvTransform[0], m.uvTransform[1], m.uvTransform[2], m.uvTransform[3]);
        const f0 = ((m.ior - 1) / (m.ior + 1)) ** 2;
        gl.uniform2f(L.uSpec, Number.isFinite(f0) ? f0 : 0.04, m.specularIntensity);
        if (flags & F_SHEEN) gl.uniform4f(L.uSheen, m.sheenColor.r * m.sheen, m.sheenColor.g * m.sheen, m.sheenColor.b * m.sheen, m.sheenRoughness);
        if (flags & F_ANISO) gl.uniform4f(L.uAniso, clamp(m.anisotropy, -1, 1), Math.cos(m.anisotropyRotation), Math.sin(m.anisotropyRotation), 0);
        if (flags & F_IRID) gl.uniform4f(L.uIrid, clamp(m.iridescence, 0, 1), m.iridescenceIOR, m.iridescenceThickness, 0);
        if (flags & F_SSS) gl.uniform4f(L.uSSS, m.subsurfaceColor.r, m.subsurfaceColor.g, m.subsurfaceColor.b, clamp(m.subsurface, 0, 1));
        if (flags & F_WATER) gl.uniform4f(L.uWave, m.waves, m.waveScale, m.waveSpeed, 0);
        if (flags & F_TRANSMISSION) {
          // Beer–Lambert coefficient: colour after `attenuationDistance` metres → per-metre absorption
          const d = m.attenuationDistance;
          const k = (c: number) => (Number.isFinite(d) && d > 0 ? -Math.log(Math.max(c, 1e-4)) / d : 0);
          gl.uniform3f(L.uAttCoeff, k(m.attenuationColor.r), k(m.attenuationColor.g), k(m.attenuationColor.b));
        }
        if (flags & F_CONTACT) gl.uniform4f(L.uContact, this.contact.length, this.contact.thickness, this.contact.strength, 0);
        if (flags & F_HEIGHT) {
          gl.uniform4f(L.uPOM, Math.max(0, m.parallaxScale), clamp(m.parallaxMinSteps, 4, 64), clamp(m.parallaxMaxSteps, 4, 64), this.parallaxFade);
          gl.uniform4f(L.uPOM2, clamp(m.parallaxSelfShadow, 0, 1), clamp(m.parallaxAO, 0, 1), clamp(this.parallax.quality, 0.15, 1), 0);
          gl.uniform2f(L.uPOM3, clamp(m.parallaxNormalBlend, 0, 1), m.parallaxLocalShadow ? 1 : 0);
        }
        if (flags & F_DETAIL) gl.uniform4f(L.uDetail, Math.max(0.01, m.detailScale), m.detailNormalScale, m.detailRoughness, Math.max(0.5, m.detailDistance));
        if (flags & F_LAYERS) {
          gl.uniform4f(L.uLayers, clamp(m.wetness, 0, 1), clamp(m.dust, 0, 1), Math.max(0.01, m.layerScale), clamp(m.snow, 0, 1));
          gl.uniform3f(L.uDustColor, m.dustColor.r, m.dustColor.g, m.dustColor.b);
        }
        if (flags & F_SSREFRACT) {
          const rf = this.post.refraction;
          gl.uniform4f(L.uRefr, clamp(rf.bend, 0, 1), clamp(Math.round(rf.steps), 6, 64), Math.max(0.1, rf.maxDistance), Math.max(0.02, rf.thickness));
        }
        if (flags & F_DISPERSION) gl.uniform1f(L.uDisp, Math.max(0, m.dispersion));
      } else {
        const m = mat as UnlitMaterial;
        gl.uniform4f(L.uBaseColor, m.color.r, m.color.g, m.color.b, m.opacity);
        gl.uniform3f(L.uEmissive, m.intensity, 0, 0);
        gl.uniform4f(L.uUvTransform, 1, 1, 0, 0);
      }
      gl.uniform1f(L.uAlphaCutoff, mat.alphaTest);
    }

    gl.uniformMatrix4fv(L.uModel, false, mesh.matrixWorld.elements);
    if (!(flags & F_INSTANCED)) {
      if (mesh.normalMatrixVersion !== mesh.worldVersion) {
        mesh.normalMatrix.setNormalMatrix(mesh.matrixWorld);
        mesh.normalMatrixVersion = mesh.worldVersion;
      }
      gl.uniformMatrix3fv(L.uNormalMatrix, false, mesh.normalMatrix.elements);
    }

    if (flags & F_TRANSMISSION) {
      const tm = mat as PBRMaterial;
      // thickness lives in the mesh's local units → scale to metres
      gl.uniform4f(L.uTrans, clamp(tm.transmission, 0, 1), tm.thickness * mesh.matrixWorld.getMaxScaleOnAxis(), 0, tm.ior);
    }

    st.setSide(mat.side);
    st.setDepth(mat.depthTest, mat.depthWrite && !mat.transparent);
    st.setBlend(mat.transparent ? (mat.additive ? 2 : 1) : 0);
    this.drawGeometry(mesh);
  }

  private drawDepthMesh(mesh: Mesh, program: Program, flags: number): void {
    const gl = this.gl;
    const mat = mesh.material;
    const L = program.loc;
    if (flags & F_ALPHATEST) {
      const base = mat.kind === 'pbr' ? (mat as PBRMaterial) : null;
      const map = base ? base.map : (mat as UnlitMaterial).map;
      if (map) this.state.bindTexture(5, TEX_2D, this.resources.getTexture(map));
      gl.uniform4f(L.uBaseColor, 1, 1, 1, mat.opacity);
      const t = base ? base.uvTransform : [1, 1, 0, 0];
      gl.uniform4f(L.uUvTransform, t[0], t[1], t[2], t[3]);
      gl.uniform1f(L.uAlphaCutoff, mat.alphaTest);
    }
    gl.uniformMatrix4fv(L.uModel, false, mesh.matrixWorld.elements);
    this.state.setSide(mat.side);
    this.drawGeometry(mesh);
  }

  private drawGBufMesh(mesh: Mesh, program: Program, flags: number): void {
    const gl = this.gl;
    const st = this.state;
    const mat = mesh.material;
    const L = program.loc;
    gl.uniformMatrix4fv(L.uModel, false, mesh.matrixWorld.elements);
    gl.uniformMatrix4fv(L.uPrevModel, false, mesh.prevMatrixWorld.elements);
    if (!(flags & F_INSTANCED)) {
      if (mesh.normalMatrixVersion !== mesh.worldVersion) {
        mesh.normalMatrix.setNormalMatrix(mesh.matrixWorld);
        mesh.normalMatrixVersion = mesh.worldVersion;
      }
      gl.uniformMatrix3fv(L.uNormalMatrix, false, mesh.normalMatrix.elements);
    }
    if (mat.kind === 'pbr') {
      const m = mat as PBRMaterial;
      if (m.map) st.bindTexture(5, TEX_2D, this.resources.getTexture(m.map));
      if (m.ormMap) st.bindTexture(7, TEX_2D, this.resources.getTexture(m.ormMap));
      gl.uniform4f(L.uBaseColor, m.color.r, m.color.g, m.color.b, m.opacity);
      gl.uniform2f(L.uRoughMetal, m.roughness, m.metalness);
      gl.uniform4f(L.uUvTransform, m.uvTransform[0], m.uvTransform[1], m.uvTransform[2], m.uvTransform[3]);
    } else {
      const m = mat as UnlitMaterial;
      if (m.map) st.bindTexture(5, TEX_2D, this.resources.getTexture(m.map));
      gl.uniform4f(L.uBaseColor, m.color.r, m.color.g, m.color.b, m.opacity);
      gl.uniform2f(L.uRoughMetal, 1, 0);
      gl.uniform4f(L.uUvTransform, 1, 1, 0, 0);
    }
    gl.uniform1f(L.uAlphaCutoff, mat.alphaTest);
    st.setSide(mat.side);
    this.drawGeometry(mesh);
  }

  private drawBackground(sky: Sky): void {
    const gl = this.gl;
    const p = this.bgProgram;
    p.use();
    this.state.setDepth(true, false);
    this.state.setSide(2);
    this.state.setBlend(0);
    this.state.bindVAO(null);
    gl.uniform3f(p.loc.uSunDir, sky.sunDirection.x, sky.sunDirection.y, sky.sunDirection.z);
    gl.uniform3f(p.loc.uSunE, this.env.sunE.r, this.env.sunE.g, this.env.sunE.b);
    gl.uniform1f(p.loc.uSunSize, sky.sunDiskScale);
    gl.uniform4f(p.loc.uCloud, this.env.cloudsActive ? sky.cloudCoverage : 0, sky.cloudDensity, sky.cloudScale, Math.max(0, sky.stars));
    gl.uniform2f(p.loc.uCloudOffset, sky.cloudOffset.x, sky.cloudOffset.y);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.info.calls++;
  }

  // ───────────────────────────────── passes ─────────────────────────────────

  private contact: PostSettings['contactShadows'] = defaultPostSettings().contactShadows;

  /** Resolves the scene rendered so far into a mip-chained texture (unit 11) that refractive surfaces sample. */
  private captureTransmission(src: WebGLFramebuffer, w: number, h: number): void {
    const gl = this.gl;
    const st = this.state;
    if (!this.trans || this.trans.width !== w || this.trans.height !== h) {
      deleteColorTarget(gl, st, this.trans);
      this.trans = createColorTarget(gl, st, w, h, gl.RGBA16F, { mipmaps: true });
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.trans.fbo);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    st.invalidateFramebuffer();
    st.bindScratch(TEX_2D, this.trans.texture);
    gl.generateMipmap(gl.TEXTURE_2D);
    st.bindFramebuffer(src);
    st.bindTexture(11, TEX_2D, this.trans.texture);
  }

  private renderShadows(sun: DirectionalLight, camera: PerspectiveCamera): void {
    const gl = this.gl;
    const st = this.state;
    const s = sun.shadow;
    const csm = this.csm;
    csm.ensure(s.mapSize, clamp(Math.round(s.cascades), 1, 4));
    sun.getDirection(_sunDir);
    csm.compute(camera, _sunDir, s, this.casterSpheres, this.casters.length);

    st.setDepth(true, true);
    st.setBlend(0);
    st.setColorMask(false);
    st.setPolygonOffset(true, 1.5, 3);
    st.setViewport(0, 0, csm.size, csm.size);
    for (let c = 0; c < csm.count; c++) {
      st.bindFramebuffer(csm.fbos[c]);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      const fr = csm.frustums[c];
      let bound: Program | null = null;
      for (let i = 0; i < this.casters.length; i++) {
        const sp = this.casterSpheres;
        if (!fr.intersectsSphere(sp[i * 4], sp[i * 4 + 1], sp[i * 4 + 2], sp[i * 4 + 3])) continue;
        const mesh = this.casters[i];
        const flags = this.featureFlags(mesh, mesh.material);
        const prog = this.getDepthProgram(flags);
        if (!this.ready(prog)) continue;
        if (prog !== bound) {
          prog.use();
          gl.uniformMatrix4fv(prog.loc.uViewProj, false, csm.viewProj[c].elements);
          bound = prog;
        }
        this.drawDepthMesh(mesh, prog, flags);
        this.info.shadowCalls++;
      }
    }
    st.setPolygonOffset(false);
    st.setColorMask(true);
  }

  /** Renders the spot / point shadow atlas planned by `LocalShadows.plan` (point lights: six cube faces). */
  private renderLocalShadows(): void {
    const gl = this.gl;
    const st = this.state;
    const ls = this.ls;
    ls.ensure(Math.max(128, Math.min(4096, Math.round(this.localShadows.mapSize))));
    st.setDepth(true, true);
    st.setBlend(0);
    st.setColorMask(false);
    st.setPolygonOffset(true, 2, 4);
    st.setViewport(0, 0, ls.size, ls.size);
    const sp = this.casterSpheres;
    for (const e of ls.entries) {
      const le = e.light.matrixWorld.elements;
      for (let f = 0; f < e.count; f++) {
        const layer = e.layer + f;
        st.bindFramebuffer(ls.fbos[layer]);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        const fr = ls.frustums[layer];
        let bound: Program | null = null;
        for (let i = 0; i < this.casters.length; i++) {
          const mesh = this.casters[i];
          const r = sp[i * 4 + 3];
          // huge instanced fields never cast local-light shadows (their bounding sphere would pull in every instance)
          if ((mesh as InstancedMesh).instanceMatrix && r > e.far) continue;
          const dx = sp[i * 4] - le[12],
            dy = sp[i * 4 + 1] - le[13],
            dz = sp[i * 4 + 2] - le[14];
          if (dx * dx + dy * dy + dz * dz > (e.far + r) * (e.far + r)) continue;
          if (!fr.intersectsSphere(sp[i * 4], sp[i * 4 + 1], sp[i * 4 + 2], r)) continue;
          const flags = this.featureFlags(mesh, mesh.material);
          const prog = this.getDepthProgram(flags);
          if (!this.ready(prog)) continue;
          if (prog !== bound) {
            prog.use();
            gl.uniformMatrix4fv(prog.loc.uViewProj, false, ls.viewProj[layer].elements);
            bound = prog;
          }
          this.drawDepthMesh(mesh, prog, flags);
          this.info.shadowCalls++;
        }
      }
    }
    st.setPolygonOffset(false);
    st.setColorMask(true);
  }

  /** Spot / point lights in priority order: shadow casters first, then by distance to the camera (closest MAX_LIGHTS). */
  private sortLights(camera: PerspectiveCamera): void {
    camera.getWorldPosition(_tmp);
    const cx = _tmp.x,
      cy = _tmp.y,
      cz = _tmp.z;
    const list = this.sortedLights;
    list.length = 0;
    for (const l of this.lights) list.push(l);
    if (list.length > 1) {
      const dist = (l: Light) => {
        const e = l.matrixWorld.elements;
        return (e[12] - cx) ** 2 + (e[13] - cy) ** 2 + (e[14] - cz) ** 2;
      };
      list.sort((a, b) => (a.castShadow === b.castShadow ? dist(a) - dist(b) : a.castShadow ? -1 : 1));
    }
    if (list.length > MAX_LIGHTS) list.length = MAX_LIGHTS;
  }

  private renderDepthPrepass(viewProj: Matrix4, withColor: boolean): void {
    const gl = this.gl;
    const st = this.state;
    const dp = this.depthPre!;
    st.bindFramebuffer(dp.fbo);
    st.setViewport(0, 0, dp.width, dp.height);
    st.setDepth(true, true);
    st.setBlend(0);
    st.setColorMask(withColor);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    if (withColor) {
      gl.clearBufferfv(gl.COLOR, 0, ZERO4);
      gl.clearBufferfv(gl.COLOR, 1, ZERO4);
      if (dp.hasAlbedo) gl.clearBufferfv(gl.COLOR, 2, ZERO4);
    }
    let bound: Program | null = null;
    const draw = (it: RenderItem): void => {
      if (it.material.kind === 'unlit' && it.material.transparent) return;
      const prog = withColor ? this.getGBufProgram(it.flags, dp.hasAlbedo) : this.getDepthProgram(it.flags);
      if (!this.ready(prog)) return;
      if (prog !== bound) {
        prog.use();
        if (!withColor) gl.uniformMatrix4fv(prog.loc.uViewProj, false, viewProj.elements);
        bound = prog;
      }
      if (withColor) this.drawGBufMesh(it.mesh, prog, it.flags);
      else this.drawDepthMesh(it.mesh, prog, it.flags);
    };
    for (let i = 0; i < this.opaque.length; i++) draw(this.opaque[i]);
    if (!this.needDepthCopy) for (let i = 0; i < this.transmissive.length; i++) draw(this.transmissive[i]);
    else {
      // water + refractive glass sample the opaque depth behind them → snapshot it before they are written
      if (!this.depthCopy || this.depthCopy.width !== dp.width || this.depthCopy.height !== dp.height) {
        deleteColorTarget(gl, st, this.depthCopy);
        this.depthCopy = createDepthTarget(gl, st, dp.width, dp.height);
      }
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, dp.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.depthCopy.fbo);
      gl.blitFramebuffer(0, 0, dp.width, dp.height, 0, 0, dp.width, dp.height, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
      st.invalidateFramebuffer();
      st.bindFramebuffer(dp.fbo);
      for (let i = 0; i < this.transmissive.length; i++) draw(this.transmissive[i]);
    }
    st.setColorMask(true);
  }

  // ───────────────────────────────── lights ─────────────────────────────────

  private fillLights(scene: Scene, camera: PerspectiveCamera, sun: DirectionalLight | null, shadows: boolean, decalCount: number): void {
    const gl = this.gl;
    const d = this.lightData;
    d.fill(0, 0, 104);

    // sun
    if (sun) {
      sun.getDirection(_sunDir);
      d[0] = _sunDir.x;
      d[1] = _sunDir.y;
      d[2] = _sunDir.z;
      d[4] = sun.color.r * sun.intensity;
      d[5] = sun.color.g * sun.intensity;
      d[6] = sun.color.b * sun.intensity;
    } else {
      d[1] = 1;
    }

    // punctual lights – priority order (see sortLights), at most MAX_LIGHTS
    const list = this.sortedLights;
    const n = list.length;
    for (let i = 0; i < n; i++) {
      const l = list[i];
      const o = 104 + i * 16;
      const e = l.matrixWorld.elements;
      d[o] = e[12];
      d[o + 1] = e[13];
      d[o + 2] = e[14];
      d[o + 4] = l.color.r * l.intensity;
      d[o + 5] = l.color.g * l.intensity;
      d[o + 6] = l.color.b * l.intensity;
      d.fill(0, o + 8, o + 16);
      const sLayer = this.ls.layerOf(l);
      d[o + 13] = sLayer;                              // spot.y: first shadow-atlas layer (−1 = none)
      d[o + 14] = l.type === 'PointLight' ? 1 : 0;     // spot.z: cube shadow
      d[o + 15] = Math.max(0, (l as PointLight | SpotLight).radius || 0);   // spot.w: emitter radius (sphere light)
      if (l.type === 'SpotLight') {
        const sl = l as SpotLight;
        d[o + 3] = 2;
        d[o + 7] = sl.range;
        _tmp.set(sl.target.x - e[12], sl.target.y - e[13], sl.target.z - e[14]).normalize();
        d[o + 8] = _tmp.x;
        d[o + 9] = _tmp.y;
        d[o + 10] = _tmp.z;
        const cosOuter = Math.cos(sl.angle);
        const cosInner = Math.cos(sl.angle * (1 - clamp(sl.penumbra, 0, 0.999)));
        d[o + 11] = cosOuter;
        d[o + 12] = 1 / Math.max(cosInner - cosOuter, 1e-4);
      } else {
        d[o + 3] = 1;
        d[o + 7] = (l as PointLight).range;
      }
    }

    d[8] = scene.environmentIntensity;
    d[9] = this.env.prefilterLevels - 1;
    d[10] = n;

    // Lumina 4 block: local shadows, PCSS, micro shadowing, decals
    d.fill(0, OFF_LOCAL, OFF_LOCAL + 12);
    if (this.ls.active) {
      d[OFF_LOCAL] = 1;
      d[OFF_LOCAL + 1] = this.localShadows.softness;
      d[OFF_LOCAL + 2] = 1 / this.ls.size;
      d[OFF_LOCAL + 3] = this.localShadows.normalBias;
      d.set(this.ls.matrices, OFF_LMAT);
      d.set(this.ls.params, OFF_LPAR);
    }
    if (sun) {
      d[OFF_LOCAL + 4] = sun.shadow.pcss ? 1 : 0;
      d[OFF_LOCAL + 5] = Math.max(0, sun.shadow.penumbra);
    }
    d[OFF_LOCAL + 6] = clamp(this.microShadowing, 0, 1);
    d[OFF_LOCAL + 8] = decalCount;
    if (decalCount > 0) {
      let decals = this.decalList;
      if (decals.length > MAX_DECALS) {
        camera.getWorldPosition(_tmp);
        const cx = _tmp.x,
          cy = _tmp.y,
          cz = _tmp.z;
        const dist = (x: Decal) => {
          const e = x.matrixWorld.elements;
          return (e[12] - cx) ** 2 + (e[13] - cy) ** 2 + (e[14] - cz) ** 2;
        };
        decals = decals.slice().sort((a, b) => dist(a) - dist(b));
      }
      for (let i = 0; i < decalCount; i++) {
        const dc = decals[i];
        const o = OFF_DECAL + i * 28;
        _dm.copy(dc.matrixWorld).invert();
        d.set(_dm.elements, o);
        d[o + 16] = dc.color.r;
        d[o + 17] = dc.color.g;
        d[o + 18] = dc.color.b;
        d[o + 19] = clamp(dc.opacity, 0, 1);
        const kind = DECAL_KINDS.indexOf(dc.kind);
        d[o + 20] = kind < 0 ? 0 : kind;
        d[o + 21] = dc.roughness;
        d[o + 22] = dc.normalStrength;
        d[o + 23] = clamp(dc.flatten, 0, 1);
        const m = dc.matrixWorld.elements;
        const il = 1 / (Math.hypot(m[8], m[9], m[10]) || 1);
        d[o + 24] = m[8] * il;
        d[o + 25] = m[9] * il;
        d[o + 26] = m[10] * il;
        d[o + 27] = clamp(dc.wetness, 0, 1);
      }
    }

    if (shadows && sun) {
      const s = sun.shadow;
      const csm = this.csm;
      d[12] = s.bias;
      d[13] = s.normalBias;
      d[14] = s.softness;
      d[15] = 1 / csm.size;
      d[16] = csm.count;
      d[17] = 1;
      d[18] = 0.1;
      d[19] = csm.distance;
      for (let i = 0; i < 4; i++) {
        d[20 + i] = csm.splits[i];
        d[24 + i] = csm.texel[i];
        d[28 + i] = csm.invRange[i];
      }
      d.set(csm.matrices, 40);
    }

    const fog = scene.fog;
    if (fog) {
      d[32] = fog.density;
      d[33] = fog.heightFalloff;
      d[34] = fog.baseHeight;
      d[35] = fog.sunScatter;
      d[36] = fog.tint.r;
      d[37] = fog.tint.g;
      d[38] = fog.tint.b;
      d[39] = 1;
    }
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.lightBuf);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, d);
  }
}
