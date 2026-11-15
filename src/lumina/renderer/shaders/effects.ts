/**
 * Screen-space effects that need the G-buffer: TAA, SSR, depth of field and motion blur.
 * Every shader here includes <ubo_camera> + <depth_util>, so linZ()/skyVelocity() etc. are shared.
 */

export const taaFrag = /* glsl */ `
#include <common>
#include <ubo_camera>
#include <depth_util>
uniform sampler2D uTex0;   // current frame (HDR, jittered)
uniform sampler2D uTex1;   // history (HDR, resolved)
uniform sampler2D uTex2;   // G-buffer RT0: velocity.xy
uniform sampler2D uTex3;   // depth
uniform vec4 uTaa;         // x = history weight, y = reset flag
in vec2 vUv;
layout(location = 0) out vec4 fragColor;

float sane1(float x) { return x >= 0.0 ? min(x, 1e4) : 0.0; }   // also kills NaN
vec3 sane(vec3 c) { return vec3(sane1(c.r), sane1(c.g), sane1(c.b)); }
// reversible tone curve: bright pixels no longer dominate the neighbourhood statistics
vec3 tmap(vec3 c) { return c / (1.0 + luma(c)); }
vec3 itmap(vec3 c) { return c / max(1.0 - luma(c), 1e-4); }

// Catmull-Rom history filter in 5 bilinear taps (Jimenez, SIGGRAPH 2016) – keeps the image sharp
vec3 sampleHistory(vec2 uv, vec2 texSize) {
  vec2 pos = uv * texSize;
  vec2 tc = floor(pos - 0.5) + 0.5;
  vec2 f = pos - tc;
  vec2 f2 = f * f;
  vec2 f3 = f2 * f;
  vec2 w0 = f2 - 0.5 * (f3 + f);
  vec2 w1 = 1.5 * f3 - 2.5 * f2 + 1.0;
  vec2 w3 = 0.5 * (f3 - f2);
  vec2 w2 = 1.0 - w0 - w1 - w3;
  vec2 w12 = w1 + w2;
  vec2 tc0 = (tc - 1.0) / texSize;
  vec2 tc3 = (tc + 2.0) / texSize;
  vec2 tc12 = (tc + w2 / w12) / texSize;
  vec3 r = vec3(0.0);
  r += sane(texture(uTex1, vec2(tc12.x, tc0.y)).rgb) * (w12.x * w0.y);
  r += sane(texture(uTex1, vec2(tc0.x, tc12.y)).rgb) * (w0.x * w12.y);
  r += sane(texture(uTex1, vec2(tc12.x, tc12.y)).rgb) * (w12.x * w12.y);
  r += sane(texture(uTex1, vec2(tc3.x, tc12.y)).rgb) * (w3.x * w12.y);
  r += sane(texture(uTex1, vec2(tc12.x, tc3.y)).rgb) * (w12.x * w3.y);
  float wsum = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  return max(r / max(wsum, 1e-4), 0.0);
}

void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  ivec2 sz = textureSize(uTex0, 0);
  ivec2 maxP = sz - 1;

  vec3 m1 = vec3(0.0), m2 = vec3(0.0), cmin = vec3(1e5), cmax = vec3(-1e5), cc = vec3(0.0);
  float closest = 2.0;
  ivec2 closestP = ip;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      ivec2 q = clamp(ip + ivec2(dx, dy), ivec2(0), maxP);
      vec3 c = tmap(sane(texelFetch(uTex0, q, 0).rgb));
      m1 += c;
      m2 += c * c;
      cmin = min(cmin, c);
      cmax = max(cmax, c);
      if (dx == 0 && dy == 0) cc = c;
      // velocity of the closest sample → crisp moving silhouettes (no ghost halo)
      float dd = texelFetch(uTex3, q, 0).r;
      if (dd < closest) { closest = dd; closestP = q; }
    }
  }
  vec3 mean = m1 / 9.0;
  vec3 sigma = sqrt(max(m2 / 9.0 - mean * mean, 0.0));

  vec2 vel = closest >= 1.0 ? skyVelocity(vUv) : texelFetch(uTex2, closestP, 0).xy;
  vec2 prevUv = vUv - vel;
  bool offscreen = any(lessThan(prevUv, vec2(0.0))) || any(greaterThan(prevUv, vec2(1.0)));
  if (uTaa.y > 0.5 || offscreen) {
    fragColor = vec4(itmap(cc), 1.0);
    return;
  }

  vec3 hist = tmap(sampleHistory(prevUv, vec2(sz)));
  // variance clipping toward the neighbourhood mean (Salvi 2016)
  vec3 ext = sigma * 1.25 + 1e-4;
  vec3 v = hist - mean;
  float t = max(max(abs(v.x) / ext.x, abs(v.y) / ext.y), abs(v.z) / ext.z);
  if (t > 1.0) hist = mean + v / t;
  hist = clamp(hist, cmin, cmax);

  float alpha = clamp(1.0 - uTaa.x, 0.02, 1.0);
  float vPx = length(vel * vec2(sz));
  alpha = mix(alpha, max(alpha, 0.3), saturate(vPx * 0.2));
  vec3 col = mix(hist, cc, alpha);
  fragColor = vec4(itmap(col), 1.0);
}
`;

