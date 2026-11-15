import { useEffect, useRef, useState } from 'react';
import { Section, Segmented, Slider, Stat, Toggle } from './components/ui';
import { createShowcase, type Showcase } from './demo/buildScene';
import type { ToneMapping } from './lumina';

interface Settings {
  elevation: number;
  azimuth: number;
  fog: number;
  exposure: number;
  autoExposure: boolean;
  tone: ToneMapping;
  bloom: boolean;
  bloomIntensity: number;
  ssao: boolean;
  shadows: boolean;
  shadowSize: number;
  cascades: number;
  softness: number;
  msaa: number;
  scale: number;
  dynRes: boolean;
  instances: number;
  animate: boolean;
  autoRotate: boolean;
  vignette: number;
  grain: number;
  saturation: number;
  contrast: number;
  chroma: number;
  volFog: boolean;
  volFogDensity: number;
  volFogHeightFalloff: number;
  volFogAnisotropy: number;
  volFogIntensity: number;
}

const DEFAULTS: Settings = {
  elevation: 38,
  azimuth: 140,
  fog: 1.7,
  exposure: 1,
  autoExposure: true,
  tone: 'aces',
  bloom: true,
  bloomIntensity: 0.12,
  ssao: true,
  shadows: true,
  shadowSize: 2048,
  cascades: 3,
  softness: 1.6,
  msaa: 4,
  scale: 1,
  dynRes: false,
  instances: 1500,
  animate: true,
  autoRotate: false,
  vignette: 0.28,
  grain: 0.08,
  saturation: 1.06,
  contrast: 1.04,
  chroma: 0,
  volFog: false,
  volFogDensity: 0.02,
  volFogHeightFalloff: 0.05,
  volFogAnisotropy: 0.6,
  volFogIntensity: 1,
};

const PRESETS = [
  { name: 'Siang', e: 52, a: 140 },
  { name: 'Sore', e: 14, a: 120 },
  { name: 'Golden hour', e: 4.5, a: 100 },
  { name: 'Senja', e: -0.8, a: 95 },
];

const fmtN = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n)));

const SNIPPET = `import { Renderer, Scene, PerspectiveCamera, Mesh,
  SphereGeometry, PBRMaterial, DirectionalLight,
  Sky, OrbitControls } from './lumina';

const renderer = new Renderer({ canvas, samples: 4 });
const scene = new Scene();
scene.sky = new Sky();                 // atmosfer fisik + IBL

const sun = new DirectionalLight();
sun.syncWithSky(scene.sky);            // warna & arah dari langit
scene.add(sun);

scene.add(new Mesh(
  new SphereGeometry(1),
  new PBRMaterial({ metalness: 1, roughness: 0.2,
                    clearcoat: 1 })));

renderer.render(scene, camera);`;

const FEATURES = [
  ['PBR Cook-Torrance', 'GGX + Smith height-correlated, multi-scatter energy compensation, clear-coat'],
  ['IBL dari atmosfer fisik', 'Rayleigh/Mie dibake ke cubemap HDR → irradiance, prefilter GGX, BRDF LUT'],
  ['Cascaded Shadow Maps', '1–4 cascade, texel snapping, blending, PCF Vogel 16-tap + normal offset'],
  ['SSAO + Multi-bounce AO', 'Half-res, depth-aware blur, specular occlusion'],
  ['Pipeline HDR', 'RGBA16F + MSAA, bloom progresif (Karis), auto-exposure GPU, ACES / Neutral'],
  ['Specular anti-aliasing', 'Tokuyoshi–Kaplanyan: tidak ada kilau berkedip pada normal map'],
  ['Volumetric fog', 'Raymarch terhadap cascade shadow, Henyey-Greenstein phase function, half-res + bilateral upsample'],
  ['Performa', 'GPU instancing, frustum culling, state cache, UBO, sorting, dirty-flag matrix, dynamic resolution'],
];

