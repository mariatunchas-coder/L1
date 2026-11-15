import type { QualityLevel } from './Quality';

export interface DeviceProfile {
  /** Phone / tablet class device (touch + mobile GPU). */
  mobile: boolean;
  /** Overall GPU class used to pick presets. */
  tier: 'low' | 'medium' | 'high';
  gpu: string;
  /** 0.3 … 1 – multiplier for geometry segment counts of procedural primitives. */
  geometryDetail: number;
  /** Highest sensible device-pixel-ratio. */
  pixelRatioCap: number;
  /** Quality preset recommended for this device. */
  preset: QualityLevel;
  /** MSAA sample count recommended for this device. */
  msaa: number;
  /** Why the tier was chosen (for the UI / logs). */
  reasons: string[];
}

const MOBILE_GPU = /(adreno|mali|powervr|apple gpu|immortalis|tegra|videocore|xclipse|maleoon|sgx)/i;
const SOFTWARE_GPU = /(swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic)/i;
// entry / mid-range mobile GPUs: Adreno 3xx-6xx (≤ 640), Mali-4xx/T/G3x/G5x, PowerVR
const WEAK_MOBILE = /(adreno\s*\(?tm\)?\s*([2-5]\d\d|6[0-3]\d)|mali-?(4|t|g3|g5[0-2])|powervr|sgx|videocore|mali-g(6[0-9]|7[0-1])\b)/i;

function probeGpuName(): string {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return 'unknown';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? (gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string) : (gl.getParameter(gl.RENDERER) as string);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Detects phones / weak GPUs *before* anything heavy is built, so geometry density, MSAA, SSGI and the quality preset
 * can be reduced automatically (a 3 M triangle scene with 4× MSAA + SSGI runs at ~15 fps on an Adreno 610).
 * Pass the renderer's `capabilities.gpu` string when you already have a context.
 */
export function detectDevice(gpuName?: string): DeviceProfile {
  const gpu = gpuName && gpuName !== 'unknown' ? gpuName : probeGpuName();
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { userAgentData?: { mobile?: boolean }; deviceMemory?: number }) : null;
  const ua = nav?.userAgent ?? '';
  const reasons: string[] = [];
  const touch = typeof window !== 'undefined' && ('ontouchstart' in window || (nav?.maxTouchPoints ?? 0) > 1);
  const smallScreen = typeof screen !== 'undefined' && Math.min(screen.width, screen.height) <= 820;
  let mobile = !!nav?.userAgentData?.mobile || /android|iphone|ipad|ipod|mobile|silk/i.test(ua);
  if (!mobile && touch && smallScreen && MOBILE_GPU.test(gpu)) mobile = true;
  if (MOBILE_GPU.test(gpu) && !/(apple m\d|apple gpu.*(m1|m2|m3))/i.test(gpu) && (touch || smallScreen)) mobile = true;
  if (mobile) reasons.push('mobile device');

  const mem = nav?.deviceMemory ?? 8;
  const cores = nav?.hardwareConcurrency ?? 8;
  let tier: DeviceProfile['tier'] = mobile ? 'medium' : 'high';
  if (SOFTWARE_GPU.test(gpu)) {
    tier = 'low';
    reasons.push('software renderer');
  } else if (mobile && (WEAK_MOBILE.test(gpu) || mem <= 3 || cores <= 4)) {
    tier = 'low';
    reasons.push(WEAK_MOBILE.test(gpu) ? 'entry-level mobile GPU (' + gpu + ')' : 'low memory / few cores');
  } else if (!mobile && (mem <= 2 || cores <= 2)) {
    tier = 'medium';
    reasons.push('low-end desktop');
  }
  if (!reasons.length) reasons.push('desktop-class GPU');

  const geometryDetail = tier === 'low' ? 0.3 : tier === 'medium' ? 0.55 : 1;
  const preset: QualityLevel = tier === 'low' ? 'low' : tier === 'medium' ? 'medium' : 'high';
  return {
    mobile,
    tier,
    gpu,
    geometryDetail,
    pixelRatioCap: tier === 'high' ? 2 : tier === 'medium' ? 1.5 : 1.25,
    preset,
    msaa: tier === 'high' ? 4 : tier === 'medium' ? 2 : 0,
    reasons,
  };
}
