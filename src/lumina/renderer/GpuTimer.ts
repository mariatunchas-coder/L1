interface TimerExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

/**
 * Asynchronous GPU frame timer (EXT_disjoint_timer_query_webgl2). Results arrive a few
 * frames late and are exponentially smoothed. `supported` is false where the extension is
 * unavailable (Safari, Firefox with resistFingerprinting …) – `ms` then stays at 0.
 */
export class GpuTimer {
  readonly supported: boolean;
  ms = 0;
  private ext: TimerExt | null;
  private active: WebGLQuery | null = null;
  private pending: WebGLQuery[] = [];
  private free: WebGLQuery[] = [];

  constructor(private gl: WebGL2RenderingContext) {
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null;
    this.supported = !!this.ext;
  }

  begin(): void {
    if (!this.ext || this.active || this.pending.length > 8) return;
    const q = this.free.pop() ?? this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  end(): void {
    if (!this.ext || !this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  poll(): void {
    const ext = this.ext;
    if (!ext || this.pending.length === 0) return;
    const gl = this.gl;
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean;
    while (this.pending.length) {
      const q = this.pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      this.pending.shift();
      if (!disjoint) {
        const ms = (gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6;
        this.ms = this.ms === 0 ? ms : this.ms + (ms - this.ms) * 0.1;
      }
      this.free.push(q);
    }
  }

  dispose(): void {
    const gl = this.gl;
    for (const q of [...this.pending, ...this.free]) gl.deleteQuery(q);
    if (this.active) gl.deleteQuery(this.active);
    this.pending = [];
    this.free = [];
    this.active = null;
  }
}
