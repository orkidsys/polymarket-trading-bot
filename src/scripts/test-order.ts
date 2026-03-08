/**
 * Place a single test order (for Phase 2 verification).
 * Set env: TEST_ORDER_TOKEN_ID, TEST_ORDER_MARKET_SLUG, TEST_ORDER_OUTCOME, TEST_ORDER_PRICE, TEST_ORDER_SIZE, TRADER_ADDRESS.
 * Optional: TRADER_ADDRESS (default from USER_ADDRESSES first).
 */
import "dotenv/config";
import { getCopiedTraders } from "../supabase/client.js";
import { runExecutorWithClob } from "../executor/index.js";

async function main(): Promise<void> {
  const tokenId = process.env.TEST_ORDER_TOKEN_ID;
  const marketSlug = process.env.TEST_ORDER_MARKET_SLUG ?? "test-market";
  const outcome = process.env.TEST_ORDER_OUTCOME ?? "Yes";
  const price = Number(process.env.TEST_ORDER_PRICE ?? "0.5");
  const size = Number(process.env.TEST_ORDER_SIZE ?? "1");
  let traderAddress = process.env.TEST_ORDER_TRADER_ADDRESS;

  if (!tokenId) {
    console.error("Set TEST_ORDER_TOKEN_ID (and optionally TEST_ORDER_PRICE, TEST_ORDER_SIZE, TEST_ORDER_MARKET_SLUG, TEST_ORDER_OUTCOME, TEST_ORDER_TRADER_ADDRESS)");
    process.exit(1);
  }

  if (!traderAddress) {
    const traders = await getCopiedTraders();
    traderAddress = traders[0]?.address;
  }
  if (!traderAddress) {
    console.error("Set TEST_ORDER_TRADER_ADDRESS or USER_ADDRESSES");
    process.exit(1);
  }

  console.log("Test order:", { tokenId, marketSlug, outcome, price, size, traderAddress });
  const result = await runExecutorWithClob({
    traderAddress,
    marketSlug,
    tokenId,
    outcome,
    side: "BUY",
    sizeShares: size,
    limitPrice: price,
  });

  if (result.success) {
    console.log("Order placed:", result.orderId, "copy_trade id:", result.copyTradeId);
  } else {
    console.error("Order failed:", result.error);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
