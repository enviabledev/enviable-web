"use client";

/**
 * Price lists at /sales/price-lists. Tier-bound pricing: one row per
 * (productVariant, customerTier) currently-active entry. Gated
 * 'pricelist.read'. Mirror-first paint + FreshnessBadge offline.
 *
 * The detail at /sales/price-lists/[variantId]?tier=<tierId> surfaces the
 * full effective-dated history for one (variant, tier) tuple and exposes
 * the supersede form when the user has 'pricelist.manage'. Writes are
 * online-only and the form makes that explicit when offline.
 *
 * No cost-gating here: price is the selling price, visible to all who
 * can read the catalogue. The backend strips landedCost-style fields
 * via the global CostVisibilityInterceptor; price is not in that set.
 */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { PricelistIcon, SearchIcon } from "@/components/icons";
import FreshnessBadge from "@/components/sync/FreshnessBadge";
import OfflineNotice from "@/components/sync/OfflineNotice";
import {
  listPrices,
  type PriceListEntry,
} from "@/lib/api";
import { isTransientFailure } from "@/lib/api/client";
import { usePermissions } from "@/lib/auth";
import { formatDateShort, formatNGN } from "@/lib/format";
import { listByType } from "@/lib/sync/mirror/store";

type MirroredEntry = {
  id: string;
  productVariantId: string;
  customerTierId: string;
  price: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  setById: string | null;
  updatedAt: string;
};
type MirroredVariant = {
  id: string;
  supplierSkuCode: string;
  productId?: string;
  variantAttributes?: { model?: string; colour?: string; [k: string]: string | undefined };
};
type MirroredProduct = { id: string; name: string };
type MirroredTier = { id: string; name: string };

type Row = {
  entryId: string;
  variantId: string;
  variantSku: string;
  variantLabel: string;
  productName: string | null;
  tierId: string;
  tierName: string;
  price: string;
  effectiveFrom: string;
};

function readParams(sp: URLSearchParams) {
  return {
    search: sp.get("search") ?? "",
    tier: sp.get("tier") ?? "",
  };
}

