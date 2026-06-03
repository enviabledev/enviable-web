"use client";

/**
 * Proforma invoice detail at /procurement/proforma-invoices/[id]. Reads
 * the PI from the mirror (joined to PO + supplier + product variants on
 * the lines), then revalidates from /api/proforma-invoices/:id. Actions
 * for users with pi.review: Approve (atomic supersede per I-5) and Reject.
 *
 * Meta-disciplines applied (proactively, not retroactively):
 *
 *   - Empty-id guard (seventh): the useEffect bails when id is "" so the
 *     first-render empty-string pass does not hit /api/proforma-invoices/
 *     and try to render the LIST response as a detail object.
 *
 *   - Relation-read audit (eighth): every X.Y dotted access in the render
 *     reads a field reconstructed in loadFromMirror or guarded with an
 *     optional chain. No `pi.purchaseOrder.poNumber` on a raw mirror row
 *     that lacks the join.
 *
 *   - Field-access audit: each rendered field is either flat on the
 *     mirrored row or assembled in the loadFromMirror reconstruction
 *     with an explicit fallback.
 *
 * Conflict handling: I-5 atomic supersede via the partial unique index
 * 'one_active_pi_per_po'. A concurrent approve from another reviewer
 * returns 409 ConflictException; surface verbatim with a "Reload to see
 * the updated state" affordance.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import FreshnessBadge from "@/components/sync/FreshnessBadge";
import OfflineNotice from "@/components/sync/OfflineNotice";
import {
  approveProformaInvoice,
  getProformaInvoice,
  rejectProformaInvoice,
  type ProformaInvoice,
  type ProformaInvoiceStatus,
} from "@/lib/api";
import { isTransientFailure } from "@/lib/api/client";
import { usePermissions } from "@/lib/auth";
import { useConnectivity } from "@/lib/sync/connectivity";
import { formatDateTime, formatNGN } from "@/lib/format";
import { getById, listByType } from "@/lib/sync/mirror/store";
import { useUrlLastSegment } from "@/lib/sync/use-url-segment";

type MirroredPi = Omit<ProformaInvoice, "lines" | "purchaseOrder">;
type MirroredPiLine = {
  id: string;
  proformaInvoiceId: string;
  productVariantId: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  updatedAt: string;
};
type MirroredPo = { id: string; poNumber: string; supplierId: string; status: string };
type MirroredCounterparty = { id: string; name: string };
type MirroredVariant = {
  id: string;
  supplierSkuCode: string;
  variantAttributes?: { model?: string; colour?: string; [k: string]: string | undefined };
};
type MirroredUser = { id: string; fullName: string };

type Reconstructed = {
  pi: ProformaInvoice;
  supplierName: string;
  approverName: string | null;
  variantById: Map<string, MirroredVariant>;
};

const STATUS_LABEL: Record<ProformaInvoiceStatus, string> = {
  PENDING_REVIEW: "Pending review",
  ACTIVE: "Active",
  SUPERSEDED: "Superseded",
  REJECTED: "Rejected",
};

const STATUS_TONE: Record<ProformaInvoiceStatus, { bg: string; fg: string; dot: string }> = {
  PENDING_REVIEW: {
    bg: "bg-[var(--color-warning-50)]",
    fg: "text-[var(--color-warning-700)]",
    dot: "bg-[var(--color-warning-700)]",
  },
  ACTIVE: {
    bg: "bg-[var(--color-success-100)]",
    fg: "text-[var(--color-success-700)]",
    dot: "bg-[var(--color-success-700)]",
  },
  SUPERSEDED: {
    bg: "bg-[var(--color-ink-100)]",
    fg: "text-[var(--color-ink-700)]",
    dot: "bg-[var(--color-ink-500)]",
  },
  REJECTED: {
    bg: "bg-[var(--color-danger-50)]",
    fg: "text-[var(--color-danger-700)]",
    dot: "bg-[var(--color-danger-700)]",
  },
};

function variantLabel(v: MirroredVariant | undefined, fallback: string): string {
  if (!v) return fallback;
  const attrs = v.variantAttributes ?? {};
  return [attrs.model, attrs.colour].filter(Boolean).join(" ") || v.supplierSkuCode;
}

export default function ProformaInvoiceDetailPage() {
  const router = useRouter();
  const { has } = usePermissions();
  const { state: connState } = useConnectivity();
  const id = useUrlLastSegment();

  const canRead = has("pi.read");
  const canReview = has("pi.review");

  const [data, setData] = useState<Reconstructed | null>(null);
  const [fromMirror, setFromMirror] = useState(false);
  const [offline, setOffline] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [reloadTick, setReloadTick] = useState(0);
  const [action, setAction] = useState<
    | { status: "idle" }
    | { status: "confirming"; kind: "approve" | "reject" }
    | { status: "submitting"; kind: "approve" | "reject" }
    | { status: "success"; kind: "approve" | "reject" }
    | { status: "conflict"; message: string }
    | { status: "error"; message: string }
  >({ status: "idle" });

  useEffect(() => {
    if (!canRead || !id) return;
    const ctrl = new AbortController();
    setOffline(false);
    setNotFound(false);

    let mirrorPainted = false;
    (async () => {
      try {
        const [piRow, lineRows, poRows, supplierRows, variantRows, userRows] = await Promise.all([
          getById<MirroredPi>("proformaInvoice", id),
          listByType<MirroredPiLine>("proformaInvoiceLine"),
          listByType<MirroredPo>("purchaseOrder"),
          listByType<MirroredCounterparty>("counterparty"),
          listByType<MirroredVariant>("productVariant"),
          listByType<MirroredUser>("user"),
        ]);
        if (ctrl.signal.aborted || !piRow) return;
        const pi = piRow.body;
        const poById = new Map(poRows.map((p) => [p.body.id, p.body]));
        const supById = new Map(supplierRows.map((s) => [s.body.id, s.body]));
        const variantById = new Map(variantRows.map((v) => [v.body.id, v.body]));
        const userById = new Map(userRows.map((u) => [u.body.id, u.body]));
        const po = poById.get(pi.purchaseOrderId);
        const sup = po ? supById.get(po.supplierId) : undefined;
        const lines = lineRows
          .map((l) => l.body)
          .filter((l) => l.proformaInvoiceId === pi.id)
          .sort((a, b) => a.id.localeCompare(b.id));
        const reconstructed: ProformaInvoice = {
          ...pi,
          lines,
          purchaseOrder: po
            ? {
                id: po.id,
                poNumber: po.poNumber,
                status: po.status,
                supplierId: po.supplierId,
              }
            : {
                id: pi.purchaseOrderId,
                poNumber: pi.purchaseOrderId,
                status: "",
                supplierId: "",
              },
        };
        mirrorPainted = true;
        setData({
          pi: reconstructed,
          supplierName: sup?.name ?? "(supplier unavailable)",
          approverName: pi.approvedById ? userById.get(pi.approvedById)?.fullName ?? null : null,
          variantById,
        });
        setFromMirror(true);
      } catch {
        // network drives
      }
    })();

    getProformaInvoice(id, ctrl.signal).then(async (r) => {
      if (ctrl.signal.aborted) return;
      if (r.kind === "ok") {
        const variantRows = await listByType<MirroredVariant>("productVariant");
        const userRows = await listByType<MirroredUser>("user");
        const supplierRows = await listByType<MirroredCounterparty>("counterparty");
        if (ctrl.signal.aborted) return;
        const variantById = new Map(variantRows.map((v) => [v.body.id, v.body]));
        const userById = new Map(userRows.map((u) => [u.body.id, u.body]));
        const supById = new Map(supplierRows.map((s) => [s.body.id, s.body]));
        setData({
          pi: r.data,
          supplierName: supById.get(r.data.purchaseOrder.supplierId)?.name ?? "(supplier unavailable)",
          approverName: r.data.approvedById ? userById.get(r.data.approvedById)?.fullName ?? null : null,
          variantById,
        });
        setFromMirror(false);
        setErrMsg("");
      } else if (r.kind === "unauthorized") {
        router.replace("/login");
      } else if (r.kind === "forbidden") {
        setErrMsg("You do not have access to view this proforma invoice.");
      } else if (r.kind === "not_found") {
        if (!mirrorPainted) setNotFound(true);
      } else if (isTransientFailure(r)) {
        if (!mirrorPainted) setOffline(true);
      } else if ("message" in r) {
        setErrMsg(typeof r.message === "string" ? r.message : r.message.join("; "));
      }
    });

    return () => ctrl.abort();
  }, [canRead, id, router, reloadTick]);

  const runAction = async (kind: "approve" | "reject") => {
    if (action.status === "submitting") return;
    setAction({ status: "submitting", kind });
    const fn = kind === "approve" ? approveProformaInvoice : rejectProformaInvoice;
    const r = await fn(id);
    if (r.kind === "ok") {
      setAction({ status: "success", kind });
      setReloadTick((n) => n + 1);
    } else if (r.kind === "conflict") {
      setAction({
        status: "conflict",
        message:
          r.message ||
          "Another reviewer approved a different PI for the same PO while this form was open. The active PI for this PO has changed; reload to see the updated state.",
      });
    } else if (r.kind === "forbidden") {
      setAction({ status: "error", message: "You do not have permission to review proforma invoices (requires pi.review)." });
    } else if (r.kind === "validation") {
      setAction({
        status: "error",
        message: typeof r.message === "string" ? r.message : r.message.join("; "),
      });
    } else if (r.kind === "network_error") {
      setAction({ status: "error", message: "Network error reaching the backend. PI review requires a live connection; try again." });
    } else {
      setAction({ status: "error", message: "Unexpected response from the server." });
    }
  };

  if (!canRead) {
    return (
      <div className="max-w-[1080px] mx-auto py-10 text-center text-[var(--color-ink-500)]">
        You do not have access to proforma invoices (requires pi.read).
      </div>
    );
  }
  if (errMsg) {
    return (
      <div className="max-w-[820px] mx-auto py-10">
        <div className="px-3.5 py-2.5 rounded-[3px] bg-[var(--color-danger-100)] text-[var(--color-danger-700)] text-[12.5px]">
          {errMsg}
        </div>
      </div>
    );
  }
  if (notFound) {
    return (
      <div className="max-w-[640px] mx-auto py-12">
        <div className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-6 py-8 text-center">
          <h1 className="text-[18px] font-semibold text-[var(--color-ink-900)] m-0 mb-2">Proforma invoice not found</h1>
          <p className="text-[13px] text-[var(--color-ink-700)] m-0 mb-3">
            No PI matches <span className="font-mono text-[var(--color-navy-700)]">{id}</span>.
          </p>
          <Link
            href="/procurement/proforma-invoices"
            className="inline-flex items-center h-8 px-3 rounded-[3px] text-[12.5px] font-medium text-white"
            style={{ background: "var(--color-navy-700)" }}
          >
            Back to proforma invoices
          </Link>
        </div>
      </div>
    );
  }
  if (!data && offline) {
    return (
      <div className="max-w-[820px] mx-auto pb-10">
        <OfflineNotice body="This proforma invoice will load once you are back online. PIs already cached appear from the local mirror." />
      </div>
    );
  }
  if (!data) {
    return <div className="max-w-[1080px] mx-auto py-10 text-center text-[var(--color-ink-500)]">Loading proforma invoice...</div>;
  }

  const pi = data.pi;
  const goodsTotal =
    Number(pi.totalValue) - Number(pi.freightAmount) - Number(pi.insuranceAmount);
  const isActionable = pi.status === "PENDING_REVIEW" && canReview;

  return (
    <div className="max-w-[1080px] mx-auto pb-10">
      <header className="pb-4 mb-5 border-b border-[var(--color-border-default)]">
        <div className="text-[12px] text-[var(--color-ink-500)] flex items-center gap-1.5 mb-1.5 flex-wrap">
          <Link href="/procurement/proforma-invoices" className="text-[var(--color-ink-500)] hover:text-[var(--color-navy-700)]">
            Procurement
          </Link>
          <span className="text-[var(--color-ink-300)]">/</span>
          <Link href="/procurement/proforma-invoices" className="text-[var(--color-ink-500)] hover:text-[var(--color-navy-700)]">
            Proforma invoices
          </Link>
          <span className="text-[var(--color-ink-300)]">/</span>
          <span className="text-[var(--color-ink-900)] font-medium font-mono">{pi.piNumber}</span>
        </div>
        <div className="flex items-center gap-3 flex-wrap mb-1">
          <h1 className="text-[22px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em] font-mono">
            {pi.piNumber}
          </h1>
          <span className="text-[12px] text-[var(--color-ink-500)] font-medium">
            Revision {pi.revisionNumber}
          </span>
          <StatusPill status={pi.status} />
          {fromMirror && <FreshnessBadge />}
        </div>
        <div className="text-[12.5px] text-[var(--color-ink-500)] mt-1 flex items-center gap-3 flex-wrap">
          <span>
            Supplier: <span className="text-[var(--color-ink-900)] font-medium">{data.supplierName}</span>
          </span>
          <span className="text-[var(--color-ink-300)]">·</span>
          <span>
            PO:{" "}
            <Link
              href={`/procurement/purchase-orders/${pi.purchaseOrder.id}`}
              className="text-[var(--color-navy-700)] hover:underline font-mono"
            >
              {pi.purchaseOrder.poNumber}
            </Link>
          </span>
        </div>
      </header>

      {isActionable && (
        <ActionBar
          action={action}
          connState={connState}
          onConfirm={(kind) => setAction({ status: "confirming", kind })}
          onCancel={() => setAction({ status: "idle" })}
          onRun={runAction}
        />
      )}

      <PiTotalsCard pi={pi} goodsTotal={goodsTotal} />
      <PiLinesCard pi={pi} variantById={data.variantById} />
      <PiMetaCard pi={pi} approverName={data.approverName} />
    </div>
  );
}

function ActionBar({
  action,
  connState,
  onConfirm,
  onCancel,
  onRun,
}: {
  action:
    | { status: "idle" }
    | { status: "confirming"; kind: "approve" | "reject" }
    | { status: "submitting"; kind: "approve" | "reject" }
    | { status: "success"; kind: "approve" | "reject" }
    | { status: "conflict"; message: string }
    | { status: "error"; message: string };
  connState: "online" | "offline" | "unknown";
  onConfirm: (kind: "approve" | "reject") => void;
  onCancel: () => void;
  onRun: (kind: "approve" | "reject") => void;
}) {
  const disabled = connState === "offline" || action.status === "submitting";
  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] mb-5">
      <header className="px-5 py-3 border-b border-[var(--color-border-default)] flex items-center justify-between">
        <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">Review</h2>
        <span className="text-[11px] text-[var(--color-ink-500)]">
          Online-only. Approving atomically supersedes any prior active PI for this PO (I-5).
        </span>
      </header>
      {action.status === "idle" && (
        <div className="px-5 py-4 flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => onConfirm("approve")}
            disabled={disabled}
            data-testid="approve-button"
            className="h-[32px] px-4 rounded-[3px] bg-[var(--color-success-700)] text-white text-[12.5px] font-medium disabled:opacity-50"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() => onConfirm("reject")}
            disabled={disabled}
            data-testid="reject-button"
            className="h-[32px] px-4 rounded-[3px] border border-[var(--color-danger-700)] bg-white text-[var(--color-danger-700)] text-[12.5px] font-medium disabled:opacity-50"
          >
            Reject
          </button>
          {connState === "offline" && (
            <span className="text-[11.5px] text-[var(--color-warning-700)] ml-2">
              Disabled offline. Reconnect to review.
            </span>
          )}
        </div>
      )}
      {action.status === "confirming" && (
        <div
          role="dialog"
          className="mx-5 my-4 px-4 py-3 rounded-[4px] border-2"
          style={{
            background:
              action.kind === "approve"
                ? "var(--color-success-50)"
                : "var(--color-danger-50)",
            borderColor:
              action.kind === "approve"
                ? "var(--color-success-700)"
                : "var(--color-danger-700)",
          }}
        >
          <div
            className="text-[13px] font-semibold mb-1"
            style={{
              color:
                action.kind === "approve"
                  ? "var(--color-success-700)"
                  : "var(--color-danger-700)",
            }}
          >
            {action.kind === "approve" ? "Approve this proforma invoice?" : "Reject this proforma invoice?"}
          </div>
          <div className="text-[12.5px] text-[var(--color-ink-900)] mb-3">
            {action.kind === "approve" ? (
              <>
                The PI pivots to <span className="font-semibold">ACTIVE</span>; any prior active PI on the
                same PO is atomically marked <span className="font-semibold">SUPERSEDED</span> (I-5
                enforced server-side).
              </>
            ) : (
              <>
                The PI is marked <span className="font-semibold">REJECTED</span>. It will not become
                active and the PO remains gated until a new PI is submitted and approved.
              </>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onRun(action.kind)}
              data-testid={`${action.kind}-confirm`}
              className="h-[32px] px-4 rounded-[3px] text-white text-[12.5px] font-medium inline-flex items-center"
              style={{
                background:
                  action.kind === "approve"
                    ? "var(--color-success-700)"
                    : "var(--color-danger-700)",
              }}
            >
              Confirm {action.kind === "approve" ? "approval" : "rejection"}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="h-[32px] px-3 rounded-[3px] border border-[var(--color-border-strong)] bg-white text-[var(--color-ink-900)] text-[12.5px] font-medium hover:bg-[var(--color-ink-100)]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {action.status === "submitting" && (
        <div className="px-5 py-4 text-[12.5px] text-[var(--color-ink-700)]">
          {action.kind === "approve" ? "Approving..." : "Rejecting..."}
        </div>
      )}
      {action.status === "success" && (
        <div
          role="status"
          data-testid="action-success"
          className="mx-5 my-4 px-3.5 py-2.5 rounded-[3px] border border-[var(--color-success-700)] bg-[var(--color-success-50)] text-[12.5px] text-[var(--color-success-700)]"
        >
          PI {action.kind === "approve" ? "approved" : "rejected"}. The page has refreshed to show the new
          status.
        </div>
      )}
      {action.status === "conflict" && (
        <div
          role="alert"
          data-testid="action-conflict"
          className="mx-5 my-4 px-3.5 py-2.5 rounded-[3px] border border-[var(--color-warning-700)] bg-[var(--color-warning-50)] text-[12.5px] text-[var(--color-warning-700)]"
        >
          <div className="font-semibold mb-0.5">Concurrent review detected</div>
          <div className="text-[var(--color-ink-700)]">{action.message}</div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-2 h-[26px] px-3 rounded-[3px] bg-white border border-[var(--color-warning-700)] text-[var(--color-warning-700)] text-[11.5px] font-medium"
          >
            Reload to see the updated state
          </button>
        </div>
      )}
      {action.status === "error" && (
        <div
          role="alert"
          className="mx-5 my-4 px-3.5 py-2.5 rounded-[3px] border border-[var(--color-danger-100)] bg-[var(--color-danger-50)] text-[12.5px] text-[var(--color-danger-700)]"
        >
          {action.message}
        </div>
      )}
    </section>
  );
}

function PiTotalsCard({ pi, goodsTotal }: { pi: ProformaInvoice; goodsTotal: number }) {
  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] mb-5">
      <header className="px-5 py-3 border-b border-[var(--color-border-default)]">
        <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">CIF totals</h2>
      </header>
      <div className="px-5 py-4 grid grid-cols-4 gap-6">
        <div>
          <div className="text-[10.5px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] mb-1">Goods</div>
          <div className="text-[16px] font-semibold text-[var(--color-ink-900)] font-mono">
            {formatNGN(String(goodsTotal))}
          </div>
        </div>
        <div>
          <div className="text-[10.5px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] mb-1">Freight</div>
          <div className="text-[16px] font-semibold text-[var(--color-ink-900)] font-mono">
            {formatNGN(pi.freightAmount)}
          </div>
        </div>
        <div>
          <div className="text-[10.5px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] mb-1">Insurance</div>
          <div className="text-[16px] font-semibold text-[var(--color-ink-900)] font-mono">
            {formatNGN(pi.insuranceAmount)}
          </div>
        </div>
        <div>
          <div className="text-[10.5px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] mb-1">Total (CIF)</div>
          <div className="text-[20px] font-semibold text-[var(--color-ink-900)] font-mono tracking-[-0.01em]">
            {formatNGN(pi.totalValue)}
          </div>
        </div>
      </div>
    </section>
  );
}

function PiLinesCard({
  pi,
  variantById,
}: {
  pi: ProformaInvoice;
  variantById: Map<string, MirroredVariant>;
}) {
  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] mb-5">
      <header className="px-5 py-3 border-b border-[var(--color-border-default)] flex items-center justify-between">
        <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">Line items</h2>
        <span className="text-[11px] text-[var(--color-ink-500)]">{pi.lines.length} lines</span>
      </header>
      {pi.lines.length === 0 ? (
        <div className="px-5 py-8 text-center text-[12.5px] text-[var(--color-ink-500)]">
          No line items on this proforma invoice.
        </div>
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr>
              <Th>Variant</Th>
              <Th>SKU</Th>
              <Th align="right">Quantity</Th>
              <Th align="right">Unit price</Th>
              <Th align="right">Line total</Th>
            </tr>
          </thead>
          <tbody>
            {pi.lines.map((l, i) => {
              const v = variantById.get(l.productVariantId);
              return (
                <tr
                  key={l.id}
                  className={`${i % 2 ? "bg-[#FBFBFC]" : "bg-white"} border-b border-[var(--color-border-default)] last:border-b-0`}
                >
                  <Td>{variantLabel(v, l.productVariantId)}</Td>
                  <Td mono>
                    {v?.supplierSkuCode ?? (
                      <span className="text-[var(--color-ink-400)] text-[11.5px]">{l.productVariantId}</span>
                    )}
                  </Td>
                  <Td align="right" mono>
                    {l.quantity.toLocaleString()}
                  </Td>
                  <Td align="right" mono>
                    {formatNGN(l.unitPrice)}
                  </Td>
                  <Td align="right" mono>
                    <span className="font-semibold">{formatNGN(l.lineTotal)}</span>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function PiMetaCard({
  pi,
  approverName,
}: {
  pi: ProformaInvoice;
  approverName: string | null;
}) {
  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px]">
      <header className="px-5 py-3 border-b border-[var(--color-border-default)] flex items-center justify-between">
        <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">Metadata</h2>
        <span className="text-[11px] text-[var(--color-ink-500)] font-mono">{pi.id}</span>
      </header>
      <dl className="text-[12.5px] grid grid-cols-2 gap-x-12 px-5 py-3">
        <Row label="Issue date">
          {pi.issueDate ? formatDateTime(pi.issueDate) : <span className="text-[var(--color-ink-400)]">--</span>}
        </Row>
        <Row label="Validity until">
          {pi.validityUntil ? (
            formatDateTime(pi.validityUntil)
          ) : (
            <span className="text-[var(--color-ink-400)]">--</span>
          )}
        </Row>
        <Row label="Payment terms">
          {pi.paymentTerms ?? <span className="text-[var(--color-ink-400)]">--</span>}
        </Row>
        <Row label="Port of loading">
          {pi.portOfLoading ?? <span className="text-[var(--color-ink-400)]">--</span>}
        </Row>
        <Row label="Port of discharge">
          {pi.portOfDischarge ?? <span className="text-[var(--color-ink-400)]">--</span>}
        </Row>
        <Row label="Approved by">
          {approverName ?? <span className="text-[var(--color-ink-400)]">--</span>}
        </Row>
        <Row label="Approved at">
          {pi.approvedAt ? formatDateTime(pi.approvedAt) : <span className="text-[var(--color-ink-400)]">--</span>}
        </Row>
        <Row label="Created at">{formatDateTime(pi.createdAt)}</Row>
      </dl>
    </section>
  );
}

function StatusPill({ status }: { status: ProformaInvoiceStatus }) {
  const tone = STATUS_TONE[status];
  return (
    <span
      className={`inline-flex items-center gap-1 h-[20px] px-2 rounded-full text-[10.5px] font-semibold uppercase tracking-[0.02em] ${tone.bg} ${tone.fg}`}
    >
      <span className={`w-[5px] h-[5px] rounded-full flex-shrink-0 ${tone.dot}`} aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-3 items-baseline py-2 border-b border-dashed border-[var(--color-border-default)] last:border-b-0">
      <dt className="text-[12px] font-medium text-[var(--color-ink-500)]">{label}</dt>
      <dd className="m-0 text-[var(--color-ink-900)]">{children}</dd>
    </div>
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`text-${align} font-medium text-[10.5px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] px-3.5 py-2.5 border-b border-[var(--color-border-default)] bg-[var(--color-ink-100)]`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  mono = false,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  mono?: boolean;
}) {
  return (
    <td
      className={`px-3.5 py-2 text-[12.5px] text-[var(--color-ink-900)] whitespace-nowrap text-${align} ${
        mono ? "font-mono text-[12px] tracking-[0.02em]" : ""
      }`}
    >
      {children}
    </td>
  );
}
