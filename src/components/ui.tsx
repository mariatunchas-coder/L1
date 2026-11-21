import type { ReactNode } from "react";
import { cn } from "../utils/cn";

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  className,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  className?: string;
}) {
  const p = ((value - min) / (max - min)) * 100;
  return (
    <div className={cn("w-full", className)}>
      <div className="flex items-center justify-between text-[11px] text-zinc-400 leading-none mb-0.5">
        <span>{label}</span>
        <span className="font-mono text-zinc-200">{format ? format(value) : value}</span>
      </div>
      <input
        type="range"
        className="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ["--p" as any]: `${p}%` }}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 py-1.5 text-left"
    >
      <span className="min-w-0">
        <span className="block text-[13px] text-zinc-200">{label}</span>
        {hint && <span className="block text-[11px] text-zinc-500 leading-tight">{hint}</span>}
      </span>
      <span
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full transition-colors",
          checked ? "bg-[#7c9cff]" : "bg-zinc-700"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all",
            checked ? "left-[18px]" : "left-0.5"
          )}
        />
      </span>
    </button>
  );
}

export function Btn({
  children,
  onClick,
  active,
  disabled,
  className,
  title,
  tone = "default",
}: {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
  title?: string;
  tone?: "default" | "primary" | "danger";
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg border px-2.5 py-2 text-[12px] font-medium transition-colors active:scale-[0.97] disabled:opacity-35 disabled:pointer-events-none",
        tone === "primary" &&
          "border-[#7c9cff] bg-[#7c9cff] text-[#0b0d14] hover:bg-[#93affF]",
        tone === "danger" && "border-red-900/60 bg-red-950/40 text-red-300 hover:bg-red-900/40",
        tone === "default" &&
          (active
            ? "border-[#7c9cff] bg-[#7c9cff]/15 text-[#b9c9ff]"
            : "border-zinc-700/80 bg-zinc-800/60 text-zinc-200 hover:bg-zinc-700/70"),
        className
      )}
    >
      {children}
    </button>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-b border-zinc-800/80 px-3 py-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
        {title}
      </div>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}