/** Half-resolution ray march. rgb = hit radiance × confidence (premultiplied), a = confidence. */
export const ssrTraceFrag = /* glsl */ `
#include <common>
#include <ubo_camera>
#include <depth_util>
uniform sampler2D uTex0;   // depth
uniform sampler2D uTex1;   // G-buffer RT0 (velocity.xy, oct normal.zw)
uniform sampler2D uTex2;   // G-buffer RT1 (F0.rgb, roughness)
uniform sampler2D uTex3;   // scene colour (HDR)
uniform vec2 uInvOutSize;
uniform vec4 uSSR;         // x = max distance, y = thickness, z = max roughness, w = steps
uniform float uFrame;
in vec2 vUv;
layout(location = 0) out vec4 fragColor;

float rayDiff(vec2 s0, vec2 s1, float k0, float k1, float t) {
  float rz = 1.0 / mix(k0, k1, t);
  return rz - linZ(textureLod(uTex0, mix(s0, s1, t), 0.0).r);
}

void main() {
  vec2 uv = gl_FragCoord.xy * uInvOutSize;
  fragColor = vec4(0.0);
  float d = textureLod(uTex0, uv, 0.0).r;
  if (d >= 1.0) return;
  vec4 mat = textureLod(uTex2, uv, 0.0);
  float rough = mat.a;
  if (rough > uSSR.z) return;

  vec3 Nw = octDecode(textureLod(uTex1, uv, 0.0).zw);
  vec3 N = normalize(mat3(uView) * Nw);
  vec3 P = viewPosFromDepth(uv, d);
  vec3 V = normalize(P);
  float noise = interleavedGradientNoise(gl_FragCoord.xy + uFrame * 5.588238);

  vec3 R = reflect(V, N);
  if (rough > 0.03) {
    vec3 rnd = vec3(interleavedGradientNoise(gl_FragCoord.xy + 11.1 + uFrame * 3.1),
                    interleavedGradientNoise(gl_FragCoord.xy + 37.7 + uFrame * 1.7),
                    interleavedGradientNoise(gl_FragCoord.xy + 71.3 + uFrame * 2.3)) * 2.0 - 1.0;
    R = normalize(R + rnd * rough * rough * 0.7);
    if (dot(R, N) < 0.0) R = reflect(R, N);
  }

  float rayLen = uSSR.x;
  if (P.z + R.z * rayLen > -uCamParams.x * 1.001) {
    if (R.z < 1e-5) return;
    rayLen = min(rayLen, (-uCamParams.x * 1.001 - P.z) / R.z);
  }
  vec3 E = P + R * rayLen;
  vec4 h0 = uProj * vec4(P, 1.0);
  vec4 h1 = uProj * vec4(E, 1.0);
  float k0 = 1.0 / h0.w, k1 = 1.0 / h1.w;
  vec2 s0 = h0.xy * k0 * 0.5 + 0.5;
  vec2 s1 = h1.xy * k1 * 0.5 + 0.5;
  float lenPx = length((s1 - s0) * uScreen.xy);
  if (lenPx < 1.5) return;

  int maxSteps = int(uSSR.w);
  int steps = int(clamp(lenPx * 0.5, 8.0, uSSR.w));
  float tPrev = 0.0;
  float tHit = -1.0;
  for (int i = 0; i < 128; i++) {
    if (i >= steps) break;
    float t = (float(i) + 1.0 + noise) / (float(steps) + 1.0);
    vec2 suv = mix(s0, s1, t);
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) break;
    float rz = 1.0 / mix(k0, k1, t);
    float sd = linZ(textureLod(uTex0, suv, 0.0).r);
    float diff = rz - sd;
    float thick = uSSR.y + sd * 0.03;
    if (diff > 0.01 + rz * 0.003 && diff < thick) {
      float lo = tPrev, hi = t;
      for (int j = 0; j < 6; j++) {
        float mid = 0.5 * (lo + hi);
        if (rayDiff(s0, s1, k0, k1, mid) > 0.0) hi = mid; else lo = mid;
      }
      tHit = hi;
      break;
    }
    tPrev = t;
  }
  if (tHit < 0.0 || maxSteps < 1) return;

  vec2 huv = mix(s0, s1, tHit);
  float hd = textureLod(uTex0, huv, 0.0).r;
  if (hd >= 1.0) return;
  vec3 Nh = octDecode(textureLod(uTex1, huv, 0.0).zw);
  vec3 Rw = R * mat3(uView);                       // view → world (rotation only)
  float backFace = dot(Nh, Rw);

  float conf = 1.0 - smoothstep(0.0, 0.3, backFace);
  vec2 e = min(huv, 1.0 - huv);
  conf *= smoothstep(0.0, 0.08, min(e.x, e.y));
  float hitDist = length(viewPosFromDepth(huv, hd) - P);
  float df = saturate(hitDist / uSSR.x);
  conf *= 1.0 - df * df;
  conf *= 1.0 - smoothstep(0.4, 0.95, R.z);
  conf *= 1.0 - smoothstep(uSSR.z * 0.5, uSSR.z, rough);

  vec3 col = min(textureLod(uTex3, huv, 0.0).rgb, vec3(40.0));
  fragColor = vec4(col * conf, conf);
}
`;

