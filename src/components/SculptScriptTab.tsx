import { useState } from "react";
import { Sparkles, Play, FileCode2 } from "lucide-react";
import type { EngineState, Settings, SculptEngine } from "../engine/engine";
import { Btn, Section } from "./ui";
import { SCULPT_PRESETS } from "../sculptscript/presets";
import { runSculptScript, runSculptSteps } from "../sculptscript/interpreter";
import { parseSculptScript, stringifySculptScript } from "../sculptscript/parse";
import { cn } from "../utils/cn";

interface Props {
  engine: SculptEngine | null;
  s: Settings;
  st: EngineState;
  update: (p: Partial<Settings>) => void;
  setStrength: (v: number) => void;
  toast: (m: string) => void;
  cursor: [number, number, number] | null;
}

const EXAMPLE_SCRIPT = `# Tulis satu instruksi per baris. Baris # adalah komentar.
# Posisi (at/center/from/to): anchor ("front-top-right"), anchor+offset
# ("front-top,0.02,0,0"), atau koordinat manual ("0.1,0.2,-0.05").
# radius/strength/amount boleh angka atau ekspresi dengan $i (index repeat)
# dan $variabel (dari "set"), mis. "0.05 + $i*0.01".
dab tool=clay at=top radius=0.18 strength=0.6 repeat=2
dab tool=inflate at=top radius=0.14 strength=0.35
smoothAll iterations=1 amount=0.3

# contoh repeat + jitter (variasi acak tiap pengulangan):
# set name=n value=5
# repeat count=5
#   dab tool=roughen at=front radius=0.04+$i*0.01 strength=0.3 jitter=0.4
# end`;

