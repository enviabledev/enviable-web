"use client";

/**
 * /admin/historical-load
 *
 * IT Admin tool for bulk-loading pre-existing inventory into the system: the
 * one-off historical arrivals and spare-part stock that pre-date the workflow
 * but need to exist as queryable rows in the database. Gated historicalload.run
 * (class-level on the controller; only IT Admin holds it currently).
 *
 * Three handlers, three distinct sections on this page:
 *
 *   1. Historical Shipment (JSON form). Creates PO + PI + Shipment in one
 *      transaction, directly in terminal states (PO CLOSED, PI ACTIVE,
 *      Shipment RECEIVED) with isHistoricalImport=true. NO dry-run mode;
 *      direct create. Returns the new shipment id (needed as the parent
 *      for handler 2). Section copies the new shipmentId into the next
 *      section's input automatically so the workflow chains.
 *
 *   2. Historical Units (CSV upload + dry-run/commit). Bulk-creates Units
 *      and their paired RECEIPT StockMovements under an existing Shipment
 *      (typically one just created in section 1). CSV columns:
 *      productVariantSku, engineNumber, chassisNumber. Validates: missing
 *      fields, unknown SKUs, in-file dupes, against-DB dupes. All-or-
 *      nothing commit: any error rejects the whole batch.
 *
 *   3. Historical Spare Parts (CSV upload + dry-run/commit). Bulk-upserts
 *      SparePart catalogue rows, incrementing quantityOnHand by sku. CSV
 *      columns: sku, name, quantity. Validates: missing fields, non-
 *      positive-integer quantity. Same all-or-nothing semantics.
 *
 * Bulk-admin framing: this screen bypasses the usual workflow (creating
 * units via historical-load is NOT the same as creating them via the
 * receipt flow). The honest visual treatment is amber-toned banners
 * explaining the bulk-admin nature, dry-run-first affordances (commit is
 * disabled until a successful dry-run lands), and a consequence-
 * explaining confirmation dialog before any commit fires.
 *
 * Dry-run is the safety property. The commit button is enabled ONLY after
 * a dry-run that reports zero errors against the currently-selected file;
 * changing the file or context resets the gate. The user cannot click
 * commit on a file that hasn't been validated by the backend first.
 */
import { useEffect, useState } from "react";

import { HistoricalLoadIcon } from "@/components/icons";
import Modal from "@/components/ui/Modal";
import {
  createHistoricalShipment,
  listCounterparties,
  loadHistoricalSpareParts,
  loadHistoricalUnits,
  type Counterparty,
  type CreatedHistoricalShipment,
  type HistoricalLoadReport,
} from "@/lib/api";
import { isTransientFailure } from "@/lib/api/client";
import { usePermissions } from "@/lib/auth";

export default function HistoricalLoadPage() {
  const { has } = usePermissions();
  const canRun = has("historicalload.run");

  // Cross-section state: the shipment id created in section 1 flows
  // automatically into section 2's "Shipment id" field as a convenience.
  const [createdShipmentId, setCreatedShipmentId] = useState<string>("");

  if (!canRun) {
    return (
      <div className="max-w-[640px] mx-auto py-12">
        <div className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-6 py-8 text-center">
          <h1 className="text-[18px] font-semibold text-[var(--color-ink-900)] m-0 mb-2">
            Access denied
          </h1>
          <p className="text-[13px] text-[var(--color-ink-700)] m-0">
            You do not have access to historical-load. This screen requires the
            <span className="font-mono mx-1">historicalload.run</span> permission, which is held
            by IT Admin only. Historical-load loads pre-existing inventory directly into the
            database, bypassing the receipt and assembly workflows; gating it narrowly is
            deliberate.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1100px] mx-auto pb-10">
      <header className="flex items-end justify-between gap-6 pb-4 mb-4 border-b border-[var(--color-border-default)]">
        <div>
          <div className="text-[12px] text-[var(--color-ink-500)] mb-1.5">Admin / Historical data load</div>
          <h1 className="text-[22px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em] flex items-center gap-2">
            <HistoricalLoadIcon className="w-[18px] h-[18px] text-[var(--color-ink-500)]" />
            Historical data load
          </h1>
          <div className="text-[12.5px] text-[var(--color-ink-500)] mt-1 max-w-[860px]">
            Bulk-load pre-existing inventory into the system. These operations bypass the
            receipt and assembly workflows; entities created here are marked
            <span className="font-mono mx-1">isHistoricalImport=true</span>. Use only for
            one-off historical imports and data migrations; routine inbound flow goes through
            the usual receipt screens.
          </div>
        </div>
      </header>

      <BulkAdminWarning />

      <div className="grid gap-4">
        <ShipmentSection onCreated={setCreatedShipmentId} />
        <UnitsSection initialShipmentId={createdShipmentId} />
        <SparePartsSection />
      </div>
    </div>
  );
}

