import type { Sky } from '../core/Sky';
import { Color } from '../math/Color';
import { GLState, TEX_2D, TEX_CUBE } from './GLState';
import { Program } from './Program';
import { backgroundFrag, backgroundVert, brdfFrag, fullscreenVert, irradianceFrag, prefilterFrag, skyCloudFrag, skyFrag } from './shaders/ibl';

/**
 * Image based lighting resources, all generated on the GPU:
 *   skyCube     – HDR atmosphere (mip-mapped)           → background + fog source
 *   irradiance  – cosine convolved diffuse environment   → ambient diffuse
 *   prefilter   – GGX pre-filtered radiance (mip = roughness) → specular reflections
 *   brdfLut     – split-sum scale/bias table             → specular BRDF integration
 */
export class EnvironmentMaps {
  /** Atmosphere + clouds (lighting source: irradiance / prefilter are derived from it). */
  readonly skyCube: WebGLTexture;
  /** Clear-sky copy, only allocated while clouds are enabled (the background draws clouds analytically on top of it). */
  private clearCube: WebGLTexture | null = null;
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
  private cloudProg: Program;
  private checked = false;
  /** True while the baked environment contains clouds (the background then draws them analytically on top). */
  cloudsActive = false;

  /** Cubemap the visible background samples (clear sky while clouds are on, otherwise the full sky). */
  get backgroundCube(): WebGLTexture {
    return this.cloudsActive && this.clearCube ? this.clearCube : this.skyCube;
  }

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
    this.cloudProg = new Program(gl, state, fullscreenVert, skyCloudFrag, [], 'skyClouds').finalize();

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

    // 1. atmosphere → cube (clear cube first when clouds are composited on top)
    const clouds = sky.cloudCoverage > 0.001;
    if (clouds && !this.clearCube) this.clearCube = this.createCube(this.skySize, Math.floor(Math.log2(this.skySize)) + 1);
    this.cloudsActive = clouds;
    const atmosphereTarget = clouds ? this.clearCube! : this.skyCube;
    this.skyProg.use();
    gl.uniform3f(this.skyProg.loc.uSunDir, sky.sunDirection.x, sky.sunDirection.y, sky.sunDirection.z);
    gl.uniform3f(this.skyProg.loc.uSunE, this.sunE.r, this.sunE.g, this.sunE.b);
    gl.uniform1f(this.skyProg.loc.uRayleigh, sky.rayleigh);
    gl.uniform1f(this.skyProg.loc.uMie, sky.mie);
    gl.uniform1f(this.skyProg.loc.uMieG, sky.mieAnisotropy);
    gl.uniform1f(this.skyProg.loc.uSunI, sky.sunIntensity);
    gl.uniform1f(this.skyProg.loc.uBoost, sky.scatteringBoost);
    gl.uniform3f(this.skyProg.loc.uGroundAlbedo, sky.groundAlbedo.r, sky.groundAlbedo.g, sky.groundAlbedo.b);
    this.renderFaces(this.skyProg, atmosphereTarget, 0, this.skySize);
    this.state.bindScratch(TEX_CUBE, atmosphereTarget);
    gl.generateMipmap(gl.TEXTURE_CUBE_MAP);

    if (clouds) {
      this.cloudProg.use();
      this.state.bindTexture(0, TEX_CUBE, this.clearCube);
      gl.uniform3f(this.cloudProg.loc.uSunDir, sky.sunDirection.x, sky.sunDirection.y, sky.sunDirection.z);
      gl.uniform3f(this.cloudProg.loc.uSunE, this.sunE.r, this.sunE.g, this.sunE.b);
      gl.uniform4f(this.cloudProg.loc.uCloud, sky.cloudCoverage, sky.cloudDensity, sky.cloudScale, 0);
      gl.uniform2f(this.cloudProg.loc.uCloudOffset, sky.cloudOffset.x, sky.cloudOffset.y);
      this.renderFaces(this.cloudProg, this.skyCube, 0, this.skySize);
      this.state.bindScratch(TEX_CUBE, this.skyCube);
      gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
    }

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
    for (const t of [this.skyCube, this.clearCube, this.irradiance, this.prefilter, this.brdfLut]) {
      if (!t) continue;
      this.state.forgetTexture(t);
      gl.deleteTexture(t);
    }
    gl.deleteFramebuffer(this.fbo);
    for (const p of [this.skyProg, this.irrProg, this.prefProg, this.brdfProg, this.cloudProg]) p.dispose();
  }
}

export function createBackgroundProgram(gl: WebGL2RenderingContext, state: GLState): Program {
  return new Program(gl, state, backgroundVert, backgroundFrag, [], 'background').finalize();
}
