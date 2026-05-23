"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import {
  flattenVariantOptions,
  getShipment,
  listProducts,
  receiveUnits,
  type ApiResult,
  type ManifestLine,
  type ProductWithVariants,
  type ShipmentDetail,
} from "@/lib/api";
import { usePermissions } from "@/lib/auth";

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
  | { status: "rejected"; message: string; classification: "duplicate" | "validation" | "conflict" | "other" }
  | { status: "error"; message: string };

export default function ReceiveUnitsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { has } = usePermissions();
  const id = decodeURIComponent(params.id);

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [products, setProducts] = useState<ProductWithVariants[]>([]);
  const [draft, setDraft] = useState<LinesDraft>({});
  const [submit, setSubmit] = useState<SubmitState>({ status: "idle" });

  useEffect(() => {
    const ctrl = new AbortController();
    getShipment(id, ctrl.signal).then((r: ApiResult<ShipmentDetail>) => {
      if (ctrl.signal.aborted) return;
      if (r.kind === "ok") {
        setState({ status: "ok", shipment: r.data });
        // Initialize one empty row per manifest line that has outstanding to receive.
        const init: LinesDraft = {};
        for (const line of r.data.manifestLines) {
          const outstanding = line.quantityDeclared - line.quantityReceived;
          init[line.id] = outstanding > 0 ? [emptyRow()] : [];
        }
        setDraft(init);
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
  }, [id, router]);

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
    const linesPayload: { manifestLineId: string; units: { engineNumber: string; chassisNumber: string }[] }[] = [];
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

    const r = await receiveUnits(shipment.id, { lines: linesPayload });
    if (r.kind === "ok") {
      // Route back to detail; the user sees updated manifest counts and the new units.
      router.replace(`/procurement/shipments/${shipment.id}`);
      return;
    }
    if (r.kind === "conflict") {
      const lower = r.message.toLowerCase();
      const classification: "duplicate" | "conflict" = lower.includes("duplicate") || lower.includes("already exists") ? "duplicate" : "conflict";
      setSubmit({ status: "rejected", classification, message: r.message });
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
      setSubmit({ status: "error", message: r.message });
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
            Receive units against <span className="font-mono">{shipment.shipmentReference}</span>
          </h1>
          <div className="text-[13px] text-[var(--color-ink-500)] mt-1 max-w-[820px]">
            Enter the engine and chassis number for each unit you received against each manifest
            line. Submission is all-or-nothing: if any number is a duplicate (within this batch or
            against a unit already in the system), the entire batch is rejected and nothing is saved
            until you fix the offending pair and resubmit.
          </div>
        </div>
      </header>

      {submit.status === "rejected" && (
        <RejectedPanel
          message={submit.message}
          classification={submit.classification}
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
            highlightedSerial={
              submit.status === "rejected" && submit.classification === "duplicate"
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
              href={`/procurement/shipments/${shipment.id}`}
              className="h-8 px-3 rounded-[3px] text-[12.5px] font-medium border border-[var(--color-border-strong)] bg-white text-[var(--color-ink-900)] hover:bg-[var(--color-ink-100)] inline-flex items-center"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={submit.status === "submitting" || totalRowsWithBoth === 0}
              className="h-8 px-4 rounded-[3px] text-[12.5px] font-medium text-white disabled:opacity-50 inline-flex items-center"
              style={{ background: "var(--color-navy-700)" }}
            >
              {submit.status === "submitting"
                ? "Submitting..."
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
  onDismiss,
}: {
  message: string;
  classification: "duplicate" | "validation" | "conflict" | "other";
  onDismiss: () => void;
}) {
  const isDuplicate = classification === "duplicate";
  const dupSerial = isDuplicate ? extractDuplicateSerial(message) : null;
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
        <div>
          <div className="font-semibold text-[14px] text-[var(--color-danger-700)] mb-1.5">
            Batch rejected. Nothing was saved.
          </div>
          <div className="text-[12.5px] text-[var(--color-ink-900)] mb-2">
            {isDuplicate ? (
              <>
                The server rejected the receipt because of a duplicate serial number.
                {dupSerial && (
                  <>
                    {" "}The offending value is{" "}
                    <span className="font-mono font-semibold text-[var(--color-danger-700)] px-1.5 py-0.5 bg-white rounded-[2px] border border-[var(--color-danger-100)]">
                      {dupSerial}
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
  highlightedSerial,
}: {
  line: ManifestLine;
  variant: ReturnType<typeof flattenVariantOptions>[number] | undefined;
  rows: Row[];
  onChange: (rows: Row[]) => void;
  highlightedSerial: string | null;
}) {
  const outstanding = line.quantityDeclared - line.quantityReceived;
  const filled = rows.filter((r) => r.engineNumber.trim() && r.chassisNumber.trim()).length;

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
              const engineIsDup = highlightedSerial !== null && r.engineNumber.trim() === highlightedSerial;
              const chassisIsDup = highlightedSerial !== null && r.chassisNumber.trim() === highlightedSerial;
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
