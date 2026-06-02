"use client";

/**
 * Spare-part detail at /inventory/spare-parts/[id]. Read-only, gated
 * 'sparepart.read'. The backend's detail endpoint returns the catalogue
 * row plus a movements array (RECEIPT / ADJUSTMENT entries with the
 * actor joined). The movement timeline mirrors how the unit detail
 * surfaces its own movement history, the audit trail at the level a
 * user looking at "this specific spare part" would want it.
 *
 * Mirror-first paint:
 *   Phase 1: paint from the mirror's sparePart row + the
 *            sparePartMovement bucket filtered to this sparePartId,
 *            with actors joined from the mirrored user directory.
 *   Phase 2: revalidate from /api/spare-parts/:id which carries the
 *            same shape PLUS server-joined actor full names.
 *
 * Cost-gating: landedCostPerUnit is absent on the row for non-cost
 * users (the backend's CostVisibilityInterceptor strips it before the
 * row lands in the mirror), so the cost field renders only when the
 * key is present. No client-side stripping; absence-is-the-gate.
 *
 * References on each movement: the prompt-15 resolver in
 * src/lib/movements/reference.ts handles every MovementReferenceType
 * the backend can emit. Today the historical-load writer is the only
 * sparePartMovement writer and it sets referenceType=null, so the
 * movements typically render with no reference; but the join target
 * is in place for the day a writer starts setting referenceType
 * (the silent-skip discipline at the resolver's default branch).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import FreshnessBadge from "@/components/sync/FreshnessBadge";
import OfflineNotice from "@/components/sync/OfflineNotice";
import {
  getSparePart,
  type SparePartDetail,
  type SparePartMovementEntry,
} from "@/lib/api";
import { usePermissions } from "@/lib/auth";
import { formatDateTime, formatNGN } from "@/lib/format";
import { resolveReferenceSummary } from "@/lib/movements/reference";
import { getById, listByType } from "@/lib/sync/mirror/store";
import { useUrlLastSegment } from "@/lib/sync/use-url-segment";
import { formatMovementType } from "@/lib/units/format";

type SparePartMirror = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  quantityOnHand: number;
  landedCostPerUnit?: string;
  status: "ACTIVE" | "DISCONTINUED";
};

type SparePartMovementMirror = {
  id: string;
  sparePartId: string;
  movementType: "RECEIPT" | "ADJUSTMENT";
  quantity: number;
  referenceType: string | null;
  referenceId: string | null;
  occurredAt: string;
  notes: string | null;
  actorId: string | null;
};

type RefCtx = Awaited<ReturnType<typeof loadRefContext>>;

async function loadRefContext() {
  const [shipments, salesOrders, assemblyJobs] = await Promise.all([
    listByType<{ id: string; shipmentReference: string }>("shipment"),
    listByType<{ id: string; soNumber: string }>("salesOrder"),
    listByType<{ id: string; unitId: string }>("assemblyJob"),
  ]);
  return {
    shipmentById: new Map(shipments.map((s) => [s.body.id, s.body])),
    salesOrderById: new Map(salesOrders.map((s) => [s.body.id, s.body])),
    assemblyJobById: new Map(assemblyJobs.map((j) => [j.body.id, j.body])),
  };
}

export default function SparePartDetailPage() {
  const router = useRouter();
  const { has } = usePermissions();
  const canRead = has("sparepart.read");
  // Read from window.location.pathname so a sibling-fallback cache hit
  // renders the page corresponding to the URL bar, not whatever sibling
  // the SW returned. See src/lib/sync/use-url-segment.ts.
  const id = useUrlLastSegment();

  const [part, setPart] = useState<SparePartDetail | null>(null);
  const [fromMirror, setFromMirror] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [offline, setOffline] = useState(false);
  const [refCtx, setRefCtx] = useState<RefCtx | null>(null);

  useEffect(() => {
    if (!canRead || !id) return;
    const ctrl = new AbortController();
    setNotFound(false);
    setOffline(false);

    let mirrorPainted = false;
    (async () => {
      try {
        const row = await getById<SparePartMirror>("sparePart", id);
        if (ctrl.signal.aborted) return;
        if (!row) return;
        const [movs, users] = await Promise.all([
          listByType<SparePartMovementMirror>("sparePartMovement"),
          listByType<{ id: string; fullName: string }>("user"),
        ]);
        const ctx = await loadRefContext();
        if (ctrl.signal.aborted) return;
        const userById = new Map(users.map((u) => [u.body.id, u.body]));
        const ownMovs = movs
          .map((m) => m.body)
          .filter((m) => m.sparePartId === id)
          .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))
          .map<SparePartMovementEntry>((m) => ({
            id: m.id,
            movementType: m.movementType,
            quantity: m.quantity,
            referenceType: (m.referenceType ?? null) as SparePartMovementEntry["referenceType"],
            referenceId: m.referenceId,
            occurredAt: m.occurredAt,
            notes: m.notes,
            actor: m.actorId
              ? { id: m.actorId, fullName: userById.get(m.actorId)?.fullName ?? m.actorId }
              : null,
          }));
        mirrorPainted = true;
        setPart({ ...row.body, movements: ownMovs });
        setFromMirror(true);
        setRefCtx(ctx);
      } catch {
        // network drives
      }
    })();

    getSparePart(id, ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      if (r.kind === "ok") {
        setPart(r.data);
        setFromMirror(false);
        setErrMsg("");
      } else if (r.kind === "unauthorized") {
        router.replace("/login");
      } else if (r.kind === "forbidden") {
        setErrMsg("You do not have access to view this spare part.");
      } else if (r.kind === "not_found") {
        if (!mirrorPainted) setNotFound(true);
      } else if (r.kind === "network_error" || r.kind === "server_error") {
        if (!mirrorPainted) setOffline(true);
      } else if ("message" in r) {
        setErrMsg(typeof r.message === "string" ? r.message : r.message.join("; "));
      }
    });

    return () => ctrl.abort();
  }, [canRead, id, router]);

  if (!canRead) {
    return (
      <div className="max-w-[1080px] mx-auto py-10 text-center text-[var(--color-ink-500)]">
        You do not have access to spare parts (requires sparepart.read).
      </div>
    );
  }
  if (errMsg) {
    return (
      <div className="max-w-[820px] mx-auto py-10">
        <div className="px-3.5 py-2.5 rounded-[3px] bg-[var(--color-danger-100)] text-[var(--color-danger-700)] text-[12.5px]">
          {errMsg}
        </div>
        <div className="text-center mt-3">
          <Link href="/inventory/spare-parts" className="text-[12px] text-[var(--color-navy-700)] hover:underline">
            Back to spare parts
          </Link>
        </div>
      </div>
    );
  }
  if (notFound) {
    return (
      <div className="max-w-[640px] mx-auto py-12">
        <div className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-6 py-8 text-center">
          <h1 className="text-[18px] font-semibold text-[var(--color-ink-900)] m-0 mb-2">Spare part not found</h1>
          <p className="text-[13px] text-[var(--color-ink-700)] m-0 mb-3">
            No spare part matches <span className="font-mono text-[var(--color-navy-700)]">{id}</span>.
          </p>
          <Link
            href="/inventory/spare-parts"
            className="inline-flex items-center h-8 px-3 rounded-[3px] text-[12.5px] font-medium text-white"
            style={{ background: "var(--color-navy-700)" }}
          >
            Back to spare parts
          </Link>
        </div>
      </div>
    );
  }
  if (!part && offline) {
    return (
      <div className="max-w-[820px] mx-auto pb-10">
        <OfflineNotice body="This spare part's details will load once you are back online. Spare parts you have already opened or that the mirror has warmed appear here from the local mirror." />
        <div className="text-center mt-3">
          <Link href="/inventory/spare-parts" className="text-[12px] text-[var(--color-navy-700)] hover:underline">
            Back to spare parts
          </Link>
        </div>
      </div>
    );
  }
  if (!part) {
    return <div className="max-w-[1080px] mx-auto py-10 text-center text-[var(--color-ink-500)]">Loading spare part...</div>;
  }

  return (
    <div className="max-w-[1080px] mx-auto pb-10">
      <header className="pb-4 mb-5 border-b border-[var(--color-border-default)]">
        <div className="text-[12px] text-[var(--color-ink-500)] flex items-center gap-1.5 mb-1.5 flex-wrap">
          <Link href="/inventory/spare-parts" className="text-[var(--color-ink-500)] hover:text-[var(--color-navy-700)]">
            Inventory
          </Link>
          <span className="text-[var(--color-ink-300)]">/</span>
          <Link href="/inventory/spare-parts" className="text-[var(--color-ink-500)] hover:text-[var(--color-navy-700)]">
            Spare parts
          </Link>
          <span className="text-[var(--color-ink-300)]">/</span>
          <span className="text-[var(--color-ink-900)] font-medium">{part.name}</span>
        </div>
        <div className="flex items-center gap-3 flex-wrap mb-1">
          <h1 className="text-[22px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em]">
            {part.name}
          </h1>
          <span
            className={`inline-flex items-center h-[20px] px-2 rounded-full text-[10.5px] font-semibold uppercase tracking-[0.02em] ${
              part.status === "ACTIVE"
                ? "bg-[var(--color-success-100)] text-[var(--color-success-700)]"
                : "bg-[var(--color-ink-100)] text-[var(--color-ink-700)]"
            }`}
          >
            {part.status === "ACTIVE" ? "Active" : "Discontinued"}
          </span>
          {fromMirror && <FreshnessBadge />}
        </div>
        <div className="text-[12.5px] text-[var(--color-ink-500)] mt-1 font-mono">{part.sku}</div>
      </header>

      <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] mb-5">
        <header className="px-5 py-3 border-b border-[var(--color-border-default)]">
          <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">Catalogue</h2>
        </header>
        <dl className="text-[12.5px] divide-y divide-[var(--color-border-default)]">
          <Row label="Quantity on hand">
            <span
              className={
                part.quantityOnHand === 0
                  ? "text-[var(--color-warning-700)] font-semibold font-mono text-[16px] tracking-[0.02em]"
                  : "text-[var(--color-ink-900)] font-semibold font-mono text-[16px] tracking-[0.02em]"
              }
            >
              {part.quantityOnHand.toLocaleString()}
            </span>
          </Row>
          {part.landedCostPerUnit != null && (
            <Row label="Landed cost / unit">
              <span className="text-[var(--color-ink-900)] font-mono">
                {formatNGN(part.landedCostPerUnit)}
              </span>
            </Row>
          )}
          {part.description && (
            <Row label="Description">
              <span className="text-[var(--color-ink-900)]">{part.description}</span>
            </Row>
          )}
          <Row label="Spare part ID" mono>
            {part.id}
          </Row>
        </dl>
      </section>

      <MovementHistoryCard movements={part.movements} refCtx={refCtx} />
    </div>
  );
}

function MovementHistoryCard({
  movements,
  refCtx,
}: {
  movements: SparePartMovementEntry[];
  refCtx: RefCtx | null;
}) {
  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px]">
      <header className="px-5 py-3 border-b border-[var(--color-border-default)] flex items-center justify-between">
        <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)]">Movement history</h2>
        <span className="text-[11px] text-[var(--color-ink-500)]">
          {movements.length} {movements.length === 1 ? "entry" : "entries"}
        </span>
      </header>
      {movements.length === 0 ? (
        <div className="px-5 py-8 text-center text-[12.5px] text-[var(--color-ink-500)]">
          No movements recorded for this spare part yet.
        </div>
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr>
              <Th>Occurred</Th>
              <Th>Type</Th>
              <Th align="right">Quantity</Th>
              <Th>Actor</Th>
              <Th>Reference</Th>
              <Th>Notes</Th>
            </tr>
          </thead>
          <tbody>
            {movements.map((m, i) => {
              const ref = resolveReferenceSummary(m.referenceType, m.referenceId, refCtx);
              return (
                <tr
                  key={m.id}
                  className={`${i % 2 ? "bg-[#FBFBFC]" : "bg-white"} border-b border-[var(--color-border-default)] last:border-b-0`}
                >
                  <Td>
                    <Link
                      href={`/inventory/movements/${m.id}?kind=spare`}
                      className="text-[var(--color-navy-700)] hover:underline"
                    >
                      {formatDateTime(m.occurredAt)}
                    </Link>
                  </Td>
                  <Td>{formatMovementType(m.movementType)}</Td>
                  <Td align="right">
                    <span
                      className={
                        m.quantity >= 0
                          ? "text-[var(--color-success-700)] font-mono font-semibold"
                          : "text-[var(--color-danger-700)] font-mono font-semibold"
                      }
                    >
                      {m.quantity >= 0 ? "+" : ""}
                      {m.quantity}
                    </span>
                  </Td>
                  <Td>{m.actor?.fullName ?? <span className="text-[var(--color-ink-400)]">--</span>}</Td>
                  <Td>
                    {ref.label ? (
                      ref.href ? (
                        <Link href={ref.href} className="text-[var(--color-navy-700)] hover:underline">
                          {ref.label}
                        </Link>
                      ) : (
                        <span className="text-[var(--color-ink-700)]">{ref.label}</span>
                      )
                    ) : (
                      <span className="text-[var(--color-ink-400)]">--</span>
                    )}
                  </Td>
                  <Td>{m.notes ?? <span className="text-[var(--color-ink-400)]">--</span>}</Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
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
    <div className="px-5 py-2.5 grid grid-cols-[200px_1fr] gap-3 items-baseline">
      <dt className="text-[12px] font-medium text-[var(--color-ink-500)]">{label}</dt>
      <dd
        className={`m-0 text-[var(--color-ink-900)] ${mono ? "font-mono text-[12px] tracking-[0.02em]" : ""}`}
      >
        {children}
      </dd>
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
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <td
      className={`px-3.5 py-2 text-[12.5px] text-[var(--color-ink-900)] whitespace-nowrap text-${align}`}
    >
      {children}
    </td>
  );
}
