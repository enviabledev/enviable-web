"use client";

/**
 * Shipment selector for historical-load (prompt 38). Replaces the old free-text
 * shipment-id input, which was broken by design: the backend route
 * /api/historical-load/units/:shipmentId keys on the system cuid, but users only
 * ever see the human-readable reference (SH-YYYY-NNNN) on screen, so a manual
 * paste of the reference 404'd. This surfaces references as labels and submits
 * cuids as values, so the user picks what they recognise and the request carries
 * what the backend needs.
 *
 * No status filter: section 1 of historical-load creates the parent shipment
 * directly in RECEIVED state (isHistoricalImport=true), and the backend's
 * units-load does not gate on shipment status, so filtering to pre-receive
 * states would hide the very shipments this screen targets (and break the
 * section-1 auto-flow). Status is shown per option as context instead.
 *
 * Mirror-first paint, then revalidate from the network. A just-created shipment
 * from the section-1 auto-flow (passed via `injected`) is merged in even before
 * the mirror catches up, so it shows selected immediately.
 */
import { useEffect, useMemo, useState } from "react";

import { listShipments, type ShipmentListRow, type ShipmentStatus } from "@/lib/api";
import { listByType } from "@/lib/sync/mirror/store";

// Mirror's shipment bucket stores the flat row (no nested manifestLines).
type MirroredShipment = Omit<ShipmentListRow, "manifestLines">;

type ShipmentOption = {
  id: string;
  reference: string;
  status: ShipmentStatus;
  createdAt: string;
  isHistoricalImport: boolean;
};

function toOption(s: MirroredShipment): ShipmentOption {
  return {
    id: s.id,
    reference: s.shipmentReference,
    status: s.status,
    createdAt: s.createdAt,
    isHistoricalImport: s.isHistoricalImport,
  };
}

// Most recent first (ISO timestamps sort lexicographically).
function recentFirst(a: ShipmentOption, b: ShipmentOption): number {
  return b.createdAt.localeCompare(a.createdAt);
}

export default function ShipmentSelect({
  value,
  onChange,
  injected,
  testId,
  disabled,
}: {
  value: string;
  onChange: (id: string) => void;
  /**
   * A just-created shipment (from the section-1 auto-flow) that may not be in
   * the mirror yet. Merged into the options so it can be shown selected without
   * waiting for the next sync.
   */
  injected?: { id: string; reference: string } | null;
  testId?: string;
  disabled?: boolean;
}) {
  // null = still loading (mirror + first network response pending).
  const [shipments, setShipments] = useState<ShipmentOption[] | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();

    // Phase 1: paint from the mirror.
    (async () => {
      try {
        const mirrored = await listByType<MirroredShipment>("shipment");
        if (ctrl.signal.aborted) return;
        if (mirrored.length > 0) {
          setShipments(mirrored.map((m) => toOption(m.body)).sort(recentFirst));
        }
      } catch {
        // Let the network phase drive.
      }
    })();

    // Phase 2: revalidate from the network.
    listShipments({}, ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      if (r.kind === "ok") {
        setShipments(r.data.map(toOption).sort(recentFirst));
      } else if (
        r.kind === "network_error" ||
        r.kind === "server_error" ||
        r.kind === "forbidden"
      ) {
        // Keep whatever the mirror painted; if nothing painted, settle to empty
        // so the empty-state guidance shows instead of a perpetual spinner.
        setShipments((prev) => prev ?? []);
      }
    });

    return () => ctrl.abort();
  }, []);

  const options = useMemo(() => {
    const base = shipments ?? [];
    if (injected && !base.some((s) => s.id === injected.id)) {
      // Prepend the just-created shipment (RECEIVED historical import) so the
      // auto-flow shows it selected immediately, before the mirror catches up.
      return [
        {
          id: injected.id,
          reference: injected.reference,
          status: "RECEIVED" as ShipmentStatus,
          createdAt: "￿", // sorts first
          isHistoricalImport: true,
        },
        ...base,
      ];
    }
    return base;
  }, [shipments, injected]);

  if (shipments === null && options.length === 0) {
    return (
      <select
        disabled
        data-testid={testId}
        className="h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-[var(--color-ink-100)] text-[12.5px] w-full max-w-[440px]"
      >
        <option>Loading shipments…</option>
      </select>
    );
  }

  if (options.length === 0) {
    return (
      <div
        data-testid={`${testId}-empty`}
        className="text-[12px] text-[var(--color-ink-700)] max-w-[440px] leading-[1.5]"
      >
        No shipments available yet. Create one in the{" "}
        <span className="font-medium">Historical shipment</span> section above (or via a
        purchase order) before loading units.
      </div>
    );
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      data-testid={testId}
      className="h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] font-mono w-full max-w-[440px]"
    >
      <option value="">Select a shipment…</option>
      {options.map((s) => (
        <option key={s.id} value={s.id}>
          {s.reference} · {s.status}
          {s.isHistoricalImport ? " · historical" : ""}
        </option>
      ))}
    </select>
  );
}
