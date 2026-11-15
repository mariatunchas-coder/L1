import { Vector3 } from '../math/Vector3';
import { GLState, TEX_2D, TEX_3D } from './GLState';
import { Program } from './Program';
import { fullscreenVert } from './shaders/ibl';
import { voxelInjectFrag } from './shaders/effects';

/**
 * World-space radiance cache (a poor man's Lumen "surface cache"): an N³ RGBA16F volume that follows the camera
 * (snapped to whole cells). Every frame each voxel is projected into the screen; voxels that contain a visible surface
 * store its lit colour (premultiplied by occupancy), voxels in visible free space fade out, voxels hidden behind
 * surfaces and voxels outside the view keep their history. SSGI rays that leave the screen read this volume instead of
 * falling back to nothing – so a red wall *behind* the camera still tints the floor in front of it.
 */
export class VoxelGI {
  size = 0;
  readonly origin = new Float32Array(4); // xyz = world position of the volume's min corner, w = cell size
  private tex: WebGLTexture[] = [];
  private fbos: WebGLFramebuffer[][] = [];
  private write = 0;
  private valid = false;
  private prevCell = 0;
  private prev = new Float32Array(4);
  private prog: Program;
  private lastTex: WebGLTexture | null = null;

  constructor(private gl: WebGL2RenderingContext, private state: GLState) {
    this.prog = new Program(gl, state, fullscreenVert, voxelInjectFrag, [], 'voxelInject').finalize();
  }

  /** The most recently written volume (valid after `update` / `ensure`). */
  get texture(): WebGLTexture | null {
    return this.lastTex ?? this.tex[0] ?? null;
  }

  ensure(n: number): void {
    n = Math.max(4, Math.min(64, n & ~1));
    if (n === this.size && this.tex.length) return;
    this.release();
    const gl = this.gl;
    this.size = n;
    for (let k = 0; k < 2; k++) {
      const t = gl.createTexture()!;
      this.state.bindScratch(TEX_3D, t);
      gl.texStorage3D(gl.TEXTURE_3D, 1, gl.RGBA16F, n, n, n);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
      this.tex.push(t);
      const list: WebGLFramebuffer[] = [];
      for (let z = 0; z < n; z++) {
        const f = gl.createFramebuffer()!;
        this.state.bindFramebuffer(f);
        gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, t, 0, z);
        list.push(f);
      }
      this.fbos.push(list);
    }
    const status = (this.state.bindFramebuffer(this.fbos[0][0]), gl.checkFramebufferStatus(gl.FRAMEBUFFER));
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Lumina: radiance-cache framebuffer incomplete 0x' + status.toString(16));
    this.valid = false;
    this.lastTex = this.tex[0];
  }

  reset(): void {
    this.valid = false;
  }

  update(depthTex: WebGLTexture, sceneTex: WebGLTexture, cam: Vector3, extent: number, rate: number, maxRadiance: number, forceReset: boolean): void {
    const gl = this.gl;
    const st = this.state;
    const n = this.size;
    const cell = Math.max(extent, 1) / n;
    const ox = Math.floor(cam.x / cell) * cell - (n / 2) * cell;
    const oy = Math.floor(cam.y / cell) * cell - (n / 2) * cell;
    const oz = Math.floor(cam.z / cell) * cell - (n / 2) * cell;
    const valid = this.valid && !forceReset && Math.abs(cell - this.prevCell) < 1e-6;
    const read = this.tex[1 - this.write];
    const dst = this.fbos[this.write];

    st.setDepth(false, false);
    st.setSide(2);
    st.setBlend(0);
    st.bindVAO(null);
    this.prog.use();
    const L = this.prog.loc;
    st.bindTexture(0, TEX_2D, depthTex);
    st.bindTexture(1, TEX_2D, sceneTex);
    st.bindTexture(6, TEX_3D, read);
    gl.uniform4f(L.uVoxOrigin, ox, oy, oz, cell);
    gl.uniform4f(L.uVoxPrev, this.prev[0], this.prev[1], this.prev[2], valid ? 1 : 0);
    gl.uniform4f(L.uVoxP, n, 0, valid ? rate : 1, maxRadiance);
    st.setViewport(0, 0, n, n);
    for (let z = 0; z < n; z++) {
      st.bindFramebuffer(dst[z]);
      gl.uniform4f(L.uVoxP, n, z, valid ? rate : 1, maxRadiance);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    this.origin[0] = ox;
    this.origin[1] = oy;
    this.origin[2] = oz;
    this.origin[3] = cell;
    this.prev.set(this.origin);
    this.prevCell = cell;
    this.lastTex = this.tex[this.write];
    this.write = 1 - this.write;
    this.valid = true;
  }

  private release(): void {
    const gl = this.gl;
    for (const t of this.tex) {
      this.state.forgetTexture(t);
      gl.deleteTexture(t);
    }
    for (const list of this.fbos) for (const f of list) gl.deleteFramebuffer(f);
    this.tex = [];
    this.fbos = [];
    this.size = 0;
    this.valid = false;
    this.lastTex = null;
  }

  dispose(): void {
    this.release();
    this.prog.dispose();
  }
}
