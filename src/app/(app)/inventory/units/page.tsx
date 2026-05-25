"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { SearchIcon, UnitsIcon } from "@/components/icons";
import FreshnessBadge from "@/components/sync/FreshnessBadge";
import OfflineNotice from "@/components/sync/OfflineNotice";
import MultiSelectFilter, {
  type MultiSelectOption,
} from "@/components/units/MultiSelectFilter";
import StatusPill from "@/components/units/StatusPill";
import { usePermissions } from "@/lib/auth";
import {
  listUnits,
  UNIT_STATUS,
  type ApiResult,
  type UnitListResponse,
  type UnitListRow,
  type UnitStatus,
  type VariantAttributes,
} from "@/lib/api";
import { listByType } from "@/lib/sync/mirror/store";

// Mirror shape: the unit bucket stores the unit's flat fields (productVariantId,
// shipmentId, currentWarehouseId, etc.) per the server's syncPull contract; the
// online UnitListRow carries a nested productVariant object. Reconstruct the
// nested object client-side from the productVariant bucket so the list code
// renders identically on both paths.
type MirroredUnit = {
  id: string;
  engineNumber: string;
  chassisNumber: string;
  status: UnitStatus;
  createdAt: string;
  currentWarehouseId: string | null;
  landedCost?: string;
  productVariantId: string;
  shipmentId: string | null;
};
type MirroredVariant = {
  id: string;
  supplierSkuCode: string;
  variantAttributes: VariantAttributes;
};
import {
  formatDateShort,
  formatNGN,
  formatUnitStatus,
  formatVariantAbbreviation,
  relativeTime,
} from "@/lib/units/format";

const PAGE_SIZES = [25, 50, 100, 250] as const;
type PageSize = (typeof PAGE_SIZES)[number];

// Variants currently seeded in the dev DB. Until the backend exposes a
// /api/product-variants endpoint, the filter sources from this static list.
const VARIANT_OPTIONS: readonly MultiSelectOption[] = [
  { value: "seed-var-gs-gyellow", label: "GS+ G Yellow" },
  { value: "seed-var-gs-nepblue", label: "GS+ NEP Blue" },
  { value: "seed-var-gs-winered", label: "GS+ NF Wine Red" },
  { value: "seed-var-gs-ecogreen", label: "GS+ Eco Green" },
  { value: "seed-var-zs-gyellow", label: "ZS+ G Yellow" },
];

const STATUS_OPTIONS: readonly MultiSelectOption[] = UNIT_STATUS.map((s) => ({
  value: s,
  label: formatUnitStatus(s),
}));

const WAREHOUSE_OPTIONS = [
  { value: "", label: "All warehouses" },
  { value: "seed-wh-lagos", label: "Lagos Main" },
];

function readParams(sp: URLSearchParams) {
  const pageRaw = Number(sp.get("page") ?? "1");
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;

  const psRaw = Number(sp.get("pageSize") ?? "50");
  const pageSize: PageSize = (PAGE_SIZES as readonly number[]).includes(psRaw)
    ? (psRaw as PageSize)
    : 50;

  const variantId = sp.getAll("variantId");
  const status = sp.getAll("status").filter((s): s is UnitStatus =>
    (UNIT_STATUS as readonly string[]).includes(s),
  );
  const warehouseId = sp.get("warehouseId") ?? "";
  const receivedFrom = sp.get("receivedFrom") ?? "";
  const receivedTo = sp.get("receivedTo") ?? "";
  const search = sp.get("search") ?? "";

  return { page, pageSize, variantId, status, warehouseId, receivedFrom, receivedTo, search };
}

