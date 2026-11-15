import type { Light, PointLight, SpotLight } from '../core/Lights';
import { Frustum } from '../math/Bounds';
import { clamp } from '../math/MathUtils';
import { Matrix4 } from '../math/Matrix4';
import { Vector3 } from '../math/Vector3';
import { GLState, TEX_2D_ARRAY } from './GLState';

export interface LocalShadowSettings {
  enabled: boolean;
  /** Edge length of every atlas layer (px). A point light uses six layers, a spot light one (8 layers in total). */
  mapSize: number;
  /** Penumbra radius in texels. */
  softness: number;
  /** Normal offset in texels. */
  normalBias: number;
  /** Constant depth bias (m). */
  bias: number;
  /** Near plane of the light cameras (m). */
  near: number;
  /** Far plane for lights without a `range` (m). */
  defaultFar: number;
  /** Number of volumetric-fog lights evaluated per ray step (performance knob). */
  maxFogLights: number;
}

export const defaultLocalShadowSettings = (): LocalShadowSettings => ({
  enabled: true,
  mapSize: 1024,
  softness: 1.6,
  normalBias: 1.2,
  bias: 0.02,
  near: 0.1,
  defaultFar: 40,
  maxFogLights: 8,
});

export const LOCAL_LAYERS = 8;

export interface LocalShadowEntry {
  light: Light;
  /** first layer in the atlas */
  layer: number;
  /** 1 (spot) or 6 (point) */
  count: number;
  far: number;
}

const _eye = new Vector3();
const _dir = new Vector3();
const _up = new Vector3();
const _tgt = new Vector3();
const _view = new Matrix4();
const _proj = new Matrix4();
const FACE_DIR: [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
const FACE_UP: [number, number, number][] = [
  [0, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [0, 0, -1],
  [0, 1, 0],
  [0, 1, 0],
];

/**
 * Shadow atlas for spot and point lights: one depth texture array (8 layers). A spot light is rendered into one layer
 * with its cone as field of view, a point light into six layers (cube faces). The closest shadow-casting lights win.
 * The atlas feeds both the surface shading (PCF) and the volumetric fog (god rays of local lights).
 */
export class LocalShadows {
  texture: WebGLTexture | null = null;
  size = 0;
  fbos: WebGLFramebuffer[] = [];
  entries: LocalShadowEntry[] = [];
  readonly matrices = new Float32Array(16 * LOCAL_LAYERS);
  /** per layer: near, far, texel size at distance 1, bias */
  readonly params = new Float32Array(4 * LOCAL_LAYERS);
  readonly viewProj: Matrix4[] = Array.from({ length: LOCAL_LAYERS }, () => new Matrix4());
  readonly frustums: Frustum[] = Array.from({ length: LOCAL_LAYERS }, () => new Frustum());
  private baseLayer = new Map<Light, number>();

  constructor(private gl: WebGL2RenderingContext, private state: GLState) {}

  /** First atlas layer of `light`, or −1 when it casts no shadow this frame. */
  layerOf(light: Light): number {
    return this.baseLayer.get(light) ?? -1;
  }
  get active(): boolean {
    return this.entries.length > 0;
  }

  ensure(size: number): void {
    const gl = this.gl;
    if (this.texture && this.size === size) return;
    this.release();
    this.size = size;
    const tex = gl.createTexture()!;
    this.texture = tex;
    this.state.bindScratch(TEX_2D_ARRAY, tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.DEPTH_COMPONENT24, size, size, LOCAL_LAYERS);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    for (let i = 0; i < LOCAL_LAYERS; i++) {
      const fbo = gl.createFramebuffer()!;
      this.state.bindFramebuffer(fbo);
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, tex, 0, i);
      gl.drawBuffers([gl.NONE]);
      gl.readBuffer(gl.NONE);
      this.fbos.push(fbo);
    }
  }

  /** Chooses which lights get a shadow and builds their light cameras. `lights` must already be sorted by priority. */
  plan(lights: Light[], s: LocalShadowSettings): void {
    this.entries.length = 0;
    this.baseLayer.clear();
    if (!s.enabled) return;
    let used = 0;
    for (const l of lights) {
      if (!l.castShadow) continue;
      const point = l.type === 'PointLight';
      const need = point ? 6 : 1;
      if (used + need > LOCAL_LAYERS) continue;
      const range = (l as PointLight | SpotLight).range;
      const far = range > 0 ? range : s.defaultFar;
      const near = clamp(s.near, 0.01, far * 0.5);
      const e = l.matrixWorld.elements;
      _eye.set(e[12], e[13], e[14]);
      let tanHalf: number;
      if (point) tanHalf = 1.05;
      else {
        const sl = l as SpotLight;
        tanHalf = Math.tan(Math.min(sl.angle * 1.06 + 0.02, 1.5));
      }
      const fov = 2 * Math.atan(tanHalf);
      _proj.perspective(fov, 1, near, far);
      for (let f = 0; f < need; f++) {
        if (point) {
          const d = FACE_DIR[f],
            u = FACE_UP[f];
          _tgt.set(_eye.x + d[0], _eye.y + d[1], _eye.z + d[2]);
          _up.set(u[0], u[1], u[2]);
        } else {
          const sl = l as SpotLight;
          _dir.set(sl.target.x - _eye.x, sl.target.y - _eye.y, sl.target.z - _eye.z);
          if (_dir.lengthSq() < 1e-10) _dir.set(0, -1, 0);
          _dir.normalize();
          _tgt.set(_eye.x + _dir.x, _eye.y + _dir.y, _eye.z + _dir.z);
          if (Math.abs(_dir.y) > 0.98) _up.set(1, 0, 0);
          else _up.set(0, 1, 0);
        }
        _view.identity().lookAt(_eye, _tgt, _up).setPosition(_eye.x, _eye.y, _eye.z).invert();
        const layer = used + f;
        this.viewProj[layer].multiplyMatrices(_proj, _view);
        this.matrices.set(this.viewProj[layer].elements, layer * 16);
        this.frustums[layer].setFromProjectionMatrix(this.viewProj[layer]);
        this.params[layer * 4] = near;
        this.params[layer * 4 + 1] = far;
        this.params[layer * 4 + 2] = (2 * tanHalf) / s.mapSize;
        this.params[layer * 4 + 3] = s.bias;
      }
      this.entries.push({ light: l, layer: used, count: need, far });
      this.baseLayer.set(l, used);
      used += need;
    }
  }

  private release(): void {
    const gl = this.gl;
    if (this.texture) {
      this.state.forgetTexture(this.texture);
      gl.deleteTexture(this.texture);
    }
    for (const f of this.fbos) gl.deleteFramebuffer(f);
    this.fbos = [];
    this.texture = null;
    this.size = 0;
  }

  dispose(): void {
    this.release();
  }
}
