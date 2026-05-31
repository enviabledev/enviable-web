"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import SoStatusPill from "@/components/sales-orders/SoStatusPill";
import FreshnessBadge from "@/components/sync/FreshnessBadge";
import OfflineNotice from "@/components/sync/OfflineNotice";
import {
  listCustomers,
  listSalesOrders,
  SO_STATUS,
  type Customer,
  type SalesOrderListRow,
  type SoStatus,
} from "@/lib/api";
import { usePermissions } from "@/lib/auth";
import { formatDateShort, formatNGN } from "@/lib/format";
import { listByType } from "@/lib/sync/mirror/store";

function readParams(sp: URLSearchParams): { customerId: string; status: SoStatus | "" } {
  const statusRaw = sp.get("status") ?? "";
  const status: SoStatus | "" = (SO_STATUS as readonly string[]).includes(statusRaw)
    ? (statusRaw as SoStatus)
    : "";
  return { customerId: sp.get("customerId") ?? "", status };
}

function buildHref(params: ReturnType<typeof readParams>): string {
  const sp = new URLSearchParams();
  if (params.customerId) sp.set("customerId", params.customerId);
  if (params.status) sp.set("status", params.status);
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

export default function SalesOrdersListPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const { has } = usePermissions();
  const canCreate = has("salesorder.create");

  const params = useMemo(() => readParams(new URLSearchParams(sp.toString())), [sp]);
  const [rows, setRows] = useState<SalesOrderListRow[] | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [errMsg, setErrMsg] = useState<string>("");
  const [offline, setOffline] = useState(false);
  const [fromMirror, setFromMirror] = useState(false);

  // Customers dropdown: mirror-first.
  useEffect(() => {
    if (!has("customer.read")) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const mirrored = await listByType<Customer>("customer");
        if (ctrl.signal.aborted) return;
        const filtered = mirrored.map((m) => m.body).filter((c) => c.status === "ACTIVE");
        if (filtered.length > 0) setCustomers(filtered);
      } catch {
        // Let network drive.
      }
    })();
    listCustomers({ status: "ACTIVE", pageSize: 100 }, ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      if (r.kind === "ok") setCustomers(r.data.data);
    });
    return () => ctrl.abort();
  }, [has]);

  // Main list: mirror-first paint, network revalidate.
  const mirrorPaintedRef = useRef(false);
  useEffect(() => {
    const ctrl = new AbortController();
    mirrorPaintedRef.current = false;
    setErrMsg("");
    setOffline(false);

    // Phase 1: mirror.
    (async () => {
      try {
        type MirroredSo = Omit<SalesOrderListRow, "customer" | "_count">;
        type MirroredSoLine = { id: string; salesOrderId: string };
        const [soRows, customerRows, lineRows] = await Promise.all([
          listByType<MirroredSo>("salesOrder"),
          listByType<Customer>("customer"),
          listByType<MirroredSoLine>("salesOrderLine"),
        ]);
        if (ctrl.signal.aborted) return;
        const customerById = new Map<string, Customer>();
        for (const c of customerRows) customerById.set(c.body.id, c.body);
        const lineCountBySo = new Map<string, number>();
        for (const l of lineRows) {
          lineCountBySo.set(
            l.body.salesOrderId,
            (lineCountBySo.get(l.body.salesOrderId) ?? 0) + 1,
          );
        }
        const filtered = soRows
          .map((m) => m.body)
          .filter((so) => {
            if (params.customerId && so.customerId !== params.customerId) return false;
            if (params.status && so.status !== params.status) return false;
            return true;
          })
          .map<SalesOrderListRow>((so) => {
            const c = customerById.get(so.customerId);
            return {
              ...so,
              customer: c
                ? { id: c.id, name: c.name }
                : { id: so.customerId, name: so.customerId },
              _count: { lines: lineCountBySo.get(so.id) ?? 0 },
            };
          });
        if (filtered.length > 0 || soRows.length > 0) {
          mirrorPaintedRef.current = true;
          setRows(filtered);
          setFromMirror(true);
        }
      } catch {
        // Let network drive.
      }
    })();

    // Phase 2: network revalidate.
    listSalesOrders(
      {
        customerId: params.customerId || undefined,
        status: params.status || undefined,
      },
      ctrl.signal,
    ).then((r) => {
      if (ctrl.signal.aborted) return;
      if (r.kind === "ok") {
        setRows(r.data);
        setFromMirror(false);
      } else if (r.kind === "unauthorized") {
        router.replace("/login");
      } else if (r.kind === "forbidden") {
        setErrMsg("You do not have access to view sales orders.");
      } else if (r.kind === "network_error" || r.kind === "server_error") {
        if (!mirrorPaintedRef.current) setOffline(true);
      } else if ("message" in r) {
        setErrMsg(typeof r.message === "string" ? r.message : r.message.join("; "));
      }
    });
    return () => ctrl.abort();
  }, [params, router]);

  const update = useCallback(
    (next: Partial<ReturnType<typeof readParams>>) => {
      router.replace(`/sales/sales-orders${buildHref({ ...params, ...next })}`);
    },
    [params, router],
  );

  return (
    <div className="max-w-[1480px] mx-auto pb-10">
      <header className="flex items-end justify-between gap-6 pb-4 mb-4 border-b border-[var(--color-border-default)]">
        <div>
          <div className="text-[12px] text-[var(--color-ink-500)] flex items-center gap-1.5 mb-1.5">
            <span>Sales</span>
            <span className="text-[var(--color-ink-300)]">/</span>
            <span className="text-[var(--color-ink-900)] font-medium">Sales Orders</span>
          </div>
          <h1 className="text-[24px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em] flex items-center gap-3">
            Sales Orders
            {rows && (
              <span className="font-mono text-[12px] bg-[var(--color-navy-50)] text-[var(--color-navy-800)] px-2.5 py-1 rounded-[3px] font-semibold">
                {rows.length} total
              </span>
            )}
            {fromMirror && <FreshnessBadge />}
          </h1>
          <div className="text-[13px] text-[var(--color-ink-500)] mt-1">
            Allocating a unit to a line is a soft reservation: the unit stays in the warehouse with
            its real status until release. Status is not changed by allocation.
          </div>
        </div>
        {canCreate && (
          <Link
            href="/sales/sales-orders/new"
            className="h-8 px-3 rounded-[3px] text-[12.5px] font-medium text-white inline-flex items-center"
            style={{ background: "var(--color-navy-700)" }}
          >
            + New Sales Order
          </Link>
        )}
      </header>

      <div className="bg-white border border-[var(--color-border-default)] rounded-[4px] p-3.5 mb-3.5 grid grid-cols-[1fr_1fr_auto] gap-3 items-end">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--color-ink-500)]">
            Customer
          </span>
          <select
            value={params.customerId}
            onChange={(e) => update({ customerId: e.target.value })}
            className="h-8 px-2.5 bg-white border border-[var(--color-border-strong)] rounded-[3px] text-[13px] text-[var(--color-ink-900)] cursor-pointer focus:outline-none focus:border-[var(--color-navy-700)] focus:shadow-[0_0_0_3px_rgba(31,78,121,0.10)]"
          >
            <option value="">All customers</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--color-ink-500)]">
            Status
          </span>
          <select
            value={params.status}
            onChange={(e) => update({ status: e.target.value as SoStatus | "" })}
            className="h-8 px-2.5 bg-white border border-[var(--color-border-strong)] rounded-[3px] text-[13px] text-[var(--color-ink-900)] cursor-pointer focus:outline-none focus:border-[var(--color-navy-700)] focus:shadow-[0_0_0_3px_rgba(31,78,121,0.10)]"
          >
            <option value="">All statuses</option>
            {SO_STATUS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => router.replace("/sales/sales-orders")}
          disabled={!params.customerId && !params.status}
          className={`h-8 px-3 rounded-[3px] text-[13px] font-medium inline-flex items-center self-end ${
            !params.customerId && !params.status
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
              <Th>SO Number</Th>
              <Th>Customer</Th>
              <Th>Status</Th>
              <Th align="right">Lines</Th>
              <Th align="right">Total</Th>
              <Th>Channel</Th>
              <Th>Created</Th>
            </tr>
          </thead>
          <tbody>
            {rows === null && !errMsg && !offline && (
              <tr>
                <td colSpan={7} className="px-3.5 py-12 text-center text-[var(--color-ink-500)]">
                  Loading sales orders...
                </td>
              </tr>
            )}
            {offline && (
              <tr>
                <td colSpan={7} className="px-3.5 py-8">
                  <OfflineNotice body="The sales orders list will load when the connection returns. Any sales orders cached during a prior online visit appear when present in the local mirror." />
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
                  No sales orders match the current filters.
                </td>
              </tr>
            )}
            {rows &&
              rows.map((row, i) => (
                <tr key={row.id} className={`${i % 2 ? "bg-[#FBFBFC]" : "bg-white"} hover:bg-[var(--color-navy-50)] border-b border-[var(--color-border-default)]`}>
                  <Td>
                    <Link
                      href={`/sales/sales-orders/${row.id}`}
                      className="font-mono text-[12px] text-[var(--color-navy-700)] hover:underline tracking-[0.02em]"
                    >
                      {row.soNumber}
                    </Link>
                  </Td>
                  <Td>{row.customer.name}</Td>
                  <Td>
                    <SoStatusPill status={row.status} />
                  </Td>
                  <td className="px-3.5 py-2.5 text-right tabular-nums whitespace-nowrap text-[var(--color-ink-900)]">
                    {row._count?.lines ?? "--"}
                  </td>
                  <td className="px-3.5 py-2.5 text-right tabular-nums whitespace-nowrap font-mono text-[12px] font-semibold text-[var(--color-ink-900)]">
                    {formatNGN(row.total)}
                  </td>
                  <Td>
                    <span className="text-[11px] text-[var(--color-ink-700)]">{row.channel.replace(/_/g, " ")}</span>
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
