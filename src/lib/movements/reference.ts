"use client";

/**
 * Reference resolution for stock and spare-part movements.
 *
 * The backend's MovementReferenceType enum has six values but only five are
 * ever written (TRANSFER is defined in the enum and never emitted, audited
 * in enviable-system/src/{shipments,sales-orders,assembly,returns,units}/*).
 * This module owns the exhaustive switch so the screens never read
 * referenceType without a handler for every case.
 *
 * Field-access audit:
 *   SHIPMENT      -> shipment bucket, body.shipmentReference
 *   SALES_ORDER   -> salesOrder bucket, body.soNumber
 *   ASSEMBLY_JOB  -> assemblyJob bucket, no human-readable code (uses the id)
 *   RETURN        -> NOT IN MIRROR. The frontend's ENTITY_TYPES has no
 *                    'return' bucket today; degrade gracefully with the id.
 *                    FINDING: backend pull-coverage candidate.
 *   ADJUSTMENT    -> no entity; the movement's notes carries the reason.
 *   TRANSFER      -> never emitted, but if encountered (e.g. a future
 *                    backend addition lands before the frontend updates)
 *                    we still need a non-crashing path.
 *   null          -> some legacy movements may have null referenceType;
 *                    show "--", no crash.
 *
 * Each branch returns a { label, href } pair so the caller can deep-link.
 * Missing entities (id present, body not in the mirror) show the id as the
 * label and either a best-guess href or no href at all; this is the
 * graceful-degradation contract.
 */

type Buckets = {
  shipmentById: Map<string, { id: string; shipmentReference: string }>;
  salesOrderById: Map<string, { id: string; salesOrderReference?: string; reference?: string }>;
  assemblyJobById: Map<string, { id: string; unitId: string }>;
};

export type ReferenceSummary = {
  label: string;
  href: string | null;
  // 'missing' means we know the referenceType is something we handle but
  // the specific id is not in the local mirror (e.g. cold offline). 'unmirrored'
  // means the referenceType is one whose entity bucket is not mirrored at all
  // (currently RETURN). Both render the id honestly; the distinction matters
  // for the detail page's diagnostic note.
  state: "resolved" | "missing" | "unmirrored" | "no-ref" | "unknown";
};

export function resolveReferenceSummary(
  referenceType: string | null | undefined,
  referenceId: string | null | undefined,
  buckets: Buckets | null,
): ReferenceSummary {
  if (!referenceType) {
    // ADJUSTMENT with no reference id, or legacy null. Either way, no entity.
    return { label: "", href: null, state: "no-ref" };
  }
  switch (referenceType) {
    case "SHIPMENT": {
      if (!referenceId) return { label: "Shipment", href: null, state: "no-ref" };
      const ship = buckets?.shipmentById.get(referenceId);
      if (ship) {
        return {
          label: `Shipment ${ship.shipmentReference}`,
          href: `/procurement/shipments/${ship.id}`,
          state: "resolved",
        };
      }
      return {
        label: `Shipment ${referenceId}`,
        href: `/procurement/shipments/${referenceId}`,
        state: "missing",
      };
    }
    case "SALES_ORDER": {
      if (!referenceId) return { label: "Sales order", href: null, state: "no-ref" };
      const so = buckets?.salesOrderById.get(referenceId);
      // Mirror row may carry the field as either `soNumber` (api shape) or
      // a generic `reference`. Look for both, then fall back to the id.
      const reference =
        (so as { soNumber?: string } | undefined)?.soNumber ??
        so?.salesOrderReference ??
        so?.reference ??
        referenceId;
      if (so) {
        return {
          label: `Sales order ${reference}`,
          href: `/sales/sales-orders/${so.id}`,
          state: "resolved",
        };
      }
      return {
        label: `Sales order ${referenceId}`,
        href: `/sales/sales-orders/${referenceId}`,
        state: "missing",
      };
    }
    case "ASSEMBLY_JOB": {
      if (!referenceId) return { label: "Assembly job", href: null, state: "no-ref" };
      const job = buckets?.assemblyJobById.get(referenceId);
      if (job) {
        return {
          label: `Assembly job ${referenceId.slice(-6).toUpperCase()}`,
          href: `/inventory/assembly-jobs/${job.id}`,
          state: "resolved",
        };
      }
      return {
        label: `Assembly job ${referenceId}`,
        href: `/inventory/assembly-jobs/${referenceId}`,
        state: "missing",
      };
    }
    case "RETURN": {
      // The frontend mirror does NOT have a 'return' bucket today; surface
      // the id honestly and leave the href null so the user is not led to a
      // dead screen. Listed as a follow-up: add 'return' to ENTITY_TYPES
      // once a returns detail page exists.
      return {
        label: `Return ${referenceId ?? ""}`.trim(),
        href: null,
        state: "unmirrored",
      };
    }
    case "ADJUSTMENT": {
      // ADJUSTMENT is the IT-admin reason path: referenceId is null and the
      // reason lives in movement.notes. The caller renders the notes; the
      // summary just labels the kind so the list shows something meaningful.
      return { label: "Adjustment", href: null, state: "no-ref" };
    }
    case "TRANSFER": {
      // Defined in the backend enum but not written by any service today.
      // If a future writer emits TRANSFER, we still want a non-crashing
      // path; we have no idea where to deep-link without more context.
      return {
        label: `Transfer ${referenceId ?? ""}`.trim(),
        href: null,
        state: "unmirrored",
      };
    }
    default: {
      // A referenceType the backend started emitting that this code has not
      // been taught about. Be loud about it so the bug surfaces.
      if (typeof window !== "undefined") {
        console.warn(
          `[movements] unknown referenceType "${referenceType}" with referenceId "${referenceId}". Frontend reference resolver needs a case for it.`,
        );
      }
      return {
        label: `${referenceType} ${referenceId ?? ""}`.trim(),
        href: null,
        state: "unknown",
      };
    }
  }
}
