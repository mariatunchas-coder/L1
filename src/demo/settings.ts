import type { ToneMapping } from '../lumina';

export type CameraMode = 'fly' | 'path' | 'orbit';

export interface Settings {
  // ── time & sky ──
  hour: number;
  timeScale: number;
  latitude: number;
  dayOfYear: number;
  azimuthOffset: number;
  clouds: number;
  cloudDensity: number;
  cloudScale: number;
  cloudDrift: number;
  stars: number;
  moon: number;
  // ── weather ──
  rain: boolean;
  rainIntensity: number;
  rainWind: number;
  wetness: number;
  // ── analytic atmosphere fog ──
  fog: number; // ×1e-4
  fogHeight: number;
  // ── volumetric fog X ──
  volFog: boolean;
  volDensity: number; // ×1e-3
  volHeightFalloff: number;
  volBase: number;
  volAnisotropy: number;
  volIntensity: number;
  volMax: number;
  volSteps: number;
  volStepExp: number;
  volNoise: number;
  volNoiseScale: number;
  volWind: number;
  volWindDir: number;
  volMulti: number;
  volMist: number; // ×1e-3
  volMistFalloff: number;
  volAmbient: number;
  volTemporal: number;
  volLocal: boolean;
  volLocalIntensity: number;
  volAlbedo: string;
  // ── lighting & shadows ──
  pcss: boolean;
  penumbra: number;
  shadowDistance: number;
  cascades: number;
  shadowSize: number;
  localShadows: boolean;
  microShadow: number;
  ssgi: boolean;
  ssgiIntensity: number;
  ssgiRays: number;
  ssgiBounce: boolean;
  ssgiCache: boolean;
  ssao: boolean;
  gtaoIntensity: number;
  gtaoRadius: number;
  ssr: boolean;
  ssrIntensity: number;
  ssrSteps: number;
  contact: boolean;
  // ── surfaces ──
  pom: boolean;
  pomQuality: number;
  decals: boolean;
  lampIntensity: number;
  windowGlow: number;
  // ── camera & lens ──
  fov: number;
  autoExposure: boolean;
  exposure: number;
  ev: number;
  centerWeight: number;
  tone: ToneMapping;
  bloom: boolean;
  bloomIntensity: number;
  bloomEnergy: boolean;
  halation: number;
  lensDirt: number;
  flare: boolean;
  flareIntensity: number;
  vignette: number;
  opticalVignette: number;
  chroma: number;
  grain: number;
  dof: boolean;
  dofFocus: number;
  dofFStop: number;
  mb: boolean;
  mbIntensity: number;
  taa: boolean;
  sharpen: number;
  saturation: number;
  contrast: number;
  temperature: number;
  look: string;
  // ── engine ──
  quality: QualityId;
  renderScale: number;
  msaa: number;
  // ── navigation ──
  mode: CameraMode;
  flySpeed: number;
  pathSpeed: number;
}

