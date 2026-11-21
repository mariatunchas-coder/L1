import type { SculptScript } from "./types";

/**
 * Preset SculptScript. Semua posisi ditulis relatif (anchor/offset), bukan
 * koordinat absolut — jadi preset yang sama bekerja wajar di objek apa pun
 * (sphere default, karakter custom, dll), menyesuaikan ukuran bbox part
 * masing-masing secara otomatis.
 */
export const SCULPT_PRESETS: SculptScript[] = [
  {
    id: "ears",
    label: "Tambah Telinga",
    description: "Menonjolkan dua benjolan di sisi kiri-kanan bagian atas sebagai dasar telinga, lalu menajamkan tepinya.",
    symmetry: { x: true },
    steps: [
      { op: "dab", tool: "clay", at: { anchor: "right-top", offset: [0.02, 0, 0] }, radius: 0.14, strength: 0.65, repeat: 3 },
      { op: "dab", tool: "inflate", at: { anchor: "right-top", offset: [0.02, 0, 0] }, radius: 0.12, strength: 0.4 },
      { op: "dab", tool: "crease", at: { anchor: "right-top", offset: [-0.02, -0.02, 0] }, radius: 0.1, strength: 0.4 },
    ],
  },
  {
    id: "horns",
    label: "Tambah Tanduk",
    description: "Menarik dua tonjolan runcing dari atas kepala ke luar/atas menyerupai tanduk.",
    symmetry: { x: true },
    steps: [
      { op: "line", tool: "clay", from: { anchor: "right-top" }, to: { anchor: "right-top", offset: [0.05, 0.18, -0.02] }, radius: 0.09, strength: 0.7, steps: 5 },
      { op: "dab", tool: "pinch", at: { anchor: "right-top", offset: [0.05, 0.18, -0.02] }, radius: 0.08, strength: 0.6, repeat: 2 },
    ],
  },
  {
    id: "muscle-bulge",
    label: "Bentuk Otot (Bulge)",
    description: "Menggembungkan area tengah objek secara simetris untuk kesan otot/massa, lalu dihaluskan sedikit.",
    symmetry: { x: true },
    steps: [
      { op: "dab", tool: "clay", at: "center", radius: 0.3, strength: 0.5, repeat: 2 },
      { op: "dab", tool: "inflate", at: "center", radius: 0.26, strength: 0.35 },
      { op: "smoothAll", iterations: 1, amount: 0.25 },
    ],
  },
  {
    id: "brow-crease",
    label: "Alis / Lipatan Wajah",
    description: "Membuat dua alur melengkung di area depan-atas, cocok untuk alis mata atau lipatan dahi.",
    symmetry: { x: true },
    steps: [
      { op: "line", tool: "crease", from: { anchor: "front-top", offset: [0.02, -0.03, 0] }, to: { anchor: "front-top", offset: [0.12, -0.06, 0] }, radius: 0.05, strength: 0.55, steps: 6 },
    ],
  },
  {
    id: "spine-ridge",
    label: "Punggung Bertulang (Ridge)",
    description: "Membuat punggungan tajam dari belakang-bawah ke belakang-atas, seperti duri punggung reptil.",
    steps: [
      { op: "line", tool: "crease", from: { anchor: "back-bottom" }, to: { anchor: "back-top" }, radius: 0.08, strength: 0.5, steps: 8 },
      { op: "line", tool: "draw", from: { anchor: "back-bottom" }, to: { anchor: "back-top" }, radius: 0.06, strength: 0.45, steps: 8 },
    ],
  },
  {
    id: "wart-cluster",
    label: "Tonjolan Acak (Bintil)",
    description: "Sebaran bintil-bintil kecil melingkar di permukaan depan — cocok untuk tekstur kulit kasar/reptil.",
    steps: [
      { op: "ring", tool: "inflate", center: "front", orbit: 0.18, radius: 0.045, strength: 0.6, count: 10, axis: "z" },
    ],
  },
  {
    id: "scatter-scars",
    label: "Luka/Bekas Acak (Repeat + Jitter)",
    description: "Contoh pemakaian repeat + jitter: menabur beberapa alur luka kecil secara acak di area depan, tiap pengulangan sedikit berbeda ukuran & posisinya.",
    steps: [
      { op: "set", name: "n", value: 6 },
      {
        op: "repeat",
        count: 6,
        steps: [
          {
            op: "line",
            tool: "crease",
            from: { anchor: "front", offset: [-0.08, 0.05, 0] },
            to: { anchor: "front", offset: [0.08, -0.05, 0] },
            radius: "0.03 + $i*0.004",
            strength: "0.4 + $i*0.02",
            steps: 4,
            jitter: 0.5,
          },
        ],
      },
    ],
  },
  {
    id: "rough-skin",
    label: "Kulit Kasar (Roughen)",
    description: "Menerapkan noise searah normal ke seluruh permukaan depan objek untuk kesan kulit/batu kasar, memakai tool Roughen yang baru.",
    steps: [{ op: "dab", tool: "roughen", at: "center", radius: 0.6, strength: 0.4, repeat: 1 }],
  },
  {
    id: "trim-flat-base",
    label: "Ratakan Dasar (Trim)",
    description: "Memotong tegas bagian bawah objek supaya rata, menggunakan tool Trim yang baru — berguna sebelum mengekspor objek yang perlu berdiri di permukaan datar.",
    steps: [{ op: "dab", tool: "trim", at: "bottom", radius: 0.7, strength: 0.8, invert: true }],
  },
  {
    id: "smooth-pass",
    label: "Haluskan Semua",
    description: "Menghaluskan seluruh permukaan part aktif beberapa iterasi — berguna setelah sculpting kasar.",
    steps: [{ op: "smoothAll", iterations: 3, amount: 0.5 }],
  },
  {
    id: "inflate-pass",
    label: "Gemukkan Semua",
    description: "Menggelembungkan seluruh permukaan secara merata (menambah volume keseluruhan).",
    steps: [{ op: "inflateAll", amount: 0.015 }],
  },
];

export const SCULPT_PRESET_BY_ID = Object.fromEntries(SCULPT_PRESETS.map((p) => [p.id, p]));
