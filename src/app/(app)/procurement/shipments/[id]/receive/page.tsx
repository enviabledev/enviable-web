"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import {
  flattenVariantOptions,
  getShipment,
  listProducts,
  parseReceiptConflict,
  receiveUnits,
  type ApiResult,
  type ManifestLine,
  type ProductWithVariants,
  type ReceiptDuplicateViolation,
  type ShipmentDetail,
} from "@/lib/api";
import { usePermissions } from "@/lib/auth";
import { queueUnitReceipt } from "@/lib/sync/actions/unit-receipt";
import { useConnectivity } from "@/lib/sync/connectivity";
import { syncEngine } from "@/lib/sync/engine";
import {
  getByClientId,
  resetForResubmit,
} from "@/lib/sync/queue";
import type { QueuedAction } from "@/lib/sync/types";

type Row = { key: string; engineNumber: string; chassisNumber: string };
type LinesDraft = Record<string, Row[]>; // manifestLineId -> rows

let nextKey = 0;
const k = () => `row-${++nextKey}`;
const emptyRow = (): Row => ({ key: k(), engineNumber: "", chassisNumber: "" });

type LoadState =
  | { status: "loading" }
  | { status: "ok"; shipment: ShipmentDetail }
  | { status: "not_found" }
  | { status: "forbidden" }
  | { status: "error"; message: string };

type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | {
      status: "rejected";
      message: string;
      classification: "duplicate" | "validation" | "conflict" | "other";
      // Structured violations from the exhaustive pre-flight. When present,
      // the panel lists every duplicate and the line cards highlight each
      // offending cell. Absent (legacy/fallback path): the panel falls back
      // to the single-serial extraction.
      violations?: ReceiptDuplicateViolation[];
    }
  | { status: "queued-offline" }
  | { status: "queued-resolved" }
  | { status: "error"; message: string };

const cellKey = (manifestLineId: string, unitIndex: number, field: "engineNumber" | "chassisNumber") =>
  `${manifestLineId}::${unitIndex}::${field}`;

