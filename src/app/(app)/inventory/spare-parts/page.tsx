"use client";

/**
 * Spare-parts catalogue list at /inventory/spare-parts. Read-only screen
 * gated 'sparepart.read'; the backend exposes no create/update/delete on
 * the spare-parts controller (only the historical-load admin endpoint
 * writes spare parts at MVP), so this is a pure catalogue surface.
 *
 * Mirror-first paint, FreshnessBadge offline, dense table per the design.
 * Filters mirror the backend's QuerySparePartsDto: status (ACTIVE /
 * DISCONTINUED) and search (substring across sku + name, case-insensitive).
 *
 * Cost-gating is by absence: a non-cost user's mirror has no
 * landedCostPerUnit on any spare-part row, so the cost column simply
 * does not appear for them. No client-side stripping.
 */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SearchIcon, SparePartsIcon } from "@/components/icons";
import FreshnessBadge from "@/components/sync/FreshnessBadge";
import OfflineNotice from "@/components/sync/OfflineNotice";
import {
  listSpareParts,
  SPARE_PART_STATUS,
  type SparePartListResponse,
  type SparePartListRow,
  type SparePartStatus,
} from "@/lib/api";
import { isTransientFailure } from "@/lib/api/client";
import { usePermissions } from "@/lib/auth";
import { formatNGN } from "@/lib/format";
import { listByType } from "@/lib/sync/mirror/store";

const PAGE_SIZES = [25, 50, 100, 250] as const;
type PageSize = (typeof PAGE_SIZES)[number];

function readParams(sp: URLSearchParams) {
  const pageRaw = Number(sp.get("page") ?? "1");
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
  const psRaw = Number(sp.get("pageSize") ?? "50");
  const pageSize: PageSize = (PAGE_SIZES as readonly number[]).includes(psRaw)
    ? (psRaw as PageSize)
    : 50;
  const statusRaw = sp.get("status") ?? "";
  const status: SparePartStatus | "" = (SPARE_PART_STATUS as readonly string[]).includes(statusRaw)
    ? (statusRaw as SparePartStatus)
    : "";
  const search = sp.get("search") ?? "";
  return { page, pageSize, status, search };
}

