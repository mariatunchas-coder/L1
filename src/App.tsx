import { useEffect, useReducer, useRef, useState } from 'react';
import { Button, ColorField, Note, Section, Segmented, Select, Slider, Stat, Tabs, Toggle } from './components/ui';
import { createShowcase, type ModelInfo, type ModelSource, type PickResult, type Showcase } from './demo/buildScene';
import { detectDevice, type ToneMapping } from './lumina';

interface Settings {
  // langit
  elevation: number;
  azimuth: number;
  fog: number;
  // cahaya
  shadows: boolean;
  shadowSize: number;
  cascades: number;
  softness: number;
  ssao: boolean;
  volFog: boolean;
  volFogDensity: number;
  volFogHeightFalloff: number;
  volFogAnisotropy: number;
  volFogIntensity: number;
  // kamera
  exposure: number;
  autoExposure: boolean;
  tone: ToneMapping;
  bloom: boolean;
  bloomIntensity: number;
  // AA & efek
  msaa: number;
  taa: boolean;
  taaFeedback: number;
  taaJitter: number;
  sharpen: number;
  ssr: boolean;
  ssrIntensity: number;
  ssrDistance: number;
  ssrThickness: number;
  ssrRough: number;
  ssrSteps: number;
  dof: boolean;
  dofFocus: number;
  dofFocal: number;
  dofFStop: number;
  dofBlur: number;
  dofClick: boolean;
  mb: boolean;
  mbIntensity: number;
  // grading
  vignette: number;
  grain: number;
  saturation: number;
  contrast: number;
  chroma: number;
  temperature: number;
  // performa
  scale: number;
  dynRes: boolean;
  instances: number;
  // scene
  animate: boolean;
  autoRotate: boolean;
  props: boolean;
  modelFit: number;
  modelLights: boolean;
  // awan
  clouds: number;
  cloudDensity: number;
  cloudScale: number;
  cloudDrift: boolean;
  // efek baru
  contact: boolean;
  contactLength: number;
  contactStrength: number;
  flare: boolean;
  flareIntensity: number;
  flareThreshold: number;
  flareGhosts: number;
  lensDistortion: number;
  look: string;
  // air kolam
  waterWaves: number;
  waterScale: number;
  waterSpeed: number;
  waterClarity: number;
  waterColor: string;
  // performa adaptif
  adaptive: boolean;
  adaptiveFps: number;
  // Lumina 3: SSGI
  ssgi: boolean;
  ssgiIntensity: number;
  ssgiRadius: number;
  ssgiRays: number;
  ssgiSteps: number;
  ssgiBlur: number;
  ssgiDebug: boolean;
  // refraksi & dispersi
  refrSS: boolean;
  refrBend: number;
  refrSteps: number;
  dispersion: number;
  // parallax occlusion mapping
  pom: boolean;
  pomQuality: number;
  pomDepth: number;
  pomShadow: number;
  pomAO: number;
  pomSteps: number;
  // Lumina 4
  histExposure: boolean;
  exposureCenter: number;
  exposureComp: number;
  opticalVignette: number;
  energyBloom: boolean;
  ssgiBounce: boolean;
  ssgiCache: boolean;
  ssgiCacheExtent: number;
  ssgiCacheRes: number;
  ssgiCacheStrength: number;
  pcss: boolean;
  sunPenumbra: number;
  microShadow: number;
  localShadows: boolean;
  localShadowSize: number;
  localShadowSoft: number;
  fogLocal: boolean;
  fogLocalIntensity: number;
  wetness: number;
  dust: number;
  decals: boolean;
  detail: number;
  detailRough: number;
  detailTiling: number;
  pomBlend: number;
  pomLocalShadow: boolean;
}

const DEFAULTS: Settings = {
  elevation: 38,
  azimuth: 140,
  fog: 1.7,
  shadows: true,
  shadowSize: 2048,
  cascades: 3,
  softness: 1.6,
  ssao: true,
  volFog: false,
  volFogDensity: 0.02,
  volFogHeightFalloff: 0.05,
  volFogAnisotropy: 0.6,
  volFogIntensity: 1,
  exposure: 1,
  autoExposure: true,
  tone: 'agx',
  bloom: true,
  bloomIntensity: 0.12,
  msaa: 4,
  taa: false,
  taaFeedback: 0.9,
  taaJitter: 1,
  sharpen: 0,
  ssr: false,
  ssrIntensity: 1,
  ssrDistance: 40,
  ssrThickness: 0.6,
  ssrRough: 0.6,
  ssrSteps: 64,
  dof: false,
  dofFocus: 12,
  dofFocal: 50,
  dofFStop: 2.8,
  dofBlur: 12,
  dofClick: true,
  mb: false,
  mbIntensity: 0.5,
  vignette: 0.28,
  grain: 0.08,
  saturation: 1.06,
  contrast: 1.04,
  chroma: 0,
  temperature: 0,
  scale: 1,
  dynRes: false,
  instances: 1500,
  animate: true,
  autoRotate: false,
  props: true,
  modelFit: 5,
  modelLights: true,
  clouds: 0.35,
  cloudDensity: 1,
  cloudScale: 2.2,
  cloudDrift: false,
  contact: true,
  contactLength: 0.7,
  contactStrength: 0.85,
  flare: false,
  flareIntensity: 0.2,
  flareThreshold: 8,
  flareGhosts: 5,
  lensDistortion: 0,
  look: 'none',
  waterWaves: 0.035,
  waterScale: 1,
  waterSpeed: 1,
  waterClarity: 2.2,
  waterColor: '#3aa7a8',
  adaptive: false,
  adaptiveFps: 58,
  ssgi: true,
  ssgiIntensity: 1.8,
  ssgiRadius: 6,
  ssgiRays: 1,
  ssgiSteps: 16,
  ssgiBlur: 3,
  ssgiDebug: false,
  refrSS: true,
  refrBend: 0.4,
  refrSteps: 24,
  dispersion: 1,
  pom: true,
  pomQuality: 1,
  pomDepth: 1,
  pomShadow: 1,
  pomAO: 0.5,
  pomSteps: 40,
  histExposure: true,
  exposureCenter: 0.6,
  exposureComp: 0,
  opticalVignette: 0.35,
  energyBloom: false,
  ssgiBounce: true,
  ssgiCache: true,
  ssgiCacheExtent: 40,
  ssgiCacheRes: 32,
  ssgiCacheStrength: 1,
  pcss: true,
  sunPenumbra: 0.02,
  microShadow: 0.6,
  localShadows: true,
  localShadowSize: 1024,
  localShadowSoft: 1.6,
  fogLocal: true,
  fogLocalIntensity: 1,
  wetness: 0.25,
  dust: 0.12,
  decals: true,
  detail: 0.7,
  detailRough: 0.3,
  detailTiling: 14,
  pomBlend: 0.5,
  pomLocalShadow: true,
};

const STORAGE_KEY = 'lumina.settings.v5';

/** Merges untrusted JSON into the defaults, keeping only keys of the right type. */
function sanitize(raw: unknown): Settings {
  const out: Settings = { ...DEFAULTS };
  if (!raw || typeof raw !== 'object') return out;
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    if (typeof o[k] === typeof DEFAULTS[k] && (typeof o[k] !== 'number' || Number.isFinite(o[k] as number))) (out as unknown as Record<string, unknown>)[k] = o[k];
  }
  return out;
}
/** First run on phones / weak GPUs: start from a lighter preset instead of the desktop defaults. */
function deviceDefaults(): Settings {
  const d = detectDevice();
  if (d.tier === 'high') return DEFAULTS;
  const low = d.tier === 'low';
  return {
    ...DEFAULTS,
    ssgi: false,
    taa: false,
    ssr: false,
    contact: false,
    mb: false,
    volFog: false,
    ssgiCache: false,
    msaa: d.msaa,
    ssao: !low,
    pomQuality: low ? 0.35 : 0.6,
    refrSteps: low ? 8 : 14,
    shadowSize: low ? 1024 : 2048,
    cascades: 2,
    scale: low ? 0.7 : 0.9,
    dynRes: true,
    instances: low ? 400 : 800,
    localShadows: !low,
    localShadowSize: 512,
    fogLocal: false,
    sharpen: 0,
  };
}
function loadSettings(): Settings {
  try {
    const t = localStorage.getItem(STORAGE_KEY);
    return t ? sanitize(JSON.parse(t)) : deviceDefaults();
  } catch {
    return deviceDefaults();
  }
}