function BulkAdminWarning() {
  return (
    <div
      className="flex items-start gap-2 px-3.5 py-2.5 rounded-[3px] border mb-4"
      style={{
        background: "var(--color-warning-100)",
        borderColor: "var(--color-warning-700)",
      }}
    >
      <span
        aria-hidden
        className="mt-[5px] w-[6px] h-[6px] rounded-full flex-shrink-0"
        style={{ background: "var(--color-warning-700)" }}
      />
      <div className="text-[12px] text-[var(--color-ink-900)] leading-[1.5]">
        <span className="font-semibold" style={{ color: "var(--color-warning-700)" }}>
          Bulk admin operations.
        </span>{" "}
        Loads write directly to the database, bypassing the workflow checks (status
        transitions, capacity, payment coverage) that the regular screens enforce. A bad load
        is difficult to roll back. Always run a dry-run first; the commit button stays
        disabled until a clean dry-run lands. Your user id is attributed on every row written.
      </div>
    </div>
  );
}

// =====================================================================
// SECTION 1: Historical Shipment (form, no dry-run)
// =====================================================================

type ShipmentFormState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success"; result: CreatedHistoricalShipment }
  | { status: "error"; message: string };

function ShipmentSection({ onCreated }: { onCreated: (shipmentId: string) => void }) {
  const [suppliers, setSuppliers] = useState<Counterparty[]>([]);
  const [form, setForm] = useState({
    supplierId: "",
    currency: "USD",
    piNumber: "",
    totalValue: "",
    poNumber: "",
    shipmentReference: "",
    vesselName: "",
    billOfLadingNumber: "",
    etd: "",
    eta: "",
    arrivalDate: "",
  });
  const [state, setState] = useState<ShipmentFormState>({ status: "idle" });
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listCounterparties({ type: "SUPPLIER", status: "ACTIVE" }).then((r) => {
      if (cancelled) return;
      if (r.kind === "ok") {
        setSuppliers(r.data);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async () => {
    setState({ status: "submitting" });
    const body = {
      supplierId: form.supplierId,
      currency: form.currency,
      piNumber: form.piNumber,
      ...(form.totalValue ? { totalValue: form.totalValue } : {}),
      ...(form.poNumber ? { poNumber: form.poNumber } : {}),
      ...(form.shipmentReference ? { shipmentReference: form.shipmentReference } : {}),
      ...(form.vesselName ? { vesselName: form.vesselName } : {}),
      ...(form.billOfLadingNumber ? { billOfLadingNumber: form.billOfLadingNumber } : {}),
      ...(form.etd ? { etd: new Date(`${form.etd}T00:00:00.000Z`).toISOString() } : {}),
      ...(form.eta ? { eta: new Date(`${form.eta}T00:00:00.000Z`).toISOString() } : {}),
      ...(form.arrivalDate
        ? { arrivalDate: new Date(`${form.arrivalDate}T00:00:00.000Z`).toISOString() }
        : {}),
    };
    const r = await createHistoricalShipment(body);
    if (r.kind === "ok") {
      setState({ status: "success", result: r.data });
      onCreated(r.data.id);
    } else if (r.kind === "validation") {
      setState({
        status: "error",
        message: typeof r.message === "string" ? r.message : r.message.join("; "),
      });
    } else if (r.kind === "forbidden") {
      setState({ status: "error", message: "You do not have access to this operation." });
    } else if (isTransientFailure(r)) {
      setState({
        status: "error",
        message: "Could not reach the server. Try again when connectivity returns.",
      });
    } else {
      setState({ status: "error", message: "Could not create historical shipment." });
    }
  };

  const canSubmit =
    form.supplierId.length > 0 &&
    form.currency.length > 0 &&
    form.piNumber.length > 0 &&
    state.status !== "submitting";

  return (
    <Section
      title="Historical shipment"
      description="Create a one-off PO + PI + Shipment as a historical arrival. The shipment is created directly in RECEIVED state. Once it exists, load its units via the section below using the returned shipment id."
    >
      <div className="grid grid-cols-2 gap-3 mb-3">
        <Field label="Supplier (required)">
          <select
            value={form.supplierId}
            onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
            data-testid="hist-shipment-supplierId"
            className="h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px]"
          >
            <option value="">Select a supplier...</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Currency (required)">
          <input
            type="text"
            value={form.currency}
            onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
            data-testid="hist-shipment-currency"
            className="h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] font-mono"
            placeholder="USD"
          />
        </Field>
        <Field label="PI number (required)">
          <input
            type="text"
            value={form.piNumber}
            onChange={(e) => setForm({ ...form, piNumber: e.target.value })}
            data-testid="hist-shipment-piNumber"
            className="h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] font-mono"
            placeholder="PI-HIST-001"
          />
        </Field>
        <Field label="Total value (optional)">
          <input
            type="text"
            value={form.totalValue}
            onChange={(e) => setForm({ ...form, totalValue: e.target.value })}
            className="h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] font-mono"
            placeholder="0.00"
          />
        </Field>
        <Field label="PO number (auto-generated if blank)">
          <input
            type="text"
            value={form.poNumber}
            onChange={(e) => setForm({ ...form, poNumber: e.target.value })}
            className="h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] font-mono"
          />
        </Field>
        <Field label="Shipment reference (auto-generated if blank)">
          <input
            type="text"
            value={form.shipmentReference}
            onChange={(e) => setForm({ ...form, shipmentReference: e.target.value })}
            className="h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] font-mono"
          />
        </Field>
        <Field label="Vessel name (optional)">
          <input
            type="text"
            value={form.vesselName}
            onChange={(e) => setForm({ ...form, vesselName: e.target.value })}
            className="h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px]"
          />
        </Field>
        <Field label="Bill of lading (optional)">
          <input
            type="text"
            value={form.billOfLadingNumber}
            onChange={(e) => setForm({ ...form, billOfLadingNumber: e.target.value })}
            className="h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] font-mono"
          />
        </Field>
        <Field label="ETD (optional)">
          <input
            type="date"
            value={form.etd}
            onChange={(e) => setForm({ ...form, etd: e.target.value })}
            className="h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px]"
          />
        </Field>
        <Field label="ETA (optional)">
          <input
            type="date"
            value={form.eta}
            onChange={(e) => setForm({ ...form, eta: e.target.value })}
            className="h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px]"
          />
        </Field>
        <Field label="Arrival date (optional)">
          <input
            type="date"
            value={form.arrivalDate}
            onChange={(e) => setForm({ ...form, arrivalDate: e.target.value })}
            className="h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px]"
          />
        </Field>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={!canSubmit}
          data-testid="hist-shipment-commit"
          className="h-[28px] px-4 rounded-[3px] bg-[var(--color-navy-700)] text-white text-[12.5px] font-medium disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {state.status === "submitting" ? "Creating..." : "Create historical shipment"}
        </button>
        {state.status === "success" && (
          <span className="text-[12px] text-[var(--color-success-700)]" data-testid="hist-shipment-success">
            Created shipment {state.result.shipment.shipmentReference} (id{" "}
            <span className="font-mono">{state.result.id}</span>); flowed into the units section.
          </span>
        )}
        {state.status === "error" && (
          <span className="text-[12px] text-[var(--color-danger-700)]" data-testid="hist-shipment-error">
            {state.message}
          </span>
        )}
      </div>

      {confirming && (
        <ConfirmDialog
          title="Create historical shipment?"
          body={
            <>
              This creates a Purchase Order, Proforma Invoice, and Shipment directly in
              terminal states, marked as historical imports. The action is attributed to your
              user id and recorded in the audit log. It is NOT reversible through the UI.
            </>
          }
          confirmLabel="Create historical shipment"
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            setConfirming(false);
            await submit();
          }}
        />
      )}
    </Section>
  );
}

// =====================================================================
// SECTION 2: Historical Units (CSV upload + dry-run/commit)
// =====================================================================

function UnitsSection({ initialShipmentId }: { initialShipmentId: string }) {
  return (
    <CsvUploadSection
      title="Historical units"
      description="Bulk-create Units (with paired RECEIPT stock movements) under an existing Shipment. CSV columns: productVariantSku, engineNumber, chassisNumber. Validation is all-or-nothing: any row error rejects the whole commit."
      csvColumns={["productVariantSku", "engineNumber", "chassisNumber"]}
      requiresShipmentId
      initialShipmentId={initialShipmentId}
      kind="units"
    />
  );
}

// =====================================================================
// SECTION 3: Historical Spare Parts (CSV upload + dry-run/commit)
// =====================================================================

function SparePartsSection() {
  return (
    <CsvUploadSection
      title="Historical spare parts"
      description="Bulk-upsert SparePart catalogue rows (incrementing quantityOnHand by sku). CSV columns: sku, name, quantity. New SKUs are created; existing SKUs have their quantity added to."
      csvColumns={["sku", "name", "quantity"]}
      requiresShipmentId={false}
      initialShipmentId=""
      kind="spareParts"
    />
  );
}

// =====================================================================
// Shared CSV upload section (units + spare parts)
// =====================================================================

type CsvUploadState =
  | { status: "idle" }
  | { status: "running"; mode: "dry" | "commit" }
  | {
      status: "dry-ok";
      report: HistoricalLoadReport;
      forFileName: string;
      forShipmentId: string;
    }
  | { status: "dry-errors"; report: HistoricalLoadReport; message: string }
  | { status: "commit-ok"; created: number }
  | { status: "commit-errors"; report: HistoricalLoadReport; message: string }
  | { status: "error"; message: string };

function CsvUploadSection({
  title,
  description,
  csvColumns,
  requiresShipmentId,
  initialShipmentId,
  kind,
}: {
  title: string;
  description: string;
  csvColumns: string[];
  requiresShipmentId: boolean;
  initialShipmentId: string;
  kind: "units" | "spareParts";
}) {
  const [shipmentId, setShipmentId] = useState(initialShipmentId);
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<CsvUploadState>({ status: "idle" });
  const [confirming, setConfirming] = useState(false);

  // Auto-flow new shipmentId from section 1 into section 2.
  useEffect(() => {
    if (requiresShipmentId && initialShipmentId) {
      setShipmentId(initialShipmentId);
      // Reset any prior dry-run when the context changes.
      setState({ status: "idle" });
    }
  }, [initialShipmentId, requiresShipmentId]);

  const dryRunDisabled =
    !file || (requiresShipmentId && !shipmentId) || state.status === "running";

  // Commit is enabled ONLY after a successful dry-run against THIS file
  // and shipmentId. Any change to file or shipmentId resets the gate.
  const commitGated =
    state.status === "dry-ok" &&
    state.forFileName === (file?.name ?? "") &&
    state.forShipmentId === shipmentId;

  const runLoad = async (mode: "dry" | "commit") => {
    if (!file) return;
    setState({ status: "running", mode });
    const result =
      kind === "units"
        ? await loadHistoricalUnits(shipmentId, file, mode === "dry")
        : await loadHistoricalSpareParts(file, mode === "dry");

    if (result.kind === "ok") {
      // Two shapes returned from "ok":
      //  - dry-run: the validation report (errorCount may be 0 or >0)
      //  - commit: the commit result (created, totalRows for units)
      if ("errorCount" in result.data) {
        const report = result.data as HistoricalLoadReport;
        if (mode === "dry") {
          if (report.errorCount === 0) {
            setState({
              status: "dry-ok",
              report,
              forFileName: file.name,
              forShipmentId: shipmentId,
            });
          } else {
            setState({
              status: "dry-errors",
              report,
              message: `${report.errorCount} validation error${report.errorCount === 1 ? "" : "s"} across ${report.totalRows} rows.`,
            });
          }
        } else {
          // commit returned a report (shouldn't happen in success path)
          setState({ status: "commit-ok", created: report.validRows });
        }
      } else {
        const commit = result.data as { created: number };
        setState({ status: "commit-ok", created: commit.created });
      }
    } else if (result.kind === "validation_report") {
      // Backend rejected with structured report (either dry-run with
      // errors or commit-with-errors).
      setState({
        status: mode === "dry" ? "dry-errors" : "commit-errors",
        report: result.report,
        message: result.message,
      });
    } else if (result.kind === "forbidden") {
      setState({ status: "error", message: "You do not have access to this operation." });
    } else if (isTransientFailure(result)) {
      setState({
        status: "error",
        message: "Could not reach the server. Try again when connectivity returns.",
      });
    } else if (result.kind === "validation") {
      setState({
        status: "error",
        message:
          typeof result.message === "string" ? result.message : result.message.join("; "),
      });
    } else {
      setState({ status: "error", message: "Could not perform the load." });
    }
  };

  return (
    <Section title={title} description={description}>
      <div className="text-[11px] text-[var(--color-ink-500)] font-mono mb-2">
        Expected columns: {csvColumns.join(", ")}
      </div>

      {requiresShipmentId && (
        <Field label="Shipment id (required)">
          <input
            type="text"
            value={shipmentId}
            onChange={(e) => {
              setShipmentId(e.target.value);
              setState({ status: "idle" });
            }}
            data-testid={`hist-${kind}-shipmentId`}
            className="h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] font-mono w-full max-w-[400px]"
            placeholder="paste from above, or use the shipment created in section 1"
          />
        </Field>
      )}

      <Field label="CSV file">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFile(f);
            setState({ status: "idle" });
          }}
          data-testid={`hist-${kind}-file`}
          className="text-[12.5px] text-[var(--color-ink-900)]"
        />
      </Field>

      <div className="flex items-center gap-2 mt-3">
        <button
          type="button"
          onClick={() => runLoad("dry")}
          disabled={dryRunDisabled}
          data-testid={`hist-${kind}-dry`}
          className="h-[28px] px-4 rounded-[3px] border border-[var(--color-navy-700)] text-[var(--color-navy-700)] text-[12.5px] font-medium bg-white disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {state.status === "running" && state.mode === "dry" ? "Running..." : "Run dry-run"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={!commitGated}
          data-testid={`hist-${kind}-commit`}
          className="h-[28px] px-4 rounded-[3px] bg-[var(--color-danger-700)] text-white text-[12.5px] font-medium disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {state.status === "running" && state.mode === "commit"
            ? "Committing..."
            : "Commit load"}
        </button>
        {!commitGated && state.status !== "running" && (
          <span className="text-[11px] text-[var(--color-ink-500)]" data-testid={`hist-${kind}-commit-gate`}>
            Commit is locked until a dry-run with zero errors lands for this file
            {requiresShipmentId ? " and shipment id" : ""}.
          </span>
        )}
      </div>

      <ResultPanel state={state} kind={kind} />

      {confirming && (
        <ConfirmDialog
          title={`Commit ${title.toLowerCase()}?`}
          body={
            <>
              This will write{" "}
              {state.status === "dry-ok" ? (
                <strong>{state.report.validRows}</strong>
              ) : (
                "all valid rows"
              )}{" "}
              from the file{" "}
              <strong className="font-mono">{file?.name ?? ""}</strong>
              {requiresShipmentId ? (
                <>
                  {" "}
                  under shipment <strong className="font-mono">{shipmentId}</strong>
                </>
              ) : null}
              . The write is attributed to your user id and recorded in the audit log. It is
              NOT reversible through the UI.
            </>
          }
          confirmLabel={`Commit ${title.toLowerCase()}`}
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            setConfirming(false);
            await runLoad("commit");
          }}
        />
      )}
    </Section>
  );
}

