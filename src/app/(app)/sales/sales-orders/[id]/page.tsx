"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState } from "react";

import CancelSalesOrderModal from "@/components/sales-orders/CancelSalesOrderModal";
import InitiateReturnModal, {
  type ReturnableUnit,
} from "@/components/returns/InitiateReturnModal";
import ReturnStatusPill from "@/components/returns/ReturnStatusPill";
import PrintButton from "@/components/invoices/PrintButton";
import SoStatusPill from "@/components/sales-orders/SoStatusPill";
import FreshnessBadge from "@/components/sync/FreshnessBadge";
import OfflineNotice from "@/components/sync/OfflineNotice";
import StatusPill from "@/components/units/StatusPill";
import {
  authoriseRelease,
  closeSalesOrder,
  confirmPayment,
  createDeliveryNote,
  createWaybill,
  dispatch,
  generateInvoice,
  getInvoiceForSo,
  getSalesOrder,
  listPayments,
  listReturns,
  parseI4Conflict,
  recordPayment,
  recordProofOfDelivery,
  rejectPayment,
  soIsCancellable,
  soIsEditable,
  submitSalesOrder,
  type ApiResult,
  type CancelSalesOrderResult,
  type Customer,
  type Invoice,
  type Payment,
  type RecordPaymentBody,
  type ReturnRow,
  type SaleForm,
  type SalesOrderDetail,
  type SalesOrderLine,
  type SoStatus,
  type UnitStatus,
} from "@/lib/api";
import RecordPaymentForm from "@/components/sales-orders/RecordPaymentForm";
import { SalesPiCard } from "@/components/sales-orders/SalesProformaInvoiceLinks";
import { usePermissions } from "@/lib/auth";
import { formatDateTime, formatNGN } from "@/lib/format";
import { salesInvoiceDoc } from "@/lib/invoices/pdf";
import { getById, listByType } from "@/lib/sync/mirror/store";
import { useUrlLastSegment } from "@/lib/sync/use-url-segment";

type LoadState =
  | { status: "loading" }
  | { status: "ok"; so: SalesOrderDetail; fromMirror?: boolean }
  | { status: "not_found" }
  | { status: "forbidden" }
  | { status: "offline" }
  | { status: "error"; message: string };

// Mirror shapes for SO detail reconstruction.
type MirroredSo = {
  id: string;
  soNumber: string;
  customerId: string;
  channel: string;
  status: SoStatus;
  subtotal: string;
  discountTotal: string;
  vatAmount: string;
  total: string;
  paymentReceivedTotal: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  createdById: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  cancellationReason: string | null;
  cancelledAt: string | null;
  cancelledById: string | null;
};
type MirroredSoLine = {
  id: string;
  salesOrderId: string;
  productVariantId: string;
  unitId: string | null;
  saleForm: SaleForm;
  unitPrice: string;
  discountAmount: string;
  lineTotal: string;
};
type MirroredVariantForSo = {
  id: string;
  supplierSkuCode: string;
};
type MirroredUnitForSo = {
  id: string;
  engineNumber: string;
  status: string;
};

type ActionBanner =
  | { kind: "idle" }
  | { kind: "conflict"; message: string }
  | { kind: "error"; message: string }
  | { kind: "info"; message: string };

