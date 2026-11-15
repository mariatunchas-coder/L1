export const ssaoFrag = /* glsl */ `
#include <common>
uniform sampler2D uTex0;   // depth
uniform mat4 uProj;
uniform vec4 uProjInfo;    // (2/P00, 2/P11, -1/P00, -1/P11)
uniform vec2 uNearFar;
uniform vec2 uInvSize;     // 1 / full-res size
uniform vec2 uInvOutSize;  // 1 / ao size
uniform float uRadius;
uniform float uBias;
uniform float uIntensity;
uniform float uPower;
in vec2 vUv;
out vec4 fragColor;

float linZ(float d) {
  float z = d * 2.0 - 1.0;
  return 2.0 * uNearFar.x * uNearFar.y / (uNearFar.y + uNearFar.x - z * (uNearFar.y - uNearFar.x));
}
vec3 viewPosAt(vec2 uv) {
  float lz = linZ(textureLod(uTex0, uv, 0.0).r);
  return vec3((uv * uProjInfo.xy + uProjInfo.zw) * lz, -lz);
}

#define SAMPLES 16
void main() {
  vec2 uv = gl_FragCoord.xy * uInvOutSize;
  float d = textureLod(uTex0, uv, 0.0).r;
  if (d >= 1.0) { fragColor = vec4(1.0); return; }
  vec3 P = viewPosAt(uv);
  vec3 Pr = viewPosAt(uv + vec2(uInvSize.x, 0.0));
  vec3 Pl = viewPosAt(uv - vec2(uInvSize.x, 0.0));
  vec3 Pu = viewPosAt(uv + vec2(0.0, uInvSize.y));
  vec3 Pd = viewPosAt(uv - vec2(0.0, uInvSize.y));
  // pick the smaller depth delta → clean normals on silhouettes
  vec3 dx = abs(Pr.z - P.z) < abs(P.z - Pl.z) ? Pr - P : P - Pl;
  vec3 dy = abs(Pu.z - P.z) < abs(P.z - Pd.z) ? Pu - P : P - Pd;
  vec3 N = normalize(cross(dx, dy));

  vec3 T = normalize(abs(N.y) < 0.99 ? cross(N, vec3(0.0, 1.0, 0.0)) : cross(N, vec3(1.0, 0.0, 0.0)));
  vec3 B = cross(N, T);
  float noise = interleavedGradientNoise(gl_FragCoord.xy);

  float occ = 0.0;
  for (int i = 0; i < SAMPLES; i++) {
    float fi = float(i);
    float u1 = (fi + 0.5) / float(SAMPLES);
    float phi = TWO_PI * fract(fi * 0.7548776662 + noise);
    float cosT = sqrt(1.0 - u1);
    float sinT = sqrt(u1);
    vec3 h = vec3(cos(phi) * sinT, sin(phi) * sinT, cosT);
    vec3 sdir = T * h.x + B * h.y + N * h.z;
    float sc = (fi + 0.5 + noise) / float(SAMPLES);
    float scale = mix(0.08, 1.0, sc * sc);
    vec3 sp = P + sdir * uRadius * scale;
    vec4 pc = uProj * vec4(sp, 1.0);
    vec2 suv = pc.xy / pc.w * 0.5 + 0.5;
    float sz = -linZ(textureLod(uTex0, suv, 0.0).r);
    float occluded = sz >= sp.z + uBias * (0.5 + scale) ? 1.0 : 0.0;
    float range = smoothstep(0.0, 1.0, uRadius / max(abs(P.z - sz), 1e-4));
    occ += occluded * range;
  }
  float ao = saturate(1.0 - uIntensity * occ / float(SAMPLES));
  fragColor = vec4(pow(ao, uPower), 0.0, 0.0, 1.0);
}
`;

