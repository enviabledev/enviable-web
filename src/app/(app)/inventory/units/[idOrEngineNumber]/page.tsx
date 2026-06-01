"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import FreshnessBadge from "@/components/sync/FreshnessBadge";
import OfflineNotice from "@/components/sync/OfflineNotice";
import StatusPill from "@/components/units/StatusPill";
import {
  getUnit,
  type MovementType,
  type StockMovementEntry,
  type UnitDetail,
  type UnitStatus,
  type VariantAttributes,
} from "@/lib/api";
import { listByType } from "@/lib/sync/mirror/store";
import { useUrlLastSegment } from "@/lib/sync/use-url-segment";
import {
  formatDateShort,
  formatDateTime,
  formatMovementType,
  formatNGN,
  formatUnitStatus,
  formatVariantName,
  relativeTime,
  toneOfMaybeStatus,
} from "@/lib/units/format";

type LoadState =
  | { status: "loading" }
  | { status: "ok"; unit: UnitDetail; fromMirror?: boolean }
  | { status: "not_found" }
  | { status: "forbidden" }
  | { status: "offline" }
  | { status: "error"; message: string };

// Mirror shapes for unit-detail reconstruction.
type MirroredUnitFull = {
  id: string;
  engineNumber: string;
  chassisNumber: string;
  status: UnitStatus;
  createdAt: string;
  assembledAt: string | null;
  assembledById: string | null;
  soldAt: string | null;
  currentWarehouseId: string | null;
  landedCost?: string;
  productVariantId: string;
  shipmentId: string | null;
};
type MirroredVariantFull = {
  id: string;
  productId: string;
  supplierSkuCode: string;
  variantAttributes: VariantAttributes;
};
type MirroredShipmentForUnit = {
  id: string;
  shipmentReference: string;
  status: string;
  isHistoricalImport: boolean;
};
type MirroredWarehouse = {
  id: string;
  name: string;
};
type MirroredStockMovement = {
  id: string;
  unitId: string;
  movementType: string;
  fromState: string | null;
  toState: string | null;
  fromWarehouseId: string | null;
  toWarehouseId: string | null;
  referenceType: string | null;
  referenceId: string | null;
  actorId: string;
  occurredAt: string;
  notes: string | null;
};

