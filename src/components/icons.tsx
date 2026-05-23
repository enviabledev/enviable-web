/**
 * Inline SVG icons lifted from design_handoff/App Shell.html. Stroke-only,
 * 16x16, currentColor. The shell renders these at 13px via CSS so paths are
 * authored at the handoff's native viewBox and scaled by the wrapper.
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export function DashboardIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="2" y="2" width="5" height="6" rx="0.5" />
      <rect x="9" y="2" width="5" height="4" rx="0.5" />
      <rect x="2" y="10" width="5" height="4" rx="0.5" />
      <rect x="9" y="8" width="5" height="6" rx="0.5" />
    </svg>
  );
}

export function PurchaseOrderIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="2.5" width="10" height="11.5" rx="1" />
      <path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" />
    </svg>
  );
}

export function ProformaIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 2.5h7l3 3V13a1 1 0 01-1 1H3.5a.5.5 0 01-.5-.5V2.5z" />
      <path d="M10 2.5v3h3M5.5 8.5h5M5.5 11h3.5" />
    </svg>
  );
}

export function SuppliersIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="5.5" cy="6" r="2" />
      <circle cx="11" cy="7" r="1.5" />
      <path d="M2 13c0-2 1.5-3.5 3.5-3.5S9 11 9 13M9 13c0-1.5 1-2.5 2-2.5s2 1 2 2.5" />
    </svg>
  );
}

export function ShipmentIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M2 4.5h7v6H2zM9 7h3.5l2 2v1.5H9z" />
      <circle cx="5" cy="12" r="1.2" />
      <circle cx="12" cy="12" r="1.2" />
    </svg>
  );
}

export function UnitsIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M1.5 11h2l1-3.5h6L12 11h2.5" />
      <path d="M2 11v1.5M14 11v1.5" />
      <circle cx="5" cy="12.5" r="1.3" />
      <circle cx="11" cy="12.5" r="1.3" />
    </svg>
  );
}

export function SparePartsIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M8 2.5l1.5 1.5L8 5.5 6.5 4 8 2.5zM2.5 8L4 6.5 5.5 8 4 9.5 2.5 8zM13.5 8L12 6.5 10.5 8 12 9.5 13.5 8zM8 13.5l1.5-1.5L8 10.5 6.5 12 8 13.5z" />
      <circle cx="8" cy="8" r="1.8" />
    </svg>
  );
}

export function MovementsIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M2 5h9M8 2.5L11 5 8 7.5M14 11H5M8 8.5L5 11l3 2.5" />
    </svg>
  );
}

export function AssemblyIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="2.5" y="6" width="11" height="7" rx="1" />
      <path d="M5 6V4a3 3 0 016 0v2M6 9h4M6 11h3" />
    </svg>
  );
}

export function SalesOrderIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="2.5" width="10" height="11.5" rx="1" />
      <path d="M5.5 6h5M5.5 8.5h5M5.5 11h3" />
    </svg>
  );
}

export function CustomersIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="8" cy="5.5" r="2.5" />
      <path d="M3 13.5c0-2.5 2.2-4.5 5-4.5s5 2 5 4.5" />
    </svg>
  );
}

export function PricelistIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M8.5 2.5l5 5-6 6-5-5V2.5h6z" />
      <circle cx="6" cy="6" r="0.8" fill="currentColor" />
    </svg>
  );
}

export function PaymentsIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3 2.5h10v11l-2-1-1.5 1L8 12.5l-1.5 1L5 12.5l-2 1v-11z" />
      <path d="M5.5 5.5h5M5.5 8h5" />
    </svg>
  );
}

export function DeliveriesIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M2 4.5h7v6H2zM9 7h3.5l2 2v1.5H9z" />
      <circle cx="5" cy="12" r="1.2" />
      <circle cx="12" cy="12" r="1.2" />
    </svg>
  );
}

export function RevenueIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M2 13l4-4 3 3 5-6" />
      <path d="M11 6h3v3" />
    </svg>
  );
}

export function StocksIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <rect x="3" y="9" width="2.5" height="5" />
      <rect x="6.75" y="6" width="2.5" height="8" />
      <rect x="10.5" y="3" width="2.5" height="11" />
    </svg>
  );
}

export function AuditIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M8 2a6 6 0 11-4.5 2" />
      <path d="M3.5 1.5v3h3M8 5v3.5l2 1.5" />
    </svg>
  );
}

export function UsersIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="8" cy="5.5" r="2.5" />
      <path d="M3 13.5c0-2.5 2.2-4.5 5-4.5s5 2 5 4.5" />
    </svg>
  );
}

export function RolesIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M8 2l5 2v4c0 3-2.5 5-5 6-2.5-1-5-3-5-6V4l5-2z" />
      <path d="M6 8l1.5 1.5L10.5 6.5" />
    </svg>
  );
}

export function HistoricalLoadIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <ellipse cx="8" cy="4" rx="5" ry="2" />
      <path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4" />
      <path d="M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M11 11l3 3" />
    </svg>
  );
}

export function HelpIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <circle cx="8" cy="8" r="6" />
      <path d="M6.5 6a1.5 1.5 0 113 0c0 1-1.5 1.2-1.5 2.5M8 11v.01" />
    </svg>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M3.5 11h9l-1-2V6.5a3.5 3.5 0 10-7 0V9l-1 2zM6.5 13a1.5 1.5 0 003 0" />
    </svg>
  );
}

export function SignOutIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M10 4V3a1 1 0 00-1-1H3.5a1 1 0 00-1 1v10a1 1 0 001 1H9a1 1 0 001-1v-1" />
      <path d="M7 8h7m0 0l-2.5-2.5M14 8l-2.5 2.5" />
    </svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M2 4l3 3 3-3" />
    </svg>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M10 4l-4 4 4 4" />
    </svg>
  );
}
