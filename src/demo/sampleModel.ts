import { BoxGeometry, SphereGeometry, TorusKnotGeometry, type Geometry } from '../lumina';

/**
 * Builds a small, fully self-contained GLB in memory (binary glTF 2.0) that exercises the loader:
 * node hierarchy, embedded PNG texture, PBR + clearcoat + emissive-strength + BLEND materials,
 * a KHR_lights_punctual point light, a camera, and LINEAR + CUBICSPLINE animations.
 */
export async function buildSampleGLB(): Promise<ArrayBuffer> {
  const chunks: { data: Uint8Array; target?: number }[] = [];
  const bufferViews: object[] = [];
  const accessors: object[] = [];
  let byteLength = 0;

  const addView = (data: Uint8Array, target?: number): number => {
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) {
      chunks.push({ data: new Uint8Array(pad) });
      byteLength += pad;
    }
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: data.byteLength, ...(target ? { target } : {}) });
    chunks.push({ data });
    byteLength += data.byteLength;
    return bufferViews.length - 1;
  };
  const bytesOf = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const addAccessor = (arr: Float32Array | Uint16Array | Uint32Array, type: string, target: number, minmax = false): number => {
    const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type]!;
    const view = addView(bytesOf(arr), target);
    const acc: Record<string, unknown> = {
      bufferView: view,
      componentType: arr instanceof Float32Array ? 5126 : arr instanceof Uint16Array ? 5123 : 5125,
      count: arr.length / size,
      type,
    };
    if (minmax) {
      const min = Array(size).fill(Infinity),
        max = Array(size).fill(-Infinity);
      for (let i = 0; i < arr.length; i++) {
        min[i % size] = Math.min(min[i % size], arr[i]);
        max[i % size] = Math.max(max[i % size], arr[i]);
      }
      acc.min = min;
      acc.max = max;
    }
    accessors.push(acc);
    return accessors.length - 1;
  };
  const meshOf = (g: Geometry, material: number) => {
    const p = g.attributes;
    const prim: Record<string, unknown> = {
      attributes: {
        POSITION: addAccessor(p.position.array as Float32Array, 'VEC3', 34962, true),
        NORMAL: addAccessor(p.normal.array as Float32Array, 'VEC3', 34962),
        TEXCOORD_0: addAccessor(p.uv.array as Float32Array, 'VEC2', 34962),
      },
      material,
      mode: 4,
    };
    if (g.index) prim.indices = addAccessor(g.index.array as Uint16Array | Uint32Array, 'SCALAR', 34963);
    return { primitives: [prim] };
  };

  // checker texture → PNG bytes
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g2 = c.getContext('2d')!;
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      g2.fillStyle = (x + y) % 2 ? '#e8e2d4' : '#1f6f8b';
      g2.fillRect(x * 32, y * 32, 32, 32);
    }
  const blob: Blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('PNG encode failed'))), 'image/png'));
  const imageView = addView(new Uint8Array(await blob.arrayBuffer()));

  const meshes = [
    meshOf(new TorusKnotGeometry(0.6, 0.2, 200, 24, 2, 3), 0),
    meshOf(new SphereGeometry(0.35, 32, 16), 1),
    meshOf(new BoxGeometry(1.8, 0.16, 1.8), 2),
    meshOf(new SphereGeometry(0.55, 48, 24), 3),
  ];

  // animation data
  const q = (deg: number) => {
    const h = (deg * Math.PI) / 360;
    return [0, Math.sin(h), 0, Math.cos(h)];
  };
  const tSpin = addAccessor(new Float32Array([0, 1, 2, 3, 4]), 'SCALAR', 0, true);
  const vSpin = addAccessor(new Float32Array([...q(0), ...q(90), ...q(180), ...q(270), ...q(360)]), 'VEC4', 0);
  const tBob = addAccessor(new Float32Array([0, 1, 2, 3, 4]), 'SCALAR', 0, true);
  const vBob = addAccessor(new Float32Array([1.1, 0.9, 0, 1.1, 1.3, 0, 1.1, 0.9, 0, 1.1, 0.5, 0, 1.1, 0.9, 0]), 'VEC3', 0);
  const tPulse = addAccessor(new Float32Array([0, 1, 2]), 'SCALAR', 0, true);
  // cubic spline: [in-tangent, value, out-tangent] per key
  const z = [0, 0, 0];
  const vPulse = addAccessor(new Float32Array([...z, 1, 1, 1, ...z, ...z, 1.5, 1.5, 1.5, ...z, ...z, 1, 1, 1, ...z]), 'VEC3', 0);

  const json = {
    asset: { version: '2.0', generator: 'Lumina demo sample builder' },
    extensionsUsed: ['KHR_lights_punctual', 'KHR_materials_clearcoat', 'KHR_materials_emissive_strength'],
    scene: 0,
    scenes: [{ name: 'Sample', nodes: [0, 5] }],
    nodes: [
      { name: 'Rig', children: [1, 2, 3, 4], rotation: q(0) },
      { name: 'Knot', mesh: 0, translation: [0, 1.15, 0] },
      { name: 'Orbiter', mesh: 1, translation: [1.1, 0.9, 0], extensions: { KHR_lights_punctual: { light: 0 } } },
      { name: 'Pedestal', mesh: 2, translation: [0, 0.08, 0] },
      { name: 'Glass', mesh: 3, translation: [-1.1, 0.7, 0] },
      { name: 'SampleCamera', camera: 0, translation: [0, 1.6, 5] },
    ],
    cameras: [{ type: 'perspective', perspective: { yfov: 0.7, znear: 0.1, zfar: 100, aspectRatio: 1.7 } }],
    meshes: meshes.map((m, i) => ({ name: ['TorusKnot', 'Sphere', 'Box', 'GlassSphere'][i], ...m })),
    materials: [
      {
        name: 'Checker lacquer',
        pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0.1, roughnessFactor: 0.45 },
        extensions: { KHR_materials_clearcoat: { clearcoatFactor: 1, clearcoatRoughnessFactor: 0.05 } },
      },
      { name: 'Gold', pbrMetallicRoughness: { baseColorFactor: [1, 0.71, 0.29, 1], metallicFactor: 1, roughnessFactor: 0.2 }, emissiveFactor: [1, 0.4, 0.05], extensions: { KHR_materials_emissive_strength: { emissiveStrength: 0.6 } } },
      { name: 'Concrete', pbrMetallicRoughness: { baseColorFactor: [0.55, 0.55, 0.57, 1], metallicFactor: 0, roughnessFactor: 0.85 }, doubleSided: true },
      { name: 'Tinted glass', alphaMode: 'BLEND', pbrMetallicRoughness: { baseColorFactor: [0.5, 0.85, 1, 0.22], metallicFactor: 0, roughnessFactor: 0.03 } },
    ],
    textures: [{ source: 0, sampler: 0 }],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
    images: [{ bufferView: imageView, mimeType: 'image/png' }],
    extensions: { KHR_lights_punctual: { lights: [{ type: 'point', color: [1, 0.6, 0.25], intensity: 25, range: 8, name: 'OrbiterLight' }] } },
    animations: [
      {
        name: 'Spin',
        samplers: [{ input: tSpin, output: vSpin, interpolation: 'LINEAR' }],
        channels: [{ sampler: 0, target: { node: 0, path: 'rotation' } }],
      },
      {
        name: 'Bob & pulse',
        samplers: [
          { input: tBob, output: vBob, interpolation: 'LINEAR' },
          { input: tPulse, output: vPulse, interpolation: 'CUBICSPLINE' },
        ],
        channels: [
          { sampler: 0, target: { node: 2, path: 'translation' } },
          { sampler: 1, target: { node: 4, path: 'scale' } },
        ],
      },
    ],
    accessors,
    bufferViews,
    buffers: [{ byteLength }],
  };

  // ── assemble GLB ──
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const binPad = (4 - (byteLength % 4)) % 4;
  const jsonLen = jsonBytes.length + jsonPad;
  const binLen = byteLength + binPad;
  const total = 12 + 8 + jsonLen + 8 + binLen;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonLen);
  const binStart = 20 + jsonLen;
  dv.setUint32(binStart, binLen, true);
  dv.setUint32(binStart + 4, 0x004e4942, true);
  let o = binStart + 8;
  for (const ch of chunks) {
    out.set(ch.data, o);
    o += ch.data.byteLength;
  }
  return out.buffer;
}
