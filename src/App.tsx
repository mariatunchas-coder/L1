import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, ColorField, Note, Section, Segmented, Select, Slider, Stat, Tabs, Toggle } from './components/ui';
import { CityWorld } from './demo/world';
import { DEFAULTS, LOOKS, PRESETS, QUALITY_PATCH, STORAGE_KEY, loadSettings, type CameraMode, type QualityId, type Settings } from './demo/settings';
import type { ToneMapping } from './lumina';

// ───────────────────────── declarative control specs ─────────────────────────
type Spec =
  | { kind: 'range'; k: keyof Settings; label: string; min: number; max: number; step: number; hint?: string; fmt?: (v: number) => string }
  | { kind: 'toggle'; k: keyof Settings; label: string; hint?: string }
  | { kind: 'color'; k: keyof Settings; label: string }
  | { kind: 'select'; k: keyof Settings; label: string; options: { label: string; value: string }[] };

const R = (k: keyof Settings, label: string, min: number, max: number, step: number, hint?: string, fmt?: (v: number) => string): Spec => ({ kind: 'range', k, label, min, max, step, hint, fmt });
const T = (k: keyof Settings, label: string, hint?: string): Spec => ({ kind: 'toggle', k, label, hint });
const C = (k: keyof Settings, label: string): Spec => ({ kind: 'color', k, label });
const S = (k: keyof Settings, label: string, options: { label: string; value: string }[]): Spec => ({ kind: 'select', k, label, options });

interface Group {
  title: string;
  open?: boolean;
  note?: string;
  items: Spec[];
}

const f0 = (v: number) => v.toFixed(0);
const f1 = (v: number) => v.toFixed(1);
const f3 = (v: number) => v.toFixed(3);
const f4 = (v: number) => v.toFixed(4);
const pct = (v: number) => Math.round(v * 100) + '%';
const hh = (v: number) => {
  const h = Math.floor(v),
    m = Math.round((v - h) * 60);
  return String(m === 60 ? (h + 1) % 24 : h).padStart(2, '0') + ':' + String(m === 60 ? 0 : m).padStart(2, '0');
};

const TABS = [
  { id: 'scene', label: 'Suasana' },
  { id: 'fog', label: 'Kabut X' },
  { id: 'light', label: 'Cahaya' },
  { id: 'lens', label: 'Lensa' },
  { id: 'engine', label: 'Engine' },
] as const;
type Tab = (typeof TABS)[number]['id'];

