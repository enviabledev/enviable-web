"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { ChevronDownIcon } from "@/components/icons";
import SidebarUser from "@/components/shell/SidebarUser";
import { usePermissions } from "@/lib/auth";
import { NAV, type NavGroup, type NavItem } from "@/lib/nav/config";

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function Sidebar() {
  const pathname = usePathname();
  const { hasAll } = usePermissions();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const visibleGroups: NavGroup[] = NAV
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => hasAll(item.permissions)),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <aside className="w-sidebar flex h-screen flex-col flex-shrink-0 bg-[var(--color-sidebar-bg)] text-[var(--color-sidebar-fg)] text-[12.5px] sticky top-0 self-start">
      <div className="h-topbar flex items-center gap-2.5 px-2.5 border-b border-white/[0.08] flex-shrink-0">
        <div className="w-6 h-6 rounded-[3px] grid place-items-center text-[11px] font-bold tracking-wider text-white"
             style={{ background: "linear-gradient(135deg, #2c5e8e, #5a82a8)" }}>
          EI
        </div>
        <div className="overflow-hidden">
          <div className="text-[12px] font-semibold leading-[1.15] text-white whitespace-nowrap">
            Enviable I&amp;O
          </div>
          <div className="text-[9.5px] tracking-wide text-[var(--color-sidebar-muted)] whitespace-nowrap">
            Inventory &amp; Operations
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-1.5 pt-1 pb-2 sidebar-scroll">
        {visibleGroups.map((group) => {
          const isCollapsed = !!collapsed[group.label];
          return (
            <div key={group.label} className="mb-1">
              <button
                type="button"
                onClick={() => setCollapsed((s) => ({ ...s, [group.label]: !isCollapsed }))}
                className="w-full flex items-center justify-between px-2.5 pt-2 pb-1 text-[9.5px] font-semibold uppercase tracking-[0.06em] text-[var(--color-sidebar-label)] hover:text-[var(--color-sidebar-hover)] select-none whitespace-nowrap"
              >
                <span>{group.label}</span>
                <ChevronDownIcon
                  className={`transition-transform duration-150 ${isCollapsed ? "-rotate-90" : ""}`}
                  style={{ color: "var(--color-sidebar-label)" }}
                />
              </button>
              {!isCollapsed && (
                <div>
                  {group.items.map((item) => (
                    <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <SidebarUser />

      <style jsx>{`
        .sidebar-scroll {
          scrollbar-width: thin;
          scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
        }
        .sidebar-scroll::-webkit-scrollbar { width: 6px; }
        .sidebar-scroll::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.12);
          border-radius: 4px;
        }
      `}</style>
    </aside>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={`relative flex items-center gap-2.5 px-2.5 py-1 rounded-[3px] text-[12px] leading-snug whitespace-nowrap ${
        active
          ? "bg-[var(--color-navy-700)] text-white font-medium"
          : "text-[var(--color-sidebar-fg)] hover:bg-white/[0.05] hover:text-white"
      }`}
    >
      {active && (
        <span
          aria-hidden
          className="absolute top-1 bottom-1 -left-2 w-[3px] rounded-r-[2px]"
          style={{ background: "var(--color-sidebar-active-bar)" }}
        />
      )}
      <Icon width={13} height={13} className={active ? "opacity-100" : "opacity-85"} />
      <span>{item.label}</span>
    </Link>
  );
}
