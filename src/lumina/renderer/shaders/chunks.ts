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
#define MAX_DECALS 8
#define MAX_LOCAL_LAYERS 8
struct PunctualLight {
  vec4 posType;     // xyz = world position, w = 1 point / 2 spot
  vec4 colorRange;  // rgb = colour * intensity, w = range (0 = infinite)
  vec4 dirAngle;    // xyz = spot axis, w = cos(outer)
  vec4 spot;        // x = 1 / (cos(inner) - cos(outer)), y = first shadow-atlas layer (-1 = no shadow), z = 1 → cube (point) shadow
};
struct DecalData {
  mat4 inv;         // world → decal space (box [-0.5, 0.5]^3, image on xy, projected along z)
  vec4 color;       // rgb tint, a = opacity
  vec4 p1;          // x = atlas layer, y = target roughness (<0 keep), z = normal strength, w = flatten normal (puddles)
  vec4 p2;          // xyz = projection axis (world, points out of the surface), w = wetness (darkening + gloss)
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
  vec4 uLocalInfo;       // x = enabled, y = softness (texels), z = 1 / map size, w = normal bias (texels)
  vec4 uExtra;           // x = PCSS on, y = PCSS penumbra (tan of the light's angular radius), z = micro-shadow strength, w = POM local-light shadows
  vec4 uDecalInfo;       // x = decal count
  mat4 uLocalShadowMat[MAX_LOCAL_LAYERS];
  vec4 uLocalShadowParam[MAX_LOCAL_LAYERS]; // x = near, y = far, z = world size of a texel at distance 1, w = constant bias (m)
  DecalData uDecals[MAX_DECALS];
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

// ── anisotropic GGX (Filament / Burley 2012) ──
float D_GGX_Aniso(float at, float ab, float ToH, float BoH, float NoH) {
  float a2 = at * ab;
  vec3 d = vec3(ab * ToH, at * BoH, a2 * NoH);
  float d2 = max(dot(d, d), 1e-8);
  float b2 = a2 / d2;
  return a2 * b2 * b2 * INV_PI;
}
float V_SmithGGXCorrelated_Aniso(float at, float ab, float ToV, float BoV, float ToL, float BoL, float NoV, float NoL) {
  float lambdaV = NoL * length(vec3(at * ToV, ab * BoV, NoV));
  float lambdaL = NoV * length(vec3(at * ToL, ab * BoL, NoL));
  return 0.5 / max(lambdaV + lambdaL, 1e-5);
}

// ── cloth sheen: Charlie NDF (Estevez & Kulla 2017) + Neubelt visibility ──
float D_Charlie(float alpha, float NoH) {
  float invAlpha = 1.0 / max(alpha, 0.02);
  float sin2h = max(1.0 - NoH * NoH, 0.0078125);
  return (2.0 + invAlpha) * pow(sin2h, invAlpha * 0.5) / (2.0 * PI);
}
float V_Neubelt(float NoV, float NoL) {
  return clamp(1.0 / (4.0 * (NoL + NoV - NoL * NoV)), 0.0, 1.0);
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

  // Shadow atlas of spot / point lights (a depth array; a point light owns six consecutive layers).
  // Needs <ubo_lights>. 'taps' = 1 (cheap, volumetric fog) … 8 (surfaces).
  local_shadow: /* glsl */ `
uniform sampler2DArrayShadow uLocalShadow;
float localShadowFactor(int li, vec3 wp, vec3 N, vec3 L, float dist, float noise, int taps) {
  float base = uLights[li].spot.y;
  if (base < -0.5) return 1.0;
  int layer = int(base + 0.5);
  if (uLights[li].spot.z > 0.5) {
    vec3 d = -L;
    vec3 a = abs(d);
    int face;
    if (a.x >= a.y && a.x >= a.z) face = d.x > 0.0 ? 0 : 1;
    else if (a.y >= a.z) face = d.y > 0.0 ? 2 : 3;
    else face = d.z > 0.0 ? 4 : 5;
    layer += face;
  }
  vec4 prm = uLocalShadowParam[layer];
  float texelW = prm.z * dist;
  float NoLg = dot(N, L);
  float sinT = sqrt(saturate(1.0 - NoLg * NoLg));
  vec3 p = wp + N * (texelW * uLocalInfo.w * (0.5 + 2.0 * sinT));
  vec4 c = uLocalShadowMat[layer] * vec4(p, 1.0);
  if (c.w <= prm.x) return 1.0;
  vec2 uv = c.xy / c.w * 0.5 + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 1.0;
  float bias = prm.w + texelW * (1.0 + 2.0 * min(sinT / max(NoLg, 0.2), 4.0));
  float z = max(c.w - bias, prm.x);
  float n = prm.x;
  float f = prm.y;
  float ndc = ((f + n) * z - 2.0 * f * n) / ((f - n) * z);
  float ref = clamp(ndc * 0.5 + 0.5, 0.0, 1.0);
  float radius = uLocalInfo.y * uLocalInfo.z;
  float sum = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= taps) break;
    vec2 o = vogelDisk(i, taps, noise) * radius;
    sum += texture(uLocalShadow, vec4(uv + o, float(layer), ref));
  }
  return sum / float(taps);
}
`,

  // Procedural cumulus layer shared by the sky bake (image based lighting) and the background pass
  // (analytic, so the visible clouds stay razor sharp instead of being limited by cubemap resolution).
  clouds: /* glsl */ `
uniform vec4 uCloud;          // x coverage, y density, z scale, w unused
uniform vec2 uCloudOffset;    // wind drift

float cHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float cNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(cHash(i), cHash(i + vec2(1.0, 0.0)), u.x), mix(cHash(i + vec2(0.0, 1.0)), cHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float cFbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  const mat2 R = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) {
    s += a * cNoise(p);
    p = R * p;
    a *= 0.5;
  }
  return s * 1.0323;
}
float cloudField(vec2 p) {
  vec2 q = p * uCloud.z + uCloudOffset;
  float warp = cNoise(q * 0.5 + 3.1);
  float base = cFbm(q * 0.42 + warp * 0.6);
  float det = cFbm(q * 1.9 + 11.7 - warp);
  return base * 0.78 + det * 0.22;
}
float cloudDensity(vec2 p) {
  float t = mix(0.74, 0.28, clamp(uCloud.x, 0.0, 1.0));
  return smoothstep(t, t + 0.24, cloudField(p));
}
float hgPhase(float mu, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-3), 1.5));
}

// Returns premultiplied radiance (rgb) and coverage (a). 'ambient' is the sky radiance overhead.
vec4 cloudLayer(vec3 dir, vec3 sunDir, vec3 sunE, vec3 ambient) {
  if (uCloud.x <= 0.001 || dir.y <= 0.0) return vec4(0.0);
  float h = max(dir.y, 0.02);
  vec2 p = dir.xz / (h + 0.18);
  float d = cloudDensity(p);
  if (d <= 0.001) return vec4(0.0);
  float horizonFade = smoothstep(0.0, 0.2, dir.y);
  // two taps toward the sun approximate self shadowing (dark bellies, bright rims)
  vec2 toSun = sunDir.xz / max(sunDir.y + 0.25, 0.25) * 0.05;
  float tau = cloudDensity(p + toSun) + 0.7 * cloudDensity(p + toSun * 2.5);
  float light = exp(-tau * 1.8 * uCloud.y);
  float mu = dot(dir, sunDir);
  float phase = 0.45 + 2.6 * mix(hgPhase(mu, 0.62), hgPhase(mu, -0.25), 0.3);
  float sunUp = smoothstep(-0.08, 0.12, sunDir.y);
  vec3 lit = sunE * INV_PI * 0.9 * light * phase * sunUp;
  float thick = clamp(d * uCloud.y, 0.0, 1.0);
  vec3 amb = ambient * (1.05 - 0.45 * thick);
  float alpha = (1.0 - exp(-d * uCloud.y * 3.2)) * horizonFade;
  return vec4((lit + amb) * alpha, alpha);
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
