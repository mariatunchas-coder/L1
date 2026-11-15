import { useEffect, useReducer, useRef, useState } from 'react';
import { Button, ColorField, Note, Section, Segmented, Select, Slider, Stat, Tabs, Toggle } from './components/ui';
import { createShowcase, type ModelInfo, type ModelSource, type PickResult, type Showcase } from './demo/buildScene';
import type { ToneMapping } from './lumina';

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
  tone: 'aces',
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
};

const STORAGE_KEY = 'lumina.settings.v2';

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
function loadSettings(): Settings {
  try {
    const t = localStorage.getItem(STORAGE_KEY);
    return t ? sanitize(JSON.parse(t)) : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

const QUALITY: { name: string; patch: Partial<Settings> }[] = [
  { name: 'Rendah', patch: { msaa: 0, taa: false, ssao: false, ssr: false, dof: false, mb: false, shadowSize: 1024, cascades: 2, scale: 0.75, volFog: false, bloom: true, sharpen: 0 } },
  { name: 'Sedang', patch: { msaa: 2, taa: false, ssao: true, ssr: false, dof: false, mb: false, shadowSize: 2048, cascades: 3, scale: 1, volFog: false, sharpen: 0 } },
  { name: 'Tinggi', patch: { msaa: 0, taa: true, ssao: true, ssr: true, dof: false, mb: false, shadowSize: 2048, cascades: 3, scale: 1, volFog: false, sharpen: 0.25 } },
  { name: 'Ultra', patch: { msaa: 4, taa: true, ssao: true, ssr: true, dof: false, mb: true, shadowSize: 4096, cascades: 4, scale: 1, volFog: true, sharpen: 0.25 } },
];

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
renderer.post.taa.enabled = true;          // anti-aliasing temporal
renderer.post.ssr.enabled = true;          // pantulan screen-space
renderer.post.dof.enabled = true;          // depth of field

const scene = new Scene();
scene.sky = new Sky();
const sun = new DirectionalLight();
sun.syncWithSky(scene.sky);
scene.add(sun);

const gltf = await new GLTFLoader().load('model.glb');
scene.add(gltf.scene);

const mixer = new AnimationMixer();
mixer.clipAction(gltf.animations[0]).play();

(function loop() {
  mixer.update(dt);
  renderer.render(scene, camera);
})();`;

const FEATURES: [string, string][] = [
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

type Tab = 'render' | 'effects' | 'model' | 'object';

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
    sh.setSun(s.elevation, s.azimuth);
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
            <div className="text-[10px] uppercase tracking-[0.2em] text-slate-300/80 drop-shadow">WebGL2 · PBR · TAA · SSR · glTF</div>
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
              { id: 'model', label: 'Model' },
              { id: 'object', label: 'Objek' },
            ]}
          />

          {tab === 'render' && (
            <>
              <Section title="Preset kualitas">
                <div className="grid grid-cols-4 gap-1.5">
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

              <Section title="Kamera & tone mapping">
                <Toggle label="Auto exposure" hint="adaptasi mata" value={s.autoExposure} onChange={(v) => set('autoExposure', v)} />
                <Slider label="Kompensasi exposure" value={s.exposure} min={0.25} max={3} step={0.01} onChange={(v) => set('exposure', v)} fmt={(v) => '×' + v.toFixed(2)} />
                <Segmented
                  label="Tone mapper"
                  value={s.tone}
                  options={[{ label: 'ACES', value: 'aces' }, { label: 'Neutral', value: 'neutral' }, { label: 'Filmic', value: 'filmic' }, { label: 'Reinhard', value: 'reinhard' }, { label: 'Linear', value: 'none' }]}
                  onChange={(v) => set('tone', v as ToneMapping)}
                />
                <Toggle label="Bloom" value={s.bloom} onChange={(v) => set('bloom', v)} />
                <Slider label="Intensitas bloom" value={s.bloomIntensity} min={0} max={0.6} step={0.005} onChange={(v) => set('bloomIntensity', v)} />
                <div>
                  <div className="mb-1 text-xs text-slate-400">Posisi kamera</div>
                  <div className="grid grid-cols-5 gap-1">
                    {(['default', 'top', 'front', 'low', 'close'] as const).map((p) => (
                      <Button key={p} onClick={() => showRef.current?.setCameraPreset(p)}>
                        {{ default: 'Awal', top: 'Atas', front: 'Depan', low: 'Rendah', close: 'Dekat' }[p]}
                      </Button>
                    ))}
                  </div>
                </div>
              </Section>

              <Section title="Performa">
                <Segmented label="MSAA" value={s.msaa} options={[{ label: 'Off', value: 0 }, { label: '2×', value: 2 }, { label: '4×', value: 4 }]} onChange={(v) => set('msaa', v)} />
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
                  Library rendering WebGL2 ala three.js — fokus pada performa dan realisme fisik. Seluruh kode ada di <code className="text-sky-300">src/lumina/</code>.
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
