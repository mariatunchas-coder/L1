import { useRef, useState } from "react";
import {
  Box,
  Circle,
  Cone,
  Copy,
  Cylinder,
  Donut,
  Download,
  Eye,
  EyeOff,
  FlipHorizontal2,
  Pill,
  Square,
  Trash2,
  Upload,
  User,
  Move,
  Rotate3d,
  Scale3d,
} from "lucide-react";
import type { EngineState, ExportFormat, FalloffId, Settings, SculptEngine } from "../engine/engine";
import type { PrimitiveKind } from "../engine/mesh";
import { Btn, Section, Slider, Toggle } from "./ui";
import { TOOL_BY_ID } from "../tools";
import { cn } from "../utils/cn";
import { SculptScriptTab } from "./SculptScriptTab";

export type TabId = "brush" | "object" | "mesh" | "view" | "export" | "ai";

export const TABS: { id: TabId; label: string }[] = [
  { id: "brush", label: "Kuas" },
  { id: "object", label: "Objek" },
  { id: "mesh", label: "Mesh" },
  { id: "view", label: "Tampilan" },
  { id: "ai", label: "AI Sculpt" },
  { id: "export", label: "Ekspor" },
];

interface Props {
  engine: SculptEngine | null;
  s: Settings;
  st: EngineState;
  update: (p: Partial<Settings>) => void;
  setStrength: (v: number) => void;
  tab: TabId;
  setTab: (t: TabId) => void;
  toast: (m: string) => void;
  cursor: [number, number, number] | null;
}

function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const fmt = (n: number) => n.toLocaleString("id-ID");

export function Panel(props: Props) {
  const { tab, setTab } = props;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 border-b border-zinc-800 bg-[#12151b]">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "flex-1 px-1 py-2.5 text-[12px] font-medium transition-colors border-b-2",
              tab === t.id
                ? "border-[#7c9cff] text-white"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {tab === "brush" && <BrushTab {...props} />}
        {tab === "object" && <ObjectTab {...props} />}
        {tab === "mesh" && <MeshTab {...props} />}
        {tab === "view" && <ViewTab {...props} />}
        {tab === "ai" && <SculptScriptTab {...props} />}
        {tab === "export" && <ExportTab {...props} />}
      </div>
    </div>
  );
}

const FALLOFFS: { id: FalloffId; label: string }[] = [
  { id: "smooth", label: "Halus" },
  { id: "sphere", label: "Bulat" },
  { id: "linear", label: "Linear" },
  { id: "sharp", label: "Tajam" },
];