/** Full-resolution composite: replaces the environment specular by the traced reflection where a hit exists. */
export const ssrApplyFrag = /* glsl */ `
#include <common>
#include <ubo_camera>
#include <ubo_lights>
#include <depth_util>
uniform sampler2D uTex0;   // scene colour
uniform sampler2D uTex1;   // blurred SSR (half-res, premultiplied)
uniform sampler2D uTex2;   // G-buffer RT0
uniform sampler2D uTex3;   // G-buffer RT1
uniform sampler2D uTex4;   // depth
uniform samplerCube uEnvCube;
uniform float uIntensity;
in vec2 vUv;
layout(location = 0) out vec4 fragColor;

// Karis 2014 analytic split-sum approximation (mobile PBR)
vec3 envBRDFApprox(vec3 F0, float rough, float NoV) {
  const vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
  const vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
  vec4 r = rough * c0 + c1;
  float a004 = min(r.x * r.x, exp2(-9.28 * NoV)) * r.x + r.y;
  vec2 AB = vec2(-1.04, 1.04) * a004 + r.zw;
  return F0 * AB.x + AB.y;
}

void main() {
  vec3 scene = texture(uTex0, vUv).rgb;
  fragColor = vec4(scene, 1.0);
  float d = texture(uTex4, vUv).r;
  if (d >= 1.0) return;
  vec4 ssr = texture(uTex1, vUv);
  if (ssr.a < 1e-3) return;
  vec3 rad = ssr.rgb / ssr.a;
  float conf = saturate(ssr.a);

  vec4 mat = texture(uTex3, vUv);
  float rough = mat.a;
  vec3 N = octDecode(texture(uTex2, vUv).zw);
  vec3 wp = worldPosFromDepth(vUv, d);
  vec3 V = normalize(uCamPos.xyz - wp);
  float NoV = max(dot(N, V), 1e-3);
  vec3 F = envBRDFApprox(mat.rgb, rough, NoV);

  vec3 R = reflect(-V, N);
  R = normalize(mix(R, N, rough * rough));
  vec3 envSpec = textureLod(uEnvCube, R, rough * uEnvParams.y).rgb * uEnvParams.x * F;
  vec3 delta = conf * uIntensity * (rad * F - envSpec);
  fragColor = vec4(max(scene + delta, 0.0), 1.0);
}
`;

