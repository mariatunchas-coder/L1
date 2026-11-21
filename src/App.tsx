import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Download,
  Maximize,
  Minus,
  PanelRight,
  Plus,
  Redo2,
  Undo2,
  X,
} from "lucide-react";
import {
  SculptEngine,
  defaultSettings,
  type EngineState,
  type Settings,
  type ToolId,
} from "./engine/engine";
import { TOOLS, TOOL_BY_ID } from "./tools";
import { Panel, type TabId } from "./components/Panels";
import { Slider } from "./components/ui";
import { cn } from "./utils/cn";

const emptyState: EngineState = {
  parts: [],
  activeId: null,
  canUndo: false,
  canRedo: false,
  verts: 0,
  tris: 0,
  dims: null,
  hasMask: false,
};

const isMobileNow = () => typeof window !== "undefined" && window.innerWidth < 768;

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gizmoRef = useRef<HTMLCanvasElement>(null);
  const [engine, setEngine] = useState<SculptEngine | null>(null);
  const [s, setS] = useState<Settings>(() => ({
    ...defaultSettings,
    radius: isMobileNow() ? 55 : 70,
  }));
  const [strengths, setStrengths] = useState<Record<string, number>>(() =>
    Object.fromEntries(TOOLS.map((t) => [t.id, t.defaultStrength]))
  );
  const [st, setSt] = useState<EngineState>(emptyState);
  const [cursor, setCursor] = useState<[number, number, number] | null>(null);
  const [tab, setTab] = useState<TabId>("brush");
  const [panelOpen, setPanelOpen] = useState(() => !isMobileNow());
  const [dockOpen, setDockOpen] = useState(true);
  const [help, setHelp] = useState(() => {
    try {
      return !localStorage.getItem("sculpt-help-seen");
    } catch {
      return true;
    }
  });
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const toast = useCallback((m: string) => {
    if (!m) return;
    setToastMsg(m);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 3500);
  }, []);

  // create engine
  useEffect(() => {
    const canvas = canvasRef.current!;
    const eng = new SculptEngine(canvas);
    eng.onState = (x) => setSt(x);
    eng.onHover = (p) => setCursor(p ? [p.x, p.y, p.z] : null);
    eng.onToast = (m) => toast(m);
    eng.attachGizmo(gizmoRef.current);
    eng.setSettings({ ...defaultSettings, radius: isMobileNow() ? 55 : 70 });
    eng.newScene("sphere");
    setEngine(eng);
    return () => {
      eng.dispose();
    };
  }, [toast]);

  const update = useCallback(
    (p: Partial<Settings>) => {
      setS((prev) => ({ ...prev, ...p }));
      engine?.setSettings(p);
    },
    [engine]
  );

  const selectTool = useCallback(
    (id: ToolId) => {
      update({ tool: id, strength: strengths[id], cameraMode: false });
    },
    [update, strengths]
  );

  const setStrength = useCallback(
    (v: number) => {
      setStrengths((prev) => ({ ...prev, [s.tool]: v }));
      update({ strength: v });
    },
    [update, s.tool]
  );

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA") && (t as HTMLInputElement).type !== "range") return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "z") {
        e.preventDefault();
        if (e.shiftKey) engine?.redo();
        else engine?.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && k === "y") {
        e.preventDefault();
        engine?.redo();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (k === "[") update({ radius: Math.max(8, s.radius - 8) });
      else if (k === "]") update({ radius: Math.min(300, s.radius + 8) });
      else if (k === "x" && e.shiftKey) update({ symX: !s.symX });
      else if (k === "y" && e.shiftKey) update({ symY: !s.symY });
      else if (k === "z" && e.shiftKey) update({ symZ: !s.symZ });
      else if (k === "." || k === "home") engine?.frameAll();
      else if (!e.shiftKey) {
        const tool = TOOLS.find((x) => x.key?.toLowerCase() === k);
        if (tool) selectTool(tool.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [engine, s, update, selectTool]);

  const closeHelp = () => {
    setHelp(false);
    try {
      localStorage.setItem("sculpt-help-seen", "1");
    } catch {
      /* ignore */
    }
  };

  const tool = TOOL_BY_ID[s.tool];
  const panelProps = { engine, s, st, update, setStrength, tab, setTab, toast, cursor };

  return (
    <div className="flex h-dvh w-screen flex-col overflow-hidden bg-[#0e1014] text-zinc-200">
      {/* ───────── top bar ───────── */}
      <header className="flex h-12 shrink-0 items-center gap-1.5 border-b border-zinc-800 bg-[#12151b] px-2 md:gap-2 md:px-3">
        <div className="mr-1 flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-[#7c9cff] to-[#b07cff] text-[13px] font-black text-[#0b0d14]">
            S
          </div>
          <div className="hidden leading-none lg:block">
            <div className="text-[13px] font-bold tracking-tight text-white">SculptStudio 3D</div>
            <div className="mt-0.5 text-[10px] text-zinc-500">Pahat · Warnai · Ekspor</div>
          </div>
        </div>

        <IconBtn title="Undo (Ctrl+Z)" disabled={!st.canUndo} onClick={() => engine?.undo()}>
          <Undo2 size={17} />
        </IconBtn>
        <IconBtn title="Redo (Ctrl+Y)" disabled={!st.canRedo} onClick={() => engine?.redo()}>
          <Redo2 size={17} />
        </IconBtn>

        <div className="mx-1 flex rounded-lg border border-zinc-700/80 bg-zinc-900 p-0.5">
          <button
            onClick={() => update({ cameraMode: false })}
            className={cn(
              "rounded-md px-2.5 py-1.5 text-[12px] font-semibold transition-colors",
              !s.cameraMode ? "bg-[#7c9cff] text-[#0b0d14]" : "text-zinc-400"
            )}
          >
            Pahat
          </button>
          <button
            onClick={() => update({ cameraMode: true })}
            className={cn(
              "flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[12px] font-semibold transition-colors",
              s.cameraMode ? "bg-[#7c9cff] text-[#0b0d14]" : "text-zinc-400"
            )}
            title="Mode kamera: 1 jari / klik kiri memutar kamera"
          >
            <Camera size={13} /> Kamera
          </button>
        </div>

        <button
          onClick={() => update({ invert: !s.invert })}
          title="Tambah (+) / Kurangi (−)"
          className={cn(
            "flex h-9 items-center gap-1 rounded-lg border px-2.5 text-[12px] font-semibold transition-colors",
            s.invert
              ? "border-amber-500/70 bg-amber-500/15 text-amber-300"
              : "border-zinc-700/80 bg-zinc-900 text-zinc-300"
          )}
        >
          {s.invert ? <Minus size={14} /> : <Plus size={14} />}
          <span className="hidden sm:inline">{s.invert ? "Kurangi" : "Tambah"}</span>
        </button>

        <div className="ml-auto flex items-center gap-1.5">
          <IconBtn title="Fokus ke model (.)" onClick={() => engine?.frameAll()}>
            <Maximize size={17} />
          </IconBtn>
          <IconBtn title="Panduan" onClick={() => setHelp(true)}>
            <CircleHelp size={17} />
          </IconBtn>
          <button
            onClick={() => {
              setTab("export");
              setPanelOpen(true);
            }}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-[#7c9cff] px-3 text-[12px] font-bold text-[#0b0d14] hover:bg-[#93aeff] active:scale-95"
          >
            <Download size={15} />
            <span className="hidden sm:inline">Ekspor</span>
          </button>
          <IconBtn title="Panel" active={panelOpen} onClick={() => setPanelOpen((v) => !v)}>
            <PanelRight size={17} />
          </IconBtn>
        </div>
      </header>

      {/* ───────── main ───────── */}
      <div className="flex min-h-0 flex-1">
        {/* tool rail (desktop) */}
        <nav className="thin-scroll hidden w-[66px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-zinc-800 bg-[#12151b] p-1.5 md:flex">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              title={`${t.label}${t.key ? ` (${t.key})` : ""} — ${t.hint}`}
              onClick={() => selectTool(t.id)}
              className={cn(
                "flex flex-col items-center gap-1 rounded-xl py-2 text-[10px] font-medium transition-colors",
                s.tool === t.id && !s.cameraMode
                  ? "bg-[#7c9cff] text-[#0b0d14]"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              )}
            >
              <t.icon size={19} />
              {t.label}
            </button>
          ))}
        </nav>

        {/* viewport */}
        <main className="relative min-w-0 flex-1 bg-[#15171d]">
          <canvas ref={canvasRef} className="viewport" />

          {/* info chips */}
          <div className="pointer-events-none absolute left-2 top-2 flex flex-col gap-1 font-mono text-[10.5px] md:text-[11.5px]">
            <div className="flex items-center gap-1.5 rounded-lg bg-black/55 px-2 py-1 backdrop-blur">
              <span className="font-sans font-semibold text-[#9db4ff]">{tool.label}</span>
              {s.cameraMode && <span className="rounded bg-[#7c9cff] px-1 font-sans text-[9px] font-bold text-black">KAMERA</span>}
              {(s.symX || s.symY || s.symZ || s.radial > 1) && (
                <span className="text-zinc-400">
                  Sim:
                  {s.symX && <span className="text-red-400"> X</span>}
                  {s.symY && <span className="text-green-400"> Y</span>}
                  {s.symZ && <span className="text-blue-400"> Z</span>}
                  {s.radial > 1 && <span className="text-purple-300"> ⟳{s.radial}</span>}
                </span>
              )}
            </div>
            <div className="rounded-lg bg-black/55 px-2 py-1 text-zinc-300 backdrop-blur">
              <span className="text-red-400">X</span> {cursor ? cursor[0].toFixed(2).padStart(6) : "  —   "}{" "}
              <span className="text-green-400">Y</span> {cursor ? cursor[1].toFixed(2).padStart(6) : "  —   "}{" "}
              <span className="text-blue-400">Z</span> {cursor ? cursor[2].toFixed(2).padStart(6) : "  —   "}
            </div>
            <div className="hidden rounded-lg bg-black/55 px-2 py-1 text-zinc-400 backdrop-blur sm:block">
              {st.tris.toLocaleString("id-ID")} tri · {st.verts.toLocaleString("id-ID")} titik
              {st.dims && (
                <span className="ml-2">
                  [{st.dims[0].toFixed(2)}×{st.dims[1].toFixed(2)}×{st.dims[2].toFixed(2)}]
                </span>
              )}
            </div>
          </div>

          {/* axis gizmo */}
          <canvas
            ref={gizmoRef}
            className="absolute right-1 top-1 h-[88px] w-[88px] cursor-pointer md:h-[104px] md:w-[104px]"
            onPointerDown={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              engine?.gizmoClick(e.clientX - r.left, e.clientY - r.top);
            }}
          />

          {/* desktop quick symmetry */}
          <div className="absolute bottom-3 left-3 hidden items-center gap-1.5 md:flex">
            {(
              [
                ["symX", "X", "text-red-400"],
                ["symY", "Y", "text-green-400"],
                ["symZ", "Z", "text-blue-400"],
              ] as const
            ).map(([key, label, color]) => (
              <button
                key={key}
                onClick={() => update({ [key]: !s[key] } as Partial<Settings>)}
                title={`Simetri sumbu ${label} (Shift+${label})`}
                className={cn(
                  "h-8 w-8 rounded-lg border text-[12px] font-bold backdrop-blur transition-colors",
                  s[key] ? "border-[#7c9cff] bg-[#7c9cff]/20 text-white" : "border-zinc-700 bg-black/50 text-zinc-500"
                )}
              >
                <span className={s[key] ? color : ""}>{label}</span>
              </button>
            ))}
            <span className="ml-1 rounded-lg bg-black/50 px-2 py-1.5 text-[10.5px] text-zinc-500 backdrop-blur">
              Simetri
            </span>
          </div>

          {toastMsg && (
            <div className="absolute bottom-4 left-1/2 z-20 max-w-[90%] -translate-x-1/2 rounded-xl border border-zinc-700 bg-zinc-900/95 px-4 py-2.5 text-center text-[12.5px] text-zinc-100 shadow-xl">
              {toastMsg}
            </div>
          )}
        </main>

        {/* side panel (desktop) */}
        <aside
          className={cn(
            "w-[300px] shrink-0 border-l border-zinc-800 bg-[#12151b]",
            panelOpen ? "hidden md:block" : "hidden"
          )}
        >
          <Panel {...panelProps} />
        </aside>
      </div>

      {/* ───────── mobile bottom sheet ───────── */}
      {panelOpen && (
        <div className="fixed inset-x-0 bottom-0 z-30 flex max-h-[64dvh] flex-col rounded-t-2xl border-t border-zinc-700 bg-[#12151b] shadow-[0_-12px_40px_rgba(0,0,0,0.6)] md:hidden">
          <div className="flex items-center justify-between px-3 pt-2">
            <div className="mx-auto h-1 w-10 rounded-full bg-zinc-700" />
            <button className="absolute right-2 top-1.5 rounded-lg p-1.5 text-zinc-400" onClick={() => setPanelOpen(false)}>
              <X size={18} />
            </button>
          </div>
          <div className="min-h-0 flex-1" style={{ height: "56dvh" }}>
            <Panel {...panelProps} />
          </div>
        </div>
      )}

      {/* ───────── mobile dock ───────── */}
      <div className="shrink-0 border-t border-zinc-800 bg-[#12151b] pb-[env(safe-area-inset-bottom)] md:hidden">
        <div className="no-scrollbar flex gap-1 overflow-x-auto px-1.5 py-1.5">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              onClick={() => selectTool(t.id)}
              className={cn(
                "flex min-w-[54px] shrink-0 flex-col items-center gap-0.5 rounded-xl py-1.5 text-[9.5px] font-medium",
                s.tool === t.id && !s.cameraMode ? "bg-[#7c9cff] text-[#0b0d14]" : "bg-zinc-800/50 text-zinc-400"
              )}
            >
              <t.icon size={18} />
              {t.label}
            </button>
          ))}
        </div>
        {dockOpen && s.tool !== "transform" && (
          <div className="flex items-end gap-3 px-3 pb-1.5">
            <Slider
              label="Ukuran"
              value={s.radius}
              min={8}
              max={220}
              onChange={(v) => update({ radius: v })}
            />
            {s.tool !== "grab" ? (
              <Slider
                label="Kekuatan"
                value={s.strength}
                min={0.02}
                max={1}
                step={0.01}
                onChange={setStrength}
                format={(v) => Math.round(v * 100) + "%"}
              />
            ) : (
              <div className="w-full" />
            )}
          </div>
        )}
        {dockOpen && s.tool === "transform" && (
          <div className="grid grid-cols-3 gap-2 px-3 pb-2">
            {(
              [
                ["translate", "Geser"],
                ["rotate", "Putar"],
                ["scale", "Skala"],
              ] as const
            ).map(([m, l]) => (
              <button
                key={m}
                onClick={() => update({ transformMode: m })}
                className={cn(
                  "rounded-lg border py-2 text-[12px] font-medium",
                  s.transformMode === m
                    ? "border-[#7c9cff] bg-[#7c9cff]/15 text-[#b9c9ff]"
                    : "border-zinc-700 bg-zinc-800/60 text-zinc-300"
                )}
              >
                {l}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1.5 px-2 pb-1.5">
          <button onClick={() => setDockOpen((v) => !v)} className="rounded-lg p-1.5 text-zinc-500">
            {dockOpen ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
          </button>
          {(
            [
              ["symX", "X", "text-red-400"],
              ["symY", "Y", "text-green-400"],
              ["symZ", "Z", "text-blue-400"],
            ] as const
          ).map(([key, label, color]) => (
            <button
              key={key}
              onClick={() => update({ [key]: !s[key] } as Partial<Settings>)}
              className={cn(
                "h-9 w-10 rounded-lg border text-[12px] font-bold",
                s[key] ? "border-[#7c9cff] bg-[#7c9cff]/20" : "border-zinc-700 bg-zinc-800/50 text-zinc-500"
              )}
            >
              <span className={s[key] ? color : ""}>{label}</span>
            </button>
          ))}
          <span className="text-[10px] text-zinc-500">Simetri</span>
          <button
            onClick={() => {
              setTab("brush");
              setPanelOpen((v) => !v);
            }}
            className="ml-auto flex h-9 items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800/70 px-3 text-[12px] font-semibold text-zinc-200"
          >
            <PanelRight size={15} /> Menu
          </button>
        </div>
      </div>

      {/* ───────── help ───────── */}
      {help && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/70 p-3 backdrop-blur-sm" onClick={closeHelp}>
          <div
            className="thin-scroll max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-zinc-700 bg-[#14171e] p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold text-white">Selamat datang di SculptStudio 3D</h2>
                <p className="mt-1 text-[13px] text-zinc-400">
                  Studio sculpting 3D di browser: pahat bola menjadi karakter, lalu ekspor ke OBJ / GLB / GLTF / STL.
                </p>
              </div>
              <button onClick={closeHelp} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800">
                <X size={18} />
              </button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-zinc-900 p-3">
                <div className="mb-1.5 text-[12px] font-bold text-[#9db4ff]">📱 HP / Tablet</div>
                <ul className="space-y-1 text-[12.5px] text-zinc-300">
                  <li>• <b>1 jari pada model</b> → memahat</li>
                  <li>• <b>1 jari di luar model</b> → memutar kamera</li>
                  <li>• <b>2 jari</b> → cubit = zoom, geser = pan</li>
                  <li>• Tombol <b>Kamera</b> → 1 jari selalu memutar</li>
                  <li>• Tombol <b>Tambah/Kurangi</b> → ganti arah kuas</li>
                  <li>• Stylus mendukung tekanan</li>
                </ul>
              </div>
              <div className="rounded-xl bg-zinc-900 p-3">
                <div className="mb-1.5 text-[12px] font-bold text-[#9db4ff]">🖱️ Desktop</div>
                <ul className="space-y-1 text-[12.5px] text-zinc-300">
                  <li>• <b>Klik kiri</b> pada model → memahat, di luar → orbit</li>
                  <li>• <b>Klik kanan</b> / Spasi+drag → pan · <b>Scroll</b> → zoom</li>
                  <li>• <b>Ctrl</b> = kurangi · <b>Shift</b> = smooth sementara</li>
                  <li>• <b>[ ]</b> ukuran · <b>Shift+X/Y/Z</b> simetri</li>
                  <li>• <b>D C I S F G K M B T</b> pilih kuas · <b>Ctrl+Z/Y</b> undo/redo</li>
                  <li>• Klik huruf pada gizmo sumbu → pindah sudut pandang</li>
                </ul>
              </div>
            </div>
            <div className="mt-3 rounded-xl bg-zinc-900 p-3 text-[12.5px] text-zinc-300">
              <div className="mb-1 text-[12px] font-bold text-[#9db4ff]">Alur membuat karakter</div>
              Mulai dari <b>Bola</b> atau <b>Karakter</b> (tab Objek) → bentuk besar dengan <b>Grab / Clay</b> → tambah
              detail lewat <b>Mesh › Subdivide</b> → lipatan dengan <b>Crease / Pinch</b> → warnai dengan <b>Cat</b> →{" "}
              <b>Ekspor</b>. Simetri X aktif secara default sehingga sisi seberang ikut terpahat.
            </div>
            <button
              onClick={closeHelp}
              className="mt-4 w-full rounded-xl bg-[#7c9cff] py-3 text-[14px] font-bold text-[#0b0d14] active:scale-[0.99]"
            >
              Mulai memahat
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  title,
  disabled,
  active,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "grid h-9 w-9 place-items-center rounded-lg transition-colors active:scale-95 disabled:opacity-30",
        active ? "bg-zinc-700 text-white" : "text-zinc-300 hover:bg-zinc-800"
      )}
    >
      {children}
    </button>
  );
}
