import type { OrderBookSummary } from "@polymarket/clob-client";
import { getOrderBook } from "../clob/client.js";

function parsePrice(p: string): number {
  const n = Number(p);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Best bid = highest buy price (bids[0]).
 * Best ask = lowest sell price (asks[0]).
 */
export function getBestBidAsk(book: OrderBookSummary): { bestBid: number; bestAsk: number } {
  const bestBid =
    book.bids && book.bids.length > 0
      ? parsePrice(book.bids[0].price)
      : 0;
  const bestAsk =
    book.asks && book.asks.length > 0
      ? parsePrice(book.asks[0].price)
      : 0;
  return { bestBid, bestAsk };
}

/**
 * Check if placing an order at limitPrice would exceed maxSlippageBps vs. the best available price.
 * BUY: we pay at most limitPrice; acceptable if bestAsk <= limitPrice and slippage vs bestAsk is within bps.
 * SELL: we receive at least limitPrice; acceptable if bestBid >= limitPrice and slippage vs bestBid is within bps.
 * Returns true if the order is acceptable (within slippage or no book to compare).
 */
export function isWithinSlippage(
  side: "BUY" | "SELL",
  limitPrice: number,
  bestBid: number,
  bestAsk: number,
  maxSlippageBps: number
): boolean {
  if (limitPrice <= 0) return false;
  const bps = maxSlippageBps / 10000;

  if (side === "BUY") {
    if (bestAsk <= 0) return true;
    if (limitPrice < bestAsk) return false;
    const slippage = (limitPrice - bestAsk) / bestAsk;
    return slippage <= bps;
  } else {
    if (bestBid <= 0) return true;
    if (limitPrice > bestBid) return false;
    const slippage = (bestBid - limitPrice) / bestBid;
    return slippage <= bps;
  }
}

export interface SlippageCheckResult {
  ok: boolean;
  reason?: string;
  bestBid: number;
  bestAsk: number;
}

/**
 * For a given token and order params, fetch book and check slippage.
 * If maxSpreadBps is set, also rejects when (bestAsk - bestBid) / mid > maxSpreadBps/10000.
 */
export async function checkSlippage(
  tokenId: string,
  side: "BUY" | "SELL",
  limitPrice: number,
  maxSlippageBps: number,
  maxSpreadBps?: number | null
): Promise<SlippageCheckResult> {
  const book = await getOrderBook(tokenId);
  const { bestBid, bestAsk } = getBestBidAsk(book);

  if (maxSpreadBps != null && maxSpreadBps > 0 && bestBid > 0 && bestAsk > 0) {
    const mid = (bestBid + bestAsk) / 2;
    const spreadBps = (mid > 0 ? (bestAsk - bestBid) / mid : 0) * 10000;
    if (spreadBps > maxSpreadBps) {
      return {
        ok: false,
        reason: `Spread ${spreadBps.toFixed(0)} bps exceeds max ${maxSpreadBps} bps`,
        bestBid,
        bestAsk,
      };
    }
  }

  const ok = isWithinSlippage(side, limitPrice, bestBid, bestAsk, maxSlippageBps);
  if (ok) return { ok: true, bestBid, bestAsk };

  if (side === "BUY") {
    if (bestAsk <= 0) return { ok: true, bestBid, bestAsk };
    return {
      ok: false,
      reason: `BUY limit ${limitPrice} exceeds slippage vs bestAsk ${bestAsk} (max ${maxSlippageBps} bps)`,
      bestBid,
      bestAsk,
    };
  } else {
    if (bestBid <= 0) return { ok: true, bestBid, bestAsk };
    return {
      ok: false,
      reason: `SELL limit ${limitPrice} below acceptable vs bestBid ${bestBid} (max ${maxSlippageBps} bps)`,
      bestBid,
      bestAsk,
    };
  }
}

/**
 * Get tick size and negRisk from order book for createAndPostOrder options.
 */
export async function getOrderBookOptions(
  tokenId: string
): Promise<{ tickSize: "0.1" | "0.01" | "0.001" | "0.0001"; negRisk: boolean }> {
  const book = await getOrderBook(tokenId);
  const tickSize = (book.tick_size ?? "0.01") as "0.1" | "0.01" | "0.001" | "0.0001";
  const negRisk = Boolean(book.neg_risk);
  return { tickSize, negRisk };
}