export const ssaoBlurFrag = /* glsl */ `
uniform sampler2D uTex0;   // depth
uniform sampler2D uTex1;   // ao
uniform vec2 uDir;         // texel step (ao space)
uniform vec2 uNearFar;
in vec2 vUv;
out vec4 fragColor;
float linZ(float d) {
  float z = d * 2.0 - 1.0;
  return 2.0 * uNearFar.x * uNearFar.y / (uNearFar.y + uNearFar.x - z * (uNearFar.y - uNearFar.x));
}
void main() {
  float zc = linZ(textureLod(uTex0, vUv, 0.0).r);
  float sum = texture(uTex1, vUv).r;
  float wsum = 1.0;
  for (int i = -4; i <= 4; i++) {
    if (i == 0) continue;
    vec2 uv = vUv + uDir * float(i);
    float zs = linZ(textureLod(uTex0, uv, 0.0).r);
    float dz = abs(zs - zc) / zc;
    float w = exp(-float(i * i) * 0.12) * exp(-dz * dz * 6000.0);
    sum += texture(uTex1, uv).r * w;
    wsum += w;
  }
  fragColor = vec4(sum / wsum, 0.0, 0.0, 1.0);
}
`;

export const bloomDownFrag = /* glsl */ `
uniform sampler2D uTex0;
uniform vec2 uTexel;       // 1 / source size
uniform vec3 uThreshold;   // x = threshold, y = knee
in vec2 vUv;
out vec4 fragColor;

vec3 prefilter(vec3 c) {
  c = min(c, vec3(500.0));
  float br = max(c.r, max(c.g, c.b));
  float knee = max(uThreshold.y, 1e-4);
  float soft = clamp(br - uThreshold.x + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-5);
  float contrib = max(soft, br - uThreshold.x) / max(br, 1e-4);
  return c * contrib;
}
float karis(vec3 c) { return 1.0 / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722))); }

void main() {
  vec3 a = texture(uTex0, vUv + uTexel * vec2(-2.0,  2.0)).rgb;
  vec3 b = texture(uTex0, vUv + uTexel * vec2( 0.0,  2.0)).rgb;
  vec3 c = texture(uTex0, vUv + uTexel * vec2( 2.0,  2.0)).rgb;
  vec3 d = texture(uTex0, vUv + uTexel * vec2(-2.0,  0.0)).rgb;
  vec3 e = texture(uTex0, vUv).rgb;
  vec3 f = texture(uTex0, vUv + uTexel * vec2( 2.0,  0.0)).rgb;
  vec3 g = texture(uTex0, vUv + uTexel * vec2(-2.0, -2.0)).rgb;
  vec3 h = texture(uTex0, vUv + uTexel * vec2( 0.0, -2.0)).rgb;
  vec3 i = texture(uTex0, vUv + uTexel * vec2( 2.0, -2.0)).rgb;
  vec3 j = texture(uTex0, vUv + uTexel * vec2(-1.0,  1.0)).rgb;
  vec3 k = texture(uTex0, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
  vec3 l = texture(uTex0, vUv + uTexel * vec2(-1.0, -1.0)).rgb;
  vec3 m = texture(uTex0, vUv + uTexel * vec2( 1.0, -1.0)).rgb;
#ifdef FIRST_PASS
  // threshold + Karis average removes fireflies from tiny, extremely bright pixels
  vec3 g0 = prefilter((a + b + d + e) * 0.25);
  vec3 g1 = prefilter((b + c + e + f) * 0.25);
  vec3 g2 = prefilter((d + e + g + h) * 0.25);
  vec3 g3 = prefilter((e + f + h + i) * 0.25);
  vec3 g4 = prefilter((j + k + l + m) * 0.25);
  float w0 = 0.125 * karis(g0), w1 = 0.125 * karis(g1), w2 = 0.125 * karis(g2), w3 = 0.125 * karis(g3), w4 = 0.5 * karis(g4);
  vec3 col = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
  fragColor = vec4(col, 1.0);
#else
  vec3 col = (j + k + l + m) * 0.125 + (a + b + d + e) * 0.03125 + (b + c + e + f) * 0.03125 + (d + e + g + h) * 0.03125 + (e + f + h + i) * 0.03125;
  fragColor = vec4(col, 1.0);
#endif
}
`;