function buildHref(params: Partial<ReturnType<typeof readParams>>): string {
  const sp = new URLSearchParams();
  if (params.page && params.page > 1) sp.set("page", String(params.page));
  if (params.pageSize && params.pageSize !== 50) sp.set("pageSize", String(params.pageSize));
  for (const v of params.variantId ?? []) sp.append("variantId", v);
  for (const s of params.status ?? []) sp.append("status", s);
  if (params.warehouseId) sp.set("warehouseId", params.warehouseId);
  if (params.receivedFrom) sp.set("receivedFrom", params.receivedFrom);
  if (params.receivedTo) sp.set("receivedTo", params.receivedTo);
  if (params.search) sp.set("search", params.search);
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

export default function UnitsListingPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const { has } = usePermissions();
  const showLandedCost = has("costdata.view");

  const params = useMemo(() => readParams(new URLSearchParams(sp.toString())), [sp]);
  const [searchDraft, setSearchDraft] = useState(params.search);
  const [data, setData] = useState<UnitListResponse | null>(null);
  const [result, setResult] = useState<ApiResult<UnitListResponse>["kind"] | "idle">("idle");
  const [errMsg, setErrMsg] = useState<string>("");

  useEffect(() => {
    setSearchDraft(params.search);
  }, [params.search]);

  const [fromMirror, setFromMirror] = useState(false);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const ctrl = new AbortController();
    setResult("idle");
    setFromMirror(false);
    setOffline(false);
    listUnits(
      {
        page: params.page,
        pageSize: params.pageSize,
        variantId: params.variantId.length > 0 ? params.variantId : undefined,
        status: params.status.length > 0 ? params.status : undefined,
        warehouseId: params.warehouseId || undefined,
        receivedFrom: params.receivedFrom || undefined,
        receivedTo: params.receivedTo || undefined,
        search: params.search || undefined,
      },
      ctrl.signal,
    ).then(async (r) => {
      if (ctrl.signal.aborted) return;
      setResult(r.kind);
      if (r.kind === "ok") {
        setData(r.data);
        setErrMsg("");
      } else if (r.kind === "unauthorized") {
        router.replace("/login");
      } else if (r.kind === "forbidden") {
        setErrMsg("You do not have access to view units.");
      } else if (r.kind === "network_error" || r.kind === "server_error") {
        // Mirror fallback: assemble a paged list from the unit bucket. The
        // mirror stores the full unit row including the FKs needed for the
        // existing display, so the same UnitListRow shape (id, engineNumber,
        // chassisNumber, status, productVariantId, shipmentId,
        // currentWarehouseId, landedCost, createdAt) can be re-used; offline
        // filtering happens against those fields.
        try {
          const [mirroredUnits, mirroredVariants] = await Promise.all([
            listByType<MirroredUnit>("unit"),
            listByType<MirroredVariant>("productVariant"),
          ]);
          if (ctrl.signal.aborted) return;
          if (mirroredUnits.length === 0) {
            setOffline(true);
            return;
          }
          const variantById = new Map<string, MirroredVariant>();
          for (const v of mirroredVariants) variantById.set(v.body.id, v.body);

          const filtered = mirroredUnits
            .map((m) => m.body)
            .filter((u) => {
              if (params.variantId.length > 0 && !params.variantId.includes(u.productVariantId)) return false;
              if (params.status.length > 0 && !params.status.includes(u.status)) return false;
              if (params.warehouseId && u.currentWarehouseId !== params.warehouseId) return false;
              if (params.search) {
                const q = params.search.toUpperCase();
                if (
                  !u.engineNumber.toUpperCase().includes(q) &&
                  !u.chassisNumber.toUpperCase().includes(q)
                ) {
                  return false;
                }
              }
              return true;
            })
            .map<UnitListRow>((u) => {
              const variant = variantById.get(u.productVariantId);
              return {
                id: u.id,
                engineNumber: u.engineNumber,
                chassisNumber: u.chassisNumber,
                status: u.status,
                createdAt: u.createdAt,
                currentWarehouseId: u.currentWarehouseId,
                landedCost: u.landedCost,
                productVariant: variant
                  ? {
                      id: variant.id,
                      supplierSkuCode: variant.supplierSkuCode,
                      variantAttributes: variant.variantAttributes,
                    }
                  : {
                      id: u.productVariantId,
                      supplierSkuCode: u.productVariantId,
                      variantAttributes: {},
                    },
              };
            });
          const start = (params.page - 1) * params.pageSize;
          const slice = filtered.slice(start, start + params.pageSize);
          setData({
            data: slice,
            page: params.page,
            pageSize: params.pageSize,
            total: filtered.length,
          });
          setFromMirror(true);
          setResult("ok");
          setErrMsg("");
        } catch {
          setOffline(true);
        }
      } else if (r.kind === "validation") {
        setErrMsg(typeof r.message === "string" ? r.message : r.message.join("; "));
      }
    });
    return () => ctrl.abort();
  }, [params, router]);

  const navigate = useCallback(
    (next: Partial<ReturnType<typeof readParams>>) => {
      const merged = { ...params, ...next };
      router.replace(`/inventory/units${buildHref(merged)}`);
    },
    [params, router],
  );

  const setFilters = useCallback(
    (next: Partial<ReturnType<typeof readParams>>) => {
      // Any filter change resets page to 1.
      navigate({ ...next, page: 1 });
    },
    [navigate],
  );

  const onSearchSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setFilters({ search: searchDraft });
    },
    [searchDraft, setFilters],
  );

  const filtersApplied =
    params.variantId.length +
    params.status.length +
    (params.warehouseId ? 1 : 0) +
    (params.receivedFrom ? 1 : 0) +
    (params.receivedTo ? 1 : 0) +
    (params.search ? 1 : 0);

  return (
    <div className="max-w-[1620px] mx-auto pb-10">
      <header className="flex items-end justify-between gap-6 pb-4 mb-4 border-b border-[var(--color-border-default)]">
        <div>
          <div className="text-[12px] text-[var(--color-ink-500)] flex items-center gap-1.5 mb-1.5">
            <span>Inventory</span>
            <span className="text-[var(--color-ink-300)]">/</span>
            <span className="text-[var(--color-ink-900)] font-medium">Units</span>
          </div>
          <h1 className="text-[24px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em] flex items-center gap-3">
            Units (Kekes)
            {data && (
              <span className="font-mono text-[12px] bg-[var(--color-navy-50)] text-[var(--color-navy-800)] px-2.5 py-1 rounded-[3px] font-semibold">
                {data.total.toLocaleString()} total
              </span>
            )}
            {fromMirror && <FreshnessBadge />}
          </h1>
          <div className="text-[13px] text-[var(--color-ink-500)] mt-1">
            Individually-tracked tricycle units with engine and chassis serials. Each unit has its
            own audit trail.
          </div>
        </div>
      </header>

      <FilterBar
        params={params}
        searchDraft={searchDraft}
        onSearchDraftChange={setSearchDraft}
        onSearchSubmit={onSearchSubmit}
        onChange={setFilters}
        onReset={() =>
          router.replace("/inventory/units")
        }
        disabledReset={filtersApplied === 0}
      />

      <div className="flex items-center justify-between py-2 px-1 text-[12.5px] text-[var(--color-ink-700)]">
        <div>
          {data ? (
            <>
              Showing <b className="text-[var(--color-ink-900)] tabular-nums">
                {data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1}
              </b> to{" "}
              <b className="text-[var(--color-ink-900)] tabular-nums">
                {Math.min(data.page * data.pageSize, data.total)}
              </b>{" "}
              of <b className="text-[var(--color-ink-900)] tabular-nums">{data.total.toLocaleString()}</b> units.
              <span className="text-[var(--color-ink-500)] ml-2">
                Filters applied: <i>{filtersApplied === 0 ? "none" : filtersApplied}</i>.
              </span>
            </>
          ) : (
            <span className="text-[var(--color-ink-500)]">Loading...</span>
          )}
        </div>
      </div>

      <section className="bg-white border border-[var(--color-border-default)] rounded-[4px]">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr>
                <th className="text-left font-medium text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] px-3.5 py-2.5 border-b border-[var(--color-border-default)] bg-[var(--color-ink-100)] whitespace-nowrap">
                  Engine Number
                </th>
                <th className="text-left font-medium text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] px-3.5 py-2.5 border-b border-[var(--color-border-default)] bg-[var(--color-ink-100)] whitespace-nowrap">
                  Chassis Number
                </th>
                <th className="text-left font-medium text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] px-3.5 py-2.5 border-b border-[var(--color-border-default)] bg-[var(--color-ink-100)] whitespace-nowrap">
                  Variant
                </th>
                <th className="text-left font-medium text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] px-3.5 py-2.5 border-b border-[var(--color-border-default)] bg-[var(--color-ink-100)] whitespace-nowrap">
                  Status
                </th>
                <th className="text-left font-medium text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] px-3.5 py-2.5 border-b border-[var(--color-border-default)] bg-[var(--color-ink-100)] whitespace-nowrap">
                  Received
                </th>
                <th className="text-left font-medium text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] px-3.5 py-2.5 border-b border-[var(--color-border-default)] bg-[var(--color-ink-100)] whitespace-nowrap">
                  Current Warehouse
                </th>
                {showLandedCost && (
                  <th className="text-right font-medium text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] px-3.5 py-2.5 border-b border-[var(--color-border-default)] bg-[var(--color-ink-100)] whitespace-nowrap">
                    Landed Cost
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {result === "idle" && (
                <tr>
                  <td
                    colSpan={showLandedCost ? 7 : 6}
                    className="px-3.5 py-12 text-center text-[var(--color-ink-500)]"
                  >
                    Loading units...
                  </td>
                </tr>
              )}
              {result === "forbidden" && (
                <tr>
                  <td
                    colSpan={showLandedCost ? 7 : 6}
                    className="px-3.5 py-12 text-center text-[var(--color-ink-500)]"
                  >
                    You do not have access to view units.
                  </td>
                </tr>
              )}
              {offline && (
                <tr>
                  <td
                    colSpan={showLandedCost ? 7 : 6}
                    className="px-3.5 py-8"
                  >
                    <OfflineNotice body="The units list will load when the connection returns. Any units cached during a prior online visit appear here when present in the local mirror." />
                  </td>
                </tr>
              )}
              {!offline && (result === "validation" ||
                result === "server_error" ||
                result === "network_error") && (
                <tr>
                  <td
                    colSpan={showLandedCost ? 7 : 6}
                    className="px-3.5 py-12 text-center text-[var(--color-danger-700)]"
                  >
                    {errMsg || "Something went wrong loading units."}
                  </td>
                </tr>
              )}
              {result === "ok" && data && data.data.length === 0 && (
                <tr>
                  <td
                    colSpan={showLandedCost ? 7 : 6}
                    className="px-3.5 py-12 text-center text-[var(--color-ink-500)]"
                  >
                    No units match the current filters.
                  </td>
                </tr>
              )}
              {result === "ok" &&
                data &&
                data.data.map((row, i) => (
                  <UnitRow
                    key={row.id}
                    row={row}
                    showLandedCost={showLandedCost}
                    even={i % 2 === 1}
                  />
                ))}
            </tbody>
          </table>
        </div>

        {data && data.total > 0 && (
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            onPage={(p) => navigate({ page: p })}
            onPageSize={(s) => navigate({ pageSize: s, page: 1 })}
          />
        )}
      </section>
    </div>
  );
}

function UnitRow({
  row,
  showLandedCost,
  even,
}: {
  row: UnitListRow;
  showLandedCost: boolean;
  even: boolean;
}) {
  const href = `/inventory/units/${encodeURIComponent(row.engineNumber)}`;
  const cellBg = even ? "bg-[#FBFBFC]" : "bg-white";
  return (
    <tr className={`${cellBg} hover:bg-[var(--color-navy-50)] transition-colors`}>
      <td className="px-3.5 py-2.5 border-b border-[var(--color-border-default)] font-mono text-[12px] text-[var(--color-ink-900)] tracking-[0.02em] whitespace-nowrap">
        <Link href={href} className="text-[var(--color-navy-700)] hover:underline">
          {row.engineNumber}
        </Link>
      </td>
      <td className="px-3.5 py-2.5 border-b border-[var(--color-border-default)] font-mono text-[12px] text-[var(--color-ink-900)] tracking-[0.02em] whitespace-nowrap">
        {row.chassisNumber}
      </td>
      <td className="px-3.5 py-2.5 border-b border-[var(--color-border-default)] align-middle whitespace-nowrap">
        <div className="font-medium text-[var(--color-ink-900)] text-[12.5px] leading-tight">
          {formatVariantAbbreviation(row.productVariant)}
        </div>
        <div className="font-mono text-[10.5px] text-[var(--color-ink-500)] font-medium mt-0.5">
          {row.productVariant.supplierSkuCode}
        </div>
      </td>
      <td className="px-3.5 py-2.5 border-b border-[var(--color-border-default)] whitespace-nowrap">
        <StatusPill status={row.status} />
      </td>
      <td className="px-3.5 py-2.5 border-b border-[var(--color-border-default)] tabular-nums whitespace-nowrap">
        {formatDateShort(row.createdAt)}
        <span className="block text-[11px] text-[var(--color-ink-500)] mt-px">
          {relativeTime(row.createdAt)}
        </span>
      </td>
      <td className="px-3.5 py-2.5 border-b border-[var(--color-border-default)] text-[var(--color-ink-900)] whitespace-nowrap">
        {row.currentWarehouseId ? (
          row.currentWarehouseId === "seed-wh-lagos" ? "Lagos Main" : row.currentWarehouseId
        ) : (
          <span className="text-[var(--color-ink-400)]">--</span>
        )}
      </td>
      {showLandedCost && (
        <td className="px-3.5 py-2.5 border-b border-[var(--color-border-default)] text-right tabular-nums font-mono text-[12px] whitespace-nowrap">
          {row.landedCost !== undefined ? formatNGN(row.landedCost) : <span className="text-[var(--color-ink-400)]">--</span>}
        </td>
      )}
    </tr>
  );
}

function FilterBar({
  params,
  searchDraft,
  onSearchDraftChange,
  onSearchSubmit,
  onChange,
  onReset,
  disabledReset,
}: {
  params: ReturnType<typeof readParams>;
  searchDraft: string;
  onSearchDraftChange: (v: string) => void;
  onSearchSubmit: (e: React.FormEvent) => void;
  onChange: (next: Partial<ReturnType<typeof readParams>>) => void;
  onReset: () => void;
  disabledReset: boolean;
}) {
  return (
    <div className="bg-white border border-[var(--color-border-default)] rounded-[4px] p-3.5 mb-3.5 grid grid-cols-[repeat(5,1fr)_auto] gap-3 items-end">
      <MultiSelectFilter
        label="Variant"
        placeholder="All variants"
        options={VARIANT_OPTIONS}
        selected={params.variantId}
        onChange={(next) => onChange({ variantId: [...next] })}
        icon={<UnitsIcon width={13} height={13} />}
      />

      <MultiSelectFilter
        label="Status"
        placeholder="All statuses"
        options={STATUS_OPTIONS}
        selected={params.status}
        onChange={(next) => onChange({ status: next as UnitStatus[] })}
        icon={
          <svg width={13} height={13} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <circle cx="8" cy="8" r="6" />
            <circle cx="8" cy="8" r="2.5" fill="currentColor" />
          </svg>
        }
      />

      <div className="flex flex-col gap-1 min-w-0">
        <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--color-ink-500)]">
          Warehouse
        </span>
        <select
          value={params.warehouseId}
          onChange={(e) => onChange({ warehouseId: e.target.value })}
          className="h-8 px-2.5 bg-white border border-[var(--color-border-strong)] rounded-[3px] text-[13px] text-[var(--color-ink-900)] cursor-pointer focus:outline-none focus:border-[var(--color-navy-700)] focus:shadow-[0_0_0_3px_rgba(31,78,121,0.10)]"
        >
          {WAREHOUSE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1 min-w-0">
        <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--color-ink-500)]">
          Received From
        </span>
        <input
          type="date"
          value={params.receivedFrom}
          onChange={(e) => onChange({ receivedFrom: e.target.value })}
          className="h-8 px-2.5 bg-white border border-[var(--color-border-strong)] rounded-[3px] text-[13px] text-[var(--color-ink-900)] focus:outline-none focus:border-[var(--color-navy-700)] focus:shadow-[0_0_0_3px_rgba(31,78,121,0.10)]"
        />
      </div>

      <form onSubmit={onSearchSubmit} className="flex flex-col gap-1 min-w-0">
        <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--color-ink-500)]">
          Engine or Chassis #
        </span>
        <div className="h-8 flex items-center gap-1.5 px-2.5 bg-white border border-[var(--color-border-strong)] rounded-[3px] focus-within:border-[var(--color-navy-700)] focus-within:shadow-[0_0_0_3px_rgba(31,78,121,0.10)]">
          <SearchIcon width={13} height={13} style={{ color: "var(--color-ink-500)" }} />
          <input
            type="text"
            value={searchDraft}
            onChange={(e) => onSearchDraftChange(e.target.value)}
            placeholder="FIXT-GS-... or MD3..."
            className="flex-1 bg-transparent outline-none text-[13px] text-[var(--color-ink-900)] placeholder:text-[var(--color-ink-400)]"
          />
        </div>
      </form>

      <button
        type="button"
        onClick={onReset}
        disabled={disabledReset}
        className={`h-8 px-3 rounded-[3px] text-[13px] font-medium inline-flex items-center gap-1.5 self-end ${
          disabledReset
            ? "text-[var(--color-ink-400)] cursor-default"
            : "text-[var(--color-navy-700)] hover:bg-[var(--color-navy-50)] cursor-pointer"
        }`}
      >
        Reset
      </button>
    </div>
  );
}