function FalloffIcon({ id }: { id: FalloffId }) {
  const pts: string[] = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    let v = 0;
    if (id === "smooth") v = 1 - t * t * (3 - 2 * t);
    else if (id === "sphere") v = Math.sqrt(1 - t * t);
    else if (id === "linear") v = 1 - t;
    else v = (1 - t) * (1 - t);
    pts.push(`${(t * 30).toFixed(1)},${(14 - v * 12).toFixed(1)}`);
  }
  return (
    <svg width="32" height="16" viewBox="0 0 30 16" className="mx-auto">
      <polyline points={pts.join(" ")} fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function BrushTab({ s, update, setStrength }: Props) {
  const tool = TOOL_BY_ID[s.tool];
  const isTransform = s.tool === "transform";
  return (
    <>
      <div className="border-b border-zinc-800/80 bg-[#7c9cff]/5 px-3 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <tool.icon size={16} /> {tool.label}
          {tool.key && (
            <kbd className="ml-auto hidden rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 md:block">
              {tool.key}
            </kbd>
          )}
        </div>
        <p className="mt-1 text-[11.5px] leading-snug text-zinc-400">{tool.hint}</p>
      </div>

      {isTransform ? (
        <Section title="Mode Gizmo">
          <div className="grid grid-cols-3 gap-2">
            <Btn active={s.transformMode === "translate"} onClick={() => update({ transformMode: "translate" })}>
              <Move size={14} /> Geser
            </Btn>
            <Btn active={s.transformMode === "rotate"} onClick={() => update({ transformMode: "rotate" })}>
              <Rotate3d size={14} /> Putar
            </Btn>
            <Btn active={s.transformMode === "scale"} onClick={() => update({ transformMode: "scale" })}>
              <Scale3d size={14} /> Skala
            </Btn>
          </div>
          <p className="text-[11px] text-zinc-500">
            Transformasi otomatis "dipanggang" ke mesh saat kembali ke kuas sculpt, sehingga simetri tetap
            akurat terhadap sumbu dunia.
          </p>
        </Section>
      ) : (
        <>
          <Section title="Kuas">
            <Slider label="Ukuran (px)" value={s.radius} min={8} max={300} onChange={(v) => update({ radius: v })} />
            {s.tool !== "grab" && (
              <Slider
                label="Kekuatan"
                value={s.strength}
                min={0.02}
                max={1}
                step={0.01}
                onChange={setStrength}
                format={(v) => Math.round(v * 100) + "%"}
              />
            )}
            {s.tool !== "grab" && s.tool !== "snake" && (
              <Slider
                label="Jarak titik (spacing)"
                value={s.spacing}
                min={0.04}
                max={0.5}
                step={0.01}
                onChange={(v) => update({ spacing: v })}
                format={(v) => Math.round(v * 100) + "%"}
              />
            )}
            <div>
              <div className="mb-1 text-[11px] text-zinc-400">Falloff</div>
              <div className="grid grid-cols-4 gap-1.5">
                {FALLOFFS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => update({ falloff: f.id })}
                    className={cn(
                      "rounded-lg border py-1.5 text-[10px] transition-colors",
                      s.falloff === f.id
                        ? "border-[#7c9cff] bg-[#7c9cff]/15 text-[#b9c9ff]"
                        : "border-zinc-700/80 bg-zinc-800/60 text-zinc-400"
                    )}
                  >
                    <FalloffIcon id={f.id} />
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <Toggle
              label="Mode kurangi / hapus (−)"
              checked={s.invert}
              onChange={(v) => update({ invert: v })}
              hint="Ctrl + drag di desktop"
            />
            {s.tool === "paint" && (
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-zinc-200">Warna cat</span>
                <input
                  type="color"
                  value={s.color}
                  onChange={(e) => update({ color: e.target.value })}
                  className="h-9 w-14"
                />
              </div>
            )}
            {s.tool === "roughen" && (
              <Slider
                label="Noise Scale (kerapatan bintil)"
                value={s.noiseScale}
                min={1}
                max={40}
                step={0.5}
                onChange={(v) => update({ noiseScale: v })}
                format={(v) => v.toFixed(1)}
              />
            )}
          </Section>

          <Section title="Simetri (bagian lain ikut terpahat)">
            <div className="grid grid-cols-3 gap-2">
              <Btn active={s.symX} onClick={() => update({ symX: !s.symX })}>
                <span className="text-red-400">●</span> Sumbu X
              </Btn>
              <Btn active={s.symY} onClick={() => update({ symY: !s.symY })}>
                <span className="text-green-400">●</span> Sumbu Y
              </Btn>
              <Btn active={s.symZ} onClick={() => update({ symZ: !s.symZ })}>
                <span className="text-blue-400">●</span> Sumbu Z
              </Btn>
            </div>
            <Slider
              label="Radial (sekeliling sumbu Y)"
              value={s.radial}
              min={1}
              max={12}
              onChange={(v) => update({ radial: v })}
              format={(v) => (v === 1 ? "mati" : v + "×")}
            />
            <Toggle
              label="Simetri lintas objek"
              checked={s.crossParts}
              onChange={(v) => update({ crossParts: v })}
              hint="Cermin juga memahat objek lain (mis. lengan kiri ⇄ kanan)"
            />
          </Section>

          <Section title="Perilaku">
            <Toggle
              label="Hanya sisi depan"
              checked={s.frontOnly}
              onChange={(v) => update({ frontOnly: v })}
              hint="Titik di belakang tidak ikut terpahat"
            />
            <Toggle
              label="Pilih objek otomatis"
              checked={s.autoSelect}
              onChange={(v) => update({ autoSelect: v })}
              hint="Menyentuh objek lain langsung memilihnya"
            />
          </Section>
        </>
      )}
    </>
  );
}

const PRIMS: { kind: PrimitiveKind; label: string; icon: any }[] = [
  { kind: "sphere", label: "Bola", icon: Circle },
  { kind: "cube", label: "Kubus", icon: Box },
  { kind: "cylinder", label: "Silinder", icon: Cylinder },
  { kind: "capsule", label: "Kapsul", icon: Pill },
  { kind: "cone", label: "Kerucut", icon: Cone },
  { kind: "torus", label: "Torus", icon: Donut },
  { kind: "plane", label: "Bidang", icon: Square },
];

function ObjectTab({ engine, st }: Props) {
  const [quality, setQuality] = useState(1);
  const active = st.parts.find((p) => p.id === st.activeId);
  if (!engine) return null;
  return (
    <>
      <Section title="Tambah objek">
        <div className="grid grid-cols-4 gap-1.5">
          {PRIMS.map((p) => (
            <button
              key={p.kind}
              onClick={() => engine.addPrimitive(p.kind, quality)}
              className="flex flex-col items-center gap-1 rounded-lg border border-zinc-700/80 bg-zinc-800/60 py-2 text-[10px] text-zinc-300 active:scale-95 hover:bg-zinc-700/70"
            >
              <p.icon size={18} />
              {p.label}
            </button>
          ))}
          <button
            onClick={() => engine.newScene("character")}
            className="flex flex-col items-center gap-1 rounded-lg border border-[#7c9cff]/60 bg-[#7c9cff]/10 py-2 text-[10px] text-[#b9c9ff] active:scale-95"
            title="Ganti scene dengan kerangka karakter (kepala, badan, tangan, kaki)"
          >
            <User size={18} />
            Karakter
          </button>
        </div>
        <div>
          <div className="mb-1 text-[11px] text-zinc-400">Resolusi objek baru</div>
          <div className="grid grid-cols-3 gap-1.5">
            {[
              [0.55, "Rendah"],
              [1, "Sedang"],
              [1.5, "Tinggi"],
            ].map(([q, l]) => (
              <Btn key={l as string} active={quality === q} onClick={() => setQuality(q as number)}>
                {l}
              </Btn>
            ))}
          </div>
        </div>
      </Section>

      <Section title={`Daftar objek (${st.parts.length})`}>
        <div className="space-y-1">
          {st.parts.map((p) => (
            <div
              key={p.id}
              onClick={() => engine.setActive(p.id)}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-2 py-1.5",
                p.id === st.activeId
                  ? "border-[#7c9cff]/70 bg-[#7c9cff]/10"
                  : "border-zinc-800 bg-zinc-900/60"
              )}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  engine.toggleVisible(p.id);
                }}
                className="text-zinc-400 hover:text-white"
              >
                {p.visible ? <Eye size={15} /> : <EyeOff size={15} />}
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] text-zinc-100">{p.name}</div>
                <div className="font-mono text-[10px] text-zinc-500">
                  {fmt(p.verts)} titik · {fmt(p.tris)} tri
                </div>
              </div>
            </div>
          ))}
          {!st.parts.length && <p className="text-xs text-zinc-500">Scene kosong. Tambahkan objek di atas.</p>}
        </div>
        {active && (
          <>
            <input
              key={active.id}
              defaultValue={active.name}
              onBlur={(e) => engine.renamePart(active.id, e.target.value || active.name)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-2 text-[13px] text-zinc-100 outline-none focus:border-[#7c9cff]"
              placeholder="Nama objek"
            />
            <div className="grid grid-cols-2 gap-1.5">
              <Btn onClick={() => engine.duplicatePart(active.id)}>
                <Copy size={14} /> Duplikat
              </Btn>
              <Btn onClick={() => engine.duplicatePart(active.id, 0)} title="Salin mirror pada sumbu X (mis. lengan kanan dari kiri)">
                <FlipHorizontal2 size={14} /> Cermin X
              </Btn>
              <Btn onClick={() => engine.duplicatePart(active.id, 1)}>
                <FlipHorizontal2 size={14} className="rotate-90" /> Cermin Y
              </Btn>
              <Btn onClick={() => engine.duplicatePart(active.id, 2)}>
                <FlipHorizontal2 size={14} /> Cermin Z
              </Btn>
              <Btn tone="danger" className="col-span-2" onClick={() => engine.removePart(active.id)}>
                <Trash2 size={14} /> Hapus objek
              </Btn>
            </div>
          </>
        )}
      </Section>

      <Section title="Scene baru">
        <div className="grid grid-cols-3 gap-1.5">
          <Btn
            onClick={() => {
              if (confirm("Hapus semua objek & mulai scene baru (Bola)?")) engine.newScene("sphere");
            }}
          >
            Bola
          </Btn>
          <Btn
            onClick={() => {
              if (confirm("Hapus semua objek & mulai dengan kerangka karakter?")) engine.newScene("character");
            }}
          >
            Karakter
          </Btn>
          <Btn
            onClick={() => {
              if (confirm("Hapus semua objek?")) engine.newScene("empty");
            }}
          >
            Kosong
          </Btn>
        </div>
        <p className="text-[11px] text-zinc-500">
          Tips karakter: tarik anggota tubuh dengan <b>Grab</b>/<b>Snake</b>, simetri X aktif membuat sisi kiri-kanan
          ikut terpahat. Tekan <b>Cermin X</b> untuk menyalin lengan ke sisi lain.
        </p>
      </Section>
    </>
  );
}