export default function App() {
  const hostRef = useRef<HTMLDivElement>(null);
  const showRef = useRef<Showcase | null>(null);
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [progress, setProgress] = useState({ p: 0, label: 'Memulai…' });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<string, number | string>>({});
  const [panel, setPanel] = useState(true);
  const [about, setAbout] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const downRef = useRef({ x: 0, y: 0, t: 0 });

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
        calls: i.calls,
        tris: i.triangles,
        vis: i.visible,
        cull: i.culled,
        sh: i.shadowCalls,
        prog: i.programs,
        lights: i.lights,
        res: `${i.width}×${i.height}`,
        tex: i.textures,
        gpu: r.capabilities.gpu,
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
  }, [s, ready]);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((o) => ({ ...o, [k]: v }));

  const onPointerDown = (e: React.PointerEvent) => {
    downRef.current = { x: e.clientX, y: e.clientY, t: performance.now() };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = downRef.current;
    if (e.button !== 0 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4 || performance.now() - d.t > 400) return;
    const sh = showRef.current;
    if (!sh) return;
    const name = sh.pick((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    setPicked(name);
    if (name) setTimeout(() => setPicked((c) => (c === name ? null : c)), 2600);
  };

  const fps = Number(stats.fps ?? 0);

  return (
    <div className="fixed inset-0 overflow-hidden bg-slate-950 font-sans text-slate-200 select-none">
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
            <div className="text-[10px] uppercase tracking-[0.2em] text-slate-300/80 drop-shadow">WebGL2 · PBR · Realtime</div>
          </div>
        </div>
      </div>

      <div className="absolute right-5 top-4 z-10 flex gap-2">
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
          <Stat k="Draw calls" v={String(stats.calls ?? 0)} />
          <Stat k="Segitiga" v={fmtN(Number(stats.tris ?? 0))} />
          <Stat k="Terlihat / di-cull" v={`${stats.vis ?? 0} / ${stats.cull ?? 0}`} />
          <Stat k="Shadow draws" v={String(stats.sh ?? 0)} />
          <Stat k="Lampu · program" v={`${stats.lights ?? 0} · ${stats.prog ?? 0}`} />
          <Stat k="Resolusi internal" v={String(stats.res ?? '')} />
          <div className="mt-1 truncate text-[10px] text-slate-500" title={String(stats.gpu ?? '')}>
            {String(stats.gpu ?? '')}
          </div>
        </div>
      )}

      {picked && (
        <div className="pointer-events-none absolute bottom-6 left-1/2 z-10 -translate-x-1/2 rounded-full bg-slate-950/80 px-4 py-2 text-xs text-slate-100 ring-1 ring-sky-400/40 backdrop-blur">
          ◎ {picked}
        </div>
      )}
      {ready && !picked && (
        <div className="pointer-events-none absolute bottom-5 left-1/2 z-10 hidden -translate-x-1/2 text-[11px] text-white/70 drop-shadow md:block">
          Drag: putar · Klik kanan / Shift+drag: geser · Scroll: zoom · Klik objek: fokus
        </div>
      )}

      {/* control panel */}
      {panel && ready && (
        <div className="absolute bottom-4 right-5 top-16 z-10 w-72 overflow-y-auto rounded-2xl bg-slate-950/75 ring-1 ring-white/10 backdrop-blur-md [scrollbar-width:thin]">
          <Section title="Langit & waktu">
            <div className="grid grid-cols-2 gap-1.5">
              {PRESETS.map((p) => (
                <button key={p.name} onClick={() => setS((o) => ({ ...o, elevation: p.e, azimuth: p.a }))} className="rounded-md bg-white/5 py-1.5 text-[11px] font-medium text-slate-300 hover:bg-sky-500/30 hover:text-white">
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
                <Slider label="Arah hamburan" hint="negatif = ke arah kamera" value={s.volFogAnisotropy} min={-0.9} max={0.9} step={0.01} onChange={(v) => set('volFogAnisotropy', v)} />
                <Slider label="Intensitas sinar" value={s.volFogIntensity} min={0} max={4} step={0.05} onChange={(v) => set('volFogIntensity', v)} />
              </>
            )}
          </Section>

          <Section title="Kamera & tone mapping">
            <Toggle label="Auto exposure" hint="adaptasi mata" value={s.autoExposure} onChange={(v) => set('autoExposure', v)} />
            <Slider label="Kompensasi exposure" value={s.exposure} min={0.25} max={3} step={0.01} onChange={(v) => set('exposure', v)} fmt={(v) => '×' + v.toFixed(2)} />
            <Segmented label="Tone mapper" value={s.tone} options={[{ label: 'ACES', value: 'aces' }, { label: 'Neutral', value: 'neutral' }, { label: 'Reinhard', value: 'reinhard' }, { label: 'Linear', value: 'none' }]} onChange={(v) => set('tone', v as ToneMapping)} />
            <Toggle label="Bloom" value={s.bloom} onChange={(v) => set('bloom', v)} />
            <Slider label="Intensitas bloom" value={s.bloomIntensity} min={0} max={0.6} step={0.005} onChange={(v) => set('bloomIntensity', v)} />
          </Section>

          <Section title="Color grading" defaultOpen={false}>
            <Slider label="Saturasi" value={s.saturation} min={0} max={2} onChange={(v) => set('saturation', v)} />
            <Slider label="Kontras" value={s.contrast} min={0.7} max={1.5} onChange={(v) => set('contrast', v)} />
            <Slider label="Vignette" value={s.vignette} min={0} max={1} onChange={(v) => set('vignette', v)} />
            <Slider label="Film grain" value={s.grain} min={0} max={0.5} onChange={(v) => set('grain', v)} />
            <Slider label="Chromatic aberration" value={s.chroma} min={0} max={0.01} step={0.0002} onChange={(v) => set('chroma', v)} fmt={(v) => (v * 1000).toFixed(1)} />
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
          </Section>
        </div>
      )}

      {/* about modal */}
      {about && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setAbout(false)}>
          <div className="max-h-full w-full max-w-3xl overflow-y-auto rounded-2xl bg-slate-900 p-6 ring-1 ring-white/10" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold text-white">Lumina Engine</h2>
                <p className="text-sm text-slate-400">Library rendering WebGL2 ala three.js — fokus pada performa dan realisme fisik. Seluruh kode ada di <code className="text-sky-300">src/lumina/</code>.</p>
              </div>
              <button onClick={() => setAbout(false)} className="rounded-md px-2 py-1 text-slate-400 hover:bg-white/10 hover:text-white">✕</button>
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
