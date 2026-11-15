import { useState, type ReactNode } from 'react';

export function Section({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-white/5 last:border-0">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-300 hover:text-white">
        {title}
        <span className={`text-slate-500 transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
      </button>
      {open && <div className="space-y-3 px-4 pb-4">{children}</div>}
    </div>
  );
}

export function Slider({ label, value, min, max, step = 0.01, onChange, fmt, hint }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; fmt?: (v: number) => string; hint?: string }) {
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
        <span>
          {label}
          {hint && <span className="ml-1.5 text-[10px] text-slate-500">{hint}</span>}
        </span>
        <span className="font-mono text-[11px] text-sky-300">{fmt ? fmt(value) : value.toFixed(2)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-sky-400" />
    </label>
  );
}

export function Toggle({ label, value, onChange, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <button onClick={() => onChange(!value)} className="flex w-full items-center justify-between gap-3 text-left text-xs text-slate-300">
      <span>
        {label}
        {hint && <span className="ml-1.5 text-[10px] text-slate-500">{hint}</span>}
      </span>
      <span className={`relative h-4 w-8 shrink-0 rounded-full transition-colors ${value ? 'bg-sky-500' : 'bg-white/15'}`}>
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${value ? 'left-4' : 'left-0.5'}`} />
      </span>
    </button>
  );
}

export function Segmented<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { label: string; value: T }[]; onChange: (v: T) => void }) {
  return (
    <div>
      <div className="mb-1 text-xs text-slate-400">{label}</div>
      <div className="flex gap-1 rounded-lg bg-white/5 p-0.5">
        {options.map((o) => (
          <button key={String(o.value)} onClick={() => onChange(o.value)} className={`flex-1 rounded-md px-1.5 py-1 text-[11px] font-medium transition-colors ${o.value === value ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-white'}`}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Stat({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div className="flex justify-between gap-6">
      <span className="text-slate-500">{k}</span>
      <span className={`font-mono ${warn ? 'text-amber-300' : 'text-slate-100'}`}>{v}</span>
    </div>
  );
}