export default function SalesOrderDetailPage() {
  const router = useRouter();
  const { has } = usePermissions();
  // Read from window.location to handle the SW's sibling-URL fallback;
  // see src/lib/sync/use-url-segment.ts.
  const id = useUrlLastSegment();

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [invoiceChecked, setInvoiceChecked] = useState(false);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [banner, setBanner] = useState<ActionBanner>({ kind: "idle" });
  const [pending, setPending] = useState<string | null>(null);

  // Cancel flow (prompt 37): confirmation modal + a mirror users map to render
  // the cancelled-by name from cancelledById.
  const [cancelOpen, setCancelOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [soReturns, setSoReturns] = useState<ReturnRow[]>([]);
  const [usersById, setUsersById] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await listByType<{ id: string; fullName: string }>("user");
        if (!cancelled) setUsersById(new Map(rows.map((r) => [r.body.id, r.body.fullName])));
      } catch {
        // Best-effort; falls back to the raw id.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Form: record payment. Field state (amount, method, reference, and the
  // overpayment resolution sub-form) lives inside RecordPaymentForm; the parent
  // owns only the open/submitting flags.
  const [showRecord, setShowRecord] = useState(false);
  const [recordSubmitting, setRecordSubmitting] = useState(false);

  // Form: delivery note.
  const [showDn, setShowDn] = useState(false);
  const [dnVehicle, setDnVehicle] = useState("");
  const [dnDriver, setDnDriver] = useState("");

  // Form: proof of delivery.
  const [showPod, setShowPod] = useState(false);
  const [podReceivedBy, setPodReceivedBy] = useState("");

  // Delivery note id for the waybill step (kept once we create it).
  const [dnId, setDnId] = useState<string | null>(null);
  const [hasWaybill, setHasWaybill] = useState(false);

  const mirrorPaintedRef = useRef(false);

  const loadFromMirror = async () => {
    try {
      const [soRow, lineRows, variantRows, unitRows, invRows, payRows, methodRows] =
        await Promise.all([
          getById<MirroredSo>("salesOrder", id),
          listByType<MirroredSoLine>("salesOrderLine"),
          listByType<MirroredVariantForSo>("productVariant"),
          listByType<MirroredUnitForSo>("unit"),
          listByType<Invoice>("invoice"),
          listByType<Payment>("payment"),
          listByType<{ id: string; name: string; status: string }>("paymentMethod"),
        ]);
      if (!soRow) return;
      const so = soRow.body;
      const customerRow = await getById<Customer>("customer", so.customerId);
      const variantById = new Map(variantRows.map((v) => [v.body.id, v.body]));
      const unitById = new Map(unitRows.map((u) => [u.body.id, u.body]));
      const lines: SalesOrderLine[] = lineRows
        .map((l) => l.body)
        .filter((l) => l.salesOrderId === id)
        .map((l) => {
          const v = variantById.get(l.productVariantId);
          const u = l.unitId ? unitById.get(l.unitId) : undefined;
          return {
            id: l.id,
            salesOrderId: l.salesOrderId,
            productVariantId: l.productVariantId,
            unitId: l.unitId,
            saleForm: l.saleForm,
            unitPrice: l.unitPrice,
            discountAmount: l.discountAmount,
            lineTotal: l.lineTotal,
            productVariant: v
              ? { id: v.id, supplierSkuCode: v.supplierSkuCode }
              : { id: l.productVariantId, supplierSkuCode: l.productVariantId },
            unit: u
              ? { id: u.id, engineNumber: u.engineNumber, status: u.status }
              : null,
          };
        });
      const c = customerRow?.body;
      const reconstructed: SalesOrderDetail = {
        ...so,
        channel: so.channel as SalesOrderDetail["channel"],
        customer: c
          ? { id: c.id, name: c.name, tierId: c.tierId, type: c.type }
          : { id: so.customerId, name: so.customerId, tierId: null, type: "" },
        lines,
      };
      mirrorPaintedRef.current = true;
      setState((prev) =>
        prev.status === "ok" && !prev.fromMirror
          ? prev
          : { status: "ok", so: reconstructed, fromMirror: true },
      );
      const matchingInvoice = invRows
        .map((i) => i.body)
        .find((i) => i.salesOrderId === id);
      setInvoice((prev) => prev ?? matchingInvoice ?? null);
      setInvoiceChecked(true);
      // Mirror Payment rows carry paymentMethodId only; the renderer expects
      // a nested paymentMethod summary object (api shape from the server's
      // include). Join from the mirrored paymentMethod bucket so the row is
      // structurally identical to a network-painted one, the same shape fix
      // the SO customer relation needed earlier. Without this, the renderer
      // crashes on `p.paymentMethod.name`.
      const methodById = new Map(methodRows.map((m) => [m.body.id, m.body]));
      const reconstructedPayments: Payment[] = payRows
        .map((p) => p.body)
        .filter((p) => p.salesOrderId === id)
        .map((p) => {
          const m = methodById.get(p.paymentMethodId);
          return {
            ...p,
            paymentMethod: m
              ? { id: m.id, name: m.name, status: m.status as Payment["paymentMethod"]["status"] }
              : { id: p.paymentMethodId, name: p.paymentMethodId, status: "ACTIVE" as Payment["paymentMethod"]["status"] },
          };
        });
      setPayments((prev) => (prev.length > 0 ? prev : reconstructedPayments));
    } catch {
      // Let the network phase drive.
    }
  };

  const refresh = async () => {
    const [soR, invR, payR] = await Promise.all([
      getSalesOrder(id),
      getInvoiceForSo(id),
      listPayments(id),
    ]);
    if (soR.kind === "ok") setState({ status: "ok", so: soR.data });
    else if (soR.kind === "not_found") setState({ status: "not_found" });
    else if (soR.kind === "unauthorized") router.replace("/login");
    else if (soR.kind === "forbidden") setState({ status: "forbidden" });
    else if (soR.kind === "network_error" || soR.kind === "server_error") {
      if (!mirrorPaintedRef.current) setState({ status: "offline" });
    } else {
      setState({ status: "error", message: "message" in soR ? String(soR.message) : "Error" });
    }

    if (invR.kind === "ok") {
      setInvoice(invR.data);
      setInvoiceChecked(true);
    } else if (invR.kind === "not_found") {
      setInvoice(null);
      setInvoiceChecked(true);
    }

    if (payR.kind === "ok") setPayments(payR.data);
  };

  useEffect(() => {
    // useUrlLastSegment starts as "" until its mount-time useEffect runs to
    // read window.location.pathname. Skip the first render's empty-id pass
    // so we do not hit GET /api/sales-orders/ (which Next collapses to the
    // LIST route, returning a SalesOrderListRow array that the page then
    // tries to render as a detail object, crashing on so.customer.name).
    // Same fix shape applies to any other detail page using
    // useUrlLastSegment whose fetch wrappers do not themselves guard
    // against the empty-segment case.
    if (!id) return;
    mirrorPaintedRef.current = false;
    void loadFromMirror();
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Returns for this order. There is no returns mirror bucket and no server-side
  // filter by sales order, so fetch the list and narrow by salesOrderId. Returns
  // volume is low; refine if it ever grows.
  const loadSoReturns = useRef<() => void>(() => {});
  loadSoReturns.current = () => {
    if (!id) return;
    listReturns().then((r) => {
      if (r.kind === "ok") setSoReturns(r.data.filter((x) => x.salesOrderId === id));
    });
  };
  useEffect(() => {
    loadSoReturns.current();
  }, [id]);

  // While the record-payment form is open, keep the remaining balance fresh:
  // re-fetch on focus/visibility so a balance moved by another session (a
  // confirm/reject elsewhere) is reflected before the user submits. This is the
  // (h) stale-data guard at the read side; the submit handler also refreshes on
  // a validation 400, and the backend remains the source of truth.
  const refreshOnFocusRef = useRef<() => void>(() => {});
  refreshOnFocusRef.current = () => {
    if (showRecord && id) void refresh();
  };
  useEffect(() => {
    if (!showRecord) return;
    const fn = () => refreshOnFocusRef.current();
    window.addEventListener("focus", fn);
    document.addEventListener("visibilitychange", fn);
    return () => {
      window.removeEventListener("focus", fn);
      document.removeEventListener("visibilitychange", fn);
    };
  }, [showRecord]);

  if (state.status === "loading")
    return <div className="max-w-[1080px] mx-auto py-10 text-center text-[var(--color-ink-500)]">Loading...</div>;
  if (state.status === "not_found")
    return <NotFoundCard id={id} />;
  if (state.status === "forbidden")
    return <div className="max-w-[1080px] mx-auto py-10 text-center text-[var(--color-ink-500)]">You do not have access to view this sales order.</div>;
  if (state.status === "error")
    return <div className="max-w-[1080px] mx-auto py-10 text-center text-[var(--color-danger-700)]">{state.message}</div>;
  if (state.status === "offline")
    return (
      <div className="max-w-[820px] mx-auto pb-10">
        <OfflineNotice body="This sales order's details will load when the connection returns. If this SO was visited online before, it should be in the local mirror; otherwise come back online to load it." />
        <div className="text-center mt-3">
          <Link
            href="/sales/sales-orders"
            className="text-[12px] text-[var(--color-navy-700)] hover:underline"
          >
            Back to Sales Orders
          </Link>
        </div>
      </div>
    );

  const so = state.so;
  const isFromMirror = state.fromMirror === true;
  const canEditSo = has("salesorder.create") && soIsEditable(so.status);
  const canSubmit = has("salesorder.create") && so.status === "DRAFT";
  const canGenerateInvoice = has("salesorder.create") && invoiceChecked && !invoice &&
    so.status !== "DRAFT" && so.status !== "CANCELLED" && so.status !== "REFUNDED";
  const canRecordPayment = has("payment.record") &&
    (so.status === "AWAITING_PAYMENT" || so.status === "PAYMENT_RECEIVED");
  const canConfirmPayment = has("payment.confirm");
  const canAuthoriseRelease = has("payment.confirm") && so.status === "PAYMENT_RECEIVED";
  const canDeliveryActions = has("delivery.manage");
  // Cancel mirrors the backend gate (salesorder.create) and the service's
  // cancellable-state allowlist (DRAFT / AWAITING_PAYMENT / PAYMENT_RECEIVED).
  const canCancel = has("salesorder.create") && soIsCancellable(so.status);
  // Returns: only a unit currently SOLD on this order can be returned (I-15).
  const soldUnits: ReturnableUnit[] = so.lines
    .filter((l) => l.unit && (l.unit.status === "SOLD_AS_CKD" || l.unit.status === "SOLD_AS_CBU"))
    .map((l) => ({ id: l.unit!.id, engineNumber: l.unit!.engineNumber }));
  const canInitiateReturn = has("return.manage") && soldUnits.length > 0;

  // Overpayment detection inputs (prompt 42b). Remaining balance = SO total
  // minus the sum of CONFIRMED payments, floored at 0, mirroring the backend's
  // balance basis exactly (cents math, no float drift). hasPendingPayments
  // drives the "confirmed-only" caveat on the overpayment indicator: a PENDING
  // payment does not reduce the balance yet, so the displayed remaining may not
  // be the eventual one.
  const totalCents = Math.round(Number(so.total) * 100);
  const confirmedCents = payments
    .filter((p) => p.status === "CONFIRMED")
    .reduce((acc, p) => acc + Math.round(Number(p.amount) * 100), 0);
  const remainingBalance = Math.max(0, totalCents - confirmedCents) / 100;
  const hasPendingPayments = payments.some((p) => p.status === "PENDING");

  // ------ confirmed-update wrappers ------
  const handle = async <T,>(label: string, op: () => Promise<ApiResult<T>>, onOk?: (data: T) => void) => {
    if (pending) return;
    setPending(label);
    setBanner({ kind: "idle" });
    const r = await op();
    setPending(null);
    if (r.kind === "ok") {
      if (onOk) onOk(r.data);
      await refresh();
      setBanner({ kind: "info", message: `${label}: done.` });
    } else if (r.kind === "conflict") {
      setBanner({ kind: "conflict", message: r.message });
    } else if (r.kind === "forbidden") {
      setBanner({ kind: "error", message: `You do not have permission for: ${label}.` });
    } else if (r.kind === "validation") {
      setBanner({ kind: "error", message: typeof r.message === "string" ? r.message : r.message.join("; ") });
    } else if (r.kind === "not_found") {
      setBanner({ kind: "error", message: `Not found: ${label}.` });
    } else if (r.kind === "network_error") {
      setBanner({ kind: "error", message: r.message });
    } else {
      setBanner({ kind: "error", message: `Unexpected response: ${label}.` });
    }
  };

  // Records the payment (and, when present, its overpayment resolution) in one
  // call. Returns the outcome so RecordPaymentForm can map known 400s onto the
  // field that caused them; the parent owns the success banner + refresh.
  const submitRecord = async (
    body: RecordPaymentBody,
  ): Promise<{ ok: boolean; message?: string }> => {
    setBanner({ kind: "idle" });
    setRecordSubmitting(true);
    const r = await recordPayment(so.id, body);
    setRecordSubmitting(false);
    if (r.kind === "ok") {
      setShowRecord(false);
      await refresh();
      const over = body.overpaymentResolution
        ? ` Overpayment recorded as ${body.overpaymentResolution === "REFUND" ? "a refund" : "a credit"}.`
        : "";
      setBanner({ kind: "info", message: `Payment of ${formatNGN(body.amount)} recorded (PENDING).${over}` });
      return { ok: true };
    }
    if (r.kind === "validation") {
      // Re-fetch so the remaining balance re-derives (covers the stale-balance
      // case), and hand the message back to the form for field-level mapping.
      await refresh();
      return { ok: false, message: typeof r.message === "string" ? r.message : r.message.join("; ") };
    }
    if (r.kind === "forbidden") {
      const m = "You do not have payment.record permission.";
      setBanner({ kind: "error", message: m });
      return { ok: false, message: m };
    }
    if (r.kind === "conflict") {
      setBanner({ kind: "conflict", message: r.message });
      return { ok: false, message: r.message };
    }
    if (r.kind === "network_error") {
      setBanner({ kind: "error", message: r.message });
      return { ok: false, message: r.message };
    }
    const m = "Unexpected response recording payment.";
    setBanner({ kind: "error", message: m });
    return { ok: false, message: m };
  };

  return (
    <div className="max-w-[1120px] mx-auto pb-10">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 sm:gap-6 pb-4 mb-5 border-b border-[var(--color-border-default)]">
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
            {isFromMirror && <FreshnessBadge />}
          </div>
          <div className="text-[13px] text-[var(--color-ink-500)]">
            Customer: <span className="text-[var(--color-ink-900)] font-medium">{so.customer.name}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {canEditSo && (
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
              onClick={() => handle("Submit for payment", () => submitSalesOrder(so.id))}
              disabled={pending !== null}
              className="h-8 px-3 rounded-[3px] text-[12.5px] font-medium text-white disabled:opacity-50 inline-flex items-center"
              style={{ background: "var(--color-navy-700)" }}
            >
              {pending === "Submit for payment" ? "Submitting..." : "Submit for Payment"}
            </button>
          )}
          {canAuthoriseRelease && (
            <button
              type="button"
              onClick={() => handle("Authorise release", () => authoriseRelease(so.id))}
              disabled={pending !== null}
              className="h-8 px-3 rounded-[3px] text-[12.5px] font-medium text-white disabled:opacity-50 inline-flex items-center"
              style={{ background: "var(--color-success-700)" }}
            >
              {pending === "Authorise release" ? "Authorising..." : "Authorise Release"}
            </button>
          )}
          {canInitiateReturn && (
            <button
              type="button"
              onClick={() => setReturnOpen(true)}
              disabled={pending !== null}
              data-testid="initiate-return-button"
              className="h-8 px-3 rounded-[3px] text-[12.5px] font-medium border border-[var(--color-navy-700)] bg-white text-[var(--color-navy-700)] hover:bg-[var(--color-navy-50)] disabled:opacity-50 inline-flex items-center"
            >
              Initiate return
            </button>
          )}
          {canCancel && (
            <button
              type="button"
              onClick={() => setCancelOpen(true)}
              disabled={pending !== null}
              data-testid="cancel-so-button"
              className="h-8 px-3 rounded-[3px] text-[12.5px] font-medium border border-[var(--color-danger-700)] bg-white text-[var(--color-danger-700)] hover:bg-[var(--color-danger-50)] disabled:opacity-50 inline-flex items-center"
            >
              Cancel order
            </button>
          )}
        </div>
      </header>

      {has("return.manage") && (
        <InitiateReturnModal
          open={returnOpen}
          onClose={() => setReturnOpen(false)}
          salesOrderId={so.id}
          soNumber={so.soNumber}
          units={soldUnits}
          onSuccess={(created) => {
            setReturnOpen(false);
            void refresh();
            loadSoReturns.current();
            setBanner({
              kind: "info",
              message: `Return initiated for unit ${created.unit.engineNumber}.`,
            });
          }}
        />
      )}

      {canCancel && (
        <CancelSalesOrderModal
          open={cancelOpen}
          onClose={() => setCancelOpen(false)}
          soId={so.id}
          soNumber={so.soNumber}
          onSuccess={(result: CancelSalesOrderResult) => {
            setCancelOpen(false);
            void refresh();
            setBanner({
              kind: result.refundOutstanding
                ? "conflict"
                : "info",
              message: result.refundOutstanding
                ? `Sales order cancelled. A refund of ${formatNGN(result.refundAmount ?? "0")} is outstanding for confirmed payments (process it via the refund flow).`
                : "Sales order cancelled.",
            });
          }}
        />
      )}

      <BannerArea banner={banner} />

      <IdentityCard
        so={so}
        cancelledByName={
          so.cancelledById ? usersById.get(so.cancelledById) ?? so.cancelledById : null
        }
      />
      <SoftReservationNotice so={so} />
      <LinesCard lines={so.lines} so={so} />

      {soReturns.length > 0 && (
        <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] mb-6" data-testid="so-returns-card">
          <header className="px-5 py-3 border-b border-[var(--color-border-default)] flex items-center justify-between">
            <h2 className="m-0 text-[14px] font-semibold text-[var(--color-ink-900)]">Returns</h2>
            <span className="text-[11px] text-[var(--color-ink-500)] font-medium bg-[var(--color-ink-100)] px-2 py-0.5 rounded-full">
              {soReturns.length}
            </span>
          </header>
          <ul className="divide-y divide-[var(--color-border-default)]">
            {soReturns.map((r) => (
              <li key={r.id} className="px-5 py-2.5 flex items-center justify-between gap-3 text-[12.5px]">
                <Link
                  href={`/sales/returns/${r.id}`}
                  className="font-mono text-[var(--color-navy-700)] hover:underline"
                >
                  {r.unit.engineNumber}
                </Link>
                <span className="flex items-center gap-3">
                  {r.reason && (
                    <span className="text-[var(--color-ink-500)] truncate max-w-[280px] hidden sm:inline">
                      {r.reason}
                    </span>
                  )}
                  <ReturnStatusPill status={r.status} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <SalesPiCard pi={so.salesProformaInvoice} known={!isFromMirror} />

      <InvoiceCard
        invoice={invoice}
        invoiceChecked={invoiceChecked}
        canGenerate={canGenerateInvoice}
        generating={pending === "Generate invoice"}
        onGenerate={() => handle("Generate invoice", () => generateInvoice(so.id))}
      />

      <PaymentsCard
        payments={payments}
        so={so}
        canRecord={canRecordPayment}
        canConfirm={canConfirmPayment}
        showRecord={showRecord}
        onOpenRecord={() => {
          setShowRecord(true);
          // Start from a fresh balance so detection reflects the latest confirms.
          void refresh();
        }}
        onCloseRecord={() => setShowRecord(false)}
        remainingBalance={remainingBalance}
        hasPendingPayments={hasPendingPayments}
        recordSubmitting={recordSubmitting}
        onSubmitRecord={submitRecord}
        onConfirm={(pid) => handle("Confirm payment", () => confirmPayment(pid))}
        onReject={(pid) => handle("Reject payment", () => rejectPayment(pid))}
        pending={pending}
      />

      {(so.status === "RELEASE_AUTHORISED" ||
        so.status === "PICKING" ||
        so.status === "READY_FOR_DISPATCH" ||
        so.status === "DISPATCHED" ||
        so.status === "DELIVERED") && (
        <DeliveryCard
          so={so}
          canManage={canDeliveryActions}
          pending={pending}
          dnId={dnId}
          hasWaybill={hasWaybill}
          showDn={showDn}
          dnVehicle={dnVehicle}
          dnDriver={dnDriver}
          showPod={showPod}
          podReceivedBy={podReceivedBy}
          onOpenDn={() => setShowDn(true)}
          onCloseDn={() => setShowDn(false)}
          onDnVehicleChange={setDnVehicle}
          onDnDriverChange={setDnDriver}
          onSubmitDn={() =>
            handle("Create delivery note", () =>
              createDeliveryNote(so.id, {
                ...(dnVehicle.trim() ? { vehicleReg: dnVehicle.trim() } : {}),
                ...(dnDriver.trim() ? { driverName: dnDriver.trim() } : {}),
              }),
              (dn) => {
                setDnId(dn.id);
                setShowDn(false);
                setDnVehicle("");
                setDnDriver("");
              },
            )
          }
          onCreateWaybill={() => {
            if (!dnId) {
              setBanner({ kind: "error", message: "Create the delivery note before the waybill." });
              return;
            }
            void handle("Create waybill", () => createWaybill(dnId), () => setHasWaybill(true));
          }}
          onDispatch={() => handle("Dispatch", () => dispatch(so.id))}
          onOpenPod={() => setShowPod(true)}
          onClosePod={() => setShowPod(false)}
          podReceivedByChange={setPodReceivedBy}
          onSubmitPod={() =>
            handle("Record proof of delivery", () =>
              recordProofOfDelivery(so.id, {
                ...(podReceivedBy.trim() ? { receivedBy: podReceivedBy.trim() } : {}),
                signedAt: new Date().toISOString(),
              }),
              () => {
                setShowPod(false);
                setPodReceivedBy("");
              },
            )
          }
          onClose={() => handle("Close sales order", () => closeSalesOrder(so.id))}
        />
      )}
    </div>
  );
}

function BannerArea({ banner }: { banner: ActionBanner }) {
  if (banner.kind === "idle") return null;
  if (banner.kind === "conflict") {
    const i4 = parseI4Conflict(banner.message);
    return (
      <div
        role="alert"
        className="mb-4 px-3.5 py-2.5 rounded-[3px] border-2"
        style={{ background: "var(--color-warning-50)", borderColor: "var(--color-warning-700)", color: "var(--color-warning-700)" }}
      >
        <div className="font-semibold text-[13px] mb-1">Server refused the action</div>
        {i4 ? (
          <div className="text-[12.5px] text-[var(--color-ink-900)]">
            <span className="font-semibold">Invariant I-4 (payment coverage):</span> confirmed
            payments cover{" "}
            <span className="font-mono font-semibold text-[var(--color-danger-700)]">
              {formatNGN(i4.confirmed)}
            </span>{" "}
            of the order total{" "}
            <span className="font-mono font-semibold text-[var(--color-ink-900)]">
              {formatNGN(i4.total)}
            </span>
            . Release refused. The server re-checks the real confirmed-payment sum inside the
            release transaction; a desynced status does not bypass this defence.
          </div>
        ) : (
          <div className="text-[12px]">
            <span className="font-mono">{banner.message}</span>
          </div>
        )}
      </div>
    );
  }
  if (banner.kind === "error") {
    return (
      <div
        role="alert"
        className="mb-4 px-3.5 py-2.5 rounded-[3px] border"
        style={{ background: "var(--color-danger-50)", borderColor: "var(--color-danger-100)", color: "var(--color-danger-700)" }}
      >
        <div className="text-[12px]">{banner.message}</div>
      </div>
    );
  }
  return (
    <div
      className="mb-4 px-3.5 py-2.5 rounded-[3px] border"
      style={{ background: "var(--color-success-50)", borderColor: "var(--color-success-100)", color: "var(--color-success-700)" }}
    >
      <div className="text-[12px]">{banner.message}</div>
    </div>
  );
}

function IdentityCard({
  so,
  cancelledByName,
}: {
  so: SalesOrderDetail;
  cancelledByName?: string | null;
}) {
  const rows: { label: string; value: React.ReactNode; mono?: boolean }[] = [
    { label: "SO Number", value: so.soNumber, mono: true },
    { label: "Customer", value: <>{so.customer.name} <span className="text-[11px] text-[var(--color-ink-500)] ml-1">{so.customer.type}</span></> },
    { label: "Status", value: <SoStatusPill status={so.status} /> },
    { label: "Channel", value: so.channel.replace(/_/g, " ") },
    { label: "Subtotal", value: <span className="font-mono tabular-nums">{formatNGN(so.subtotal)}</span> },
    {
      label: "Discount",
      value: Number(so.discountTotal) > 0
        ? <span className="font-mono tabular-nums text-[var(--color-danger-700)]">&minus;{formatNGN(so.discountTotal)}</span>
        : <span className="text-[var(--color-ink-400)]">&minus;&minus;</span>,
    },
    { label: "VAT (7.5%)", value: <span className="font-mono tabular-nums">{formatNGN(so.vatAmount)}</span> },
    {
      label: "Total",
      value: <span className="font-mono tabular-nums text-[14px] font-semibold text-[var(--color-navy-800)]">{formatNGN(so.total)}</span>,
    },
    {
      label: "Payment received",
      value: <span className="font-mono tabular-nums">{formatNGN(so.paymentReceivedTotal)}</span>,
    },
    { label: "Created", value: formatDateTime(so.createdAt) },
    {
      label: "Dispatched",
      value: so.dispatchedAt ? formatDateTime(so.dispatchedAt) : <span className="text-[var(--color-ink-400)]">&minus;&minus;</span>,
    },
    {
      label: "Delivered",
      value: so.deliveredAt ? formatDateTime(so.deliveredAt) : <span className="text-[var(--color-ink-400)]">&minus;&minus;</span>,
    },
    ...(so.status === "CANCELLED"
      ? [
          {
            label: "Cancellation reason",
            value: (
              <span data-testid="so-cancellation-reason" className="text-[var(--color-danger-700)]">
                {so.cancellationReason ?? "--"}
              </span>
            ),
          },
          {
            label: "Cancelled at",
            value: so.cancelledAt ? formatDateTime(so.cancelledAt) : "--",
          },
          {
            label: "Cancelled by",
            value: cancelledByName ?? "--",
          },
        ]
      : []),
  ];
  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] mb-4">
      <header className="px-5 py-3 border-b border-[var(--color-border-default)] flex items-center justify-between">
        <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">Order identity</h2>
        <span className="text-mono-id text-[11px] text-[var(--color-ink-500)]">{so.id}</span>
      </header>
      <div className="px-5 py-3 grid grid-cols-1 sm:grid-cols-2gap-x-12 gap-y-1">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-3 items-baseline py-2 border-b border-dashed border-[var(--color-border-default)] last:border-b-0 text-[13px]">
            <span className="text-[12px] font-medium text-[var(--color-ink-500)]">{r.label}</span>
            <span className={`text-[var(--color-ink-900)] font-medium ${r.mono ? "font-mono text-[13px] tracking-[0.02em]" : ""}`}>{r.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function SoftReservationNotice({ so }: { so: SalesOrderDetail }) {
  const stillReserved = so.lines.some(
    (l) => l.unit && (l.unit.status === "IN_WAREHOUSE_CKD" || l.unit.status === "IN_WAREHOUSE_CBU"),
  );
  if (!stillReserved) return null;
  return (
    <div
      className="mb-4 px-3.5 py-2.5 rounded-[3px] border flex items-start gap-2"
      style={{ background: "var(--color-navy-50)", borderColor: "var(--color-navy-100)", color: "var(--color-navy-800)" }}
    >
      <span className="text-[10px] font-semibold uppercase tracking-[0.04em] px-1.5 py-0.5 rounded-[2px] flex-shrink-0 mt-px"
            style={{ background: "var(--color-navy-700)", color: "white" }}>Soft reservation</span>
      <div className="text-[12px] leading-snug">
        The units below are <span className="font-semibold">reserved to this order</span> but
        physically <span className="font-semibold">still in the warehouse</span>. They become
        <span className="font-mono"> SOLD_AS_CKD</span> or <span className="font-mono"> SOLD_AS_CBU</span> only
        at release.
      </div>
    </div>
  );
}

function LinesCard({ lines, so }: { lines: readonly SalesOrderLine[]; so: SalesOrderDetail }) {
  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] mb-4">
      <header className="px-5 py-3 border-b border-[var(--color-border-default)]">
        <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">
          Line items
          <span className="text-[11px] text-[var(--color-ink-500)] font-medium ml-2">{lines.length} line{lines.length === 1 ? "" : "s"}</span>
        </h2>
      </header>
      <div className="overflow-x-auto">
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
              <Td><span className="font-mono text-[11.5px] text-[var(--color-ink-700)]">{l.productVariant.supplierSkuCode}</span></Td>
              <Td>
                <span className={`inline-flex items-center h-4 px-1.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.02em] ${l.saleForm === "CKD" ? "bg-[var(--color-navy-100)] text-[var(--color-navy-800)]" : "bg-[var(--color-success-50)] text-[var(--color-success-700)]"}`}>
                  {l.saleForm}
                </span>
              </Td>
              <Td>{l.unit ? <Link href={`/inventory/units/${encodeURIComponent(l.unit.engineNumber)}`} className="font-mono text-[11.5px] text-[var(--color-navy-700)] hover:underline tracking-[0.02em]">{l.unit.engineNumber}</Link> : <span className="text-[var(--color-ink-400)]">--</span>}</Td>
              <Td>{l.unit ? (
                <span className="inline-flex items-center gap-1.5">
                  <StatusPill status={l.unit.status as UnitStatus} />
                  {(l.unit.status === "IN_WAREHOUSE_CKD" || l.unit.status === "IN_WAREHOUSE_CBU") && (
                    <span className="text-[10px] text-[var(--color-navy-700)] font-medium">reserved to {so.soNumber}</span>
                  )}
                  {(l.unit.status === "SOLD_AS_CKD" || l.unit.status === "SOLD_AS_CBU") && (
                    <span className="text-[10px] text-[var(--color-success-700)] font-medium">sold on {so.soNumber}</span>
                  )}
                </span>
              ) : <span className="text-[var(--color-ink-400)]">--</span>}</Td>
              <NumTd mono>{formatNGN(l.unitPrice)}</NumTd>
              <NumTd mono>{Number(l.discountAmount) > 0 ? <span className="text-[var(--color-danger-700)]">&minus;{formatNGN(l.discountAmount)}</span> : <span className="text-[var(--color-ink-400)]">&minus;&minus;</span>}</NumTd>
              <NumTd mono strong>{formatNGN(l.lineTotal)}</NumTd>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </section>
  );
}

function InvoiceCard({
  invoice,
  invoiceChecked,
  canGenerate,
  generating,
  onGenerate,
}: {
  invoice: Invoice | null;
  invoiceChecked: boolean;
  canGenerate: boolean;
  generating: boolean;
  onGenerate: () => void;
}) {
  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] mb-4">
      <header className="px-5 py-3 border-b border-[var(--color-border-default)] flex items-center justify-between gap-2 flex-wrap">
        <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">Invoice</h2>
        <div className="flex items-center gap-2 flex-wrap">
          {invoice && (
            <>
              <Link
                href={`/sales/invoices/${invoice.id}`}
                className="h-7 px-2.5 inline-flex items-center rounded-[3px] text-[12px] font-medium border border-[var(--color-border-strong)] bg-white text-[var(--color-navy-700)] hover:bg-[var(--color-navy-50)]"
              >
                View invoice
              </Link>
              <PrintButton
                pdfPath={salesInvoiceDoc(invoice.id).pdf}
                fallbackFilename={`${invoice.invoiceNumber}.pdf`}
                variant="outline"
              />
            </>
          )}
          {canGenerate && (
            <button
              type="button"
              onClick={onGenerate}
              disabled={generating}
              className="h-7 px-2.5 rounded-[3px] text-[12px] font-medium border border-[var(--color-border-strong)] bg-white text-[var(--color-navy-700)] hover:bg-[var(--color-navy-50)] disabled:opacity-50"
            >
              {generating ? "Generating..." : "Generate Invoice"}
            </button>
          )}
        </div>
      </header>
      <div className="px-5 py-3">
        {!invoiceChecked ? (
          <div className="text-[12.5px] text-[var(--color-ink-500)]">Loading...</div>
        ) : invoice ? (
          <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-x-3 gap-y-2 text-[13px]">
            <span className="text-[12px] font-medium text-[var(--color-ink-500)]">Invoice number</span>
            <span className="font-mono font-semibold text-[var(--color-navy-700)]">{invoice.invoiceNumber}</span>
            <span className="text-[12px] font-medium text-[var(--color-ink-500)]">Issued</span>
            <span>{formatDateTime(invoice.issueDate)}</span>
            <span className="text-[12px] font-medium text-[var(--color-ink-500)]">VAT rate (snapshot)</span>
            <span className="font-mono">{(Number(invoice.vatRate) * 100).toFixed(2)}%</span>
            <span className="text-[12px] font-medium text-[var(--color-ink-500)]">VAT amount (snapshot)</span>
            <span className="font-mono tabular-nums">{formatNGN(invoice.vatAmount)}</span>
            <span className="text-[12px] font-medium text-[var(--color-ink-500)]">Total (snapshot)</span>
            <span className="font-mono tabular-nums font-semibold text-[var(--color-navy-800)] text-[14px]">{formatNGN(invoice.total)}</span>
          </div>
        ) : (
          <div className="text-[12.5px] text-[var(--color-ink-500)]">
            No invoice generated yet. {canGenerate
              ? "Click Generate Invoice to snapshot the order totals."
              : "An invoice will appear once the order is at AWAITING_PAYMENT or beyond and an authorised user generates it."}
          </div>
        )}
      </div>
    </section>
  );
}

// Human label for a payment's recorded overpayment resolution, or null when the
// payment did not overpay. The system records the user's stated resolution; it
// neither processes the refund nor issues the credit.
function overpaymentSummary(p: Payment): string | null {
  if (!p.overpaymentAmount || !p.overpaymentResolution) return null;
  if (p.overpaymentResolution === "REFUND") {
    const mech =
      p.refundMechanism === "BANK_TRANSFER"
        ? "Bank Transfer"
        : p.refundMechanism === "CASH"
          ? "Cash"
          : "an unspecified mechanism";
    const ref = p.refundReference ? ` (ref: ${p.refundReference})` : "";
    return `Refund issued via ${mech}${ref}`;
  }
  const notes = p.creditNotes ? ` (notes: ${p.creditNotes})` : "";
  return `Credit applied${notes}`;
}

function PaymentsCard({
  payments,
  so,
  canRecord,
  canConfirm,
  showRecord,
  onOpenRecord,
  onCloseRecord,
  remainingBalance,
  hasPendingPayments,
  recordSubmitting,
  onSubmitRecord,
  onConfirm,
  onReject,
  pending,
}: {
  payments: Payment[];
  so: SalesOrderDetail;
  canRecord: boolean;
  canConfirm: boolean;
  showRecord: boolean;
  onOpenRecord: () => void;
  onCloseRecord: () => void;
  remainingBalance: number;
  hasPendingPayments: boolean;
  recordSubmitting: boolean;
  onSubmitRecord: (body: RecordPaymentBody) => Promise<{ ok: boolean; message?: string }>;
  onConfirm: (id: string) => void;
  onReject: (id: string) => void;
  pending: string | null;
}) {
  const total = Number(so.total);
  const received = Number(so.paymentReceivedTotal);
  const pct = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
  const remaining = Math.max(0, total - received);
  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] mb-4">
      <header className="px-5 py-3 border-b border-[var(--color-border-default)] flex items-center justify-between">
        <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">
          Payments
          <span className="text-[11px] text-[var(--color-ink-500)] font-medium ml-2">
            {payments.length} on record &middot; {pct}% covered
          </span>
        </h2>
        {canRecord && !showRecord && (
          <button
            type="button"
            onClick={onOpenRecord}
            className="h-7 px-2.5 rounded-[3px] text-[12px] font-medium text-white"
            style={{ background: "var(--color-navy-700)" }}
          >
            + Record Payment
          </button>
        )}
      </header>

      <div className="px-5 py-3 border-b border-[var(--color-border-default)]">
        <div className="text-[11px] text-[var(--color-ink-500)] mb-1.5">
          Confirmed payments &middot;{" "}
          <span className="text-[var(--color-ink-900)] font-mono font-semibold">{formatNGN(so.paymentReceivedTotal)}</span>{" "}
          of <span className="text-[var(--color-ink-900)] font-mono font-semibold">{formatNGN(so.total)}</span>{" "}
          {remaining > 0 ? (
            <span className="text-[var(--color-warning-700)]">
              ({formatNGN(remaining.toString())} remaining)
            </span>
          ) : (
            <span className="text-[var(--color-success-700)]">(fully covered)</span>
          )}
        </div>
        <div className="h-2 rounded-full bg-[var(--color-ink-100)] overflow-hidden">
          <div className="h-full" style={{ width: `${pct}%`, background: pct >= 100 ? "var(--color-success-700)" : "var(--color-navy-700)" }} />
        </div>
      </div>

      {showRecord && (
        <RecordPaymentForm
          remainingBalance={remainingBalance}
          hasPendingPayments={hasPendingPayments}
          submitting={recordSubmitting}
          onCancel={onCloseRecord}
          onSubmit={onSubmitRecord}
        />
      )}

      <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr>
            <Th>Status</Th>
            <Th>Method</Th>
            <Th align="right">Amount</Th>
            <Th>Reference</Th>
            <Th>Source</Th>
            <Th>Received</Th>
            <Th align="right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {payments.length === 0 && (
            <tr>
              <td colSpan={7} className="px-3.5 py-5 text-center text-[var(--color-ink-500)] text-[12.5px]">
                No payments yet.
              </td>
            </tr>
          )}
          {payments.map((p, i) => {
            const rowBg = i % 2 ? "bg-[#FBFBFC]" : "bg-white";
            const op = overpaymentSummary(p);
            return (
            <Fragment key={p.id}>
            <tr className={`${rowBg} ${op ? "" : "border-b border-[var(--color-border-default)] last:border-b-0"}`}>
              <Td><PaymentStatusPill status={p.status} /></Td>
              <Td>{p.paymentMethod.name}</Td>
              <NumTd mono strong>{formatNGN(p.amount)}</NumTd>
              <Td>{p.referenceNumber ? <span className="font-mono text-[11.5px]">{p.referenceNumber}</span> : <span className="text-[var(--color-ink-400)]">&minus;&minus;</span>}</Td>
              <Td><span className="text-[11px] text-[var(--color-ink-700)]">{p.confirmationSource.replace(/_/g, " ")}</span></Td>
              <Td>{formatDateTime(p.receivedAt)}</Td>
              <td className="px-3.5 py-2.5 text-right whitespace-nowrap">
                {p.status === "PENDING" && canConfirm && (
                  <div className="inline-flex gap-1">
                    <button
                      type="button"
                      onClick={() => onConfirm(p.id)}
                      disabled={pending !== null}
                      className="h-6 px-2 rounded-[3px] text-[11px] font-medium text-white disabled:opacity-50"
                      style={{ background: "var(--color-success-700)" }}
                    >
                      {pending === "Confirm payment" ? "..." : "Confirm"}
                    </button>
                    <button
                      type="button"
                      onClick={() => onReject(p.id)}
                      disabled={pending !== null}
                      className="h-6 px-2 rounded-[3px] text-[11px] font-medium text-[var(--color-danger-700)] border border-[var(--color-danger-100)] bg-white disabled:opacity-50"
                    >
                      {pending === "Reject payment" ? "..." : "Reject"}
                    </button>
                  </div>
                )}
                {p.status === "PENDING" && !canConfirm && (
                  <span className="text-[10.5px] text-[var(--color-ink-500)]">(requires payment.confirm)</span>
                )}
              </td>
            </tr>
            {op && (
              <tr className={`${rowBg} border-b border-[var(--color-border-default)] last:border-b-0`} data-testid="overpayment-row">
                <td colSpan={7} className="px-3.5 pb-2.5 pt-0">
                  <div className="rounded-[3px] border border-[var(--color-warning-100)] bg-[var(--color-warning-50)] px-2.5 py-1.5 text-[11.5px] text-[var(--color-ink-900)] flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-semibold uppercase tracking-[0.03em] text-[10px] text-[var(--color-warning-700)]">Overpayment</span>
                    <span>
                      Of <span className="font-mono tabular-nums font-semibold">{formatNGN(p.amount)}</span> paid,{" "}
                      <span className="font-mono tabular-nums font-semibold">{formatNGN(p.overpaymentAmount ?? "0")}</span> was excess.
                    </span>
                    <span className="text-[var(--color-ink-300)]">&middot;</span>
                    <span data-testid="overpayment-resolution">{op}</span>
                  </div>
                </td>
              </tr>
            )}
            </Fragment>
            );
          })}
        </tbody>
      </table>
      </div>
    </section>
  );
}

