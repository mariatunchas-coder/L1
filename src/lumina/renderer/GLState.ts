/**
 * Thin WebGL2 state tracker. Every redundant state change (program, VAO, texture binding,
 * depth/cull/blend modes, framebuffer, viewport) is filtered out before reaching the driver –
 * driver calls are the dominant CPU cost of a WebGL renderer.
 */
export const TEX_2D = 0;
export const TEX_CUBE = 1;
export const TEX_2D_ARRAY = 2;
export const SCRATCH_UNIT = 15;

export class GLState {
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private fbo: WebGLFramebuffer | null | undefined = undefined;
  private depthTest = true;
  private depthWrite = true;
  private depthFunc: number;
  private cullMode = -1; // -1 unknown, 0 none, 1 back, 2 front
  private blendMode = -1;
  private polyOffset = false;
  private polyFactor = 0;
  private polyUnits = 0;
  private vx = -1;
  private vy = -1;
  private vw = -1;
  private vh = -1;
  private activeUnit = -1;
  private colorMask = true;
  private units: (WebGLTexture | null)[][] = [];
  private readonly targets: number[];

  constructor(public readonly gl: WebGL2RenderingContext) {
    this.depthFunc = gl.LEQUAL;
    this.targets = [gl.TEXTURE_2D, gl.TEXTURE_CUBE_MAP, gl.TEXTURE_2D_ARRAY];
    for (let i = 0; i < 16; i++) this.units.push([null, null, null]);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.frontFace(gl.CCW);
    this.cullMode = 0;
    this.blendMode = 0;
  }

  useProgram(p: WebGLProgram | null): boolean {
    if (this.program === p) return false;
    this.gl.useProgram(p);
    this.program = p;
    return true;
  }
  bindVAO(v: WebGLVertexArrayObject | null): void {
    if (this.vao === v) return;
    this.gl.bindVertexArray(v);
    this.vao = v;
  }
  bindFramebuffer(fb: WebGLFramebuffer | null): void {
    if (this.fbo === fb) return;
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, fb);
    this.fbo = fb;
  }
  /** Call after raw bindFramebuffer(READ/DRAW) usage (e.g. blits). */
  invalidateFramebuffer(): void {
    this.fbo = undefined;
  }
  setViewport(x: number, y: number, w: number, h: number): void {
    if (this.vx === x && this.vy === y && this.vw === w && this.vh === h) return;
    this.gl.viewport(x, y, w, h);
    this.vx = x;
    this.vy = y;
    this.vw = w;
    this.vh = h;
  }
  setDepth(test: boolean, write: boolean, func?: number): void {
    const gl = this.gl;
    if (this.depthTest !== test) {
      test ? gl.enable(gl.DEPTH_TEST) : gl.disable(gl.DEPTH_TEST);
      this.depthTest = test;
    }
    if (this.depthWrite !== write) {
      gl.depthMask(write);
      this.depthWrite = write;
    }
    const f = func ?? gl.LEQUAL;
    if (this.depthFunc !== f) {
      gl.depthFunc(f);
      this.depthFunc = f;
    }
  }
  /** 0 = FrontSide (cull back), 1 = BackSide (cull front), 2 = DoubleSide */
  setSide(side: 0 | 1 | 2): void {
    const gl = this.gl;
    const mode = side === 2 ? 0 : side === 0 ? 1 : 2;
    if (this.cullMode === mode) return;
    if (mode === 0) gl.disable(gl.CULL_FACE);
    else {
      if (this.cullMode <= 0) gl.enable(gl.CULL_FACE);
      gl.cullFace(mode === 1 ? gl.BACK : gl.FRONT);
    }
    this.cullMode = mode;
  }
  /** 0 = none, 1 = premultiplied alpha, 2 = additive */
  setBlend(mode: 0 | 1 | 2): void {
    const gl = this.gl;
    if (this.blendMode === mode) return;
    if (mode === 0) gl.disable(gl.BLEND);
    else {
      if (this.blendMode <= 0) gl.enable(gl.BLEND);
      if (mode === 1) gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      else gl.blendFunc(gl.ONE, gl.ONE);
    }
    this.blendMode = mode;
  }
  setPolygonOffset(enabled: boolean, factor = 0, units = 0): void {
    const gl = this.gl;
    if (this.polyOffset !== enabled) {
      enabled ? gl.enable(gl.POLYGON_OFFSET_FILL) : gl.disable(gl.POLYGON_OFFSET_FILL);
      this.polyOffset = enabled;
    }
    if (enabled && (this.polyFactor !== factor || this.polyUnits !== units)) {
      gl.polygonOffset(factor, units);
      this.polyFactor = factor;
      this.polyUnits = units;
    }
  }
  setColorMask(on: boolean): void {
    if (this.colorMask === on) return;
    this.gl.colorMask(on, on, on, on);
    this.colorMask = on;
  }
  bindTexture(unit: number, kind: number, tex: WebGLTexture | null): void {
    const slot = this.units[unit];
    if (slot[kind] === tex) return;
    if (this.activeUnit !== unit) {
      this.gl.activeTexture(this.gl.TEXTURE0 + unit);
      this.activeUnit = unit;
    }
    this.gl.bindTexture(this.targets[kind], tex);
    slot[kind] = tex;
  }
  /** Binds on the reserved scratch unit (used for uploads / mip generation). */
  bindScratch(kind: number, tex: WebGLTexture | null): void {
    this.bindTexture(SCRATCH_UNIT, kind, tex);
    // uploads / generateMipmap act on the *active* unit – make sure it is the scratch unit
    if (this.activeUnit !== SCRATCH_UNIT) {
      this.gl.activeTexture(this.gl.TEXTURE0 + SCRATCH_UNIT);
      this.activeUnit = SCRATCH_UNIT;
    }
  }
  /** Forget a deleted texture so a recycled id can't produce a stale cache hit. */
  forgetTexture(tex: WebGLTexture): void {
    for (const slot of this.units) for (let k = 0; k < 3; k++) if (slot[k] === tex) slot[k] = null;
  }
}
