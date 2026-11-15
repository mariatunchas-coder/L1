export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
export function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** RGB color stored in **linear** space. Hex/CSS inputs are treated as sRGB and converted. */
export class Color {
  constructor(public r = 1, public g = 1, public b = 1) {}

  set(v: Color | number | string): this {
    if (typeof v === 'number') return this.setHex(v);
    if (typeof v === 'string') return this.setStyle(v);
    return this.copy(v);
  }
  setHex(hex: number): this {
    this.r = srgbToLinear(((hex >> 16) & 255) / 255);
    this.g = srgbToLinear(((hex >> 8) & 255) / 255);
    this.b = srgbToLinear((hex & 255) / 255);
    return this;
  }
  setStyle(s: string): this {
    const m = /^#?([0-9a-f]{6})$/i.exec(s.trim());
    if (m) return this.setHex(parseInt(m[1], 16));
    const m3 = /^#?([0-9a-f]{3})$/i.exec(s.trim());
    if (m3) {
      const h = m3[1];
      return this.setHex(parseInt(h[0] + h[0] + h[1] + h[1] + h[2] + h[2], 16));
    }
    return this;
  }
  setRGB(r: number, g: number, b: number): this {
    this.r = r;
    this.g = g;
    this.b = b;
    return this;
  }
  setSRGB(r: number, g: number, b: number): this {
    this.r = srgbToLinear(r);
    this.g = srgbToLinear(g);
    this.b = srgbToLinear(b);
    return this;
  }
  /** Approximate black body color (Tanner Helland) – handy for physically-motivated light colors. */
  setKelvin(kelvin: number): this {
    const t = Math.min(Math.max(kelvin, 1000), 40000) / 100;
    let r: number, g: number, b: number;
    if (t <= 66) {
      r = 255;
      g = 99.4708025861 * Math.log(t) - 161.1195681661;
      b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
    } else {
      r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
      g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
      b = 255;
    }
    const c = (v: number) => Math.min(Math.max(v, 0), 255) / 255;
    return this.setSRGB(c(r), c(g), c(b));
  }
  copy(c: Color): this {
    this.r = c.r;
    this.g = c.g;
    this.b = c.b;
    return this;
  }
  clone(): Color {
    return new Color(this.r, this.g, this.b);
  }
  multiplyScalar(s: number): this {
    this.r *= s;
    this.g *= s;
    this.b *= s;
    return this;
  }
  lerp(c: Color, t: number): this {
    this.r += (c.r - this.r) * t;
    this.g += (c.g - this.g) * t;
    this.b += (c.b - this.b) * t;
    return this;
  }
  getHex(): number {
    const f = (v: number) => Math.round(Math.min(Math.max(linearToSrgb(v), 0), 1) * 255);
    return (f(this.r) << 16) | (f(this.g) << 8) | f(this.b);
  }
  getHexString(): string {
    return '#' + this.getHex().toString(16).padStart(6, '0');
  }
  luminance(): number {
    return 0.2126 * this.r + 0.7152 * this.g + 0.0722 * this.b;
  }
}
