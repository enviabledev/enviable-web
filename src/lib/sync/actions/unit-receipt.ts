"use client";

/**
 * Typed helper for the receipt offline path. Mirrors the existing direct-POST
 * receiveUnits body, just routed through the sync engine instead of a direct
 * POST. The backend's unit.receipt sync action accepts the same payload
 * (shipmentId + lines), runs the same all-or-nothing validation, generates
 * Unit IDs server-side at process time. No ID pre-allocation: engine and
 * chassis come from the supplier in the payload.
 */
import { connectivity } from "../connectivity";
import { syncEngine } from "../engine";
import { enqueue } from "../queue";
import type { QueuedAction } from "../types";

export type ReceiveLinePayload = {
  manifestLineId: string;
  units: { engineNumber: string; chassisNumber: string }[];
};

export type UnitReceiptPayload = {
  shipmentId: string;
  lines: ReceiveLinePayload[];
};

export async function queueUnitReceipt(params: {
  payload: UnitReceiptPayload;
  description: string;
}): Promise<QueuedAction> {
  const action = await enqueue({
    type: "unit.receipt",
    payload: params.payload as unknown as Record<string, unknown>,
    description: params.description,
  });
  syncEngine.notifyChange();
  if (connectivity.getState() === "online") {
    void syncEngine.drain();
  }
  return action;
}
