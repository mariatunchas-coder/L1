import {
  BoxGeometry,
  Clock,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  InstancedMesh,
  Matrix4,
  Mesh,
  OrbitControls,
  PBRMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Quaternion,
  Raycaster,
  Renderer,
  RoundedBoxGeometry,
  Scene,
  Sky,
  SphereGeometry,
  SpotLight,
  TorusGeometry,
  TorusKnotGeometry,
  UnlitMaterial,
  Vector3,
  createBricks,
  createBrushedMetal,
  createConcrete,
  createGrass,
  createMarbleTiles,
  createRandom,
  createWoodPlanks,
  Euler,
} from '../lumina';

export interface Showcase {
  renderer: Renderer;
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  sky: Sky;
  sun: DirectionalLight;
  fog: Fog;
  stressMesh: InstancedMesh;
  maxInstances: number;
  setSun(elevation: number, azimuth: number): void;
  setInstanceCount(n: number): void;
  resize(w: number, h: number): void;
  pick(ndcX: number, ndcY: number): string | null;
  animate: boolean;
  start(): void;
  stop(): void;
  dispose(): void;
}

const lin = (r: number, g: number, b: number) => new Color().setRGB(r, g, b);
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

export async function createShowcase(
  canvas: HTMLCanvasElement,
  onProgress: (p: number, label: string) => void = () => {}
): Promise<Showcase> {
  const envRes = Number(new URLSearchParams(location.search).get('env')) || 256;
  const renderer = new Renderer({ canvas, samples: 4, environmentResolution: envRes });
  const scene = new Scene();
  const camera = new PerspectiveCamera(42, 1, 0.1, 3500);
  camera.position.set(15, 5.2, 23);

  // ── atmosphere & sun ──
  const sky = new Sky();
  sky.setSun(38, 140);
  sky.rayleigh = 1.2;
  scene.sky = sky;
  const fog = new Fog(0.0017, 0.008);
  scene.fog = fog;
  const sun = new DirectionalLight();
  sun.name = 'Sun';
  sun.shadow.distance = 110;
  sun.shadow.mapSize = 2048;
  sun.syncWithSky(sky);
  scene.add(sun);

  // ── procedural PBR texture sets ──
  onProgress(0.05, 'Membuat tekstur PBR prosedural…');
  await tick();
  const grass = createGrass(512);
  onProgress(0.2, 'Rumput…');
  await tick();
  const marble = createMarbleTiles(512);
  onProgress(0.35, 'Marmer…');
  await tick();
  const bricks = createBricks(512);
  onProgress(0.5, 'Bata…');
  await tick();
  const wood = createWoodPlanks(512);
  onProgress(0.62, 'Kayu…');
  await tick();
  const concrete = createConcrete(512);
  const brushed = createBrushedMetal(512);
  onProgress(0.75, 'Menyusun scene…');
  await tick();

  const FLOOR_Y = 0.3;

  // ── ground ──
  const ground = new Mesh(
    new PlaneGeometry(5000, 5000),
    new PBRMaterial({ ...grass, uvRepeat: [750, 750], roughness: 1, name: 'Ground' })
  );
  ground.name = 'Rumput';
  ground.rotation.x = -Math.PI / 2;
  ground.castShadow = false;
  scene.add(ground);

  // ── marble platform ──
  const platform = new Mesh(
    new RoundedBoxGeometry(34, 0.6, 30, 0.06, 3),
    new PBRMaterial({ ...marble, uvRepeat: [8.5, 7.5], roughness: 1, name: 'Marmer' })
  );
  platform.name = 'Panggung marmer';
  platform.position.set(0, 0, 0);
  scene.add(platform);

  // ── brick wall ──
  const wall = new Mesh(
    new RoundedBoxGeometry(24, 6, 0.9, 0.05, 2),
    new PBRMaterial({ ...bricks, uvRepeat: [27, 6.8], roughness: 1, normalScale: 1.1, name: 'Bata' })
  );
  wall.name = 'Dinding bata';
  wall.position.set(0, FLOOR_Y + 3, -11);
  scene.add(wall);

  // ── material spheres: metal (gold) and dielectric (red plastic) sweeping roughness ──
  const sphereGeo = new SphereGeometry(0.72, 96, 48);
  const gold = lin(1.0, 0.71, 0.29);
  for (let i = 0; i < 7; i++) {
    const r = i / 6;
    const x = (i - 3) * 1.85;
    const m = new Mesh(sphereGeo, new PBRMaterial({ color: gold, metalness: 1, roughness: Math.max(0.04, r) }));
    m.name = `Emas · roughness ${r.toFixed(2)}`;
    m.position.set(x, FLOOR_Y + 0.72, 3.6);
    scene.add(m);
    const p = new Mesh(sphereGeo, new PBRMaterial({ color: new Color().setHex(0xc4161c), metalness: 0, roughness: Math.max(0.04, r) }));
    p.name = `Plastik merah · roughness ${r.toFixed(2)}`;
    p.position.set(x, FLOOR_Y + 0.72, 5.9);
    scene.add(p);
  }

  // ── hero: car paint sphere (clear-coat) ──
  const carPaint = new Mesh(
    new SphereGeometry(1.5, 128, 64),
    new PBRMaterial({ color: lin(0.5, 0.012, 0.02), metalness: 0.55, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.025, name: 'Cat mobil' })
  );
  carPaint.name = 'Cat mobil (clear-coat)';
  carPaint.position.set(0, FLOOR_Y + 1.5, -3.6);
  scene.add(carPaint);

  // ── wooden pedestal + brushed copper torus knot ──
  const woodMat = new PBRMaterial({ ...wood, uvRepeat: [3, 1.2], roughness: 1, clearcoat: 0.6, clearcoatRoughness: 0.2, name: 'Kayu' });
  const ped1 = new Mesh(new CylinderGeometry(1.9, 2.05, 0.9, 64), woodMat);
  ped1.name = 'Alas kayu';
  ped1.position.set(-7.2, FLOOR_Y + 0.45, -3.2);
  scene.add(ped1);
  const knot = new Mesh(
    new TorusKnotGeometry(0.85, 0.27, 360, 48, 2, 3),
    new PBRMaterial({ ...brushed, color: lin(0.955, 0.638, 0.538), roughness: 1, metalness: 1, clearcoat: 0.35, clearcoatRoughness: 0.08, name: 'Tembaga' })
  );
  knot.name = 'Torus knot tembaga';
  knot.position.set(-7.2, FLOOR_Y + 0.9 + 1.55, -3.2);
  scene.add(knot);

  // ── glass sphere on pedestal (premultiplied transparency + Fresnel reflections) ──
  const ped2 = new Mesh(new CylinderGeometry(1.9, 2.05, 0.9, 64), woodMat);
  ped2.name = 'Alas kayu';
  ped2.position.set(7.2, FLOOR_Y + 0.45, -3.2);
  scene.add(ped2);
  const inner = new Mesh(new SphereGeometry(0.45, 64, 32), new PBRMaterial({ color: gold, metalness: 1, roughness: 0.18 }));
  inner.name = 'Bola emas dalam kaca';
  inner.position.set(7.2, FLOOR_Y + 0.9 + 1.25, -3.2);
  scene.add(inner);
  const glass = new Mesh(
    new SphereGeometry(1.25, 128, 64),
    new PBRMaterial({ color: lin(0.82, 0.93, 0.95), metalness: 0, roughness: 0.02, opacity: 0.16, transparent: true, name: 'Kaca' })
  );
  glass.name = 'Bola kaca';
  glass.castShadow = false;
  glass.position.set(7.2, FLOOR_Y + 0.9 + 1.25, -3.2);
  scene.add(glass);

  // ── concrete pillars (long cascaded shadows) ──
  const concreteMat = new PBRMaterial({ ...concrete, uvRepeat: [3, 6], roughness: 1, name: 'Beton' });
  const pillarGeo = new CylinderGeometry(0.7, 0.7, 11, 48);
  for (const [x, z] of [
    [-14.5, 9],
    [14.5, 9],
    [-14.5, -7],
    [14.5, -7],
  ]) {
    const p = new Mesh(pillarGeo, concreteMat);
    p.name = 'Pilar beton';
    p.position.set(x, FLOOR_Y + 5.5, z);
    scene.add(p);
  }
  const beam = new Mesh(new BoxGeometry(31, 0.7, 1.2), concreteMat);
  beam.name = 'Balok beton';
  beam.position.set(0, FLOOR_Y + 11.2, 9);
  scene.add(beam);

  // ── emissive neon ring + its light ──
  const neonMat = new PBRMaterial({ color: new Color(0, 0, 0), emissive: lin(1.0, 0.32, 0.06), emissiveIntensity: 14, roughness: 0.4, name: 'Neon' });
  const neon = new Mesh(new TorusGeometry(2.4, 0.07, 24, 160), neonMat);
  neon.name = 'Cincin neon';
  neon.position.set(0, FLOOR_Y + 3.4, -10.35);
  neon.castShadow = false;
  scene.add(neon);
  const neonLight = new PointLight(lin(1.0, 0.4, 0.12), 90, 16);
  neonLight.position.set(0, FLOOR_Y + 3.4, -8.8);
  scene.add(neonLight);

  const blueLight = new PointLight(lin(0.25, 0.5, 1.0), 40, 14);
  blueLight.position.set(10.5, FLOOR_Y + 2.4, 1.5);
  scene.add(blueLight);
  const bulb = new Mesh(new SphereGeometry(0.16, 24, 12), new UnlitMaterial({ color: lin(0.25, 0.5, 1.0), intensity: 60 }));
  bulb.position.copy(blueLight.position);
  bulb.castShadow = false;
  scene.add(bulb);

  const spot = new SpotLight(lin(1.0, 0.85, 0.62), 420, 30);
  spot.angle = 0.34;
  spot.penumbra = 0.55;
  spot.position.set(0, 9, 3);
  spot.target.set(0, FLOOR_Y + 1.5, -3.6);
  scene.add(spot);

  // ── thousands of instanced rounded boxes: one draw call ──
  const MAX = 200000;
  const boxGeo = new RoundedBoxGeometry(1, 1, 1, 0.1, 2);
  const stressMat = new PBRMaterial({ color: lin(1, 1, 1), roughness: 0.55, metalness: 0.0, name: 'Instance' });
  const stress = new InstancedMesh(boxGeo, stressMat, MAX, true);
  stress.name = 'Instanced boxes';
  const rnd = createRandom(1337);
  const mtx = new Matrix4();
  const q = new Quaternion();
  const e = new Euler();
  const pos = new Vector3();
  const scl = new Vector3();
  const col = new Color();
  for (let i = 0; i < MAX; i++) {
    // first 1200 fill an inner ring, the rest are spread over a growing area
    const spread = i < 1200 ? 1 : 1 + (i / MAX) * 6;
    const ang = rnd() * Math.PI * 2;
    const rad = (i < 1200 ? 24 + rnd() * 70 : 24 + Math.sqrt(rnd()) * 100 * spread) * 1.0;
    const s = 0.5 + rnd() * rnd() * 2.6;
    pos.set(Math.cos(ang) * rad, (s * (0.6 + rnd() * 0.8)) / 2, Math.sin(ang) * rad - 10);
    scl.set(s, s * (0.6 + rnd() * 1.6), s);
    pos.y = scl.y / 2;
    e.set(0, rnd() * Math.PI, 0);
    q.setFromEuler(e);
    mtx.compose(pos, q, scl);
    stress.setMatrixAt(i, mtx);
    const hue = rnd();
    const pick = rnd();
    if (pick < 0.55) col.setSRGB(0.55 + rnd() * 0.25, 0.53 + rnd() * 0.25, 0.5 + rnd() * 0.25);
    else {
      const h6 = hue * 6;
      const f = h6 - Math.floor(h6);
      const sat = 0.55;
      const vv = 0.55 + rnd() * 0.35;
      const p1 = vv * (1 - sat),
        p2 = vv * (1 - sat * f),
        p3 = vv * (1 - sat * (1 - f));
      const t = [
        [vv, p3, p1],
        [p2, vv, p1],
        [p1, vv, p3],
        [p1, p2, vv],
        [p3, p1, vv],
        [vv, p1, p2],
      ][Math.floor(h6) % 6];
      col.setSRGB(t[0], t[1], t[2]);
    }
    stress.setColorAt(i, col);
  }
  stress.count = 1500;
  stress.update();
  scene.add(stress);

  onProgress(0.9, 'Menginisialisasi renderer…');
  await tick();

  // ── controls ──
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 2.2, 0);
  controls.setView(new Vector3(0, 2.0, -0.5), 26, 32, 13);
  controls.minDistance = 2;
  controls.maxDistance = 220;
  controls.autoRotateSpeed = 0.12;

  const raycaster = new Raycaster();
  const clock = new Clock();
  let raf = 0;
  let running = false;

  const api: Showcase = {
    renderer,
    scene,
    camera,
    controls,
    sky,
    sun,
    fog,
    stressMesh: stress,
    maxInstances: MAX,
    animate: true,
    setSun(elevation, azimuth) {
      sky.setSun(elevation, azimuth);
      sun.syncWithSky(sky);
    },
    setInstanceCount(n) {
      stress.count = Math.max(0, Math.min(MAX, Math.floor(n)));
      stress.update();
    },
    resize(w, h) {
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
    pick(nx, ny) {
      raycaster.setFromCamera(nx, ny, camera);
      const hits = raycaster.intersectObjects([scene]).filter((h) => h.object !== ground);
      if (!hits.length) return null;
      const h = hits[0];
      controls.focusOn(h.point);
      return h.object.name || h.object.type;
    },
    start() {
      if (running) return;
      running = true;
      clock.getDelta();
      const loop = () => {
        raf = requestAnimationFrame(loop);
        const dt = clock.getDelta();
        const t = clock.elapsed;
        if (api.animate) {
          knot.rotation.y = t * 0.35;
          knot.rotation.x = t * 0.2;
          carPaint.rotation.y = t * 0.1;
          neonLight.intensity = 90 * (0.93 + 0.07 * Math.sin(t * 7.0) * Math.sin(t * 2.3));
          blueLight.position.set(10.5 * Math.cos(t * 0.25), FLOOR_Y + 2.4, 2.5 + 7 * Math.sin(t * 0.25));
          bulb.position.copy(blueLight.position);
        }
        controls.update(dt);
        renderer.render(scene, camera);
      };
      loop();
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
    dispose() {
      api.stop();
      controls.dispose();
      renderer.dispose();
    },
  };
  onProgress(1, 'Siap');
  return api;
}
