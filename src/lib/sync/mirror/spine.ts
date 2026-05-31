/**
 * Shared spine-timestamp picker for mirror storage. The mirror record's
 * `updatedAt` is the abstract "last-modified" key the mirror stores under;
 * different backend entities supply it under different field names:
 *
 *   - Mutable entities (most reference data, the orders, units, jobs) carry
 *     `updatedAt` (Prisma @updatedAt).
 *   - Append-only event streams (StockMovement, SparePartMovement,
 *     AuditLogEntry) have no `updatedAt` per I-9/I-10; the insert moment is
 *     definitive, exposed as `occurredAt`.
 *   - ReleaseAuthorisation is one-per-released-SO and never updated; exposed
 *     as `issuedAt`.
 *
 * Accept all three. If a row STILL has no recognised timestamp, surface a
 * console.warn (loud skip) so the next entity with a fourth convention is
 * visible immediately, not via empty buckets discovered weeks later
 * (the silent-skip-is-a-bug lesson, see feedback-silent-skip-is-a-bug).
 *
 * Used by both the history downloader and the periodic reconciler so the
 * fix lives in one place; banking the spine-timestamp convention in one
 * file and importing it everywhere is itself an application of the
 * conventions-retroactive-sweep discipline (don't apply a convention in
 * one call site and miss the second).
 */
export function pickIdAndTimestamp(
  row: Record<string, unknown>,
  entityType: string,
): { id: string; ts: string } | null {
  const id = row.id;
  const updated = row.updatedAt;
  const occurred = row.occurredAt;
  const issued = row.issuedAt;
  let ts: string | undefined;
  if (typeof updated === "string") ts = updated;
  else if (typeof occurred === "string") ts = occurred;
  else if (typeof issued === "string") ts = issued;
  if (typeof id !== "string" || typeof ts !== "string") {
    console.warn(
      `[mirror] skipping ${entityType} row: missing id or recognised timestamp (updatedAt/occurredAt/issuedAt)`,
      { hasId: typeof id === "string", id, knownKeys: Object.keys(row) },
    );
    return null;
  }
  return { id, ts };
}
