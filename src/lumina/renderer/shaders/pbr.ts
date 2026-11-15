export const pbrVert = /* glsl */ `
#include <ubo_camera>

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;
layout(location = 3) in vec4 aTangent;
#ifdef INSTANCED
layout(location = 4) in vec4 aIM0;
layout(location = 5) in vec4 aIM1;
layout(location = 6) in vec4 aIM2;
layout(location = 7) in vec4 aIM3;
#endif
#ifdef INSTANCED_COLOR
layout(location = 8) in vec3 aInstanceColor;
#endif

uniform mat4 uModel;
uniform mat3 uNormalMatrix;

out vec3 vWorldPos;
out vec3 vNormal;
out vec2 vUv;
out vec4 vTangent;
out vec3 vColor;

void main() {
  mat4 model = uModel;
  mat3 nm = uNormalMatrix;
#ifdef INSTANCED
  model = uModel * mat4(aIM0, aIM1, aIM2, aIM3);
  vec3 c0 = model[0].xyz, c1 = model[1].xyz, c2 = model[2].xyz;
  // cofactor matrix == inverse transpose up to scale (exact direction, no per-vertex inverse)
  nm = mat3(cross(c1, c2), cross(c2, c0), cross(c0, c1)) * sign(dot(c0, cross(c1, c2)));
#endif
  vec4 wp = model * vec4(aPosition, 1.0);
  vWorldPos = wp.xyz;
  vNormal = nm * aNormal;
  vTangent = vec4(mat3(model) * aTangent.xyz, aTangent.w);
  vUv = aUv;
#ifdef INSTANCED_COLOR
  vColor = aInstanceColor;
#else
  vColor = vec3(1.0);
#endif
  gl_Position = uViewProj * wp;
}
`;