export const DEFAULTS: Settings = {
  hour: 17.7,
  timeScale: 0,
  latitude: 35,
  dayOfYear: 172,
  azimuthOffset: 0,
  clouds: 0.28,
  cloudDensity: 0.9,
  cloudScale: 2.2,
  cloudDrift: 0.01,
  stars: 1,
  moon: 1,
  rain: false,
  rainIntensity: 0.6,
  rainWind: 0.25,
  wetness: 0,
  fog: 3,
  fogHeight: 0.012,
  volFog: true,
  volDensity: 3.2,
  volHeightFalloff: 0.012,
  volBase: 0,
  volAnisotropy: 0.62,
  volIntensity: 1.25,
  volMax: 520,
  volSteps: 40,
  volStepExp: 1.6,
  volNoise: 0.45,
  volNoiseScale: 0.02,
  volWind: 1.5,
  volWindDir: 35,
  volMulti: 0.7,
  volMist: 2.2,
  volMistFalloff: 0.14,
  volAmbient: 1,
  volTemporal: 0.85,
  volLocal: true,
  volLocalIntensity: 1,
  volAlbedo: '#ffffff',
  pcss: true,
  penumbra: 0.02,
  shadowDistance: 420,
  cascades: 4,
  shadowSize: 2048,
  localShadows: true,
  microShadow: 0.6,
  ssgi: true,
  ssgiIntensity: 1.2,
  ssgiRays: 1,
  ssgiBounce: true,
  ssgiCache: true,
  ssao: true,
  gtaoIntensity: 1,
  gtaoRadius: 0.9,
  ssr: true,
  ssrIntensity: 1,
  ssrSteps: 64,
  contact: true,
  pom: true,
  pomQuality: 1,
  decals: true,
  lampIntensity: 1100,
  windowGlow: 1.5,
  fov: 58,
  autoExposure: true,
  exposure: 1,
  ev: 0,
  centerWeight: 0.6,
  tone: 'agx',
  bloom: true,
  bloomIntensity: 0.16,
  bloomEnergy: false,
  halation: 0.25,
  lensDirt: 0.25,
  flare: false,
  flareIntensity: 0.04,
  vignette: 0.3,
  opticalVignette: 0.35,
  chroma: 0.0015,
  grain: 0.06,
  dof: false,
  dofFocus: 40,
  dofFStop: 2.8,
  mb: false,
  mbIntensity: 0.4,
  taa: true,
  sharpen: 0.25,
  saturation: 1.05,
  contrast: 1.03,
  temperature: 0.05,
  look: 'none',
  quality: 'ultra',
  renderScale: 1,
  msaa: 0,
  mode: 'path',
  flySpeed: 22,
  pathSpeed: 20,
};

export const LOOKS: Record<string, { slope: [number, number, number]; offset: [number, number, number]; power: [number, number, number] } | null> = {
  none: null,
  'teal-orange': { slope: [1.08, 1.0, 0.9], offset: [0.01, 0.0, 0.02], power: [1.0, 1.0, 1.04] },
  'bleach-bypass': { slope: [1.05, 1.05, 1.05], offset: [-0.015, -0.015, -0.015], power: [0.88, 0.9, 0.92] },
  'noir-blue': { slope: [0.92, 1.0, 1.12], offset: [0.0, 0.005, 0.02], power: [1.05, 1.0, 0.95] },
  'warm-film': { slope: [1.1, 1.02, 0.88], offset: [0.015, 0.005, -0.01], power: [0.96, 1.0, 1.06] },
};

export interface Preset {
  id: string;
  label: string;
  hint: string;
  patch: Partial<Settings>;
}

export const PRESETS: Preset[] = [
  {
    id: 'golden',
    label: 'Golden Hour',
    hint: 'Matahari rendah, god rays di antara gedung',
    patch: { hour: 17.7, clouds: 0.28, rain: false, wetness: 0, volFog: true, volDensity: 3.2, volMist: 2.2, volIntensity: 1.25, volAnisotropy: 0.62, look: 'warm-film', tone: 'agx', ev: 0 },
  },
  {
    id: 'noon',
    label: 'Siang Cerah',
    hint: 'Langit biru, bayangan tajam, haze tipis',
    patch: { hour: 12.2, clouds: 0.25, rain: false, wetness: 0, volFog: true, volDensity: 0.9, volMist: 0.4, volIntensity: 0.9, volAnisotropy: 0.55, look: 'none', ev: 0 },
  },
  {
    id: 'dawn',
    label: 'Fajar Berkabut',
    hint: 'Kabut tebal, berkas cahaya lembut',
    patch: { hour: 6.1, clouds: 0.4, rain: false, wetness: 0.2, volFog: true, volDensity: 6.5, volMist: 6, volMistFalloff: 0.08, volIntensity: 1.5, volAnisotropy: 0.7, volNoise: 0.6, look: 'warm-film', ev: 0.3 },
  },
  {
    id: 'blue',
    label: 'Blue Hour',
    hint: 'Senja biru, lampu kota menyala',
    patch: { hour: 19.55, clouds: 0.35, rain: false, wetness: 0.15, volFog: true, volDensity: 3.6, volMist: 2.6, volIntensity: 1.3, look: 'teal-orange', ev: 0.2 },
  },
  {
    id: 'night',
    label: 'Malam Hujan Neon',
    hint: 'Hujan, aspal basah, kolam lampu & kabut',
    patch: { hour: 22.5, clouds: 0.6, rain: true, rainIntensity: 0.75, wetness: 0.9, volFog: true, volDensity: 4.2, volMist: 3.2, volIntensity: 1.6, volAnisotropy: 0.55, volLocalIntensity: 1.4, look: 'noir-blue', windowGlow: 2, ev: 0.4 },
  },
  {
    id: 'storm',
    label: 'Badai Sore',
    hint: 'Mendung pekat, hujan deras, kabut rendah',
    patch: { hour: 16.2, clouds: 0.95, cloudDensity: 1.4, rain: true, rainIntensity: 1, rainWind: 0.5, wetness: 1, volFog: true, volDensity: 7, volMist: 5, volIntensity: 1.3, volAnisotropy: 0.35, look: 'bleach-bypass', ev: 0.2 },
  },
];

