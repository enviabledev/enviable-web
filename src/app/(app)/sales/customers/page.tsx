"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import FreshnessBadge from "@/components/sync/FreshnessBadge";
import OfflineNotice from "@/components/sync/OfflineNotice";
import { listCustomers, type Customer } from "@/lib/api";
import { COL } from "@/lib/responsive";
import { listByType } from "@/lib/sync/mirror/store";

export default function CustomersListPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Customer[] | null>(null);
  const [errMsg, setErrMsg] = useState<string>("");
  const [offline, setOffline] = useState(false);
  // When true, the rows came from the mirror, not the network. Drives the
  // FreshnessBadge so the clerk knows it's cached data, not live.
  const [fromMirror, setFromMirror] = useState(false);

  const mirrorPaintedRef = useRef(false);
  useEffect(() => {
    const ctrl = new AbortController();
    mirrorPaintedRef.current = false;

    // Phase 1: mirror.
    (async () => {
      try {
        const mirrored = await listByType<Customer>("customer");
        if (ctrl.signal.aborted) return;
        if (mirrored.length > 0) {
          mirrorPaintedRef.current = true;
          setRows(mirrored.map((m) => m.body));
          setFromMirror(true);
          setOffline(false);
        }
      } catch {
        // Let network drive.
      }
    })();

    // Phase 2: network revalidate.
    listCustomers({ pageSize: 250 }, ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      if (r.kind === "ok") {
        setRows(r.data.data);
        setFromMirror(false);
        setOffline(false);
      } else if (r.kind === "unauthorized") {
        router.replace("/login");
      } else if (r.kind === "forbidden") {
        setErrMsg("You do not have access to view customers.");
      } else if (r.kind === "network_error" || r.kind === "server_error") {
        if (!mirrorPaintedRef.current) setOffline(true);
      } else if ("message" in r) {
        setErrMsg(
          typeof r.message === "string" ? r.message : r.message.join("; "),
        );
      }
    });
    return () => ctrl.abort();
  }, [router]);

  return (
    <div className="max-w-[1480px] mx-auto pb-10">
      <header className="flex items-end justify-between gap-6 pb-4 mb-4 border-b border-[var(--color-border-default)]">
        <div>
          <div className="text-[12px] text-[var(--color-ink-500)] flex items-center gap-1.5 mb-1.5">
            <span>Sales</span>
            <span className="text-[var(--color-ink-300)]">/</span>
            <span className="text-[var(--color-ink-900)] font-medium">
              Customers
            </span>
          </div>
          <h1 className="text-[24px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em] flex items-center gap-3">
            Customers
            {rows && (
              <span className="font-mono text-[12px] bg-[var(--color-navy-50)] text-[var(--color-navy-800)] px-2.5 py-1 rounded-[3px] font-semibold">
                {rows.length} total
              </span>
            )}
            {fromMirror && <FreshnessBadge />}
          </h1>
        </div>
      </header>

      {errMsg && (
        <div className="mb-4 px-3.5 py-2.5 rounded-[3px] bg-[var(--color-danger-100)] text-[var(--color-danger-700)] text-[12.5px]">
          {errMsg}
        </div>
      )}

      {offline && rows === null && (
        <OfflineNotice body="The customer list will load when the connection returns. Phone edits queued on customer detail pages are saved locally and sync automatically once reconnected." />
      )}

      {!offline && (
      <div className="bg-white border border-[var(--color-border-default)] rounded-[4px] overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-[var(--color-ink-100)] text-[10.5px] uppercase text-[var(--color-ink-600)] tracking-[0.04em]">
              <th className="text-left font-semibold px-3 py-2 border-b border-[var(--color-border-default)]">
                Name
              </th>
              <th className={`text-left font-semibold px-3 py-2 border-b border-[var(--color-border-default)] ${COL.sm}`}>
                Type
              </th>
              <th className={`text-left font-semibold px-3 py-2 border-b border-[var(--color-border-default)] ${COL.md}`}>
                Tier
              </th>
              <th className={`text-left font-semibold px-3 py-2 border-b border-[var(--color-border-default)] ${COL.md}`}>
                Phone
              </th>
              <th className={`text-left font-semibold px-3 py-2 border-b border-[var(--color-border-default)] ${COL.lg}`}>
                Email
              </th>
              <th className="text-left font-semibold px-3 py-2 border-b border-[var(--color-border-default)]">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {rows === null && (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-6 text-center text-[12px] text-[var(--color-ink-500)]"
                >
                  Loading…
                </td>
              </tr>
            )}
            {rows && rows.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-6 text-center text-[12px] text-[var(--color-ink-500)]"
                >
                  No customers.
                </td>
              </tr>
            )}
            {rows?.map((c) => (
              <tr
                key={c.id}
                className="text-[12.5px] hover:bg-[var(--color-ink-100)]"
              >
                <td className="px-3 h-[30px] border-b border-[var(--color-border-default)]">
                  <Link
                    href={`/sales/customers/${c.id}`}
                    title={c.name}
                    className="block max-w-[180px] sm:max-w-none truncate text-[var(--color-navy-700)] hover:underline font-medium"
                  >
                    {c.name}
                  </Link>
                </td>
                <td className={`px-3 h-[30px] border-b border-[var(--color-border-default)] text-[var(--color-ink-700)] ${COL.sm}`}>
                  {c.type === "RESELLER" ? "Reseller" : "End user"}
                </td>
                <td className={`px-3 h-[30px] border-b border-[var(--color-border-default)] text-[var(--color-ink-700)] ${COL.md}`}>
                  {c.tier?.name ?? "--"}
                </td>
                <td className={`px-3 h-[30px] border-b border-[var(--color-border-default)] text-[var(--color-ink-700)] font-mono text-[12px] ${COL.md}`}>
                  {c.phone ?? "--"}
                </td>
                <td className={`px-3 h-[30px] border-b border-[var(--color-border-default)] text-[var(--color-ink-700)] ${COL.lg}`}>
                  {c.email ?? "--"}
                </td>
                <td className="px-3 h-[30px] border-b border-[var(--color-border-default)] text-[var(--color-ink-700)]">
                  {c.status === "ACTIVE" ? "Active" : "Inactive"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}