export const pbrFrag = /* glsl */ `
#include <common>
#include <ubo_camera>
#include <ubo_lights>
#include <brdf>
#if defined(USE_CONTACT) || defined(USE_WATER)
#include <depth_util>
#endif

in vec3 vWorldPos;
in vec3 vNormal;
in vec2 vUv;
in vec4 vTangent;
in vec3 vColor;

layout(location = 0) out vec4 fragColor;

uniform vec4 uBaseColor;     // rgb + opacity
uniform vec3 uEmissive;      // already multiplied by intensity
uniform vec2 uRoughMetal;
uniform vec2 uClearcoat;     // x = strength, y = roughness
uniform float uNormalScale;
uniform float uEnvIntensity;
uniform vec4 uUvTransform;
uniform float uAlphaCutoff;
uniform float uAoStrength;
uniform vec2 uSpec;          // x = dielectric F0 (from IOR), y = specular intensity
#ifdef USE_SHEEN
uniform vec4 uSheen;         // rgb = sheen colour * strength, a = sheen roughness
#endif
#ifdef USE_ANISO
uniform vec4 uAniso;         // x = anisotropy (-1..1), y = cos(rot), z = sin(rot)
#endif
#ifdef USE_IRIDESCENCE
uniform vec4 uIrid;          // x = strength, y = film IOR, z = thickness (nm)
#endif
#ifdef USE_SSS
uniform vec4 uSSS;           // rgb = scatter colour, a = strength
#endif
#ifdef USE_TRANSMISSION
uniform vec4 uTrans;         // x = transmission, y = thickness (m), z = unused, w = IOR
uniform vec3 uAttCoeff;      // Beer-Lambert absorption coefficient (1/m)
uniform sampler2D uTransmissionTex;
#endif
#ifdef USE_WATER
uniform vec4 uWave;          // x = amplitude, y = scale, z = speed
#endif
#if defined(USE_CONTACT) || defined(USE_WATER)
uniform sampler2D uSceneDepth;
#endif
#ifdef USE_CONTACT
uniform vec4 uContact;       // x = ray length (m), y = thickness (m), z = strength
#endif

uniform samplerCube uIrradiance;
uniform samplerCube uPrefilter;
uniform sampler2D uBrdfLut;
uniform sampler2D uMap;
uniform sampler2D uNormalMap;
uniform sampler2D uOrmMap;
uniform sampler2D uEmissiveMap;
#ifdef USE_SHADOWS
uniform sampler2DArrayShadow uShadowMap;
#endif
#ifdef USE_SSAO
uniform sampler2D uAoTex;
#endif

#ifdef UNLIT
// ───────────────────────────── Unlit ─────────────────────────────
void main() {
  vec4 c = uBaseColor;
#ifdef USE_MAP
  c *= texture(uMap, vUv * uUvTransform.xy + uUvTransform.zw);
#endif
#ifdef ALPHA_TEST
  if (c.a < uAlphaCutoff) discard;
#endif
  vec3 col = c.rgb * vColor * uEmissive.r;
#ifdef TRANSPARENT
  col *= c.a;
#endif
  fragColor = vec4(min(col, vec3(60000.0)), c.a);
}
#else
// ───────────────────────────── PBR ─────────────────────────────

#ifdef USE_SHADOWS
#define SHADOW_TAPS 16

float sampleCascade(int c, vec3 wp, vec3 N, float NoL, float noise) {
  float texel = uCascadeTexel[c];
  float sinT = sqrt(saturate(1.0 - NoL * NoL));
  // normal-offset: shrinks the receiver along its normal → kills acne without peter-panning
  vec3 p = wp + N * (uShadowParams.y * texel * (0.5 + 2.0 * sinT));
  vec3 uvz = (uCascadeMatrix[c] * vec4(p, 1.0)).xyz * 0.5 + 0.5;
  if (uvz.x < 0.0 || uvz.x > 1.0 || uvz.y < 0.0 || uvz.y > 1.0 || uvz.z > 1.0) return 1.0;
  float invRange = uCascadeInvRange[c];
  float slope = min(sinT / max(sqrt(1.0 - sinT * sinT), 0.15), 6.0);
  float bias = uShadowParams.x * invRange + uShadowParams.z * texel * invRange * slope * 0.7;
  float ref = uvz.z - bias;
  float radius = uShadowParams.z * uShadowParams.w;
  float sum = 0.0;
  for (int i = 0; i < SHADOW_TAPS; i++) {
    vec2 o = vogelDisk(i, SHADOW_TAPS, noise) * radius;
    // hardware 2x2 bilinear PCF on every tap → very smooth penumbra
    sum += texture(uShadowMap, vec4(uvz.xy + o, float(c), ref));
  }
  return sum / float(SHADOW_TAPS);
}

float getShadow(vec3 wp, vec3 N, float NoL) {
  float viewZ = -(uView * vec4(wp, 1.0)).z;
  int count = int(uShadowInfo.x);
  float noise = interleavedGradientNoise(gl_FragCoord.xy) * TWO_PI;
  int c = 0;
  for (int i = 0; i < 3; i++) {
    if (i < count - 1 && viewZ > uCascadeSplits[i]) c = i + 1;
  }
  float s = sampleCascade(c, wp, N, NoL, noise);
  if (c < count - 1) {
    float splitEnd = uCascadeSplits[c];
    float f = (splitEnd - viewZ) / max(splitEnd * uShadowInfo.z, 1e-3);
    if (f < 1.0) s = mix(sampleCascade(c + 1, wp, N, NoL, noise), s, saturate(f));
  }
  float dist = uShadowInfo.w;
  return mix(1.0, s, saturate((dist - viewZ) / (dist * 0.12)));
}
#endif

vec3 applyFog(vec3 color, vec3 wp, float alpha) {
  vec3 toP = wp - uCamPos.xyz;
  float dist = length(toP);
  vec3 rd = toP / max(dist, 1e-4);
  float fall = uFog.y;
  float k = fall * rd.y;
  float integral = abs(k) < 1e-4 ? dist : (1.0 - exp(-k * dist)) / k;
  float optical = uFog.x * exp(-fall * (uCamPos.y - uFog.z)) * integral;
  float f = 1.0 - exp(-optical);
  // aerial perspective: fog takes the colour of the sky toward that direction
  vec3 fogDir = normalize(vec3(rd.x, max(rd.y, 0.04), rd.z));
  vec3 fogCol = textureLod(uPrefilter, fogDir, uEnvParams.y * 0.5).rgb * uEnvParams.x * uFogTint.rgb;
  float sunAmt = pow(saturate(dot(rd, uSunDir.xyz)), 10.0) * uFog.w;
  fogCol += uSunColor.rgb * sunAmt * 0.012;
  return color * (1.0 - f) + fogCol * f * alpha;
}

// Jimenez et al. 2016 – approximates inter-reflection so AO doesn't over-darken bright albedos
vec3 aoMultiBounce(float ao, vec3 albedo) {
  vec3 a = 2.0404 * albedo - 0.3324;
  vec3 b = -4.7951 * albedo + 0.6417;
  vec3 c = 2.7552 * albedo + 0.6903;
  return max(vec3(ao), ((ao * a + b) * ao + c) * ao);
}

struct Surface {
  vec3 N;
  vec3 Ng;
  vec3 V;
  float NoV;
  float a;          // alpha = roughness^2 (after specular anti-aliasing)
  vec3 F0;
  vec3 diffuseColor;
  vec3 energyComp;
  float clearcoat;
  float ccA;
  vec3 sheenColor;
  float sheenA;
  vec3 aT;
  vec3 aB;
  float at;
  float ab;
  vec3 sssColor;
  float sssWrap;
};

// Evaluates one punctual/directional light. Returns radiance split in diffuse / specular.
void evalLight(Surface s, vec3 L, vec3 radiance, inout vec3 diffuse, inout vec3 specular) {
  float rawNoL = dot(s.N, L);
  float NoL = saturate(rawNoL);
#ifdef USE_SSS
  if (rawNoL + s.sssWrap <= 0.0) return;
#else
  if (NoL <= 0.0) return;
#endif
  vec3 H = normalize(s.V + L);
  float NoH = saturate(dot(s.N, H));
  float LoH = saturate(dot(L, H));
  float VoH = saturate(dot(s.V, H));
  vec3 NxH = cross(s.N, H);

#ifdef USE_ANISO
  float D = D_GGX_Aniso(s.at, s.ab, dot(s.aT, H), dot(s.aB, H), NoH);
  float Vis = V_SmithGGXCorrelated_Aniso(s.at, s.ab, dot(s.aT, s.V), dot(s.aB, s.V), dot(s.aT, L), dot(s.aB, L), s.NoV, NoL);
#else
  float D = D_GGX(s.a, NoH, NxH);
  float Vis = V_SmithGGXCorrelated(s.NoV, NoL, s.a);
#endif
  vec3 F = F_Schlick(s.F0, VoH);
  vec3 Fr = D * Vis * F * s.energyComp;
  vec3 Fd = s.diffuseColor * INV_PI;

  // diffuse cosine term (wrapped + tinted when subsurface scattering is on)
  vec3 dN = vec3(NoL);
#ifdef USE_SSS
  {
    float wrap = saturate((rawNoL + s.sssWrap) / (1.0 + s.sssWrap));
    dN += s.sssColor * (wrap - NoL);
  }
#endif

#ifdef USE_SHEEN
  specular += s.sheenColor * (D_Charlie(s.sheenA, NoH) * V_Neubelt(s.NoV, NoL)) * radiance * NoL;
#endif

#ifdef USE_CLEARCOAT
  if (s.clearcoat > 0.0) {
    float NoLc = saturate(dot(s.Ng, L));
    float NoHc = saturate(dot(s.Ng, H));
    float Fc = F_Schlick1(0.04, LoH) * s.clearcoat;
    float Dc = D_GGX(s.ccA, NoHc, cross(s.Ng, H));
    float Vc = V_Kelemen(LoH);
    float coat = Dc * Vc * Fc;
    float att = 1.0 - Fc;
    diffuse += Fd * att * att * radiance * dN;
    specular += (Fr * att * att * NoL + vec3(coat * NoLc)) * radiance;
    return;
  }
#endif
  diffuse += Fd * radiance * dN;
  specular += Fr * radiance * NoL;
}

#ifdef USE_IRIDESCENCE
// Thin-film interference (analytic approximation): reflectance oscillates with the optical path
// difference 2·η·d·cosθ₂ at three representative wavelengths.
vec3 applyIridescence(vec3 F0, float metalness, float NoV) {
  float eta = max(uIrid.y, 1.0);
  float sin2 = (1.0 - NoV * NoV) / (eta * eta);
  float cos2 = sqrt(max(1.0 - sin2, 0.0));
  float opd = 2.0 * eta * uIrid.z * cos2;
  vec3 irid = 0.5 - 0.5 * cos(TWO_PI * opd / vec3(650.0, 510.0, 475.0));
  vec3 dielectric = vec3(0.04) + vec3(0.36) * irid;
  vec3 metal = F0 * (0.35 + 1.3 * irid);
  return mix(F0, clamp(mix(dielectric, metal, metalness), 0.0, 1.0), uIrid.x);
}
#endif

#ifdef USE_WATER
float cNoiseFoam(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
  float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
  float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
  float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// Sum of directional waves with deep-water dispersion; returns the height-field gradient.
vec2 waterGradient(vec2 p, float t, float amp, float scale) {
  vec2 g = vec2(0.0);
  float freq = 0.9 * scale;
  float a = amp;
  float angle = 0.4;
  for (int i = 0; i < 7; i++) {
    angle += 2.399963;
    vec2 dir = vec2(cos(angle), sin(angle));
    float speed = sqrt(9.81 * freq);
    float ph = dot(dir, p) * freq + t * speed;
    g += dir * (a * freq * cos(ph));
    freq *= 1.55;
    a *= 0.5;
  }
  return g;
}
#endif

#ifdef USE_CONTACT
// Screen-space contact shadow toward the sun: short depth-buffer ray march that grounds small objects.
float contactShadow(vec3 wp, vec3 Ng, vec3 L) {
  vec3 vp = (uView * vec4(wp + Ng * 0.015, 1.0)).xyz;
  vec3 vL = mat3(uView) * L;
  float len = uContact.x;
  float jitter = interleavedGradientNoise(gl_FragCoord.xy);
  float occ = 0.0;
  for (int i = 0; i < 12; i++) {
    float t = (float(i) + jitter) / 12.0;
    vec3 sp = vp + vL * (t * len);
    vec4 c = uProj * vec4(sp, 1.0);
    if (c.w <= 0.0) break;
    vec2 suv = c.xy / c.w * 0.5 + 0.5;
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) break;
    float sd = linZ(textureLod(uSceneDepth, suv, 0.0).r);
    float diff = -sp.z - sd;
    if (diff > 0.006 * -sp.z + t * 0.02 && diff < uContact.y) occ = 1.0;
  }
  float fade = 1.0 - smoothstep(25.0, 55.0, -vp.z);
  return 1.0 - occ * uContact.z * fade;
}
#endif

#ifdef USE_TRANSMISSION
// Refraction of the opaque scene (already resolved + mip-chained) with volume absorption.
vec3 getTransmission(vec3 N, vec3 V, vec3 baseCol, float roughness, float NoV, vec3 specAlbedo, out float behindDist) {
  float ior = max(uTrans.w, 1.0);
  vec3 rdir = refract(-V, N, 1.0 / ior);
  if (dot(rdir, rdir) < 1e-6) rdir = -V;
  rdir = normalize(rdir);
  vec2 screenUv = gl_FragCoord.xy * uScreen.zw;
  float travel = uTrans.y;
#ifdef USE_WATER
  float surfZ = linZ(gl_FragCoord.z);
  float sd0 = texture(uSceneDepth, screenUv).r;
  float behind0 = sd0 >= 1.0 ? 60.0 : max(linZ(sd0) - surfZ, 0.0);
  travel = min(behind0, 2.0) * 0.85;
#endif
  vec3 exitPos = vWorldPos + rdir * travel;
  vec4 clip = uViewProj * vec4(exitPos, 1.0);
  vec2 uv = clip.w > 1e-4 ? clip.xy / clip.w * 0.5 + 0.5 : screenUv;
  uv = clamp(uv, vec2(0.002), vec2(0.998));
  float pathLen = travel;
  behindDist = 0.0;
#ifdef USE_WATER
  float sd1 = texture(uSceneDepth, uv).r;
  if (sd1 < gl_FragCoord.z - 1e-6) {   // refracted lookup landed on something in front of the water: don't leak it
    uv = screenUv;
    sd1 = sd0;
  }
  behindDist = sd1 >= 1.0 ? 60.0 : max(linZ(sd1) - surfZ, 0.0);
  pathLen = behindDist / max(NoV, 0.3);
#endif
  float lod = roughness * log2(max(uScreen.x, uScreen.y)) * clamp(ior * 2.0 - 2.0, 0.0, 1.0);
  vec3 scene = textureLod(uTransmissionTex, uv, lod).rgb;
  vec3 T = exp(-uAttCoeff * pathLen);
  return baseCol * scene * T * (1.0 - specAlbedo);
}
#endif

void main() {
  vec2 uv = vUv * uUvTransform.xy + uUvTransform.zw;

  vec4 base = uBaseColor;
#ifdef USE_MAP
  base *= texture(uMap, uv);
#endif
  base.rgb *= vColor;
#ifdef ALPHA_TEST
  if (base.a < uAlphaCutoff) discard;
#endif

  float roughness = uRoughMetal.x;
  float metalness = uRoughMetal.y;
  float ao = 1.0;
#ifdef USE_ORM
  vec3 orm = texture(uOrmMap, uv).rgb;
  ao = mix(1.0, orm.r, uAoStrength);
  roughness *= orm.g;
  metalness *= orm.b;
#endif
  roughness = clamp(roughness, 0.045, 1.0);
  metalness = saturate(metalness);

  // ── geometry / shading normal ──
  vec3 V = normalize(uCamPos.xyz - vWorldPos);
  vec3 Ng = normalize(vNormal);
#ifdef DOUBLE_SIDED
  if (!gl_FrontFacing) Ng = -Ng;
#endif
  vec3 N = Ng;
#ifdef USE_WATER
  {
    float wd = length(uCamPos.xyz - vWorldPos);
    float damp = 1.0 / (1.0 + wd * 0.012);   // fade the ripples with distance (no moire / shimmer)
    vec2 wg = waterGradient(vWorldPos.xz, uCamPos.w * uWave.z, uWave.x * damp, uWave.y);
    N = normalize(Ng + vec3(-wg.x, 0.0, -wg.y));
  }
#endif
#if defined(USE_NORMALMAP) || defined(USE_ANISO)
  vec3 Tg;
  vec3 Bg;
  #ifdef USE_TANGENT
    Tg = normalize(vTangent.xyz);
    Tg = normalize(Tg - Ng * dot(Ng, Tg));
    Bg = cross(Ng, Tg) * vTangent.w;
  #else
    vec3 dp1 = dFdx(vWorldPos), dp2 = dFdy(vWorldPos);
    vec2 duv1 = dFdx(uv), duv2 = dFdy(uv);
    vec3 dp2perp = cross(dp2, Ng), dp1perp = cross(Ng, dp1);
    vec3 T0 = dp2perp * duv1.x + dp1perp * duv2.x;
    vec3 B0 = dp2perp * duv1.y + dp1perp * duv2.y;
    float invmax = inversesqrt(max(max(dot(T0, T0), dot(B0, B0)), 1e-20));
    Tg = T0 * invmax;
    Bg = B0 * invmax;
  #endif
#endif
#ifdef USE_NORMALMAP
  vec3 tn = texture(uNormalMap, uv).xyz * 2.0 - 1.0;
  tn.xy *= uNormalScale;
  N = normalize(mat3(Tg, Bg, Ng) * tn);
#endif

  // ── specular anti-aliasing (Tokuyoshi & Kaplanyan) – removes shimmering on bumpy / distant surfaces ──
  float alpha = roughness * roughness;
  vec3 dndu = dFdx(N), dndv = dFdy(N);
  float variance = 0.25 * (dot(dndu, dndu) + dot(dndv, dndv));
  float kernelRough2 = min(2.0 * variance, 0.18);
  alpha = sqrt(saturate(alpha * alpha + kernelRough2));
  float perceptual = sqrt(alpha);

  float NoV = max(dot(N, V), 1e-4);
  vec3 F0 = mix(vec3(min(uSpec.x * uSpec.y, 1.0)), base.rgb, metalness);
#ifdef USE_IRIDESCENCE
  F0 = applyIridescence(F0, metalness, NoV);
#endif
  vec3 diffuseColor = base.rgb * (1.0 - metalness);

  // split-sum environment BRDF + multiple-scattering energy compensation (Fdez-Aguera 2019)
  vec2 dfg = texture(uBrdfLut, vec2(NoV, perceptual)).rg;
  vec3 specAlbedo = F0 * dfg.x + dfg.y;
  vec3 energyComp = 1.0 + F0 * (1.0 / max(dfg.x + dfg.y, 1e-3) - 1.0);

  Surface s;
  s.N = N; s.Ng = Ng; s.V = V; s.NoV = NoV; s.a = max(alpha, 0.002);
  s.F0 = F0; s.diffuseColor = diffuseColor; s.energyComp = energyComp;
  s.clearcoat = uClearcoat.x;
  float ccRough = clamp(uClearcoat.y, 0.045, 1.0);
  s.ccA = ccRough * ccRough;
  s.sheenColor = vec3(0.0);
  s.sheenA = 1.0;
  s.aT = vec3(1.0, 0.0, 0.0);
  s.aB = vec3(0.0, 0.0, 1.0);
  s.at = s.a;
  s.ab = s.a;
  s.sssColor = vec3(0.0);
  s.sssWrap = 0.0;
#ifdef USE_SHEEN
  {
    s.sheenColor = uSheen.rgb;
    float sr = clamp(uSheen.a, 0.07, 1.0);
    s.sheenA = sr * sr;
    // the sheen layer absorbs a little of the light that would reach the base layer
    float sheenMax = max(s.sheenColor.r, max(s.sheenColor.g, s.sheenColor.b));
    float sheenScale = 1.0 - sheenMax * 0.3;
    s.diffuseColor *= sheenScale;
    s.energyComp *= sheenScale;
  }
#endif
#ifdef USE_ANISO
  {
    vec3 Ta0 = dot(Tg, Tg) > 1e-10 ? normalize(Tg) : normalize(cross(abs(Ng.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), Ng));
    vec3 Ba0 = dot(Bg, Bg) > 1e-10 ? normalize(Bg) : cross(Ng, Ta0);
    vec3 Tr = Ta0 * uAniso.y + Ba0 * uAniso.z;
    Tr = Tr - N * dot(N, Tr);
    Tr = dot(Tr, Tr) > 1e-10 ? normalize(Tr) : Ta0;
    s.aT = Tr;
    s.aB = cross(N, Tr);
    s.at = max(alpha * (1.0 + uAniso.x), 0.002);
    s.ab = max(alpha * (1.0 - uAniso.x), 0.002);
  }
#endif
#ifdef USE_SSS
  s.sssColor = uSSS.rgb;
  s.sssWrap = uSSS.a * 0.85;
#endif

  vec3 diffuse = vec3(0.0);
  vec3 specular = vec3(0.0);

  // ── sun with cascaded shadows ──
  {
    vec3 L = uSunDir.xyz;
    float NoLs = saturate(dot(Ng, L));
    float shadow = 1.0;
#ifdef USE_SHADOWS
    if (NoLs > 0.0) shadow = getShadow(vWorldPos, Ng, NoLs);
#endif
#ifdef USE_CONTACT
    if (NoLs > 0.0 && shadow > 0.0) shadow = min(shadow, contactShadow(vWorldPos, Ng, L));
#endif
    if (shadow > 0.0) evalLight(s, L, uSunColor.rgb * shadow, diffuse, specular);
  }

  // ── punctual lights ──
  int lightCount = int(uEnvParams.z);
  for (int i = 0; i < MAX_LIGHTS; i++) {
    if (i >= lightCount) break;
    vec4 pt = uLights[i].posType;
    vec4 cr = uLights[i].colorRange;
    vec3 Lv = pt.xyz - vWorldPos;
    float d2 = dot(Lv, Lv);
    vec3 L = Lv * inversesqrt(max(d2, 1e-8));
    float att = 1.0 / max(d2, 1e-3);
    if (cr.w > 0.0) {
      float r2 = d2 / (cr.w * cr.w);
      float win = saturate(1.0 - r2 * r2);
      att *= win * win;
    }
    if (pt.w > 1.5) {
      float cd = dot(-L, uLights[i].dirAngle.xyz);
      float sp = saturate((cd - uLights[i].dirAngle.w) * uLights[i].spot.x);
      att *= sp * sp;
    }
    if (att > 1e-5) evalLight(s, L, cr.rgb * att, diffuse, specular);
  }

  // ── ambient occlusion (material AO × screen-space AO) ──
#ifdef USE_SSAO
  ao = min(ao, texture(uAoTex, gl_FragCoord.xy * uScreen.zw).r);
#endif

  // ── image based lighting ──
  float envI = uEnvParams.x * uEnvIntensity;
  float maxLod = uEnvParams.y;
  vec3 irradiance = texture(uIrradiance, N).rgb * envI;
  vec3 diffuseIBL = s.diffuseColor * irradiance * (1.0 - specAlbedo) * aoMultiBounce(ao, diffuseColor);

  vec3 R = reflect(-V, N);
#ifdef USE_ANISO
  {
    // anisotropic reflection: bend the normal toward the stretched direction (Filament)
    vec3 aDir = uAniso.x >= 0.0 ? s.aB : s.aT;
    vec3 aNrm = cross(aDir, V);
    vec3 bent = normalize(cross(aNrm, aDir));
    float bendAmt = pow(1.0 - abs(uAniso.x) * (1.0 - perceptual), 4.0);
    R = reflect(-V, normalize(mix(bent, N, bendAmt)));
  }
#endif
  R = normalize(mix(R, N, alpha));   // bend toward the normal on rough surfaces
  vec3 prefiltered = textureLod(uPrefilter, R, perceptual * maxLod).rgb * envI;
  float specOcc = saturate(pow(NoV + ao, exp2(-16.0 * perceptual - 1.0)) - 1.0 + ao);
  vec3 specIBL = prefiltered * specAlbedo * s.energyComp * specOcc;
#ifdef USE_SHEEN
  {
    // soft velvet rim from the diffuse environment (approximation of the sheen DFG)
    float rim = 0.2 + 1.3 * pow(1.0 - NoV, 3.0);
    specIBL += s.sheenColor * irradiance * rim * 0.6 * ao;
  }
#endif
#ifdef USE_SSS
  diffuseIBL += diffuseColor * irradiance * uSSS.rgb * (uSSS.a * 0.3);
#endif

#ifdef USE_CLEARCOAT
  if (s.clearcoat > 0.0) {
    float NoVc = max(dot(Ng, V), 1e-4);
    float Fc = F_Schlick1(0.04, NoVc) * s.clearcoat;
    vec3 Rc = reflect(-V, Ng);
    vec3 coatPre = textureLod(uPrefilter, Rc, sqrt(s.ccA) * maxLod).rgb * envI;
    float att = 1.0 - Fc;
    diffuseIBL *= att * att;
    specIBL = specIBL * att * att + coatPre * Fc * specOcc;
  }
#endif

  vec3 emissive = uEmissive;
#ifdef USE_EMISSIVEMAP
  emissive *= texture(uEmissiveMap, uv).rgb;
#endif

  float outAlpha = base.a;
#ifdef TRANSPARENT
  // premultiplied alpha: diffuse is attenuated by opacity, specular reflections are not (glass-like)
  diffuse *= base.a;
  diffuseIBL *= base.a;
  emissive *= base.a;
#else
  outAlpha = 1.0;
#endif

#ifdef USE_TRANSMISSION
  float behindDist;
  vec3 transmitted = vec3(0.0);
  {
    float tAmt = uTrans.x;
    diffuse *= 1.0 - tAmt;
    diffuseIBL *= 1.0 - tAmt;
    transmitted = getTransmission(N, V, base.rgb, roughness, NoV, specAlbedo, behindDist) * tAmt;
  }
#endif

  vec3 color = diffuse + diffuseIBL + specular + specIBL + emissive;
#ifdef USE_TRANSMISSION
  color += transmitted;
  #ifdef USE_WATER
  {
    // shore / contact foam where the water column gets thin
    float fn = cNoiseFoam(vWorldPos.xz * 3.1 + uCamPos.w * 0.15) * 0.65 + cNoiseFoam(vWorldPos.xz * 9.0 - uCamPos.w * 0.2) * 0.35;
    float foam = smoothstep(0.45, 0.0, behindDist) * smoothstep(0.25, 0.75, fn);
    vec3 foamLight = (uSunColor.rgb * max(uSunDir.y, 0.0) * 0.8 + irradiance * 3.14159) * INV_PI * 0.9;
    color = mix(color, foamLight, foam * 0.75);
  }
  #endif
#endif

#ifdef USE_FOG
  color = applyFog(color, vWorldPos, outAlpha);
#endif

  fragColor = vec4(min(color, vec3(60000.0)), outAlpha);
}
#endif
`;