export type QualityId = 'low' | 'medium' | 'high' | 'ultra' | 'photo';
/** Quality presets expressed as Settings patches (the UI shows the result, nothing is hidden). */
export const QUALITY_PATCH: Record<QualityId, Partial<Settings>> = {
  low: { ssgi: false, ssr: false, ssao: false, taa: false, contact: false, shadowSize: 1024, cascades: 2, renderScale: 0.75, flare: false, mb: false, localShadows: false, pomQuality: 0.5, ssrSteps: 32, volSteps: 16, msaa: 0, sharpen: 0, volTemporal: 0.8 },
  medium: { ssgi: false, ssr: false, ssao: true, taa: false, contact: false, shadowSize: 2048, cascades: 3, renderScale: 1, flare: false, mb: false, localShadows: true, pomQuality: 0.7, ssrSteps: 48, volSteps: 24, msaa: 2, sharpen: 0 },
  high: { ssgi: false, ssr: true, ssao: true, taa: true, contact: true, shadowSize: 2048, cascades: 3, renderScale: 1, flare: false, mb: false, localShadows: true, pomQuality: 1, ssrSteps: 64, volSteps: 32, msaa: 0, sharpen: 0.25 },
  ultra: { ssgi: true, ssgiRays: 1, ssr: true, ssao: true, taa: true, contact: true, shadowSize: 2048, cascades: 4, renderScale: 1, flare: false, mb: false, localShadows: true, pomQuality: 1, ssrSteps: 96, volSteps: 40, msaa: 0, sharpen: 0.25 },
  photo: { ssgi: true, ssgiRays: 2, ssr: true, ssao: true, taa: true, contact: true, shadowSize: 4096, cascades: 4, renderScale: 1, flare: true, mb: false, localShadows: true, pomQuality: 1, ssrSteps: 128, volSteps: 64, msaa: 0, sharpen: 0.3 },
};

export const STORAGE_KEY = 'lumina.x.settings.v1';

export function sanitize(raw: unknown): Settings {
  const out: Settings = { ...DEFAULTS };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    const d = DEFAULTS[k];
    const v = r[k];
    if (typeof d === 'number' && typeof v === 'number' && Number.isFinite(v)) (out[k] as number) = v;
    else if (typeof d === 'boolean' && typeof v === 'boolean') (out[k] as boolean) = v;
    else if (typeof d === 'string' && typeof v === 'string') (out[k] as string) = v;
  }
  if (!(out.look in LOOKS)) out.look = 'none';
  if (!(out.quality in QUALITY_PATCH)) out.quality = 'ultra';
  if (!['fly', 'path', 'orbit'].includes(out.mode)) out.mode = 'path';
  if (!['none', 'reinhard', 'aces', 'neutral', 'filmic', 'agx'].includes(out.tone)) out.tone = 'agx';
  return out;
}

export function loadSettings(): Settings {
  let s = { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) s = sanitize(JSON.parse(raw));
  } catch {
    /* storage unavailable or corrupt – fall back to defaults */
  }
  // ?s={"hour":22,"rain":true} – share / test a configuration through the URL
  try {
    const q = new URLSearchParams(window.location.search).get('s');
    if (q) s = sanitize({ ...s, ...JSON.parse(q) });
  } catch {
    /* ignore malformed query */
  }
  return s;
}