function buildHref(p: Partial<ReturnType<typeof readParams>>): string {
  const sp = new URLSearchParams();
  if (p.page && p.page > 1) sp.set("page", String(p.page));
  if (p.pageSize && p.pageSize !== 50) sp.set("pageSize", String(p.pageSize));
  if (p.status) sp.set("status", p.status);
  if (p.search) sp.set("search", p.search);
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

export default function SparePartsListPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const { has } = usePermissions();
  const canRead = has("sparepart.read");
  const showCost = has("costdata.view");

  const params = useMemo(() => readParams(new URLSearchParams(sp.toString())), [sp]);
  const [searchDraft, setSearchDraft] = useState(params.search);
  useEffect(() => setSearchDraft(params.search), [params.search]);

  const [data, setData] = useState<SparePartListResponse | null>(null);
  const [fromMirror, setFromMirror] = useState(false);
  const [offline, setOffline] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const mirrorPaintedRef = useRef(false);

  useEffect(() => {
    if (!canRead) return;
    const ctrl = new AbortController();
    mirrorPaintedRef.current = false;
    setOffline(false);

    // Phase 1: paint from the mirror, applying the same filters server-side
    // would (substring on sku + name, status equality). Catalogue is small
    // so the in-memory filter + pagination stays cheap.
    (async () => {
      try {
        const rows = await listByType<SparePartListRow>("sparePart");
        if (ctrl.signal.aborted) return;
        const filtered = rows
          .map((r) => r.body)
          .filter((p) => {
            if (params.status && p.status !== params.status) return false;
            if (params.search) {
              const q = params.search.toUpperCase();
              if (
                !(p.sku ?? "").toUpperCase().includes(q) &&
                !(p.name ?? "").toUpperCase().includes(q)
              ) {
                return false;
              }
            }
            return true;
          })
          .sort((a, b) => a.name.localeCompare(b.name));
        const start = (params.page - 1) * params.pageSize;
        const slice = filtered.slice(start, start + params.pageSize);
        if (rows.length > 0) {
          mirrorPaintedRef.current = true;
          setData({
            data: slice,
            page: params.page,
            pageSize: params.pageSize,
            total: filtered.length,
          });
          setFromMirror(true);
          setErrMsg("");
        }
      } catch {
        // network drives
      }
    })();

    // Phase 2: revalidate from the network.
    listSpareParts(
      {
        page: params.page,
        pageSize: params.pageSize,
        status: params.status || undefined,
        search: params.search || undefined,
      },
      ctrl.signal,
    ).then((r) => {
      if (ctrl.signal.aborted) return;
      if (r.kind === "ok") {
        setData(r.data);
        setFromMirror(false);
        setErrMsg("");
      } else if (r.kind === "unauthorized") {
        router.replace("/login");
      } else if (r.kind === "forbidden") {
        setErrMsg("You do not have access to read spare parts.");
      } else if (isTransientFailure(r)) {
        if (!mirrorPaintedRef.current) setOffline(true);
      } else if ("message" in r) {
        setErrMsg(typeof r.message === "string" ? r.message : r.message.join("; "));
      }
    });

    return () => ctrl.abort();
  }, [canRead, params, router]);

  const navigate = useCallbackNav(router, params);

  if (!canRead) {
    return (
      <div className="max-w-[1080px] mx-auto py-10 text-center text-[var(--color-ink-500)]">
        You do not have access to spare parts (requires sparepart.read).
      </div>
    );
  }

  return (
    <div className="max-w-[1620px] mx-auto pb-10">
      <header className="flex items-end justify-between gap-6 pb-4 mb-4 border-b border-[var(--color-border-default)]">
        <div>
          <div className="text-[12px] text-[var(--color-ink-500)] mb-1.5">Inventory / Spare parts</div>
          <h1 className="text-[22px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em] flex items-center gap-2">
            <SparePartsIcon className="w-[18px] h-[18px] text-[var(--color-ink-500)]" />
            Spare parts
          </h1>
          <div className="text-[12.5px] text-[var(--color-ink-500)] mt-1">
            Catalogue of spare parts in stock. Read-only at MVP; quantities are received via the bulk
            historical-load tool and adjusted through the spare-part movements audit trail.
          </div>
        </div>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          navigate({ search: searchDraft, page: 1 });
        }}
        className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-3 py-2.5 mb-3 flex items-end gap-3 flex-wrap"
      >
        <Field label="Status">
          <select
            value={params.status}
            onChange={(e) => navigate({ status: e.target.value as SparePartStatus | "", page: 1 })}
            className="h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] text-[var(--color-ink-900)]"
          >
            <option value="">All statuses</option>
            {SPARE_PART_STATUS.map((s) => (
              <option key={s} value={s}>
                {s === "ACTIVE" ? "Active" : "Discontinued"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Name or SKU">
          <div className="relative">
            <SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 w-[12px] h-[12px] text-[var(--color-ink-500)]" />
            <input
              type="text"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="e.g. Brake Pad"
              className="h-[28px] w-[260px] pl-6 pr-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] text-[var(--color-ink-900)]"
            />
          </div>
        </Field>
        <button
          type="submit"
          className="h-[28px] px-3 rounded-[3px] bg-[var(--color-navy-700)] text-white text-[12.5px] font-medium"
        >
          Search
        </button>
        {(params.status || params.search) && (
          <button
            type="button"
            onClick={() => {
              setSearchDraft("");
              navigate({ status: "", search: "", page: 1 });
            }}
            className="h-[28px] px-3 rounded-[3px] bg-white border border-[var(--color-border-default)] text-[var(--color-ink-700)] text-[12px] hover:border-[var(--color-navy-700)] hover:text-[var(--color-navy-700)]"
          >
            Clear
          </button>
        )}
      </form>

      {errMsg && <div className="py-10 text-center text-[var(--color-danger-700)]">{errMsg}</div>}
      {!errMsg && !data && offline && (
        <OfflineNotice body="Spare parts will load once you are back online. Items already in the local mirror appear here." />
      )}
      {!errMsg && !data && !offline && (
        <div className="py-10 text-center text-[var(--color-ink-500)]">Loading spare parts...</div>
      )}
      {!errMsg && data && (
        <section className="bg-white border border-[var(--color-border-default)] rounded-[4px]">
          <header className="px-4 py-2.5 border-b border-[var(--color-border-default)] flex items-center justify-between">
            <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)] flex items-center gap-2">
              Catalogue
              <span className="text-[11px] text-[var(--color-ink-500)] font-medium ml-1">
                {data.total} total
              </span>
              {fromMirror && <FreshnessBadge />}
            </h2>
            <div className="flex items-center gap-2 text-[11px] text-[var(--color-ink-500)]">
              <span>Rows per page</span>
              <select
                value={params.pageSize}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if ((PAGE_SIZES as readonly number[]).includes(v)) {
                    navigate({ pageSize: v as PageSize, page: 1 });
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
          {data.data.length === 0 ? (
            <div className="px-4 py-8 text-center text-[12.5px] text-[var(--color-ink-500)]">
              No spare parts match the current filters.
            </div>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr>
                  <Th>SKU</Th>
                  <Th>Name</Th>
                  <Th align="right">Quantity on hand</Th>
                  {showCost && <Th align="right">Landed cost / unit</Th>}
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((p, i) => (
                  <tr
                    key={p.id}
                    className={`${i % 2 ? "bg-[#FBFBFC]" : "bg-white"} border-b border-[var(--color-border-default)] hover:bg-[var(--color-navy-50)]`}
                  >
                    <Td mono>
                      <Link
                        href={`/inventory/spare-parts/${p.id}`}
                        className="text-[var(--color-navy-700)] hover:underline"
                      >
                        {p.sku}
                      </Link>
                    </Td>
                    <Td>{p.name}</Td>
                    <Td align="right" mono>
                      <span
                        className={
                          p.quantityOnHand === 0
                            ? "text-[var(--color-warning-700)] font-semibold"
                            : "text-[var(--color-ink-900)]"
                        }
                      >
                        {p.quantityOnHand.toLocaleString()}
                      </span>
                    </Td>
                    {showCost && (
                      <Td align="right" mono>
                        {p.landedCostPerUnit != null ? (
                          formatNGN(p.landedCostPerUnit)
                        ) : (
                          <span className="text-[var(--color-ink-400)]">--</span>
                        )}
                      </Td>
                    )}
                    <Td>
                      <span
                        className={`inline-flex items-center h-[18px] px-2 rounded-full text-[10.5px] font-semibold uppercase tracking-[0.02em] ${
                          p.status === "ACTIVE"
                            ? "bg-[var(--color-success-100)] text-[var(--color-success-700)]"
                            : "bg-[var(--color-ink-100)] text-[var(--color-ink-700)]"
                        }`}
                      >
                        {p.status === "ACTIVE" ? "Active" : "Discontinued"}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <PageFooter
            page={data.page}
            pageSize={params.pageSize}
            total={data.total}
            onPage={(p) => navigate({ page: p })}
          />
        </section>
      )}
    </div>
  );
}

function useCallbackNav(
  router: ReturnType<typeof useRouter>,
  params: ReturnType<typeof readParams>,
) {
  return useCallback(
    (next: Partial<ReturnType<typeof readParams>>) => {
      const merged = { ...params, ...next };
      router.replace(`/inventory/spare-parts${buildHref(merged)}`);
    },
    [params, router],
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
  mono = false,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  mono?: boolean;
}) {
  return (
    <td
      className={`px-3.5 py-2 text-[12.5px] text-[var(--color-ink-900)] whitespace-nowrap text-${align} ${
        mono ? "font-mono text-[12px] tracking-[0.02em]" : ""
      }`}
    >
      {children}
    </td>
  );
}

function PageFooter({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  return (
    <footer className="px-4 py-2 border-t border-[var(--color-border-default)] flex items-center justify-between text-[11.5px] text-[var(--color-ink-500)]">
      <span>
        Page {page} of {lastPage}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          className="h-[24px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[var(--color-ink-700)] disabled:opacity-40"
        >
          Previous
        </button>
        <button
          type="button"
          disabled={page >= lastPage}
          onClick={() => onPage(page + 1)}
          className="h-[24px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[var(--color-ink-700)] disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </footer>
  );
}
