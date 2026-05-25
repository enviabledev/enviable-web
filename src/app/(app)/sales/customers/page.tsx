"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import FreshnessBadge from "@/components/sync/FreshnessBadge";
import OfflineNotice from "@/components/sync/OfflineNotice";
import { isTransientFailure } from "@/lib/api/client";
import { listCustomers, type Customer } from "@/lib/api";
import { listByType } from "@/lib/sync/mirror/store";

// Module-level version stamp: fires the moment this chunk loads, BEFORE
// any component renders. If the offline reload's console does not show
// "[customers] module v3 loaded" we know definitively the SW served a
// stale chunk, regardless of what the in-memory HMR-patched code is.
console.log("[customers] module v3 loaded (mirror+diagnostics)");

export default function CustomersListPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Customer[] | null>(null);
  const [errMsg, setErrMsg] = useState<string>("");
  const [offline, setOffline] = useState(false);
  // When true, the rows came from the mirror, not the network. Drives the
  // FreshnessBadge so the clerk knows it's cached data, not live.
  const [fromMirror, setFromMirror] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    console.log("[customers] effect run, calling listCustomers(pageSize=250)");
    listCustomers({ pageSize: 250 }, ctrl.signal).then(async (r) => {
      if (ctrl.signal.aborted) {
        console.log("[customers] aborted before result");
        return;
      }
      console.log("[customers] listCustomers result kind:", r.kind);
      if (r.kind === "ok") {
        setRows(r.data.data);
        setOffline(false);
        setFromMirror(false);
        console.log("[customers] online path: rendered", r.data.data.length, "rows");
      } else if (r.kind === "unauthorized") {
        router.replace("/login");
      } else if (r.kind === "forbidden") {
        setErrMsg("You do not have access to view customers.");
      } else if (isTransientFailure(r)) {
        console.log("[customers] transient failure (kind=" + r.kind + "), attempting mirror fallback");
        try {
          const mirrored = await listByType<Customer>("customer");
          if (ctrl.signal.aborted) {
            console.log("[customers] aborted after mirror read");
            return;
          }
          console.log("[customers] mirror returned", mirrored.length, "customer records");
          if (mirrored.length > 0) {
            setRows(mirrored.map((m) => m.body));
            setFromMirror(true);
            setOffline(false);
            console.log("[customers] fallback path: rendered", mirrored.length, "rows from mirror");
          } else {
            setOffline(true);
            console.log("[customers] mirror was empty, falling back to OfflineNotice");
          }
        } catch (err) {
          console.error("[customers] mirror read threw:", err);
          setOffline(true);
        }
      } else if ("message" in r) {
        console.log("[customers] catchall message branch, setting errMsg");
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
      <div className="bg-white border border-[var(--color-border-default)] rounded-[4px] overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-[var(--color-ink-100)] text-[10.5px] uppercase text-[var(--color-ink-600)] tracking-[0.04em]">
              <th className="text-left font-semibold px-3 py-2 border-b border-[var(--color-border-default)]">
                Name
              </th>
              <th className="text-left font-semibold px-3 py-2 border-b border-[var(--color-border-default)]">
                Type
              </th>
              <th className="text-left font-semibold px-3 py-2 border-b border-[var(--color-border-default)]">
                Tier
              </th>
              <th className="text-left font-semibold px-3 py-2 border-b border-[var(--color-border-default)]">
                Phone
              </th>
              <th className="text-left font-semibold px-3 py-2 border-b border-[var(--color-border-default)]">
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
                    className="text-[var(--color-navy-700)] hover:underline font-medium"
                  >
                    {c.name}
                  </Link>
                </td>
                <td className="px-3 h-[30px] border-b border-[var(--color-border-default)] text-[var(--color-ink-700)]">
                  {c.type === "RESELLER" ? "Reseller" : "End user"}
                </td>
                <td className="px-3 h-[30px] border-b border-[var(--color-border-default)] text-[var(--color-ink-700)]">
                  {c.tier?.name ?? "—"}
                </td>
                <td className="px-3 h-[30px] border-b border-[var(--color-border-default)] text-[var(--color-ink-700)] font-mono text-[12px]">
                  {c.phone ?? "—"}
                </td>
                <td className="px-3 h-[30px] border-b border-[var(--color-border-default)] text-[var(--color-ink-700)]">
                  {c.email ?? "—"}
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
