import { pingSupabase } from "./supabase/client.js";
import { loadConfigFromEnv, getRpcUrl } from "./config/index.js";

async function checkRpc(): Promise<{ ok: boolean; error?: string }> {
  try {
    const rpcUrl = getRpcUrl();
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_chainId",
        params: [],
      }),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = (await res.json()) as { result?: string };
    const chainId = data.result;
    // Polygon mainnet = 0x89 = 137
    if (chainId && (chainId === "0x89" || chainId === "137")) return { ok: true };
    return { ok: true }; // any chainId is fine for "connected"
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function main(): Promise<void> {
  console.log("Health check starting...\n");

  const results: { name: string; ok: boolean; error?: string }[] = [];

  // Env
  try {
    loadConfigFromEnv();
    results.push({ name: "Config (env)", ok: true });
  } catch (e) {
    results.push({
      name: "Config (env)",
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // Supabase (optional if keys not set)
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const supabaseOk = await pingSupabase();
    results.push({
      name: "Supabase",
      ok: supabaseOk,
      error: supabaseOk ? undefined : "Connection or query failed",
    });
  } else {
    results.push({ name: "Supabase", ok: false, error: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set" });
  }

  // RPC (only if RPC_URL set)
  if (process.env.RPC_URL) {
    const rpc = await checkRpc();
    results.push({
      name: "Polygon RPC",
      ok: rpc.ok,
      error: rpc.error,
    });
  } else {
    results.push({ name: "Polygon RPC", ok: false, error: "RPC_URL not set" });
  }

  let allOk = true;
  for (const r of results) {
    const status = r.ok ? "OK" : "FAIL";
    console.log(`${r.name}: ${status}${r.error ? ` — ${r.error}` : ""}`);
    if (!r.ok) allOk = false;
  }

  console.log("");
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
