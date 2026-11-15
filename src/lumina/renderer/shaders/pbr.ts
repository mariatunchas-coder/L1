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
};

// Evaluates one punctual/directional light. Returns radiance split in diffuse / specular.
void evalLight(Surface s, vec3 L, vec3 radiance, inout vec3 diffuse, inout vec3 specular) {
  float NoL = saturate(dot(s.N, L));
  if (NoL <= 0.0) return;
  vec3 H = normalize(s.V + L);
  float NoH = saturate(dot(s.N, H));
  float LoH = saturate(dot(L, H));
  float VoH = saturate(dot(s.V, H));
  vec3 NxH = cross(s.N, H);

  float D = D_GGX(s.a, NoH, NxH);
  float Vis = V_SmithGGXCorrelated(s.NoV, NoL, s.a);
  vec3 F = F_Schlick(s.F0, VoH);
  vec3 Fr = D * Vis * F * s.energyComp;
  vec3 Fd = s.diffuseColor * INV_PI;

#ifdef USE_CLEARCOAT
  if (s.clearcoat > 0.0) {
    float NoLc = saturate(dot(s.Ng, L));
    float NoHc = saturate(dot(s.Ng, H));
    float Fc = F_Schlick1(0.04, LoH) * s.clearcoat;
    float Dc = D_GGX(s.ccA, NoHc, cross(s.Ng, H));
    float Vc = V_Kelemen(LoH);
    float coat = Dc * Vc * Fc;
    float att = 1.0 - Fc;
    diffuse += Fd * att * att * radiance * NoL;
    specular += (Fr * att * att * NoL + vec3(coat * NoLc)) * radiance;
    return;
  }
#endif
  diffuse += Fd * radiance * NoL;
  specular += Fr * radiance * NoL;
}

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
#ifdef USE_NORMALMAP
  vec3 tn = texture(uNormalMap, uv).xyz * 2.0 - 1.0;
  tn.xy *= uNormalScale;
  #ifdef USE_TANGENT
    vec3 T = normalize(vTangent.xyz);
    T = normalize(T - Ng * dot(Ng, T));
    vec3 B = cross(Ng, T) * vTangent.w;
    N = normalize(mat3(T, B, Ng) * tn);
  #else
    vec3 dp1 = dFdx(vWorldPos), dp2 = dFdy(vWorldPos);
    vec2 duv1 = dFdx(uv), duv2 = dFdy(uv);
    vec3 dp2perp = cross(dp2, Ng), dp1perp = cross(Ng, dp1);
    vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
    vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
    float invmax = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-20));
    N = normalize(mat3(T * invmax, B * invmax, Ng) * tn);
  #endif
#endif

  // ── specular anti-aliasing (Tokuyoshi & Kaplanyan) – removes shimmering on bumpy / distant surfaces ──
  float alpha = roughness * roughness;
  vec3 dndu = dFdx(N), dndv = dFdy(N);
  float variance = 0.25 * (dot(dndu, dndu) + dot(dndv, dndv));
  float kernelRough2 = min(2.0 * variance, 0.18);
  alpha = sqrt(saturate(alpha * alpha + kernelRough2));
  float perceptual = sqrt(alpha);

  float NoV = max(dot(N, V), 1e-4);
  vec3 F0 = mix(vec3(0.04), base.rgb, metalness);
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
  vec3 diffuseIBL = diffuseColor * irradiance * (1.0 - specAlbedo) * aoMultiBounce(ao, diffuseColor);

  vec3 R = reflect(-V, N);
  R = normalize(mix(R, N, alpha));   // bend toward the normal on rough surfaces
  vec3 prefiltered = textureLod(uPrefilter, R, perceptual * maxLod).rgb * envI;
  float specOcc = saturate(pow(NoV + ao, exp2(-16.0 * perceptual - 1.0)) - 1.0 + ao);
  vec3 specIBL = prefiltered * specAlbedo * energyComp * specOcc;

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

  vec3 color = diffuse + diffuseIBL + specular + specIBL + emissive;

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
