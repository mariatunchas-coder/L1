import * as THREE from "three";
import {
  computeBoundsTree,
  disposeBoundsTree,
  acceleratedRaycast,
} from "three-mesh-bvh";
import { buildAdjacency, type Adjacency } from "./mesh";

// patch three with BVH acceleration
(THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export interface PartSnapshot {
  pos: Float32Array;
  index: Uint32Array;
  mask: Float32Array;
  paint: Float32Array;
}

export const BASE_PAINT = new THREE.Color("#cfc8bf");

export class Part {
  id: number;
  name: string;
  visible = true;
  mesh: THREE.Mesh;
  wire: THREE.Mesh;
  geo: THREE.BufferGeometry | null = null;

  pos: Float32Array = new Float32Array(0);
  nor: Float32Array = new Float32Array(0);
  col: Float32Array = new Float32Array(0);
  index: Uint32Array = new Uint32Array(0);
  mask: Float32Array = new Float32Array(0);
  paint: Float32Array = new Float32Array(0);
  stamp: Uint32Array = new Uint32Array(0);
  bbox = new THREE.Box3();

  dirtyPos = false;
  dirtyCol = false;
  private adj: Adjacency | null = null;

  constructor(
    id: number,
    name: string,
    material: THREE.Material,
    wireMaterial: THREE.Material
  ) {
    this.id = id;
    this.name = name;
    this.mesh = new THREE.Mesh(undefined, material);
    this.mesh.frustumCulled = false;
    this.mesh.userData.part = this;
    this.wire = new THREE.Mesh(undefined, wireMaterial);
    this.wire.frustumCulled = false;
    this.wire.visible = false;
    this.wire.raycast = () => {};
    this.mesh.add(this.wire);
  }

  get vertCount() {
    return this.pos.length / 3;
  }
  get triCount() {
    return this.index.length / 3;
  }

  get adjacency(): Adjacency {
    if (!this.adj) this.adj = buildAdjacency(this.vertCount, this.index);
    return this.adj;
  }

  setData(
    pos: Float32Array,
    index: Uint32Array,
    mask?: Float32Array,
    paint?: Float32Array
  ) {
    const n = pos.length / 3;
    this.pos = pos;
    this.index = index;
    this.mask = mask ?? new Float32Array(n);
    if (paint) this.paint = paint;
    else {
      this.paint = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        this.paint[i * 3] = BASE_PAINT.r;
        this.paint[i * 3 + 1] = BASE_PAINT.g;
        this.paint[i * 3 + 2] = BASE_PAINT.b;
      }
    }
    this.col = new Float32Array(n * 3);
    this.stamp = new Uint32Array(n);
    this.adj = null;

    const old = this.geo;
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage)
    );
    g.setAttribute(
      "color",
      new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage)
    );
    g.setIndex(new THREE.BufferAttribute(this.index, 1));
    g.computeVertexNormals();
    (g.getAttribute("normal") as THREE.BufferAttribute).setUsage(
      THREE.DynamicDrawUsage
    );
    this.nor = (g.getAttribute("normal") as THREE.BufferAttribute)
      .array as Float32Array;
    g.computeBoundingBox();
    g.computeBoundingSphere();
    (g as any).computeBoundsTree({ targetLeafSize: 10 });
    this.geo = g;
    this.mesh.geometry = g;
    this.wire.geometry = g;
    this.bbox.copy(g.boundingBox!);
    this.refreshAllColors();
    this.dirtyPos = false;
    this.dirtyCol = false;
    if (old) {
      (old as any).disposeBoundsTree?.();
      old.dispose();
    }
  }

  refreshColor(i: number) {
    const m = this.mask[i];
    const k = m * 0.82;
    const o = i * 3;
    const g = 0.09;
    this.col[o] = this.paint[o] * (1 - k) + g * k;
    this.col[o + 1] = this.paint[o + 1] * (1 - k) + g * k;
    this.col[o + 2] = this.paint[o + 2] * (1 - k) + (g + 0.015) * k;
  }

  refreshAllColors() {
    for (let i = 0; i < this.mask.length; i++) this.refreshColor(i);
    this.dirtyCol = true;
  }

  /** push pending changes to GPU + acceleration structure. returns true when something changed */
  flush(): boolean {
    if (!this.geo) return false;
    let changed = false;
    if (this.dirtyPos) {
      (this.geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      this.geo.computeVertexNormals();
      (this.geo.getAttribute("normal") as THREE.BufferAttribute).needsUpdate = true;
      (this.geo as any).boundsTree?.refit();
      this.geo.computeBoundingBox();
      this.bbox.copy(this.geo.boundingBox!);
      this.dirtyPos = false;
      changed = true;
    }
    if (this.dirtyCol) {
      (this.geo.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
      this.dirtyCol = false;
      changed = true;
    }
    return changed;
  }

  rebuildBVH() {
    if (!this.geo) return;
    (this.geo as any).disposeBoundsTree?.();
    this.geo.computeBoundingSphere();
    (this.geo as any).computeBoundsTree({ targetLeafSize: 10 });
  }

  snapshot(): PartSnapshot {
    return {
      pos: new Float32Array(this.pos),
      index: this.index,
      mask: new Float32Array(this.mask),
      paint: new Float32Array(this.paint),
    };
  }

  restore(s: PartSnapshot) {
    if (s.index === this.index && s.pos.length === this.pos.length) {
      this.pos.set(s.pos);
      this.mask.set(s.mask);
      this.paint.set(s.paint);
      this.refreshAllColors();
      this.dirtyPos = true;
      this.flush();
      this.rebuildBVH();
    } else {
      this.setData(
        new Float32Array(s.pos),
        s.index,
        new Float32Array(s.mask),
        new Float32Array(s.paint)
      );
    }
  }

  dispose() {
    if (this.geo) {
      (this.geo as any).disposeBoundsTree?.();
      this.geo.dispose();
    }
  }
}
