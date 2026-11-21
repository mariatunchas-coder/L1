import {
  Brush,
  Layers,
  Layers2,
  Expand,
  Waves,
  Square,
  Eraser,
  Minimize2,
  Slash,
  MoveRight,
  Hand,
  Spline,
  Palette,
  Move3d,
  VenetianMask,
  Mountain,
  Scissors,
} from "lucide-react";
import type { ToolId } from "./engine/engine";

export interface ToolMeta {
  id: ToolId;
  label: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
  hint: string;
  key?: string;
  defaultStrength: number;
}

export const TOOLS: ToolMeta[] = [
  { id: "draw", label: "Draw", icon: Brush, key: "D", defaultStrength: 0.5, hint: "Menonjolkan/menekan permukaan searah normal. Invert untuk mengukir ke dalam." },
  { id: "clay", label: "Clay", icon: Layers, key: "C", defaultStrength: 0.55, hint: "Membangun massa tanah liat sambil meratakan – ideal untuk bentuk besar (otot, badan)." },
  { id: "inflate", label: "Inflate", icon: Expand, key: "I", defaultStrength: 0.4, hint: "Menggelembungkan titik sepanjang normal masing-masing." },
  { id: "smooth", label: "Smooth", icon: Waves, key: "S", defaultStrength: 0.5, hint: "Menghaluskan permukaan. Tahan Shift (desktop) untuk smooth sementara." },
  { id: "flatten", label: "Flatten", icon: Square, key: "F", defaultStrength: 0.6, hint: "Meratakan permukaan ke bidang rata-rata kuas." },
  { id: "scrape", label: "Scrape", icon: Eraser, key: "R", defaultStrength: 0.6, hint: "Mengikis hanya bagian yang menonjol sampai rata." },
  { id: "pinch", label: "Pinch", icon: Minimize2, key: "P", defaultStrength: 0.5, hint: "Menarik titik ke tengah kuas – menajamkan tepi & lipatan." },
  { id: "crease", label: "Crease", icon: Slash, key: "V", defaultStrength: 0.5, hint: "Membuat alur/garis tajam (kerutan, mulut, mata)." },
  { id: "layer", label: "Layer", icon: Layers2, key: "L", defaultStrength: 0.5, hint: "Menaikkan permukaan sampai tinggi maksimum (plateau) tanpa menumpuk." },
  { id: "nudge", label: "Nudge", icon: MoveRight, key: "N", defaultStrength: 0.5, hint: "Mendorong permukaan searah goresan." },
  { id: "grab", label: "Grab", icon: Hand, key: "G", defaultStrength: 1, hint: "Menarik area (ukuran kuas) mengikuti jari/kursor – untuk membentuk anggota badan." },
  { id: "snake", label: "Snake", icon: Spline, key: "K", defaultStrength: 0.8, hint: "Snake Hook: menarik 'tentakel' – tangan, ekor, tanduk, rambut." },
  { id: "mask", label: "Mask", icon: VenetianMask, key: "M", defaultStrength: 0.6, hint: "Melukis mask (area gelap terkunci dari sculpt). Invert untuk menghapus mask." },
  { id: "paint", label: "Cat", icon: Palette, key: "B", defaultStrength: 0.7, hint: "Melukis warna vertex. Warna ikut diekspor ke GLB/GLTF." },
  { id: "transform", label: "Gerak", icon: Move3d, key: "T", defaultStrength: 0.5, hint: "Pindah / putar / skala objek memakai gizmo. Ketuk objek untuk memilih." },
  { id: "roughen", label: "Roughen", icon: Mountain, key: "U", defaultStrength: 0.35, hint: "Menambah tekstur kasar/noise acak searah normal — untuk kulit, batu, atau permukaan organik. Atur kerapatan di slider Noise Scale." },
  { id: "trim", label: "Trim", icon: Scissors, key: "H", defaultStrength: 0.7, hint: "Memotong tegas bagian yang menonjol ke bidang rata kuas — lebih tegas dari Flatten. Invert untuk membalik arah potong." },
];

export const TOOL_BY_ID = Object.fromEntries(TOOLS.map((t) => [t.id, t])) as Record<ToolId, ToolMeta>;
