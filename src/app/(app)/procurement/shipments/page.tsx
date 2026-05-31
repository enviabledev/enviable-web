"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import ShipmentStatusPill from "@/components/shipments/ShipmentStatusPill";
import FreshnessBadge from "@/components/sync/FreshnessBadge";
import OfflineNotice from "@/components/sync/OfflineNotice";
import {
  listShipments,
  SHIPMENT_STATUS,
  type ManifestLine,
  type ShipmentListRow,
  type ShipmentStatus,
} from "@/lib/api";
import { formatDateShort } from "@/lib/format";
import { listByType } from "@/lib/sync/mirror/store";

// Mirror's shipment bucket stores the flat row (no nested manifestLines);
// the online ShipmentListRow includes manifestLines for the per-row count.
// Look up manifestLines from its own bucket and reconstruct the array per
// shipmentId so the existing render logic works unchanged.
type MirroredShipment = Omit<ShipmentListRow, "manifestLines">;
type MirroredManifestLine = ManifestLine & { shipmentId: string };

function readParams(sp: URLSearchParams): { status: ShipmentStatus | ""; purchaseOrderId: string } {
  const statusRaw = sp.get("status") ?? "";
  const status: ShipmentStatus | "" = (SHIPMENT_STATUS as readonly string[]).includes(statusRaw)
    ? (statusRaw as ShipmentStatus)
    : "";
  const purchaseOrderId = sp.get("purchaseOrderId") ?? "";
  return { status, purchaseOrderId };
}

function buildHref(params: { status: ShipmentStatus | ""; purchaseOrderId: string }): string {
  const usp = new URLSearchParams();
  if (params.status) usp.set("status", params.status);
  if (params.purchaseOrderId) usp.set("purchaseOrderId", params.purchaseOrderId);
  const qs = usp.toString();
  return qs ? `?${qs}` : "";
}