export function SculptScriptTab({ engine, st, toast }: Props) {
  const [runningId, setRunningId] = useState<string | null>(null);
  const [code, setCode] = useState(EXAMPLE_SCRIPT);
  const [parseErrors, setParseErrors] = useState<{ line: number; message: string }[]>([]);
  const [runningScript, setRunningScript] = useState(false);
  if (!engine) return null;

  const activePart = engine.parts.find((p) => p.id === st.activeId) ?? null;

  const runCode = () => {
    if (!activePart) {
      toast("Pilih / aktifkan satu objek dulu di tab Objek.");
      return;
    }
    const parsed = parseSculptScript(code);
    setParseErrors(parsed.errors);
    if (!parsed.ok) {
      toast(`Skrip punya ${parsed.errors.length} kesalahan — lihat detail di bawah textarea.`);
      return;
    }
    if (!parsed.steps.length) {
      toast("Skrip kosong, tidak ada instruksi untuk dijalankan.");
      return;
    }
    setRunningScript(true);
    requestAnimationFrame(() => {
      const result = runSculptSteps(engine, activePart, parsed.steps);
      setRunningScript(false);
      if (result.ok) toast(`Skrip selesai (${result.stepsRun} langkah).`);
      else toast(`Skrip berhenti di tengah jalan: ${result.error}`);
    });
  };

  const loadPresetToEditor = (presetId: string) => {
    const script = SCULPT_PRESETS.find((p) => p.id === presetId);
    if (!script) return;
    setCode(stringifySculptScript(script.steps));
    setParseErrors([]);
    toast(`Skrip "${script.label}" dimuat ke editor — edit bebas lalu tekan Jalankan.`);
  };

  const run = (presetId: string) => {
    const script = SCULPT_PRESETS.find((p) => p.id === presetId);
    if (!script) return;
    if (!activePart) {
      toast("Pilih / aktifkan satu objek dulu di tab Objek.");
      return;
    }
    setRunningId(presetId);
    // dijalankan langsung (sinkron) — operasi geometri ringan, tapi requestAnimationFrame
    // dipakai supaya UI sempat update tombol "Menjalankan..." dulu sebelum kerja berat.
    requestAnimationFrame(() => {
      const result = runSculptScript(engine, activePart, script);
      setRunningId(null);
      if (result.ok) {
        toast(`"${script.label}" selesai (${result.stepsRun} langkah).`);
      } else {
        toast(`Gagal menjalankan "${script.label}": ${result.error}`);
      }
    });
  };

  return (
    <>
      <Section title="Sculptscript">
        <p className="text-[11px] leading-relaxed text-zinc-400">
          Setiap tombol di bawah adalah rangkaian goresan sculpting yang sudah dirancang (SculptScript), dijalankan
          otomatis ke objek aktif{" "}
          {activePart ? (
            <span className="text-zinc-200">({activePart.name})</span>
          ) : (
            <span className="text-amber-400">— belum ada objek aktif</span>
          )}
          . Hasilnya tetap tercatat di riwayat, jadi bisa di-undo seperti goresan manual biasa.
        </p>
      </Section>

      <Section title="Preset">
        <div className="space-y-1.5">
          {SCULPT_PRESETS.map((p) => (
            <div
              key={p.id}
              className="flex items-start gap-2.5 rounded-lg border border-zinc-700/80 bg-zinc-800/60 px-3 py-2.5"
            >
              <Sparkles size={15} className="mt-0.5 shrink-0 text-[#7c9cff]" />
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] font-medium text-zinc-100">
                  {runningId === p.id ? "Menjalankan..." : p.label}
                </div>
                <div className="text-[11px] leading-snug text-zinc-500">{p.description}</div>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  title="Jalankan langsung"
                  disabled={!activePart || runningId !== null}
                  onClick={() => run(p.id)}
                  className="rounded-md border border-zinc-600 p-1.5 text-zinc-300 hover:bg-zinc-700 disabled:opacity-30 disabled:pointer-events-none"
                >
                  <Play size={13} />
                </button>
                <button
                  title="Muat ke editor untuk diedit"
                  onClick={() => loadPresetToEditor(p.id)}
                  className="rounded-md border border-zinc-600 p-1.5 text-zinc-300 hover:bg-zinc-700"
                >
                  <FileCode2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Editor Skrip">
        <p className="text-[11px] leading-relaxed text-zinc-400">
          Instruksi: <code className="rounded bg-zinc-800 px-1 py-0.5 text-[10.5px] text-[#b9c9ff]">dab</code>{" "}
          <code className="rounded bg-zinc-800 px-1 py-0.5 text-[10.5px] text-[#b9c9ff]">line</code>{" "}
          <code className="rounded bg-zinc-800 px-1 py-0.5 text-[10.5px] text-[#b9c9ff]">ring</code>{" "}
          <code className="rounded bg-zinc-800 px-1 py-0.5 text-[10.5px] text-[#b9c9ff]">smoothAll</code>{" "}
          <code className="rounded bg-zinc-800 px-1 py-0.5 text-[10.5px] text-[#b9c9ff]">inflateAll</code>{" "}
          <code className="rounded bg-zinc-800 px-1 py-0.5 text-[10.5px] text-[#b9c9ff]">set</code>{" "}
          <code className="rounded bg-zinc-800 px-1 py-0.5 text-[10.5px] text-[#b9c9ff]">repeat...end</code>. Tambah{" "}
          <code className="rounded bg-zinc-800 px-1 py-0.5 text-[10.5px] text-[#b9c9ff]">jitter=0.3</code> di dab/line/ring
          untuk variasi acak, dan pakai <code className="rounded bg-zinc-800 px-1 py-0.5 text-[10.5px] text-[#b9c9ff]">$i</code>{" "}
          / <code className="rounded bg-zinc-800 px-1 py-0.5 text-[10.5px] text-[#b9c9ff]">$namaVar</code> di dalam angka radius/strength/amount.
        </p>
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          spellCheck={false}
          rows={10}
          className={cn(
            "thin-scroll w-full resize-y rounded-lg border bg-zinc-900 px-2.5 py-2 font-mono text-[11.5px] leading-relaxed text-zinc-100 outline-none",
            parseErrors.length ? "border-red-700/70 focus:border-red-600" : "border-zinc-700 focus:border-[#7c9cff]"
          )}
        />
        {parseErrors.length > 0 && (
          <div className="space-y-0.5 rounded-lg border border-red-900/50 bg-red-950/30 px-2.5 py-2">
            {parseErrors.map((e, i) => (
              <div key={i} className="text-[11px] text-red-300">
                Baris {e.line}: {e.message}
              </div>
            ))}
          </div>
        )}
        <Btn
          tone="primary"
          className="w-full"
          disabled={!activePart || runningScript}
          onClick={runCode}
        >
          <Play size={14} /> {runningScript ? "Menjalankan..." : "Jalankan Skrip"}
        </Btn>
      </Section>

      <Section title="Catatan">
        <p className="text-[11px] leading-relaxed text-zinc-500">
          Posisi tiap goresan dihitung relatif terhadap ukuran objek aktif (bukan koordinat tetap), jadi preset yang
          sama bekerja wajar baik di objek kecil maupun besar. Aktifkan <b>Cermin X</b> di tab Kuas sebelum menjalankan
          preset simetris (mis. Telinga, Tanduk) kalau ingin hasil manual tambahan tetap simetris juga — preset itu
          sendiri sudah otomatis mengaktifkan simetri yang relevan hanya selama ia berjalan.
        </p>
      </Section>

      {!activePart && (
        <Btn
          className="mx-3 mb-3 w-[calc(100%-1.5rem)]"
          tone="primary"
          onClick={() => {
            if (engine.parts[0]) engine.setActive(engine.parts[0].id);
            else toast("Scene masih kosong — tambahkan objek dulu di tab Objek.");
          }}
        >
          Aktifkan objek pertama
        </Btn>
      )}
    </>
  );
}