export const depthVert = /* glsl */ `
layout(location = 0) in vec3 aPosition;
layout(location = 2) in vec2 aUv;
#ifdef INSTANCED
layout(location = 4) in vec4 aIM0;
layout(location = 5) in vec4 aIM1;
layout(location = 6) in vec4 aIM2;
layout(location = 7) in vec4 aIM3;
#endif
uniform mat4 uViewProj;
uniform mat4 uModel;
out vec2 vUv;
void main() {
  mat4 model = uModel;
#ifdef INSTANCED
  model = uModel * mat4(aIM0, aIM1, aIM2, aIM3);
#endif
  vUv = aUv;
  gl_Position = uViewProj * model * vec4(aPosition, 1.0);
}
`;

export const depthFrag = /* glsl */ `
in vec2 vUv;
uniform vec4 uBaseColor;
uniform vec4 uUvTransform;
uniform float uAlphaCutoff;
uniform sampler2D uMap;
void main() {
#ifdef ALPHA_TEST
  float a = uBaseColor.a;
  #ifdef USE_MAP
  a *= texture(uMap, vUv * uUvTransform.xy + uUvTransform.zw).a;
  #endif
  if (a < uAlphaCutoff) discard;
#endif
}
`;

/**
 * G-buffer pre-pass (depth + velocity + world normal + F0/roughness). Used instead of the plain
 * depth pre-pass whenever TAA, SSR or motion blur are active.
 */
