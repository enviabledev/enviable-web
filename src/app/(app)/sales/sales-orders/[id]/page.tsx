"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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
  parseI4Conflict,
  recordPayment,
  recordProofOfDelivery,
  rejectPayment,
  SEED_PAYMENT_METHODS,
  soIsEditable,
  submitSalesOrder,
  type ApiResult,
  type Customer,
  type Invoice,
  type Payment,
  type RecordPaymentBody,
  type SaleForm,
  type SalesOrderDetail,
  type SalesOrderLine,
  type SoStatus,
  type UnitStatus,
} from "@/lib/api";
import { isTransientFailure } from "@/lib/api/client";
import { usePermissions } from "@/lib/auth";
import { formatDateTime, formatNGN } from "@/lib/format";
import { getById, listByType } from "@/lib/sync/mirror/store";

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

const UNIT_PRICE_RE = /^\d+(\.\d{1,2})?$/;

export default function SalesOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { has } = usePermissions();
  const id = decodeURIComponent(params.id);

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [invoiceChecked, setInvoiceChecked] = useState(false);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [banner, setBanner] = useState<ActionBanner>({ kind: "idle" });
  const [pending, setPending] = useState<string | null>(null);

  // Form: record payment.
  const [showRecord, setShowRecord] = useState(false);
  const [recordAmount, setRecordAmount] = useState("");
  const [recordMethodId, setRecordMethodId] = useState(SEED_PAYMENT_METHODS[0]?.id ?? "");
  const [recordReference, setRecordReference] = useState("");
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
    else if (isTransientFailure(soR)) {
      // Reconstruct SalesOrderDetail offline from the mirror: SO + customer
      // (by customerId) + lines (filtered by salesOrderId, nesting variant
      // and unit summaries by FK). Invoice and payments come from their own
      // mirror buckets filtered by salesOrderId.
      try {
        const [soRow, lineRows, variantRows, unitRows, invRows, payRows] =
          await Promise.all([
            getById<MirroredSo>("salesOrder", id),
            listByType<MirroredSoLine>("salesOrderLine"),
            listByType<MirroredVariantForSo>("productVariant"),
            listByType<MirroredUnitForSo>("unit"),
            listByType<Invoice>("invoice"),
            listByType<Payment>("payment"),
          ]);
        if (!soRow) {
          setState({ status: "offline" });
          return;
        }
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
        setState({ status: "ok", so: reconstructed, fromMirror: true });
        // Surface invoice + payments from the mirror too.
        const matchingInvoice = invRows
          .map((i) => i.body)
          .find((i) => i.salesOrderId === id);
        setInvoice(matchingInvoice ?? null);
        setInvoiceChecked(true);
        setPayments(payRows.map((p) => p.body).filter((p) => p.salesOrderId === id));
        return;
      } catch {
        setState({ status: "offline" });
        return;
      }
    } else {
      setState({ status: "error", message: "message" in soR ? String(soR.message) : "Error" });
    }

    if (invR.kind === "ok") setInvoice(invR.data);
    else if (invR.kind === "not_found") setInvoice(null);
    setInvoiceChecked(true);

    if (payR.kind === "ok") setPayments(payR.data);
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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

  const submitRecord = async () => {
    setBanner({ kind: "idle" });
    if (!UNIT_PRICE_RE.test(recordAmount)) {
      setBanner({ kind: "error", message: "Amount must be a decimal with up to 2 places." });
      return;
    }
    if (!recordMethodId) {
      setBanner({ kind: "error", message: "Pick a payment method." });
      return;
    }
    setRecordSubmitting(true);
    const body: RecordPaymentBody = {
      paymentMethodId: recordMethodId,
      amount: recordAmount,
      ...(recordReference.trim() ? { referenceNumber: recordReference.trim() } : {}),
    };
    const r = await recordPayment(so.id, body);
    setRecordSubmitting(false);
    if (r.kind === "ok") {
      setShowRecord(false);
      setRecordAmount("");
      setRecordReference("");
      await refresh();
      setBanner({ kind: "info", message: `Payment of ${formatNGN(body.amount)} recorded (PENDING).` });
    } else if (r.kind === "validation") {
      setBanner({ kind: "error", message: typeof r.message === "string" ? r.message : r.message.join("; ") });
    } else if (r.kind === "forbidden") {
      setBanner({ kind: "error", message: "You do not have payment.record permission." });
    } else if (r.kind === "conflict") {
      setBanner({ kind: "conflict", message: r.message });
    } else if (r.kind === "network_error") {
      setBanner({ kind: "error", message: r.message });
    } else {
      setBanner({ kind: "error", message: "Unexpected response recording payment." });
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
        </div>
      </header>

      <BannerArea banner={banner} />

      <IdentityCard so={so} />
      <SoftReservationNotice so={so} />
      <LinesCard lines={so.lines} so={so} />

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
        onOpenRecord={() => setShowRecord(true)}
        onCloseRecord={() => setShowRecord(false)}
        recordAmount={recordAmount}
        onAmountChange={setRecordAmount}
        recordMethodId={recordMethodId}
        onMethodChange={setRecordMethodId}
        recordReference={recordReference}
        onReferenceChange={setRecordReference}
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

function IdentityCard({ so }: { so: SalesOrderDetail }) {
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
  ];
  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] mb-4">
      <header className="px-5 py-3 border-b border-[var(--color-border-default)] flex items-center justify-between">
        <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">Order identity</h2>
        <span className="text-mono-id text-[11px] text-[var(--color-ink-500)]">{so.id}</span>
      </header>
      <div className="px-5 py-3 grid grid-cols-2 gap-x-12 gap-y-1">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[160px_1fr] gap-3 items-baseline py-2 border-b border-dashed border-[var(--color-border-default)] last:border-b-0 text-[13px]">
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
      <header className="px-5 py-3 border-b border-[var(--color-border-default)] flex items-center justify-between">
        <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">Invoice</h2>
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
      </header>
      <div className="px-5 py-3">
        {!invoiceChecked ? (
          <div className="text-[12.5px] text-[var(--color-ink-500)]">Loading...</div>
        ) : invoice ? (
          <div className="grid grid-cols-[160px_1fr] gap-x-3 gap-y-2 text-[13px]">
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

function PaymentsCard({
  payments,
  so,
  canRecord,
  canConfirm,
  showRecord,
  onOpenRecord,
  onCloseRecord,
  recordAmount,
  onAmountChange,
  recordMethodId,
  onMethodChange,
  recordReference,
  onReferenceChange,
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
  recordAmount: string;
  onAmountChange: (v: string) => void;
  recordMethodId: string;
  onMethodChange: (v: string) => void;
  recordReference: string;
  onReferenceChange: (v: string) => void;
  recordSubmitting: boolean;
  onSubmitRecord: () => void;
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
        <div className="px-5 py-3 border-b border-[var(--color-border-default)] bg-[var(--color-navy-50)]">
          <h3 className="m-0 mb-2 text-[12.5px] font-semibold text-[var(--color-ink-900)]">Record payment (PENDING)</h3>
          <div className="grid grid-cols-3 gap-3 mb-2">
            <label className="block">
              <span className="block text-[10.5px] font-medium uppercase tracking-[0.04em] text-[var(--color-ink-500)] mb-1">Amount (NGN)</span>
              <input
                type="text"
                inputMode="decimal"
                value={recordAmount}
                onChange={(e) => onAmountChange(e.target.value)}
                placeholder="0.00"
                className="h-7 w-full px-2 text-[12.5px] tabular-nums font-mono text-right text-[var(--color-ink-900)] bg-white border border-[var(--color-border-strong)] rounded-[3px] focus:outline-none focus:border-[var(--color-navy-700)] focus:shadow-[0_0_0_2px_rgba(31,78,121,0.14)]"
              />
            </label>
            <label className="block">
              <span className="block text-[10.5px] font-medium uppercase tracking-[0.04em] text-[var(--color-ink-500)] mb-1">Method</span>
              <select
                value={recordMethodId}
                onChange={(e) => onMethodChange(e.target.value)}
                className="h-7 w-full px-2 text-[12.5px] text-[var(--color-ink-900)] bg-white border border-[var(--color-border-strong)] rounded-[3px] focus:outline-none focus:border-[var(--color-navy-700)] focus:shadow-[0_0_0_2px_rgba(31,78,121,0.14)]"
              >
                {SEED_PAYMENT_METHODS.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-[10.5px] font-medium uppercase tracking-[0.04em] text-[var(--color-ink-500)] mb-1">Reference</span>
              <input
                type="text"
                value={recordReference}
                onChange={(e) => onReferenceChange(e.target.value)}
                placeholder="optional"
                className="h-7 w-full px-2 text-[12.5px] text-[var(--color-ink-900)] bg-white border border-[var(--color-border-strong)] rounded-[3px] focus:outline-none focus:border-[var(--color-navy-700)] focus:shadow-[0_0_0_2px_rgba(31,78,121,0.14)]"
              />
            </label>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={onCloseRecord} className="h-7 px-2.5 text-[12px] text-[var(--color-ink-700)]">Cancel</button>
            <button
              type="button"
              onClick={onSubmitRecord}
              disabled={recordSubmitting}
              className="h-7 px-3 rounded-[3px] text-[12px] font-medium text-white disabled:opacity-50"
              style={{ background: "var(--color-navy-700)" }}
            >
              {recordSubmitting ? "Recording..." : "Record"}
            </button>
          </div>
        </div>
      )}

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
          {payments.map((p, i) => (
            <tr key={p.id} className={`${i % 2 ? "bg-[#FBFBFC]" : "bg-white"} border-b border-[var(--color-border-default)] last:border-b-0`}>
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
          ))}
        </tbody>
      </table>
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

      <div className="px-5 py-3 grid grid-cols-[180px_1fr] gap-x-4 gap-y-2 text-[13px]">
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
              <div className="grid grid-cols-2 gap-3 mb-2">
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
