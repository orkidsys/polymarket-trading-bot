import type { CopyConfig, TieredMultiplier } from "../types/index.js";
import { getOurBalanceUsd } from "../clob/client.js";
import { fetchPositions } from "../data-api/positions.js";

/**
 * Estimate trader's portfolio size in USD from their open positions (position size * avgPrice).
 * Does not include cash; use as a proxy for "capital at risk" in markets.
 */
export async function estimateTraderBalanceUsd(traderAddress: string): Promise<number> {
  const positions = await fetchPositions(traderAddress, { limit: 500 });
  let total = 0;
  for (const p of positions) {
    total += p.size * p.avgPrice;
  }
  return total;
}

/**
 * Get tiered multiplier for a given trade size (USD).
 * Uses first matching tier [min_usd, max_usd); if none match, returns config.tradeMultiplier.
 */
export function getTieredMultiplier(
  tradeSizeUsd: number,
  tieredMultipliers: TieredMultiplier[],
  defaultMultiplier: number
): number {
  for (const t of tieredMultipliers) {
    if (tradeSizeUsd >= t.min_usd && tradeSizeUsd < t.max_usd) return t.mult;
  }
  return defaultMultiplier;
}

export interface SizingInput {
  traderAddress: string;
  traderTradeSizeUsd: number;
  traderTradeSizeShares: number;
  price: number;
}

export interface SizingResult {
  sizeShares: number;
  sizeUsd: number;
  multiplierApplied: number;
}

/**
 * Compute our order size from trader's trade: proportional by balance and multipliers.
 * our_size_shares = (our_balance / trader_balance) * trader_size_shares * mult.
 * If trader_balance is 0, falls back to using config.tradeMultiplier only (no proportion).
 */
export async function computeSizing(
  input: SizingInput,
  config: CopyConfig
): Promise<SizingResult> {
  const ourBalance = await getOurBalanceUsd();
  const traderBalance = await estimateTraderBalanceUsd(input.traderAddress);

  const tierMult = getTieredMultiplier(
    input.traderTradeSizeUsd,
    config.tieredMultipliers,
    config.tradeMultiplier
  );
  const baseMult = config.tradeMultiplier;
  const mult = tierMult;

  let sizeShares: number;
  if (traderBalance <= 0) {
    sizeShares = input.traderTradeSizeShares * mult;
  } else {
    const ratio = ourBalance / traderBalance;
    sizeShares = input.traderTradeSizeShares * ratio * mult;
  }

  if (config.maxPositionUsd != null && config.maxPositionUsd > 0) {
    const sizeUsdCap = config.maxPositionUsd;
    const sizeUsdWouldBe = sizeShares * input.price;
    if (sizeUsdWouldBe > sizeUsdCap) {
      sizeShares = sizeUsdCap / input.price;
    }
  }

  sizeShares = Math.max(0, sizeShares);
  const sizeUsd = sizeShares * input.price;
  return { sizeShares, sizeUsd, multiplierApplied: mult };
}
