"use client";

/**
 * Stock movements list. Two tabs:
 *
 *   "Stock"        - cross-unit StockMovement log, gated 'movement.read'.
 *                    Backed by GET /api/stock-movements; mirror-first paint
 *                    against the stockMovement bucket and join to unit/user
 *                    buckets for engine number and actor name.
 *
 *   "Spare parts"  - SparePartMovement log, gated 'sparepart.read'.
 *                    The backend has no standalone list endpoint for
 *                    spare-part movements (they live inside the spare-part
 *                    detail), so this tab renders ENTIRELY from the mirror's
 *                    sparePartMovement bucket. Client-side filters / paging
 *                    over the mirror rows.
 *
 * Reference resolution on each row is a short summary ("via Shipment SHP-X",
 * "via Sales order SO-Y"), joined from the mirror's reference buckets. The
 * detail page renders the full join. Both branches handle every distinct
 * referenceType the backend emits (audit in src/lib/movements/reference.ts).
 *
 * Cost gating holds by absence: movement rows themselves carry no cost
 * fields (the backend's CostVisibilityInterceptor strips landedCost from
 * Unit/SparePart, not from the movement row), so the rendering is the same
 * for cost and non-cost users.
 */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MovementsIcon } from "@/components/icons";
import FreshnessBadge from "@/components/sync/FreshnessBadge";
import OfflineNotice from "@/components/sync/OfflineNotice";
import { usePermissions } from "@/lib/auth";
import {
  listStockMovements,
  MOVEMENT_TYPE,
  SPARE_PART_MOVEMENT_TYPE,
  type MovementType,
  type SparePartMovementType,
  type StockMovementListRow,
  type StockMovementListResponse,
  type SparePartMovementListRow,
  type ApiResult,
} from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { resolveReferenceSummary } from "@/lib/movements/reference";
import { listByType } from "@/lib/sync/mirror/store";
import { formatMovementType } from "@/lib/units/format";

const PAGE_SIZES = [10, 25, 50, 100] as const;
type PageSize = (typeof PAGE_SIZES)[number];
type Tab = "stock" | "spare";

