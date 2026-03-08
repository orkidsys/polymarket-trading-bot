# Polymarket Copy Trading Bot — Implementation Plan

> Automated copy trading bot that mirrors trades from selected Polymarket traders with proportional position sizing and real-time execution. Trade history and performance are stored in **Supabase** (not MongoDB).

**Reference:** [nlhx/polymarket-copy-trading-bot](https://github.com/nlhx/polymarket-copy-trading-bot)

---

## 1. Overview

| Step | Description |
|------|-------------|
| **Select Traders** | Choose top performers from Polymarket leaderboard or Predictfolio |
| **Monitor Activity** | Bot watches new positions via Polymarket Data API (polling, default 1s) |
| **Calculate Size** | Scale trades by your balance vs. trader balance (with optional tiered multipliers) |
| **Execute Orders** | Place matching orders on Polymarket CLOB using your wallet |
| **Track Performance** | Store all trades and positions in **Supabase** |

---

## 2. Tech Stack

| Layer | Choice | Purpose |
|-------|--------|---------|
| Runtime | **Node.js 18+** | Align with reference; good SDK support |
| Language | **TypeScript** | Type safety, maintainability |
| Auth / Orders | **Polymarket CLOB** | L1 (EIP-712) + L2 (HMAC) auth; create/post orders |
| Data / Monitoring | **Polymarket Data API** | Positions, activity, trades per user |
| Database | **Supabase (PostgreSQL)** | Trade history, positions, config, performance |
| Chain | **Polygon** | USDC and gas (POL/MATIC) |
| RPC | **Alchemy / Infura** | Polygon RPC for signing and txs |

**Key APIs:**

- [Polymarket CLOB](https://docs.polymarket.com/developers/CLOB/introduction) — orders, auth
- [Polymarket Data API](https://docs.polymarket.com/developers/misc-endpoints/data-api-*) — positions, activity, trades
- [Polymarket Data SDK](https://polymarket-data.com/quickstart) (optional) — typed access to data API

---

## 3. Supabase Schema (replaces MongoDB)

Use Supabase for all persistent state: traders, positions, trades, and copy config.

### 3.1 Tables

```sql
-- Traders we copy (from leaderboard/Predictfolio)
CREATE TABLE copied_traders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  address       TEXT NOT NULL UNIQUE,
  label         TEXT,
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- Our copy-trading config (multipliers, limits)
CREATE TABLE copy_config (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_multiplier      NUMERIC DEFAULT 1.0,
  fetch_interval_sec    INTEGER DEFAULT 1,
  max_position_usd      NUMERIC,
  tiered_multipliers    JSONB,  -- e.g. [{"min_usd": 0, "max_usd": 100, "mult": 1}, ...]
  max_slippage_bps      INTEGER DEFAULT 50,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

-- Snapshot of trader positions we use for diffing (Data API response cached)
CREATE TABLE trader_position_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trader_address  TEXT NOT NULL,
  market_slug     TEXT NOT NULL,
  outcome         TEXT NOT NULL,
  size            NUMERIC NOT NULL,
  avg_price       NUMERIC,
  raw_snapshot    JSONB,
  fetched_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (trader_address, market_slug, outcome)
);

-- Positions we have opened (mirror of trader positions)
CREATE TABLE our_positions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trader_address  TEXT NOT NULL,
  market_slug     TEXT NOT NULL,
  token_id        TEXT NOT NULL,
  outcome         TEXT NOT NULL,
  size            NUMERIC NOT NULL,
  avg_price       NUMERIC,
  cost_basis_usd  NUMERIC,
  source_trade_ids UUID[],
  opened_at       TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  closed_at       TIMESTAMPTZ
);

-- Individual copy trades we executed (for history and aggregation)
CREATE TABLE copy_trades (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trader_address  TEXT NOT NULL,
  market_slug     TEXT NOT NULL,
  token_id        TEXT NOT NULL,
  side            TEXT NOT NULL,  -- BUY | SELL
  size            NUMERIC NOT NULL,
  price           NUMERIC NOT NULL,
  order_id        TEXT,
  clob_tx_hash    TEXT,
  status          TEXT DEFAULT 'pending',  -- pending | filled | failed | cancelled
  our_position_id UUID REFERENCES our_positions(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  filled_at       TIMESTAMPTZ
);

-- Optional: balance snapshots for sizing and analytics
CREATE TABLE balance_snapshots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source       TEXT NOT NULL,  -- 'our_wallet' | trader address
  balance_usd  NUMERIC NOT NULL,
  snapshot_at  TIMESTAMPTZ DEFAULT now()
);
```

### 3.2 Row Level Security (RLS)

- Enable RLS on all tables.
- Use a single service role key in the bot for full access.
- Optionally add a `user_id` and RLS policies if you later support multiple “accounts” per Supabase project.

### 3.3 Indexes

- `trader_position_snapshots (trader_address, fetched_at)`
- `our_positions (trader_address, market_slug, closed_at)`
- `copy_trades (trader_address, created_at)`, `copy_trades (our_position_id)`

---

## 4. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Copy Trading Bot (Node/TS)                       │
├─────────────────────────────────────────────────────────────────────────┤
│  Config Loader     │  Trader Monitor       │  Sizing Engine              │
│  (env + Supabase)  │  (Data API polling)   │  (balance, multipliers)     │
├────────────────────┼───────────────────────┼─────────────────────────────┤
│  Position Diff     │  Trade Aggregator     │  Order Executor             │
│  (new/closed pos)  │  (batch small → 1)    │  (CLOB createAndPostOrder)  │
├────────────────────┼───────────────────────┼─────────────────────────────┤
│  Supabase Client   │  Slippage Guard       │  Health / Logging           │
└─────────────────────────────────────────────────────────────────────────┘
         │                     │                          │
         ▼                     ▼                          ▼
   Supabase (DB)      Polymarket Data API          Polymarket CLOB
   (trades, config)   (positions, activity)        (orders, auth)
```

---

## 5. Module Breakdown

| Module | Responsibility | Deps |
|--------|----------------|------|
| **config** | Load `USER_ADDRESSES`, `PROXY_WALLET`, `PRIVATE_KEY`, Supabase URL/key, RPC, CLOB URLs, `TRADE_MULTIPLIER`, `FETCH_INTERVAL`, tiered multipliers, max slippage. Optionally override from Supabase `copy_config`. | — |
| **supabase** | CRUD for traders, config, position snapshots, our positions, copy_trades, balance snapshots. | `@supabase/supabase-js` |
| **data-api** | Fetch positions per trader (`GET /positions?user=...`), activity/trades if needed. Map to internal position type. | `node-fetch` or `axios` |
| **position-diff** | Compare latest Data API positions with `trader_position_snapshots` and local `our_positions` to detect new/closed positions and size changes. Output: list of “intents” (BUY/SELL, market, size). | config, supabase, data-api |
| **sizing** | Given an intent and optional tiered rules: (1) get our balance and trader balance (Data API or cached), (2) compute proportional size, (3) apply multiplier (global + tiered). Return size in USD/shares. | config, data-api, supabase |
| **aggregator** | Group small intents (same market, same side) into a single order size to reduce number of CLOB orders. | — |
| **slippage** | For each order: get current best bid/ask from CLOB L2; if execution would exceed `max_slippage_bps`, skip or log. | CLOB client |
| **clob-client** | Init CLOB client (L1 derive API creds, L2 HMAC). Create limit/market orders, post, check fills. Handle USDC allowance if needed. | Polymarket `@polymarket/clob-client` or equivalent |
| **executor** | Take aggregated intents → sizing → slippage check → createAndPostOrder (or createAndPostMarketOrder). Persist each fill as `copy_trades` and update `our_positions`. | clob-client, sizing, slippage, supabase |
| **monitor** | Main loop: every `FETCH_INTERVAL` s, for each active trader fetch positions, run position-diff, sizing, aggregator, executor. Update `trader_position_snapshots` and balances. | data-api, position-diff, executor, supabase |
| **health** | Check: Supabase connection, CLOB auth, RPC, USDC balance. Endpoint or CLI `npm run health-check`. | config, supabase, clob-client |

---

## 6. Implementation Phases

### Phase 1 — Foundation (Week 1)

1. **Repo and env**
   - Init Node + TypeScript project (`package.json`, `tsconfig.json`, eslint/prettier).
   - Add `.env.example`: `USER_ADDRESSES`, `PROXY_WALLET`, `PRIVATE_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RPC_URL`, `CLOB_HTTP_URL`, `CLOB_WS_URL`, `USDC_CONTRACT_ADDRESS`, `TRADE_MULTIPLIER`, `FETCH_INTERVAL`, optional tiered multiplier JSON and `MAX_SLIPPAGE_BPS`.
   - Document required env in README.

2. **Supabase**
   - Create Supabase project; run schema (tables + indexes + RLS).
   - Implement `supabase` module: insert/update/select for `copied_traders`, `copy_config`, `trader_position_snapshots`, `our_positions`, `copy_trades`, `balance_snapshots`.

3. **Config**
   - Load env and optionally merge with `copy_config` from Supabase (trade_multiplier, fetch_interval, tiered_multipliers, max_slippage_bps).

4. **Data API client**
   - Implement `data-api` module: fetch positions for a given address (Polymarket Data API). Parse into internal `Position` type (market, outcome, size, avg price, token id). Handle rate limits and errors.

5. **Health check**
   - Implement `health`: Supabase ping, RPC ping, and (if possible) CLOB credential check. `npm run health-check`.

**Deliverable:** App that loads config, connects to Supabase, fetches positions for one hardcoded trader, and passes health check.

---

### Phase 2 — CLOB and Execution (Week 2)

1. **CLOB client**
   - Integrate Polymarket CLOB client (e.g. `@polymarket/clob-client` or official SDK). Implement L1 (EIP-712) + L2 (HMAC) auth; derive and store API creds.
   - Implement: get balance/allowance (USDC); get order book (L2) for a token for slippage.
   - Implement: createAndPostOrder (limit) and optionally createAndPostMarketOrder with correct params (tokenID, price, size, side, tickSize). Handle GTC/GTD/FOK/FAK if needed.

2. **Sizing**
   - Implement `sizing` module: fetch our wallet USDC balance; fetch or estimate trader balance (from Data API or cached in Supabase). Compute proportional size = (our_balance / trader_balance) * trader_trade_size * multiplier. Apply tiered multiplier from config by trade size. Return size in shares and USD.

3. **Slippage**
   - Implement `slippage` module: for a given token and side, get best bid/ask; compute implied fill price; compare to requested price; reject or warn if beyond `max_slippage_bps`.

4. **Executor**
   - Implement `executor`: input = list of orders (market, token_id, side, size, limit price). For each: slippage check → createAndPostOrder → on success insert `copy_trades` and upsert `our_positions`. On failure log and optionally retry.

**Deliverable:** Can place a single test order on Polymarket (e.g. small BUY) and record it in Supabase `copy_trades` and `our_positions`.

---

### Phase 3 — Copy Logic and Multi-Trader (Week 3)

1. **Position diff**
   - Implement `position-diff`: load last snapshot from `trader_position_snapshots` per trader; fetch current positions from Data API; diff by (market_slug, outcome): new position → BUY intent; increased size → BUY intent; decreased size → SELL intent; closed → SELL intent. Save new snapshot to Supabase.

2. **Aggregator**
   - Implement `aggregator`: group intents by (market_slug, token_id, side); sum sizes; output one order per group (optional min size threshold to avoid dust).

3. **Monitor loop**
   - Implement `monitor`: load active traders from Supabase (or `USER_ADDRESSES`); every `FETCH_INTERVAL` s run for each trader: data-api positions → position-diff → sizing for each intent → aggregator → executor. Update snapshots and balance cache. One process, sequential or controlled concurrency to avoid duplicate orders.

4. **Multi-trader**
   - Ensure trader list is from Supabase `copied_traders` (and/or env); loop over all active traders; tag every trade and position with `trader_address`.

**Deliverable:** Bot runs continuously; when a copied trader opens or changes a position, bot places proportional orders and records everything in Supabase.

---

### Phase 4 — Hardening and Features (Week 4)

1. **Tiered multipliers**
   - Ensure config supports tiered rules (e.g. by trade size buckets); apply in sizing module and add tests.

2. **Price protection**
   - Finalize slippage behavior: skip vs. log-and-continue; optional max spread. Document in README.

3. **Position tracking**
   - Reconcile `our_positions` with CLOB/Data API our positions periodically; correct size/avg_price on sells; set `closed_at` when size is zero.

4. **Error handling and idempotency**
   - Retry with backoff for CLOB/Data API/Supabase; avoid double-execution for the same “intent” (e.g. intent id or snapshot version). Log errors and optionally alert.

5. **Docs and ops**
   - README: quick start, env table, how to find traders (leaderboard, Predictfolio), Supabase setup, how to run and stop. Optional: Dockerfile, `docker-compose` for local Supabase.

**Deliverable:** Production-ready copy bot with Supabase-backed history and config.

---

## 7. Configuration Reference

| Variable | Description | Example |
|----------|-------------|---------|
| `USER_ADDRESSES` | Comma-separated trader addresses to copy | `'0xABC...,0xDEF...'` |
| `PROXY_WALLET` | Your Polygon wallet (executes trades) | `'0x123...'` |
| `PRIVATE_KEY` | Wallet private key (no 0x) | `abc123...` |
| `SUPABASE_URL` | Supabase project URL | `https://xxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server-only) | `eyJ...` |
| `RPC_URL` | Polygon RPC | `https://polygon-mainnet.g.alchemy.com/v2/...` |
| `CLOB_HTTP_URL` | CLOB API base | `https://clob.polymarket.com/` |
| `CLOB_WS_URL` | CLOB WS (optional) | `wss://ws-subscriptions-clob.polymarket.com/ws` |
| `USDC_CONTRACT_ADDRESS` | Polygon USDC | `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174` |
| `TRADE_MULTIPLIER` | Global size multiplier | `1.0` or `2.0` |
| `FETCH_INTERVAL` | Poll interval (seconds) | `1` |
| `MAX_SLIPPAGE_BPS` | Max slippage (basis points) | `50` |
| `TIERED_MULTIPLIERS` | Optional JSON: `[{ "min_usd", "max_usd", "mult" }]` | — |

---

## 8. Key Algorithms

- **Proportional size:** `our_size = (our_balance_usd / trader_balance_usd) * trader_trade_size_usd * multiplier`. Use tiered multiplier by `trader_trade_size_usd` if configured.
- **Position diff:** For each (market, outcome), compare current position size vs. previous snapshot; delta positive → BUY, delta negative → SELL; new row → BUY; removed row → SELL.
- **Aggregation:** Group by (market_slug, token_id, side); sum sizes; optionally filter out sizes below a minimum to avoid dust.
- **Slippage:** `allowed_price = ref_price * (1 ± max_slippage_bps/10000)`; get best opposite-side quote from L2; skip order if best price worse than allowed.

---

## 9. Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Data API rate limits | Respect headers; add jitter to poll interval; cache positions briefly. |
| CLOB rejections | Validate tickSize, size limits; use slippage guard; log and skip bad orders. |
| Double execution | Idempotency by intent key or snapshot version; single-threaded monitor loop. |
| Stale balances | Refresh our/trader balance at interval or before each sizing step. |
| Supabase down | Retry with backoff; optionally queue intents in memory and persist when Supabase recovers. |

---

## 10. References

- [Polymarket CLOB Introduction](https://docs.polymarket.com/developers/CLOB/introduction)
- [Polymarket Create Order](https://docs.polymarket.com/developers/CLOB/orders/create-order)
- [Polymarket Data API (positions)](https://docs.polymarket.com/developers/misc-endpoints/data-api-get-positions)
- [Polymarket Data SDK](https://polymarket-data.com/data/positions)
- [Reference repo: nlhx/polymarket-copy-trading-bot](https://github.com/nlhx/polymarket-copy-trading-bot)

---

*This plan assumes a single instance of the bot. For horizontal scaling, you would need distributed locking (e.g. Supabase advisory locks or Redis) so only one instance runs the monitor loop per config.*
