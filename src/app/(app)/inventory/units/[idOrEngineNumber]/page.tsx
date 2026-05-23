"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import StatusPill from "@/components/units/StatusPill";
import {
  getUnit,
  type ApiResult,
  type MovementType,
  type StockMovementEntry,
  type UnitDetail,
} from "@/lib/api";
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
  | { status: "ok"; unit: UnitDetail }
  | { status: "not_found" }
  | { status: "forbidden" }
  | { status: "error"; message: string };

export default function UnitDetailPage() {
  const params = useParams<{ idOrEngineNumber: string }>();
  const router = useRouter();
  const idOrEngineNumber = decodeURIComponent(params.idOrEngineNumber);
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    const ctrl = new AbortController();
    getUnit(idOrEngineNumber, ctrl.signal).then((r: ApiResult<UnitDetail>) => {
      if (ctrl.signal.aborted) return;
      if (r.kind === "ok") setState({ status: "ok", unit: r.data });
      else if (r.kind === "not_found") setState({ status: "not_found" });
      else if (r.kind === "unauthorized") router.replace("/login");
      else if (r.kind === "forbidden") setState({ status: "forbidden" });
      else setState({ status: "error", message: "message" in r ? String(r.message) : "Error" });
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

  const unit = state.unit;
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