function Pagination({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
  onPageSize: (s: PageSize) => void;
}) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  const pageButtons: (number | "ellipsis")[] = [];
  const push = (v: number | "ellipsis") => pageButtons.push(v);
  if (lastPage <= 7) {
    for (let i = 1; i <= lastPage; i++) push(i);
  } else {
    push(1);
    if (page > 4) push("ellipsis");
    const start2 = Math.max(2, page - 2);
    const end2 = Math.min(lastPage - 1, page + 2);
    for (let i = start2; i <= end2; i++) push(i);
    if (page < lastPage - 3) push("ellipsis");
    push(lastPage);
  }

  return (
    <div className="flex items-center gap-4 px-3.5 py-3 border-t border-[var(--color-border-default)] bg-[#FBFBFB] text-[12.5px] text-[var(--color-ink-700)]">
      <span>
        Rows per page:&nbsp;
        <select
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value) as PageSize)}
          className="h-7 px-2 pr-6 border border-[var(--color-border-strong)] rounded-[3px] bg-white text-[12px] tabular-nums cursor-pointer"
        >
          {PAGE_SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </span>
      <span className="text-[var(--color-ink-300)]">|</span>
      <span>
        Showing{" "}
        <b className="text-[var(--color-ink-900)] tabular-nums">
          {total === 0 ? 0 : start} - {end}
        </b>{" "}
        of <b className="text-[var(--color-ink-900)] tabular-nums">{total.toLocaleString()}</b>
      </span>
      <div className="flex-1" />
      <div className="flex gap-0.5">
        <PageBtn disabled={page === 1} onClick={() => onPage(1)}>
          &laquo;
        </PageBtn>
        <PageBtn disabled={page === 1} onClick={() => onPage(page - 1)}>
          &lsaquo;
        </PageBtn>
        {pageButtons.map((b, i) =>
          b === "ellipsis" ? (
            <span key={`e-${i}`} className="grid place-items-center px-1.5 text-[var(--color-ink-400)]">
              ...
            </span>
          ) : (
            <PageBtn key={b} active={b === page} onClick={() => onPage(b)}>
              {b}
            </PageBtn>
          ),
        )}
        <PageBtn disabled={page >= lastPage} onClick={() => onPage(page + 1)}>
          &rsaquo;
        </PageBtn>
        <PageBtn disabled={page >= lastPage} onClick={() => onPage(lastPage)}>
          &raquo;
        </PageBtn>
      </div>
    </div>
  );
}

function PageBtn({
  children,
  onClick,
  disabled,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-w-7 h-7 px-2 grid place-items-center border rounded-[3px] text-[12px] tabular-nums ${
        active
          ? "bg-[var(--color-navy-700)] text-white border-[var(--color-navy-700)]"
          : disabled
            ? "border-[var(--color-border-strong)] bg-white text-[var(--color-ink-300)] opacity-40 cursor-default"
            : "border-[var(--color-border-strong)] bg-white text-[var(--color-ink-900)] hover:bg-[var(--color-ink-100)] cursor-pointer"
      }`}
    >
      {children}
    </button>
  );
}
