/**
 * Pick a sensible default customer tier to land on when routing into the
 * per-variant price editor for a variant that has no price yet (prompt 34).
 *
 * Preference order: a tier whose name reads as the "standard" one (the seed's
 * primary tier, ResellerStandard), else the first tier by name. Returns null
 * when no tiers are available, in which case the caller should not offer the
 * pricing entry point (the editor requires a ?tier=).
 *
 * The editor lets the user switch tier after arrival, so this is only the
 * landing default, not a constraint.
 */
export function pickDefaultTier<T extends { id: string; name: string }>(
  tiers: readonly T[],
): T | null {
  if (tiers.length === 0) return null;
  const sorted = [...tiers].sort((a, b) => a.name.localeCompare(b.name));
  const standard = sorted.find((t) => /standard/i.test(t.name));
  return standard ?? sorted[0];
}