function MeshTab({ engine, st, s, update }: Props) {
  if (!engine) return null;
  const active = st.parts.find((p) => p.id === st.activeId);
  return (
    <>
      <Section title="Statistik">
        <div className="grid grid-cols-2 gap-2 font-mono text-[12px]">
          <div className="rounded-lg bg-zinc-900 p-2">
            <div className="text-[10px] text-zinc-500">Objek aktif</div>
            <div>{active ? fmt(active.tris) : 0} tri</div>
            <div className="text-zinc-500">{active ? fmt(active.verts) : 0} titik</div>
          </div>
          <div className="rounded-lg bg-zinc-900 p-2">
            <div className="text-[10px] text-zinc-500">Total scene</div>
            <div>{fmt(st.tris)} tri</div>
            <div className="text-zinc-500">{fmt(st.verts)} titik</div>
          </div>
        </div>
        {st.dims && (
          <div className="rounded-lg bg-zinc-900 p-2 font-mono text-[12px]">
            <div className="text-[10px] text-zinc-500">Dimensi (unit)</div>
            L {st.dims[0].toFixed(3)} · T {st.dims[1].toFixed(3)} · D {st.dims[2].toFixed(3)}
          </div>
        )}
      </Section>

      <Section title="Subdivisi (tambah detail)">
        <div className="grid grid-cols-2 gap-2">
          <Btn tone="primary" onClick={() => engine.subdividePart(true)} title="Loop subdivision – halus">
            Subdivide Halus
          </Btn>
          <Btn onClick={() => engine.subdividePart(false)} title="Mempertahankan bentuk persis">
            Subdivide Simpel
          </Btn>
        </div>
        <p className="text-[11px] text-zinc-500">
          Setiap subdivisi melipatgandakan poligon ×4 (maks 900 rb segitiga). Tambah detail sebelum memahat pori,
          kerutan & jari.
        </p>
      </Section>

      <Section title="Operasi global">
        <div className="grid grid-cols-3 gap-2">
          <Btn onClick={() => engine.smoothAll(2, 0.5)}>Haluskan</Btn>
          <Btn onClick={() => engine.inflateAll(0.04)}>Gemukkan</Btn>
          <Btn onClick={() => engine.inflateAll(-0.04)}>Kurusi</Btn>
        </div>
      </Section>

      <Section title="Mask">
        <div className="grid grid-cols-3 gap-2">
          <Btn active={s.tool === "mask"} onClick={() => update({ tool: "mask" })}>
            Kuas mask
          </Btn>
          <Btn onClick={() => engine.maskOp("invert")}>Balik</Btn>
          <Btn disabled={!st.hasMask} onClick={() => engine.maskOp("clear")}>
            Hapus
          </Btn>
          <Btn onClick={() => engine.maskOp("blur")}>Blur</Btn>
          <Btn onClick={() => engine.maskOp("sharpen")}>Tajamkan</Btn>
          <Btn onClick={() => engine.maskOp("all")}>Semua</Btn>
        </div>
        <p className="text-[11px] text-zinc-500">Area ber-mask (gelap) terkunci dari semua kuas.</p>
      </Section>

      <Section title="Warna">
        <div className="flex items-center gap-3">
          <input type="color" value={s.color} onChange={(e) => update({ color: e.target.value })} className="h-9 w-14" />
          <Btn className="flex-1" onClick={() => engine.fillPaint(s.color)}>
            Isi seluruh objek
          </Btn>
        </div>
      </Section>
    </>
  );
}