export default function UnitDetailPage() {
  const router = useRouter();
  // Read from window.location, not useParams: when the SW serves a cached
  // sibling URL for an uncached detail (sibling-fallback for offline nav),
  // useParams returns the sibling's id from the RSC, not the URL bar's id.
  // See src/lib/sync/use-url-segment.ts for the rationale.
  const idOrEngineNumber = useUrlLastSegment();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  // Mirror-first paint, revalidate with network. Movements timeline
  // reconstruction follows in the next change (D); for now it stays empty
  // offline.
  const mirrorPaintedRef = useRef(false);
  useEffect(() => {
    const ctrl = new AbortController();
    mirrorPaintedRef.current = false;

    // Phase 1: reconstruct UnitDetail from the mirror. The page accepts
    // either an id or an engineNumber; match by either against the unit
    // bucket. Movement timeline reconstructs from the stockMovement bucket
    // filtered by unitId and joined to the user directory for actor names
    // (the backend mirrors a minimal user directory for offline staff
    // attribution).
    (async () => {
      try {
        const units = await listByType<MirroredUnitFull>("unit");
        if (ctrl.signal.aborted) return;
        const hit = units.find(
          (u) =>
            u.body.id === idOrEngineNumber ||
            u.body.engineNumber === idOrEngineNumber,
        );
        if (!hit) return;
        const u = hit.body;
        const [variant, shipment, warehouse, movementRows, userRows] =
          await Promise.all([
            listByType<MirroredVariantFull>("productVariant").then((vs) =>
              vs.map((v) => v.body).find((v) => v.id === u.productVariantId),
            ),
            u.shipmentId
              ? listByType<MirroredShipmentForUnit>("shipment").then((ss) =>
                  ss.map((s) => s.body).find((s) => s.id === u.shipmentId),
                )
              : Promise.resolve(undefined),
            u.currentWarehouseId
              ? listByType<MirroredWarehouse>("warehouse").then((ws) =>
                  ws.map((w) => w.body).find((w) => w.id === u.currentWarehouseId),
                )
              : Promise.resolve(undefined),
            listByType<MirroredStockMovement>("stockMovement"),
            listByType<{ id: string; fullName: string }>("user"),
          ]);
        if (ctrl.signal.aborted) return;
        // Field-access audit on the timeline: every field StockMovementEntry
        // exposes (id, movementType, fromState, toState, fromWarehouseId,
        // toWarehouseId, referenceType, referenceId, occurredAt, notes,
        // actor.{id, fullName}) is assigned explicitly here with a fallback,
        // so a mirror row with a missing actor or null FK can never crash.
        const userById = new Map(userRows.map((u) => [u.body.id, u.body.fullName]));
        const movements: StockMovementEntry[] = movementRows
          .map((m) => m.body)
          .filter((m) => m.unitId === u.id)
          .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
          .map((m) => ({
            id: m.id,
            movementType: m.movementType as MovementType,
            fromState: m.fromState ?? null,
            toState: m.toState ?? null,
            fromWarehouseId: m.fromWarehouseId ?? null,
            toWarehouseId: m.toWarehouseId ?? null,
            referenceType: (m.referenceType ?? null) as StockMovementEntry["referenceType"],
            referenceId: m.referenceId ?? null,
            occurredAt: m.occurredAt,
            notes: m.notes ?? null,
            actor: {
              id: m.actorId,
              fullName: userById.get(m.actorId) ?? m.actorId,
            },
          }));
        const reconstructed: UnitDetail = {
          id: u.id,
          engineNumber: u.engineNumber,
          chassisNumber: u.chassisNumber,
          status: u.status,
          createdAt: u.createdAt,
          assembledAt: u.assembledAt,
          soldAt: u.soldAt,
          currentWarehouseId: u.currentWarehouseId,
          landedCost: u.landedCost,
          productVariant: variant
            ? {
                id: variant.id,
                supplierSkuCode: variant.supplierSkuCode,
                variantAttributes: variant.variantAttributes,
                product: { id: variant.productId, name: variant.productId },
              }
            : {
                id: u.productVariantId,
                supplierSkuCode: u.productVariantId,
                variantAttributes: {},
                product: { id: "", name: "" },
              },
          shipment: shipment
            ? {
                id: shipment.id,
                shipmentReference: shipment.shipmentReference,
                status: shipment.status,
                isHistoricalImport: shipment.isHistoricalImport,
              }
            : null,
          currentWarehouse: warehouse
            ? { id: warehouse.id, name: warehouse.name }
            : null,
          movements,
        };
        mirrorPaintedRef.current = true;
        setState((prev) =>
          prev.status === "ok" && !prev.fromMirror
            ? prev
            : { status: "ok", unit: reconstructed, fromMirror: true },
        );
      } catch {
        // Let network drive.
      }
    })();

    // Phase 2: network revalidate.
    getUnit(idOrEngineNumber, ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      if (r.kind === "ok") setState({ status: "ok", unit: r.data });
      else if (r.kind === "not_found") setState({ status: "not_found" });
      else if (r.kind === "unauthorized") router.replace("/login");
      else if (r.kind === "forbidden") setState({ status: "forbidden" });
      else if (r.kind === "network_error" || r.kind === "server_error") {
        if (!mirrorPaintedRef.current) setState({ status: "offline" });
      } else
        setState({ status: "error", message: "message" in r ? String(r.message) : "Error" });
    });
    return () => ctrl.abort();
  }, [idOrEngineNumber, router]);

  if (state.status === "loading") {
    return (
      <div className="max-w-[1120px] mx-auto py-10 text-center text-[var(--color-ink-500)]">
        Loading unit...
      </div>
    );
  }
  if (state.status === "not_found") {
    return <NotFoundCard idOrEngineNumber={idOrEngineNumber} />;
  }
  if (state.status === "forbidden") {
    return (
      <div className="max-w-[1120px] mx-auto py-10 text-center text-[var(--color-ink-500)]">
        You do not have access to view this unit.
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="max-w-[1120px] mx-auto py-10 text-center text-[var(--color-danger-700)]">
        {state.message}
      </div>
    );
  }
  if (state.status === "offline") {
    return (
      <div className="max-w-[820px] mx-auto pb-10">
        <OfflineNotice body="This unit's details will load when the connection returns. If this unit was visited online before, it should be in the local mirror; otherwise come back online to load it." />
        <div className="text-center mt-3">
          <Link
            href="/inventory/units"
            className="text-[12px] text-[var(--color-navy-700)] hover:underline"
          >
            Back to Units
          </Link>
        </div>
      </div>
    );
  }

  const unit = state.unit;
  const isFromMirror = state.fromMirror === true;
  const variantFull = formatVariantName(unit.productVariant, unit.productVariant.product.name);

  return (
    <div className="max-w-[1120px] mx-auto pb-10">
      <header className="flex items-end justify-between gap-6 pb-4 mb-5 border-b border-[var(--color-border-default)]">
        <div>
          <div className="text-[12px] text-[var(--color-ink-500)] flex items-center gap-1.5 mb-1.5 flex-wrap">
            <Link href="/inventory/units" className="text-[var(--color-ink-500)] hover:text-[var(--color-navy-700)]">
              Inventory
            </Link>
            <span className="text-[var(--color-ink-300)]">/</span>
            <Link href="/inventory/units" className="text-[var(--color-ink-500)] hover:text-[var(--color-navy-700)]">
              Units
            </Link>
            <span className="text-[var(--color-ink-300)]">/</span>
            <span className="text-[var(--color-ink-900)] font-medium font-mono">{unit.engineNumber}</span>
          </div>
          <div className="flex items-center gap-3 flex-wrap mb-1">
            <h1 className="text-[24px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em]">
              <span className="font-mono">{unit.engineNumber}</span>
            </h1>
            <StatusPill status={unit.status} />
            {isFromMirror && <FreshnessBadge />}
          </div>
          <div className="text-[13px] text-[var(--color-ink-500)] flex items-center gap-2.5 flex-wrap">
            <span>{variantFull}</span>
            <span className="text-[var(--color-ink-300)]">|</span>
            <span>
              Chassis <span className="text-mono-id text-[var(--color-ink-700)]">{unit.chassisNumber}</span>
            </span>
          </div>
        </div>
      </header>

      <SummaryCard unit={unit} />
      <TimelineCard movements={unit.movements} currentStatus={unit.status} />
    </div>
  );
}

