import type { ToolId } from "../engine/engine";
import type {
  SculptInstruction,
  DabInstruction,
  LineInstruction,
  RingInstruction,
  SmoothAllInstruction,
  InflateAllInstruction,
  SetInstruction,
  RepeatInstruction,
  NumExpr,
} from "./types";
import type { PositionSpec } from "./resolve";
import { validateExprSyntax } from "./expr";

/**
 * Parser teks SculptScript, format per baris:
 *
 *   op key=value key=value ...
 *
 * Posisi (at / center / from / to) ditulis sebagai salah satu dari:
 *   right-top                    -> anchor saja
 *   right-top,0.02,0,0           -> anchor + offset (x,y,z setelah anchor)
 *   0.1,0.3,-0.05                -> koordinat manual murni (3 angka, tanpa anchor)
 *
 * Field numerik (radius, strength, amount, orbit) boleh berupa angka polos ATAU
 * ekspresi yang memakai "$i" (index iterasi repeat) / "$namaVar" (lihat "set"),
 * mis. "radius=0.08+$i*0.01". Ekspresi divalidasi sintaksnya saat parse (supaya
 * typo ketahuan langsung), tapi nilainya baru benar-benar dihitung saat dijalankan
 * (karena $i hanya punya nilai nyata di dalam sebuah "repeat").
 *
 * "set" mendefinisikan variabel: `set name=ukuran value=0.12`
 * "repeat" membungkus instruksi lain dalam BLOK, ditutup dengan baris "end":
 *   repeat count=6
 *     dab tool=inflate at=front radius=0.05 strength=0.3+$i*0.05 jitter=0.4
 *   end
 * Blok "repeat" boleh bersarang (repeat di dalam repeat).
 *
 * Baris kosong dan baris diawali # diabaikan (komentar).
 * Tiap baris yang gagal diparse dilaporkan sebagai error dengan nomor barisnya,
 * TANPA menghentikan baris lain — supaya textarea bisa menunjukkan semua kesalahan
 * sekaligus, bukan cuma yang pertama ditemukan.
 */

export interface ParseResult {
  ok: boolean;
  steps: SculptInstruction[];
  errors: { line: number; message: string }[];
}

const TOOL_IDS = new Set<ToolId>([
  "draw", "clay", "inflate", "smooth", "flatten", "scrape",
  "pinch", "crease", "layer", "nudge", "grab", "snake", "mask", "paint", "transform",
  "roughen", "trim",
]);

function parseKeyValues(tokens: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tok of tokens) {
    const eq = tok.indexOf("=");
    if (eq === -1) continue;
    out[tok.slice(0, eq).trim()] = tok.slice(eq + 1).trim();
  }
  return out;
}

function parsePosition(raw: string): PositionSpec {
  const parts = raw.split(",").map((s) => s.trim());
  const allNumeric = parts.length === 3 && parts.every((p) => p !== "" && !isNaN(Number(p)));
  if (allNumeric) {
    return [Number(parts[0]), Number(parts[1]), Number(parts[2])] as [number, number, number];
  }
  // anchor (+ opsional offset setelahnya)
  const anchor = parts[0];
  if (parts.length >= 4) {
    const off = parts.slice(1, 4).map(Number);
    if (off.every((n) => !isNaN(n))) {
      return { anchor, offset: [off[0], off[1], off[2]] as [number, number, number] };
    }
  }
  return anchor;
}

function requireTool(kv: Record<string, string>, line: number, errors: ParseResult["errors"]): ToolId | null {
  const t = kv.tool;
  if (!t) {
    errors.push({ line, message: "instruksi ini butuh tool=... (mis. tool=clay)" });
    return null;
  }
  if (!TOOL_IDS.has(t as ToolId)) {
    errors.push({ line, message: `tool "${t}" tidak dikenal. Pilihan: ${[...TOOL_IDS].join(", ")}` });
    return null;
  }
  return t as ToolId;
}

/**
 * Baca field numerik sebagai NumExpr: dicoba Number() dulu (jalur cepat untuk angka
 * polos), kalau gagal dicoba sebagai ekspresi ($i, $var, operator) — ekspresi hanya
 * divalidasi sintaksnya di sini (context kosong boleh gagal kalau memang butuh $var,
 * makanya validasi dibungkus supaya error "variabel tidak ditemukan" TIDAK dilaporkan
 * di tahap parse, hanya error sintaks murni yang dilaporkan di sini).
 */