const QUALITY: { name: string; patch: Partial<Settings> }[] = [
  { name: 'Rendah', patch: { localShadows: false, ssgiCache: false, fogLocal: false, ssgi: false, pomQuality: 0.5, refrSteps: 12, msaa: 0, taa: false, ssao: false, ssr: false, contact: false, flare: false, dof: false, mb: false, shadowSize: 1024, cascades: 2, scale: 0.75, volFog: false, bloom: true, sharpen: 0 } },
  { name: 'Sedang', patch: { localShadows: true, localShadowSize: 512, ssgiCache: false, fogLocal: false, ssgi: false, pomQuality: 0.7, refrSteps: 16, msaa: 2, taa: false, ssao: true, ssr: false, contact: false, flare: false, dof: false, mb: false, shadowSize: 2048, cascades: 3, scale: 1, volFog: false, sharpen: 0 } },
  { name: 'Tinggi', patch: { localShadows: true, localShadowSize: 1024, ssgiCache: false, fogLocal: true, ssgi: true, ssgiRays: 1, ssgiSteps: 14, pomQuality: 1, refrSteps: 24, msaa: 0, taa: true, ssao: true, ssr: true, contact: true, flare: false, dof: false, mb: false, shadowSize: 2048, cascades: 3, scale: 1, volFog: false, sharpen: 0.25 } },
  { name: 'Ultra', patch: { localShadows: true, localShadowSize: 1024, ssgiCache: true, ssgiCacheRes: 32, fogLocal: true, ssgi: true, ssgiRays: 1, ssgiSteps: 16, pomQuality: 1, refrSteps: 28, msaa: 0, taa: true, ssao: true, ssr: true, contact: true, flare: false, dof: false, mb: true, shadowSize: 4096, cascades: 4, scale: 1, volFog: true, sharpen: 0.25 } },
  { name: 'Foto', patch: { localShadows: true, localShadowSize: 2048, ssgiCache: true, ssgiCacheRes: 48, fogLocal: true, ssgi: true, ssgiRays: 2, ssgiSteps: 24, pomQuality: 1, refrSteps: 40, msaa: 0, taa: true, ssao: true, ssr: true, contact: true, flare: true, dof: true, mb: false, shadowSize: 4096, cascades: 4, scale: 1, volFog: true, sharpen: 0.3, tone: 'agx' } },
];

type V3 = [number, number, number];
const LOOKS: Record<string, { slope: V3; offset: V3; power: V3 } | null> = {
  none: null,
  warm: { slope: [1.06, 1.0, 0.9], offset: [0.01, 0.005, -0.01], power: [0.97, 1, 1.04] },
  teal: { slope: [1.1, 1.0, 0.86], offset: [-0.015, 0, 0.03], power: [0.94, 1, 1.1] },
  cool: { slope: [0.95, 1.0, 1.08], offset: [0, 0, 0.01], power: [1.05, 1, 0.96] },
  fade: { slope: [0.92, 0.92, 0.95], offset: [0.06, 0.06, 0.07], power: [1, 1, 1] },
};

const SKY_PRESETS = [
  { name: 'Siang', e: 52, a: 140 },
  { name: 'Sore', e: 14, a: 120 },
  { name: 'Golden hour', e: 4.5, a: 100 },
  { name: 'Senja', e: -0.8, a: 95 },
];

const KHRONOS = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/';
const SAMPLES = [
  { id: 'DamagedHelmet', label: 'Damaged Helmet (PBR lengkap)' },
  { id: 'BoomBox', label: 'BoomBox' },
  { id: 'WaterBottle', label: 'Water Bottle' },
  { id: 'Avocado', label: 'Avocado' },
  { id: 'Lantern', label: 'Lantern' },
  { id: 'CesiumMilkTruck', label: 'Cesium Milk Truck (animasi)' },
  { id: 'BoxAnimated', label: 'Box Animated (animasi)' },
  { id: 'ToyCar', label: 'Toy Car' },
];

const fmtN = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n)));

const SNIPPET = `import { Renderer, Scene, PerspectiveCamera,
  GLTFLoader, AnimationMixer, Sky,
  DirectionalLight, OrbitControls } from './lumina';

const renderer = new Renderer({ canvas, samples: 0 });
renderer.post.ssgi.enabled = true;         // GI: warna memantul antar-objek
renderer.post.refraction.bend = 0.4;       // refraksi screen-space (lensa)
renderer.post.taa.enabled = true;          // anti-aliasing temporal
renderer.post.ssr.enabled = true;          // pantulan screen-space
renderer.post.dof.enabled = true;          // depth of field

const scene = new Scene();
scene.sky = new Sky();
const sun = new DirectionalLight();
sun.syncWithSky(scene.sky);
scene.add(sun);

// POM: set tekstur prosedural sudah membawa heightMap
const brick = new PBRMaterial({ ...createBricks(), parallaxScale: 0.04 });
const glass = new PBRMaterial({ transmission: 1, ior: 1.52, thickness: 0.7, dispersion: 4 });

const gltf = await new GLTFLoader().load('model.glb');
scene.add(gltf.scene);

const mixer = new AnimationMixer();
mixer.clipAction(gltf.animations[0]).play();

(function loop() {
  mixer.update(dt);
  renderer.render(scene, camera);
})();`;

const FEATURES: [string, string][] = [
  ['Lumina 4 · GI dunia + multi-bounce', 'Radiance cache voxel 3D yang mengikuti kamera (surface-cache ala Lumen) – ray SSGI yang keluar layar membaca cache, sehingga dinding merah di belakang kamera tetap mewarnai lantai di depan. Frame GI di-feedback sehingga cahaya memantul berkali-kali.'],
  ['Lumina 4 · PCSS + shadow atlas lampu lokal', 'Blocker search per cascade: bayangan tajam di titik kontak, melunak dengan jarak. Spot & point light (cube 6 layer) punya shadow atlas sendiri, ikut menghasilkan god rays di volumetric fog. POM juga self-shadow ke lampu lokal.'],
  ['Lumina 4 · Material berlapis, detail map & decal', 'Normal height ⊕ normal map (RNM), detail map mikro, lapisan basah/debu, decal terproyeksi (retak, kotor, genangan, jelaga, lumut, goresan) yang dihitung di dalam shader material, micro-shadowing & horizon occlusion.'],
  ['Lumina 4 · Kamera fisik & optimasi mobile', 'Eksposur histogram center-weighted dengan persentil, kompensasi EV, vignette cos⁴, bloom hemat energi; deteksi GPU mobile otomatis menurunkan geometri, MSAA, preset dan menyalakan dynamic resolution. UV RoundedBox kini arc-length.'],
  ['Screen-Space Global Illumination — SSGI (baru)', 'Pantulan warna tidak langsung antar-objek ala Lumen: ray cosine-weighted di half-res, ray-march depth, akumulasi temporal (reproyeksi velocity + penolakan disocclusion), blur bilateral depth/normal, upsample bilateral × albedo G-buffer'],
  ['Parallax Occlusion Mapping — POM (baru)', 'Kedalaman 3D nyata pada bata, kayu, beton & marmer: ray-march height field + refinement biner, self-shadow matahari, cavity AO, normal dari height map, mip stabil (textureGrad), fade jarak & kualitas adaptif'],
  ['Screen-Space Refraction + dispersi (baru)', 'Ray refraksi di-march menembus depth opaque (parallax benar), bend lensa, dispersi kromatik per kanal RGB (KHR_materials_dispersion), anti-alias mip otomatis, tolak kebocoran objek di depan kaca, fallback ke environment di tepi layar'],
  ['Refraksi & transmisi nyata (baru)', 'Pass transmission: scene di belakang objek di-resolve ke mip-chain, dibelokkan sesuai IOR, diburamkan oleh roughness, diserap Beer–Lambert (kaca, cairan, kaca buram)'],
  ['Air fotorealistik (baru)', 'Gelombang dispersi air dalam, refraksi, serapan warna berdasarkan kedalaman nyata dari depth buffer, busa tepi, tanpa kebocoran objek di depan air'],
  ['Material berlapis (baru)', 'Sheen Charlie (beludru), anisotropy GGX (baja sikat), iridescence film tipis, subsurface wrap (lilin/kulit), IOR → F0'],
  ['Awan prosedural volumetrik-semu (baru)', 'fBm + domain warp dengan self-shadow, silver lining; ikut di-bake ke IBL, tajam di background, menyaring matahari saat mendung'],
  ['Bayangan kontak, lens flare, AgX, CDL (baru)', 'Ray-march depth ke arah matahari, flare ghost/halo ber-ambang, tone mapper AgX, ASC CDL, distorsi lensa'],
  ['Optimasi (baru)', 'compile/compileAsync (pre-warm shader), AdaptiveQuality (tangga penghematan yang dapat dibalik), preset kualitas, mergeGeometries, perbaikan kebocoran resource setelah context restore'],
  ['TAA (baru)', 'Jitter Halton sub-pixel, motion vector per-objek + kamera, reproyeksi history Catmull-Rom, variance clipping, sharpen'],
  ['SSR (baru)', 'Ray-march screen-space half-res dengan binary refine, G-buffer normal/roughness/F0, menggantikan specular IBL secara akurat'],
  ['Depth of Field (baru)', 'Lensa tipis (focal length, f-stop, jarak fokus), bokeh Vogel, foreground tidak tercemar blur background'],
  ['Motion blur (baru)', 'Blur per-piksel mengikuti velocity buffer (objek bergerak + rotasi kamera)'],
  ['glTF 2.0 / GLB loader (baru)', 'Accessor sparse/interleaved/normalized, PBR + clearcoat/unlit/emissive, lampu & kamera, hierarchy, animasi LINEAR/STEP/CUBICSPLINE'],
  ['AnimationMixer (baru)', 'Blend banyak clip dengan bobot, fade/crossfade, loop repeat/once/pingpong'],
  ['LOD, GPU timer, pulih dari context lost (baru)', 'LOD berhisteresis, waktu GPU asli via timer query, renderer membangun ulang diri setelah WebGL context hilang'],
  ['PBR + IBL + CSM + SSAO', 'GGX Smith, multi-scatter, clear-coat, atmosfer fisik → cubemap IBL, cascaded shadow, SSAO multi-bounce'],
  ['Pipeline HDR', 'RGBA16F + MSAA, bloom Karis, auto-exposure GPU, ACES / Neutral / Filmic / Reinhard, volumetric fog'],
  ['Performa', 'Instancing, frustum culling, state cache, UBO, sorting, dirty-flag matrix, resolusi dinamis'],
];