function ResultPanel({
  state,
  kind,
}: {
  state: CsvUploadState;
  kind: "units" | "spareParts";
}) {
  if (state.status === "idle" || state.status === "running") return null;

  if (state.status === "error") {
    return (
      <div
        className="mt-3 px-3 py-2 rounded-[3px] text-[12px] bg-[var(--color-danger-100)] text-[var(--color-danger-700)] border border-[var(--color-danger-700)]"
        data-testid={`hist-${kind}-result-error`}
      >
        {state.message}
      </div>
    );
  }

  if (state.status === "commit-ok") {
    return (
      <div
        className="mt-3 px-3 py-2 rounded-[3px] text-[12px] bg-[var(--color-success-100)] text-[var(--color-success-700)] border border-[var(--color-success-700)]"
        data-testid={`hist-${kind}-result-commit-ok`}
      >
        Commit successful. {state.created} row{state.created === 1 ? "" : "s"} written.
      </div>
    );
  }

  // Dry-ok, dry-errors, commit-errors all carry a report
  const isOk = state.status === "dry-ok";
  return (
    <div
      className={`mt-3 px-3 py-2 rounded-[3px] text-[12px] border ${
        isOk
          ? "bg-[var(--color-success-100)] text-[var(--color-success-700)] border-[var(--color-success-700)]"
          : "bg-[var(--color-danger-100)] text-[var(--color-danger-700)] border-[var(--color-danger-700)]"
      }`}
      data-testid={`hist-${kind}-result-${isOk ? "dry-ok" : state.status === "dry-errors" ? "dry-errors" : "commit-errors"}`}
    >
      <div className="font-medium mb-1">
        {isOk ? "Dry-run passed." : "message" in state ? state.message : ""}{" "}
        <span className="font-mono">
          ({state.report.validRows} valid / {state.report.totalRows} total
          {state.report.errorCount > 0 ? `, ${state.report.errorCount} errors` : ""})
        </span>
      </div>
      {state.report.errors.length > 0 && (
        <ul
          className="mt-1 list-disc list-inside max-h-[200px] overflow-auto font-mono text-[11.5px]"
          data-testid={`hist-${kind}-errors`}
        >
          {state.report.errors.slice(0, 50).map((e, i) => (
            <li key={`${e.row}-${i}`}>
              row {e.row}: {e.message}
            </li>
          ))}
          {state.report.errors.length > 50 && (
            <li>... and {state.report.errors.length - 50} more</li>
          )}
        </ul>
      )}
      {isOk && (
        <div className="text-[11.5px] mt-1 text-[var(--color-ink-700)]">
          The Commit load button is now enabled. Changing the file or context will reset the gate.
        </div>
      )}
    </div>
  );
}

// =====================================================================
// Shared building blocks
// =====================================================================

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-5 py-4">
      <header className="mb-3">
        <h2 className="m-0 text-[14px] font-semibold text-[var(--color-ink-900)]">{title}</h2>
        <p className="m-0 mt-1 text-[12px] text-[var(--color-ink-500)] leading-[1.5] max-w-[820px]">
          {description}
        </p>
      </header>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 mb-2">
      <span className="text-[10.5px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">
        {label}
      </span>
      {children}
    </label>
  );
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open
      onClose={onCancel}
      title={title}
      testId="confirm-dialog"
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            className="h-[28px] px-3 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            data-testid="confirm-dialog-go"
            className="h-[28px] px-4 rounded-[3px] bg-[var(--color-danger-700)] text-white text-[12.5px] font-medium"
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-[12.5px] text-[var(--color-ink-700)] leading-[1.55]">{body}</div>
    </Modal>
  );
}