export default function ShipmentsListPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const params = useMemo(() => readParams(new URLSearchParams(sp.toString())), [sp]);
  const [rows, setRows] = useState<ShipmentListRow[] | null>(null);
  const [errMsg, setErrMsg] = useState<string>("");
  const [offline, setOffline] = useState(false);
  const [fromMirror, setFromMirror] = useState(false);

  // Mirror-first paint, revalidate with network.
  const mirrorPaintedRef = useRef(false);
  useEffect(() => {
    const ctrl = new AbortController();
    mirrorPaintedRef.current = false;
    setErrMsg("");
    setOffline(false);

    // Phase 1: paint from mirror.
    (async () => {
      try {
        const [mirroredShipments, mirroredLines] = await Promise.all([
          listByType<MirroredShipment>("shipment"),
          listByType<MirroredManifestLine>("manifestLine"),
        ]);
        if (ctrl.signal.aborted) return;
        const linesByShipment = new Map<string, ManifestLine[]>();
        for (const l of mirroredLines) {
          const sid = l.body.shipmentId;
          if (!sid) continue;
          const arr = linesByShipment.get(sid) ?? [];
          arr.push(l.body);
          linesByShipment.set(sid, arr);
        }
        const reconstructed: ShipmentListRow[] = mirroredShipments
          .map((m) => ({
            ...m.body,
            manifestLines: linesByShipment.get(m.body.id) ?? [],
          }))
          .filter((s) => {
            if (params.status && s.status !== params.status) return false;
            if (params.purchaseOrderId && s.purchaseOrderId !== params.purchaseOrderId) return false;
            return true;
          });
        if (reconstructed.length > 0 || mirroredShipments.length > 0) {
          mirrorPaintedRef.current = true;
          setRows(reconstructed);
          setFromMirror(true);
        }
      } catch {
        // Let the network phase drive.
      }
    })();

    // Phase 2: revalidate.
    listShipments(
      {
        status: params.status || undefined,
        purchaseOrderId: params.purchaseOrderId || undefined,
      },
      ctrl.signal,
    ).then((r) => {
      if (ctrl.signal.aborted) return;
      if (r.kind === "ok") {
        setRows(r.data);
        setFromMirror(false);
      } else if (r.kind === "unauthorized") {
        router.replace("/login");
      } else if (r.kind === "forbidden") {
        setErrMsg("You do not have access to view shipments.");
      } else if (r.kind === "network_error" || r.kind === "server_error") {
        if (!mirrorPaintedRef.current) setOffline(true);
      } else if ("message" in r) {
        setErrMsg(typeof r.message === "string" ? r.message : r.message.join("; "));
      }
    });
    return () => ctrl.abort();
  }, [params, router]);

  const update = useCallback(
    (next: Partial<typeof params>) => {
      router.replace(`/procurement/shipments${buildHref({ ...params, ...next })}`);
    },
    [params, router],
  );

  return (
    <div className="max-w-[1480px] mx-auto pb-10">
      <header className="flex items-end justify-between gap-6 pb-4 mb-4 border-b border-[var(--color-border-default)]">
        <div>
          <div className="text-[12px] text-[var(--color-ink-500)] flex items-center gap-1.5 mb-1.5">
            <span>Procurement</span>
            <span className="text-[var(--color-ink-300)]">/</span>
            <span className="text-[var(--color-ink-900)] font-medium">Shipments</span>
          </div>
          <h1 className="text-[24px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em] flex items-center gap-3">
            Shipments
            {rows && (
              <span className="font-mono text-[12px] bg-[var(--color-navy-50)] text-[var(--color-navy-800)] px-2.5 py-1 rounded-[3px] font-semibold">
                {rows.length} total
              </span>
            )}
            {fromMirror && <FreshnessBadge />}
          </h1>
          <div className="text-[13px] text-[var(--color-ink-500)] mt-1">
            Inbound containers from suppliers. Once a shipment clears customs, units are received against its manifest.
          </div>
        </div>
      </header>

      <div className="bg-white border border-[var(--color-border-default)] rounded-[4px] p-3.5 mb-3.5 grid grid-cols-[1fr_1fr_auto] gap-3 items-end">
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--color-ink-500)]">
            Status
          </span>
          <select
            value={params.status}
            onChange={(e) => update({ status: e.target.value as ShipmentStatus | "" })}
            className="h-8 px-2.5 bg-white border border-[var(--color-border-strong)] rounded-[3px] text-[13px] text-[var(--color-ink-900)] cursor-pointer focus:outline-none focus:border-[var(--color-navy-700)] focus:shadow-[0_0_0_3px_rgba(31,78,121,0.10)]"
          >
            <option value="">All statuses</option>
            {SHIPMENT_STATUS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--color-ink-500)]">
            Purchase Order ID
          </span>
          <input
            type="text"
            value={params.purchaseOrderId}
            onChange={(e) => update({ purchaseOrderId: e.target.value })}
            placeholder="Filter by PO id"
            className="h-8 px-2.5 bg-white border border-[var(--color-border-strong)] rounded-[3px] text-[13px] text-[var(--color-ink-900)] focus:outline-none focus:border-[var(--color-navy-700)] focus:shadow-[0_0_0_3px_rgba(31,78,121,0.10)]"
          />
        </div>
        <button
          type="button"
          onClick={() => router.replace("/procurement/shipments")}
          disabled={!params.status && !params.purchaseOrderId}
          className={`h-8 px-3 rounded-[3px] text-[13px] font-medium inline-flex items-center self-end ${
            !params.status && !params.purchaseOrderId
              ? "text-[var(--color-ink-400)] cursor-default"
              : "text-[var(--color-navy-700)] hover:bg-[var(--color-navy-50)] cursor-pointer"
          }`}
        >
          Reset
        </button>
      </div>

      <section className="bg-white border border-[var(--color-border-default)] rounded-[4px]">
        <table className="w-full text-[13px]">
          <thead>
            <tr>
              <Th>Reference</Th>
              <Th>Purchase Order</Th>
              <Th>Status</Th>
              <Th>Vessel</Th>
              <Th>BOL</Th>
              <Th>ETA</Th>
              <Th>Cleared</Th>
              <Th align="right">Manifest Lines</Th>
            </tr>
          </thead>
          <tbody>
            {rows === null && !errMsg && !offline && (
              <tr>
                <td colSpan={8} className="px-3.5 py-12 text-center text-[var(--color-ink-500)]">
                  Loading shipments...
                </td>
              </tr>
            )}
            {offline && (
              <tr>
                <td colSpan={8} className="px-3.5 py-8">
                  <OfflineNotice body="The shipments list will load when the connection returns. Any offline receipts you've already queued are saved locally and sync automatically once reconnected; see Sync Conflicts in the sidebar if any need your attention." />
                </td>
              </tr>
            )}
            {errMsg && (
              <tr>
                <td colSpan={8} className="px-3.5 py-12 text-center text-[var(--color-danger-700)]">
                  {errMsg}
                </td>
              </tr>
            )}
            {rows && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3.5 py-12 text-center text-[var(--color-ink-500)]">
                  No shipments match the current filters.
                </td>
              </tr>
            )}
            {rows &&
              rows.map((row, i) => (
                <tr key={row.id} className={`${i % 2 ? "bg-[#FBFBFC]" : "bg-white"} hover:bg-[var(--color-navy-50)] border-b border-[var(--color-border-default)]`}>
                  <Td>
                    <Link
                      href={`/procurement/shipments/${row.id}`}
                      className="font-mono text-[12px] text-[var(--color-navy-700)] hover:underline tracking-[0.02em]"
                    >
                      {row.shipmentReference}
                    </Link>
                  </Td>
                  <Td>
                    <span className="font-mono text-[11.5px] text-[var(--color-ink-700)]">
                      {row.purchaseOrderId}
                    </span>
                  </Td>
                  <Td>
                    <ShipmentStatusPill status={row.status} />
                  </Td>
                  <Td>{row.vesselName ?? <span className="text-[var(--color-ink-400)]">--</span>}</Td>
                  <Td>
                    {row.billOfLadingNumber ? (
                      <span className="font-mono text-[11.5px]">{row.billOfLadingNumber}</span>
                    ) : (
                      <span className="text-[var(--color-ink-400)]">--</span>
                    )}
                  </Td>
                  <Td>{row.eta ? formatDateShort(row.eta) : <span className="text-[var(--color-ink-400)]">--</span>}</Td>
                  <Td>{row.clearedAt ? formatDateShort(row.clearedAt) : <span className="text-[var(--color-ink-400)]">--</span>}</Td>
                  <td className="px-3.5 py-2.5 text-right tabular-nums whitespace-nowrap text-[var(--color-ink-900)]">
                    {row.manifestLines.length}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      className={`font-medium text-[11px] uppercase tracking-[0.04em] text-[var(--color-ink-500)] px-3.5 py-2.5 border-b border-[var(--color-border-default)] bg-[var(--color-ink-100)] whitespace-nowrap ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3.5 py-2.5 align-middle text-[var(--color-ink-900)] whitespace-nowrap">{children}</td>;
}
