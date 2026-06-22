"use client";

/**
 * Returns list (prompt 40). Network-only: there is no returns mirror bucket, so
 * this reads straight from GET /api/returns (gated salesorder.read) with the
 * usual loading / offline / empty states. A return is one sold unit on one sales
 * order moving through INITIATED -> INSPECTING -> RESOLVED.
 *
 * Returns are initiated from the sales-order detail (the workflow is SO-scoped),
 * not from here; this is the cross-order worklist.
 */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import OfflineNotice from "@/components/sync/OfflineNotice";
import ReturnStatusPill from "@/components/returns/ReturnStatusPill";
import {
  listReturns,
  RETURN_STATUS,
  type ReturnRow,
  type ReturnStatus,
} from "@/lib/api";
import { formatDateShort } from "@/lib/format";
import { COL } from "@/lib/responsive";

function dispositionLabel(d: ReturnRow["disposition"]): string {
  switch (d) {
    case "REPAIR":
      return "Repair";
    case "WRITE_OFF":
      return "Write-off";
    default:
      return "Pending";
  }
}

type StatusFilter = "ALL" | ReturnStatus;

export default function ReturnsListPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<ReturnRow[] | null>(null);
  const [errMsg, setErrMsg] = useState("");
  const [offline, setOffline] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
    const s = searchParams.get("status");
    return s && (RETURN_STATUS as readonly string[]).includes(s)
      ? (s as ReturnStatus)
      : "ALL";
  });

  useEffect(() => {
    const ctrl = new AbortController();
    setErrMsg("");
    listReturns(ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      if (r.kind === "ok") {
        setRows(r.data);
        setOffline(false);
      } else if (r.kind === "unauthorized") {
        router.replace("/login");
      } else if (r.kind === "forbidden") {
        setErrMsg("You do not have access to returns.");
      } else if (r.kind === "network_error" || r.kind === "server_error") {
        setOffline(true);
      } else if ("message" in r) {
        setErrMsg(typeof r.message === "string" ? r.message : r.message.join("; "));
      }
    });
    return () => ctrl.abort();
  }, [router]);

  const filtered = useMemo(() => {
    if (!rows) return null;
    if (statusFilter === "ALL") return rows;
    return rows.filter((r) => r.status === statusFilter);
  }, [rows, statusFilter]);

  return (
    <div className="max-w-[1480px] mx-auto pb-10">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 sm:gap-6 pb-4 mb-4 border-b border-[var(--color-border-default)]">
        <div>
          <div className="text-[12px] text-[var(--color-ink-500)] flex items-center gap-1.5 mb-1.5">
            <span>Sales</span>
            <span className="text-[var(--color-ink-300)]">/</span>
            <span className="text-[var(--color-ink-900)] font-medium">Returns</span>
          </div>
          <h1 className="text-[24px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em] flex items-center gap-3">
            Returns
            {rows && (
              <span className="font-mono text-[12px] bg-[var(--color-navy-50)] text-[var(--color-navy-800)] px-2.5 py-1 rounded-[3px] font-semibold">
                {rows.length} total
              </span>
            )}
          </h1>
        </div>
      </header>

      {errMsg && (
        <div className="mb-4 px-3.5 py-2.5 rounded-[3px] bg-[var(--color-danger-100)] text-[var(--color-danger-700)] text-[12.5px]">
          {errMsg}
        </div>
      )}

      {offline && rows === null && (
        <OfflineNotice body="Returns will load when the connection returns." />
      )}

      {!offline && (
        <>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">
              Status
            </span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              data-testid="return-status-filter"
              className="h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px]"
            >
              <option value="ALL">All</option>
              {RETURN_STATUS.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0) + s.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </div>

          <div className="bg-white border border-[var(--color-border-default)] rounded-[4px] overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-[var(--color-ink-100)] text-[10.5px] uppercase text-[var(--color-ink-600)] tracking-[0.04em]">
                  <th className="text-left font-semibold px-3 py-2 border-b border-[var(--color-border-default)]">Unit</th>
                  <th className={`text-left font-semibold px-3 py-2 border-b border-[var(--color-border-default)] ${COL.sm}`}>Sales order</th>
                  <th className="text-left font-semibold px-3 py-2 border-b border-[var(--color-border-default)]">Status</th>
                  <th className={`text-left font-semibold px-3 py-2 border-b border-[var(--color-border-default)] ${COL.md}`}>Initiated</th>
                  <th className={`text-left font-semibold px-3 py-2 border-b border-[var(--color-border-default)] ${COL.md}`}>Disposition</th>
                </tr>
              </thead>
              <tbody>
                {filtered === null && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-[12px] text-[var(--color-ink-500)]">
                      Loading…
                    </td>
                  </tr>
                )}
                {filtered && filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-[12px] text-[var(--color-ink-500)]">
                      {statusFilter === "ALL"
                        ? "No returns yet. Returns are initiated from a sales order."
                        : "No returns match this status."}
                    </td>
                  </tr>
                )}
                {filtered?.map((r) => (
                  <tr
                    key={r.id}
                    data-testid={`return-row-${r.id}`}
                    className="text-[12.5px] hover:bg-[var(--color-ink-100)]"
                  >
                    <td className="px-3 h-[30px] border-b border-[var(--color-border-default)]">
                      <Link
                        href={`/sales/returns/${r.id}`}
                        className="text-[var(--color-navy-700)] hover:underline font-mono text-[12px] font-medium"
                      >
                        {r.unit.engineNumber}
                      </Link>
                    </td>
                    <td className={`px-3 h-[30px] border-b border-[var(--color-border-default)] ${COL.sm}`}>
                      <Link
                        href={`/sales/sales-orders/${r.salesOrderId}`}
                        className="text-[var(--color-navy-700)] hover:underline font-mono text-[12px]"
                      >
                        {r.salesOrder.soNumber}
                      </Link>
                    </td>
                    <td className="px-3 h-[30px] border-b border-[var(--color-border-default)]">
                      <ReturnStatusPill status={r.status} />
                    </td>
                    <td className={`px-3 h-[30px] border-b border-[var(--color-border-default)] text-[var(--color-ink-700)] ${COL.md}`}>
                      {formatDateShort(r.initiatedAt)}
                    </td>
                    <td className={`px-3 h-[30px] border-b border-[var(--color-border-default)] text-[var(--color-ink-700)] ${COL.md}`}>
                      {r.status === "RESOLVED" ? dispositionLabel(r.disposition) : "--"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
