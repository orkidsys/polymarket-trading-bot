import type { Position } from "../types/index.js";
import { fetchPositions } from "../data-api/positions.js";
import {
  getTraderPositionSnapshots,
  upsertTraderPositionSnapshots,
  getOurPosition,
} from "../supabase/client.js";

/**
 * Raw trade intent from position diff: trader's delta in one market/outcome.
 * Size is the trader's size change (positive = BUY, negative = SELL).
 */
export interface TradeIntent {
  traderAddress: string;
  marketSlug: string;
  tokenId: string;
  outcome: string;
  side: "BUY" | "SELL";
  sizeShares: number;
  limitPrice: number;
}

function snapshotKey(marketSlug: string, outcome: string): string {
  return `${marketSlug}\t${outcome}`;
}

/**
 * Diff current positions vs last snapshot for one trader.
 * Produces BUY intents for new/increased positions, SELL for decreased/closed.
 * Persists new snapshot to Supabase after computing diff.
 * On first run (no previous snapshot), only saves current state and returns no intents.
 */
export async function computePositionDiff(
  traderAddress: string
): Promise<TradeIntent[]> {
  const [current, previousRows] = await Promise.all([
    fetchPositions(traderAddress, { limit: 500 }),
    getTraderPositionSnapshots(traderAddress),
  ]);

  const prevByKey = new Map<string, { size: number; avgPrice: number; tokenId: string }>();
  for (const row of previousRows) {
    const raw = row.raw_snapshot ?? {};
    const tokenId =
      typeof raw.tokenId === "string"
        ? raw.tokenId
        : (row as unknown as { token_id?: string }).token_id ?? "";
    prevByKey.set(snapshotKey(row.market_slug, row.outcome), {
      size: Number(row.size),
      avgPrice: Number(row.avg_price ?? 0),
      tokenId,
    });
  }

  const isFirstRun = previousRows.length === 0;
  const currentByKey = new Map<string, Position>();
  for (const p of current) {
    currentByKey.set(snapshotKey(p.marketSlug, p.outcome), p);
  }

  if (isFirstRun) {
    const newSnapshots = current.map((p) => ({
      market_slug: p.marketSlug,
      outcome: p.outcome,
      size: p.size,
      avg_price: p.avgPrice,
      raw_snapshot: { tokenId: p.tokenId, avgPrice: p.avgPrice, size: p.size } as Record<string, unknown>,
    }));
    await upsertTraderPositionSnapshots(traderAddress, newSnapshots);
    return [];
  }

  const intents: TradeIntent[] = [];

  for (const [key, curr] of currentByKey) {
    const prev = prevByKey.get(key);
    const prevSize = prev?.size ?? 0;
    const currSize = curr.size;
    const delta = currSize - prevSize;

    if (delta > 0) {
      intents.push({
        traderAddress,
        marketSlug: curr.marketSlug,
        tokenId: curr.tokenId || prev?.tokenId || "",
        outcome: curr.outcome,
        side: "BUY",
        sizeShares: delta,
        limitPrice: curr.avgPrice,
      });
    } else if (delta < 0) {
      intents.push({
        traderAddress,
        marketSlug: curr.marketSlug,
        tokenId: curr.tokenId || prev?.tokenId || "",
        outcome: curr.outcome,
        side: "SELL",
        sizeShares: -delta,
        limitPrice: curr.avgPrice,
      });
    }
  }

  for (const [key, prev] of prevByKey) {
    if (currentByKey.has(key)) continue;
    const [marketSlug, outcome] = key.split("\t");
    let tokenId = prev.tokenId;
    if (!tokenId) {
      const ourPos = await getOurPosition(traderAddress, marketSlug, outcome);
      if (!ourPos) continue;
      tokenId = ourPos.token_id;
    }
    intents.push({
      traderAddress,
      marketSlug,
      tokenId,
      outcome,
      side: "SELL",
      sizeShares: prev.size,
      limitPrice: prev.avgPrice,
    });
  }

  const newSnapshots = current.map((p) => ({
    market_slug: p.marketSlug,
    outcome: p.outcome,
    size: p.size,
    avg_price: p.avgPrice,
    raw_snapshot: { tokenId: p.tokenId, avgPrice: p.avgPrice, size: p.size } as Record<string, unknown>,
  }));
  await upsertTraderPositionSnapshots(traderAddress, newSnapshots);

  return intents;
}
