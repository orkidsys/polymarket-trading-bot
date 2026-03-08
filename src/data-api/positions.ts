import { getDataApiUrl } from "../config/index.js";
import type { Position } from "../types/index.js";

const DEFAULT_LIMIT = 100;

/** Response shape from Polymarket Data API GET /positions */
interface DataApiPositionRow {
  market?: string;
  conditionId?: string;
  outcome?: string;
  size?: string | number;
  avgPrice?: string | number;
  tokenId?: string;
  question?: string;
  [key: string]: unknown;
}

function toNumber(v: string | number | undefined): number {
  if (v === undefined || v === null) return 0;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Fetch current positions for a user from Polymarket Data API.
 * GET /positions?user={address}
 */
export async function fetchPositions(
  userAddress: string,
  options?: { limit?: number; sortBy?: string }
): Promise<Position[]> {
  const baseUrl = getDataApiUrl().replace(/\/+$/, "");
  const limit = options?.limit ?? DEFAULT_LIMIT;
  const sortBy = options?.sortBy ?? "CASHPNL";

  const url = new URL(`${baseUrl}/positions`);
  url.searchParams.set("user", userAddress);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("sortBy", sortBy);

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Data API positions ${res.status}: ${text}`);
  }

  const data = (await res.json()) as DataApiPositionRow[] | unknown;
  if (!Array.isArray(data)) return [];

  const positions: Position[] = [];
  for (const row of data) {
    const tokenId = typeof row.tokenId === "string" ? row.tokenId : undefined;
    const outcome = typeof row.outcome === "string" ? row.outcome : "Unknown";
    const marketSlug =
      typeof row.market === "string"
        ? row.market
        : typeof row.slug === "string"
          ? row.slug
          : "";
    if (!marketSlug && !tokenId) continue;

    positions.push({
      marketSlug,
      conditionId: typeof row.conditionId === "string" ? row.conditionId : undefined,
      outcome,
      size: toNumber(row.size),
      avgPrice: toNumber(row.avgPrice ?? row.averagePrice),
      tokenId: tokenId ?? "",
      marketQuestion: typeof row.question === "string" ? row.question : undefined,
      raw: row as Record<string, unknown>,
    });
  }

  return positions;
}
