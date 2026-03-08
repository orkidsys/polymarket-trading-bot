import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { CopyConfigRow, CopiedTrader, TraderPositionSnapshotRow } from "../types/index.js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
    }
    client = createClient(supabaseUrl, supabaseServiceKey);
  }
  return client;
}

/** Fetch all active copied traders (from DB). Falls back to USER_ADDRESSES env if table empty. */
export async function getCopiedTraders(): Promise<{ address: string; label?: string }[]> {
  const db = getSupabase();
  const { data, error } = await db
    .from("copied_traders")
    .select("address, label")
    .eq("is_active", true);

  if (error) throw new Error(`Supabase copied_traders: ${error.message}`);

  if (data && data.length > 0) {
    return (data as Pick<CopiedTrader, "address" | "label">[]).map((r) => ({
      address: r.address,
      label: r.label ?? undefined,
    }));
  }

  const envAddresses = process.env.USER_ADDRESSES;
  if (!envAddresses?.trim()) return [];
  return envAddresses.split(",").map((a) => ({ address: a.trim() }));
}

/** Get first copy_config row for overrides (trade_multiplier, fetch_interval, etc.). */
export async function getCopyConfigOverrides(): Promise<CopyConfigRow | null> {
  const db = getSupabase();
  const { data, error } = await db
    .from("copy_config")
    .select("*")
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Supabase copy_config: ${error.message}`);
  return data as CopyConfigRow | null;
}

/** Upsert position snapshots for a trader (replace all for that trader). */
export async function upsertTraderPositionSnapshots(
  traderAddress: string,
  snapshots: { market_slug: string; outcome: string; size: number; avg_price?: number; raw_snapshot?: Record<string, unknown> }[]
): Promise<void> {
  const db = getSupabase();
  await db.from("trader_position_snapshots").delete().eq("trader_address", traderAddress);

  if (snapshots.length === 0) return;

  const rows = snapshots.map((s) => ({
    trader_address: traderAddress,
    market_slug: s.market_slug,
    outcome: s.outcome,
    size: s.size,
    avg_price: s.avg_price ?? null,
    raw_snapshot: s.raw_snapshot ?? null,
    fetched_at: new Date().toISOString(),
  }));

  const { error } = await db.from("trader_position_snapshots").insert(rows);
  if (error) throw new Error(`Supabase insert snapshots: ${error.message}`);
}

/** Get latest snapshots for a trader (for diffing). */
export async function getTraderPositionSnapshots(
  traderAddress: string
): Promise<TraderPositionSnapshotRow[]> {
  const db = getSupabase();
  const { data, error } = await db
    .from("trader_position_snapshots")
    .select("*")
    .eq("trader_address", traderAddress);

  if (error) throw new Error(`Supabase get snapshots: ${error.message}`);
  return (data ?? []) as TraderPositionSnapshotRow[];
}

/** Insert a copy_trade record. */
export async function insertCopyTrade(params: {
  trader_address: string;
  market_slug: string;
  token_id: string;
  side: string;
  size: number;
  price: number;
  order_id?: string;
  clob_tx_hash?: string;
  status?: string;
  our_position_id?: string;
}): Promise<string> {
  const db = getSupabase();
  const { data, error } = await db.from("copy_trades").insert(params).select("id").single();
  if (error) throw new Error(`Supabase insert copy_trade: ${error.message}`);
  return (data as { id: string }).id;
}

/** Record a balance snapshot. */
export async function insertBalanceSnapshot(
  source: string,
  balanceUsd: number
): Promise<void> {
  const db = getSupabase();
  const { error } = await db.from("balance_snapshots").insert({
    source,
    balance_usd: balanceUsd,
  });
  if (error) throw new Error(`Supabase insert balance_snapshot: ${error.message}`);
}

/** Check Supabase connectivity. */
export async function pingSupabase(): Promise<boolean> {
  try {
    const db = getSupabase();
    const { error } = await db.from("copied_traders").select("id").limit(1);
    return !error;
  } catch {
    return false;
  }
}

/** Our position row (open position we mirror). */
export interface OurPositionRow {
  id: string;
  trader_address: string;
  market_slug: string;
  token_id: string;
  outcome: string;
  size: number;
  avg_price: number | null;
  cost_basis_usd: number | null;
  opened_at: string;
  updated_at: string;
  closed_at: string | null;
}

/** Get our open position for a trader + market + outcome (closed_at IS NULL). */
export async function getOurPosition(
  traderAddress: string,
  marketSlug: string,
  outcome: string
): Promise<OurPositionRow | null> {
  const db = getSupabase();
  const { data, error } = await db
    .from("our_positions")
    .select("*")
    .eq("trader_address", traderAddress)
    .eq("market_slug", marketSlug)
    .eq("outcome", outcome)
    .is("closed_at", null)
    .maybeSingle();
  if (error) throw new Error(`Supabase get our_position: ${error.message}`);
  return data as OurPositionRow | null;
}

/** Insert new our_position (when opening). */
export async function insertOurPosition(params: {
  trader_address: string;
  market_slug: string;
  token_id: string;
  outcome: string;
  size: number;
  avg_price?: number;
  cost_basis_usd?: number;
}): Promise<string> {
  const db = getSupabase();
  const { data, error } = await db.from("our_positions").insert(params).select("id").single();
  if (error) throw new Error(`Supabase insert our_position: ${error.message}`);
  return (data as { id: string }).id;
}

/** Update size/avg_price/cost_basis and optionally set closed_at. */
export async function updateOurPosition(
  positionId: string,
  updates: {
    size?: number;
    avg_price?: number;
    cost_basis_usd?: number;
    closed_at?: string | null;
  }
): Promise<void> {
  const db = getSupabase();
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (updates.size !== undefined) row.size = updates.size;
  if (updates.avg_price !== undefined) row.avg_price = updates.avg_price;
  if (updates.cost_basis_usd !== undefined) row.cost_basis_usd = updates.cost_basis_usd;
  if (updates.closed_at !== undefined) row.closed_at = updates.closed_at;
  const { error } = await db.from("our_positions").update(row).eq("id", positionId);
  if (error) throw new Error(`Supabase update our_position: ${error.message}`);
}

/** Get all open our_positions (closed_at IS NULL). */
export async function getOurPositionsOpen(): Promise<OurPositionRow[]> {
  const db = getSupabase();
  const { data, error } = await db
    .from("our_positions")
    .select("*")
    .is("closed_at", null);
  if (error) throw new Error(`Supabase get our_positions open: ${error.message}`);
  return (data ?? []) as OurPositionRow[];
}
