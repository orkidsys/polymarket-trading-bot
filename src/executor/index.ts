import type { CopyConfig } from "../types/index.js";
import { loadConfig } from "../config/index.js";
import { initClobClient, createAndPostOrder } from "../clob/client.js";
import { checkSlippage, getOrderBookOptions } from "../slippage/index.js";
import { withRetry } from "../lib/retry.js";
import {
  insertCopyTrade,
  getOurPosition,
  insertOurPosition,
  updateOurPosition,
} from "../supabase/client.js";

export interface OrderIntent {
  traderAddress: string;
  marketSlug: string;
  tokenId: string;
  outcome: string;
  side: "BUY" | "SELL";
  sizeShares: number;
  limitPrice: number;
}

export interface ExecuteResult {
  success: boolean;
  orderId?: string;
  copyTradeId?: string;
  ourPositionId?: string;
  error?: string;
  skippedSlippage?: boolean;
}

/**
 * Execute a single order intent: slippage check → createAndPostOrder → persist to Supabase.
 * Call initClobClient() before using.
 */
export async function executeOrder(intent: OrderIntent): Promise<ExecuteResult> {
  const config = await loadConfig();

  if (intent.sizeShares <= 0) {
    return { success: false, error: "sizeShares must be positive" };
  }

  const slippageResult = await checkSlippage(
    intent.tokenId,
    intent.side,
    intent.limitPrice,
    config.maxSlippageBps,
    config.maxSpreadBps
  );
  if (!slippageResult.ok) {
    console.warn("[Executor] Slippage check failed:", slippageResult.reason);
    return {
      success: false,
      error: slippageResult.reason,
      skippedSlippage: true,
    };
  }

  const { tickSize, negRisk } = await getOrderBookOptions(intent.tokenId);

  let orderResponse: { orderID?: string; status?: string; error?: string };
  try {
    orderResponse = await withRetry(
      () =>
        createAndPostOrder({
          tokenID: intent.tokenId,
          price: intent.limitPrice,
          side: intent.side,
          size: intent.sizeShares,
          tickSize,
          negRisk,
        }),
      { maxRetries: 2, baseMs: 1000 }
    );
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error("[Executor] createAndPostOrder failed:", errMsg);
    return { success: false, error: errMsg };
  }

  if (orderResponse.error) {
    return {
      success: false,
      error: orderResponse.error,
      orderId: orderResponse.orderID,
    };
  }

  const orderId = orderResponse.orderID ?? undefined;
  const status = (orderResponse.status ?? "filled").toLowerCase();
  const isFilled = status === "filled" || status === "live"; // treat live as placed for recording

  let ourPositionId: string | undefined;
  const existing = await getOurPosition(
    intent.traderAddress,
    intent.marketSlug,
    intent.outcome
  );
  const costUsd = intent.sizeShares * intent.limitPrice;

  if (intent.side === "BUY") {
    if (existing) {
      const newSize = existing.size + intent.sizeShares;
      const newCost =
        (existing.cost_basis_usd ?? existing.size * (existing.avg_price ?? 0)) + costUsd;
      const newAvg = newSize > 0 ? newCost / newSize : 0;
      await updateOurPosition(existing.id, {
        size: newSize,
        avg_price: newAvg,
        cost_basis_usd: newCost,
      });
      ourPositionId = existing.id;
    } else {
      ourPositionId = await insertOurPosition({
        trader_address: intent.traderAddress,
        market_slug: intent.marketSlug,
        token_id: intent.tokenId,
        outcome: intent.outcome,
        size: intent.sizeShares,
        avg_price: intent.limitPrice,
        cost_basis_usd: costUsd,
      });
    }
  } else {
    if (existing) {
      const newSize = Math.max(0, existing.size - intent.sizeShares);
      if (newSize <= 0) {
        await updateOurPosition(existing.id, { size: 0, closed_at: new Date().toISOString() });
      } else {
        await updateOurPosition(existing.id, { size: newSize });
      }
      ourPositionId = existing.id;
    }
  }

  const copyTradeId = await insertCopyTrade({
    trader_address: intent.traderAddress,
    market_slug: intent.marketSlug,
    token_id: intent.tokenId,
    side: intent.side,
    size: intent.sizeShares,
    price: intent.limitPrice,
    order_id: orderId,
    status: isFilled ? "filled" : "pending",
    our_position_id: ourPositionId,
  });

  return {
    success: true,
    orderId,
    copyTradeId,
    ourPositionId,
  };
}

/**
 * Run executor after initializing CLOB client. Use for a one-off test order.
 */
export async function runExecutorWithClob(intent: OrderIntent): Promise<ExecuteResult> {
  await initClobClient();
  return executeOrder(intent);
}
