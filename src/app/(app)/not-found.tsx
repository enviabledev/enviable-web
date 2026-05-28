import Link from "next/link";

/**
 * Graceful 404 for authenticated routes. Next renders this when notFound() is
 * triggered or an unmatched path is hit under (app), instead of the bare
 * default. Kept calm and on-brand, with a route back to the dashboard.
 */
export default function AppNotFound() {
  return (
    <div className="max-w-[560px] mx-auto mt-12">
      <div className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-6 py-6 text-center">
        <h1 className="m-0 mb-2 text-[18px] font-semibold text-[var(--color-ink-900)]">
          Page not found
        </h1>
        <p className="text-[13px] text-[var(--color-ink-700)] m-0 mb-5">
          This page doesn&apos;t exist, or it may have moved. Check the address, or head back to
          a known screen.
        </p>
        <Link
          href="/"
          className="inline-flex items-center h-8 px-3 rounded-[3px] text-[12.5px] font-medium text-white"
          style={{ background: "var(--color-navy-700)" }}
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
