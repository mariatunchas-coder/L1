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