export const bloomUpFrag = /* glsl */ `
uniform sampler2D uTex0;   // lower (smaller) level
uniform sampler2D uTex1;   // current down level
uniform vec2 uTexel;       // 1 / lower size
uniform float uRadius;
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec2 t = uTexel;
  vec3 up = texture(uTex0, vUv + t * vec2(-1.0,  1.0)).rgb
          + texture(uTex0, vUv + t * vec2( 0.0,  1.0)).rgb * 2.0
          + texture(uTex0, vUv + t * vec2( 1.0,  1.0)).rgb
          + texture(uTex0, vUv + t * vec2(-1.0,  0.0)).rgb * 2.0
          + texture(uTex0, vUv).rgb * 4.0
          + texture(uTex0, vUv + t * vec2( 1.0,  0.0)).rgb * 2.0
          + texture(uTex0, vUv + t * vec2(-1.0, -1.0)).rgb
          + texture(uTex0, vUv + t * vec2( 0.0, -1.0)).rgb * 2.0
          + texture(uTex0, vUv + t * vec2( 1.0, -1.0)).rgb;
  up *= 1.0 / 16.0;
  vec3 high = texture(uTex1, vUv).rgb;
  fragColor = vec4(mix(high, up, uRadius), 1.0);
}
`;

export const lumFrag = /* glsl */ `
uniform sampler2D uTex0;
uniform vec2 uTexel;   // 1 / scene size
uniform vec2 uStep;    // sampling footprint in scene texels
in vec2 vUv;
out vec4 fragColor;
void main() {
  float sum = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec3 c = texture(uTex0, vUv + vec2(float(x), float(y)) * uStep * uTexel).rgb;
      c = min(c, vec3(48.0));
      sum += log2(max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-4));
    }
  }
  fragColor = vec4(sum / 9.0, 0.0, 0.0, 1.0);
}
`;

export const adaptFrag = /* glsl */ `
uniform sampler2D uTex0;   // log-luminance (mipmapped)
uniform sampler2D uTex1;   // previous adapted luminance
uniform float uDt;
uniform float uSpeedUp;
uniform float uSpeedDown;
uniform float uFirst;
uniform float uMaxLod;
in vec2 vUv;
out vec4 fragColor;
void main() {
  float cur = exp2(textureLod(uTex0, vec2(0.5), uMaxLod).r);
  float prev = texture(uTex1, vec2(0.5)).r;
  float speed = cur > prev ? uSpeedUp : uSpeedDown;
  float k = uFirst > 0.5 ? 1.0 : 1.0 - exp(-uDt * speed);
  fragColor = vec4(prev + (cur - prev) * k, 0.0, 0.0, 1.0);
}
`;