function ViewTab({ engine, s, update, cursor }: Props) {
  if (!engine) return null;
  const MATCAPS = ["Tanah liat", "Mutiara", "Lilin merah", "Logam"];
  return (
    <>
      <Section title="Kamera & koordinat">
        <div className="grid grid-cols-3 gap-1.5">
          {[
            ["+z", "Depan"],
            ["-z", "Belakang"],
            ["-x", "Kiri"],
            ["+x", "Kanan"],
            ["+y", "Atas"],
            ["-y", "Bawah"],
          ].map(([v, l]) => (
            <Btn key={v} onClick={() => engine.setView(v)}>
              {l}
            </Btn>
          ))}
        </div>
        <Btn className="w-full" onClick={() => engine.frameAll()}>
          Fokus ke seluruh model
        </Btn>
        <div className="rounded-lg bg-zinc-900 p-2 font-mono text-[12px]">
          <div className="text-[10px] text-zinc-500">Posisi kursor di permukaan</div>
          {cursor ? (
            <>
              <span className="text-red-400">X</span> {cursor[0].toFixed(3)}{" "}
              <span className="text-green-400">Y</span> {cursor[1].toFixed(3)}{" "}
              <span className="text-blue-400">Z</span> {cursor[2].toFixed(3)}
            </>
          ) : (
            <span className="text-zinc-600">—</span>
          )}
        </div>
      </Section>
      <Section title="Tampilan">
        <Toggle label="Wireframe" checked={s.wire} onChange={(v) => update({ wire: v })} />
        <Toggle label="Flat shading" checked={s.flat} onChange={(v) => update({ flat: v })} />
        <Toggle label="Grid lantai" checked={s.grid} onChange={(v) => update({ grid: v })} />
        <Toggle label="Garis sumbu X Y Z" checked={s.axes} onChange={(v) => update({ axes: v })} />
        <Toggle label="Label angka koordinat" checked={s.labels} onChange={(v) => update({ labels: v })} />
        <Toggle label="Bidang simetri" checked={s.symPlanes} onChange={(v) => update({ symPlanes: v })} />
      </Section>
      <Section title="Material (MatCap)">
        <div className="grid grid-cols-2 gap-1.5">
          {MATCAPS.map((m, i) => (
            <Btn key={m} active={s.matcap === i} onClick={() => update({ matcap: i })}>
              {m}
            </Btn>
          ))}
        </div>
      </Section>
    </>
  );
}

