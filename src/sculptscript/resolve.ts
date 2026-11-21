import * as THREE from "three";
import type { Part } from "../engine/part";
import type { SculptEngine } from "../engine/engine";

/**
 * Posisi di SculptScript bisa ditulis dengan 3 cara, bisa dicampur bebas:
 *
 *   "top"                      -> anchor pada bbox part (lihat ANCHORS di bawah)
 *   "front-top-right"          -> gabungan anchor per sumbu
 *   [0.1, 0.3, -0.05]          -> offset manual (unit dunia) dari pusat bbox
 *   { anchor: "top", offset: [0, 0.05, 0] } -> anchor + offset tambahan
 *
 * Hasil akhir SELALU diproyeksikan ke permukaan mesh terdekat (closestSurfacePoint),
 * supaya brush selalu "menempel" di permukaan walau anchor/offset menembus ke
 * dalam/luar mesh. Ini meniru bagaimana raycast manual bekerja, tapi tanpa kamera.
 */

export type PositionSpec =
  | string
  | [number, number, number]
  | { anchor?: string; offset?: [number, number, number] };

// Setiap anchor = posisi relatif dalam bbox part, 0..1 per sumbu.
// y: 0 = bawah, 1 = atas. z disini dipetakan sebagai depan(+)/belakang(-) mengikuti
// konvensi kamera default engine (depan = +z di sebagian besar primitive).
const AXIS_WORDS: Record<string, { axis: "x" | "y" | "z"; t: number }> = {
  top: { axis: "y", t: 1 },
  bottom: { axis: "y", t: 0 },
  left: { axis: "x", t: 0 },
  right: { axis: "x", t: 1 },
  front: { axis: "z", t: 1 },
  back: { axis: "z", t: 0 },
};

function parseAnchor(name: string): { x: number; y: number; z: number } {
  // "center" dan setiap kata yang tidak dikenali di AXIS_WORDS otomatis jatuh ke 0.5
  // (tengah) pada sumbu itu, karena nilai awal t sudah 0.5 di semua sumbu dan hanya
  // ditimpa oleh kata yang cocok di AXIS_WORDS.
  const t = { x: 0.5, y: 0.5, z: 0.5 };
  const parts = name.toLowerCase().split(/[\s-_]+/).filter(Boolean);
  for (const w of parts) {
    const a = AXIS_WORDS[w];
    if (a) t[a.axis] = a.t;
  }
  return t;
}

/** Ubah PositionSpec jadi titik di koordinat lokal part (sebelum di-snap ke permukaan). */
function toRawPoint(part: Part, spec: PositionSpec): THREE.Vector3 {
  const box = part.bbox;
  const size = box.getSize(new THREE.Vector3());
  const min = box.min;

  if (Array.isArray(spec)) {
    // koordinat manual: offset dari pusat bbox, dalam unit dunia
    const c = box.getCenter(new THREE.Vector3());
    return c.add(new THREE.Vector3(spec[0], spec[1], spec[2]));
  }

  if (typeof spec === "string") {
    const t = parseAnchor(spec);
    return new THREE.Vector3(
      min.x + size.x * t.x,
      min.y + size.y * t.y,
      min.z + size.z * t.z
    );
  }

  // object form: { anchor, offset }
  const t = spec.anchor ? parseAnchor(spec.anchor) : { x: 0.5, y: 0.5, z: 0.5 };
  const base = new THREE.Vector3(
    min.x + size.x * t.x,
    min.y + size.y * t.y,
    min.z + size.z * t.z
  );
  if (spec.offset) base.add(new THREE.Vector3(spec.offset[0], spec.offset[1], spec.offset[2]));
  return base;
}

/** Resolusi penuh: anchor/koordinat -> titik permukaan nyata + normal, siap dipakai scriptDab. */
export function resolvePosition(
  engine: SculptEngine,
  part: Part,
  spec: PositionSpec
): { point: THREE.Vector3; normal: THREE.Vector3 } {
  const raw = toRawPoint(part, spec);
  return engine.closestSurfacePoint(part, raw);
}

/** Radius dalam SculptScript ditulis sebagai fraksi dari ukuran terbesar bbox part (0..1), supaya skrip preset tetap proporsional di objek besar/kecil apa pun. */
export function resolveRadius(part: Part, fraction: number): number {
  const size = part.bbox.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 1e-5);
  return maxDim * fraction;
}
