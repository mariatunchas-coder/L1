export const fullscreenVert = /* glsl */ `
out vec2 vUv;
void main() {
  // single oversized triangle – no vertex buffers needed
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

/** Bakes the physically based atmosphere into one cube face (HDR). */
export const skyFrag = /* glsl */ `
#include <common>
#include <ibl_sampling>

uniform int uFace;
uniform vec3 uSunDir;
uniform vec3 uSunE;          // direct sun irradiance (colour * intensity) – used for ground bounce
uniform float uRayleigh;
uniform float uMie;
uniform float uMieG;
uniform float uSunI;
uniform float uBoost;
uniform vec3 uGroundAlbedo;

in vec2 vUv;
out vec4 fragColor;

const float Re = 6360e3;
const float Ra = 6420e3;
const float Hr = 7994.0;
const float Hm = 1200.0;
const vec3 betaR = vec3(3.8e-6, 5.421e-6, 13.558e-6);
const float betaM = 21e-6;
const int NS = 28;
const int NL = 8;

bool raySphere(vec3 o, vec3 d, float r, out float t0, out float t1) {
  float b = dot(o, d);
  float c = dot(o, o) - r * r;
  float disc = b * b - c;
  if (disc < 0.0) return false;
  float s = sqrt(disc);
  t0 = -b - s;
  t1 = -b + s;
  return true;
}

vec3 atmosphere(vec3 dir) {
  vec3 o = vec3(0.0, Re + 100.0, 0.0);
  float t0, t1;
  raySphere(o, dir, Ra, t0, t1);
  float tmax = t1;

  float mu = dot(dir, uSunDir);
  float phaseR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  float g = uMieG;
  float phaseM = 3.0 / (8.0 * PI) * ((1.0 - g * g) * (1.0 + mu * mu)) / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5));

  vec3 sumR = vec3(0.0), sumM = vec3(0.0);
  float optR = 0.0, optM = 0.0;
  vec3 bR = betaR * uRayleigh;
  float bM = betaM * uMie;

  for (int i = 0; i < NS; i++) {
    // quadratic spacing → more samples where the air is dense (near the viewer)
    float x = (float(i) + 0.5) / float(NS);
    float t = tmax * x * x;
    float dt = tmax * 2.0 * x / float(NS);
    vec3 p = o + dir * t;
    float h = length(p) - Re;
    float hr = exp(-h / Hr) * dt;
    float hm = exp(-h / Hm) * dt;
    optR += hr;
    optM += hm;

    // light ray toward the sun
    float l0, l1;
    raySphere(p, uSunDir, Ra, l0, l1);
    float e0, e1;
    bool earthShadow = raySphere(p, uSunDir, Re, e0, e1) && e0 > 0.0;
    if (earthShadow) continue;
    float ls = l1 / float(NL);
    float oLR = 0.0, oLM = 0.0;
    for (int j = 0; j < NL; j++) {
      vec3 lp = p + uSunDir * (ls * (float(j) + 0.5));
      float lh = length(lp) - Re;
      oLR += exp(-lh / Hr) * ls;
      oLM += exp(-lh / Hm) * ls;
    }
    vec3 tau = bR * (optR + oLR) + bM * 1.1 * (optM + oLM);
    vec3 attn = exp(-tau);
    sumR += attn * hr;
    sumM += attn * hm;
  }
  return uSunI * uBoost * (sumR * bR * phaseR + sumM * bM * phaseM);
}

