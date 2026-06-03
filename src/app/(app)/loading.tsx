/**
 * Route-transition loading fallback for every route under (app).
 *
 * Next App Router renders this while a route's bundle is being compiled
 * (dev server's first-hit on a never-visited route is the slow case;
 * Turbopack can take 10+ seconds on a cold compile) or while a server
 * component is suspended on data. Without this file, a slow route just
 * shows the previous page until the new one is ready, which reads as
 * "did my click register?" to the user.
 *
 * Shape mirrors the page chrome the user is about to see: a topbar-
 * height spacer, a content-area skeleton with a header row + a few row
 * blocks. The skeleton uses the standard ink-100 token for the bar fills
 * and a subtle pulse animation so the user immediately recognises this
 * as a load state and not a broken empty render.
 */
export default function AppLoading() {
  return (
    <div className="max-w-[1620px] mx-auto pb-10" role="status" aria-busy="true" aria-label="Loading">
      {/* Header skeleton */}
      <div className="pb-4 mb-4 border-b border-[var(--color-border-default)]">
        <div className="h-[14px] w-[180px] bg-[var(--color-ink-100)] rounded animate-pulse mb-2" />
        <div className="h-[26px] w-[260px] bg-[var(--color-ink-100)] rounded animate-pulse mb-2" />
        <div className="h-[14px] w-[480px] bg-[var(--color-ink-100)] rounded animate-pulse" />
      </div>

      {/* Filter bar skeleton */}
      <div className="bg-white border border-[var(--color-border-default)] rounded-[4px] px-3 py-2.5 mb-3 flex items-end gap-3">
        <div className="h-[40px] w-[140px] bg-[var(--color-ink-100)] rounded animate-pulse" />
        <div className="h-[40px] w-[140px] bg-[var(--color-ink-100)] rounded animate-pulse" />
        <div className="h-[40px] w-[260px] bg-[var(--color-ink-100)] rounded animate-pulse" />
      </div>

      {/* Table skeleton */}
      <div className="bg-white border border-[var(--color-border-default)] rounded-[4px]">
        <div className="px-4 py-2.5 border-b border-[var(--color-border-default)]">
          <div className="h-[16px] w-[180px] bg-[var(--color-ink-100)] rounded animate-pulse" />
        </div>
        <div className="px-4 py-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="grid grid-cols-6 gap-4 py-2.5 border-b border-[var(--color-border-default)] last:border-b-0"
            >
              <div className="h-[12px] bg-[var(--color-ink-100)] rounded animate-pulse" style={{ animationDelay: `${i * 50}ms` }} />
              <div className="h-[12px] bg-[var(--color-ink-100)] rounded animate-pulse" style={{ animationDelay: `${i * 50}ms` }} />
              <div className="h-[12px] bg-[var(--color-ink-100)] rounded animate-pulse" style={{ animationDelay: `${i * 50}ms` }} />
              <div className="h-[12px] bg-[var(--color-ink-100)] rounded animate-pulse" style={{ animationDelay: `${i * 50}ms` }} />
              <div className="h-[12px] bg-[var(--color-ink-100)] rounded animate-pulse" style={{ animationDelay: `${i * 50}ms` }} />
              <div className="h-[12px] bg-[var(--color-ink-100)] rounded animate-pulse" style={{ animationDelay: `${i * 50}ms` }} />
            </div>
          ))}
        </div>
      </div>

      <span className="sr-only">Loading the page contents...</span>
    </div>
  );
}