function PaymentStatusPill({ status }: { status: Payment["status"] }) {
  const tone = status === "PENDING" ? "amber" : status === "CONFIRMED" ? "success" : "danger";
  const cls = tone === "amber"
    ? "bg-[var(--color-warning-50)] text-[var(--color-warning-700)]"
    : tone === "success"
      ? "bg-[var(--color-success-50)] text-[var(--color-success-700)]"
      : "bg-[var(--color-danger-50)] text-[var(--color-danger-700)]";
  return (
    <span className={`inline-flex items-center h-4 px-1.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.02em] ${cls}`}>
      {status}
    </span>
  );
}

function DeliveryCard({
  so,
  canManage,
  pending,
  dnId,
  hasWaybill,
  showDn,
  dnVehicle,
  dnDriver,
  showPod,
  podReceivedBy,
  onOpenDn,
  onCloseDn,
  onDnVehicleChange,
  onDnDriverChange,
  onSubmitDn,
  onCreateWaybill,
  onDispatch,
  onOpenPod,
  onClosePod,
  podReceivedByChange,
  onSubmitPod,
  onClose,
}: {
  so: SalesOrderDetail;
  canManage: boolean;
  pending: string | null;
  dnId: string | null;
  hasWaybill: boolean;
  showDn: boolean;
  dnVehicle: string;
  dnDriver: string;
  showPod: boolean;
  podReceivedBy: string;
  onOpenDn: () => void;
  onCloseDn: () => void;
  onDnVehicleChange: (v: string) => void;
  onDnDriverChange: (v: string) => void;
  onSubmitDn: () => void;
  onCreateWaybill: () => void;
  onDispatch: () => void;
  onOpenPod: () => void;
  onClosePod: () => void;
  podReceivedByChange: (v: string) => void;
  onSubmitPod: () => void;
  onClose: () => void;
}) {
  if (!canManage) {
    return (
      <section className="bg-white border border-[var(--color-border-default)] rounded-[4px]">
        <header className="px-5 py-3 border-b border-[var(--color-border-default)]">
          <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">Delivery</h2>
        </header>
        <div className="px-5 py-3 text-[12.5px] text-[var(--color-ink-500)]">
          The delivery actions require <span className="font-mono">delivery.manage</span>.
        </div>
      </section>
    );
  }
  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px]">
      <header className="px-5 py-3 border-b border-[var(--color-border-default)]">
        <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">
          Delivery
          <span className="text-[11px] text-[var(--color-ink-500)] font-medium ml-2">
            Current status: <span className="font-mono">{so.status}</span>
          </span>
        </h2>
      </header>

      <div className="px-5 py-3 grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-x-4 gap-y-2 text-[13px]">
        <DeliveryStep
          label="Delivery note"
          active={so.status === "RELEASE_AUTHORISED" || so.status === "PICKING"}
          done={so.status === "READY_FOR_DISPATCH" || so.status === "DISPATCHED" || so.status === "DELIVERED" || so.status === "CLOSED"}
          actionLabel="Create delivery note"
          onAction={onOpenDn}
          pending={pending === "Create delivery note"}
          expanded={showDn}
        >
          {showDn && (
            <div className="mt-2 p-3 bg-[var(--color-navy-50)] rounded-[3px]">
              <div className="grid grid-cols-1 sm:grid-cols-2gap-3 mb-2">
                <label className="block">
                  <span className="block text-[10.5px] font-medium uppercase tracking-[0.04em] text-[var(--color-ink-500)] mb-1">Vehicle reg</span>
                  <input type="text" value={dnVehicle} onChange={(e) => onDnVehicleChange(e.target.value)} placeholder="optional" className="h-7 w-full px-2 text-[12.5px] text-[var(--color-ink-900)] bg-white border border-[var(--color-border-strong)] rounded-[3px]" />
                </label>
                <label className="block">
                  <span className="block text-[10.5px] font-medium uppercase tracking-[0.04em] text-[var(--color-ink-500)] mb-1">Driver name</span>
                  <input type="text" value={dnDriver} onChange={(e) => onDnDriverChange(e.target.value)} placeholder="optional" className="h-7 w-full px-2 text-[12.5px] text-[var(--color-ink-900)] bg-white border border-[var(--color-border-strong)] rounded-[3px]" />
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={onCloseDn} className="h-7 px-2.5 text-[12px] text-[var(--color-ink-700)]">Cancel</button>
                <button type="button" onClick={onSubmitDn} disabled={pending !== null} className="h-7 px-3 rounded-[3px] text-[12px] font-medium text-white disabled:opacity-50" style={{ background: "var(--color-navy-700)" }}>
                  {pending === "Create delivery note" ? "Creating..." : "Create"}
                </button>
              </div>
            </div>
          )}
        </DeliveryStep>

        <DeliveryStep
          label="Waybill"
          active={so.status === "READY_FOR_DISPATCH" && !hasWaybill}
          done={hasWaybill || so.status === "DISPATCHED" || so.status === "DELIVERED" || so.status === "CLOSED"}
          actionLabel="Create waybill"
          onAction={onCreateWaybill}
          pending={pending === "Create waybill"}
          disabled={dnId === null && !(so.status === "READY_FOR_DISPATCH" || so.status === "DISPATCHED" || so.status === "DELIVERED" || so.status === "CLOSED")}
          disabledHint={dnId === null && so.status === "READY_FOR_DISPATCH" ? "Waybill id is set only on the same session that created the DN; reload the page in a new session if needed." : undefined}
        />

        <DeliveryStep
          label="Dispatch"
          active={so.status === "READY_FOR_DISPATCH"}
          done={so.status === "DISPATCHED" || so.status === "DELIVERED" || so.status === "CLOSED"}
          actionLabel="Dispatch"
          onAction={onDispatch}
          pending={pending === "Dispatch"}
        />

        <DeliveryStep
          label="Proof of delivery"
          active={so.status === "DISPATCHED"}
          done={so.status === "DELIVERED" || so.status === "CLOSED"}
          actionLabel="Record proof of delivery"
          onAction={onOpenPod}
          pending={pending === "Record proof of delivery"}
          expanded={showPod}
        >
          {showPod && (
            <div className="mt-2 p-3 bg-[var(--color-navy-50)] rounded-[3px]">
              <label className="block mb-2">
                <span className="block text-[10.5px] font-medium uppercase tracking-[0.04em] text-[var(--color-ink-500)] mb-1">Received by</span>
                <input type="text" value={podReceivedBy} onChange={(e) => podReceivedByChange(e.target.value)} placeholder="name of recipient" className="h-7 w-full px-2 text-[12.5px] text-[var(--color-ink-900)] bg-white border border-[var(--color-border-strong)] rounded-[3px]" />
              </label>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={onClosePod} className="h-7 px-2.5 text-[12px] text-[var(--color-ink-700)]">Cancel</button>
                <button type="button" onClick={onSubmitPod} disabled={pending !== null} className="h-7 px-3 rounded-[3px] text-[12px] font-medium text-white disabled:opacity-50" style={{ background: "var(--color-navy-700)" }}>
                  {pending === "Record proof of delivery" ? "Recording..." : "Record"}
                </button>
              </div>
            </div>
          )}
        </DeliveryStep>

        <DeliveryStep
          label="Close"
          active={so.status === "DELIVERED"}
          done={so.status === "CLOSED"}
          actionLabel="Close order"
          onAction={onClose}
          pending={pending === "Close sales order"}
        />
      </div>
    </section>
  );
}