/** Thin-lens depth of field – scatter-as-gather bokeh with depth-aware weights. */
export const dofFrag = /* glsl */ `
#include <common>
#include <ubo_camera>
#include <depth_util>
uniform sampler2D uTex0;   // scene colour
uniform sampler2D uTex1;   // depth
uniform vec4 uDofA;        // x = focus distance (m), y = focal length (m), z = f-number, w = max blur radius (px)
uniform vec4 uDofB;        // x = taps, y = sensor height (m)
in vec2 vUv;
layout(location = 0) out vec4 fragColor;

float cocRadius(float z) {
  float f = uDofA.y;
  float S = uDofA.x;
  float A = f / uDofA.z;
  float c = A * f * (z - S) / (max(z, 1e-3) * max(S - f, 1e-3));
  return min(abs(c) / uDofB.y * uScreen.y * 0.5, uDofA.w);
}
float sceneZ(vec2 uv) { return linZ(textureLod(uTex1, uv, 0.0).r); }

void main() {
  vec3 center = texture(uTex0, vUv).rgb;
  fragColor = vec4(center, 1.0);
  float zC = sceneZ(vUv);
  float cocC = cocRadius(zC);
  int taps = int(uDofB.x);
  float R = uDofA.w;
  float rot = interleavedGradientNoise(gl_FragCoord.xy) * TWO_PI;
  vec3 acc = center;
  float wsum = 1.0;
  for (int i = 0; i < 64; i++) {
    if (i >= taps) break;
    vec2 o = vogelDisk(i, taps, rot) * R;
    float dist = length(o);
    vec2 uv2 = vUv + o * uScreen.zw;
    float zS = sceneZ(uv2);
    float cocS = cocRadius(zS);
    // a sharp foreground must not be smeared by the blurry background behind it
    float cocEff = zS > zC + 0.02 * zC ? min(cocS, cocC) : cocS;
    float w = saturate(cocEff - dist + 1.0);
    acc += min(texture(uTex0, uv2).rgb, vec3(60.0)) * w;
    wsum += w;
  }
  fragColor = vec4(acc / wsum, 1.0);
}
`;

/** Per-pixel motion blur along the G-buffer velocity (camera + object motion). */
export const motionBlurFrag = /* glsl */ `
#include <common>
#include <ubo_camera>
#include <depth_util>
uniform sampler2D uTex0;   // scene colour
uniform sampler2D uTex1;   // G-buffer RT0
uniform sampler2D uTex2;   // depth
uniform vec4 uMB;          // x = shutter scale, y = max length (uv), z = samples
in vec2 vUv;
layout(location = 0) out vec4 fragColor;
void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec3 center = texture(uTex0, vUv).rgb;
  float d = texelFetch(uTex2, ip, 0).r;
  vec2 v = d >= 1.0 ? skyVelocity(vUv) : texelFetch(uTex1, ip, 0).xy;
  v *= uMB.x;
  float l = length(v);
  if (l > uMB.y) v *= uMB.y / l;
  if (length(v * uScreen.xy) < 0.75) { fragColor = vec4(center, 1.0); return; }
  int n = int(uMB.z);
  float noise = interleavedGradientNoise(gl_FragCoord.xy);
  vec3 acc = center;
  for (int i = 0; i < 32; i++) {
    if (i >= n) break;
    float t = (float(i) + noise) / float(n) - 0.5;
    acc += min(texture(uTex0, clamp(vUv + v * t, vec2(0.001), vec2(0.999))).rgb, vec3(60.0));
  }
  fragColor = vec4(acc / float(n + 1), 1.0);
}
`;

