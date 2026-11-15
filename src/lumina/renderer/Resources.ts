import { BufferAttribute, Geometry } from '../core/Geometry';
import { Texture } from '../core/Texture';
import { GLState, TEX_2D } from './GLState';

/** Fixed vertex attribute locations shared by every shader. */
const ATTRIB_LOCATION: Record<string, number> = {
  position: 0,
  normal: 1,
  uv: 2,
  tangent: 3,
  instanceMatrix: 4, // occupies 4..7
  instanceColor: 8,
};

interface BufferRecord {
  buffer: WebGLBuffer;
  version: number;
  byteLength: number;
}
interface VAORecord {
  vao: WebGLVertexArrayObject;
  indexVersion: number;
  indexType: number;
  indexBytes: number;
  indexByteLength: number;
  indexBuffer: WebGLBuffer | null;
}
interface TextureRecord {
  texture: WebGLTexture;
  version: number;
  width: number;
  height: number;
  levels: number;
}

export interface GeometryStats {
  geometries: number;
  textures: number;
}

/** Owns every GPU buffer / VAO / texture created from engine-side objects and keeps them in sync. */
export class Resources {
  private buffers = new WeakMap<BufferAttribute, BufferRecord>();
  private vaos = new WeakMap<Geometry, VAORecord>();
  private textures = new WeakMap<Texture, TextureRecord>();
  private whiteTex: WebGLTexture;
  geometryCount = 0;
  textureCount = 0;
  private maxAniso = 1;
  defaultAnisotropy = 8;
  /** Set when the GL context was lost/replaced: every handle owned by this instance is dead and must not be touched. */
  private stale = false;

  /** Called by the renderer before it builds a replacement after a context restore. */
  invalidate(): void {
    this.stale = true;
  }

  constructor(private gl: WebGL2RenderingContext, private state: GLState) {
    const ext = gl.getExtension('EXT_texture_filter_anisotropic');
    if (ext) this.maxAniso = gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number;
    // generic attribute defaults for geometry that lacks uv/tangent
    gl.vertexAttrib4f(2, 0, 0, 0, 1);
    gl.vertexAttrib4f(3, 1, 0, 0, 1);
    gl.vertexAttrib4f(8, 1, 1, 1, 1);

    this.whiteTex = gl.createTexture()!;
    state.bindScratch(TEX_2D, this.whiteTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 1, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  }

  get white(): WebGLTexture {
    return this.whiteTex;
  }

  // ───────────────────────────── geometry ─────────────────────────────

  private glType(a: BufferAttribute): number {
    const gl = this.gl;
    const arr = a.array;
    if (arr instanceof Float32Array) return gl.FLOAT;
    if (arr instanceof Uint16Array) return gl.UNSIGNED_SHORT;
    if (arr instanceof Uint32Array) return gl.UNSIGNED_INT;
    if (arr instanceof Uint8Array) return gl.UNSIGNED_BYTE;
    if (arr instanceof Int16Array) return gl.SHORT;
    return gl.BYTE;
  }

  private upload(a: BufferAttribute, target: number): WebGLBuffer {
    const gl = this.gl;
    let rec = this.buffers.get(a);
    if (!rec) {
      rec = { buffer: gl.createBuffer()!, version: -1, byteLength: 0 };
      this.buffers.set(a, rec);
      const owned = rec;
      a.disposeListeners.add(() => {
        if (this.stale) return;
        gl.deleteBuffer(owned.buffer);
        if (this.buffers.get(a) === owned) this.buffers.delete(a);
      });
    }
    if (rec.version !== a.version) {
      gl.bindBuffer(target, rec.buffer);
      const usage = a.usage === 'dynamic' ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW;
      if (rec.byteLength === a.array.byteLength && rec.version >= 0) gl.bufferSubData(target, 0, a.array);
      else {
        gl.bufferData(target, a.array, usage);
        rec.byteLength = a.array.byteLength;
      }
      rec.version = a.version;
    }
    return rec.buffer;
  }

  /** Returns a ready-to-draw VAO (creating / updating buffers on demand). */
  getVAO(g: Geometry): VAORecord {
    const gl = this.gl;
    let rec = this.vaos.get(g);
    if (!rec) {
      const vao = gl.createVertexArray()!;
      rec = { vao, indexVersion: -1, indexType: 0, indexBytes: 0, indexByteLength: 0, indexBuffer: null };
      this.vaos.set(g, rec);
      this.geometryCount++;
      this.state.bindVAO(vao);
      for (const name in g.attributes) {
        const loc = ATTRIB_LOCATION[name];
        if (loc === undefined) continue;
        const attr = g.attributes[name];
        gl.bindBuffer(gl.ARRAY_BUFFER, this.upload(attr, gl.ARRAY_BUFFER));
        if (name === 'instanceMatrix') {
          for (let k = 0; k < 4; k++) {
            gl.enableVertexAttribArray(loc + k);
            gl.vertexAttribPointer(loc + k, 4, gl.FLOAT, false, 64, k * 16);
            gl.vertexAttribDivisor(loc + k, 1);
          }
        } else {
          gl.enableVertexAttribArray(loc);
          gl.vertexAttribPointer(loc, attr.itemSize, this.glType(attr), attr.normalized, 0, 0);
          if (attr.divisor) gl.vertexAttribDivisor(loc, attr.divisor);
        }
      }
      g.disposeListeners.add(() => {
        if (this.stale) return;
        gl.deleteVertexArray(vao);
        this.vaos.delete(g);
        this.geometryCount--;
        if (g.ownsBuffers) {
          for (const k in g.attributes) g.attributes[k].dispose();
          g.index?.dispose();
        }
      });
    } else {
      // streaming updates (dynamic attributes)
      for (const name in g.attributes) {
        if (ATTRIB_LOCATION[name] === undefined) continue;
        const a = g.attributes[name];
        const br = this.buffers.get(a);
        if (!br || br.version !== a.version) this.upload(a, gl.ARRAY_BUFFER);
      }
    }
    if (g.index) {
      const idx = g.index;
      if (rec.indexVersion !== idx.version || !rec.indexBuffer) {
        this.state.bindVAO(rec.vao);
        rec.indexBuffer = this.upload(idx, gl.ELEMENT_ARRAY_BUFFER);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, rec.indexBuffer); // VAO-bound element binding
        rec.indexVersion = idx.version;
        rec.indexType = idx.array instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
        rec.indexBytes = idx.array instanceof Uint32Array ? 4 : 2;
      }
    }
    return rec;
  }

