import { DEG2RAD, smoothstep } from '../math/MathUtils';
import type { DirectionalLight } from './Lights';
import type { Sky } from './Sky';

/**
 * Lumina X – astronomical time-of-day driver.
 *
 * Converts a clock time + latitude + day of the year into the real solar position (declination, hour angle),
 * pushes it into a `Sky`, hands the key light to sun / moon (`DirectionalLight.syncWithSky`) and exposes
 * `night` / `lamps` factors (0 … 1) that apps use to switch street lamps, window emissives, neon …
 *
 *   const tod = new TimeOfDay(scene.sky, sun);
 *   tod.hour = 18.4; tod.timeScale = 0.05;      // 0.05 h of game time per real second
 *   loop: tod.update(dt);
 *
 * Re-baking the image-based lighting is the expensive part of a sky change, so the sky is only touched when the sun moved
 * by more than `minRebakeDegrees` – fast clocks stay smooth, a paused clock costs nothing.
 */
export class TimeOfDay {
  /** 0 … 24 */
  hour = 12;
  /** Degrees north (negative = south). */
  latitude = 35;
  /** 1 … 365 (172 ≈ June solstice, 355 ≈ December solstice). */
  dayOfYear = 172;
  /** Hours of simulated time per real second (0 = paused). */
  timeScale = 0;
  /** Rotates the whole compass (deg) so the sunset can face the street you want. */
  azimuthOffset = 0;
  /** The sky is only updated once the sun moved this far (deg) since the last update. */
  minRebakeDegrees = 0.2;

  /** Sun elevation above the horizon in degrees (read-only result of the last `apply()`). */
  elevation = 0;
  /** Compass-less sky azimuth in degrees (the value handed to `Sky.setSun`). */
  azimuth = 0;
  /** 0 = full daylight … 1 = night (civil twilight → dark). */
  night = 0;
  /** 0 … 1 – street lamps / window emissives: switch on around sunset, off after sunrise. */
  lamps = 0;

  private _lastE = Infinity;
  private _lastA = Infinity;

  constructor(public sky: Sky, public sun: DirectionalLight | null = null) {
    this.apply(true);
  }

  /** Advances the clock and re-applies the sun. */
  update(dt: number): void {
    if (this.timeScale !== 0) {
      this.hour = (((this.hour + dt * this.timeScale) % 24) + 24) % 24;
    }
    this.apply(false);
  }

  /** `HH:MM` for the UI. */
  get clock(): string {
    const h = ((this.hour % 24) + 24) % 24;
    let hh = Math.floor(h);
    let mm = Math.round((h - hh) * 60);
    if (mm === 60) {
      mm = 0;
      hh = (hh + 1) % 24;
    }
    return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  }

  /** Computes the solar position and applies it. `force` ignores `minRebakeDegrees`. */
  apply(force = true): void {
    const phi = this.latitude * DEG2RAD;
    // solar declination (Cooper's equation)
    const decl = 23.44 * DEG2RAD * Math.sin((2 * Math.PI * (284 + this.dayOfYear)) / 365);
    const H = (this.hour - 12) * 15 * DEG2RAD; // hour angle, + after noon
    const sinE = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H);
    const e = Math.asin(Math.max(-1, Math.min(1, sinE)));
    // azimuth measured clockwise from north; compass north is −Z, Sky azimuth 0 is +Z
    const A = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) + Math.PI;
    const skyAz = (180 - A / DEG2RAD + this.azimuthOffset + 720) % 360;
    this.elevation = e / DEG2RAD;
    this.azimuth = skyAz;
    this.night = 1 - smoothstep(-9, 3, this.elevation);
    this.lamps = 1 - smoothstep(-2, 8, this.elevation);

    const dA = Math.abs(((skyAz - this._lastA + 540) % 360) - 180);
    if (force || Math.abs(this.elevation - this._lastE) >= this.minRebakeDegrees || dA >= this.minRebakeDegrees) {
      this.sky.setSun(this.elevation, skyAz);
      this._lastE = this.elevation;
      this._lastA = skyAz;
    }
    this.sun?.syncWithSky(this.sky);
  }
}