// ═════════════════════════════ Screen-Space Global Illumination ═════════════════════════════
// Diffuse indirect bounce (Lumen-style colour bleeding) gathered from the already lit frame:
//   trace (half-res, cosine-weighted rays) → temporal accumulation → bilateral blur → apply × albedo

const ssgiHash = /* glsl */ `
float giHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

export const ssgiTraceFrag = /* glsl */ `
#include <common>
#include <ubo_camera>
#include <depth_util>
${ssgiHash}
uniform sampler2D uTex0;   // depth (full-res)
uniform sampler2D uTex1;   // G-buffer RT0: velocity.xy, oct normal.zw
uniform sampler2D uTex2;   // lit scene colour (HDR)
uniform vec4 uGI;          // x = radius (m), y = thickness (m), z = rays, w = steps
uniform vec4 uGI2;         // x = frame, y = max radiance (firefly clamp)
in vec2 vUv;
layout(location = 0) out vec4 fragColor;

vec2 giProject(vec3 vp) {
  vec4 h = uProj * vec4(vp, 1.0);
  return h.xy / h.w * 0.5 + 0.5;
}

void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  ivec2 fs = textureSize(uTex0, 0);
  ivec2 fullP = min(ip * 2, fs - 1);
  fragColor = vec4(0.0);
  float d = texelFetch(uTex0, fullP, 0).r;
  if (d >= 1.0) return;
  vec2 uv = (vec2(fullP) + 0.5) / vec2(fs);
  vec3 P = viewPosFromDepth(uv, d);
  vec3 N = normalize(mat3(uView) * octDecode(texelFetch(uTex1, fullP, 0).zw));

  vec3 up = abs(N.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
  vec3 T = normalize(cross(up, N));
  vec3 B = cross(N, T);
  vec3 O = P + N * (0.012 + 0.004 * -P.z);

  int rays = int(uGI.z);
  int steps = int(uGI.w);
  float R = uGI.x;
  vec3 acc = vec3(0.0);
  for (int r = 0; r < 4; r++) {
    if (r >= rays) break;
    vec2 seed = gl_FragCoord.xy + vec2(uGI2.x * 7.13 + float(r) * 31.7, uGI2.x * 3.31 + float(r) * 17.3);
    vec2 xi = vec2(giHash(seed), giHash(seed.yx * 1.37 + 19.19));
    float jit = giHash(seed * 0.73 + 5.5);
    float phi = TWO_PI * xi.x;
    float rr = sqrt(xi.y);
    vec3 dir = normalize(T * (cos(phi) * rr) + B * (sin(phi) * rr) + N * sqrt(max(1.0 - xi.y, 0.0)));

    float maxT = R;
    if (O.z + dir.z * maxT > -uCamParams.x * 1.01) {
      if (dir.z < 1e-5) continue;
      maxT = (-uCamParams.x * 1.01 - O.z) / dir.z;
    }
    float tPrev = 0.0;
    float tHit = -1.0;
    for (int i = 0; i < 32; i++) {
      if (i >= steps) break;
      float f = (float(i) + jit) / float(steps);
      float t = maxT * f * f;
      vec3 sp = O + dir * t;
      vec2 suv = giProject(sp);
      if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) break;
      float sd = linZ(textureLod(uTex0, suv, 0.0).r);
      float rz = -sp.z;
      float diff = rz - sd;
      if (diff > 0.02 + rz * 0.004 && diff < uGI.y + (t - tPrev) + rz * 0.01) {
        float lo = tPrev, hi = t;
        for (int j = 0; j < 4; j++) {
          float mid = 0.5 * (lo + hi);
          vec3 mp = O + dir * mid;
          if (-mp.z - linZ(textureLod(uTex0, giProject(mp), 0.0).r) > 0.0) hi = mid; else lo = mid;
        }
        tHit = hi;
        break;
      }
      tPrev = t;
    }
    if (tHit < 0.0) continue;
    vec2 huv = giProject(O + dir * tHit);
    ivec2 hp = clamp(ivec2(huv * vec2(fs)), ivec2(0), fs - 1);
    if (texelFetch(uTex0, hp, 0).r >= 1.0) continue;
    vec3 Nh = octDecode(texelFetch(uTex1, hp, 0).zw);
    vec3 dirW = dir * mat3(uView);                   // view → world
    if (dot(Nh, dirW) > 0.25) continue;              // hit the back of a surface
    vec2 e = min(huv, 1.0 - huv);
    float w = (1.0 - smoothstep(0.5 * R, R, tHit)) * smoothstep(0.0, 0.06, min(e.x, e.y));
    acc += min(textureLod(uTex2, huv, 0.0).rgb, vec3(uGI2.y)) * w;
  }
  fragColor = vec4(acc / float(max(rays, 1)), 1.0);
}
`;

export const ssgiTemporalFrag = /* glsl */ `
#include <common>
#include <ubo_camera>
#include <depth_util>
uniform sampler2D uTex0;   // raw trace (half-res)
uniform sampler2D uTex1;   // history (half-res): rgb = GI, a = linear depth
uniform sampler2D uTex2;   // G-buffer RT0 (velocity)
uniform sampler2D uTex3;   // depth (full-res)
uniform vec4 uGIT;         // x = history weight, y = reset flag
in vec2 vUv;
layout(location = 0) out vec4 fragColor;