function numExpr(
  kv: Record<string, string>,
  key: string,
  line: number,
  errors: ParseResult["errors"],
  required = true,
  fallback = 0
): NumExpr {
  const v = kv[key];
  if (v == null) {
    if (required) errors.push({ line, message: `kurang parameter "${key}=..."` });
    return fallback;
  }
  const plain = Number(v);
  if (!isNaN(plain)) return plain;
  // bukan angka polos -> validasi sebagai ekspresi (hanya sintaks, $var belum perlu ada)
  try {
    validateExprSyntax(v);
    return v;
  } catch (err) {
    errors.push({ line, message: `ekspresi "${key}=${v}" tidak valid: ${(err as Error).message}` });
    return fallback;
  }
}

function requirePos(kv: Record<string, string>, key: string, line: number, errors: ParseResult["errors"]): PositionSpec {
  const v = kv[key];
  if (!v) {
    errors.push({ line, message: `kurang parameter posisi "${key}=..."` });
    return "center";
  }
  return parsePosition(v);
}

function parseOneLine(
  op: string,
  kv: Record<string, string>,
  line: number,
  errors: ParseResult["errors"]
): SculptInstruction | null {
  switch (op) {
    case "set": {
      if (!kv.name) {
        errors.push({ line, message: `"set" butuh name=... (nama variabel)` });
        return null;
      }
      const instr: SetInstruction = { op: "set", name: kv.name, value: numExpr(kv, "value", line, errors) };
      return instr;
    }
    case "dab": {
      const tool = requireTool(kv, line, errors);
      if (!tool) return null;
      const at = requirePos(kv, "at", line, errors);
      const instr: DabInstruction = {
        op: "dab",
        tool,
        at,
        radius: numExpr(kv, "radius", line, errors),
        strength: numExpr(kv, "strength", line, errors),
        invert: kv.invert === "true",
        repeat: kv.repeat ? Math.max(1, Math.round(Number(kv.repeat) || 1)) : undefined,
        jitter: kv.jitter ? Number(kv.jitter) : undefined,
      };
      return instr;
    }
    case "line": {
      const tool = requireTool(kv, line, errors);
      if (!tool) return null;
      const from = requirePos(kv, "from", line, errors);
      const to = requirePos(kv, "to", line, errors);
      const instr: LineInstruction = {
        op: "line",
        tool,
        from,
        to,
        radius: numExpr(kv, "radius", line, errors),
        strength: numExpr(kv, "strength", line, errors),
        invert: kv.invert === "true",
        steps: kv.steps ? Math.max(1, Math.round(Number(kv.steps) || 6)) : undefined,
        jitter: kv.jitter ? Number(kv.jitter) : undefined,
      };
      return instr;
    }
    case "ring": {
      const tool = requireTool(kv, line, errors);
      if (!tool) return null;
      const center = requirePos(kv, "center", line, errors);
      const axis = (kv.axis as "x" | "y" | "z") ?? "y";
      if (kv.axis && !["x", "y", "z"].includes(axis)) {
        errors.push({ line, message: `axis "${kv.axis}" tidak valid, pakai x/y/z` });
      }
      const countNum = Number(kv.count ?? 8);
      const instr: RingInstruction = {
        op: "ring",
        tool,
        center,
        orbit: numExpr(kv, "orbit", line, errors),
        radius: numExpr(kv, "radius", line, errors),
        strength: numExpr(kv, "strength", line, errors),
        count: Math.max(1, Math.round(isNaN(countNum) ? 8 : countNum)),
        invert: kv.invert === "true",
        axis,
        jitter: kv.jitter ? Number(kv.jitter) : undefined,
      };
      return instr;
    }
    case "smoothAll": {
      const instr: SmoothAllInstruction = {
        op: "smoothAll",
        iterations: kv.iterations ? Math.max(1, Math.round(Number(kv.iterations) || 1)) : undefined,
        amount: kv.amount ? Number(kv.amount) || 0.5 : undefined,
      };
      return instr;
    }
    case "inflateAll": {
      const instr: InflateAllInstruction = { op: "inflateAll", amount: numExpr(kv, "amount", line, errors) };
      return instr;
    }
    default:
      errors.push({ line, message: `instruksi "${op}" tidak dikenal. Pakai: set, dab, line, ring, smoothAll, inflateAll, repeat` });
      return null;
  }
}

