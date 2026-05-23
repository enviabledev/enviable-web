"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { ChevronDownIcon } from "@/components/icons";

export type MultiSelectOption = { value: string; label: string };

export type MultiSelectFilterProps = {
  label: string;
  placeholder: string;
  options: readonly MultiSelectOption[];
  selected: readonly string[];
  onChange: (next: readonly string[]) => void;
  icon?: ReactNode;
};

export default function MultiSelectFilter({
  label,
  placeholder,
  options,
  selected,
  onChange,
  icon,
}: MultiSelectFilterProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const toggle = (v: string) => {
    if (selected.includes(v)) {
      onChange(selected.filter((s) => s !== v));
    } else {
      onChange([...selected, v]);
    }
  };

  const summary =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? options.find((o) => o.value === selected[0])?.label ?? selected[0]
        : `${selected.length} selected`;

  return (
    <div className="flex flex-col gap-1 min-w-0" ref={wrapRef}>
      <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--color-ink-500)]">
        {label}
      </span>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`h-8 px-2.5 bg-white border rounded-[3px] text-[13px] flex items-center gap-1.5 cursor-pointer w-full min-w-0 ${
          open
            ? "border-[var(--color-navy-700)] shadow-[0_0_0_3px_rgba(31,78,121,0.10)]"
            : "border-[var(--color-border-strong)] hover:border-[var(--color-ink-400)]"
        }`}
      >
        {icon && <span className="text-[var(--color-ink-500)] flex-shrink-0">{icon}</span>}
        <span
          className={`flex-1 text-left truncate ${selected.length === 0 ? "text-[var(--color-ink-400)]" : "text-[var(--color-ink-900)] font-medium"}`}
        >
          {summary}
        </span>
        {selected.length > 1 && (
          <span className="text-[10px] font-semibold text-white bg-[var(--color-navy-700)] rounded-full px-1.5 py-px">
            {selected.length}
          </span>
        )}
        <ChevronDownIcon style={{ color: "var(--color-ink-400)" }} />
      </button>

      {open && (
        <div className="relative">
          <div
            className="absolute z-40 top-1 left-0 right-0 min-w-[220px] max-h-[280px] overflow-y-auto bg-white border border-[var(--color-border-default)] rounded-[3px] py-1"
            style={{ boxShadow: "0 6px 20px rgba(15,42,68,0.11), 0 2px 5px rgba(15,42,68,0.07)" }}
          >
            {options.length === 0 && (
              <div className="px-2.5 py-2 text-[12px] text-[var(--color-ink-500)]">No options</div>
            )}
            {options.map((opt) => {
              const checked = selected.includes(opt.value);
              return (
                <label
                  key={opt.value}
                  className="flex items-center gap-2 px-2.5 py-1.5 cursor-pointer hover:bg-[var(--color-ink-100)] text-[12.5px] text-[var(--color-ink-900)]"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(opt.value)}
                    className="w-3.5 h-3.5 accent-[var(--color-navy-700)] cursor-pointer"
                  />
                  <span className="flex-1 truncate">{opt.label}</span>
                </label>
              );
            })}
            {selected.length > 0 && (
              <div className="border-t border-[var(--color-border-default)] mt-1 pt-1">
                <button
                  type="button"
                  onClick={() => onChange([])}
                  className="w-full text-left px-2.5 py-1.5 text-[12px] text-[var(--color-navy-700)] hover:bg-[var(--color-navy-50)]"
                >
                  Clear selection
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
