import type { ToolId } from "../engine/engine";
import type { PositionSpec } from "./resolve";

/**
 * Field numerik di seluruh instruksi bisa berupa angka literal, ATAU ekspresi
 * teks sederhana yang dievaluasi saat instruksi dijalankan:
 *   - "$i"              -> index iterasi loop saat ini (0-based), hanya valid di dalam RepeatInstruction
 *   - "$namaVar"        -> nilai variabel yang didefinisikan lewat SetInstruction
 *   - "0.2 + $i * 0.05"  -> operasi matematis dasar (+ - * /) boleh dicampur dengan $i/$var
 * Dukungan operator sengaja dibatasi (bukan full JS eval) supaya aman dijalankan
 * dari input user tanpa risiko injeksi kode.
 */
export type NumExpr = number | string;

/**
 * SculptScript ditulis sebagai ARRAY INSTRUKSI (bukan teks bebas), mirip cara
 * SurfaceTool dipakai di Godot: tiap baris = satu perintah eksplisit.
 * Ini sengaja dibuat sebagai data (bukan string yang perlu diparse) supaya
 * aman dijalankan langsung dari kode TypeScript (preset) tanpa tahap parsing
 * teks sama sekali. Kalau nanti mau textarea bebas, tinggal tambah parser
 * yang menghasilkan array instruksi yang sama persis.
 */

export interface DabInstruction {
  op: "dab";
  tool: ToolId;
  at: PositionSpec;
  /** radius sebagai fraksi dari ukuran bbox part, misal 0.12 = 12% dimensi terbesar. Boleh ekspresi, mis. "0.1 + $i*0.01" */
  radius: NumExpr;
  /** 0..1, seberapa kuat efeknya. Boleh ekspresi. */
  strength: NumExpr;
  invert?: boolean;
  /** berapa kali dab diulang di titik yang sama (menumpuk efek, dipakai "clay"/"inflate" untuk hasil lebih tegas) */
  repeat?: number;
  /**
   * 0..1: variasi acak pada posisi (digeser acak dalam radius * jitter), radius, dan
   * strength (± jitter * nilai), dievaluasi ulang setiap repeat. Berguna dipakai di
   * dalam "repeat" supaya tiap iterasi terlihat organik, bukan identik berulang.
   */
  jitter?: number;
}

export interface LineInstruction {
  op: "line";
  tool: ToolId;
  from: PositionSpec;
  to: PositionSpec;
  radius: NumExpr;
  strength: NumExpr;
  invert?: boolean;
  steps?: number;
  jitter?: number;
}

/** Urutan dab melingkar di sekitar sebuah pusat, radius orbit dalam fraksi bbox juga. */
export interface RingInstruction {
  op: "ring";
  tool: ToolId;
  center: PositionSpec;
  /** radius orbit lingkaran (fraksi bbox) */
  orbit: NumExpr;
  /** radius brush tiap dab (fraksi bbox) */
  radius: NumExpr;
  strength: NumExpr;
  count: number;
  invert?: boolean;
  /** sumbu normal lingkaran: "x" | "y" | "z", default "y" (lingkaran horizontal) */
  axis?: "x" | "y" | "z";
  jitter?: number;
}

export interface SmoothAllInstruction {
  op: "smoothAll";
  iterations?: number;
  amount?: number;
}

export interface InflateAllInstruction {
  op: "inflateAll";
  amount: NumExpr;
}

/** Mendefinisikan/mengubah sebuah variabel yang bisa dipakai di instruksi sesudahnya lewat "$nama". */
export interface SetInstruction {
  op: "set";
  name: string;
  value: NumExpr;
}

/**
 * Mengulang satu atau beberapa instruksi sejumlah `count` kali. Di dalam `steps`,
 * field numerik boleh memakai "$i" (index iterasi, mulai dari 0) supaya tiap
 * iterasi bisa sedikit berbeda (radius membesar, strength mengecil, dll) tanpa
 * menulis ulang instruksi yang sama berkali-kali secara manual.
 */
export interface RepeatInstruction {
  op: "repeat";
  count: number;
  steps: SculptInstruction[];
}

export type SculptInstruction =
  | DabInstruction
  | LineInstruction
  | RingInstruction
  | SmoothAllInstruction
  | InflateAllInstruction
  | SetInstruction
  | RepeatInstruction;

export interface SculptScript {
  id: string;
  label: string;
  description: string;
  /** mirror otomatis diaktifkan sementara selama skrip ini berjalan, lalu dikembalikan ke setting semula */
  symmetry?: { x?: boolean; y?: boolean; z?: boolean };
  steps: SculptInstruction[];
}
