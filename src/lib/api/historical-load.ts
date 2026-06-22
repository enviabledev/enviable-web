/**
 * Historical-load endpoints. Three handlers:
 *
 * 1. POST /api/historical-load/shipment            (JSON body)
 *    Creates a one-off PO + PI + Shipment in one transaction. The shipment
 *    is created directly in RECEIVED state with isHistoricalImport=true.
 *    Returns the created shipment id and the embedded PO + PI + Shipment.
 *    NO dry-run mode; this is a direct create.
 *
 * 2. POST /api/historical-load/units/:shipmentId   (multipart CSV + dryRun)
 *    Bulk-creates Units (each with a paired RECEIPT StockMovement) under
 *    the parent Shipment. CSV columns: productVariantSku, engineNumber,
 *    chassisNumber. Dry-run mode reports validation errors without
 *    writing. Commit mode is all-or-nothing: if ANY row has an error, the
 *    whole commit is rejected with the validation report attached.
 *
 * 3. POST /api/historical-load/spare-parts          (multipart CSV + dryRun)
 *    Bulk-upserts SpareParts (incrementing quantityOnHand on existing
 *    rows by sku) with paired RECEIPT SparePartMovement per row. CSV
 *    columns: sku, name, quantity. Same dry-run semantics as units.
 *
 * All three are class-gated on historicalload.run (IT Admin only currently).
 * Each is @Audit-annotated; the audit interceptor writes one row per
 * successful commit (historical.shipment, historical.units, historical.spareparts).
 */

import type { ApiResult } from "./client";
import { apiFetch } from "./client";

export type CreateHistoricalShipmentBody = {
  supplierId: string;
  currency: string;
  piNumber: string;
  totalValue?: string;
  poNumber?: string;
  shipmentReference?: string;
  vesselName?: string;
  billOfLadingNumber?: string;
  etd?: string;
  eta?: string;
  arrivalDate?: string;
};

export type CreatedHistoricalShipment = {
  id: string;
  purchaseOrder: { id: string; poNumber: string };
  proformaInvoice: { id: string; piNumber: string };
  shipment: {
    id: string;
    shipmentReference: string;
    status: string;
    receivedAt: string | null;
  };
};

export async function createHistoricalShipment(
  body: CreateHistoricalShipmentBody,
  signal?: AbortSignal,
): Promise<ApiResult<CreatedHistoricalShipment>> {
  return apiFetch<CreatedHistoricalShipment>("/api/historical-load/shipment", {
    method: "POST",
    body,
    signal,
  });
}

export type HistoricalLoadRowError = {
  row: number;
  message: string;
};

export type HistoricalLoadReport = {
  dryRun: boolean;
  totalRows: number;
  validRows: number;
  errorCount: number;
  errors: HistoricalLoadRowError[];
};

export type HistoricalUnitsReport = HistoricalLoadReport & {
  shipmentId: string;
};

export type HistoricalUnitsCommitResult = {
  id: string; // shipmentId
  dryRun: false;
  created: number;
  totalRows: number;
};

export type HistoricalSparePartsCommitResult = {
  dryRun: false;
  created: number;
};

/**
 * Multipart upload helper. Routes through the same /api proxy; the cookie
 * flows because credentials:include. Does NOT set Content-Type: the browser
 * sets multipart/form-data with the boundary automatically when given a
 * FormData. Returns the same ApiResult shape as the JSON apiFetch so callers
 * branch on kind uniformly.
 *
 * The backend's 400 responses carry the validation report as a STRUCTURED
 * body (the dryRun report or the rejected-commit report); we parse it
 * specifically so callers can render row-level errors rather than only the
 * generic "message" string. The shape: { message, dryRun, totalRows,
 * validRows, errorCount, errors[] }.
 */
async function multipartFetch<T>(
  path: string,
  form: FormData,
  signal?: AbortSignal,
): Promise<ApiResult<T> | { kind: "validation_report"; report: HistoricalLoadReport; message: string }> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      body: form,
      signal,
    });
  } catch (err) {
    return {
      kind: "network_error",
      message: err instanceof Error ? err.message : "Network error",
    };
  }

  if (res.status === 401) return { kind: "unauthorized" };
  if (res.status === 403) return { kind: "forbidden" };
  if (res.status === 404) return { kind: "not_found" };

  if (res.status >= 200 && res.status < 300) {
    const data = (await res.json()) as T;
    return { kind: "ok", data };
  }

  // 400: either CSV-parse error (generic message) or validation report
  // (structured body). Try to parse structured; fall back to message.
  if (res.status === 400) {
    try {
      const body = (await res.json()) as Partial<HistoricalLoadReport> & {
        message?: string | string[];
      };
      if (typeof body.errorCount === "number" && Array.isArray(body.errors)) {
        return {
          kind: "validation_report",
          report: {
            dryRun: Boolean(body.dryRun),
            totalRows: body.totalRows ?? 0,
            validRows: body.validRows ?? 0,
            errorCount: body.errorCount,
            errors: body.errors,
          },
          message:
            typeof body.message === "string"
              ? body.message
              : Array.isArray(body.message)
                ? body.message.join("; ")
                : "Validation failed",
        };
      }
      const msg = Array.isArray(body.message) ? body.message.join("; ") : body.message ?? "Bad request";
      return { kind: "validation", status: 400, message: msg };
    } catch {
      return { kind: "validation", status: 400, message: "Bad request" };
    }
  }

  let bodyText: string;
  try {
    const body = await res.json();
    bodyText =
      typeof body === "object" && body !== null && "message" in body
        ? ((body as { message: string | string[] }).message as string)
        : JSON.stringify(body);
  } catch {
    bodyText = await res.text().catch(() => "");
  }
  if (res.status >= 400 && res.status < 500) {
    return { kind: "validation", status: res.status, message: bodyText };
  }
  return { kind: "server_error", status: res.status, message: bodyText };
}

export async function loadHistoricalUnits(
  shipmentId: string,
  file: File,
  dryRun: boolean,
  signal?: AbortSignal,
): Promise<
  | ApiResult<HistoricalUnitsReport | HistoricalUnitsCommitResult>
  | { kind: "validation_report"; report: HistoricalLoadReport; message: string }
> {
  const form = new FormData();
  form.append("file", file);
  const qs = `?dryRun=${dryRun ? "true" : "false"}`;
  // Defensive trim. The shipment-id input already trims on entry; this is the
  // belt-and-braces backstop for any future caller that bypasses that input.
  // A stray space here becomes %20 in the path and 404s the route. Both trims
  // are intentional; do not remove one as a "cleanup".
  const id = encodeURIComponent(shipmentId.trim());
  return multipartFetch<HistoricalUnitsReport | HistoricalUnitsCommitResult>(
    `/api/historical-load/units/${id}${qs}`,
    form,
    signal,
  );
}

export async function loadHistoricalSpareParts(
  file: File,
  dryRun: boolean,
  signal?: AbortSignal,
): Promise<
  | ApiResult<HistoricalLoadReport | HistoricalSparePartsCommitResult>
  | { kind: "validation_report"; report: HistoricalLoadReport; message: string }
> {
  const form = new FormData();
  form.append("file", file);
  const qs = `?dryRun=${dryRun ? "true" : "false"}`;
  return multipartFetch<HistoricalLoadReport | HistoricalSparePartsCommitResult>(
    `/api/historical-load/spare-parts${qs}`,
    form,
    signal,
  );
}
