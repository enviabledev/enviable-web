"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import PoStatusPill from "@/components/purchase-orders/PoStatusPill";
import RecordProformaInvoiceModal from "@/components/purchase-orders/RecordProformaInvoiceModal";
import FreshnessBadge from "@/components/sync/FreshnessBadge";
import OfflineNotice from "@/components/sync/OfflineNotice";
import {
  approvePurchaseOrder,
  flattenVariantOptions,
  getPurchaseOrder,
  listProducts,
  listProformaInvoicesForPo,
  poIsEditable,
  submitPurchaseOrder,
  type Counterparty,
  type PoDetail,
  type PoLine,
  type PoListRow,
  type PoStatus,
  type ProductWithVariants,
  type ProformaInvoice,
  type ProformaInvoiceStatus,
} from "@/lib/api";
import { usePermissions } from "@/lib/auth";
import { useConnectivity } from "@/lib/sync/connectivity";
import { formatDateShort, formatDateTime, formatNGN } from "@/lib/format";
import { COL, DETAIL_GRID } from "@/lib/responsive";
import { getById, listByType } from "@/lib/sync/mirror/store";
import { useUrlLastSegment } from "@/lib/sync/use-url-segment";

// PO statuses where recording a proforma invoice makes operational sense: the
// PO is committed (approved onward) and not in a terminal/closed state.
const PI_RECORDABLE_STATUSES: readonly PoStatus[] = [
  "APPROVED",
  "SENT_TO_SUPPLIER",
  "PI_RECEIVED",
  "AWAITING_SHIPMENT",
  "PARTIALLY_RECEIVED",
];

type LoadState =
  | { status: "loading" }
  | { status: "ok"; po: PoDetail; fromMirror?: boolean }
  | { status: "not_found" }
  | { status: "forbidden" }
  | { status: "offline" }
  | { status: "error"; message: string };

// Mirror bucket shapes for PO detail reconstruction.
type MirroredPo = Omit<PoListRow, "supplier">;
type MirroredPoLine = PoLine & { purchaseOrderId: string };

type ActionState =
  | { status: "idle" }
  | { status: "submitting"; action: "submit" | "approve" }
  | { status: "conflict"; message: string }
  | { status: "error"; message: string };

