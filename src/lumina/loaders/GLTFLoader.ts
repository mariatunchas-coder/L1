import { AnimationClip, KeyframeTrack, type Interpolation, type TrackProperty } from '../animation/Animation';
import { PerspectiveCamera } from '../core/Camera';
import { BufferAttribute, Geometry } from '../core/Geometry';
import { PointLight, SpotLight, DirectionalLight, type Light } from '../core/Lights';
import { DoubleSide, FrontSide, Material, PBRMaterial, UnlitMaterial } from '../core/Material';
import { Mesh } from '../core/Mesh';
import { Object3D } from '../core/Object3D';
import { Texture } from '../core/Texture';
import { Matrix4 } from '../math/Matrix4';
import { Vector3 } from '../math/Vector3';

/* ───────────────────────────── public types ───────────────────────────── */

export interface GLTFResult {
  /** Root of the default scene (add this to your Scene). */
  scene: Object3D;
  scenes: Object3D[];
  animations: AnimationClip[];
  cameras: PerspectiveCamera[];
  /** KHR_lights_punctual lights (already attached to their nodes inside `scene`). */
  lights: Light[];
  materials: Material[];
  textures: Texture[];
  geometries: Geometry[];
  meshes: Mesh[];
  asset: { version: string; generator?: string; copyright?: string };
  /** World-space bounds of all meshes at load time. */
  bounds: { min: Vector3; max: Vector3; center: Vector3; radius: number };
  /** Non-fatal problems (unsupported extensions, skins …). */
  warnings: string[];
  /** Releases GPU resources and object URLs. */
  dispose(): void;
}

export interface GLTFLoaderOptions {
  /** Import KHR_lights_punctual lights. Default true. */
  importLights?: boolean;
  /** Import cameras. Default true. */
  importCameras?: boolean;
  /** Multiplier for imported light intensities. Default 1. */
  lightIntensityScale?: number;
  /** Textures larger than this (px) are down-scaled before upload (0 = never). Default 0. */
  maxTextureSize?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

type TA = Float32Array | Uint32Array | Uint16Array | Uint8Array | Int16Array | Int8Array;
type Prim = { geometry: Geometry; material: Material };

const COMPONENTS: Record<number, { ctor: new (b: ArrayBuffer) => TA; bytes: number; max: number }> = {
  5120: { ctor: Int8Array, bytes: 1, max: 127 },
  5121: { ctor: Uint8Array, bytes: 1, max: 255 },
  5122: { ctor: Int16Array, bytes: 2, max: 32767 },
  5123: { ctor: Uint16Array, bytes: 2, max: 65535 },
  5125: { ctor: Uint32Array, bytes: 4, max: 4294967295 },
  5126: { ctor: Float32Array, bytes: 4, max: 1 },
};
const TYPE_SIZE: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

const SUPPORTED_EXT = new Set([
  'KHR_materials_unlit',
  'KHR_materials_emissive_strength',
  'KHR_materials_clearcoat',
  'KHR_materials_transmission',
  'KHR_materials_ior',
  'KHR_texture_transform',
  'KHR_lights_punctual',
  'KHR_mesh_quantization',
  'EXT_texture_webp', // browsers decode WebP natively
]);
const BLOCKING_EXT: Record<string, string> = {
  KHR_draco_mesh_compression: 'Draco mesh compression is not supported – re-export without compression (or run gltf-transform decompress).',
  EXT_meshopt_compression: 'Meshopt compression is not supported – re-export without compression.',
  KHR_texture_basisu: 'KTX2/Basis textures are not supported – re-export with PNG/JPEG/WebP textures.',
};

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/* ───────────────────────────── loader ───────────────────────────── */

/**
 * glTF 2.0 / GLB loader.
 *
 * Supported: .gltf (embedded or external buffers/images) and .glb · sparse, interleaved and
 * normalized accessors · triangle lists/strips/fans · PBR metallic-roughness materials (base colour,
 * metal/rough, occlusion, normal, emissive; MASK/BLEND/double-sided) · KHR_materials_unlit /
 * clearcoat / emissive_strength / transmission (approximated) / ior · KHR_texture_transform
 * (offset + scale) · KHR_lights_punctual · cameras · node hierarchy · TRS animations
 * (LINEAR, STEP, CUBICSPLINE).
 *
 * Not supported (reported through `warnings`): skinning & morph targets (rendered in bind pose),
 * Draco / Meshopt / KTX2 compression (throws a descriptive error), vertex colours, second UV sets.
 */
export class GLTFLoader {
  options: Required<GLTFLoaderOptions>;
  /** Maps relative URIs to something fetchable (used for drag & drop of multi-file glTF). */
  resolver: ((uri: string) => string | null) | null = null;