export const gbufVert = /* glsl */ `
#include <ubo_camera>
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;
#ifdef INSTANCED
layout(location = 4) in vec4 aIM0;
layout(location = 5) in vec4 aIM1;
layout(location = 6) in vec4 aIM2;
layout(location = 7) in vec4 aIM3;
#endif
uniform mat4 uModel;
uniform mat4 uPrevModel;
uniform mat3 uNormalMatrix;
out vec3 vNormal;
out vec2 vUv;
out vec4 vCurr;
out vec4 vPrev;
void main() {
  mat4 model = uModel;
  mat4 prevModel = uPrevModel;
  mat3 nm = uNormalMatrix;
#ifdef INSTANCED
  mat4 im = mat4(aIM0, aIM1, aIM2, aIM3);
  model = uModel * im;
  prevModel = uPrevModel * im;
  vec3 c0 = model[0].xyz, c1 = model[1].xyz, c2 = model[2].xyz;
  nm = mat3(cross(c1, c2), cross(c2, c0), cross(c0, c1)) * sign(dot(c0, cross(c1, c2)));
#endif
  vec4 wp = model * vec4(aPosition, 1.0);
  vNormal = nm * aNormal;
  vUv = aUv;
  vCurr = uViewProjUnjit * wp;
  vPrev = uPrevViewProj * (prevModel * vec4(aPosition, 1.0));
  gl_Position = uViewProj * wp;
}
`;