void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  ivec2 hs = textureSize(uTex0, 0);
  ivec2 fs = textureSize(uTex3, 0);
  ivec2 fullP = min(ip * 2, fs - 1);
  float d = texelFetch(uTex3, fullP, 0).r;
  if (d >= 1.0) { fragColor = vec4(0.0); return; }
  float z = linZ(d);
  vec3 cur = texelFetch(uTex0, ip, 0).rgb;

  vec3 m1 = vec3(0.0), m2 = vec3(0.0);
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      vec3 c = texelFetch(uTex0, clamp(ip + ivec2(dx, dy), ivec2(0), hs - 1), 0).rgb;
      m1 += c;
      m2 += c * c;
    }
  }
  vec3 mean = m1 / 9.0;
  vec3 sigma = sqrt(max(m2 / 9.0 - mean * mean, 0.0));

  vec2 vel = texelFetch(uTex2, fullP, 0).xy;
  vec2 uv = (vec2(ip) + 0.5) / vec2(hs);
  vec2 prevUv = uv - vel;
  vec4 hist = texture(uTex1, prevUv);
  bool inside = all(greaterThan(prevUv, vec2(0.0))) && all(lessThan(prevUv, vec2(1.0)));
  bool valid = uGIT.y < 0.5 && inside && abs(hist.a - z) < 0.05 * z + 0.02 && all(lessThan(hist.rgb, vec3(1e4)));
  float a = 1.0;
  vec3 h = hist.rgb;
  if (valid) {
    vec3 ext = sigma * 1.8 + 0.02;
    vec3 v = h - mean;
    float t = max(max(abs(v.x) / ext.x, abs(v.y) / ext.y), abs(v.z) / ext.z);
    if (t > 1.0) h = mean + v / t;
    a = clamp(1.0 - uGIT.x, 0.02, 1.0);
  }
  fragColor = vec4(mix(h, cur, a), z);
}
`;

export const ssgiBlurFrag = /* glsl */ `
#include <common>
#include <ubo_camera>
#include <depth_util>
${ssgiHash}
uniform sampler2D uTex0;   // temporal result (half-res)
uniform sampler2D uTex1;   // G-buffer RT0 (normals)
uniform sampler2D uTex2;   // depth (full-res)
uniform float uRadius;     // px (half-res)
in vec2 vUv;
layout(location = 0) out vec4 fragColor;

