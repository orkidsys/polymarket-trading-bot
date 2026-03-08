import "dotenv/config";
import { getCopyConfigOverrides } from "../supabase/client.js";
import type { CopyConfig, TieredMultiplier } from "../types/index.js";

const DEFAULT_MULTIPLIER = 1.0;
const DEFAULT_FETCH_INTERVAL_SEC = 1;
const DEFAULT_MAX_SLIPPAGE_BPS = 50;

let cachedConfig: CopyConfig | null = null;

function parseTieredMultipliers(): TieredMultiplier[] {
  const raw = process.env.TIERED_MULTIPLIERS;
  if (!raw?.trim()) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (x): x is TieredMultiplier =>
        typeof x === "object" &&
        x !== null &&
        typeof (x as TieredMultiplier).min_usd === "number" &&
        typeof (x as TieredMultiplier).max_usd === "number" &&
        typeof (x as TieredMultiplier).mult === "number"
    );
  } catch {
    return [];
  }
}

/** Load config from env only (no Supabase). Use when Supabase is not yet available (e.g. health check). */
export function loadConfigFromEnv(): CopyConfig {
  const tradeMultiplier = Math.max(
    0,
    Number(process.env.TRADE_MULTIPLIER) || DEFAULT_MULTIPLIER
  );
  const fetchIntervalSec = Math.max(
    1,
    Math.min(60, Number(process.env.FETCH_INTERVAL) || DEFAULT_FETCH_INTERVAL_SEC)
  );
  const maxSlippageBps = Math.max(
    0,
    Math.min(1000, Number(process.env.MAX_SLIPPAGE_BPS) || DEFAULT_MAX_SLIPPAGE_BPS)
  );
  const maxPositionUsdRaw = process.env.MAX_POSITION_USD;
  const maxPositionUsd =
    maxPositionUsdRaw != null && maxPositionUsdRaw !== ""
      ? Number(maxPositionUsdRaw)
      : null;
  const maxSpreadBpsRaw = process.env.MAX_SPREAD_BPS;
  const maxSpreadBps =
    maxSpreadBpsRaw != null && maxSpreadBpsRaw !== ""
      ? Math.max(0, Math.min(1000, Number(maxSpreadBpsRaw)))
      : null;

  return {
    tradeMultiplier,
    fetchIntervalSec,
    maxPositionUsd: maxPositionUsd != null && Number.isFinite(maxPositionUsd) ? maxPositionUsd : null,
    tieredMultipliers: parseTieredMultipliers(),
    maxSlippageBps,
    maxSpreadBps,
  };
}

/** Load full config: env + Supabase copy_config overrides (if available). */
export async function loadConfig(): Promise<CopyConfig> {
  if (cachedConfig) return cachedConfig;

  const base = loadConfigFromEnv();

  try {
    const overrides = await getCopyConfigOverrides();
    if (!overrides) {
      cachedConfig = base;
      return base;
    }

    cachedConfig = {
      tradeMultiplier:
        overrides.trade_multiplier != null
          ? Number(overrides.trade_multiplier)
          : base.tradeMultiplier,
      fetchIntervalSec:
        overrides.fetch_interval_sec != null
          ? Math.max(1, Math.min(60, overrides.fetch_interval_sec))
          : base.fetchIntervalSec,
      maxPositionUsd:
        overrides.max_position_usd != null
          ? Number(overrides.max_position_usd)
          : base.maxPositionUsd,
      tieredMultipliers: Array.isArray(overrides.tiered_multipliers)
        ? (overrides.tiered_multipliers as TieredMultiplier[])
        : base.tieredMultipliers,
      maxSlippageBps:
        overrides.max_slippage_bps != null
          ? Math.max(0, Math.min(1000, overrides.max_slippage_bps))
          : base.maxSlippageBps,
      maxSpreadBps: base.maxSpreadBps,
    };
    return cachedConfig;
  } catch (e) {
    console.warn("Could not load copy_config from Supabase, using env only:", e);
    cachedConfig = base;
    return base;
  }
}

export function getEnvOrThrow(key: string): string {
  const v = process.env[key];
  if (v == null || v.trim() === "") {
    throw new Error(`Missing or empty env: ${key}`);
  }
  return v.trim();
}

export function getEnvOptional(key: string): string | undefined {
  const v = process.env[key];
  return v != null && v.trim() !== "" ? v.trim() : undefined;
}

/** CLOB HTTP URL (no trailing slash for consistency). */
export function getClobHttpUrl(): string {
  const u = getEnvOptional("CLOB_HTTP_URL") ?? "https://clob.polymarket.com/";
  return u.replace(/\/+$/, "");
}

/** Data API base URL. */
export function getDataApiUrl(): string {
  return getEnvOptional("DATA_API_URL") ?? "https://data-api.polymarket.com";
}

/** RPC URL for Polygon. */
export function getRpcUrl(): string {
  return getEnvOrThrow("RPC_URL");
}

/** Our wallet address (executes trades). */
export function getProxyWallet(): string {
  return getEnvOrThrow("PROXY_WALLET");
}

/** Private key without 0x prefix. */
export function getPrivateKey(): string {
  const key = getEnvOrThrow("PRIVATE_KEY");
  return key.startsWith("0x") ? key.slice(2) : key;
}
