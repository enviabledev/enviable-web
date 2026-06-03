"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import ShipmentStatusPill from "@/components/shipments/ShipmentStatusPill";
import FreshnessBadge from "@/components/sync/FreshnessBadge";
import OfflineNotice from "@/components/sync/OfflineNotice";
import {
  closeShipment,
  completeReceipt,
  flattenVariantOptions,
  getShipment,
  listProducts,
  resolveVariance,
  shipmentHasUnresolvedVariance,
  type ApiResult,
  type Counterparty,
  type ManifestLine,
  type ProductWithVariants,
  type ShipmentDetail,
  type ShipmentListRow,
  type ShipmentUnit,
} from "@/lib/api";
import { usePermissions } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { getById, listByType } from "@/lib/sync/mirror/store";
import { useUrlLastSegment } from "@/lib/sync/use-url-segment";

type LoadState =
  | { status: "loading" }
  | { status: "ok"; shipment: ShipmentDetail; fromMirror?: boolean }
  | { status: "not_found" }
  | { status: "forbidden" }
  | { status: "offline" }
  | { status: "error"; message: string };

// Mirror shapes used to reconstruct ShipmentDetail offline.
type MirroredShipment = Omit<ShipmentListRow, "manifestLines">;
type MirroredUnit = {
  id: string;
  engineNumber: string;
  status: string;
  landedCost?: string;
  shipmentId: string | null;
};

type ActionState =
  | { status: "idle" }
  | { status: "submitting"; action: "complete" | "close" | "resolve" }
  | { status: "conflict"; message: string }
  | { status: "error"; message: string };