function buildHref(p: Partial<ReturnType<typeof readParams>>): string {
  const sp = new URLSearchParams();
  if (p.search) sp.set("search", p.search);
  if (p.tier) sp.set("tier", p.tier);
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

function rowsFromEntries(
  entries: PriceListEntry[] | MirroredEntry[],
  variantById: Map<string, MirroredVariant>,
  productById: Map<string, MirroredProduct>,
  tierById: Map<string, MirroredTier>,
): Row[] {
  return entries
    .filter((e) => e.effectiveTo == null)
    .map<Row>((e) => {
      const variant = variantById.get(e.productVariantId);
      const product = variant?.productId ? productById.get(variant.productId) : null;
      const attrs = variant?.variantAttributes ?? {};
      const variantLabel =
        [attrs.model, attrs.colour].filter(Boolean).join(" ") ||
        variant?.supplierSkuCode ||
        "Variant";
      return {
        entryId: e.id,
        variantId: e.productVariantId,
        variantSku: variant?.supplierSkuCode ?? e.productVariantId,
        variantLabel,
        productName: product?.name ?? null,
        tierId: e.customerTierId,
        tierName: tierById.get(e.customerTierId)?.name ?? e.customerTierId,
        price: e.price,
        effectiveFrom: e.effectiveFrom,
      };
    });
}

export default function PriceListsPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const { has } = usePermissions();
  const canRead = has("pricelist.read");

  const params = useMemo(() => readParams(new URLSearchParams(sp.toString())), [sp]);
  const [searchDraft, setSearchDraft] = useState(params.search);
  useEffect(() => setSearchDraft(params.search), [params.search]);

  const [rows, setRows] = useState<Row[] | null>(null);
  const [tiers, setTiers] = useState<MirroredTier[]>([]);
  const [fromMirror, setFromMirror] = useState(false);
  const [offline, setOffline] = useState(false);
  const [errMsg, setErrMsg] = useState("");

  const navigate = useCallback(
    (next: Partial<ReturnType<typeof readParams>>) => {
      router.replace(`/sales/price-lists${buildHref({ ...params, ...next })}`);
    },
    [params, router],
  );

  useEffect(() => {
    if (!canRead) return;
    const ctrl = new AbortController();
    let mirrorPainted = false;
    setOffline(false);

    (async () => {
      try {
        const [pls, variants, products, tiersM] = await Promise.all([
          listByType<MirroredEntry>("priceListEntry"),
          listByType<MirroredVariant>("productVariant"),
          listByType<MirroredProduct>("product"),
          listByType<MirroredTier>("customerTier"),
        ]);
        if (ctrl.signal.aborted) return;
        const variantById = new Map(variants.map((v) => [v.body.id, v.body]));
        const productById = new Map(products.map((p) => [p.body.id, p.body]));
        const tierById = new Map(tiersM.map((t) => [t.body.id, t.body]));
        const built = rowsFromEntries(
          pls.map((p) => p.body),
          variantById,
          productById,
          tierById,
        );
        if (built.length > 0) {
          mirrorPainted = true;
          setRows(built);
          setFromMirror(true);
          setTiers(tiersM.map((t) => t.body));
        }
      } catch {
        // network drives
      }
    })();

    listPrices({ includeClosed: false }, ctrl.signal).then(async (r) => {
      if (ctrl.signal.aborted) return;
      if (r.kind === "ok") {
        // Rebuild rows using the SAME join sources from the mirror so the
        // variant label / product name / tier name reconstruction is the
        // same on both paths (online join echoes only variantId/tierId
        // summaries from the server; the mirror has the fuller variant
        // attributes for the label).
        const [variants, products, tiersM] = await Promise.all([
          listByType<MirroredVariant>("productVariant"),
          listByType<MirroredProduct>("product"),
          listByType<MirroredTier>("customerTier"),
        ]);
        const variantById = new Map(variants.map((v) => [v.body.id, v.body]));
        const productById = new Map(products.map((p) => [p.body.id, p.body]));
        const tierById = new Map(tiersM.map((t) => [t.body.id, t.body]));
        const built = rowsFromEntries(r.data, variantById, productById, tierById);
        setRows(built);
        setFromMirror(false);
        setTiers(tiersM.map((t) => t.body));
        setErrMsg("");
      } else if (r.kind === "unauthorized") {
        router.replace("/login");
      } else if (r.kind === "forbidden") {
        setErrMsg("You do not have access to read prices.");
      } else if (isTransientFailure(r)) {
        if (!mirrorPainted) setOffline(true);
      } else if ("message" in r) {
        setErrMsg(typeof r.message === "string" ? r.message : r.message.join("; "));
      }
    });

    return () => ctrl.abort();
  }, [canRead, router]);

  if (!canRead) {
    return (
      <div className="max-w-[1080px] mx-auto py-10 text-center text-[var(--color-ink-500)]">
        You do not have access to price lists (requires pricelist.read).
      </div>
    );
  }

  const filtered = (rows ?? []).filter((r) => {
    if (params.tier && r.tierId !== params.tier) return false;
    if (params.search) {
      const q = params.search.toUpperCase();
      if (
        !r.variantSku.toUpperCase().includes(q) &&
        !r.variantLabel.toUpperCase().includes(q) &&
        !(r.productName ?? "").toUpperCase().includes(q)
      ) {
        return false;
      }
    }
    return true;
  });

  return (
    <div className="max-w-[1480px] mx-auto pb-10">
      <header className="flex items-end justify-between gap-6 pb-4 mb-4 border-b border-[var(--color-border-default)]">
        <div>
          <div className="text-[12px] text-[var(--color-ink-500)] mb-1.5">Sales / Price lists</div>
          <h1 className="text-[22px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em] flex items-center gap-2">
            <PricelistIcon className="w-[18px] h-[18px] text-[var(--color-ink-500)]" />
            Price lists
          </h1>
          <div className="text-[12.5px] text-[var(--color-ink-500)] mt-1 max-w-[820px]">
            One active selling price per (variant, customer tier). Setting a new price atomically closes the
            prior entry&apos;s effective window and opens a new one, leaving the prior price in place as
            part of the history. Reads cache offline; setting a price requires a connection.
          </div>
        </div>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          navigate({ search: searchDraft });
        }}
        className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-3 py-2.5 mb-3 flex items-end gap-3 flex-wrap"
      >
        <Field label="Tier">
          <select
            value={params.tier}
            onChange={(e) => navigate({ tier: e.target.value })}
            className="h-[28px] px-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] text-[var(--color-ink-900)]"
          >
            <option value="">All tiers</option>
            {tiers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Search variant / product / SKU">
          <div className="relative">
            <SearchIcon className="absolute left-2 top-1/2 -translate-y-1/2 w-[12px] h-[12px] text-[var(--color-ink-500)]" />
            <input
              type="text"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="e.g. ZS+ G Yellow"
              className="h-[28px] w-[280px] pl-6 pr-2 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] text-[var(--color-ink-900)]"
            />
          </div>
        </Field>
        <button
          type="submit"
          className="h-[28px] px-3 rounded-[3px] bg-[var(--color-navy-700)] text-white text-[12.5px] font-medium"
        >
          Search
        </button>
        {(params.tier || params.search) && (
          <button
            type="button"
            onClick={() => {
              setSearchDraft("");
              navigate({ tier: "", search: "" });
            }}
            className="h-[28px] px-3 rounded-[3px] bg-white border border-[var(--color-border-default)] text-[var(--color-ink-700)] text-[12px] hover:border-[var(--color-navy-700)] hover:text-[var(--color-navy-700)]"
          >
            Clear
          </button>
        )}
      </form>

      {errMsg && <div className="py-10 text-center text-[var(--color-danger-700)]">{errMsg}</div>}
      {!errMsg && !rows && offline && (
        <OfflineNotice body="Prices will load once you are back online. Anything already cached appears here from the local mirror." />
      )}
      {!errMsg && !rows && !offline && (
        <div className="py-10 text-center text-[var(--color-ink-500)]">Loading prices...</div>
      )}
      {!errMsg && rows && (
        <section className="bg-white border border-[var(--color-border-default)] rounded-[4px]">
          <header className="px-4 py-2.5 border-b border-[var(--color-border-default)] flex items-center justify-between">
            <h2 className="m-0 text-[13px] font-semibold text-[var(--color-ink-900)] flex items-center gap-2">
              Active prices
              <span className="text-[11px] text-[var(--color-ink-500)] font-medium ml-1">
                {filtered.length} of {rows.length}
              </span>
              {fromMirror && <FreshnessBadge />}
            </h2>
          </header>
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-[12.5px] text-[var(--color-ink-500)]">
              No active prices match the current filters.
            </div>
          ) : (
            <table className="w-full text-[13px]">
              <thead>
                <tr>
                  <Th>Variant</Th>
                  <Th>SKU</Th>
                  <Th>Tier</Th>
                  <Th align="right">Active price</Th>
                  <Th>Effective from</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr
                    key={r.entryId}
                    className={`${i % 2 ? "bg-[#FBFBFC]" : "bg-white"} border-b border-[var(--color-border-default)] hover:bg-[var(--color-navy-50)]`}
                  >
                    <Td>
                      <Link
                        href={`/sales/price-lists/${r.variantId}?tier=${r.tierId}`}
                        className="text-[var(--color-navy-700)] hover:underline font-medium"
                      >
                        {r.variantLabel}
                      </Link>
                      {r.productName && (
                        <span className="text-[11px] text-[var(--color-ink-500)] ml-2">{r.productName}</span>
                      )}
                    </Td>
                    <Td mono>{r.variantSku}</Td>
                    <Td>{r.tierName}</Td>
                    <Td align="right" mono>
                      <span className="text-[var(--color-ink-900)] font-semibold">{formatNGN(r.price)}</span>
                    </Td>
                    <Td>{formatDateShort(r.effectiveFrom)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
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
