"use client";

/**
 * Offline mirror-read for the audit log. NOT a recompute (no aggregation,
 * no scaled-bigint arithmetic): the audit log is rendered raw, the only
 * client work is applying the filter set and slicing pagination. The
 * backend's filter shape is replicated faithfully so the offline result
 * matches the online result for the same filters over the same data.
 *
 * Backend reference: enviable-system/src/reports/audit-log-report.service.ts
 *
 * The mirror's auditLogEntry bucket stores raw rows. Actor resolution
 * (id -> fullName) is reconstructed from the mirror's user bucket via
 * actorUserId; if the actor user is missing from the mirror (e.g., a
 * user pruned by the 90-day window), actor falls back to null so the
 * row still renders honestly rather than crashing.
 *
 * Filters (all narrow the row set, AND-combined):
 *   actorUserId  exact match on actor.id
 *   action       exact match on action string
 *   entityType   exact match on entityType string
 *   entityId     exact match on entityId string
 *   occurredFrom inclusive lower bound on occurredAt ISO
 *   occurredTo   inclusive upper bound on occurredAt ISO
 *
 * Sort: occurredAt desc. Pagination: { data, page, pageSize, total }.
 */
import type { AuditLogEntry, AuditLogResponse } from "@/lib/api";
import { listByType } from "@/lib/sync/mirror/store";

type MirroredAuditLogEntry = {
  id: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  occurredAt: string;
  context: unknown;
  beforeState: unknown;
  afterState: unknown;
};
type MirroredUser = { id: string; fullName: string };

export type RecomputeAuditLogOptions = {
  page?: number;
  pageSize?: number;
  actorUserId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  occurredFrom?: string;
  occurredTo?: string;
};

export type AuditLogMirrorResult = AuditLogResponse & {
  /** Earliest occurredAt in the entire mirror bucket (regardless of
   * the active filter). Used to render the horizon disclosure. */
  earliestOccurredAt: string | null;
};

export async function listAuditLogFromMirror(
  opts: RecomputeAuditLogOptions = {},
): Promise<AuditLogMirrorResult> {
  const page = opts.page ?? 1;
  const pageSize = opts.pageSize ?? 50;

  const [entries, users] = await Promise.all([
    listByType<MirroredAuditLogEntry>("auditLogEntry"),
    listByType<MirroredUser>("user"),
  ]);

  const userById = new Map(users.map((u) => [u.body.id, u.body]));

  const allOccurredAts = entries.map((e) => e.body.occurredAt).sort();
  const earliestOccurredAt = allOccurredAts.length > 0 ? allOccurredAts[0] : null;

  let filtered = entries.map((e) => e.body);
  if (opts.actorUserId) {
    filtered = filtered.filter((e) => e.actorUserId === opts.actorUserId);
  }
  if (opts.action) {
    filtered = filtered.filter((e) => e.action === opts.action);
  }
  if (opts.entityType) {
    filtered = filtered.filter((e) => e.entityType === opts.entityType);
  }
  if (opts.entityId) {
    filtered = filtered.filter((e) => e.entityId === opts.entityId);
  }
  if (opts.occurredFrom) {
    filtered = filtered.filter((e) => e.occurredAt >= opts.occurredFrom!);
  }
  if (opts.occurredTo) {
    filtered = filtered.filter((e) => e.occurredAt <= opts.occurredTo!);
  }

  filtered.sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0));

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const pageRows = filtered.slice(start, start + pageSize);

  const data: AuditLogEntry[] = pageRows.map((r) => {
    const u = r.actorUserId ? userById.get(r.actorUserId) : undefined;
    return {
      id: r.id,
      actor: u ? { id: u.id, fullName: u.fullName } : null,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      occurredAt: r.occurredAt,
      context: r.context,
      beforeState: r.beforeState,
      afterState: r.afterState,
    };
  });

  return { data, page, pageSize, total, earliestOccurredAt };
}
