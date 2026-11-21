import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type PrimitiveKind =
  | "sphere"
  | "cube"
  | "cylinder"
  | "capsule"
  | "cone"
  | "torus"
  | "plane";

export interface MeshData {
  pos: Float32Array;
  index: Uint32Array;
}

/** Turn any three geometry into clean indexed position+index data (degenerate tris removed). */
export function toMeshData(g: THREE.BufferGeometry): MeshData {
  const clone = g.clone();
  for (const name of Object.keys(clone.attributes)) {
    if (name !== "position") clone.deleteAttribute(name);
  }
  const merged = mergeVertices(clone, 1e-4);
  const pa = merged.getAttribute("position") as THREE.BufferAttribute;
  const pos = new Float32Array(pa.count * 3);
  for (let i = 0; i < pa.count; i++) {
    pos[i * 3] = pa.getX(i);
    pos[i * 3 + 1] = pa.getY(i);
    pos[i * 3 + 2] = pa.getZ(i);
  }
  const idxAttr = merged.getIndex();
  let raw: ArrayLike<number>;
  if (idxAttr) raw = idxAttr.array as ArrayLike<number>;
  else {
    const arr = new Uint32Array(pa.count);
    for (let i = 0; i < arr.length; i++) arr[i] = i;
    raw = arr;
  }
  const out: number[] = [];
  for (let i = 0; i < raw.length; i += 3) {
    const a = raw[i],
      b = raw[i + 1],
      c = raw[i + 2];
    if (a === b || b === c || a === c) continue;
    out.push(a, b, c);
  }
  clone.dispose();
  merged.dispose();
  return { pos, index: Uint32Array.from(out) };
}

export function createPrimitive(kind: PrimitiveKind, quality = 1): MeshData {
  let g: THREE.BufferGeometry;
  const q = quality;
  switch (kind) {
    case "sphere":
      g = new THREE.IcosahedronGeometry(1, Math.round(32 * q));
      break;
    case "cube": {
      const s = Math.round(22 * q);
      g = new THREE.BoxGeometry(1.7, 1.7, 1.7, s, s, s);
      break;
    }
    case "cylinder":
      g = new THREE.CylinderGeometry(0.8, 0.8, 2, Math.round(64 * q), Math.round(40 * q), false);
      break;
    case "capsule":
      g = new THREE.CapsuleGeometry(0.6, 1.4, Math.round(20 * q), Math.round(56 * q));
      break;
    case "cone":
      g = new THREE.ConeGeometry(0.9, 2, Math.round(64 * q), Math.round(40 * q), false);
      break;
    case "torus":
      g = new THREE.TorusGeometry(1, 0.38, Math.round(40 * q), Math.round(96 * q));
      break;
    case "plane":
    default: {
      const s = Math.round(80 * q);
      g = new THREE.PlaneGeometry(3, 3, s, s);
      break;
    }
  }
  const d = toMeshData(g);
  g.dispose();
  return d;
}

/** Ellipsoid (baked transform) built from an icosphere. */
export function createEllipsoid(
  detail: number,
  radii: [number, number, number],
  position: [number, number, number],
  rotZ = 0,
  rotX = 0
): MeshData {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const d = toMeshData(g);
  g.dispose();
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, 0, rotZ)),
    new THREE.Vector3(...radii)
  );
  const v = new THREE.Vector3();
  for (let i = 0; i < d.pos.length; i += 3) {
    v.set(d.pos[i], d.pos[i + 1], d.pos[i + 2]).applyMatrix4(m);
    d.pos[i] = v.x;
    d.pos[i + 1] = v.y;
    d.pos[i + 2] = v.z;
  }
  return d;
}

export interface Adjacency {
  offsets: Uint32Array;
  list: Uint32Array;
}

export function buildAdjacency(n: number, index: Uint32Array): Adjacency {
  const nb: number[][] = new Array(n);
  for (let i = 0; i < n; i++) nb[i] = [];
  const add = (a: number, b: number) => {
    const l = nb[a];
    for (let k = 0; k < l.length; k++) if (l[k] === b) return;
    l.push(b);
  };
  for (let f = 0; f < index.length; f += 3) {
    const a = index[f],
      b = index[f + 1],
      c = index[f + 2];
    add(a, b);
    add(b, a);
    add(b, c);
    add(c, b);
    add(c, a);
    add(a, c);
  }
  const offsets = new Uint32Array(n + 1);
  let total = 0;
  for (let i = 0; i < n; i++) {
    offsets[i] = total;
    total += nb[i].length;
  }
  offsets[n] = total;
  const list = new Uint32Array(total);
  let k = 0;
  for (let i = 0; i < n; i++) for (const j of nb[i]) list[k++] = j;
  return { offsets, list };
}

