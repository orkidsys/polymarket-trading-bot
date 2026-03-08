/**
 * Polymarket Copy Trading Bot
 * Entry point: starts the copy-trading monitor loop (poll → diff → size → aggregate → execute).
 */
import "dotenv/config";
import { loadConfig } from "./config/index.js";
import { getCopiedTraders } from "./supabase/client.js";
import { runMonitorLoop, requestStop, isStopRequested } from "./monitor/index.js";

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

  const handleSignal = (): void => {
    if (isStopRequested()) {
      console.log("\n[Main] Force exit.");
      process.exit(1);
    }
    console.log("\n[Main] Shutting down gracefully (Ctrl+C again to force)...");
    requestStop();
  };

  process.on("SIGINT", handleSignal);
  process.on("SIGTERM", handleSignal);

  await runMonitorLoop();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