function SummaryCard({ unit }: { unit: UnitDetail }) {
  const kvs: { label: string; value: React.ReactNode; mono?: boolean }[] = [
    {
      label: "Variant",
      value: formatVariantName(unit.productVariant, unit.productVariant.product.name),
    },
    { label: "Engine Number", value: unit.engineNumber, mono: true },
    { label: "Chassis Number", value: unit.chassisNumber, mono: true },
    {
      label: "Current Status",
      value: (
        <span className="inline-flex items-center gap-2">
          <StatusPill status={unit.status} />
          <span className="text-[var(--color-ink-500)] text-[12px]">
            {formatUnitStatus(unit.status)}
          </span>
        </span>
      ),
    },
    {
      label: "Current Warehouse",
      value: unit.currentWarehouse ? unit.currentWarehouse.name : (
        <span className="text-[var(--color-ink-400)]">--</span>
      ),
    },
    {
      label: "Shipment",
      value: unit.shipment ? (
        <span>
          <span className="text-mono-id text-[var(--color-navy-700)]">{unit.shipment.shipmentReference}</span>
          <span className="ml-2 text-[11px] text-[var(--color-ink-500)]">{unit.shipment.status}</span>
        </span>
      ) : (
        <span className="text-[var(--color-ink-400)]">--</span>
      ),
    },
    {
      label: "Received",
      value: (
        <span>
          {formatDateShort(unit.createdAt)}
          <span className="block text-[11px] text-[var(--color-ink-500)] mt-px">
            {relativeTime(unit.createdAt)}
          </span>
        </span>
      ),
    },
  ];

  if (unit.landedCost !== undefined) {
    kvs.push({
      label: "Landed Cost",
      value: (
        <span className="font-semibold text-[14px] tabular-nums text-[var(--color-ink-900)]">
          {formatNGN(unit.landedCost)}
        </span>
      ),
    });
  }

  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] mb-6">
      <header className="px-5 py-3.5 border-b border-[var(--color-border-default)] flex items-center justify-between">
        <h2 className="m-0 text-[14px] font-semibold text-[var(--color-ink-900)] flex items-center gap-2.5">
          Unit identity
        </h2>
        <span className="text-mono-id text-[11px] text-[var(--color-ink-500)]">
          {unit.id}
        </span>
      </header>
      <div className="px-6 py-5 grid grid-cols-2 gap-x-16 gap-y-1">
        {kvs.map((kv, i) => (
          <div
            key={i}
            className="grid grid-cols-[160px_1fr] gap-4 items-baseline py-2.5 border-b border-dashed border-[var(--color-border-default)] last:border-b-0 text-[13px]"
          >
            <span className="text-[12px] font-medium text-[var(--color-ink-500)]">{kv.label}</span>
            <span
              className={`text-[var(--color-ink-900)] font-medium ${kv.mono ? "font-mono text-[13px] tracking-[0.02em]" : ""}`}
            >
              {kv.value}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function TimelineCard({
  movements,
  currentStatus,
}: {
  movements: readonly StockMovementEntry[];
  currentStatus: string;
}) {
  // Movements reconstruct from the stockMovement bucket offline, joined to
  // the user directory for actor names. The page-level FreshnessBadge already
  // signals "cached data"; no separate offline notice for the timeline.
  if (movements.length === 0) {
    return (
      <section className="bg-white border border-[var(--color-border-default)] rounded-[4px]">
        <header className="px-5 py-3.5 border-b border-[var(--color-border-default)]">
          <h2 className="m-0 text-[14px] font-semibold text-[var(--color-ink-900)]">
            Movement timeline
          </h2>
        </header>
        <div className="px-6 py-10 text-center text-[var(--color-ink-500)] text-[13px]">
          No movements recorded for this unit yet.
        </div>
      </section>
    );
  }

  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px]">
      <header className="px-5 py-3.5 border-b border-[var(--color-border-default)] flex items-center justify-between">
        <h2 className="m-0 text-[14px] font-semibold text-[var(--color-ink-900)] flex items-center gap-2.5">
          Movement timeline
          <span className="text-[11px] text-[var(--color-ink-500)] font-medium bg-[var(--color-ink-100)] px-2 py-0.5 rounded-full">
            {movements.length}
          </span>
        </h2>
        <span className="text-[12px] text-[var(--color-ink-500)]">
          Current state: <span className="font-medium text-[var(--color-ink-900)]">{formatUnitStatus(currentStatus)}</span>
        </span>
      </header>
      <div className="px-7 py-7 relative">
        <div
          aria-hidden
          className="absolute left-[46px] top-7 bottom-7 w-px bg-[var(--color-border-default)]"
        />
        {movements.map((m, i) => (
          <TimelineEntry key={m.id} entry={m} isLast={i === movements.length - 1} />
        ))}
      </div>
    </section>
  );
}

const MOVEMENT_TONE: Record<MovementType, "success" | "amber" | "danger" | "navy" | "grey"> = {
  RECEIPT: "success",
  ASSEMBLY_START: "amber",
  ASSEMBLY_COMPLETE: "success",
  SALE: "success",
  RETURN: "amber",
  DAMAGE: "danger",
  WRITE_OFF: "danger",
  DEMO: "navy",
  INTERNAL_USE: "navy",
  TRANSFER: "grey",
  REPAIR_IN: "amber",
  REPAIR_OUT: "success",
  RESTOCK_FROM_REPAIR: "success",
  ADJUSTMENT: "grey",
};

const TONE_DOT: Record<"success" | "amber" | "danger" | "navy" | "grey", { bg: string; border: string; fg: string }> = {
  success: { bg: "var(--color-success-50)", border: "var(--color-success-700)", fg: "var(--color-success-700)" },
  amber: { bg: "var(--color-warning-50)", border: "var(--color-warning-700)", fg: "var(--color-warning-700)" },
  danger: { bg: "var(--color-danger-50)", border: "var(--color-danger-700)", fg: "var(--color-danger-700)" },
  navy: { bg: "var(--color-navy-50)", border: "var(--color-navy-700)", fg: "var(--color-navy-700)" },
  grey: { bg: "#FBFBFC", border: "var(--color-border-strong)", fg: "var(--color-ink-700)" },
};

function TimelineEntry({ entry, isLast }: { entry: StockMovementEntry; isLast: boolean }) {
  const tone = MOVEMENT_TONE[entry.movementType] ?? "grey";
  const dot = TONE_DOT[tone];
  const refLabel = entry.referenceType
    ? `${entry.referenceType.replace(/_/g, " ").toLowerCase()}${entry.referenceId ? ` ${entry.referenceId}` : ""}`
    : null;

  return (
    <div className={`relative pl-14 ${isLast ? "" : "mb-5"}`}>
      <div
        className="absolute left-3 top-0 w-8 h-8 rounded-full grid place-items-center z-10 text-[10px] font-bold uppercase"
        style={{ background: dot.bg, border: `2px solid ${dot.border}`, color: dot.fg }}
      >
        {entry.movementType.slice(0, 2)}
      </div>
      <div className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-4 py-3">
        <div className="flex items-center gap-2.5 mb-2 flex-wrap">
          <h3 className="text-[14px] font-semibold text-[var(--color-ink-900)] m-0">
            {formatMovementType(entry.movementType)}
          </h3>
          <span
            className="text-[10px] font-bold uppercase tracking-[0.04em] px-1.5 py-0.5 rounded-[3px]"
            style={{ background: dot.bg, color: dot.fg }}
          >
            {entry.movementType.replace(/_/g, " ")}
          </span>
          {entry.fromState && entry.toState && (
            <span className="text-[11.5px] text-[var(--color-ink-500)]">
              {formatUnitStatus(entry.fromState)}
              <span className="mx-1 text-[var(--color-ink-300)]">&rsaquo;</span>
              <span
                className="font-medium"
                style={{ color: toneOfMaybeStatus(entry.toState) === "danger" ? "var(--color-danger-700)" : "var(--color-ink-900)" }}
              >
                {formatUnitStatus(entry.toState)}
              </span>
            </span>
          )}
          {!entry.fromState && entry.toState && (
            <span className="text-[11.5px] text-[var(--color-ink-500)]">
              Initial state:{" "}
              <span className="font-medium text-[var(--color-ink-900)]">
                {formatUnitStatus(entry.toState)}
              </span>
            </span>
          )}
          <span className="ml-auto text-[12px] text-[var(--color-ink-500)] tabular-nums flex items-center gap-2 flex-shrink-0">
            <span>{formatDateTime(entry.occurredAt)}</span>
            <span className="text-[var(--color-ink-400)] text-[11px]">{relativeTime(entry.occurredAt)}</span>
          </span>
        </div>
        <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-[12px] text-[var(--color-ink-700)]">
          <span>
            <span className="text-[var(--color-ink-500)]">Actor:</span>{" "}
            <span className="font-medium text-[var(--color-ink-900)]">{entry.actor.fullName}</span>
          </span>
          {refLabel && (
            <span>
              <span className="text-[var(--color-ink-500)]">Reference:</span>{" "}
              <span className="font-mono text-[var(--color-navy-700)]">{refLabel}</span>
            </span>
          )}
          {entry.notes && (
            <span className="basis-full text-[12px] text-[var(--color-ink-700)] mt-1 italic">
              &ldquo;{entry.notes}&rdquo;
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function NotFoundCard({ idOrEngineNumber }: { idOrEngineNumber: string }) {
  return (
    <div className="max-w-[640px] mx-auto py-12">
      <div className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-6 py-8 text-center">
        <h1 className="text-[18px] font-semibold text-[var(--color-ink-900)] m-0 mb-2">
          Unit not found
        </h1>
        <p className="text-[13px] text-[var(--color-ink-700)] m-0 mb-1">
          No unit matches{" "}
          <span className="font-mono text-[var(--color-navy-700)]">{idOrEngineNumber}</span>.
        </p>
        <p className="text-[12px] text-[var(--color-ink-500)] m-0 mb-5">
          Check the engine number or browse the listing.
        </p>
        <Link
          href="/inventory/units"
          className="inline-flex items-center h-8 px-3 rounded-[3px] text-[12.5px] font-medium text-white"
          style={{ background: "var(--color-navy-700)" }}
        >
          Back to Units
        </Link>
      </div>
    </div>
  );
}