export default function ShipmentDetailPage() {
  const router = useRouter();
  const { has } = usePermissions();
  // Read from window.location to handle the SW's sibling-URL fallback;
  // see src/lib/sync/use-url-segment.ts.
  const id = useUrlLastSegment();

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [action, setAction] = useState<ActionState>({ status: "idle" });
  const [products, setProducts] = useState<ProductWithVariants[]>([]);

  // Variance resolution form local state: manifestLineId -> draft reason.
  const [varianceDrafts, setVarianceDrafts] = useState<Record<string, string>>({});

  // Mirror-first paint. Phase 1 reconstructs ShipmentDetail from: shipment (by id)
  // + manifestLines (filtered) + units (filtered) + counterparty FKs. Phase 2
  // revalidates from getShipment.
  const mirrorPaintedRef = useRef(false);
  useEffect(() => {
    // Empty-id guard: useUrlLastSegment starts as "" until its mount-time
    // effect runs; without this skip, the network call hits /api/shipments/
    // (the LIST route) and the detail renderer crashes on the array.
    if (!id) return;
    const ctrl = new AbortController();
    mirrorPaintedRef.current = false;

    // Phase 1: mirror.
    (async () => {
      try {
        const [shipRow, manifestRows, unitRows] = await Promise.all([
          getById<MirroredShipment>("shipment", id),
          listByType<ManifestLine>("manifestLine"),
          listByType<MirroredUnit>("unit"),
        ]);
        if (ctrl.signal.aborted || !shipRow) return;
        const ship = shipRow.body;
        const [forwarder, clearing, insurance] = await Promise.all([
          ship.freightForwarderId
            ? getById<Counterparty>("counterparty", ship.freightForwarderId)
            : Promise.resolve(undefined),
          ship.clearingAgentId
            ? getById<Counterparty>("counterparty", ship.clearingAgentId)
            : Promise.resolve(undefined),
          ship.insuranceCompanyId
            ? getById<Counterparty>("counterparty", ship.insuranceCompanyId)
            : Promise.resolve(undefined),
        ]);
        if (ctrl.signal.aborted) return;
        const manifestLines = manifestRows
          .map((m) => m.body)
          .filter((m) => m.shipmentId === id);
        const units: ShipmentUnit[] = unitRows
          .map((u) => u.body)
          .filter((u) => u.shipmentId === id)
          .map((u) => ({
            id: u.id,
            engineNumber: u.engineNumber,
            status: u.status,
            landedCost: u.landedCost,
          }));
        const reconstructed: ShipmentDetail = {
          ...ship,
          manifestLines,
          freightForwarder: forwarder?.body
            ? { id: forwarder.body.id, name: forwarder.body.name, type: forwarder.body.type }
            : null,
          clearingAgent: clearing?.body
            ? { id: clearing.body.id, name: clearing.body.name, type: clearing.body.type }
            : null,
          insuranceCompany: insurance?.body
            ? { id: insurance.body.id, name: insurance.body.name, type: insurance.body.type }
            : null,
          units,
        };
        mirrorPaintedRef.current = true;
        setState((prev) =>
          prev.status === "ok" && !prev.fromMirror
            ? prev
            : { status: "ok", shipment: reconstructed, fromMirror: true },
        );
      } catch {
        // Let network drive.
      }
    })();

    // Phase 2: network revalidate.
    getShipment(id, ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      if (r.kind === "ok") setState({ status: "ok", shipment: r.data });
      else if (r.kind === "not_found") setState({ status: "not_found" });
      else if (r.kind === "unauthorized") router.replace("/login");
      else if (r.kind === "forbidden") setState({ status: "forbidden" });
      else if (r.kind === "network_error" || r.kind === "server_error") {
        if (!mirrorPaintedRef.current) setState({ status: "offline" });
      } else
        setState({ status: "error", message: "message" in r ? String(r.message) : "Error" });
    });

    // Products for variant labels: mirror-first, both phases best-effort.
    (async () => {
      try {
        const mirroredVariants = await listByType<{
          id: string;
          productId: string;
          supplierSkuCode: string;
          variantAttributes: Record<string, string | undefined>;
        }>("productVariant");
        if (ctrl.signal.aborted || mirroredVariants.length === 0) return;
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
    const m = new Map<string, ReturnType<typeof flattenVariantOptions>[number]>();
    for (const v of flattenVariantOptions(products)) m.set(v.productVariantId, v);
    return m;
  }, [products]);

  if (state.status === "loading") {
    return <div className="max-w-[1120px] mx-auto py-10 text-center text-[var(--color-ink-500)]">Loading shipment...</div>;
  }
  if (state.status === "offline") {
    return (
      <div className="max-w-[820px] mx-auto pb-10">
        <OfflineNotice body="This shipment's details will load when the connection returns. If you've already queued an offline receipt against this shipment, it will sync automatically; see Sync Conflicts if any need your attention." />
        <div className="text-center mt-3">
          <Link
            href="/procurement/shipments"
            className="text-[12px] text-[var(--color-navy-700)] hover:underline"
          >
            Back to Shipments
          </Link>
        </div>
      </div>
    );
  }
  if (state.status === "not_found") {
    return (
      <div className="max-w-[640px] mx-auto py-12">
        <div className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-6 py-8 text-center">
          <h1 className="text-[18px] font-semibold m-0 mb-2">Shipment not found</h1>
          <p className="text-[13px] text-[var(--color-ink-700)] m-0 mb-1">
            No shipment matches <span className="font-mono text-[var(--color-navy-700)]">{id}</span>.
          </p>
          <Link
            href="/procurement/shipments"
            className="mt-5 inline-flex items-center h-8 px-3 rounded-[3px] text-[12.5px] font-medium text-white"
            style={{ background: "var(--color-navy-700)" }}
          >
            Back to Shipments
          </Link>
        </div>
      </div>
    );
  }
  if (state.status === "forbidden") {
    return <div className="max-w-[1120px] mx-auto py-10 text-center text-[var(--color-ink-500)]">You do not have access to view this shipment.</div>;
  }
  if (state.status === "error") {
    return <div className="max-w-[1120px] mx-auto py-10 text-center text-[var(--color-danger-700)]">{state.message}</div>;
  }

  const shipment = state.shipment;
  const isFromMirror = state.fromMirror === true;
  const canReceive = has("shipment.receive");
  const canManage = has("shipment.manage");
  const hasUnresolved = shipmentHasUnresolvedVariance(shipment.manifestLines);

  const showReceiveAction = canReceive && shipment.status === "CLEARED";
  const showCompleteReceipt = canReceive && shipment.status === "CLEARED" && shipment.manifestLines.some((l) => l.quantityReceived > 0);
  const showClose = canManage && shipment.status === "RECEIVED";
  const closeDisabledReason = showClose && hasUnresolved ? "Resolve all variances before closing (I-7)." : null;

  const runAction = async (which: "complete" | "close", fn: () => Promise<ApiResult<ShipmentDetail>>) => {
    if (action.status === "submitting") return;
    setAction({ status: "submitting", action: which });
    const r = await fn();
    if (r.kind === "ok") {
      setState({ status: "ok", shipment: r.data });
      setAction({ status: "idle" });
    } else if (r.kind === "conflict") {
      setAction({ status: "conflict", message: r.message });
    } else if (r.kind === "forbidden") {
      setAction({ status: "error", message: "You do not have permission for this action." });
    } else if (r.kind === "validation") {
      setAction({ status: "error", message: typeof r.message === "string" ? r.message : r.message.join("; ") });
    } else if (r.kind === "network_error") {
      setAction({ status: "error", message: r.message });
    } else {
      setAction({ status: "error", message: "Unexpected response." });
    }
  };

  const submitVarianceResolution = async () => {
    const lines = Object.entries(varianceDrafts)
      .filter(([, reason]) => reason.trim().length > 0)
      .map(([manifestLineId, varianceReason]) => ({ manifestLineId, varianceReason: varianceReason.trim() }));
    if (lines.length === 0) return;
    setAction({ status: "submitting", action: "resolve" });
    const r = await resolveVariance(shipment.id, { lines });
    if (r.kind === "ok") {
      setState({ status: "ok", shipment: r.data });
      setAction({ status: "idle" });
      setVarianceDrafts({});
    } else if (r.kind === "conflict") {
      setAction({ status: "conflict", message: r.message });
    } else if (r.kind === "validation") {
      setAction({ status: "error", message: typeof r.message === "string" ? r.message : r.message.join("; ") });
    } else if (r.kind === "forbidden") {
      setAction({ status: "error", message: "You do not have permission to resolve variances." });
    } else if (r.kind === "network_error") {
      setAction({ status: "error", message: r.message });
    } else {
      setAction({ status: "error", message: "Unexpected response." });
    }
  };

  const variancedLines = shipment.manifestLines.filter(
    (l) => l.variance !== 0 && l.varianceResolvedAt === null,
  );

  return (
    <div className="max-w-[1120px] mx-auto pb-10">
      <header className="flex items-end justify-between gap-6 pb-4 mb-5 border-b border-[var(--color-border-default)]">
        <div>
          <div className="text-[12px] text-[var(--color-ink-500)] flex items-center gap-1.5 mb-1.5 flex-wrap">
            <Link href="/procurement/shipments" className="text-[var(--color-ink-500)] hover:text-[var(--color-navy-700)]">
              Procurement
            </Link>
            <span className="text-[var(--color-ink-300)]">/</span>
            <Link href="/procurement/shipments" className="text-[var(--color-ink-500)] hover:text-[var(--color-navy-700)]">
              Shipments
            </Link>
            <span className="text-[var(--color-ink-300)]">/</span>
            <span className="text-[var(--color-ink-900)] font-medium font-mono">{shipment.shipmentReference}</span>
          </div>
          <div className="flex items-center gap-3 flex-wrap mb-1">
            <h1 className="text-[24px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em]">
              <span className="font-mono">{shipment.shipmentReference}</span>
            </h1>
            <ShipmentStatusPill status={shipment.status} />
            {isFromMirror && <FreshnessBadge />}
          </div>
          <div className="text-[13px] text-[var(--color-ink-500)]">
            PO <span className="font-mono text-[var(--color-ink-700)]">{shipment.purchaseOrderId}</span>
            {shipment.vesselName && (
              <>
                <span className="mx-2 text-[var(--color-ink-300)]">|</span>
                Vessel: <span className="text-[var(--color-ink-900)] font-medium">{shipment.vesselName}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {showReceiveAction && (
            <Link
              href={`/procurement/shipments/${shipment.id}/receive`}
              className="h-8 px-3 rounded-[3px] text-[12.5px] font-medium text-white inline-flex items-center"
              style={{ background: "var(--color-navy-700)" }}
            >
              Receive Units
            </Link>
          )}
          {showCompleteReceipt && (
            <button
              type="button"
              onClick={() => runAction("complete", () => completeReceipt(shipment.id))}
              disabled={action.status === "submitting"}
              className="h-8 px-3 rounded-[3px] text-[12.5px] font-medium text-white disabled:opacity-50 inline-flex items-center"
              style={{ background: "var(--color-success-700)" }}
            >
              {action.status === "submitting" && action.action === "complete" ? "Completing..." : "Complete Receipt"}
            </button>
          )}
          {showClose && (
            <button
              type="button"
              onClick={() => runAction("close", () => closeShipment(shipment.id))}
              disabled={action.status === "submitting" || hasUnresolved}
              title={closeDisabledReason ?? undefined}
              className="h-8 px-3 rounded-[3px] text-[12.5px] font-medium text-white disabled:opacity-50 inline-flex items-center"
              style={{ background: hasUnresolved ? "var(--color-ink-400)" : "var(--color-navy-700)" }}
            >
              {action.status === "submitting" && action.action === "close" ? "Closing..." : "Close Shipment"}
            </button>
          )}
          {!showReceiveAction && !showCompleteReceipt && !showClose && (
            <span className="text-[11px] text-[var(--color-ink-500)]">
              No actions available
              {shipment.status === "CLEARED" && !canReceive && <span className="ml-1">(requires shipment.receive)</span>}
              {shipment.status === "RECEIVED" && !canManage && <span className="ml-1">(requires shipment.manage)</span>}
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

      <IdentityCard shipment={shipment} />

      <ManifestCard
        lines={shipment.manifestLines}
        variantsById={variantsById}
        unitCount={shipment.units.length}
      />

      {variancedLines.length > 0 && canReceive && shipment.status !== "CLOSED" && (
        <VarianceResolutionCard
          lines={variancedLines}
          variantsById={variantsById}
          drafts={varianceDrafts}
          onDraftChange={(id, v) => setVarianceDrafts((prev) => ({ ...prev, [id]: v }))}
          onSubmit={submitVarianceResolution}
          submitting={action.status === "submitting" && action.action === "resolve"}
        />
      )}

      {shipment.units.length > 0 && <UnitsReceivedCard units={shipment.units} />}
    </div>
  );
}

function IdentityCard({ shipment }: { shipment: ShipmentDetail }) {
  const rows: { label: string; value: React.ReactNode; mono?: boolean }[] = [
    { label: "Reference", value: shipment.shipmentReference, mono: true },
    { label: "Purchase Order", value: shipment.purchaseOrderId, mono: true },
    { label: "Status", value: <ShipmentStatusPill status={shipment.status} /> },
    { label: "Bill of Lading", value: shipment.billOfLadingNumber || <Muted>--</Muted>, mono: !!shipment.billOfLadingNumber },
    { label: "Vessel", value: shipment.vesselName || <Muted>--</Muted> },
    { label: "Freight Forwarder", value: shipment.freightForwarder ? `${shipment.freightForwarder.name}` : <Muted>--</Muted> },
    { label: "Clearing Agent", value: shipment.clearingAgent ? `${shipment.clearingAgent.name}` : <Muted>--</Muted> },
    { label: "Insurance", value: shipment.insuranceCompany ? `${shipment.insuranceCompany.name}` : <Muted>--</Muted> },
    { label: "ETD", value: shipment.etd ? formatDateTime(shipment.etd) : <Muted>--</Muted> },
    { label: "ETA", value: shipment.eta ? formatDateTime(shipment.eta) : <Muted>--</Muted> },
    { label: "Arrival", value: shipment.arrivalDate ? formatDateTime(shipment.arrivalDate) : <Muted>--</Muted> },
    { label: "Cleared", value: shipment.clearedAt ? formatDateTime(shipment.clearedAt) : <Muted>--</Muted> },
    { label: "Received", value: shipment.receivedAt ? formatDateTime(shipment.receivedAt) : <Muted>--</Muted> },
  ];
  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] mb-5">
      <header className="px-5 py-3 border-b border-[var(--color-border-default)] flex items-center justify-between">
        <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">Shipment identity</h2>
        <span className="text-mono-id text-[11px] text-[var(--color-ink-500)]">{shipment.id}</span>
      </header>
      <div className="px-5 py-3 grid grid-cols-2 gap-x-12 gap-y-1">
        {rows.map((r, i) => (
          <div
            key={i}
            className="grid grid-cols-[170px_1fr] gap-3 items-baseline py-2 border-b border-dashed border-[var(--color-border-default)] last:border-b-0 text-[13px]"
          >
            <span className="text-[12px] font-medium text-[var(--color-ink-500)]">{r.label}</span>
            <span
              className={`text-[var(--color-ink-900)] font-medium ${r.mono ? "font-mono text-[12.5px] tracking-[0.02em]" : ""}`}
            >
              {r.value}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ManifestCard({
  lines,
  variantsById,
  unitCount,
}: {
  lines: readonly ManifestLine[];
  variantsById: Map<string, ReturnType<typeof flattenVariantOptions>[number]>;
  unitCount: number;
}) {
  const totalDeclared = lines.reduce((s, l) => s + l.quantityDeclared, 0);
  const totalReceived = lines.reduce((s, l) => s + l.quantityReceived, 0);
  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] mb-5">
      <header className="px-5 py-3 border-b border-[var(--color-border-default)] flex items-center justify-between">
        <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">
          Manifest
          <span className="text-[11px] text-[var(--color-ink-500)] font-medium ml-2">
            {lines.length} lines &middot; {unitCount} units recorded
          </span>
        </h2>
      </header>
      <table className="w-full text-[13px]">
        <thead>
          <tr>
            <th className="text-left font-medium text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] px-3.5 py-2.5 border-b border-[var(--color-border-default)] bg-[var(--color-ink-100)]">Variant</th>
            <th className="text-right font-medium text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] px-3.5 py-2.5 border-b border-[var(--color-border-default)] bg-[var(--color-ink-100)] w-[120px]">Declared</th>
            <th className="text-right font-medium text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] px-3.5 py-2.5 border-b border-[var(--color-border-default)] bg-[var(--color-ink-100)] w-[120px]">Received</th>
            <th className="text-right font-medium text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] px-3.5 py-2.5 border-b border-[var(--color-border-default)] bg-[var(--color-ink-100)] w-[120px]">Variance</th>
            <th className="text-left font-medium text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] px-3.5 py-2.5 border-b border-[var(--color-border-default)] bg-[var(--color-ink-100)]">Variance Reason</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const v = variantsById.get(l.productVariantId);
            const varianceTone =
              l.variance === 0
                ? "text-[var(--color-ink-700)]"
                : l.varianceResolvedAt
                  ? "text-[var(--color-ink-700)]"
                  : "text-[var(--color-danger-700)]";
            return (
              <tr key={l.id} className={`${i % 2 ? "bg-[#FBFBFC]" : "bg-white"} border-b border-[var(--color-border-default)]`}>
                <td className="px-3.5 py-2.5 align-middle">
                  {v ? (
                    <>
                      <div className="font-medium text-[var(--color-ink-900)] text-[12.5px] leading-tight">
                        {v.productName} {[v.attributes.model, v.attributes.colour].filter(Boolean).join(" ")}
                      </div>
                      <div className="font-mono text-[10.5px] text-[var(--color-ink-500)] font-medium mt-0.5">
                        {v.label.match(/\[(.*)\]/)?.[1] ?? l.productVariantId}
                      </div>
                    </>
                  ) : (
                    <span className="font-mono text-[12px] text-[var(--color-ink-700)]">{l.productVariantId}</span>
                  )}
                </td>
                <td className="px-3.5 py-2.5 text-right tabular-nums font-mono text-[12px] text-[var(--color-ink-900)]">
                  {l.quantityDeclared}
                </td>
                <td className="px-3.5 py-2.5 text-right tabular-nums font-mono text-[12px] text-[var(--color-ink-900)] font-semibold">
                  {l.quantityReceived}
                </td>
                <td className={`px-3.5 py-2.5 text-right tabular-nums font-mono text-[12px] font-semibold ${varianceTone}`}>
                  {l.variance === 0 ? "0" : l.variance > 0 ? `+${l.variance}` : l.variance}
                  {l.varianceResolvedAt && (
                    <span className="ml-1 text-[10px] text-[var(--color-ink-500)] font-normal">resolved</span>
                  )}
                </td>
                <td className="px-3.5 py-2.5 text-[12px] text-[var(--color-ink-700)]">
                  {l.varianceReason || <Muted>--</Muted>}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bg-[var(--color-ink-100)]">
            <td className="px-3.5 py-2.5 text-right text-[12.5px] font-medium text-[var(--color-ink-700)]">Totals</td>
            <td className="px-3.5 py-2.5 text-right tabular-nums font-mono text-[12.5px] font-semibold text-[var(--color-ink-900)]">
              {totalDeclared}
            </td>
            <td className="px-3.5 py-2.5 text-right tabular-nums font-mono text-[12.5px] font-semibold text-[var(--color-navy-800)]">
              {totalReceived}
            </td>
            <td className="px-3.5 py-2.5 text-right tabular-nums font-mono text-[12.5px] font-semibold text-[var(--color-ink-700)]">
              {totalReceived - totalDeclared === 0 ? "0" : totalReceived - totalDeclared > 0 ? `+${totalReceived - totalDeclared}` : `${totalReceived - totalDeclared}`}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </section>
  );
}

function VarianceResolutionCard({
  lines,
  variantsById,
  drafts,
  onDraftChange,
  onSubmit,
  submitting,
}: {
  lines: readonly ManifestLine[];
  variantsById: Map<string, ReturnType<typeof flattenVariantOptions>[number]>;
  drafts: Record<string, string>;
  onDraftChange: (id: string, v: string) => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  const hasAnyDraft = Object.values(drafts).some((s) => s.trim().length > 0);
  return (
    <section className="bg-white border border-[var(--color-warning-100)] rounded-[4px] mb-5">
      <header className="px-5 py-3 border-b border-[var(--color-warning-100)] bg-[var(--color-warning-50)]">
        <h2 className="m-0 text-[13px] font-semibold text-[var(--color-warning-700)]">
          Resolve variances
          <span className="text-[11px] font-medium ml-2">
            {lines.length} unresolved
          </span>
        </h2>
        <p className="m-0 mt-1 text-[12px] text-[var(--color-ink-700)]">
          Capture a reason for each varianced line. Close is blocked while any variance is
          unresolved (Invariant I-7).
        </p>
      </header>
      <div className="px-5 py-3 space-y-3">
        {lines.map((l) => {
          const v = variantsById.get(l.productVariantId);
          return (
            <div key={l.id} className="flex items-start gap-3">
              <div className="w-[240px] flex-shrink-0">
                <div className="font-medium text-[12.5px] text-[var(--color-ink-900)]">
                  {v ? `${v.productName} ${[v.attributes.model, v.attributes.colour].filter(Boolean).join(" ")}` : l.productVariantId}
                </div>
                <div className="text-[11px] text-[var(--color-ink-500)] mt-0.5">
                  Declared {l.quantityDeclared} &middot; Received {l.quantityReceived} &middot;{" "}
                  <span className="text-[var(--color-danger-700)] font-semibold font-mono">
                    {l.variance > 0 ? `+${l.variance}` : l.variance}
                  </span>
                </div>
              </div>
              <textarea
                value={drafts[l.id] ?? ""}
                onChange={(e) => onDraftChange(l.id, e.target.value)}
                placeholder="Reason for variance (required to close)"
                rows={2}
                className="flex-1 px-2.5 py-1.5 text-[12.5px] text-[var(--color-ink-900)] bg-white border border-[var(--color-border-strong)] rounded-[3px] focus:outline-none focus:border-[var(--color-navy-700)] focus:shadow-[0_0_0_2px_rgba(31,78,121,0.14)]"
              />
            </div>
          );
        })}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onSubmit}
            disabled={!hasAnyDraft || submitting}
            className="h-8 px-3 rounded-[3px] text-[12.5px] font-medium text-white disabled:opacity-50 inline-flex items-center"
            style={{ background: "var(--color-navy-700)" }}
          >
            {submitting ? "Saving..." : "Resolve Variances"}
          </button>
        </div>
      </div>
    </section>
  );
}

function UnitsReceivedCard({ units }: { units: readonly { id: string; engineNumber: string; status: string }[] }) {
  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px]">
      <header className="px-5 py-3 border-b border-[var(--color-border-default)]">
        <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">
          Received units
          <span className="text-[11px] text-[var(--color-ink-500)] font-medium ml-2">{units.length} on this shipment</span>
        </h2>
      </header>
      <div className="px-4 py-3 flex flex-wrap gap-1.5">
        {units.map((u) => (
          <Link
            key={u.id}
            href={`/inventory/units/${encodeURIComponent(u.engineNumber)}`}
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-[3px] border border-[var(--color-border-strong)] bg-white hover:bg-[var(--color-navy-50)]"
          >
            <span className="font-mono text-[11.5px] text-[var(--color-navy-700)]">{u.engineNumber}</span>
            <span className="text-[10px] text-[var(--color-ink-500)]">{u.status}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-[var(--color-ink-400)]">{children}</span>;
}
