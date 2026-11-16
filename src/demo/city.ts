import {
  Color,
  Decal,
  type DecalKind,
  FACADE,
  InstancedMesh,
  Mesh,
  Object3D,
  PBRMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  ROAD,
  SpotLight,
  UnlitMaterial,
  Vector3,
  createBuildingGeometry,
  createCarGeometry,
  createDetailMap,
  createFacade,
  createGrass,
  createLampGeometry,
  createLeaves,
  createRoadTile,
  createTreeGeometry,
  makeRng,
  smoothstep,
  type BuildingTier,
  type Geometry,
} from '../lumina';

/** One city block = one road tile (block + its half streets). */
const TILE = ROAD.tile;

interface Variant {
  id: string;
  kind: 'single' | 'quad' | 'slab';
  glass: boolean;
  tiers: BuildingTier[];
}

// Footprints are multiples of the 3.2 m bay: 20 bays = 64 m = the whole lot, 9 bays + gap + 9 bays = 64 m.
const VARIANTS: Variant[] = [
  { id: 's-low-a', kind: 'single', glass: false, tiers: [{ bays: [16, 16], floors: 5 }] },
  { id: 's-low-b', kind: 'single', glass: false, tiers: [{ bays: [18, 14], floors: 6 }] },
  { id: 's-mid-a', kind: 'single', glass: false, tiers: [{ bays: [16, 16], floors: 8 }, { bays: [12, 12], floors: 4 }] },
  { id: 's-mid-b', kind: 'single', glass: false, tiers: [{ bays: [18, 18], floors: 12 }] },
  { id: 's-high-a', kind: 'single', glass: true, tiers: [{ bays: [16, 16], floors: 10 }, { bays: [12, 12], floors: 14 }, { bays: [8, 8], floors: 8 }] },
  { id: 's-high-b', kind: 'single', glass: true, tiers: [{ bays: [14, 14], floors: 26 }] },
  { id: 's-super-a', kind: 'single', glass: true, tiers: [{ bays: [16, 16], floors: 12 }, { bays: [12, 12], floors: 20 }, { bays: [8, 8], floors: 20 }, { bays: [5, 5], floors: 8 }] },
  { id: 's-super-b', kind: 'single', glass: true, tiers: [{ bays: [12, 12], floors: 42 }, { bays: [7, 7], floors: 6 }] },
  { id: 'q-low', kind: 'quad', glass: false, tiers: [{ bays: [9, 9], floors: 4 }] },
  { id: 'q-mid-a', kind: 'quad', glass: false, tiers: [{ bays: [9, 9], floors: 7 }] },
  { id: 'q-mid-b', kind: 'quad', glass: false, tiers: [{ bays: [9, 9], floors: 9 }, { bays: [6, 6], floors: 3 }] },
  { id: 'q-high-a', kind: 'quad', glass: true, tiers: [{ bays: [9, 9], floors: 14 }] },
  { id: 'q-high-b', kind: 'quad', glass: true, tiers: [{ bays: [8, 8], floors: 22 }] },
  { id: 'l-low', kind: 'slab', glass: false, tiers: [{ bays: [20, 9], floors: 5 }] },
  { id: 'l-mid-a', kind: 'slab', glass: false, tiers: [{ bays: [20, 9], floors: 9 }] },
  { id: 'l-mid-b', kind: 'slab', glass: false, tiers: [{ bays: [20, 9], floors: 7 }, { bays: [14, 6], floors: 5 }] },
  { id: 'l-high', kind: 'slab', glass: true, tiers: [{ bays: [20, 9], floors: 16 }] },
];
const totalFloors = (v: Variant) => v.tiers.reduce((a, t) => a + t.floors, 0);

export interface CityStats {
  blocks: number;
  buildings: number;
  cars: number;
  lamps: number;
  trees: number;
  decals: number;
  instancedMeshes: number;
  /** authored (unique + instanced-submitted-once) triangles of all geometries in the scene */
  authoredTriangles: number;
  /** triangles of the whole city when every instance is counted */
  instancedTriangles: number;
  size: number;
}

export interface CityOptions {
  blocks?: number;
  seed?: number;
  /** texture edge lengths */
  roadTexture?: number;
  facadeTexture?: number;
  carDensity?: number;
}

