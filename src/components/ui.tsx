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

export function Button({ children, onClick, variant = 'default', disabled, title }: { children: ReactNode; onClick?: () => void; variant?: 'default' | 'primary' | 'danger'; disabled?: boolean; title?: string }) {
  const cls = variant === 'primary' ? 'bg-sky-500 text-white hover:bg-sky-400' : variant === 'danger' ? 'bg-rose-500/20 text-rose-200 hover:bg-rose-500/40' : 'bg-white/8 text-slate-200 hover:bg-white/15';
  return (
    <button title={title} disabled={disabled} onClick={onClick} className={`rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${cls}`}>
      {children}
    </button>
  );
}

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  return (
    <label className="flex items-center justify-between text-xs text-slate-400">
      <span>{label}</span>
      <span className="flex items-center gap-2">
        <span className="font-mono text-[11px] text-sky-300">{value}</span>
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-5 w-8 cursor-pointer rounded border-0 bg-transparent p-0" />
      </span>
    </label>
  );
}

export function Select<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { label: string; value: T }[]; onChange: (v: T) => void }) {
  return (
    <label className="block">
      <div className="mb-1 text-xs text-slate-400">{label}</div>
      <select
        value={String(value)}
        onChange={(e) => {
          const o = options.find((x) => String(x.value) === e.target.value);
          if (o) onChange(o.value);
        }}
        className="w-full rounded-md bg-slate-800 px-2 py-1.5 text-xs text-slate-100 ring-1 ring-white/10 outline-none focus:ring-sky-400"
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Tabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="sticky top-0 z-10 flex gap-0.5 bg-slate-950/95 p-1.5 backdrop-blur">
      {tabs.map((t) => (
        <button key={t.id} onClick={() => onChange(t.id)} className={`flex-1 rounded-md px-1 py-1.5 text-[11px] font-semibold tracking-wide transition-colors ${t.id === value ? 'bg-sky-500 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Note({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' | 'error' }) {
  const cls = tone === 'error' ? 'bg-rose-500/10 text-rose-200 ring-rose-400/30' : tone === 'warn' ? 'bg-amber-500/10 text-amber-200 ring-amber-400/30' : 'bg-sky-500/10 text-sky-100 ring-sky-400/20';
  return <div className={`rounded-lg p-2.5 text-[11px] leading-relaxed ring-1 ${cls}`}>{children}</div>;
}
