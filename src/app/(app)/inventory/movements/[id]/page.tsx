"use client";

/**
 * Stock-movement detail. There is NO backend detail endpoint for movements
 * (audit confirmed: stock-movements has only the list endpoint). The detail
 * page therefore reads exclusively from the mirror by id, against either
 * the stockMovement OR sparePartMovement bucket depending on the ?kind=
 * query param (defaults to "stock").
 *
 * The interesting work is reference resolution: every referenceType the
 * backend can emit has a join target in the mirror, EXCEPT 'RETURN' (no
 * 'return' bucket today, surfaced as a finding by the resolver). The page
 * renders the full referenced entity summary AND a deep link when one is
 * available; degrades to "Reference unavailable in the local mirror" when
 * the join target isn't there.
 *
 * Field-access audit: every field read by the renderer is assigned in the
 * setState below with an explicit fallback. The dependency on the runtime
 * referenceType is what makes this surface fragile, so the resolver in
 * @/lib/movements/reference owns the exhaustive switch.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import FreshnessBadge from "@/components/sync/FreshnessBadge";
import { usePermissions } from "@/lib/auth";
import { type MovementType, type SparePartMovementType } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { resolveReferenceSummary, type ReferenceSummary } from "@/lib/movements/reference";
import { DETAIL_GRID } from "@/lib/responsive";
import { getById, listByType } from "@/lib/sync/mirror/store";
import { useUrlLastSegment } from "@/lib/sync/use-url-segment";
import { formatMovementType } from "@/lib/units/format";

type Kind = "stock" | "spare";

type StockMovementMirror = {
  id: string;
  unitId: string;
  movementType: MovementType;
  fromState: string | null;
  toState: string | null;
  fromWarehouseId: string | null;
  toWarehouseId: string | null;
  referenceType: string | null;
  referenceId: string | null;
  occurredAt: string;
  notes: string | null;
  actorId: string;
};

type SparePartMovementMirror = {
  id: string;
  sparePartId: string;
  movementType: SparePartMovementType;
  quantity: number;
  referenceType: string | null;
  referenceId: string | null;
  occurredAt: string;
  notes: string | null;
  actorId: string | null;
};

type ResolvedDetail = {
  kind: Kind;
  movement: StockMovementMirror | SparePartMovementMirror;
  actorName: string | null;
  unitEngineNumber: string | null;
  unitId: string | null;
  sparePartName: string | null;
  sparePartSku: string | null;
  sparePartId: string | null;
  fromWarehouseName: string | null;
  toWarehouseName: string | null;
  reference: ReferenceSummary;
};

export default function StockMovementDetailPage() {
  const id = useUrlLastSegment();
  const sp = useSearchParams();
  const kind: Kind = sp.get("kind") === "spare" ? "spare" : "stock";

  const { has } = usePermissions();
  const canSeeStock = has("movement.read");
  const canSeeSpare = has("sparepart.read");
  const canSee = kind === "stock" ? canSeeStock : canSeeSpare;

  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "not_found" }
    | { status: "ok"; detail: ResolvedDetail }
  >({ status: "loading" });

  useEffect(() => {
    if (!canSee || !id) return;
    let cancelled = false;
    (async () => {
      const bucket = kind === "stock" ? "stockMovement" : "sparePartMovement";
      const row = await getById<StockMovementMirror | SparePartMovementMirror>(bucket, id);
      if (cancelled) return;
      if (!row) {
        setState({ status: "not_found" });
        return;
      }
      const m = row.body;

      // Load the join sources from the mirror. listByType is cheap (single
      // IDB range scan per bucket); we only pull buckets the resolver and
      // the renderer actually consume.
      const [shipments, salesOrders, assemblyJobs, users, units, parts, warehouses] = await Promise.all([
        listByType<{ id: string; shipmentReference: string }>("shipment"),
        listByType<{ id: string; soNumber: string }>("salesOrder"),
        listByType<{ id: string; unitId: string }>("assemblyJob"),
        listByType<{ id: string; fullName: string }>("user"),
        listByType<{ id: string; engineNumber: string }>("unit"),
        listByType<{ id: string; sku: string; name: string }>("sparePart"),
        listByType<{ id: string; name: string }>("warehouse"),
      ]);
      if (cancelled) return;

      const userById = new Map(users.map((u) => [u.body.id, u.body]));
      const unitById = new Map(units.map((u) => [u.body.id, u.body]));
      const partById = new Map(parts.map((p) => [p.body.id, p.body]));
      const wareById = new Map(warehouses.map((w) => [w.body.id, w.body]));
      const buckets = {
        shipmentById: new Map(
          shipments.map((s) => [s.body.id, { id: s.body.id, shipmentReference: s.body.shipmentReference }]),
        ),
        salesOrderById: new Map(
          salesOrders.map((s) => [s.body.id, { id: s.body.id, soNumber: s.body.soNumber }]),
        ),
        assemblyJobById: new Map(
          assemblyJobs.map((j) => [j.body.id, { id: j.body.id, unitId: j.body.unitId }]),
        ),
      };

      const reference = resolveReferenceSummary(m.referenceType, m.referenceId, buckets);

      if (kind === "stock") {
        const sm = m as StockMovementMirror;
        setState({
          status: "ok",
          detail: {
            kind,
            movement: sm,
            actorName: userById.get(sm.actorId)?.fullName ?? null,
            unitEngineNumber: unitById.get(sm.unitId)?.engineNumber ?? null,
            unitId: sm.unitId,
            sparePartName: null,
            sparePartSku: null,
            sparePartId: null,
            fromWarehouseName: sm.fromWarehouseId ? wareById.get(sm.fromWarehouseId)?.name ?? null : null,
            toWarehouseName: sm.toWarehouseId ? wareById.get(sm.toWarehouseId)?.name ?? null : null,
            reference,
          },
        });
      } else {
        const spm = m as SparePartMovementMirror;
        const part = partById.get(spm.sparePartId) ?? null;
        setState({
          status: "ok",
          detail: {
            kind,
            movement: spm,
            actorName: spm.actorId ? userById.get(spm.actorId)?.fullName ?? null : null,
            unitEngineNumber: null,
            unitId: null,
            sparePartName: part?.name ?? null,
            sparePartSku: part?.sku ?? null,
            sparePartId: spm.sparePartId,
            fromWarehouseName: null,
            toWarehouseName: null,
            reference,
          },
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, kind, canSee]);

  if (!canSee) {
    return (
      <div className="max-w-[1080px] mx-auto py-10 text-center text-[var(--color-ink-500)]">
        You do not have access to this movement (requires {kind === "stock" ? "movement.read" : "sparepart.read"}).
      </div>
    );
  }
  if (state.status === "loading") {
    return <div className="max-w-[1080px] mx-auto py-10 text-center text-[var(--color-ink-500)]">Loading movement...</div>;
  }
  if (state.status === "not_found") {
    return (
      <div className="max-w-[640px] mx-auto py-12">
        <div className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-6 py-8 text-center">
          <h1 className="text-[18px] font-semibold text-[var(--color-ink-900)] m-0 mb-2">Movement not found</h1>
          <p className="text-[13px] text-[var(--color-ink-700)] m-0 mb-3">
            No movement matches{" "}
            <span className="font-mono text-[var(--color-navy-700)]">{id}</span> in the local mirror.
            Movements are append-only and the mirror is synced on every pull; if this id is real, try
            re-opening this screen online to pull the latest movements.
          </p>
          <Link
            href="/inventory/movements"
            className="inline-flex items-center h-8 px-3 rounded-[3px] text-[12.5px] font-medium text-white"
            style={{ background: "var(--color-navy-700)" }}
          >
            Back to movements
          </Link>
        </div>
      </div>
    );
  }

  const d = state.detail;
  return (
    <div className="max-w-[920px] mx-auto pb-10">
      <header className="pb-4 mb-5 border-b border-[var(--color-border-default)]">
        <div className="text-[12px] text-[var(--color-ink-500)] flex items-center gap-1.5 mb-1.5 flex-wrap">
          <Link href="/inventory/movements" className="text-[var(--color-ink-500)] hover:text-[var(--color-navy-700)]">
            Inventory
          </Link>
          <span className="text-[var(--color-ink-300)]">/</span>
          <Link
            href={`/inventory/movements${d.kind === "spare" ? "?tab=spare" : ""}`}
            className="text-[var(--color-ink-500)] hover:text-[var(--color-navy-700)]"
          >
            Stock movements
          </Link>
          <span className="text-[var(--color-ink-300)]">/</span>
          <span className="text-[var(--color-ink-900)] font-medium font-mono">{id}</span>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-[22px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em]">
            {formatMovementType(d.movement.movementType)}{" "}
            <span className="text-[var(--color-ink-500)] text-[14px] font-medium">
              · {d.kind === "stock" ? "unit movement" : "spare-part movement"}
            </span>
          </h1>
          <FreshnessBadge />
        </div>
        <div className="text-[12.5px] text-[var(--color-ink-500)] mt-1">
          Occurred {formatDateTime(d.movement.occurredAt)}
          {d.actorName && (
            <>
              {" · by "}
              <span className="text-[var(--color-ink-700)] font-medium">{d.actorName}</span>
            </>
          )}
        </div>
      </header>

      {d.kind === "stock" ? <StockSubject d={d} /> : <SpareSubject d={d} />}
      <ReferenceCard d={d} />
      <RawCard d={d} id={id} />
    </div>
  );
}

function StockSubject({ d }: { d: ResolvedDetail }) {
  const m = d.movement as StockMovementMirror;
  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] mb-5">
      <header className="px-4 sm:px-5 py-3 border-b border-[var(--color-border-default)]">
        <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">Subject</h2>
      </header>
      <dl className="text-[12.5px] divide-y divide-[var(--color-border-default)]">
        <Row label="Unit">
          {d.unitId ? (
            <Link
              href={`/inventory/units/${d.unitId}`}
              className="text-[var(--color-navy-700)] hover:underline font-mono"
            >
              {d.unitEngineNumber ?? d.unitId}
            </Link>
          ) : (
            <span className="text-[var(--color-ink-400)]">--</span>
          )}
        </Row>
        <Row label="State change">
          {m.fromState || m.toState ? (
            <span>
              <span className="font-medium">{m.fromState ?? "(initial)"}</span>{" "}
              <span className="text-[var(--color-ink-400)]">to</span>{" "}
              <span className="font-medium">{m.toState ?? "(final)"}</span>
            </span>
          ) : (
            <span className="text-[var(--color-ink-400)]">--</span>
          )}
        </Row>
        <Row label="Warehouse">
          {m.fromWarehouseId || m.toWarehouseId ? (
            <span>
              {d.fromWarehouseName ?? m.fromWarehouseId ?? "(none)"}{" "}
              <span className="text-[var(--color-ink-400)]">to</span>{" "}
              {d.toWarehouseName ?? m.toWarehouseId ?? "(none)"}
            </span>
          ) : (
            <span className="text-[var(--color-ink-400)]">--</span>
          )}
        </Row>
        {m.notes && (
          <Row label="Notes">
            <span className="text-[var(--color-ink-900)]">{m.notes}</span>
          </Row>
        )}
      </dl>
    </section>
  );
}

function SpareSubject({ d }: { d: ResolvedDetail }) {
  const m = d.movement as SparePartMovementMirror;
  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] mb-5">
      <header className="px-4 sm:px-5 py-3 border-b border-[var(--color-border-default)]">
        <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">Subject</h2>
      </header>
      <dl className="text-[12.5px] divide-y divide-[var(--color-border-default)]">
        <Row label="Spare part">
          {d.sparePartName ? (
            <span>
              <span className="font-medium">{d.sparePartName}</span>{" "}
              <span className="text-[11px] text-[var(--color-ink-500)] font-mono ml-1">{d.sparePartSku}</span>
            </span>
          ) : (
            <span className="font-mono text-[11.5px] text-[var(--color-ink-500)]">{d.sparePartId}</span>
          )}
        </Row>
        <Row label="Quantity">
          <span className={m.quantity >= 0 ? "text-[var(--color-success-700)] font-medium" : "text-[var(--color-danger-700)] font-medium"}>
            {m.quantity >= 0 ? "+" : ""}
            {m.quantity}
          </span>
        </Row>
        {m.notes && (
          <Row label="Notes">
            <span className="text-[var(--color-ink-900)]">{m.notes}</span>
          </Row>
        )}
      </dl>
    </section>
  );
}

function ReferenceCard({ d }: { d: ResolvedDetail }) {
  const r = d.reference;
  const m = d.movement;
  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] mb-5">
      <header className="px-4 sm:px-5 py-3 border-b border-[var(--color-border-default)]">
        <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">Reference</h2>
      </header>
      <div className="px-4 sm:px-5 py-3 text-[12.5px]">
        {!m.referenceType ? (
          <span className="text-[var(--color-ink-500)]">
            No reference entity. {m.notes ? `Reason recorded on notes: "${m.notes}".` : ""}
          </span>
        ) : r.state === "resolved" && r.href ? (
          <span className="text-[var(--color-ink-900)]">
            <span className="text-[10.5px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] mr-2">
              {m.referenceType}
            </span>
            <Link href={r.href} className="text-[var(--color-navy-700)] hover:underline font-medium">
              {r.label}
            </Link>
            <span className="text-[11px] text-[var(--color-ink-500)] ml-2">{m.referenceId}</span>
          </span>
        ) : r.state === "missing" ? (
          <span className="text-[var(--color-ink-700)]">
            <span className="text-[10.5px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] mr-2">
              {m.referenceType}
            </span>
            {r.href ? (
              <Link href={r.href} className="text-[var(--color-navy-700)] hover:underline font-medium">
                {r.label}
              </Link>
            ) : (
              <span className="font-medium">{r.label}</span>
            )}{" "}
            <span className="text-[11.5px] text-[var(--color-warning-700)] ml-2">
              (entity not in local mirror; open online to load its detail)
            </span>
          </span>
        ) : r.state === "unmirrored" ? (
          <span className="text-[var(--color-ink-700)]">
            <span className="text-[10.5px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] mr-2">
              {m.referenceType}
            </span>
            <span className="font-medium">{r.label}</span>{" "}
            <span className="text-[11.5px] text-[var(--color-warning-700)] ml-2">
              ({m.referenceType.toLowerCase()} entity bucket not yet mirrored; reference shown by id)
            </span>
          </span>
        ) : r.state === "unknown" ? (
          <span className="text-[var(--color-ink-700)]">
            <span className="text-[10.5px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] mr-2">
              {m.referenceType}
            </span>
            <span className="font-medium">{r.label}</span>{" "}
            <span className="text-[11.5px] text-[var(--color-danger-700)] ml-2">
              (unknown reference type; frontend needs a handler for &quot;{m.referenceType}&quot;)
            </span>
          </span>
        ) : (
          <span className="text-[var(--color-ink-500)]">
            <span className="text-[10.5px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] mr-2">
              {m.referenceType}
            </span>
            {r.label || "No reference id recorded."}
          </span>
        )}
      </div>
    </section>
  );
}

function RawCard({ d, id }: { d: ResolvedDetail; id: string }) {
  const m = d.movement;
  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px]">
      <header className="px-4 sm:px-5 py-3 border-b border-[var(--color-border-default)] flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">Audit fields</h2>
        <span className="text-[11px] text-[var(--color-ink-500)] font-mono break-all">{id}</span>
      </header>
      <dl className="text-[12.5px] grid grid-cols-1 sm:grid-cols-2 gap-x-12 px-4 sm:px-5 py-3">
        <Row label="Movement id" mono>
          {m.id}
        </Row>
        <Row label="Occurred at" mono>
          {m.occurredAt}
        </Row>
        <Row label="Type">{formatMovementType(m.movementType)}</Row>
        <Row label="Reference type">{m.referenceType ?? "--"}</Row>
        <Row label="Reference id" mono>
          {m.referenceId ?? "--"}
        </Row>
      </dl>
    </section>
  );
}

function Row({
  label,
  mono = false,
  children,
}: {
  label: string;
  mono?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`${DETAIL_GRID} gap-1 sm:gap-3 items-baseline py-2 border-b border-dashed border-[var(--color-border-default)] last:border-b-0`}>
      <span className="text-[12px] font-medium text-[var(--color-ink-500)]">{label}</span>
      <span
        className={`text-[var(--color-ink-900)] ${mono ? "font-mono text-[12px] tracking-[0.02em] break-all" : ""}`}
      >
        {children}
      </span>
    </div>
  );
}
