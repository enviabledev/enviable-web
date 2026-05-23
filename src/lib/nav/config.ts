/**
 * Declarative navigation metadata. Each item lists the permission keys the
 * backend would require for the destination screen; the sidebar renders only
 * items the principal holds ALL of (mirroring the backend's AND-only
 * PermissionsGuard). Empty `permissions` = visible to any authenticated user.
 *
 * Keys are drawn from enviable-op/enviable-system/prisma/seed.ts. Items that
 * have no backing permission yet (Letters of Credit, Settings) are not listed
 * here; the handoff shows them but the API does not support them, and per
 * CLAUDE.md the API is the source of truth.
 */
import type { ComponentType, SVGProps } from "react";

import {
  AssemblyIcon,
  AuditIcon,
  CustomersIcon,
  DashboardIcon,
  DeliveriesIcon,
  HistoricalLoadIcon,
  MovementsIcon,
  PaymentsIcon,
  PricelistIcon,
  ProformaIcon,
  PurchaseOrderIcon,
  RevenueIcon,
  RolesIcon,
  SalesOrderIcon,
  ShipmentIcon,
  SparePartsIcon,
  StocksIcon,
  SuppliersIcon,
  UnitsIcon,
  UsersIcon,
} from "@/components/icons";

export type NavIcon = ComponentType<SVGProps<SVGSVGElement>>;

export type NavItem = {
  label: string;
  href: string;
  icon: NavIcon;
  permissions: readonly string[];
};

export type NavGroup = {
  label: string;
  items: readonly NavItem[];
};

export const NAV: readonly NavGroup[] = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", href: "/", icon: DashboardIcon, permissions: [] },
    ],
  },
  {
    label: "Procurement",
    items: [
      { label: "Purchase Orders", href: "/procurement/purchase-orders", icon: PurchaseOrderIcon, permissions: ["po.read"] },
      { label: "Proforma Invoices", href: "/procurement/proforma-invoices", icon: ProformaIcon, permissions: ["pi.read"] },
      { label: "Suppliers & Counterparties", href: "/procurement/counterparties", icon: SuppliersIcon, permissions: ["counterparty.read"] },
      { label: "Shipments", href: "/procurement/shipments", icon: ShipmentIcon, permissions: ["shipment.read"] },
    ],
  },
  {
    label: "Inventory",
    items: [
      { label: "Units (kekes)", href: "/inventory/units", icon: UnitsIcon, permissions: ["unit.read"] },
      { label: "Spare Parts", href: "/inventory/spare-parts", icon: SparePartsIcon, permissions: ["sparepart.read"] },
      { label: "Stock Movements", href: "/inventory/movements", icon: MovementsIcon, permissions: ["movement.read"] },
      { label: "Assembly Jobs", href: "/inventory/assembly-jobs", icon: AssemblyIcon, permissions: ["assembly.read"] },
    ],
  },
  {
    label: "Sales",
    items: [
      { label: "Sales Orders", href: "/sales/sales-orders", icon: SalesOrderIcon, permissions: ["salesorder.read"] },
      { label: "Customers", href: "/sales/customers", icon: CustomersIcon, permissions: ["customer.read"] },
      { label: "Price Lists", href: "/sales/price-lists", icon: PricelistIcon, permissions: ["pricelist.read"] },
      { label: "Invoices & Payments", href: "/sales/invoices-payments", icon: PaymentsIcon, permissions: ["salesorder.read"] },
      { label: "Deliveries", href: "/sales/deliveries", icon: DeliveriesIcon, permissions: ["delivery.manage"] },
    ],
  },
  {
    label: "Reports",
    items: [
      { label: "Revenue & Sales", href: "/reports/revenue", icon: RevenueIcon, permissions: ["report.revenue"] },
      { label: "Stocks", href: "/reports/stocks", icon: StocksIcon, permissions: ["report.stocks"] },
      { label: "Customers", href: "/reports/customers", icon: CustomersIcon, permissions: ["report.customers"] },
      { label: "Audit Log", href: "/reports/audit-log", icon: AuditIcon, permissions: ["audit.read"] },
    ],
  },
  {
    label: "Admin",
    items: [
      { label: "Users", href: "/admin/users", icon: UsersIcon, permissions: ["user.read"] },
      { label: "Roles", href: "/admin/roles", icon: RolesIcon, permissions: ["role.read"] },
      { label: "Historical Data Load", href: "/admin/historical-load", icon: HistoricalLoadIcon, permissions: ["historicalload.run"] },
    ],
  },
];
