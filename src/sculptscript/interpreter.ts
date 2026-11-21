import type { SculptEngine } from "../engine/engine";
import type { Part } from "../engine/part";
import { resolvePosition, resolveRadius } from "./resolve";
import type { SculptScript, SculptInstruction, NumExpr } from "./types";
import { evalExpr, type ExprContext } from "./expr";

export interface RunResult {
  ok: boolean;
  error?: string;
  stepsRun: number;
}

/**
 * Jalankan array instruksi mentah (hasil parser teks, atau ditulis manual) pada satu part.
 * Semua stroke dikerjakan lewat jalur scripted (beginScriptStroke/scriptDab/endScriptStroke)
 * di engine, jadi tetap tercatat di riwayat undo/redo seperti stroke manual, dan simetri
 * (mirror X/Y/Z) tetap berlaku karena memakai buildCopies() yang sama.
 *
 * Variabel ("set name=... value=...") dan index loop ("$i" di dalam "repeat") hidup di
 * satu ExprContext yang dibagi ke seluruh eksekusi skrip ini — jadi variabel yang
 * didefinisikan di luar sebuah "repeat" tetap terbaca di dalamnya, dan "$i" dari repeat
 * terluar tertimpa sementara oleh repeat yang bersarang di dalamnya (lalu dikembalikan).
 */
export function runSculptSteps(
  engine: SculptEngine,
  part: Part,
  steps: SculptInstruction[],
  symmetry?: { x?: boolean; y?: boolean; z?: boolean }
): RunResult {
  let stepsRun = 0;
  const prevSym = { x: engine.s.symX, y: engine.s.symY, z: engine.s.symZ };
  const ctx: ExprContext = { vars: {} };
  try {
    if (symmetry) {
      engine.setSettings({
        symX: symmetry.x ?? prevSym.x,
        symY: symmetry.y ?? prevSym.y,
        symZ: symmetry.z ?? prevSym.z,
      });
    }
    stepsRun = runStepList(engine, part, steps, ctx);
    return { ok: true, stepsRun };
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message ?? err), stepsRun };
  } finally {
    // kembalikan setting simetri semula supaya skrip tidak diam-diam mengubah preferensi user
    engine.setSettings(prevSym);
  }
}

/** Jalankan satu SculptScript lengkap (preset) pada part aktif — wrapper tipis di atas runSculptSteps. */
export function runSculptScript(engine: SculptEngine, part: Part, script: SculptScript): RunResult {
  return runSculptSteps(engine, part, script.steps, script.symmetry);
}

/** Jalankan sederet instruksi berurutan, mengembalikan jumlah instruksi yang benar-benar dieksekusi (termasuk isi "repeat"). */
function runStepList(engine: SculptEngine, part: Part, steps: SculptInstruction[], ctx: ExprContext): number {
  let count = 0;
  for (const step of steps) {
    count += runStep(engine, part, step, ctx);
  }
  return count;
}

function ev(expr: NumExpr, ctx: ExprContext): number {
  return evalExpr(expr, ctx);
}

/** Geser titik secara acak di dalam bola berjari-jari (radius * jitter) — dipakai untuk variasi posisi antar-repeat. */
function jitterPoint<T extends { x: number; y: number; z: number; clone(): T }>(point: T, radius: number, jitter: number): T {
  if (!jitter) return point;
  const p = point.clone();
  // arah acak uniform di bola (bukan kubus, supaya distribusinya tidak condong ke sudut)
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  const r = Math.random() * radius * jitter;
  p.x += r * Math.sin(phi) * Math.cos(theta);
  p.y += r * Math.sin(phi) * Math.sin(theta);
  p.z += r * Math.cos(phi);
  return p;
}

/** Variasi acak ±jitter*nilai pada sebuah angka (radius/strength), tidak pernah menghasilkan negatif. */
function jitterValue(value: number, jitter: number): number {
  if (!jitter) return value;
  const delta = (Math.random() * 2 - 1) * jitter * value;
  return Math.max(0, value + delta);
}