type Tab = 'render' | 'effects' | 'l4' | 'model' | 'object';

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export default function App() {
  const hostRef = useRef<HTMLDivElement>(null);
  const showRef = useRef<Showcase | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [s, setS] = useState<Settings>(loadSettings);
  const [progress, setProgress] = useState({ p: 0, label: 'Memulai…' });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<string, number | string | boolean>>({});
  const [panel, setPanel] = useState(true);
  const [about, setAbout] = useState(false);
  const [tab, setTab] = useState<Tab>('render');
  const [picked, setPicked] = useState<PickResult | null>(null);
  const [pickedFlash, setPickedFlash] = useState<string | null>(null);
  const [model, setModel] = useState<ModelInfo | null>(null);
  const [modelBusy, setModelBusy] = useState<{ p: number; label: string } | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [sampleId, setSampleId] = useState(SAMPLES[0].id);
  const [url, setUrl] = useState('');
  const [clip, setClip] = useState(0);
  const [clipSpeed, setClipSpeed] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [lost, setLost] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const downRef = useRef({ x: 0, y: 0, t: 0 });
  const sRef = useRef(s);
  sRef.current = s;

  const say = (m: string) => {
    setToast(m);
    setTimeout(() => setToast((c) => (c === m ? null : c)), 2600);
  };

  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.className = 'block h-full w-full';
    hostRef.current!.appendChild(canvas);
    let show: Showcase | null = null;
    let disposed = false;
    const onResize = () => show?.resize(window.innerWidth, window.innerHeight);
    createShowcase(canvas, (p, label) => !disposed && setProgress({ p, label }))
      .then((sh) => {
        if (disposed) return sh.dispose();
        show = sh;
        showRef.current = sh;
        (window as unknown as { __show: Showcase }).__show = sh;
        sh.renderer.onContextLost = () => setLost(true);
        sh.renderer.onContextRestored = () => setLost(false);
        onResize();
        sh.start();
        setReady(true);
      })
      .catch((e: Error) => !disposed && setError(e.message));
    window.addEventListener('resize', onResize);
    const timer = setInterval(() => {
      const r = showRef.current?.renderer;
      if (!r) return;
      const i = r.info;
      setStats({
        fps: i.fps,
        ms: i.frameMs,
        cpu: i.cpuMs,
        gpu: i.gpuMs,
        gpuOk: r.gpuTimerSupported,
        calls: i.calls,
        tris: i.triangles,
        vis: i.visible,
        cull: i.culled,
        sh: i.shadowCalls,
        prog: i.programs,
        lights: i.lights,
        res: `${i.width}×${i.height}`,
        gpuName: r.capabilities.gpu,
        aq: showRef.current?.adaptive.level ?? 0,
        aqStep: showRef.current?.adaptive.lastStep ?? '',
      });
    }, 300);
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener('resize', onResize);
      show?.dispose();
      showRef.current = null;
      canvas.remove();
    };
  }, []);

  // persist settings
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {
      /* storage may be unavailable (private mode) – settings simply won't persist */
    }
  }, [s]);

  // apply settings to the engine
  useEffect(() => {
    const sh = showRef.current;
    if (!sh) return;
    const r = sh.renderer;
    const p = r.post;
    sh.adaptive.release(); // the governor's savings must not leak into the values we are about to apply
    sh.setSun(s.elevation, s.azimuth);
    sh.setClouds(s.clouds, s.cloudDensity, s.cloudScale);
    sh.cloudDrift = s.cloudDrift;
    sh.fog.density = s.fog / 1000;
    p.exposure = s.exposure;
    p.autoExposure = s.autoExposure;
    p.toneMapping = s.tone;
    p.bloom.enabled = s.bloom;
    p.bloom.intensity = s.bloomIntensity;
    p.ssao.enabled = s.ssao;
    p.vignette = s.vignette;
    p.grain = s.grain;
    p.saturation = s.saturation;
    p.contrast = s.contrast;
    p.chromaticAberration = s.chroma;
    p.temperature = s.temperature;
    p.sharpen = s.sharpen;
    p.taa.enabled = s.taa;
    p.taa.feedback = s.taaFeedback;
    p.taa.jitter = s.taaJitter;
    p.ssr.enabled = s.ssr;
    p.ssr.intensity = s.ssrIntensity;
    p.ssr.maxDistance = s.ssrDistance;
    p.ssr.thickness = s.ssrThickness;
    p.ssr.maxRoughness = s.ssrRough;
    p.ssr.steps = s.ssrSteps;
    p.dof.enabled = s.dof;
    p.dof.focusDistance = s.dofFocus;
    p.dof.focalLength = s.dofFocal;
    p.dof.fStop = s.dofFStop;
    p.dof.maxBlur = s.dofBlur;
    p.motionBlur.enabled = s.mb;
    p.motionBlur.intensity = s.mbIntensity;
    p.volumetricFog.enabled = s.volFog;
    p.volumetricFog.density = s.volFogDensity;
    p.volumetricFog.heightFalloff = s.volFogHeightFalloff;
    p.volumetricFog.anisotropy = s.volFogAnisotropy;
    p.volumetricFog.intensity = s.volFogIntensity;
    p.ssgi.enabled = s.ssgi;
    p.ssgi.intensity = s.ssgiIntensity;
    p.ssgi.radius = s.ssgiRadius;
    p.ssgi.rays = s.ssgiRays;
    p.ssgi.steps = s.ssgiSteps;
    p.ssgi.blur = s.ssgiBlur;
    p.ssgi.debug = s.ssgiDebug;
    p.refraction.screenSpace = s.refrSS;
    p.refraction.bend = s.refrBend;
    p.refraction.steps = s.refrSteps;
    sh.setDispersion(s.dispersion);
    r.parallax.enabled = s.pom;
    r.parallax.quality = s.pomQuality;
    sh.setParallax(s.pomDepth, s.pomShadow, s.pomAO, s.pomSteps);
    p.contactShadows.enabled = s.contact;
    p.contactShadows.length = s.contactLength;
    p.contactShadows.strength = s.contactStrength;
    p.lensFlare.enabled = s.flare;
    p.lensFlare.intensity = s.flareIntensity;
    p.lensFlare.threshold = s.flareThreshold;
    p.lensFlare.ghosts = s.flareGhosts;
    p.lensDistortion = s.lensDistortion;
    const lk = LOOKS[s.look] ?? null;
    p.cdl.enabled = !!lk;
    if (lk) {
      p.cdl.slope = lk.slope;
      p.cdl.offset = lk.offset;
      p.cdl.power = lk.power;
    }
    sh.water.waves = s.waterWaves;
    sh.water.waveScale = s.waterScale;
    sh.water.waveSpeed = s.waterSpeed;
    sh.water.attenuationDistance = s.waterClarity;
    sh.water.attenuationColor.setStyle(s.waterColor);
    r.shadowsEnabled = s.shadows;
    sh.sun.shadow.mapSize = s.shadowSize;
    sh.sun.shadow.cascades = s.cascades;
    sh.sun.shadow.softness = s.softness;
    r.setSamples(s.msaa);
    r.dynamicResolution.enabled = s.dynRes;
    if (!s.dynRes) r.renderScale = s.scale;
    sh.setInstanceCount(s.instances);
    sh.animate = s.animate;
    sh.controls.autoRotate = s.autoRotate;
    sh.setPropsVisible(s.props);
    sh.setModelScale(s.modelFit);
    sh.setModelLights(s.modelLights);
    // ── Lumina 4 ──
    p.autoExposureMode = s.histExposure ? 'histogram' : 'average';
    p.autoExposureCenterWeight = s.exposureCenter;
    p.exposureCompensation = s.exposureComp;
    p.opticalVignette = s.opticalVignette;
    p.bloom.energyConserving = s.energyBloom;
    p.ssgi.multiBounce = s.ssgiBounce;
    p.ssgi.worldCache = s.ssgiCache;
    p.ssgi.worldCacheExtent = s.ssgiCacheExtent;
    p.ssgi.worldCacheResolution = s.ssgiCacheRes;
    p.ssgi.worldCacheStrength = s.ssgiCacheStrength;
    sh.sun.shadow.pcss = s.pcss;
    sh.sun.shadow.penumbra = s.sunPenumbra;
    r.microShadowing = s.microShadow;
    r.localShadows.enabled = s.localShadows;
    r.localShadows.mapSize = s.localShadowSize;
    r.localShadows.softness = s.localShadowSoft;
    sh.spot.castShadow = s.localShadows;
    sh.neonLight.castShadow = s.localShadows;
    p.volumetricFog.localLights = s.fogLocal;
    p.volumetricFog.localIntensity = s.fogLocalIntensity;
    sh.setSurfaceLayers(s.wetness, s.dust);
    r.decalsEnabled = s.decals;
    sh.setDecalsVisible(s.decals);
    sh.setDetail(s.detail, s.detail > 0 ? s.detailRough : 0, s.detailTiling);
    sh.setPomBlend(s.pomBlend, s.pomLocalShadow);
    sh.adaptive.targetFps = s.adaptiveFps;
    sh.adaptive.enabled = s.adaptive;
  }, [s, ready]);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((o) => ({ ...o, [k]: v }));
  const patch = (pt: Partial<Settings>) => setS((o) => ({ ...o, ...pt }));

  const loadModel = async (src: ModelSource) => {
    const sh = showRef.current;
    if (!sh) return;
    setModelBusy({ p: 0, label: 'Memuat model…' });
    setModelError(null);
    try {
      const info = await sh.loadModel(src, (p) => setModelBusy({ p, label: `Mengunduh ${(p * 100).toFixed(0)}%` }));
      setModel(info);
      setClip(0);
      setPicked(null);
      set('props', false);
      setTab('model');
      say(`Model dimuat: ${info.name}`);
    } catch (e) {
      setModelError(e instanceof Error ? e.message : String(e));
    } finally {
      setModelBusy(null);
    }
  };

  const onPointerDown = (e: React.PointerEvent) => {
    downRef.current = { x: e.clientX, y: e.clientY, t: performance.now() };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = downRef.current;
    if (e.button !== 0 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4 || performance.now() - d.t > 400) return;
    const sh = showRef.current;
    if (!sh) return;
    const r = sh.pickObject((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1, true);
    setPicked(r);
    if (r) {
      setPickedFlash(r.name);
      setTimeout(() => setPickedFlash((c) => (c === r.name ? null : c)), 2400);
      if (sRef.current.dofClick) set('dofFocus', Math.min(300, Math.max(0.3, r.distance)));
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) void loadModel({ kind: 'files', files: Array.from(e.dataTransfer.files) });
  };

  const exportSettings = () => download(new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' }), 'lumina-settings.json');
  const importSettings = async (f: File | undefined) => {
    if (!f) return;
    try {
      setS(sanitize(JSON.parse(await f.text())));
      say('Pengaturan diimpor');
    } catch {
      say('File pengaturan tidak valid');
    }
  };

  const fps = Number(stats.fps ?? 0);
  const mat = picked?.material ?? null;

  return (
    <div
      className="fixed inset-0 overflow-hidden bg-slate-950 font-sans text-slate-200 select-none"
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragging) setDragging(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={onDrop}
    >
      <div ref={hostRef} className="absolute inset-0" onPointerDown={onPointerDown} onPointerUp={onPointerUp} />

      {/* header */}
      <div className="pointer-events-none absolute left-5 top-4 z-10">
        <div className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-sky-400 to-indigo-600 shadow-lg shadow-sky-900/40">
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-white" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2 3 7v10l9 5 9-5V7z" />
              <path d="M12 22V12M3 7l9 5 9-5" />
            </svg>
          </div>
          <div>
            <div className="text-sm font-semibold tracking-wide text-white drop-shadow">LUMINA</div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-slate-300/80 drop-shadow">WebGL2 · Lumina 4 · GI cache · PCSS · Decal · AgX</div>
          </div>
        </div>
      </div>

      <div className="absolute right-5 top-4 z-10 flex gap-2">
        <button
          onClick={() => {
            const sh = showRef.current;
            if (!sh) return;
            sh.screenshot().then((b) => download(b, 'lumina.png'), () => say('Gagal mengambil gambar'));
          }}
          className="rounded-lg bg-slate-900/70 px-3 py-1.5 text-xs font-medium text-slate-200 ring-1 ring-white/10 backdrop-blur hover:bg-slate-800/80"
        >
          📷 Foto
        </button>
        <button onClick={() => setAbout(true)} className="rounded-lg bg-slate-900/70 px-3 py-1.5 text-xs font-medium text-slate-200 ring-1 ring-white/10 backdrop-blur hover:bg-slate-800/80">
          Tentang library
        </button>
        <button onClick={() => setPanel(!panel)} className="rounded-lg bg-slate-900/70 px-3 py-1.5 text-xs font-medium text-slate-200 ring-1 ring-white/10 backdrop-blur hover:bg-slate-800/80">
          {panel ? 'Sembunyikan panel' : 'Tampilkan panel'}
        </button>
      </div>

      {/* stats */}
      {ready && (
        <div className="pointer-events-none absolute bottom-4 left-5 z-10 w-56 rounded-xl bg-slate-950/70 p-3 text-[11px] leading-5 ring-1 ring-white/10 backdrop-blur">
          <div className="mb-1 flex items-baseline justify-between">
            <span className={`text-2xl font-semibold tabular-nums ${fps >= 55 ? 'text-emerald-400' : fps >= 30 ? 'text-amber-300' : 'text-rose-400'}`}>{fps.toFixed(0)}</span>
            <span className="text-slate-500">FPS · {Number(stats.ms ?? 0).toFixed(1)} ms</span>
          </div>
          <Stat k="CPU render" v={`${Number(stats.cpu ?? 0).toFixed(2)} ms`} />
          <Stat k="GPU render" v={stats.gpuOk ? `${Number(stats.gpu ?? 0).toFixed(2)} ms` : 'n/a'} />
          <Stat k="Draw calls" v={String(stats.calls ?? 0)} />
          <Stat k="Segitiga" v={fmtN(Number(stats.tris ?? 0))} />
          <Stat k="Terlihat / di-cull" v={`${stats.vis ?? 0} / ${stats.cull ?? 0}`} />
          <Stat k="Shadow draws" v={String(stats.sh ?? 0)} />
          <Stat k="Lampu · program" v={`${stats.lights ?? 0} · ${stats.prog ?? 0}`} />
          <Stat k="Resolusi internal" v={String(stats.res ?? '')} />
          {s.adaptive && <Stat k="Hemat adaptif" v={Number(stats.aq) ? `L${stats.aq} · ${stats.aqStep}` : 'tidak perlu'} warn={!!Number(stats.aq)} />}
          <div className="mt-1 truncate text-[10px] text-slate-500" title={String(stats.gpuName ?? '')}>
            {String(stats.gpuName ?? '')}
          </div>
        </div>
      )}

      {pickedFlash && (
        <div className="pointer-events-none absolute bottom-6 left-1/2 z-10 -translate-x-1/2 rounded-full bg-slate-950/80 px-4 py-2 text-xs text-slate-100 ring-1 ring-sky-400/40 backdrop-blur">◎ {pickedFlash}</div>
      )}
      {ready && !pickedFlash && (
        <div className="pointer-events-none absolute bottom-5 left-1/2 z-10 hidden -translate-x-1/2 text-[11px] text-white/70 drop-shadow xl:block">
          Drag: putar · Klik kanan / Shift+drag: geser · Scroll: zoom · Klik objek: fokus &amp; edit material · Seret file .glb ke sini
        </div>
      )}
      {toast && <div className="pointer-events-none absolute left-1/2 top-16 z-30 -translate-x-1/2 rounded-full bg-emerald-500/90 px-4 py-1.5 text-xs font-medium text-white shadow-lg">{toast}</div>}

      {/* control panel */}
      {panel && ready && (
        <div className="absolute bottom-4 right-5 top-16 z-10 w-80 overflow-y-auto rounded-2xl bg-slate-950/80 ring-1 ring-white/10 backdrop-blur-md [scrollbar-width:thin]">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'render', label: 'Render' },
              { id: 'effects', label: 'Efek' },
              { id: 'l4', label: 'L4' },
              { id: 'model', label: 'Model' },
              { id: 'object', label: 'Objek' },
            ]}
          />

          {tab === 'render' && (
            <>
              <Section title="Preset kualitas">
                <div className="grid grid-cols-5 gap-1.5">
                  {QUALITY.map((q) => (
                    <button key={q.name} onClick={() => patch(q.patch)} className="rounded-md bg-white/5 py-1.5 text-[11px] font-medium text-slate-300 hover:bg-sky-500/30 hover:text-white">
                      {q.name}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <Button onClick={exportSettings}>Ekspor</Button>
                  <Button onClick={() => importRef.current?.click()}>Impor</Button>
                  <Button variant="danger" onClick={() => setS(DEFAULTS)}>
                    Reset
                  </Button>
                </div>
                <input ref={importRef} type="file" accept="application/json" hidden onChange={(e) => void importSettings(e.target.files?.[0]).then(() => (e.target.value = ''))} />
                <div className="text-[10px] text-slate-500">Pengaturan tersimpan otomatis di browser.</div>
              </Section>

              <Section title="Langit & waktu">
                <div className="grid grid-cols-2 gap-1.5">
                  {SKY_PRESETS.map((p) => (
                    <button key={p.name} onClick={() => patch({ elevation: p.e, azimuth: p.a })} className="rounded-md bg-white/5 py-1.5 text-[11px] font-medium text-slate-300 hover:bg-sky-500/30 hover:text-white">
                      {p.name}
                    </button>
                  ))}
                </div>
                <Slider label="Elevasi matahari" value={s.elevation} min={-4} max={85} step={0.1} onChange={(v) => set('elevation', v)} fmt={(v) => v.toFixed(1) + '°'} />
                <Slider label="Azimuth" value={s.azimuth} min={0} max={360} step={1} onChange={(v) => set('azimuth', v)} fmt={(v) => v.toFixed(0) + '°'} />
                <Slider label="Kabut atmosfer" value={s.fog} min={0} max={8} step={0.05} onChange={(v) => set('fog', v)} />
              </Section>

              <Section title="Pencahayaan & bayangan">
                <Toggle label="Cascaded shadow maps" value={s.shadows} onChange={(v) => set('shadows', v)} />
                <Segmented label="Resolusi shadow" value={s.shadowSize} options={[{ label: '1K', value: 1024 }, { label: '2K', value: 2048 }, { label: '4K', value: 4096 }]} onChange={(v) => set('shadowSize', v)} />
                <Segmented label="Jumlah cascade" value={s.cascades} options={[1, 2, 3, 4].map((n) => ({ label: String(n), value: n }))} onChange={(v) => set('cascades', v)} />
                <Slider label="Kelembutan penumbra" value={s.softness} min={0.5} max={4} step={0.05} onChange={(v) => set('softness', v)} />
                <Toggle label="SSAO" hint="ambient occlusion" value={s.ssao} onChange={(v) => set('ssao', v)} />
                <Toggle label="Volumetric fog" hint="butuh shadow aktif" value={s.volFog} onChange={(v) => set('volFog', v)} />
                {s.volFog && (
                  <>
                    <Slider label="Kepadatan" value={s.volFogDensity} min={0} max={0.15} step={0.001} onChange={(v) => set('volFogDensity', v)} />
                    <Slider label="Peluruhan ketinggian" value={s.volFogHeightFalloff} min={0} max={0.3} step={0.005} onChange={(v) => set('volFogHeightFalloff', v)} />
                    <Slider label="Arah hamburan" hint="negatif = ke kamera" value={s.volFogAnisotropy} min={-0.9} max={0.9} step={0.01} onChange={(v) => set('volFogAnisotropy', v)} />
                    <Slider label="Intensitas sinar" value={s.volFogIntensity} min={0} max={4} step={0.05} onChange={(v) => set('volFogIntensity', v)} />
                  </>
                )}
              </Section>

              <Section title="Awan prosedural">
                <Slider label="Tutupan awan" hint="0 = cerah, 1 = mendung" value={s.clouds} min={0} max={1} step={0.01} onChange={(v) => set('clouds', v)} fmt={(v) => (v * 100).toFixed(0) + '%'} />
                {s.clouds > 0 && (
                  <>
                    <Slider label="Kepadatan" value={s.cloudDensity} min={0.3} max={2.5} step={0.05} onChange={(v) => set('cloudDensity', v)} />
                    <Slider label="Skala awan" hint="besar ↔ kecil" value={s.cloudScale} min={0.8} max={5} step={0.05} onChange={(v) => set('cloudScale', v)} />
                    <Toggle label="Awan bergerak (angin)" value={s.cloudDrift} onChange={(v) => set('cloudDrift', v)} />
                  </>
                )}
                <div className="text-[10px] text-slate-500">Awan ikut mewarnai pencahayaan &amp; pantulan, dan menyaring sinar matahari saat mendung.</div>
              </Section>

              <Section title="Air kolam (refraksi)">
                <Slider label="Tinggi gelombang" value={s.waterWaves} min={0} max={0.12} step={0.002} onChange={(v) => set('waterWaves', v)} />
                <Slider label="Skala riak" value={s.waterScale} min={0.4} max={3} step={0.05} onChange={(v) => set('waterScale', v)} />
                <Slider label="Kecepatan" value={s.waterSpeed} min={0} max={3} step={0.05} onChange={(v) => set('waterSpeed', v)} fmt={(v) => '×' + v.toFixed(2)} />
                <Slider label="Kejernihan" hint="jarak serap warna" value={s.waterClarity} min={0.3} max={12} step={0.1} onChange={(v) => set('waterClarity', v)} fmt={(v) => v.toFixed(1) + ' m'} />
                <ColorField label="Warna air" value={s.waterColor} onChange={(h) => set('waterColor', h)} />
              </Section>

              <Section title="Kamera & tone mapping">
                <Toggle label="Auto exposure" hint="adaptasi mata" value={s.autoExposure} onChange={(v) => set('autoExposure', v)} />
                <Slider label="Kompensasi exposure" value={s.exposure} min={0.25} max={3} step={0.01} onChange={(v) => set('exposure', v)} fmt={(v) => '×' + v.toFixed(2)} />
                <Segmented
                  label="Tone mapper"
                  value={s.tone}
                  options={[{ label: 'AgX', value: 'agx' }, { label: 'ACES', value: 'aces' }, { label: 'Neutral', value: 'neutral' }, { label: 'Filmic', value: 'filmic' }, { label: 'Reinhard', value: 'reinhard' }, { label: 'Linear', value: 'none' }]}
                  onChange={(v) => set('tone', v as ToneMapping)}
                />
                <Toggle label="Bloom" value={s.bloom} onChange={(v) => set('bloom', v)} />
                <Slider label="Intensitas bloom" value={s.bloomIntensity} min={0} max={0.6} step={0.005} onChange={(v) => set('bloomIntensity', v)} />
                <div>
                  <div className="mb-1 text-xs text-slate-400">Posisi kamera</div>
                  <div className="grid grid-cols-4 gap-1">
                    {(['default', 'top', 'front', 'low', 'close', 'relief', 'glass', 'gi'] as const).map((p) => (
                      <Button key={p} onClick={() => showRef.current?.setCameraPreset(p)}>
                        {{ default: 'Awal', top: 'Atas', front: 'Depan', low: 'Rendah', close: 'Dekat', relief: 'Relief', glass: 'Kaca', gi: 'GI' }[p]}
                      </Button>
                    ))}
                  </div>
                </div>
              </Section>

              <Section title="Performa">
                <Segmented label="MSAA" value={s.msaa} options={[{ label: 'Off', value: 0 }, { label: '2×', value: 2 }, { label: '4×', value: 4 }]} onChange={(v) => set('msaa', v)} />
                <Toggle label="Kualitas adaptif" hint="efek dikurangi otomatis bila lambat" value={s.adaptive} onChange={(v) => set('adaptive', v)} />
                {s.adaptive && <Slider label="Target FPS" value={s.adaptiveFps} min={24} max={120} step={1} onChange={(v) => set('adaptiveFps', v)} fmt={(v) => v.toFixed(0)} />}
                <Toggle label="Dynamic resolution" hint="otomatis" value={s.dynRes} onChange={(v) => set('dynRes', v)} />
                {!s.dynRes && <Slider label="Render scale" value={s.scale} min={0.4} max={1} step={0.05} onChange={(v) => set('scale', v)} fmt={(v) => (v * 100).toFixed(0) + '%'} />}
                <Segmented
                  label="Instanced boxes (1 draw call)"
                  value={s.instances}
                  options={[{ label: '1.5K', value: 1500 }, { label: '10K', value: 10000 }, { label: '50K', value: 50000 }, { label: '200K', value: 200000 }]}
                  onChange={(v) => set('instances', v)}
                />
              </Section>

              <Section title="Scene" defaultOpen={false}>
                <Toggle label="Animasi" value={s.animate} onChange={(v) => set('animate', v)} />
                <Toggle label="Auto-rotate kamera" value={s.autoRotate} onChange={(v) => set('autoRotate', v)} />
                <Toggle label="Tampilkan objek demo" value={s.props} onChange={(v) => set('props', v)} />
              </Section>
            </>
          )}

          {tab === 'effects' && (
            <>
              <Section title="Global illumination (SSGI)">
                <Toggle label="Aktifkan SSGI" hint="warna memantul antar-objek" value={s.ssgi} onChange={(v) => set('ssgi', v)} />
                {s.ssgi && (
                  <>
                    <Slider label="Intensitas bounce" value={s.ssgiIntensity} min={0} max={4} step={0.05} onChange={(v) => set('ssgiIntensity', v)} />
                    <Slider label="Radius bounce" value={s.ssgiRadius} min={1} max={20} step={0.5} onChange={(v) => set('ssgiRadius', v)} fmt={(v) => v.toFixed(1) + ' m'} />
                    <Segmented label="Ray per piksel" value={s.ssgiRays} options={[1, 2, 3, 4].map((n) => ({ label: String(n), value: n }))} onChange={(v) => set('ssgiRays', v)} />
                    <Segmented label="Langkah ray" value={s.ssgiSteps} options={[{ label: '8', value: 8 }, { label: '16', value: 16 }, { label: '24', value: 24 }, { label: '32', value: 32 }]} onChange={(v) => set('ssgiSteps', v)} />
                    <Slider label="Denoise spasial" value={s.ssgiBlur} min={0} max={8} step={1} onChange={(v) => set('ssgiBlur', v)} fmt={(v) => v.toFixed(0) + ' px'} />
                    <Toggle label="Tampilkan bounce saja" hint="debug" value={s.ssgiDebug} onChange={(v) => set('ssgiDebug', v)} />
                  </>
                )}
                <Button onClick={() => showRef.current?.setCameraPreset('gi')}>Lihat dinding merah / biru →</Button>
              </Section>

              <Section title="Refraksi & dispersi">
                <Toggle label="Refraksi screen-space" hint="ray-march depth" value={s.refrSS} onChange={(v) => set('refrSS', v)} />
                {s.refrSS && (
                  <>
                    <Slider label="Pembengkokan lensa" hint="slab ↔ lensa penuh" value={s.refrBend} min={0} max={1} step={0.01} onChange={(v) => set('refrBend', v)} />
                    <Segmented label="Langkah ray" value={s.refrSteps} options={[{ label: '12', value: 12 }, { label: '24', value: 24 }, { label: '40', value: 40 }, { label: '64', value: 64 }]} onChange={(v) => set('refrSteps', v)} />
                  </>
                )}
                <Slider label="Dispersi kromatik" hint="pelangi di tepi kaca" value={s.dispersion} min={0} max={4} step={0.05} onChange={(v) => set('dispersion', v)} fmt={(v) => '×' + v.toFixed(2)} />
                <Button onClick={() => showRef.current?.setCameraPreset('glass')}>Lihat lensa &amp; prisma →</Button>
              </Section>

              <Section title="Parallax occlusion mapping">
                <Toggle label="Aktifkan POM" hint="kedalaman nyata" value={s.pom} onChange={(v) => set('pom', v)} />
                {s.pom && (
                  <>
                    <Slider label="Kedalaman relief" hint="× dasar material" value={s.pomDepth} min={0} max={3} step={0.05} onChange={(v) => set('pomDepth', v)} fmt={(v) => '×' + v.toFixed(2)} />
                    <Slider label="Kualitas ray-march" value={s.pomQuality} min={0.25} max={1} step={0.05} onChange={(v) => set('pomQuality', v)} fmt={(v) => (v * 100).toFixed(0) + '%'} />
                    <Segmented label="Langkah maksimum" value={s.pomSteps} options={[{ label: '16', value: 16 }, { label: '32', value: 32 }, { label: '40', value: 40 }, { label: '64', value: 64 }]} onChange={(v) => set('pomSteps', v)} />
                    <Slider label="Self-shadow relief" value={s.pomShadow} min={0} max={1} step={0.01} onChange={(v) => set('pomShadow', v)} />
                    <Slider label="Cavity occlusion" value={s.pomAO} min={0} max={1} step={0.01} onChange={(v) => set('pomAO', v)} />
                  </>
                )}
                <Button onClick={() => showRef.current?.setCameraPreset('relief')}>Lihat panel relief →</Button>
              </Section>

              <Section title="Temporal AA (TAA)">
                <Toggle label="Aktifkan TAA" hint="matikan MSAA untuk performa" value={s.taa} onChange={(v) => set('taa', v)} />
                {s.taa && (
                  <>
                    <Slider label="Bobot history" hint="tinggi = halus, ghosting" value={s.taaFeedback} min={0.7} max={0.97} step={0.01} onChange={(v) => set('taaFeedback', v)} />
                    <Slider label="Jitter" value={s.taaJitter} min={0} max={1.5} step={0.05} onChange={(v) => set('taaJitter', v)} />
                  </>
                )}
                <Slider label="Sharpen" hint="imbangi blur TAA" value={s.sharpen} min={0} max={1} step={0.01} onChange={(v) => set('sharpen', v)} />
              </Section>

              <Section title="Screen-space reflections">
                <Toggle label="Aktifkan SSR" value={s.ssr} onChange={(v) => set('ssr', v)} />
                {s.ssr && (
                  <>
                    <Slider label="Intensitas" value={s.ssrIntensity} min={0} max={1.5} step={0.01} onChange={(v) => set('ssrIntensity', v)} />
                    <Slider label="Jarak maksimum" value={s.ssrDistance} min={5} max={120} step={1} onChange={(v) => set('ssrDistance', v)} fmt={(v) => v.toFixed(0) + ' m'} />
                    <Slider label="Ketebalan" value={s.ssrThickness} min={0.05} max={3} step={0.05} onChange={(v) => set('ssrThickness', v)} fmt={(v) => v.toFixed(2) + ' m'} />
                    <Slider label="Roughness maksimum" value={s.ssrRough} min={0.1} max={1} step={0.01} onChange={(v) => set('ssrRough', v)} />
                    <Segmented label="Langkah ray" value={s.ssrSteps} options={[{ label: '32', value: 32 }, { label: '64', value: 64 }, { label: '96', value: 96 }, { label: '128', value: 128 }]} onChange={(v) => set('ssrSteps', v)} />
                  </>
                )}
              </Section>

              <Section title="Depth of field">
                <Toggle label="Aktifkan DoF" value={s.dof} onChange={(v) => set('dof', v)} />
                {s.dof && (
                  <>
                    <Toggle label="Klik objek = fokus" value={s.dofClick} onChange={(v) => set('dofClick', v)} />
                    <Slider label="Jarak fokus" value={s.dofFocus} min={0.5} max={120} step={0.1} onChange={(v) => set('dofFocus', v)} fmt={(v) => v.toFixed(1) + ' m'} />
                    <Slider label="Focal length" value={s.dofFocal} min={18} max={200} step={1} onChange={(v) => set('dofFocal', v)} fmt={(v) => v.toFixed(0) + ' mm'} />
                    <Slider label="Aperture" value={s.dofFStop} min={0.95} max={16} step={0.05} onChange={(v) => set('dofFStop', v)} fmt={(v) => 'f/' + v.toFixed(2)} />
                    <Slider label="Blur maksimum" value={s.dofBlur} min={2} max={32} step={1} onChange={(v) => set('dofBlur', v)} fmt={(v) => v.toFixed(0) + ' px'} />
                  </>
                )}
              </Section>

              <Section title="Motion blur">
                <Toggle label="Aktifkan motion blur" hint="objek & kamera" value={s.mb} onChange={(v) => set('mb', v)} />
                {s.mb && <Slider label="Intensitas shutter" value={s.mbIntensity} min={0.1} max={2} step={0.05} onChange={(v) => set('mbIntensity', v)} />}
              </Section>

              <Section title="Bayangan kontak (screen-space)">
                <Toggle label="Aktifkan" hint="mendasari objek kecil" value={s.contact} onChange={(v) => set('contact', v)} />
                {s.contact && (
                  <>
                    <Slider label="Panjang ray" value={s.contactLength} min={0.1} max={2} step={0.05} onChange={(v) => set('contactLength', v)} fmt={(v) => v.toFixed(2) + ' m'} />
                    <Slider label="Kekuatan" value={s.contactStrength} min={0} max={1} step={0.01} onChange={(v) => set('contactStrength', v)} />
                  </>
                )}
              </Section>

              <Section title="Lensa & flare">
                <Toggle label="Lens flare" hint="hanya sumber cahaya terang" value={s.flare} onChange={(v) => set('flare', v)} />
                {s.flare && (
                  <>
                    <Slider label="Intensitas" value={s.flareIntensity} min={0} max={1.5} step={0.01} onChange={(v) => set('flareIntensity', v)} />
                    <Slider label="Ambang kecerahan" value={s.flareThreshold} min={1} max={60} step={0.5} onChange={(v) => set('flareThreshold', v)} />
                    <Segmented label="Jumlah ghost" value={s.flareGhosts} options={[{ label: '2', value: 2 }, { label: '4', value: 4 }, { label: '5', value: 5 }, { label: '8', value: 8 }]} onChange={(v) => set('flareGhosts', v)} />
                  </>
                )}
                <Slider label="Distorsi lensa" hint="barrel ↔ pincushion" value={s.lensDistortion} min={-0.1} max={0.1} step={0.002} onChange={(v) => set('lensDistortion', v)} />
              </Section>

              <Section title="Look sinematik (CDL)">
                <Segmented
                  label="Gradasi warna"
                  value={s.look}
                  options={[{ label: 'Netral', value: 'none' }, { label: 'Hangat', value: 'warm' }, { label: 'Teal', value: 'teal' }, { label: 'Dingin', value: 'cool' }, { label: 'Pudar', value: 'fade' }]}
                  onChange={(v) => set('look', v)}
                />
              </Section>

              <Section title="Color grading" defaultOpen={false}>
                <Slider label="Suhu warna" hint="dingin ↔ hangat" value={s.temperature} min={-1} max={1} step={0.01} onChange={(v) => set('temperature', v)} />
                <Slider label="Saturasi" value={s.saturation} min={0} max={2} onChange={(v) => set('saturation', v)} />
                <Slider label="Kontras" value={s.contrast} min={0.7} max={1.5} onChange={(v) => set('contrast', v)} />
                <Slider label="Vignette" value={s.vignette} min={0} max={1} onChange={(v) => set('vignette', v)} />
                <Slider label="Film grain" value={s.grain} min={0} max={0.5} onChange={(v) => set('grain', v)} />
                <Slider label="Chromatic aberration" value={s.chroma} min={0} max={0.01} step={0.0002} onChange={(v) => set('chroma', v)} fmt={(v) => (v * 1000).toFixed(1)} />
              </Section>
            </>
          )}

          {tab === 'l4' && (
            <>
              <Section title="Perangkat & optimasi otomatis">
                {showRef.current && (
                  <Note tone={showRef.current.device.tier === 'high' ? 'info' : 'warn'}>
                    GPU: {showRef.current.device.gpu.slice(0, 60)} · kelas <b>{showRef.current.device.tier}</b>
                    {showRef.current.device.mobile ? ' (mobile)' : ''} · {showRef.current.device.reasons.join(', ')}. Detail geometri ×{showRef.current.device.geometryDetail.toFixed(2)}.
                  </Note>
                )}
                <Button variant="primary" onClick={() => { const d = detectDevice(); patch({ ...deviceDefaults(), ...(d.tier === 'high' ? { dynRes: false } : {}) }); say('Optimasi perangkat diterapkan'); }}>
                  Terapkan preset otomatis perangkat
                </Button>
              </Section>

              <Section title="GI dunia (surface cache) & multi-bounce">
                <Toggle label="Multi-bounce SSGI" hint="frame GI diumpan balik → cahaya memantul berkali-kali" value={s.ssgiBounce} onChange={(v) => set('ssgiBounce', v)} />
                <Toggle label="World-space radiance cache" hint="voxel 3D mengikuti kamera; ray off-screen membaca cache" value={s.ssgiCache} onChange={(v) => set('ssgiCache', v)} />
                {s.ssgiCache && (
                  <>
                    <Slider label="Jangkauan cache" value={s.ssgiCacheExtent} min={12} max={120} step={1} onChange={(v) => set('ssgiCacheExtent', v)} fmt={(v) => v.toFixed(0) + ' m'} />
                    <Segmented label="Resolusi voxel" value={s.ssgiCacheRes} options={[16, 24, 32, 48].map((n) => ({ label: n + '³', value: n }))} onChange={(v) => set('ssgiCacheRes', v)} />
                    <Slider label="Kekuatan GI off-screen" value={s.ssgiCacheStrength} min={0} max={2} onChange={(v) => set('ssgiCacheStrength', v)} />
                  </>
                )}
                {!s.ssgi && <Note>Aktifkan SSGI di tab Efek agar bagian ini berpengaruh.</Note>}
              </Section>

              <Section title="Bayangan: PCSS & lampu lokal">
                <Toggle label="PCSS (penumbra dinamis)" hint="blocker search: tajam di kontak, lembut di jauh" value={s.pcss} onChange={(v) => set('pcss', v)} />
                {s.pcss && <Slider label="Ukuran sumber cahaya" value={s.sunPenumbra} min={0.002} max={0.08} step={0.001} onChange={(v) => set('sunPenumbra', v)} fmt={(v) => v.toFixed(3)} />}
                <Slider label="Micro-shadowing" hint="rongga material menggelapkan cahaya miring" value={s.microShadow} min={0} max={1} onChange={(v) => set('microShadow', v)} />
                <Toggle label="Bayangan spot / point light" hint="shadow atlas 8 layer (point = 6 layer)" value={s.localShadows} onChange={(v) => set('localShadows', v)} />
                {s.localShadows && (
                  <>
                    <Segmented label="Resolusi atlas" value={s.localShadowSize} options={[512, 1024, 2048].map((n) => ({ label: String(n), value: n }))} onChange={(v) => set('localShadowSize', v)} />
                    <Slider label="Kelembutan" value={s.localShadowSoft} min={0.5} max={6} onChange={(v) => set('localShadowSoft', v)} fmt={(v) => v.toFixed(1) + ' texel'} />
                  </>
                )}
                <Toggle label="God rays dari lampu lokal" hint="butuh Volumetric fog (tab Render)" value={s.fogLocal} onChange={(v) => set('fogLocal', v)} />
                {s.fogLocal && <Slider label="Intensitas cahaya fog lokal" value={s.fogLocalIntensity} min={0} max={4} onChange={(v) => set('fogLocalIntensity', v)} />}
                {!s.volFog && <Note>Nyalakan "Volumetric fog" untuk melihat berkas cahaya lampu sorot & neon.</Note>}
              </Section>

              <Section title="Kamera fisik & eye adaptation">
                <Toggle label="Eksposur histogram" hint="64 bin EV + persentil, center-weighted" value={s.histExposure} onChange={(v) => set('histExposure', v)} />
                <Slider label="Bobot tengah (metering)" value={s.exposureCenter} min={0} max={1} onChange={(v) => set('exposureCenter', v)} />
                <Slider label="Kompensasi eksposur" value={s.exposureComp} min={-3} max={3} step={0.1} onChange={(v) => set('exposureComp', v)} fmt={(v) => (v >= 0 ? '+' : '') + v.toFixed(1) + ' EV'} />
                <Slider label="Vignette optik (cos⁴)" value={s.opticalVignette} min={0} max={1} onChange={(v) => set('opticalVignette', v)} />
                <Toggle label="Bloom hemat energi" hint="menyebar, bukan menambah cahaya" value={s.energyBloom} onChange={(v) => set('energyBloom', v)} />
              </Section>

              <Section title="Material berlapis, detail & decal">
                <Slider label="Basah (wetness)" hint="gelap + licin, mengisi cekungan dulu" value={s.wetness} min={0} max={1} onChange={(v) => set('wetness', v)} />
                <Slider label="Debu (dust)" hint="mengendap di permukaan atas" value={s.dust} min={0} max={1} onChange={(v) => set('dust', v)} />
                <Slider label="Detail map: normal" value={s.detail} min={0} max={1.5} onChange={(v) => set('detail', v)} />
                <Slider label="Detail map: roughness" hint="sidik jari / goresan mikro" value={s.detailRough} min={0} max={0.8} onChange={(v) => set('detailRough', v)} />
                <Slider label="Tiling detail" value={s.detailTiling} min={2} max={60} step={1} onChange={(v) => set('detailTiling', v)} fmt={(v) => v.toFixed(0) + '×'} />
                <Toggle label="Decal (retak, kotor, genangan, lumut)" value={s.decals} onChange={(v) => set('decals', v)} />
                <Slider label="Normal height ⊕ normal map" hint="RNM; 0 = hanya normal map" value={s.pomBlend} min={0} max={1} onChange={(v) => set('pomBlend', v)} />
                <Toggle label="Self-shadow POM untuk lampu lokal" value={s.pomLocalShadow} onChange={(v) => set('pomLocalShadow', v)} />
                <div className="grid grid-cols-3 gap-1.5">
                  <Button onClick={() => showRef.current?.setCameraPreset('decals')}>Dinding</Button>
                  <Button onClick={() => showRef.current?.setCameraPreset('wet')}>Genangan</Button>
                  <Button onClick={() => showRef.current?.setCameraPreset('gi')}>GI</Button>
                </div>
              </Section>
            </>
          )}

          {tab === 'model' && (
            <>
              <Section title="Muat model glTF / GLB">
                <Button variant="primary" onClick={() => void loadModel({ kind: 'sample' })} disabled={!!modelBusy}>
                  Muat contoh bawaan (offline)
                </Button>
                <Select label="Contoh Khronos (butuh internet)" value={sampleId} options={SAMPLES.map((x) => ({ label: x.label, value: x.id }))} onChange={setSampleId} />
                <Button
                  disabled={!!modelBusy}
                  onClick={() => void loadModel({ kind: 'url', url: `${KHRONOS}${sampleId}/glTF-Binary/${sampleId}.glb`, name: sampleId })}
                >
                  Unduh &amp; muat {sampleId}
                </Button>
                <div className="flex gap-1.5">
                  <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://…/model.glb"
                    className="min-w-0 flex-1 rounded-md bg-slate-800 px-2 py-1.5 text-xs text-slate-100 ring-1 ring-white/10 outline-none focus:ring-sky-400"
                  />
                  <Button disabled={!url.trim() || !!modelBusy} onClick={() => void loadModel({ kind: 'url', url: url.trim() })}>
                    Muat
                  </Button>
                </div>
                <Button disabled={!!modelBusy} onClick={() => fileRef.current?.click()}>
                  Pilih file dari komputer…
                </Button>
                <input ref={fileRef} type="file" multiple accept=".glb,.gltf,.bin,.png,.jpg,.jpeg,.webp" hidden onChange={(e) => e.target.files?.length && void loadModel({ kind: 'files', files: Array.from(e.target.files) }).then(() => (e.target.value = ''))} />
                <div className="text-[10px] text-slate-500">Atau seret file .glb / .gltf (+ .bin &amp; tekstur) langsung ke jendela.</div>
                {modelBusy && (
                  <div>
                    <div className="mb-1 text-[11px] text-slate-400">{modelBusy.label}</div>
                    <div className="h-1 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full bg-sky-400 transition-all" style={{ width: `${Math.max(5, modelBusy.p * 100)}%` }} />
                    </div>
                  </div>
                )}
                {modelError && <Note tone="error">{modelError}</Note>}
              </Section>

              {model && (
                <>
                  <Section title="Info model">
                    <div className="space-y-0.5 text-[11px]">
                      <div className="truncate font-medium text-slate-100" title={model.name}>
                        {model.name}
                      </div>
                      <Stat k="Mesh" v={String(model.meshes)} />
                      <Stat k="Segitiga" v={fmtN(model.triangles)} />
                      <Stat k="Material · tekstur" v={`${model.materials} · ${model.textures}`} />
                      <Stat k="Lampu · kamera" v={`${model.lights} · ${model.cameras}`} />
                      <Stat k="Ukuran asli (m)" v={model.size.map((n) => n.toFixed(2)).join(' × ')} />
                    </div>
                    {model.warnings.map((w) => (
                      <Note key={w} tone="warn">
                        {w}
                      </Note>
                    ))}
                  </Section>

                  <Section title="Tampilan model">
                    <Slider label="Ukuran di scene" value={s.modelFit} min={1} max={14} step={0.1} onChange={(v) => set('modelFit', v)} fmt={(v) => v.toFixed(1) + ' m'} />
                    <Toggle label="Tampilkan objek demo" value={s.props} onChange={(v) => set('props', v)} />
                    {model.lights > 0 && <Toggle label="Lampu dari glTF" value={s.modelLights} onChange={(v) => set('modelLights', v)} />}
                    <Button variant="danger" onClick={() => { showRef.current?.clearModel(); setModel(null); set('props', true); setPicked(null); }}>
                      Hapus model
                    </Button>
                  </Section>

                  {model.animations.length > 0 && (
                    <Section title="Animasi">
                      <Select
                        label="Clip"
                        value={clip}
                        options={[{ label: '— diam —', value: -1 }, ...model.animations.map((a, i) => ({ label: `${a.name} (${a.duration.toFixed(1)}s)`, value: i }))]}
                        onChange={(v) => {
                          setClip(v);
                          showRef.current?.playClip(v);
                        }}
                      />
                      <Slider
                        label="Kecepatan"
                        value={clipSpeed}
                        min={0}
                        max={3}
                        step={0.05}
                        onChange={(v) => {
                          setClipSpeed(v);
                          showRef.current?.setClipSpeed(v);
                        }}
                        fmt={(v) => '×' + v.toFixed(2)}
                      />
                      <Toggle label="Animasi berjalan" value={s.animate} onChange={(v) => set('animate', v)} />
                    </Section>
                  )}
                </>
              )}
            </>
          )}

          {tab === 'object' && (
            <Section title={picked ? `Objek: ${picked.name}` : 'Editor material'}>
              {!picked && <Note>Klik objek mana pun di scene untuk memilihnya, lalu ubah materialnya di sini secara langsung.</Note>}
              {picked && !mat && <Note tone="warn">Objek ini tidak memiliki material PBR yang bisa diedit (instanced / unlit).</Note>}
              {mat && (
                <>
                  <ColorField label="Warna dasar" value={mat.color.getHexString()} onChange={(h) => { mat.color.setStyle(h); bump(); }} />
                  <Slider label="Roughness" value={mat.roughness} min={0} max={1} step={0.01} onChange={(v) => { mat.roughness = v; bump(); }} />
                  <Slider label="Metalness" value={mat.metalness} min={0} max={1} step={0.01} onChange={(v) => { mat.metalness = v; bump(); }} />
                  <Slider label="Clear-coat" value={mat.clearcoat} min={0} max={1} step={0.01} onChange={(v) => { mat.clearcoat = v; bump(); }} />
                  <Slider label="Clear-coat roughness" value={mat.clearcoatRoughness} min={0} max={1} step={0.01} onChange={(v) => { mat.clearcoatRoughness = v; bump(); }} />
                  <ColorField label="Warna emisi" value={mat.emissive.getHexString()} onChange={(h) => { mat.emissive.setStyle(h); bump(); }} />
                  <Slider label="Intensitas emisi" value={mat.emissiveIntensity} min={0} max={30} step={0.1} onChange={(v) => { mat.emissiveIntensity = v; bump(); }} />
                  <Slider label="Env reflection" value={mat.envMapIntensity} min={0} max={3} step={0.01} onChange={(v) => { mat.envMapIntensity = v; bump(); }} />
                  {mat.normalMap && <Slider label="Kekuatan normal map" value={mat.normalScale} min={0} max={3} step={0.01} onChange={(v) => { mat.normalScale = v; bump(); }} />}
                  {mat.transparent && <Slider label="Opasitas" value={mat.opacity} min={0.02} max={1} step={0.01} onChange={(v) => { mat.opacity = v; bump(); }} />}
                  <div className="pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Lapisan fotorealistik</div>
                  <Slider label="IOR" value={mat.ior} min={1} max={2.5} step={0.01} onChange={(v) => { mat.ior = v; bump(); }} />
                  <Slider label="Transmisi (refraksi)" value={mat.transmission} min={0} max={1} step={0.01} onChange={(v) => { mat.transmission = v; bump(); }} />
                  {mat.transmission > 0 && <Slider label="Ketebalan volume" value={mat.thickness} min={0} max={4} step={0.02} onChange={(v) => { mat.thickness = v; bump(); }} fmt={(v) => v.toFixed(2) + ' m'} />}
                  <Slider label="Sheen (kain)" value={mat.sheen} min={0} max={1} step={0.01} onChange={(v) => { mat.sheen = v; bump(); }} />
                  {mat.sheen > 0 && <Slider label="Sheen roughness" value={mat.sheenRoughness} min={0} max={1} step={0.01} onChange={(v) => { mat.sheenRoughness = v; bump(); }} />}
                  <Slider label="Anisotropy" hint="baja sikat" value={mat.anisotropy} min={-1} max={1} step={0.01} onChange={(v) => { mat.anisotropy = v; bump(); }} />
                  {mat.anisotropy !== 0 && <Slider label="Rotasi anisotropy" value={mat.anisotropyRotation} min={0} max={3.1416} step={0.01} onChange={(v) => { mat.anisotropyRotation = v; bump(); }} fmt={(v) => ((v * 180) / Math.PI).toFixed(0) + '°'} />}
                  <Slider label="Iridescence" hint="lapisan tipis" value={mat.iridescence} min={0} max={1} step={0.01} onChange={(v) => { mat.iridescence = v; bump(); }} />
                  {mat.iridescence > 0 && <Slider label="Tebal film" value={mat.iridescenceThickness} min={80} max={900} step={5} onChange={(v) => { mat.iridescenceThickness = v; bump(); }} fmt={(v) => v.toFixed(0) + ' nm'} />}
                  <Slider label="Subsurface (lilin/kulit)" value={mat.subsurface} min={0} max={1} step={0.01} onChange={(v) => { mat.subsurface = v; bump(); }} />
                  {mat.subsurface > 0 && <ColorField label="Warna subsurface" value={mat.subsurfaceColor.getHexString()} onChange={(h) => { mat.subsurfaceColor.setStyle(h); bump(); }} />}
                  {mat.transmission > 0 && <Slider label="Dispersi" hint="pelangi" value={mat.dispersion} min={0} max={10} step={0.05} onChange={(v) => { mat.dispersion = v; bump(); }} />}
                  {mat.heightMap && (
                    <>
                      <div className="pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Parallax occlusion</div>
                      <Slider label="Kedalaman relief" value={mat.parallaxScale} min={0} max={0.15} step={0.0025} onChange={(v) => { mat.parallaxScale = v; bump(); }} fmt={(v) => (v * 100).toFixed(1) + ' cm'} />
                      <Slider label="Self-shadow" value={mat.parallaxSelfShadow} min={0} max={1} step={0.01} onChange={(v) => { mat.parallaxSelfShadow = v; bump(); }} />
                      <Slider label="Cavity AO" value={mat.parallaxAO} min={0} max={1} step={0.01} onChange={(v) => { mat.parallaxAO = v; bump(); }} />
                    </>
                  )}
                  {mat.waves > 0 && <Slider label="Gelombang air" value={mat.waves} min={0} max={0.12} step={0.002} onChange={(v) => { mat.waves = v; bump(); }} />}
                </>
              )}
            </Section>
          )}
        </div>
      )}

      {/* about modal */}
      {about && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setAbout(false)}>
          <div className="max-h-full w-full max-w-4xl overflow-y-auto rounded-2xl bg-slate-900 p-6 ring-1 ring-white/10" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold text-white">Lumina Engine</h2>
                <p className="text-sm text-slate-400">
                  Library rendering WebGL2 (Lumina 4) — fokus pada performa dan realisme ala game engine: GI dunia + multi-bounce, PCSS, shadow lampu lokal, god rays, eksposur histogram, decal, material berlapis, SSGI, POM, refraksi + dispersi. Seluruh kode ada di <code className="text-sky-300">src/lumina/</code>.
                </p>
              </div>
              <button onClick={() => setAbout(false)} className="rounded-md px-2 py-1 text-slate-400 hover:bg-white/10 hover:text-white">
                ✕
              </button>
            </div>
            <div className="grid gap-5 md:grid-cols-2">
              <div className="space-y-2.5">
                {FEATURES.map(([t, d]) => (
                  <div key={t}>
                    <div className="text-sm font-medium text-sky-300">{t}</div>
                    <div className="text-xs leading-relaxed text-slate-400">{d}</div>
                  </div>
                ))}
              </div>
              <pre className="overflow-x-auto rounded-xl bg-black/50 p-4 text-[11px] leading-relaxed text-emerald-200/90">{SNIPPET}</pre>
            </div>
          </div>
        </div>
      )}

      {dragging && (
        <div className="pointer-events-none absolute inset-3 z-40 grid place-items-center rounded-3xl border-2 border-dashed border-sky-400 bg-sky-500/10 backdrop-blur-sm">
          <div className="rounded-xl bg-slate-950/80 px-6 py-4 text-center">
            <div className="text-lg font-semibold text-white">Lepaskan untuk memuat model</div>
            <div className="text-xs text-slate-400">.glb atau .gltf (beserta .bin &amp; tekstur)</div>
          </div>
        </div>
      )}

      {lost && (
        <div className="absolute inset-0 z-50 grid place-items-center bg-slate-950/80">
          <Note tone="warn">Konteks WebGL hilang (GPU di-reset). Lumina akan membangun ulang otomatis begitu browser memulihkannya…</Note>
        </div>
      )}

      {/* loading / error */}
      {!ready && !error && (
        <div className="absolute inset-0 z-40 grid place-items-center bg-slate-950">
          <div className="w-72 text-center">
            <div className="mb-1 text-lg font-semibold tracking-widest text-white">LUMINA</div>
            <div className="mb-4 text-xs text-slate-400">{progress.label}</div>
            <div className="h-1 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-gradient-to-r from-sky-400 to-indigo-500 transition-all" style={{ width: `${progress.p * 100}%` }} />
            </div>
          </div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 z-40 grid place-items-center bg-slate-950 p-6">
          <div className="max-w-md rounded-2xl bg-rose-950/40 p-6 text-center ring-1 ring-rose-500/30">
            <div className="mb-2 text-lg font-semibold text-rose-300">Tidak dapat memulai renderer</div>
            <p className="text-sm text-slate-300">{error}</p>
            <p className="mt-3 text-xs text-slate-500">Lumina memerlukan WebGL2 dengan ekstensi EXT_color_buffer_float (HDR).</p>
          </div>
        </div>
      )}
    </div>
  );
}