// Mirror-bucket shapes for the rows we filter on. The sync pull returns the
// raw Prisma rows (no nested join select), so engine number and actor name
// resolve from neighbouring buckets, not from these rows themselves.
type MirroredStockMovement = {
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
type MirroredSparePartMovement = {
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
type MirroredUserMini = { id: string; fullName: string };
type MirroredUnitMini = { id: string; engineNumber: string };
type MirroredSparePartMini = { id: string; sku: string; name: string };

function readParams(sp: URLSearchParams, hasStock: boolean, hasSpare: boolean) {
  const tabRaw = sp.get("tab");
  const tab: Tab =
    tabRaw === "spare" && hasSpare
      ? "spare"
      : tabRaw === "stock" && hasStock
        ? "stock"
        : hasStock
          ? "stock"
          : "spare";

  const pageRaw = Number(sp.get("page") ?? "1");
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
  const psRaw = Number(sp.get("pageSize") ?? "50");
  const pageSize: PageSize = (PAGE_SIZES as readonly number[]).includes(psRaw)
    ? (psRaw as PageSize)
    : 50;

  const movementType = sp.get("movementType") ?? "";
  const occurredFrom = sp.get("occurredFrom") ?? "";
  const occurredTo = sp.get("occurredTo") ?? "";
  const search = sp.get("search") ?? "";

  return { tab, page, pageSize, movementType, occurredFrom, occurredTo, search };
}

function buildHref(p: Partial<ReturnType<typeof readParams>>): string {
  const sp = new URLSearchParams();
  if (p.tab && p.tab !== "stock") sp.set("tab", p.tab);
  if (p.page && p.page > 1) sp.set("page", String(p.page));
  if (p.pageSize && p.pageSize !== 50) sp.set("pageSize", String(p.pageSize));
  if (p.movementType) sp.set("movementType", p.movementType);
  if (p.occurredFrom) sp.set("occurredFrom", p.occurredFrom);
  if (p.occurredTo) sp.set("occurredTo", p.occurredTo);
  if (p.search) sp.set("search", p.search);
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

export default function StockMovementsListPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const { has } = usePermissions();
  const canStock = has("movement.read");
  const canSpare = has("sparepart.read");

  const params = useMemo(
    () => readParams(new URLSearchParams(sp.toString()), canStock, canSpare),
    [sp, canStock, canSpare],
  );
  const [searchDraft, setSearchDraft] = useState(params.search);
  useEffect(() => setSearchDraft(params.search), [params.search]);

  const navigate = useCallback(
    (next: Partial<ReturnType<typeof readParams>>) => {
      const merged = { ...params, ...next };
      router.replace(`/inventory/movements${buildHref(merged)}`);
    },
    [params, router],
  );

  if (!canStock && !canSpare) {
    return (
      <div className="max-w-[1080px] mx-auto py-10 text-center text-[var(--color-ink-500)]">
        You do not have access to stock movements (requires movement.read or sparepart.read).
      </div>
    );
  }

  return (
    <div className="max-w-[1620px] mx-auto pb-10">
      <header className="flex items-end justify-between gap-6 pb-4 mb-4 border-b border-[var(--color-border-default)]">
        <div>
          <div className="text-[12px] text-[var(--color-ink-500)] mb-1.5">Inventory / Stock movements</div>
          <h1 className="text-[22px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em] flex items-center gap-2">
            <MovementsIcon className="w-[18px] h-[18px] text-[var(--color-ink-500)]" />
            Stock movements
          </h1>
          <div className="text-[12.5px] text-[var(--color-ink-500)] mt-1">
            Append-only audit trail of unit and spare-part state transitions. Movements are recorded as side
            effects of receipts, assembly, sales, returns, and IT-admin adjustments.
          </div>
        </div>
        {canStock && canSpare && (
          <nav className="flex gap-1 self-start" role="tablist">
            <TabButton active={params.tab === "stock"} onClick={() => navigate({ tab: "stock", page: 1 })}>
              Stock
            </TabButton>
            <TabButton active={params.tab === "spare"} onClick={() => navigate({ tab: "spare", page: 1 })}>
              Spare parts
            </TabButton>
          </nav>
        )}
      </header>

      <FiltersBar
        params={params}
        searchDraft={searchDraft}
        setSearchDraft={setSearchDraft}
        onChange={(next) => navigate({ ...next, page: 1 })}
        searchLabel={params.tab === "stock" ? "Engine or chassis number" : "Spare part name or SKU"}
        typeOptions={params.tab === "stock" ? MOVEMENT_TYPE : SPARE_PART_MOVEMENT_TYPE}
      />

      {params.tab === "stock" ? (
        <StockTab params={params} navigate={navigate} />
      ) : (
        <SparePartTab params={params} navigate={navigate} />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`h-[28px] px-3 rounded-[3px] text-[12.5px] font-medium ${
        active
          ? "bg-[var(--color-navy-700)] text-white"
          : "bg-white border border-[var(--color-border-default)] text-[var(--color-ink-700)] hover:border-[var(--color-navy-700)] hover:text-[var(--color-navy-700)]"
      }`}
    >
      {children}
    </button>
  );
}

function FiltersBar({
  params,
  searchDraft,
  setSearchDraft,
  onChange,
  searchLabel,
  typeOptions,
}: {
  params: ReturnType<typeof readParams>;
  searchDraft: string;
  setSearchDraft: (v: string) => void;
  onChange: (next: Partial<ReturnType<typeof readParams>>) => void;
  searchLabel: string;
  typeOptions: readonly string[];
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onChange({ search: searchDraft });
      }}
      className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-3 py-2.5 mb-3 flex items-end gap-3 flex-wrap"
    >
      <Field label="Type">
        <select
          value={params.movementType}
          onChange={(e) => onChange({ movementType: e.target.value })}
          className="h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] text-[var(--color-ink-900)]"
        >
          <option value="">All types</option>
          {typeOptions.map((t) => (
            <option key={t} value={t}>
              {formatMovementType(t)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="From">
        <input
          type="date"
          value={params.occurredFrom}
          onChange={(e) => onChange({ occurredFrom: e.target.value })}
          className="h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] text-[var(--color-ink-900)]"
        />
      </Field>
      <Field label="To">
        <input
          type="date"
          value={params.occurredTo}
          onChange={(e) => onChange({ occurredTo: e.target.value })}
          className="h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] text-[var(--color-ink-900)]"
        />
      </Field>
      <Field label={searchLabel}>
        <input
          type="text"
          value={searchDraft}
          onChange={(e) => setSearchDraft(e.target.value)}
          placeholder="e.g. TVSKGS25E0001211"
          className="h-[28px] w-[240px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] text-[var(--color-ink-900)] font-mono"
        />
      </Field>
      <button
        type="submit"
        className="h-[28px] px-3 rounded-[3px] bg-[var(--color-navy-700)] text-white text-[12.5px] font-medium"
      >
        Search
      </button>
      {(params.movementType || params.occurredFrom || params.occurredTo || params.search) && (
        <button
          type="button"
          onClick={() => {
            setSearchDraft("");
            onChange({ movementType: "", occurredFrom: "", occurredTo: "", search: "" });
          }}
          className="h-[28px] px-3 rounded-[3px] bg-white border border-[var(--color-border-default)] text-[var(--color-ink-700)] text-[12px] hover:border-[var(--color-navy-700)] hover:text-[var(--color-navy-700)]"
        >
          Clear
        </button>
      )}
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10.5px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] font-medium">
        {label}
      </span>
      {children}
    </label>
  );
}

// =========================================================================
// Stock tab: mirror-first paint + network revalidate.
// =========================================================================

function StockTab({
  params,
  navigate,
}: {
  params: ReturnType<typeof readParams>;
  navigate: (n: Partial<ReturnType<typeof readParams>>) => void;
}) {
  const router = useRouter();
  const [data, setData] = useState<StockMovementListResponse | null>(null);
  const [fromMirror, setFromMirror] = useState(false);
  const [offline, setOffline] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const [refCtx, setRefCtx] = useState<RefContext | null>(null);
  const mirrorPaintedRef = useRef(false);

  useEffect(() => {
    const ctrl = new AbortController();
    mirrorPaintedRef.current = false;
    setOffline(false);

    // Phase 1: paint from the mirror.
    (async () => {
      try {
        const [movs, users, units] = await Promise.all([
          listByType<MirroredStockMovement>("stockMovement"),
          listByType<MirroredUserMini>("user"),
          listByType<MirroredUnitMini>("unit"),
        ]);
        const ctx = await loadRefContext();
        if (ctrl.signal.aborted) return;
        const userById = new Map(users.map((u) => [u.body.id, u.body]));
        const unitById = new Map(units.map((u) => [u.body.id, u.body]));
        const rows = movs.map((r) => r.body);
        // Apply filters in JS so the mirror view matches the URL filters
        // exactly (the network path uses the same filters server-side).
        const filtered = rows
          .filter((m) => {
            if (params.movementType && m.movementType !== params.movementType) return false;
            if (params.occurredFrom && m.occurredAt < params.occurredFrom) return false;
            if (params.occurredTo && m.occurredAt > params.occurredTo + "T23:59:59.999Z") return false;
            if (params.search) {
              const unit = unitById.get(m.unitId);
              if (!unit) return false;
              const q = params.search.toUpperCase();
              if (!unit.engineNumber.toUpperCase().includes(q)) return false;
            }
            return true;
          })
          .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
        const start = (params.page - 1) * params.pageSize;
        const sliced = filtered.slice(start, start + params.pageSize).map<StockMovementListRow>((m) => ({
          id: m.id,
          unitId: m.unitId,
          movementType: m.movementType,
          fromState: m.fromState,
          toState: m.toState,
          fromWarehouseId: m.fromWarehouseId,
          toWarehouseId: m.toWarehouseId,
          referenceType: (m.referenceType ?? null) as StockMovementListRow["referenceType"],
          referenceId: m.referenceId,
          occurredAt: m.occurredAt,
          notes: m.notes,
          actor: {
            id: m.actorId,
            fullName: userById.get(m.actorId)?.fullName ?? m.actorId,
          },
          unit: {
            id: m.unitId,
            engineNumber: unitById.get(m.unitId)?.engineNumber ?? m.unitId,
          },
        }));
        if (rows.length > 0) {
          mirrorPaintedRef.current = true;
          setData({ data: sliced, page: params.page, pageSize: params.pageSize, total: filtered.length });
          setFromMirror(true);
          setErrMsg("");
        }
        setRefCtx(ctx);
      } catch {
        // network drives
      }
    })();

    // Phase 2: revalidate against the network.
    listStockMovements(
      {
        page: params.page,
        pageSize: params.pageSize,
        movementType: (params.movementType || undefined) as MovementType | undefined,
        occurredFrom: params.occurredFrom || undefined,
        occurredTo: params.occurredTo || undefined,
      },
      ctrl.signal,
    ).then((r: ApiResult<StockMovementListResponse>) => {
      if (ctrl.signal.aborted) return;
      if (r.kind === "ok") {
        // Server response does not include any engine-number search; if the
        // user typed one, filter client-side over the page slice.
        let rows = r.data.data;
        if (params.search) {
          const q = params.search.toUpperCase();
          rows = rows.filter((m) => m.unit.engineNumber.toUpperCase().includes(q));
        }
        setData({ data: rows, page: r.data.page, pageSize: r.data.pageSize, total: r.data.total });
        setFromMirror(false);
        setErrMsg("");
      } else if (r.kind === "unauthorized") {
        router.replace("/login");
      } else if (r.kind === "forbidden") {
        setErrMsg("You do not have access to read movements.");
      } else if (r.kind === "network_error" || r.kind === "server_error") {
        if (!mirrorPaintedRef.current) setOffline(true);
      } else if ("message" in r) {
        setErrMsg(typeof r.message === "string" ? r.message : r.message.join("; "));
      }
    });

    return () => ctrl.abort();
  }, [params, router]);

  if (errMsg) {
    return <div className="py-10 text-center text-[var(--color-danger-700)]">{errMsg}</div>;
  }
  if (!data && offline) {
    return (
      <OfflineNotice body="Stock movements will load once you are back online. Movements you have already opened or that were warmed offline will appear here." />
    );
  }
  if (!data) {
    return <div className="py-10 text-center text-[var(--color-ink-500)]">Loading movements...</div>;
  }

  return (
    <MovementsTable
      rows={data.data}
      total={data.total}
      page={data.page}
      pageSize={params.pageSize}
      fromMirror={fromMirror}
      refCtx={refCtx}
      onPage={(p) => navigate({ page: p })}
      onPageSize={(ps) => navigate({ pageSize: ps, page: 1 })}
      kind="stock"
    />
  );
}

// =========================================================================
// Spare-part tab: mirror-only (no backend list endpoint).
// =========================================================================

function SparePartTab({
  params,
  navigate,
}: {
  params: ReturnType<typeof readParams>;
  navigate: (n: Partial<ReturnType<typeof readParams>>) => void;
}) {
  const [data, setData] = useState<{
    rows: SparePartMovementListRow[];
    total: number;
    sparePartById: Map<string, MirroredSparePartMini>;
    actorById: Map<string, MirroredUserMini>;
  } | null>(null);
  const [refCtx, setRefCtx] = useState<RefContext | null>(null);

  // This tab is mirror-only (no backend list endpoint for spare-part
  // movements), so freshness depends on re-reading the mirror after
  // SyncBoot's background reconcile lands new rows. Same signal pattern
  // the deliveries page uses: re-read on visibility / focus / online / a
  // light 15s tick while the document is visible. Without this, a clerk
  // who opens the tab before the first reconcile sees a stale snapshot
  // and the page never catches up.
  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      try {
        const [movs, parts, users] = await Promise.all([
          listByType<MirroredSparePartMovement>("sparePartMovement"),
          listByType<MirroredSparePartMini>("sparePart"),
          listByType<MirroredUserMini>("user"),
        ]);
        const ctx = await loadRefContext();
        if (cancelled) return;
        const partById = new Map(parts.map((p) => [p.body.id, p.body]));
        const userById = new Map(users.map((u) => [u.body.id, u.body]));
        const rows = movs.map((m) => m.body);
        const filtered = rows
          .filter((m) => {
            if (params.movementType && m.movementType !== params.movementType) return false;
            if (params.occurredFrom && m.occurredAt < params.occurredFrom) return false;
            if (params.occurredTo && m.occurredAt > params.occurredTo + "T23:59:59.999Z") return false;
            if (params.search) {
              const part = partById.get(m.sparePartId);
              if (!part) return false;
              const q = params.search.toUpperCase();
              if (!part.sku.toUpperCase().includes(q) && !part.name.toUpperCase().includes(q)) return false;
            }
            return true;
          })
          .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
        if (cancelled) return;
        setData({
          rows: filtered as unknown as SparePartMovementListRow[],
          total: filtered.length,
          sparePartById: partById,
          actorById: userById,
        });
        setRefCtx(ctx);
      } catch {
        // mirror unavailable
      }
    };
    void read();
    const onVisible = () => {
      if (document.visibilityState === "visible") void read();
    };
    window.addEventListener("focus", read);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", read);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void read();
    }, 15000);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", read);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", read);
      window.clearInterval(interval);
    };
  }, [params]);

  if (!data) {
    return <div className="py-10 text-center text-[var(--color-ink-500)]">Loading spare-part movements...</div>;
  }
  const start = (params.page - 1) * params.pageSize;
  const slice = data.rows.slice(start, start + params.pageSize);

  return (
    <MovementsTable
      rows={slice}
      total={data.total}
      page={params.page}
      pageSize={params.pageSize}
      fromMirror={true}
      refCtx={refCtx}
      onPage={(p) => navigate({ page: p })}
      onPageSize={(ps) => navigate({ pageSize: ps, page: 1 })}
      kind="spare"
      sparePartById={data.sparePartById}
      actorById={data.actorById}
    />
  );
}