/**
 * Parse sederet baris menjadi instruksi, mendukung blok "repeat ... end" bersarang.
 * idx adalah indeks baris (0-based) tempat parsing dimulai; mengembalikan instruksi
 * yang dihasilkan di level ini beserta indeks baris setelah blok ini selesai dibaca.
 */
function parseBlock(
  lines: string[],
  startIdx: number,
  errors: ParseResult["errors"],
  stopAtEnd: boolean
): { steps: SculptInstruction[]; nextIdx: number } {
  const steps: SculptInstruction[] = [];
  let i = startIdx;
  while (i < lines.length) {
    const lineNo = i + 1;
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith("#")) {
      i++;
      continue;
    }
    if (trimmed === "end") {
      if (!stopAtEnd) {
        errors.push({ line: lineNo, message: `"end" tanpa "repeat" yang membukanya` });
      }
      return { steps, nextIdx: i + 1 };
    }

    const tokens = trimmed.split(/\s+/);
    const op = tokens[0];
    const kv = parseKeyValues(tokens.slice(1));

    if (op === "repeat") {
      const countNum = Number(kv.count ?? 1);
      const count = Math.max(1, Math.round(isNaN(countNum) ? 1 : countNum));
      if (!kv.count) errors.push({ line: lineNo, message: `"repeat" butuh count=... (mis. count=5)` });
      const inner = parseBlock(lines, i + 1, errors, true);
      const instr: RepeatInstruction = { op: "repeat", count, steps: inner.steps };
      steps.push(instr);
      i = inner.nextIdx;
      continue;
    }

    const instr = parseOneLine(op, kv, lineNo, errors);
    if (instr) steps.push(instr);
    i++;
  }
  if (stopAtEnd) {
    errors.push({ line: lines.length, message: `blok "repeat" tidak ditutup — tambahkan baris "end"` });
  }
  return { steps, nextIdx: i };
}

export function parseSculptScript(text: string): ParseResult {
  const errors: ParseResult["errors"] = [];
  const lines = text.split("\n");
  const { steps } = parseBlock(lines, 0, errors, false);
  return { ok: errors.length === 0, steps, errors };
}

/** Dump satu SculptScript (array instruksi) kembali jadi teks — dipakai untuk mengisi textarea dari preset yang dipilih. */
export function stringifySculptScript(steps: SculptInstruction[], indent = ""): string {
  const posToStr = (p: PositionSpec): string => {
    if (Array.isArray(p)) return p.join(",");
    if (typeof p === "string") return p;
    const off = p.offset ?? [0, 0, 0];
    return `${p.anchor ?? "center"},${off.join(",")}`;
  };
  const jitterPart = (j?: number) => (j ? ` jitter=${j}` : "");

  return steps
    .map((s) => {
      switch (s.op) {
        case "set":
          return `${indent}set name=${s.name} value=${s.value}`;
        case "dab":
          return `${indent}dab tool=${s.tool} at=${posToStr(s.at)} radius=${s.radius} strength=${s.strength}${s.invert ? " invert=true" : ""}${s.repeat ? ` repeat=${s.repeat}` : ""}${jitterPart(s.jitter)}`;
        case "line":
          return `${indent}line tool=${s.tool} from=${posToStr(s.from)} to=${posToStr(s.to)} radius=${s.radius} strength=${s.strength}${s.invert ? " invert=true" : ""}${s.steps ? ` steps=${s.steps}` : ""}${jitterPart(s.jitter)}`;
        case "ring":
          return `${indent}ring tool=${s.tool} center=${posToStr(s.center)} orbit=${s.orbit} radius=${s.radius} strength=${s.strength} count=${s.count} axis=${s.axis ?? "y"}${s.invert ? " invert=true" : ""}${jitterPart(s.jitter)}`;
        case "smoothAll":
          return `${indent}smoothAll${s.iterations ? ` iterations=${s.iterations}` : ""}${s.amount ? ` amount=${s.amount}` : ""}`;
        case "inflateAll":
          return `${indent}inflateAll amount=${s.amount}`;
        case "repeat":
          return `${indent}repeat count=${s.count}\n${stringifySculptScript(s.steps, indent + "  ")}\n${indent}end`;
      }
    })
    .join("\n");
}
