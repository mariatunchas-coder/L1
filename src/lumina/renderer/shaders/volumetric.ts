/**
 * Lumina X – Volumetric Fog X.
 *
 * Froxel-free ray marcher that integrates participating media along every camera ray at half resolution:
 *
 *  • exponential height fog + a separate ground-hugging mist layer,
 *  • animated 3D fbm density (wind-driven wisps, so light shafts show real structure instead of a flat haze),
 *  • sun in-scattering through the shadow cascades (god rays) with an analytic sun-column transmittance,
 *  • multiple scattering (Wrenninge octaves: attenuation a, contribution b, eccentricity c) → shadowed
 *    regions of the fog are never pitch black and thick fog glows like in real photographs,
 *  • sky ambient in-scattering (isotropic),
 *  • point / spot lights with inverse-square falloff, cone, Henyey-Greenstein phase and atlas shadows,
 *  • step distribution denser near the camera, interleaved-gradient jitter that changes every frame,
 *  • temporal accumulation (reprojection + 3×3 neighbourhood clamp) followed by a depth-aware bilateral blur.
 *
 * Output: rgb = in-scattered radiance, a = transmittance.
 */
export const volumetricFrag = /* glsl */ `
#include <common>
#include <ubo_camera>
#include <ubo_lights>

uniform sampler2D uTex0;         // full-res scene depth (bound to unit 0, see SAMPLER_UNITS)
// must be declared BEFORE <fog_shadow>, which samples it
uniform sampler2DArrayShadow uShadowMap; // unit 3, see SAMPLER_UNITS
#include <fog_shadow>
#include <local_shadow>
uniform vec4 uFogLocal;          // x = number of local lights evaluated, y = intensity
uniform vec2 uInvOutSize;        // 1 / (half-res) size
uniform float uDensity;          // extinction at base height (1/m)
uniform float uHeightFalloff;    // 1/m
uniform float uBaseHeight;
uniform float uAnisotropy;       // Henyey-Greenstein g, [-0.95, 0.95]
uniform float uIntensity;        // overall in-scatter multiplier
uniform float uMaxDistance;      // raymarch stops here even if the scene depth is farther
uniform int uSteps;
uniform vec4 uVolA;              // x = noise amount, y = noise frequency (1/m), zw = wind (m/s, xz)
uniform vec4 uVolB;              // x = time (s), y = multi-scatter 0..1, z = mist density (1/m), w = mist falloff (1/m)
uniform vec4 uVolC;              // rgb = sky ambient radiance, w = frame jitter offset
uniform vec4 uVolD;              // rgb = fog albedo, w = step distribution exponent

in vec2 vUv;
layout(location = 0) out vec4 fragColor; // rgb = in-scattered light, a = transmittance

float phaseHG(float cosTheta, float g) {
  float g2 = g * g;
  float d = 1.0 + g2 - 2.0 * g * cosTheta;
  return (1.0 - g2) / (4.0 * PI * max(d * sqrt(max(d, 1e-4)), 1e-4));
}

// Dave Hoskins hash (no sin → stable across GPUs)
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash13(i);
  float b = hash13(i + vec3(1.0, 0.0, 0.0));
  float c = hash13(i + vec3(0.0, 1.0, 0.0));
  float d = hash13(i + vec3(1.0, 1.0, 0.0));
  float e = hash13(i + vec3(0.0, 0.0, 1.0));
  float g = hash13(i + vec3(1.0, 0.0, 1.0));
  float h = hash13(i + vec3(0.0, 1.0, 1.0));
  float k = hash13(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
}

// Extinction at a world point: height fog + mist layer, modulated by drifting fbm wisps.
float densityAt(vec3 p) {
  float h = max(p.y - uBaseHeight, 0.0);
  float d = uDensity * exp(-uHeightFalloff * h) + uVolB.z * exp(-uVolB.w * h);
  if (uVolA.x > 0.001 && d > 1e-6) {
    vec3 q = (p + vec3(uVolA.z, 0.0, uVolA.w) * uVolB.x) * uVolA.y;
    float n = vnoise3(q) * 0.62 + vnoise3(q * 2.17 + 7.3) * 0.38;
    // mean ≈ 1: wisps thicker / thinner than the average, never negative
    d *= max(1.0 + uVolA.x * (n - 0.5) * 3.2, 0.0);
  }
  return d;
}

void main() {
  vec2 uv = gl_FragCoord.xy * uInvOutSize;
  float d = texture(uTex0, uv).r;
  vec4 clip = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec4 wp4 = uInvViewProj * clip;
  vec3 worldPos = wp4.xyz / wp4.w;

  vec3 camPos = uCamPos.xyz;
  vec3 toP = worldPos - camPos;
  float sceneDist = d >= 1.0 ? uMaxDistance : min(length(toP), uMaxDistance);
  vec3 rd = toP / max(length(toP), 1e-5);

  int steps = uSteps;
  float invSteps = 1.0 / float(steps);
  float noise = interleavedGradientNoise(gl_FragCoord.xy + uVolC.w * 5.588238);
  float cosTheta = dot(rd, uSunDir.xyz);
  float g = uAnisotropy;
  float multi = uVolB.y;

  // single + multiple scattering phase of the sun (Wrenninge: a = 0.5, b = 0.5, c = 0.5 per octave)
  float ph0 = phaseHG(cosTheta, g);
  float ph1 = phaseHG(cosTheta, g * 0.5);
  float ph2 = phaseHG(cosTheta, g * 0.25);

  // sun-column optical depth of the exponential height layers (analytic, per step it only needs the height)
  float sunSin = max(uSunDir.y, 0.06);
  float colK = uDensity / max(uHeightFalloff, 1e-4);
  float mistK = uVolB.z / max(uVolB.w, 1e-4);
  int nl = int(min(uEnvParams.z, uFogLocal.x));

  vec3 scatter = vec3(0.0);
  float transmittance = 1.0;
  float prevT = 0.0;
  for (int i = 0; i < 96; i++) {
    if (i >= steps) break;
    float f1 = float(i + 1) * invSteps;
    float t1 = sceneDist * pow(f1, uVolD.w);
    float stepLen = max(t1 - prevT, 1e-4);
    float t = prevT + stepLen * noise;
    prevT = t1;
    vec3 p = camPos + rd * t;
    float density = densityAt(p);
    if (density > 1e-6) {
      float viewZ = -(uView * vec4(p, 1.0)).z;
      float shadow = uShadowInfo.y > 0.5 ? fogShadowSample(p, viewZ) : 1.0;
      float h = max(p.y - uBaseHeight, 0.0);
      float tauSun = (colK * exp(-uHeightFalloff * h) + mistK * exp(-uVolB.w * h)) / sunSin;
      float tSun = exp(-tauSun);
      float stepT = exp(-density * stepLen);
      // single scattering vs three octaves of multiple scattering
      float singleS = ph0 * tSun;
      float multiS = ph0 * tSun + 0.5 * ph1 * exp(-tauSun * 0.5) + 0.25 * ph2 * exp(-tauSun * 0.25);
      vec3 inscatter = uSunColor.rgb * shadow * mix(singleS, multiS, multi) * uIntensity;
      // sky ambient (isotropic phase 1/4π), a little brighter in the thinner, higher air
      inscatter += uVolC.rgb * (0.25 * INV_PI) * (0.6 + 0.4 * exp(-h * 0.02)) * uIntensity;
      // point / spot lights: inverse-square falloff, cone, phase function and (when they own a shadow layer) occlusion → god rays
      for (int li = 0; li < 12; li++) {
        if (li >= nl) break;
        vec4 pt = uLights[li].posType;
        vec4 cr = uLights[li].colorRange;
        vec3 Lv = pt.xyz - p;
        float d2 = dot(Lv, Lv);
        float dist = sqrt(d2);
        vec3 L = Lv / max(dist, 1e-4);
        float att = 1.0 / max(d2, 0.25);
        if (cr.w > 0.0) {
          float r2 = d2 / (cr.w * cr.w);
          float win = saturate(1.0 - r2 * r2);
          att *= win * win;
        }
        if (pt.w > 1.5) {
          float cd = dot(-L, uLights[li].dirAngle.xyz);
          float sp = saturate((cd - uLights[li].dirAngle.w) * uLights[li].spot.x);
          att *= sp * sp;
        }
        if (att > 1e-4) {
          float vis = localShadowFactor(li, p, vec3(0.0), L, dist, noise * TWO_PI, 1);
          float lp = phaseHG(dot(rd, L), g * 0.5);
          // a light's own scattering is attenuated by the fog between it and the sample (cheap: average density)
          float lt = exp(-min(dist, 60.0) * density * 0.35);
          inscatter += cr.rgb * (att * vis * lp * lt * uFogLocal.y * uIntensity);
        }
      }
      inscatter *= uVolD.rgb;
      scatter += transmittance * inscatter * (1.0 - stepT);
      transmittance *= stepT;
    }
  }
  scatter = min(scatter, vec3(2.0e3));
  fragColor = vec4(scatter, transmittance);
}
`;