export const compositeFrag = /* glsl */ `
#include <common>
uniform sampler2D uTex0;   // HDR scene
uniform sampler2D uTex1;   // bloom
uniform sampler2D uTex2;   // adapted luminance
uniform sampler2D uTex3;   // volumetric fog: rgb in-scatter, a transmittance
uniform sampler2D uTex4;   // lens flare
uniform vec4 uParams5;     // x flare intensity, y lens distortion, z grade enabled
uniform vec3 uSlope;       // ASC CDL (applied in display space)
uniform vec3 uOffset;
uniform vec3 uPower;
uniform vec4 uParams0;     // x exposure, y bloom intensity, z vignette, w grain
uniform vec4 uParams1;     // x saturation, y contrast, z chromatic aberration, w tone mapper
uniform vec4 uParams2;     // x auto exposure, y key, z min lum, w max lum
uniform vec2 uParams3;     // x time, y aspect
uniform vec2 uParams4;     // x sharpen, y temperature (-1 cool … +1 warm)
uniform float uFogEnabled;
in vec2 vUv;
out vec4 fragColor;

vec3 acesFilm(vec3 v) {
  const mat3 inM = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 outM = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  v = inM * (v / 0.6);
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return clamp(outM * (a / b), 0.0, 1.0);
}
// Khronos PBR Neutral – keeps base colours faithful, only compresses highlights
vec3 neutral(vec3 color) {
  const float startCompression = 0.8 - 0.04;
  const float desaturation = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return color;
  const float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / (peak + d - startCompression);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}
vec3 reinhard(vec3 c) {
  float l = luma(c);
  float tl = l * (1.0 + l / 16.0) / (1.0 + l);
  return clamp(c * (tl / max(l, 1e-5)), 0.0, 1.0);
}
// Hable / Uncharted 2 filmic curve
vec3 hableCurve(vec3 x) {
  const float A = 0.15, B = 0.50, C = 0.10, D = 0.20, E = 0.02, F = 0.30;
  return ((x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F)) - E / F;
}
vec3 filmic(vec3 c) {
  return clamp(hableCurve(c * 2.0) / hableCurve(vec3(11.2)), 0.0, 1.0);
}
// AgX (Troy Sobotka / Blender / Filament) – hue-preserving highlight roll-off, very photographic
vec3 agxContrast(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 agx(vec3 color) {
  const mat3 toRec2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
  const mat3 fromRec2020 = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
  const mat3 inset = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
  const mat3 outset = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
  const float minEv = -12.47393;
  const float maxEv = 4.026069;
  color = inset * (toRec2020 * color);
  color = max(color, vec3(1e-10));
  color = clamp((log2(color) - minEv) / (maxEv - minEv), 0.0, 1.0);
  color = agxContrast(color);
  color = outset * color;
  color = pow(max(color, vec3(0.0)), vec3(2.2));
  return clamp(fromRec2020 * color, 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec2 uv = vUv;
  vec2 dir = uv - 0.5;
  // barrel / pincushion lens distortion
  if (uParams5.y != 0.0) {
    float kd = uParams5.y;
    // for barrel distortion the corners would sample outside the image → zoom just enough to keep the edge clean
    uv = 0.5 + dir * (1.0 + kd * dot(dir, dir) * 4.0) / (kd > 0.0 ? 1.0 + 2.0 * kd : 1.0);
  }
  vec3 col;
  float ca = uParams1.z;
  if (ca > 0.0) {
    col.r = texture(uTex0, uv + dir * ca).r;
    col.g = texture(uTex0, uv).g;
    col.b = texture(uTex0, uv - dir * ca).b;
  } else {
    col = texture(uTex0, uv).rgb;
  }

  // volumetric fog: applied in linear HDR, before tone mapping, so light shafts
  // tone-map consistently with the rest of the scene instead of being added as a flat overlay
  if (uFogEnabled > 0.5) {
    vec4 fog = texture(uTex3, uv);
    col = col * fog.a + fog.rgb;
  }

  // unsharp mask (compensates TAA softness); deltas are limited so HDR highlights can't ring
  if (uParams4.x > 0.0) {
    vec2 tx = 1.0 / vec2(textureSize(uTex0, 0));
    vec3 nb = min(texture(uTex0, uv + vec2(tx.x, 0.0)).rgb, vec3(32.0)) + min(texture(uTex0, uv - vec2(tx.x, 0.0)).rgb, vec3(32.0))
            + min(texture(uTex0, uv + vec2(0.0, tx.y)).rgb, vec3(32.0)) + min(texture(uTex0, uv - vec2(0.0, tx.y)).rgb, vec3(32.0));
    vec3 dlt = clamp(col - nb * 0.25, -col, col);
    col = max(col + dlt * uParams4.x, 0.0);
  }

  col += texture(uTex1, uv).rgb * uParams0.y;
  if (uParams5.x > 0.0) col += texture(uTex4, uv).rgb * uParams5.x;
  col *= vec3(1.0 + 0.22 * uParams4.y, 1.0 + 0.02 * uParams4.y, 1.0 - 0.22 * uParams4.y);

  float exposure = uParams0.x;
  if (uParams2.x > 0.5) {
    float lum = clamp(texture(uTex2, vec2(0.5)).r, uParams2.z, uParams2.w);
    exposure *= uParams2.y / lum;
  }
  col *= exposure;

  float vig = smoothstep(0.95, 0.25, length(dir * vec2(uParams3.y, 1.0)) * 1.25);
  col *= mix(1.0, vig, uParams0.z);

  int tm = int(uParams1.w + 0.5);
  if (tm == 1) col = reinhard(col);
  else if (tm == 2) col = acesFilm(col);
  else if (tm == 3) col = neutral(col);
  else if (tm == 4) col = filmic(col);
  else if (tm == 5) col = agx(col);
  else col = clamp(col, 0.0, 1.0);

  float l = luma(col);
  col = mix(vec3(l), col, uParams1.x);
  col = toSRGB(col);
  col = (col - 0.5) * uParams1.y + 0.5;
  if (uParams5.z > 0.5) col = pow(max(col * uSlope + uOffset, vec3(0.0)), uPower);

  // film grain + triangular dither (kills banding in smooth sky gradients)
  float n1 = interleavedGradientNoise(gl_FragCoord.xy + uParams3.x * 61.0);
  float n2 = interleavedGradientNoise(gl_FragCoord.xy + 17.0 + uParams3.x * 43.0);
  col += (n1 + n2 - 1.0) * (1.0 / 255.0 + uParams0.w * 0.06);
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

/**
 * Screen-space lens flare (Chapman): ghosts mirrored through the image centre, a ring halo and
 * per-channel chromatic offset. Reads the thresholded, blurred bloom pyramid, so only genuinely
 * bright light sources (sun, lamps, neon) produce flares.
 */
export const lensFlareFrag = /* glsl */ `
uniform sampler2D uTex0;
uniform vec4 uFlare;   // x ghost count, y dispersal, z halo width, w chromatic offset
uniform float uFlareThreshold;  // scene-linear brightness a pixel needs before it can flare
in vec2 vUv;
out vec4 fragColor;
// only genuinely intense sources (sun, lamps, neon) pass – ordinary bright surfaces and sky never flare
vec3 src(vec2 uv) {
  vec3 c = texture(uTex0, uv).rgb;
  float l = max(c.r, max(c.g, c.b));
  return c * smoothstep(uFlareThreshold, uFlareThreshold * 2.0, l);
}
vec3 chroma(vec2 uv, vec2 dir, float d) {
  return vec3(src(uv + dir * d).r, src(uv).g, src(uv - dir * d).b);
}
void main() {
  vec2 uv = vec2(1.0) - vUv;
  vec2 ghostVec = (vec2(0.5) - uv) * uFlare.y;
  float gLen = length(ghostVec);
  vec2 ndir = gLen > 1e-5 ? ghostVec / gLen : vec2(0.0);
  vec3 res = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    if (float(i) >= uFlare.x) break;
    vec2 off = fract(uv + ghostVec * float(i));
    float w = pow(max(1.0 - length(vec2(0.5) - off) / 0.70710678, 0.0), 3.0);
    // coated-lens tint cycles through the spectrum
    vec3 tint = 0.6 + 0.4 * cos(6.2831853 * (float(i) * 0.19 + vec3(0.0, 0.33, 0.67)));
    res += chroma(off, ndir, uFlare.w) * w * tint;
  }
  vec2 haloUv = fract(uv + ndir * uFlare.z);
  float wh = pow(max(1.0 - length(vec2(0.5) - haloUv) / 0.70710678, 0.0), 5.0);
  res += chroma(haloUv, ndir, uFlare.w) * wh;
  fragColor = vec4(min(res, vec3(24.0)), 1.0);
}
`;