/** Jalankan satu instruksi; mengembalikan berapa instruksi "dasar" yang dieksekusi (repeat/set dihitung tersendiri). */
function runStep(engine: SculptEngine, part: Part, step: SculptInstruction, ctx: ExprContext): number {
  switch (step.op) {
    case "set": {
      ctx.vars[step.name] = ev(step.value, ctx);
      return 1;
    }
    case "repeat": {
      const prevI = ctx.vars.i;
      let ran = 0;
      for (let i = 0; i < step.count; i++) {
        ctx.vars.i = i;
        ran += runStepList(engine, part, step.steps, ctx);
      }
      if (prevI == null) delete ctx.vars.i;
      else ctx.vars.i = prevI;
      return ran;
    }
    case "dab": {
      const jitter = step.jitter ?? 0;
      const baseR = resolveRadius(part, ev(step.radius, ctx));
      const strength = ev(step.strength, ctx);
      const { point: basePoint, normal } = resolvePosition(engine, part, step.at);
      engine.beginScriptStroke(part, step.tool, step.invert ?? false);
      const times = Math.max(1, step.repeat ?? 1);
      for (let i = 0; i < times; i++) {
        const R = jitterValue(baseR, jitter);
        const str = jitterValue(strength, jitter);
        const jp = jitter ? jitterPoint(basePoint, baseR, jitter) : basePoint;
        // titik hasil jitter bisa sedikit melayang dari permukaan asli, jadi di-snap
        // ulang ke permukaan mesh supaya brush tetap menempel, bukan "mengambang".
        const srf = jitter ? engine.closestSurfacePoint(part, jp) : { point: jp, normal };
        engine.scriptDab(srf.point, srf.normal, R, str);
      }
      engine.endScriptStroke();
      return 1;
    }
    case "line": {
      const jitter = step.jitter ?? 0;
      const a = resolvePosition(engine, part, step.from).point;
      const b = resolvePosition(engine, part, step.to).point;
      const R = resolveRadius(part, ev(step.radius, ctx));
      const strength = ev(step.strength, ctx);
      engine.beginScriptStroke(part, step.tool, step.invert ?? false);
      if (!jitter) {
        engine.scriptLine(a, b, R, strength, part, step.steps);
      } else {
        // versi jitter manual: scriptLine bawaan tidak punya parameter noise, jadi untuk
        // garis beraksen organik kita dab titik demi titik di sini dengan variasi sendiri.
        const n = step.steps ?? Math.max(1, Math.ceil(a.distanceTo(b) / Math.max(R * 0.25, 1e-4)));
        for (let i = 0; i <= n; i++) {
          const t = n === 0 ? 0 : i / n;
          const basePoint = a.clone().lerp(b, t);
          const jp = jitterPoint(basePoint, R, jitter);
          const srf = engine.closestSurfacePoint(part, jp);
          engine.scriptDab(srf.point, srf.normal, jitterValue(R, jitter), jitterValue(strength, jitter));
        }
      }
      engine.endScriptStroke();
      return 1;
    }
    case "ring": {
      const jitter = step.jitter ?? 0;
      const center = resolvePosition(engine, part, step.center).point;
      const orbitR = resolveRadius(part, ev(step.orbit, ctx));
      const dabR = resolveRadius(part, ev(step.radius, ctx));
      const strength = ev(step.strength, ctx);
      const axis = step.axis ?? "y";
      engine.beginScriptStroke(part, step.tool, step.invert ?? false);
      for (let i = 0; i < step.count; i++) {
        const a = (i / step.count) * Math.PI * 2;
        const p = center.clone();
        if (axis === "y") {
          p.x += Math.cos(a) * orbitR;
          p.z += Math.sin(a) * orbitR;
        } else if (axis === "x") {
          p.y += Math.cos(a) * orbitR;
          p.z += Math.sin(a) * orbitR;
        } else {
          p.x += Math.cos(a) * orbitR;
          p.y += Math.sin(a) * orbitR;
        }
        const jp = jitter ? jitterPoint(p, dabR, jitter) : p;
        const srf = engine.closestSurfacePoint(part, jp);
        engine.scriptDab(srf.point, srf.normal, jitterValue(dabR, jitter), jitterValue(strength, jitter));
      }
      engine.endScriptStroke();
      return 1;
    }
    case "smoothAll": {
      engine.smoothAll(step.iterations ?? 1, step.amount ?? 0.5);
      return 1;
    }
    case "inflateAll": {
      engine.inflateAll(ev(step.amount, ctx));
      return 1;
    }
  }
}
