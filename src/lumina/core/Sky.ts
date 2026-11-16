import { Color } from '../math/Color';
import { DEG2RAD, smoothstep } from '../math/MathUtils';
import { Vector3 } from '../math/Vector3';

/** Atmospheric constants – shared by the GLSL sky shader and the CPU sun-colour model. */
export const ATMOSPHERE = {
  earthRadius: 6360e3,
  atmosphereRadius: 6420e3,
  rayleighScaleHeight: 7994,
  mieScaleHeight: 1200,
  betaRayleigh: [3.8e-6, 5.421e-6, 13.558e-6] as const,
  betaMie: 21e-6,
};

/**
 * Procedural physically-based atmosphere (single-scattering Rayleigh + Mie, Nishita style).
 * The renderer bakes it into an HDR cubemap which drives image based lighting, reflections,
 * fog colour and the background – so lighting always matches the visible sky.
 */
export class Sky {
  /** Unit vector pointing from the scene toward the sun. */
  readonly sunDirection = new Vector3(0, 1, 0);
  elevation = 45;
  azimuth = 135;
  /** Rayleigh scattering multiplier (blueness of the sky). */
  rayleigh = 1;
  /** Mie multiplier (haze / turbidity). */
  mie = 1;
  mieAnisotropy = 0.76;
  /** Irradiance of the sun at the top of the atmosphere (scene units). */
  sunIntensity = 22;
  /** Compensates the missing multiple scattering of the single scattering model. */
  scatteringBoost = 3.2;
  groundAlbedo = new Color(0.3, 0.28, 0.25);
  /** Angular size multiplier of the visible sun disk. */
  sunDiskScale = 1;
  /** Procedural cumulus layer: 0 = clear sky … 1 = overcast. */
  cloudCoverage = 0;
  /** Optical density multiplier (thicker = darker, more opaque). */
  cloudDensity = 1;
  /** Feature frequency multiplier (higher = smaller clouds). */
  cloudScale = 2.2;
  /** Wind drift in cloud-space units. Changing it never triggers an environment re-bake (only the visible clouds move). */
  readonly cloudOffset = { x: 0, y: 0 };
  /** Night sky: star field + Milky Way brightness (0 = off). Only visible while the sky is dark. */
  stars = 1;
  /** Moonlight multiplier (0 = off): after sunset the scene's directional light switches to a cool, dim moon. */
  moonLight = 1;
  /** Incremented whenever a parameter changes – the renderer rebakes the environment lazily. */
  version = 1;

  constructor() {
    this.setSun(this.elevation, this.azimuth);
  }

  setSun(elevationDeg: number, azimuthDeg: number): this {
    this.elevation = elevationDeg;
    this.azimuth = azimuthDeg;
    const e = elevationDeg * DEG2RAD,
      a = azimuthDeg * DEG2RAD;
    this.sunDirection.set(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a));
    this.version++;
    return this;
  }
  /** Call after changing rayleigh / mie / albedo… */
  touch(): void {
    this.version++;
  }

  /** Relative optical air mass (Kasten & Young 1989). */
  static airMass(elevationDeg: number): number {
    const zenith = Math.min(90 - elevationDeg, 90.5);
    return 1 / (Math.cos(zenith * DEG2RAD) + 0.50572 * Math.pow(96.07995 - zenith, -1.6364));
  }

  /** Colour/intensity of direct sunlight reaching the ground (irradiance, same units as the sky shader). */
  getSunLight(): { color: Color; intensity: number } {
    const m = Sky.airMass(this.elevation);
    const A = ATMOSPHERE;
    const tauM = A.betaMie * 1.1 * A.mieScaleHeight * this.mie;
    const c = new Color(
      Math.exp(-(A.betaRayleigh[0] * A.rayleighScaleHeight * this.rayleigh + tauM) * m),
      Math.exp(-(A.betaRayleigh[1] * A.rayleighScaleHeight * this.rayleigh + tauM) * m),
      Math.exp(-(A.betaRayleigh[2] * A.rayleighScaleHeight * this.rayleigh + tauM) * m)
    );
    // the sun disappears behind the horizon (earth shadow)
    const fade = smoothstep(-2.5, 0.8, this.elevation);
    // heavy cloud cover filters the direct sun (the sky dome keeps lighting the scene softly)
    const overcast = smoothstep(0.55, 1.0, this.cloudCoverage) * Math.min(1, this.cloudDensity);
    return { color: c, intensity: this.sunIntensity * fade * (1 - 0.8 * overcast) };
  }
}

/** Exponential height fog whose colour is sampled from the sky (aerial perspective). */
export class Fog {
  /** Extinction at `baseHeight` (1/m). 0.0015 ≈ 1 km visibility. */
  density: number;
  /** Exponential falloff with altitude (1/m). */
  heightFalloff: number;
  baseHeight = 0;
  /** Strength of the forward-scattering glow toward the sun. */
  sunScatter = 0.6;
  tint = new Color(1, 1, 1);
  constructor(density = 0.0015, heightFalloff = 0.02) {
    this.density = density;
    this.heightFalloff = heightFalloff;
  }
}
