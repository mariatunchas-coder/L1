import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { OBJExporter } from "three/examples/jsm/exporters/OBJExporter.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  createEllipsoid,
  createPrimitive,
  mirrorData,
  subdivide,
  toMeshData,
  type MeshData,
  type PrimitiveKind,
} from "./mesh";
import { Part, type PartSnapshot } from "./part";

export type ToolId =
  | "draw"
  | "clay"
  | "inflate"
  | "smooth"
  | "flatten"
  | "scrape"
  | "pinch"
  | "crease"
  | "layer"
  | "nudge"
  | "grab"
  | "snake"
  | "mask"
  | "paint"
  | "transform"
  | "roughen"
  | "trim";

export type FalloffId = "smooth" | "sphere" | "linear" | "sharp";

export interface Settings {
  tool: ToolId;
  radius: number;
  strength: number;
  falloff: FalloffId;
  spacing: number;
  invert: boolean;
  color: string;
  symX: boolean;
  symY: boolean;
  symZ: boolean;
  radial: number;
  frontOnly: boolean;
  crossParts: boolean;
  autoSelect: boolean;
  cameraMode: boolean;
  transformMode: "translate" | "rotate" | "scale";
  wire: boolean;
  flat: boolean;
  grid: boolean;
  axes: boolean;
  labels: boolean;
  symPlanes: boolean;
  matcap: number;
  /** khusus tool "roughen": frekuensi noise (semakin besar = bintil semakin rapat/kecil) */
  noiseScale: number;
}

export const defaultSettings: Settings = {
  tool: "draw",
  radius: 70,
  strength: 0.5,
  falloff: "smooth",
  spacing: 0.12,
  invert: false,
  color: "#d9534f",
  symX: true,
  symY: false,
  symZ: false,
  radial: 1,
  frontOnly: true,
  crossParts: true,
  autoSelect: true,
  cameraMode: false,
  transformMode: "translate",
  wire: false,
  flat: false,
  grid: true,
  axes: true,
  labels: true,
  symPlanes: true,
  matcap: 0,
  noiseScale: 8,
};

export interface PartInfo {
  id: number;
  name: string;
  visible: boolean;
  verts: number;
  tris: number;
}

export interface EngineState {
  parts: PartInfo[];
  activeId: number | null;
  canUndo: boolean;
  canRedo: boolean;
  verts: number;
  tris: number;
  dims: [number, number, number] | null;
  hasMask: boolean;
}

export type ExportFormat = "obj" | "glb" | "gltf" | "stl";

interface Copy {
  sx: number;
  sy: number;
  sz: number;
  c: number;
  s: number;
}

class Rec {
  idx: number[] = [];
  pos: number[] = [];
  mask: number[] = [];
  paint: number[] = [];
  constructor(public part: Part, public id: number) {}
  touch(i: number) {
    const p = this.part;
    if (p.stamp[i] === this.id) return;
    p.stamp[i] = this.id;
    this.idx.push(i);
    const o = i * 3;
    this.pos.push(p.pos[o], p.pos[o + 1], p.pos[o + 2]);
    this.mask.push(p.mask[i]);
    this.paint.push(p.paint[o], p.paint[o + 1], p.paint[o + 2]);
  }
}

interface Delta {
  part: Part;
  idx: Uint32Array;
  pos: Float32Array;
  mask: Float32Array;
  paint: Float32Array;
}

interface HistoryEntry {
  undo(): void;
  redo(): void;
  bytes: number;
}

interface Group {
  part: Part;
  cp: Copy;
  idx: Int32Array;
  w: Float32Array;
  p0: Float32Array;
}

interface Stroke {
  id: number;
  part: Part;
  tool: ToolId;
  inv: boolean;
  copies: Copy[];
  recs: Map<Part, Rec>;
  queue: { x: number; y: number; pr: number }[];
  last: THREE.Vector3 | null;
  hasDab: boolean;
  orig: Map<Part, { pos: Float32Array; nor: Float32Array }>;
  groups: Group[];
  plane: THREE.Plane | null;
  P0: THREE.Vector3;
  lastP: THREE.Vector3;
  center: THREE.Vector3;
  pressure: number;
  R: number;
}

const MAX_TRIS = 900_000;

/**
 * Hash 3D -> [-1, 1] yang deterministik (bukan Math.random()), supaya noise di
 * tool "roughen" konsisten tiap kali brush melewati vertex yang sama — kalau
 * pakai random murni, permukaan akan "berkedip"/flicker setiap dab baru pada
 * area yang sama karena noise-nya beda tiap kali.
 */
function hashNoise3(x: number, y: number, z: number, scale: number): number {
  const sx = x * scale,
    sy = y * scale,
    sz = z * scale;
  const n = Math.sin(sx * 12.9898 + sy * 78.233 + sz * 37.719) * 43758.5453;
  return (n - Math.floor(n)) * 2 - 1; // -1..1
}

const AXIS_COLORS = { x: 0xe5484d, y: 0x46c35f, z: 0x3b82f6 };

