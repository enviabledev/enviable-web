"use client";

/**
 * Shared similarity-warning Modal, used wherever a supply-side write hits the
 * backend's `kind: "similar-variant"` 409 (PO line creation today; future
 * entry points reuse this). One consistent decision surface across the app.
 *
 * The backend flags an incoming SKU as suspiciously close to an existing ACTIVE
 * variant (Levenshtein edit distance under a length-scaled threshold, or a long
 * shared prefix). That is almost always a typo of a SKU the catalogue already
 * has, so the DEFAULT, visually-primary choice is "Use the existing variant".
 * The escape hatch ("Create new variant anyway") re-submits with the override
 * flag for genuinely-distinct SKUs. Cancel aborts.
 *
 * Signature touch: the two SKUs are shown stacked with a character-level diff
 * so the operator can see at a glance exactly which characters differ. The diff
 * is the whole point of an edit-distance warning, so it earns the one bit of
 * visual emphasis on this screen; everything else stays quiet.
 */
import Modal from "@/components/ui/Modal";
import type { SimilarVariantConflict } from "@/lib/api";

type Choice = "use-existing" | "create-new" | "cancel";

/**
 * Per-character diff alignment via a classic LCS backtrace, so insertions and
 * deletions (not just substitutions) are highlighted correctly. Returns one
 * marked-up run per string for rendering. Same-length common runs stay plain;
 * differing characters are tinted (amber for the incoming, navy for the match).
 */
function diffChars(a: string, b: string): { aMarks: boolean[]; bMarks: boolean[] } {
  const n = a.length;
  const m = b.length;
  // LCS length table.
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const aMarks = new Array<boolean>(n).fill(false);
  const bMarks = new Array<boolean>(m).fill(false);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      aMarks[i] = true; // char in a not matched -> highlight as differing
      i++;
    } else {
      bMarks[j] = true;
      j++;
    }
  }
  while (i < n) aMarks[i++] = true;
  while (j < m) bMarks[j++] = true;
  return { aMarks, bMarks };
}

function MarkedSku({
  value,
  marks,
  tone,
  testId,
}: {
  value: string;
  marks: boolean[];
  tone: "incoming" | "match";
  testId: string;
}) {
  const markClass =
    tone === "incoming"
      ? "bg-[var(--color-warning-100)] text-[var(--color-warning-700)] rounded-[2px]"
      : "bg-[var(--color-navy-50)] text-[var(--color-navy-800)] rounded-[2px]";
  return (
    <span data-testid={testId} className="font-mono text-[13px] break-all leading-[1.6]">
      {Array.from(value).map((ch, idx) => (
        <span
          key={idx}
          className={marks[idx] ? `${markClass} px-[0.5px]` : undefined}
        >
          {ch === " " ? " " : ch}
        </span>
      ))}
    </span>
  );
}

export default function SimilarityWarningModal({
  open,
  conflict,
  contextLabel,
  busy = false,
  onChoose,
}: {
  open: boolean;
  conflict: SimilarVariantConflict | null;
  /** Short description of what action is paused, e.g. "this purchase-order line". */
  contextLabel?: string;
  busy?: boolean;
  onChoose: (choice: Choice) => void;
}) {
  if (!conflict) return null;
  const { aMarks, bMarks } = diffChars(conflict.incomingSku, conflict.match.supplierSkuCode);

  return (
    <Modal
      open={open}
      onClose={() => (busy ? undefined : onChoose("cancel"))}
      title="This SKU looks like an existing variant"
      testId="similarity-warning-modal"
      closeOnScrim={!busy}
      footer={
        <>
          <button
            type="button"
            onClick={() => onChoose("cancel")}
            disabled={busy}
            data-testid="similarity-cancel"
            className="h-[28px] px-3 rounded-[3px] border border-[var(--color-border-default)] bg-white text-[12.5px] text-[var(--color-ink-900)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onChoose("create-new")}
            disabled={busy}
            data-testid="similarity-create-new"
            className="h-[28px] px-3 rounded-[3px] border border-[var(--color-warning-700)] bg-white text-[12.5px] font-medium text-[var(--color-warning-700)] disabled:opacity-50"
          >
            {busy ? "Working..." : "Create new variant anyway"}
          </button>
          <button
            type="button"
            onClick={() => onChoose("use-existing")}
            disabled={busy}
            data-testid="similarity-use-existing"
            className="h-[28px] px-4 rounded-[3px] bg-[var(--color-navy-700)] text-white text-[12.5px] font-medium disabled:opacity-50"
          >
            Use existing variant
          </button>
        </>
      }
    >
      <div className="text-[12.5px] text-[var(--color-ink-700)] leading-[1.55] mb-3">
        The SKU you entered for {contextLabel ?? "this line"} is only{" "}
        <span className="font-semibold text-[var(--color-ink-900)]">
          {conflict.match.distance} character
          {conflict.match.distance === 1 ? "" : "s"}
        </span>{" "}
        different from a variant already in the catalogue. That is usually a typo. Use the
        existing variant, or create a brand-new one if these really are different products.
      </div>

      <div className="border border-[var(--color-border-default)] rounded-[3px] overflow-hidden mb-1">
        <div className="px-3 py-2 border-b border-[var(--color-border-default)]">
          <div className="text-[10.5px] uppercase tracking-[0.04em] text-[var(--color-warning-700)] font-semibold mb-1">
            You entered
          </div>
          <MarkedSku
            value={conflict.incomingSku}
            marks={aMarks}
            tone="incoming"
            testId="similarity-incoming-sku"
          />
        </div>
        <div className="px-3 py-2 bg-[var(--color-navy-50)]/40">
          <div className="text-[10.5px] uppercase tracking-[0.04em] text-[var(--color-navy-800)] font-semibold mb-1">
            Existing variant
          </div>
          <MarkedSku
            value={conflict.match.supplierSkuCode}
            marks={bMarks}
            tone="match"
            testId="similarity-match-sku"
          />
        </div>
      </div>
      <div className="text-[11px] text-[var(--color-ink-500)]">
        Highlighted characters are where the two SKUs differ.
      </div>
    </Modal>
  );
}