// =========================================================================
// Shared table renderer
// =========================================================================

type RefContext = Awaited<ReturnType<typeof loadRefContext>>;

async function loadRefContext() {
  const [shipments, salesOrders, assemblyJobs] = await Promise.all([
    listByType<{ id: string; shipmentReference: string }>("shipment"),
    listByType<{ id: string; salesOrderReference?: string; reference?: string }>("salesOrder"),
    listByType<{ id: string; unitId: string }>("assemblyJob"),
  ]);
  return {
    shipmentById: new Map(shipments.map((s) => [s.body.id, s.body])),
    salesOrderById: new Map(salesOrders.map((s) => [s.body.id, s.body])),
    assemblyJobById: new Map(assemblyJobs.map((j) => [j.body.id, j.body])),
  };
}

type MovementsTableProps =
  | {
      kind: "stock";
      rows: StockMovementListRow[];
      total: number;
      page: number;
      pageSize: PageSize;
      fromMirror: boolean;
      refCtx: RefContext | null;
      onPage: (p: number) => void;
      onPageSize: (ps: PageSize) => void;
    }
  | {
      kind: "spare";
      rows: SparePartMovementListRow[];
      total: number;
      page: number;
      pageSize: PageSize;
      fromMirror: boolean;
      refCtx: RefContext | null;
      onPage: (p: number) => void;
      onPageSize: (ps: PageSize) => void;
      sparePartById: Map<string, MirroredSparePartMini>;
      actorById: Map<string, MirroredUserMini>;
    };