export interface SubdivResult {
  pos: Float32Array;
  index: Uint32Array;
  /** for each new vertex (index n+e), its two parent vertices */
  parents: Uint32Array;
  oldCount: number;
}

/** Loop (smooth) or simple midpoint subdivision. */
export function subdivide(
  pos: Float32Array,
  index: Uint32Array,
  smooth: boolean
): SubdivResult {
  const n = pos.length / 3;
  const edgeMap = new Map<number, number>();
  const eA: number[] = [];
  const eB: number[] = [];
  const eC: number[] = [];
  const eD: number[] = [];
  const faceEdges = new Int32Array(index.length);

  for (let f = 0; f < index.length; f += 3) {
    for (let k = 0; k < 3; k++) {
      const a = index[f + k];
      const b = index[f + ((k + 1) % 3)];
      const opp = index[f + ((k + 2) % 3)];
      const lo = a < b ? a : b;
      const hi = a < b ? b : a;
      const key = lo * n + hi;
      let slot = edgeMap.get(key);
      if (slot === undefined) {
        slot = eA.length;
        edgeMap.set(key, slot);
        eA.push(lo);
        eB.push(hi);
        eC.push(opp);
        eD.push(-1);
      } else {
        eD[slot] = opp;
      }
      faceEdges[f + k] = slot;
    }
  }
  const E = eA.length;
  const newPos = new Float32Array((n + E) * 3);
  const parents = new Uint32Array(E * 2);

  for (let e = 0; e < E; e++) {
    const a = eA[e] * 3,
      b = eB[e] * 3;
    parents[e * 2] = eA[e];
    parents[e * 2 + 1] = eB[e];
    const o = (n + e) * 3;
    if (smooth && eD[e] >= 0) {
      const c = eC[e] * 3,
        d = eD[e] * 3;
      for (let k = 0; k < 3; k++)
        newPos[o + k] = 0.375 * (pos[a + k] + pos[b + k]) + 0.125 * (pos[c + k] + pos[d + k]);
    } else {
      for (let k = 0; k < 3; k++) newPos[o + k] = 0.5 * (pos[a + k] + pos[b + k]);
    }
  }

  if (smooth) {
    const sum = new Float32Array(n * 3);
    const val = new Uint16Array(n);
    const boundary = new Uint8Array(n);
    for (let e = 0; e < E; e++) {
      const a = eA[e],
        b = eB[e];
      val[a]++;
      val[b]++;
      for (let k = 0; k < 3; k++) {
        sum[a * 3 + k] += pos[b * 3 + k];
        sum[b * 3 + k] += pos[a * 3 + k];
      }
      if (eD[e] < 0) {
        boundary[a] = 1;
        boundary[b] = 1;
      }
    }
    for (let i = 0; i < n; i++) {
      const v = val[i];
      if (boundary[i] || v < 3) {
        for (let k = 0; k < 3; k++) newPos[i * 3 + k] = pos[i * 3 + k];
        continue;
      }
      const beta = v === 3 ? 3 / 16 : 3 / (8 * v);
      for (let k = 0; k < 3; k++)
        newPos[i * 3 + k] = (1 - v * beta) * pos[i * 3 + k] + beta * sum[i * 3 + k];
    }
  } else {
    newPos.set(pos, 0);
  }

  const newIndex = new Uint32Array(index.length * 4);
  let w = 0;
  for (let f = 0; f < index.length; f += 3) {
    const a = index[f],
      b = index[f + 1],
      c = index[f + 2];
    const mab = n + faceEdges[f];
    const mbc = n + faceEdges[f + 1];
    const mca = n + faceEdges[f + 2];
    newIndex[w++] = a;
    newIndex[w++] = mab;
    newIndex[w++] = mca;
    newIndex[w++] = b;
    newIndex[w++] = mbc;
    newIndex[w++] = mab;
    newIndex[w++] = c;
    newIndex[w++] = mca;
    newIndex[w++] = mbc;
    newIndex[w++] = mab;
    newIndex[w++] = mbc;
    newIndex[w++] = mca;
  }
  return { pos: newPos, index: newIndex, parents, oldCount: n };
}

/** Mirror geometry across an axis (0=x,1=y,2=z) and flip winding. */
export function mirrorData(d: MeshData, axis: 0 | 1 | 2): MeshData {
  const pos = new Float32Array(d.pos);
  for (let i = axis; i < pos.length; i += 3) pos[i] = -pos[i];
  const index = new Uint32Array(d.index);
  for (let i = 0; i < index.length; i += 3) {
    const t = index[i + 1];
    index[i + 1] = index[i + 2];
    index[i + 2] = t;
  }
  return { pos, index };
}