export default function PurchaseOrderDetailPage() {
  const router = useRouter();
  const { has } = usePermissions();
  // Read from window.location to handle the SW's sibling-URL fallback;
  // see src/lib/sync/use-url-segment.ts.
  const id = useUrlLastSegment();

  const { state: connState } = useConnectivity();
  const offlineConn = connState === "offline";
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [action, setAction] = useState<ActionState>({ status: "idle" });
  const [products, setProducts] = useState<ProductWithVariants[]>([]);

  // Proforma invoices recorded against this PO (prompt 35). Mirror-first paint
  // then network revalidate; re-fetched on piReloadTick after a record.
  const [piList, setPiList] = useState<ProformaInvoice[] | null>(null);
  const [piReloadTick, setPiReloadTick] = useState(0);
  const [recordOpen, setRecordOpen] = useState(false);
  const [recordedPi, setRecordedPi] = useState<{ id: string; piNumber: string } | null>(null);

  useEffect(() => {
    if (!id) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const rows = await listByType<ProformaInvoice & { purchaseOrderId: string }>(
          "proformaInvoice",
        );
        if (ctrl.signal.aborted) return;
        const mine = rows.map((r) => r.body).filter((p) => p.purchaseOrderId === id);
        if (mine.length > 0) setPiList((prev) => prev ?? mine);
      } catch {
        // Network drives.
      }
    })();
    listProformaInvoicesForPo(id, ctrl.signal).then((r) => {
      if (!ctrl.signal.aborted && r.kind === "ok") setPiList(r.data);
    });
    return () => ctrl.abort();
  }, [id, piReloadTick]);

  // Mirror-first paint. Phase 1 reconstructs the PoDetail from the mirror
  // buckets (purchaseOrder + counterparty + purchaseOrderLine), phase 2
  // revalidates from getPurchaseOrder.
  const mirrorPaintedRef = useRef(false);
  useEffect(() => {
    // Empty-id guard: useUrlLastSegment starts as "" until its mount-time
    // effect runs; without this skip, the network call hits
    // /api/purchase-orders/ (the LIST route) and the detail renderer
    // crashes on the array.
    if (!id) return;
    const ctrl = new AbortController();
    mirrorPaintedRef.current = false;

    // Phase 1: mirror.
    (async () => {
      try {
        const [poRow, lineRows] = await Promise.all([
          getById<MirroredPo>("purchaseOrder", id),
          listByType<MirroredPoLine>("purchaseOrderLine"),
        ]);
        if (ctrl.signal.aborted || !poRow) return;
        const supplierRow = await getById<Counterparty>(
          "counterparty",
          poRow.body.supplierId,
        );
        if (ctrl.signal.aborted) return;
        const lines = lineRows
          .map((l) => l.body)
          .filter((l) => l.purchaseOrderId === id);
        const supplier = supplierRow?.body ?? {
          id: poRow.body.supplierId,
          name: poRow.body.supplierId,
          type: "SUPPLIER",
          status: "ACTIVE",
        };
        const reconstructed: PoDetail = {
          ...poRow.body,
          supplier: {
            id: supplier.id,
            name: supplier.name,
            type: supplier.type,
            status: supplier.status,
          },
          lines,
        };
        mirrorPaintedRef.current = true;
        setState((prev) =>
          prev.status === "ok" && !prev.fromMirror
            ? prev
            : { status: "ok", po: reconstructed, fromMirror: true },
        );
      } catch {
        // Let the network phase drive.
      }
    })();

    // Phase 2: network revalidate.
    getPurchaseOrder(id, ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      if (r.kind === "ok") setState({ status: "ok", po: r.data });
      else if (r.kind === "not_found") setState({ status: "not_found" });
      else if (r.kind === "unauthorized") router.replace("/login");
      else if (r.kind === "forbidden") setState({ status: "forbidden" });
      else if (r.kind === "network_error" || r.kind === "server_error") {
        if (!mirrorPaintedRef.current) setState({ status: "offline" });
      } else
        setState({ status: "error", message: "message" in r ? String(r.message) : "Error loading PO" });
    });

    // Products for variant labels: mirror-first too. Phase 1 builds synthetic
    // ProductWithVariants from the productVariant bucket, phase 2 fetches
    // listProducts. Best-effort throughout, lines fall back to variant id.
    (async () => {
      try {
        const mirroredVariants = await listByType<{
          id: string;
          productId: string;
          supplierSkuCode: string;
          variantAttributes: Record<string, string | undefined>;
        }>("productVariant");
        if (ctrl.signal.aborted) return;
        if (mirroredVariants.length === 0) return;
        const synthetic: ProductWithVariants[] = mirroredVariants.map((v) => ({
          id: v.body.productId,
          name: v.body.productId,
          category: "PASSENGER",
          manufacturer: { id: "", name: "", type: "" },
          variants: [
            {
              id: v.body.id,
              supplierSkuCode: v.body.supplierSkuCode,
              variantAttributes: v.body.variantAttributes,
              currentMarketPrice: "",
              status: "ACTIVE",
            },
          ],
        }));
        setProducts((prev) => (prev.length > 0 ? prev : synthetic));
      } catch {
        // Best-effort.
      }
    })();
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
  if (state.status === "offline") {
    return (
      <div className="max-w-[820px] mx-auto pb-10">
        <OfflineNotice body="This purchase order's details will load when the connection returns. If this PO was visited online before, it should be in the local mirror; otherwise come back online to load it." />
        <div className="text-center mt-3">
          <Link
            href="/procurement/purchase-orders"
            className="text-[12px] text-[var(--color-navy-700)] hover:underline"
          >
            Back to Purchase Orders
          </Link>
        </div>
      </div>
    );
  }

  const po = state.po;
  const isFromMirror = state.fromMirror === true;
  const canEdit = has("po.create") && poIsEditable(po.status);
  const canSubmit = has("po.submit") && po.status === "DRAFT";
  const canApprove = has("po.approve") && po.status === "PENDING_APPROVAL";
  const hasActivePi = (piList ?? []).some((p) => p.status === "ACTIVE");
  const canRecordPi = has("pi.review") && PI_RECORDABLE_STATUSES.includes(po.status);

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
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 sm:gap-6 pb-4 mb-5 border-b border-[var(--color-border-default)]">
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
            {isFromMirror && <FreshnessBadge />}
          </div>
          <div className="text-[13px] text-[var(--color-ink-500)]">
            Supplier: <span className="text-[var(--color-ink-900)] font-medium">{po.supplier?.name ?? po.supplierId}</span>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2 shrink-0">
          {canEdit && (
            <Link
              href={`/procurement/purchase-orders/${po.id}/edit`}
              className="h-8 px-3 rounded-[3px] text-[12.5px] font-medium border border-[var(--color-border-strong)] bg-white text-[var(--color-ink-900)] hover:bg-[var(--color-ink-100)] inline-flex items-center justify-center"
            >
              Edit
            </Link>
          )}
          {canSubmit && (
            <button
              type="button"
              onClick={() => handleAction("submit")}
              disabled={action.status === "submitting"}
              className="h-8 px-3 rounded-[3px] text-[12.5px] font-medium text-white disabled:opacity-50 inline-flex items-center justify-center"
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
              className="h-8 px-3 rounded-[3px] text-[12.5px] font-medium text-white disabled:opacity-50 inline-flex items-center justify-center"
              style={{ background: "var(--color-success-700)" }}
            >
              {action.status === "submitting" && action.action === "approve" ? "Approving..." : "Approve"}
            </button>
          )}
          {canRecordPi && (
            <button
              type="button"
              onClick={() => setRecordOpen(true)}
              disabled={offlineConn}
              data-testid="record-pi-button"
              title={offlineConn ? "Recording a proforma invoice requires a connection" : undefined}
              className="h-8 px-3 rounded-[3px] text-[12.5px] font-medium border border-[var(--color-navy-700)] bg-white text-[var(--color-navy-700)] hover:bg-[var(--color-navy-50)] disabled:opacity-50 inline-flex items-center justify-center"
            >
              {hasActivePi ? "Record proforma invoice (revision)" : "Record proforma invoice"}
            </button>
          )}
          {!canEdit && !canSubmit && !canApprove && !canRecordPi && (
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

      {canRecordPi && offlineConn && (
        <div className="mb-4 px-3.5 py-2.5 rounded-[3px] bg-[var(--color-warning-100)] text-[var(--color-warning-700)] text-[12.5px]">
          Recording a proforma invoice requires a live connection. Reconnect to record one against this PO.
        </div>
      )}

      {recordedPi && (
        <div
          role="status"
          data-testid="record-pi-notification"
          className="mb-4 px-3.5 py-2.5 rounded-[3px] bg-[var(--color-success-100)] text-[var(--color-success-700)] text-[12.5px] flex items-center justify-between gap-3"
        >
          <span className="flex items-center gap-3 flex-wrap">
            <span>
              Proforma invoice <span className="font-mono font-semibold">{recordedPi.piNumber}</span> recorded for review. Approve to make it active.
            </span>
            <Link
              href={`/procurement/proforma-invoices/${recordedPi.id}`}
              data-testid="record-pi-review-link"
              className="underline font-medium hover:opacity-70"
            >
              Review proforma invoice
            </Link>
          </span>
          <button
            type="button"
            onClick={() => setRecordedPi(null)}
            aria-label="Dismiss"
            className="text-[var(--color-success-700)] hover:opacity-70 text-[14px] leading-none px-1"
          >
            &times;
          </button>
        </div>
      )}

      <SummaryCard po={po} />
      <LinesCard lines={po.lines} totalValue={po.totalValue} currency={po.currency} variantsById={variantsById} />
      <ProformaInvoicesCard piList={piList} />

      {canRecordPi && (
        <RecordProformaInvoiceModal
          open={recordOpen}
          onClose={() => setRecordOpen(false)}
          poId={po.id}
          poLines={po.lines}
          products={products}
          isRevision={hasActivePi}
          onSuccess={(pi) => {
            setRecordOpen(false);
            setRecordedPi({ id: pi.id, piNumber: pi.piNumber });
            setPiReloadTick((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}

const PI_STATUS_LABEL: Record<ProformaInvoiceStatus, string> = {
  PENDING_REVIEW: "Pending review",
  ACTIVE: "Active",
  SUPERSEDED: "Superseded",
  REJECTED: "Rejected",
};
const PI_STATUS_TONE: Record<ProformaInvoiceStatus, string> = {
  PENDING_REVIEW: "bg-[var(--color-warning-50)] text-[var(--color-warning-700)]",
  ACTIVE: "bg-[var(--color-success-100)] text-[var(--color-success-700)]",
  SUPERSEDED: "bg-[var(--color-ink-100)] text-[var(--color-ink-700)]",
  REJECTED: "bg-[var(--color-danger-50)] text-[var(--color-danger-700)]",
};

function ProformaInvoicesCard({ piList }: { piList: ProformaInvoice[] | null }) {
  const sorted = [...(piList ?? [])].sort((a, b) => b.revisionNumber - a.revisionNumber);
  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] mt-5 overflow-hidden">
      <header className="px-4 py-2.5 border-b border-[var(--color-border-default)]">
        <h2 className="m-0 text-[14px] font-semibold text-[var(--color-ink-900)]">Proforma invoices</h2>
      </header>
      {piList === null ? (
        <div className="px-4 py-6 text-center text-[12px] text-[var(--color-ink-500)]">Loading...</div>
      ) : sorted.length === 0 ? (
        <div className="px-4 py-6 text-center text-[12px] text-[var(--color-ink-500)]" data-testid="po-pi-empty">
          No proforma invoices recorded yet.
        </div>
      ) : (
        <ul className="divide-y divide-[var(--color-border-default)]" data-testid="po-pi-list">
          {sorted.map((pi) => (
            <li key={pi.id} data-testid="po-pi-row" className="px-4 py-2.5 flex items-center gap-3 hover:bg-[var(--color-ink-100)]">
              <Link
                href={`/procurement/proforma-invoices/${pi.id}`}
                className="font-mono text-[12.5px] text-[var(--color-navy-700)] hover:underline font-medium"
              >
                {pi.piNumber}
              </Link>
              <span className="text-[11px] text-[var(--color-ink-500)]">rev {pi.revisionNumber}</span>
              <span
                className={`inline-flex items-center h-[18px] px-2 rounded-full text-[10.5px] font-semibold uppercase tracking-[0.02em] ${PI_STATUS_TONE[pi.status]}`}
              >
                {PI_STATUS_LABEL[pi.status]}
              </span>
              <span className="ml-auto font-mono text-[12px] text-[var(--color-ink-900)]">
                {formatNGN(pi.totalValue)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
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
      <header className="px-4 sm:px-5 py-3 border-b border-[var(--color-border-default)] flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">Order identity</h2>
        <span className="text-mono-id text-[11px] text-[var(--color-ink-500)] break-all">{po.id}</span>
      </header>
      <div className="px-4 sm:px-5 py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-1">
        {rows.map((r, i) => (
          <div
            key={i}
            className={`${DETAIL_GRID} gap-1 sm:gap-3 items-baseline py-2 border-b border-dashed border-[var(--color-border-default)] last:border-b-0 text-[13px]`}
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
      <header className="px-4 sm:px-5 py-3 border-b border-[var(--color-border-default)]">
        <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">
          Line items{" "}
          <span className="text-[11px] text-[var(--color-ink-500)] font-medium ml-2">
            {lines.length} {lines.length === 1 ? "line" : "lines"}
          </span>
        </h2>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr>
              <Th>Variant</Th>
              <Th align="right">Quantity</Th>
              <Th align="right" className={COL.sm}>Unit Price</Th>
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
                        <div className="font-mono text-[10.5px] text-[var(--color-ink-500)] font-medium mt-0.5 block max-w-[104px] sm:max-w-none truncate" title={v.label.match(/\[(.*)\]/)?.[1] ?? l.productVariantId}>
                          {v.label.match(/\[(.*)\]/)?.[1] ?? l.productVariantId}
                        </div>
                      </>
                    ) : (
                      <span className="font-mono text-[12px] text-[var(--color-ink-700)] block max-w-[104px] sm:max-w-none truncate" title={l.productVariantId}>{l.productVariantId}</span>
                    )}
                  </Td>
                  <NumTd>{l.quantityOrdered}</NumTd>
                  <NumTd mono className={COL.sm}>{formatNGN(l.unitPrice)}</NumTd>
                  <NumTd mono strong>{Number.isFinite(lineTotal) ? formatNGN(lineTotal) : "--"}</NumTd>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-[var(--color-ink-100)]">
              <td colSpan={3} className="px-2 sm:px-3.5 py-2.5 text-right text-[12.5px] font-medium text-[var(--color-ink-700)]">
                Total {currency && <span className="font-mono text-[11px] text-[var(--color-ink-500)]">{currency}</span>}
              </td>
              <td className="px-2 sm:px-3.5 py-2.5 text-right tabular-nums font-mono text-[14px] font-semibold text-[var(--color-navy-800)]">
                {formatNGN(totalValue)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function Th({
  children,
  align = "left",
  className = "",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <th
      className={`font-medium text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] px-2 sm:px-3.5 py-2.5 border-b border-[var(--color-border-default)] bg-[var(--color-ink-100)] whitespace-nowrap ${
        align === "right" ? "text-right" : "text-left"
      } ${className}`}
    >
      {children}
    </th>
  );
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-2 sm:px-3.5 py-2.5 align-middle text-[var(--color-ink-900)] ${className}`}>{children}</td>;
}

function NumTd({
  children,
  mono,
  strong,
  className = "",
}: {
  children: React.ReactNode;
  mono?: boolean;
  strong?: boolean;
  className?: string;
}) {
  return (
    <td
      className={`px-2 sm:px-3.5 py-2.5 text-right tabular-nums whitespace-nowrap text-[var(--color-ink-900)] ${mono ? "font-mono text-[12px]" : ""} ${strong ? "font-semibold" : ""} ${className}`}
    >
      {children}
    </td>
  );
}
