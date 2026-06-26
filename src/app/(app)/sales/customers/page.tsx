"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import CreateCustomerModal from "@/components/customers/CreateCustomerModal";
import FreshnessBadge from "@/components/sync/FreshnessBadge";
import OfflineNotice from "@/components/sync/OfflineNotice";
import { listCustomers, type Customer, type CustomerType } from "@/lib/api";
import { usePermissions } from "@/lib/auth";
import { useActiveTiers } from "@/lib/pricing/use-tiers";
import { COL } from "@/lib/responsive";
import { listByType } from "@/lib/sync/mirror/store";

type TypeFilter = "ALL" | CustomerType;

export default function CustomersListPage() {
  const router = useRouter();
  const { has } = usePermissions();
  const canManage = has("customer.manage");
  const { tiers: activeTiers } = useActiveTiers();
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("ALL");
  const [tierFilter, setTierFilter] = useState<string>("ALL");
  const [rows, setRows] = useState<Customer[] | null>(null);
  const [errMsg, setErrMsg] = useState<string>("");
  const [offline, setOffline] = useState(false);
  // When true, the rows came from the mirror, not the network. Drives the
  // FreshnessBadge so the clerk knows it's cached data, not live.
  const [fromMirror, setFromMirror] = useState(false);

  // Create-customer overlay + post-create notification (prompt 33-A).
  const [createOpen, setCreateOpen] = useState(false);
  const [createdName, setCreatedName] = useState<string>("");
  // Bumped on successful create to re-trigger the mirror + network read so the
  // new customer appears without a manual refresh.
  const [reloadTick, setReloadTick] = useState(0);

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
  }, [router, reloadTick]);

  const filtered = useMemo(() => {
    if (!rows) return null;
    return rows.filter(
      (c) =>
        (typeFilter === "ALL" || c.type === typeFilter) &&
        (tierFilter === "ALL" || c.tierId === tierFilter),
    );
  }, [rows, typeFilter, tierFilter]);

  return (
    <div className="max-w-[1480px] mx-auto pb-10">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 sm:gap-6 pb-4 mb-4 border-b border-[var(--color-border-default)]">
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
        {canManage && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            data-testid="create-customer-button"
            className="h-[32px] px-4 inline-flex items-center rounded-[3px] bg-[var(--color-navy-700)] text-white text-[12.5px] font-medium self-start"
          >
            Create customer
          </button>
        )}
      </header>

      {canManage && createdName && (
        <div
          role="status"
          data-testid="create-customer-notification"
          className="mb-4 px-3.5 py-2.5 rounded-[3px] bg-[var(--color-success-100)] text-[var(--color-success-700)] text-[12.5px] flex items-center justify-between gap-3"
        >
          <span>Customer {createdName} created.</span>
          <button
            type="button"
            onClick={() => setCreatedName("")}
            aria-label="Dismiss"
            className="text-[var(--color-success-700)] hover:opacity-70 text-[14px] leading-none px-1"
          >
            &times;
          </button>
        </div>
      )}

      {canManage && (
        <CreateCustomerModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onSuccess={(created) => {
            setCreateOpen(false);
            setCreatedName(created.name);
            setReloadTick((n) => n + 1);
          }}
        />
      )}

      {errMsg && (
        <div className="mb-4 px-3.5 py-2.5 rounded-[3px] bg-[var(--color-danger-100)] text-[var(--color-danger-700)] text-[12.5px]">
          {errMsg}
        </div>
      )}

      {offline && rows === null && (
        <OfflineNotice body="The customer list will load when the connection returns. Phone edits queued on customer detail pages are saved locally and sync automatically once reconnected." />
      )}

      {!offline && rows && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">Type</span>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
            data-testid="customer-type-filter"
            className="h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px]"
          >
            <option value="ALL">All types</option>
            <option value="RESELLER">Reseller</option>
            <option value="END_USER">End user</option>
          </select>
          <span className="text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium ml-1">Tier</span>
          <select
            value={tierFilter}
            onChange={(e) => setTierFilter(e.target.value)}
            data-testid="customer-tier-filter"
            className="h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px]"
          >
            <option value="ALL">All tiers</option>
            {activeTiers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
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
            {filtered === null && (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-6 text-center text-[12px] text-[var(--color-ink-500)]"
                >
                  Loading…
                </td>
              </tr>
            )}
            {filtered && filtered.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-6 text-center text-[12px] text-[var(--color-ink-500)]"
                >
                  {rows && rows.length > 0 ? "No customers match these filters." : "No customers."}
                </td>
              </tr>
            )}
            {filtered?.map((c) => (
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