function DeliveryStep({
  label,
  active,
  done,
  actionLabel,
  onAction,
  pending,
  disabled,
  disabledHint,
  expanded,
  children,
}: {
  label: string;
  active: boolean;
  done: boolean;
  actionLabel: string;
  onAction: () => void;
  pending: boolean;
  disabled?: boolean;
  disabledHint?: string;
  expanded?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <>
      <span className="text-[12px] font-medium text-[var(--color-ink-500)] pt-1">{label}</span>
      <div>
        <div className="flex items-center gap-2">
          {done ? (
            <span className="inline-flex items-center h-5 px-1.5 rounded-[2px] text-[10.5px] font-semibold text-white" style={{ background: "var(--color-success-700)" }}>done</span>
          ) : active ? (
            <button
              type="button"
              onClick={onAction}
              disabled={pending || disabled || expanded}
              title={disabled ? disabledHint : undefined}
              className="h-7 px-2.5 rounded-[3px] text-[12px] font-medium text-white disabled:opacity-50"
              style={{ background: "var(--color-navy-700)" }}
            >
              {pending ? "..." : actionLabel}
            </button>
          ) : (
            <span className="text-[11px] text-[var(--color-ink-400)]">(not yet reachable)</span>
          )}
        </div>
        {expanded && children}
      </div>
    </>
  );
}