const GROUPS: Record<Exclude<Tab, 'engine'>, Group[]> = {
  scene: [
    {
      title: 'Waktu (astronomis)',
      open: true,
      items: [
        R('hour', 'Jam', 0, 24, 0.01, 'matahari / bulan / bintang', hh),
        R('timeScale', 'Kecepatan waktu', 0, 1.5, 0.01, 'jam game / detik', (v) => (v === 0 ? 'jeda' : v.toFixed(2) + ' j/d')),
        R('latitude', 'Lintang', -60, 60, 1, '°', f0),
        R('dayOfYear', 'Hari dalam tahun', 1, 365, 1, '172 = Juni', f0),
        R('azimuthOffset', 'Putar mata angin', -180, 180, 1, '°', f0),
      ],
    },
    {
      title: 'Langit & awan',
      items: [R('clouds', 'Tutupan awan', 0, 1, 0.01, undefined, pct), R('cloudDensity', 'Kepadatan awan', 0.2, 2, 0.01), R('cloudScale', 'Skala awan', 0.8, 5, 0.05), R('cloudDrift', 'Angin awan', 0, 0.2, 0.002, undefined, f3), R('stars', 'Bintang & Bima Sakti', 0, 3, 0.05), R('moon', 'Cahaya bulan', 0, 3, 0.05)],
    },
    {
      title: 'Cuaca',
      open: true,
      items: [T('rain', 'Hujan', 'goresan 3 lapis, menangkap cahaya lampu'), R('rainIntensity', 'Intensitas hujan', 0, 1, 0.01, undefined, pct), R('rainWind', 'Angin hujan', -1, 1, 0.01), R('wetness', 'Basah / genangan', 0, 1, 0.01, 'aspal, dinding, kolam', pct)],
    },
    {
      title: 'Atmosfer (aerial perspective)',
      items: [R('fog', 'Kepadatan kabut jauh', 0, 40, 0.1, '×10⁻⁴ /m', f1), R('fogHeight', 'Penurunan terhadap tinggi', 0, 0.1, 0.001, undefined, f3)],
    },
  ],
  fog: [
    {
      title: 'Volumetric Fog X',
      open: true,
      note: 'Integrasi cahaya 3D per-piksel: berkas matahari lewat cascade shadow, spot lampu jalan, multi-scatter, ambient langit, noise 3D bergerak, akumulasi temporal.',
      items: [
        T('volFog', 'Aktif'),
        R('volDensity', 'Kepadatan', 0, 25, 0.05, '×10⁻³ /m', f1),
        R('volHeightFalloff', 'Turun terhadap tinggi', 0, 0.12, 0.001, '1/m', f3),
        R('volBase', 'Tinggi dasar', -20, 60, 1, 'm', f0),
        R('volMax', 'Jarak maksimum', 60, 1500, 10, 'm', f0),
        R('volIntensity', 'Intensitas cahaya', 0, 5, 0.01),
        R('volAnisotropy', 'Anisotropi (god rays)', -0.9, 0.95, 0.01, 'g'),
      ],
    },
    {
      title: 'Struktur & gerak',
      open: true,
      items: [R('volNoise', 'Gumpalan (noise 3D)', 0, 1, 0.01, undefined, pct), R('volNoiseScale', 'Frekuensi gumpalan', 0.003, 0.12, 0.001, '1/m', f3), R('volWind', 'Kecepatan angin', 0, 20, 0.1, 'm/s', f1), R('volWindDir', 'Arah angin', 0, 360, 1, '°', f0)],
    },
    {
      title: 'Kabut tanah (mist)',
      items: [R('volMist', 'Kepadatan', 0, 25, 0.05, '×10⁻³ /m', f1), R('volMistFalloff', 'Ketebalan (turun /m)', 0.01, 0.6, 0.005, undefined, f3)],
    },
    {
      title: 'Cahaya di dalam kabut',
      items: [R('volMulti', 'Multi-scatter', 0, 1, 0.01, 'Wrenninge', pct), R('volAmbient', 'Ambient langit', 0, 4, 0.01), T('volLocal', 'Lampu lokal membuat berkas', 'spot & point'), R('volLocalIntensity', 'Intensitas lampu', 0, 6, 0.05), C('volAlbedo', 'Warna kabut (albedo)')],
    },
    {
      title: 'Kualitas',
      items: [R('volSteps', 'Langkah ray-march', 8, 96, 1, undefined, f0), R('volStepExp', 'Distribusi langkah', 1, 3, 0.05, '1 = rata, besar = rapat di dekat'), R('volTemporal', 'Akumulasi temporal', 0, 0.95, 0.01, undefined, pct)],
    },
  ],
  light: [
    {
      title: 'Bayangan matahari',
      open: true,
      items: [
        T('pcss', 'PCSS (penumbra dinamis)', 'blocker search'),
        R('penumbra', 'Ukuran penumbra', 0.002, 0.12, 0.001, undefined, f3),
        R('shadowDistance', 'Jarak bayangan', 60, 900, 10, 'm', f0),
        S('cascades', 'Cascade', [1, 2, 3, 4].map((n) => ({ label: String(n), value: String(n) }))),
        S('shadowSize', 'Resolusi', [1024, 2048, 4096].map((n) => ({ label: String(n), value: String(n) }))),
        T('localShadows', 'Bayangan lampu lokal (atlas)'),
        R('microShadow', 'Micro-shadowing', 0, 1, 0.01, undefined, pct),
        T('contact', 'Contact shadow'),
      ],
    },
    {
      title: 'Global Illumination',
      open: true,
      items: [T('ssgi', 'SSGI + world cache'), R('ssgiIntensity', 'Intensitas', 0, 4, 0.05), R('ssgiRays', 'Sinar', 1, 4, 1, undefined, f0), T('ssgiBounce', 'Multi-bounce (infinite bounce)'), T('ssgiCache', 'Radiance cache dunia (off-screen)')],
    },
    {
      title: 'Oklusi & pantulan',
      items: [T('ssao', 'GTAO'), R('gtaoIntensity', 'Intensitas AO', 0, 3, 0.05), R('gtaoRadius', 'Radius AO', 0.2, 3, 0.05, 'm'), T('ssr', 'SSR (jalan basah, kaca)'), R('ssrIntensity', 'Intensitas SSR', 0, 2, 0.05), R('ssrSteps', 'Langkah SSR', 16, 160, 1, undefined, f0)],
    },
    {
      title: 'Permukaan & kota',
      items: [T('pom', 'Parallax occlusion (jendela, curb)'), R('pomQuality', 'Kualitas POM', 0.2, 1, 0.05), T('decals', 'Decal (retak, genangan)'), R('lampIntensity', 'Lampu jalan', 0, 4000, 10, 'cd', f0), R('windowGlow', 'Cahaya jendela', 0, 20, 0.1, undefined, f1)],
    },
  ],
  lens: [
    {
      title: 'Kamera fisik',
      open: true,
      items: [
        R('fov', 'Field of view', 20, 110, 1, '°', f0),
        T('autoExposure', 'Eksposur otomatis (histogram)'),
        R('exposure', 'Eksposur manual', 0.05, 8, 0.01),
        R('ev', 'Kompensasi EV', -4, 4, 0.05, 'stop', f1),
        R('centerWeight', 'Bobot tengah layar', 0, 1, 0.01, undefined, pct),
        S('tone', 'Tone mapping', (['agx', 'aces', 'neutral', 'filmic', 'reinhard', 'none'] as ToneMapping[]).map((v) => ({ label: v.toUpperCase(), value: v }))),
      ],
    },
    {
      title: 'Bloom & optik',
      open: true,
      items: [T('bloom', 'Bloom'), R('bloomIntensity', 'Intensitas bloom', 0, 1.5, 0.01), T('bloomEnergy', 'Bloom fisik (energi kekal)'), R('halation', 'Halation film', 0, 1, 0.01), R('lensDirt', 'Lensa kotor', 0, 1, 0.01), T('flare', 'Lens flare'), R('flareIntensity', 'Intensitas flare', 0, 1, 0.01), R('vignette', 'Vignette', 0, 1, 0.01), R('opticalVignette', 'Vignette optik (cos⁴)', 0, 1, 0.01), R('chroma', 'Aberasi kromatik', 0, 0.01, 0.0001, undefined, f4), R('grain', 'Grain', 0, 0.4, 0.005, undefined, f3)],
    },
    {
      title: 'Depth of field & gerak',
      items: [T('dof', 'Depth of field'), R('dofFocus', 'Jarak fokus', 2, 400, 1, 'm', f0), R('dofFStop', 'f-stop', 1, 16, 0.1, undefined, f1), T('mb', 'Motion blur'), R('mbIntensity', 'Intensitas', 0, 1, 0.01), T('taa', 'TAA'), R('sharpen', 'Sharpen', 0, 1, 0.01)],
    },
    {
      title: 'Grading',
      items: [
        R('saturation', 'Saturasi', 0, 2, 0.01),
        R('contrast', 'Kontras', 0.5, 1.6, 0.01),
        R('temperature', 'Suhu warna', -1, 1, 0.01),
        S('look', 'Look', Object.keys(LOOKS).map((v) => ({ label: v, value: v }))),
      ],
    },
  ],
};