/** Writes a Y-rotated + uniformly scaled transform into an instance matrix (column-major). */
function setInst(m: InstancedMesh, i: number, x: number, y: number, z: number, rotY: number, s = 1): void {
  const c = Math.cos(rotY) * s,
    sn = Math.sin(rotY) * s;
  const a = m.instanceMatrix.array;
  const o = i * 16;
  a[o] = c;
  a[o + 1] = 0;
  a[o + 2] = -sn;
  a[o + 3] = 0;
  a[o + 4] = 0;
  a[o + 5] = s;
  a[o + 6] = 0;
  a[o + 7] = 0;
  a[o + 8] = sn;
  a[o + 9] = 0;
  a[o + 10] = c;
  a[o + 11] = 0;
  a[o + 12] = x;
  a[o + 13] = y;
  a[o + 14] = z;
  a[o + 15] = 1;
}

interface Place {
  x: number;
  z: number;
  rot: number;
  color?: number;
}

export class City {
  readonly root = new Object3D();
  readonly stats: CityStats;
  /** world-space positions of every lamp head (x, y, z) */
  readonly lampHeads: Float32Array;
  readonly lampDirs: Float32Array; // arm direction (x, z) per lamp
  readonly decals: { decal: Decal; kind: DecalKind; threshold: number; base: number }[] = [];
  readonly pool: SpotLight[] = [];
  /** half extent of the street grid (m) */
  readonly half: number;
  readonly pathKeys: { p: [number, number, number]; fov?: number }[];
  readonly start: { pos: [number, number, number]; look: [number, number, number] };
  readonly materials: {
    concrete: PBRMaterial;
    glass: PBRMaterial;
    road: PBRMaterial;
    lampHead: UnlitMaterial;
    car: PBRMaterial;
    carDark: PBRMaterial;
    lampPole: PBRMaterial;
    grass: PBRMaterial;
    canopy: PBRMaterial;
    trunk: PBRMaterial;
    outer: PBRMaterial;
  };
  /** Street lamp spot intensity (cd) when fully on. */
  lampIntensity = 1100;
  /** Brightness of lit windows when fully on. */
  windowGlow = 4.5;
  /** 0 … 1 – lamps / windows (from `TimeOfDay.lamps / night`). */
  lampsOn = 0;
  windowsOn = 0;
  /** 0 … 1 – decals of kind 'puddle' appear as the wetness passes their threshold. */
  wetness = 0;
  private frame = 0;
  private near: { i: number; d: number }[] = [];
  private lastCam = { x: 1e9, z: 1e9 };

  constructor(o: {
    root: Object3D;
    stats: CityStats;
    lampHeads: Float32Array;
    lampDirs: Float32Array;
    half: number;
    pathKeys: City['pathKeys'];
    start: City['start'];
    materials: City['materials'];
  }) {
    this.root = o.root;
    this.stats = o.stats;
    this.lampHeads = o.lampHeads;
    this.lampDirs = o.lampDirs;
    this.half = o.half;
    this.pathKeys = o.pathKeys;
    this.start = o.start;
    this.materials = o.materials;
  }

