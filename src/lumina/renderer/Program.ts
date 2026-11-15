import type { GLState } from './GLState';
import { chunks } from './shaders/chunks';

/** Fixed texture-unit layout – samplers are bound once at link time, never per draw. */
export const SAMPLER_UNITS: Record<string, number> = {
  uIrradiance: 0,
  uPrefilter: 1,
  uBrdfLut: 2,
  uShadowMap: 3,
  uAoTex: 4,
  uMap: 5,
  uNormalMap: 6,
  uOrmMap: 7,
  uEmissiveMap: 8,
  uSkyCube: 9,
  /** refracted-scene colour (mip-chained) and opaque scene depth – main pass only */
  uTransmissionTex: 11,
  uSceneDepth: 12,
  // generic post-processing inputs
  uTex0: 0,
  uTex1: 1,
  uTex2: 2,
  uTex3: 3,
  uTex4: 4,
  uTex5: 5,
  uCube: 0,
  /** pre-filtered environment for screen-space reflections (post passes only) */
  uEnvCube: 10,
};

export const UBO_CAMERA = 0;
export const UBO_LIGHTS = 1;

const PREFIX = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp samplerCube;
precision highp sampler2DArray;
precision highp sampler2DShadow;
precision highp sampler2DArrayShadow;
`;

function resolve(src: string): string {
  let out = src;
  for (let i = 0; i < 4 && out.includes('#include'); i++) {
    out = out.replace(/#include <(\w+)>/g, (_, n: string) => {
      const c = chunks[n];
      if (c === undefined) throw new Error(`Lumina: unknown shader chunk <${n}>`);
      return c;
    });
  }
  return out;
}

function annotate(src: string): string {
  return src
    .split('\n')
    .map((l, i) => `${String(i + 1).padStart(4)}| ${l}`)
    .join('\n');
}

export class Program {
  readonly program: WebGLProgram;
  readonly loc: Record<string, WebGLUniformLocation | null> = {};
  /** Material whose uniforms are currently resident on this program (reset every frame). */
  lastMaterial: object | null = null;
  private finalized = false;
  private vs: WebGLShader;
  private fs: WebGLShader;
  readonly id: number;
  private static nextId = 1;

  constructor(
    private gl: WebGL2RenderingContext,
    private state: GLState,
    vert: string,
    frag: string,
    defines: string[] = [],
    public readonly name = 'program',
    private parallel: { COMPLETION_STATUS_KHR: number } | null = null
  ) {
    this.id = Program.nextId++;
    const def = defines.map((d) => `#define ${d}\n`).join('');
    this.vs = this.compile(gl.VERTEX_SHADER, PREFIX + def + resolve(vert));
    this.fs = this.compile(gl.FRAGMENT_SHADER, PREFIX + def + resolve(frag));
    this.program = gl.createProgram()!;
    gl.attachShader(this.program, this.vs);
    gl.attachShader(this.program, this.fs);
    gl.linkProgram(this.program);
  }

  private compile(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    (s as unknown as { __src: string }).__src = src;
    return s;
  }

  /** Non-blocking readiness check (uses KHR_parallel_shader_compile when available). */
  isReady(): boolean {
    if (this.finalized) return true;
    if (this.parallel && !this.gl.getProgramParameter(this.program, this.parallel.COMPLETION_STATUS_KHR)) return false;
    this.finalize();
    return true;
  }

  /** Blocks until the program is linked; throws with an annotated log on failure. */
  finalize(): this {
    if (this.finalized) return this;
    const gl = this.gl;
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(this.program) ?? '';
      let detail = '';
      for (const s of [this.vs, this.fs]) {
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
          detail += `\n--- ${s === this.vs ? 'vertex' : 'fragment'} shader error ---\n${gl.getShaderInfoLog(s)}\n${annotate(
            (s as unknown as { __src: string }).__src
          )}`;
        }
      }
      throw new Error(`Lumina: program "${this.name}" failed to link: ${log}${detail}`);
    }
    gl.deleteShader(this.vs);
    gl.deleteShader(this.fs);

    for (const [block, binding] of [
      ['Camera', UBO_CAMERA],
      ['Lights', UBO_LIGHTS],
    ] as const) {
      const idx = gl.getUniformBlockIndex(this.program, block);
      if (idx !== gl.INVALID_INDEX) gl.uniformBlockBinding(this.program, idx, binding);
    }

    this.state.useProgram(this.program);
    const n = gl.getProgramParameter(this.program, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(this.program, i);
      if (!info) continue;
      const name = info.name.replace(/\[0\]$/, '');
      const loc = gl.getUniformLocation(this.program, info.name);
      this.loc[name] = loc;
      const unit = SAMPLER_UNITS[name];
      if (unit !== undefined && loc) gl.uniform1i(loc, unit);
    }
    this.finalized = true;
    return this;
  }

  use(): this {
    if (!this.finalized) this.finalize();
    this.state.useProgram(this.program);
    return this;
  }

  dispose(): void {
    this.gl.deleteProgram(this.program);
  }
}