function MovementsTable(props: MovementsTableProps) {
  const lastPage = Math.max(1, Math.ceil(props.total / props.pageSize));
  return (
    <section className="bg-white border border-[var(--color-border-default)] rounded-[4px]">
      <header className="px-4 py-2.5 border-b border-[var(--color-border-default)] flex items-center justify-between">
        <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)] flex items-center gap-2">
          {props.kind === "stock" ? "Unit movements" : "Spare-part movements"}
          <span className="text-[11px] text-[var(--color-ink-500)] font-medium ml-1">
            {props.total} total
          </span>
          {props.fromMirror && <FreshnessBadge />}
        </h2>
        <div className="flex items-center gap-2 text-[11px] text-[var(--color-ink-500)]">
          <span>Rows per page</span>
          <select
            value={props.pageSize}
            onChange={(e) => {
              const v = Number(e.target.value);
              if ((PAGE_SIZES as readonly number[]).includes(v)) {
                props.onPageSize(v as PageSize);
              }
            }}
            className="h-[24px] px-1 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[11px] text-[var(--color-ink-900)]"
          >
            {PAGE_SIZES.map((ps) => (
              <option key={ps} value={ps}>
                {ps}
              </option>
            ))}
          </select>
        </div>
      </header>
      {props.rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-[12.5px] text-[var(--color-ink-500)]">
          No movements match the current filters.
        </div>
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr>
              <Th>Occurred</Th>
              <Th>Type</Th>
              <Th>{props.kind === "stock" ? "Engine number" : "Spare part"}</Th>
              <Th>{props.kind === "stock" ? "State change" : "Quantity"}</Th>
              <Th>Actor</Th>
              <Th>Reference</Th>
            </tr>
          </thead>
          <tbody>
            {props.kind === "stock"
              ? props.rows.map((r, i) => (
                  <StockRow key={r.id} row={r} odd={i % 2 === 1} refCtx={props.refCtx} />
                ))
              : props.rows.map((r, i) => (
                  <SpareRow
                    key={r.id}
                    row={r}
                    odd={i % 2 === 1}
                    refCtx={props.refCtx}
                    sparePartById={props.sparePartById}
                    actorById={props.actorById}
                  />
                ))}
          </tbody>
        </table>
      )}
      <footer className="px-4 py-2 border-t border-[var(--color-border-default)] flex items-center justify-between text-[11.5px] text-[var(--color-ink-500)]">
        <span>
          Page {props.page} of {lastPage}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={props.page <= 1}
            onClick={() => props.onPage(props.page - 1)}
            className="h-[24px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[var(--color-ink-700)] disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={props.page >= lastPage}
            onClick={() => props.onPage(props.page + 1)}
            className="h-[24px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[var(--color-ink-700)] disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </footer>
    </section>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="text-left font-medium text-[10.5px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] px-3.5 py-2.5 border-b border-[var(--color-border-default)] bg-[var(--color-ink-100)]">
      {children}
    </th>
  );
}

