import type { Sky } from '../core/Sky';
import { Color } from '../math/Color';
import { GLState, TEX_2D, TEX_CUBE } from './GLState';
import { Program } from './Program';
import { backgroundFrag, backgroundVert, brdfFrag, fullscreenVert, irradianceFrag, prefilterFrag, skyFrag } from './shaders/ibl';

/**
 * Image based lighting resources, all generated on the GPU:
 *   skyCube     – HDR atmosphere (mip-mapped)           → background + fog source
 *   irradiance  – cosine convolved diffuse environment   → ambient diffuse
 *   prefilter   – GGX pre-filtered radiance (mip = roughness) → specular reflections
 *   brdfLut     – split-sum scale/bias table             → specular BRDF integration
 */
export class EnvironmentMaps {
  readonly skyCube: WebGLTexture;
  readonly irradiance: WebGLTexture;
  readonly prefilter: WebGLTexture;
  readonly brdfLut: WebGLTexture;
  readonly prefilterLevels = 6;
  readonly irradianceSize = 32;
  readonly prefilterSize = 128;
  version = -1;
  readonly sunE = new Color();
  private fbo: WebGLFramebuffer;
  private skyProg: Program;
  private irrProg: Program;
  private prefProg: Program;
  private brdfProg: Program;
  private checked = false;

  constructor(private gl: WebGL2RenderingContext, private state: GLState, readonly skySize = 256) {
    const mipLevels = (s: number) => Math.floor(Math.log2(s)) + 1;
    this.skyCube = this.createCube(skySize, mipLevels(skySize));
    this.irradiance = this.createCube(this.irradianceSize, 1);
    this.prefilter = this.createCube(this.prefilterSize, this.prefilterLevels);
    this.fbo = gl.createFramebuffer()!;

    this.skyProg = new Program(gl, state, fullscreenVert, skyFrag, [], 'sky').finalize();
    this.irrProg = new Program(gl, state, fullscreenVert, irradianceFrag, [], 'irradiance').finalize();
    this.prefProg = new Program(gl, state, fullscreenVert, prefilterFrag, [], 'prefilter').finalize();
    this.brdfProg = new Program(gl, state, fullscreenVert, brdfFrag, [], 'brdf').finalize();

    this.brdfLut = gl.createTexture()!;
    state.bindScratch(TEX_2D, this.brdfLut);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG16F, 128, 128);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.bakeBRDF();
  }

  private createCube(size: number, levels: number): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    this.state.bindScratch(TEX_CUBE, t);
    gl.texStorage2D(gl.TEXTURE_CUBE_MAP, levels, gl.RGBA16F, size, size);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, levels > 1 ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    return t;
  }

  private prepare(): void {
    this.state.setDepth(false, false);
    this.state.setSide(2);
    this.state.setBlend(0);
    this.state.bindVAO(null);
  }

  private renderFaces(prog: Program, tex: WebGLTexture, level: number, size: number): void {
    const gl = this.gl;
    this.state.bindFramebuffer(this.fbo);
    this.state.setViewport(0, 0, size, size);
    for (let f = 0; f < 6; f++) {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, tex, level);
      if (!this.checked) {
        const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Lumina: HDR cube framebuffer incomplete (0x' + st.toString(16) + ')');
        this.checked = true;
      }
      gl.uniform1i(prog.loc.uFace, f);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }

  private bakeBRDF(): void {
    const gl = this.gl;
    this.prepare();
    this.brdfProg.use();
    this.state.bindFramebuffer(this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.brdfLut, 0);
    this.state.setViewport(0, 0, 128, 128);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Re-bakes sky → irradiance → prefiltered radiance. ~1–3 ms of GPU time on desktop GPUs. */
  update(sky: Sky): void {
    const gl = this.gl;
    this.prepare();
    const sun = sky.getSunLight();
    this.sunE.copy(sun.color).multiplyScalar(sun.intensity);

    // 1. atmosphere → cube
    this.skyProg.use();
    gl.uniform3f(this.skyProg.loc.uSunDir, sky.sunDirection.x, sky.sunDirection.y, sky.sunDirection.z);
    gl.uniform3f(this.skyProg.loc.uSunE, this.sunE.r, this.sunE.g, this.sunE.b);
    gl.uniform1f(this.skyProg.loc.uRayleigh, sky.rayleigh);
    gl.uniform1f(this.skyProg.loc.uMie, sky.mie);
    gl.uniform1f(this.skyProg.loc.uMieG, sky.mieAnisotropy);
    gl.uniform1f(this.skyProg.loc.uSunI, sky.sunIntensity);
    gl.uniform1f(this.skyProg.loc.uBoost, sky.scatteringBoost);
    gl.uniform3f(this.skyProg.loc.uGroundAlbedo, sky.groundAlbedo.r, sky.groundAlbedo.g, sky.groundAlbedo.b);
    this.renderFaces(this.skyProg, this.skyCube, 0, this.skySize);
    this.state.bindScratch(TEX_CUBE, this.skyCube);
    gl.generateMipmap(gl.TEXTURE_CUBE_MAP);

    // 2. diffuse irradiance
    this.irrProg.use();
    this.state.bindTexture(0, TEX_CUBE, this.skyCube);
    this.renderFaces(this.irrProg, this.irradiance, 0, this.irradianceSize);

    // 3. GGX prefiltered specular, one roughness per mip
    this.prefProg.use();
    this.state.bindTexture(0, TEX_CUBE, this.skyCube);
    gl.uniform1f(this.prefProg.loc.uSrcSize, this.skySize);
    for (let l = 0; l < this.prefilterLevels; l++) {
      gl.uniform1f(this.prefProg.loc.uRoughness, l / (this.prefilterLevels - 1));
      this.renderFaces(this.prefProg, this.prefilter, l, this.prefilterSize >> l);
    }
    this.version = sky.version;
  }

  dispose(): void {
    const gl = this.gl;
    for (const t of [this.skyCube, this.irradiance, this.prefilter, this.brdfLut]) {
      this.state.forgetTexture(t);
      gl.deleteTexture(t);
    }
    gl.deleteFramebuffer(this.fbo);
    for (const p of [this.skyProg, this.irrProg, this.prefProg, this.brdfProg]) p.dispose();
  }
}

export function createBackgroundProgram(gl: WebGL2RenderingContext, state: GLState): Program {
  return new Program(gl, state, backgroundVert, backgroundFrag, [], 'background').finalize();
}
