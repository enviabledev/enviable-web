"use client";

import { useEffect, useRef, useState } from "react";

import { BellIcon, ChevronDownIcon, HelpIcon, SearchIcon } from "@/components/icons";
import { usePrincipal } from "@/lib/auth";

function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export default function Topbar() {
  const principal = usePrincipal();
  const [notifOpen, setNotifOpen] = useState(false);
  const popRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!notifOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [notifOpen]);

  return (
    <header className="h-topbar sticky top-0 z-30 bg-white border-b border-[var(--color-border-default)] flex items-center gap-3 px-3.5 flex-shrink-0">
      <div className="flex items-center text-[12.5px] font-semibold text-[var(--color-ink-900)] tracking-[-0.005em] h-6 pr-3.5 border-r border-[var(--color-border-default)]">
        Enviable&nbsp;<span className="text-[var(--color-navy-700)]">Tricycle</span>
      </div>

      <label className="flex-1 max-w-[420px] mx-auto h-[26px] flex items-center gap-2 px-2.5 rounded-[4px] bg-[var(--color-ink-100)] border border-transparent text-[var(--color-ink-500)] text-[12px] focus-within:bg-white focus-within:border-[var(--color-navy-700)] focus-within:shadow-[0_0_0_3px_rgba(31,78,121,0.10)] transition-colors">
        <SearchIcon width={14} height={14} />
        <input
          type="text"
          placeholder="Search purchase orders, units, SKUs, customers, invoices..."
          className="flex-1 bg-transparent outline-none text-[12px] text-[var(--color-ink-900)] placeholder:text-[var(--color-ink-400)]"
        />
        <span className="font-mono text-[10px] px-1 border border-[var(--color-border-strong)] border-b-2 rounded-[2px] text-[var(--color-ink-700)] bg-white">
          &#8984;K
        </span>
      </label>

      <div className="flex items-center gap-1 relative">
        <button
          type="button"
          title="Help"
          className="w-[26px] h-[26px] grid place-items-center rounded-[4px] text-[var(--color-ink-700)] hover:bg-[var(--color-ink-100)] hover:text-[var(--color-ink-900)]"
        >
          <HelpIcon />
        </button>

        <button
          type="button"
          title="Notifications"
          onClick={(e) => {
            e.stopPropagation();
            setNotifOpen((v) => !v);
          }}
          className="relative w-[26px] h-[26px] grid place-items-center rounded-[4px] text-[var(--color-ink-700)] hover:bg-[var(--color-ink-100)] hover:text-[var(--color-ink-900)]"
        >
          <BellIcon />
          <span
            aria-hidden
            className="absolute top-[5px] right-[6px] w-2 h-2 rounded-full border-[1.5px] border-white"
            style={{ background: "var(--color-danger-700)" }}
          />
        </button>

        <div className="w-px h-[22px] bg-[var(--color-border-default)] mx-1.5" />

        <div className="flex items-center gap-2 px-2 py-0.5 rounded-full cursor-pointer hover:bg-[var(--color-ink-100)]">
          <div
            aria-hidden
            className="w-6 h-6 rounded-full grid place-items-center text-[10px] font-semibold text-white"
            style={{ background: "var(--color-navy-600)" }}
          >
            {principal ? initialsOf(principal.fullName) : "?"}
          </div>
          <div className="flex flex-col gap-px leading-[1.1]">
            <div className="text-[12px] font-medium text-[var(--color-ink-900)] whitespace-nowrap">
              {principal?.fullName ?? "Unknown"}
            </div>
            <div className="text-[10px] text-[var(--color-ink-500)] whitespace-nowrap">
              {principal?.roles[0] ?? ""}
            </div>
          </div>
          <ChevronDownIcon style={{ color: "var(--color-ink-400)" }} />
        </div>

        {notifOpen && (
          <div
            ref={popRef}
            className="absolute top-[calc(100%+4px)] right-0 w-[320px] bg-white border border-[var(--color-border-default)] rounded-[4px] overflow-hidden z-50"
            style={{ boxShadow: "0 6px 20px rgba(15,42,68,0.11), 0 2px 5px rgba(15,42,68,0.07)" }}
          >
            <div className="px-3.5 py-2.5 border-b border-[var(--color-border-default)] flex items-center justify-between">
              <h4 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">
                Notifications
              </h4>
              <span className="text-[11px] text-[var(--color-ink-500)]">No new notifications</span>
            </div>
            <div className="px-3.5 py-6 text-center text-[12px] text-[var(--color-ink-500)]">
              You&apos;re all caught up.
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