function Td({ children, mono = false }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <td
      className={`px-3.5 py-2 text-[12.5px] text-[var(--color-ink-900)] whitespace-nowrap ${
        mono ? "font-mono text-[12px] tracking-[0.02em]" : ""
      }`}
    >
      {children}
    </td>
  );
}

function StockRow({
  row,
  odd,
  refCtx,
}: {
  row: StockMovementListRow;
  odd: boolean;
  refCtx: RefContext | null;
}) {
  const summary = resolveReferenceSummary(row.referenceType, row.referenceId, refCtx);
  return (
    <tr
      className={`${odd ? "bg-[#FBFBFC]" : "bg-white"} border-b border-[var(--color-border-default)] hover:bg-[var(--color-navy-50)]`}
    >
      <Td>
        <Link
          href={`/inventory/movements/${row.id}`}
          className="text-[var(--color-navy-700)] hover:underline"
        >
          {formatDateTime(row.occurredAt)}
        </Link>
      </Td>
      <Td>{formatMovementType(row.movementType)}</Td>
      <Td mono>{row.unit.engineNumber}</Td>
      <Td>
        {row.fromState || row.toState ? (
          <span className="text-[var(--color-ink-700)]">
            {row.fromState ?? "--"} <span className="text-[var(--color-ink-400)]">to</span>{" "}
            {row.toState ?? "--"}
          </span>
        ) : (
          <span className="text-[var(--color-ink-400)]">--</span>
        )}
      </Td>
      <Td>{row.actor.fullName}</Td>
      <Td>{summary.label || <span className="text-[var(--color-ink-400)]">--</span>}</Td>
    </tr>
  );
}

