import { getProxyWallet } from "../config/index.js";
import { fetchPositions } from "../data-api/positions.js";
import { getOurPositionsOpen, updateOurPosition } from "../supabase/client.js";
import { withRetry } from "../lib/retry.js";

/**
 * Reconcile our_positions with Data API: if our wallet no longer has a position
 * for a token (or size is 0), mark the corresponding our_position as closed.
 * Run periodically from the monitor to correct for missed updates or external sells.
 */
export async function reconcileOurPositions(): Promise<{ closed: number }> {
  const ourWallet = getProxyWallet();
  const apiPositions = await withRetry(
    () => fetchPositions(ourWallet, { limit: 500 }),
    { maxRetries: 2 }
  );
  const byTokenId = new Map<string, { size: number }>();
  for (const p of apiPositions) {
    if (p.tokenId) {
      const existing = byTokenId.get(p.tokenId);
      const size = existing ? existing.size + p.size : p.size;
      byTokenId.set(p.tokenId, { size });
    }
  }

  const openRows = await getOurPositionsOpen();
  let closed = 0;
  for (const row of openRows) {
    const api = byTokenId.get(row.token_id);
    if (!api || api.size <= 0) {
      await updateOurPosition(row.id, { size: 0, closed_at: new Date().toISOString() });
      closed++;
    }
  }
  return { closed };
}
