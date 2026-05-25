"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import PoStatusPill from "@/components/purchase-orders/PoStatusPill";
import FreshnessBadge from "@/components/sync/FreshnessBadge";
import OfflineNotice from "@/components/sync/OfflineNotice";
import {
  listCounterparties,
  listPurchaseOrders,
  PO_STATUS,
  type Counterparty,
  type PoListRow,
  type PoStatus,
} from "@/lib/api";
import { isTransientFailure } from "@/lib/api/client";
import { usePermissions } from "@/lib/auth";
import { formatDateShort, formatNGN } from "@/lib/format";
import { listByType } from "@/lib/sync/mirror/store";

function readParams(sp: URLSearchParams): { status: PoStatus | ""; supplierId: string } {
  const statusRaw = sp.get("status") ?? "";
  const status: PoStatus | "" = (PO_STATUS as readonly string[]).includes(statusRaw)
    ? (statusRaw as PoStatus)
    : "";
  const supplierId = sp.get("supplierId") ?? "";
  return { status, supplierId };
}

function buildHref(params: { status: PoStatus | ""; supplierId: string }): string {
  const usp = new URLSearchParams();
  if (params.status) usp.set("status", params.status);
  if (params.supplierId) usp.set("supplierId", params.supplierId);
  const qs = usp.toString();
  return qs ? `?${qs}` : "";
}

