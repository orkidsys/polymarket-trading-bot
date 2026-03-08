/** Trader position from Polymarket Data API */
export interface Position {
  marketSlug: string;
  conditionId?: string;
  outcome: string;
  size: number;
  avgPrice: number;
  tokenId: string;
  marketQuestion?: string;
  raw?: Record<string, unknown>;
}

/** Tiered multiplier rule: apply mult when trade size is in [min_usd, max_usd) */
export interface TieredMultiplier {
  min_usd: number;
  max_usd: number;
  mult: number;
}

/** Resolved copy-trading config (env + optional Supabase overrides) */
export interface CopyConfig {
  tradeMultiplier: number;
  fetchIntervalSec: number;
  maxPositionUsd: number | null;
  tieredMultipliers: TieredMultiplier[];
  maxSlippageBps: number;
}

/** Row from copied_traders */
export interface CopiedTrader {
  id: string;
  address: string;
  label: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Row from copy_config (first row used) */
export interface CopyConfigRow {
  id: string;
  trade_multiplier: number;
  fetch_interval_sec: number;
  max_position_usd: number | null;
  tiered_multipliers: TieredMultiplier[] | null;
  max_slippage_bps: number;
}

/** Snapshot row for position diffing */
export interface TraderPositionSnapshotRow {
  id: string;
  trader_address: string;
  market_slug: string;
  outcome: string;
  size: number;
  avg_price: number | null;
  raw_snapshot: Record<string, unknown> | null;
  fetched_at: string;
}
