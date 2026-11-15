import { GLState, TEX_2D } from './GLState';

export interface ColorTarget {
  fbo: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
}

export interface DepthTarget {
  fbo: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
}

export function createColorTarget(
  gl: WebGL2RenderingContext,
  state: GLState,
  width: number,
  height: number,
  internalFormat: number,
  opts: { mipmaps?: boolean; filter?: 'linear' | 'nearest'; depthBuffer?: boolean } = {}
): ColorTarget {
  const texture = gl.createTexture()!;
  const levels = opts.mipmaps ? Math.floor(Math.log2(Math.max(width, height))) + 1 : 1;
  state.bindScratch(TEX_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, levels, internalFormat, width, height);
  const nearest = opts.filter === 'nearest';
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, nearest ? gl.NEAREST : opts.mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, nearest ? gl.NEAREST : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer()!;
  state.bindFramebuffer(fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  if (opts.depthBuffer) {
    const rb = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    (fbo as unknown as { __rb: WebGLRenderbuffer }).__rb = rb;
  }
  return { fbo, texture, width, height };
}

export function deleteColorTarget(gl: WebGL2RenderingContext, state: GLState, t: ColorTarget | DepthTarget | null): void {
  if (!t) return;
  const rb = (t.fbo as unknown as { __rb?: WebGLRenderbuffer }).__rb;
  if (rb) gl.deleteRenderbuffer(rb);
  state.forgetTexture(t.texture);
  gl.deleteTexture(t.texture);
  gl.deleteFramebuffer(t.fbo);
}

/** Depth-only target readable as a regular texture (used by SSAO). */
export function createDepthTarget(gl: WebGL2RenderingContext, state: GLState, width: number, height: number): DepthTarget {
  const texture = gl.createTexture()!;
  state.bindScratch(TEX_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, width, height);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer()!;
  state.bindFramebuffer(fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, texture, 0);
  gl.drawBuffers([gl.NONE]);
  gl.readBuffer(gl.NONE);
  return { fbo, texture, width, height };
}

/**
 * Geometry buffer used by the screen-space effects. Always has a readable depth texture;
 * with `withColor` it additionally stores
 *   RT0 (RGBA16F): xy = screen-space velocity (uv units), zw = octahedral world normal
 *   RT1 (RGBA8)  : rgb = specular F0, a = roughness
 *   RT2 (RGBA8)  : rgb = sqrt(diffuse albedo), a = 1   (only with `withAlbedo` – screen-space GI)
 */
export interface GBufferTarget extends DepthTarget {
  hasColor: boolean;
  hasAlbedo: boolean;
  velNormal: WebGLTexture | null;
  material: WebGLTexture | null;
  albedo: WebGLTexture | null;
}

function nearestTexture(gl: WebGL2RenderingContext, state: GLState, w: number, h: number, format: number): WebGLTexture {
  const t = gl.createTexture()!;
  state.bindScratch(TEX_2D, t);
  gl.texStorage2D(gl.TEXTURE_2D, 1, format, w, h);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

export function createGBuffer(gl: WebGL2RenderingContext, state: GLState, width: number, height: number, withColor: boolean, withAlbedo = false): GBufferTarget {
  const depth = nearestTexture(gl, state, width, height, gl.DEPTH_COMPONENT24);
  const fbo = gl.createFramebuffer()!;
  state.bindFramebuffer(fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
  let velNormal: WebGLTexture | null = null;
  let material: WebGLTexture | null = null;
  let albedo: WebGLTexture | null = null;
  if (withColor) {
    velNormal = nearestTexture(gl, state, width, height, gl.RGBA16F);
    material = nearestTexture(gl, state, width, height, gl.RGBA8);
    state.bindFramebuffer(fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, velNormal, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, material, 0);
    if (withAlbedo) {
      albedo = nearestTexture(gl, state, width, height, gl.RGBA8);
      state.bindFramebuffer(fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, albedo, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
    } else {
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    }
  } else {
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
  }
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Lumina: G-buffer framebuffer incomplete 0x' + status.toString(16));
  return { fbo, texture: depth, width, height, hasColor: withColor, hasAlbedo: withColor && withAlbedo, velNormal, material, albedo };
}

export function deleteGBuffer(gl: WebGL2RenderingContext, state: GLState, g: GBufferTarget | null): void {
  if (!g) return;
  for (const t of [g.texture, g.velNormal, g.material, g.albedo]) {
    if (!t) continue;
    state.forgetTexture(t);
    gl.deleteTexture(t);
  }
  gl.deleteFramebuffer(g.fbo);
}
