/**
 * Volumetric (froxel-free) fog: raymarches the camera ray against the shadow
 * cascades to produce light shafts, then composites as in-scatter + transmittance
 * on top of the scene. Rendered at half resolution with a depth-aware bilateral
 * upsample, mirroring the SSAO pass.
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

in vec2 vUv;
layout(location = 0) out vec4 fragColor; // rgb = in-scattered light, a = transmittance

float phaseHG(float cosTheta, float g) {
  float g2 = g * g;
  float d = 1.0 + g2 - 2.0 * g * cosTheta;
  return (1.0 - g2) / (4.0 * PI * max(d * sqrt(max(d, 1e-4)), 1e-4));
}

// Exponential height-fog density at a world point (matches the analytic fog's model).
float densityAt(vec3 p) {
  return uDensity * exp(-uHeightFalloff * max(p.y - uBaseHeight, 0.0));
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
  float stepLen = sceneDist / float(steps);
  float noise = interleavedGradientNoise(gl_FragCoord.xy);
  float cosTheta = dot(rd, uSunDir.xyz);
  float phase = phaseHG(cosTheta, uAnisotropy);

  vec3 scatter = vec3(0.0);
  float transmittance = 1.0;
  for (int i = 0; i < 64; i++) {
    if (i >= steps) break;
    float t = stepLen * (float(i) + noise);
    vec3 p = camPos + rd * t;
    float density = densityAt(p);
    if (density > 1e-6) {
      float viewZ = -(uView * vec4(p, 1.0)).z;
      float shadow = uShadowInfo.y > 0.5 ? fogShadowSample(p, viewZ) : 1.0;
      float stepT = exp(-density * stepLen);
      // in-scattered sun radiance integrated over this step's transmittance drop —
      // (1 - stepT) is the fraction of light extinguished in this step, all of
      // which re-appears as scatter toward the eye (single-scattering approximation)
      vec3 inscatter = uSunColor.rgb * shadow * phase * uIntensity;
      // point / spot lights: inverse-square falloff, cone, phase function and (when they own a shadow layer) occlusion → god rays
      int nl = int(min(uEnvParams.z, uFogLocal.x));
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
          inscatter += cr.rgb * (att * vis * phaseHG(dot(rd, L), uAnisotropy * 0.5) * uFogLocal.y * uIntensity);
        }
      }
      scatter += transmittance * inscatter * (1.0 - stepT);
      transmittance *= stepT;
    }
  }
  fragColor = vec4(scatter, transmittance);
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
