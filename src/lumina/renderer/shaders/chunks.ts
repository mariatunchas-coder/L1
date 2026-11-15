/** Reusable GLSL snippets – resolved through `#include <name>` by the Program compiler. */
export const chunks: Record<string, string> = {
  common: /* glsl */ `
#define PI 3.14159265359
#define TWO_PI 6.28318530718
#define INV_PI 0.31830988618
#define saturate(x) clamp(x, 0.0, 1.0)

float pow2(float x) { return x * x; }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// Jimenez 2014 – cheap, high quality screen-space noise
float interleavedGradientNoise(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

// Vogel (sunflower) disk – well distributed samples for any N
vec2 vogelDisk(int i, int n, float phi) {
  float r = sqrt((float(i) + 0.5) / float(n));
  float t = float(i) * 2.39996323 + phi;
  return r * vec2(cos(t), sin(t));
}
`,

  ubo_camera: /* glsl */ `
layout(std140) uniform Camera {
  mat4 uView;
  mat4 uProj;
  mat4 uViewProj;
  mat4 uInvViewProj;
  vec4 uCamPos;      // xyz = world position, w = time (s)
  vec4 uScreen;      // xy = render target size (px), zw = 1/size
  vec4 uCamParams;   // x = near, y = far, zw = TAA jitter (NDC, already baked into uProj / uViewProj)
  mat4 uPrevViewProj;     // previous frame, un-jittered
  mat4 uViewProjUnjit;    // this frame, un-jittered
};
`,

  // Helpers shared by the screen-space effects. Requires <ubo_camera>.
  depth_util: /* glsl */ `
float linZ(float d) {
  float z = d * 2.0 - 1.0;
  return 2.0 * uCamParams.x * uCamParams.y / (uCamParams.y + uCamParams.x - z * (uCamParams.y - uCamParams.x));
}
vec3 worldPosFromDepth(vec2 uv, float d) {
  vec4 w = uInvViewProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return w.xyz / w.w;
}
vec3 viewPosFromDepth(vec2 uv, float d) {
  return (uView * vec4(worldPosFromDepth(uv, d), 1.0)).xyz;
}
// octahedral normal decoding (matches the G-buffer writer)
vec3 octDecode(vec2 e) {
  vec3 n = vec3(e.x, e.y, 1.0 - abs(e.x) - abs(e.y));
  if (n.z < 0.0) n.xy = (1.0 - abs(n.yx)) * vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
  return normalize(n);
}
// Screen-space motion (uv units) of an infinitely distant pixel – only camera rotation matters.
vec2 skyVelocity(vec2 uv) {
  vec4 w = uInvViewProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  vec3 dir = normalize(w.xyz / w.w - uCamPos.xyz);
  vec3 p = uCamPos.xyz + dir * 1000.0;
  vec4 c = uViewProjUnjit * vec4(p, 1.0);
  vec4 q = uPrevViewProj * vec4(p, 1.0);
  return (c.xy / c.w - q.xy / q.w) * 0.5;
}
`,

  ubo_lights: /* glsl */ `
#define MAX_LIGHTS 32
struct PunctualLight {
  vec4 posType;     // xyz = world position, w = 1 point / 2 spot
  vec4 colorRange;  // rgb = colour * intensity, w = range (0 = infinite)
  vec4 dirAngle;    // xyz = spot axis, w = cos(outer)
  vec4 spot;        // x = 1 / (cos(inner) - cos(outer))
};
layout(std140) uniform Lights {
  vec4 uSunDir;          // xyz = direction toward sun
  vec4 uSunColor;        // rgb = colour * irradiance
  vec4 uEnvParams;       // x = env intensity, y = max prefilter lod, z = light count
  vec4 uShadowParams;    // x = depth bias (world), y = normal bias (texels), z = softness (texels), w = 1/mapSize
  vec4 uShadowInfo;      // x = cascade count, y = enabled, z = blend fraction, w = shadow distance
  vec4 uCascadeSplits;   // far view-depth of each cascade
  vec4 uCascadeTexel;    // world size of one shadow texel per cascade
  vec4 uCascadeInvRange; // 1 / depth range per cascade
  vec4 uFog;             // x = density, y = height falloff, z = base height, w = sun scatter
  vec4 uFogTint;         // rgb = tint, a = enabled
  mat4 uCascadeMatrix[4];
  PunctualLight uLights[MAX_LIGHTS];
};
`,

  brdf: /* glsl */ `
// GGX / Trowbridge-Reitz NDF – numerically stable form (Filament): uses |N x H|^2
float D_GGX(float a, float NoH, vec3 NxH) {
  float oneMinusNoHSq = dot(NxH, NxH);
  float t = NoH * a;
  float k = a / (oneMinusNoHSq + t * t);
  return k * k * INV_PI;
}
float D_GGX_simple(float NoH, float a) {
  float a2 = a * a;
  float d = NoH * NoH * (a2 - 1.0) + 1.0;
  return a2 / (PI * d * d);
}
// Height-correlated Smith visibility term (already divided by 4 NoL NoV)
float V_SmithGGXCorrelated(float NoV, float NoL, float a) {
  float a2 = a * a;
  float GGXV = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2);
  float GGXL = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2);
  return 0.5 / max(GGXV + GGXL, 1e-5);
}
float V_Kelemen(float LoH) { return 0.25 / max(LoH * LoH, 1e-4); }
vec3 F_Schlick(vec3 f0, float VoH) {
  float f = pow(1.0 - VoH, 5.0);
  return f + f0 * (1.0 - f);
}
float F_Schlick1(float f0, float VoH) {
  float f = pow(1.0 - VoH, 5.0);
  return f + f0 * (1.0 - f);
}
`,

  // Single-tap shadow test, no normal offset (there's no surface normal in a volume).
  // Used by volumetric fog, which calls this once per raymarch step — the 16-tap PCF
  // in <brdf>-adjacent getShadow() would be far too expensive at that sample count,
  // and the raymarch + bilateral blur already produce a soft result on their own.
  fog_shadow: /* glsl */ `
float fogCascadeSelect(float viewZ, int count) {
  float c = 0.0;
  for (int i = 0; i < 3; i++) {
    if (float(i) < float(count) - 1.0 && viewZ > uCascadeSplits[i]) c = float(i + 1);
  }
  return c;
}
float fogShadowSample(vec3 wp, float viewZ) {
  int count = int(uShadowInfo.x);
  int c = int(fogCascadeSelect(viewZ, count));
  vec3 uvz = (uCascadeMatrix[c] * vec4(wp, 1.0)).xyz * 0.5 + 0.5;
  if (uvz.x < 0.0 || uvz.x > 1.0 || uvz.y < 0.0 || uvz.y > 1.0 || uvz.z > 1.0) return 1.0;
  float invRange = uCascadeInvRange[c];
  float bias = uShadowParams.x * invRange * 2.0;
  float dist = uShadowInfo.w;
  float s = texture(uShadowMap, vec4(uvz.xy, float(c), uvz.z - bias));
  return mix(1.0, s, saturate((dist - viewZ) / (dist * 0.12)));
}
`,

  ibl_sampling: /* glsl */ `
float radicalInverse_VdC(uint bits) {
  bits = (bits << 16u) | (bits >> 16u);
  bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
  bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
  bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
  bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
  return float(bits) * 2.3283064365386963e-10;
}
vec2 hammersley(uint i, uint n) { return vec2(float(i) / float(n), radicalInverse_VdC(i)); }

vec3 importanceSampleGGX(vec2 Xi, vec3 N, float a) {
  float phi = TWO_PI * Xi.x;
  float cosTheta = sqrt((1.0 - Xi.y) / (1.0 + (a * a - 1.0) * Xi.y));
  float sinTheta = sqrt(max(1.0 - cosTheta * cosTheta, 0.0));
  vec3 H = vec3(cos(phi) * sinTheta, sin(phi) * sinTheta, cosTheta);
  vec3 up = abs(N.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
  vec3 tx = normalize(cross(up, N));
  vec3 ty = cross(N, tx);
  return normalize(tx * H.x + ty * H.y + N * H.z);
}

// Direction for a cube face texel; uv in [-1, 1]. Matches the OpenGL cube map convention.
vec3 cubeFaceDir(int face, vec2 uv) {
  if (face == 0) return vec3(1.0, -uv.y, -uv.x);
  if (face == 1) return vec3(-1.0, -uv.y, uv.x);
  if (face == 2) return vec3(uv.x, 1.0, uv.y);
  if (face == 3) return vec3(uv.x, -1.0, -uv.y);
  if (face == 4) return vec3(uv.x, -uv.y, 1.0);
  return vec3(-uv.x, -uv.y, -1.0);
}
`,
};
