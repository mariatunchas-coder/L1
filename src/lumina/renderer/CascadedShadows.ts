import type { PerspectiveCamera } from '../core/Camera';
import type { CascadedShadowSettings } from '../core/Lights';
import { Frustum } from '../math/Bounds';
import { DEG2RAD, clamp, lerp } from '../math/MathUtils';
import { Matrix4 } from '../math/Matrix4';
import { Vector3 } from '../math/Vector3';
import { GLState } from './GLState';

const _ortho = new Matrix4();
const _x = new Vector3();
const _y = new Vector3();
const _z = new Vector3();
const _up = new Vector3();
const _center = new Vector3();
const _fwd = new Vector3();

/**
 * Cascaded shadow maps for a directional light.
 *  - practical split scheme (uniform/log blend)
 *  - each cascade is fitted to the bounding *sphere* of its frustum slice → rotation-invariant size
 *  - light-space texel snapping → no shimmering when the camera moves
 *  - near plane pushed toward the sun to cover off-screen casters (tight, per cascade)
 *  - all cascades live in a single depth texture array (one sampler, one binding)
 */
export class CascadedShadows {
  texture: WebGLTexture | null = null;
  size = 0;
  layers = 0;
  fbos: WebGLFramebuffer[] = [];
  count = 0;
  distance = 0;
  readonly matrices = new Float32Array(16 * 4);
  readonly splits = new Float32Array(4);
  readonly texel = new Float32Array(4);
  readonly invRange = new Float32Array(4);
  readonly viewProj: Matrix4[] = [new Matrix4(), new Matrix4(), new Matrix4(), new Matrix4()];
  readonly frustums: Frustum[] = [new Frustum(), new Frustum(), new Frustum(), new Frustum()];

  constructor(private gl: WebGL2RenderingContext, private state: GLState) {}

  ensure(size: number, cascades: number): void {
    const gl = this.gl;
    if (this.texture && this.size === size && this.layers === cascades) return;
    this.release();
    this.size = size;
    this.layers = cascades;
    const tex = gl.createTexture()!;
    this.texture = tex;
    // bind through raw GL – the array kind uses the scratch unit
    this.state.bindScratch(2, tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.DEPTH_COMPONENT24, size, size, cascades);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    for (let i = 0; i < cascades; i++) {
      const fbo = gl.createFramebuffer()!;
      this.state.bindFramebuffer(fbo);
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, tex, 0, i);
      gl.drawBuffers([gl.NONE]);
      gl.readBuffer(gl.NONE);
      this.fbos.push(fbo);
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
  }

  /**
   * @param sunDir  unit vector toward the sun
   * @param casters flat array of world-space caster spheres (x, y, z, r)…
   */
  compute(camera: PerspectiveCamera, sunDir: Vector3, s: CascadedShadowSettings, casters: Float64Array, casterCount: number): void {
    const n = clamp(Math.round(s.cascades), 1, 4);
    this.count = n;
    const near = camera.near;
    const far = Math.min(s.distance, camera.far);
    this.distance = far;

    for (let i = 0; i < n; i++) {
      const p = (i + 1) / n;
      const log = near * Math.pow(far / near, p);
      const uni = near + (far - near) * p;
      this.splits[i] = lerp(uni, log, s.lambda);
    }
    this.splits[n - 1] = far;

    _z.copy(sunDir).normalize();
    _up.set(0, 1, 0);
    if (Math.abs(_z.y) > 0.99) _up.set(1, 0, 0);
    _x.crossVectors(_up, _z).normalize();
    _y.crossVectors(_z, _x);

    camera.getWorldDirection(_fwd);
    const camPos = _center.setFromMatrixPosition(camera.matrixWorld);
    const cpx = camPos.x,
      cpy = camPos.y,
      cpz = camPos.z;
    const tanV = Math.tan((camera.fov * DEG2RAD) / 2);
    const tanH = tanV * camera.aspect;
    const k2 = tanV * tanV + tanH * tanH;
    const k = Math.sqrt(k2);

    for (let c = 0; c < n; c++) {
      const nn = c === 0 ? near : Math.max(near, this.splits[c - 1] * 0.85);
      const f = this.splits[c];
      let cd: number, r: number;
      if ((k2 * (f - nn)) / (f + nn) >= 1) {
        cd = f;
        r = f * k;
      } else {
        cd = 0.5 * (f + nn) * (1 + k2);
        r = 0.5 * Math.sqrt((f - nn) * (f - nn) + 2 * (f * f + nn * nn) * k2 + (f + nn) * (f + nn) * k2 * k2);
      }
      r = Math.ceil(r * 8) / 8;

      const wx = cpx + _fwd.x * cd,
        wy = cpy + _fwd.y * cd,
        wz = cpz + _fwd.z * cd;
      const texelWorld = (2 * r) / this.size;
      let cx = wx * _x.x + wy * _x.y + wz * _x.z;
      let cy = wx * _y.x + wy * _y.y + wz * _y.z;
      const cz = wx * _z.x + wy * _z.y + wz * _z.z;
      cx = Math.round(cx / texelWorld) * texelWorld; // texel snapping
      cy = Math.round(cy / texelWorld) * texelWorld;

      // push the near plane toward the sun so that off-screen casters still shadow this slice
      let zTop = cz + r;
      for (let i = 0; i < casterCount; i++) {
        const sx = casters[i * 4],
          sy = casters[i * 4 + 1],
          sz = casters[i * 4 + 2],
          sr = casters[i * 4 + 3];
        const dx = sx * _x.x + sy * _x.y + sz * _x.z - cx;
        const dy = sx * _y.x + sy * _y.y + sz * _y.z - cy;
        if (Math.abs(dx) < r + sr && Math.abs(dy) < r + sr) {
          const zz = sx * _z.x + sy * _z.y + sz * _z.z + sr;
          if (zz > zTop) zTop = zz;
        }
      }
      const zBottom = cz - r;
      const range = zTop - zBottom;

      const ex = _x.x * cx + _y.x * cy + _z.x * zTop;
      const ey = _x.y * cx + _y.y * cy + _z.y * zTop;
      const ez = _x.z * cx + _y.z * cy + _z.z * zTop;

      const view = this.viewProj[c];
      const e = view.elements;
      e[0] = _x.x;
      e[4] = _x.y;
      e[8] = _x.z;
      e[12] = -(_x.x * ex + _x.y * ey + _x.z * ez);
      e[1] = _y.x;
      e[5] = _y.y;
      e[9] = _y.z;
      e[13] = -(_y.x * ex + _y.y * ey + _y.z * ez);
      e[2] = _z.x;
      e[6] = _z.y;
      e[10] = _z.z;
      e[14] = -(_z.x * ex + _z.y * ey + _z.z * ez);
      e[3] = e[7] = e[11] = 0;
      e[15] = 1;
      _ortho.orthographic(-r, r, -r, r, 0, range);
      view.premultiply(_ortho);

      this.matrices.set(view.elements, c * 16);
      this.texel[c] = texelWorld;
      this.invRange[c] = 1 / range;
      this.frustums[c].setFromProjectionMatrix(view);
    }
  }

  dispose(): void {
    this.release();
  }
}
