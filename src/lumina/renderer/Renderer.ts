import type { PerspectiveCamera } from '../core/Camera';
import type { DirectionalLight, Light, PointLight, SpotLight } from '../core/Lights';
import { DoubleSide, Material, PBRMaterial, UnlitMaterial } from '../core/Material';
import { InstancedMesh, Mesh } from '../core/Mesh';
import type { Object3D } from '../core/Object3D';
import type { Scene } from '../core/Scene';
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
import { ColorTarget, DepthTarget, createColorTarget, createDepthTarget, deleteColorTarget } from './RenderTarget';
import { Resources } from './Resources';
import { depthFrag, depthVert, pbrFrag, pbrVert } from './shaders/pbr';

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
  F_FOG = 16384;

const CAM_FLOATS = 76;
const LIGHT_FLOATS = 104 + 32 * 16;
const MAX_LIGHTS = 32;

const _vp = new Matrix4();
const _tmp = new Vector3();
const _sunDir = new Vector3();
const _frustum = new Frustum();

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  readonly state: GLState;
  readonly resources: Resources;

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

  private camBuf: WebGLBuffer;
  private lightBuf: WebGLBuffer;
  private camData = new Float32Array(CAM_FLOATS);
  private lightData = new Float32Array(LIGHT_FLOATS);

  private hdr: ColorTarget | null = null;
  private msaaFbo: WebGLFramebuffer | null = null;
  private msaaColor: WebGLRenderbuffer | null = null;
  private msaaDepth: WebGLRenderbuffer | null = null;
  private depthPre: DepthTarget | null = null;

  private env: EnvironmentMaps;
  private defaultSky = new Sky();
  private lastEnvUpdate = -1e9;
  private bgProgram: Program;
  private post_: PostProcessor;
  private csm: CascadedShadows;
  private parallelExt: { COMPLETION_STATUS_KHR: number } | null;

  private programs = new Map<number, Program>();
  private depthPrograms = new Map<number, Program>();
  private opaque: RenderItem[] = [];
  private transparent: RenderItem[] = [];
  private pool: RenderItem[] = [];
  private poolIndex = 0;
  private casters: Mesh[] = [];
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
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('Lumina: EXT_color_buffer_float (HDR rendering) is required.');
    gl.getExtension('EXT_color_buffer_half_float');
    gl.getExtension('OES_texture_float_linear');
    this.parallelExt = gl.getExtension('KHR_parallel_shader_compile');

    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.capabilities = {
      maxSamples: gl.getParameter(gl.MAX_SAMPLES) as number,
      gpu: dbg ? (gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string) : 'unknown',
    };
    this.samples = Math.min(opts.samples ?? 4, this.capabilities.maxSamples);
    this.pixelRatio = opts.pixelRatio ?? Math.min(window.devicePixelRatio || 1, 2);

    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      console.warn('Lumina: WebGL context lost');
    });

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

    this.env = new EnvironmentMaps(gl, this.state, opts.environmentResolution ?? 256);
    this.bgProgram = createBackgroundProgram(gl, this.state);
    this.post_ = new PostProcessor(gl, this.state);
    this.csm = new CascadedShadows(gl, this.state);
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

  /** Renders `scene` as seen from `camera` to the canvas. */
  render(scene: Scene, camera: PerspectiveCamera): void {
    if (this.contextLost) return;
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
    this.ensureTargets(rw, rh);

    // ── image based lighting (re-baked lazily when the sky changes) ──
    const sky = scene.sky ?? this.defaultSky;
    if (this.env.version !== sky.version && t0 - this.lastEnvUpdate > (this.env.version < 0 ? 0 : this.environmentUpdateInterval)) {
      this.env.update(sky);
      this.lastEnvUpdate = t0;
    }

    // ── per-frame camera data ──
    _vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_vp);
    const cd = this.camData;
    cd.set(camera.matrixWorldInverse.elements, 0);
    cd.set(camera.projectionMatrix.elements, 16);
    cd.set(_vp.elements, 32);
    cd.set(new Matrix4().copy(_vp).invert().elements, 48);
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
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.camBuf);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, cd);

    // ── gather ──
    this.collect(scene, camera);

    const sun = this.sun;
    const useShadows = this.shadowsEnabled && !!sun && sun.castShadow && this.casters.length > 0;
    const useSSAO = this.post.ssao.enabled;
    // volumetric fog needs its own shadow-mapped sun, and a depth buffer to raymarch against
    const useVolumetricFog = this.post.volumetricFog.enabled && useShadows;
    const useDepthPre = useSSAO || useVolumetricFog;
    const fog = scene.fog;

    if (useShadows) this.renderShadows(sun!, camera);
    if (useDepthPre) this.renderDepthPrepass(_vp);
    const aoTex = useSSAO ? this.post_.renderSSAO(this.depthPre!.texture, camera, this.post.ssao, rw, rh) : null;

    this.fillLights(scene, camera, sun, useShadows);

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
    if (aoTex) st.bindTexture(4, TEX_2D, aoTex);
    st.bindTexture(9, TEX_CUBE, this.env.skyCube);

    for (const p of this.programs.values()) p.lastMaterial = null;
    this.textureMaterial = null;
    const frameFlags = (useShadows ? F_SHADOWS : 0) | (useSSAO ? F_SSAO : 0) | (fog ? F_FOG : 0);

    this.opaque.sort((a, b) => a.order - b.order || a.flags - b.flags || a.matId - b.matId || a.z - b.z);
    for (let i = 0; i < this.opaque.length; i++) this.drawItem(this.opaque[i], frameFlags);

    if (scene.sky) this.drawBackground(sky);

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
      ? this.post_.renderVolumetricFog(this.depthPre!.texture, this.csm.texture!, camera, p.volumetricFog, rw, rh)
      : null;
    const bloomTex = p.bloom.enabled ? this.post_.renderBloom(hdrTex, p.bloom, rw, rh) : null;
    if (p.autoExposure) this.post_.updateAutoExposure(hdrTex, rw, rh, dt, p);
    this.post_.composite(hdrTex, bloomTex, fogTex, p, nowS, this.canvasW, this.canvasH);

    // ── stats ──
    info.lights = this.lights.length;
    info.programs = this.programs.size + this.depthPrograms.size;
    info.geometries = this.resources.geometryCount;
    info.textures = this.resources.textureCount;
    info.width = rw;
    info.height = rh;
    info.renderScale = this.renderScale;
    info.cpuMs = performance.now() - t0;
    this.frameCount++;
  }

  dispose(): void {
    this.releaseTargets();
    this.env.dispose();
    this.post_.dispose();
    this.csm.dispose();
    for (const p of this.programs.values()) p.dispose();
    for (const p of this.depthPrograms.values()) p.dispose();
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
    deleteColorTarget(gl, this.state, this.depthPre);
    if (this.msaaFbo) gl.deleteFramebuffer(this.msaaFbo);
    if (this.msaaColor) gl.deleteRenderbuffer(this.msaaColor);
    if (this.msaaDepth) gl.deleteRenderbuffer(this.msaaDepth);
    this.hdr = this.depthPre = null;
    this.msaaFbo = this.msaaColor = this.msaaDepth = null;
    this.rw = this.rh = 0;
  }

  private ensureTargets(w: number, h: number): void {
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
    if ((this.post.ssao.enabled || this.post.volumetricFog.enabled) && !this.depthPre) this.depthPre = createDepthTarget(gl, this.state, w, h);
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
    this.lights.length = 0;
    this.sun = null;
    this.poolIndex = 0;
    this.visit(scene, camera);
  }

  private visit(o: Object3D, camera: PerspectiveCamera): void {
    if (!o.visible) return;
    if (o.isLight) {
      const l = o as Light;
      if (l.type === 'DirectionalLight') {
        if (!this.sun && l.intensity > 0) this.sun = l as DirectionalLight;
      } else this.lights.push(l);
    } else if (o.isMesh) {
      const mesh = o as Mesh;
      const mat = mesh.material;
      this.info.objects++;
      if (mat.visible && (!(mesh as InstancedMesh).instanceMatrix || (mesh as InstancedMesh).count > 0)) {
        const s = mesh.getWorldSphere();
        if (mesh.castShadow && !mat.transparent) {
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
          (mat.transparent ? this.transparent : this.opaque).push(it);
          this.info.visible++;
        } else this.info.culled++;
      }
    }
    const ch = o.children;
    for (let i = 0; i < ch.length; i++) this.visit(ch[i], camera);
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
      if (p.normalMap) {
        f |= F_NORMALMAP;
        if (mesh.geometry.attributes.tangent) f |= F_TANGENT;
      }
      if (p.ormMap) f |= F_ORM;
      if (p.emissiveMap) f |= F_EMISSIVEMAP;
      if (p.clearcoat > 0) f |= F_CLEARCOAT;
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
    let flags = item.flags;
    if (!(flags & F_UNLIT)) {
      flags |= frameFlags & (F_SSAO | F_FOG);
      if (mesh.receiveShadow) flags |= frameFlags & F_SHADOWS;
    }
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
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.info.calls++;
  }

  // ───────────────────────────────── passes ─────────────────────────────────

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

  private renderDepthPrepass(viewProj: Matrix4): void {
    const gl = this.gl;
    const st = this.state;
    const dp = this.depthPre!;
    st.bindFramebuffer(dp.fbo);
    st.setViewport(0, 0, dp.width, dp.height);
    st.setDepth(true, true);
    st.setBlend(0);
    st.setColorMask(false);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    let bound: Program | null = null;
    for (let i = 0; i < this.opaque.length; i++) {
      const it = this.opaque[i];
      if (it.material.kind === 'unlit' && it.material.transparent) continue;
      const prog = this.getDepthProgram(it.flags);
      if (!this.ready(prog)) continue;
      if (prog !== bound) {
        prog.use();
        gl.uniformMatrix4fv(prog.loc.uViewProj, false, viewProj.elements);
        bound = prog;
      }
      this.drawDepthMesh(it.mesh, prog, it.flags);
    }
    st.setColorMask(true);
  }

  // ───────────────────────────────── lights ─────────────────────────────────

  private fillLights(scene: Scene, camera: PerspectiveCamera, sun: DirectionalLight | null, shadows: boolean): void {
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

    // punctual lights – keep the closest MAX_LIGHTS
    let list = this.lights;
    if (list.length > MAX_LIGHTS) {
      camera.getWorldPosition(_tmp);
      const cx = _tmp.x,
        cy = _tmp.y,
        cz = _tmp.z;
      const dist = (l: Light) => {
        const e = l.matrixWorld.elements;
        return (e[12] - cx) ** 2 + (e[13] - cy) ** 2 + (e[14] - cz) ** 2;
      };
      list = list.slice().sort((a, b) => dist(a) - dist(b)).slice(0, MAX_LIGHTS);
    }
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