  // ───────────────────────────── textures ─────────────────────────────

  getTexture(t: Texture): WebGLTexture {
    const gl = this.gl;
    let rec = this.textures.get(t);
    if (rec && rec.version === t.version) return rec.texture;

    const levels = t.generateMipmaps ? Math.floor(Math.log2(Math.max(t.width, t.height))) + 1 : 1;
    if (rec && (rec.width !== t.width || rec.height !== t.height || rec.levels !== levels)) {
      // immutable storage → recreate
      this.state.forgetTexture(rec.texture);
      gl.deleteTexture(rec.texture);
      this.textureCount--;
      rec = undefined;
    }
    if (!rec) {
      const texture = gl.createTexture()!;
      rec = { texture, version: -1, width: t.width, height: t.height, levels };
      this.textures.set(t, rec);
      this.textureCount++;
      this.state.bindScratch(TEX_2D, texture);
      gl.texStorage2D(gl.TEXTURE_2D, levels, t.colorSpace === 'srgb' ? gl.SRGB8_ALPHA8 : gl.RGBA8, t.width, t.height);
      const owner = rec;
      t.disposeListeners.add(() => {
        // a resized texture gets a new record (and a new listener) – the old listener must not delete the new one
        if (this.stale || this.textures.get(t) !== owner) return;
        this.state.forgetTexture(owner.texture);
        gl.deleteTexture(owner.texture);
        this.textures.delete(t);
        this.textureCount--;
      });
    } else this.state.bindScratch(TEX_2D, rec.texture);

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, t.image ? t.flipY : false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    if (t.data) {
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, t.width, t.height, gl.RGBA, gl.UNSIGNED_BYTE, t.data as ArrayBufferView);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    } else if (t.image) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, t.image as TexImageSource);
    }
    const wrap = (m: string) => (m === 'repeat' ? gl.REPEAT : m === 'mirror' ? gl.MIRRORED_REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap(t.wrapS));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap(t.wrapT));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, t.magFilter === 'nearest' ? gl.NEAREST : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, levels > 1 ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    const ext = gl.getExtension('EXT_texture_filter_anisotropic');
    if (ext) {
      const a = Math.min(t.anisotropy || this.defaultAnisotropy, this.maxAniso);
      gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, a);
    }
    if (levels > 1) gl.generateMipmap(gl.TEXTURE_2D);
    rec.version = t.version;
    return rec.texture;
  }
}
