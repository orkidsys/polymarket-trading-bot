/**
 * Polymarket Copy Trading Bot
 * Entry point: runs health check by default; monitor loop will be added in Phase 3.
 */
import "dotenv/config";
import { loadConfig } from "./config/index.js";
import { getCopiedTraders } from "./supabase/client.js";
import { fetchPositions } from "./data-api/positions.js";

async function main(): Promise<void> {
  console.log("Polymarket Copy Trading Bot\n");

  const config = await loadConfig();
  console.log("Config loaded:", {
    tradeMultiplier: config.tradeMultiplier,
    fetchIntervalSec: config.fetchIntervalSec,
    maxSlippageBps: config.maxSlippageBps,
  });

  const traders = await getCopiedTraders();
  console.log("Traders to copy:", traders.length);
  if (traders.length === 0) {
    console.log("Add USER_ADDRESSES in .env or insert rows into copied_traders table.");
    return;
  }

  // Phase 1 demo: fetch positions for first trader
  const first = traders[0];
  console.log("\nFetching positions for", first.address, first.label ? `(${first.label})` : "");
  const positions = await fetchPositions(first.address, { limit: 10 });
  console.log("Positions count:", positions.length);
  if (positions.length > 0) {
    const p = positions[0];
    console.log("Sample position:", p.marketSlug, p.outcome, "size:", p.size, "avgPrice:", p.avgPrice);
  }

  console.log("\nBot ready. Monitor loop and order execution will be added in Phase 2–3.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
