export class Clock {
  private last = performance.now();
  elapsed = 0;
  /** Seconds since the previous call (clamped to avoid huge steps after tab switches). */
  getDelta(): number {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    this.elapsed += dt;
    return dt;
  }
}