void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  ivec2 hs = textureSize(uTex0, 0);
  ivec2 fs = textureSize(uTex2, 0);
  vec4 c = texelFetch(uTex0, ip, 0);
  float z = c.a;
  if (z <= 0.0) { fragColor = c; return; }
  vec3 Nc = octDecode(texelFetch(uTex1, min(ip * 2, fs - 1), 0).zw);
  float rot = giHash(gl_FragCoord.xy) * TWO_PI;
  vec3 acc = c.rgb;
  float wsum = 1.0;
  for (int i = 0; i < 16; i++) {
    vec2 o = vogelDisk(i, 16, rot) * uRadius;
    ivec2 q = ip + ivec2(floor(o + 0.5));
    if (q.x < 0 || q.y < 0 || q.x >= hs.x || q.y >= hs.y) continue;
    vec4 s = texelFetch(uTex0, q, 0);
    if (s.a <= 0.0) continue;
    vec3 Nq = octDecode(texelFetch(uTex1, min(q * 2, fs - 1), 0).zw);
    float wz = exp(-abs(s.a - z) / (z * 0.03 + 0.01));
    float wn = pow(max(dot(Nc, Nq), 0.0), 12.0);
    float w = wz * wn;
    acc += s.rgb * w;
    wsum += w;
  }
  fragColor = vec4(acc / wsum, z);
}
`;

export const ssgiApplyFrag = /* glsl */ `
#include <common>
#include <ubo_camera>
#include <depth_util>
uniform sampler2D uTex0;   // scene colour
uniform sampler2D uTex1;   // filtered GI (half-res): rgb, a = linear depth
uniform sampler2D uTex2;   // G-buffer RT2: sqrt(albedo)
uniform sampler2D uTex3;   // depth (full-res)
uniform vec4 uGIA;         // x = intensity, y = debug view
in vec2 vUv;
layout(location = 0) out vec4 fragColor;

void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec3 scene = texelFetch(uTex0, ip, 0).rgb;
  fragColor = vec4(scene, 1.0);
  float d = texelFetch(uTex3, ip, 0).r;
  if (d >= 1.0) {
    if (uGIA.y > 0.5) fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  float z = linZ(d);
  ivec2 hs = textureSize(uTex1, 0);
  vec2 hp = (vec2(ip) + 0.5) * 0.5 - 0.5;
  ivec2 b = ivec2(floor(hp));
  vec2 f = hp - vec2(b);
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int k = 0; k < 4; k++) {
    ivec2 o = ivec2(k & 1, k >> 1);
    ivec2 q = clamp(b + o, ivec2(0), hs - 1);
    vec4 g = texelFetch(uTex1, q, 0);
    if (g.a <= 0.0) continue;
    float bw = (o.x == 1 ? f.x : 1.0 - f.x) * (o.y == 1 ? f.y : 1.0 - f.y);
    float w = max(bw, 1e-3) * exp(-abs(g.a - z) / (z * 0.03 + 0.01));
    acc += g.rgb * w;
    wsum += w;
  }
  vec3 gi = wsum > 1e-5 ? acc / wsum : vec3(0.0);
  vec3 sa = texelFetch(uTex2, ip, 0).rgb;
  vec3 albedo = sa * sa;
  vec3 bounce = albedo * gi * uGIA.x;
  fragColor = vec4(uGIA.y > 0.5 ? bounce * 2.0 : scene + bounce, 1.0);
}
`;