export default function ReceiveUnitsPage() {
  const params = useParams<{ id: string }>();
  const sp = useSearchParams();
  const router = useRouter();
  const { has } = usePermissions();
  const id = decodeURIComponent(params.id);
  const { state: connState } = useConnectivity();

  // Resolve mode: the clerk re-opened a conflicted offline receipt from
  // /sync/conflicts. Loads the queued action and re-hydrates the draft from
  // its payload; submission updates the queued action with the corrected
  // payload (same clientId) and drains.
  const resolveClientId = sp.get("resolveClientId");

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [products, setProducts] = useState<ProductWithVariants[]>([]);
  const [draft, setDraft] = useState<LinesDraft>({});
  const [submit, setSubmit] = useState<SubmitState>({ status: "idle" });
  const [resolveAction, setResolveAction] = useState<QueuedAction | null>(null);
  // The conflict's structured violations carried on the queued action when
  // we're resolving. Drives the initial cell highlighting; replaced by a
  // fresh submit's violations if the corrected batch is still wrong.
  const [resolveViolations, setResolveViolations] = useState<
    ReceiptDuplicateViolation[] | null
  >(null);

  useEffect(() => {
    const ctrl = new AbortController();
    getShipment(id, ctrl.signal).then(async (r: ApiResult<ShipmentDetail>) => {
      if (ctrl.signal.aborted) return;
      if (r.kind === "ok") {
        setState({ status: "ok", shipment: r.data });
        if (resolveClientId) {
          // Re-hydrate from the queued action. Fetch the queue row, pre-fill
          // rows from action.payload.lines (the original serial pairs the
          // clerk submitted offline), surface the conflict's violations for
          // initial cell highlighting. The form below uses the CURRENT
          // manifest state from the shipment fetch we just did, so the
          // re-validation runs against reality-now, not the offline-captured
          // manifest from hours ago.
          const action = await getByClientId(resolveClientId);
          if (!action || action.type !== "unit.receipt") {
            setResolveAction(null);
          } else {
            setResolveAction(action);
            const body = action.conflictBody as
              | { kind?: string; violations?: ReceiptDuplicateViolation[] }
              | undefined;
            setResolveViolations(body?.violations ?? null);
            const payload = action.payload as {
              shipmentId: string;
              lines: { manifestLineId: string; units: { engineNumber: string; chassisNumber: string }[] }[];
            };
            const init: LinesDraft = {};
            // Seed every CURRENT manifest line with an empty draft (so each
            // line block renders), then overlay rows from the queued payload
            // where the manifestLineId is still present. Lines that vanished
            // (rare: another clerk's concurrent receipt closed the line)
            // simply have no pre-filled rows; the clerk sees the new state.
            for (const line of r.data.manifestLines) {
              init[line.id] = [];
            }
            for (const pl of payload.lines) {
              if (!(pl.manifestLineId in init)) continue;
              init[pl.manifestLineId] = pl.units.map((u) => ({
                key: k(),
                engineNumber: u.engineNumber,
                chassisNumber: u.chassisNumber,
              }));
            }
            setDraft(init);
          }
        } else {
          // Normal (non-resolve) entry: one empty row per outstanding line.
          const init: LinesDraft = {};
          for (const line of r.data.manifestLines) {
            const outstanding = line.quantityDeclared - line.quantityReceived;
            init[line.id] = outstanding > 0 ? [emptyRow()] : [];
          }
          setDraft(init);
        }
      } else if (r.kind === "not_found") setState({ status: "not_found" });
      else if (r.kind === "unauthorized") router.replace("/login");
      else if (r.kind === "forbidden") setState({ status: "forbidden" });
      else setState({ status: "error", message: "message" in r ? String(r.message) : "Error" });
    });
    listProducts(ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      if (r.kind === "ok") setProducts(r.data);
    });
    return () => ctrl.abort();
  }, [id, router, resolveClientId]);

  const variantsById = useMemo(() => {
    const m = new Map<string, ReturnType<typeof flattenVariantOptions>[number]>();
    for (const v of flattenVariantOptions(products)) m.set(v.productVariantId, v);
    return m;
  }, [products]);

  if (state.status === "loading") {
    return <div className="max-w-[1080px] mx-auto py-10 text-center text-[var(--color-ink-500)]">Loading shipment...</div>;
  }
  if (state.status === "not_found") {
    return <div className="max-w-[1080px] mx-auto py-10 text-center text-[var(--color-ink-500)]">Shipment not found.</div>;
  }
  if (state.status === "forbidden") {
    return <div className="max-w-[1080px] mx-auto py-10 text-center text-[var(--color-ink-500)]">You do not have access to this shipment.</div>;
  }
  if (state.status === "error") {
    return <div className="max-w-[1080px] mx-auto py-10 text-center text-[var(--color-danger-700)]">{state.message}</div>;
  }

  if (!has("shipment.receive")) {
    return (
      <div className="max-w-[920px] mx-auto py-10 text-center text-[var(--color-ink-500)]">
        You do not have permission to receive units on this shipment (requires shipment.receive).
      </div>
    );
  }

  const shipment = state.shipment;

  // Pre-compute the set of (manifestLineId, unitIndex, field) cells the
  // current rejected submission marked as duplicates. The LineBlock rows are
  // ordered to match unitIndex on the submitted payload (we strip blank rows
  // when building the payload; only filled rows get an index), so we have to
  // walk each line's rows in the same order to recover the index. The Set
  // membership check is O(1) per render of a row. In resolve mode the
  // initial highlights come from the conflict carried on the queued action;
  // they're cleared once the clerk submits a corrected batch.
  const highlightedCellsSet = (() => {
    const set = new Set<string>();
    const violations =
      submit.status === "rejected" && submit.violations
        ? submit.violations
        : submit.status === "idle" && resolveViolations
          ? resolveViolations
          : null;
    if (!violations) return set;
    for (const v of violations) {
      for (const row of v.rows) {
        set.add(cellKey(row.manifestLineId, row.unitIndex, v.field));
      }
    }
    return set;
  })();

  if (shipment.status !== "CLEARED") {
    return (
      <div className="max-w-[720px] mx-auto py-10">
        <div className="bg-white border border-[var(--color-warning-100)] rounded-[4px] px-5 py-4">
          <h2 className="m-0 mb-1 text-[14px] font-semibold text-[var(--color-warning-700)]">
            Shipment is not ready to receive
          </h2>
          <p className="text-[12.5px] text-[var(--color-ink-700)] m-0 mb-3">
            Units can only be received against a CLEARED shipment. Current status:{" "}
            <span className="font-mono font-semibold">{shipment.status}</span>.
          </p>
          <Link
            href={`/procurement/shipments/${shipment.id}`}
            className="inline-flex items-center h-8 px-3 rounded-[3px] text-[12.5px] font-medium text-white"
            style={{ background: "var(--color-navy-700)" }}
          >
            Back to shipment
          </Link>
        </div>
      </div>
    );
  }

  const setRows = (manifestLineId: string, rows: Row[]) =>
    setDraft((prev) => ({ ...prev, [manifestLineId]: rows }));

  const totalRowsWithBoth = Object.values(draft).reduce(
    (s, rows) => s + rows.filter((r) => r.engineNumber.trim() && r.chassisNumber.trim()).length,
    0,
  );
  const totalRowsAny = Object.values(draft).reduce(
    (s, rows) => s + rows.filter((r) => r.engineNumber.trim() || r.chassisNumber.trim()).length,
    0,
  );
  const hasPartialRow = totalRowsAny > totalRowsWithBoth;

  const handleSubmit = async (e: FormEvent) => {
      e.preventDefault();
      if (submit.status === "submitting") return;
      setSubmit({ status: "submitting" });

      // Collect only fully-filled rows; group by manifest line.
      const linesPayload: {
        manifestLineId: string;
        units: { engineNumber: string; chassisNumber: string }[];
      }[] = [];
      for (const [manifestLineId, rows] of Object.entries(draft)) {
        const units = rows
          .filter((r) => r.engineNumber.trim() && r.chassisNumber.trim())
          .map((r) => ({
            engineNumber: r.engineNumber.trim(),
            chassisNumber: r.chassisNumber.trim(),
          }));
        if (units.length > 0) linesPayload.push({ manifestLineId, units });
      }

      if (linesPayload.length === 0) {
        setSubmit({
          status: "rejected",
          classification: "validation",
          message: "Enter at least one engine/chassis pair before submitting.",
        });
        return;
      }

      // Mode A: resolve a previously-conflicted offline receipt. Update the
      // queued action with the corrected payload, reset its status to
      // queued, drain. The SAME clientId is preserved (safe-by-retry).
      if (resolveAction) {
        await resetForResubmit(resolveAction.clientId, {
          shipmentId: shipment.id,
          lines: linesPayload,
        });
        syncEngine.notifyChange();
        await syncEngine.drain();
        const after = await getByClientId(resolveAction.clientId);
        if (!after) {
          setSubmit({ status: "error", message: "Queued action vanished." });
          return;
        }
        if (after.status === "synced") {
          // Server confirmed (processed or duplicate). Conflict cleared.
          router.replace("/sync/conflicts");
          return;
        }
        if (after.status === "conflict") {
          const body = after.conflictBody as
            | { kind?: string; violations?: ReceiptDuplicateViolation[] }
            | undefined;
          const violations = body?.violations ?? [];
          setResolveViolations(violations);
          setSubmit({
            status: "rejected",
            classification: "duplicate",
            message: "Corrected batch still has duplicates against the current state.",
            violations,
          });
          return;
        }
        if (after.status === "queued" || after.status === "syncing") {
          // Offline mid-drain (or no connectivity at all). The corrected
          // payload is queued; it will drain when connectivity returns.
          setSubmit({ status: "queued-resolved" });
          return;
        }
        setSubmit({
          status: "error",
          message: after.errorMessage ?? "Sync failed.",
        });
        return;
      }

      // Mode B: fresh receipt, offline. Enqueue and tell the clerk it's
      // saved locally and will sync. Honest wording: NOT "received."
      if (connState === "offline") {
        await queueUnitReceipt({
          payload: { shipmentId: shipment.id, lines: linesPayload },
          description: `Receive ${linesPayload.reduce((s, l) => s + l.units.length, 0)} units against ${shipment.shipmentReference}`,
        });
        setSubmit({ status: "queued-offline" });
        return;
      }

      // Mode C: fresh receipt, online. Direct POST (unchanged from
      // prompt 5/5.5 to avoid any regression on the proven path).
      const r = await receiveUnits(shipment.id, { lines: linesPayload });
      if (r.kind === "ok") {
        router.replace(`/procurement/shipments/${shipment.id}`);
        return;
      }
      if (r.kind === "conflict") {
        const violations = parseReceiptConflict(r.body) ?? undefined;
        const lower = r.message.toLowerCase();
        const isDup =
          (violations && violations.length > 0) ||
          lower.includes("duplicate") ||
          lower.includes("already exists");
        const classification: "duplicate" | "conflict" = isDup ? "duplicate" : "conflict";
        setSubmit({ status: "rejected", classification, message: r.message, violations });
        return;
      }
      if (r.kind === "validation") {
        const msg = typeof r.message === "string" ? r.message : r.message.join("; ");
        setSubmit({ status: "rejected", classification: "validation", message: msg });
        return;
      }
      if (r.kind === "forbidden") {
        setSubmit({ status: "error", message: "You do not have permission to receive units." });
        return;
      }
      if (r.kind === "network_error") {
        // Connectivity flipped between the connState check and the POST.
        // Fall through to the offline-enqueue path so the clerk's work is
        // not lost.
        await queueUnitReceipt({
          payload: { shipmentId: shipment.id, lines: linesPayload },
          description: `Receive ${linesPayload.reduce((s, l) => s + l.units.length, 0)} units against ${shipment.shipmentReference}`,
        });
        setSubmit({ status: "queued-offline" });
        return;
      }
      setSubmit({ status: "error", message: "Unexpected response from the server." });
  };

  return (
    <div className="max-w-[1200px] mx-auto pb-10">
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
            <Link href={`/procurement/shipments/${shipment.id}`} className="text-[var(--color-ink-500)] hover:text-[var(--color-navy-700)] font-mono">
              {shipment.shipmentReference}
            </Link>
            <span className="text-[var(--color-ink-300)]">/</span>
            <span className="text-[var(--color-ink-900)] font-medium">Receive Units</span>
          </div>
          <h1 className="text-[24px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em]">
            {resolveAction ? (
              <>Resolve receipt conflict against <span className="font-mono">{shipment.shipmentReference}</span></>
            ) : (
              <>Receive units against <span className="font-mono">{shipment.shipmentReference}</span></>
            )}
          </h1>
          <div className="text-[13px] text-[var(--color-ink-500)] mt-1 max-w-[820px]">
            Enter the engine and chassis number for each unit you received against each manifest
            line. Submission is all-or-nothing: if any number is a duplicate (within this batch or
            against a unit already in the system), the entire batch is rejected and nothing is saved
            until you fix the offending pair and resubmit.
          </div>
        </div>
      </header>

      {resolveAction && (
        <div
          role="status"
          className="mb-4 px-3.5 py-2.5 rounded-[3px] border"
          style={{
            background: "var(--color-warning-100)",
            borderColor: "var(--color-warning-700)",
            color: "var(--color-warning-700)",
          }}
        >
          <div className="text-[12.5px] leading-[1.5]">
            <span className="font-semibold">Resolving a queued conflict.</span>{" "}
            Your original serial pairs from{" "}
            <span className="font-mono">
              {new Date(resolveAction.createdAt).toLocaleString(undefined, {
                month: "short",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>{" "}
            are pre-filled below against the current manifest state. Offending cells are outlined
            in red; fix them and resubmit. The same client id is reused so the corrected work is
            applied exactly once.
          </div>
        </div>
      )}

      {connState === "offline" && submit.status === "idle" && !resolveAction && (
        <div
          role="status"
          className="mb-4 px-3.5 py-2.5 rounded-[3px] border"
          style={{
            background: "var(--color-warning-100)",
            borderColor: "var(--color-warning-700)",
            color: "var(--color-warning-700)",
          }}
        >
          <div className="text-[12.5px] leading-[1.5]">
            <span className="font-semibold">You are offline.</span>{" "}
            Submitting will save the batch locally; the units are not received until the connection
            returns and the server processes the queued action. If the server rejects the batch as
            a duplicate, the conflict will appear at <span className="font-mono">/sync/conflicts</span>{" "}
            so you can re-open and fix it.
          </div>
        </div>
      )}

      {submit.status === "queued-offline" && (
        <div
          role="status"
          className="mb-4 px-3.5 py-2.5 rounded-[3px] border"
          style={{
            background: "var(--color-success-100)",
            borderColor: "var(--color-success-700)",
            color: "var(--color-success-700)",
          }}
        >
          <div className="text-[12.5px] leading-[1.5]">
            <span className="font-semibold">Saved locally, will sync.</span>{" "}
            The receipt is queued and will be processed by the server when the connection returns.
            The units are not received yet; you will see them on the shipment once the queued
            action syncs. The sync indicator in the topbar shows the current state.
          </div>
          <div className="mt-2 flex gap-2">
            <Link
              href={`/procurement/shipments/${shipment.id}`}
              className="h-7 px-3 inline-flex items-center rounded-[3px] text-[12px] font-medium text-white"
              style={{ background: "var(--color-success-700)" }}
            >
              Back to shipment
            </Link>
            <button
              type="button"
              onClick={() => {
                // Reset form for another offline entry.
                const init: LinesDraft = {};
                for (const line of shipment.manifestLines) {
                  const outstanding = line.quantityDeclared - line.quantityReceived;
                  init[line.id] = outstanding > 0 ? [emptyRow()] : [];
                }
                setDraft(init);
                setSubmit({ status: "idle" });
              }}
              className="h-7 px-3 rounded-[3px] text-[12px] font-medium border border-[var(--color-border-strong)] bg-white text-[var(--color-ink-700)] hover:bg-[var(--color-ink-100)]"
            >
              Receive more
            </button>
          </div>
        </div>
      )}

      {submit.status === "queued-resolved" && (
        <div
          role="status"
          className="mb-4 px-3.5 py-2.5 rounded-[3px] border"
          style={{
            background: "var(--color-success-100)",
            borderColor: "var(--color-success-700)",
            color: "var(--color-success-700)",
          }}
        >
          <div className="text-[12.5px] leading-[1.5]">
            <span className="font-semibold">Correction saved locally.</span>{" "}
            The corrected batch is queued under the same client id and will re-sync when the
            connection returns. The conflict will clear once the server processes it.
          </div>
          <div className="mt-2">
            <Link
              href="/sync/conflicts"
              className="h-7 px-3 inline-flex items-center rounded-[3px] text-[12px] font-medium text-white"
              style={{ background: "var(--color-success-700)" }}
            >
              Back to conflicts
            </Link>
          </div>
        </div>
      )}

      {submit.status === "rejected" && (
        <RejectedPanel
          message={submit.message}
          classification={submit.classification}
          violations={submit.status === "rejected" ? submit.violations : undefined}
          onDismiss={() => setSubmit({ status: "idle" })}
        />
      )}
      {submit.status === "error" && (
        <div
          role="alert"
          className="mb-4 px-3.5 py-2.5 rounded-[3px] border"
          style={{
            background: "var(--color-danger-50)",
            borderColor: "var(--color-danger-100)",
            color: "var(--color-danger-700)",
          }}
        >
          <div className="text-[12px]">{submit.message}</div>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        {shipment.manifestLines.map((line) => (
          <LineBlock
            key={line.id}
            line={line}
            variant={variantsById.get(line.productVariantId)}
            rows={draft[line.id] ?? []}
            onChange={(rows) => setRows(line.id, rows)}
            highlightedCells={highlightedCellsSet}
            legacyHighlightedSerial={
              !highlightedCellsSet.size &&
              submit.status === "rejected" &&
              submit.classification === "duplicate"
                ? extractDuplicateSerial(submit.message)
                : null
            }
          />
        ))}

        <div className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-4 py-3 flex items-center justify-between">
          <div className="text-[12.5px] text-[var(--color-ink-700)]">
            <span className="font-semibold text-[var(--color-ink-900)] tabular-nums">{totalRowsWithBoth}</span>{" "}
            pair{totalRowsWithBoth === 1 ? "" : "s"} ready to submit
            {hasPartialRow && (
              <span className="ml-2 text-[var(--color-warning-700)]">
                ({totalRowsAny - totalRowsWithBoth} row{totalRowsAny - totalRowsWithBoth === 1 ? "" : "s"} incomplete; only complete rows will be sent)
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Link
              href={resolveAction ? "/sync/conflicts" : `/procurement/shipments/${shipment.id}`}
              className="h-8 px-3 rounded-[3px] text-[12.5px] font-medium border border-[var(--color-border-strong)] bg-white text-[var(--color-ink-900)] hover:bg-[var(--color-ink-100)] inline-flex items-center"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={
                submit.status === "submitting" ||
                submit.status === "queued-offline" ||
                submit.status === "queued-resolved" ||
                totalRowsWithBoth === 0
              }
              className="h-8 px-4 rounded-[3px] text-[12.5px] font-medium text-white disabled:opacity-50 inline-flex items-center"
              style={{ background: "var(--color-navy-700)" }}
            >
              {submit.status === "submitting"
                ? resolveAction
                  ? "Resubmitting..."
                  : connState === "offline"
                    ? "Saving locally..."
                    : "Submitting..."
                : resolveAction
                  ? `Resubmit ${totalRowsWithBoth} unit${totalRowsWithBoth === 1 ? "" : "s"}`
                  : connState === "offline"
                    ? `Save ${totalRowsWithBoth} unit${totalRowsWithBoth === 1 ? "" : "s"} locally`
                    : `Submit ${totalRowsWithBoth} unit${totalRowsWithBoth === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

/**
 * The rejection panel is the most important UX element on this screen. The
 * backend's all-or-nothing duplicate rejection means NO units were saved when
 * this panel renders; the wording must leave no ambiguity about that.
 */
function RejectedPanel({
  message,
  classification,
  violations,
  onDismiss,
}: {
  message: string;
  classification: "duplicate" | "validation" | "conflict" | "other";
  violations?: ReceiptDuplicateViolation[];
  onDismiss: () => void;
}) {
  const isDuplicate = classification === "duplicate";
  const hasStructured = !!violations && violations.length > 0;
  const legacySerial = isDuplicate && !hasStructured ? extractDuplicateSerial(message) : null;
  return (
    <div
      role="alert"
      className="mb-5 rounded-[4px] border-2 overflow-hidden"
      style={{
        borderColor: "var(--color-danger-700)",
        background: "var(--color-danger-50)",
      }}
    >
      <div className="px-4 py-3 flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-[14px] text-[var(--color-danger-700)] mb-1.5">
            Batch rejected. Nothing was saved.
          </div>

          {hasStructured ? (
            <>
              <div className="text-[12.5px] text-[var(--color-ink-900)] mb-2">
                {violations!.length === 1
                  ? "1 duplicate detected in this batch:"
                  : `${violations!.length} duplicates detected in this batch (across one or both unique fields):`}
              </div>
              <ul className="text-[12px] text-[var(--color-ink-900)] list-disc list-inside space-y-1 mb-2">
                {violations!.map((v, i) => (
                  <li key={i}>
                    <span
                      className="font-mono font-semibold text-[var(--color-danger-700)] px-1.5 py-0.5 bg-white rounded-[2px] border border-[var(--color-danger-100)]"
                    >
                      {v.value}
                    </span>{" "}
                    on the{" "}
                    <span className="font-semibold">
                      {v.field === "engineNumber" ? "Engine Number" : "Chassis Number"}
                    </span>{" "}
                    field
                    {" — "}
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
                            (matched by <span className="font-semibold">{v.rows.length} rows</span> here)
                          </>
                        )}
                      </>
                    )}
                    .
                  </li>
                ))}
              </ul>
              <div className="text-[12px] text-[var(--color-ink-700)]">
                Each offending cell is outlined in red above. Fix every flagged cell, then resubmit
                the whole batch as one.
              </div>
            </>
          ) : (
            <>
              <div className="text-[12.5px] text-[var(--color-ink-900)] mb-2">
                {isDuplicate ? (
                  <>
                    The server rejected the receipt because of a duplicate serial number.
                    {legacySerial && (
                      <>
                        {" "}The offending value is{" "}
                        <span className="font-mono font-semibold text-[var(--color-danger-700)] px-1.5 py-0.5 bg-white rounded-[2px] border border-[var(--color-danger-100)]">
                          {legacySerial}
                        </span>
                        .
                      </>
                    )}
                  </>
                ) : classification === "validation" ? (
                  <>The server rejected the request as invalid.</>
                ) : (
                  <>The server rejected the action.</>
                )}
              </div>
              <div className="text-[12px] text-[var(--color-ink-700)] mb-2">
                <span className="font-medium">Server message:</span>{" "}
                <span className="font-mono">{message}</span>
              </div>
              <div className="text-[12px] text-[var(--color-ink-700)]">
                Because the receipt is all-or-nothing,{" "}
                <span className="font-semibold">no units were created and no manifest counts changed.</span>{" "}
                {isDuplicate
                  ? "Locate the row with that number above, correct it, and resubmit the whole batch."
                  : "Adjust the inputs above and resubmit."}
              </div>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-[11px] text-[var(--color-ink-500)] hover:text-[var(--color-ink-900)] flex-shrink-0"
          aria-label="Dismiss"
        >
          dismiss
        </button>
      </div>
    </div>
  );
}

/**
 * Backend messages take the form "engineNumber already exists: <value>",
 * "chassisNumber already exists: <value>", "Duplicate engineNumber in request
 * batch: <value>", or "Duplicate chassisNumber in request batch: <value>".
 * Pull the value off the end so we can highlight it in the panel.
 */
function extractDuplicateSerial(msg: string): string | null {
  const m = msg.match(/:\s*([A-Za-z0-9_\-]+)\s*$/);
  return m ? m[1] : null;
}

function LineBlock({
  line,
  variant,
  rows,
  onChange,
  highlightedCells,
  legacyHighlightedSerial,
}: {
  line: ManifestLine;
  variant: ReturnType<typeof flattenVariantOptions>[number] | undefined;
  rows: Row[];
  onChange: (rows: Row[]) => void;
  // Structured per-cell highlight from the exhaustive 409 (preferred path).
  // Keys are `${manifestLineId}::${unitIndex}::${field}`. The unitIndex
  // matches the SUBMITTED ordering: blank rows are not submitted, so we have
  // to recompute filled-row position when walking `rows` for display.
  highlightedCells: Set<string>;
  // Legacy single-serial highlight kept for the race-window fallback path
  // where the server returns the older single-message shape with no
  // structured violations. Used only when highlightedCells is empty.
  legacyHighlightedSerial: string | null;
}) {
  const outstanding = line.quantityDeclared - line.quantityReceived;
  const filled = rows.filter((r) => r.engineNumber.trim() && r.chassisNumber.trim()).length;
  // Per-row submitted index: filled rows get sequential 0-based indices in
  // the order they were submitted; blank rows get null and never highlight.
  const submittedIndexByRow = (() => {
    const out: (number | null)[] = [];
    let n = 0;
    for (const r of rows) {
      if (r.engineNumber.trim() && r.chassisNumber.trim()) {
        out.push(n);
        n++;
      } else {
        out.push(null);
      }
    }
    return out;
  })();

  const addRow = () => onChange([...rows, emptyRow()]);
  const removeRow = (key: string) => onChange(rows.filter((r) => r.key !== key));
  const setRow = (key: string, patch: Partial<Row>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const variantLabel = variant
    ? `${variant.productName} ${[variant.attributes.model, variant.attributes.colour].filter(Boolean).join(" ")}`
    : line.productVariantId;
  const sku = variant?.label.match(/\[(.*)\]/)?.[1] ?? line.productVariantId;

  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] mb-4">
      <header className="px-4 py-2.5 border-b border-[var(--color-border-default)] flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)] truncate">
            {variantLabel}
          </h3>
          <div className="font-mono text-[10.5px] text-[var(--color-ink-500)] mt-0.5">{sku}</div>
        </div>
        <div className="flex items-center gap-5 text-[12px] flex-shrink-0">
          <Counter label="Declared" value={line.quantityDeclared} />
          <Counter label="Already received" value={line.quantityReceived} />
          <Counter label="Outstanding" value={outstanding} tone={outstanding === 0 ? "muted" : "default"} />
          <Counter
            label="Entered this batch"
            value={filled}
            tone={filled > outstanding ? "warning" : filled === outstanding && outstanding > 0 ? "success" : "default"}
          />
          <button
            type="button"
            onClick={addRow}
            className="h-7 px-2.5 rounded-[3px] text-[12px] font-medium border border-[var(--color-border-strong)] bg-white text-[var(--color-navy-700)] hover:bg-[var(--color-navy-50)]"
          >
            + Add row
          </button>
        </div>
      </header>
      {rows.length === 0 ? (
        <div className="px-4 py-5 text-[12.5px] text-[var(--color-ink-500)] text-center">
          No rows for this line. Click + Add row to enter units.
        </div>
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr>
              <th className="w-[40px] bg-[var(--color-ink-100)] border-b border-[var(--color-border-default)]" />
              <th className="text-left font-medium text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] px-3 py-2 border-b border-[var(--color-border-default)] bg-[var(--color-ink-100)]">
                Engine Number
              </th>
              <th className="text-left font-medium text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] px-3 py-2 border-b border-[var(--color-border-default)] bg-[var(--color-ink-100)]">
                Chassis Number
              </th>
              <th className="w-[40px] bg-[var(--color-ink-100)] border-b border-[var(--color-border-default)]" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const submitted = submittedIndexByRow[idx];
              const cellHitEngine =
                submitted !== null &&
                highlightedCells.has(cellKey(line.id, submitted, "engineNumber"));
              const cellHitChassis =
                submitted !== null &&
                highlightedCells.has(cellKey(line.id, submitted, "chassisNumber"));
              // Legacy fallback: single-serial value match, used only when the
              // structured path produced no cells (race-window backstop path).
              const legacyEng =
                highlightedCells.size === 0 &&
                legacyHighlightedSerial !== null &&
                r.engineNumber.trim() === legacyHighlightedSerial;
              const legacyCha =
                highlightedCells.size === 0 &&
                legacyHighlightedSerial !== null &&
                r.chassisNumber.trim() === legacyHighlightedSerial;
              const engineIsDup = cellHitEngine || legacyEng;
              const chassisIsDup = cellHitChassis || legacyCha;
              return (
                <tr key={r.key} className="border-b border-[var(--color-border-default)]">
                  <td className="px-2 py-1.5 text-right text-[10.5px] tabular-nums text-[var(--color-ink-400)]">
                    {idx + 1}
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="text"
                      value={r.engineNumber}
                      onChange={(e) => setRow(r.key, { engineNumber: e.target.value.toUpperCase() })}
                      placeholder="e.g. TVSKGS25E0001234"
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      style={{ textTransform: "uppercase" }}
                      className={`h-7 w-full px-2 font-mono text-[12px] tracking-[0.02em] text-[var(--color-ink-900)] bg-white border rounded-[3px] focus:outline-none focus:shadow-[0_0_0_2px_rgba(31,78,121,0.14)] ${
                        engineIsDup
                          ? "border-[var(--color-danger-700)] bg-[var(--color-danger-50)] focus:border-[var(--color-danger-700)]"
                          : "border-[var(--color-border-strong)] focus:border-[var(--color-navy-700)]"
                      }`}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="text"
                      value={r.chassisNumber}
                      onChange={(e) => setRow(r.key, { chassisNumber: e.target.value.toUpperCase() })}
                      placeholder="e.g. MD3TVSGS25C0001234"
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      style={{ textTransform: "uppercase" }}
                      className={`h-7 w-full px-2 font-mono text-[12px] tracking-[0.02em] text-[var(--color-ink-900)] bg-white border rounded-[3px] focus:outline-none focus:shadow-[0_0_0_2px_rgba(31,78,121,0.14)] ${
                        chassisIsDup
                          ? "border-[var(--color-danger-700)] bg-[var(--color-danger-50)] focus:border-[var(--color-danger-700)]"
                          : "border-[var(--color-border-strong)] focus:border-[var(--color-navy-700)]"
                      }`}
                    />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <button
                      type="button"
                      onClick={() => removeRow(r.key)}
                      title="Remove row"
                      className="w-6 h-6 grid place-items-center rounded-[3px] text-[var(--color-ink-500)] hover:bg-[var(--color-danger-50)] hover:text-[var(--color-danger-700)]"
                    >
                      &times;
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Counter({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "success" | "warning" | "muted";
}) {
  const cls =
    tone === "success"
      ? "text-[var(--color-success-700)]"
      : tone === "warning"
        ? "text-[var(--color-warning-700)]"
        : tone === "muted"
          ? "text-[var(--color-ink-400)]"
          : "text-[var(--color-ink-900)]";
  return (
    <div className="flex flex-col items-end leading-tight">
      <span className="text-[9.5px] uppercase tracking-[0.05em] text-[var(--color-ink-500)] font-medium">
        {label}
      </span>
      <span className={`font-mono tabular-nums text-[14px] font-semibold ${cls}`}>{value}</span>
    </div>
  );
}