const NUMERIC_SELECT = new Set<keyof Settings>(['cascades', 'shadowSize']);

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

const fmtN = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n)));

export default function App() {
  const hostRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<CityWorld | null>(null);
  const [s, setS] = useState<Settings>(loadSettings);
  const sRef = useRef(s);
  sRef.current = s;
  const [progress, setProgress] = useState({ p: 0, label: 'Memulai…' });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lost, setLost] = useState(false);
  const [panel, setPanel] = useState(() => new URLSearchParams(window.location.search).get('noui') === null);
  const [hud, setHud] = useState(true);
  const [tab, setTab] = useState<Tab>('scene');
  const [stats, setStats] = useState<Record<string, number | string>>({});
  const [toast, setToast] = useState<string | null>(null);

  const say = useCallback((m: string) => {
    setToast(m);
    setTimeout(() => setToast((c) => (c === m ? null : c)), 2400);
  }, []);
  const set = useCallback(<K extends keyof Settings>(k: K, v: Settings[K]) => setS((p) => ({ ...p, [k]: v })), []);
  const patch = useCallback((p: Partial<Settings>) => setS((c) => ({ ...c, ...p })), []);

  // world lifecycle
  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.className = 'block h-full w-full';
    hostRef.current!.appendChild(canvas);
    let disposed = false;
    let world: CityWorld | null = null;
    const q = new URLSearchParams(window.location.search);
    const lite = q.get('lite') !== null;
    const onResize = () => world?.resize(window.innerWidth, window.innerHeight);
    CityWorld.create(canvas, (p, label) => !disposed && setProgress({ p, label }), lite ? { blocks: 6, roadTexture: 512, facadeTexture: 512 } : {})
      .then((w) => {
        if (disposed) return w.dispose();
        world = w;
        worldRef.current = w;
        (window as unknown as { __world: CityWorld }).__world = w;
        w.renderer.onContextLost = () => setLost(true);
        w.renderer.onContextRestored = () => setLost(false);
        w.onModeChange = (m) => setS((c) => (c.mode === m ? c : { ...c, mode: m }));
        w.apply(sRef.current);
        onResize();
        w.start();
        setReady(true);
      })
      .catch((e: Error) => !disposed && setError(e.message || String(e)));
    window.addEventListener('resize', onResize);
    const timer = setInterval(() => {
      const w = worldRef.current;
      if (!w) return;
      const i = w.renderer.info;
      const c = w.city.stats;
      setStats({
        fps: i.fps,
        ms: i.frameMs,
        gpu: i.gpuMs,
        cpu: i.cpuMs,
        calls: i.calls,
        tris: i.triangles,
        vis: i.visible,
        cull: i.culled,
        lights: i.lights,
        prog: i.programs,
        res: `${i.width}×${i.height}`,
        gpuName: w.renderer.capabilities.gpu,
        clock: w.tod.clock,
        elev: w.tod.elevation,
        authored: c.authoredTriangles,
        instanced: c.instancedTriangles,
        buildings: c.buildings,
        cars: c.cars,
        lamps: c.lamps,
        trees: c.trees,
        meshes: c.instancedMeshes,
        size: c.size,
      });
      if (w.tod.timeScale > 0) setS((cur) => (Math.abs(cur.hour - w.tod.hour) > 0.004 ? { ...cur, hour: w.tod.hour } : cur));
    }, 300);
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener('resize', onResize);
      world?.dispose();
      worldRef.current = null;
      canvas.remove();
    };
  }, []);

  // persist + apply
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {
      /* storage unavailable (private mode) – settings just won't persist */
    }
    worldRef.current?.apply(s);
  }, [s, ready]);

  // shortcuts: H = hide panel, 1..6 = atmosphere presets
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      if (e.key === 'h' || e.key === 'H') setPanel((p) => !p);
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= PRESETS.length) {
        patch(PRESETS[n - 1].patch);
        say(PRESETS[n - 1].label);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [patch, say]);

  const shot = async () => {
    const w = worldRef.current;
    if (!w) return;
    try {
      download(await w.renderer.screenshot(w.scene, w.camera), `lumina-x-${Date.now()}.png`);
      say('Screenshot tersimpan');
    } catch (e) {
      say('Screenshot gagal: ' + (e as Error).message);
    }
  };

  const render = (it: Spec) => {
    const v = s[it.k];
    switch (it.kind) {
      case 'range':
        return <Slider key={it.k} label={it.label} value={v as number} min={it.min} max={it.max} step={it.step} hint={it.hint} fmt={it.fmt} onChange={(x) => set(it.k, x as never)} />;
      case 'toggle':
        return <Toggle key={it.k} label={it.label} hint={it.hint} value={v as boolean} onChange={(x) => set(it.k, x as never)} />;
      case 'color':
        return <ColorField key={it.k} label={it.label} value={v as string} onChange={(x) => set(it.k, x as never)} />;
      case 'select':
        return (
          <Select
            key={it.k}
            label={it.label}
            value={String(v)}
            options={it.options}
            onChange={(x) => set(it.k, (NUMERIC_SELECT.has(it.k) ? Number(x) : x) as never)}
          />
        );
    }
  };

  const fps = Number(stats.fps ?? 0);
  const modes: { label: string; value: CameraMode }[] = useMemo(
    () => [
      { label: '🎬 Sinematik', value: 'path' },
      { label: '🕊 Terbang', value: 'fly' },
      { label: '🌐 Orbit', value: 'orbit' },
    ],
    []
  );

  return (
    <div className="fixed inset-0 overflow-hidden bg-black text-slate-200 select-none">
      <div ref={hostRef} className="absolute inset-0" />

      {!ready && !error && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[radial-gradient(ellipse_at_center,#10182b,#04060c)]">
          <div className="text-[11px] tracking-[0.5em] text-sky-300/70">LUMINA</div>
          <div className="bg-gradient-to-r from-sky-300 via-white to-amber-200 bg-clip-text text-7xl font-black tracking-tight text-transparent">X</div>
          <div className="mt-6 h-1 w-72 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-gradient-to-r from-sky-400 to-amber-300 transition-all" style={{ width: `${Math.round(progress.p * 100)}%` }} />
          </div>
          <div className="mt-3 text-xs text-slate-400">{progress.label}</div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/80 p-6">
          <div className="max-w-md">
            <Note tone="error">
              <b>Gagal memulai Lumina X.</b>
              <br />
              {error}
              <br />
              Pastikan browser mendukung WebGL2 dan ekstensi float-texture (EXT_color_buffer_float).
            </Note>
          </div>
        </div>
      )}
      {lost && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70">
          <Note tone="warn">Konteks WebGL hilang – memulihkan…</Note>
        </div>
      )}

      {ready && (
        <>
          {/* title + clock + mode */}
          <div className="pointer-events-none absolute left-4 top-4 z-10 space-y-2">
            <div className="flex items-baseline gap-2 drop-shadow-lg">
              <span className="text-2xl font-black tracking-tight text-white">LUMINA</span>
              <span className="bg-gradient-to-r from-sky-300 to-amber-200 bg-clip-text text-3xl font-black text-transparent">X</span>
              <span className="ml-2 font-mono text-sm text-white/80">{String(stats.clock ?? '')}</span>
              <span className="font-mono text-[11px] text-white/50">{Number(stats.elev ?? 0).toFixed(0)}° elevasi</span>
            </div>
            <div className="pointer-events-auto w-[330px] rounded-xl bg-black/45 p-1 backdrop-blur">
              <Segmented label="" value={s.mode} options={modes} onChange={(m) => set('mode', m)} />
            </div>
          </div>

          {/* HUD */}
          {hud && (
            <div className="pointer-events-none absolute bottom-3 left-4 z-10 w-72 rounded-xl bg-black/50 p-3 text-[11px] backdrop-blur">
              <Stat k="FPS" v={fps.toFixed(0)} warn={fps < 30} />
              <Stat k="Frame" v={`${Number(stats.ms ?? 0).toFixed(1)} ms`} />
              <Stat k="GPU" v={Number(stats.gpu) > 0 ? `${Number(stats.gpu).toFixed(1)} ms` : 'n/a'} />
              <Stat k="Draw calls" v={String(stats.calls ?? 0)} />
              <Stat k="Segitiga digambar" v={fmtN(Number(stats.tris ?? 0))} />
              <Stat k="Gedung / mobil / lampu" v={`${stats.buildings} / ${stats.cars} / ${stats.lamps}`} />
              <Stat k="Segitiga unik (authored)" v={fmtN(Number(stats.authored ?? 0))} />
              <Stat k="Semua instance" v={fmtN(Number(stats.instanced ?? 0))} />
              <Stat k="Kota" v={`${Number(stats.size ?? 0) / 1000} × ${Number(stats.size ?? 0) / 1000} km`} />
              <Stat k="Resolusi" v={String(stats.res ?? '')} />
            </div>
          )}

          {toast && <div className="absolute left-1/2 top-6 z-20 -translate-x-1/2 rounded-full bg-black/70 px-4 py-1.5 text-xs backdrop-blur">{toast}</div>}

          <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-black/40 px-4 py-1 text-[10px] text-white/60 backdrop-blur">
            {s.mode === 'fly' ? 'W A S D gerak · Q/E turun/naik · Shift cepat · drag = lihat · roda = kecepatan' : s.mode === 'orbit' ? 'drag = putar · klik kanan = geser · roda = zoom' : 'Gerakan kamera sinematik – sentuh tombol/WASD untuk mengambil alih'} · H = panel · 1–6 = suasana
          </div>

          <button onClick={() => setPanel((p) => !p)} className="absolute right-3 top-3 z-20 rounded-lg bg-black/55 px-3 py-1.5 text-xs font-medium text-white backdrop-blur hover:bg-black/75">
            {panel ? 'Sembunyikan ›' : '‹ Pengaturan'}
          </button>

          {panel && (
            <aside className="absolute bottom-3 right-3 top-12 z-10 flex w-[350px] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl bg-slate-950/88 shadow-2xl ring-1 ring-white/10 backdrop-blur-xl">
              <div className="space-y-2 border-b border-white/5 p-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Suasana cepat</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {PRESETS.map((p, i) => (
                    <button key={p.id} title={p.hint} onClick={() => patch(p.patch)} className="rounded-lg bg-white/6 px-2 py-1.5 text-left text-[11px] font-medium text-slate-200 transition-colors hover:bg-sky-500/30">
                      <span className="mr-1 text-slate-500">{i + 1}</span>
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button onClick={shot}>📷 Screenshot</Button>
                  <Button onClick={() => setHud((h) => !h)}>{hud ? 'Sembunyikan HUD' : 'Tampilkan HUD'}</Button>
                  <Button
                    variant="danger"
                    onClick={() => {
                      setS({ ...DEFAULTS });
                      say('Pengaturan direset');
                    }}
                  >
                    Reset
                  </Button>
                </div>
              </div>
              <Tabs value={tab} tabs={TABS as unknown as { id: Tab; label: string }[]} onChange={setTab} />
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                {tab !== 'engine' &&
                  GROUPS[tab].map((g) => (
                    <Section key={g.title} title={g.title} defaultOpen={g.open}>
                      {g.note && <Note>{g.note}</Note>}
                      {g.items.map(render)}
                    </Section>
                  ))}
                {tab === 'engine' && (
                  <>
                    <Section title="Kualitas (preset)">
                      <Segmented
                        label="Preset"
                        value={s.quality}
                        options={(Object.keys(QUALITY_PATCH) as QualityId[]).map((q) => ({ label: q, value: q }))}
                        onChange={(q) => patch({ ...QUALITY_PATCH[q], quality: q })}
                      />
                      <Note>Preset mengubah nilai-nilai di bawah secara terlihat; tidak ada penurunan kualitas otomatis di balik layar.</Note>
                      <Slider label="Render scale" value={s.renderScale} min={0.4} max={1.5} step={0.05} onChange={(v) => set('renderScale', v)} fmt={pct} />
                      <Select label="MSAA" value={String(s.msaa)} options={[0, 2, 4].map((n) => ({ label: n === 0 ? 'Off (pakai TAA)' : n + '×', value: String(n) }))} onChange={(v) => set('msaa', Number(v))} />
                    </Section>
                    <Section title="Navigasi">
                      <Slider label="Kecepatan terbang" value={s.flySpeed} min={2} max={200} step={1} onChange={(v) => set('flySpeed', v)} fmt={(v) => v.toFixed(0) + ' m/s'} />
                      <Slider label="Kecepatan rel sinematik" value={s.pathSpeed} min={4} max={80} step={1} onChange={(v) => set('pathSpeed', v)} fmt={(v) => v.toFixed(0) + ' m/s'} />
                      <div className="flex flex-wrap gap-1.5">
                        <Button
                          onClick={() => {
                            const w = worldRef.current;
                            if (!w) return;
                            set('mode', 'fly');
                            const sz = w.city.stats.size;
                            w.teleport([0, sz * 0.36, sz * 0.54], [0, 20, 0]);
                          }}
                        >
                          Pandangan udara
                        </Button>
                        <Button
                          onClick={() => {
                            const w = worldRef.current;
                            if (!w) return;
                            set('mode', 'fly');
                            w.teleport(w.city.start.pos, w.city.start.look);
                          }}
                        >
                          Level jalan
                        </Button>
                      </div>
                    </Section>
                    <Section title="Tentang Lumina X" defaultOpen>
                      <Note>
                        Engine WebGL2 fotorealistik tanpa dependensi. Kota ini ({String(stats.buildings ?? 0)} gedung) digambar dari <b>{String(stats.meshes ?? 0)} mesh instanced</b> dan satu quad ground; jendela, curb, marka jalan dan lampu jendela adalah tekstur + relief parallax, bukan poligon. GPU: {String(stats.gpuName ?? '')}
                      </Note>
                    </Section>
                  </>
                )}
              </div>
            </aside>
          )}
        </>
      )}
    </div>
  );
}