function makeMatcap(kind: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d")!;
  const palettes = [
    ["#ffffff", "#d8d3cc", "#6b655e", "#1f1d1b"], // clay
    ["#ffffff", "#f3f4f8", "#b9bdca", "#585c6b"], // pearl
    ["#ffe2d6", "#d96a4f", "#7a2b1d", "#220c07"], // red wax
    ["#ffffff", "#9fb4cc", "#3d4a5c", "#0c1118"], // metal
  ];
  const p = palettes[kind % palettes.length];
  ctx.fillStyle = p[3];
  ctx.fillRect(0, 0, 256, 256);
  const g = ctx.createRadialGradient(100, 88, 6, 128, 128, 128);
  g.addColorStop(0, p[0]);
  g.addColorStop(0.28, p[1]);
  g.addColorStop(0.75, p[2]);
  g.addColorStop(1, p[3]);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(128, 128, 128, 0, Math.PI * 2);
  ctx.fill();
  const rim = ctx.createRadialGradient(190, 200, 10, 190, 200, 110);
  rim.addColorStop(0, "rgba(255,255,255,0.28)");
  rim.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.arc(128, 128, 128, 0, Math.PI * 2);
  ctx.fill();
  if (kind === 3) {
    ctx.globalCompositeOperation = "overlay";
    const b = ctx.createLinearGradient(0, 0, 0, 256);
    b.addColorStop(0, "#fff");
    b.addColorStop(0.5, "#222");
    b.addColorStop(0.52, "#aaa");
    b.addColorStop(1, "#000");
    ctx.fillStyle = b;
    ctx.beginPath();
    ctx.arc(128, 128, 128, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function labelSprite(text: string, color: string): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.font = "bold 40px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(text, 64, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, opacity: 0.85 });
  const s = new THREE.Sprite(m);
  s.scale.set(0.34, 0.17, 1);
  return s;
}

export class SculptEngine {
  canvas: HTMLCanvasElement;
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(40, 1, 0.02, 300);
  s: Settings = { ...defaultSettings };

  parts: Part[] = [];
  active: Part | null = null;
  private nextId = 1;
  private counters: Record<string, number> = {};

  // camera
  private target = new THREE.Vector3(0, 0.6, 0);
  private theta = 0.5;
  private phi = 1.25;
  private dist = 6;

  // materials
  private matcaps: THREE.CanvasTexture[] = [];
  private material: THREE.MeshMatcapMaterial;
  private wireMaterial: THREE.MeshBasicMaterial;

  // helpers
  private gridHelper: THREE.GridHelper;
  private axesLines: THREE.LineSegments;
  private labelGroup = new THREE.Group();
  private symPlaneGroup = new THREE.Group();
  private symPlanes: Record<string, THREE.Mesh> = {};
  private cursorGroup = new THREE.Group();
  private rings: THREE.LineLoop[] = [];
  private tc: TransformControls;
  private selBox: THREE.BoxHelper;

  // interaction
  private pointers = new Map<number, { x: number; y: number }>();
  private gesture: "none" | "sculpt" | "orbit" | "pan" | "pinch" | "select" | "idle" = "none";
  private downPos = { x: 0, y: 0 };
  private lastDist = 0;
  private lastMid = { x: 0, y: 0 };
  private spaceDown = false;
  private stroke: Stroke | null = null;
  private strokeCounter = 0;
  private raycaster = new THREE.Raycaster();
  private needsRender = true;
  private raf = 0;
  private ro: ResizeObserver;
  private lastHoverEmit = 0;
  private paintColor = new THREE.Color();

  // history
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];

  // buffers
  private idxBuf = new Int32Array(0);
  private wBuf = new Float32Array(0);
  private tmpBuf = new Float32Array(0);

  // gizmo
  private gizmoCanvas: HTMLCanvasElement | null = null;
  private gizmoTips: { label: string; x: number; y: number; r: number }[] = [];

  // callbacks
  onState: (s: EngineState) => void = () => {};
  onHover: (p: THREE.Vector3 | null) => void = () => {};
  onToast: (msg: string) => void = () => {};

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene.background = new THREE.Color(0x15171d);

    for (let i = 0; i < 4; i++) this.matcaps.push(makeMatcap(i));
    this.material = new THREE.MeshMatcapMaterial({
      matcap: this.matcaps[0],
      vertexColors: true,
      side: THREE.DoubleSide,
    });
    this.wireMaterial = new THREE.MeshBasicMaterial({
      color: 0x0b0c10,
      wireframe: true,
      transparent: true,
      opacity: 0.35,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      depthWrite: false,
    });

    // grid + axes
    this.gridHelper = new THREE.GridHelper(10, 20, 0x39404f, 0x242933);
    this.scene.add(this.gridHelper);
    const ap: number[] = [];
    const ac: number[] = [];
    const L = 5;
    const add = (v: number[], col: number) => {
      const c = new THREE.Color(col);
      ap.push(...v);
      ac.push(c.r, c.g, c.b, c.r, c.g, c.b);
    };
    add([-L, 0, 0, L, 0, 0], AXIS_COLORS.x);
    add([0, -L, 0, 0, L, 0], AXIS_COLORS.y);
    add([0, 0, -L, 0, 0, L], AXIS_COLORS.z);
    const ag = new THREE.BufferGeometry();
    ag.setAttribute("position", new THREE.Float32BufferAttribute(ap, 3));
    ag.setAttribute("color", new THREE.Float32BufferAttribute(ac, 3));
    this.axesLines = new THREE.LineSegments(
      ag,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8 })
    );
    this.scene.add(this.axesLines);

    for (let i = -4; i <= 4; i++) {
      if (i === 0) continue;
      const sx = labelSprite(String(i), "#ff7b80");
      sx.position.set(i, -0.12, 0);
      const sy = labelSprite(String(i), "#6ee08a");
      sy.position.set(0.2, i, 0);
      const sz = labelSprite(String(i), "#7aa7ff");
      sz.position.set(0, -0.12, i);
      this.labelGroup.add(sx, sy, sz);
    }
    const o = labelSprite("0", "#cbd0dc");
    o.position.set(0.15, -0.12, 0.15);
    this.labelGroup.add(o);
    this.scene.add(this.labelGroup);

    // symmetry planes
    const mkPlane = (col: number, rx: number, ry: number) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(6, 6),
        new THREE.MeshBasicMaterial({
          color: col,
          transparent: true,
          opacity: 0.07,
          side: THREE.DoubleSide,
          depthWrite: false,
        })
      );
      m.rotation.set(rx, ry, 0);
      m.raycast = () => {};
      this.symPlaneGroup.add(m);
      return m;
    };
    this.symPlanes.x = mkPlane(AXIS_COLORS.x, 0, Math.PI / 2);
    this.symPlanes.y = mkPlane(AXIS_COLORS.y, Math.PI / 2, 0);
    this.symPlanes.z = mkPlane(AXIS_COLORS.z, 0, 0);
    this.scene.add(this.symPlaneGroup);
    this.scene.add(this.cursorGroup);

    // selection box
    this.selBox = new THREE.BoxHelper(new THREE.Object3D(), 0x7c9cff);
    this.selBox.visible = false;
    this.scene.add(this.selBox);

    // transform controls (registered BEFORE our own pointer listeners)
    this.tc = new TransformControls(this.camera, canvas);
    this.tc.setSize(1.0);
    this.scene.add(this.tc.getHelper());
    this.tc.addEventListener("change", () => {
      this.needsRender = true;
      this.updateSelBox();
    });
    this.tc.addEventListener("dragging-changed", (e: any) => {
      if (!e.value) this.emitState();
    });

    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointercancel", this.onUp);
    canvas.addEventListener("pointerleave", this.onLeave);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKey);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
    this.applySettings();
    this.applyCamera();
    this.loop();
  }

  // ───────────────────────── settings ─────────────────────────

  setSettings(p: Partial<Settings>) {
    const prevTool = this.s.tool;
    this.s = { ...this.s, ...p };
    if (p.tool && prevTool === "transform" && p.tool !== "transform") {
      this.bakeAll();
    }
    this.applySettings();
  }

  private applySettings() {
    const s = this.s;
    const mc = this.matcaps[s.matcap % 4];
    if (this.material.matcap !== mc || this.material.flatShading !== s.flat) {
      this.material.matcap = mc;
      this.material.flatShading = s.flat;
      this.material.needsUpdate = true;
    }
    this.gridHelper.visible = s.grid;
    this.axesLines.visible = s.axes;
    this.labelGroup.visible = s.labels;
    this.symPlaneGroup.visible = s.symPlanes;
    this.symPlanes.x.visible = s.symX;
    this.symPlanes.y.visible = s.symY;
    this.symPlanes.z.visible = s.symZ;
    for (const p of this.parts) p.wire.visible = s.wire;
    this.paintColor.set(s.color);
    const isT = s.tool === "transform";
    this.tc.enabled = isT;
    if (isT && this.active) {
      this.tc.attach(this.active.mesh);
      this.tc.setMode(s.transformMode);
      this.tc.getHelper().visible = true;
    } else {
      this.tc.detach();
      this.tc.getHelper().visible = false;
    }
    this.updateSelBox();
    if (!isT || s.cameraMode) this.hideCursor();
    this.needsRender = true;
  }

  private updateSelBox() {
    if (this.s.tool === "transform" && this.active) {
      this.selBox.setFromObject(this.active.mesh);
      this.selBox.visible = true;
    } else this.selBox.visible = false;
  }

  // ───────────────────────── scene / parts ─────────────────────────

  private nameFor(base: string) {
    this.counters[base] = (this.counters[base] || 0) + 1;
    return `${base} ${this.counters[base]}`;
  }

  private createPart(data: MeshData, name: string, mask?: Float32Array, paint?: Float32Array) {
    const part = new Part(this.nextId++, name, this.material, this.wireMaterial);
    part.setData(data.pos, data.index, mask, paint);
    part.wire.visible = this.s.wire;
    return part;
  }

  private attach(part: Part) {
    this.parts.push(part);
    this.scene.add(part.mesh);
    this.needsRender = true;
  }

  private detach(part: Part) {
    const i = this.parts.indexOf(part);
    if (i >= 0) this.parts.splice(i, 1);
    this.scene.remove(part.mesh);
    if (this.active === part) this.active = this.parts[this.parts.length - 1] ?? null;
    this.needsRender = true;
  }

  private pushHistory(e: HistoryEntry) {
    this.undoStack.push(e);
    this.redoStack = [];
    let total = this.undoStack.reduce((a, b) => a + b.bytes, 0);
    while (this.undoStack.length > 120 || (total > 450e6 && this.undoStack.length > 1)) {
      total -= this.undoStack.shift()!.bytes;
    }
  }

  addPart(data: MeshData, baseName: string, record = true): Part {
    const part = this.createPart(data, this.nameFor(baseName));
    this.attach(part);
    this.active = part;
    if (record) {
      this.pushHistory({
        bytes: data.pos.byteLength * 3,
        undo: () => this.detach(part),
        redo: () => {
          this.attach(part);
          this.active = part;
        },
      });
    }
    this.applySettings();
    this.emitState();
    return part;
  }

  addPrimitive(kind: PrimitiveKind, quality = 1) {
    this.bakeAll();
    const names: Record<PrimitiveKind, string> = {
      sphere: "Bola",
      cube: "Kubus",
      cylinder: "Silinder",
      capsule: "Kapsul",
      cone: "Kerucut",
      torus: "Torus",
      plane: "Bidang",
    };
    const p = this.addPart(createPrimitive(kind, quality), names[kind]);
    if (this.s.tool === "transform") this.applySettings();
    return p;
  }

  removePart(id: number) {
    const part = this.parts.find((p) => p.id === id);
    if (!part) return;
    const wasActive = this.active === part;
    this.detach(part);
    this.pushHistory({
      bytes: 1000,
      undo: () => {
        this.attach(part);
        if (wasActive) this.active = part;
        this.applySettings();
      },
      redo: () => this.detach(part),
    });
    this.applySettings();
    this.emitState();
  }

  duplicatePart(id: number, mirrorAxis?: 0 | 1 | 2) {
    const src = this.parts.find((p) => p.id === id);
    if (!src) return;
    this.bakeAll();
    let data: MeshData = { pos: new Float32Array(src.pos), index: src.index };
    if (mirrorAxis !== undefined) data = mirrorData(data, mirrorAxis);
    const part = this.createPart(
      data,
      src.name + (mirrorAxis !== undefined ? " (cermin)" : " (salinan)"),
      new Float32Array(src.mask),
      new Float32Array(src.paint)
    );
    this.attach(part);
    this.active = part;
    this.pushHistory({
      bytes: data.pos.byteLength * 3,
      undo: () => this.detach(part),
      redo: () => {
        this.attach(part);
        this.active = part;
      },
    });
    this.applySettings();
    this.emitState();
  }

  setActive(id: number) {
    const p = this.parts.find((x) => x.id === id);
    if (!p) return;
    this.active = p;
    this.applySettings();
    this.emitState();
  }

  toggleVisible(id: number) {
    const p = this.parts.find((x) => x.id === id);
    if (!p) return;
    p.visible = !p.visible;
    p.mesh.visible = p.visible;
    this.needsRender = true;
    this.emitState();
  }

  renamePart(id: number, name: string) {
    const p = this.parts.find((x) => x.id === id);
    if (p) {
      p.name = name;
      this.emitState();
    }
  }

  private commitSnap(part: Part, before: PartSnapshot, label?: string) {
    const after = part.snapshot();
    void label;
    this.pushHistory({
      bytes: (before.pos.byteLength + after.pos.byteLength) * 2,
      undo: () => {
        part.restore(before);
        this.afterEdit();
      },
      redo: () => {
        part.restore(after);
        this.afterEdit();
      },
    });
    this.afterEdit();
  }

  private afterEdit() {
    this.needsRender = true;
    this.updateSelBox();
    this.emitState();
  }

  private bakeAll() {
    for (const part of this.parts) this.bakePart(part);
  }

  private bakePart(part: Part) {
    const m = part.mesh;
    m.updateMatrix();
    const identity = new THREE.Matrix4();
    if (m.matrix.equals(identity)) return;
    const before = part.snapshot();
    const mat = m.matrix.clone();
    const v = new THREE.Vector3();
    const pos = new Float32Array(part.pos);
    for (let i = 0; i < pos.length; i += 3) {
      v.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(mat);
      pos[i] = v.x;
      pos[i + 1] = v.y;
      pos[i + 2] = v.z;
    }
    m.position.set(0, 0, 0);
    m.quaternion.identity();
    m.scale.set(1, 1, 1);
    m.updateMatrix();
    m.updateMatrixWorld(true);
    part.setData(pos, part.index, new Float32Array(part.mask), new Float32Array(part.paint));
    // determinant < 0 (negative scale) -> flip winding
    if (mat.determinant() < 0) {
      const idx = new Uint32Array(part.index);
      for (let i = 0; i < idx.length; i += 3) {
        const t = idx[i + 1];
        idx[i + 1] = idx[i + 2];
        idx[i + 2] = t;
      }
      part.setData(part.pos, idx, part.mask, part.paint);
    }
    this.commitSnap(part, before);
  }

  subdividePart(smooth: boolean): boolean {
    const part = this.active;
    if (!part) return false;
    if (part.triCount * 4 > MAX_TRIS) {
      this.onToast("Batas poligon tercapai (maks 900 rb segitiga) – subdivisi dibatalkan.");
      return false;
    }
    this.bakePart(part);
    const before = part.snapshot();
    const n = part.vertCount;
    const r = subdivide(part.pos, part.index, smooth);
    const total = r.pos.length / 3;
    const mask = new Float32Array(total);
    const paint = new Float32Array(total * 3);
    mask.set(part.mask);
    paint.set(part.paint);
    for (let e = 0; e < total - n; e++) {
      const a = r.parents[e * 2],
        b = r.parents[e * 2 + 1];
      mask[n + e] = (part.mask[a] + part.mask[b]) * 0.5;
      for (let k = 0; k < 3; k++)
        paint[(n + e) * 3 + k] = (part.paint[a * 3 + k] + part.paint[b * 3 + k]) * 0.5;
    }
    part.setData(r.pos, r.index, mask, paint);
    this.commitSnap(part, before);
    return true;
  }

  /** global operations on active part */
  smoothAll(iterations = 1, amount = 0.5) {
    const part = this.active;
    if (!part) return;
    this.bakePart(part);
    const before = part.snapshot();
    const adj = part.adjacency;
    const n = part.vertCount;
    let src = new Float32Array(part.pos);
    let dst = new Float32Array(part.pos);
    for (let it = 0; it < iterations; it++) {
      for (let i = 0; i < n; i++) {
        const a0 = adj.offsets[i],
          a1 = adj.offsets[i + 1];
        const w = amount * (1 - part.mask[i]);
        if (a1 === a0 || w <= 0) {
          dst[i * 3] = src[i * 3];
          dst[i * 3 + 1] = src[i * 3 + 1];
          dst[i * 3 + 2] = src[i * 3 + 2];
          continue;
        }
        let x = 0,
          y = 0,
          z = 0;
        for (let k = a0; k < a1; k++) {
          const j = adj.list[k] * 3;
          x += src[j];
          y += src[j + 1];
          z += src[j + 2];
        }
        const c = a1 - a0;
        dst[i * 3] = src[i * 3] + (x / c - src[i * 3]) * w;
        dst[i * 3 + 1] = src[i * 3 + 1] + (y / c - src[i * 3 + 1]) * w;
        dst[i * 3 + 2] = src[i * 3 + 2] + (z / c - src[i * 3 + 2]) * w;
      }
      [src, dst] = [dst, src];
    }
    part.pos.set(src);
    part.dirtyPos = true;
    part.flush();
    part.rebuildBVH();
    this.commitSnap(part, before);
  }

  inflateAll(amount: number) {
    const part = this.active;
    if (!part) return;
    this.bakePart(part);
    const before = part.snapshot();
    for (let i = 0; i < part.vertCount; i++) {
      const w = (1 - part.mask[i]) * amount;
      part.pos[i * 3] += part.nor[i * 3] * w;
      part.pos[i * 3 + 1] += part.nor[i * 3 + 1] * w;
      part.pos[i * 3 + 2] += part.nor[i * 3 + 2] * w;
    }
    part.dirtyPos = true;
    part.flush();
    part.rebuildBVH();
    this.commitSnap(part, before);
  }

  maskOp(op: "clear" | "invert" | "blur" | "sharpen" | "all") {
    const part = this.active;
    if (!part) return;
    const before = part.snapshot();
    const n = part.vertCount;
    const m = part.mask;
    if (op === "clear") m.fill(0);
    else if (op === "all") m.fill(1);
    else if (op === "invert") for (let i = 0; i < n; i++) m[i] = 1 - m[i];
    else if (op === "sharpen") for (let i = 0; i < n; i++) m[i] = m[i] * m[i] * (3 - 2 * m[i]) > 0.5 ? Math.min(1, m[i] * 1.5) : m[i] * 0.5;
    else {
      const adj = part.adjacency;
      const o = new Float32Array(m);
      for (let i = 0; i < n; i++) {
        const a0 = adj.offsets[i],
          a1 = adj.offsets[i + 1];
        let s = o[i];
        for (let k = a0; k < a1; k++) s += o[adj.list[k]];
        m[i] = s / (a1 - a0 + 1);
      }
    }
    part.refreshAllColors();
    this.commitSnap(part, before);
  }

  fillPaint(color: string) {
    const part = this.active;
    if (!part) return;
    const before = part.snapshot();
    const c = new THREE.Color(color);
    for (let i = 0; i < part.vertCount; i++) {
      part.paint[i * 3] = c.r;
      part.paint[i * 3 + 1] = c.g;
      part.paint[i * 3 + 2] = c.b;
    }
    part.refreshAllColors();
    this.commitSnap(part, before);
  }

  newScene(kind: "sphere" | "character" | "empty") {
    for (const p of [...this.parts]) {
      this.scene.remove(p.mesh);
      p.dispose();
    }
    this.parts = [];
    this.active = null;
    this.undoStack = [];
    this.redoStack = [];
    this.counters = {};
    if (kind === "sphere") {
      this.addPart(createPrimitive("sphere", 1.15), "Bola", false);
    } else if (kind === "character") {
      this.buildCharacter();
    }
    this.applySettings();
    this.frameAll();
    this.emitState();
  }

  private buildCharacter() {
    const D = 24;
    const defs: [string, MeshData][] = [
      ["Badan", createEllipsoid(D, [0.52, 0.72, 0.34], [0, 1.5, 0])],
      ["Kepala", createEllipsoid(D, [0.33, 0.4, 0.36], [0, 2.55, 0.02])],
      ["Lengan Kiri", createEllipsoid(D - 6, [0.13, 0.62, 0.13], [1.12, 1.98, 0], Math.PI / 2)],
      ["Lengan Kanan", createEllipsoid(D - 6, [0.13, 0.62, 0.13], [-1.12, 1.98, 0], -Math.PI / 2)],
      ["Tangan Kiri", createEllipsoid(D - 8, [0.16, 0.14, 0.1], [1.86, 1.98, 0])],
      ["Tangan Kanan", createEllipsoid(D - 8, [0.16, 0.14, 0.1], [-1.86, 1.98, 0])],
      ["Kaki Kiri", createEllipsoid(D - 4, [0.2, 0.85, 0.2], [0.26, 0.82, 0])],
      ["Kaki Kanan", createEllipsoid(D - 4, [0.2, 0.85, 0.2], [-0.26, 0.82, 0])],
      ["Telapak Kiri", createEllipsoid(D - 8, [0.18, 0.1, 0.32], [0.26, 0.08, 0.12])],
      ["Telapak Kanan", createEllipsoid(D - 8, [0.18, 0.1, 0.32], [-0.26, 0.08, 0.12])],
    ];
    for (const [name, data] of defs) {
      const part = this.createPart(data, name);
      this.attach(part);
      this.active = part;
    }
    this.active = this.parts[1];
    this.target.set(0, 1.4, 0);
  }

  // ───────────────────────── history ─────────────────────────

  undo() {
    if (this.stroke) return;
    const e = this.undoStack.pop();
    if (!e) return;
    e.undo();
    this.redoStack.push(e);
    this.applySettings();
    this.afterEdit();
  }

  redo() {
    if (this.stroke) return;
    const e = this.redoStack.pop();
    if (!e) return;
    e.redo();
    this.undoStack.push(e);
    this.applySettings();
    this.afterEdit();
  }

  private swapDelta(d: Delta) {
    const p = d.part;
    for (let k = 0; k < d.idx.length; k++) {
      const i = d.idx[k];
      const o = i * 3;
      for (let c = 0; c < 3; c++) {
        let t = p.pos[o + c];
        p.pos[o + c] = d.pos[k * 3 + c];
        d.pos[k * 3 + c] = t;
        t = p.paint[o + c];
        p.paint[o + c] = d.paint[k * 3 + c];
        d.paint[k * 3 + c] = t;
      }
      const m = p.mask[i];
      p.mask[i] = d.mask[k];
      d.mask[k] = m;
      p.refreshColor(i);
    }
    p.dirtyPos = true;
    p.dirtyCol = true;
    p.flush();
    p.rebuildBVH();
  }

  // ───────────────────────── state ─────────────────────────

  emitState() {
    let verts = 0,
      tris = 0;
    const box = new THREE.Box3();
    let any = false;
    for (const p of this.parts) {
      verts += p.vertCount;
      tris += p.triCount;
      if (p.visible) {
        const b = p.bbox.clone();
        if (!p.mesh.matrix.equals(new THREE.Matrix4().identity())) b.applyMatrix4(p.mesh.matrix);
        box.union(b);
        any = true;
      }
    }
    let hasMask = false;
    if (this.active) {
      const m = this.active.mask;
      for (let i = 0; i < m.length; i++)
        if (m[i] > 0) {
          hasMask = true;
          break;
        }
    }
    const size = box.getSize(new THREE.Vector3());
    this.onState({
      parts: this.parts.map((p) => ({
        id: p.id,
        name: p.name,
        visible: p.visible,
        verts: p.vertCount,
        tris: p.triCount,
      })),
      activeId: this.active?.id ?? null,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      verts,
      tris,
      dims: any ? [size.x, size.y, size.z] : null,
      hasMask,
    });
  }

  // ───────────────────────── camera ─────────────────────────

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(r.width));
    const h = Math.max(1, Math.floor(r.height));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  }

  private applyCamera() {
    const sp = Math.sin(this.phi);
    this.camera.position.set(
      this.target.x + this.dist * sp * Math.sin(this.theta),
      this.target.y + this.dist * Math.cos(this.phi),
      this.target.z + this.dist * sp * Math.cos(this.theta)
    );
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
    this.needsRender = true;
  }

  private worldPerPixel(dist: number) {
    const h = this.canvas.getBoundingClientRect().height || 1;
    return (2 * dist * Math.tan((this.camera.fov * Math.PI) / 360)) / h;
  }

  private orbit(dx: number, dy: number) {
    this.theta -= dx * 0.0065;
    this.phi = Math.min(Math.PI - 0.01, Math.max(0.01, this.phi - dy * 0.0065));
    this.applyCamera();
  }

  private pan(dx: number, dy: number) {
    const k = this.worldPerPixel(this.dist);
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    this.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
    this.applyCamera();
  }

  private zoom(factor: number) {
    this.dist = Math.min(80, Math.max(0.25, this.dist * factor));
    this.applyCamera();
  }

  setView(v: string) {
    switch (v) {
      case "+x":
        this.theta = Math.PI / 2;
        this.phi = Math.PI / 2;
        break;
      case "-x":
        this.theta = -Math.PI / 2;
        this.phi = Math.PI / 2;
        break;
      case "+z":
        this.theta = 0;
        this.phi = Math.PI / 2;
        break;
      case "-z":
        this.theta = Math.PI;
        this.phi = Math.PI / 2;
        break;
      case "+y":
        this.phi = 0.012;
        break;
      case "-y":
        this.phi = Math.PI - 0.012;
        break;
    }
    this.applyCamera();
  }

  frameAll() {
    const box = new THREE.Box3();
    let any = false;
    for (const p of this.parts) {
      if (!p.visible) continue;
      box.union(p.bbox);
      any = true;
    }
    if (!any) {
      this.target.set(0, 0.5, 0);
      this.dist = 6;
    } else {
      const c = box.getCenter(new THREE.Vector3());
      const r = (box.getSize(new THREE.Vector3()).length() / 2) * 0.85;
      this.target.copy(c);
      const half = Math.atan(Math.tan((this.camera.fov * Math.PI) / 360) * Math.min(1, this.camera.aspect));
      this.dist = Math.max(1.5, (r * 1.12) / Math.sin(half));
    }
    this.theta = 0.55;
    this.phi = 1.3;
    this.applyCamera();
  }

  // ───────────────────────── input ─────────────────────────

  private local(e: { clientX: number; clientY: number }) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private setRay(x: number, y: number) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2((x / r.width) * 2 - 1, -(y / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    (this.raycaster as any).firstHitOnly = true;
  }

  private pick(x: number, y: number, onlyPart?: Part | null) {
    this.setRay(x, y);
    const meshes = onlyPart
      ? [onlyPart.mesh]
      : this.parts.filter((p) => p.visible).map((p) => p.mesh);
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (!hits.length) return null;
    const h = hits[0];
    const part = h.object.userData.part as Part;
    const n = h.face ? h.face.normal.clone() : new THREE.Vector3(0, 1, 0);
    return { part, point: h.point.clone(), normal: n };
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.code === "Space") {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "BUTTON")) return;
      this.spaceDown = e.type === "keydown";
      if (this.spaceDown) e.preventDefault();
    }
  };

  private onDown = (e: PointerEvent) => {
    if (this.tc.dragging) return;
    if (this.tc.axis && this.s.tool === "transform" && this.active) return;
    e.preventDefault();
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);

    if (this.pointers.size >= 2) {
      if (this.stroke) this.endStroke(true);
      this.hideCursor();
      this.gesture = "pinch";
      const [a, b] = [...this.pointers.values()];
      this.lastDist = Math.hypot(a.x - b.x, a.y - b.y);
      this.lastMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      return;
    }
    this.downPos = p;
    const mouse = e.pointerType === "mouse";
    if (mouse && e.button === 1) {
      this.gesture = e.shiftKey ? "pan" : "orbit";
      return;
    }
    if (mouse && e.button === 2) {
      this.gesture = "pan";
      return;
    }
    if (mouse && e.button === 0 && (e.altKey || this.spaceDown)) {
      this.gesture = this.spaceDown || e.shiftKey ? "pan" : "orbit";
      return;
    }
    if (this.s.tool === "transform") {
      this.gesture = "select";
      return;
    }
    if (this.s.cameraMode) {
      this.gesture = "orbit";
      return;
    }
    // sculpt?
    let hit = this.s.autoSelect
      ? this.pick(p.x, p.y)
      : this.active
      ? this.pick(p.x, p.y, this.active)
      : null;
    if (!this.active && hit) this.active = hit.part;
    if (hit && this.active && hit.part !== this.active) {
      this.active = hit.part;
      this.applySettings();
      this.emitState();
    }
    if (!hit) {
      this.gesture = "orbit";
      return;
    }
    hit = hit as NonNullable<typeof hit>;
    this.beginStroke(hit.part, hit.point, hit.normal, e, p);
  };

  private onMove = (e: PointerEvent) => {
    const id = e.pointerId;
    if (!this.pointers.has(id)) {
      if (e.pointerType === "mouse" && !this.tc.dragging) this.hover(e);
      return;
    }
    const prev = this.pointers.get(id)!;
    const cur = this.local(e);
    this.pointers.set(id, cur);
    const dx = cur.x - prev.x,
      dy = cur.y - prev.y;
    switch (this.gesture) {
      case "sculpt": {
        if (!this.stroke) break;
        const evs = (e.getCoalescedEvents?.() ?? []).filter(Boolean);
        const list = evs.length ? evs : [e];
        for (const ev of list) {
          const l = this.local(ev);
          this.stroke.queue.push({ x: l.x, y: l.y, pr: ev.pointerType === "pen" ? Math.max(0.05, ev.pressure) : 1 });
        }
        break;
      }
      case "orbit":
        this.orbit(dx, dy);
        break;
      case "pan":
        this.pan(dx, dy);
        break;
      case "select":
        if (Math.hypot(cur.x - this.downPos.x, cur.y - this.downPos.y) > 6) {
          this.gesture = "orbit";
          this.orbit(cur.x - this.downPos.x, cur.y - this.downPos.y);
        }
        break;
      case "pinch": {
        if (this.pointers.size < 2) break;
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (this.lastDist > 0 && d > 0) this.zoom(this.lastDist / d);
        this.pan(mid.x - this.lastMid.x, mid.y - this.lastMid.y);
        this.lastDist = d;
        this.lastMid = mid;
        break;
      }
    }
  };

  private onUp = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this.local(e);
    this.pointers.delete(e.pointerId);
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (this.gesture === "sculpt" && this.stroke) {
      this.processStroke();
      this.endStroke(false);
      if (e.pointerType !== "mouse") this.hideCursor();
    } else if (this.gesture === "select" && e.type === "pointerup") {
      if (Math.hypot(p.x - this.downPos.x, p.y - this.downPos.y) < 8) {
        const hit = this.pick(p.x, p.y);
        if (hit) {
          this.active = hit.part;
          this.applySettings();
          this.emitState();
        }
      }
    }
    if (this.pointers.size === 0) this.gesture = "none";
    else if (this.gesture === "pinch") this.gesture = "idle";
  };

  private onLeave = () => {
    if (!this.stroke) {
      this.hideCursor();
      this.onHover(null);
    }
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (e.shiftKey) this.pan(-e.deltaX || -e.deltaY, 0);
    else this.zoom(Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0012)));
  };

  private hover(e: PointerEvent) {
    if (this.s.tool === "transform" || this.s.cameraMode) {
      this.hideCursor();
      return;
    }
    const p = this.local(e);
    const hit = this.s.autoSelect ? this.pick(p.x, p.y) : this.pick(p.x, p.y, this.active);
    if (!hit) {
      this.hideCursor();
      this.emitHover(null);
      return;
    }
    this.showCursor(hit.point, hit.normal, this.worldRadius(hit.point), this.buildCopies());
    this.emitHover(hit.point);
  }

  private emitHover(p: THREE.Vector3 | null) {
    const now = performance.now();
    if (now - this.lastHoverEmit < 50 && p) return;
    this.lastHoverEmit = now;
    this.onHover(p);
  }

  // ───────────────────────── cursor ─────────────────────────

  private ringGeo = (() => {
    const pts: number[] = [];
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      pts.push(Math.cos(a), Math.sin(a), 0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  })();

  private showCursor(point: THREE.Vector3, normal: THREE.Vector3, R: number, copies: Copy[]) {
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const nv = new THREE.Vector3();
    const z = new THREE.Vector3(0, 0, 1);
    for (let i = 0; i < copies.length; i++) {
      let ring = this.rings[i];
      if (!ring) {
        ring = new THREE.LineLoop(
          this.ringGeo,
          new THREE.LineBasicMaterial({
            color: i === 0 ? 0xffffff : 0x9db4ff,
            transparent: true,
            opacity: i === 0 ? 0.95 : 0.55,
            depthTest: false,
          })
        );
        ring.renderOrder = 999;
        ring.raycast = () => {};
        this.rings[i] = ring;
        this.cursorGroup.add(ring);
      }
      v.copy(point);
      nv.copy(normal);
      this.applyCopy(v, copies[i]);
      this.applyCopy(nv, copies[i]);
      nv.normalize();
      q.setFromUnitVectors(z, nv);
      ring.quaternion.copy(q);
      ring.position.copy(v).addScaledVector(nv, R * 0.01);
      ring.scale.setScalar(R);
      ring.visible = true;
    }
    for (let i = copies.length; i < this.rings.length; i++) this.rings[i].visible = false;
    this.needsRender = true;
  }

  private hideCursor() {
    let any = false;
    for (const r of this.rings)
      if (r.visible) {
        r.visible = false;
        any = true;
      }
    if (any) this.needsRender = true;
  }

  // ───────────────────────── symmetry ─────────────────────────

  private buildCopies(): Copy[] {
    const out: Copy[] = [];
    const n = Math.max(1, Math.round(this.s.radial));
    for (const sx of this.s.symX ? [1, -1] : [1])
      for (const sy of this.s.symY ? [1, -1] : [1])
        for (const sz of this.s.symZ ? [1, -1] : [1])
          for (let r = 0; r < n; r++) {
            const a = (r / n) * Math.PI * 2;
            out.push({ sx, sy, sz, c: Math.cos(a), s: Math.sin(a) });
          }
    return out;
  }

  private applyCopy(v: THREE.Vector3, cp: Copy) {
    v.x *= cp.sx;
    v.y *= cp.sy;
    v.z *= cp.sz;
    const x = v.x * cp.c + v.z * cp.s;
    const z = -v.x * cp.s + v.z * cp.c;
    v.x = x;
    v.z = z;
    return v;
  }

  private worldRadius(point: THREE.Vector3) {
    const d = this.camera.position.distanceTo(point);
    return this.s.radius * this.worldPerPixel(d);
  }

  // ───────────────────────── stroke ─────────────────────────

  private targetsFor(copyIndex: number, part: Part): Part[] {
    if (copyIndex === 0 || !this.s.crossParts) return [part];
    return this.parts.filter((p) => p.visible);
  }

  private getRec(part: Part): Rec {
    const s = this.stroke!;
    let r = s.recs.get(part);
    if (!r) {
      r = new Rec(part, s.id);
      s.recs.set(part, r);
    }
    return r;
  }

  private beginStroke(
    part: Part,
    point: THREE.Vector3,
    normal: THREE.Vector3,
    e: PointerEvent,
    p: { x: number; y: number }
  ) {
    const mouse = e.pointerType === "mouse";
    let tool = this.s.tool;
    if (mouse && e.shiftKey && tool !== "smooth") tool = "smooth";
    const inv = this.s.invert !== (mouse && (e.ctrlKey || e.metaKey));
    const id = ++this.strokeCounter;
    const st: Stroke = {
      id,
      part,
      tool,
      inv,
      copies: this.buildCopies(),
      recs: new Map(),
      queue: [],
      last: null,
      hasDab: false,
      orig: new Map(),
      groups: [],
      plane: null,
      P0: new THREE.Vector3(),
      lastP: new THREE.Vector3(),
      center: point.clone(),
      pressure: e.pointerType === "pen" ? Math.max(0.05, e.pressure) : 1,
      R: this.worldRadius(point),
    };
    this.stroke = st;
    this.gesture = "sculpt";
    if (tool === "grab" || tool === "snake") {
      const dir = this.camera.getWorldDirection(new THREE.Vector3());
      st.plane = new THREE.Plane().setFromNormalAndCoplanarPoint(dir, point);
      this.setRay(p.x, p.y);
      const P = new THREE.Vector3();
      if (!this.raycaster.ray.intersectPlane(st.plane, P)) P.copy(point);
      st.P0.copy(P);
      st.lastP.copy(P);
      if (tool === "grab") this.grabSetup(st, point);
    } else {
      st.queue.push({ x: p.x, y: p.y, pr: st.pressure });
      void normal;
    }
    this.showCursor(point, normal, st.R, st.copies);
    this.emitHover(point);
    // first dab immediately
    if (tool !== "grab" && tool !== "snake") {
      this.strokeTo(point, normal, st.pressure);
      st.queue.length = 0;
    }
  }

  private processStroke() {
    const st = this.stroke;
    if (!st) return;
    if (!st.queue.length) return;
    const q = st.queue.splice(0);
    for (const it of q) {
      st.pressure = it.pr;
      if (st.tool === "grab" || st.tool === "snake") {
        this.setRay(it.x, it.y);
        const P = new THREE.Vector3();
        if (!st.plane || !this.raycaster.ray.intersectPlane(st.plane, P)) continue;
        if (st.tool === "grab") this.grabMove(st, P);
        else this.snakeMove(st, P);
        const hitN = new THREE.Vector3(0, 1, 0);
        this.showCursor(st.tool === "snake" ? st.center : st.P0, hitN, st.R, st.copies);
      } else {
        const hit = this.pick(it.x, it.y, st.part);
        if (!hit) continue;
        this.strokeTo(hit.point, hit.normal, it.pr);
        this.showCursor(hit.point, hit.normal, st.R, st.copies);
        this.emitHover(hit.point);
      }
    }
    // refresh pointer ray hover info
    this.needsRender = true;
  }

  private strokeTo(point: THREE.Vector3, normal: THREE.Vector3, pressure: number) {
    const st = this.stroke!;
    const R = this.worldRadius(point);
    st.R = R;
    const spacing = Math.max(R * 2 * this.s.spacing, 1e-5);
    if (!st.last) {
      st.last = point.clone();
      st.hasDab = true;
      this.dabAll(point, normal, new THREE.Vector3(0, 0, 0), R, pressure);
      return;
    }
    const d = point.distanceTo(st.last);
    if (d < spacing) return;
    const dir = point.clone().sub(st.last).normalize();
    const n = Math.floor(d / spacing);
    const pt = st.last.clone();
    for (let k = 0; k < n; k++) {
      pt.addScaledVector(dir, spacing);
      this.dabAll(pt, normal, dir, R, pressure);
    }
    st.last.copy(pt);
  }

  private dabAll(
    c: THREE.Vector3,
    n: THREE.Vector3,
    dir: THREE.Vector3,
    R: number,
    pressure: number
  ) {
    const st = this.stroke!;
    const eye0 = this.camera.position;
    const cc = new THREE.Vector3();
    const nn = new THREE.Vector3();
    const dd = new THREE.Vector3();
    const ee = new THREE.Vector3();
    let k = this.s.strength * pressure;
    if (st.tool === "smooth" && this.s.tool !== "smooth") k = Math.max(k, 0.5);
    for (let ci = 0; ci < st.copies.length; ci++) {
      const cp = st.copies[ci];
      cc.copy(c);
      nn.copy(n);
      dd.copy(dir);
      ee.copy(eye0);
      this.applyCopy(cc, cp);
      this.applyCopy(nn, cp);
      this.applyCopy(dd, cp);
      this.applyCopy(ee, cp);
      nn.normalize();
      for (const part of this.targetsFor(ci, st.part)) {
        this.dab(part, cc, nn, ee, dd, R, k, st.tool, st.inv);
      }
    }
  }

  private ensureBufs(n: number) {
    if (this.idxBuf.length < n) {
      this.idxBuf = new Int32Array(n);
      this.wBuf = new Float32Array(n);
    }
  }

  private falloff(t: number) {
    switch (this.s.falloff) {
      case "sphere":
        return Math.sqrt(Math.max(0, 1 - t * t));
      case "linear":
        return 1 - t;
      case "sharp": {
        const u = 1 - t;
        return u * u;
      }
      default:
        return 1 - t * t * (3 - 2 * t);
    }
  }

  private gather(part: Part, c: THREE.Vector3, R: number, eye: THREE.Vector3, front: boolean): number {
    if (part.bbox.distanceToPoint(c) > R) return 0;
    const n = part.vertCount;
    this.ensureBufs(n);
    const pos = part.pos,
      nor = part.nor;
    const R2 = R * R;
    const idx = this.idxBuf,
      wt = this.wBuf;
    let cnt = 0;
    const cx = c.x,
      cy = c.y,
      cz = c.z;
    for (let i = 0, o = 0; i < n; i++, o += 3) {
      const dx = pos[o] - cx;
      if (dx > R || dx < -R) continue;
      const dy = pos[o + 1] - cy;
      if (dy > R || dy < -R) continue;
      const dz = pos[o + 2] - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= R2) continue;
      if (front) {
        const vx = eye.x - pos[o],
          vy = eye.y - pos[o + 1],
          vz = eye.z - pos[o + 2];
        if (nor[o] * vx + nor[o + 1] * vy + nor[o + 2] * vz < 0) continue;
      }
      idx[cnt] = i;
      wt[cnt] = this.falloff(Math.sqrt(d2) / R);
      cnt++;
    }
    return cnt;
  }

  private layerOrig(part: Part) {
    const st = this.stroke!;
    let o = st.orig.get(part);
    if (!o) {
      o = { pos: new Float32Array(part.pos), nor: new Float32Array(part.nor) };
      st.orig.set(part, o);
    }
    return o;
  }

  private dab(
    part: Part,
    c: THREE.Vector3,
    n: THREE.Vector3,
    eye: THREE.Vector3,
    dir: THREE.Vector3,
    R: number,
    k: number,
    tool: ToolId,
    inv: boolean
  ) {
    const cnt = this.gather(part, c, R, eye, this.s.frontOnly && tool !== "mask");
    if (!cnt) return;
    const pos = part.pos,
      nor = part.nor,
      mask = part.mask;
    const idx = this.idxBuf,
      wt = this.wBuf;
    const rec = this.getRec(part);

    // area normal & center
    let sw = 0,
      ax = 0,
      ay = 0,
      az = 0,
      cx = 0,
      cy = 0,
      cz = 0;
    for (let j = 0; j < cnt; j++) {
      const i = idx[j] * 3;
      const f = wt[j];
      sw += f;
      ax += nor[i] * f;
      ay += nor[i + 1] * f;
      az += nor[i + 2] * f;
      cx += pos[i] * f;
      cy += pos[i + 1] * f;
      cz += pos[i + 2] * f;
    }
    let al = Math.hypot(ax, ay, az);
    if (al < 1e-8) {
      ax = n.x;
      ay = n.y;
      az = n.z;
      al = 1;
    }
    ax /= al;
    ay /= al;
    az /= al;
    if (sw > 0) {
      cx /= sw;
      cy /= sw;
      cz /= sw;
    }
    const sgn = inv ? -1 : 1;
    let geom = true;

    switch (tool) {
      case "draw": {
        const amt = R * 0.09 * k * sgn;
        for (let j = 0; j < cnt; j++) {
          const i = idx[j];
          const w = wt[j] * (1 - mask[i]);
          if (w <= 0) continue;
          rec.touch(i);
          const o = i * 3;
          pos[o] += ax * w * amt;
          pos[o + 1] += ay * w * amt;
          pos[o + 2] += az * w * amt;
        }
        break;
      }
      case "clay": {
        const off = R * 0.05 * k * sgn;
        const px = cx + ax * off,
          py = cy + ay * off,
          pz = cz + az * off;
        for (let j = 0; j < cnt; j++) {
          const i = idx[j];
          const w = wt[j] * (1 - mask[i]);
          if (w <= 0) continue;
          rec.touch(i);
          const o = i * 3;
          const d = (px - pos[o]) * ax + (py - pos[o + 1]) * ay + (pz - pos[o + 2]) * az;
          const f = Math.min(1, w * (0.3 + 0.5 * k));
          pos[o] += ax * d * f;
          pos[o + 1] += ay * d * f;
          pos[o + 2] += az * d * f;
        }
        break;
      }
      case "inflate": {
        const amt = R * 0.09 * k * sgn;
        for (let j = 0; j < cnt; j++) {
          const i = idx[j];
          const w = wt[j] * (1 - mask[i]);
          if (w <= 0) continue;
          rec.touch(i);
          const o = i * 3;
          pos[o] += nor[o] * w * amt;
          pos[o + 1] += nor[o + 1] * w * amt;
          pos[o + 2] += nor[o + 2] * w * amt;
        }
        break;
      }
      case "smooth": {
        const adj = part.adjacency;
        if (this.tmpBuf.length < cnt * 3) this.tmpBuf = new Float32Array(cnt * 3 + 3000);
        const tmp = this.tmpBuf;
        for (let j = 0; j < cnt; j++) {
          const i = idx[j];
          const a0 = adj.offsets[i],
            a1 = adj.offsets[i + 1];
          const o = i * 3;
          if (a1 === a0) {
            tmp[j * 3] = pos[o];
            tmp[j * 3 + 1] = pos[o + 1];
            tmp[j * 3 + 2] = pos[o + 2];
            continue;
          }
          let x = 0,
            y = 0,
            z = 0;
          for (let q = a0; q < a1; q++) {
            const nb = adj.list[q] * 3;
            x += pos[nb];
            y += pos[nb + 1];
            z += pos[nb + 2];
          }
          const m = a1 - a0;
          tmp[j * 3] = x / m;
          tmp[j * 3 + 1] = y / m;
          tmp[j * 3 + 2] = z / m;
        }
        for (let j = 0; j < cnt; j++) {
          const i = idx[j];
          const w = wt[j] * (1 - mask[i]);
          if (w <= 0) continue;
          rec.touch(i);
          const f = Math.min(1, w * (0.12 + 0.7 * k));
          const o = i * 3;
          pos[o] += (tmp[j * 3] - pos[o]) * f;
          pos[o + 1] += (tmp[j * 3 + 1] - pos[o + 1]) * f;
          pos[o + 2] += (tmp[j * 3 + 2] - pos[o + 2]) * f;
        }
        break;
      }
      case "flatten":
      case "scrape": {
        for (let j = 0; j < cnt; j++) {
          const i = idx[j];
          const w = wt[j] * (1 - mask[i]);
          if (w <= 0) continue;
          const o = i * 3;
          const d = (pos[o] - cx) * ax + (pos[o + 1] - cy) * ay + (pos[o + 2] - cz) * az;
          if (tool === "scrape" && (inv ? d < 0 : d > 0) === false) continue;
          rec.touch(i);
          const f = Math.min(1, w * (0.25 + 0.65 * k));
          pos[o] -= ax * d * f;
          pos[o + 1] -= ay * d * f;
          pos[o + 2] -= az * d * f;
        }
        break;
      }
      case "pinch":
      case "crease": {
        const crease = tool === "crease";
        for (let j = 0; j < cnt; j++) {
          const i = idx[j];
          const w = wt[j] * (1 - mask[i]);
          if (w <= 0) continue;
          rec.touch(i);
          const o = i * 3;
          let dx = c.x - pos[o],
            dy = c.y - pos[o + 1],
            dz = c.z - pos[o + 2];
          const dn = dx * ax + dy * ay + dz * az;
          dx -= ax * dn;
          dy -= ay * dn;
          dz -= az * dn;
          const f = w * k * (crease ? 0.3 : 0.25) * sgn;
          pos[o] += dx * f;
          pos[o + 1] += dy * f;
          pos[o + 2] += dz * f;
          if (crease) {
            const h = w * R * 0.06 * k * sgn;
            pos[o] -= ax * h;
            pos[o + 1] -= ay * h;
            pos[o + 2] -= az * h;
          }
        }
        break;
      }
      case "layer": {
        const orig = this.layerOrig(part);
        const H = R * 0.1 * k;
        for (let j = 0; j < cnt; j++) {
          const i = idx[j];
          const w = wt[j] * (1 - mask[i]);
          if (w <= 0) continue;
          const o = i * 3;
          const target = sgn * H * Math.min(1, w * 1.8);
          const off =
            (pos[o] - orig.pos[o]) * orig.nor[o] +
            (pos[o + 1] - orig.pos[o + 1]) * orig.nor[o + 1] +
            (pos[o + 2] - orig.pos[o + 2]) * orig.nor[o + 2];
          if (sgn * off >= sgn * target) continue;
          rec.touch(i);
          const dlt = target - off;
          pos[o] += orig.nor[o] * dlt;
          pos[o + 1] += orig.nor[o + 1] * dlt;
          pos[o + 2] += orig.nor[o + 2] * dlt;
        }
        break;
      }
      case "roughen": {
        // Noise searah normal tiap vertex: menambah tekstur kasar/organik (kulit, batu,
        // karat) dalam satu goresan, alih-alih menekuk banyak bintil kecil manual satu-satu.
        const scale = this.s.noiseScale;
        const amt = R * 0.12 * k;
        for (let j = 0; j < cnt; j++) {
          const i = idx[j];
          const w = wt[j] * (1 - mask[i]);
          if (w <= 0) continue;
          rec.touch(i);
          const o = i * 3;
          const h = hashNoise3(pos[o], pos[o + 1], pos[o + 2], scale);
          pos[o] += nor[o] * h * w * amt;
          pos[o + 1] += nor[o + 1] * h * w * amt;
          pos[o + 2] += nor[o + 2] * h * w * amt;
        }
        break;
      }
      case "trim": {
        // Potong tegas satu sisi: vertex di depan bidang singgung brush (searah normal
        // rata-rata area, arah ditentukan invert) didorong PENUH ke bidang itu — beda
        // dari "flatten" yang hanya menarik sebagian (gradual) berdasar strength.
        for (let j = 0; j < cnt; j++) {
          const i = idx[j];
          const w = wt[j] * (1 - mask[i]);
          if (w <= 0) continue;
          const o = i * 3;
          const d = (pos[o] - cx) * ax + (pos[o + 1] - cy) * ay + (pos[o + 2] - cz) * az;
          const cut = inv ? d < 0 : d > 0;
          if (!cut) continue;
          rec.touch(i);
          // dorong penuh ke bidang (f mendekati 1), bukan proporsional seperti flatten,
          // supaya efeknya terasa "memotong", w tetap dipakai untuk falloff tepi brush
          // yang halus (anti-patahan tajam di batas kuas).
          const f = Math.min(1, w * (0.6 + 0.8 * k));
          pos[o] -= ax * d * f;
          pos[o + 1] -= ay * d * f;
          pos[o + 2] -= az * d * f;
        }
        break;
      }
      case "nudge": {
        let tx = dir.x,
          ty = dir.y,
          tz = dir.z;
        const dn = tx * ax + ty * ay + tz * az;
        tx -= ax * dn;
        ty -= ay * dn;
        tz -= az * dn;
        const tl = Math.hypot(tx, ty, tz);
        if (tl < 1e-8) break;
        const len = (R * 0.3 * k) / tl;
        for (let j = 0; j < cnt; j++) {
          const i = idx[j];
          const w = wt[j] * (1 - mask[i]);
          if (w <= 0) continue;
          rec.touch(i);
          const o = i * 3;
          pos[o] += tx * len * w;
          pos[o + 1] += ty * len * w;
          pos[o + 2] += tz * len * w;
        }
        break;
      }
      case "mask": {
        geom = false;
        for (let j = 0; j < cnt; j++) {
          const i = idx[j];
          rec.touch(i);
          const v = mask[i] + sgn * wt[j] * (0.2 + 0.6 * k);
          mask[i] = v < 0 ? 0 : v > 1 ? 1 : v;
          part.refreshColor(i);
        }
        part.dirtyCol = true;
        break;
      }
      case "paint": {
        geom = false;
        const pc = this.paintColor;
        for (let j = 0; j < cnt; j++) {
          const i = idx[j];
          const w = wt[j] * (1 - mask[i]);
          if (w <= 0) continue;
          rec.touch(i);
          const f = Math.min(1, w * (0.15 + 0.7 * k));
          const o = i * 3;
          part.paint[o] += (pc.r - part.paint[o]) * f;
          part.paint[o + 1] += (pc.g - part.paint[o + 1]) * f;
          part.paint[o + 2] += (pc.b - part.paint[o + 2]) * f;
          part.refreshColor(i);
        }
        part.dirtyCol = true;
        break;
      }
      default:
        geom = false;
    }
    if (geom) part.dirtyPos = true;
    this.needsRender = true;
  }

  // grab ----------------------------------------------------

  private grabSetup(st: Stroke, point: THREE.Vector3) {
    const R = st.R;
    const c = new THREE.Vector3();
    const eye = new THREE.Vector3();
    for (let ci = 0; ci < st.copies.length; ci++) {
      const cp = st.copies[ci];
      c.copy(point);
      eye.copy(this.camera.position);
      this.applyCopy(c, cp);
      this.applyCopy(eye, cp);
      for (const part of this.targetsFor(ci, st.part)) {
        const cnt = this.gather(part, c, R, eye, this.s.frontOnly);
        if (!cnt) continue;
        const idx = new Int32Array(cnt);
        const w = new Float32Array(cnt);
        const p0 = new Float32Array(cnt * 3);
        const rec = this.getRec(part);
        for (let j = 0; j < cnt; j++) {
          const i = this.idxBuf[j];
          idx[j] = i;
          w[j] = this.wBuf[j] * (1 - part.mask[i]);
          p0[j * 3] = part.pos[i * 3];
          p0[j * 3 + 1] = part.pos[i * 3 + 1];
          p0[j * 3 + 2] = part.pos[i * 3 + 2];
          rec.touch(i);
        }
        st.groups.push({ part, cp, idx, w, p0 });
      }
    }
  }

  private grabMove(st: Stroke, P: THREE.Vector3) {
    const delta = P.clone().sub(st.P0);
    const d = new THREE.Vector3();
    const touched = new Set<Part>();
    for (const g of st.groups) {
      d.copy(delta);
      this.applyCopy(d, g.cp);
      const pos = g.part.pos;
      for (let j = 0; j < g.idx.length; j++) {
        const o = g.idx[j] * 3;
        const w = g.w[j];
        pos[o] = g.p0[j * 3] + d.x * w;
        pos[o + 1] = g.p0[j * 3 + 1] + d.y * w;
        pos[o + 2] = g.p0[j * 3 + 2] + d.z * w;
      }
      touched.add(g.part);
    }
    for (const p of touched) p.dirtyPos = true;
    this.needsRender = true;
  }

  private snakeMove(st: Stroke, P: THREE.Vector3) {
    const delta = P.clone().sub(st.lastP);
    st.lastP.copy(P);
    if (delta.lengthSq() < 1e-14) return;
    st.center.add(delta);
    const R = st.R;
    const c = new THREE.Vector3();
    const eye = new THREE.Vector3();
    const d = new THREE.Vector3();
    const sgn = st.inv ? 0.6 : 1;
    const k = 0.45 + 0.55 * this.s.strength * st.pressure;
    for (let ci = 0; ci < st.copies.length; ci++) {
      const cp = st.copies[ci];
      c.copy(st.center);
      eye.copy(this.camera.position);
      d.copy(delta);
      this.applyCopy(c, cp);
      this.applyCopy(eye, cp);
      this.applyCopy(d, cp);
      for (const part of this.targetsFor(ci, st.part)) {
        const cnt = this.gather(part, c, R, eye, false);
        if (!cnt) continue;
        const rec = this.getRec(part);
        for (let j = 0; j < cnt; j++) {
          const i = this.idxBuf[j];
          const w = this.wBuf[j] * (1 - part.mask[i]) * k * sgn;
          if (w <= 0) continue;
          rec.touch(i);
          const o = i * 3;
          part.pos[o] += d.x * w;
          part.pos[o + 1] += d.y * w;
          part.pos[o + 2] += d.z * w;
        }
        part.dirtyPos = true;
      }
    }
    this.needsRender = true;
  }

  private endStroke(cancelled: boolean) {
    const st = this.stroke;
    if (!st) return;
    void cancelled;
    this.stroke = null;
    const deltas: Delta[] = [];
    let bytes = 0;
    for (const [part, r] of st.recs) {
      if (!r.idx.length) continue;
      const d: Delta = {
        part,
        idx: Uint32Array.from(r.idx),
        pos: Float32Array.from(r.pos),
        mask: Float32Array.from(r.mask),
        paint: Float32Array.from(r.paint),
      };
      bytes += d.idx.byteLength * 8 + 64;
      deltas.push(d);
      if (st.tool === "grab" || st.tool === "snake") {
        part.flush();
        part.rebuildBVH();
      }
    }
    if (deltas.length) {
      this.pushHistory({
        bytes,
        undo: () => deltas.forEach((d) => this.swapDelta(d)),
        redo: () => deltas.forEach((d) => this.swapDelta(d)),
      });
    }
    this.gesture = this.pointers.size ? "idle" : "none";
    // let normals update, then emit stats
    requestAnimationFrame(() => this.emitState());
  }

  // ───────────────────────── render ─────────────────────────

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    if (this.stroke) this.processStroke();
    let ch = false;
    for (const p of this.parts) if (p.flush()) ch = true;
    if (ch) {
      this.needsRender = true;
      if (this.s.tool === "transform") this.updateSelBox();
    }
    if (this.needsRender) {
      this.needsRender = false;
      this.renderer.render(this.scene, this.camera);
      this.drawGizmo();
    }
  };

  // ───────────────────────── scripted sculpting (SculptScript) ─────────────────────────
  // Jalur stroke terprogram: dipanggil oleh interpreter SculptScript, bukan oleh
  // pointer manusia. Tidak menyentuh this.gesture/this.pointers sama sekali, jadi
  // aman berjalan berdampingan dengan input mouse/touch normal.

  /** Mulai satu stroke terprogram pada part tertentu. R dan strength sudah dalam world-space absolut. */
  beginScriptStroke(part: Part, tool: ToolId, invert = false): number {
    const id = ++this.strokeCounter;
    const st: Stroke = {
      id,
      part,
      tool,
      inv: invert,
      copies: this.buildCopies(),
      recs: new Map(),
      queue: [],
      last: null,
      hasDab: false,
      orig: new Map(),
      groups: [],
      plane: null,
      P0: new THREE.Vector3(),
      lastP: new THREE.Vector3(),
      center: new THREE.Vector3(),
      pressure: 1,
      R: 0,
    };
    this.stroke = st;
    return id;
  }

  /**
   * Satu "dab" terprogram di titik dunia tertentu.
   * point/normal: posisi & normal permukaan (world-space, part-local sebelum transform part — part tidak
   *   memiliki transform sendiri di engine ini jadi sama dengan world).
   * radius/strength: world-space absolut, TIDAK dikonversi dari piksel (beda dari brush manual).
   */
  scriptDab(point: THREE.Vector3, normal: THREE.Vector3, radius: number, strength: number) {
    const st = this.stroke;
    if (!st) return;
    st.R = radius;
    const prevStrength = this.s.strength;
    this.s.strength = strength;
    try {
      const eye = this.camera.position;
      const dir = st.last ? point.clone().sub(st.last) : new THREE.Vector3();
      this.dabAll(point, normal, dir, radius, 1);
    } finally {
      this.s.strength = prevStrength;
    }
    st.last = point.clone();
    st.hasDab = true;
  }

  /** Dab lurus dari a ke b, dipecah jadi beberapa titik supaya hasil menyambung (seperti garis kuas). */
  scriptLine(a: THREE.Vector3, b: THREE.Vector3, radius: number, strength: number, part: Part, steps?: number) {
    const dist = a.distanceTo(b);
    const n = steps ?? Math.max(1, Math.ceil(dist / Math.max(radius * 0.25, 1e-4)));
    const tmp = new THREE.Vector3();
    for (let i = 0; i <= n; i++) {
      tmp.lerpVectors(a, b, n === 0 ? 0 : i / n);
      const srf = this.closestSurfacePoint(part, tmp);
      this.scriptDab(srf.point, srf.normal, radius, strength);
    }
  }

  /** Selesaikan stroke terprogram: commit ke history (undo/redo) + refresh tampilan, sama seperti stroke manual. */
  endScriptStroke() {
    const st = this.stroke;
    if (!st) return;
    for (const part of st.recs.keys()) {
      part.flush();
      part.rebuildBVH();
    }
    this.endStroke(false);
  }

  /** Cari titik terdekat pada permukaan mesh part dari sebuah titik target (dunia/lokal, sama ruang). */
  closestSurfacePoint(part: Part, target: THREE.Vector3): { point: THREE.Vector3; normal: THREE.Vector3 } {
    const geo = part.geo as (THREE.BufferGeometry & { boundsTree?: any }) | null;
    if (geo?.boundsTree) {
      try {
        const hit = geo.boundsTree.closestPointToPoint(target);
        // hit.point bisa berupa THREE.Vector3 asli atau objek {x,y,z} tergantung versi
        // three-mesh-bvh, jadi dibaca manual lewat .x/.y/.z, bukan .clone(), supaya tidak
        // bergantung pada bentuk instance-nya.
        if (hit && hit.point && typeof hit.point.x === "number") {
          const point = new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z);
          const faceIdx = hit.faceIndex;
          let normal = new THREE.Vector3(0, 1, 0);
          if (faceIdx != null && part.index.length) {
            const a = part.index[faceIdx * 3],
              b = part.index[faceIdx * 3 + 1],
              c = part.index[faceIdx * 3 + 2];
            normal = new THREE.Vector3(
              part.nor[a * 3] + part.nor[b * 3] + part.nor[c * 3],
              part.nor[a * 3 + 1] + part.nor[b * 3 + 1] + part.nor[c * 3 + 1],
              part.nor[a * 3 + 2] + part.nor[b * 3 + 2] + part.nor[c * 3 + 2]
            ).normalize();
          }
          return { point, normal };
        }
      } catch {
        // jatuh ke fallback bbox di bawah kalau API BVH tidak sesuai dugaan
      }
    }
    // fallback: proyeksi sederhana ke bbox surface kalau BVH tidak tersedia
    const p = target.clone();
    part.bbox.clampPoint(p, p);
    return { point: p, normal: new THREE.Vector3(0, 1, 0) };
  }

  /** Bounding box part (local-space, part tidak punya transform sendiri jadi = world-space di engine ini). */
  getPartBBox(part: Part): THREE.Box3 {
    return part.bbox;
  }

  attachGizmo(c: HTMLCanvasElement | null) {
    this.gizmoCanvas = c;
    this.needsRender = true;
  }

  private drawGizmo() {
    const c = this.gizmoCanvas;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = c.clientWidth || 96;
    if (c.width !== size * dpr) {
      c.width = size * dpr;
      c.height = size * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const q = this.camera.quaternion.clone().invert();
    const L = size * 0.34;
    const cx = size / 2,
      cy = size / 2;
    const axes = [
      { l: "X", v: new THREE.Vector3(1, 0, 0), col: "#e5484d", key: "+x" },
      { l: "Y", v: new THREE.Vector3(0, 1, 0), col: "#46c35f", key: "+y" },
      { l: "Z", v: new THREE.Vector3(0, 0, 1), col: "#3b82f6", key: "+z" },
      { l: "", v: new THREE.Vector3(-1, 0, 0), col: "#e5484d", key: "-x" },
      { l: "", v: new THREE.Vector3(0, -1, 0), col: "#46c35f", key: "-y" },
      { l: "", v: new THREE.Vector3(0, 0, -1), col: "#3b82f6", key: "-z" },
    ].map((a) => {
      const v = a.v.clone().applyQuaternion(q);
      return { ...a, x: cx + v.x * L, y: cy - v.y * L, z: v.z };
    });
    axes.sort((a, b) => a.z - b.z);
    this.gizmoTips = [];
    for (const a of axes) {
      const pos = a.l !== "";
      ctx.strokeStyle = a.col;
      ctx.globalAlpha = pos ? 1 : 0.0;
      ctx.lineWidth = 2.5;
      if (pos) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(a.x, a.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      const r = pos ? 10 : 6.5;
      ctx.beginPath();
      ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
      ctx.fillStyle = pos ? a.col : a.col + "55";
      ctx.fill();
      if (!pos) {
        ctx.strokeStyle = a.col;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      if (pos) {
        ctx.fillStyle = "#0b0c10";
        ctx.font = "bold 11px ui-sans-serif, system-ui";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(a.l, a.x, a.y + 0.5);
      }
      this.gizmoTips.push({ label: a.key, x: a.x, y: a.y, r: r + 5 });
    }
  }

  gizmoClick(x: number, y: number) {
    let best: string | null = null;
    let bd = 1e9;
    for (const t of this.gizmoTips) {
      const d = Math.hypot(t.x - x, t.y - y);
      if (d < t.r && d < bd) {
        bd = d;
        best = t.label;
      }
    }
    if (best) this.setView(best);
  }

  // ───────────────────────── export / import ─────────────────────────

  private buildExportGroup(selectedOnly: boolean): THREE.Group {
    const g = new THREE.Group();
    g.name = "SculptStudio";
    const list = this.parts.filter((p) => p.visible && (!selectedOnly || p === this.active));
    for (const p of list) {
      p.mesh.updateMatrixWorld(true);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(p.pos), 3));
      const col = new Float32Array(p.paint);
      geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
      geo.setIndex(new THREE.BufferAttribute(new Uint32Array(p.index), 1));
      geo.applyMatrix4(p.mesh.matrixWorld);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({
          name: "Material_" + p.name.replace(/\s+/g, "_"),
          vertexColors: true,
          roughness: 0.75,
          metalness: 0,
        })
      );
      mesh.name = p.name.replace(/\s+/g, "_");
      g.add(mesh);
    }
    return g;
  }

  async exportModel(
    format: ExportFormat,
    selectedOnly = false
  ): Promise<{ blob: Blob; ext: string }> {
    const group = this.buildExportGroup(selectedOnly);
    if (!group.children.length) throw new Error("Tidak ada mesh untuk diekspor.");
    group.updateMatrixWorld(true);
    let blob: Blob;
    let ext = format as string;
    if (format === "obj") {
      const txt = new OBJExporter().parse(group);
      blob = new Blob([txt], { type: "text/plain" });
    } else if (format === "stl") {
      const res = new STLExporter().parse(group, { binary: true }) as unknown as DataView;
      blob = new Blob([res.buffer as ArrayBuffer], { type: "model/stl" });
    } else {
      const exp = new GLTFExporter();
      const res = await exp.parseAsync(group, { binary: format === "glb" });
      if (res instanceof ArrayBuffer) {
        blob = new Blob([res], { type: "model/gltf-binary" });
        ext = "glb";
      } else {
        blob = new Blob([JSON.stringify(res)], { type: "model/gltf+json" });
        ext = "gltf";
      }
    }
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
    return { blob, ext };
  }

  async importFile(file: File) {
    const name = file.name.replace(/\.[^.]+$/, "");
    const lower = file.name.toLowerCase();
    const root: THREE.Object3D = await new Promise((resolve, reject) => {
      if (lower.endsWith(".obj")) {
        file.text().then((t) => resolve(new OBJLoader().parse(t)), reject);
      } else if (lower.endsWith(".glb") || lower.endsWith(".gltf")) {
        const rd = lower.endsWith(".gltf") ? file.text() : file.arrayBuffer();
        rd.then((data) => {
          new GLTFLoader().parse(data as any, "", (g) => resolve(g.scene), reject);
        }, reject);
      } else reject(new Error("Format tidak didukung (gunakan .obj, .glb, .gltf)"));
    });
    root.updateMatrixWorld(true);
    const datas: { name: string; data: MeshData }[] = [];
    const box = new THREE.Box3();
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry) return;
      const g = m.geometry.clone();
      g.applyMatrix4(m.matrixWorld);
      const d = toMeshData(g);
      g.dispose();
      for (let i = 0; i < d.pos.length; i += 3) box.expandByPoint(new THREE.Vector3(d.pos[i], d.pos[i + 1], d.pos[i + 2]));
      datas.push({ name: m.name || name, data: d });
    });
    if (!datas.length) throw new Error("File tidak berisi mesh.");
    const size = box.getSize(new THREE.Vector3());
    const mx = Math.max(size.x, size.y, size.z);
    if (mx > 8 || mx < 0.4) {
      const c = box.getCenter(new THREE.Vector3());
      const sc = 2.6 / mx;
      for (const { data } of datas)
        for (let i = 0; i < data.pos.length; i += 3) {
          data.pos[i] = (data.pos[i] - c.x) * sc;
          data.pos[i + 1] = (data.pos[i + 1] - c.y) * sc;
          data.pos[i + 2] = (data.pos[i + 2] - c.z) * sc;
        }
    }
    this.bakeAll();
    for (const { name: n, data } of datas) this.addPart(data, n);
    this.frameAll();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.canvas.removeEventListener("pointerdown", this.onDown);
    this.canvas.removeEventListener("pointermove", this.onMove);
    this.canvas.removeEventListener("pointerup", this.onUp);
    this.canvas.removeEventListener("pointercancel", this.onUp);
    this.canvas.removeEventListener("pointerleave", this.onLeave);
    this.canvas.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("keyup", this.onKey);
    this.tc.dispose();
    for (const p of this.parts) p.dispose();
    this.renderer.dispose();
  }
}
