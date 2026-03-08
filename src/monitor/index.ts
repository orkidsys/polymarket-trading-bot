import { loadConfig } from "../config/index.js";
import { getCopiedTraders } from "../supabase/client.js";
import { initClobClient } from "../clob/client.js";
import { computePositionDiff } from "../position-diff/index.js";
import { computeSizing } from "../sizing/index.js";
import { aggregateIntents } from "../aggregator/index.js";
import { executeOrder } from "../executor/index.js";
import type { OrderIntent } from "../executor/index.js";

let stopRequested = false;

export function requestStop(): void {
  stopRequested = true;
}

export function isStopRequested(): boolean {
  return stopRequested;
}

/**
 * Process one trader: diff → sizing → aggregate → execute.
 * Returns number of orders executed successfully.
 */
async function processTrader(traderAddress: string): Promise<number> {
  const config = await loadConfig();
  const rawIntents = await computePositionDiff(traderAddress);
  if (rawIntents.length === 0) return 0;

  const orderIntents: OrderIntent[] = [];
  for (const raw of rawIntents) {
    if (raw.sizeShares <= 0 || !raw.tokenId) continue;
    const tradeSizeUsd = raw.sizeShares * raw.limitPrice;
    try {
      const sizing = await computeSizing(
        {
          traderAddress: raw.traderAddress,
          traderTradeSizeUsd: tradeSizeUsd,
          traderTradeSizeShares: raw.sizeShares,
          price: raw.limitPrice,
        },
        config
      );
      if (sizing.sizeShares <= 0) continue;
      orderIntents.push({
        traderAddress: raw.traderAddress,
        marketSlug: raw.marketSlug,
        tokenId: raw.tokenId,
        outcome: raw.outcome,
        side: raw.side,
        sizeShares: sizing.sizeShares,
        limitPrice: raw.limitPrice,
      });
    } catch (e) {
      console.warn("[Monitor] Sizing failed for intent:", raw.marketSlug, raw.outcome, e);
    }
  }

  const aggregated = aggregateIntents(orderIntents);
  let executed = 0;
  for (const intent of aggregated) {
    if (stopRequested) break;
    try {
      const result = await executeOrder(intent);
      if (result.success) {
        executed++;
        console.log(
          "[Monitor] Executed",
          intent.side,
          intent.sizeShares,
          intent.marketSlug,
          "orderId:",
          result.orderId
        );
      } else {
        console.warn("[Monitor] Order failed:", result.error);
      }
    } catch (e) {
      console.error("[Monitor] executeOrder error:", e);
    }
  }
  return executed;
}

/**
 * Run the monitor loop: poll all traders every fetchIntervalSec, diff → size → aggregate → execute.
 * Call initClobClient() before starting. Stops when requestStop() is called or on uncaught error.
 */
export async function runMonitorLoop(): Promise<void> {
  await initClobClient();
  const config = await loadConfig();
  const intervalMs = config.fetchIntervalSec * 1000;

  console.log(
    "[Monitor] Starting loop:",
    config.fetchIntervalSec,
    "s interval, traders from config/DB"
  );

  while (!stopRequested) {
    const traders = await getCopiedTraders();
    if (traders.length === 0) {
      await sleep(intervalMs);
      continue;
    }

    for (const { address } of traders) {
      if (stopRequested) break;
      try {
        await processTrader(address);
      } catch (e) {
        console.error("[Monitor] Trader", address, "error:", e);
      }
    }

    await sleep(intervalMs);
  }

  console.log("[Monitor] Loop stopped.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
