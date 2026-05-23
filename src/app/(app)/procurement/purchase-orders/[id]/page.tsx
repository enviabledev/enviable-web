"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import PoStatusPill from "@/components/purchase-orders/PoStatusPill";
import {
  approvePurchaseOrder,
  flattenVariantOptions,
  getPurchaseOrder,
  listProducts,
  poIsEditable,
  submitPurchaseOrder,
  type ApiResult,
  type PoDetail,
  type PoLine,
  type ProductWithVariants,
} from "@/lib/api";
import { usePermissions } from "@/lib/auth";
import { formatDateShort, formatDateTime, formatNGN } from "@/lib/format";

type LoadState =
  | { status: "loading" }
  | { status: "ok"; po: PoDetail }
  | { status: "not_found" }
  | { status: "forbidden" }
  | { status: "error"; message: string };

type ActionState =
  | { status: "idle" }
  | { status: "submitting"; action: "submit" | "approve" }
  | { status: "conflict"; message: string }
  | { status: "error"; message: string };

export default function PurchaseOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { has } = usePermissions();
  const id = decodeURIComponent(params.id);

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [action, setAction] = useState<ActionState>({ status: "idle" });
  const [products, setProducts] = useState<ProductWithVariants[]>([]);

  useEffect(() => {
    const ctrl = new AbortController();
    getPurchaseOrder(id, ctrl.signal).then((r: ApiResult<PoDetail>) => {
      if (ctrl.signal.aborted) return;
      if (r.kind === "ok") setState({ status: "ok", po: r.data });
      else if (r.kind === "not_found") setState({ status: "not_found" });
      else if (r.kind === "unauthorized") router.replace("/login");
      else if (r.kind === "forbidden") setState({ status: "forbidden" });
      else setState({ status: "error", message: "message" in r ? String(r.message) : "Error loading PO" });
    });
    // Products are best-effort, used to show variant names on lines. If the
    // user lacks pricelist.read, lines fall back to the variant id only.
    listProducts(ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      if (r.kind === "ok") setProducts(r.data);
    });
    return () => ctrl.abort();
  }, [id, router]);

  const variantsById = useMemo(() => {
    const m = new Map<string, (ReturnType<typeof flattenVariantOptions>)[number]>();
    for (const v of flattenVariantOptions(products)) m.set(v.productVariantId, v);
    return m;
  }, [products]);

  if (state.status === "loading") {
    return (
      <div className="max-w-[1080px] mx-auto py-10 text-center text-[var(--color-ink-500)]">
        Loading purchase order...
      </div>
    );
  }
  if (state.status === "not_found") {
    return (
      <div className="max-w-[640px] mx-auto py-12">
        <div className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-6 py-8 text-center">
          <h1 className="text-[18px] font-semibold text-[var(--color-ink-900)] m-0 mb-2">Purchase order not found</h1>
          <p className="text-[13px] text-[var(--color-ink-700)] m-0 mb-1">
            No purchase order matches{" "}
            <span className="font-mono text-[var(--color-navy-700)]">{id}</span>.
          </p>
          <Link
            href="/procurement/purchase-orders"
            className="mt-5 inline-flex items-center h-8 px-3 rounded-[3px] text-[12.5px] font-medium text-white"
            style={{ background: "var(--color-navy-700)" }}
          >
            Back to Purchase Orders
          </Link>
        </div>
      </div>
    );
  }
  if (state.status === "forbidden") {
    return (
      <div className="max-w-[1080px] mx-auto py-10 text-center text-[var(--color-ink-500)]">
        You do not have access to view this purchase order.
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="max-w-[1080px] mx-auto py-10 text-center text-[var(--color-danger-700)]">
        {state.message}
      </div>
    );
  }

  const po = state.po;
  const canEdit = has("po.create") && poIsEditable(po.status);
  const canSubmit = has("po.submit") && po.status === "DRAFT";
  const canApprove = has("po.approve") && po.status === "PENDING_APPROVAL";

  const handleAction = async (which: "submit" | "approve") => {
    if (action.status === "submitting") return;
    setAction({ status: "submitting", action: which });
    const fn = which === "submit" ? submitPurchaseOrder : approvePurchaseOrder;
    const r = await fn(po.id);
    if (r.kind === "ok") {
      setState({ status: "ok", po: r.data });
      setAction({ status: "idle" });
    } else if (r.kind === "conflict") {
      setAction({ status: "conflict", message: r.message });
    } else if (r.kind === "forbidden") {
      setAction({ status: "error", message: "You do not have permission to perform this action." });
    } else if (r.kind === "validation") {
      setAction({
        status: "error",
        message: typeof r.message === "string" ? r.message : r.message.join("; "),
      });
    } else if (r.kind === "network_error") {
      setAction({ status: "error", message: r.message });
    } else {
      setAction({ status: "error", message: "Unexpected response from the server." });
    }
  };

  return (
    <div className="max-w-[1080px] mx-auto pb-10">
      <header className="flex items-end justify-between gap-6 pb-4 mb-5 border-b border-[var(--color-border-default)]">
        <div>
          <div className="text-[12px] text-[var(--color-ink-500)] flex items-center gap-1.5 mb-1.5 flex-wrap">
            <Link href="/procurement/purchase-orders" className="text-[var(--color-ink-500)] hover:text-[var(--color-navy-700)]">
              Procurement
            </Link>
            <span className="text-[var(--color-ink-300)]">/</span>
            <Link href="/procurement/purchase-orders" className="text-[var(--color-ink-500)] hover:text-[var(--color-navy-700)]">
              Purchase Orders
            </Link>
            <span className="text-[var(--color-ink-300)]">/</span>
            <span className="text-[var(--color-ink-900)] font-medium font-mono">{po.poNumber}</span>
          </div>
          <div className="flex items-center gap-3 flex-wrap mb-1">
            <h1 className="text-[24px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em]">
              <span className="font-mono">{po.poNumber}</span>
            </h1>
            <PoStatusPill status={po.status} />
          </div>
          <div className="text-[13px] text-[var(--color-ink-500)]">
            Supplier: <span className="text-[var(--color-ink-900)] font-medium">{po.supplier?.name ?? po.supplierId}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {canEdit && (
            <Link
              href={`/procurement/purchase-orders/${po.id}/edit`}
              className="h-8 px-3 rounded-[3px] text-[12.5px] font-medium border border-[var(--color-border-strong)] bg-white text-[var(--color-ink-900)] hover:bg-[var(--color-ink-100)] inline-flex items-center"
            >
              Edit
            </Link>
          )}
          {canSubmit && (
            <button
              type="button"
              onClick={() => handleAction("submit")}
              disabled={action.status === "submitting"}
              className="h-8 px-3 rounded-[3px] text-[12.5px] font-medium text-white disabled:opacity-50 inline-flex items-center"
              style={{ background: "var(--color-navy-700)" }}
            >
              {action.status === "submitting" && action.action === "submit" ? "Submitting..." : "Submit for Approval"}
            </button>
          )}
          {canApprove && (
            <button
              type="button"
              onClick={() => handleAction("approve")}
              disabled={action.status === "submitting"}
              className="h-8 px-3 rounded-[3px] text-[12.5px] font-medium text-white disabled:opacity-50 inline-flex items-center"
              style={{ background: "var(--color-success-700)" }}
            >
              {action.status === "submitting" && action.action === "approve" ? "Approving..." : "Approve"}
            </button>
          )}
          {!canEdit && !canSubmit && !canApprove && (
            <span className="text-[11px] text-[var(--color-ink-500)]">
              No actions available
              {!has("po.submit") && po.status === "DRAFT" && (
                <span className="ml-1">(requires po.submit)</span>
              )}
              {!has("po.approve") && po.status === "PENDING_APPROVAL" && (
                <span className="ml-1">(requires po.approve)</span>
              )}
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

      <SummaryCard po={po} />
      <LinesCard lines={po.lines} totalValue={po.totalValue} currency={po.currency} variantsById={variantsById} />
    </div>
  );
}

function SummaryCard({ po }: { po: PoDetail }) {
  const rows: { label: string; value: React.ReactNode; mono?: boolean }[] = [
    { label: "PO Number", value: po.poNumber, mono: true },
    {
      label: "Supplier",
      value: (
        <span>
          {po.supplier?.name ?? po.supplierId}
          {po.supplier?.type && (
            <span className="ml-2 text-[11px] text-[var(--color-ink-500)]">{po.supplier.type}</span>
          )}
        </span>
      ),
    },
    {
      label: "Status",
      value: <PoStatusPill status={po.status} />,
    },
    {
      label: "Total Value",
      value: (
        <span className="font-mono tabular-nums font-semibold text-[14px] text-[var(--color-ink-900)]">
          {formatNGN(po.totalValue)}{" "}
          <span className="text-[11px] text-[var(--color-ink-500)] font-medium">{po.currency}</span>
        </span>
      ),
    },
    {
      label: "Expected Ship Date",
      value: po.expectedShipDate ? formatDateShort(po.expectedShipDate) : <span className="text-[var(--color-ink-400)]">--</span>,
    },
    {
      label: "Payment Terms",
      value: po.paymentTerms || <span className="text-[var(--color-ink-400)]">--</span>,
    },
    {
      label: "Created",
      value: formatDateTime(po.createdAt),
    },
    {
      label: "Updated",
      value: formatDateTime(po.updatedAt),
    },
  ];
  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] mb-5">
      <header className="px-5 py-3 border-b border-[var(--color-border-default)] flex items-center justify-between">
        <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">Order identity</h2>
        <span className="text-mono-id text-[11px] text-[var(--color-ink-500)]">{po.id}</span>
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

function LinesCard({
  lines,
  totalValue,
  currency,
  variantsById,
}: {
  lines: readonly PoLine[];
  totalValue: string;
  currency: string;
  variantsById: Map<string, ReturnType<typeof flattenVariantOptions>[number]>;
}) {
  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px]">
      <header className="px-5 py-3 border-b border-[var(--color-border-default)]">
        <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">
          Line items{" "}
          <span className="text-[11px] text-[var(--color-ink-500)] font-medium ml-2">
            {lines.length} {lines.length === 1 ? "line" : "lines"}
          </span>
        </h2>
      </header>
      <table className="w-full text-[13px]">
        <thead>
          <tr>
            <Th>Variant</Th>
            <Th align="right">Quantity</Th>
            <Th align="right">Unit Price</Th>
            <Th align="right">Line Total</Th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const v = variantsById.get(l.productVariantId);
            const lineTotal = Number(l.unitPrice) * l.quantityOrdered;
            return (
              <tr key={l.id} className={`${i % 2 ? "bg-[#FBFBFC]" : "bg-white"} border-b border-[var(--color-border-default)]`}>
                <Td>
                  {v ? (
                    <>
                      <div className="font-medium text-[var(--color-ink-900)]">{v.productName}{" "}
                        {[v.attributes.model, v.attributes.colour].filter(Boolean).join(" ")}
                      </div>
                      <div className="font-mono text-[10.5px] text-[var(--color-ink-500)] font-medium mt-0.5">
                        {v.label.match(/\[(.*)\]/)?.[1] ?? l.productVariantId}
                      </div>
                    </>
                  ) : (
                    <span className="font-mono text-[12px] text-[var(--color-ink-700)]">{l.productVariantId}</span>
                  )}
                </Td>
                <NumTd>{l.quantityOrdered}</NumTd>
                <NumTd mono>{formatNGN(l.unitPrice)}</NumTd>
                <NumTd mono strong>{Number.isFinite(lineTotal) ? formatNGN(lineTotal) : "--"}</NumTd>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bg-[var(--color-ink-100)]">
            <td colSpan={3} className="px-3.5 py-2.5 text-right text-[12.5px] font-medium text-[var(--color-ink-700)]">
              Total {currency && <span className="font-mono text-[11px] text-[var(--color-ink-500)]">{currency}</span>}
            </td>
            <td className="px-3.5 py-2.5 text-right tabular-nums font-mono text-[14px] font-semibold text-[var(--color-navy-800)]">
              {formatNGN(totalValue)}
            </td>
          </tr>
        </tfoot>
      </table>
    </section>
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
  return <td className="px-3.5 py-2.5 align-middle text-[var(--color-ink-900)]">{children}</td>;
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
