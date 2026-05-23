"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import SoStatusPill from "@/components/sales-orders/SoStatusPill";
import StatusPill from "@/components/units/StatusPill";
import {
  getSalesOrder,
  soIsEditable,
  submitSalesOrder,
  type ApiResult,
  type SalesOrderDetail,
  type SalesOrderLine,
  type UnitStatus,
} from "@/lib/api";
import { usePermissions } from "@/lib/auth";
import { formatDateTime, formatNGN } from "@/lib/format";

type LoadState =
  | { status: "loading" }
  | { status: "ok"; so: SalesOrderDetail }
  | { status: "not_found" }
  | { status: "forbidden" }
  | { status: "error"; message: string };

type ActionState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "conflict"; message: string }
  | { status: "error"; message: string };

export default function SalesOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { has } = usePermissions();
  const id = decodeURIComponent(params.id);

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [action, setAction] = useState<ActionState>({ status: "idle" });

  useEffect(() => {
    const ctrl = new AbortController();
    getSalesOrder(id, ctrl.signal).then((r: ApiResult<SalesOrderDetail>) => {
      if (ctrl.signal.aborted) return;
      if (r.kind === "ok") setState({ status: "ok", so: r.data });
      else if (r.kind === "not_found") setState({ status: "not_found" });
      else if (r.kind === "unauthorized") router.replace("/login");
      else if (r.kind === "forbidden") setState({ status: "forbidden" });
      else setState({ status: "error", message: "message" in r ? String(r.message) : "Error" });
    });
    return () => ctrl.abort();
  }, [id, router]);

  if (state.status === "loading")
    return <div className="max-w-[1080px] mx-auto py-10 text-center text-[var(--color-ink-500)]">Loading...</div>;
  if (state.status === "not_found")
    return <NotFoundCard id={id} />;
  if (state.status === "forbidden")
    return <div className="max-w-[1080px] mx-auto py-10 text-center text-[var(--color-ink-500)]">You do not have access to view this sales order.</div>;
  if (state.status === "error")
    return <div className="max-w-[1080px] mx-auto py-10 text-center text-[var(--color-danger-700)]">{state.message}</div>;

  const so = state.so;
  const canEdit = has("salesorder.create") && soIsEditable(so.status);
  const canSubmit = has("salesorder.create") && so.status === "DRAFT";

  const handleSubmit = async () => {
    if (action.status === "submitting") return;
    setAction({ status: "submitting" });
    const r = await submitSalesOrder(so.id);
    if (r.kind === "ok") {
      setState({ status: "ok", so: r.data });
      setAction({ status: "idle" });
    } else if (r.kind === "conflict") {
      setAction({ status: "conflict", message: r.message });
    } else if (r.kind === "forbidden") {
      setAction({ status: "error", message: "You do not have permission to submit this order." });
    } else if (r.kind === "validation") {
      setAction({ status: "error", message: typeof r.message === "string" ? r.message : r.message.join("; ") });
    } else if (r.kind === "network_error") {
      setAction({ status: "error", message: r.message });
    } else {
      setAction({ status: "error", message: "Unexpected response." });
    }
  };

  return (
    <div className="max-w-[1120px] mx-auto pb-10">
      <header className="flex items-end justify-between gap-6 pb-4 mb-5 border-b border-[var(--color-border-default)]">
        <div>
          <div className="text-[12px] text-[var(--color-ink-500)] flex items-center gap-1.5 mb-1.5 flex-wrap">
            <Link href="/sales/sales-orders" className="text-[var(--color-ink-500)] hover:text-[var(--color-navy-700)]">
              Sales
            </Link>
            <span className="text-[var(--color-ink-300)]">/</span>
            <Link href="/sales/sales-orders" className="text-[var(--color-ink-500)] hover:text-[var(--color-navy-700)]">
              Sales Orders
            </Link>
            <span className="text-[var(--color-ink-300)]">/</span>
            <span className="text-[var(--color-ink-900)] font-medium font-mono">{so.soNumber}</span>
          </div>
          <div className="flex items-center gap-3 flex-wrap mb-1">
            <h1 className="text-[24px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em]">
              <span className="font-mono">{so.soNumber}</span>
            </h1>
            <SoStatusPill status={so.status} />
          </div>
          <div className="text-[13px] text-[var(--color-ink-500)]">
            Customer: <span className="text-[var(--color-ink-900)] font-medium">{so.customer.name}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {canEdit && (
            <Link
              href={`/sales/sales-orders/${so.id}/edit`}
              className="h-8 px-3 rounded-[3px] text-[12.5px] font-medium border border-[var(--color-border-strong)] bg-white text-[var(--color-ink-900)] hover:bg-[var(--color-ink-100)] inline-flex items-center"
            >
              Edit
            </Link>
          )}
          {canSubmit && (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={action.status === "submitting"}
              className="h-8 px-3 rounded-[3px] text-[12.5px] font-medium text-white disabled:opacity-50 inline-flex items-center"
              style={{ background: "var(--color-navy-700)" }}
            >
              {action.status === "submitting" ? "Submitting..." : "Submit for Payment"}
            </button>
          )}
          {!canEdit && !canSubmit && (
            <span className="text-[11px] text-[var(--color-ink-500)]">
              {so.status === "DRAFT" && !has("salesorder.create") ? "(requires salesorder.create)" : "No actions in this view"}
            </span>
          )}
        </div>
      </header>

      {action.status === "conflict" && (
        <div
          role="alert"
          className="mb-4 px-3.5 py-2.5 rounded-[3px] border"
          style={{
            background: "var(--color-warning-50)",
            borderColor: "var(--color-warning-100)",
            color: "var(--color-warning-700)",
          }}
        >
          <div className="font-semibold text-[12.5px] mb-0.5">Action rejected by the server</div>
          <div className="text-[12px]">{action.message}</div>
        </div>
      )}
      {action.status === "error" && (
        <div
          role="alert"
          className="mb-4 px-3.5 py-2.5 rounded-[3px] border"
          style={{
            background: "var(--color-danger-50)",
            borderColor: "var(--color-danger-100)",
            color: "var(--color-danger-700)",
          }}
        >
          <div className="text-[12px]">{action.message}</div>
        </div>
      )}

      <IdentityCard so={so} />
      <SoftReservationNotice so={so} />
      <LinesCard lines={so.lines} so={so} />
    </div>
  );
}

