"use client";

/**
 * Receipt conflict plugin. Registers itself on import for actionType
 * "unit.receipt".
 *
 *   DetailRenderer  Renders the structured exhaustive violations the backend
 *                   sends back via the sync intake (kind="constraint-violations").
 *                   The shape is identical to the direct-POST 5.5 endpoint,
 *                   so the named-violation rendering reads the data directly.
 *   ReOpener        Navigates the clerk to the receive form with a
 *                   ?resolveClientId=<clientId> query parameter. The receive
 *                   page detects this, loads the queued action from IDB,
 *                   fetches CURRENT manifest state, re-hydrates the form
 *                   with the original serial pairs, highlights the offending
 *                   cells from the conflict violations, and on submit
 *                   re-uses the SAME clientId (safe-by-retry).
 */
import type { ReceiptDuplicateViolation } from "@/lib/api";
import { registerConflictPlugin } from "../conflicts-registry";
import type { QueuedAction } from "../types";

type UnitReceiptPayload = {
  shipmentId: string;
  lines: { manifestLineId: string; units: { engineNumber: string; chassisNumber: string }[] }[];
};

type ReceiptConflictBody = {
  kind: "constraint-violations";
  violations: ReceiptDuplicateViolation[];
};

function ReceiptDetailRenderer({ action }: { action: QueuedAction }) {
  const body = action.conflictBody as ReceiptConflictBody | undefined;
  const violations = body?.violations ?? [];
  const payload = action.payload as UnitReceiptPayload;

  const totalSerials = payload.lines.reduce((s, l) => s + l.units.length, 0);

  return (
    <div className="space-y-4">
      <div className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-4 py-3">
        <div className="text-[12.5px] text-[var(--color-ink-700)] leading-[1.55]">
          <span className="font-semibold text-[var(--color-ink-900)]">Batch rejected.</span>{" "}
          The server received <span className="font-mono">{totalSerials}</span> serial pair
          {totalSerials === 1 ? "" : "s"} for shipment{" "}
          <span className="font-mono">{payload.shipmentId}</span>, found{" "}
          <span className="font-semibold text-[var(--color-danger-700)]">
            {violations.length} duplicate{violations.length === 1 ? "" : "s"}
          </span>
          , and rejected the entire batch (all-or-nothing). No units were created and no manifest
          counts changed.
        </div>
      </div>

      <div
        role="alert"
        className="rounded-[4px] border-2 overflow-hidden"
        style={{
          borderColor: "var(--color-danger-700)",
          background: "var(--color-danger-50)",
        }}
      >
        <div className="px-4 py-3">
          <div className="font-semibold text-[14px] text-[var(--color-danger-700)] mb-2">
            {violations.length === 1
              ? "1 duplicate detected"
              : `${violations.length} duplicates detected (across one or both unique fields)`}
            :
          </div>
          {violations.length === 0 ? (
            <div className="text-[12px] text-[var(--color-ink-700)]">
              No structured violation detail available on this conflict.
            </div>
          ) : (
            <ul className="text-[12px] text-[var(--color-ink-900)] list-disc list-inside space-y-1">
              {violations.map((v, i) => (
                <li key={i}>
                  <span className="font-mono font-semibold text-[var(--color-danger-700)] px-1.5 py-0.5 bg-white rounded-[2px] border border-[var(--color-danger-100)]">
                    {v.value}
                  </span>{" "}
                  on the{" "}
                  <span className="font-semibold">
                    {v.field === "engineNumber" ? "Engine Number" : "Chassis Number"}
                  </span>{" "}
                  field {" - "}
                  {v.kind === "IN_BATCH_DUP" ? (
                    <>
                      appears <span className="font-semibold">{v.rows.length} times</span> in this
                      batch (in-batch duplicate)
                    </>
                  ) : (
                    <>
                      already exists in the system{" "}
                      {v.rows.length > 1 && (
                        <>
                          (matched by <span className="font-semibold">{v.rows.length} rows</span>{" "}
                          here)
                        </>
                      )}
                    </>
                  )}
                  .
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-4 py-3">
        <h2 className="m-0 mb-2 text-[13px] font-semibold text-[var(--color-ink-900)]">
          What happens when you re-open
        </h2>
        <ol className="text-[12px] text-[var(--color-ink-700)] list-decimal list-inside space-y-1 leading-[1.5]">
          <li>
            The receive form opens against the current state of shipment{" "}
            <span className="font-mono">{payload.shipmentId}</span>. If another clerk received
            against this shipment since you submitted offline, you will see those updated manifest
            counts.
          </li>
          <li>
            Your original serial pairs are pre-filled. The offending cells are outlined in red,
            matching the violations above.
          </li>
          <li>
            Fix every flagged cell. When you submit, the corrected batch is re-attempted with the
            same client id, so the work is applied exactly once if it now succeeds.
          </li>
        </ol>
      </div>
    </div>
  );
}

const ReceiptReOpener = (
  action: QueuedAction,
  navigate: (href: string) => void,
) => {
  const payload = action.payload as UnitReceiptPayload;
  const href = `/procurement/shipments/${encodeURIComponent(payload.shipmentId)}/receive?resolveClientId=${encodeURIComponent(action.clientId)}`;
  navigate(href);
};

registerConflictPlugin({
  actionType: "unit.receipt",
  rowLabel: "Receive units",
  DetailRenderer: ReceiptDetailRenderer,
  ReOpener: ReceiptReOpener,
});

export {};
