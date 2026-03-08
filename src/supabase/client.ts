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