function NotFoundCard({ id }: { id: string }) {
  return (
    <div className="max-w-[640px] mx-auto py-12">
      <div className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-6 py-8 text-center">
        <h1 className="text-[18px] font-semibold m-0 mb-2">Sales order not found</h1>
        <p className="text-[13px] text-[var(--color-ink-700)] m-0 mb-1">
          No sales order matches <span className="font-mono text-[var(--color-navy-700)]">{id}</span>.
        </p>
        <Link href="/sales/sales-orders" className="mt-5 inline-flex items-center h-8 px-3 rounded-[3px] text-[12.5px] font-medium text-white" style={{ background: "var(--color-navy-700)" }}>
          Back to Sales Orders
        </Link>
      </div>
    </div>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th className={`font-medium text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] px-3.5 py-2.5 border-b border-[var(--color-border-default)] bg-[var(--color-ink-100)] whitespace-nowrap ${align === "right" ? "text-right" : "text-left"}`}>
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3.5 py-2.5 align-middle text-[var(--color-ink-900)] whitespace-nowrap">{children}</td>;
}

function NumTd({ children, mono, strong }: { children: React.ReactNode; mono?: boolean; strong?: boolean }) {
  return (
    <td className={`px-3.5 py-2.5 text-right tabular-nums whitespace-nowrap text-[var(--color-ink-900)] ${mono ? "font-mono text-[12px]" : ""} ${strong ? "font-semibold" : ""}`}>
      {children}
    </td>
  );
}