  /** Per-frame: switches emissives, assigns the pooled spot lights to the lamps nearest the camera, fades puddles. */
  update(camera: PerspectiveCamera): void {
    const m = this.materials;
    m.concrete.emissiveIntensity = this.windowGlow * this.windowsOn;
    m.glass.emissiveIntensity = this.windowGlow * this.windowsOn * 0.8;
    m.lampHead.intensity = 0.04 + 30 * this.lampsOn;
    const wet = this.wetness;
    for (const d of this.decals) {
      if (d.kind === 'puddle') d.decal.opacity = d.base * smoothstep(d.threshold, d.threshold + 0.25, wet);
    }

    // light pool: re-pick the nearest lamps whenever the camera moved a bit (cheap selection over ~600 lamps)
    const cp = camera.position;
    const moved = Math.abs(cp.x - this.lastCam.x) + Math.abs(cp.z - this.lastCam.z);
    if (moved > 3 || this.frame === 0) {
      this.lastCam.x = cp.x;
      this.lastCam.z = cp.z;
      const K = this.pool.length;
      const best = this.near;
      best.length = 0;
      const n = this.lampHeads.length / 3;
      for (let i = 0; i < n; i++) {
        const dx = this.lampHeads[i * 3] - cp.x,
          dz = this.lampHeads[i * 3 + 2] - cp.z,
          dy = this.lampHeads[i * 3 + 1] - cp.y;
        const d = dx * dx + dz * dz + dy * dy * 0.25;
        if (best.length < K || d < best[best.length - 1].d) {
          let j = best.length;
          if (best.length < K) best.push({ i, d });
          else {
            best[K - 1] = { i, d };
            j = K - 1;
          }
          while (j > 0 && best[j - 1].d > best[j].d) {
            const t = best[j - 1];
            best[j - 1] = best[j];
            best[j] = t;
            j--;
          }
        }
      }
      for (let k = 0; k < this.pool.length; k++) {
        const L = this.pool[k];
        const b = best[k];
        if (!b) {
          L.visible = false;
          continue;
        }
        const x = this.lampHeads[b.i * 3],
          y = this.lampHeads[b.i * 3 + 1],
          z = this.lampHeads[b.i * 3 + 2];
        L.position.set(x, y - 0.1, z);
        L.target.set(x, 0, z);
        (L as SpotLight & { _d: number })._d = Math.sqrt(b.d);
      }
    }
    for (let k = 0; k < this.pool.length; k++) {
      const L = this.pool[k] as SpotLight & { _d?: number };
      if (!this.near[k]) continue;
      const fade = 1 - smoothstep(60, 120, L._d ?? 0);
      L.intensity = this.lampIntensity * this.lampsOn * fade;
      L.visible = L.intensity > 1;
    }
    this.frame++;
  }
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** Builds the whole demo city. Async so the UI can show progress between the heavy texture generation steps. */
export async function buildCity(opts: CityOptions = {}, onProgress: (p: number, label: string) => void = () => {}): Promise<City> {
  const N = opts.blocks ?? 12;
  const seed = opts.seed ?? 20250;
  const rng = makeRng(seed);
  const half = (N * TILE) / 2;
  const root = new Object3D();
  let authored = 0;
  let instanced = 0;
  const countTris = (g: Geometry, n = 1) => {
    authored += g.triangleCount;
    instanced += g.triangleCount * n;
  };

  onProgress(0.05, 'Tekstur jalan, trotoar & curb (relief parallax)…');
  await tick();
  const roadSet = createRoadTile(opts.roadTexture ?? 2048);
  onProgress(0.3, 'Tekstur fasad beton: jendela cekung & lampu…');
  await tick();
  const concreteSet = createFacade(opts.facadeTexture ?? 1024, 'concrete', 7);
  onProgress(0.5, 'Tekstur fasad kaca (curtain wall)…');
  await tick();
  const glassSet = createFacade(opts.facadeTexture ?? 1024, 'glass', 11);
  const grassSet = createGrass(256);
  const leafSet = createLeaves(256);
  const detail = createDetailMap(256, 1);
  onProgress(0.62, 'Material & geometri hemat poligon…');
  await tick();

  const facadeBase = (set: typeof concreteSet, glass: boolean) =>
    new PBRMaterial({
      map: set.map,
      normalMap: set.normalMap,
      ormMap: set.ormMap,
      heightMap: set.heightMap,
      emissiveMap: set.emissiveMap,
      emissive: 0xffffff,
      emissiveIntensity: 0,
      roughness: 1,
      metalness: 1,
      parallaxScale: glass ? 0.07 : 0.2,
      parallaxMinSteps: 8,
      parallaxMaxSteps: 30,
      parallaxSelfShadow: 0.8,
      parallaxAO: 0.7,
      detailMap: detail,
      detailScale: 22,
      detailNormalScale: 0.2,
      detailRoughness: 0.12,
      detailDistance: 28,
      weatherResponse: glass ? 0.15 : 0.5,
      layerScale: 0.45,
      layers: true,
      name: glass ? 'Facade glass' : 'Facade concrete',
    });
  const concrete = facadeBase(concreteSet, false);
  const glass = facadeBase(glassSet, true);
  const road = new PBRMaterial({
    map: roadSet.map,
    normalMap: roadSet.normalMap,
    ormMap: roadSet.ormMap,
    heightMap: roadSet.heightMap,
    roughness: 1,
    metalness: 1,
    uvRepeat: [N, N],
    parallaxScale: 0.16,
    parallaxMinSteps: 8,
    parallaxMaxSteps: 36,
    parallaxSelfShadow: 0.8,
    parallaxAO: 0.8,
    detailMap: detail,
    detailScale: 36,
    detailNormalScale: 0.3,
    detailRoughness: 0.2,
    detailDistance: 22,
    weatherResponse: 1,
    layerScale: 0.22,
    layers: true,
    name: 'Road tile',
  });
  const outer = new PBRMaterial({ color: 0x1b1d1a, roughness: 0.96, name: 'Outskirts' });
  const grass = new PBRMaterial({ ...grassSet, uvRepeat: [14, 14], roughness: 1, metalness: 1, parallaxScale: 0.05, weatherResponse: 0.5, layers: true, name: 'Park grass' });
  const canopy = new PBRMaterial({ ...leafSet, uvRepeat: [1, 1], roughness: 1, metalness: 1, subsurface: 0.5, subsurfaceColor: 0x6fa030, side: 2, parallaxScale: 0.05, name: 'Canopy' });
  const trunk = new PBRMaterial({ color: 0x3b2c20, roughness: 0.95, name: 'Trunk' });
  const car = new PBRMaterial({ color: 0xffffff, metalness: 0.6, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03, name: 'Car paint' });
  const carDark = new PBRMaterial({ color: 0x06080b, metalness: 0, roughness: 0.14, clearcoat: 0.6, name: 'Car glass & tyres' });
  const lampPole = new PBRMaterial({ color: 0x2a2d32, metalness: 0.85, roughness: 0.45, name: 'Lamp pole' });
  const lampHead = new UnlitMaterial({ color: new Color(1, 0.82, 0.55), intensity: 0.1 });
  lampHead.name = 'Lamp head';

  // ── ground: ONE quad textured with the road tile (streets, sidewalks and curbs are relief, not geometry) ──
  const ground = new Mesh(new PlaneGeometry(N * TILE, N * TILE, 1, 1), road);
  ground.rotation.x = -Math.PI / 2;
  ground.castShadow = false;
  root.add(ground);
  countTris(ground.geometry);
  const outerPlane = new Mesh(new PlaneGeometry(40000, 40000, 1, 1), outer);
  outerPlane.rotation.x = -Math.PI / 2;
  outerPlane.position.y = -0.12;
  outerPlane.castShadow = false;
  root.add(outerPlane);
  countTris(outerPlane.geometry);

  // ── unique building geometries (one per variant; instanced everywhere) ──
  const geos = new Map<string, Geometry>();
  VARIANTS.forEach((v, idx) => {
    const g = createBuildingGeometry({ tiers: v.tiers, uvPhase: [rng(), rng()], seed: seed + idx * 31 });
    geos.set(v.id, g);
  });

  // ── layout ──
  const CH = 3; // blocks per chunk side (frustum-culling granularity)
  const chunks = Math.ceil(N / CH);
  const bMap = new Map<string, { v: Variant; items: Place[] }>();
  const carMap = new Map<number, Place[]>();
  const lampList: { x: number; z: number; rot: number }[] = [];
  const parkBlocks: { cx: number; cz: number }[] = [];
  let buildings = 0;
  const pickVariant = (kind: Variant['kind'], d: number): Variant => {
    const list = VARIANTS.filter((v) => v.kind === kind);
    const desired = 3 + 44 * Math.pow(1 - smoothstep(0.0, 0.95, d), 1.5);
    let sum = 0;
    const w = list.map((v) => {
      const f = totalFloors(v);
      const x = (f - desired) / (0.55 * desired + 4);
      const k = Math.exp(-x * x) + 0.02;
      sum += k;
      return k;
    });
    let r = rng() * sum;
    for (let i = 0; i < list.length; i++) {
      r -= w[i];
      if (r <= 0) return list[i];
    }
    return list[list.length - 1];
  };
  const addBuilding = (v: Variant, cx: number, cz: number, rot: number) => {
    const key = `${Math.floor(cx / (CH * TILE) + chunks / 2)}|${Math.floor(cz / (CH * TILE) + chunks / 2)}|${v.id}`;
    let e = bMap.get(key);
    if (!e) {
      e = { v, items: [] };
      bMap.set(key, e);
    }
    e.items.push({ x: cx, z: cz, rot });
    buildings++;
  };
  const carDensity = opts.carDensity ?? 0.028;
  const palette = [0xf2f2f0, 0x111214, 0xa9adb3, 0x7d1b1b, 0x1d3a6b, 0x4b4f55, 0x1e4a34, 0xd8b030, 0xe8e8e6, 0x2b2d31];
  const R90 = Math.PI / 2;

  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const cx = (i - (N - 1) / 2) * TILE,
        cz = (j - (N - 1) / 2) * TILE;
      const d = Math.hypot(cx, cz) / half;
      const r = rng();
      const isPark = (i === N / 2 && j === N / 2) || (r < 0.07 && d > 0.15);
      if (isPark) {
        parkBlocks.push({ cx, cz });
      } else {
        const roll = rng();
        const kind: Variant['kind'] = d < 0.45 ? (roll < 0.55 ? 'single' : roll < 0.75 ? 'quad' : 'slab') : roll < 0.2 ? 'single' : roll < 0.7 ? 'quad' : 'slab';
        if (kind === 'single') addBuilding(pickVariant('single', d), cx, cz, Math.floor(rng() * 4) * R90);
        else if (kind === 'quad') {
          const o = 14.4 + 3.2;
          for (const sx of [-1, 1])
            for (const sz of [-1, 1]) addBuilding(pickVariant('quad', d + rng() * 0.15), cx + sx * o, cz + sz * o, Math.floor(rng() * 4) * R90);
        } else {
          const o = 14.4 + 3.2;
          const alongZ = rng() < 0.5;
          const rot = alongZ ? R90 : 0;
          for (const s of [-1, 1]) {
            const v = pickVariant('slab', d + rng() * 0.15);
            // rotate 180° for the south slab so both face their street
            addBuilding(v, cx + (alongZ ? s * o : 0), cz + (alongZ ? 0 : s * o), rot + (s > 0 ? Math.PI : 0));
          }
        }
      }
      // parked cars along the kerb lanes, street lamps on the sidewalks
      const ci = Math.floor(i / CH) * 1000 + Math.floor(j / CH);
      const cars = carMap.get(ci) ?? [];
      const dens = carDensity * (1.6 - d);
      for (const [ex, ez] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as [number, number][]) {
        const alongZ = ex !== 0; // east / west kerbs run along z
        for (let s = -5; s <= 4; s++) {
          if (rng() > dens) continue;
          const t = s * 6 + 3 + (rng() - 0.5) * 1.6;
          const lane = 39.4 + (rng() - 0.5) * 0.5;
          const px = cx + (ex !== 0 ? ex * lane : t),
            pz = cz + (ez !== 0 ? ez * lane : t);
          const rot = alongZ ? (rng() < 0.5 ? R90 : -R90) : rng() < 0.5 ? 0 : Math.PI;
          cars.push({ x: px, z: pz, rot, color: palette[Math.floor(rng() * palette.length)] });
        }
        // lamp on the sidewalk side of the kerb, alternating position
        const off = (((i + j + (ex !== 0 ? 1 : 0)) & 1) * 2 - 1) * 15;
        const lx = cx + (ex !== 0 ? ex * 36.8 : off),
          lz = cz + (ez !== 0 ? ez * 36.8 : off);
        // arm points toward the street: +x local → rotY(θ) = (cosθ, −sinθ)
        const rot = ex > 0 ? 0 : ex < 0 ? Math.PI : ez > 0 ? -R90 : R90;
        lampList.push({ x: lx, z: lz, rot });
      }
      carMap.set(ci, cars);
    }
  }
  onProgress(0.72, 'Membangun instance gedung, mobil, lampu…');
  await tick();

  // ── instanced buildings (per chunk × variant) ──
  let meshCount = 0;
  for (const { v, items } of bMap.values()) {
    const geo = geos.get(v.id)!;
    const m = new InstancedMesh(geo, v.glass ? glass : concrete, items.length);
    items.forEach((it, k) => setInst(m, k, it.x, 0, it.z, it.rot));
    m.update();
    root.add(m);
    meshCount++;
    countTris(geo, items.length);
  }
  for (const g of geos.values()) void g;
  // authored count: each unique building geometry once (countTris above counted the geometry once per mesh)
  authored = 0;
  countTris(ground.geometry);
  countTris(outerPlane.geometry);
  for (const g of geos.values()) authored += g.triangleCount;

  // ── cars ──
  const carGeo = createCarGeometry();
  authored += carGeo.body.triangleCount + carGeo.dark.triangleCount;
  let carTotal = 0;
  const tmpC = new Color();
  for (const list of carMap.values()) {
    if (!list.length) continue;
    const body = new InstancedMesh(carGeo.body, car, list.length, true);
    const dark = new InstancedMesh(carGeo.dark, carDark, list.length);
    list.forEach((c, k) => {
      setInst(body, k, c.x, 0, c.z, c.rot);
      setInst(dark, k, c.x, 0, c.z, c.rot);
      body.setColorAt(k, tmpC.set(c.color ?? 0xffffff));
    });
    body.update();
    dark.update();
    root.add(body, dark);
    meshCount += 2;
    carTotal += list.length;
    instanced += (carGeo.body.triangleCount + carGeo.dark.triangleCount) * list.length;
  }

  // ── street lamps ──
  const lg = createLampGeometry(9, 2.4);
  authored += lg.pole.triangleCount + lg.head.triangleCount;
  const lampPoleMesh = new InstancedMesh(lg.pole, lampPole, lampList.length);
  const lampHeadMesh = new InstancedMesh(lg.head, lampHead, lampList.length);
  const lampHeads = new Float32Array(lampList.length * 3);
  const lampDirs = new Float32Array(lampList.length * 2);
  lampList.forEach((l, k) => {
    setInst(lampPoleMesh, k, l.x, 0, l.z, l.rot);
    setInst(lampHeadMesh, k, l.x, 0, l.z, l.rot);
    // head sits 2.4 m along the arm
    const hx = l.x + Math.cos(l.rot) * 2.4,
      hz = l.z - Math.sin(l.rot) * 2.4;
    lampHeads[k * 3] = hx;
    lampHeads[k * 3 + 1] = 8.96;
    lampHeads[k * 3 + 2] = hz;
    lampDirs[k * 2] = Math.cos(l.rot);
    lampDirs[k * 2 + 1] = -Math.sin(l.rot);
  });
  lampPoleMesh.update();
  lampHeadMesh.update();
  lampPoleMesh.castShadow = false;
  lampHeadMesh.castShadow = false;
  root.add(lampPoleMesh, lampHeadMesh);
  meshCount += 2;
  instanced += (lg.pole.triangleCount + lg.head.triangleCount) * lampList.length;

  // ── parks ──
  let treeTotal = 0;
  if (parkBlocks.length) {
    const tg = createTreeGeometry(5);
    authored += tg.trunk.triangleCount + tg.canopy.triangleCount;
    const perPark = 14;
    const trunkM = new InstancedMesh(tg.trunk, trunk, parkBlocks.length * perPark);
    const canopyM = new InstancedMesh(tg.canopy, canopy, parkBlocks.length * perPark);
    let k = 0;
    const lawn = new PlaneGeometry(64, 64, 1, 1);
    authored += lawn.triangleCount;
    for (const pb of parkBlocks) {
      const lawnMesh = new Mesh(lawn, grass);
      lawnMesh.rotation.x = -Math.PI / 2;
      lawnMesh.position.set(pb.cx, 0.05, pb.cz);
      lawnMesh.castShadow = false;
      root.add(lawnMesh);
      for (let t = 0; t < perPark; t++) {
        const x = pb.cx + (rng() - 0.5) * 56,
          z = pb.cz + (rng() - 0.5) * 56,
          s = 0.8 + rng() * 0.7,
          r = rng() * 6.28;
        setInst(trunkM, k, x, 0.05, z, r, s);
        setInst(canopyM, k, x, 0.05, z, r, s);
        k++;
      }
    }
    trunkM.update();
    canopyM.update();
    root.add(trunkM, canopyM);
    meshCount += 2;
    treeTotal = k;
    instanced += (tg.trunk.triangleCount + tg.canopy.triangleCount) * k + lawn.triangleCount * parkBlocks.length;
  }

  // ── decals: puddles (grow with the rain), cracks, grime ──
  const decals: City['decals'] = [];
  const kinds: DecalKind[] = ['puddle', 'puddle', 'puddle', 'crack', 'dirt', 'scorch'];
  const upN = new Vector3(0, 1, 0);
  for (let n = 0; n < 220; n++) {
    const kind = kinds[Math.floor(rng() * kinds.length)];
    const alongZ = rng() < 0.5; // vertical street (x = const) or horizontal
    const line = -half + TILE * (1 + Math.floor(rng() * (N - 1))); // street centre line
    const lane = (rng() - 0.5) * 17; // across the street
    const t = (rng() - 0.5) * (N * TILE - 40); // along the street
    const px = alongZ ? line + lane : t;
    const pz = alongZ ? t : line + lane;
    const size = kind === 'puddle' ? 3 + rng() * 6 : kind === 'crack' ? 2.5 + rng() * 4 : 2 + rng() * 3;
    const dc = new Decal(kind, size, 1);
    dc.placeOnSurface(new Vector3(px, 0, pz), upN, size, 1, rng() * 6.28);
    dc.opacity = kind === 'puddle' ? 0 : kind === 'crack' ? 0.9 : 0.5;
    root.add(dc);
    decals.push({ decal: dc, kind, threshold: rng() * 0.85, base: 1 });
  }

  // ── pooled lamp lights (spot cones → god rays in the fog) ──
  const pool: SpotLight[] = [];
  for (let k = 0; k < 20; k++) {
    const L = new SpotLight(0xffd7a0, 0, 70);
    L.angle = 1.0;
    L.penumbra = 0.75;
    L.radius = 0.25;
    L.visible = false;
    root.add(L);
    pool.push(L);
  }

  // ── cinematic path: a rectangular loop computed from the street grid (always on a street, corners rounded) ──
  const line = (k: number) => -half + TILE * k; // street centre line k
  const k1 = Math.max(1, Math.round(N * 0.33));
  const k2 = Math.min(N - 1, Math.max(k1 + 2, Math.round(N * 0.67)));
  const corners: [number, number][] = [
    [line(k2), line(k1)],
    [line(k1), line(k1)],
    [line(k1), line(k2)],
    [line(k2), line(k2)],
  ];
  const pathKeys: City['pathKeys'] = [];
  let ki = 0;
  for (let c = 0; c < 4; c++) {
    const A = corners[c],
      B = corners[(c + 1) % 4],
      C = corners[(c + 2) % 4];
    const dx = Math.sign(B[0] - A[0]),
      dz = Math.sign(B[1] - A[1]);
    const ex = Math.sign(C[0] - B[0]),
      ez = Math.sign(C[1] - B[1]);
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    // straight leg: a key every ~80 m, then the corner (before / centre / after)
    const n = Math.max(1, Math.round((len - 60) / 80));
    for (let i = 0; i < n; i++) {
      const t = (30 + ((len - 60) * i) / n) / len;
      const phase = ki++ * 0.9;
      pathKeys.push({ p: [A[0] + (B[0] - A[0]) * t + dz * 2, 5 + 13 * (0.5 + 0.5 * Math.sin(phase)), A[1] + (B[1] - A[1]) * t - dx * 2], fov: 48 + 10 * (0.5 + 0.5 * Math.cos(phase * 0.7)) });
    }
    pathKeys.push({ p: [B[0] - dx * 28 + dz * 2, 5.5, B[1] - dz * 28 - dx * 2], fov: 50 });
    pathKeys.push({ p: [B[0], 6, B[1]], fov: 52 });
    pathKeys.push({ p: [B[0] + ex * 28, 7, B[1] + ez * 28], fov: 52 });
  }
  const p0 = pathKeys[0].p,
    p1 = pathKeys[1].p;
  const start = { pos: [p0[0], p0[1], p0[2]] as [number, number, number], look: [p1[0], p1[1], p1[2]] as [number, number, number] };

  const stats: CityStats = {
    blocks: N * N,
    buildings,
    cars: carTotal,
    lamps: lampList.length,
    trees: treeTotal,
    decals: decals.length,
    instancedMeshes: meshCount,
    authoredTriangles: authored,
    instancedTriangles: instanced,
    size: N * TILE,
  };
  void FACADE;
  const city = new City({ root, stats, lampHeads, lampDirs, half, pathKeys, start, materials: { concrete, glass, road, lampHead, car, carDark, lampPole, grass, canopy, trunk, outer } });
  city.decals.push(...decals);
  city.pool.push(...pool);
  onProgress(1, 'Selesai');
  return city;
}
