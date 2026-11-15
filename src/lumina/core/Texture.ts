export type TextureImage = HTMLImageElement | HTMLCanvasElement | ImageBitmap | OffscreenCanvas;
export type WrapMode = 'repeat' | 'clamp' | 'mirror';
export type FilterMode = 'nearest' | 'linear';

export interface TextureOptions {
  image?: TextureImage;
  /** Raw RGBA8 pixels (alternative to `image`). Row 0 = v 0. */
  data?: Uint8Array | Uint8ClampedArray;
  width?: number;
  height?: number;
  /** 'srgb' for colour data (albedo/emissive), 'linear' for data maps (normal, ORM...). */
  colorSpace?: 'srgb' | 'linear';
  wrapS?: WrapMode;
  wrapT?: WrapMode;
  magFilter?: FilterMode;
  generateMipmaps?: boolean;
  anisotropy?: number;
  flipY?: boolean;
}

let _texId = 1;

export class Texture {
  readonly id = _texId++;
  image: TextureImage | null;
  data: Uint8Array | Uint8ClampedArray | null;
  width: number;
  height: number;
  colorSpace: 'srgb' | 'linear';
  wrapS: WrapMode;
  wrapT: WrapMode;
  magFilter: FilterMode;
  generateMipmaps: boolean;
  /** Max anisotropy requested; clamped by hardware. 0 = renderer default. */
  anisotropy: number;
  flipY: boolean;
  version = 1;
  readonly disposeListeners = new Set<() => void>();

  constructor(o: TextureOptions = {}) {
    this.image = o.image ?? null;
    this.data = o.data ?? null;
    this.width = o.width ?? (o.image ? (o.image as HTMLImageElement).width : 1);
    this.height = o.height ?? (o.image ? (o.image as HTMLImageElement).height : 1);
    this.colorSpace = o.colorSpace ?? 'srgb';
    this.wrapS = o.wrapS ?? 'repeat';
    this.wrapT = o.wrapT ?? 'repeat';
    this.magFilter = o.magFilter ?? 'linear';
    this.generateMipmaps = o.generateMipmaps ?? true;
    this.anisotropy = o.anisotropy ?? 0;
    this.flipY = o.flipY ?? true;
  }
  set needsUpdate(v: boolean) {
    if (v) this.version++;
  }
  dispose(): void {
    this.disposeListeners.forEach((l) => l());
  }

  static fromURL(url: string, o: TextureOptions = {}): Promise<Texture> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(new Texture({ ...o, image: img }));
      img.onerror = reject;
      img.src = url;
    });
  }
}