function SpareRow({
  row,
  odd,
  refCtx,
  sparePartById,
  actorById,
}: {
  row: SparePartMovementListRow;
  odd: boolean;
  refCtx: RefContext | null;
  sparePartById: Map<string, MirroredSparePartMini>;
  actorById: Map<string, MirroredUserMini>;
}) {
  const part = sparePartById.get(row.sparePartId);
  const actor = row.actorId ? actorById.get(row.actorId) : null;
  const summary = resolveReferenceSummary(row.referenceType, row.referenceId, refCtx);
  return (
    <tr
      className={`${odd ? "bg-[#FBFBFC]" : "bg-white"} border-b border-[var(--color-border-default)] hover:bg-[var(--color-navy-50)]`}
    >
      <Td>
        <Link
          href={`/inventory/movements/${row.id}?kind=spare`}
          className="text-[var(--color-navy-700)] hover:underline"
        >
          {formatDateTime(row.occurredAt)}
        </Link>
      </Td>
      <Td>{formatMovementType(row.movementType)}</Td>
      <Td>
        {part ? (
          <>
            <span className="font-medium">{part.name}</span>{" "}
            <span className="text-[11px] text-[var(--color-ink-500)] font-mono ml-1">{part.sku}</span>
          </>
        ) : (
          <span className="font-mono text-[11.5px] text-[var(--color-ink-500)]">{row.sparePartId}</span>
        )}
      </Td>
      <Td>
        <span className={row.quantity >= 0 ? "text-[var(--color-success-700)]" : "text-[var(--color-danger-700)]"}>
          {row.quantity >= 0 ? "+" : ""}
          {row.quantity}
        </span>
      </Td>
      <Td>{actor?.fullName ?? <span className="text-[var(--color-ink-400)]">--</span>}</Td>
      <Td>{summary.label || <span className="text-[var(--color-ink-400)]">--</span>}</Td>
    </tr>
  );
}
