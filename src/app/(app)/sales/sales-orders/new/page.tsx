"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import SoForm from "@/components/sales-orders/SoForm";
import { createSalesOrder } from "@/lib/api";
import { usePermissions } from "@/lib/auth";

export default function NewSalesOrderPage() {
  const router = useRouter();
  const { has } = usePermissions();

  if (!has("salesorder.create")) {
    return (
      <div className="max-w-[920px] mx-auto py-10 text-center text-[var(--color-ink-500)]">
        You do not have permission to create sales orders.
      </div>
    );
  }

  return (
    <div className="max-w-[1080px] mx-auto pb-10">
      <header className="flex items-end justify-between gap-6 pb-4 mb-5 border-b border-[var(--color-border-default)]">
        <div>
          <div className="text-[12px] text-[var(--color-ink-500)] flex items-center gap-1.5 mb-1.5">
            <Link href="/sales/sales-orders" className="text-[var(--color-ink-500)] hover:text-[var(--color-navy-700)]">
              Sales
            </Link>
            <span className="text-[var(--color-ink-300)]">/</span>
            <Link href="/sales/sales-orders" className="text-[var(--color-ink-500)] hover:text-[var(--color-navy-700)]">
              Sales Orders
            </Link>
            <span className="text-[var(--color-ink-300)]">/</span>
            <span className="text-[var(--color-ink-900)] font-medium">New</span>
          </div>
          <h1 className="text-[24px] font-semibold text-[var(--color-ink-900)] m-0 tracking-[-0.01em]">
            New Sales Order
          </h1>
          <div className="text-[13px] text-[var(--color-ink-500)] mt-1 max-w-[820px]">
            Allocate specific units (by engine and chassis) to the order. Allocation is a soft
            reservation: each unit stays in the warehouse with its real status until release.
            Status only changes to SOLD at release, which is a separate later step.
          </div>
        </div>
      </header>

      <SoForm
        mode="create"
        onSubmit={async (body) => {
          const result = await createSalesOrder(body);
          if (result.kind === "ok") {
            router.replace(`/sales/sales-orders/${result.data.id}`);
          }
          return result;
        }}
      />
    </div>
  );
}