void main() {
  vec3 dir = normalize(cubeFaceDir(uFace, vUv * 2.0 - 1.0));
  vec3 aboveDir = normalize(vec3(dir.x, max(dir.y, 0.0015), dir.z));
  vec3 sky = atmosphere(aboveDir);
  vec3 color = sky;
  if (dir.y < 0.0) {
    // below the horizon: lit ground (lambertian) fading into the haze at the horizon line
    vec3 ground = uGroundAlbedo * (uSunE * max(uSunDir.y, 0.0) * INV_PI + sky * 0.9);
    color = mix(ground, sky, exp(dir.y * 22.0));
  }
  fragColor = vec4(color, 1.0);
}
`;

export const irradianceFrag = /* glsl */ `
#include <common>
#include <ibl_sampling>
uniform samplerCube uCube;
uniform int uFace;
in vec2 vUv;
out vec4 fragColor;
void main() {
  vec3 N = normalize(cubeFaceDir(uFace, vUv * 2.0 - 1.0));
  vec3 up = abs(N.y) < 0.999 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 right = normalize(cross(up, N));
  up = cross(N, right);
  const float delta = 0.07;
  vec3 sum = vec3(0.0);
  float count = 0.0;
  for (float phi = 0.0; phi < TWO_PI; phi += delta) {
    for (float theta = 0.0; theta < 1.5707963; theta += delta) {
      vec3 ts = vec3(sin(theta) * cos(phi), sin(theta) * sin(phi), cos(theta));
      vec3 sv = ts.x * right + ts.y * up + ts.z * N;
      sum += textureLod(uCube, sv, 2.0).rgb * cos(theta) * sin(theta);
      count += 1.0;
    }
  }
  // stores E/pi, so diffuse = albedo * irradiance
  fragColor = vec4(PI * sum / count, 1.0);
}
`;

export const prefilterFrag = /* glsl */ `
#include <common>
#include <brdf>
#include <ibl_sampling>
uniform samplerCube uCube;
uniform int uFace;
uniform float uRoughness;
uniform float uSrcSize;
in vec2 vUv;
out vec4 fragColor;
#define SAMPLE_COUNT 112u
void main() {
  vec3 N = normalize(cubeFaceDir(uFace, vUv * 2.0 - 1.0));
  if (uRoughness < 0.002) {
    fragColor = vec4(textureLod(uCube, N, 0.0).rgb, 1.0);
    return;
  }
  vec3 V = N;
  float a = uRoughness * uRoughness;
  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  float saTexel = 4.0 * PI / (6.0 * uSrcSize * uSrcSize);
  for (uint i = 0u; i < SAMPLE_COUNT; i++) {
    vec2 Xi = hammersley(i, SAMPLE_COUNT);
    vec3 H = importanceSampleGGX(Xi, N, a);
    vec3 L = normalize(2.0 * dot(V, H) * H - V);
    float NoL = dot(N, L);
    if (NoL > 0.0) {
      float NoH = max(dot(N, H), 0.0);
      float HoV = max(dot(H, V), 1e-4);
      float D = D_GGX_simple(NoH, a);
      float pdf = D * NoH / (4.0 * HoV) + 1e-4;
      float saSample = 1.0 / (float(SAMPLE_COUNT) * pdf + 1e-4);
      float mip = 0.5 * log2(saSample / saTexel) + 1.0;
      sum += textureLod(uCube, L, mip).rgb * NoL;
      wsum += NoL;
    }
  }
  fragColor = vec4(sum / max(wsum, 1e-4), 1.0);
}
`;

export const brdfFrag = /* glsl */ `
#include <common>
#include <ibl_sampling>
in vec2 vUv;
out vec4 fragColor;
float G_SchlickIBL(float NoV, float roughness) {
  float k = (roughness * roughness) * 0.5;
  return NoV / (NoV * (1.0 - k) + k);
}
void main() {
  float NoV = max(vUv.x, 1e-3);
  float roughness = max(vUv.y, 0.02);
  vec3 V = vec3(sqrt(1.0 - NoV * NoV), 0.0, NoV);
  vec3 N = vec3(0.0, 0.0, 1.0);
  float a = roughness * roughness;
  float A = 0.0, B = 0.0;
  const uint COUNT = 256u;
  for (uint i = 0u; i < COUNT; i++) {
    vec2 Xi = hammersley(i, COUNT);
    vec3 H = importanceSampleGGX(Xi, N, a);
    vec3 L = normalize(2.0 * dot(V, H) * H - V);
    float NoL = max(L.z, 0.0);
    float NoH = max(H.z, 0.0);
    float VoH = max(dot(V, H), 0.0);
    if (NoL > 0.0) {
      float G = G_SchlickIBL(NoV, roughness) * G_SchlickIBL(NoL, roughness);
      float Gv = (G * VoH) / max(NoH * NoV, 1e-4);
      float Fc = pow(1.0 - VoH, 5.0);
      A += (1.0 - Fc) * Gv;
      B += Fc * Gv;
    }
  }
  fragColor = vec4(A / float(COUNT), B / float(COUNT), 0.0, 1.0);
}
`;

export const backgroundVert = /* glsl */ `
#include <ubo_camera>
out vec3 vDir;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vec4 ndc = vec4(p * 2.0 - 1.0, 1.0, 1.0);
  vec4 w = uInvViewProj * ndc;
  vDir = w.xyz / w.w - uCamPos.xyz;
  gl_Position = vec4(ndc.xy, 1.0, 1.0);   // depth = 1 → drawn only where nothing else was
}
`;

export const backgroundFrag = /* glsl */ `
#include <common>
#include <ubo_camera>
uniform samplerCube uSkyCube;
uniform vec3 uSunDir;
uniform vec3 uSunE;
uniform float uSunSize;
in vec3 vDir;
layout(location = 0) out vec4 fragColor;
void main() {
  vec3 dir = normalize(vDir);
  vec3 col = textureLod(uSkyCube, dir, 0.0).rgb;
  // analytic sun disk (cube is too coarse for it) – radiance clamped to the fp16 range
  float r = 0.00465 * uSunSize;
  // |dir x sun| = sin(angle): stays accurate for tiny angles where cos() collapses in fp32
  float ang = length(cross(dir, uSunDir));
  float disk = (1.0 - smoothstep(r * 0.9, r * 1.2, ang)) * step(0.0, dot(dir, uSunDir));
  float solid = PI * r * r;
  vec3 sunRadiance = min(uSunE / solid, vec3(20000.0));
  col += sunRadiance * disk * step(0.0, dir.y + 0.01);
  fragColor = vec4(col, 1.0);
}
`;