function ExportTab({ engine, st, toast }: Props) {
  const [name, setName] = useState("karakter-saya");
  const [onlySel, setOnlySel] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  if (!engine) return null;

  const doExport = async (f: ExportFormat) => {
    setBusy(f);
    await new Promise((r) => setTimeout(r, 30));
    try {
      const { blob, ext } = await engine.exportModel(f, onlySel);
      const safe = (name || "model").trim().replace(/[^\w\-]+/g, "_");
      download(blob, `${safe}.${ext}`);
      toast(`Berhasil mengekspor ${safe}.${ext} (${(blob.size / 1024 / 1024).toFixed(2)} MB)`);
    } catch (e: any) {
      toast("Gagal ekspor: " + (e?.message ?? e));
    }
    setBusy(null);
  };

  const FORMATS: { f: ExportFormat; title: string; desc: string }[] = [
    { f: "glb", title: "GLB", desc: "glTF biner + warna vertex. Terbaik untuk web, Unity, Unreal, Blender." },
    { f: "gltf", title: "GLTF", desc: "glTF JSON (buffer tertanam)." },
    { f: "obj", title: "OBJ", desc: "Universal – dibuka di Blender, Maya, ZBrush." },
    { f: "stl", title: "STL", desc: "Untuk 3D print." },
  ];

  return (
    <>
      <Section title="Ekspor model">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-2 text-[13px] text-zinc-100 outline-none focus:border-[#7c9cff]"
          placeholder="Nama file"
        />
        <Toggle label="Hanya objek aktif" checked={onlySel} onChange={setOnlySel} hint="Jika mati: semua objek yang terlihat" />
        <div className="space-y-1.5">
          {FORMATS.map((x) => (
            <button
              key={x.f}
              disabled={!!busy || !st.parts.length}
              onClick={() => doExport(x.f)}
              className="flex w-full items-center gap-3 rounded-lg border border-zinc-700/80 bg-zinc-800/60 px-3 py-2.5 text-left transition-colors hover:bg-zinc-700/70 active:scale-[0.98] disabled:opacity-40"
            >
              <Download size={16} className="shrink-0 text-[#9db4ff]" />
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-zinc-100">
                  {busy === x.f ? "Memproses…" : `Unduh .${x.f.toUpperCase()}`}
                </span>
                <span className="block text-[11px] leading-tight text-zinc-500">{x.desc}</span>
              </span>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-zinc-500">
          Sumbu: Y ke atas, 1 unit = 1 meter (konvensi glTF). Posisi & koordinat dunia sama persis dengan yang
          terlihat pada grid.
        </p>
      </Section>
      <Section title="Impor">
        <input
          ref={fileRef}
          type="file"
          accept=".obj,.glb,.gltf"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            try {
              await engine.importFile(f);
              toast(`Berhasil impor ${f.name}`);
            } catch (err: any) {
              toast("Gagal impor: " + (err?.message ?? err));
            }
          }}
        />
        <Btn className="w-full" onClick={() => fileRef.current?.click()}>
          <Upload size={14} /> Impor OBJ / GLB / GLTF
        </Btn>
      </Section>
    </>
  );
}