export const gbufFrag = /* glsl */ `
layout(location = 0) out vec4 outVelNormal;
layout(location = 1) out vec4 outMaterial;
in vec3 vNormal;
in vec2 vUv;
in vec4 vCurr;
in vec4 vPrev;
uniform vec4 uBaseColor;
uniform vec2 uRoughMetal;
uniform vec4 uUvTransform;
uniform float uAlphaCutoff;
uniform sampler2D uMap;
uniform sampler2D uOrmMap;

vec2 octEncode(vec3 n) {
  n /= (abs(n.x) + abs(n.y) + abs(n.z));
  vec2 e = n.xy;
  if (n.z < 0.0) e = (1.0 - abs(e.yx)) * vec2(e.x >= 0.0 ? 1.0 : -1.0, e.y >= 0.0 ? 1.0 : -1.0);
  return e;
}

void main() {
  vec2 uv = vUv * uUvTransform.xy + uUvTransform.zw;
  vec4 base = uBaseColor;
#ifdef USE_MAP
  base *= texture(uMap, uv);
#endif
#ifdef ALPHA_TEST
  if (base.a < uAlphaCutoff) discard;
#endif
  float roughness = uRoughMetal.x;
  float metalness = uRoughMetal.y;
#ifdef USE_ORM
  vec3 orm = texture(uOrmMap, uv).rgb;
  roughness *= orm.g;
  metalness *= orm.b;
#endif
  roughness = clamp(roughness, 0.045, 1.0);
  vec3 N = normalize(vNormal);
#ifdef DOUBLE_SIDED
  if (!gl_FrontFacing) N = -N;
#endif
  vec2 vel = (vCurr.xy / vCurr.w - vPrev.xy / vPrev.w) * 0.5;
  outVelNormal = vec4(vel, octEncode(N));
#ifdef UNLIT
  outMaterial = vec4(0.0, 0.0, 0.0, 1.0);
#else
  outMaterial = vec4(mix(vec3(0.04), base.rgb, clamp(metalness, 0.0, 1.0)), roughness);
#endif
}
`;