  constructor(options: GLTFLoaderOptions = {}) {
    this.options = { importLights: true, importCameras: true, lightIntensityScale: 1, maxTextureSize: 0, ...options };
  }

  async load(url: string, onProgress?: (loaded: number, total: number) => void): Promise<GLTFResult> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GLTFLoader: ${res.status} ${res.statusText} while loading ${url}`);
    const total = Number(res.headers.get('content-length')) || 0;
    let buf: ArrayBuffer;
    if (res.body && onProgress) {
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let loaded = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        onProgress(loaded, total);
      }
      const all = new Uint8Array(loaded);
      let o = 0;
      for (const c of chunks) {
        all.set(c, o);
        o += c.length;
      }
      buf = all.buffer;
    } else buf = await res.arrayBuffer();
    const base = url.includes('/') ? url.slice(0, url.lastIndexOf('/') + 1) : '';
    return this.parse(buf, base);
  }

  /** Loads a dropped / picked file set: one .gltf or .glb plus any .bin / image files it references. */
  async loadFiles(files: File[] | FileList): Promise<GLTFResult> {
    const list = Array.from(files);
    const main = list.find((f) => /\.(gltf|glb)$/i.test(f.name));
    if (!main) throw new Error('GLTFLoader: no .gltf or .glb file in the selection');
    const urls = new Map<string, string>();
    for (const f of list) if (f !== main) urls.set(f.name.toLowerCase(), URL.createObjectURL(f));
    const prev = this.resolver;
    this.resolver = (uri) => {
      const name = decodeURIComponent(uri).split('/').pop()!.toLowerCase();
      return urls.get(name) ?? null;
    };
    try {
      return await this.parse(await main.arrayBuffer(), '');
    } finally {
      this.resolver = prev;
      // parse() awaits every image decode, so the temporary URLs can be released now
      urls.forEach((u) => URL.revokeObjectURL(u));
    }
  }

  async parse(data: ArrayBuffer | string | object, basePath = ''): Promise<GLTFResult> {
    let json: Json;
    let glb: Uint8Array | null = null;
    if (data instanceof ArrayBuffer) {
      const dv = new DataView(data);
      if (data.byteLength >= 12 && dv.getUint32(0, true) === GLB_MAGIC) {
        const version = dv.getUint32(4, true);
        if (version !== 2) throw new Error(`GLTFLoader: unsupported GLB version ${version}`);
        const total = Math.min(dv.getUint32(8, true), data.byteLength);
        let off = 12;
        while (off + 8 <= total) {
          const len = dv.getUint32(off, true);
          const type = dv.getUint32(off + 4, true);
          const start = off + 8;
          if (start + len > data.byteLength) throw new Error('GLTFLoader: truncated GLB chunk');
          if (type === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(new Uint8Array(data, start, len)));
          else if (type === CHUNK_BIN && !glb) glb = new Uint8Array(data, start, len);
          off = start + ((len + 3) & ~3);
        }
        if (!json) throw new Error('GLTFLoader: GLB has no JSON chunk');
      } else json = JSON.parse(new TextDecoder().decode(data));
    } else if (typeof data === 'string') json = JSON.parse(data);
    else json = data;

    const version = String(json.asset?.version ?? '');
    if (!version.startsWith('2')) throw new Error(`GLTFLoader: only glTF 2.x is supported (file is ${version || 'unknown'})`);
    for (const e of json.extensionsRequired ?? []) {
      if (BLOCKING_EXT[e]) throw new Error('GLTFLoader: ' + BLOCKING_EXT[e]);
      if (!SUPPORTED_EXT.has(e)) throw new Error(`GLTFLoader: required extension ${e} is not supported`);
    }
    return new GLTFParser(json, glb, basePath, this).build();
  }
}

/* ───────────────────────────── parser ───────────────────────────── */

class GLTFParser {
  private warnings: string[] = [];
  private buffers = new Map<number, Promise<Uint8Array>>();
  private images = new Map<number, Promise<HTMLImageElement>>();
  private textures = new Map<string, Promise<Texture>>();
  private objectUrls: string[] = [];
  private allTextures: Texture[] = [];
  private allMaterials: Material[] = [];
  private allGeometries: Geometry[] = [];
  private warned = new Set<string>();
  private matCache = new Map<number, Promise<Material>>();
  private defaultMaterial: PBRMaterial | null = null;

  constructor(private json: Json, private glb: Uint8Array | null, private base: string, private loader: GLTFLoader) {
    const skins = json.skins?.length;
    if (skins) this.warn('skins', `${skins} skin(s) found – skeletal animation is not supported, skinned meshes are drawn in bind pose.`);
    for (const e of json.extensionsUsed ?? []) {
      if (!SUPPORTED_EXT.has(e) && !(e in BLOCKING_EXT)) this.warn('ext:' + e, `Extension ${e} is ignored.`);
    }
  }

  private warn(key: string, msg: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.warnings.push(msg);
  }

  /* ---------- low level data ---------- */

  private resolveUri(uri: string): string {
    if (/^(data:|blob:|https?:)/i.test(uri)) return uri;
    const mapped = this.loader.resolver?.(uri);
    if (mapped) return mapped;
    if (this.loader.resolver && !this.base) throw new Error(`GLTFLoader: referenced file "${uri}" was not provided – select it together with the .gltf`);
    return this.base + uri;
  }

  private getBuffer(i: number): Promise<Uint8Array> {
    let p = this.buffers.get(i);
    if (!p) {
      const def = this.json.buffers?.[i];
      if (!def) throw new Error(`GLTFLoader: buffer ${i} does not exist`);
      if (def.uri === undefined) {
        if (!this.glb) throw new Error('GLTFLoader: buffer has no uri and the file is not a GLB');
        p = Promise.resolve(this.glb);
      } else {
        p = fetch(this.resolveUri(def.uri)).then(async (r) => {
          if (!r.ok) throw new Error(`GLTFLoader: could not load buffer "${def.uri}" (${r.status})`);
          return new Uint8Array(await r.arrayBuffer());
        });
      }
      this.buffers.set(i, p);
    }
    return p;
  }

  private async getBufferViewBytes(i: number): Promise<{ bytes: Uint8Array; stride: number }> {
    const v = this.json.bufferViews?.[i];
    if (!v) throw new Error(`GLTFLoader: bufferView ${i} does not exist`);
    const buf = await this.getBuffer(v.buffer);
    const off = v.byteOffset ?? 0;
    if (off + v.byteLength > buf.byteLength) throw new Error(`GLTFLoader: bufferView ${i} exceeds its buffer`);
    return { bytes: buf.subarray(off, off + v.byteLength), stride: v.byteStride ?? 0 };
  }

  /** Reads an accessor into a tightly packed typed array (sparse, interleaved and unaligned data handled). */
  private async readAccessor(i: number): Promise<{ array: TA; itemSize: number; count: number; normalized: boolean; componentType: number }> {
    const a = this.json.accessors?.[i];
    if (!a) throw new Error(`GLTFLoader: accessor ${i} does not exist`);
    const comp = COMPONENTS[a.componentType];
    const itemSize = TYPE_SIZE[a.type];
    if (!comp || !itemSize) throw new Error(`GLTFLoader: accessor ${i} has an invalid type`);
    const elemBytes = comp.bytes * itemSize;
    const count: number = a.count;
    const out = new Uint8Array(count * elemBytes); // zero-filled (spec: accessors without bufferView are all zero)

    if (a.bufferView !== undefined) {
      const { bytes, stride } = await this.getBufferViewBytes(a.bufferView);
      const start = a.byteOffset ?? 0;
      const step = stride || elemBytes;
      if (count > 0 && start + step * (count - 1) + elemBytes > bytes.byteLength) throw new Error(`GLTFLoader: accessor ${i} exceeds its bufferView`);
      if (step === elemBytes) out.set(bytes.subarray(start, start + count * elemBytes));
      else for (let n = 0; n < count; n++) out.set(bytes.subarray(start + n * step, start + n * step + elemBytes), n * elemBytes);
    }

    if (a.sparse) {
      const sp = a.sparse;
      const idxComp = COMPONENTS[sp.indices.componentType];
      const ib = await this.getBufferViewBytes(sp.indices.bufferView);
      const vb = await this.getBufferViewBytes(sp.values.bufferView);
      const io = sp.indices.byteOffset ?? 0;
      const vo = sp.values.byteOffset ?? 0;
      const idxView = new DataView(ib.bytes.buffer, ib.bytes.byteOffset, ib.bytes.byteLength);
      for (let n = 0; n < sp.count; n++) {
        const pos = io + n * idxComp.bytes;
        const target = idxComp.bytes === 1 ? idxView.getUint8(pos) : idxComp.bytes === 2 ? idxView.getUint16(pos, true) : idxView.getUint32(pos, true);
        if (target >= count) throw new Error(`GLTFLoader: sparse index out of range in accessor ${i}`);
        out.set(vb.bytes.subarray(vo + n * elemBytes, vo + (n + 1) * elemBytes), target * elemBytes);
      }
    }
    return { array: new comp.ctor(out.buffer), itemSize, count, normalized: !!a.normalized, componentType: a.componentType };
  }

  /** Accessor as Float32Array, de-normalising integer data when flagged normalized. */
  private async readFloat(i: number): Promise<{ array: Float32Array; itemSize: number; count: number }> {
    const r = await this.readAccessor(i);
    if (r.array instanceof Float32Array) return r as { array: Float32Array; itemSize: number; count: number };
    const max = COMPONENTS[r.componentType].max;
    const f = new Float32Array(r.array.length);
    const signed = r.componentType === 5120 || r.componentType === 5122;
    for (let k = 0; k < f.length; k++) {
      const v = r.array[k];
      f[k] = r.normalized ? (signed ? Math.max(v / max, -1) : v / max) : v;
    }
    return { array: f, itemSize: r.itemSize, count: r.count };
  }

  /* ---------- textures ---------- */

  private getImage(i: number): Promise<HTMLImageElement> {
    let p = this.images.get(i);
    if (!p) {
      p = (async () => {
        const def = this.json.images?.[i];
        if (!def) throw new Error(`GLTFLoader: image ${i} does not exist`);
        let url: string;
        if (def.uri !== undefined) url = this.resolveUri(def.uri);
        else {
          const { bytes } = await this.getBufferViewBytes(def.bufferView);
          url = URL.createObjectURL(new Blob([bytes.slice()], { type: def.mimeType || 'image/png' }));
          this.objectUrls.push(url);
        }
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = url;
        try {
          await img.decode();
        } catch {
          // decode() can reject for exotic sources – fall back to onload
          if (!img.complete || !img.naturalWidth)
            await new Promise<void>((res, rej) => {
              img.onload = () => res();
              img.onerror = () => rej(new Error(`GLTFLoader: could not decode image ${i}`));
            });
        }
        return img;
      })();
      this.images.set(i, p);
    }
    return p;
  }

  private samplerOf(texIndex: number): { wrapS: 'repeat' | 'clamp' | 'mirror'; wrapT: 'repeat' | 'clamp' | 'mirror'; magFilter: 'nearest' | 'linear' } {
    const t = this.json.textures?.[texIndex];
    const s = t?.sampler !== undefined ? this.json.samplers?.[t.sampler] : undefined;
    const wrap = (w?: number) => (w === 33071 ? 'clamp' : w === 33648 ? 'mirror' : 'repeat');
    return { wrapS: wrap(s?.wrapS), wrapT: wrap(s?.wrapT), magFilter: s?.magFilter === 9728 ? 'nearest' : 'linear' };
  }

  private maybeShrink(img: HTMLImageElement): HTMLImageElement | HTMLCanvasElement {
    const max = this.loader.options.maxTextureSize;
    const w = img.naturalWidth,
      h = img.naturalHeight;
    if (!max || (w <= max && h <= max)) return img;
    const k = max / Math.max(w, h);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k));
    c.height = Math.max(1, Math.round(h * k));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  private getTexture(texIndex: number, colorSpace: 'srgb' | 'linear'): Promise<Texture> {
    const key = `${texIndex}|${colorSpace}`;
    let p = this.textures.get(key);
    if (!p) {
      p = (async () => {
        const def = this.json.textures?.[texIndex];
        if (!def || def.source === undefined) throw new Error(`GLTFLoader: texture ${texIndex} has no image source`);
        const img = this.maybeShrink(await this.getImage(def.source));
        const w = img instanceof HTMLImageElement ? img.naturalWidth : img.width;
        const h = img instanceof HTMLImageElement ? img.naturalHeight : img.height;
        // glTF uv origin is the image's top-left corner → no vertical flip on upload
        const t = new Texture({ image: img, width: w, height: h, colorSpace, flipY: false, ...this.samplerOf(texIndex) });
        this.allTextures.push(t);
        return t;
      })();
      this.textures.set(key, p);
    }
    return p;
  }

  /**
   * glTF stores occlusion (R) and metallic-roughness (G/B) as separate textures, the engine expects one
   * packed ORM map. When both reference the same image it is used directly, otherwise the channels are repacked.
   */
  private async getORM(occ: number | undefined, mr: number | undefined): Promise<Texture | null> {
    if (occ === undefined && mr === undefined) return null;
    const occSrc: number | undefined = occ !== undefined ? this.json.textures[occ].source : undefined;
    const mrSrc: number | undefined = mr !== undefined ? this.json.textures[mr].source : undefined;
    if (occ !== undefined && mr !== undefined && occSrc === mrSrc) return this.getTexture(mr, 'linear');

    const key = `orm|${occ}|${mr}`;
    let p = this.textures.get(key);
    if (!p) {
      p = (async () => {
        const imgMR = mrSrc !== undefined ? this.maybeShrink(await this.getImage(mrSrc)) : null;
        const imgOcc = occSrc !== undefined ? this.maybeShrink(await this.getImage(occSrc)) : null;
        const ref = (imgMR ?? imgOcc)!;
        const w = ref instanceof HTMLImageElement ? ref.naturalWidth : ref.width;
        const h = ref instanceof HTMLImageElement ? ref.naturalHeight : ref.height;
        const read = (img: HTMLImageElement | HTMLCanvasElement | null): Uint8ClampedArray | null => {
          if (!img) return null;
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const g = c.getContext('2d', { willReadFrequently: true })!;
          g.drawImage(img, 0, 0, w, h);
          return g.getImageData(0, 0, w, h).data;
        };
        const dMR = read(imgMR);
        const dOcc = read(imgOcc);
        const out = document.createElement('canvas');
        out.width = w;
        out.height = h;
        const og = out.getContext('2d')!;
        const id = og.createImageData(w, h);
        for (let k = 0; k < id.data.length; k += 4) {
          id.data[k] = dOcc ? dOcc[k] : 255; // R = ambient occlusion
          id.data[k + 1] = dMR ? dMR[k + 1] : 255; // G = roughness
          id.data[k + 2] = dMR ? dMR[k + 2] : 255; // B = metalness
          id.data[k + 3] = 255;
        }
        og.putImageData(id, 0, 0);
        const t = new Texture({ image: out, width: w, height: h, colorSpace: 'linear', flipY: false, ...this.samplerOf((mr ?? occ)!) });
        this.allTextures.push(t);
        return t;
      })();
      this.textures.set(key, p);
    }
    return p;
  }

  /* ---------- materials ---------- */

  private getMaterial(index: number | undefined): Promise<Material> {
    if (index === undefined) {
      if (!this.defaultMaterial) {
        this.defaultMaterial = new PBRMaterial({ color: 0xffffff, metalness: 1, roughness: 1, name: 'glTF default' });
        this.allMaterials.push(this.defaultMaterial);
      }
      return Promise.resolve(this.defaultMaterial);
    }
    let p = this.matCache.get(index);
    if (!p) {
      p = this.buildMaterial(index);
      this.matCache.set(index, p);
    }
    return p;
  }

  private async buildMaterial(index: number): Promise<Material> {
    const def = this.json.materials?.[index];
    if (!def) throw new Error(`GLTFLoader: material ${index} does not exist`);
    const pbr = def.pbrMetallicRoughness ?? {};
    const ext = def.extensions ?? {};
    const bc: number[] = pbr.baseColorFactor ?? [1, 1, 1, 1];
    const texCoordCheck = (info: Json) => {
      if (info && info.texCoord) this.warn('texCoord', 'Only TEXCOORD_0 is supported – textures using other UV sets will look wrong.');
    };
    const mapOf = async (info: Json, cs: 'srgb' | 'linear') => {
      if (!info) return null;
      texCoordCheck(info);
      return this.getTexture(info.index, cs);
    };

    let mat: Material;
    const transformSrc = pbr.baseColorTexture ?? def.normalTexture ?? def.emissiveTexture ?? pbr.metallicRoughnessTexture;
    const tt = transformSrc?.extensions?.KHR_texture_transform;

    if (ext.KHR_materials_unlit) {
      const m = new UnlitMaterial({ color: 0xffffff, intensity: 2 });
      m.color.setRGB(bc[0], bc[1], bc[2]);
      m.opacity = bc[3];
      m.map = await mapOf(pbr.baseColorTexture, 'srgb');
      mat = m;
    } else {
      const m = new PBRMaterial();
      m.color.setRGB(bc[0], bc[1], bc[2]);
      m.opacity = bc[3];
      m.metalness = pbr.metallicFactor ?? 1;
      m.roughness = pbr.roughnessFactor ?? 1;
      const e: number[] = def.emissiveFactor ?? [0, 0, 0];
      m.emissive.setRGB(e[0], e[1], e[2]);
      m.emissiveIntensity = ext.KHR_materials_emissive_strength?.emissiveStrength ?? 1;
      m.map = await mapOf(pbr.baseColorTexture, 'srgb');
      m.normalMap = await mapOf(def.normalTexture, 'linear');
      m.emissiveMap = await mapOf(def.emissiveTexture, 'srgb');
      texCoordCheck(def.occlusionTexture);
      texCoordCheck(pbr.metallicRoughnessTexture);
      m.ormMap = await this.getORM(def.occlusionTexture?.index, pbr.metallicRoughnessTexture?.index);
      if (def.normalTexture?.scale !== undefined) m.normalScale = def.normalTexture.scale;
      if (def.occlusionTexture?.strength !== undefined) m.aoMapIntensity = def.occlusionTexture.strength;
      const cc = ext.KHR_materials_clearcoat;
      if (cc) {
        m.clearcoat = cc.clearcoatFactor ?? 0;
        m.clearcoatRoughness = cc.clearcoatRoughnessFactor ?? 0;
      }
      const tr = ext.KHR_materials_transmission;
      if (tr && (tr.transmissionFactor ?? 0) > 0) {
        // no refraction pass: approximate transmissive glass by premultiplied transparency + Fresnel reflections
        m.transparent = true;
        m.opacity *= Math.max(0.04, 1 - tr.transmissionFactor * 0.9);
      }
      if (tt) {
        const s: number[] = tt.scale ?? [1, 1];
        const o: number[] = tt.offset ?? [0, 0];
        if (tt.rotation) this.warn('uvrot', 'KHR_texture_transform rotation is ignored (offset and scale are applied).');
        m.uvTransform = [s[0], s[1], o[0], o[1]];
      }
      mat = m;
    }

    mat.name = def.name ?? `material_${index}`;
    mat.side = def.doubleSided ? DoubleSide : FrontSide;
    const mode = def.alphaMode ?? 'OPAQUE';
    if (mode === 'MASK') mat.alphaTest = Math.max(1e-4, def.alphaCutoff ?? 0.5);
    else if (mode === 'BLEND') mat.transparent = true;
    this.allMaterials.push(mat);
    return mat;
  }

  /* ---------- geometry ---------- */

  private async buildPrimitive(prim: Json, meshName: string): Promise<Prim | null> {
    const mode = prim.mode ?? 4;
    if (mode < 4) {
      this.warn('mode' + mode, 'Points and line primitives are not supported and were skipped.');
      return null;
    }
    const attrs = prim.attributes ?? {};
    if (attrs.POSITION === undefined) throw new Error(`GLTFLoader: primitive of "${meshName}" has no POSITION`);
    if (prim.extensions?.KHR_draco_mesh_compression) throw new Error('GLTFLoader: ' + BLOCKING_EXT.KHR_draco_mesh_compression);
    if (attrs.COLOR_0 !== undefined) this.warn('color0', 'Vertex colours (COLOR_0) are not supported and are ignored.');
    if (prim.targets?.length) this.warn('morph', 'Morph targets are not supported – meshes are drawn with their base shape.');
    if (attrs.JOINTS_0 !== undefined) this.warn('joints', 'Skinned primitives are drawn in bind pose.');

    const pos = await this.readFloat(attrs.POSITION);
    const nrm = attrs.NORMAL !== undefined ? await this.readFloat(attrs.NORMAL) : null;
    const uv = attrs.TEXCOORD_0 !== undefined ? await this.readFloat(attrs.TEXCOORD_0) : null;
    const tan = attrs.TANGENT !== undefined ? await this.readFloat(attrs.TANGENT) : null;

    let index: Uint16Array | Uint32Array | null = null;
    if (prim.indices !== undefined) {
      const r = await this.readAccessor(prim.indices);
      const src = r.array as Uint8Array | Uint16Array | Uint32Array;
      for (let k = 0; k < src.length; k++) if (src[k] >= pos.count) throw new Error(`GLTFLoader: index ${src[k]} out of range in "${meshName}"`);
      index = src instanceof Uint32Array ? src : new Uint16Array(src);
    }
    if (mode !== 4) {
      // strips / fans → triangle list
      const n = index ? index.length : pos.count;
      const get = (k: number) => (index ? index[k] : k);
      const tris: number[] = [];
      if (mode === 5) {
        for (let k = 0; k + 2 < n; k++) {
          if (k % 2 === 0) tris.push(get(k), get(k + 1), get(k + 2));
          else tris.push(get(k + 1), get(k), get(k + 2));
        }
      } else for (let k = 1; k + 1 < n; k++) tris.push(get(0), get(k), get(k + 1));
      index = pos.count > 65535 ? new Uint32Array(tris) : new Uint16Array(tris);
    }

    const g = new Geometry();
    g.type = 'GLTFGeometry';
    g.setAttribute('position', new BufferAttribute(pos.array, 3));
    if (nrm) g.setAttribute('normal', new BufferAttribute(nrm.array, 3));
    if (uv) g.setAttribute('uv', new BufferAttribute(uv.array, 2));
    if (tan) g.setAttribute('tangent', new BufferAttribute(tan.array, 4));
    if (index) g.index = new BufferAttribute(index, 1);

    if (!nrm) {
      // spec: absent normals ⇒ flat shading → un-index so every triangle owns its vertices
      this.makeFlat(g);
      g.computeVertexNormals();
    }
    this.allGeometries.push(g);
    return { geometry: g, material: await this.getMaterial(prim.material) };
  }

  private makeFlat(g: Geometry): void {
    const idx = g.index?.array;
    if (!idx) return;
    for (const name of Object.keys(g.attributes)) {
      const a = g.attributes[name];
      const n = a.itemSize;
      const out = new Float32Array(idx.length * n);
      for (let k = 0; k < idx.length; k++) for (let c = 0; c < n; c++) out[k * n + c] = a.array[idx[k] * n + c];
      g.attributes[name] = new BufferAttribute(out, n);
    }
    g.index = null;
  }

  /* ---------- scene graph ---------- */

  async build(): Promise<GLTFResult> {
    const json = this.json;
    const opts = this.loader.options;
    const nodeDefs: Json[] = json.nodes ?? [];

    // 1. meshes (one geometry/material pair per primitive, shared by every node that instances the mesh)
    const meshPrims = new Map<number, (Prim | null)[]>();
    const usedMeshes = new Set<number>(nodeDefs.map((n) => n.mesh).filter((m) => m !== undefined));
    await Promise.all(
      [...usedMeshes].map(async (mi) => {
        const md = json.meshes?.[mi];
        if (!md) throw new Error(`GLTFLoader: mesh ${mi} does not exist`);
        meshPrims.set(mi, await Promise.all((md.primitives ?? []).map((p: Json) => this.buildPrimitive(p, md.name ?? `mesh_${mi}`))));
      })
    );

    // 2. nodes
    const lights: Light[] = [];
    const cameras: PerspectiveCamera[] = [];
    const meshes: Mesh[] = [];
    const nodes: Object3D[] = [];
    const lightDefs: Json[] = json.extensions?.KHR_lights_punctual?.lights ?? [];

    const makeMesh = (p: Prim, name: string) => {
      const m = new Mesh(p.geometry, p.material);
      m.name = name;
      m.castShadow = !p.material.transparent;
      meshes.push(m);
      return m;
    };

    nodeDefs.forEach((nd, i) => {
      let obj: Object3D;
      const prims = nd.mesh !== undefined ? (meshPrims.get(nd.mesh) ?? []).filter((p): p is Prim => !!p) : [];
      const label: string = nd.name ?? (nd.mesh !== undefined ? json.meshes?.[nd.mesh]?.name : undefined) ?? `node_${i}`;
      if (prims.length === 1) obj = makeMesh(prims[0], label);
      else {
        obj = new Object3D();
        obj.name = label;
        prims.forEach((p, k) => obj.add(makeMesh(p, `${label}_${k}`)));
      }
      if (nd.matrix) new Matrix4().fromArray(nd.matrix).decompose(obj.position, obj.quaternion, obj.scale);
      else {
        if (nd.translation) obj.position.set(nd.translation[0], nd.translation[1], nd.translation[2]);
        if (nd.rotation) obj.quaternion.set(nd.rotation[0], nd.rotation[1], nd.rotation[2], nd.rotation[3]);
        if (nd.scale) obj.scale.set(nd.scale[0], nd.scale[1], nd.scale[2]);
      }
      if (nd.camera !== undefined && opts.importCameras) {
        const cd = json.cameras?.[nd.camera];
        if (cd?.type === 'perspective') {
          const p = cd.perspective;
          const cam = new PerspectiveCamera((p.yfov * 180) / Math.PI, p.aspectRatio ?? 1, p.znear ?? 0.05, p.zfar ?? 1000);
          cam.name = cd.name ?? `camera_${nd.camera}`;
          obj.add(cam);
          cameras.push(cam);
        }
      }
      const li = nd.extensions?.KHR_lights_punctual?.light;
      if (li !== undefined && opts.importLights && lightDefs[li]) {
        const ld = lightDefs[li];
        const color: number[] = ld.color ?? [1, 1, 1];
        const intensity = (ld.intensity ?? 1) * opts.lightIntensityScale;
        let light: Light;
        if (ld.type === 'directional') light = new DirectionalLight(0xffffff, intensity);
        else if (ld.type === 'spot') {
          const s = new SpotLight(0xffffff, intensity, ld.range ?? 0);
          const outer = ld.spot?.outerConeAngle ?? Math.PI / 4;
          const inner = ld.spot?.innerConeAngle ?? 0;
          s.angle = outer;
          s.penumbra = outer > 0 ? Math.min(1, Math.max(0, 1 - inner / outer)) : 0;
          light = s;
        } else light = new PointLight(0xffffff, intensity, ld.range ?? 0);
        light.color.setRGB(color[0], color[1], color[2]);
        light.name = ld.name ?? `light_${li}`;
        light.userData.gltfLightType = ld.type;
        if (ld.type === 'directional') light.castShadow = false;
        light.position.set(0, 0, 0);
        obj.add(light);
        lights.push(light);
      }
      nodes.push(obj);
    });

    nodeDefs.forEach((nd, i) => {
      for (const c of nd.children ?? []) {
        if (!nodes[c]) throw new Error(`GLTFLoader: node ${i} references missing child ${c}`);
        nodes[i].add(nodes[c]);
      }
    });

    // 3. scenes
    const sceneDefs: Json[] = json.scenes ?? [];
    const scenes: Object3D[] = sceneDefs.map((sd, si) => {
      const root = new Object3D();
      root.name = sd.name ?? `scene_${si}`;
      for (const n of sd.nodes ?? []) if (nodes[n]) root.add(nodes[n]);
      return root;
    });
    if (!scenes.length) {
      const root = new Object3D();
      const hasParent = new Set<number>();
      nodeDefs.forEach((nd) => (nd.children ?? []).forEach((c: number) => hasParent.add(c)));
      nodes.forEach((n, i) => {
        if (!hasParent.has(i)) root.add(n);
      });
      scenes.push(root);
    }
    const scene = scenes[json.scene ?? 0] ?? scenes[0];
    scene.updateMatrixWorld(true);

    // lights are authored looking down -Z; the engine aims directional / spot lights at a world-space target
    const zAxis = new Vector3();
    for (const l of lights) {
      const e = l.matrixWorld.elements;
      zAxis.set(-e[8], -e[9], -e[10]).normalize();
      const wp = new Vector3().setFromMatrixPosition(l.matrixWorld);
      if (l.type === 'DirectionalLight') (l as DirectionalLight).target.copy(wp).add(zAxis);
      else if (l.type === 'SpotLight') (l as SpotLight).target.copy(wp).add(zAxis);
    }

    const animations = await this.buildAnimations(nodes);
    const bounds = this.computeBounds(meshes);
    const urls = this.objectUrls;
    const geos = this.allGeometries;
    const texs = this.allTextures;
    return {
      scene,
      scenes,
      animations,
      cameras,
      lights,
      materials: this.allMaterials,
      textures: texs,
      geometries: geos,
      meshes,
      asset: { version: json.asset.version, generator: json.asset.generator, copyright: json.asset.copyright },
      bounds,
      warnings: this.warnings,
      dispose() {
        geos.forEach((g) => g.dispose());
        texs.forEach((t) => t.dispose());
        urls.forEach((u) => URL.revokeObjectURL(u));
        urls.length = 0;
      },
    };
  }

  private async buildAnimations(nodes: Object3D[]): Promise<AnimationClip[]> {
    const out: AnimationClip[] = [];
    const pathToProp: Record<string, TrackProperty> = { translation: 'position', rotation: 'quaternion', scale: 'scale' };
    const defs: Json[] = this.json.animations ?? [];
    for (let ai = 0; ai < defs.length; ai++) {
      const ad = defs[ai];
      const tracks: KeyframeTrack[] = [];
      for (const ch of ad.channels ?? []) {
        const path: string = ch.target?.path;
        const node = ch.target?.node !== undefined ? nodes[ch.target.node] : undefined;
        if (!node) continue;
        if (path === 'weights') {
          this.warn('weights', 'Morph-target weight animation is not supported.');
          continue;
        }
        const prop = pathToProp[path];
        if (!prop) continue;
        const sampler = ad.samplers?.[ch.sampler];
        if (!sampler) throw new Error(`GLTFLoader: animation ${ai} references a missing sampler`);
        const input = await this.readFloat(sampler.input);
        const output = await this.readFloat(sampler.output);
        const interp: Interpolation = sampler.interpolation === 'STEP' ? 'step' : sampler.interpolation === 'CUBICSPLINE' ? 'cubic' : 'linear';
        const n = prop === 'quaternion' ? 4 : 3;
        const expected = input.count * n * (interp === 'cubic' ? 3 : 1);
        if (output.array.length !== expected) throw new Error(`GLTFLoader: animation ${ai} sampler output has ${output.array.length} values, expected ${expected}`);
        tracks.push(new KeyframeTrack(node, prop, input.array, output.array, interp));
      }
      out.push(new AnimationClip(ad.name ?? `animation_${ai}`, tracks));
    }
    return out;
  }

  private computeBounds(meshes: Mesh[]): GLTFResult['bounds'] {
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    const p = new Vector3();
    for (const m of meshes) {
      const bb = m.geometry.boundingBox ?? m.geometry.computeBoundingBox();
      for (let k = 0; k < 8; k++) {
        p.set(k & 1 ? bb.max.x : bb.min.x, k & 2 ? bb.max.y : bb.min.y, k & 4 ? bb.max.z : bb.min.z).applyMatrix4(m.matrixWorld);
        min.min(p);
        max.max(p);
      }
    }
    if (!isFinite(min.x)) {
      min.set(-1, -1, -1);
      max.set(1, 1, 1);
    }
    const center = new Vector3().addVectors(min, max).multiplyScalar(0.5);
    return { min, max, center, radius: Math.max(1e-3, max.distanceTo(min) / 2) };
  }
}
