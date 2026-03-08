import type { OrderIntent } from "../executor/index.js";

const DEFAULT_MIN_SIZE = 0.0001;

/**
 * Group order intents by (traderAddress, marketSlug, tokenId, side) and sum sizes.
 * Drops intents below minSizeShares to avoid dust orders.
 */
export function aggregateIntents(
  intents: OrderIntent[],
  options?: { minSizeShares?: number }
): OrderIntent[] {
  const minSize = options?.minSizeShares ?? DEFAULT_MIN_SIZE;
  const key = (i: OrderIntent) =>
    `${i.traderAddress}\t${i.marketSlug}\t${i.tokenId}\t${i.side}`;
  const combined = new Map<
    string,
    { intent: OrderIntent; totalSize: number; count: number }
  >();

  for (const intent of intents) {
    if (intent.sizeShares <= 0) continue;
    const k = key(intent);
    const existing = combined.get(k);
    if (!existing) {
      combined.set(k, {
        intent: { ...intent },
        totalSize: intent.sizeShares,
        count: 1,
      });
    } else {
      existing.totalSize += intent.sizeShares;
      existing.count += 1;
    }
  }

  const out: OrderIntent[] = [];
  for (const { intent, totalSize } of combined.values()) {
    if (totalSize < minSize) continue;
    out.push({ ...intent, sizeShares: totalSize });
  }
  return out;
}
