"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import SoForm, { type SoFormInitial } from "@/components/sales-orders/SoForm";
import { getSalesOrder, soIsEditable, updateSalesOrder, type SalesOrderDetail } from "@/lib/api";
import { usePermissions } from "@/lib/auth";

type LoadState =
  | { status: "loading" }
  | { status: "ok"; so: SalesOrderDetail }
  | { status: "not_found" }
  | { status: "forbidden" }
  | { status: "not_editable"; so: SalesOrderDetail }
  | { status: "error"; message: string };

export default function EditSalesOrderPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { has } = usePermissions();
  const id = decodeURIComponent(params.id);

  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    const ctrl = new AbortController();
    getSalesOrder(id, ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      if (r.kind === "ok") {
        if (!soIsEditable(r.data.status)) setState({ status: "not_editable", so: r.data });
        else setState({ status: "ok", so: r.data });
      } else if (r.kind === "not_found") setState({ status: "not_found" });
      else if (r.kind === "unauthorized") router.replace("/login");
      else if (r.kind === "forbidden") setState({ status: "forbidden" });
      else setState({ status: "error", message: "message" in r ? String(r.message) : "Error" });
    });
    return () => ctrl.abort();
  }, [id, router]);

  if (!has("salesorder.create")) {
    return (
      <div className="max-w-[920px] mx-auto py-10 text-center text-[var(--color-ink-500)]">
        You do not have permission to edit sales orders.
      </div>
    );
  }
  if (state.status === "loading")
    return <div className="max-w-[1080px] mx-auto py-10 text-center text-[var(--color-ink-500)]">Loading...</div>;
  if (state.status === "not_found")
    return <div className="max-w-[1080px] mx-auto py-10 text-center text-[var(--color-ink-500)]">Sales order not found.</div>;
  if (state.status === "forbidden")
    return <div className="max-w-[1080px] mx-auto py-10 text-center text-[var(--color-ink-500)]">You do not have access to this sales order.</div>;
  if (state.status === "error")
    return <div className="max-w-[1080px] mx-auto py-10 text-center text-[var(--color-danger-700)]">{state.message}</div>;
  if (state.status === "not_editable") {
    return (
      <div className="max-w-[720px] mx-auto py-10">
        <div className="bg-white border border-[var(--color-warning-100)] rounded-[4px] px-5 py-4">
          <h2 className="m-0 mb-1 text-[14px] font-semibold text-[var(--color-warning-700)]">
            This sales order is no longer editable.
          </h2>
          <p className="text-[12.5px] text-[var(--color-ink-700)] m-0 mb-3">
            Only DRAFT sales orders can be edited. Current status:{" "}
            <span className="font-mono font-semibold">{state.so.status}</span>.
          </p>
          <Link
            href={`/sales/sales-orders/${state.so.id}`}
            className="inline-flex items-center h-8 px-3 rounded-[3px] text-[12.5px] font-medium text-white"
            style={{ background: "var(--color-navy-700)" }}
          >
            Back to detail
          </Link>
        </div>
      </div>
    );
  }

  const so = state.so;
  const initial: SoFormInitial = {
    customerId: so.customerId,
    lines: so.lines.map((l) => ({
      productVariantId: l.productVariantId,
      saleForm: l.saleForm,
      unitId: l.unitId ?? "",
      discountAmount: Number(l.discountAmount) > 0 ? l.discountAmount : "",
    })),
  };

  return (
    <div className="max-w-[1080px] mx-auto pb-10">
      <header className="flex items-end justify-between gap-6 pb-4 mb-5 border-b border-[var(--color-border-default)]">
        <div>
          <div className="text-[12px] text-[var(--color-ink-500)] flex items-center gap-1.5 mb-1.5 flex-wrap">
            <Link href="/sales/sales-orders" className="text-[var(--color-ink-500)] hover:text-[var(--color-navy-700)]">
              Sales
            </Link>
            <span className="text-[var(--color-ink-300)]">/</span>
            <Link href="/sales/sales-orders" className="text-[var(--color-ink-500)] hover:text-[var(--color-navy-700)]">
              Sales Orders
            </Link>
            <span className="text-[var(--color-ink-300)]">/</span>
            <Link href={`/sales/sales-orders/${so.id}`} className="text-[var(--color-ink-500)] hover:text-[var(--color-navy-700)] font-mono">
              {so.soNumber}
            </Link>
            <span className="text-[var(--color-ink-300)]">/</span>
            <span className="text-[var(--color-ink-900)] font-medium">Edit</span>
          </div>
          <h1 className="text-[24px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em]">
            Edit <span className="font-mono">{so.soNumber}</span>
          </h1>
          <div className="text-[13px] text-[var(--color-ink-500)] mt-1">
            Editing replaces all lines and re-resolves prices. Submitting locks the order.
          </div>
        </div>
      </header>

      <SoForm
        mode="edit"
        initial={initial}
        submitLabel="Save Changes"
        excludeSoId={so.id}
        onSubmit={async (body) => {
          const result = await updateSalesOrder(so.id, body);
          if (result.kind === "ok") router.replace(`/sales/sales-orders/${so.id}`);
          return result;
        }}
      />
    </div>
  );
}