function IdentityCard({ so }: { so: SalesOrderDetail }) {
  const rows: { label: string; value: React.ReactNode; mono?: boolean }[] = [
    { label: "SO Number", value: so.soNumber, mono: true },
    {
      label: "Customer",
      value: (
        <span>
          {so.customer.name}{" "}
          <span className="text-[11px] text-[var(--color-ink-500)] ml-1">{so.customer.type}</span>
        </span>
      ),
    },
    { label: "Status", value: <SoStatusPill status={so.status} /> },
    { label: "Channel", value: so.channel.replace(/_/g, " ") },
    {
      label: "Subtotal",
      value: <span className="font-mono tabular-nums">{formatNGN(so.subtotal)}</span>,
    },
    {
      label: "Discount",
      value:
        Number(so.discountTotal) > 0 ? (
          <span className="font-mono tabular-nums text-[var(--color-danger-700)]">
            &minus;{formatNGN(so.discountTotal)}
          </span>
        ) : (
          <span className="text-[var(--color-ink-400)]">&minus;&minus;</span>
        ),
    },
    {
      label: "VAT (7.5%)",
      value: <span className="font-mono tabular-nums">{formatNGN(so.vatAmount)}</span>,
    },
    {
      label: "Total",
      value: (
        <span className="font-mono tabular-nums text-[14px] font-semibold text-[var(--color-navy-800)]">
          {formatNGN(so.total)}
        </span>
      ),
    },
    { label: "Created", value: formatDateTime(so.createdAt) },
  ];
  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] mb-4">
      <header className="px-5 py-3 border-b border-[var(--color-border-default)] flex items-center justify-between">
        <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">Order identity</h2>
        <span className="text-mono-id text-[11px] text-[var(--color-ink-500)]">{so.id}</span>
      </header>
      <div className="px-5 py-3 grid grid-cols-2 gap-x-12 gap-y-1">
        {rows.map((r, i) => (
          <div
            key={i}
            className="grid grid-cols-[160px_1fr] gap-3 items-baseline py-2 border-b border-dashed border-[var(--color-border-default)] last:border-b-0 text-[13px]"
          >
            <span className="text-[12px] font-medium text-[var(--color-ink-500)]">{r.label}</span>
            <span
              className={`text-[var(--color-ink-900)] font-medium ${r.mono ? "font-mono text-[13px] tracking-[0.02em]" : ""}`}
            >
              {r.value}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function SoftReservationNotice({ so }: { so: SalesOrderDetail }) {
  // Only relevant while units are still soft-reserved (status hasn't moved to
  // SOLD_*). After release, the unit becomes sold and the notice no longer
  // applies.
  const stillReserved = so.lines.some(
    (l) => l.unit && (l.unit.status === "IN_WAREHOUSE_CKD" || l.unit.status === "IN_WAREHOUSE_CBU"),
  );
  if (!stillReserved) return null;
  return (
    <div
      className="mb-4 px-3.5 py-2.5 rounded-[3px] border flex items-start gap-2"
      style={{
        background: "var(--color-navy-50)",
        borderColor: "var(--color-navy-100)",
        color: "var(--color-navy-800)",
      }}
    >
      <span className="text-[10px] font-semibold uppercase tracking-[0.04em] px-1.5 py-0.5 rounded-[2px] flex-shrink-0 mt-px"
            style={{ background: "var(--color-navy-700)", color: "white" }}>
        Soft reservation
      </span>
      <div className="text-[12px] leading-snug">
        The units below are <span className="font-semibold">reserved to this order</span> but
        physically <span className="font-semibold">still in the warehouse</span> with their original
        status. They do not become <span className="font-mono">SOLD_AS_CKD</span> or{" "}
        <span className="font-mono">SOLD_AS_CBU</span> until the order is released (a later step).
      </div>
    </div>
  );
}

function LinesCard({ lines, so }: { lines: readonly SalesOrderLine[]; so: SalesOrderDetail }) {
  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px]">
      <header className="px-5 py-3 border-b border-[var(--color-border-default)]">
        <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">
          Line items
          <span className="text-[11px] text-[var(--color-ink-500)] font-medium ml-2">
            {lines.length} line{lines.length === 1 ? "" : "s"} &middot; each reserves one physical unit
          </span>
        </h2>
      </header>
      <table className="w-full text-[13px]">
        <thead>
          <tr>
            <Th>Variant</Th>
            <Th>Sale Form</Th>
            <Th>Allocated Unit</Th>
            <Th>Unit Status (real)</Th>
            <Th align="right">Unit Price</Th>
            <Th align="right">Discount</Th>
            <Th align="right">Line Total</Th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.id} className={`${i % 2 ? "bg-[#FBFBFC]" : "bg-white"} border-b border-[var(--color-border-default)]`}>
              <Td>
                <span className="font-mono text-[11.5px] text-[var(--color-ink-700)]">
                  {l.productVariant.supplierSkuCode}
                </span>
              </Td>
              <Td>
                <span
                  className={`inline-flex items-center h-4 px-1.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.02em] ${
                    l.saleForm === "CKD"
                      ? "bg-[var(--color-navy-100)] text-[var(--color-navy-800)]"
                      : "bg-[var(--color-success-50)] text-[var(--color-success-700)]"
                  }`}
                >
                  {l.saleForm}
                </span>
              </Td>
              <Td>
                {l.unit ? (
                  <Link
                    href={`/inventory/units/${encodeURIComponent(l.unit.engineNumber)}`}
                    className="font-mono text-[11.5px] text-[var(--color-navy-700)] hover:underline tracking-[0.02em]"
                  >
                    {l.unit.engineNumber}
                  </Link>
                ) : (
                  <span className="text-[var(--color-ink-400)]">--</span>
                )}
              </Td>
              <Td>
                {l.unit ? (
                  <span className="inline-flex items-center gap-1.5">
                    <StatusPill status={l.unit.status as UnitStatus} />
                    {(l.unit.status === "IN_WAREHOUSE_CKD" || l.unit.status === "IN_WAREHOUSE_CBU") && (
                      <span className="text-[10px] text-[var(--color-navy-700)] font-medium">
                        reserved to {so.soNumber}
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="text-[var(--color-ink-400)]">--</span>
                )}
              </Td>
              <NumTd mono>{formatNGN(l.unitPrice)}</NumTd>
              <NumTd mono>
                {Number(l.discountAmount) > 0 ? (
                  <span className="text-[var(--color-danger-700)]">&minus;{formatNGN(l.discountAmount)}</span>
                ) : (
                  <span className="text-[var(--color-ink-400)]">&minus;&minus;</span>
                )}
              </NumTd>
              <NumTd mono strong>
                {formatNGN(l.lineTotal)}
              </NumTd>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-[var(--color-ink-100)]">
            <td colSpan={6} className="px-3.5 py-2.5 text-right text-[12.5px] font-medium text-[var(--color-ink-700)]">
              Subtotal{Number(so.discountTotal) > 0 ? ` (discount ${formatNGN(so.discountTotal)})` : ""} &middot; VAT 7.5%{" "}
              {formatNGN(so.vatAmount)} &middot; Total
            </td>
            <td className="px-3.5 py-2.5 text-right tabular-nums font-mono text-[14px] font-semibold text-[var(--color-navy-800)]">
              {formatNGN(so.total)}
            </td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}

function NotFoundCard({ id }: { id: string }) {
  return (
    <div className="max-w-[640px] mx-auto py-12">
      <div className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-6 py-8 text-center">
        <h1 className="text-[18px] font-semibold m-0 mb-2">Sales order not found</h1>
        <p className="text-[13px] text-[var(--color-ink-700)] m-0 mb-1">
          No sales order matches{" "}
          <span className="font-mono text-[var(--color-navy-700)]">{id}</span>.
        </p>
        <Link
          href="/sales/sales-orders"
          className="mt-5 inline-flex items-center h-8 px-3 rounded-[3px] text-[12.5px] font-medium text-white"
          style={{ background: "var(--color-navy-700)" }}
        >
          Back to Sales Orders
        </Link>
      </div>
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

function NumTd({ children, mono, strong }: { children: React.ReactNode; mono?: boolean; strong?: boolean }) {
  return (
    <td
      className={`px-3.5 py-2.5 text-right tabular-nums whitespace-nowrap text-[var(--color-ink-900)] ${mono ? "font-mono text-[12px]" : ""} ${strong ? "font-semibold" : ""}`}
    >
      {children}
    </td>
  );
}
