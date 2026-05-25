"use client";

/**
 * Per-flow conflict resolution registry. Each flow that surfaces conflicts
 * registers a plugin that knows how to:
 *
 *   - DetailRenderer  : render the structured conflict body (the exhaustive
 *                       per-cell named violations for receipt, future shapes
 *                       for assembly and SO) in the /sync/conflicts detail view.
 *   - ReOpener        : navigate the clerk into the flow's form so they can
 *                       fix the offending inputs against current state and
 *                       re-submit with the SAME clientId.
 *
 * Receipt is the first plugin (this prompt). Assembly and SO add their own
 * later without modifying the page or the registry.
 *
 * Plugins register themselves on module import via `registerConflictPlugin`.
 * The /sync/conflicts pages look up plugins by the QueuedAction's `type`. A
 * missing plugin renders a minimal generic fallback (just the raw conflict
 * body + the action description) rather than crashing.
 */
import type { ComponentType } from "react";
import type { QueuedAction, SyncActionType } from "./types";

export type ConflictDetailRenderer = ComponentType<{ action: QueuedAction }>;

/**
 * ReOpener is a function so it can do work before navigating (e.g. read the
 * payload to extract the target id). It receives a small navigator interface
 * to keep it decoupled from next/navigation specifics; the page passes in
 * `router.push`.
 */
export type ConflictReOpener = (
  action: QueuedAction,
  navigate: (href: string) => void,
) => void;

export type ConflictPlugin = {
  actionType: SyncActionType;
  DetailRenderer: ConflictDetailRenderer;
  ReOpener: ConflictReOpener;
  /**
   * Short human label for the row in the conflicts list ("Receive units",
   * "Start assembly job", "Create sales order"). Falls back to the action's
   * type string when absent.
   */
  rowLabel?: string;
};

const REGISTRY = new Map<SyncActionType, ConflictPlugin>();

export function registerConflictPlugin(plugin: ConflictPlugin) {
  REGISTRY.set(plugin.actionType, plugin);
}

export function getConflictPlugin(
  actionType: string,
): ConflictPlugin | undefined {
  return REGISTRY.get(actionType as SyncActionType);
}

/**
 * Used by SyncBoot to ensure all plugin modules are loaded once at app boot,
 * even on routes that don't directly import them. Each plugin module registers
 * itself on import; calling this just touches them.
 */
export async function loadAllConflictPlugins(): Promise<void> {
  await import("./conflicts/receipt-plugin");
}
