/**
 * Calm offline placeholder for data screens that couldn't reach the backend.
 * Renders in a soft white card with a warning dot, never a red error banner.
 *
 * Use this where a page tried to fetch and got a transient failure (a
 * network_error or server_error from apiFetch, see isTransientFailure). The
 * topbar sync indicator is still the canonical surface for connectivity
 * state; this card is just an in-flow explanation of why the screen is empty.
 */
export default function OfflineNotice({
  title = "You're offline",
  body = "This screen will load when the connection returns. Any offline edits you queue are saved locally and sync automatically once reconnected.",
}: {
  title?: string;
  body?: string;
}) {
  return (
    <div className="max-w-[520px] mx-auto mt-10 px-3.5 py-3 rounded-[4px] bg-white border border-[var(--color-border-default)] text-[12.5px] text-[var(--color-ink-700)] leading-[1.55]">
      <div className="flex items-center gap-2 mb-1">
        <span
          aria-hidden
          className="w-[6px] h-[6px] rounded-full"
          style={{ background: "var(--color-warning-700)" }}
        />
        <span className="font-semibold text-[var(--color-ink-900)]">
          {title}
        </span>
      </div>
      {body}
    </div>
  );
}