/**
 * Temporal accumulation of the half-resolution fog: the previous result is reprojected with the previous
 * view-projection matrix at the surface / far-plane point of the ray, clamped to the 3×3 neighbourhood of the
 * new sample (kills ghosting) and blended. The per-frame jitter of the ray march turns into smooth, noise-free
 * shafts after a few frames.
 */
export const volumetricTemporalFrag = /* glsl */ `
#include <common>
#include <ubo_camera>
uniform sampler2D uTex0;   // full-res depth
uniform sampler2D uTex1;   // this frame's fog
uniform sampler2D uTex2;   // history
uniform vec2 uInvOutSize;
uniform vec4 uTemporal;    // x = history weight, y = max distance, z = history valid
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec2 uv = vUv;
  vec4 cur = texture(uTex1, uv);
  if (uTemporal.z < 0.5 || uTemporal.x <= 0.0) { fragColor = cur; return; }
  vec4 mn = cur, mx = cur;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec4 s = texture(uTex1, uv + vec2(float(i), float(j)) * uInvOutSize);
      mn = min(mn, s);
      mx = max(mx, s);
    }
  }
  float d = texture(uTex0, uv).r;
  vec4 wp4 = uInvViewProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec3 P = wp4.xyz / wp4.w;
  vec3 toP = P - uCamPos.xyz;
  float len = length(toP);
  vec3 rd = toP / max(len, 1e-5);
  float dist = d >= 1.0 ? uTemporal.y : min(len, uTemporal.y);
  vec4 pc = uPrevViewProj * vec4(uCamPos.xyz + rd * dist, 1.0);
  if (pc.w <= 1e-4) { fragColor = cur; return; }
  vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
  if (puv.x < 0.0 || puv.x > 1.0 || puv.y < 0.0 || puv.y > 1.0) { fragColor = cur; return; }
  vec4 h = texture(uTex2, puv);
  vec4 range = mx - mn;
  h = clamp(h, mn - range * 0.25, mx + range * 0.25);
  float motion = length((puv - uv) / uInvOutSize);          // half-res pixels
  float w = uTemporal.x * (1.0 - 0.6 * clamp(motion / 10.0, 0.0, 1.0));
  fragColor = mix(cur, h, w);
}
`;

export const volumetricBlurFrag = /* glsl */ `
uniform sampler2D uTex0;   // depth (full-res)
uniform sampler2D uTex1;   // half-res fog (rgb scatter, a transmittance)
uniform vec2 uDir;         // texel step, half-res space
uniform vec2 uNearFar;
in vec2 vUv;
out vec4 fragColor;
float linZ(float d) {
  float z = d * 2.0 - 1.0;
  return 2.0 * uNearFar.x * uNearFar.y / (uNearFar.y + uNearFar.x - z * (uNearFar.y - uNearFar.x));
}
void main() {
  float zc = linZ(texture(uTex0, vUv).r);
  vec4 sum = texture(uTex1, vUv);
  float wsum = 1.0;
  for (int i = -3; i <= 3; i++) {
    if (i == 0) continue;
    vec2 uv = vUv + uDir * float(i);
    float zs = linZ(texture(uTex0, uv).r);
    float dz = abs(zs - zc) / max(zc, 1e-3);
    float w = exp(-float(i * i) * 0.15) * exp(-dz * dz * 4000.0);
    sum += texture(uTex1, uv) * w;
    wsum += w;
  }
  fragColor = sum / wsum;
}
`;