export default function PurchaseOrdersListPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const { has } = usePermissions();
  const canCreate = has("po.create");

  const params = useMemo(() => readParams(new URLSearchParams(sp.toString())), [sp]);
  const [rows, setRows] = useState<PoListRow[] | null>(null);
  const [suppliers, setSuppliers] = useState<Counterparty[]>([]);
  const [errMsg, setErrMsg] = useState<string>("");
  const [offline, setOffline] = useState(false);
  const [fromMirror, setFromMirror] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    listCounterparties({ type: "SUPPLIER", status: "ACTIVE" }, ctrl.signal).then(async (r) => {
      if (ctrl.signal.aborted) return;
      if (r.kind === "ok") setSuppliers(r.data);
      else if (isTransientFailure(r)) {
        try {
          const mirrored = await listByType<Counterparty>("counterparty");
          if (ctrl.signal.aborted) return;
          setSuppliers(
            mirrored
              .map((m) => m.body)
              .filter((c) => c.type === "SUPPLIER" && c.status === "ACTIVE"),
          );
        } catch {
          // Best-effort.
        }
      }
    });
    return () => ctrl.abort();
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    setRows(null);
    setErrMsg("");
    setOffline(false);
    setFromMirror(false);
    listPurchaseOrders(
      {
        status: params.status || undefined,
        supplierId: params.supplierId || undefined,
      },
      ctrl.signal,
    ).then(async (r) => {
      if (ctrl.signal.aborted) return;
      if (r.kind === "ok") {
        setRows(r.data);
      } else if (r.kind === "unauthorized") {
        router.replace("/login");
      } else if (r.kind === "forbidden") {
        setErrMsg("You do not have access to view purchase orders.");
      } else if (isTransientFailure(r)) {
        try {
          const mirrored = await listByType<PoListRow>("purchaseOrder");
          if (ctrl.signal.aborted) return;
          const filtered = mirrored
            .map((m) => m.body)
            .filter((po) => {
              if (params.status && po.status !== params.status) return false;
              if (params.supplierId && po.supplierId !== params.supplierId) return false;
              return true;
            });
          if (filtered.length > 0 || mirrored.length > 0) {
            setRows(filtered);
            setFromMirror(true);
          } else {
            setOffline(true);
          }
        } catch {
          setOffline(true);
        }
      } else if ("message" in r) {
        setErrMsg(typeof r.message === "string" ? r.message : r.message.join("; "));
      }
    });
    return () => ctrl.abort();
  }, [params, router]);

  const update = useCallback(
    (next: Partial<typeof params>) => {
      router.replace(`/procurement/purchase-orders${buildHref({ ...params, ...next })}`);
    },
    [params, router],
  );

  return (
    <div className="max-w-[1480px] mx-auto pb-10">
      <header className="flex items-end justify-between gap-6 pb-4 mb-4 border-b border-[var(--color-border-default)]">
        <div>
          <div className="text-[12px] text-[var(--color-ink-500)] flex items-center gap-1.5 mb-1.5">
            <span>Procurement</span>
            <span className="text-[var(--color-ink-300)]">/</span>
            <span className="text-[var(--color-ink-900)] font-medium">Purchase Orders</span>
          </div>
          <h1 className="text-[24px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em] flex items-center gap-3">
            Purchase Orders
            {rows && (
              <span className="font-mono text-[12px] bg-[var(--color-navy-50)] text-[var(--color-navy-800)] px-2.5 py-1 rounded-[3px] font-semibold">
                {rows.length} total
              </span>
            )}
            {fromMirror && <FreshnessBadge />}
          </h1>
          <div className="text-[13px] text-[var(--color-ink-500)] mt-1">
            Drafts you create here become PENDING_APPROVAL on submit; approval is a separate step gated on po.approve.
          </div>
        </div>
        <div className="flex gap-2">
          {canCreate && (
            <Link
              href="/procurement/purchase-orders/new"
              className="h-8 px-3 rounded-[3px] text-[12.5px] font-medium text-white inline-flex items-center"
              style={{ background: "var(--color-navy-700)" }}
            >
              + New Purchase Order
            </Link>
          )}
        </div>
      </header>

      <div className="bg-white border border-[var(--color-border-default)] rounded-[4px] p-3.5 mb-3.5 grid grid-cols-[1fr_1fr_auto] gap-3 items-end">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--color-ink-500)]">
            Status
          </span>
          <select
            value={params.status}
            onChange={(e) => update({ status: (e.target.value as PoStatus | "") })}
            className="h-8 px-2.5 bg-white border border-[var(--color-border-strong)] rounded-[3px] text-[13px] text-[var(--color-ink-900)] cursor-pointer focus:outline-none focus:border-[var(--color-navy-700)] focus:shadow-[0_0_0_3px_rgba(31,78,121,0.10)]"
          >
            <option value="">All statuses</option>
            {PO_STATUS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--color-ink-500)]">
            Supplier
          </span>
          <select
            value={params.supplierId}
            onChange={(e) => update({ supplierId: e.target.value })}
            className="h-8 px-2.5 bg-white border border-[var(--color-border-strong)] rounded-[3px] text-[13px] text-[var(--color-ink-900)] cursor-pointer focus:outline-none focus:border-[var(--color-navy-700)] focus:shadow-[0_0_0_3px_rgba(31,78,121,0.10)]"
          >
            <option value="">All suppliers</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => router.replace("/procurement/purchase-orders")}
          disabled={!params.status && !params.supplierId}
          className={`h-8 px-3 rounded-[3px] text-[13px] font-medium inline-flex items-center self-end ${
            !params.status && !params.supplierId
              ? "text-[var(--color-ink-400)] cursor-default"
              : "text-[var(--color-navy-700)] hover:bg-[var(--color-navy-50)] cursor-pointer"
          }`}
        >
          Reset
        </button>
      </div>

      <section className="bg-white border border-[var(--color-border-default)] rounded-[4px]">
        <table className="w-full text-[13px]">
          <thead>
            <tr>
              <Th>PO Number</Th>
              <Th>Supplier</Th>
              <Th>Status</Th>
              <Th align="right">Total</Th>
              <Th>Currency</Th>
              <Th>Expected Ship</Th>
              <Th>Created</Th>
            </tr>
          </thead>
          <tbody>
            {rows === null && !errMsg && !offline && (
              <tr>
                <td colSpan={7} className="px-3.5 py-12 text-center text-[var(--color-ink-500)]">
                  Loading purchase orders...
                </td>
              </tr>
            )}
            {offline && (
              <tr>
                <td colSpan={7} className="px-3.5 py-8">
                  <OfflineNotice body="The purchase orders list will load when the connection returns. Any cached purchase orders from a prior online visit appear when present in the local mirror." />
                </td>
              </tr>
            )}
            {errMsg && (
              <tr>
                <td colSpan={7} className="px-3.5 py-12 text-center text-[var(--color-danger-700)]">
                  {errMsg}
                </td>
              </tr>
            )}
            {rows && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3.5 py-12 text-center text-[var(--color-ink-500)]">
                  No purchase orders match the current filters.
                </td>
              </tr>
            )}
            {rows &&
              rows.map((row, i) => (
                <tr key={row.id} className={`${i % 2 ? "bg-[#FBFBFC]" : "bg-white"} hover:bg-[var(--color-navy-50)] border-b border-[var(--color-border-default)]`}>
                  <Td>
                    <Link
                      href={`/procurement/purchase-orders/${row.id}`}
                      className="font-mono text-[12px] text-[var(--color-navy-700)] hover:underline tracking-[0.02em]"
                    >
                      {row.poNumber}
                    </Link>
                  </Td>
                  <Td>
                    <span className="font-medium text-[var(--color-ink-900)]">{row.supplier?.name ?? row.supplierId}</span>
                  </Td>
                  <Td>
                    <PoStatusPill status={row.status} />
                  </Td>
                  <NumTd>
                    <span className="font-mono tabular-nums font-semibold">
                      {formatNGN(row.totalValue)}
                    </span>
                  </NumTd>
                  <Td>
                    <span className="font-mono text-[11.5px] text-[var(--color-ink-700)]">{row.currency}</span>
                  </Td>
                  <Td>
                    {row.expectedShipDate ? formatDateShort(row.expectedShipDate) : <span className="text-[var(--color-ink-400)]">--</span>}
                  </Td>
                  <Td>{formatDateShort(row.createdAt)}</Td>
                </tr>
              ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      className={`font-medium text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] px-3.5 py-2.5 border-b border-[var(--color-border-default)] bg-[var(--color-ink-100)] whitespace-nowrap ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3.5 py-2.5 align-middle text-[var(--color-ink-900)] whitespace-nowrap">{children}</td>;
}

function NumTd({ children }: { children: React.ReactNode }) {
  return <td className="px-3.5 py-2.5 text-right tabular-nums whitespace-nowrap text-[var(--color-ink-900)]">{children}</td>;
}
